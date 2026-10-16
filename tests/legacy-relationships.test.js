import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildRelationshipEffects,
	createLegacyRelationshipEffects,
	HeroData,
} from "../modules/actor/hero/hero-data.js";
import { LitmActor } from "../modules/actor/litm-actor.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// Legacy heroes stored relationships as `system.relationships`. Foundry hands
// `HeroData.migrateData` the *system* object only, so a `flags` write there
// lands on `system.flags` and is pruned by the schema. The stash has to be
// written at Document level, where `source.flags` is the actor's own flags.
// Foundry discards the return value of the Document-level hook, so every
// assertion below is on the object that was passed in.

const legacyRelationships = () => [
	{ tag: "owes me", actorId: "abc", isScratched: false },
	{ tag: "sworn rival", actorId: "def", isScratched: true },
];

beforeEach(() => {
	vi.clearAllMocks();
});

describe("LitmActor.migrateData", () => {
	it("stashes a hero's legacy relationships onto the actor's flags, in place", () => {
		const rels = legacyRelationships();
		const source = { type: "hero", system: { relationships: rels } };

		LitmActor.migrateData(source);

		expect(source.flags.litmv2.legacyRelationships).toEqual(rels);
	});

	it("keeps unrelated flags alongside the stash", () => {
		const source = {
			type: "hero",
			flags: { litmv2: { other: 1 }, elsewhere: { a: 2 } },
			system: { relationships: legacyRelationships() },
		};

		LitmActor.migrateData(source);

		expect(source.flags.litmv2.other).toBe(1);
		expect(source.flags.elsewhere).toEqual({ a: 2 });
		expect(source.flags.litmv2.legacyRelationships).toHaveLength(2);
	});

	it("is idempotent: an existing stash is never overwritten", () => {
		const earlier = [{ tag: "first", actorId: "x" }];
		const source = {
			type: "hero",
			flags: { litmv2: { legacyRelationships: earlier } },
			system: { relationships: legacyRelationships() },
		};

		LitmActor.migrateData(source);
		LitmActor.migrateData(source);

		expect(source.flags.litmv2.legacyRelationships).toBe(earlier);
	});

	it.each([
		["a non-hero actor", { type: "challenge", system: { relationships: [1] } }],
		[
			"an empty relationships array",
			{ type: "hero", system: { relationships: [] } },
		],
		[
			"a non-array relationships value",
			{ type: "hero", system: { relationships: {} } },
		],
		["no relationships at all", { type: "hero", system: {} }],
		["no system data (partial update)", { type: "hero" }],
	])("leaves %s untouched", (_label, source) => {
		LitmActor.migrateData(source);
		expect(source).not.toHaveProperty("flags");
	});

	it("returns the source it was given", () => {
		const source = { type: "hero", system: { relationships: [] } };
		expect(LitmActor.migrateData(source)).toBe(source);
	});

	it("survives the system model's own migrateData running afterwards", () => {
		// Foundry's order: Document-level migrateData first, then the TypeDataModel
		// on `source.system`. The stash must outlive the system model dropping
		// `relationships`.
		const rels = legacyRelationships();
		const source = { type: "hero", system: { relationships: rels } };

		LitmActor.migrateData(source);
		HeroData.migrateData(source.system);

		expect(source.flags.litmv2.legacyRelationships).toEqual(rels);
		expect(source.system).not.toHaveProperty("relationships");
		expect(source.system).not.toHaveProperty("flags");
	});
});

describe("HeroData.migrateData", () => {
	it("drops legacy relationships without writing flags onto system data", () => {
		const system = { relationships: legacyRelationships(), promise: 2 };

		const out = HeroData.migrateData(system);

		expect(out).toBe(system);
		expect(out).not.toHaveProperty("relationships");
		expect(out).not.toHaveProperty("flags");
		expect(out.promise).toBe(2);
	});
});

describe("buildRelationshipEffects", () => {
	it("maps legacy entries to relationship_tag creation data", () => {
		expect(buildRelationshipEffects(legacyRelationships())).toEqual([
			{
				name: "owes me",
				type: "relationship_tag",
				system: { targetId: "abc", isScratched: false },
			},
			{
				name: "sworn rival",
				type: "relationship_tag",
				system: { targetId: "def", isScratched: true },
			},
		]);
	});

	it("defaults isScratched to false", () => {
		const [effect] = buildRelationshipEffects([{ tag: "t", actorId: "a" }]);
		expect(effect.system.isScratched).toBe(false);
	});

	it("skips entries missing a tag or a target", () => {
		const out = buildRelationshipEffects([
			{ tag: "", actorId: "a" },
			{ tag: "t", actorId: "" },
			{ tag: "ok", actorId: "a" },
		]);
		expect(out.map((e) => e.name)).toEqual(["ok"]);
	});
});

describe("createLegacyRelationshipEffects", () => {
	const heroWithStash = (stash, { effects = [] } = {}) => {
		const actor = fakeActor({ type: "hero", effects });
		actor.getFlag = vi.fn((scope, key) =>
			scope === "litmv2" && key === "legacyRelationships" ? stash : undefined,
		);
		return actor;
	};

	it("creates relationship_tag effects from the stash, then clears it", async () => {
		const actor = heroWithStash(legacyRelationships());

		await createLegacyRelationshipEffects(actor);

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			buildRelationshipEffects(legacyRelationships()),
		);
		expect(actor.update).toHaveBeenCalledOnce();
	});

	it("does nothing when there is no stash", async () => {
		const actor = heroWithStash(undefined);
		await createLegacyRelationshipEffects(actor);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("does nothing when relationship effects already exist", async () => {
		const actor = heroWithStash(legacyRelationships(), {
			effects: [fakeEffect({ type: "relationship_tag" })],
		});
		await createLegacyRelationshipEffects(actor);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
