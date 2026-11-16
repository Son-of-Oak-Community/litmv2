import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { Sockets } from "../modules/system/sockets.js";

// `LitmRollDialog#_onTagChange`: a tag row's checkbox changed in the roll
// window. The change handler is the boundary, not the markup: it puts the
// checkbox back when this client may not make the change (CLAUDE.md, "Roll
// Flow"), holds the caps (one burn per roll, p.158; one tag per Hero in Acting
// Together and one per helper, p.157) and stamps the Narrator's invocations.

const FELLOWSHIP = "fel";
const PLAYER_CYCLE = ",positive,scratched";
// The Narrator may invert a power tag (p.76), so "negative" follows the burn.
const NARRATOR_CYCLE = ",positive,scratched,negative";

const USERS = {
	gm: { id: "gm", isGM: true },
	player: { id: "player", isGM: false },
	peer: { id: "peer", isGM: false },
	third: { id: "third", isGM: false },
};

let actors;
let effects;
let messages;

/** A tag on `actorId`'s Hero, resolvable the way the dialog resolves it. */
const tagOn = (uuid, actorId, type = "power_tag") => {
	const effect = {
		_id: uuid,
		id: uuid,
		uuid,
		name: uuid,
		type,
		system: {},
		parent: { documentName: "Actor", id: actorId },
	};
	effects.set(uuid, effect);
	return effect;
};
const hero = (id, owners = [], type = "hero") => {
	const actor = {
		id,
		type,
		name: id,
		img: `${id}.webp`,
		system: { allRollTags: [] },
		testUserPermission: (user, level) =>
			level === "OWNER" && owners.includes(user.id),
	};
	actors.set(id, actor);
	return actor;
};
const as = (id, character = null) => {
	game.user = { ...USERS[id], character };
};

const make = (options = {}) => {
	const dialog = new LitmRollDialog({
		actorId: "hero",
		ownerId: "player",
		speaker: {},
		...options,
	});
	dialog.tabGroups = {};
	dialog.render = vi.fn();
	dialog.updatePresence = vi.fn(async () => {});
	return dialog;
};
/** The checkbox for `uuid`, moved to `value` by the user. */
const checkbox = (uuid, value, states = PLAYER_CYCLE) => ({
	tagName: "LITM-SUPER-CHECKBOX",
	name: uuid,
	value,
	dataset: { type: effects.get(uuid)?.type ?? "story_tag" },
	getAttribute: (attr) => (attr === "states" ? states : null),
});
const change = (dialog, uuid, value, states) => {
	const target = checkbox(uuid, value, states);
	dialog._onTagChange({ target });
	return target;
};
const stateOf = (dialog, uuid) => dialog.getSelection(uuid).state;

beforeEach(() => {
	actors = new Map();
	effects = new Map();
	messages = [];
	vi.spyOn(Sockets, "dispatch").mockImplementation((event, data) => {
		if (event === "updateRollDialog") messages.push(data);
	});
	vi.spyOn(ui.notifications, "warn").mockImplementation(() => {});
	game.litmv2 = {};
	game.actors.get.mockImplementation((id) => actors.get(id) ?? null);
	game.users.get.mockImplementation((id) => USERS[id]);
	// The Narrator's contributor lookup walks the story-tag sidebar's actors.
	// The store caches them across files in the shared worker, so pin an
	// empty sidebar here instead of inheriting another file's.
	vi.spyOn(StoryTagsStore, "actors", "get").mockReturnValue([]);
	game.users.filter = () => [];
	foundry.utils.fromUuidSync.mockImplementation(
		(uuid) => effects.get(uuid) ?? null,
	);
	hero("hero", ["player"]);
	hero("ally", ["peer"]);
	as("player");
});
afterEach(() => {
	vi.restoreAllMocks();
	game.actors.get.mockReset();
	game.users.get.mockReset();
	delete game.users.filter;
	foundry.utils.fromUuidSync.mockReset();
});

