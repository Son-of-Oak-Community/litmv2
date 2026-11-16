import { describe, expect, it } from "vitest";
import { ChallengeData } from "../modules/actor/challenge/challenge-data.js";
import { fakeActor, fakeItem } from "./__helpers__/factories.js";

// A Challenge's addons add to it: rating, roles, limits, Might, tags and
// threats. prepareDerivedData works the totals out into `derived*` fields and
// leaves the Challenge's own stored data as it was, so a write of
// `system.limits` never saves an addon's limit as the Challenge's own.

const addon = (name, system = {}) => {
	const item = fakeItem({ type: "addon", name });
	item.system = {
		ratingBonus: 0,
		categories: [],
		limits: [],
		might: [],
		tags: "",
		threats: [],
		...system,
	};
	return item;
};

const limit = (id, label, max, value = 0) => ({ id, label, max, value });

const challenge = ({ items = [], limits = [], ...fields } = {}) => {
	const model = new ChallengeData({
		rating: 1,
		category: "",
		might: [],
		tags: "",
		_source: { limits },
		...fields,
	});
	model.parent = fakeActor({ type: "challenge", items });
	model.prepareDerivedData();
	return model;
};

describe("ChallengeData.prepareDerivedData: rating", () => {
	it("is the Challenge's own rating with no addons", () => {
		expect(challenge({ rating: 3 }).derivedRating).toBe(3);
	});

	it("adds each addon's bonus", () => {
		const model = challenge({
			rating: 2,
			items: [addon("Armoured", { ratingBonus: 1 }), addon("Plain")],
		});
		expect(model.derivedRating).toBe(3);
	});

	it("stops at 5", () => {
		const model = challenge({
			rating: 4,
			items: [
				addon("Armoured", { ratingBonus: 1 }),
				addon("Winged", { ratingBonus: 2 }),
			],
		});
		expect(model.derivedRating).toBe(5);
	});

	it("leaves the stored rating alone", () => {
		const model = challenge({
			rating: 2,
			items: [addon("Armoured", { ratingBonus: 2 })],
		});
		expect(model.rating).toBe(2);
	});

	it("counts addons only, not the Challenge's other items", () => {
		const vignette = fakeItem({ type: "vignette" });
		vignette.system = { ratingBonus: 3 };
		expect(challenge({ rating: 1, items: [vignette] }).derivedRating).toBe(1);
	});
});

describe("ChallengeData.prepareDerivedData: limits", () => {
	it("keeps the higher max when an addon names a limit the Challenge has", () => {
		const model = challenge({
			limits: [limit("own-1", "Wounded", 3, 2)],
			items: [addon("Armoured", { limits: [limit("add-1", "wounded", 5)] })],
		});

		expect(model.derivedLimits).toEqual([limit("own-1", "Wounded", 5, 2)]);
	});

	it("keeps the Challenge's max when the addon's is lower", () => {
		const model = challenge({
			limits: [limit("own-1", "Wounded", 4, 1)],
			items: [addon("Frail", { limits: [limit("add-1", "Wounded", 2)] })],
		});

		expect(model.derivedLimits).toEqual([limit("own-1", "Wounded", 4, 1)]);
	});

	it("appends a limit only the addon has", () => {
		const model = challenge({
			limits: [limit("own-1", "Wounded", 3)],
			items: [addon("Skittish", { limits: [limit("add-1", "Scared", 2)] })],
		});

		expect(model.derivedLimits).toEqual([
			limit("own-1", "Wounded", 3),
			limit("add-1", "Scared", 2),
		]);
	});

	it("merges two addons that name the same new limit", () => {
		const model = challenge({
			items: [
				addon("Skittish", { limits: [limit("a", "Scared", 2)] }),
				addon("Timid", { limits: [limit("b", "SCARED", 4)] }),
			],
		});

		expect(model.derivedLimits).toEqual([limit("a", "Scared", 4)]);
	});

	it("ignores an addon limit with no label", () => {
		const model = challenge({
			limits: [limit("own-1", "Wounded", 3)],
			items: [addon("Blank", { limits: [limit("add-1", "", 6)] })],
		});

		expect(model.derivedLimits).toEqual([limit("own-1", "Wounded", 3)]);
	});

	// "Add limit" writes `[...system.limits, newLimit]`. Were `limits` the
	// merged list, that write would save the addon's limit as the Challenge's.
	it("leaves the Challenge's own limits as they are stored", () => {
		const own = [limit("own-1", "Wounded", 3, 2)];
		const model = challenge({
			limits: own,
			items: [
				addon("Armoured", {
					limits: [limit("add-1", "Wounded", 5), limit("add-2", "Scared", 2)],
				}),
			],
		});

		expect(model.limits).toBe(own);
		expect(own).toEqual([limit("own-1", "Wounded", 3, 2)]);
	});
});

