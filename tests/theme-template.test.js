import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemeTemplate } from "../modules/apps/theme-template.js";
import { fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Setting a Hero's theme up from the theme browser: a kit or themebook
// re-shapes the theme in place, with no evolution bookkeeping.

function tagEffect({ name, type = "power_tag", isTitleTag = false }) {
	const effect = fakeEffect({ name, type, system: { isTitleTag } });
	effect.toObject = () => ({ _id: effect.id, name, type, system: { isTitleTag } });
	return effect;
}

function fakeTheme({ name = "Blank", isFellowship = false, level = "origin" } = {}) {
	const effects = [
		tagEffect({ name: `${name} title`, isTitleTag: true }),
		tagEffect({ name: `${name} power` }),
		tagEffect({ name: `${name} weakness`, type: "weakness_tag" }),
	];
	const theme = fakeItem({ name, type: "theme", effects });
	theme.system = {
		isFellowship,
		themebook: "",
		level,
		description: "",
		quest: { description: "" },
		specialImprovements: [],
	};
	theme.deleteEmbeddedDocuments = vi.fn(async (_type, ids) => {
		for (const id of ids) {
			const idx = theme.effects.findIndex((e) => e.id === id);
			if (idx >= 0) theme.effects.splice(idx, 1);
		}
		return [];
	});
	return theme;
}

const created = (theme) =>
	theme.createEmbeddedDocuments.mock.calls.flatMap(([, docs]) => docs);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("applyThemeTemplate", () => {
	it("copies a kit's name, book, level, quest and tags, and keeps the title tag", async () => {
		const kit = fakeTheme({ name: "Hardened Warrior", level: "adventure" });
		kit.system.themebook = "Skill or Trade";
		kit.system.quest.description = "Prove yourself";
		const theme = fakeTheme();

		expect(await applyThemeTemplate({ theme, source: kit })).toBe(true);

		const update = theme.update.mock.calls[0][0];
		expect(update).toMatchObject({
			name: "Hardened Warrior",
			"system.themebook": "Skill or Trade",
			"system.level": "adventure",
			"system.quest.description": "Prove yourself",
			"system.improve.value": 0,
		});
		expect(update).not.toHaveProperty("system.nascentImprovements");
		expect(created(theme).map((e) => e.name)).toEqual([
			"Hardened Warrior power",
			"Hardened Warrior weakness",
		]);
		expect(theme.effects.map((e) => e.name)).toEqual(["Blank title"]);
	});

	it("takes a themebook's name, type and fixed Might, with a placeholder weakness", async () => {
		const book = fakeItem({ name: "Destiny", type: "themebook" });
		book.system = { theme_level: "greatness", isFellowship: false };
		const theme = fakeTheme();

		await applyThemeTemplate({ theme, source: book });

		expect(theme.update.mock.calls[0][0]).toMatchObject({
			name: "Destiny",
			"system.themebook": "Destiny",
			"system.level": "greatness",
			"system.specialImprovements": [],
		});
		const tags = created(theme);
		expect(tags).toHaveLength(1);
		expect(tags[0].type).toBe("weakness_tag");
	});

	it("keeps the theme's Might for a variable themebook", async () => {
		const book = fakeItem({ name: "Companion", type: "themebook" });
		book.system = { theme_level: "variable", isFellowship: false };
		const theme = fakeTheme({ level: "adventure" });

		await applyThemeTemplate({ theme, source: book });

		expect(theme.update.mock.calls[0][0]["system.level"]).toBe("adventure");
	});

	it("refuses a Fellowship source for a Hero theme and changes nothing", async () => {
		const kit = fakeTheme({ name: "Bound by Oath", isFellowship: true });
		const theme = fakeTheme();

		expect(await applyThemeTemplate({ theme, source: kit })).toBe(false);
		expect(theme.update).not.toHaveBeenCalled();
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
