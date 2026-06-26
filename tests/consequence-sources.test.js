import { beforeAll, describe, expect, it } from "vitest";
import { buildConsequenceItem } from "../modules/apps/consequence-sources.js";
import { makeTagStringRe } from "../modules/system/config.js";

// scanMarkup → classifyTagString reads CONFIG.litmv2.tagStringRe, which the
// test shim leaves null. Install the real getter (fresh regex per read).
beforeAll(() => {
	Object.defineProperty(CONFIG.litmv2, "tagStringRe", {
		configurable: true,
		get: () => makeTagStringRe(),
	});
});

describe("buildConsequenceItem", () => {
	it("renders prose chips and passes through key/flags/source fields", () => {
		const item = buildConsequenceItem("A [muddy path]", "0", {
			index: 0,
			applied: true,
			disabled: false,
			sourceUuid: "",
			sourceLabel: "Cross the Ford",
		});
		expect(item.key).toBe("0");
		expect(item.index).toBe(0);
		expect(item.applied).toBe(true);
		expect(item.disabled).toBe(false);
		expect(item.sourceUuid).toBe("");
		expect(item.sourceLabel).toBe("Cross the Ford");
		expect(item.text).toContain(">muddy path<");
		expect(item.hasVariableTier).toBe(false);
		expect(item.varTokens).toEqual([]);
	});

	it("extracts variable-tier status tokens (tier-less [name-])", () => {
		const item = buildConsequenceItem(
			"Heroes are [shaken-] and [bruised-]",
			"k",
			{
				index: 2,
			},
		);
		expect(item.hasVariableTier).toBe(true);
		expect(item.varTokens).toEqual([
			{ idx: 0, name: "shaken" },
			{ idx: 1, name: "bruised" },
		]);
	});

	it("does not treat a fixed-tier status as variable", () => {
		const item = buildConsequenceItem("Wake [drenched-2]", "k", { index: 0 });
		expect(item.hasVariableTier).toBe(false);
		expect(item.varTokens).toEqual([]);
	});

	it("assigns idx only among variable tokens, skipping fixed-tier statuses", () => {
		const item = buildConsequenceItem(
			"[shaken-] [drenched-2] [bruised-]",
			"k",
			{
				index: 0,
			},
		);
		expect(item.varTokens).toEqual([
			{ idx: 0, name: "shaken" },
			{ idx: 1, name: "bruised" },
		]);
	});
});

import { collectSourceConsequences } from "../modules/apps/consequence-sources.js";

const vignette = (uuid, consequences, extra = {}) => ({
	type: "vignette",
	uuid,
	name: extra.name ?? "",
	system: { consequences, threat: extra.threat ?? "" },
});

const actor = (type, vignettes, extra = {}) => ({
	type,
	name: extra.name ?? "Actor",
	system: { publicName: extra.publicName },
	items: vignettes,
});

describe("collectSourceConsequences", () => {
	it("flattens challenge + journey vignette consequences in order", () => {
		const ch = actor("challenge", [
			vignette("Actor.c.Item.v1", ["[a]", "[b]"]),
			vignette("Actor.c.Item.v2", ["[c]"]),
		]);
		const jo = actor("journey", [vignette("Actor.j.Item.v3", ["[d]"])]);

		const records = collectSourceConsequences([ch, jo]);
		expect(records.map((r) => [r.vignette.uuid, r.index, r.text])).toEqual([
			["Actor.c.Item.v1", 0, "[a]"],
			["Actor.c.Item.v1", 1, "[b]"],
			["Actor.c.Item.v2", 0, "[c]"],
			["Actor.j.Item.v3", 0, "[d]"],
		]);
	});

	it("ignores non-challenge/journey actors", () => {
		const hero = actor("hero", [vignette("Actor.h.Item.v", ["[x]"])]);
		expect(collectSourceConsequences([hero])).toEqual([]);
	});

	it("skips empty/blank consequence strings and vignette-less sources", () => {
		const ch = actor("challenge", [
			vignette("Actor.c.Item.v1", ["", "   ", "[real]"]),
			vignette("Actor.c.Item.v2", []),
		]);
		const records = collectSourceConsequences([ch]);
		expect(records).toHaveLength(1);
		expect(records[0].text).toBe("[real]");
		expect(records[0].index).toBe(2);
	});

	it("ignores non-vignette items on the actor", () => {
		const ch = actor("challenge", [
			{
				type: "addon",
				uuid: "Actor.c.Item.a",
				system: { consequences: ["[no]"] },
			},
		]);
		expect(collectSourceConsequences([ch])).toEqual([]);
	});
});

