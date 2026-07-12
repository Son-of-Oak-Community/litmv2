import { describe, expect, it } from "vitest";
import { shouldAutoLinkHero } from "../modules/system/hooks/fellowship-rules.js";

const FELLOWSHIP_ID = "9XSmLIXZbN2j1L16";

const hero = (overrides = {}) => ({
	type: "hero",
	pack: null,
	system: { fellowshipId: "" },
	...overrides,
});

describe("shouldAutoLinkHero", () => {
	it("links a world hero with a stale fellowship id", () => {
		expect(shouldAutoLinkHero(hero(), FELLOWSHIP_ID)).toBe(true);
	});

	it("never links compendium actors (world fellowship must not leak into packs)", () => {
		const packHero = hero({ pack: "litmv2-converter.bridge-actors" });
		expect(shouldAutoLinkHero(packHero, FELLOWSHIP_ID)).toBe(false);
	});

	it("ignores non-hero actors", () => {
		expect(shouldAutoLinkHero(hero({ type: "challenge" }), FELLOWSHIP_ID)).toBe(
			false,
		);
	});

	it("skips heroes already linked to the singleton", () => {
		const linked = hero({ system: { fellowshipId: FELLOWSHIP_ID } });
		expect(shouldAutoLinkHero(linked, FELLOWSHIP_ID)).toBe(false);
	});

	it("does nothing when no fellowship singleton exists", () => {
		expect(shouldAutoLinkHero(hero(), "")).toBe(false);
		expect(shouldAutoLinkHero(hero(), null)).toBe(false);
	});
});
