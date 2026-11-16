import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagSidebar } from "../modules/apps/story-tags/story-tag-sidebar.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { LitmTokenHUD } from "../modules/hud/litm-token-hud.js";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import { setGM, setPlayer } from "./__helpers__/users.js";

// The token HUD is a player-facing surface for statuses and a second way into
// the story-tag sidebar. CLAUDE.md: "A hidden tag or status is never shown to
// the player it is hidden from, on any surface"; "A newly tracked actor's
// column starts from its tokens' state"; and the Narrator's additions to a
// Challenge start hidden (`startsHiddenOn`), to a Hero visible.

const originalUser = game.user;
const originalUsers = game.users;
const originalStatusEffects = CONFIG.statusEffects;

const status = (name, { isHidden = false, tier = 1 } = {}) =>
	fakeEffect({
		name,
		type: "status_tag",
		system: {
			isHidden,
			currentTier: tier,
			tiers: Array.from({ length: 6 }, (_, i) => i + 1 === tier),
		},
	});

/** A HUD bound to `actor`, the way Foundry binds one to the clicked token. */
function hudFor(actor, { tokenHidden = false, controlled = [] } = {}) {
	const hud = new LitmTokenHUD();
	hud.actor = actor;
	hud.document = { hidden: tokenHidden, documentName: "Token" };
	hud.layer = { controlled };
	return hud;
}

const act = (hud, name, { dataset = {}, button = 0 } = {}) => {
	const entry = LitmTokenHUD.DEFAULT_OPTIONS.actions[name];
	const handler = typeof entry === "function" ? entry : entry.handler;
	const target = {
		dataset,
		classList: { toggle: vi.fn() },
		closest: () => null,
	};
	return handler.call(hud, { button }, target);
};

beforeEach(() => {
	vi.clearAllMocks();
	setPlayer();
	game.users = Object.assign([], { activeGM: null, get: vi.fn() });
	game.litmv2 = {};
	CONFIG.statusEffects = [
		{ id: "wounded", name: "Wounded", img: "wounded.svg" },
		{ id: "afraid", name: "Afraid", img: "afraid.svg" },
	];
	vi.spyOn(ContentSources, "getPacks").mockReturnValue([]);
});

afterEach(() => {
	vi.restoreAllMocks();
	delete game.litmv2;
	game.user = originalUser;
	game.users = originalUsers;
	CONFIG.statusEffects = originalStatusEffects;
});

describe("the statuses a token HUD shows", () => {
	function heroWith(...effects) {
		return fakeActor({ type: "hero", effects });
	}

	it("lights the grid icon of a visible status and lists its tier row", async () => {
		const wounded = status("Wounded", { tier: 2 });
		const hud = hudFor(heroWith(wounded));

		const choices = hud._getStatusEffectChoices();
		const { statusRows } = await hud._prepareContext({});

		expect(choices.wounded).toMatchObject({
			isActive: true,
			effectId: wounded.id,
			cssClass: "active",
		});
		expect(choices.afraid).toMatchObject({ isActive: false, cssClass: "" });
		expect(statusRows).toEqual([
			{
				title: "Wounded",
				effectId: wounded.id,
				tiers: [false, true, false, false, false, false],
				currentTier: 2,
				isHidden: false,
			},
		]);
	});

	it("shows a player nothing of a hidden status: no lit icon, no tier row", async () => {
		const hud = hudFor(heroWith(status("Wounded", { isHidden: true })));

		const choices = hud._getStatusEffectChoices();
		const { statusRows } = await hud._prepareContext({});

		expect(choices.wounded.isActive).toBe(false);
		expect(choices.wounded.effectId).toBeUndefined();
		expect(statusRows).toEqual([]);
	});

	it("shows the Narrator a hidden status, marked as hidden", async () => {
		setGM();
		const secret = status("Wounded", { isHidden: true });
		const hud = hudFor(heroWith(secret));

		const choices = hud._getStatusEffectChoices();
		const { statusRows } = await hud._prepareContext({});

		expect(choices.wounded.isActive).toBe(true);
		expect(statusRows).toEqual([
			expect.objectContaining({ effectId: secret.id, isHidden: true }),
		]);
	});

	it("lists a status with no matching icon as a row only", async () => {
		const odd = status("Smells of smoke");
		const hud = hudFor(heroWith(odd));

		const choices = hud._getStatusEffectChoices();
		const { statusRows } = await hud._prepareContext({});

		expect(Object.values(choices).some((c) => c.isActive)).toBe(false);
		expect(statusRows.map((r) => r.title)).toEqual(["Smells of smoke"]);
	});

	it("ignores effects that are not statuses", async () => {
		const tag = fakeEffect({ name: "Wounded", type: "story_tag", system: {} });
		const hud = hudFor(heroWith(tag));

		expect(hud._getStatusEffectChoices().wounded.isActive).toBe(false);
		expect((await hud._prepareContext({})).statusRows).toEqual([]);
	});
});