describe("the roller changing a tag in their own roll", () => {
	it("selects it as theirs and tells the table", () => {
		tagOn("bow", "hero");
		const dialog = make();
		change(dialog, "bow", "positive");
		expect(dialog.getSelection("bow")).toMatchObject({
			state: "positive",
			contributorId: "player",
			tagActorId: "hero",
			helper: false,
			narrator: false,
		});
		expect(messages).toHaveLength(1);
		expect(messages[0].sync.state.selections.map(([id]) => id)).toEqual([
			"bow",
		]);
	});

	it("counts it toward the Power at once", () => {
		tagOn("bow", "hero");
		tagOn("slow", "hero", "weakness_tag");
		const dialog = make();
		change(dialog, "bow", "positive");
		expect(dialog.totalPower).toBe(1);
		change(dialog, "bow", "scratched");
		expect(dialog.totalPower).toBe(3);
		change(dialog, "slow", "negative", ",negative");
		expect(dialog.totalPower).toBe(2);
	});

	it("drops the selection when the checkbox cycles back to off", () => {
		tagOn("bow", "hero");
		const dialog = make();
		change(dialog, "bow", "positive");
		change(dialog, "bow", "");
		expect(dialog.selections.has("bow")).toBe(false);
		expect(dialog.totalPower).toBe(0);
		expect(messages.at(-1).sync.state.selections).toEqual([]);
	});
});

