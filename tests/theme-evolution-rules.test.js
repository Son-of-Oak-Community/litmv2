import { describe, expect, it } from "vitest";
import {
	applyPromiseGain,
	availableModes,
	getRevisableParts,
	getTradeCaps,
	POWER_BASELINE,
	PROMISE_MAX,
	syntheticTradedFromCaps,
	totalTradeCap,
	WEAKNESS_BASELINE,
} from "../modules/apps/theme-evolution-rules.js";

const effect = ({
	id = "fx",
	name = "tag",
	type = "power_tag",
	isTitleTag = false,
	disabled = false,
	isScratched = false,
} = {}) => ({
	id,
	name,
	type,
	disabled,
	system: { isTitleTag, isScratched },
});

const special = ({ name = "special", isActive = true, ...rest } = {}) => ({
	name,
	isActive,
	...rest,
});

const theme = ({
	power = 0,
	weakness = 0,
	specials = [],
	titleTag = true,
	milestone = 0,
	abandon = 0,
} = {}) => {
	const effects = [];
	if (titleTag) {
		effects.push(effect({ id: "title", name: "Title", isTitleTag: true }));
	}
	for (let i = 0; i < power; i++) {
		effects.push(effect({ id: `p${i}`, name: `power-${i}` }));
	}
	for (let i = 0; i < weakness; i++) {
		effects.push(
			effect({ id: `w${i}`, name: `weak-${i}`, type: "weakness_tag" }),
		);
	}
	return {
		effects,
		system: {
			specialImprovements: specials,
			quest: {
				tracks: {
					milestone: { value: milestone },
					abandon: { value: abandon },
				},
			},
		},
	};
};

describe("availableModes", () => {
	it("evolve is default when only the milestone track is full", () => {
		expect(availableModes(theme({ milestone: 3 }))).toEqual({
			defaultMode: "evolve",
			milestoneFull: true,
			abandonFull: false,
		});
	});

	it("replace is default when only the abandon track is full", () => {
		expect(availableModes(theme({ abandon: 3 }))).toEqual({
			defaultMode: "replace",
			milestoneFull: false,
			abandonFull: true,
		});
	});

	it("Inexorable Failure: both full, evolve is default but both available", () => {
		expect(availableModes(theme({ milestone: 3, abandon: 3 }))).toEqual({
			defaultMode: "evolve",
			milestoneFull: true,
			abandonFull: true,
		});
	});
});

describe("getRevisableParts", () => {
	it("excludes the title tag from revisable power tags", () => {
		const parts = getRevisableParts(theme({ power: 2 }));
		expect(parts).toHaveLength(2);
		for (const p of parts) expect(p.kind).toBe("power");
		expect(parts.map((p) => p.id)).toEqual(["p0", "p1"]);
	});

	it("returns weakness tags as kind=weakness", () => {
		const parts = getRevisableParts(theme({ weakness: 2, titleTag: false }));
		expect(parts.map((p) => p.kind)).toEqual(["weakness", "weakness"]);
	});

	it("returns specials with their index as id and fallback name", () => {
		const parts = getRevisableParts(
			theme({
				titleTag: false,
				specials: [
					special({ name: "Named" }),
					special({ name: "", description: "Described only" }),
					special({ name: "" }),
				],
			}),
		);
		expect(parts).toEqual([
			{ kind: "special", id: "0", name: "Named" },
			{ kind: "special", id: "1", name: "Described only" },
			{ kind: "special", id: "2", name: "#3" },
		]);
	});

	it("excludes locked (disabled) power and weakness tags", () => {
		const theme = {
			effects: [
				effect({ id: "p0", name: "p0" }),
				effect({ id: "p1", name: "p1", disabled: true }),
				effect({ id: "w0", name: "w0", type: "weakness_tag" }),
				effect({
					id: "w1",
					name: "w1",
					type: "weakness_tag",
					disabled: true,
				}),
			],
			system: { specialImprovements: [] },
		};
		const parts = getRevisableParts(theme);
		expect(parts.map((p) => p.id)).toEqual(["p0", "w0"]);
	});

	it("keeps scratched tags revisable (the tag still exists on the theme)", () => {
		const theme = {
			effects: [
				effect({ id: "p0", name: "p0" }),
				effect({ id: "p1", name: "p1", isScratched: true }),
			],
			system: { specialImprovements: [] },
		};
		const parts = getRevisableParts(theme);
		expect(parts.map((p) => p.id)).toEqual(["p0", "p1"]);
	});

	it("excludes inactive special improvements", () => {
		const parts = getRevisableParts(
			theme({
				titleTag: false,
				specials: [
					special({ name: "claimed" }),
					special({ name: "unclaimed", isActive: false }),
				],
			}),
		);
		expect(parts.map((p) => p.name)).toEqual(["claimed"]);
	});

	it("preserves the unfiltered array index as the special id", () => {
		// applyTransformation uses `Number(p.id)` to index into the *raw*
		// theme.system.specialImprovements when renaming/trading. If an
		// inactive entry sits earlier in the array, the surviving entries
		// must still report their original index — otherwise renames and
		// trades target the wrong row.
		const parts = getRevisableParts(
			theme({
				titleTag: false,
				specials: [
					special({ name: "unclaimed-first", isActive: false }),
					special({ name: "second" }),
					special({ name: "third" }),
				],
			}),
		);
		expect(parts).toEqual([
			{ kind: "special", id: "1", name: "second" },
			{ kind: "special", id: "2", name: "third" },
		]);
	});

	it("trade caps shrink when locked parts are excluded", () => {
		// 5 power tags total but only 3 unlocked → 0 extras (baseline 3),
		// even though the raw count of 5 would otherwise yield 2 extras.
		const t = {
			effects: [
				effect({ id: "p0", name: "p0" }),
				effect({ id: "p1", name: "p1" }),
				effect({ id: "p2", name: "p2" }),
				effect({ id: "p3", name: "p3", disabled: true }),
				effect({ id: "p4", name: "p4", disabled: true }),
			],
			system: { specialImprovements: [] },
		};
		const caps = getTradeCaps(getRevisableParts(t));
		expect(caps).toEqual({ power: 0, weakness: 0, special: 0 });
	});
});

