import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmActor } from "../modules/actor/litm-actor.js";
import { LitmItem } from "../modules/item/litm-item.js";
import { registerActorHooks } from "../modules/system/hooks/actor-hooks.js";
import { fakeActor, fakeItem } from "./__helpers__/factories.js";

// Sidebar "Import Data" on an existing document is `update(data, {noHook: true})`
// (client-document.mjs importFromJSON). That skips createActor / createItem, so
// the stash `migrateData` writes into `flags.litmv2` is never consumed. The
// overrides below run the consumer after Foundry's own import has landed.

const relationships = () => [
	{ tag: "owes me", actorId: "abc", isScratched: false },
];
const themeLegacy = () => ({
	powerTags: [{ name: "Sword", isActive: true }],
	weaknessTags: [],
	isFellowship: false,
});

// A fake document whose flags can be changed after construction, the way
// Foundry's update changes them under a running `import`.
function withFlags(doc, flags = {}) {
	doc.flags = { litmv2: flags };
	doc.getFlag = vi.fn((scope, key) => doc.flags[scope]?.[key]);
	return doc;
}

const theme = (flags) => {
	const item = withFlags(fakeItem({ type: "theme" }), flags);
	item.system = {};
	return item;
};

const backpack = (flags) => {
	const item = withFlags(fakeItem({ type: "backpack" }), flags);
	item.system = {};
	return item;
};

// The base-class importFromJSON is Foundry's. The stub document classes have
// none, so install one that applies `landed` to the document, as the real
// update would before it resolves.
function stubFoundryImport(BaseProto, landed) {
	BaseProto.importFromJSON = vi.fn(async function () {
		landed(this);
		return this;
	});
}

describe("LitmActor#importFromJSON", () => {
	const BaseProto = foundry.documents.Actor.prototype;

	afterEach(() => {
		delete BaseProto.importFromJSON;
	});

	it("creates relationship effects from the stash the import just wrote, then clears it", async () => {
		const hero = withFlags(fakeActor({ type: "hero" }));
		const order = [];
		stubFoundryImport(BaseProto, (doc) => {
			order.push("import");
			doc.flags.litmv2.legacyRelationships = relationships();
		});
		hero.createEmbeddedDocuments.mockImplementation(async () => {
			order.push("effects");
			return [];
		});

		const out = await LitmActor.prototype.importFromJSON.call(hero, "{}");

		expect(order).toEqual(["import", "effects"]);
		expect(hero.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{
				name: "owes me",
				type: "relationship_tag",
				system: { targetId: "abc", isScratched: false },
			},
		]);
		const [update] = hero.update.mock.calls[0];
		expect(update.flags.litmv2).toHaveProperty("legacyRelationships");
		expect(update.system).toHaveProperty("relationships");
		expect(out).toBe(hero);
	});

	it("converts the legacy theme and backpack items the import brought along", async () => {
		const legacyTheme = theme();
		const legacyPack = backpack();
		const hero = withFlags(
			fakeActor({ type: "hero", items: [legacyTheme, legacyPack] }),
		);
		stubFoundryImport(BaseProto, () => {
			legacyTheme.flags.litmv2.legacyTags = themeLegacy();
			legacyPack.flags.litmv2.legacyContents = [
				{ name: "Rope", isActive: true },
			];
		});

		await LitmActor.prototype.importFromJSON.call(hero, "{}");

		const [, themeEffects] = legacyTheme.createEmbeddedDocuments.mock.calls[0];
		expect(themeEffects.map((e) => e.name)).toContain("Sword");
		const [, packEffects] = legacyPack.createEmbeddedDocuments.mock.calls[0];
		expect(packEffects.map((e) => e.name)).toEqual(["Rope"]);
	});

	it("does nothing extra when the imported data carries no legacy stash", async () => {
		const hero = withFlags(fakeActor({ type: "hero", items: [theme()] }));
		stubFoundryImport(BaseProto, () => {});

		await LitmActor.prototype.importFromJSON.call(hero, "{}");

		expect(hero.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(hero.update).not.toHaveBeenCalled();
		expect(hero.items[0].createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("does not consume anything when Foundry's import throws", async () => {
		const hero = withFlags(fakeActor({ type: "hero" }));
		hero.flags.litmv2.legacyRelationships = relationships();
		BaseProto.importFromJSON = vi.fn().mockRejectedValue(new Error("bad json"));

		await expect(
			LitmActor.prototype.importFromJSON.call(hero, "nope"),
		).rejects.toThrow("bad json");
		expect(hero.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("LitmItem#importFromJSON", () => {
	const BaseProto = foundry.documents.Item.prototype;

	afterEach(() => {
		delete BaseProto.importFromJSON;
	});

	it("converts a legacy theme the import just wrote, then clears the stash", async () => {
		const item = theme();
		stubFoundryImport(BaseProto, (doc) => {
			doc.flags.litmv2.legacyTags = themeLegacy();
		});

		const out = await LitmItem.prototype.importFromJSON.call(item, "{}");

		const [type, effects] = item.createEmbeddedDocuments.mock.calls[0];
		expect(type).toBe("ActiveEffect");
		expect(effects.map((e) => e.name)).toContain("Sword");
		const [update] = item.update.mock.calls[0];
		expect(update.flags.litmv2).toHaveProperty("legacyTags");
		expect(out).toBe(item);
	});

	it("converts a legacy backpack the import just wrote", async () => {
		const item = backpack();
		stubFoundryImport(BaseProto, (doc) => {
			doc.flags.litmv2.legacyContents = [{ name: "Rope", isActive: true }];
		});

		await LitmItem.prototype.importFromJSON.call(item, "{}");

		const [, effects] = item.createEmbeddedDocuments.mock.calls[0];
		expect(effects.map((e) => e.name)).toEqual(["Rope"]);
	});

	it("does nothing extra when the imported data carries no legacy stash", async () => {
		const item = theme();
		stubFoundryImport(BaseProto, () => {});

		await LitmItem.prototype.importFromJSON.call(item, "{}");

		expect(item.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(item.update).not.toHaveBeenCalled();
	});
});

// A plain create already consumes the stash; the import override must not be
// the only consumer, and the create path must keep working after the extract.
describe("createActor hook", () => {
	// Several modules listen on createActor; run them all, as Foundry would.
	const handler = () => {
		Hooks.on.mockClear();
		registerActorHooks();
		const handlers = Hooks.on.mock.calls
			.filter(([name]) => name === "createActor")
			.map(([, fn]) => fn);
		return (...args) => Promise.all(handlers.map((fn) => fn(...args)));
	};

	beforeEach(() => {
		game.userId = "user-1";
	});

	it("still consumes the stash for the creating user", async () => {
		const hero = withFlags(fakeActor({ type: "hero" }), {
			legacyRelationships: relationships(),
		});

		await handler()(hero, {}, "user-1");

		expect(hero.createEmbeddedDocuments).toHaveBeenCalledOnce();
	});

	it("leaves it to the creating user on every other client", async () => {
		const hero = withFlags(fakeActor({ type: "hero" }), {
			legacyRelationships: relationships(),
		});

		await handler()(hero, {}, "someone-else");

		expect(hero.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
