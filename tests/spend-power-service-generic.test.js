import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postSpendChat } from "../modules/apps/spend-power.js";
import {
	applyActionSuccess,
	applySpendIntent,
} from "../modules/apps/spend-power-service.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import {
	actionRollMessage,
	counterOption,
	fakeAction,
	fakeBlessed,
	fakeStatus,
	fakeTarget,
	inflictIntent,
	inflictOption,
	recoverIntent,
	reduceIntent,
	scratchIntent,
	spendIntent,
	wireActors,
	wireMessage,
} from "./__helpers__/spend-power.js";

// The generic Spend Power options (Core Book p.165): what each one bills, what
// it writes, and what the table is shown. Power is scarce, so a write that
// could not land is neither charged nor announced.

let sidebar;

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	vi.spyOn(StoryTagsStore, "packStoryTags", "get").mockReturnValue([]);
	// The card template is not rendered here; hand back what it was given.
	vi.spyOn(
		foundry.applications.handlebars,
		"renderTemplate",
	).mockImplementation(async (_path, data) => JSON.stringify(data));
	sidebar = { doUpdate: vi.fn(async () => {}) };
	game.litmv2 = { storyTags: sidebar };
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
	game.messages.get = vi.fn(() => null);
});

afterEach(() => {
	vi.restoreAllMocks();
	delete game.litmv2;
	delete ui.combat;
});

const hero = () => fakeActor({ id: "h1", name: "Gerrin" });

/** A free-text option: Create a Tag unless told otherwise. */
const createOption = (entries, overrides = {}) => ({
	kind: "default",
	optionId: "create_recover_tag",
	label: "LITM.Effects.create.action",
	cost: 2,
	hasTier: false,
	draggable: true,
	entries,
	targetActorId: null,
	...overrides,
});

const extraFeat = () =>
	createOption([], {
		optionId: "extra_feat",
		label: "LITM.Effects.extra_feat.action",
		cost: 1,
		draggable: false,
	});

const sceneChip = (tagId, tagName, isSingleUse = false) => ({
	tagId,
	tagName,
	actorId: "",
	isScene: true,
	isSingleUse,
});

describe("applySpendIntent: free-text options", () => {
	it("charges 2 for a created tag and 1 for a single-use one, as draggable chips", async () => {
		const { results, totalSpent } = await applySpendIntent(
			hero(),
			spendIntent(
				createOption([
					{ name: "rope", tier: null, isSingleUse: false },
					{ name: "torch", tier: null, isSingleUse: true },
				]),
			),
		);

		expect(results[0]).toEqual({
			kind: "default",
			optionId: "create_recover_tag",
			power: 3,
			body: "[rope] [torch!]",
		});
		expect(totalSpent).toBe(3);
	});

	it("charges an option with no entries its flat cost (Extra Feat: 1)", async () => {
		const { results, totalSpent } = await applySpendIntent(
			hero(),
			spendIntent(extraFeat()),
		);

		expect(results[0]).toMatchObject({ power: 1, body: "" });
		expect(totalSpent).toBe(1);
	});

	it("escapes a typed name before it reaches the chat body", async () => {
		const { results } = await applySpendIntent(
			hero(),
			spendIntent([
				createOption([{ name: "<b>rope</b>", isSingleUse: false }]),
				createOption([{ name: "<i>plan</i>", isSingleUse: false }], {
					optionId: "plain",
					draggable: false,
				}),
			]),
		);

		expect(results[0].body).toBe("[&lt;b&gt;rope&lt;/b&gt;]");
		expect(results[1].body).toBe("<em>&lt;i&gt;plan&lt;/i&gt;</em>");
	});

	it("charges a counter option per count and adds every option to the roll's spend", async () => {
		const message = wireMessage({
			id: "m1",
			getFlag: vi.fn(() => undefined),
			setFlag: vi.fn(async () => {}),
		});

		const { results, totalSpent } = await applySpendIntent(
			hero(),
			spendIntent([counterOption(3), extraFeat()], { messageId: "m1" }),
		);

		expect(results[0]).toMatchObject({ kind: "counter", power: 3, count: 3 });
		expect(totalSpent).toBe(4);
		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 4);
	});
});

