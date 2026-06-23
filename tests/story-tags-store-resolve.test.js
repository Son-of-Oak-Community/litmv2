import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";

describe("StoryTagsStore.resolveTrackedActors", () => {
	beforeEach(() => {
		// Pass UUIDs through normalizeConfig unchanged (parseUuid → truthy collection + type:"Actor"
		// so toValidUuid hits the default branch and keeps the UUID as-is).
		foundry.utils.parseUuid = () => ({ collection: {}, type: "Actor" });
		game.user = { isGM: false };
		game.users = [];
		game.litmv2 = {};
		game.settings.get = vi.fn(() => ({
			actors: ["Actor.aaa", "Scene.sss.Token.ttt"],
			limits: [],
		}));
		StoryTagsStore.invalidateCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("resolves plain actor UUIDs and maps token UUIDs to their actor", () => {
		const plain = { type: "challenge", name: "Wolves", documentName: "Actor" };
		const tokenActor = {
			type: "challenge",
			name: "Bandits",
			documentName: "Actor",
		};
		const tokenDoc = { documentName: "Token", name: "Tok", actor: tokenActor };
		foundry.utils.fromUuidSync = (uuid) =>
			uuid.startsWith("Scene") ? tokenDoc : plain;

		const resolved = StoryTagsStore.resolveTrackedActors();
		const actors = resolved.map((t) => t.actor);
		expect(actors).toContain(plain);
		expect(actors).toContain(tokenActor); // token resolved to its actor, not dropped
		const tokenTriple = resolved.find((t) => t.uuid === "Scene.sss.Token.ttt");
		expect(tokenTriple.tokenDoc).toBe(tokenDoc);
	});

	it("drops UUIDs that resolve to nothing", () => {
		foundry.utils.fromUuidSync = () => null;
		expect(StoryTagsStore.resolveTrackedActors()).toEqual([]);
	});
});
