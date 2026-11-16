import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultCostCalculator,
	optionCost,
	parseSpendIntent,
	SpendPowerApp,
	spendBudget,
} from "../modules/apps/spend-power.js";
import { fakeElement } from "./__helpers__/dom.js";
import {
	optionRow,
	spendDialog,
	spendForm,
} from "./__helpers__/spend-power.js";

// What the Spend Power dialog charges, and what it hands the service to bill.
// The disabled Spend button is the only budget check there is: the service
// applies whatever intent it is given.

beforeEach(() => {
	vi.clearAllMocks();
	game.messages.get = vi.fn(() => null);
});

const COUNTER = ".litm-spend-power__counter-value";
const ENTRIES = ".litm-spend-power__entries";
const SELECTED = ".litm-spend-power__tag-chip.is-selected";

/** A +/- counter's readout. */
const counter = (value) => ({ [COUNTER]: { textContent: String(value) } });

/** A status the Reduce picker lists, its counter showing the resulting tier. */
function statusItem({
	id = "s1",
	name = "enraged",
	tier,
	shows,
	actorId = "c1",
}) {
	return fakeElement({
		dataset: {
			maxTier: String(tier),
			effectId: id,
			statusName: name,
			actorId,
			actorUuid: `Actor.${actorId}`,
		},
		one: counter(shows),
	});
}

/** An option row whose entries section is of the given kind. */
function pickerRow(optionId, kind, { one = {}, all = {} } = {}) {
	const section = fakeElement({ dataset: { [kind]: "" }, one, all });
	return optionRow(
		{ optionId, hasTier: "false" },
		{ one: { [ENTRIES]: section } },
	);
}

const reduceRow = (items) =>
	pickerRow("reduce_status", "statusPicker", {
		all: { ".litm-spend-power__status-item": items },
	});

const counterRow = (count) =>
	pickerRow("discover_detail", "counter", { one: counter(count) });

const recoverChip = (tagId, tagName) =>
	fakeElement({ dataset: { tagId, tagName } });

const recoverRow = (chips) =>
	pickerRow("recover_tag", "picker", { all: { [SELECTED]: chips } });

const scratchRow = (chips) =>
	pickerRow("scratch_tag", "scratchPicker", { all: { [SELECTED]: chips } });

/** A row for one of the rolled Action's successes. */
function actionRow({
	key = "succ1",
	cost,
	fixedCost,
	chips = null,
	tiers = null,
	checked = true,
}) {
	const chipEls = (chips ?? []).map(({ idx, cost: tagCost, selected }) =>
		fakeElement({
			dataset: { tagIdx: String(idx), tagCost: String(tagCost) },
			classList: { contains: () => selected },
			selected,
		}),
	);
	const tierEls = (tiers ?? []).map(({ idx, value }) =>
		fakeElement({ dataset: { varIdx: String(idx) }, one: counter(value) }),
	);
	return fakeElement({
		dataset: {
			source: "action",
			successKey: key,
			cost: String(cost),
			fixedCost: String(fixedCost ?? cost),
			variableTier: String(!!tiers),
			selectableTags: String(!!chips),
		},
		one: { "[data-option-check]": { checked } },
		all: {
			".litm-spend-power__tag-chip[data-tag-idx]": chipEls,
			[SELECTED]: chipEls.filter((c) => c.selected),
			".litm-spend-power__var-tier": tierEls,
		},
	});
}

/** A free-text entry row: a created tag, single-use or not. */
const tagEntry = (name, { singleUse = false } = {}) =>
	fakeElement({
		one: {
			".litm-spend-power__entry-name": { value: name },
			".litm-spend-power__entry-single-use": { checked: singleUse },
		},
	});

/** The Create a Tag row holding the given entries. */
const createRow = (entries) =>
	optionRow(
		{ optionId: "create_recover_tag", hasTier: "false" },
		{ all: { ".litm-spend-power__entry": entries } },
	);

/** The dialog stub around the options the real app offers. */
const realDialog = () => spendDialog(new SpendPowerApp({}).spendingOptions);

