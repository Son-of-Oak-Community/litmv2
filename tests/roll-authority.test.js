import { describe, expect, it } from "vitest";
import {
	canEditNarratorFields,
	canEditTradePower,
	canInitiateRoll,
	isNarratorControlled,
	requiresRollApproval,
	resolveSharedRollOwner,
	showsRollSettings,
} from "../modules/apps/roll/roll-authority.js";

/**
 * The Narrator's Call is a shared table, not a handoff: one roll object both
 * sides look at live. That only works if the two halves of a roll have an
 * owner each — the Narrator's move and Might, the roller's tags and Trade
 * Power. These are the pure predicates that draw that line.
 */

describe("isNarratorControlled", () => {
	it("recognises a roll the Narrator opened", () => {
		expect(isNarratorControlled({ narratorUserId: "gm1" })).toBe(true);
	});

	it("treats a roll nobody called as uncontrolled", () => {
		expect(isNarratorControlled(null)).toBe(false);
		expect(isNarratorControlled(undefined)).toBe(false);
		expect(isNarratorControlled({})).toBe(false);
		expect(isNarratorControlled({ narratorUserId: null })).toBe(false);
	});
});

describe("canEditNarratorFields", () => {
	it("keeps the move and the Might with the Narrator on a called roll", () => {
		expect(
			canEditNarratorFields({
				isGM: false,
				isOwner: true,
				narratorControlled: true,
			}),
		).toBe(false);
	});

	it("still lets the Narrator change them while watching as a non-owner", () => {
		expect(
			canEditNarratorFields({
				isGM: true,
				isOwner: false,
				narratorControlled: true,
			}),
		).toBe(true);
	});

	it("leaves an uncalled roll entirely to its owner", () => {
		expect(
			canEditNarratorFields({
				isGM: false,
				isOwner: true,
				narratorControlled: false,
			}),
		).toBe(true);
	});

	it("does not hand them to a non-owner on an uncalled roll", () => {
		expect(
			canEditNarratorFields({
				isGM: false,
				isOwner: false,
				narratorControlled: false,
			}),
		).toBe(false);
	});

	it("defaults to refusing when nothing is known", () => {
		expect(canEditNarratorFields()).toBe(false);
	});
});

describe("canEditTradePower", () => {
	it("is the owner's bargain on a single-hero roll", () => {
		expect(canEditTradePower({ isOwner: true, isGroupRoll: false })).toBe(true);
	});

	it("has nobody to strike it in an Acting Together roll", () => {
		expect(canEditTradePower({ isOwner: true, isGroupRoll: true })).toBe(false);
	});

	it("is never a non-owner's to set", () => {
		expect(canEditTradePower({ isOwner: false, isGroupRoll: false })).toBe(
			false,
		);
	});
});

describe("showsRollSettings", () => {
	it("renders for the roller", () => {
		expect(showsRollSettings({ isOwner: true, isGM: false })).toBe(true);
	});

	it("renders for the Narrator watching a player's roll, so they can set Might", () => {
		expect(showsRollSettings({ isOwner: false, isGM: true })).toBe(true);
	});

	it("stays hidden for a player watching someone else's roll", () => {
		expect(showsRollSettings({ isOwner: false, isGM: false })).toBe(false);
	});
});

describe("resolveSharedRollOwner", () => {
	const gm = "gm1";

	it("gives the dialog to an active player owner", () => {
		expect(
			resolveSharedRollOwner({
				owners: [
					{ id: "p1", active: true, isGM: false },
					{ id: gm, active: true, isGM: true },
				],
				gmUserId: gm,
			}),
		).toBe("p1");
	});

	it("falls back to the Narrator when the hero's player is offline", () => {
		expect(
			resolveSharedRollOwner({
				owners: [{ id: "p1", active: false, isGM: false }],
				gmUserId: gm,
			}),
		).toBe(gm);
	});

	it("falls back to the Narrator when the hero has no player owner at all", () => {
		expect(resolveSharedRollOwner({ owners: [], gmUserId: gm })).toBe(gm);
	});

	it("never hands the roll to a GM seat that merely owns the hero", () => {
		expect(
			resolveSharedRollOwner({
				owners: [{ id: "gm2", active: true, isGM: true }],
				gmUserId: gm,
			}),
		).toBe(gm);
	});

	it("lands on the GM for a group roll, which passes no owners", () => {
		expect(resolveSharedRollOwner({ gmUserId: gm })).toBe(gm);
	});

	it("returns null when there is nobody at all", () => {
		expect(resolveSharedRollOwner()).toBe(null);
	});
});

describe("requiresRollApproval", () => {
	it("routes a player's roll past the Narrator when the table asks for it", () => {
		expect(requiresRollApproval({ isGM: false, requireApproval: true })).toBe(
			true,
		);
	});

	it("leaves a player's roll alone when it is off", () => {
		expect(requiresRollApproval({ isGM: false, requireApproval: false })).toBe(
			false,
		);
	});

	it("never moderates the Narrator", () => {
		expect(requiresRollApproval({ isGM: true, requireApproval: true })).toBe(
			false,
		);
	});

	it("skips a group roll — the Narrator is already the one pressing Roll", () => {
		expect(
			requiresRollApproval({
				isGM: false,
				requireApproval: true,
				isGroupRoll: true,
			}),
		).toBe(false);
	});

	it("is independent of player instigation: both settings can be read separately", () => {
		// `canInitiateRoll` governs starting a roll, `requiresRollApproval`
		// governs executing one. Neither implies the other.
		expect(canInitiateRoll({ isGM: false, playerInitiatedRolls: true })).toBe(
			true,
		);
		expect(requiresRollApproval({ isGM: false, requireApproval: true })).toBe(
			true,
		);
	});

	it("defaults to off", () => {
		expect(requiresRollApproval()).toBe(false);
	});
});

describe("canInitiateRoll", () => {
	it("lets anyone start a roll while player instigation is enabled", () => {
		expect(canInitiateRoll({ isGM: false, playerInitiatedRolls: true })).toBe(
			true,
		);
	});

	it("blocks a player from starting a roll once the table routes rolls through the Narrator", () => {
		expect(canInitiateRoll({ isGM: false, playerInitiatedRolls: false })).toBe(
			false,
		);
	});

	it("never gates the Narrator", () => {
		expect(canInitiateRoll({ isGM: true, playerInitiatedRolls: false })).toBe(
			true,
		);
	});

	it("defaults to permitted when the setting is unavailable", () => {
		expect(canInitiateRoll({})).toBe(true);
	});
});
