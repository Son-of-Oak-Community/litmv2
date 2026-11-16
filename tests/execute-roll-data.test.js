import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import {
	executeRoll,
	resolveRollFormula,
} from "../modules/apps/roll/roll-pipeline.js";
import { BURN_POWER } from "../modules/system/config.js";
import { Sockets } from "../modules/system/sockets.js";

// What `executeRoll` hands the dice: the formula, the numbers it reads
// (`@powerValue` and the rest) and the record kept on the roll. CLAUDE.md,
// "Power Calculation": burn +3 once, +1 per power tag, -1 per weakness, the
// strongest status on each side, the modifier, Might and Trade Power.

let built;
let message;
let saved;

const tag = (id, type, state, tier) => ({
	id,
	uuid: `Compendium.world.tags.ActiveEffect.${id}`,
	name: id,
	type,
	state,
	...(tier ? { system: { currentTier: tier } } : {}),
});
const TAGS = [
	tag("bow", "power_tag", "positive"),
	tag("keen", "power_tag", "positive"),
	tag("axe", "power_tag", "scratched"),
	tag("slow", "weakness_tag", "negative"),
	tag("rested", "status_tag", "positive", 2),
	tag("blessed", "status_tag", "positive", 3),
	tag("hurt", "status_tag", "negative", 1),
	tag("cursed", "status_tag", "negative", 2),
];

/** What the default formula adds to the 2d6, read the way the dice read it. */
const added = (formula, data) => {
	let sign = 1;
	let total = 0;
	for (const token of formula.replace(/^2d6 \+ \(|\)$/g, "").split(" ")) {
		if (token === "+") sign = 1;
		else if (token === "-") sign = -1;
		else total += sign * data[token.slice(1)];
	}
	return total;
};

beforeEach(() => {
	built = null;
	message = { rolls: [] };
	saved = { litmv2: game.litmv2, config: CONFIG.litmv2 };
	CONFIG.litmv2 = { ...CONFIG.litmv2, roll: { formula: null, resolver: null } };
	game.litmv2 = {
		LitmRoll: class {
			constructor(formula, data, options) {
				built = { formula, data, options, roll: this };
			}
			toMessage(args) {
				built.message = args;
				return Promise.resolve(message);
			}
		},
	};
	game.actors.get.mockReturnValue(null);
	Hooks.call.mockReset();
	Hooks.call.mockReturnValue(true);
	Hooks.callAll.mockClear();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	// Concealment bookkeeping is pinned in roll-concealment-paths.test.js.
	vi.spyOn(LitmRoll, "captureConcealment").mockImplementation((tags) => tags);
});
afterEach(() => {
	vi.restoreAllMocks();
	game.litmv2 = saved.litmv2;
	CONFIG.litmv2 = saved.config;
	game.actors.get.mockReset();
	Hooks.call.mockReset();
	Hooks.call.mockReturnValue(true);
});

describe("executeRoll: the numbers behind the dice", () => {
	it("hands the roll each part of the Power", async () => {
		await executeRoll({
			actorId: "hero",
			tags: TAGS,
			type: "tracked",
			modifier: 1,
			might: -3,
			tradePower: 1,
		});
		expect(built.data).toEqual({
			scratchedValue: BURN_POWER,
			powerValue: 2,
			positiveStatusValue: 3,
			weaknessValue: 1,
			negativeStatusValue: 2,
			modifier: 1,
			mightOffset: -3,
			tradePower: 1,
			sacrificeBonus: 0,
		});
	});

	it("rolls the Power plus what was traded, and records the Power alone", async () => {
		await executeRoll({
			actorId: "hero",
			tags: TAGS,
			type: "tracked",
			modifier: 1,
			might: -3,
			tradePower: 1,
		});
		// 3 (burn) + 2 - 1 + 3 - 2 + 1 (modifier) - 3 (Might)
		expect(built.options.totalPower).toBe(3);
		expect(built.options.tradePower).toBe(1);
		// A Hedge adds its 1 to the dice; the spend side takes it back off
		// `totalPower` (LitmRoll#power).
		expect(added(built.formula, built.data)).toBe(4);
	});

	it("takes 1 off the dice for Caution", async () => {
		await executeRoll({
			actorId: "hero",
			tags: [tag("bow", "power_tag", "positive")],
			type: "tracked",
			tradePower: -1,
		});
		expect(built.options.totalPower).toBe(1);
		expect(added(built.formula, built.data)).toBe(0);
	});

	it("reads numbers that arrive as strings, as a moderation card stores them", async () => {
		await executeRoll({
			actorId: "hero",
			tags: [],
			type: "quick",
			modifier: "2",
			might: "3",
			tradePower: "1",
		});
		expect(built.data).toMatchObject({
			modifier: 2,
			mightOffset: 3,
			tradePower: 1,
		});
		expect(built.options.totalPower).toBe(5);
	});

	it("keeps the tags on the roll by what they did", async () => {
		await executeRoll({ actorId: "hero", tags: TAGS, type: "quick" });
		const names = (key) => built.options[key].map((t) => t.name);
		expect(names("scratchedTags")).toEqual(["axe"]);
		expect(names("powerTags")).toEqual(["bow", "keen"]);
		expect(names("weaknessTags")).toEqual(["slow"]);
		expect(names("positiveStatuses")).toEqual(["rested", "blessed"]);
		expect(names("negativeStatuses")).toEqual(["hurt", "cursed"]);
	});

	it("remembers who acted together, for the Narrator's apply flow", async () => {
		await executeRoll({
			actorId: "fellowship",
			tags: [],
			type: "quick",
			participantIds: ["h1", "h2"],
		});
		expect(built.options.participantIds).toEqual(["h1", "h2"]);
	});

	it("links the card to the Action that was rolled", async () => {
		await executeRoll({
			actorId: "hero",
			tags: [],
			type: "quick",
			title: "Cleave",
			actionUuid: "Item.cleave",
		});
		expect(built.message).toMatchObject({
			flavor: "Cleave",
			flags: { litmv2: { actionUuid: "Item.cleave" } },
		});
	});
});

