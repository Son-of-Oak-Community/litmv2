import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maxStatusTier } from "../modules/active-effects/status-tag-data.js";
import { toTiers } from "../modules/apps/story-tags/story-tag-helpers.js";
import { effectDragState } from "../modules/item/action/tag-string.js";
import { LitmConfig } from "../modules/system/config.js";
import { fakeEffect } from "./__helpers__/factories.js";

// A tag dragged between sidebar columns used to be rebuilt from its label,
// which names the highest tier and nothing else. effectDragState reads the
// source effect so the payload can carry what the label cannot.

const status = (marked, over = {}) =>
	fakeEffect({
		type: "status_tag",
		system: {
			isHidden: false,
			tiers: Array.from({ length: maxStatusTier() }, (_, i) =>
				marked.includes(i + 1),
			),
			limitId: null,
			...over,
		},
	});

describe("effectDragState", () => {
	const original = CONFIG.litmv2;

	beforeEach(() => {
		CONFIG.litmv2 = Object.create(LitmConfig);
		CONFIG.litmv2.heroLimit = 5;
		CONFIG.litmv2._maxStatusTierOverride = null;
	});

	afterEach(() => {
		CONFIG.litmv2 = original;
	});

	it("carries a story tag's scratched, single-use and hidden flags", () => {
		const effect = fakeEffect({
			type: "story_tag",
			system: { isScratched: true, isSingleUse: true, isHidden: true },
		});

		expect(effectDragState(effect)).toEqual({
			isScratched: true,
			isSingleUse: true,
			hidden: true,
		});
	});

	it("reports a plain visible story tag as such, not as missing", () => {
		const effect = fakeEffect({
			type: "story_tag",
			system: { isScratched: false, isSingleUse: false, isHidden: false },
		});

		expect(effectDragState(effect)).toEqual({
			isScratched: false,
			isSingleUse: false,
			hidden: false,
		});
	});

	it("carries every marked tier of a stacked status, not only the highest", () => {
		const { values } = effectDragState(status([1, 3]));

		expect(toTiers(values).slice(0, 4)).toEqual([true, false, true, false]);
	});

	it("keeps a fully marked track marked", () => {
		const all = Array.from({ length: maxStatusTier() }, (_, i) => i + 1);

		const { values } = effectDragState(status(all));

		expect(toTiers(values)).toEqual(Array(maxStatusTier()).fill(true));
	});

	it("carries a status's hidden flag", () => {
		expect(effectDragState(status([2], { isHidden: true })).hidden).toBe(true);
	});

	it("leaves the source's limit link behind", () => {
		// A limit belongs to the column the tag leaves; the destination has no
		// limit with that id, so carrying it would only dangle.
		const state = effectDragState(status([2], { limitId: "lim-1" }));

		expect(state).not.toHaveProperty("limitId");
	});

	it("adds nothing when there is no effect to read", () => {
		expect(effectDragState(null)).toEqual({});
		expect(effectDragState(undefined)).toEqual({});
	});
});
