import { describe, expect, it } from "vitest";
import {
	buildNarratorSelections,
	canInitiateRoll,
	NARRATOR_CALL_TYPES,
	normalizeCallType,
	resolveCallDelivery,
	summarizeNarratorTags,
} from "../modules/apps/roll/narrator-call-rules.js";

/**
 * The Narrator's Call inverts who instigates a roll: the Narrator picks the
 * outcome method and invokes the opposition's tags (Core Book p.269, p.272),
 * then hands the roll to a player who invokes their own. These are the pure
 * pieces of that handoff.
 */

describe("NARRATOR_CALL_TYPES", () => {
	it("offers exactly Quick, Detailed and Reaction", () => {
		expect([...NARRATOR_CALL_TYPES]).toEqual(["quick", "tracked", "mitigate"]);
	});

	it("excludes sacrifice — the price is the player's to elect, not the Narrator's to demand", () => {
		expect(NARRATOR_CALL_TYPES).not.toContain("sacrifice");
	});

	it("normalizes unknown or missing types to a Quick outcome", () => {
		expect(normalizeCallType("sacrifice")).toBe("quick");
		expect(normalizeCallType(undefined)).toBe("quick");
		expect(normalizeCallType("tracked")).toBe("tracked");
	});
});

describe("buildNarratorSelections", () => {
	const gm = "gm-user";

	it("stamps every entry as the Narrator's so the roller can't quietly drop it", () => {
		const map = new Map([["Actor.a.ActiveEffect.b", { state: "negative" }]]);
		const [[uuid, entry]] = buildNarratorSelections(map, gm);
		expect(uuid).toBe("Actor.a.ActiveEffect.b");
		expect(entry).toMatchObject({
			state: "negative",
			contributorId: gm,
			narrator: true,
			effectUuid: "Actor.a.ActiveEffect.b",
		});
	});

	it("drops unset selections — an empty state means the tag was not invoked", () => {
		const map = new Map([
			["a", { state: "" }],
			["b", { state: "positive" }],
			["c", { state: null }],
		]);
		expect(buildNarratorSelections(map, gm).map(([id]) => id)).toEqual(["b"]);
	});

	it("carries a burn through as its own state", () => {
		const map = new Map([["a", { state: "scratched" }]]);
		expect(buildNarratorSelections(map, gm)[0][1].state).toBe("scratched");
	});

	it("clears contributor-actor metadata — a Narrator invocation is not a helping hero", () => {
		const map = new Map([
			["a", { state: "positive", contributorActorId: "hero-1" }],
		]);
		expect(buildNarratorSelections(map, gm)[0][1].contributorActorId).toBe(
			null,
		);
	});

	it("accepts a plain entry array as well as a Map", () => {
		const entries = [["a", { state: "positive" }]];
		expect(buildNarratorSelections(entries, gm)).toHaveLength(1);
	});

	it("round-trips into a Map the dialog can adopt wholesale", () => {
		const map = new Map([["a", { state: "positive" }]]);
		const restored = new Map(buildNarratorSelections(map, gm));
		expect(restored.get("a").narrator).toBe(true);
	});
});

describe("resolveCallDelivery", () => {
	const gm = { id: "gm", isGM: true, active: true };

	it("sends the roll to an active player owner", () => {
		const result = resolveCallDelivery({
			owners: [gm, { id: "p1", active: true }],
			narratorUserId: "gm",
		});
		expect(result.mode).toBe("player");
		expect(result.rollerIds).toEqual(["p1"]);
	});

	it("falls back to the Narrator when the hero's player is offline", () => {
		const result = resolveCallDelivery({
			owners: [gm, { id: "p1", active: false }],
			narratorUserId: "gm",
		});
		expect(result.mode).toBe("narrator");
		expect(result.rollerIds).toEqual([]);
	});

	it("falls back to the Narrator when the hero has no player owner at all", () => {
		const result = resolveCallDelivery({ owners: [gm], narratorUserId: "gm" });
		expect(result.mode).toBe("narrator");
	});

	it("never hands the roll to a GM seat even when the GM owns the hero", () => {
		const result = resolveCallDelivery({
			owners: [{ id: "gm2", isGM: true, active: true }],
			narratorUserId: "gm",
		});
		expect(result.rollerIds).toEqual([]);
	});

	it("whispers every owner plus the Narrator, so an offline player finds it at login", () => {
		const result = resolveCallDelivery({
			owners: [
				{ id: "p1", active: false },
				{ id: "p2", active: true },
			],
			narratorUserId: "gm",
		});
		expect(result.whisper.sort()).toEqual(["gm", "p1", "p2"]);
	});

	it("deduplicates the Narrator out of the whisper list when they also own the hero", () => {
		const result = resolveCallDelivery({
			owners: [gm, { id: "p1", active: true }],
			narratorUserId: "gm",
		});
		expect(result.whisper).toHaveLength(2);
	});

	it("handles a hero nobody owns", () => {
		const result = resolveCallDelivery({ narratorUserId: "gm" });
		expect(result).toEqual({
			mode: "narrator",
			rollerIds: [],
			whisper: ["gm"],
		});
	});
});

describe("canInitiateRoll", () => {
	it("lets anyone start a roll while player instigation is enabled", () => {
		expect(canInitiateRoll({ isGM: false, playerInitiatedRolls: true })).toBe(
			true,
		);
	});

	it("blocks a player from starting a roll once the table routes rolls through the Narrator", () => {
		expect(canInitiateRoll({ isGM: false, playerInitiatedRolls: false })).toBe(
			false,
		);
	});

	it("never gates the Narrator", () => {
		expect(canInitiateRoll({ isGM: true, playerInitiatedRolls: false })).toBe(
			true,
		);
	});

	it("defaults to permitted when the setting is unavailable", () => {
		expect(canInitiateRoll({})).toBe(true);
	});
});

describe("summarizeNarratorTags", () => {
	it("splits invoked tags by polarity", () => {
		const { helpful, hindering } = summarizeNarratorTags([
			{ name: "torchlight", state: "positive" },
			{ name: "slippery-scree", state: "negative" },
		]);
		expect(helpful.map((t) => t.name)).toEqual(["torchlight"]);
		expect(hindering.map((t) => t.name)).toEqual(["slippery-scree"]);
	});

	it("counts a burned tag as helping, matching LitmRoll.filterTags", () => {
		const { helpful } = summarizeNarratorTags([
			{ name: "last-arrow", state: "scratched" },
		]);
		expect(helpful[0]).toMatchObject({ name: "last-arrow", burned: true });
	});

	it("keeps the tier on a status so the card can render its pips", () => {
		const { hindering } = summarizeNarratorTags([
			{ name: "wounded", type: "status_tag", value: 3, state: "negative" },
		]);
		expect(hindering[0]).toMatchObject({ type: "status_tag", value: 3 });
	});

	it("ignores unselected and nameless entries", () => {
		const { helpful, hindering } = summarizeNarratorTags([
			{ name: "unused", state: "" },
			{ state: "positive" },
		]);
		expect(helpful).toEqual([]);
		expect(hindering).toEqual([]);
	});

	it("tolerates a missing tag list", () => {
		expect(summarizeNarratorTags()).toEqual({ helpful: [], hindering: [] });
	});
});
