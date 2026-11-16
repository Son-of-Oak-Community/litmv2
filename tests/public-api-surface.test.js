import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LitmConfig, makeTagStringRe } from "../modules/system/config.js";

// litmv2 is extended by modules and macros through three surfaces:
// `game.litmv2`, `CONFIG.litmv2` and the `litm.*` hooks. A key renamed or a
// hook dropped breaks them without breaking anything here, so the names are
// pinned. Adding one means adding it to these lists and to CLAUDE.md;
// removing one is a breaking change.

const read = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("CONFIG.litmv2 (LitmConfig)", () => {
	it("has exactly these slots", () => {
		expect(Object.keys(LitmConfig).sort()).toEqual(
			[
				"_maxStatusTierOverride",
				"assets",
				"challengeRoles",
				"challenge_types",
				"heroLimit",
				"improveThreshold",
				"maxStatusTier",
				"roll",
				"sceneLinkRe",
				"tagStringRe",
				"themeLimit",
				"theme_levels",
				"vignette_types",
			].sort(),
		);
	});

	it("leaves the roll formula and resolver for a module to fill", () => {
		expect(Object.keys(LitmConfig.roll).sort()).toEqual([
			"formula",
			"resolver",
		]);
	});

	it("names the three theme levels, origin first", () => {
		expect(Object.keys(LitmConfig.theme_levels)).toEqual([
			"origin",
			"adventure",
			"greatness",
		]);
	});

	it("keeps the asset paths other code reads", () => {
		expect(Object.keys(LitmConfig.assets).sort()).toEqual([
			"icons",
			"logo",
			"marshal_crest",
			"preloads",
			"splash",
		]);
		expect(Object.keys(LitmConfig.assets.icons).sort()).toEqual([
			"addon",
			"backpack",
			"base",
			"default",
			"defaultActor",
			"fellowship",
			"trope",
			"vignette",
		]);
		expect(Array.isArray(LitmConfig.assets.preloads)).toBe(true);
	});

	// A global regex keeps its place between uses; each read must be a new one.
	it("hands out a fresh tag-string regex on every read", () => {
		const first = LitmConfig.tagStringRe;
		const second = LitmConfig.tagStringRe;

		expect(first).toBeInstanceOf(RegExp);
		expect(first).not.toBe(second);
		expect(first.source).toBe(makeTagStringRe().source);
		expect(first.flags).toBe("gi");
	});

	it("derives the status track depth from the Hero Limit until a module sets it", () => {
		const saved = {
			heroLimit: LitmConfig.heroLimit,
			override: LitmConfig._maxStatusTierOverride,
		};
		try {
			LitmConfig._maxStatusTierOverride = null;
			LitmConfig.heroLimit = 5;
			expect(LitmConfig.maxStatusTier).toBe(6);
			LitmConfig.heroLimit = 7;
			expect(LitmConfig.maxStatusTier).toBe(8);
			// A fragile world keeps the six boxes Challenges need.
			LitmConfig.heroLimit = 3;
			expect(LitmConfig.maxStatusTier).toBe(6);

			LitmConfig.maxStatusTier = 10;
			expect(LitmConfig.maxStatusTier).toBe(10);
			LitmConfig.heroLimit = 5;
			expect(LitmConfig.maxStatusTier).toBe(10);
		} finally {
			LitmConfig.heroLimit = saved.heroLimit;
			LitmConfig._maxStatusTierOverride = saved.override;
		}
	});
});

describe("litm.* hooks", () => {
	const DOCUMENTED = [
		"litm.campingStepChanged",
		"litm.limitReached",
		"litm.narratorCall",
		"litm.preRoll",
		"litm.preTagScratched",
		"litm.roll",
		"litm.rollDialogClosed",
		"litm.rollDialogRendered",
		"litm.sacrificePrepared",
		"litm.sceneTagsChanged",
		"litm.tagScratched",
		"litm.themeAdvanced",
		"litm.trackCompleted",
	];

	/** Every `litm.*` hook the system fires, from its source. */
	const fired = () => {
		const names = new Set();
		const files = readdirSync(new URL("../modules", import.meta.url), {
			recursive: true,
		}).filter((name) => name.endsWith(".js"));
		for (const file of files) {
			const source = read(`modules/${file}`);
			for (const [, name] of source.matchAll(
				/Hooks\.call(?:All)?\(\s*["'`](litm\.[A-Za-z]+)["'`]/g,
			)) {
				names.add(name);
			}
		}
		return [...names].sort();
	};

	it("the system fires exactly the documented hooks", () => {
		expect(fired()).toEqual(DOCUMENTED);
	});

	it("each of them is listed in CLAUDE.md", () => {
		const docs = read("CLAUDE.md");
		const section = docs.slice(docs.indexOf("### Custom System Hooks"));
		for (const name of DOCUMENTED) {
			expect(section, name).toContain(`\`${name}\``);
		}
	});
});
