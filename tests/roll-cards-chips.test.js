import { describe, expect, it } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { summarizeChips } from "../modules/apps/roll/roll-dialog-context.js";

// The Cards footer lists every chosen tag with what it adds, positives first.
// Whether a chip counts is LitmRoll's rule, so the chips add up to the total.
describe("summarizeChips", () => {
	const row = (over) => ({ key: "k", name: "tag", type: "power_tag", ...over });
	const all = () => true;

	it("values each state", () => {
		const chips = summarizeChips(
			[
				row({ key: "a", state: "positive" }),
				row({ key: "b", state: "negative" }),
				row({ key: "c", state: "scratched" }),
				row({ key: "d", type: "status_tag", state: "positive", tier: 2 }),
				row({ key: "e", type: "status_tag", state: "negative", tier: 3 }),
			],
			all,
		);
		expect(chips.map((c) => c.value)).toEqual([1, 3, 2, -1, -3]);
	});

	it("lists what adds Power before what takes it away", () => {
		const chips = summarizeChips(
			[
				row({ key: "weak", state: "negative" }),
				row({ key: "brave", type: "status_tag", state: "positive", tier: 2 }),
				row({ key: "bow", state: "positive" }),
			],
			all,
		);
		expect(chips.map((c) => c.key)).toEqual(["brave", "bow", "weak"]);
	});

	it("counts exactly what LitmRoll.powerBySource counts", () => {
		const tags = [
			{ uuid: "low", type: "status_tag", state: "positive", value: 1 },
			{ uuid: "high", type: "status_tag", state: "positive", value: 2 },
			{ uuid: "neg", type: "status_tag", state: "negative", value: 1 },
			// A legacy Fellowship title marked burned: no burn bonus.
			{ uuid: "title", type: "power_tag", state: "scratched", canBurn: false },
		];
		const counted = LitmRoll.powerBySource(tags, (t) => t.uuid);
		const chips = summarizeChips(
			tags.map((t) => ({
				key: t.uuid,
				name: t.uuid,
				type: t.type,
				state: t.state,
				tier: t.value,
			})),
			(key) => key in counted,
		);
		const by = Object.fromEntries(chips.map((c) => [c.key, c.counted]));
		expect(by).toEqual({ low: false, high: true, neg: true, title: false });
	});

	it("masks a concealed row", () => {
		const [chip] = summarizeChips(
			[
				row({
					masked: true,
					name: "Something unseen",
					type: "status_tag",
					state: "negative",
					tier: 2,
				}),
			],
			all,
		);
		expect(chip.label).toBe("Something unseen");
		expect(chip.value).toBe(-2);
	});

	it("keeps the Narrator's mark", () => {
		const [chip] = summarizeChips(
			[row({ state: "negative", narrator: true })],
			all,
		);
		expect(chip.narrator).toBe(true);
	});

	it("dedups by key", () => {
		expect(
			summarizeChips(
				[row({ state: "positive" }), row({ state: "positive" })],
				all,
			),
		).toHaveLength(1);
	});
});
