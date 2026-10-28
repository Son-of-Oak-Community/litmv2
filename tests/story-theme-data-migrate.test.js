import { describe, expect, it } from "vitest";
import { StoryThemeData } from "../modules/item/story-theme/story-theme-data.js";

describe("StoryThemeData.migrateData", () => {
	it("leaves level out of an update diff that does not carry it", () => {
		const out = StoryThemeData.migrateData({ isScratched: true });
		expect("level" in out).toBe(false);
	});

	it("still replaces an invalid stored level", () => {
		const out = StoryThemeData.migrateData({ level: "story" });
		expect(out.level).toBe("origin");
	});
});