describe("ChallengeData.prepareDerivedData: the rest", () => {
	it("joins the Challenge's tags and its addons', skipping empty ones", () => {
		const model = challenge({
			tags: "[club]",
			items: [
				addon("Armoured", { tags: "[shield] [helm]" }),
				addon("Plain", { tags: "" }),
			],
		});
		expect(model.derivedTags).toBe("[club] [shield] [helm]");
	});

	it("has no derived tags when nothing has any", () => {
		expect(challenge({ items: [addon("Plain")] }).derivedTags).toBe("");
	});

	it("adds the addons' Might after the Challenge's own", () => {
		const own = { level: "adventure", description: "Huge" };
		const added = { level: "greatness", description: "Ancient" };
		const model = challenge({
			might: [own],
			items: [addon("Elder", { might: [added] })],
		});
		expect(model.derivedMight).toEqual([own, added]);
		expect(model.might).toEqual([own]);
	});

	it("collects each addon's threats under the addon's name", () => {
		const model = challenge({
			items: [
				addon("Winged", { threats: [{ name: "Dive" }, { name: "Gust" }] }),
				addon("Armoured", { threats: [{ name: "Bash" }] }),
			],
		});
		expect(model.addonThreats).toEqual([
			{ name: "Dive", addonName: "Winged" },
			{ name: "Gust", addonName: "Winged" },
			{ name: "Bash", addonName: "Armoured" },
		]);
	});

	it("lists the active addons with their rating bonus", () => {
		const winged = addon("Winged", { ratingBonus: 2 });
		const model = challenge({ items: [winged] });
		expect(model.activeAddons).toEqual([
			{ id: winged.id, name: "Winged", ratingBonus: 2 },
		]);
	});

	it("adds the addons' categories to the Challenge's roles", () => {
		const model = challenge({
			category: "Rival",
			items: [addon("Hunter", { categories: ["Stalker", "rival"] })],
		});
		expect(model.derivedRoles).toEqual(["Rival", "Stalker"]);
		expect(model.derivedCategories).toEqual(["Rival", "Stalker"]);
	});
});

// Older Challenges stored a limit's max as text. A blank or unusable max is
// the Core Book's "no maximum" Limit (p.169): an immunity, which holds no
// progress.
describe("ChallengeData.migrateData: a limit max stored as text", () => {
	const migrated = (max, value = 2) =>
		ChallengeData.migrateData({
			limits: [{ id: "lim-1", label: "Wounded", max, value }],
		}).limits[0];

	it("reads a number written as text", () => {
		expect(migrated("4")).toMatchObject({ max: 4, value: 2 });
	});

	it("drops a fraction", () => {
		expect(migrated("3.7").max).toBe(3);
	});

	it.each([
		["blank", ""],
		["not a number", "abc"],
		["a dash", "-"],
		["zero", "0"],
		["negative", "-2"],
	])("makes a %s max an immunity with no progress", (_label, max) => {
		expect(migrated(max)).toMatchObject({ max: 0, value: 0 });
	});

	it("leaves a numeric max and its value alone", () => {
		expect(migrated(3)).toMatchObject({ max: 3, value: 2 });
		expect(migrated(0)).toMatchObject({ max: 0, value: 2 });
	});

	it("leaves a source without limits alone", () => {
		expect(ChallengeData.migrateData({ rating: 2 })).toEqual({ rating: 2 });
	});
});