describe("the Spending Power price list (Core Book p.165)", () => {
	const priceOf = (id) =>
		new SpendPowerApp({}).spendingOptions.find((o) => o.id === id).cost;

	it.each([
		["create_recover_tag", 2],
		["recover_tag", 2],
		["scratch_tag", 2],
		["inflict_status", 1],
		["reduce_status", 1],
		["discover_detail", 1],
		["extra_feat", 1],
	])("%s costs %i", (id, cost) => {
		expect(priceOf(id)).toBe(cost);
	});

	it("prices statuses per tier and tags per tag", () => {
		const byId = Object.fromEntries(
			new SpendPowerApp({}).spendingOptions.map((o) => [o.id, o]),
		);
		expect(byId.inflict_status.hasTier).toBe(true);
		expect(byId.reduce_status.hasTier).toBe(true);
		expect(byId.create_recover_tag.hasTier).toBeUndefined();
	});
});

describe("defaultCostCalculator: created tags", () => {
	const li = (entries) =>
		fakeElement({ all: { ".litm-spend-power__entry": entries } });

	it("charges the option's cost once when it takes no entries (Extra Feat)", () => {
		expect(defaultCostCalculator(li([]), 1, null, false)).toBe(1);
	});

	it("charges 2 for a tag and 1 for a single-use tag", () => {
		const entries = [
			tagEntry("rope"),
			tagEntry("torch", { singleUse: true }),
			tagEntry("map"),
		];
		expect(defaultCostCalculator(li(entries), 2, null, false)).toBe(2 + 1 + 2);
	});
});

describe("optionCost: one checked option", () => {
	it("charges Reduce by the tiers dropped, a status left alone costing nothing", () => {
		const row = reduceRow([
			statusItem({ tier: 4, shows: 1 }),
			statusItem({ id: "s2", tier: 3, shows: 3 }),
		]);
		expect(optionCost(row, 1)).toBe(3);
	});

	it("never credits a counter above the status's tier", () => {
		expect(optionCost(reduceRow([statusItem({ tier: 2, shows: 5 })]), 1)).toBe(
			0,
		);
	});

	it("charges a counter option per count", () => {
		expect(optionCost(counterRow(3), 1)).toBe(3);
	});

	it("charges Recover per selected tag", () => {
		const row = recoverRow([recoverChip("a", "rope"), recoverChip("b", "map")]);
		expect(optionCost(row, 2)).toBe(4);
	});

	it("charges a plain Action success its full cost", () => {
		expect(optionCost(actionRow({ cost: 3 }), 3)).toBe(3);
	});

	it("charges an Action success its fixed part plus the tags kept and tiers picked", () => {
		const row = actionRow({
			cost: 6,
			fixedCost: 2,
			chips: [
				{ idx: 0, cost: 2, selected: true },
				{ idx: 1, cost: 2, selected: false },
			],
			tiers: [
				{ idx: 0, value: 3 },
				{ idx: 1, value: 0 },
			],
		});
		expect(optionCost(row, 6)).toBe(2 + 2 + 3);
	});

	it("reads a blank tier counter as no tier", () => {
		const row = actionRow({
			cost: 0,
			fixedCost: 0,
			tiers: [{ idx: 0, value: "abc" }],
		});
		expect(optionCost(row, 0)).toBe(0);
	});
});

describe("spendBudget: the Spend button's gate", () => {
	/** Tag each row with the per-unit cost the template writes on it. */
	const priced = (row, cost) => {
		row.dataset.cost = String(cost);
		return row;
	};

	it("sums the checked options against the Power left", () => {
		const form = spendForm([
			priced(counterRow(2), 1),
			priced(recoverRow([recoverChip("a", "rope")]), 2),
		]);
		expect(spendBudget(form, 5)).toEqual({
			spent: 4,
			remaining: 1,
			overBudget: false,
			canSubmit: true,
		});
	});

	it("allows a spend of exactly the Power left", () => {
		const form = spendForm([priced(counterRow(3), 1)]);
		expect(spendBudget(form, 3)).toMatchObject({
			remaining: 0,
			canSubmit: true,
		});
	});

	it("refuses a spend past the Power left", () => {
		const form = spendForm([priced(counterRow(4), 1)]);
		expect(spendBudget(form, 3)).toMatchObject({
			remaining: -1,
			overBudget: true,
			canSubmit: false,
		});
	});

	it("ignores unchecked options and refuses an empty selection", () => {
		const unchecked = priced(counterRow(4), 1);
		unchecked.querySelector("[data-option-check]").checked = false;
		expect(spendBudget(spendForm([unchecked]), 3)).toEqual({
			spent: 0,
			remaining: 3,
			overBudget: false,
			canSubmit: false,
		});
	});

	it("lets a free narrative success through: selection gates, not cost", () => {
		const form = spendForm([actionRow({ cost: 0 })]);
		expect(spendBudget(form, 0)).toMatchObject({ spent: 0, canSubmit: true });
	});
});

