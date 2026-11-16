import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerActorHooks } from "../modules/system/hooks/actor-hooks.js";
import { fakeActor, fakeItem } from "./__helpers__/factories.js";

// The pre-create and pre-update hooks that keep documents in a shape the
// rest of the system relies on: a Hero has at most `themeLimit` themes and
// one backpack, a Fellowship one Fellowship theme, a story-theme actor one
// story theme, and theme tags sit on themes only. A handler refuses a write
// by returning false, as Foundry reads it.

/** Run every handler registered for `name`; false when any refuses. */
const allows = (name, ...args) =>
	Hooks.on.mock.calls
		.filter(([hook]) => hook === name)
		.map(([, fn]) => fn(...args))
		.every((result) => result !== false);

const theme = ({ isFellowship = false, id } = {}) => {
	const item = fakeItem({ type: "theme", ...(id ? { id } : {}) });
	item.system = { isFellowship };
	return item;
};
const backpack = () => fakeItem({ type: "backpack" });

/** An item about to be created on `actor`. */
const creating = (actor, type, system = {}) => ({
	type,
	system,
	parent: actor,
});

beforeEach(() => {
	Hooks.on.mockClear();
	ui.notifications.warn.mockClear();
	// The real one expands dotted keys; the handler only reads `system`.
	foundry.utils.expandObject = (data) => {
		const out = {};
		for (const [key, value] of Object.entries(data))
			foundry.utils.setProperty(out, key, value);
		return out;
	};
	registerActorHooks();
});

afterEach(() => {
	delete CONFIG.litmv2.themeLimit;
});

describe("a Hero's themes and backpack", () => {
	const heroWith = (items) => fakeActor({ type: "hero", items });

	it("takes a theme while it has fewer than four", () => {
		const hero = heroWith([theme(), theme(), theme()]);

		expect(allows("preCreateItem", creating(hero, "theme"), {})).toBe(true);
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("refuses a fifth theme, with a warning", () => {
		const hero = heroWith([theme(), theme(), theme(), theme()]);

		expect(allows("preCreateItem", creating(hero, "theme"), {})).toBe(false);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_theme_limit",
		);
	});

	it("goes by the world's theme limit", () => {
		CONFIG.litmv2.themeLimit = 2;
		const hero = heroWith([theme(), theme()]);

		expect(allows("preCreateItem", creating(hero, "theme"), {})).toBe(false);

		CONFIG.litmv2.themeLimit = 5;
		const fuller = heroWith([theme(), theme(), theme(), theme()]);
		expect(allows("preCreateItem", creating(fuller, "theme"), {})).toBe(true);
	});

	it("does not count a Fellowship theme the Hero carries", () => {
		const hero = heroWith([
			theme(),
			theme(),
			theme(),
			theme({ isFellowship: true }),
		]);

		expect(allows("preCreateItem", creating(hero, "theme"), {})).toBe(true);
	});

	it("takes a Fellowship theme even with four themes of its own", () => {
		const hero = heroWith([theme(), theme(), theme(), theme()]);
		const fellowshipTheme = creating(hero, "theme", { isFellowship: true });

		expect(
			allows("preCreateItem", fellowshipTheme, {
				system: { isFellowship: true },
			}),
		).toBe(true);
	});

	it("refuses a second backpack, with a warning", () => {
		const hero = heroWith([backpack()]);

		expect(allows("preCreateItem", creating(hero, "backpack"), {})).toBe(false);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_backpack_limit",
		);
	});

	it("takes its first backpack, and any item that has no limit", () => {
		const hero = heroWith([theme(), theme(), theme(), theme()]);

		expect(allows("preCreateItem", creating(hero, "backpack"), {})).toBe(true);
		expect(allows("preCreateItem", creating(hero, "story_theme"), {})).toBe(
			true,
		);
	});

	it("puts no limit on a Challenge's or a world item", () => {
		const challenge = fakeActor({
			type: "challenge",
			items: [backpack(), backpack()],
		});

		expect(allows("preCreateItem", creating(challenge, "backpack"), {})).toBe(
			true,
		);
		expect(allows("preCreateItem", creating(null, "theme"), {})).toBe(true);
	});
});

