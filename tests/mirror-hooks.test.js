import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerActorHooks } from "../modules/system/hooks/actor-hooks.js";
import { registerItemHooks } from "../modules/system/hooks/item-hooks.js";
import { fakeActor, fakeItem } from "./__helpers__/factories.js";

// The mirror-sync hooks (title tag, story theme item <-> actor, addon effects)
// fire on every connected client, but the write they perform must happen once:
// on the client of the user who made the change. A non-owner's write would be
// refused, and on the Fellowship (OWNER for everyone) every client would write
// at once — addon resync deletes then recreates, so concurrent runs duplicate.
//
// Foundry dispatches `update*(doc, changes, options, userId)` and
// `delete*(doc, options, userId)`; every call below uses that real arity so a
// handler that reads `userId` from the wrong slot fails here.

const ME = "user-me";
const OTHER = "user-other";

const handlersFor = (name) =>
	Hooks.on.mock.calls.filter(([hook]) => hook === name).map(([, fn]) => fn);

const callAll = (name, ...args) => {
	for (const fn of handlersFor(name)) fn(...args);
};

beforeEach(() => {
	Hooks.on.mockClear();
	game.userId = ME;
	registerItemHooks();
	registerActorHooks();
});

// vitest 2 has no toHaveBeenCalledExactlyOnceWith.
const calledOnceWith = (spy, ...args) => {
	expect(spy).toHaveBeenCalledTimes(1);
	expect(spy).toHaveBeenCalledWith(...args);
};

const asEffect = (overrides = {}) => ({
	id: "tag-1",
	update: vi.fn().mockResolvedValue(undefined),
	getFlag: vi.fn(() => null),
	...overrides,
});

describe("_syncTitleTagOnRename (updateItem)", () => {
	const build = () => {
		const titleTag = asEffect({ name: "Old" });
		const item = fakeItem({ type: "theme", name: "Old" });
		item.system = { themeTag: titleTag };
		return { item, titleTag };
	};

	it("renames the title tag on the client of the user who renamed the item", () => {
		const { item, titleTag } = build();
		callAll("updateItem", item, { name: "New" }, {}, ME);
		calledOnceWith(titleTag.update, { name: "New" });
	});

	it("does nothing on any other client", () => {
		const { item, titleTag } = build();
		callAll("updateItem", item, { name: "New" }, {}, OTHER);
		expect(titleTag.update).not.toHaveBeenCalled();
	});
});

describe("_syncStoryThemeItemToActor (updateItem)", () => {
	const build = () => {
		const actor = fakeActor({ type: "story_theme", name: "Old" });
		const item = fakeItem({ type: "story_theme", name: "Old" });
		item.parent = actor;
		item.system = { themeTag: null };
		return { item, actor };
	};

	it("mirrors name and image to the actor on the changer's client", () => {
		const { item, actor } = build();
		callAll("updateItem", item, { name: "New", img: "new.webp" }, {}, ME);
		calledOnceWith(actor.update, {
			name: "New",
			img: "new.webp",
		});
	});

	it("does nothing on any other client", () => {
		const { item, actor } = build();
		callAll("updateItem", item, { name: "New" }, {}, OTHER);
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("_syncAddonEffectsOnUpdate (updateItem)", () => {
	const build = () => {
		const stale = asEffect({ id: "stale", getFlag: vi.fn(() => "addon-1") });
		const actor = fakeActor({ type: "challenge", effects: [stale] });
		const addon = fakeItem({ id: "addon-1", type: "addon" });
		addon.parent = actor;
		addon.system = { tags: "[Fog]" };
		actor.documentName = "Actor";
		return { addon, actor };
	};

	it("resyncs addon effects once, on the changer's client", async () => {
		const { addon, actor } = build();
		callAll("updateItem", addon, { system: { tags: "[Fog]" } }, {}, ME);
		await vi.waitFor(() =>
			expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1),
		);
		calledOnceWith(actor.deleteEmbeddedDocuments, "ActiveEffect", ["stale"]);
	});

	it("does nothing on any other client", async () => {
		const { addon, actor } = build();
		callAll("updateItem", addon, { system: { tags: "[Fog]" } }, {}, OTHER);
		await Promise.resolve();
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("_cleanupAddonEffectsOnDelete (deleteItem)", () => {
	const build = () => {
		const synced = asEffect({ id: "synced", getFlag: vi.fn(() => "addon-1") });
		const actor = fakeActor({ type: "challenge", effects: [synced] });
		actor.documentName = "Actor";
		const addon = fakeItem({ id: "addon-1", type: "addon" });
		addon.parent = actor;
		return { addon, actor };
	};

	it("removes the addon's synced effects on the deleter's client", async () => {
		const { addon, actor } = build();
		callAll("deleteItem", addon, {}, ME);
		await vi.waitFor(() =>
			calledOnceWith(actor.deleteEmbeddedDocuments, "ActiveEffect", ["synced"]),
		);
	});

	it("does nothing on any other client", async () => {
		const { addon, actor } = build();
		callAll("deleteItem", addon, {}, OTHER);
		await Promise.resolve();
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("_syncStoryThemeActorToItem (updateActor)", () => {
	const build = () => {
		const theme = fakeItem({ type: "story_theme", name: "Old" });
		const actor = fakeActor({ type: "story_theme", name: "Old" });
		actor.system = { storyTheme: theme };
		return { actor, theme };
	};

	it("mirrors name and image to the embedded item on the changer's client", () => {
		const { actor, theme } = build();
		callAll("updateActor", actor, { name: "New", img: "new.webp" }, {}, ME);
		calledOnceWith(theme.update, {
			name: "New",
			img: "new.webp",
		});
	});

	it("does nothing on any other client", () => {
		const { actor, theme } = build();
		callAll("updateActor", actor, { name: "New" }, {}, OTHER);
		expect(theme.update).not.toHaveBeenCalled();
	});
});
