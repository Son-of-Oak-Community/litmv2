import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeTagStringRe } from "../modules/system/config.js";
import { resyncAddonEffects } from "../modules/system/hooks/item-hooks.js";

beforeAll(() => {
	Object.defineProperty(CONFIG.litmv2, "tagStringRe", {
		configurable: true,
		get: () => makeTagStringRe(),
	});
});

const fakeEffect = ({ id, name, type = "story_tag", system = {}, addonId }) => ({
	id,
	name,
	type,
	system,
	getFlag: (_ns, key) => (key === "addonId" ? addonId : null),
});

const fakeActor = (effects) => ({
	effects,
	createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
});

const addon = (tags) => ({ id: "addon-1", system: { tags } });

describe("resyncAddonEffects", () => {
	it("keeps a revealed or scratched tag as it is when the addon changes", async () => {
		const thorny = fakeEffect({
			id: "thorny",
			name: "thorny",
			system: { isHidden: false, isScratched: true },
			addonId: "addon-1",
		});
		const actor = fakeActor([thorny]);

		await resyncAddonEffects(actor, addon("[thorny]"));

		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("creates added tags hidden and flagged, and deletes removed ones", async () => {
		const actor = fakeActor([
			fakeEffect({ id: "old", name: "old", addonId: "addon-1" }),
		]);

		await resyncAddonEffects(actor, addon("[bramble]"));

		const [, created] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created).toEqual([
			expect.objectContaining({
				name: "bramble",
				system: expect.objectContaining({ isHidden: true }),
				flags: { litmv2: { addonId: "addon-1" } },
			}),
		]);
		expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			["old"],
		);
	});

	it("leaves the Challenge's own tags and other addons' tags alone", async () => {
		const actor = fakeActor([
			fakeEffect({ id: "own", name: "club" }),
			fakeEffect({ id: "other", name: "fog", addonId: "addon-2" }),
		]);

		await resyncAddonEffects(actor, addon(""));

		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
