import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";
import { setPlayer } from "./__helpers__/users.js";

// A camp action is rolled from the camping wizard, which hands the dialog a
// sojourn bonus. The bonus has no form control, so it reaches the dice only
// through the dialog's own state (`extractRollData`); read off the form it was
// dropped, and the card rolled less than the window showed.

const spendPower = vi.hoisted(() => ({ opened: [] }));
vi.mock("../modules/apps/spend-power.js", () => ({
	SpendPowerApp: class {
		constructor(options) {
			this.options = options;
		}
		render(force) {
			spendPower.opened.push({ ...this.options, force });
		}
	},
}));

let actor;
let effects;
const make = (options = {}) => {
	const dialog = new LitmRollDialog({
		actorId: "hero",
		ownerId: "player",
		speaker: {},
		...options,
	});
	dialog.tabGroups = {};
	dialog.render = vi.fn();
	dialog.updatePresence = vi.fn(async () => {});
	return dialog;
};
const powerTag = (uuid) => {
	effects.set(uuid, {
		id: uuid,
		uuid,
		name: uuid,
		type: "power_tag",
		system: {},
	});
	return uuid;
};
const spendHalf = (dialog) =>
	LitmRollDialog.DEFAULT_OPTIONS.actions["spend-half"].call(dialog);

beforeEach(() => {
	vi.restoreAllMocks();
	spendPower.opened.length = 0;
	setPlayer();
	effects = new Map();
	actor = { id: "hero", name: "Hero", sheet: {}, getFlag: () => undefined };
	game.litmv2 = {};
	game.actors.get.mockReturnValue(actor);
	foundry.utils.fromUuidSync.mockImplementation(
		(uuid) => effects.get(uuid) ?? null,
	);
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	vi.spyOn(ui.notifications, "warn").mockImplementation(() => {});
});

describe("a camp action's sojourn bonus", () => {
	it("counts toward the Power the window shows and the roll gets", () => {
		const dialog = make();
		dialog.setCampAction({ sojournBonus: 2 });
		expect(dialog.type).toBe("campAction");
		expect(dialog.totalPower).toBe(2);
		expect(dialog.extractRollData()).toMatchObject({
			type: "campAction",
			modifier: 2,
		});
	});

	it("adds to the roll's modifier and its tags, on both sides alike", () => {
		const dialog = make({ modifier: 1 });
		dialog.setSelection(powerTag("bow"), "positive", "player");
		dialog.setCampAction({ sojournBonus: 3 });
		expect(dialog.totalPower).toBe(5);
		expect(dialog.extractRollData().modifier).toBe(4);
	});

	it("is nothing for a plain camp, and never less", () => {
		const dialog = make();
		dialog.setCampAction();
		expect(dialog.totalPower).toBe(0);
		for (const sojournBonus of [-2, "nonsense", null]) {
			dialog.setCampAction({ sojournBonus });
			expect(dialog.extractRollData().modifier).toBe(0);
		}
	});

	it("replaces a total cached before the bonus arrived", () => {
		const dialog = make();
		expect(dialog.totalPower).toBe(0);
		dialog.setCampAction({ sojournBonus: 1 });
		expect(dialog.totalPower).toBe(1);
	});

	it("is told to the table, whose totals include it", () => {
		const dialog = make();
		dialog.setCampAction({ sojournBonus: 2 });
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"updateRollDialog",
			expect.objectContaining({ sojournBonus: 2, type: "campAction" }),
		);
	});

	it("does not follow the roll to another move", () => {
		const dialog = make();
		dialog.setCampAction({ sojournBonus: 2 });
		dialog.setType("quick");
		expect(dialog.totalPower).toBe(0);
		expect(dialog.extractRollData()).toMatchObject({
			type: "quick",
			modifier: 0,
		});
	});
});

describe("spending half instead of rolling a camp action", () => {
	const campDialog = (tags, sojournBonus = 0) => {
		const dialog = make();
		dialog.close = vi.fn(async () => {});
		for (const id of tags)
			dialog.setSelection(powerTag(id), "positive", "player");
		dialog.setCampAction({ sojournBonus });
		return dialog;
	};

	it.each([
		[["a"], 0, 1],
		[["a", "b"], 0, 1],
		[["a", "b", "c"], 0, 2],
		[["a", "b"], 3, 3],
	])(
		"opens Spend Power with half the Power, rounded up (tags %j, bonus %i: %i)",
		async (tags, bonus, half) => {
			await spendHalf(campDialog(tags, bonus));
			expect(spendPower.opened).toEqual([
				{ actorId: "hero", power: half, force: true },
			]);
		},
	);

	it("ends the camp action: the roll is closed as done and starts over as a plain one", async () => {
		const dialog = campDialog(["a", "b"], 1);
		await spendHalf(dialog);
		expect(dialog.close).toHaveBeenCalledWith({ submitted: true });
		expect(dialog.type).toBe("quick");
		expect(dialog.totalPower).toBe(0);
		expect(dialog.selections.size).toBe(0);
	});

	it("has nothing to halve at Power 0, and says so", async () => {
		const dialog = campDialog([]);
		await spendHalf(dialog);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.camping_spend_half_no_power",
		);
		expect(spendPower.opened).toEqual([]);
		expect(dialog.close).not.toHaveBeenCalled();
		expect(dialog.type).toBe("campAction");
	});
});
