import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";
import { withFlags } from "./__helpers__/flags.js";
import { setGM, setPlayer } from "./__helpers__/users.js";

// `LitmRollDialog#rollRefusal`: the one gate Roll, Send to Narrator and the
// Narrator's Roll command all pass. Its parts are stubbed where the callers
// are tested (roll-submit-close, roll-dialog-lifecycle); here it runs for
// real, against a Hero's themes and the Sacrifice they still owe (p.159).

const FELLOWSHIP = "fel";

const powerTag = (scratched) => ({
	type: "power_tag",
	disabled: false,
	system: { isScratched: scratched },
});
const theme = (id, { spent = false } = {}) => ({
	id,
	type: "theme",
	system: {},
	effects: [powerTag(spent)],
});

let actors;
const hero = (
	id,
	{ owes = false, items = [theme("t1")], isOwner = true } = {},
) => {
	const actor = withFlags(
		{ id, name: id, type: "hero", isOwner, items, sheet: {} },
		owes ? { litmv2: { pendingSacrifice: { level: "painful" } } } : {},
	);
	actors.set(id, actor);
	return actor;
};
const make = (options = {}) => {
	const dialog = new LitmRollDialog({
		actorId: "hero",
		ownerId: game.user.id,
		speaker: {},
		...options,
	});
	dialog.tabGroups = {};
	dialog.render = vi.fn();
	dialog.updatePresence = vi.fn(async () => {});
	return dialog;
};
const sacrifice = (options = {}) => make({ type: "sacrifice", ...options });

let warn;
beforeEach(() => {
	vi.restoreAllMocks();
	actors = new Map();
	game.litmv2 = {};
	game.actors.get.mockImplementation((id) => actors.get(id) ?? null);
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	warn = vi.spyOn(ui.notifications, "warn").mockImplementation(() => {});
	setPlayer();
});

describe("a roll with nothing in its way", () => {
	it("is not refused", () => {
		hero("hero");
		expect(make().rollRefusal()).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("is not refused as a Sacrifice once its theme is chosen", () => {
		hero("hero");
		expect(sacrifice({ sacrificeThemeId: "t1" }).rollRefusal()).toBeNull();
	});
});

describe("a Hero who still owes a Sacrifice", () => {
	it("is refused the next roll, and the Narrators are told", () => {
		hero("hero", { owes: true });
		expect(make().rollRefusal()).toBe("unpaidSacrifice");
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_warning");
		expect(Sockets.dispatch).toHaveBeenCalledWith("unpaidSacrifice", {
			actorIds: ["hero"],
		});
	});

	it("keeps the window, and the roll, when Roll is pressed", async () => {
		hero("hero", { owes: true });
		const dialog = make();
		dialog.close = vi.fn();
		const extract = vi.spyOn(dialog, "extractRollData");
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});
		expect(extract).not.toHaveBeenCalled();
		expect(dialog.close).not.toHaveBeenCalled();
	});

	it("only reminds the Narrator, who may roll for them", () => {
		setGM();
		hero("hero", { owes: true, isOwner: false });
		expect(make().rollRefusal()).toBeNull();
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_reminder");
	});

	it("is refused a second Sacrifice even from the Narrator", () => {
		setGM();
		hero("hero", { owes: true, isOwner: false });
		expect(sacrifice({ sacrificeThemeId: "t1" }).rollRefusal()).toBe(
			"unpaidSacrifice",
		);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_new");
	});

	it("is refused a second Sacrifice when the Narrator presses Roll for them, quietly on their client", () => {
		hero("hero", { owes: true });
		expect(
			sacrifice({ sacrificeThemeId: "t1" }).rollRefusal({ narrator: true }),
		).toBe("unpaidSacrifice");
		expect(warn).not.toHaveBeenCalled();
	});

	it("is told as the roll window opens, without telling the Narrator a roll was refused", () => {
		hero("hero", { owes: true });
		const dialog = make();
		dialog.element = { addEventListener: () => {} };
		dialog._onFirstRender({}, {});
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_warning");
		expect(Sockets.dispatch).not.toHaveBeenCalledWith(
			"unpaidSacrifice",
			expect.anything(),
		);
	});
});

// Acting Together rides the Fellowship, which owes nothing itself: the debts
// are its Heroes'.
describe("an Acting Together roll with a Hero who owes", () => {
	const groupRoll = () => {
		setGM();
		const fellowship = {
			id: FELLOWSHIP,
			name: "Fellowship",
			type: "fellowship",
			getFlag: () => undefined,
			items: [],
			sheet: {},
		};
		actors.set(FELLOWSHIP, fellowship);
		game.litmv2 = { fellowship };
		hero("h1", { isOwner: false });
		hero("h2", { owes: true, isOwner: false });
		const dialog = make({ actorId: FELLOWSHIP });
		dialog.configureSharedRoll({
			ownerId: "gm",
			narratorUserId: "gm",
			participantIds: ["h1", "h2"],
		});
		return dialog;
	};

	it("reminds the Narrator of the participant's debt and lets them roll", () => {
		const dialog = groupRoll();
		expect(dialog.rollRefusal()).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_reminder");
	});

	it("says nothing when no participant owes", () => {
		const dialog = groupRoll();
		actors.get("h2").flags = {};
		expect(dialog.rollRefusal()).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("a Painful Sacrifice with nothing left to scratch", () => {
	const allSpent = () =>
		hero("hero", {
			items: [theme("t1", { spent: true }), theme("t2", { spent: true })],
		});

	it("is refused when every theme is spent", () => {
		allSpent();
		expect(sacrifice().rollRefusal()).toBe("sacrifice");
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_all_spent_warning");
	});

	// "Choose a theme" would be the wrong advice: none can be chosen.
	it("is refused for that reason before the missing theme is", () => {
		allSpent();
		sacrifice().rollRefusal();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).not.toHaveBeenCalledWith(
			"LITM.Ui.sacrifice_choose_theme_warning",
		);
	});

	it("asks for a theme instead while one still has a tag to scratch", () => {
		hero("hero", { items: [theme("t1", { spent: true }), theme("t2")] });
		expect(sacrifice().rollRefusal()).toBe("sacrificeTheme");
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_choose_theme_warning");
	});

	it("does not hold a Scarring or Grave price, which take the theme whole", () => {
		allSpent();
		for (const sacrificeLevel of ["scarring", "grave"])
			expect(
				sacrifice({ sacrificeLevel, sacrificeThemeId: "t1" }).rollRefusal(),
			).toBeNull();
	});

	it("does not hold any other move", () => {
		allSpent();
		expect(make({ type: "quick" }).rollRefusal()).toBeNull();
	});

	it("is not counted against a Hero with no theme at all", () => {
		hero("hero", { items: [] });
		expect(sacrifice().rollRefusal()).toBeNull();
	});

	it("leaves the Fellowship's theme out of the reckoning", () => {
		hero("hero", {
			items: [
				theme("t1", { spent: true }),
				{ ...theme("f"), system: { isFellowship: true } },
			],
		});
		expect(sacrifice().rollRefusal()).toBe("sacrifice");
	});

	it("stays off the player's screen when the Narrator pressed Roll", () => {
		allSpent();
		expect(sacrifice().rollRefusal({ narrator: true })).toBe("sacrifice");
		expect(warn).not.toHaveBeenCalled();
	});
});