describe("the Fellowship's one Fellowship theme", () => {
	const fellowshipWith = (items) => fakeActor({ type: "fellowship", items });
	const data = { system: { isFellowship: true } };

	it("refuses a second one on create, with a warning", () => {
		const fellowship = fellowshipWith([theme({ isFellowship: true })]);
		const item = creating(fellowship, "theme", { isFellowship: true });

		expect(allows("preCreateItem", item, data)).toBe(false);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_fellowship_limit",
		);
	});

	it("takes the first one, and any theme that is not a Fellowship theme", () => {
		const empty = fellowshipWith([]);
		expect(
			allows(
				"preCreateItem",
				creating(empty, "theme", { isFellowship: true }),
				data,
			),
		).toBe(true);

		const full = fellowshipWith([theme({ isFellowship: true })]);
		expect(
			allows("preCreateItem", creating(full, "theme"), { system: {} }),
		).toBe(true);
	});

	it("refuses turning a second theme into a Fellowship theme", () => {
		const existing = theme({ isFellowship: true, id: "t-1" });
		const plain = theme({ id: "t-2" });
		const fellowship = fellowshipWith([existing, plain]);
		plain.actor = fellowship;

		expect(
			allows("preUpdateItem", plain, { "system.isFellowship": true }),
		).toBe(false);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_fellowship_limit",
		);
	});

	it("lets the only theme become the Fellowship theme", () => {
		const plain = theme({ id: "t-2" });
		const fellowship = fellowshipWith([plain]);
		plain.actor = fellowship;

		expect(
			allows("preUpdateItem", plain, { system: { isFellowship: true } }),
		).toBe(true);
	});

	it("leaves other updates to the Fellowship theme alone", () => {
		const existing = theme({ isFellowship: true, id: "t-1" });
		const other = theme({ isFellowship: true, id: "t-2" });
		const fellowship = fellowshipWith([existing, other]);
		existing.actor = fellowship;

		expect(
			allows("preUpdateItem", existing, { system: { isFellowship: true } }),
		).toBe(true);
		expect(allows("preUpdateItem", existing, { name: "Renamed" })).toBe(true);
	});

	it("does not apply on a Hero", () => {
		const carried = theme({ isFellowship: true, id: "t-1" });
		const plain = theme({ id: "t-2" });
		const hero = fakeActor({ type: "hero", items: [carried, plain] });
		plain.actor = hero;

		expect(
			allows("preUpdateItem", plain, { system: { isFellowship: true } }),
		).toBe(true);
	});
});

describe("a story-theme actor's one story theme", () => {
	const storyActor = (items) => fakeActor({ type: "story_theme", items });

	it("takes its story theme", () => {
		expect(
			allows("preCreateItem", creating(storyActor([]), "story_theme"), {}),
		).toBe(true);
	});

	it("refuses a second one, with a warning", () => {
		const actor = storyActor([fakeItem({ type: "story_theme" })]);

		expect(allows("preCreateItem", creating(actor, "story_theme"), {})).toBe(
			false,
		);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_story_theme_actor_limit",
		);
	});

	it.each(["theme", "backpack", "addon"])(
		"refuses a %s, with a warning",
		(type) => {
			expect(allows("preCreateItem", creating(storyActor([]), type), {})).toBe(
				false,
			);
			expect(ui.notifications.warn).toHaveBeenCalledWith(
				"LITM.Ui.warn_story_theme_actor_item_type",
			);
		},
	);
});

// Power, weakness and fellowship tags belong to a theme. On an actor or a
// backpack nothing reads them as theme tags, and a roll would miss them.
describe("where a theme tag may be created", () => {
	const on = (type, parent) => ({ type, parent });
	const item = (type) => ({ documentName: "Item", type });
	const actor = { documentName: "Actor", type: "hero" };

	it.each(["power_tag", "weakness_tag", "fellowship_tag"])(
		"takes a %s on a theme and on a story theme",
		(type) => {
			expect(allows("preCreateActiveEffect", on(type, item("theme")))).toBe(
				true,
			);
			expect(
				allows("preCreateActiveEffect", on(type, item("story_theme"))),
			).toBe(true);
		},
	);

	it.each(["power_tag", "weakness_tag", "fellowship_tag"])(
		"refuses a %s on an actor, with a warning",
		(type) => {
			expect(allows("preCreateActiveEffect", on(type, actor))).toBe(false);
			expect(ui.notifications.warn).toHaveBeenCalledWith(
				"LITM.Ui.warn_invalid_effect_target",
				{ localize: true },
			);
		},
	);

	it("refuses one on an item that is not a theme", () => {
		expect(
			allows("preCreateActiveEffect", on("power_tag", item("backpack"))),
		).toBe(false);
		expect(
			allows("preCreateActiveEffect", on("weakness_tag", item("addon"))),
		).toBe(false);
	});

	// "story_theme" is an actor type too; the tag belongs on its item.
	it("refuses one on a story-theme actor, which only shares the item's type name", () => {
		const storyActor = { documentName: "Actor", type: "story_theme" };

		expect(allows("preCreateActiveEffect", on("power_tag", storyActor))).toBe(
			false,
		);
	});

	it("takes one that has no parent, as in a compendium", () => {
		expect(allows("preCreateActiveEffect", on("power_tag", null))).toBe(true);
	});

	it.each(["story_tag", "status_tag", "relationship_tag"])(
		"takes a %s anywhere",
		(type) => {
			expect(allows("preCreateActiveEffect", on(type, actor))).toBe(true);
			expect(allows("preCreateActiveEffect", on(type, item("backpack")))).toBe(
				true,
			);
			expect(ui.notifications.warn).not.toHaveBeenCalled();
		},
	);
});
