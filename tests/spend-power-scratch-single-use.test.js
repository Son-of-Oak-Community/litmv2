import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	parseSpendIntent,
	scratchPickerCostCalculator,
} from "../modules/apps/spend-power.js";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeElement } from "./__helpers__/dom.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import {
	optionRow,
	scratchIntent,
	spendDialog,
	spendForm,
	wireActors,
} from "./__helpers__/spend-power.js";

// Core Book p.165: "Scratching a single-use story tag costs 1 Power." The
// scratch picker used to price every chip at the option's flat 2.

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	// The scene-tag pack is not in the unit-test shim; no pack means no scene tags.
	vi.spyOn(StoryTagsStore, "packStoryTags", "get").mockReturnValue([]);
	game.users.activeGM = null;
	game.user.isGM = false;
	game.messages.get = vi.fn(() => null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** A selected scratch chip reduced to what the spend-power code reads off it. */
function chip({
	tagId,
	tagName,
	actorId = "h1",
	scene = false,
	singleUse = false,
}) {
	return fakeElement({
		dataset: {
			tagId,
			tagName,
			actorId,
			sceneTag: String(scene),
			singleUse: String(singleUse),
		},
	});
}

/** The scratch option's entries section holding the given selected chips. */
function entriesSection(chips) {
	return fakeElement({
		dataset: { scratchPicker: "true" },
		all: { ".litm-spend-power__tag-chip.is-selected": chips },
	});
}

describe("scratch picker price in the dialog", () => {
	it("prices a single-use chip at 1 and any other at the option cost", () => {
		const section = entriesSection([
			chip({ tagId: "a", tagName: "rope" }),
			chip({ tagId: "b", tagName: "torch", singleUse: true }),
			chip({ tagId: "c", tagName: "lantern", singleUse: true }),
		]);
		expect(scratchPickerCostCalculator(null, 2, section)).toBe(2 + 1 + 1);
	});

	it("is 0 with nothing selected", () => {
		expect(scratchPickerCostCalculator(null, 2, entriesSection([]))).toBe(0);
	});
});

describe("parseSpendIntent — scratch chips", () => {
	function scratchRow(chips) {
		return optionRow(
			{ optionId: "scratch_tag", hasTier: "false" },
			{ one: { ".litm-spend-power__entries": entriesSection(chips) } },
		);
	}

	it("carries isSingleUse on each chip", () => {
		const li = scratchRow([
			chip({ tagId: "a", tagName: "rope" }),
			chip({ tagId: "b", tagName: "torch", singleUse: true }),
			chip({
				tagId: "s1",
				tagName: "fog",
				actorId: "",
				scene: true,
				singleUse: true,
			}),
		]);
		const dialog = spendDialog([{ id: "scratch_tag", label: "x", cost: 2 }]);

		const { options } = parseSpendIntent(spendForm([li]), dialog);

		expect(options[0].chips).toEqual([
			expect.objectContaining({ tagId: "a", isSingleUse: false }),
			expect.objectContaining({ tagId: "b", isSingleUse: true }),
			expect.objectContaining({
				tagId: "s1",
				isScene: true,
				isSingleUse: true,
			}),
		]);
	});
});

describe("applySpendIntent — scratch of single-use tags", () => {
	it("charges 1 for a single-use actor tag and 2 for a normal one", async () => {
		const normal = fakeEffect({ id: "e1", name: "rope" });
		const single = fakeEffect({ id: "e2", name: "torch" });
		const hero = fakeActor({ id: "h1", effects: [normal, single] });
		wireActors(hero);

		const { results, totalSpent } = await applySpendIntent(
			hero,
			scratchIntent([
				{ tagId: "e1", tagName: "rope", actorId: "h1", isSingleUse: false },
				{ tagId: "e2", tagName: "torch", actorId: "h1", isSingleUse: true },
			]),
		);

		expect(normal.update).toHaveBeenCalledWith({ "system.isScratched": true });
		expect(single.update).toHaveBeenCalledWith({ "system.isScratched": true });
		expect(results[0].power).toBe(3);
		expect(totalSpent).toBe(3);
	});

	it("charges 1 for a single-use scene tag and 2 for a normal one", async () => {
		const hero = fakeActor({ id: "h1" });
		game.users.activeGM = { id: "gm-1" };

		const { results, totalSpent } = await applySpendIntent(
			hero,
			scratchIntent([
				{
					tagId: "s1",
					tagName: "fog",
					actorId: "",
					isScene: true,
					isSingleUse: true,
				},
				{
					tagId: "s2",
					tagName: "rain",
					actorId: "",
					isScene: true,
					isSingleUse: false,
				},
			]),
		);

		expect(Sockets.dispatch).toHaveBeenCalledWith("storyTagsUpdate", {
			operation: "updateTags",
			data: [
				{ _id: "s1", "system.isScratched": true },
				{ _id: "s2", "system.isScratched": true },
			],
		});
		expect(results[0].power).toBe(3);
		expect(totalSpent).toBe(3);
	});

	it("still charges the flat cost for chips that do not say (older intents)", async () => {
		const tag = fakeEffect({ id: "e1", name: "rope" });
		const hero = fakeActor({ id: "h1", effects: [tag] });
		wireActors(hero);

		const { totalSpent } = await applySpendIntent(
			hero,
			scratchIntent([{ tagId: "e1", tagName: "rope", actorId: "h1" }]),
		);

		expect(totalSpent).toBe(2);
	});
});
