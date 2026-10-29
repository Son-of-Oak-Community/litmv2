import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

const addon = (tags, { hasPlayerOwner = false } = {}) => ({
	id: "addon-1",
	parent: { hasPlayerOwner },
	system: { tags },
});

describe("resyncAddonEffects", () => {
	const isGM = game.user.isGM;
	afterEach(() => {
		game.user.isGM = isGM;
	});

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
		game.user.isGM = true;
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

	it("creates them visible on a Challenge a player owns", async () => {
		game.user.isGM = true;
		const actor = fakeActor([]);

		await resyncAddonEffects(actor, addon("[bramble]", { hasPlayerOwner: true }));

		const [, created] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(created[0].system.isHidden).toBe(false);
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

describe("resyncAddonEffects queue", () => {
	it("lets a second quick edit see what the first created", async () => {
		game.user.isGM = true;
		const effects = [];
		const actor = {
			effects,
			createEmbeddedDocuments: vi.fn(async (_type, data) => {
				// The server round trip: the first run is still awaiting here
				// when the second edit arrives.
				await new Promise((res) => setTimeout(res, 5));
				const created = data.map((d, i) =>
					fakeEffect({
						id: `new-${effects.length + i}`,
						name: d.name,
						system: d.system,
						addonId: d.flags.litmv2.addonId,
					}),
				);
				effects.push(...created);
				return created;
			}),
			updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
			deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		};
		const item = addon("[bramble]");

		await Promise.all([
			resyncAddonEffects(actor, item),
			resyncAddonEffects(actor, item),
		]);

		expect(effects.map((e) => e.name)).toEqual(["bramble"]);
	});
});