import { gatherSidebarConsequences } from "../modules/apps/consequence-sources.js";

describe("gatherSidebarConsequences", () => {
	it("groups by actor then vignette, with menu header = real name", async () => {
		const ch = actor(
			"challenge",
			[
				vignette("Actor.c.Item.v1", ["[a]"], { name: "Ambush" }),
				vignette("Actor.c.Item.v2", ["[b]"], { name: "Pit Trap" }),
			],
			{ name: "Bandit Camp", publicName: "Bandit Camp" },
		);

		const groups = await gatherSidebarConsequences({ actors: [ch] });
		expect(groups).toHaveLength(1);
		expect(groups[0].sourceName).toBe("Bandit Camp");
		expect(groups[0].vignettes.map((v) => v.label)).toEqual([
			"Ambush",
			"Pit Trap",
		]);
		expect(groups[0].vignettes[0].items[0].key).toBe("Actor.c.Item.v1#0");
		expect(groups[0].vignettes[0].items[0].index).toBe(0);
		expect(groups[0].vignettes[0].items[0].sourceUuid).toBe("Actor.c.Item.v1");
	});

	it("uses publicName for the stored-card source label, real name for the header", async () => {
		const ch = actor(
			"challenge",
			[vignette("Actor.c.Item.v1", ["[a]"], { name: "Ambush" })],
			{
				name: "The Lurking Horror",
				publicName: "Something Stirs",
			},
		);
		const groups = await gatherSidebarConsequences({ actors: [ch] });
		expect(groups[0].sourceName).toBe("The Lurking Horror");
		expect(groups[0].vignettes[0].items[0].sourceLabel).toBe("Something Stirs");
	});

	it("label is the vignette name; the threat renders separately", async () => {
		const ch = actor("challenge", [
			vignette("Actor.c.Item.v1", ["[a]"], {
				name: "",
				threat: "A roaring fire",
			}),
		]);
		const groups = await gatherSidebarConsequences({ actors: [ch] });
		// No name → empty label (no header line); the threat still surfaces below.
		expect(groups[0].vignettes[0].label).toBe("");
		expect(groups[0].vignettes[0].threat).toBe("A roaring fire");
	});

	it("renders item text and threat through the injected enrich fn, but scans varTokens from raw text", async () => {
		const ch = actor("challenge", [
			vignette("Actor.c.Item.v1", ["[shaken-]"], {
				name: "Storm",
				threat: "Rain lashes down",
			}),
		]);
		const enrich = (text) => `ENRICHED:${text}`;
		const groups = await gatherSidebarConsequences({ actors: [ch], enrich });
		const item = groups[0].vignettes[0].items[0];
		expect(item.text).toBe("ENRICHED:[shaken-]");
		expect(item.hasVariableTier).toBe(true); // from RAW text, not the enriched html
		expect(groups[0].vignettes[0].threat).toBe("ENRICHED:Rain lashes down");
	});

	it("marks items applied by composite key and passes disabled through", async () => {
		const ch = actor("challenge", [
			vignette("Actor.c.Item.v1", ["[a]", "[b]"]),
		]);
		const groups = await gatherSidebarConsequences({
			actors: [ch],
			appliedKeys: new Set(["Actor.c.Item.v1#1"]),
			disabled: true,
		});
		const items = groups[0].vignettes[0].items;
		expect(items[0].applied).toBe(false);
		expect(items[1].applied).toBe(true);
		expect(items.every((i) => i.disabled === true)).toBe(true);
	});

	it("produces one group per distinct actor in source order", async () => {
		const ch = actor("challenge", [vignette("Actor.c.Item.v1", ["[a]"])], {
			name: "Cave",
		});
		const jo = actor("journey", [vignette("Actor.j.Item.v2", ["[b]"])], {
			name: "Road",
		});
		const groups = await gatherSidebarConsequences({ actors: [ch, jo] });
		expect(groups).toHaveLength(2);
		expect(groups[0].sourceName).toBe("Cave");
		expect(groups[1].sourceName).toBe("Road");
	});

	it("falls back to actor.name for sourceLabel when publicName is absent", async () => {
		// Journey actors have no publicName getter, so actor.system.publicName is
		// undefined and the label should land on actor.name.
		const jo = actor("journey", [vignette("Actor.j.Item.v1", ["[a]"])], {
			name: "The Road",
		});
		const groups = await gatherSidebarConsequences({ actors: [jo] });
		expect(groups[0].vignettes[0].items[0].sourceLabel).toBe("The Road");
	});

	it("returns [] when no challenge/journey sources are present", async () => {
		expect(await gatherSidebarConsequences({ actors: [] })).toEqual([]);
	});
});
