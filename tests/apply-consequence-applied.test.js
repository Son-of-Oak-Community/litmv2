import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyConsequence } from "../modules/item/action/chat-actions.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { fakeActor } from "./__helpers__/factories.js";

beforeEach(() => {
	vi.clearAllMocks();
	CONFIG.litmv2.tagStringRe = makeTagStringRe();
});

const heroWithStubs = () => {
	const actor = fakeActor({ type: "hero" });
	actor.system.addStatus = vi.fn(async () => {});
	actor.system.addStoryTag = vi.fn(async () => {});
	return actor;
};

describe("applyConsequence — structured applied records", () => {
	it("returns status records with tier and story records without", async () => {
		const actor = heroWithStubs();
		const res = await applyConsequence({
			text: "Take [wounded-2] and [tangled]",
			actor,
		});
		expect(res.applied).toEqual([
			{ kind: "status", name: "wounded", tier: 2 },
			{ kind: "story", name: "tangled" },
		]);
		expect(res.appliedSummary).toBe("[wounded-2] [tangled]");
	});

	it("resolves a variable-tier status from chosenTiers", async () => {
		const actor = heroWithStubs();
		const res = await applyConsequence({
			text: "[shaken-]",
			actor,
			chosenTiers: [3],
		});
		expect(res.applied).toEqual([{ kind: "status", name: "shaken", tier: 3 }]);
	});

	it("returns applied: [] when no tokens match", async () => {
		const actor = heroWithStubs();
		const res = await applyConsequence({ text: "just prose, no tags", actor });
		expect(res.applied).toEqual([]);
	});

	it("returns null when nothing was created (e.g. variable status left at 0)", async () => {
		const actor = heroWithStubs();
		const res = await applyConsequence({
			text: "[shaken-]",
			actor,
			chosenTiers: [0],
		});
		expect(res).toBe(null);
	});
});
