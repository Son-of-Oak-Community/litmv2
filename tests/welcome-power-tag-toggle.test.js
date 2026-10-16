import { beforeEach, describe, expect, it } from "vitest";
import { toggledPowerTags } from "../modules/apps/welcome/welcome-overlay.js";

// The hero-creation wizard's power-tag checkboxes: at most two per theme.

const checkbox = (value, checked) => ({ value, checked });

beforeEach(() => {
	ui.notifications.warn.mockClear();
});

describe("toggledPowerTags", () => {
	it("adds a newly checked tag", () => {
		expect(toggledPowerTags(["a"], checkbox("b", true))).toEqual(["a", "b"]);
		expect(ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("drops blank entries from the incoming selection", () => {
		expect(toggledPowerTags(["", "a"], checkbox("b", true))).toEqual([
			"a",
			"b",
		]);
	});

	it("removes an unchecked tag", () => {
		expect(toggledPowerTags(["a", "b"], checkbox("a", false))).toEqual(["b"]);
	});

	it("refuses a tag that is already selected", () => {
		expect(toggledPowerTags(["a"], checkbox("a", true))).toBeNull();
	});

	it("refuses a third tag, un-checks the box and warns", () => {
		const target = checkbox("c", true);

		expect(toggledPowerTags(["a", "b"], target)).toBeNull();

		expect(target.checked).toBe(false);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.hero_creation_max_power_tags",
			{ localize: true },
		);
	});

	it("still lets a full selection shrink", () => {
		expect(toggledPowerTags(["a", "b"], checkbox("b", false))).toEqual(["a"]);
	});
});
