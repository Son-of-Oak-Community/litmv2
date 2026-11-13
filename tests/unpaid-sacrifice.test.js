import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	refuseUnpaidSacrifice,
	requestRollFromNarrator,
} from "../modules/apps/roll/roll-request.js";
import {
	completePendingSacrifice,
	recordPendingSacrifice,
} from "../modules/apps/roll/sacrifice-price.js";
import { executeRoll } from "../modules/apps/roll/roll-pipeline.js";
import { debtPrice } from "../modules/hud/sacrifice-hud.js";
import { Sockets } from "../modules/system/sockets.js";

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

// Core Book p.159: a Sacrifice's price is paid, not deferred. The debt is kept
// on the Hero (flags.litmv2.pendingSacrifice), so a player whose Hero owes one
// is refused the next roll and the Narrator is told; the Narrator is reminded.
const hero = (id, { isOwner = true, owes = false } = {}) => ({
	id,
	name: id,
	isOwner,
	getFlag: (scope, key) =>
		scope === "litmv2" && key === "pendingSacrifice" && owes
			? { level: "painful", outcome: "snc", themeId: "t" }
			: undefined,
});

describe("refuseUnpaidSacrifice", () => {
	let warn;
	beforeEach(() => {
		warn = vi.spyOn(ui.notifications, "warn");
		game.user = { id: "player", isGM: false };
	});
	afterEach(() => {
		warn.mockRestore();
		vi.mocked(Sockets.dispatch).mockClear();
	});

	it("lets a Hero with nothing owed roll", () => {
		expect(refuseUnpaidSacrifice(hero("gerrin"))).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});

	it("refuses a player and tells the Narrator", () => {
		expect(refuseUnpaidSacrifice(hero("gerrin", { owes: true }))).toBe(true);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_warning");
		expect(Sockets.dispatch).toHaveBeenCalledWith("unpaidSacrifice", {
			actorIds: ["gerrin"],
		});
	});

	it("only reminds the Narrator, never refuses them", () => {
		game.user = { id: "gm", isGM: true };
		const owing = hero("gerrin", { isOwner: false, owes: true });
		expect(refuseUnpaidSacrifice(owing)).toBe(false);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_reminder");
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("stays quiet on a player's client running the Narrator's Roll", () => {
		const owing = hero("gerrin", { owes: true });
		expect(refuseUnpaidSacrifice(owing, { byNarrator: true })).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns early without telling the Narrator a roll was refused", () => {
		const owing = hero("gerrin", { owes: true });
		expect(refuseUnpaidSacrifice(owing, { tellNarrator: false })).toBe(true);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_warning");
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("refuses even the Narrator a new Sacrifice while one is owed", () => {
		game.user = { id: "gm", isGM: true };
		const owing = hero("gerrin", { isOwner: false, owes: true });
		expect(refuseUnpaidSacrifice(owing, { newSacrifice: true })).toBe(true);
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_new");
	});

	it("treats a player's client acting on the Narrator's Roll as the Narrator", () => {
		const owing = hero("gerrin", { owes: true });
		expect(refuseUnpaidSacrifice(owing, { byNarrator: true })).toBe(false);
		expect(
			refuseUnpaidSacrifice(owing, { byNarrator: true, newSacrifice: true }),
		).toBe(true);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("checks every Acting Together participant, a player only for Heroes they own", () => {
		const group = [
			hero("gerrin", { owes: true }),
			hero("mira", { isOwner: false, owes: true }),
			hero("tal"),
		];
		expect(refuseUnpaidSacrifice(group)).toBe(true);
		expect(Sockets.dispatch).toHaveBeenCalledWith("unpaidSacrifice", {
			actorIds: ["gerrin"],
		});

		game.user = { id: "gm", isGM: true };
		warn.mockClear();
		refuseUnpaidSacrifice(group);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("recordPendingSacrifice", () => {
	it("keeps the price, the roll's outcome and its card on the Hero", async () => {
		const actor = { isOwner: true, setFlag: vi.fn() };
		const roll = {
			litm: {
				sacrificeLevel: "grave",
				sacrificeThemeId: "t1",
				sacrificeStatusName: "Dead",
			},
			outcome: { label: "success" },
		};
		await recordPendingSacrifice(actor, roll, { id: "m1" });
		expect(actor.setFlag).toHaveBeenCalledWith("litmv2", "pendingSacrifice", {
			level: "grave",
			outcome: "success",
			themeId: "t1",
			statusName: "Dead",
			messageId: "m1",
			graceBonus: 0,
		});
	});

	it("leaves a Hero this client does not own alone", () => {
		const actor = { isOwner: false, setFlag: vi.fn() };
		recordPendingSacrifice(actor, { litm: {} }, { id: "m1" });
		expect(actor.setFlag).not.toHaveBeenCalled();
	});
});

describe("completePendingSacrifice", () => {
	// A Grave debt: one confirmation, then a status. The dialog stub settles
	// (or not) the debt from "another client" while it is open.
	const graveHero = () => {
		const hero = {
			id: "gerrin",
			name: "Gerrin",
			isOwner: true,
			flag: { level: "grave", outcome: "snc", statusName: "Dead", messageId: "m1" },
			getFlag: (_scope, key) => (key === "pendingSacrifice" ? hero.flag : undefined),
			unsetFlag: vi.fn(async () => {
				hero.flag = undefined;
			}),
			system: { addStatus: vi.fn() },
			items: { get: () => null },
			testUserPermission: (user) => user.id === "player" || user.isGM,
		};
		return hero;
	};
	let wait;
	let savedUsers;
	// The Hero's player is online, so they are the one who pays.
	const table = (...users) =>
		Object.assign(users, { activeGM: users.find((u) => u.isGM) ?? null });
	beforeEach(() => {
		wait = vi.spyOn(foundry.applications.api.DialogV2, "wait");
		game.user = { id: "player", isGM: false };
		savedUsers = game.users;
		game.users = table(
			{ id: "player", isGM: false, active: true },
			{ id: "gm", isGM: true, active: true },
		);
	});
	afterEach(() => {
		wait.mockRestore();
		game.users = savedUsers;
	});

	it("pays the price and clears the debt", async () => {
		const hero = graveHero();
		wait.mockResolvedValue(true);
		expect(await completePendingSacrifice(hero)).toBe(true);
		expect(hero.system.addStatus).toHaveBeenCalledWith("Dead", { tier: 6 });
		expect(hero.unsetFlag).toHaveBeenCalled();
	});

	it("applies nothing when the debt was forgiven while the dialog was open", async () => {
		const hero = graveHero();
		wait.mockImplementation(async () => {
			hero.flag = undefined; // the Narrator forgave it meanwhile
			return true; // and then the player pressed Complete
		});
		const info = vi.spyOn(ui.notifications, "info");
		expect(await completePendingSacrifice(hero)).toBe(false);
		expect(hero.system.addStatus).not.toHaveBeenCalled();
		expect(hero.unsetFlag).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith("LITM.Ui.sacrifice_already_settled");
		info.mockRestore();
	});

	// Vol. II p.78: the Secret Grace is spent with the price, not at the roll.
	const gracedHero = () => {
		const hero = graveHero();
		hero.flag.graceBonus = 1;
		hero.grace = [
			{ id: "a", text: "Spared the wolf", scratched: false },
			{ id: "b", text: "Shared her bread", scratched: false },
		];
		hero.getFlag = (_scope, key) =>
			key === "pendingSacrifice"
				? hero.flag
				: key === "secretGrace"
					? hero.grace
					: undefined;
		hero.setFlag = vi.fn(async (_scope, key, value) => {
			if (key === "secretGrace") hero.grace = value;
		});
		return hero;
	};

	it("spends the Secret Grace Bonus once the price is paid", async () => {
		const hero = gracedHero();
		wait.mockResolvedValue(true);
		expect(await completePendingSacrifice(hero)).toBe(true);
		expect(hero.grace.map((m) => m.scratched)).toEqual([true, false]);
	});

	it("keeps the Secret Grace when the Narrator forgives the price", async () => {
		const hero = gracedHero();
		game.user = { id: "gm", isGM: true };
		wait.mockImplementation(async ({ buttons }) =>
			buttons.find((b) => b.action === "forgive").callback(),
		);
		expect(await completePendingSacrifice(hero)).toBe(true);
		expect(hero.system.addStatus).not.toHaveBeenCalled();
		expect(hero.grace.every((m) => !m.scratched)).toBe(true);
	});

	it("clears the debt only once the price is on", async () => {
		const hero = graveHero();
		hero.system.addStatus = vi.fn(() => {
			expect(hero.flag).toBeDefined();
		});
		wait.mockResolvedValue(true);
		expect(await completePendingSacrifice(hero)).toBe(true);
		expect(hero.system.addStatus).toHaveBeenCalled();
		expect(hero.flag).toBeUndefined();
	});

	it("still owes the debt when the price fails to apply", async () => {
		const hero = graveHero();
		const owed = hero.flag;
		hero.system.addStatus = vi.fn(async () => {
			throw new Error("no permission");
		});
		wait.mockResolvedValue(true);
		await expect(completePendingSacrifice(hero)).rejects.toThrow();
		expect(hero.flag).toEqual(owed);
	});

	it("lets only one owner pay, and the Narrator only forgive while the player is on", async () => {
		const hero = graveHero();
		hero.testUserPermission = (user) => user.id !== "gm2";
		game.users = table(
			{ id: "player", isGM: false, active: true },
			{ id: "other", isGM: false, active: true },
			{ id: "gm", isGM: true, active: true },
		);
		game.user = { id: "other", isGM: false };
		expect(await completePendingSacrifice(hero)).toBe(false);
		expect(wait).not.toHaveBeenCalled();
		game.user = { id: "gm", isGM: true };
		wait.mockResolvedValue(null);
		await completePendingSacrifice(hero);
		expect(wait.mock.calls[0][0].buttons.map((b) => b.action)).toEqual([
			"forgive",
		]);
	});

	it("owes the debt again when the theme went before the price landed", async () => {
		const hero = gracedHero();
		hero.flag = { level: "painful", outcome: "snc", themeId: "t", messageId: "m1", graceBonus: 1 };
		const owed = hero.flag;
		hero.setFlag = vi.fn(async (_scope, key, value) => {
			if (key === "pendingSacrifice") hero.flag = value;
		});
		const theme = { name: "Ranger", effects: [] };
		hero.items = { get: () => theme };
		wait.mockImplementation(async () => {
			hero.items = { get: () => null }; // the Narrator deleted it meanwhile
			return true;
		});
		expect(await completePendingSacrifice(hero)).toBe(false);
		expect(hero.flag).toEqual(owed);
		expect(hero.grace.every((m) => !m.scratched)).toBe(true);
	});

	it("keeps the Secret Grace when nothing was left to pay", async () => {
		const hero = gracedHero();
		hero.flag = { level: "painful", outcome: "snc", themeId: "gone", messageId: "m1", graceBonus: 2 };
		expect(await completePendingSacrifice(hero)).toBe(true);
		expect(hero.grace.every((m) => !m.scratched)).toBe(true);
	});

	// Core Book p.159 and p.192: a Scarring price replaces the theme, through
	// the Replace wizard, and is paid only once the player confirms it there.
	describe("a Scarring price", () => {
		let savedLitm;
		let opened;
		const scarredHero = (wizardDone) => {
			const hero = gracedHero();
			hero.flag = { level: "scarring", outcome: "snc", themeId: "t", messageId: "m1", graceBonus: 1 };
			hero.deleteEmbeddedDocuments = vi.fn();
			hero.items = { get: () => ({ id: "t", type: "theme", name: "Ranger", effects: [] }) };
			game.litmv2 = {
				...savedLitm,
				ThemeEvolutionWizard: class {
					constructor(options) {
						opened = options;
						this.done = Promise.resolve(wizardDone);
					}
					render() {}
				},
			};
			return hero;
		};
		beforeEach(() => {
			savedLitm = game.litmv2;
			opened = null;
			wait.mockResolvedValue(true);
		});
		afterEach(() => {
			game.litmv2 = savedLitm;
		});

		it("replaces the theme in the Replace wizard, then clears the debt", async () => {
			const hero = scarredHero(true);
			expect(await completePendingSacrifice(hero)).toBe(true);
			expect(opened).toEqual({ actorId: "gerrin", themeId: "t", forceReplace: true });
			expect(hero.deleteEmbeddedDocuments).not.toHaveBeenCalled();
			expect(hero.unsetFlag).toHaveBeenCalled();
			expect(hero.grace.map((m) => m.scratched)).toEqual([true, false]);
		});

		it("still owes the Sacrifice when the wizard closes unconfirmed", async () => {
			const hero = scarredHero(false);
			const owed = hero.flag;
			expect(await completePendingSacrifice(hero)).toBe(false);
			expect(hero.flag).toEqual(owed);
			expect(hero.grace.every((m) => !m.scratched)).toBe(true);
		});

		it("loses a story theme a debt recorded before named, without the wizard", async () => {
			const hero = scarredHero(true);
			hero.items = { get: () => ({ id: "t", type: "story_theme", name: "Lantern", effects: [] }) };
			expect(await completePendingSacrifice(hero)).toBe(true);
			expect(opened).toBeNull();
			expect(hero.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["t"]);
			expect(hero.unsetFlag).toHaveBeenCalled();
		});

		it("lessens to Painful on a Miracle: no wizard", async () => {
			const hero = scarredHero(true);
			hero.flag.outcome = "success";
			const theme = { id: "t", name: "Ranger", effects: [], updateEmbeddedDocuments: vi.fn() };
			hero.items = { get: () => theme };
			expect(await completePendingSacrifice(hero)).toBe(true);
			expect(opened).toBeNull();
		});
	});

	it("settles a Miracle with no tag left to scratch, without a dialog", async () => {
		const hero = graveHero();
		hero.flag = { level: "painful", outcome: "success", themeId: "t", messageId: "m1" };
		hero.items = { get: () => ({ name: "Ranger", effects: [] }) };
		const info = vi.spyOn(ui.notifications, "info");
		expect(await completePendingSacrifice(hero)).toBe(true);
		expect(wait).not.toHaveBeenCalled();
		expect(hero.unsetFlag).toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith("LITM.Ui.sacrifice_nothing_to_pay");
		info.mockRestore();
	});
});

describe("debtPrice", () => {
	const actor = { items: new Map([["t", { name: "Ranger" }]]) };

	it("names the theme a Grave Miracle takes, not the status", () => {
		expect(
			debtPrice(actor, {
				level: "grave",
				outcome: "success",
				themeId: "t",
				statusName: "doomed",
			}),
		).toBe("LITM.Ui.sacrifice_scarring — Ranger");
	});

	it("names the status a full Grave price takes", () => {
		expect(
			debtPrice(actor, {
				level: "grave",
				outcome: "snc",
				themeId: "t",
				statusName: "doomed",
			}),
		).toBe("LITM.Ui.sacrifice_grave — doomed");
	});

	it("reads a lessened Painful as Painful", () => {
		expect(
			debtPrice(actor, { level: "painful", outcome: "success", themeId: "t" }),
		).toBe("LITM.Ui.sacrifice_painful — Ranger");
	});
});

describe("a copied Hero", () => {
	it("does not bring the original's owed Sacrifice along", async () => {
		const { registerActorHooks } = await import(
			"../modules/system/hooks/actor-hooks.js"
		);
		Hooks.on.mockClear();
		registerActorHooks();
		// The hook builds every type's token defaults up front.
		const saved = foundry.CONST;
		foundry.CONST = {
			TOKEN_DISPOSITIONS: {},
			TOKEN_DISPLAY_MODES: {},
			DOCUMENT_OWNERSHIP_LEVELS: {},
		};
		const actor = {
			img: "",
			prototypeToken: {},
			flags: { litmv2: { pendingSacrifice: { level: "painful" } } },
			updateSource: vi.fn(),
		};
		for (const [hook, fn] of Hooks.on.mock.calls)
			if (hook === "preCreateActor") fn(actor, { type: "hero" }, {}, "user");
		foundry.CONST = saved;
		const update = actor.updateSource.mock.calls
			.map(([data]) => data)
			.find((data) => "flags.litmv2.pendingSacrifice" in data);
		expect(update["flags.litmv2.pendingSacrifice"]).toBeInstanceOf(
			foundry.data.operators.ForcedDeletion,
		);
	});
});

describe("requestRollFromNarrator", () => {
	it("lets an owing Hero back into a roll already open for them", async () => {
		game.user = { id: "player", isGM: false };
		const dialog = {};
		const actor = {
			...hero("gerrin", { owes: true }),
			getFlag: (_scope, key) =>
				key === "rollDialogOwner"
					? { userId: "player" }
					: key === "pendingSacrifice"
						? { level: "painful" }
						: undefined,
			sheet: { renderRollDialog: () => dialog },
		};
		expect(await requestRollFromNarrator(actor)).toBe(dialog);
	});
});

describe("executeRoll for a Sacrifice", () => {
	let options;
	let saved;
	beforeEach(() => {
		options = undefined;
		saved = { litmv2: game.litmv2, config: CONFIG.litmv2 };
		game.litmv2 = {
			LitmRoll: class {
				constructor(_formula, _data, opts) {
					options = opts;
				}
				toMessage() {
					return Promise.resolve({ rolls: [] });
				}
			},
		};
		CONFIG.litmv2 = { ...CONFIG.litmv2, roll: {} };
	});
	afterEach(() => {
		game.litmv2 = saved.litmv2;
		CONFIG.litmv2 = saved.config;
		game.actors.get.mockReset();
	});
	const burned = { uuid: "Actor.gerrin.Item.t.ActiveEffect.e", name: "Bow", type: "power_tag", state: "scratched" };

	it("invokes, burns and uses up no tag", async () => {
		game.actors.get.mockReturnValue(hero("gerrin", { isOwner: false }));
		await executeRoll({ actorId: "gerrin", tags: [burned], type: "sacrifice" });
		expect(options.scratchedTags).toEqual([]);
	});

	it("records no Might or modifier the dice never got", async () => {
		game.actors.get.mockReturnValue(hero("gerrin", { isOwner: false }));
		await executeRoll({ actorId: "gerrin", tags: [], type: "sacrifice", might: 3, modifier: 2 });
		expect(options).toMatchObject({ might: 0, modifier: 0, totalPower: 0 });
	});

	it("refuses a second Sacrifice while the first is owed, as an approved roll would", async () => {
		game.actors.get.mockReturnValue(hero("gerrin", { owes: true }));
		const warn = vi.spyOn(ui.notifications, "warn");
		expect(await executeRoll({ actorId: "gerrin", tags: [], type: "sacrifice" })).toBeUndefined();
		expect(options).toBeUndefined();
		expect(warn).toHaveBeenCalledWith("LITM.Ui.sacrifice_unpaid_new");
		warn.mockRestore();
	});
});