describe("parseSpendIntent: what the service is told to bill", () => {
	const parse = (...rows) => parseSpendIntent(spendForm(rows), realDialog());

	it("reads an Action success's picked tiers and kept tags in scan order", () => {
		const row = actionRow({
			key: "succ9",
			cost: 4,
			chips: [
				{ idx: 0, cost: 2, selected: false },
				{ idx: 1, cost: 2, selected: true },
			],
			tiers: [
				{ idx: 0, value: 0 },
				{ idx: 1, value: 3 },
			],
		});

		expect(parse(row).options).toEqual([
			{
				source: "action",
				successKey: "succ9",
				chosenTiers: [0, 3],
				chosenTags: [false, true],
			},
		]);
	});

	it("leaves chosenTags undefined on a success with no tag chips, so every tag applies", () => {
		const [option] = parse(actionRow({ cost: 2 })).options;
		expect(option.chosenTags).toBeUndefined();
		expect(option.chosenTiers).toEqual([]);
	});

	it("reads a Reduce as the drop from each status's tier, skipping untouched ones", () => {
		const row = reduceRow([
			statusItem({ tier: 4, shows: 1 }),
			statusItem({ id: "s2", name: "dazed", tier: 2, shows: 2 }),
		]);

		expect(parse(row).options).toEqual([
			{
				kind: "statusPicker",
				optionId: "reduce_status",
				label: "LITM.Effects.reduce.action",
				cost: 1,
				reductions: [
					{
						effectId: "s1",
						name: "enraged",
						actorId: "c1",
						actorUuid: "Actor.c1",
						tiers: 3,
					},
				],
			},
		]);
	});

	it("leaves out a Reduce that drops nothing", () => {
		const row = reduceRow([statusItem({ tier: 4, shows: 4 })]);
		expect(parse(row).options).toEqual([]);
	});

	it("reads a counter option's count", () => {
		expect(parse(counterRow(3)).options).toEqual([
			{
				kind: "counter",
				optionId: "discover_detail",
				label: "LITM.Effects.discover.action",
				cost: 1,
				count: 3,
			},
		]);
	});

	it("reads the tags picked to Recover", () => {
		const row = recoverRow([recoverChip("a", "rope"), recoverChip("b", "map")]);

		expect(parse(row).options).toEqual([
			{
				kind: "picker",
				optionId: "recover_tag",
				label: "LITM.Effects.recover.action",
				cost: 2,
				chips: [
					{ tagId: "a", tagName: "rope" },
					{ tagId: "b", tagName: "map" },
				],
			},
		]);
	});

	it("leaves out a Recover or a Scratch with nothing picked", () => {
		expect(parse(recoverRow([]), scratchRow([])).options).toEqual([]);
	});

	it("reads created tags with their single-use tick, dropping blank rows", () => {
		const row = createRow([
			tagEntry("rope"),
			tagEntry("torch", { singleUse: true }),
			tagEntry("   "),
		]);

		expect(parse(row).options).toEqual([
			expect.objectContaining({
				kind: "default",
				optionId: "create_recover_tag",
				cost: 2,
				hasTier: false,
				draggable: true,
				entries: [
					{ name: "rope", tier: null, isSingleUse: false },
					{ name: "torch", tier: null, isSingleUse: true },
				],
			}),
		]);
	});

	it("skips unchecked options and rows the dialog never offered", () => {
		const unchecked = counterRow(2);
		unchecked.querySelector("[data-option-check]").checked = false;
		const unknown = optionRow({ optionId: "not_an_option", hasTier: "false" });

		expect(parse(unchecked, unknown).options).toEqual([]);
	});
});
