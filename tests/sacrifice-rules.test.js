import { describe, expect, it } from "vitest";
import {
	hasPainfulSacrificeTarget,
	isThemeSpent,
} from "../modules/apps/roll/sacrifice-rules.js";

// A Painful sacrifice scratches a theme's power tags, so a theme whose power
// tags are *all* already scratched ("spent") is not a valid Painful target.
// These helpers gate auto-selection and the all-spent submit guard in the roll
// dialog (#101 follow-up). Regression coverage: an enabled, unscratched power
// tag must keep a theme live; disabled tags and non-power tags must be ignored.

const tag = (type, { scratched = false, disabled = false } = {}) => ({
	type,
	disabled,
	system: { isScratched: scratched },
});

const theme = (...effects) => ({ effects });

describe("isThemeSpent", () => {
	it("is true when every enabled power tag is scratched", () => {
		expect(
			isThemeSpent(
				theme(
					tag("power_tag", { scratched: true }),
					tag("power_tag", { scratched: true }),
				),
			),
		).toBe(true);
	});

	it("is false when any enabled power tag is still unscratched", () => {
		expect(
			isThemeSpent(
				theme(
					tag("power_tag", { scratched: true }),
					tag("power_tag", { scratched: false }),
				),
			),
		).toBe(false);
	});

	it("counts the title tag — an unscratched title keeps a theme live", () => {
		// The title tag is a power_tag; spent-ness includes it (no isTitleTag
		// exemption), so a scratched body tag + live title is not spent.
		expect(
			isThemeSpent(
				theme(
					tag("power_tag", { scratched: true }),
					tag("power_tag", { scratched: false }), // title tag, still live
				),
			),
		).toBe(false);
	});

	it("treats fellowship_tag as power-like", () => {
		expect(
			isThemeSpent(theme(tag("fellowship_tag", { scratched: true }))),
		).toBe(true);
		expect(
			isThemeSpent(theme(tag("fellowship_tag", { scratched: false }))),
		).toBe(false);
	});

	it("ignores disabled tags on both sides of the check", () => {
		// A disabled, unscratched power tag does not keep the theme live...
		expect(
			isThemeSpent(
				theme(
					tag("power_tag", { scratched: true }),
					tag("power_tag", { scratched: false, disabled: true }),
				),
			),
		).toBe(true);
		// ...and a disabled, scratched tag cannot make an otherwise-live theme spent.
		expect(
			isThemeSpent(
				theme(
					tag("power_tag", { scratched: false }),
					tag("power_tag", { scratched: true, disabled: true }),
				),
			),
		).toBe(false);
	});

	it("is false for a theme with no power-like tags (nothing to scratch)", () => {
		expect(isThemeSpent(theme(tag("weakness_tag", { scratched: true })))).toBe(
			false,
		);
		expect(isThemeSpent(theme())).toBe(false);
	});

	it("is false for a missing theme", () => {
		expect(isThemeSpent(null)).toBe(false);
		expect(isThemeSpent(undefined)).toBe(false);
	});
});

describe("hasPainfulSacrificeTarget", () => {
	const spent = theme(tag("power_tag", { scratched: true }));
	const live = theme(tag("power_tag", { scratched: false }));

	it("is true when at least one theme is still live", () => {
		expect(hasPainfulSacrificeTarget([spent, spent, live])).toBe(true);
	});

	it("is false when every theme is spent", () => {
		expect(hasPainfulSacrificeTarget([spent, spent])).toBe(false);
	});

	it("is false for an empty theme list", () => {
		expect(hasPainfulSacrificeTarget([])).toBe(false);
	});
});
