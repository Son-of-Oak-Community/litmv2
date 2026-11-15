import { describe, expect, it } from "vitest";
import { countsTowardLimit } from "../modules/active-effects/effect-queries.js";

// effect-queries.js: "A hidden status never counts on a Hero, nor on any actor
// a player owns: it is hidden from that player, so it must not move what they
// can see. On a Challenge, hidden is how the Narrator's statuses start, so they
// count." CLAUDE.md: "A hidden status never counts toward a Hero's limits or
// its limit readout, nor toward the limits of any actor a player owns; on a
// Challenge, whose statuses start hidden, it counts."

const status = (isHidden) => ({ system: { isHidden } });
const hero = { type: "hero", hasPlayerOwner: false };
const challenge = { type: "challenge", hasPlayerOwner: false };

describe("countsTowardLimit", () => {
	describe("a visible status", () => {
		it.each([
			["a Hero", hero],
			["a Challenge", challenge],
			["a Journey a player owns", { type: "journey", hasPlayerOwner: true }],
			["no actor (a scene column)", undefined],
			["a null actor", null],
		])("counts on %s", (_label, actor) => {
			expect(countsTowardLimit(status(false), actor)).toBe(true);
		});
	});

	describe("a hidden status", () => {
		it("never counts on a Hero, even one nobody plays yet", () => {
			expect(countsTowardLimit(status(true), hero)).toBe(false);
		});

		it("never counts on an actor a player owns, whatever its type", () => {
			for (const type of ["challenge", "journey", "fellowship", "story_theme"])
				expect(
					countsTowardLimit(status(true), { type, hasPlayerOwner: true }),
				).toBe(false);
		});

		it("counts on a Challenge no player owns, where the Narrator's statuses start hidden", () => {
			expect(countsTowardLimit(status(true), challenge)).toBe(true);
		});

		it("counts on a Journey no player owns", () => {
			expect(
				countsTowardLimit(status(true), {
					type: "journey",
					hasPlayerOwner: false,
				}),
			).toBe(true);
		});

		it("counts when there is no actor to protect, as in a scene column", () => {
			expect(countsTowardLimit(status(true), undefined)).toBe(true);
			expect(countsTowardLimit(status(true), null)).toBe(true);
		});
	});

	describe("the effect shapes it reads", () => {
		// "An ActiveEffect, or a UI descriptor carrying `hidden`" — the sidebar
		// passes descriptors, the limit recalc passes effects, one rule.
		it("reads `hidden` off a UI descriptor", () => {
			expect(countsTowardLimit({ hidden: true }, hero)).toBe(false);
			expect(countsTowardLimit({ hidden: true }, challenge)).toBe(true);
			expect(countsTowardLimit({ hidden: false }, hero)).toBe(true);
		});

		it("treats an effect with no hidden flag at all as visible", () => {
			expect(countsTowardLimit({}, hero)).toBe(true);
			expect(countsTowardLimit({ system: {} }, hero)).toBe(true);
			expect(countsTowardLimit(null, hero)).toBe(true);
			expect(countsTowardLimit(undefined, hero)).toBe(true);
		});
	});
});