describe("toggling a status icon on the token HUD", () => {
	function actorWithStatusApi(type, over = {}) {
		const actor = fakeActor({ type, ...over });
		actor.system = {
			addStatus: vi.fn().mockResolvedValue([{}]),
			removeStatus: vi.fn().mockResolvedValue([]),
		};
		return actor;
	}

	it("removes a status that is on, by its effect", async () => {
		const wounded = status("Wounded");
		const actor = actorWithStatusApi("hero", { effects: [wounded] });

		await act(hudFor(actor), "effect", { dataset: { statusId: "wounded" } });

		expect(actor.system.removeStatus).toHaveBeenCalledWith(wounded.id);
		expect(actor.system.addStatus).not.toHaveBeenCalled();
	});

	it("adds one that is off at tier 1, with the icon's art", async () => {
		const actor = actorWithStatusApi("hero");

		await act(hudFor(actor), "effect", { dataset: { statusId: "afraid" } });

		const [name, options] = actor.system.addStatus.mock.calls[0];
		expect(name).toBe("Afraid");
		expect(options.tiers.slice(0, 2)).toEqual([true, false]);
		expect(options.img).toBe("afraid.svg");
	});

	it("does nothing for an icon it does not know", async () => {
		const actor = actorWithStatusApi("hero");

		await act(hudFor(actor), "effect", { dataset: { statusId: "nope" } });

		expect(actor.system.addStatus).not.toHaveBeenCalled();
		expect(actor.system.removeStatus).not.toHaveBeenCalled();
	});
});

