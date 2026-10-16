import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LitmActiveEffectSheet } from "../modules/active-effects/active-effect-sheet.js";

/**
 * Title tags are managed by `LitmItem.ensureTitleTag`: one per theme, created
 * from the item name. The effect sheet used to offer a live checkbox on every
 * power tag, so a user could mint a second title tag (which `dedupeTitleTags`
 * then hides from rolls) or untick the only one.
 */

const TEMPLATE = readFileSync(
	new URL("../templates/effect/active-effect-sheet.html", import.meta.url),
	"utf8",
);

const effect = ({ type = "power_tag", isTitleTag = false } = {}) => ({
	type,
	name: "Sturdy",
	disabled: false,
	system: {
		isTitleTag,
		// Every power tag's schema carries the field, title tag or not.
		schema: { has: (field) => field === "isTitleTag" || field === "question" },
	},
});

const prepare = (doc) =>
	LitmActiveEffectSheet.prototype._prepareContext.call({ document: doc }, {});

describe("active effect sheet: title tag state", () => {
	it("reports the title tag state of the effect being edited", async () => {
		expect((await prepare(effect({ isTitleTag: true }))).isTitleTag).toBe(true);
		expect((await prepare(effect({ isTitleTag: false }))).isTitleTag).toBe(
			false,
		);
	});

	it("does not key the control on the schema having the field", async () => {
		// A plain power tag has the field in its schema; that must not be enough.
		expect(await prepare(effect())).not.toHaveProperty("hasTitleTag");
	});

	it("covers a fellowship title tag", async () => {
		const context = await prepare(
			effect({ type: "fellowship_tag", isTitleTag: true }),
		);

		expect(context.isTitleTag).toBe(true);
	});

	it("is false for an effect type with no title tag field", async () => {
		const status = { type: "status_tag", name: "Wounded", system: {} };

		expect((await prepare(status)).isTitleTag).toBe(false);
	});
});

describe("active effect sheet template: title tag control", () => {
	const block = TEMPLATE.match(
		/\{\{#if isTitleTag\}\}[\s\S]*?\{\{\/if\}\}/,
	)?.[0];

	it("renders only for the existing title tag", () => {
		expect(block).toBeDefined();
		expect(TEMPLATE).not.toContain("{{#if hasTitleTag}}");
	});

	it("is read-only and cannot reach the form submit", () => {
		expect(block).toMatch(/<input[^>]*\bdisabled\b/);
		expect(TEMPLATE).not.toContain('name="system.isTitleTag"');
	});
});
