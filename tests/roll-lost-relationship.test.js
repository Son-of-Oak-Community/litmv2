import { afterEach, describe, expect, it } from "vitest";
import { buildContributedTagGroups } from "../modules/apps/roll/roll-dialog-context.js";

// The Hero sheet lists only relationships with a Hero still in the world;
// the roll must not offer a helper the ones it hides.
describe("relationships with a deleted Hero", () => {
	afterEach(() => {
		delete game.user.character;
	});

	it("are not offered to a helper", () => {
		const rel = (uuid, name, targetHero) => ({
			uuid,
			name,
			type: "relationship_tag",
			parent: null,
			active: true,
			system: { targetHero },
		});
		const hero = {
			id: "h2",
			type: "hero",
			name: "Helper",
			img: null,
			system: {},
			items: { get: () => null },
			effects: [
				rel("e1", "Old friend", { id: "h1" }),
				rel("e2", "Lost friend", null),
			],
			allApplicableEffects() {
				return this.effects;
			},
		};
		for (const e of hero.effects) e.parent = hero;
		game.user.character = hero;
		const [helper] = buildContributedTagGroups(
			{ actorId: "h1", getSelection: () => ({}) },
			{
				decorateTag: (tag) => ({ ...tag, states: "" }),
				tagTypeOrder: {},
				isOwner: false,
			},
		);
		const names = helper.themeGroups.flatMap((g) => g.tags.map((t) => t.name));
		expect(names).toEqual(["Old friend"]);
	});
});
