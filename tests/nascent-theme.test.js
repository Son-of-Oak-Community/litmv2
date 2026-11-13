import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeAdvancementApp } from "../modules/apps/theme-advancement.js";
import { markImprove, settleNascent } from "../modules/item/theme/nascent-theme.js";
import { ThemeData } from "../modules/item/theme/theme-data.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Core Book p.192: a replaced theme starts with its title tag only. The next
// times it would mark Improve, it gains a power tag instead, until it has
// three power tags (title tag included); then Improve works as usual.

/**
 * A theme whose `system` is a real ThemeData, so its getters run, and whose
 * update() writes back into it.
 * @param {object} o
 * @param {number} [o.power]    Power tags besides the title tag
 * @param {number} [o.nascent]  The nascent marker (0: a normal theme)
 */
function themeWith({ power = 0, nascent = 2, pending = 0, improve = 0 } = {}) {
	const owner = fakeActor({ type: "hero" });
	const effects = [
		fakeEffect({ type: "power_tag", name: "Title", system: { isTitleTag: true } }),
		...Array.from({ length: power }, (_, i) =>
			fakeEffect({ type: "power_tag", name: `power ${i}`, system: {} }),
		),
		fakeEffect({ type: "weakness_tag", name: "Restless", system: {} }),
	];
	const theme = fakeItem({ type: "theme", name: "Wanderer", parent: owner, effects });
	theme.system = new ThemeData({
		nascentImprovements: nascent,
		nascentPending: pending,
		improve: { value: improve },
	});
	theme.system.parent = theme;
	theme.update = vi.fn(async (changes) => {
		for (const [path, value] of Object.entries(changes))
			foundry.utils.setProperty(theme, path, value);
	});
	theme.createEmbeddedDocuments = vi.fn(async (_type, data) => {
		for (const d of data)
			theme.effects.push(fakeEffect({ ...d, system: d.system ?? {} }));
		return [];
	});
	owner.items = Object.assign([theme], { get: () => theme });
	return { owner, theme };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("a nascent theme", () => {
	it("owes a power tag for each Improve until it has three", () => {
		expect(themeWith().theme.system.nascentTagsToOwe).toBe(2);
		expect(themeWith({ pending: 1 }).theme.system.nascentTagsToOwe).toBe(1);
		expect(themeWith({ power: 1 }).theme.system.nascentTagsToOwe).toBe(1);
	});

	it("is a normal theme once it has three power tags, title tag included", () => {
		const { theme } = themeWith({ power: 2 });
		expect(theme.system.isNascent).toBe(false);
		expect(theme.system.nascentTagsToOwe).toBe(0);
	});

	it("needs one tag only when the old title was kept as a power tag (p.190)", () => {
		const { theme } = themeWith({ power: 1 });
		expect(theme.system.isNascent).toBe(true);
		expect(theme.system.nascentTagsToOwe).toBe(1);
	});

	it("leaves a theme that was never replaced alone, however few its tags", () => {
		const { theme } = themeWith({ nascent: 0 });
		expect(theme.system.isNascent).toBe(false);
	});
});

describe("markImprove", () => {
	it("turns an Improve mark on a nascent theme into an owed power tag", async () => {
		const { owner, theme } = themeWith();
		const info = await markImprove(theme, owner);
		expect(theme.update).toHaveBeenCalledWith({ "system.nascentPending": 1 });
		expect(theme.system.improve.value).toBe(0);
		expect(info).toMatchObject({ type: "improve", themeId: theme.id });
		expect(Hooks.callAll).toHaveBeenCalledWith(
			"litm.trackCompleted",
			expect.objectContaining({
				trackInfo: expect.objectContaining({ type: "improve" }),
			}),
		);
	});

	it("marks Improve as usual once every missing tag is owed", async () => {
		const { owner, theme } = themeWith({ pending: 2 });
		await markImprove(theme, owner);
		expect(theme.update).toHaveBeenCalledWith({ "system.improve.value": 1 });
	});

	// Clicking the third box from 0 is three marks: two owed tags, then one
	// Improve mark.
	it("owes a tag per mark, and puts the marks left over on the track", async () => {
		const { owner, theme } = themeWith();
		await markImprove(theme, owner, undefined, { marks: 3 });
		expect(theme.system.nascentPending).toBe(2);
		expect(theme.system.improve.value).toBe(1);
	});

	it("marks Improve as usual on a normal theme", async () => {
		const { owner, theme } = themeWith({ power: 2, improve: 1 });
		await markImprove(theme, owner);
		expect(theme.update).toHaveBeenCalledWith({ "system.improve.value": 2 });
	});
});

describe("adding an owed power tag", () => {
	function addPowerTag(theme, owner, name = "new tag") {
		game.actors.get = vi.fn(() => owner);
		const app = new ThemeAdvancementApp({ actorId: owner.id, themeId: theme.id });
		app.close = vi.fn();
		foundry.applications.ux = {
			FormDataExtended: class {
				object = { option: "weakness", powerName: name };
			},
		};
		return ThemeAdvancementApp.DEFAULT_OPTIONS.actions.confirm.call(app);
	}

	it("settles one owed tag without a full Improve track", async () => {
		const { owner, theme } = themeWith({ pending: 1, improve: 1 });
		await addPowerTag(theme, owner);
		expect(theme.system.powerTagCount).toBe(2);
		expect(theme.system.nascentPending).toBe(0);
		// The Improve point it replaced was never on the track to spend.
		expect(theme.system.improve.value).toBe(1);
		expect(theme.system.isNascent).toBe(true);
	});

	it("ends the nascent stage at the third power tag", async () => {
		const { owner, theme } = themeWith({ power: 1, pending: 1 });
		await addPowerTag(theme, owner);
		expect(theme.system.powerTagCount).toBe(3);
		expect(theme.system.nascentImprovements).toBe(0);
		expect(theme.system.isNascent).toBe(false);
	});

	it("adds nothing while no tag is owed and the Improve track is not full", async () => {
		const { owner, theme } = themeWith({ improve: 1 });
		await addPowerTag(theme, owner);
		expect(theme.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("leaving the nascent stage", () => {
	it("ends at the third power tag, however it was added", async () => {
		const { theme } = themeWith({ power: 2, pending: 1 });
		await settleNascent(theme);
		expect(theme.system.nascentImprovements).toBe(0);
		expect(theme.system.nascentPending).toBe(0);
	});

	it("does not come back when the theme later loses a power tag", async () => {
		const { theme } = themeWith({ power: 2 });
		await settleNascent(theme);
		theme.effects.splice(1, 1);
		expect(theme.system.powerTagCount).toBe(2);
		expect(theme.system.isNascent).toBe(false);
	});

	it("leaves a theme still short of three power tags nascent", async () => {
		const { theme } = themeWith({ power: 1 });
		await settleNascent(theme);
		expect(theme.update).not.toHaveBeenCalled();
	});

	it("owes nothing once it is no longer nascent, whatever was stored", () => {
		const { theme } = themeWith({ power: 2, pending: 1 });
		expect(theme.system.owedPowerTags).toBe(0);
	});
});
