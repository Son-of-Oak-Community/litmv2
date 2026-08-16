import { afterEach, describe, expect, it } from "vitest";
import { StatusTagData } from "../modules/active-effects/status-tag-data.js";
import { SceneTagDialog } from "../modules/apps/story-tags/scene-tag-dialog.js";
import { LitmConfig } from "../modules/system/config.js";

// Scene tags live on a scene flag, so nothing pads them the way a DataModel
// pads effect-backed statuses. `sceneData` is both what the dialog renders and
// the object its remove-handlers write back, so a track that reads short here
// is a track whose top tiers can't be marked — and one whose marks a later
// edit persists as lost.

const original = CONFIG.litmv2;
afterEach(() => {
	CONFIG.litmv2 = original;
});

/** A dialog bound to a scene whose flag holds `tags`. */
function dialogWith(tags, heroLimit = 7) {
	CONFIG.litmv2 = Object.create(LitmConfig);
	CONFIG.litmv2.heroLimit = heroLimit;
	CONFIG.litmv2._maxStatusTierOverride = null;

	const dialog = Object.create(SceneTagDialog.prototype);
	Object.defineProperty(dialog, "scene", {
		value: { getFlag: () => ({ tags, limits: [] }) },
	});
	return dialog;
}

describe("SceneTagDialog#sceneData", () => {
	it("widens a legacy six-box status to the world's track depth", () => {
		const dialog = dialogWith([
			{
				id: "t1",
				name: "flooded",
				type: "status",
				values: [true, true, false, false, false, false],
			},
		]);

		const [tag] = dialog.sceneData.tags;
		expect(tag.type).toBe("status_tag");
		expect(tag.values).toHaveLength(8);
		expect(StatusTagData.tierOf(tag.values)).toBe(2);
	});

	it("keeps marks stored in a legacy truthy shape rather than clearing them", () => {
		const dialog = dialogWith([
			{ id: "t1", name: "flooded", type: "status", values: [1, 0, 1, 0, 0, 0] },
			{
				id: "t2",
				name: "burning",
				type: "status",
				values: ["1", "", "", "", "", ""],
			},
		]);

		const [flooded, burning] = dialog.sceneData.tags;
		expect(StatusTagData.tierOf(flooded.values)).toBe(3);
		expect(StatusTagData.tierOf(burning.values)).toBe(1);
	});

	it("never shrinks a track marked under a higher Hero Limit", () => {
		const deep = Array(10).fill(false);
		deep[9] = true; // tier 10, taken while the world ran deeper
		const dialog = dialogWith(
			[{ id: "t1", name: "cursed", type: "status", values: deep }],
			5, // depth 6 now
		);

		const [tag] = dialog.sceneData.tags;
		expect(tag.values).toHaveLength(10);
		expect(StatusTagData.tierOf(tag.values)).toBe(10);
	});

	it("leaves story tags alone", () => {
		const dialog = dialogWith([
			{ id: "t1", name: "rope", type: "tag", values: [] },
		]);

		const [tag] = dialog.sceneData.tags;
		expect(tag.type).toBe("story_tag");
		expect(tag.values).toEqual([]);
	});

	it("returns empty collections when the scene has no flag", () => {
		const dialog = Object.create(SceneTagDialog.prototype);
		Object.defineProperty(dialog, "scene", { value: { getFlag: () => null } });

		expect(dialog.sceneData).toEqual({ tags: [], limits: [] });
	});
});
