import { describe, expect, it } from "vitest";
import { maskConcealedTags } from "../modules/apps/roll/concealment.js";

/**
 * A concealed Challenge's tag still moves the Power, so it cannot be dropped
 * from a roll — but naming it on the chat card undoes the concealment the
 * dialog just protected. What is masked is identity, never magnitude.
 */

const MASK = "Something unseen";

const mask = (tags, concealed, owners = {}) =>
	maskConcealedTags(tags, {
		concealedActorIds: new Set(concealed),
		resolveActorId: (tag) => owners[tag.uuid] ?? null,
		maskName: MASK,
	});

describe("maskConcealedTags", () => {
	it("renames a tag whose actor this viewer may not see", () => {
		const tags = [{ uuid: "e1", name: "lurking", value: 4 }];
		const out = mask(tags, ["hidden"], { e1: "hidden" });
		expect(out[0].name).toBe(MASK);
		expect(out[0].isConcealed).toBe(true);
	});

	it("keeps the tier — the number is the honest part", () => {
		const tags = [{ uuid: "e1", name: "lurking", value: 4 }];
		expect(mask(tags, ["hidden"], { e1: "hidden" })[0].value).toBe(4);
	});

	it("leaves a visible actor's tag alone", () => {
		const tags = [{ uuid: "e1", name: "Hardened Warrior" }];
		const out = mask(tags, ["hidden"], { e1: "gerrin" });
		expect(out[0].name).toBe("Hardened Warrior");
		expect(out[0].isConcealed).toBeUndefined();
	});

	it("never conceals a tag no actor owns, like a scene tag", () => {
		const tags = [{ uuid: "pack.e1", name: "pouring rain" }];
		expect(mask(tags, ["hidden"])[0].name).toBe("pouring rain");
	});

	it("masks only the concealed entries in a mixed list", () => {
		const tags = [
			{ uuid: "e1", name: "lurking" },
			{ uuid: "e2", name: "Hardened Warrior" },
		];
		const out = mask(tags, ["hidden"], { e1: "hidden", e2: "gerrin" });
		expect(out.map((t) => t.name)).toEqual([MASK, "Hardened Warrior"]);
	});

	it("does not mutate the tags it was given", () => {
		const tags = [{ uuid: "e1", name: "lurking" }];
		mask(tags, ["hidden"], { e1: "hidden" });
		expect(tags[0].name).toBe("lurking");
	});

	it("returns the original array untouched for a GM, who conceals nothing", () => {
		const tags = [{ uuid: "e1", name: "lurking" }];
		expect(mask(tags, [], { e1: "hidden" })).toBe(tags);
	});

	it("returns the original array when nothing in it is concealed", () => {
		const tags = [{ uuid: "e1", name: "Hardened Warrior" }];
		expect(mask(tags, ["hidden"], { e1: "gerrin" })).toBe(tags);
	});

	it("tolerates an empty or missing list", () => {
		expect(mask([], ["hidden"])).toEqual([]);
		expect(maskConcealedTags(undefined, {})).toEqual([]);
	});
});
