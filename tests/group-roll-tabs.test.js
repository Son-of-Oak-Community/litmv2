import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGroupRollTabs } from "../modules/apps/roll/roll-dialog-context.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";

// Acting Together (Core Book p.157), roll-dialog-context.js: "One tab per
// participating Hero, one for the Fellowship whose theme power tags 'any or all'
// of may be invoked, and the shared Story tab. Deliberately not the sidebar's
// actor list... A participant who does not own the roll sees their own Hero's
// tags in full — that is their one contribution to make — and everyone else's
// as selected-only rows." And: a client with no Hero in the roll "is not in the
// roll, so it gets nothing — the Fellowship included".

const FELLOWSHIP = "fellowship";

let actors;
let selections;
let tracked;
let viewer = { isGM: false, owns: new Set() };

// The id differs from the actor's: a tag whose parent is the actor itself
// is grouped by tag type, not by theme.
const theme = (id) => ({
	id: `th-${id}`,
	name: `Theme ${id}`,
	img: `${id}.webp`,
});
const effect = (id, parent, { isHidden = false } = {}) => ({
	_id: id,
	id,
	uuid: `Actor.owner.Item.${parent.id}.ActiveEffect.${id}`,
	name: `Tag ${id}`,
	type: "power_tag",
	system: { isHidden },
	active: true,
	parent,
});
const actor = (id, type, effects, { system = {} } = {}) => {
	const doc = {
		id,
		uuid: `Actor.${id}`,
		name: `Name ${id}`,
		type,
		img: `${id}.webp`,
		isOwner: false,
		prototypeToken: { texture: { src: "" } },
		appliedEffects: effects,
		system: { storyTags: [], statusEffects: [], ...system },
		testUserPermission: (_user, level) =>
			level === "OWNER" && (viewer.isGM || viewer.owns.has(id)),
	};
	actors.set(id, doc);
	return doc;
};

/** A dialog stand-in with only what the tab builder reads. */
const dialogFor = (participantIds, { tabGroups = {} } = {}) => ({
	actorId: FELLOWSHIP,
	actor: actors.get(FELLOWSHIP),
	participantIds,
	isGroupRoll: true,
	tabGroups,
	getSelection: (uuid) => ({
		state: selections.get(uuid) ?? "",
		contributorId: null,
	}),
});
const sharedFor = ({ isOwner, sceneStoryItems = [] }) => ({
	decorateTag: (tag) => ({ ...tag, key: tag.uuid }),
	tagTypeOrder: {},
	allStoryItems: [],
	sceneStoryItems,
	isOwner,
});
const asUser = ({ isGM = false, owns = [] }) => {
	game.user = { id: "viewer", isGM, character: null };
	viewer = { isGM, owns: new Set(owns) };
};
const names = (tab) => tab.groups.flatMap((g) => g.tags.map((t) => t.name));
const ids = (tabs) => tabs.map((tab) => tab.id);

let h1;
beforeEach(() => {
	actors = new Map();
	selections = new Map();
	tracked = [];
	game.actors.get.mockImplementation((id) => actors.get(id) ?? null);
	game.users.filter = () => [];
	foundry.utils.parseUuid = (uuid) => ({
		collection: "Actor",
		type: uuid?.startsWith("Actor.") ? "Actor" : null,
	});
	foundry.utils.fromUuidSync.mockImplementation((uuid) => {
		const id = uuid?.replace(/^Actor\./, "");
		return tracked.includes(id) ? actors.get(id) : null;
	});
	game.settings.get.mockImplementation((_scope, key) =>
		key === "storytags"
			? { actors: tracked.map((id) => `Actor.${id}`), limits: [] }
			: undefined,
	);
	StoryTagsStore.invalidateCache();

	actor(FELLOWSHIP, "fellowship", [
		effect("f1", theme("fel")),
		effect("f2", theme("fel")),
	]);
	h1 = actor("h1", "hero", [
		effect("a1", theme("h1")),
		effect("a2", theme("h1")),
	]);
	actor("h2", "hero", [effect("b1", theme("h2")), effect("b2", theme("h2"))]);
});
afterEach(() => {
	StoryTagsStore.invalidateCache();
	game.actors.get.mockReset();
	game.settings.get.mockReset();
	foundry.utils.fromUuidSync.mockReset();
	delete game.users.filter;
	delete foundry.utils.parseUuid;
});

