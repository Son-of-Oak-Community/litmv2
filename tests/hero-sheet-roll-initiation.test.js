import { beforeEach, describe, expect, it, vi } from "vitest";
import { scratchTag } from "../modules/active-effects/scratchable-mixin.js";
import { HeroSheet } from "../modules/actor/hero/hero-sheet.js";

vi.mock("../modules/active-effects/scratchable-mixin.js", async (original) => ({
	...(await original()),
	scratchTag: vi.fn(),
}));

function makeSheet({ rendered = false, flag = null } = {}) {
	const tag = {
		id: "tag",
		uuid: "Actor.hero.ActiveEffect.tag",
		type: "power_tag",
		system: {
			allowedStates: ",positive,negative,scratched",
			toggleScratch: vi.fn(),
		},
	};
	const dialog = {
		rendered,
		getSelection: vi.fn(() => ({ state: "" })),
		setCharacterTagState: vi.fn(),
		render: vi.fn(),
	};
	const actor = {
		isOwner: true,
		getFlag: vi.fn(() => flag),
		allApplicableEffects: () => [tag],
	};
	return {
		document: actor,
		hasRollDialog: true,
		rollDialogInstance: dialog,
		_buildAllRollTags: () => [tag],
		renderRollDialog: vi.fn(),
		render: vi.fn(),
	};
}

const clickTag = (sheet, event = {}) =>
	HeroSheet.DEFAULT_OPTIONS.actions.selectTag.call(
		sheet,
		{ detail: 1, ...event },
		{ dataset: { tagId: "tag" } },
	);

describe("Hero sheet roll initiation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		game.user = { id: "player", isGM: false };
		game.settings.get.mockReturnValue(false);
	});

	it.each([
		false,
		true,
	])("blocks a new sheet tag-click roll (shiftKey=%s) when player initiation is off", async (shiftKey) => {
		const sheet = makeSheet();
		await clickTag(sheet, { shiftKey });
		expect(
			sheet.rollDialogInstance.setCharacterTagState,
		).not.toHaveBeenCalled();
		expect(sheet.renderRollDialog).not.toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalled();
	});

	it("uses the same gate for the programmatic tag-selection entry", () => {
		const sheet = makeSheet();
		HeroSheet.prototype.selectTagForRoll.call(sheet, "power_tag", "tag");
		expect(
			sheet.rollDialogInstance.setCharacterTagState,
		).not.toHaveBeenCalled();
		expect(sheet.renderRollDialog).not.toHaveBeenCalled();
	});

	it.each([
		{ rendered: true },
		{ flag: { ownerId: "player", narrator: true } },
	])("allows contributing to an existing roll: %j", async (options) => {
		const sheet = makeSheet(options);
		await clickTag(sheet);
		expect(sheet.rollDialogInstance.setCharacterTagState).toHaveBeenCalledWith(
			"Actor.hero.ActiveEffect.tag",
			"positive",
		);
		expect(ui.notifications.info).not.toHaveBeenCalled();
	});

	it("keeps programmatic contributions to an existing call available", () => {
		const sheet = makeSheet({ flag: { ownerId: "player", narrator: true } });
		HeroSheet.prototype.selectTagForRoll.call(sheet, "power_tag", "tag");
		expect(sheet.rollDialogInstance.setCharacterTagState).toHaveBeenCalled();
	});

	it("does not gate alt-click scratch bookkeeping", async () => {
		const sheet = makeSheet();
		await clickTag(sheet, { altKey: true });
		expect(scratchTag).toHaveBeenCalledWith(
			sheet.document,
			sheet._buildAllRollTags()[0],
		);
		expect(sheet.renderRollDialog).not.toHaveBeenCalled();
		expect(ui.notifications.info).not.toHaveBeenCalled();
	});

	it.each(["gm", "enabled-player"])("allows %s to initiate", async (mode) => {
		if (mode === "gm") game.user.isGM = true;
		else game.settings.get.mockReturnValue(true);
		const sheet = makeSheet();
		await clickTag(sheet);
		expect(sheet.renderRollDialog).toHaveBeenCalledOnce();
	});
});