describe("applySpendIntent: Inflict with nobody to write it", () => {
	it("writes nothing and charges nothing for an unowned target when no GM is active", async () => {
		const foe = fakeTarget({ isOwner: false });
		const actor = hero();
		wireActors(actor, foe);

		const { results, totalSpent } = await applySpendIntent(
			actor,
			inflictIntent({ targetActorId: "c1" }),
		);

		expect(foe.system.addStatus).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({ power: 0, body: "" });
		expect(totalSpent).toBe(0);
	});
});

describe("applySpendIntent: scratching scene story tags", () => {
	it("writes through the Tags sidebar for a Narrator, and bills each tag", async () => {
		game.user.isGM = true;

		const { results, totalSpent } = await applySpendIntent(
			hero(),
			scratchIntent([sceneChip("s1", "fog", true), sceneChip("s2", "rain")]),
		);

		expect(sidebar.doUpdate).toHaveBeenCalledWith("updateTags", [
			{ _id: "s1", "system.isScratched": true },
			{ _id: "s2", "system.isScratched": true },
		]);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({
			power: 3,
			tags: [
				{ name: "fog", type: "story_tag", isScratched: true },
				{ name: "rain", type: "story_tag", isScratched: true },
			],
		});
		expect(totalSpent).toBe(3);
	});

	it("names a hidden scene tag as unseen on the public card", async () => {
		game.user.isGM = true;
		vi.spyOn(StoryTagsStore, "packStoryTags", "get").mockReturnValue([
			{ _id: "s1", name: "ambush", system: { isHidden: true } },
		]);

		const { results } = await applySpendIntent(
			hero(),
			scratchIntent([sceneChip("s1", "ambush")]),
		);

		expect(results[0].tags).toEqual([
			{
				name: "LITM.Ui.roll_concealed_tag",
				type: "story_tag",
				isScratched: true,
			},
		]);
	});

	it("neither bills nor shows a chip when the Narrator's sidebar is missing", async () => {
		game.user.isGM = true;
		game.litmv2 = {};
		ui.combat = null;

		const { results, totalSpent } = await applySpendIntent(
			hero(),
			scratchIntent([sceneChip("s1", "fog")]),
		);

		expect(results[0]).toMatchObject({ power: 0, tags: [] });
		expect(totalSpent).toBe(0);
	});

	it("neither bills nor relays for a player when no GM is active", async () => {
		const { results, totalSpent } = await applySpendIntent(
			hero(),
			scratchIntent([sceneChip("s1", "fog")]),
		);

		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(sidebar.doUpdate).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({ power: 0, tags: [] });
		expect(totalSpent).toBe(0);
	});
});