describe("buildGroupRollTabs for the Narrator who owns the roll", () => {
	beforeEach(() => asUser({ isGM: true }));
	const build = (participantIds, shared = {}) =>
		buildGroupRollTabs(
			dialogFor(participantIds),
			sharedFor({ isOwner: true, ...shared }),
		);

	it("leads with the Fellowship that rolls, then the Heroes in the roll's order", () => {
		expect(ids(build(["h2", "h1"]))).toEqual([FELLOWSHIP, "h2", "h1"]);
	});

	it("puts the Story tab between the Fellowship and the Heroes", () => {
		const sceneStoryItems = [{ uuid: "scene-1", name: "Rain", state: "" }];
		expect(ids(build(["h1", "h2"], { sceneStoryItems }))).toEqual([
			FELLOWSHIP,
			"__story",
			"h1",
			"h2",
		]);
	});

	it("lists every tag of every Hero in the roll, selected or not", () => {
		const tabs = build(["h1", "h2"]);
		expect(names(tabs.find((tab) => tab.id === "h1"))).toEqual([
			"Tag a1",
			"Tag a2",
		]);
		expect(names(tabs.find((tab) => tab.id === "h2"))).toEqual([
			"Tag b1",
			"Tag b2",
		]);
		expect(names(tabs.find((tab) => tab.id === FELLOWSHIP))).toEqual([
			"Tag f1",
			"Tag f2",
		]);
	});

	it("labels a tab with the actor and gives it the token art, else the portrait", () => {
		h1.prototypeToken.texture.src = "token-h1.webp";
		const tabs = build(["h1", "h2"]);
		expect(tabs.find((tab) => tab.id === "h1")).toMatchObject({
			label: "Name h1",
			actorImg: "token-h1.webp",
		});
		expect(tabs.find((tab) => tab.id === "h2")).toMatchObject({
			label: "Name h2",
			actorImg: "h2.webp",
		});
	});

	it("tells every tag whose it is, which the one-tag-per-Hero cap reads", () => {
		const tabs = build(["h1"]);
		const tagActorIds = tabs
			.find((tab) => tab.id === "h1")
			.groups.flatMap((g) => g.tags.map((t) => t.tagActorId));
		expect(tagActorIds).toEqual(["h1", "h1"]);
	});

	it("carries each tag's current selection into the tab", () => {
		selections.set(effect("a1", theme("h1")).uuid, "positive");
		const tab = build(["h1"]).find((t) => t.id === "h1");
		expect(tab.groups[0].tags.map((t) => t.state)).toEqual(["positive", ""]);
	});

	it("skips a Hero with nothing to invoke and a participant the world does not know", () => {
		actor("h3", "hero", []);
		expect(ids(build(["h1", "h3", "ghost"]))).toEqual([FELLOWSHIP, "h1"]);
	});

	it("does not list the Fellowship twice when the roll names it as a participant", () => {
		expect(ids(build([FELLOWSHIP, "h1"]))).toEqual([FELLOWSHIP, "h1"]);
	});

	it("follows the roll's Heroes, not the sidebar's tracked actors", () => {
		tracked = ["h2"];
		// h1 is in the roll but not tracked; h2 is tracked but not in the roll.
		expect(ids(build(["h1"]))).toEqual([FELLOWSHIP, "h1"]);
	});
});

