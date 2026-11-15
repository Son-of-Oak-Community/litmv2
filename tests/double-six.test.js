// vitest-isolate: stubs foundry.dice.terms.Die before importing the die term
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The themed die is a d12 whose faces are labelled 1-5 and F twice over
 * (compat-hooks.js, the Dice So Nice preset), so two of them are 2d6. What
 * the roll counts has to be what the die on the table shows.
 */

let DoubleSix;

/** Foundry's `Die#total` and label, cut down to what the term overrides. */
class StubDie {
	constructor({ number = 1, faces, results = [] } = {}) {
		this.number = number;
		this.faces = faces;
		this.results = results;
		this._evaluated = results.length > 0;
	}

	get total() {
		if (!this._evaluated) return undefined;
		let total = this.results.reduce((t, r) => (r.active ? t + r.result : t), 0);
		if (this.number < 0) total *= -1;
		return total;
	}

	getResultLabel(result) {
		return String(result.result);
	}

	getResultCSS(result) {
		return [
			`d${this.faces}`,
			result.result === 1 ? "min" : null,
			result.result === this.faces ? "max" : null,
		];
	}
}

const rolled = (...faces) =>
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
		expect(rolled(1).faces).toBe(12);
	});

	it("counts each face as the pip it shows", () => {
		// Faces 1-6 show 1-6, faces 7-12 show 1-6 again.
		const shown = Array.from({ length: 12 }, (_, i) => rolled(i + 1).total);
		expect(shown).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
	});

	it("totals two dice as the sum of what they show", () => {
		expect(rolled(1, 1).total).toBe(2);
		expect(rolled(7, 7).total).toBe(2);
		expect(rolled(6, 12).total).toBe(12);
		expect(rolled(12, 1).total).toBe(7);
	});

	it("rolls the 2d6 distribution", () => {
		const counts = {};
		for (let a = 1; a <= 12; a++) {
			for (let b = 1; b <= 12; b++) {
				const total = rolled(a, b).total;
				counts[total] = (counts[total] ?? 0) + 1;
			}
		}
		// 144 outcomes: every 2d6 combination four times over.
		expect(counts).toEqual({
			2: 4,
			3: 8,
			4: 12,
			5: 16,
			6: 20,
			7: 24,
			8: 20,
			9: 16,
			10: 12,
			11: 8,
			12: 4,
		});
	});

	it("leaves a discarded die out of the total", () => {
		const term = new DoubleSix({
			number: 2,
			results: [
				{ result: 9, active: true },
				{ result: 12, active: false },
			],
		});
		expect(term.total).toBe(3);
	});

	it("has no total before it is rolled", () => {
		expect(new DoubleSix({ number: 2 }).total).toBeUndefined();
	});

	it("labels a result with the pip, so the card matches the die", () => {
		const term = rolled(7, 12);
		expect(term.results.map((r) => term.getResultLabel(r))).toEqual(["1", "6"]);
	});

	it("marks the lowest and highest pip, not the lowest and highest face", () => {
		const term = rolled(7, 6, 12, 1);
		const css = term.results.map((r) => term.getResultCSS(r));
		expect(css[0]).toContain("min");
		expect(css[1]).toContain("max");
		expect(css[2]).toContain("max");
		expect(css[3]).toContain("min");
		expect(css[0]).not.toContain("max");
		expect(css[1]).not.toContain("min");
	});

	it("registers only when themed dice are on", async () => {
		const { LitmSettings } = await import("../modules/system/settings.js");
		const { vi } = await import("vitest");
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