describe("the token HUD and the story-tag sidebar", () => {
	let config;
	let world;
	let scene;
	let sidebar;

	function worldActor(id, type) {
		const doc = {
			id,
			_id: id,
			uuid: `Actor.${id}`,
			documentName: "Actor",
			type,
			name: id,
			isOwner: true,
			system: { storyTags: [], statusEffects: [] },
		};
		world.set(doc.uuid, doc);
		return doc;
	}

	beforeEach(() => {
		setGM();
		world = new Map();
		config = { actors: [], hiddenActors: [], limits: [] };
		game.settings.get.mockImplementation((_scope, key) =>
			key === "storytags" ? config : undefined,
		);
		game.settings.set.mockImplementation(async (_scope, key, value) => {
			if (key === "storytags") config = value;
			return value;
		});
		foundry.utils.parseUuid = (uuid) => ({
			collection: "Actor",
			type: uuid?.startsWith("Actor.") ? "Actor" : null,
		});
		foundry.utils.fromUuidSync.mockImplementation(
			(uuid) => world.get(uuid) ?? null,
		);
		scene = {
			tokens: [],
			updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		};
		globalThis.canvas = { ready: true, scene, tokens: { placeables: [] } };
		vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
		StoryTagsStore.invalidateCache();
		sidebar = new StoryTagSidebar();
		sidebar.render = vi.fn();
		game.litmv2 = { storyTags: sidebar };
	});

	afterEach(() => {
		game.settings.get.mockReset();
		game.settings.set.mockReset();
		foundry.utils.fromUuidSync.mockReset();
		delete foundry.utils.parseUuid;
		globalThis.canvas = undefined;
		StoryTagsStore.invalidateCache();
	});

	const token = (doc, hidden) => {
		const t = { id: `tok-${scene.tokens.length}`, actorId: doc.id, hidden };
		scene.tokens.push(t);
		return t;
	};

	describe("adding the token's actor to the sidebar", () => {
		it("starts it visible when its token is in plain sight", async () => {
			const ogre = worldActor("ogre", "challenge");
			token(ogre, false);

			await act(hudFor(ogre), "sidebar");

			expect(config.actors).toEqual(["Actor.ogre"]);
			expect(config.hiddenActors).toEqual([]);
		});

		it("never starts a Hero's column hidden", async () => {
			const hero = worldActor("hero", "hero");
			token(hero, true);

			await act(hudFor(hero, { tokenHidden: true }), "sidebar");

			expect(config.actors).toEqual(["Actor.hero"]);
			expect(config.hiddenActors).toEqual([]);
		});

		it("does not list an actor as hidden twice", async () => {
			const ogre = worldActor("ogre", "challenge");
			token(ogre, true);
			config.hiddenActors = ["Actor.ogre"];

			await act(hudFor(ogre, { tokenHidden: true }), "sidebar");

			expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		});
	});

	it("removes the column without revealing the actor", async () => {
		const ogre = worldActor("ogre", "challenge");
		config = {
			actors: ["Actor.ogre", "Actor.wolf"],
			hiddenActors: ["Actor.ogre"],
			limits: [],
		};
		StoryTagsStore.invalidateCache();

		await act(hudFor(ogre), "sidebar");

		expect(config.actors).toEqual(["Actor.wolf"]);
		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
	});

	it("leaves the Fellowship and an active player's character where they are", async () => {
		const fellowship = worldActor("fellowship", "fellowship");
		const hero = worldActor("hero", "hero");
		game.litmv2.fellowship = fellowship;
		game.users.push({ active: true, character: hero });

		await act(hudFor(fellowship), "sidebar");
		await act(hudFor(hero), "sidebar");

		expect(game.settings.set).not.toHaveBeenCalled();
	});

	describe("the HUD's visibility button", () => {
		it("hides the controlled tokens and the actor's column with them", async () => {
			const ogre = worldActor("ogre", "challenge");
			const t = token(ogre, false);
			config.actors = ["Actor.ogre"];

			await act(hudFor(ogre, { controlled: [{ id: t.id }] }), "visibility");

			expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [
				{ _id: t.id, hidden: true },
			]);
			expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		});

		it("reveals the column when the token is shown again", async () => {
			const ogre = worldActor("ogre", "challenge");
			const t = token(ogre, true);
			config = {
				actors: ["Actor.ogre"],
				hiddenActors: ["Actor.ogre"],
				limits: [],
			};

			await act(
				hudFor(ogre, { tokenHidden: true, controlled: [{ id: t.id }] }),
				"visibility",
			);

			expect(config.hiddenActors).toEqual([]);
		});

		it("leaves the hidden list alone when it already agrees with the token", async () => {
			const ogre = worldActor("ogre", "challenge");
			const t = token(ogre, false);
			config = {
				actors: ["Actor.ogre"],
				hiddenActors: ["Actor.ogre"],
				limits: [],
			};

			await act(hudFor(ogre, { controlled: [{ id: t.id }] }), "visibility");

			expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		});

		it("hides a player character's token without touching the sidebar", async () => {
			const hero = worldActor("hero", "hero");
			const t = token(hero, false);
			game.users.push({ active: true, character: hero });

			await act(hudFor(hero, { controlled: [{ id: t.id }] }), "visibility");

			expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [
				{ _id: t.id, hidden: true },
			]);
			expect(game.settings.set).not.toHaveBeenCalled();
		});
	});
});
