import { describe, expect, it, vi } from "vitest";
import { reconcileTagEffects } from "../modules/active-effects/effect-factories.js";

// reconcileTagEffects converges a document's tag effects onto a desired list:
// the edit-mode tag string of a Challenge or Journey, or an addon's tags. An
// effect that is still wanted is kept and only its declared fields follow the
// string (name casing, a status's tiers, a story tag's single use). What play
// did to it (scratched, revealed) is never written back.

const tiers = (n) => Array.from({ length: 6 }, (_, i) => i + 1 === n);

const effect = (id, name, type = "story_tag", system = {}) => ({
	id,
	name,
	type,
	system,
});

const docWith = (effects) => ({
	effects,
	createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
});

const story = (name, system = {}) => ({ name, type: "story_tag", system });
const status = (name, tier) => ({
	name,
	type: "status_tag",
	system: { tiers: tiers(tier) },
});

const updates = (doc) => doc.updateEmbeddedDocuments.mock.calls[0]?.[1];

describe("reconcileTagEffects: an effect that is still wanted", () => {
	it("takes the new tier of a status", async () => {
		const doc = docWith([
			effect("s1", "drenched", "status_tag", { tiers: tiers(2) }),
		]);

		await reconcileTagEffects(doc, [status("drenched", 3)]);

		expect(doc.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(doc.updateEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{ _id: "s1", "system.tiers": tiers(3) },
		]);
		expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(doc.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("clears a status made tier-less", async () => {
		const doc = docWith([
			effect("s1", "drenched", "status_tag", { tiers: tiers(2) }),
		]);

		await reconcileTagEffects(doc, [status("drenched", 0)]);

		expect(updates(doc)).toEqual([{ _id: "s1", "system.tiers": tiers(0) }]);
	});

	it("marks a status stored without a track", async () => {
		const doc = docWith([effect("s1", "drenched", "status_tag", {})]);

		await reconcileTagEffects(doc, [status("drenched", 1)]);

		expect(updates(doc)).toEqual([{ _id: "s1", "system.tiers": tiers(1) }]);
	});

	it("leaves a status at the same tier alone", async () => {
		const doc = docWith([
			effect("s1", "drenched", "status_tag", { tiers: tiers(2) }),
		]);

		await reconcileTagEffects(doc, [status("drenched", 2)]);

		expect(doc.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("makes a story tag single-use, and back", async () => {
		const doc = docWith([
			effect("t1", "rope", "story_tag", { isSingleUse: false }),
			effect("t2", "flask", "story_tag", { isSingleUse: true }),
		]);

		await reconcileTagEffects(doc, [
			story("rope", { isSingleUse: true }),
			story("flask", { isSingleUse: false }),
		]);

		expect(updates(doc)).toEqual([
			{ _id: "t1", "system.isSingleUse": true },
			{ _id: "t2", "system.isSingleUse": false },
		]);
	});

	it("leaves single use alone when the desired data does not say", async () => {
		const doc = docWith([
			effect("t1", "rope", "story_tag", { isSingleUse: true }),
		]);

		await reconcileTagEffects(doc, [story("rope")]);

		expect(doc.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("takes the name as it is now written, matched whatever its case", async () => {
		const doc = docWith([effect("t1", "rope")]);

		await reconcileTagEffects(doc, [story("  Rope ")]);

		expect(updates(doc)).toEqual([{ _id: "t1", name: "Rope" }]);
		expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(doc.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("never writes back what play did to it", async () => {
		const doc = docWith([
			effect("t1", "rope", "story_tag", {
				isScratched: true,
				isHidden: false,
				isSingleUse: false,
			}),
		]);

		await reconcileTagEffects(doc, [
			story("rope", { isScratched: false, isHidden: true, isSingleUse: true }),
		]);

		expect(updates(doc)).toEqual([{ _id: "t1", "system.isSingleUse": true }]);
	});

	it("sends every change in one update", async () => {
		const doc = docWith([
			effect("s1", "drenched", "status_tag", { tiers: tiers(1) }),
			effect("t1", "rope"),
			effect("t2", "fog"),
		]);

		await reconcileTagEffects(doc, [
			status("Drenched", 4),
			story("Rope"),
			story("fog"),
		]);

		expect(doc.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(updates(doc)).toEqual([
			{ _id: "s1", name: "Drenched", "system.tiers": tiers(4) },
			{ _id: "t1", name: "Rope" },
		]);
	});
});

describe("reconcileTagEffects: matching", () => {
	it("keeps a story tag and a status of the same name apart", async () => {
		const doc = docWith([effect("t1", "storm")]);

		await reconcileTagEffects(doc, [status("storm", 2)]);

		expect(doc.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"t1",
		]);
		expect(doc.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			status("storm", 2),
		]);
		expect(doc.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("uses the first of two desired entries with the same name", async () => {
		const doc = docWith([
			effect("s1", "drenched", "status_tag", { tiers: tiers(1) }),
		]);

		await reconcileTagEffects(doc, [
			status("drenched", 2),
			status("Drenched", 5),
			story("rope"),
			story("ROPE"),
		]);

		expect(updates(doc)).toEqual([{ _id: "s1", "system.tiers": tiers(2) }]);
		expect(doc.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			story("rope"),
		]);
	});

	it("deletes the second of two existing effects with the same name", async () => {
		const doc = docWith([effect("t1", "rope"), effect("t2", "Rope")]);

		await reconcileTagEffects(doc, [story("rope")]);

		expect(doc.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"t2",
		]);
	});

	it("with no filter, takes part in every effect on the document", async () => {
		const doc = docWith([effect("t1", "rope"), effect("t2", "fog")]);

		await reconcileTagEffects(doc, [story("rope")]);

		expect(doc.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"t2",
		]);
	});

	it("never updates or deletes an effect the filter leaves out", async () => {
		const doc = docWith([
			effect("mine", "rope", "story_tag", { isSingleUse: false }),
			effect("other", "fog"),
		]);

		await reconcileTagEffects(doc, [], { filter: (e) => e.id === "mine" });

		expect(doc.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"mine",
		]);

		const second = docWith([effect("other", "rope", "story_tag", {})]);
		await reconcileTagEffects(second, [story("Rope", { isSingleUse: true })], {
			filter: () => false,
		});

		expect(second.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(second.createEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[story("Rope", { isSingleUse: true })],
		);
	});

	it("deletes, then updates, then creates", async () => {
		const doc = docWith([effect("t1", "rope"), effect("t2", "fog")]);

		await reconcileTagEffects(doc, [story("Rope"), story("lantern")]);

		const order = (fn) => fn.mock.invocationCallOrder[0];
		expect(order(doc.deleteEmbeddedDocuments)).toBeLessThan(
			order(doc.updateEmbeddedDocuments),
		);
		expect(order(doc.updateEmbeddedDocuments)).toBeLessThan(
			order(doc.createEmbeddedDocuments),
		);
	});

	it("writes nothing when the effects already match", async () => {
		const doc = docWith([
			effect("t1", "rope", "story_tag", { isSingleUse: false }),
			effect("s1", "drenched", "status_tag", { tiers: tiers(2) }),
		]);

		await reconcileTagEffects(doc, [
			story("rope", { isSingleUse: false }),
			status("drenched", 2),
		]);

		expect(doc.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(doc.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