describe("applyActionSuccess: an applier that throws", () => {
	it("reports the failure, charges nothing and records nothing as applied", async () => {
		CONFIG.litmv2.tagStringRe = makeTagStringRe();
		const blessed = fakeBlessed();
		blessed.delete = vi.fn().mockRejectedValue(new Error("write rejected"));
		const target = fakeActor({ id: "c1", name: "Beast", effects: [blessed] });
		const message = wireMessage(actionRollMessage());
		foundry.utils.fromUuid.mockResolvedValue(fakeAction());
		game.user.isGM = true;

		const result = await applyActionSuccess({
			actor: hero(),
			messageId: "m1",
			successKey: "succ1",
			presetTarget: target,
		});

		expect(result).toEqual({ spent: 0, status: "invalid" });
		expect(ui.notifications.error).toHaveBeenCalledWith(
			"LITM.Actions.apply_failed",
		);
		expect(message.update).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("postSpendChat: the card each option posts", () => {
	/** Apply the intent, post its cards, and hand back what each card was given. */
	async function cards(actor, intent) {
		const { results } = await applySpendIntent(actor, intent);
		foundry.documents.ChatMessage.create.mockClear();
		await postSpendChat(actor, intent, results);
		return foundry.documents.ChatMessage.create.mock.calls.map(([data]) => ({
			...JSON.parse(data.content),
			speaker: data.speaker,
		}));
	}

	it("posts one card per option, with what was bought and what it cost", async () => {
		const actor = hero();

		const posted = await cards(
			actor,
			spendIntent([
				createOption([{ name: "rope", isSingleUse: false }]),
				counterOption(3),
				extraFeat(),
			]),
		);

		expect(posted).toEqual([
			expect.objectContaining({
				actorName: "Gerrin",
				action: "LITM.Effects.create.action",
				body: "[rope]",
				costLine: "2 LITM.Tags.power",
				speaker: { actor: "h1" },
			}),
			expect.objectContaining({
				action: "LITM.Effects.discover.action",
				body: '<span class="litm-spend-chat__count">&times;3</span>',
				costLine: "3 LITM.Tags.power",
			}),
			expect.objectContaining({
				action: "LITM.Effects.extra_feat.action",
				body: "",
				costLine: "1 LITM.Tags.power",
			}),
		]);
	});

	it("leaves the count off a counter option taken once", async () => {
		const [card] = await cards(hero(), spendIntent(counterOption(1)));

		expect(card).toMatchObject({ body: "", costLine: "1 LITM.Tags.power" });
	});

	it("shows a recovered tag live and a scratched one crossed off", async () => {
		const scratched = fakeEffect({
			id: "t1",
			name: "rope",
			system: { isScratched: true },
		});
		const live = fakeEffect({ id: "t2", name: "torch" });
		const actor = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [scratched, live],
		});
		wireActors(actor);

		const [recovered] = await cards(
			actor,
			recoverIntent([{ tagId: "t1", tagName: "rope" }]),
		);
		const [crossed] = await cards(
			actor,
			scratchIntent([{ tagId: "t2", tagName: "torch", actorId: "h1" }]),
		);

		expect(recovered.body).toContain("rope");
		expect(recovered.body).not.toContain("litm-tag-scratch");
		expect(crossed.body).toContain("torch");
		expect(crossed.body).toContain("litm-tag-scratch");
		expect(crossed.costLine).toBe("2 LITM.Tags.power");
	});

	it("posts the reduced status with its old and new tier", async () => {
		const actor = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [fakeStatus({ id: "s1", name: "wounded", tier: 3 })],
		});
		wireActors(actor);

		const [card] = await cards(
			actor,
			reduceIntent([{ effectId: "s1", name: "wounded", tiers: 3 }]),
		);

		expect(card).toMatchObject({
			action: "LITM.Effects.reduce.action",
			body: "<span>wounded-3 &rarr; <em>LITM.Ui.removed</em></span>",
			costLine: "3 LITM.Tags.power",
		});
	});

	it("posts nothing for a scratch or recover where no tag could be written", async () => {
		const actor = hero();
		wireActors(actor);

		const posted = await cards(
			actor,
			spendIntent([
				scratchIntent([{ tagId: "gone", tagName: "ghost", actorId: "h1" }])
					.options[0],
				recoverIntent([{ tagId: "gone", tagName: "ghost" }]).options[0],
			]),
		);

		expect(posted).toEqual([]);
	});

	it("posts nothing for an Inflict that could not be written", async () => {
		const foe = fakeTarget({ isOwner: false });
		const actor = hero();
		wireActors(actor, foe);

		const posted = await cards(actor, inflictIntent({ targetActorId: "c1" }));

		expect(posted).toEqual([]);
	});

	it("posts nothing for a Reduce where no status could be written", async () => {
		const actor = hero();
		wireActors(actor);

		const posted = await cards(
			actor,
			reduceIntent([{ effectId: "gone", name: "ghost", tiers: 1 }]),
		);

		expect(posted).toEqual([]);
	});

	it("still posts an Inflict that landed, naming its target", async () => {
		const foe = fakeTarget({ isOwner: true });
		const actor = hero();
		wireActors(actor, foe);

		const [card] = await cards(
			actor,
			spendIntent(inflictOption({ targetActorId: "c1" })),
		);

		expect(card).toMatchObject({
			body: "<strong>Serpent</strong> [dazed-2]",
			costLine: "2 LITM.Tags.power",
		});
	});
});
