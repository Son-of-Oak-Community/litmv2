// vitest-isolate: stubs foundry.dice.terms.Die before importing the die term
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `DoubleSix` is a legacy term. Foundry v14 parses `2d6` to a plain `Die`, so
 * no new roll builds it; it is kept so chat cards stored by older versions,
 * which name the class, go on reading the total they were posted with.
 */

let DoubleSix;

/** Foundry's `Die#total`, cut down to what the term builds on. */
class StubDie {
	constructor({ number = 1, faces, results = [], options = {} } = {}) {
		this.number = number;
		this.faces = faces;
		this.results = results;
		this.options = options;
		this._evaluated = results.length > 0;
	}

	get total() {
		if (!this._evaluated) return undefined;
		return this.results.reduce((t, r) => (r.active ? t + r.result : t), 0);
	}
}

/** A term rebuilt from a stored chat message. */
const stored = (...faces) =>
	new DoubleSix({
		number: faces.length,
		results: faces.map((result) => ({ result, active: true })),
	});

beforeAll(async () => {
	foundry.dice.terms = { ...foundry.dice.terms, Die: StubDie };
	({ DoubleSix } = await import("../modules/apps/dice.js"));
});

describe("DoubleSix", () => {
	it("is a twelve-sided die behind the d6 denomination", () => {
		expect(DoubleSix.DENOMINATION).toBe("6");
		expect(stored(1).faces).toBe(12);
	});

	it("reads a stored roll as half its faces, rounded up", () => {
		expect(stored(7, 7).total).toBe(7);
		expect(stored(6, 6).total).toBe(6);
		expect(stored(1, 2).total).toBe(2);
		expect(stored(12, 12).total).toBe(12);
	});

	it("leaves a discarded die out of the total", () => {
		const term = new DoubleSix({
			number: 2,
			results: [
				{ result: 9, active: true },
				{ result: 12, active: false },
			],
		});
		expect(term.total).toBe(5);
	});

	it("has no total before it is rolled", () => {
		expect(new DoubleSix({ number: 2 }).total).toBeUndefined();
	});

	it("registers only when themed dice are on", async () => {
		const { LitmSettings } = await import("../modules/system/settings.js");
		const spy = vi.spyOn(LitmSettings, "customDice", "get");
		const terms = {};
		const previous = CONFIG.Dice;
		CONFIG.Dice = { terms };
		try {
			spy.mockReturnValue(false);
			DoubleSix.register();
			expect(terms["6"]).toBeUndefined();

			spy.mockReturnValue(true);
			DoubleSix.register();
			expect(terms["6"]).toBe(DoubleSix);
		} finally {
			CONFIG.Dice = previous;
			spy.mockRestore();
		}
	});
});
