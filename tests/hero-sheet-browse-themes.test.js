import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSheet } from "../modules/actor/hero/hero-sheet.js";

describe("HeroSheet browseThemes on a hero with no themes", () => {
	const browse = HeroSheet.DEFAULT_OPTIONS.actions.browseThemes;
	let onPick;
	const makeSheet = (dropResult) => ({
		document: { items: [] },
		_onDropItem: vi.fn(async () => dropResult),
	});

	beforeEach(() => {
		game.litmv2 = {
			ThemeBrowser: class {
				constructor(options) {
					onPick = options.onPick;
				}
				render() {}
			},
		};
	});
	afterEach(() => {
		delete game.litmv2;
	});

	it("adds the kit through the drop handler and closes the browser", async () => {
		const kit = { type: "theme" };
		foundry.utils.fromUuid.mockResolvedValueOnce(kit);
		const sheet = makeSheet([{ id: "new" }]);
		browse.call(sheet);
		expect(await onPick({ uuid: "Compendium.x.Item.kit" })).toBe(true);
		expect(sheet._onDropItem).toHaveBeenCalledWith(expect.any(Event), kit);
	});

	it("explains that a themebook needs a theme, without loading it", async () => {
		const warn = vi.spyOn(ui.notifications, "warn");
		const sheet = makeSheet([{ id: "new" }]);
		browse.call(sheet);
		expect(await onPick({ uuid: "Compendium.x.Item.book", kind: "book" })).toBe(
			false,
		);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.warn_themebook_no_theme");
		expect(foundry.utils.fromUuid).not.toHaveBeenCalled();
		expect(sheet._onDropItem).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("keeps the browser open when the drop handler refuses it", async () => {
		// A Fellowship theme, say: the drop handler refuses it.
		foundry.utils.fromUuid.mockResolvedValueOnce({ type: "theme" });
		// A refusal returns the warning, not created items.
		const sheet = makeSheet({ message: "warned" });
		browse.call(sheet);
		expect(await onPick({ uuid: "Compendium.x.Item.book" })).toBe(false);
	});

	it("keeps the browser open when the entry no longer resolves", async () => {
		const sheet = makeSheet([]);
		browse.call(sheet);
		expect(await onPick({ uuid: "Compendium.x.Item.gone" })).toBe(false);
		expect(sheet._onDropItem).not.toHaveBeenCalled();
	});
});
