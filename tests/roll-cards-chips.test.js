import { describe, expect, it } from "vitest";
import { summarizeChips } from "../modules/apps/roll/roll-dialog-context.js";

// The Cards footer lists every chosen tag with what it adds, positives first.
// Only the highest status of each sign counts, so a lower one is shown as not
// counted and the chips add up to the tags' share of the total.
describe("summarizeChips", () => {
	const row = (over) => ({ key: "k", name: "tag", type: "power_tag", ...over });

	it("values each state", () => {
		const chips = summarizeChips([
			row({ key: "a", state: "positive" }),
			row({ key: "b", state: "negative" }),
			row({ key: "c", state: "scratched" }),
			row({ key: "d", type: "status_tag", state: "positive", tier: 2 }),
			row({ key: "e", type: "status_tag", state: "negative", tier: 3 }),
		]);
		expect(chips.map((c) => c.value)).toEqual([1, 3, 2, -1, -3]);
	});

	it("lists what adds Power before what takes it away", () => {
		const chips = summarizeChips([
			row({ key: "weak", state: "negative" }),
			row({ key: "brave", type: "status_tag", state: "positive", tier: 2 }),
			row({ key: "bow", state: "positive" }),
		]);
		expect(chips.map((c) => c.key)).toEqual(["brave", "bow", "weak"]);
	});

	it("marks lower statuses as not counted", () => {
		const chips = summarizeChips([
			row({ key: "low", type: "status_tag", state: "positive", tier: 1 }),
			row({ key: "high", type: "status_tag", state: "positive", tier: 2 }),
			row({ key: "neg", type: "status_tag", state: "negative", tier: 1 }),
		]);
		const by = Object.fromEntries(chips.map((c) => [c.key, c.counted]));
		expect(by).toEqual({ low: false, high: true, neg: true });
	});

	it("masks a concealed row", () => {
		const [chip] = summarizeChips([
			row({
				masked: true,
				name: "Something unseen",
				type: "status_tag",
				state: "negative",
				tier: 2,
			}),
		]);
		expect(chip.label).toBe("Something unseen");
		expect(chip.value).toBe(-2);
	});

	it("keeps the Narrator's mark", () => {
		const [chip] = summarizeChips([row({ state: "negative", narrator: true })]);
		expect(chip.narrator).toBe(true);
	});

	it("dedups by key", () => {
		expect(
			summarizeChips([row({ state: "positive" }), row({ state: "positive" })]),
		).toHaveLength(1);
	});
});
