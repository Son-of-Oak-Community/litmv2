import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpendPowerApp } from "../modules/apps/spend-power.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import { rollMessage, wireActors } from "./__helpers__/spend-power.js";

// What the Spend Power dialog offers and how much Power it says is left. A
// player must never be offered a tag or status the Narrator hid, and the
// budget has two ledgers to subtract: generic spends and applied successes.

const mocks = vi.hoisted(() => ({ candidates: [], packTags: [] }));

vi.mock("../modules/apps/target-picker.js", () => ({
	getTargetCandidates: vi.fn(() => mocks.candidates),
}));
vi.mock("../modules/apps/story-tags/story-tags-store.js", () => ({
	StoryTagsStore: {
		loadStoryTags: vi.fn(async () => {}),
		get packStoryTags() {
			return mocks.packTags;
		},
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.candidates = [];
	mocks.packTags = [];
	CONFIG.litmv2.tagStringRe = makeTagStringRe();
	game.user.isGM = false;
	game.user.targets = new Set();
	game.messages.get = vi.fn(() => null);
});

const tag = (id, name, system = {}) =>
	fakeEffect({ id, name, type: "story_tag", system });

const status = (id, name, tier, system = {}) =>
	fakeEffect({
		id,
		name,
		type: "status_tag",
		system: { currentTier: tier, ...system },
	});

/** A Hero with one visible and one Narrator-hidden entry in every list. */
function heroWithSecrets() {
	const hero = fakeActor({ id: "h1", name: "Gerrin" });
	hero.system = {
		scratchedTags: [
			tag("r1", "rope", { isScratched: true }),
			tag("r2", "cursed coin", { isScratched: true, isHidden: true }),
		],
		storyTags: [tag("t1", "torch"), tag("t2", "marked", { isHidden: true })],
		statusEffects: [
			status("s1", "wounded", 2),
			status("s2", "doomed", 3, { isHidden: true }),
		],
	};
	for (const e of hero.system.scratchedTags) e.parent = hero;
	wireActors(hero);
	return hero;
}

const context = (options = {}) =>
	new SpendPowerApp({ actorId: "h1", power: 3, ...options })._prepareContext(
		{},
	);

const option = (ctx, id) => ctx.options.find((o) => o.id === id);

describe("SpendPowerApp context: what a player is offered", () => {
	it("leaves hidden tags and statuses out of Recover, Scratch and Reduce", async () => {
		heroWithSecrets();

		const ctx = await context();

		expect(option(ctx, "recover_tag").scratchedTags.map((t) => t.name)).toEqual(
			["rope"],
		);
		expect(
			option(ctx, "scratch_tag").scratchGroups.map((g) =>
				g.tags.map((t) => t.name),
			),
		).toEqual([["torch"]]);
		expect(
			option(ctx, "reduce_status").statusGroups.map((g) =>
				g.statuses.map((s) => s.name),
			),
		).toEqual([["wounded"]]);
	});

	it("shows the Narrator every one of them, flagged hidden", async () => {
		heroWithSecrets();
		game.user.isGM = true;

		const ctx = await context();

		expect(option(ctx, "recover_tag").scratchedTags).toEqual([
			{ id: "r1", name: "rope", itemId: "", isHidden: false },
			{ id: "r2", name: "cursed coin", itemId: "", isHidden: true },
		]);
		expect(option(ctx, "scratch_tag").scratchGroups[0].tags).toEqual([
			{ id: "t1", name: "torch", isSingleUse: false, isHidden: false },
			{ id: "t2", name: "marked", isSingleUse: false, isHidden: true },
		]);
		expect(
			option(ctx, "reduce_status").statusGroups[0].statuses.map((s) => s.name),
		).toEqual(["wounded", "doomed"]);
	});

	it("offers only live, visible scene tags to scratch", async () => {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero);
		const disabled = tag("p4", "embers");
		disabled.disabled = true;
		mocks.packTags = [
			tag("p1", "fog", { isSingleUse: true }),
			tag("p2", "ambush", { isHidden: true }),
			tag("p3", "rubble", { isScratched: true }),
			disabled,
			status("p5", "burning", 2),
		];

		const ctx = await context();

		expect(option(ctx, "scratch_tag").scratchGroups).toEqual([
			{
				ownerId: "",
				ownerName: "",
				isOwn: false,
				isScene: true,
				tags: [{ id: "p1", name: "fog", isSingleUse: true, isHidden: false }],
			},
		]);
	});

	it("drops a disabled effect from every list", async () => {
		const hero = heroWithSecrets();
		for (const list of ["scratchedTags", "storyTags", "statusEffects"])
			hero.system[list][0].disabled = true;

		const ctx = await context();

		expect(ctx.options.map((o) => o.id)).toEqual([
			"create_recover_tag",
			"inflict_status",
			"discover_detail",
			"extra_feat",
		]);
	});

	it("withdraws Recover, Scratch and Reduce when there is nothing to pick", async () => {
		wireActors(fakeActor({ id: "h1", name: "Gerrin" }));

		const ctx = await context();

		expect(ctx.options.map((o) => o.id)).toEqual([
			"create_recover_tag",
			"inflict_status",
			"discover_detail",
			"extra_feat",
		]);
	});

	it("names a scratched tag's item, so a theme tag is told from a Hero's own", async () => {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		const own = tag("r1", "rope", { isScratched: true });
		own.parent = hero;
		const themed = tag("r2", "keen eye", { isScratched: true });
		themed.parent = { id: "theme1" };
		hero.system = { scratchedTags: [own, themed] };
		wireActors(hero);

		const ctx = await context();

		expect(option(ctx, "recover_tag").scratchedTags).toEqual([
			{ id: "r1", name: "rope", itemId: "", isHidden: false },
			{ id: "r2", name: "keen eye", itemId: "theme1", isHidden: false },
		]);
	});

	it("lists the actors in play as Inflict targets", async () => {
		wireActors(fakeActor({ id: "h1", name: "Gerrin" }));
		mocks.candidates = [
			{ id: "c1", uuid: "Actor.c1", label: "Something unseen", img: "c.webp" },
		];

		const ctx = await context();

		expect(option(ctx, "inflict_status").targets).toEqual([
			{ id: "c1", uuid: "Actor.c1", name: "Something unseen", img: "c.webp" },
		]);
	});
});

describe("SpendPowerApp context: the rolled Action's successes", () => {
	const ACTION = {
		type: "action",
		name: "Hunt",
		system: {
			successes: [
				{ id: "tags", verb: "create", text: "Take a [bow], a [knife!]" },
				{ id: "variable", verb: "attack", text: "Cause [bleeding-]" },
				{ id: "dear", verb: "weaken", text: "Break their [guard-5]" },
				{ id: "reaction", verb: "lessen", text: "Shrug off [wounded-1]" },
				{ id: "done", verb: "create", text: "Find a [trail]" },
				{ id: "prose", verb: "quick", text: "You find the way" },
				{ id: "single", verb: "create", text: "Draw a [map]" },
			],
		},
	};

	/** A tracked success worth 6 Power: 1 spent on the menu, "done" applied for 2. */
	function wireRoll({ type = "tracked", flags = {} } = {}) {
		wireActors(fakeActor({ id: "h1", name: "Gerrin" }));
		const message = rollMessage({
			actionUuid: "Item.act1",
			spentPower: 1,
			appliedSuccesses: ["done"],
			appliedSuccessCosts: { done: 2 },
			...flags,
		});
		message.rolls = [
			{ power: 6, outcome: { label: "success" }, litm: { type } },
		];
		foundry.utils.fromUuid.mockResolvedValue(ACTION);
		return message;
	}

	const rolled = () => context({ power: 6, messageId: "m1" });
	const row = (ctx, key) => ctx.actionSuccesses.find((s) => s.key === key);

	it("subtracts both ledgers from the Power shown: generic spends and applied successes", async () => {
		wireRoll();

		expect((await rolled()).power).toBe(6 - 1 - 2);
	});

	it("counts a success recorded only in the costs flag as applied", async () => {
		// A concurrent writer can clobber the appliedSuccesses array; the costs
		// object still holds the entry.
		wireRoll({ flags: { appliedSuccesses: [] } });

		const ctx = await rolled();

		expect(ctx.power).toBe(3);
		expect(row(ctx, "done")).toBeUndefined();
	});

	it("lists the successes this roll unlocks, minus those already applied", async () => {
		wireRoll();

		const ctx = await rolled();

		expect(ctx.actionSuccesses.map((s) => s.key)).toEqual([
			"tags",
			"variable",
			"dear",
			"prose",
			"single",
		]);
	});

	it("offers a Reaction only what a Reaction unlocks", async () => {
		wireRoll({ type: "mitigate" });

		expect((await rolled()).actionSuccesses.map((s) => s.key)).toEqual([
			"reaction",
		]);
	});

	it("offers nothing on a roll that missed", async () => {
		const message = wireRoll();
		message.rolls[0].outcome.label = "consequences";

		expect((await rolled()).actionSuccesses).toEqual([]);
	});

	it("disables a success the Power left cannot pay for", async () => {
		wireRoll();

		const ctx = await rolled();

		expect(row(ctx, "dear")).toMatchObject({
			disabled: true,
			reasonKey: "LITM.Actions.cant_afford_short",
		});
	});

	it("judges an either-or success by its cheapest tag", async () => {
		// 3 Power left: [bow] 2 + [knife!] 1 is exactly affordable; with 2 more
		// spent only the single-use tag is, and the row must stay open.
		wireRoll({ flags: { spentPower: 3 } });

		const ctx = await rolled();

		expect(ctx.power).toBe(1);
		expect(row(ctx, "tags")).toMatchObject({
			disabled: false,
			reasonKey: null,
		});
	});

	it("keeps a variable-tier or free success open with no Power left", async () => {
		wireRoll({ flags: { spentPower: 4 } });

		const ctx = await rolled();

		expect(ctx.power).toBe(0);
		expect(row(ctx, "variable").disabled).toBe(false);
		expect(row(ctx, "prose").disabled).toBe(false);
		expect(row(ctx, "tags").disabled).toBe(true);
	});

	it("prices each tag of a multi-tag success, the row's fixed part being what is left", async () => {
		wireRoll();

		expect(row(await rolled(), "tags")).toMatchObject({
			hasSelectableTags: true,
			staticCost: 3,
			fixedCost: 0,
			tagTokens: [
				{ idx: 0, name: "bow", isSingleUse: false, cost: 2 },
				{ idx: 1, name: "knife", isSingleUse: true, cost: 1 },
			],
		});
	});

	it("offers no chips on a single-tag success: there is nothing to choose between", async () => {
		wireRoll();

		expect(row(await rolled(), "single")).toMatchObject({
			hasSelectableTags: false,
			tagTokens: [],
			fixedCost: 2,
		});
	});

	it("gives a variable-tier status a counter and a fixed tier none", async () => {
		wireRoll();

		const ctx = await rolled();

		expect(row(ctx, "variable")).toMatchObject({
			hasVariableTier: true,
			varTokens: [{ idx: 0, name: "bleeding" }],
			hasSelectableTags: false,
			fixedCost: 0,
		});
		expect(row(ctx, "dear")).toMatchObject({
			hasVariableTier: false,
			varTokens: [],
			fixedCost: 5,
		});
	});

	it("asks for a target only when a listed success acts on another actor", async () => {
		wireRoll();
		mocks.candidates = [
			{ id: "bandit", uuid: "Scene.s1.Token.t1.Actor.bandit", label: "Bandit" },
			{ id: "bandit", uuid: "Scene.s1.Token.t2.Actor.bandit", label: "Bandit" },
		];
		game.user.targets = new Set([
			{ actor: { uuid: "Scene.s1.Token.t2.Actor.bandit" } },
		]);

		const ctx = await rolled();

		expect(row(ctx, "variable").needsActorTarget).toBe(true);
		expect(row(ctx, "tags").needsActorTarget).toBe(false);
		// By uuid: two unlinked tokens share the actor id, and only the one the
		// player targeted is pre-picked.
		expect(ctx.targets.map((t) => t.selected)).toEqual([false, true]);
	});

	it("shows no target row for a Reaction, whose successes land on the Hero", async () => {
		wireRoll({ type: "mitigate" });
		mocks.candidates = [{ id: "c1", uuid: "Actor.c1", label: "Serpent" }];

		expect((await rolled()).targets).toEqual([]);
	});

	it("lists no successes for a roll that was not an Action", async () => {
		wireRoll({ flags: { actionUuid: undefined } });

		const ctx = await rolled();

		expect(ctx.actionSuccesses).toEqual([]);
		expect(ctx.power).toBe(6 - 1 - 2);
	});
});