describe("the burn cap (one burned tag per roll)", () => {
	const burnedOne = () => {
		tagOn("bow", "hero");
		tagOn("axe", "hero");
		const dialog = make();
		change(dialog, "bow", "scratched");
		return dialog;
	};

	it("lets the first burn through", () => {
		const dialog = burnedOne();
		expect(stateOf(dialog, "bow")).toBe("scratched");
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("skips a second burn to off where the burn ends the cycle, and says why", () => {
		const dialog = burnedOne();
		change(dialog, "axe", "positive");
		const target = change(dialog, "axe", "scratched");
		expect(stateOf(dialog, "axe")).toBe("");
		expect(target.value).toBe("");
		expect(stateOf(dialog, "bow")).toBe("scratched");
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.burn_cap_warning",
		);
	});

	// #100: reverting to off would trap the Narrator's cursor before the
	// inversion, which sits after the burn in their cycle.
	it("skips a second burn on to the Narrator's inversion", () => {
		const dialog = burnedOne();
		const target = change(dialog, "axe", "scratched", NARRATOR_CYCLE);
		expect(stateOf(dialog, "axe")).toBe("negative");
		expect(target.value).toBe("negative");
	});

	it("lets the burned tag itself be changed", () => {
		const dialog = burnedOne();
		change(dialog, "bow", "scratched");
		expect(stateOf(dialog, "bow")).toBe("scratched");
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("lets another tag burn once the first burn is taken back", () => {
		const dialog = burnedOne();
		change(dialog, "bow", "");
		change(dialog, "axe", "scratched");
		expect(stateOf(dialog, "axe")).toBe("scratched");
	});
});

// p.156-157: a tag from another Hero is help. One per helping Hero, never
// burned, whoever picks it.
describe("Helping Each Other", () => {
	beforeEach(() => {
		tagOn("ally-1", "ally");
		tagOn("ally-2", "ally");
	});

	it("takes one tag from the helping Hero, marked as help", () => {
		const dialog = make();
		change(dialog, "ally-1", "positive");
		expect(dialog.getSelection("ally-1")).toMatchObject({
			state: "positive",
			helper: true,
			tagActorId: "ally",
		});
	});

	it("refuses a second tag from the same Hero and puts the checkbox back", () => {
		const dialog = make();
		change(dialog, "ally-1", "positive");
		const target = change(dialog, "ally-2", "positive");
		expect(stateOf(dialog, "ally-2")).toBe("");
		expect(target.value).toBe("");
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.helper_tag_cap_warning",
		);
	});

	it("holds the Narrator to the same cap", () => {
		as("gm");
		const dialog = make();
		change(dialog, "ally-1", "positive");
		change(dialog, "ally-2", "positive");
		expect(stateOf(dialog, "ally-2")).toBe("");
	});

	it("never burns a helper's tag: the cycle moves past the burn", () => {
		const dialog = make();
		const target = change(dialog, "ally-1", "scratched");
		expect(stateOf(dialog, "ally-1")).toBe("");
		expect(target.value).toBe("");
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.helper_tag_cap_warning",
		);
	});

	it("does not count the helper's status as their one tag", () => {
		tagOn("ally-status", "ally", "status_tag");
		const dialog = make();
		change(dialog, "ally-status", "positive", ",positive,negative");
		change(dialog, "ally-1", "positive");
		expect(stateOf(dialog, "ally-status")).toBe("positive");
		expect(stateOf(dialog, "ally-1")).toBe("positive");
		expect(dialog.getSelection("ally-status").helper).toBe(false);
	});
});

describe("a player who is not the roller", () => {
	const watching = () => {
		tagOn("bow", "hero");
		tagOn("ally-1", "ally");
		const ally = actors.get("ally");
		ally.system.allRollTags = [effects.get("ally-1")];
		as("peer", ally);
		return make();
	};

	it("contributes a tag of their own Hero, under that Hero's name", () => {
		const dialog = watching();
		change(dialog, "ally-1", "positive");
		expect(dialog.getSelection("ally-1")).toMatchObject({
			state: "positive",
			contributorId: "peer",
			contributorActorId: "ally",
			contributorActorName: "ally",
			contributorActorImg: "ally.webp",
			effectUuid: "ally-1",
		});
		// Only the tag goes out, as an edit for the owner to judge.
		expect(messages).toHaveLength(1);
		expect(messages[0].sync.kind).toBe("edit");
		expect(messages[0].sync.selections.map(([id]) => id)).toEqual(["ally-1"]);
	});

	it("cannot touch the roller's own tags: the checkbox goes back", () => {
		const dialog = watching();
		const target = change(dialog, "bow", "positive");
		expect(stateOf(dialog, "bow")).toBe("");
		expect(target.value).toBe("");
		expect(messages).toEqual([]);
	});

	it("cannot clear a tag the roller selected", () => {
		const dialog = watching();
		dialog.setSelection("bow", "positive", "player");
		const target = change(dialog, "bow", "");
		expect(stateOf(dialog, "bow")).toBe("positive");
		expect(target.value).toBe("positive");
	});

	it("cannot change a tag of their own Hero that someone else picked", () => {
		const dialog = watching();
		dialog.setSelection("ally-1", "positive", "player");
		const target = change(dialog, "ally-1", "");
		expect(stateOf(dialog, "ally-1")).toBe("positive");
		expect(target.value).toBe("positive");
		expect(messages).toEqual([]);
	});

	it("cannot pick a scene tag, which belongs to no Hero of theirs", () => {
		const dialog = watching();
		effects.set("fog", { uuid: "fog", type: "story_tag", system: {} });
		change(dialog, "fog", "negative", ",positive,negative");
		expect(stateOf(dialog, "fog")).toBe("");
	});
});

describe("the Narrator's invocations", () => {
	const called = (dialog) =>
		dialog.configureSharedRoll({
			ownerId: "player",
			narratorUserId: "gm",
			narratorName: "GM",
		});

	it("are stamped as theirs on a roll they called", () => {
		tagOn("bow", "hero");
		as("gm");
		const dialog = make();
		called(dialog);
		change(dialog, "bow", "negative", NARRATOR_CYCLE);
		expect(dialog.getSelection("bow")).toMatchObject({
			state: "negative",
			narrator: true,
		});
	});

	it("stay locked for the roller, whose checkbox goes back", () => {
		tagOn("bow", "hero");
		as("gm");
		const dialog = make();
		called(dialog);
		change(dialog, "bow", "negative", NARRATOR_CYCLE);

		as("player");
		const target = change(dialog, "bow", "");
		expect(stateOf(dialog, "bow")).toBe("negative");
		expect(target.value).toBe("negative");
	});

	it("keep their stamp when the Narrator cycles them to another polarity", () => {
		tagOn("bow", "hero");
		as("gm");
		const dialog = make();
		called(dialog);
		change(dialog, "bow", "negative", NARRATOR_CYCLE);
		change(dialog, "bow", "positive", NARRATOR_CYCLE);
		expect(dialog.getSelection("bow")).toMatchObject({
			state: "positive",
			narrator: true,
		});
	});

	it("are not stamped on a roll the player started, nor on the Narrator's own roll", () => {
		tagOn("bow", "hero");
		as("gm");
		const watched = make();
		change(watched, "bow", "negative", NARRATOR_CYCLE);
		expect(watched.getSelection("bow").narrator).toBe(false);

		const own = make({ ownerId: "gm" });
		change(own, "bow", "positive", NARRATOR_CYCLE);
		expect(own.getSelection("bow").narrator).toBe(false);
	});

	it("leave the roller's own picks unstamped on a called roll", () => {
		tagOn("bow", "hero");
		const dialog = make();
		called(dialog);
		change(dialog, "bow", "positive");
		expect(dialog.getSelection("bow").narrator).toBe(false);
	});
});

// p.157: one tag from each Hero in the roll, any or all of the Fellowship's.
describe("Acting Together", () => {
	const groupRoll = () => {
		const fellowship = hero(FELLOWSHIP, [], "fellowship");
		game.litmv2 = { fellowship };
		hero("h1", ["peer"]);
		hero("h2", ["third"]);
		for (const id of ["h1-a", "h1-b"]) tagOn(id, "h1");
		tagOn("h2-a", "h2");
		for (const id of ["fel-a", "fel-b"])
			tagOn(id, FELLOWSHIP, "fellowship_tag");
		const dialog = make({ actorId: FELLOWSHIP, ownerId: "gm" });
		dialog.configureSharedRoll({
			ownerId: "gm",
			narratorUserId: "gm",
			participantIds: ["h1", "h2"],
		});
		dialog.render.mockClear();
		return dialog;
	};

	it("takes one tag from each Hero and refuses a Hero's second", () => {
		as("gm");
		const dialog = groupRoll();
		change(dialog, "h1-a", "positive");
		change(dialog, "h2-a", "positive");
		const target = change(dialog, "h1-b", "positive");
		expect(stateOf(dialog, "h1-a")).toBe("positive");
		expect(stateOf(dialog, "h2-a")).toBe("positive");
		expect(stateOf(dialog, "h1-b")).toBe("");
		expect(target.value).toBe("");
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.group_tag_cap_warning",
		);
	});

	it("lets a Hero swap their tag once the first is cleared", () => {
		as("gm");
		const dialog = groupRoll();
		change(dialog, "h1-a", "positive");
		change(dialog, "h1-a", "");
		change(dialog, "h1-b", "positive");
		expect(stateOf(dialog, "h1-b")).toBe("positive");
	});

	it("takes any or all of the Fellowship's tags on top", () => {
		as("gm");
		const dialog = groupRoll();
		change(dialog, "h1-a", "positive");
		change(dialog, "fel-a", "positive");
		change(dialog, "fel-b", "positive");
		expect(stateOf(dialog, "fel-a")).toBe("positive");
		expect(stateOf(dialog, "fel-b")).toBe("positive");
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("allows one burn for the whole group", () => {
		as("gm");
		const dialog = groupRoll();
		change(dialog, "h1-a", "scratched");
		change(dialog, "h2-a", "scratched");
		expect(stateOf(dialog, "h1-a")).toBe("scratched");
		expect(stateOf(dialog, "h2-a")).toBe("");
	});

	it("marks the Narrator's picks as theirs and redraws to show it", () => {
		as("gm");
		const dialog = groupRoll();
		change(dialog, "h1-a", "positive");
		expect(dialog.getSelection("h1-a").narrator).toBe(true);
		expect(dialog.render).toHaveBeenCalled();
	});

	it("lets a participant move their own Hero's tag and the Fellowship's, and nobody else's", () => {
		as("peer");
		const dialog = groupRoll();
		change(dialog, "h1-a", "positive");
		change(dialog, "fel-a", "positive");
		const target = change(dialog, "h2-a", "positive");
		expect(stateOf(dialog, "h1-a")).toBe("positive");
		expect(stateOf(dialog, "fel-a")).toBe("positive");
		expect(stateOf(dialog, "h2-a")).toBe("");
		expect(target.value).toBe("");
	});

	it("gives a spectator with no Hero in the roll nothing to move", () => {
		as("player");
		const dialog = groupRoll();
		change(dialog, "fel-a", "positive");
		change(dialog, "h1-a", "positive");
		expect(dialog.selections.size).toBe(0);
		expect(messages).toEqual([]);
	});
});