describe("executeRoll: a Sacrifice's number", () => {
	it("adds the Narrator's Secret Grace and nothing else", async () => {
		await executeRoll({
			actorId: "hero",
			tags: TAGS,
			type: "sacrifice",
			might: 3,
			modifier: 2,
			tradePower: 1,
			sacrificeBonus: 2,
		});
		expect(built.formula).toBe("2d6 + @sacrificeBonus");
		expect(built.data.sacrificeBonus).toBe(2);
		expect(built.options.sacrificeBonus).toBe(2);
		expect(built.data).toMatchObject({
			scratchedValue: 0,
			powerValue: 0,
			modifier: 0,
			mightOffset: 0,
			tradePower: 0,
		});
	});

	it.each([
		["2", 2],
		[2.9, 2],
		["nonsense", 0],
		[undefined, 0],
	])("reads a bonus of %j as %i", async (sacrificeBonus, expected) => {
		await executeRoll({
			actorId: "hero",
			tags: [],
			type: "sacrifice",
			sacrificeBonus,
		});
		expect(built.data.sacrificeBonus).toBe(expected);
	});

	it("gives no other move a bonus", async () => {
		await executeRoll({
			actorId: "hero",
			tags: [],
			type: "quick",
			sacrificeBonus: 3,
		});
		expect(built.data.sacrificeBonus).toBe(0);
		expect(built.options.sacrificeBonus).toBe(0);
	});
});

// CONFIG.litmv2.roll.formula is a public slot: a string replaces the formula,
// a function is asked for one with the roll's parts.
describe("CONFIG.litmv2.roll.formula", () => {
	it("defaults to 2d6 plus every part of the Power", () => {
		expect(resolveRollFormula({ type: "tracked" })).toBe(
			"2d6 + (@scratchedValue + @powerValue + @positiveStatusValue - @weaknessValue - @negativeStatusValue + @modifier + @mightOffset + @tradePower)",
		);
	});

	it("is used as the formula when a module sets a string", async () => {
		CONFIG.litmv2.roll.formula = "3d6kh2 + @powerValue";
		await executeRoll({ actorId: "hero", tags: TAGS, type: "sacrifice" });
		expect(built.formula).toBe("3d6kh2 + @powerValue");
	});

	it("is asked for the formula, with the roll's parts, when a module sets a function", async () => {
		const formula = vi.fn(() => "1d12");
		CONFIG.litmv2.roll.formula = formula;
		await executeRoll({
			actorId: "hero",
			tags: TAGS,
			type: "tracked",
			title: "Cleave",
			modifier: 1,
			might: 3,
		});
		expect(built.formula).toBe("1d12");
		expect(formula).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "tracked",
				actorId: "hero",
				title: "Cleave",
				totalPower: 9,
				scratchedValue: BURN_POWER,
				powerValue: 2,
				weaknessValue: 1,
				positiveStatusValue: 3,
				negativeStatusValue: 2,
				modifier: 1,
				might: 3,
				mightOffset: 3,
			}),
		);
		expect(formula.mock.calls[0][0].powerTags.map((t) => t.name)).toEqual([
			"bow",
			"keen",
		]);
	});
});

describe("the roll hooks", () => {
	it("offers litm.preRoll the tags, formula, modifier, Power and actor", async () => {
		const actor = { id: "hero" };
		game.actors.get.mockReturnValue(actor);
		await executeRoll({
			actorId: "hero",
			tags: [tag("bow", "power_tag", "positive")],
			type: "quick",
			modifier: 1,
		});
		const [name, payload] = Hooks.call.mock.calls.find(
			([hook]) => hook === "litm.preRoll",
		);
		expect(name).toBe("litm.preRoll");
		expect(payload).toMatchObject({
			formula: built.formula,
			modifier: 1,
			power: 2,
			actor,
		});
		expect(payload.tags.map((t) => t.name)).toEqual(["bow"]);
	});

	it("rolls nothing when litm.preRoll returns false", async () => {
		Hooks.call.mockImplementation((hook) => hook !== "litm.preRoll");
		const result = await executeRoll({
			actorId: "hero",
			tags: [],
			type: "quick",
		});
		expect(result).toBeUndefined();
		expect(built).toBeNull();
		expect(Hooks.callAll).not.toHaveBeenCalledWith(
			"litm.roll",
			expect.anything(),
			expect.anything(),
		);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("fires litm.roll with the roll and its chat message, and returns the message", async () => {
		const result = await executeRoll({
			actorId: "hero",
			tags: [],
			type: "quick",
		});
		expect(result).toBe(message);
		expect(Hooks.callAll).toHaveBeenCalledWith(
			"litm.roll",
			built.roll,
			message,
		);
	});
});
