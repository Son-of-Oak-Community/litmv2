import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySuccess } from "../modules/item/action/chat-actions.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// The pickers open real DialogV2s. Replace them with vi.fn so tests can drive
// the resolved-target shape directly. (Most cases use self-target verbs that
// skip the picker entirely.)
vi.mock("../modules/apps/target-picker.js", () => ({
	pickTargetActor: vi.fn(),
	pickLimit: vi.fn(),
}));

// applySuccess dispatches the GM relay through Sockets; mock the module so
// tests can assert on the payload without a live game.socket.
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

// chat-actions imports the regex from CONFIG.litmv2.tagStringRe in addition
// to makeTagStringRe directly. Either is fine for the new appliers; we just
// need the parseTagStringMatch path to work.
beforeEach(() => {
	vi.clearAllMocks();
	CONFIG.litmv2.tagStringRe = makeTagStringRe();
	game.users.activeGM = null;
	game.user.isGM = false;
});

const heroActor = (overrides = {}) => {
	const backpack = fakeItem({ type: "backpack" });
	const actor = fakeActor({
		type: "hero",
		system: { backpackItem: backpack },
		...overrides,
	});
	// HeroData.addStoryTag routes through the backpack item. Stub it here so
	// applySuccess's `actor.system.addStoryTag(effectData)` call exercises the
	// same routing without requiring the real data model.
	actor.system.addStoryTag = vi.fn((effectData) =>
		backpack.createEmbeddedDocuments("ActiveEffect", [
			{ ...effectData, transfer: true },
		]),
	);
	// Mirrors EffectTagsMixin.addStatus: case-insensitive stack-or-create.
	actor.system.addStatus = vi.fn(async (name, opts = {}) => {
		const { tier, tiers, img, isHidden = false, limitId = null } = opts;
		const markTier =
			tier ?? (tiers ? Math.max(1, tiers.lastIndexOf(true) + 1) : 1);
		const lower = name?.toLowerCase();
		const existing = lower
			? [...actor.allApplicableEffects()].find(
					(e) => e.type === "status_tag" && e.name.toLowerCase() === lower,
				)
			: null;
		if (existing) {
			const newTiers = existing.system.calculateMark(markTier);
			return existing.parent.updateEmbeddedDocuments("ActiveEffect", [
				{ _id: existing.id, "system.tiers": newTiers },
			]);
		}
		const data = {
			name,
			type: "status_tag",
			system: {
				tiers: tiers ?? Array.from({ length: 6 }, (_, i) => i + 1 === tier),
				isHidden,
				limitId,
			},
		};
		if (img) data.img = img;
		return actor.createEmbeddedDocuments("ActiveEffect", [data]);
	});
	return actor;
};

// Mirrors StatusTagData.calculateReduction — shifts each marked tier down by
// `amount` and drops anything that falls below tier 1. Lets tests exercise
// the real reduction shape (including the single-mark case) without depending
// on the actual DataModel class.
function calculateReduction(amount) {
	const newTiers = Array(6).fill(false);
	for (let i = 0; i < 6; i++) {
		if (this.tiers[i]) {
			const newIndex = i - amount;
			if (newIndex >= 0) newTiers[newIndex] = true;
		}
	}
	return newTiers;
}

describe("applySuccess — permission check", () => {
	it("warns and returns null when target is not owned and user is not GM", async () => {
		const actor = heroActor({ isOwner: false });
		const result = await applySuccess({
			success: { verb: "bestow", text: "[Resolve]" },
			actor,
		});
		expect(result).toBeNull();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});
});

describe("applySuccess — Lessen dispatches to Restore on self", () => {
	it("reduces a same-named status on the rolling hero", async () => {
		const wounded = fakeEffect({
			type: "status_tag",
			name: "wounded",
			system: {
				tiers: [true, true, false, false, false, false],
				calculateMark() {
					return this.tiers;
				},
				calculateReduction,
			},
		});
		const actor = heroActor({ effects: [wounded] });

		const result = await applySuccess({
			success: { verb: "lessen", text: "[wounded-1]" },
			actor,
		});

		expect(result).not.toBeNull();
		expect(result.appliedSummary).toContain("LITM.Actions.applied_reduced");
	});
});

