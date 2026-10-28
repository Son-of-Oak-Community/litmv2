import { describe, expect, it } from "vitest";
import { ActionData } from "../modules/item/action/action-data.js";

// Migration converts legacy success entries (structured payload + quality
// dropdown) into the new free-text + markup shape. These tests pin the rules
// from the alignment doc so the converter doesn't drift later.

describe("ActionData.migrateData", () => {
	it("returns source untouched when there are no successes", () => {
		const out = ActionData.migrateData({ description: "x" });
		expect(out).toEqual({ description: "x" });
	});

	it("converts a Create + tagName payload into [tagName] markup", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "create",
					quality: "detailed",
					label: "",
					description: "",
					payload: { tagName: "map" },
				},
			],
		});
		expect(out.successes).toEqual([
			{ id: "s1", verb: "create", text: "[map]" },
		]);
		expect(out.extraFeats).toBeUndefined();
	});

	it("leaves extraFeats out of a successes-only update diff (#177)", () => {
		const out = ActionData.migrateData({
			successes: [{ id: "s1", verb: "enhance", text: "" }],
		});
		expect("extraFeats" in out).toBe(false);
	});

	it("converts a status payload with tier into [name-N] markup", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "attack",
					quality: "detailed",
					payload: { statusName: "wounded", tier: 2 },
				},
			],
		});
		expect(out.successes[0].text).toBe("[wounded-2]");
		expect(out.successes[0].verb).toBe("attack");
	});

	it("converts a status payload with null tier into [name-] (variable)", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "attack",
					quality: "detailed",
					payload: { statusName: "wounded", tier: null },
				},
			],
		});
		expect(out.successes[0].text).toBe("[wounded-]");
	});

	it("converts isSingleUse tag payload into [name!] markup", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "create",
					quality: "detailed",
					payload: { tagName: "smoke bomb", isSingleUse: true },
				},
			],
		});
		expect(out.successes[0].text).toBe("[smoke bomb!]");
	});

	it("hoists extraFeat-quality successes into the top-level extraFeats array", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "enhance",
					quality: "extraFeat",
					label: "Prevent counterattack",
					description: "",
				},
				{
					id: "s2",
					verb: "create",
					quality: "detailed",
					payload: { tagName: "map" },
				},
			],
		});
		expect(out.successes).toHaveLength(1);
		expect(out.successes[0].id).toBe("s2");
		expect(out.extraFeats).toEqual(["Prevent counterattack"]);
	});

	it("hoists verb=extraFeat successes the same way as quality=extraFeat", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "extraFeat",
					quality: "detailed",
					label: "Keep the spotlight",
				},
			],
		});
		expect(out.successes).toHaveLength(0);
		expect(out.extraFeats).toEqual(["Keep the spotlight"]);
	});

	it("forces quality=quick successes to the `quick` verb regardless of original verb", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "create",
					quality: "quick",
					label: "You find a hidden path",
				},
			],
		});
		expect(out.successes[0].verb).toBe("quick");
		expect(out.successes[0].text).toBe("You find a hidden path");
	});

	it("concatenates label and description as prose, then trailing markup", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "create",
					quality: "detailed",
					label: "Find shelter",
					description: "from the storm",
					payload: { tagName: "shelter" },
				},
			],
		});
		expect(out.successes[0].text).toBe(
			"Find shelter — from the storm [shelter]",
		);
	});

	it("preserves both tag and status tokens when payload has both", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "attack",
					quality: "detailed",
					payload: { tagName: "marked", statusName: "wounded", tier: 1 },
				},
			],
		});
		expect(out.successes[0].text).toBe("[marked] [wounded-1]");
	});

	it("is idempotent — already-migrated entries pass through unchanged", () => {
		const already = { id: "s1", verb: "create", text: "[map]" };
		const out = ActionData.migrateData({ successes: [already] });
		expect(out.successes).toEqual([already]);
	});

	it("preserves pre-existing extraFeats and appends migrated ones", () => {
		const out = ActionData.migrateData({
			extraFeats: ["Existing feat"],
			successes: [
				{
					id: "s1",
					verb: "enhance",
					quality: "extraFeat",
					label: "Migrated feat",
				},
			],
		});
		expect(out.extraFeats).toEqual(["Existing feat", "Migrated feat"]);
	});

	it("drops out-of-range tier values to variable [name-] markup", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					id: "s1",
					verb: "attack",
					quality: "detailed",
					payload: { statusName: "wounded", tier: 99 },
				},
			],
		});
		expect(out.successes[0].text).toBe("[wounded-]");
	});

	it("synthesizes an id when the legacy entry lacks one", () => {
		const out = ActionData.migrateData({
			successes: [
				{
					verb: "create",
					quality: "detailed",
					payload: { tagName: "x" },
				},
			],
		});
		expect(out.successes[0].id).toBeTruthy();
	});
});
