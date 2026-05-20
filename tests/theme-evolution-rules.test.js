import { describe, expect, it } from "vitest";
import {
	applyPromiseGain,
	availableModes,
	getRevisableParts,
	getTradeCaps,
	POWER_BASELINE,
	PROMISE_MAX,
	totalTradeCap,
	WEAKNESS_BASELINE,
} from "../modules/apps/theme-evolution-rules.js";

const effect = ({
	id = "fx",
	name = "tag",
	type = "power_tag",
	isTitleTag = false,
} = {}) => ({ id, name, type, system: { isTitleTag } });

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
				specials: [{ name: "Named" }, { description: "Described only" }, {}],
			}),
		);
		expect(parts).toEqual([
			{ kind: "special", id: "0", name: "Named" },
			{ kind: "special", id: "1", name: "Described only" },
			{ kind: "special", id: "2", name: "#3" },
		]);
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
					specials: [{ name: "a" }, { name: "b" }],
				}),
			),
		);
		expect(caps).toEqual({ power: 2, weakness: 1, special: 2 });
	});

	it("totalTradeCap sums the kinds", () => {
		expect(totalTradeCap({ power: 2, weakness: 1, special: 3 })).toBe(6);
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
