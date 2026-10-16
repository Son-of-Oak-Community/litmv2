import { afterEach, describe, expect, it, vi } from "vitest";
import {
	defaultCostCalculator,
	parseSpendIntent,
	SpendPowerApp,
} from "../modules/apps/spend-power.js";
import { LitmConfig } from "../modules/system/config.js";

// Spend Power's Inflict row takes a free-typed tier. The template's `max`
// only constrains the spinner, so the typed value has to be clamped to the
// world's status track depth (CONFIG.litmv2.maxStatusTier) where it is priced
// and where it is read back into the intent. Otherwise "99" costs 99 Power
// and addStatus marks no box at all.

vi.mock("../modules/apps/target-picker.js", () => ({
	getTargetCandidates: vi.fn(() => []),
}));
vi.mock("../modules/apps/story-tags/story-tags-store.js", () => ({
	StoryTagsStore: { loadStoryTags: vi.fn(async () => {}), packStoryTags: [] },
}));

/** Point the global CONFIG at the real derived slot for a given Hero Limit. */
function withHeroLimit(heroLimit) {
	CONFIG.litmv2 = Object.create(LitmConfig);
	CONFIG.litmv2.heroLimit = heroLimit;
	CONFIG.litmv2._maxStatusTierOverride = null;
}

const original = CONFIG.litmv2;
afterEach(() => {
	CONFIG.litmv2 = original;
});

/** A tier-entry row reduced to what the spend-power code reads off it. */
function tierRow(tier, name = "Dazed") {
	const parts = {
		".litm-spend-power__entry-tier": { value: tier },
		".litm-spend-power__entry-name": { value: name },
	};
	return { querySelector: (selector) => parts[selector] ?? null };
}

/** An Inflict option row holding the given entry rows. */
function inflictRow(rows, { hasTier = true } = {}) {
	const parts = {
		"[data-option-check]": { checked: true },
		".litm-spend-power__entries": { dataset: {} },
	};
	return {
		dataset: { optionId: "inflict_status", hasTier: String(hasTier) },
		querySelector: (selector) => parts[selector] ?? null,
		querySelectorAll: (selector) =>
			selector === ".litm-spend-power__entry" ? rows : [],
	};
}

function parse(li) {
	const form = {
		querySelectorAll: (selector) =>
			selector === ".litm-spend-power__option" ? [li] : [],
		querySelector: () => null,
	};
	const dialog = {
		spendingOptions: [
			{
				id: "inflict_status",
				label: "LITM.Effects.inflict.action",
				cost: 1,
				hasTier: true,
				draggable: true,
			},
		],
		messageId: null,
		alreadySpent: 0,
	};
	return parseSpendIntent(form, dialog);
}

describe("defaultCostCalculator: Inflict tier", () => {
	const cost = (rows, perTier = 1, hasTier = true) =>
		defaultCostCalculator(inflictRow(rows), perTier, null, hasTier);

	it("prices a tier within the track as typed", () => {
		withHeroLimit(5);
		expect(cost([tierRow("3")])).toBe(3);
	});

	it("prices a tier past the default depth at the depth", () => {
		withHeroLimit(5);
		expect(cost([tierRow("9")])).toBe(6);
	});

	it("follows a deeper world: depth 7 allows tier 7 and caps tier 12 at 7", () => {
		withHeroLimit(6);
		expect(CONFIG.litmv2.maxStatusTier).toBe(7);
		expect(cost([tierRow("7")])).toBe(7);
		expect(cost([tierRow("12")])).toBe(7);
	});

	it("follows a module override of the depth", () => {
		withHeroLimit(5);
		CONFIG.litmv2.maxStatusTier = 5;
		expect(cost([tierRow("6")])).toBe(5);
		expect(cost([tierRow("5")])).toBe(5);
	});

	it("caps each row separately and multiplies by the per-tier cost", () => {
		withHeroLimit(5);
		expect(cost([tierRow("2"), tierRow("40")], 2)).toBe(2 * 2 + 2 * 6);
	});

	it("floors at tier 1 for zero, negative, blank and non-numeric input", () => {
		withHeroLimit(5);
		expect(cost([tierRow("0")])).toBe(1);
		expect(cost([tierRow("-4")])).toBe(1);
		expect(cost([tierRow("")])).toBe(1);
		expect(cost([tierRow("abc")])).toBe(1);
	});

	it("does not consult a tier input on rows that have none", () => {
		withHeroLimit(5);
		const row = { querySelector: () => null };
		expect(cost([row], 2, false)).toBe(2);
	});
});

describe("parseSpendIntent: Inflict tier", () => {
	const tierOf = (typed) => {
		const [option] = parse(inflictRow([tierRow(typed)])).options;
		return option.entries[0].tier;
	};

	it("reads a tier within the track as typed", () => {
		withHeroLimit(5);
		expect(tierOf("4")).toBe(4);
	});

	it("applies the default depth when the typed tier is past it", () => {
		withHeroLimit(5);
		expect(tierOf("9")).toBe(6);
	});

	it("follows a deeper world: depth 7 allows tier 7 and caps tier 12 at 7", () => {
		withHeroLimit(6);
		expect(tierOf("7")).toBe(7);
		expect(tierOf("12")).toBe(7);
	});

	it("follows a module override of the depth", () => {
		withHeroLimit(5);
		CONFIG.litmv2.maxStatusTier = 5;
		expect(tierOf("6")).toBe(5);
	});

	it("floors at tier 1 for zero, negative, blank and non-numeric input", () => {
		withHeroLimit(5);
		expect(tierOf("0")).toBe(1);
		expect(tierOf("-4")).toBe(1);
		expect(tierOf("")).toBe(1);
		expect(tierOf("abc")).toBe(1);
	});

	it("leaves tier null on options that carry no tier", () => {
		withHeroLimit(5);
		const row = {
			querySelector: (selector) =>
				({
					".litm-spend-power__entry-name": { value: "A boon" },
				})[selector] ?? null,
		};
		const li = inflictRow([row], { hasTier: false });
		const [option] = parse(li).options;
		expect(option.entries[0].tier).toBeNull();
	});
});

describe("SpendPowerApp context", () => {
	it("hands the template the world's status track depth", async () => {
		withHeroLimit(6);
		game.actors.get = vi.fn(() => null);
		const app = new SpendPowerApp({ actorId: "a1", power: 3 });

		const context = await app._prepareContext({});

		expect(context.maxTier).toBe(7);
	});

	it("tracks a module override of the depth", async () => {
		withHeroLimit(5);
		CONFIG.litmv2.maxStatusTier = 5;
		game.actors.get = vi.fn(() => null);
		const app = new SpendPowerApp({ actorId: "a1", power: 3 });

		const context = await app._prepareContext({});

		expect(context.maxTier).toBe(5);
	});
});
