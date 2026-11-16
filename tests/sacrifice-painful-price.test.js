import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	completePendingSacrifice,
	recordPendingSacrifice,
} from "../modules/apps/roll/sacrifice-price.js";
import { fakeEffect, fakeItem } from "./__helpers__/factories.js";
import { setPlayer } from "./__helpers__/users.js";

// Core Book p.159: a Painful Sacrifice scratches every power tag of the theme
// it named; a Miracle lessens that to one tag, and the player picks which.
// The Grave and Scarring prices are in unpaid-sacrifice.test.js.

const tag = (id, { type = "power_tag", scratched = false, ...rest } = {}) => {
	const effect = fakeEffect({ id, name: id, type, ...rest });
	effect.system = { isScratched: scratched, ...rest.system };
	return effect;
};

/** A theme whose effects answer `filter` and `get`, as a collection does. */
const themeWith = (...effects) => {
	const theme = fakeItem({ id: "t", name: "Ranger", type: "theme", effects });
	theme.img = "ranger.webp";
	theme.effects = Object.assign([...effects], {
		get: (id) => effects.find((e) => e.id === id),
	});
	return theme;
};

/** A Hero owing a Painful price on `theme`, rolled with `outcome`. */
const owing = (theme, outcome, flag = {}) => {
	const hero = {
		id: "gerrin",
		name: "Gerrin",
		isOwner: true,
		flag: {
			level: "painful",
			outcome,
			themeId: "t",
			messageId: "m1",
			...flag,
		},
		grace: [
			{ id: "a", text: "Spared the wolf", scratched: false },
			{ id: "b", text: "Shared her bread", scratched: false },
		],
		getFlag: (_scope, key) =>
			key === "pendingSacrifice"
				? hero.flag
				: key === "secretGrace"
					? hero.grace
					: undefined,
		setFlag: vi.fn(async (_scope, key, value) => {
			if (key === "secretGrace") hero.grace = value;
		}),
		unsetFlag: vi.fn(async () => {
			hero.flag = undefined;
		}),
		update: vi.fn(async (changes) => {
			const value = changes["flags.litmv2.pendingSacrifice.payingUserId"];
			if (hero.flag) hero.flag = { ...hero.flag, payingUserId: value };
		}),
		items: { get: (id) => (id === "t" ? theme : null) },
		testUserPermission: (user) => user.id === "player" || user.isGM,
	};
	return hero;
};

