import { afterEach, describe, expect, it } from "vitest";
import { buildOwnerContext } from "../modules/apps/roll/roll-dialog-context.js";

// The Fellowship's story tags and statuses follow the same rule as the
// Hero's own: a tag the Narrator hid is not listed for the player.
describe("buildOwnerContext — hidden Fellowship tags", () => {
	afterEach(() => {
		game.user.isGM = false;
	});

	const effect = (id, type, isHidden) => ({
		_id: id,
		id,
		uuid: `Actor.f.ActiveEffect.${id}`,
		name: id,
		type,
		active: true,
		system: { isHidden, currentTier: 1 },
	});

	function fellowshipNames() {
		const dialog = {
			getSelection: () => ({}),
			actor: {
				system: {
					themes: [],
					storyThemes: [],
					storyTags: [],
					statusEffects: [],
					relationships: [],
					fellowship: {
						themes: [],
						tags: [
							effect("open-tag", "story_tag", false),
							effect("hidden-tag", "story_tag", true),
							effect("open-status", "status_tag", false),
							effect("hidden-status", "status_tag", true),
						],
					},
				},
			},
		};
		const { fellowshipTagGroups } = buildOwnerContext(dialog, {
			decorateTag: (tag) => tag,
		});
		return fellowshipTagGroups.flatMap((g) => g.tags.map((t) => t.name));
	}

	it("leaves hidden ones out for a player", () => {
		expect(fellowshipNames()).toEqual(["open-tag", "open-status"]);
	});

	it("lists them all for the Narrator", () => {
		game.user.isGM = true;
		expect(fellowshipNames()).toEqual([
			"open-tag",
			"hidden-tag",
			"open-status",
			"hidden-status",
		]);
	});
});
