import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../modules/system/migrations/001-legacy-effects.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Migration 001 turns the legacy-relationships stash into relationship_tag
// effects, then unsets the legacy source data. It must never unset
// `system.relationships` while the only copy of that data is still unmigrated.

const stash = () => [
	{ tag: "owes me", actorId: "abc", isScratched: false },
	{ tag: "sworn rival", actorId: "def", isScratched: true },
];

const heroWith = ({ flag, effects = [] } = {}) => {
	const actor = fakeActor({ type: "hero", effects });
	actor.documentName = "Actor";
	actor.isToken = false;
	actor.getFlag = vi.fn((scope, key) =>
		scope === "litmv2" && key === "legacyRelationships" ? flag : undefined,
	);
	return actor;
};

let AE;
let doc;

const run = async (actors) => {
	game.actors = actors;
	game.items = [];
	game.scenes = [];
	await migrate();
};

beforeEach(() => {
	vi.clearAllMocks();
	AE = {
		createDocuments: vi.fn().mockResolvedValue([]),
		updateDocuments: vi.fn().mockResolvedValue([]),
	};
	CONFIG.ActiveEffect.documentClass = AE;
	doc = { update: vi.fn().mockResolvedValue(undefined) };
	foundry.utils.fromUuid.mockResolvedValue(doc);
});

describe("migration 001: hero relationships", () => {
	it("creates the effects from the stash, then unsets the stash and the legacy field", async () => {
		const hero = heroWith({ flag: stash() });

		await run([hero]);

		expect(AE.createDocuments).toHaveBeenCalledOnce();
		const [created, ctx] = AE.createDocuments.mock.calls[0];
		expect(ctx).toEqual({ parentUuid: hero.uuid });
		expect(created.map((e) => e.name)).toEqual(["owes me", "sworn rival"]);

		const [update] = doc.update.mock.calls[0];
		expect(update.flags.litmv2).toHaveProperty("legacyRelationships");
		expect(update.system).toHaveProperty("relationships");
	});

	it("leaves system.relationships alone when no stash exists to migrate from", async () => {
		const hero = heroWith({ flag: undefined });

		await run([hero]);

		expect(AE.createDocuments).not.toHaveBeenCalled();
		expect(doc.update).not.toHaveBeenCalled();
	});

	it("still clears the legacy field once relationship effects already exist", async () => {
		const hero = heroWith({
			flag: undefined,
			effects: [fakeEffect({ type: "relationship_tag" })],
		});

		await run([hero]);

		expect(AE.createDocuments).not.toHaveBeenCalled();
		const [update] = doc.update.mock.calls[0];
		expect(update.system).toHaveProperty("relationships");
	});
});

// Phase 2 creates, Phase 3 unsets the legacy source data. A create that fails
// leaves the legacy data as the only copy, so Phase 3 must skip that parent.
describe("migration 001: a failed create keeps its legacy data", () => {
	const docs = {};

	const themeWith = ({ id }) => {
		const item = fakeItem({ id, type: "theme" });
		item.documentName = "Item";
		item.system = {};
		item.getFlag = vi.fn((scope, key) =>
			scope === "litmv2" && key === "legacyTags"
				? { powerTags: [{ name: "Sword", isActive: true }] }
				: undefined,
		);
		return item;
	};

	const rejectCreatesFor = (parentUuid) => {
		AE.createDocuments.mockImplementation(async (_data, ctx) => {
			if (ctx.parentUuid === parentUuid) throw new Error("create failed");
			return [];
		});
	};

	beforeEach(() => {
		for (const k of Object.keys(docs)) delete docs[k];
		foundry.utils.fromUuid.mockImplementation(async (uuid) => {
			docs[uuid] ??= { update: vi.fn().mockResolvedValue(undefined) };
			return docs[uuid];
		});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("keeps the stash and legacy field of a hero whose create failed, and cleans the rest", async () => {
		const failing = heroWith({ flag: stash() });
		const healthy = heroWith({ flag: stash() });
		rejectCreatesFor(failing.uuid);

		await run([failing, healthy]);

		expect(docs[failing.uuid]).toBeUndefined();
		expect(docs[healthy.uuid].update).toHaveBeenCalledOnce();
	});

	it("keeps the legacy tags of a theme whose create failed", async () => {
		const failing = themeWith({ id: "t-fail" });
		const healthy = themeWith({ id: "t-ok" });
		rejectCreatesFor(failing.uuid);
		game.actors = [];
		game.items = [failing, healthy];
		game.scenes = [];

		await migrate();

		expect(docs[failing.uuid]).toBeUndefined();
		const [update] = docs[healthy.uuid].update.mock.calls[0];
		expect(update.flags.litmv2).toHaveProperty("legacyTags");
	});
});