let wait;
let render;
let savedUsers;
beforeEach(() => {
	wait = vi.spyOn(foundry.applications.api.DialogV2, "wait");
	render = vi
		.spyOn(foundry.applications.handlebars, "renderTemplate")
		.mockResolvedValue("");
	vi.spyOn(ui.notifications, "info").mockImplementation(() => {});
	setPlayer();
	savedUsers = game.users;
	const users = [
		{ id: "player", isGM: false, active: true },
		{ id: "gm", isGM: true, active: true },
	];
	game.users = Object.assign(users, {
		activeGM: users[1],
		get: (id) => users.find((u) => u.id === id),
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	game.users = savedUsers;
});

/** The player presses Complete with `picked` ticked in the tag picker. */
const pick = (picked) =>
	wait.mockImplementation(async ({ buttons }) =>
		buttons
			.find((b) => b.action === "pay")
			.callback(null, {
				form: {
					querySelector: (selector) =>
						selector === "input[name='picked']:checked" && picked
							? { value: picked }
							: null,
				},
			}),
	);

describe("a Painful price paid in full (Fate or In Vain)", () => {
	it.each(["snc", "consequences"])(
		"scratches every power tag of the theme, title included (%s)",
		async (outcome) => {
			const theme = themeWith(
				tag("title", { system: { isTitleTag: true } }),
				tag("bow"),
				tag("oath", { type: "fellowship_tag" }),
				tag("slow", { type: "weakness_tag" }),
			);
			const hero = owing(theme, outcome);
			wait.mockResolvedValue(true);

			expect(await completePendingSacrifice(hero)).toBe(true);
			expect(theme.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
			expect(theme.updateEmbeddedDocuments).toHaveBeenCalledWith(
				"ActiveEffect",
				[
					{ _id: "title", "system.isScratched": true },
					{ _id: "bow", "system.isScratched": true },
					{ _id: "oath", "system.isScratched": true },
				],
			);
			expect(hero.flag).toBeUndefined();
			expect(ui.notifications.info).toHaveBeenCalledWith(
				"LITM.Ui.sacrifice_theme_scratched",
			);
		},
	);

	it("scratches nothing and still owes when the player closes the dialog", async () => {
		const theme = themeWith(tag("bow"));
		const hero = owing(theme, "snc");
		const owed = hero.flag;
		wait.mockResolvedValue(null);

		expect(await completePendingSacrifice(hero)).toBe(false);
		expect(theme.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(hero.flag).toEqual(owed);
	});

	it("spends the Secret Grace the roll was granted, with the price", async () => {
		const hero = owing(themeWith(tag("bow")), "snc", { graceBonus: 2 });
		wait.mockResolvedValue(true);
		await completePendingSacrifice(hero);
		expect(hero.grace.map((m) => m.scratched)).toEqual([true, true]);
	});
});

describe("a Painful price lessened by a Miracle", () => {
	const ranger = () =>
		themeWith(
			tag("bow"),
			tag("title", { system: { isTitleTag: true } }),
			tag("spent", { scratched: true }),
			tag("off", { disabled: true }),
			tag("slow", { type: "weakness_tag" }),
		);

	it("scratches the one tag the player picked, and no other", async () => {
		const theme = ranger();
		const hero = owing(theme, "success");
		pick("bow");

		expect(await completePendingSacrifice(hero)).toBe(true);
		const bow = theme.effects.get("bow");
		expect(bow.update).toHaveBeenCalledWith({ "system.isScratched": true });
		for (const id of ["title", "spent", "off", "slow"])
			expect(theme.effects.get(id).update).not.toHaveBeenCalled();
		expect(theme.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(hero.flag).toBeUndefined();
		expect(ui.notifications.info).toHaveBeenCalledWith(
			"LITM.Ui.sacrifice_tag_scratched",
		);
	});

	it("offers only the tags a full price would still scratch, the title first and ticked", async () => {
		const hero = owing(ranger(), "success");
		pick("title");
		await completePendingSacrifice(hero);

		const [, context] = render.mock.calls.find(([path]) =>
			path.endsWith("tag-picker-form.html"),
		);
		expect(context.groups).toEqual([
			{
				img: "ranger.webp",
				fallbackLabel: "Ranger",
				titleEntry: {
					index: "title",
					name: "title",
					type: "power_tag",
					checked: true,
				},
				entries: [
					{ index: "bow", name: "bow", type: "power_tag", checked: false },
				],
			},
		]);
	});

	it("ticks the first tag when the title is already scratched, so Complete always names one", async () => {
		const theme = themeWith(
			tag("title", { scratched: true, system: { isTitleTag: true } }),
			tag("bow"),
			tag("axe"),
		);
		const hero = owing(theme, "success");
		pick("bow");
		await completePendingSacrifice(hero);

		const [, context] = render.mock.calls.find(([path]) =>
			path.endsWith("tag-picker-form.html"),
		);
		expect(context.groups[0].titleEntry).toBeNull();
		expect(context.groups[0].entries.map((e) => [e.index, e.checked])).toEqual([
			["bow", true],
			["axe", false],
		]);
	});

	it("still owes the price when the picker is closed without a pick", async () => {
		const theme = ranger();
		const hero = owing(theme, "success");
		const owed = hero.flag;
		pick(null);

		expect(await completePendingSacrifice(hero)).toBe(false);
		expect(theme.effects.get("bow").update).not.toHaveBeenCalled();
		expect(hero.flag).toEqual(owed);
	});

	it("still owes the price when the picked tag went before it landed", async () => {
		const theme = ranger();
		const hero = owing(theme, "success");
		pick("deleted-meanwhile");

		expect(await completePendingSacrifice(hero)).toBe(false);
		expect(hero.flag).toMatchObject({ level: "painful", payingUserId: null });
	});
});

// Vol. II p.78: the Secret Grace a Sacrifice was granted is spent when its
// price is paid, so the debt has to carry the number the roll was given.
describe("recordPendingSacrifice", () => {
	it("keeps the Secret Grace Bonus the roll was granted on the debt", async () => {
		const actor = { isOwner: true, setFlag: vi.fn() };
		const roll = {
			litm: { sacrificeLevel: "painful", sacrificeBonus: 2 },
			outcome: { label: "snc" },
		};
		await recordPendingSacrifice(actor, roll, { id: "m1" });
		expect(actor.setFlag).toHaveBeenCalledWith(
			"litmv2",
			"pendingSacrifice",
			expect.objectContaining({ level: "painful", graceBonus: 2 }),
		);
	});
});