describe("applySuccess — createOrTag (self-target, markup-driven)", () => {
	it("creates a story tag on the hero's backpack from [name] markup", async () => {
		const actor = heroActor();
		const result = await applySuccess({
			success: { verb: "bestow", text: "Grant [Sharp Eyes]" },
			actor,
		});

		expect(result.appliedSummary).toContain("LITM.Actions.applied_create_tag");
		expect(
			actor.system.backpackItem.createEmbeddedDocuments,
		).toHaveBeenCalledWith("ActiveEffect", [
			expect.objectContaining({
				type: "story_tag",
				name: "Sharp Eyes",
				system: expect.objectContaining({ isSingleUse: false }),
			}),
		]);
	});

	it("creates a single-use story tag from [name!] markup", async () => {
		const actor = heroActor();
		await applySuccess({
			success: { verb: "bestow", text: "[Spark!]" },
			actor,
		});

		const [, [data]] =
			actor.system.backpackItem.createEmbeddedDocuments.mock.calls[0];
		expect(data.system.isSingleUse).toBe(true);
		expect(data.name).toBe("Spark");
	});

	it("creates a fresh status from [name-N] markup when no existing matches", async () => {
		const actor = heroActor();
		await applySuccess({
			success: { verb: "enhance", text: "Inflict [Bruised-2]" },
			actor,
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			expect.objectContaining({
				type: "status_tag",
				name: "Bruised",
				system: expect.objectContaining({
					tiers: [false, true, false, false, false, false],
				}),
			}),
		]);
	});

	it("stacks onto an existing same-named status via calculateMark", async () => {
		const calculateMark = vi.fn(() => [
			false,
			false,
			true,
			false,
			false,
			false,
		]);
		const existing = fakeEffect({
			id: "s1",
			type: "status_tag",
			name: "Bruised",
			system: {
				tiers: [false, true, false, false, false, false],
				calculateMark,
			},
		});
		const actor = heroActor({ effects: [existing] });

		const result = await applySuccess({
			success: { verb: "enhance", text: "[Bruised-2]" },
			actor,
		});

		expect(calculateMark).toHaveBeenCalledWith(2);
		expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{
				_id: existing.id,
				"system.tiers": [false, false, true, false, false, false],
			},
		]);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(result.appliedSummary).toContain(
			"LITM.Actions.applied_create_status",
		);
	});

	it("uses chosenTiers for [name-] variable tokens", async () => {
		const actor = heroActor();
		await applySuccess({
			success: { verb: "enhance", text: "Inflict [bleeding-]" },
			actor,
			chosenTiers: [3],
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			expect.objectContaining({
				type: "status_tag",
				system: expect.objectContaining({
					tiers: [false, false, true, false, false, false],
				}),
			}),
		]);
	});

	it("skips a variable-tier token when its chosenTiers entry is missing or 0", async () => {
		// Variable tier defaults to 0 ("skip this token") so a success listing
		// many alternative statuses doesn't apply them all unintentionally — see
		// issue #91 where an Action Grimoire Attack rote with eight statuses
		// forced one of each at rank-1, swallowing the player's whole Power
		// budget. The player now opts in by raising the counter.
		const actor = heroActor();
		const result = await applySuccess({
			success: { verb: "enhance", text: "[bleeding-]" },
			actor,
			// no chosenTiers
		});

		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(result).toBeNull();
	});

	it("applies the picked subset and skips zero-tier alternatives", async () => {
		const actor = heroActor();
		await applySuccess({
			success: {
				verb: "enhance",
				text: "Apply [ferido-] [cortado-] [perfurado-]",
			},
			actor,
			chosenTiers: [0, 2, 0],
		});

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
		const [, [data]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(data.name).toBe("cortado");
		expect(data.system.tiers).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("applies multiple tokens in one success and joins the summary", async () => {
		const actor = heroActor();
		const result = await applySuccess({
			success: { verb: "bestow", text: "Grant [aim] and [focused-1]" },
			actor,
		});

		expect(
			actor.system.backpackItem.createEmbeddedDocuments,
		).toHaveBeenCalledWith("ActiveEffect", [
			expect.objectContaining({ name: "aim", type: "story_tag" }),
		]);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			expect.objectContaining({ name: "focused", type: "status_tag" }),
		]);
		expect(result.appliedSummary).toContain(" · ");
	});

	it("falls back to the prose text when the success has no markup", async () => {
		const actor = heroActor();
		const result = await applySuccess({
			success: { verb: "create", text: "Set the scene mood" },
			actor,
		});
		expect(result.appliedSummary).toBe("Set the scene mood");
		expect(
			actor.system.backpackItem.createEmbeddedDocuments,
		).not.toHaveBeenCalled();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("applySuccess — restore", () => {
	it("reduces a multi-tier status by the parsed tier", async () => {
		const status = fakeEffect({
			id: "s1",
			type: "status_tag",
			name: "Bruised",
			system: {
				tiers: [true, true, true, false, false, false],
				calculateReduction,
			},
		});
		const actor = heroActor({ effects: [status] });

		const result = await applySuccess({
			success: { verb: "restore", text: "[Bruised-1]" },
			actor,
		});

		expect(status.update).toHaveBeenCalledWith({
			"system.tiers": [true, true, false, false, false, false],
		});
		expect(status.delete).not.toHaveBeenCalled();
		expect(result.appliedSummary).toContain("LITM.Actions.applied_reduced");
	});

	it("reduces a single-mark tier-3 status to tier 1 via [name-2] (regression)", async () => {
		// Freshly-created statuses use a single-mark array: only the current
		// tier is `true`. The reduce path used to zero them out instead of
		// shifting the mark down — this pins that calculateReduction is used.
		const status = fakeEffect({
			id: "s3",
			type: "status_tag",
			name: "Bruised",
			system: {
				tiers: [false, false, true, false, false, false],
				calculateReduction,
			},
		});
		const actor = heroActor({ effects: [status] });

		await applySuccess({
			success: { verb: "restore", text: "[Bruised-2]" },
			actor,
		});

		expect(status.update).toHaveBeenCalledWith({
			"system.tiers": [true, false, false, false, false, false],
		});
		expect(status.delete).not.toHaveBeenCalled();
	});

	it("deletes a status when reduction takes it past tier 1", async () => {
		const status = fakeEffect({
			id: "s2",
			type: "status_tag",
			name: "Tired",
			system: { tiers: [true, false, false, false, false, false] },
		});
		const actor = heroActor({ effects: [status] });

		await applySuccess({
			success: { verb: "restore", text: "[Tired-1]" },
			actor,
		});

		expect(status.delete).toHaveBeenCalled();
		expect(status.update).not.toHaveBeenCalled();
	});

	it("unscratches a scratched tag of the same name when no status matches", async () => {
		const tag = fakeEffect({
			id: "t1",
			type: "story_tag",
			name: "Lantern",
			system: { isScratched: true },
		});
		// Mirror ScratchableMixin#setScratched — the fake system is a plain object
		tag.system.setScratched = (v) => tag.update({ "system.isScratched": v });
		const actor = heroActor({ effects: [tag] });

		const result = await applySuccess({
			success: { verb: "restore", text: "[Lantern]" },
			actor,
		});

		expect(tag.update).toHaveBeenCalledWith({ "system.isScratched": false });
		expect(result.appliedSummary).toContain("LITM.Actions.applied_unscratched");
	});

	it("notifies and returns null when nothing matches", async () => {
		const actor = heroActor();
		const result = await applySuccess({
			success: { verb: "restore", text: "[Nothing]" },
			actor,
		});

		expect(result).toBeNull();
		expect(ui.notifications.info).toHaveBeenCalled();
	});
});

describe("applySuccess — discover", () => {
	it("returns the success text without touching the actor", async () => {
		const actor = heroActor();
		const result = await applySuccess({
			success: {
				verb: "discover",
				text: "A hidden passage glints behind the tapestry.",
			},
			actor,
		});

		expect(result).toEqual({
			appliedSummary: "A hidden passage glints behind the tapestry.",
		});
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("falls back to the default localization key when text is empty", async () => {
		const actor = heroActor();
		const fallback = await applySuccess({
			success: { verb: "discover", text: "" },
			actor,
		});
		expect(fallback.appliedSummary).toBe("LITM.Actions.discover_default");
	});
});

describe("applySuccess — weaken (opponent target, mocked picker)", () => {
	it("removes a named status from the picked opponent (full delete when tier >= current)", async () => {
		const { pickTargetActor } = await import(
			"../modules/apps/target-picker.js"
		);
		const status = fakeEffect({
			id: "s1",
			type: "status_tag",
			name: "Blessed",
			system: { tiers: [false, false, true, false, false, false] },
		});
		const opponent = fakeActor({ name: "Beast", effects: [status] });
		pickTargetActor.mockResolvedValue(opponent);

		const result = await applySuccess({
			// No tier specified → falls through to delete via the variable-tier path
			// resolves to tier 1, which is < current tier 3, so reduce by 1.
			success: { verb: "weaken", text: "Strip [Blessed-3]" },
			actor: heroActor(),
		});

		expect(status.delete).toHaveBeenCalled();
		expect(result.appliedSummary).toContain(
			"LITM.Actions.applied_weaken_status",
		);
	});

	it("returns null when the picker is cancelled", async () => {
		const { pickTargetActor } = await import(
			"../modules/apps/target-picker.js"
		);
		pickTargetActor.mockResolvedValue(null);

		const result = await applySuccess({
			success: { verb: "weaken", text: "[Anything]" },
			actor: heroActor(),
		});

		expect(result).toBeNull();
	});

	it("warns and returns null when success text has no markup", async () => {
		const { pickTargetActor } = await import(
			"../modules/apps/target-picker.js"
		);
		pickTargetActor.mockResolvedValue(fakeActor({ name: "Beast" }));

		const result = await applySuccess({
			success: { verb: "weaken", text: "Just narrative, no markup" },
			actor: heroActor(),
		});

		expect(result).toBeNull();
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Actions.apply_weaken_needs_name",
		);
	});
});

describe("applySuccess — GM relay for unowned targets", () => {
	it("dispatches applySuccessAsGM and returns {relayed:true} when a GM is active", async () => {
		const { Sockets } = await import("../modules/system/sockets.js");
		const { pickTargetActor } = await import(
			"../modules/apps/target-picker.js"
		);
		const status = fakeEffect({
			id: "s1",
			type: "status_tag",
			name: "Blessed",
			system: { tiers: [false, false, true, false, false, false] },
		});
		const opponent = fakeActor({
			id: "opp1",
			name: "Beast",
			isOwner: false,
			effects: [status],
		});
		pickTargetActor.mockResolvedValue(opponent);
		game.users.activeGM = { id: "gm-1" };

		const actor = heroActor();
		const result = await applySuccess({
			success: { id: "succ1", verb: "weaken", text: "Strip [Blessed-3]" },
			actor,
			chosenTiers: [],
			chosenTags: null,
			relay: { messageId: "m1", successKey: "succ1" },
		});

		expect(result).toEqual({ relayed: true });
		expect(Sockets.dispatch).toHaveBeenCalledWith("applySuccessAsGM", {
			userId: "user-1",
			actorId: actor.id,
			messageId: "m1",
			successKey: "succ1",
			targetActorId: "opp1",
			limitInfo: null,
			chosenTiers: [],
			chosenTags: null,
		});
		// Nothing mutated locally, nothing warned.
		expect(status.delete).not.toHaveBeenCalled();
		expect(status.update).not.toHaveBeenCalled();
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("serializes limitInfo for process verbs (limit picked on the player client)", async () => {
		const { Sockets } = await import("../modules/system/sockets.js");
		const { pickLimit } = await import("../modules/apps/target-picker.js");
		const gate = fakeActor({ id: "j1", name: "Gate", isOwner: false });
		pickLimit.mockResolvedValue({
			actor: gate,
			limitId: "L1",
			limit: { id: "L1", label: "Siege" },
			source: "system",
		});
		game.users.activeGM = { id: "gm-1" };

		const result = await applySuccess({
			success: { id: "succ2", verb: "advance", text: "" },
			actor: heroActor(),
			relay: { messageId: "m1", successKey: "succ2" },
		});

		expect(result).toEqual({ relayed: true });
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"applySuccessAsGM",
			expect.objectContaining({
				targetActorId: "j1",
				limitInfo: { actorId: "j1", limitId: "L1", source: "system" },
			}),
		);
	});

	it("keeps the warn-and-null behavior when no GM is active, even with relay context", async () => {
		const { Sockets } = await import("../modules/system/sockets.js");
		const { pickTargetActor } = await import(
			"../modules/apps/target-picker.js"
		);
		pickTargetActor.mockResolvedValue(
			fakeActor({ name: "Beast", isOwner: false }),
		);

		const result = await applySuccess({
			success: { id: "succ1", verb: "weaken", text: "[Blessed-3]" },
			actor: heroActor(),
			relay: { messageId: "m1", successKey: "succ1" },
		});

		expect(result).toBeNull();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});

	it("does not relay without relay context (non-Spend-Power callers keep the warn)", async () => {
		const { Sockets } = await import("../modules/system/sockets.js");
		const { pickTargetActor } = await import(
			"../modules/apps/target-picker.js"
		);
		pickTargetActor.mockResolvedValue(
			fakeActor({ name: "Beast", isOwner: false }),
		);
		game.users.activeGM = { id: "gm-1" };

		const result = await applySuccess({
			success: { id: "succ1", verb: "weaken", text: "[Blessed-3]" },
			actor: heroActor(),
		});

		expect(result).toBeNull();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});

	it("uses presetLimitInfo without opening the limit picker (GM re-apply path)", async () => {
		const { pickLimit } = await import("../modules/apps/target-picker.js");
		game.user.isGM = true;
		const gate = fakeActor({ id: "j1", name: "Gate", isOwner: false });
		gate.system.advanceLimit = vi.fn(async () => ({
			limit: { label: "Siege" },
			value: 3,
			max: 5,
		}));

		const result = await applySuccess({
			success: { id: "succ2", verb: "advance", text: "" },
			actor: heroActor(),
			presetLimitInfo: { actor: gate, limitId: "L1", source: "system" },
		});

		expect(pickLimit).not.toHaveBeenCalled();
		expect(gate.system.advanceLimit).toHaveBeenCalledWith("L1", 1);
		expect(result.appliedSummary).toContain("LITM.Actions.applied_advance");
	});
});