describe("getTradeCaps", () => {
	it("returns zero caps for a baseline theme", () => {
		const caps = getTradeCaps(
			getRevisableParts(
				theme({ power: POWER_BASELINE, weakness: WEAKNESS_BASELINE }),
			),
		);
		expect(caps).toEqual({ power: 0, weakness: 0, special: 0 });
	});

	it("caps trades to extras beyond baseline", () => {
		const caps = getTradeCaps(
			getRevisableParts(
				theme({
					power: POWER_BASELINE + 2,
					weakness: WEAKNESS_BASELINE + 1,
					specials: [special({ name: "a" }), special({ name: "b" })],
				}),
			),
		);
		expect(caps).toEqual({ power: 2, weakness: 1, special: 2 });
	});

	it("totalTradeCap sums the kinds", () => {
		expect(totalTradeCap({ power: 2, weakness: 1, special: 3 })).toBe(6);
	});

	it("syntheticTradedFromCaps yields one placeholder per total cap", () => {
		const parts = syntheticTradedFromCaps({
			power: 2,
			weakness: 1,
			special: 1,
		});
		expect(parts).toHaveLength(4);
		for (const p of parts) expect(p.kind).toBe("synthetic");
		expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
	});

	it("syntheticTradedFromCaps yields an empty list for a baseline theme", () => {
		expect(
			syntheticTradedFromCaps({ power: 0, weakness: 0, special: 0 }),
		).toEqual([]);
	});
});

describe("applyPromiseGain", () => {
	it("adds within the cap with no banking", () => {
		const r = applyPromiseGain({ currentPromise: 2, gained: 2 });
		expect(r.update).toEqual({ "system.promise": 4 });
		expect(r.banked).toBe(0);
		expect(r.reachedFulfillment).toBe(false);
	});

	it("reaches fulfillment exactly at the cap", () => {
		const r = applyPromiseGain({ currentPromise: 3, gained: 2 });
		expect(r.update).toEqual({ "system.promise": PROMISE_MAX });
		expect(r.banked).toBe(0);
		expect(r.reachedFulfillment).toBe(true);
	});

	it("banks overflow when the gain exceeds the cap", () => {
		const r = applyPromiseGain({ currentPromise: 3, gained: 5 });
		expect(r.update).toEqual({
			"system.promise": PROMISE_MAX,
			"system.pendingPromise": 3,
		});
		expect(r.banked).toBe(3);
		expect(r.reachedFulfillment).toBe(true);
	});

	it("banks onto existing pending without crossing fulfillment again", () => {
		// Already at cap, MoF unresolved, another gain arrives.
		const r = applyPromiseGain({
			currentPromise: PROMISE_MAX,
			currentPending: 2,
			gained: 3,
		});
		expect(r.update).toEqual({
			"system.promise": PROMISE_MAX,
			"system.pendingPromise": 5,
		});
		expect(r.banked).toBe(3);
		// Track did not *cross* the cap this time — caller must NOT fire a
		// duplicate Moment-of-Fulfillment hook.
		expect(r.reachedFulfillment).toBe(false);
	});
});
