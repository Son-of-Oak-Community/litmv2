import { describe, expect, it, vi } from "vitest";
import {
	graceMoments,
	markMomentOfGrace,
	secretGraceTier,
	spendSecretGrace,
	toggleMomentOfGrace,
} from "../modules/actor/hero/secret-grace.js";

// Vol. II p.78: one tier per moment of grace. A Sacrifice's Secret Grace
// Bonus scratches that many moments, oldest first; scratched ones are kept.
const hero = (moments) => {
	const actor = {
		moments,
		getFlag: () => actor.moments,
		setFlag: vi.fn(async (_scope, _key, value) => {
			actor.moments = value;
		}),
	};
	return actor;
};
const moment = (scratched = false, id = "m") => ({
	id,
	text: "Spared the wolf",
	scratched,
});

describe("Secret Grace", () => {
	it("is one tier per unused moment, up to the top status tier", () => {
		expect(secretGraceTier(hero([moment(), moment(), moment(true)]))).toBe(2);
		expect(secretGraceTier(hero(Array.from({ length: 9 }, () => moment())))).toBe(6);
		expect(secretGraceTier(hero(undefined))).toBe(0);
	});

	it("marks a moment with what the Hero did", async () => {
		const actor = hero([]);
		await markMomentOfGrace(actor, "  Gave her bread away ");
		expect(graceMoments(actor)).toEqual([
			{ id: expect.any(String), text: "Gave her bread away", scratched: false },
		]);
	});

	it("keeps a scratched moment for history without counting it", async () => {
		const actor = hero([moment(), { ...moment(), id: "x" }]);
		await toggleMomentOfGrace(actor, "x");
		expect(secretGraceTier(actor)).toBe(1);
		expect(graceMoments(actor)).toHaveLength(2);
		await toggleMomentOfGrace(actor, "x");
		expect(secretGraceTier(actor)).toBe(2);
	});

	it("scratches as many moments as the bonus, oldest first", async () => {
		const actor = hero([moment(true, "a"), moment(false, "b"), moment(false, "c")]);
		await spendSecretGrace(actor, 1);
		expect(graceMoments(actor).map((m) => m.scratched)).toEqual([
			true,
			true,
			false,
		]);
		await spendSecretGrace(actor, 5);
		expect(secretGraceTier(actor)).toBe(0);
		expect(graceMoments(actor)).toHaveLength(3);
		expect(spendSecretGrace(actor, 1)).toBeUndefined();
	});
});