describe("buildGroupRollTabs for a participant who does not own the roll", () => {
	beforeEach(() => asUser({ owns: ["h1"] }));
	const build = (participantIds, shared = {}) =>
		buildGroupRollTabs(
			dialogFor(participantIds),
			sharedFor({ isOwner: false, ...shared }),
		);

	it("gives them their own Hero's tags in full", () => {
		const tabs = build(["h1", "h2"]);
		expect(names(tabs.find((tab) => tab.id === "h1"))).toEqual([
			"Tag a1",
			"Tag a2",
		]);
	});

	it("gives them the Fellowship's tags in full, though they own no part of it", () => {
		const tabs = build(["h1", "h2"]);
		expect(names(tabs.find((tab) => tab.id === FELLOWSHIP))).toEqual([
			"Tag f1",
			"Tag f2",
		]);
	});

	it("shows another Hero's tab as selected-only, and not at all when nothing is selected", () => {
		expect(ids(build(["h1", "h2"]))).toEqual([FELLOWSHIP, "h1"]);

		selections.set(effect("b2", theme("h2")).uuid, "positive");
		const tabs = build(["h1", "h2"]);
		expect(ids(tabs)).toEqual([FELLOWSHIP, "h1", "h2"]);
		expect(names(tabs.find((tab) => tab.id === "h2"))).toEqual(["Tag b2"]);
	});

	it("lists their own Hero ahead of the others, after the Fellowship and the Story", () => {
		selections.set(effect("b1", theme("h2")).uuid, "positive");
		const sceneStoryItems = [
			{ uuid: "scene-1", name: "Rain", state: "positive" },
		];
		expect(ids(build(["h2", "h1"], { sceneStoryItems }))).toEqual([
			FELLOWSHIP,
			"__story",
			"h1",
			"h2",
		]);
	});

	it("shows only the scene's selected tags on the Story tab, and no tab when none is", () => {
		const sceneStoryItems = [
			{ uuid: "scene-1", name: "Rain", state: "" },
			{ uuid: "scene-2", name: "Dusk", state: "negative" },
		];
		const story = build(["h1"], { sceneStoryItems }).find(
			(tab) => tab.id === "__story",
		);
		expect(story.groups[0].tags.map((t) => t.name)).toEqual(["Dusk"]);

		const quiet = [{ uuid: "scene-1", name: "Rain", state: "" }];
		expect(ids(build(["h1"], { sceneStoryItems: quiet }))).not.toContain(
			"__story",
		);
	});

	it("does not offer them a tag hidden from players", () => {
		h1.appliedEffects.push(effect("a3", theme("h1"), { isHidden: true }));
		const tab = build(["h1"]).find((t) => t.id === "h1");
		expect(names(tab)).toEqual(["Tag a1", "Tag a2"]);
	});

	it("offers the Narrator that same hidden tag", () => {
		asUser({ isGM: true });
		h1.appliedEffects.push(effect("a3", theme("h1"), { isHidden: true }));
		const tab = buildGroupRollTabs(
			dialogFor(["h1"]),
			sharedFor({ isOwner: true }),
		).find((t) => t.id === "h1");
		expect(names(tab)).toContain("Tag a3");
	});
});

describe("buildGroupRollTabs for a spectator with no Hero in the roll", () => {
	beforeEach(() => asUser({ owns: ["h9"] }));
	const build = (participantIds, shared = {}) =>
		buildGroupRollTabs(
			dialogFor(participantIds),
			sharedFor({ isOwner: false, ...shared }),
		);

	it("has nothing to pick from, the Fellowship included, while nothing is selected", () => {
		expect(build(["h1", "h2"])).toEqual([]);
	});

	it("reads only what has been selected, on every tab", () => {
		selections.set(effect("f2", theme("fel")).uuid, "positive");
		selections.set(effect("a1", theme("h1")).uuid, "positive");
		const tabs = build(["h1", "h2"]);
		expect(ids(tabs)).toEqual([FELLOWSHIP, "h1"]);
		expect(names(tabs[0])).toEqual(["Tag f2"]);
		expect(names(tabs[1])).toEqual(["Tag a1"]);
	});
});

