import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { registerTokenHooks } from "../modules/system/hooks/token-hooks.js";

// token-hooks.js: "A token placed for an actor whose story-tag column is hidden
// arrives hidden. The sidebar's visibility toggle hides tokens already on the
// scene; this covers the ones dragged out afterwards." CLAUDE.md: "Hiding a
// column also hides the actor on the canvas: its tokens on the scene are
// hidden, tokens placed later arrive hidden (`preCreateToken`)".

let config;
let preCreateToken;

const place = (token, data = {}) => {
	const document = {
		actorId: "hidden",
		updateSource: vi.fn(),
		...token,
	};
	preCreateToken(document, data);
	return document;
};

beforeEach(() => {
	config = { actors: ["Actor.hidden"], hiddenActors: ["Actor.hidden"] };
	game.users.filter = () => [];
	game.user.isGM = false;
	game.settings.get.mockImplementation((_scope, key) =>
		key === "storytags" ? config : undefined,
	);
	foundry.utils.parseUuid = (uuid) => ({
		collection: "Actor",
		type: uuid?.startsWith("Actor.") ? "Actor" : null,
	});
	foundry.utils.fromUuidSync.mockImplementation((uuid) =>
		uuid === "Actor.hidden" || uuid === "Actor.shown"
			? { id: uuid.replace("Actor.", ""), documentName: "Actor" }
			: null,
	);
	StoryTagsStore.invalidateCache();

	Hooks.on.mockClear();
	registerTokenHooks();
	preCreateToken = Hooks.on.mock.calls.find(
		([name]) => name === "preCreateToken",
	)?.[1];
});
afterEach(() => {
	StoryTagsStore.invalidateCache();
	game.settings.get.mockReset();
	foundry.utils.fromUuidSync.mockReset();
	delete game.users.filter;
	delete foundry.utils.parseUuid;
});

describe("the preCreateToken hook", () => {
	it("is registered once", () => {
		expect(
			Hooks.on.mock.calls.filter(([name]) => name === "preCreateToken"),
		).toHaveLength(1);
		expect(preCreateToken).toBeTypeOf("function");
	});

	it("hides a token placed for an actor whose column is hidden", () => {
		const token = place({ actorId: "hidden" });
		expect(token.updateSource).toHaveBeenCalledTimes(1);
		expect(token.updateSource).toHaveBeenCalledWith({ hidden: true });
	});

	it("hides it on the Narrator's client too, which is the one that places tokens", () => {
		game.user.isGM = true;
		StoryTagsStore.invalidateCache();
		const token = place({ actorId: "hidden" });
		expect(token.updateSource).toHaveBeenCalledWith({ hidden: true });
	});

	it("hides a token that arrives explicitly shown", () => {
		const token = place({ actorId: "hidden" }, { hidden: false });
		expect(token.updateSource).toHaveBeenCalledWith({ hidden: true });
	});

	it("leaves a token for an actor with a visible column alone", () => {
		config = {
			actors: ["Actor.hidden", "Actor.shown"],
			hiddenActors: ["Actor.hidden"],
		};
		StoryTagsStore.invalidateCache();
		const token = place({ actorId: "shown" });
		expect(token.updateSource).not.toHaveBeenCalled();
	});

	it("leaves a token for an actor the sidebar does not track alone", () => {
		const token = place({ actorId: "stranger" });
		expect(token.updateSource).not.toHaveBeenCalled();
	});

	it("leaves a token already created hidden alone", () => {
		const token = place({ actorId: "hidden" }, { hidden: true });
		expect(token.updateSource).not.toHaveBeenCalled();
	});

	it("leaves a token with no actor alone", () => {
		const token = place({ actorId: null });
		expect(token.updateSource).not.toHaveBeenCalled();
		const unset = place({ actorId: undefined });
		expect(unset.updateSource).not.toHaveBeenCalled();
	});

	it("hides tokens of an actor whose column was removed after being hidden", () => {
		// Concealment outlives the column: removing it is not a reveal.
		config = { actors: [], hiddenActors: ["Actor.hidden"] };
		StoryTagsStore.invalidateCache();
		const token = place({ actorId: "hidden" });
		expect(token.updateSource).toHaveBeenCalledWith({ hidden: true });
	});

	it("stops hiding once the column is revealed", () => {
		config = { actors: ["Actor.hidden"], hiddenActors: [] };
		StoryTagsStore.invalidateCache();
		const token = place({ actorId: "hidden" });
		expect(token.updateSource).not.toHaveBeenCalled();
	});
});
