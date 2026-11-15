import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyActionSuccess,
	handleApplySuccessAsGM,
} from "../modules/apps/spend-power-service.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import {
	actionRollMessage,
	fakeAction,
	fakeBlessed,
	wireActors,
	wireMessage,
} from "./__helpers__/spend-power.js";

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	CONFIG.litmv2.tagStringRe = makeTagStringRe();
	game.users.activeGM = null;
	game.user.isGM = false;
});

afterEach(() => {
	vi.restoreAllMocks();
});

function wire({ message, action, actors = {} }) {
	wireMessage(message);
	foundry.utils.fromUuid.mockResolvedValue(action);
	wireActors(...Object.values(actors));
}

describe("applyActionSuccess — applied path", () => {
	it("applies to the target, persists both flags in one update, and posts the chat card", async () => {
		const status = fakeBlessed();
		const target = fakeActor({ id: "c1", name: "Beast", effects: [status] });
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		const message = actionRollMessage();
		wire({ message, action: fakeAction(), actors: { c1: target, h1: hero } });
		game.user.isGM = true; // GM client — permission guard passes

		const result = await applyActionSuccess({
			actor: hero,
			messageId: "m1",
			successKey: "succ1",
			presetTarget: target,
		});

		expect(result).toEqual({ spent: 3, status: "applied" });
		expect(status.delete).toHaveBeenCalled(); // tier 3 vs tier-3 status → removed
		// Cost is written as a per-key dot path so concurrent writers merge
		// instead of clobbering the costs object.
		expect(message.update).toHaveBeenCalledWith({
			"flags.litmv2.appliedSuccesses": ["succ1"],
			"flags.litmv2.appliedSuccessCosts.succ1": 3,
		});
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({ speaker: { actor: "h1" } }),
		);
	});

	it("bails on the race guard without touching the target", async () => {
		const status = fakeBlessed();
		const target = fakeActor({ id: "c1", name: "Beast", effects: [status] });
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage({
			applied: ["succ1"],
			costs: { succ1: 3 },
		});
		wire({ message, action: fakeAction(), actors: { c1: target } });
		game.user.isGM = true;

		const result = await applyActionSuccess({
			actor: hero,
			messageId: "m1",
			successKey: "succ1",
			presetTarget: target,
		});

		expect(result).toEqual({ spent: 0, status: "already" });
		expect(status.delete).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("treats a costs-only record as applied (clobbered-array heal)", async () => {
		// A concurrent writer can replace the appliedSuccesses array and lose
		// an entry; the merge-safe appliedSuccessCosts object still has it.
		const status = fakeBlessed();
		const target = fakeActor({ id: "c1", name: "Beast", effects: [status] });
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage({ applied: [], costs: { succ1: 3 } });
		wire({ message, action: fakeAction(), actors: { c1: target } });
		game.user.isGM = true;

		const result = await applyActionSuccess({
			actor: hero,
			messageId: "m1",
			successKey: "succ1",
			presetTarget: target,
		});

		expect(result).toEqual({ spent: 0, status: "already" });
		expect(status.delete).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
	});

	it("returns status 'nothing' when the applier finds no matching effect", async () => {
		const target = fakeActor({ id: "c1", name: "Beast", effects: [] });
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage();
		wire({ message, action: fakeAction(), actors: { c1: target } });
		game.user.isGM = true;

		const result = await applyActionSuccess({
			actor: hero,
			messageId: "m1",
			successKey: "succ1",
			presetTarget: target,
		});

		expect(result).toEqual({ spent: 0, status: "nothing" });
		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("applyActionSuccess — relayed path (player client)", () => {
	it("relays to the GM: no flags, no chat card, 0 charged", async () => {
		const status = fakeBlessed();
		const target = fakeActor({
			id: "c1",
			name: "Beast",
			isOwner: false,
			effects: [status],
		});
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage();
		wire({ message, action: fakeAction(), actors: { c1: target } });
		game.users.activeGM = { id: "gm-1" }; // player client + GM online

		const result = await applyActionSuccess({
			actor: hero,
			messageId: "m1",
			successKey: "succ1",
			presetTarget: target,
		});

		expect(result).toEqual({ spent: 0, status: "relayed" });
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"applySuccessAsGM",
			expect.objectContaining({
				messageId: "m1",
				successKey: "succ1",
				targetActorId: "c1",
			}),
		);
		expect(status.delete).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("handleApplySuccessAsGM — GM socket handler", () => {
	// The handler runs on the GM client (the socket listener gates on
	// activeGM before calling it), so every test sets game.user.isGM.
	beforeEach(() => {
		game.user.isGM = true;
	});

	function relayPayload(overrides = {}) {
		return {
			userId: "player-1",
			actorId: "h1",
			messageId: "m1",
			successKey: "succ1",
			targetActorId: "c1",
			limitInfo: null,
			chosenTiers: [],
			chosenTags: null,
			...overrides,
		};
	}

	it("applies to the relayed target and persists the flags on the player's message", async () => {
		const status = fakeBlessed();
		const target = fakeActor({ id: "c1", name: "Beast", effects: [status] });
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		const message = actionRollMessage();
		wire({ message, action: fakeAction(), actors: { c1: target, h1: hero } });

		await handleApplySuccessAsGM(relayPayload());

		expect(status.delete).toHaveBeenCalled();
		expect(message.update).toHaveBeenCalledWith({
			"flags.litmv2.appliedSuccesses": ["succ1"],
			"flags.litmv2.appliedSuccessCosts.succ1": 3,
		});
		// Chat card speaks as the hero — indistinguishable from a local apply.
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({ speaker: { actor: "h1" } }),
		);
		// No whisper on a successful apply.
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalledWith(
			expect.objectContaining({ whisper: ["player-1"] }),
		);
	});

	it("respects the appliedSuccesses race guard silently (no whisper)", async () => {
		const status = fakeBlessed();
		const target = fakeActor({ id: "c1", name: "Beast", effects: [status] });
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage({
			applied: ["succ1"],
			costs: { succ1: 3 },
		});
		wire({ message, action: fakeAction(), actors: { c1: target, h1: hero } });

		await handleApplySuccessAsGM(relayPayload());

		expect(status.delete).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("whispers the acting player when nothing was applied", async () => {
		const target = fakeActor({ id: "c1", name: "Beast", effects: [] });
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage();
		wire({ message, action: fakeAction(), actors: { c1: target, h1: hero } });

		await handleApplySuccessAsGM(relayPayload());

		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledTimes(1);
		// The i18n shim returns the key itself; the {name} data is asserted via
		// game.i18n.format's call — content resolves to the localization key.
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({
				whisper: ["player-1"],
				content: expect.stringContaining("LITM.Actions.apply_relay_nothing"),
			}),
		);
	});

	it("resolves limitInfo actor ids back to documents for process verbs", async () => {
		const gate = fakeActor({ id: "j1", name: "Gate" });
		gate.system.advanceLimit = vi.fn(async () => ({
			limit: { label: "Siege" },
			value: 3,
			max: 5,
		}));
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage();
		const action = {
			type: "action",
			name: "Push On",
			system: {
				successes: [{ id: "succ1", verb: "advance", text: "" }],
			},
		};
		wire({ message, action, actors: { j1: gate, h1: hero } });

		await handleApplySuccessAsGM(
			relayPayload({
				targetActorId: "j1",
				limitInfo: { actorId: "j1", limitId: "L1", source: "system" },
			}),
		);

		expect(gate.system.advanceLimit).toHaveBeenCalledWith("L1", 1);
		expect(message.update).toHaveBeenCalled();
	});

	it("bails silently when the relayed target no longer resolves", async () => {
		const hero = fakeActor({ id: "h1" });
		const message = actionRollMessage();
		wire({ message, action: fakeAction(), actors: { h1: hero } }); // no c1

		await handleApplySuccessAsGM(relayPayload({ targetActorId: "c1" }));

		// Bailed before the pipeline: no flags read, no mutation, no whisper,
		// and crucially no target picker opened on the GM client.
		expect(message.getFlag).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("serializes concurrent relays for the same message (no lost flag updates)", async () => {
		// Two successes relayed from one Spend Power submission arrive
		// back-to-back. Without per-message serialization both pipelines read
		// the flags before either writes, and the array (replaced wholesale on
		// update) keeps only the last writer's entry.
		const blessed = fakeBlessed();
		const cursed = fakeEffect({
			id: "s2",
			type: "status_tag",
			name: "Cursed",
			system: { tiers: [false, true, false, false, false, false] },
		});
		const target = fakeActor({
			id: "c1",
			name: "Beast",
			effects: [blessed, cursed],
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		// Stateful message mirroring Foundry semantics: array flags replace
		// wholesale, object flags merge per dot-path key.
		const flags = {
			actionUuid: "Item.act1",
			appliedSuccesses: [],
			appliedSuccessCosts: {},
		};
		const message = {
			id: "m1",
			getFlag: vi.fn((_s, key) => foundry.utils.deepClone(flags[key])),
			update: vi.fn(async (data) => {
				for (const [k, v] of Object.entries(data)) {
					if (k === "flags.litmv2.appliedSuccesses") {
						flags.appliedSuccesses = v;
					} else if (k.startsWith("flags.litmv2.appliedSuccessCosts.")) {
						flags.appliedSuccessCosts[k.split(".").at(-1)] = v;
					}
				}
			}),
			setFlag: vi.fn(),
		};
		const action = {
			type: "action",
			name: "Twin Strike",
			system: {
				successes: [
					{ id: "succ1", verb: "weaken", text: "Strip [Blessed-3]" },
					{ id: "succ2", verb: "weaken", text: "Break [Cursed-2]" },
				],
			},
		};
		wire({ message, action, actors: { c1: target, h1: hero } });

		await Promise.all([
			handleApplySuccessAsGM(relayPayload({ successKey: "succ1" })),
			handleApplySuccessAsGM(relayPayload({ successKey: "succ2" })),
		]);

		expect(flags.appliedSuccesses).toEqual(["succ1", "succ2"]);
		expect(flags.appliedSuccessCosts).toEqual({ succ1: 3, succ2: 2 });
		expect(blessed.delete).toHaveBeenCalled();
		expect(cursed.delete).toHaveBeenCalled();
	});
});