describe("buildGroupRollTabs: the Story tab's opposition", () => {
	const foe = (extra = {}) =>
		actor(
			"foe",
			"challenge",
			[effect("c1", theme("foe")), effect("c2", theme("foe"))],
			{
				system: { maskedName: "Something in the dark", ...extra },
			},
		);

	it("adds the tracked opposition to the Story tab, under its masked name", () => {
		asUser({ isGM: true });
		foe();
		tracked = ["foe"];
		const story = buildGroupRollTabs(
			dialogFor(["h1"]),
			sharedFor({ isOwner: true }),
		).find((tab) => tab.id === "__story");
		expect(story.groups.map((g) => g.themeName)).toEqual([
			"Something in the dark — Theme foe",
		]);
		expect(names(story)).toEqual(["Tag c1", "Tag c2"]);
	});

	it("falls back to the actor's own name when it is not masked", () => {
		asUser({ isGM: true });
		foe({ maskedName: null });
		tracked = ["foe"];
		const story = buildGroupRollTabs(
			dialogFor(["h1"]),
			sharedFor({ isOwner: true }),
		).find((tab) => tab.id === "__story");
		expect(story.groups[0].themeName).toBe("Name foe — Theme foe");
	});

	it("leaves a tracked Hero out of the Story tab", () => {
		asUser({ isGM: true });
		tracked = ["h2"];
		const tabs = buildGroupRollTabs(
			dialogFor(["h1"]),
			sharedFor({ isOwner: true }),
		);
		expect(ids(tabs)).not.toContain("__story");
	});

	it("shows a participant only the opposition tags the Narrator invoked", () => {
		asUser({ owns: ["h1"] });
		foe();
		tracked = ["foe"];
		selections.set(effect("c2", theme("foe")).uuid, "negative");
		const story = buildGroupRollTabs(
			dialogFor(["h1"]),
			sharedFor({ isOwner: false }),
		).find((tab) => tab.id === "__story");
		expect(names(story)).toEqual(["Tag c2"]);
	});

	it("gives a participant no Story tab when none of the opposition is invoked", () => {
		asUser({ owns: ["h1"] });
		foe();
		tracked = ["foe"];
		const tabs = buildGroupRollTabs(
			dialogFor(["h1"]),
			sharedFor({ isOwner: false }),
		);
		expect(ids(tabs)).not.toContain("__story");
	});
});

describe("buildGroupRollTabs: which tab is open", () => {
	beforeEach(() => asUser({ isGM: true }));
	const build = (tabGroups) => {
		const dialog = dialogFor(["h1", "h2"], { tabGroups });
		const tabs = buildGroupRollTabs(dialog, sharedFor({ isOwner: true }));
		return { tabs, dialog };
	};

	it("opens the first tab when none was remembered, and marks only it active", () => {
		const { tabs, dialog } = build({});
		expect(dialog.tabGroups["gm-viewer"]).toBe(FELLOWSHIP);
		expect(tabs.map((tab) => tab.cssClass)).toEqual(["active", "", ""]);
	});

	it("keeps the tab the table was on", () => {
		const { tabs, dialog } = build({ "gm-viewer": "h2" });
		expect(dialog.tabGroups["gm-viewer"]).toBe("h2");
		expect(tabs.map((tab) => tab.cssClass)).toEqual(["", "", "active"]);
	});

	it("moves off a remembered tab that is gone, so a pane is never left hidden", () => {
		const { tabs, dialog } = build({ "gm-viewer": "h7" });
		expect(dialog.tabGroups["gm-viewer"]).toBe(FELLOWSHIP);
		expect(tabs.filter((tab) => tab.cssClass === "active")).toHaveLength(1);
	});
});
