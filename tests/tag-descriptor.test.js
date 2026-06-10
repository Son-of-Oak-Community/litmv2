import { describe, expect, it } from "vitest";
import {
	descriptorToEffectData,
	isStatusDescriptor,
} from "../modules/item/action/tag-string.js";

// The legacy tag descriptor is the drag-payload / scene-tag shape:
// { id, name, type, values[6], isScratched, isSingleUse, hidden, limitId }.
// descriptorToEffectData is its only conversion to AE creation data.

describe("isStatusDescriptor", () => {
	it("treats declared status types as statuses, including the legacy short form", () => {
		expect(isStatusDescriptor({ type: "status_tag", values: [] })).toBe(true);
		expect(isStatusDescriptor({ type: "status", values: [] })).toBe(true);
	});

	it("treats untyped descriptors with marked tier values as statuses", () => {
		expect(
			isStatusDescriptor({ type: "story_tag", values: [null, "2", null] }),
		).toBe(true);
		expect(isStatusDescriptor({ values: [false, true] })).toBe(true);
	});

	it("treats empty-valued story descriptors as story tags", () => {
		expect(
			isStatusDescriptor({ type: "story_tag", values: [null, null, ""] }),
		).toBe(false);
		expect(isStatusDescriptor({ type: "story_tag" })).toBe(false);
	});
});

describe("descriptorToEffectData", () => {
	it("builds status_tag creation data with positional tiers", () => {
		const data = descriptorToEffectData({
			name: "wounded",
			type: "status_tag",
			values: [null, "2", null, null, null, null],
			hidden: true,
			limitId: "lim-1",
		});
		expect(data).toMatchObject({
			name: "wounded",
			type: "status_tag",
			disabled: false,
			system: {
				tiers: [false, true, false, false, false, false],
				isHidden: true,
				limitId: "lim-1",
			},
		});
		expect(data.img).toContain("consequences.svg");
	});

	it("builds story_tag creation data preserving scratch/single-use state", () => {
		const data = descriptorToEffectData({
			name: "rope",
			type: "story_tag",
			values: [null, null, null, null, null, null],
			isScratched: true,
			isSingleUse: true,
		});
		expect(data).toMatchObject({
			name: "rope",
			type: "story_tag",
			system: {
				isScratched: true,
				isSingleUse: true,
				isHidden: false,
				limitId: null,
			},
		});
	});
});
