import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContributedTagGroups } from "../modules/apps/roll/roll-dialog-context.js";
import { setGM, setPlayer } from "./__helpers__/users.js";

// What the roller sees of the tags other characters contributed
// (`buildContributedTagGroups`, the owner's half). CLAUDE.md: "A hidden tag or
// status is never shown to the player it is hidden from, on any surface". A
// hidden contribution is left out here; it still counts, and the dialog shows
// it as a masked row (`#buildConcealedRows`).

const theme = { id: "th", name: "Skilled with a Bow", img: "bow.webp" };
const effect = (uuid, name, { type = "power_tag", isHidden = false } = {}) => ({
	_id: uuid,
	id: uuid,
	uuid,
	name,
	type,
	active: true,
	system: { isHidden },
	parent: theme,
});

let helper;
let selections;
const pick = (uuid, state = "positive", extra = {}) =>
	selections.set(uuid, {
		state,
		contributorId: "peer",
		contributorActorId: "ally",
		...extra,
	});
const build = () =>
	buildContributedTagGroups(
		{ actorId: "hero", selections },
		{ decorateTag: (tag) => tag, tagTypeOrder: {}, isOwner: true },
	);
const names = (groups) =>
	groups.flatMap((g) =>
		g.themeGroups.flatMap((t) => t.tags.map((x) => x.name)),
	);

beforeEach(() => {
	selections = new Map();
	helper = {
		id: "ally",
		type: "hero",
		name: "Arsinia",
		img: "arsinia.webp",
		items: { get: (id) => (id === "th" ? { ...theme, type: "theme" } : null) },
		system: {
			allRollTags: [
				effect("e-open", "Father's yew bow"),
				effect("e-hidden", "Sworn to the Vampire King", { isHidden: true }),
				effect("e-unpicked", "Keen eye"),
			],
		},
	};
	game.actors.get.mockImplementation((id) => (id === "ally" ? helper : null));
	setPlayer();
});
afterEach(() => {
	game.actors.get.mockReset();
});

describe("the roller's view of contributed tags", () => {
	it("lists a helper's contributed tag under the helper, by theme", () => {
		pick("e-open");
		expect(build()).toEqual([
			{
				actorName: "Arsinia",
				actorImg: "arsinia.webp",
				themeGroups: [
					expect.objectContaining({
						themeName: "Skilled with a Bow",
						themeImg: "bow.webp",
						tags: [
							expect.objectContaining({
								uuid: "e-open",
								name: "Father's yew bow",
								state: "positive",
								contributorId: "peer",
							}),
						],
					}),
				],
			},
		]);
	});

	it("never names a contributed tag that is hidden from players", () => {
		pick("e-open");
		pick("e-hidden", "negative", { narrator: true });
		const groups = build();
		expect(names(groups)).toEqual(["Father's yew bow"]);
		expect(JSON.stringify(groups)).not.toContain("Vampire King");
	});

	it("shows no group at all for a helper whose only contribution is hidden", () => {
		pick("e-hidden", "negative");
		expect(build()).toEqual([]);
	});

	it("shows the Narrator the hidden one too", () => {
		setGM();
		pick("e-open");
		pick("e-hidden", "negative");
		expect(names(build())).toEqual([
			"Father's yew bow",
			"Sworn to the Vampire King",
		]);
	});

	it("leaves out tags the helper did not contribute", () => {
		pick("e-open");
		pick("e-unpicked", "");
		expect(names(build())).toEqual(["Father's yew bow"]);
	});

	it("carries the Narrator's stamp on a contributed tag, which locks its row", () => {
		pick("e-open", "negative", { narrator: true });
		expect(build()[0].themeGroups[0].tags[0]).toMatchObject({
			state: "negative",
			narrator: true,
		});
	});

	it("names the contributor as the selection recorded them, over the actor's own name", () => {
		pick("e-open", "positive", {
			contributorActorName: "Arsinia Hawt",
			contributorActorImg: "token.webp",
		});
		expect(build()[0]).toMatchObject({
			actorName: "Arsinia Hawt",
			actorImg: "token.webp",
		});
	});

	it("skips a selection with no contributing character, and one whose character is gone", () => {
		selections.set("e-open", { state: "positive", contributorId: "player" });
		pick("e-unpicked", "positive", { contributorActorId: "deleted" });
		expect(build()).toEqual([]);
	});
});
