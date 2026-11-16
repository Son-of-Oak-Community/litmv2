import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";
import { setPlayer } from "./__helpers__/users.js";

// `LitmRollDialog#reset` runs once a roll has been made (`executeRoll`, and
// the `resetRollDialog` socket on every other client). The next roll for this
// Hero is a new one: nothing the last roll chose, was granted or was called
// with may ride along, and the Narrator's stamp must not lock a roll the
// player starts on their own.

let actor;
beforeEach(() => {
	vi.restoreAllMocks();
	setPlayer();
	game.litmv2 = {};
	actor = {
		id: "hero",
		name: "Hero",
		sheet: { rendered: false, render: vi.fn() },
		getFlag: () => undefined,
		items: [{ id: "theme", type: "theme", system: {}, effects: [] }],
	};
	game.actors.get.mockReturnValue(actor);
	foundry.utils.fromUuidSync.mockImplementation((uuid) => ({
		id: uuid,
		uuid,
		name: uuid,
		type: "power_tag",
		system: {},
	}));
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
});

/** A called Sacrifice with every piece of roll state set to something. */
const usedDialog = () => {
	const dialog = new LitmRollDialog({
		actorId: "hero",
		ownerId: "player",
		speaker: {},
	});
	dialog.tabGroups = {};
	dialog.render = vi.fn();
	dialog.close = vi.fn(async () => {});
	dialog.updatePresence = vi.fn(async () => {});
	dialog.configureSharedRoll({
		ownerId: "player",
		type: "tracked",
		title: "Cross the bridge",
		actionUuid: "Item.cross",
		participantIds: ["h1", "h2"],
		narratorUserId: "gm",
		narratorName: "GM",
		syncSession: "call-1",
	});
	dialog.setSelection("bow", "positive", "player");
	dialog.setSelection("fog", "negative", "gm", { narrator: true });
	return dialog;
};
const narratorSets = (dialog, fields) =>
	dialog.receiveUpdate({ actorId: "hero", ...fields });

describe("LitmRollDialog#reset", () => {
	it("clears every tag picked for the roll, the Narrator's included", () => {
		const dialog = usedDialog();
		expect(dialog.totalPower).toBe(0);
		dialog.reset();
		expect(dialog.selections.size).toBe(0);
		expect(dialog.extractRollData().tags).toEqual([]);
	});

	it("starts the next roll from Might 0, no modifier and no Trade Power", async () => {
		const dialog = usedDialog();
		await narratorSets(dialog, { might: 3, modifier: 2, tradePower: 1 });
		expect(dialog.totalPower).toBe(5);
		dialog.reset();
		expect(dialog.totalPower).toBe(0);
		expect(dialog.extractRollData()).toMatchObject({
			might: 0,
			modifier: 0,
			tradePower: 0,
		});
	});

	it("goes back to a Quick roll with no title, Action or Reaction context", () => {
		const dialog = usedDialog();
		dialog.setType("mitigate");
		dialog.setMitigation({ name: "burning-3" });
		dialog.reset();
		expect(dialog.type).toBe("quick");
		expect(dialog.rollName).toBe("");
		expect(dialog.actionUuid).toBeNull();
		dialog.type = "mitigate";
		expect(dialog.extractRollData().mitigation).toBeNull();
	});

	it("forgets a Sacrifice's terms and the Narrator's Secret Grace", async () => {
		const dialog = usedDialog();
		dialog.setType("sacrifice");
		await narratorSets(dialog, {
			sacrificeBonus: 2,
			sacrificeLevel: "grave",
			sacrificeThemeId: "theme",
			sacrificeStatusName: "Doomed",
		});
		expect(dialog.extractRollData()).toMatchObject({
			sacrificeBonus: 2,
			sacrificeLevel: "grave",
			sacrificeThemeId: "theme",
			sacrificeStatusName: "Doomed",
		});

		dialog.reset();
		// Read as a Sacrifice again, which is the only move that reports them.
		dialog.type = "sacrifice";
		expect(dialog.extractRollData()).toMatchObject({
			sacrificeBonus: 0,
			sacrificeLevel: "painful",
			sacrificeThemeId: null,
		});
		dialog.type = "quick";
	});

	it("does not remember the move a Sacrifice replaced", () => {
		const dialog = usedDialog();
		dialog.setType("sacrifice");
		dialog.dispatchSync();
		const told = () =>
			Sockets.dispatch.mock.calls.findLast(
				([event]) => event === "updateRollDialog",
			)[1];
		expect(told().moveBeforeSacrifice).toBe("tracked");
		dialog.reset();
		dialog.dispatchSync();
		expect(told()).toMatchObject({ type: "quick", moveBeforeSacrifice: null });
	});

	it("drops a camp action's sojourn bonus", () => {
		const dialog = usedDialog();
		dialog.setCampAction({ sojournBonus: 3 });
		dialog.reset();
		expect(dialog.totalPower).toBe(0);
		expect(dialog.extractRollData().modifier).toBe(0);
	});

	it("releases the Narrator's stamp, so the next roll's move is the roller's again", () => {
		const dialog = usedDialog();
		expect(dialog.canSetNarratorFields).toBe(false);
		dialog.reset();
		expect(dialog.narratorCall).toBeNull();
		expect(dialog.canSetNarratorFields).toBe(true);
		dialog.setType("tracked");
		expect(dialog.type).toBe("tracked");
	});

	it("is no longer an Acting Together roll's record of who took part", () => {
		const dialog = usedDialog();
		dialog.reset();
		expect(dialog.participantIds).toEqual([]);
	});

	// Closing is `_onSubmit`'s, and the `closeRollDialog` socket's on viewers.
	// A close here was a second close per roll, which tore down a window the
	// player had just reopened.
	it("changes state only: it does not close the window", () => {
		const dialog = usedDialog();
		dialog.reset();
		expect(dialog.close).not.toHaveBeenCalled();
	});

	it("redraws the Hero's sheet, whose tags showed the roll's picks", () => {
		const dialog = usedDialog();
		dialog.reset();
		expect(actor.sheet.render).not.toHaveBeenCalled();
		actor.sheet.rendered = true;
		dialog.reset();
		expect(actor.sheet.render).toHaveBeenCalledWith(true);
	});
});
