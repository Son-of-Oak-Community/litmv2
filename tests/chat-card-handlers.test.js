import { beforeEach, describe, expect, it, vi } from "vitest";
import { gainImprovement } from "../modules/actor/hero/hero-data.js";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import {
	CLICK_HANDLERS,
	registerChatHooks,
} from "../modules/system/hooks/chat-hooks.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeElement } from "./__helpers__/dom.js";
import { fakeActor } from "./__helpers__/factories.js";
import { wireActors, wireMessage } from "./__helpers__/spend-power.js";

// The buttons and context-menu entries on a roll's chat card. Each one
// decides who may press it and what it writes: a moderation verdict must land
// once, an Improve must be marked once, and a re-valued roll must not hand
// every player the Narrator's rendering of it.

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));
vi.mock("../modules/apps/roll/roll-dialog.js", () => ({
	LitmRollDialog: { roll: vi.fn(async () => {}) },
}));
vi.mock("../modules/actor/hero/hero-data.js", () => ({
	gainImprovement: vi.fn(async () => {}),
}));
// Windows the other buttons open; none is rendered here.
vi.mock("../modules/apps/spend-power.js", () => ({ SpendPowerApp: class {} }));
vi.mock("../modules/apps/apply-action-menu.js", () => ({
	ApplyActionMenuApp: class {},
}));
vi.mock("../modules/apps/theme-advancement.js", () => ({
	ThemeAdvancementApp: class {},
}));
vi.mock("../modules/apps/theme-evolution.js", () => ({
	ThemeEvolutionWizard: class {},
}));
vi.mock("../modules/apps/welcome/welcome-overlay.js", () => ({
	WelcomeOverlay: {},
}));
vi.mock("../modules/apps/roll/moderation-render.js", () => ({
	renderModerationTooltip: vi.fn(async () => {}),
}));

beforeEach(() => {
	vi.clearAllMocks();
	game.user = { id: "gm", name: "Narrator", isGM: true };
	game.userId = "gm";
	game.users.activeGM = game.user;
	game.actors.get = vi.fn(() => null);
	game.messages.get = vi.fn(() => null);
});

/** A roll as a chat card holds it: `toJSON` reports the options as they stand. */
function fakeRoll({ litm = {}, options = {}, total = 9 } = {}) {
	return {
		litm: { actorId: "h1", ...litm },
		options,
		_total: total,
		get total() {
			return this._total;
		},
		toJSON() {
			return { total: this._total, options: { ...this.options } };
		},
	};
}

/** A roll card, reachable through `game.messages`, and a button on it. */
function rollCard(roll, { isAuthor = true, authorId = "alice" } = {}) {
	const message = wireMessage({
		id: "m1",
		rolls: [roll],
		isAuthor,
		author: { id: authorId },
		update: vi.fn(async () => {}),
		getFlag: vi.fn(() => undefined),
	});
	const button = fakeElement({
		closest: { ".chat-message": { dataset: { messageId: "m1" } } },
	});
	return { message, button };
}

/** A moderation card a player posted for the Narrator to approve. */
function moderationCard({
	userId = "alice",
	data = { actorId: "h1", type: "quick", syncSession: "sess-1" },
} = {}) {
	const flags = { data, userId };
	return {
		id: "mod-1",
		getFlag: vi.fn((_scope, key) => flags[key]),
		delete: vi.fn(async function () {
			return this;
		}),
	};
}

describe("approve-moderation", () => {
	const approve = (card) => CLICK_HANDLERS["approve-moderation"](null, card);

	it("is the Narrator's alone", async () => {
		game.user.isGM = false;
		const card = moderationCard();

		await approve(card);

		expect(card.getFlag).not.toHaveBeenCalled();
		expect(card.delete).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("names the request to the player who made it, never carrying the roll itself", async () => {
		const card = moderationCard();

		await approve(card);

		expect(Sockets.dispatch).toHaveBeenNthCalledWith(1, "rollDice", {
			userId: "alice",
			messageId: "mod-1",
		});
		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(LitmRollDialog.roll).not.toHaveBeenCalled();
	});

	it("resets the approved draft on every client, by its sync session", async () => {
		await approve(moderationCard());

		expect(Sockets.dispatch).toHaveBeenLastCalledWith("resetRollDialog", {
			actorId: "h1",
			syncSession: "sess-1",
		});
	});

	it("rolls here when the request is the Narrator's own, once the card is claimed", async () => {
		const card = moderationCard({ userId: "gm" });

		await approve(card);

		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(LitmRollDialog.roll).toHaveBeenCalledWith({
			actorId: "h1",
			type: "quick",
			syncSession: "sess-1",
		});
		expect(Sockets.dispatch).not.toHaveBeenCalledWith(
			"rollDice",
			expect.anything(),
		);
	});

	it("does not roll a card another Narrator already resolved", async () => {
		const card = moderationCard({ userId: "gm" });
		card.delete = vi.fn().mockRejectedValue(new Error("does not exist"));

		await approve(card);

		expect(LitmRollDialog.roll).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("resets its own roll dialog only when it still holds the approved draft", async () => {
		const sheet = {
			hasRollDialog: true,
			rollDialogInstance: { matchesSyncSession: vi.fn((s) => s === "sess-1") },
			resetRollDialog: vi.fn(),
		};
		game.actors.get = vi.fn(() => ({ id: "h1", sheet }));

		await approve(moderationCard({ userId: "gm" }));
		expect(sheet.resetRollDialog).toHaveBeenCalledTimes(1);

		sheet.resetRollDialog.mockClear();
		await approve(
			moderationCard({
				userId: "gm",
				data: { actorId: "h1", type: "quick", syncSession: "older" },
			}),
		);
		expect(sheet.resetRollDialog).not.toHaveBeenCalled();
	});

	it("absorbs a double click: one verdict per card", async () => {
		const card = moderationCard();

		await Promise.all([approve(card), approve(card)]);

		expect(
			Sockets.dispatch.mock.calls.filter(([event]) => event === "rollDice"),
		).toHaveLength(1);
		expect(card.delete).toHaveBeenCalledTimes(1);
	});

	it("takes a second card once the first is done", async () => {
		const card = moderationCard();

		await approve(card);
		await approve(card);

		expect(
			Sockets.dispatch.mock.calls.filter(([event]) => event === "rollDice"),
		).toHaveLength(2);
	});

	it("discards a card that carries no roll", async () => {
		const card = moderationCard({ data: {} });

		await approve(card);

		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(LitmRollDialog.roll).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("keeps a Sacrifice request while the Hero still owes an earlier price", async () => {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		hero.getFlag = vi.fn(() => ({ level: "painful", messageId: "old" }));
		wireActors(hero);
		const card = moderationCard({
			data: { actorId: "h1", type: "sacrifice", syncSession: "sess-1" },
		});

		await approve(card);

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.sacrifice_unpaid_new",
		);
		expect(card.delete).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("approves any other roll for a Hero who owes a price", async () => {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		hero.getFlag = vi.fn(() => ({ level: "painful", messageId: "old" }));
		wireActors(hero);

		await approve(moderationCard());

		expect(Sockets.dispatch).toHaveBeenCalledWith("rollDice", {
			userId: "alice",
			messageId: "mod-1",
		});
	});
});

describe("reject-moderation", () => {
	const reject = (card) => CLICK_HANDLERS["reject-moderation"](null, card);

	it("is the Narrator's alone", async () => {
		game.user.isGM = false;
		const card = moderationCard();

		await reject(card);

		expect(card.delete).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("claims the card, then reopens the roll for the requester only", async () => {
		const card = moderationCard();

		await reject(card);

		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(Sockets.dispatch).toHaveBeenCalledTimes(1);
		expect(Sockets.dispatch).toHaveBeenCalledWith("rejectRoll", {
			name: "Narrator",
			actorId: "h1",
			userId: "alice",
		});
	});

	it("sends no second rejection for a card another Narrator resolved", async () => {
		const card = moderationCard();
		card.delete = vi.fn().mockRejectedValue(new Error("does not exist"));

		await reject(card);

		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("absorbs a double click", async () => {
		const card = moderationCard();

		await Promise.all([reject(card), reject(card)]);

		expect(Sockets.dispatch).toHaveBeenCalledTimes(1);
	});

	it("deletes a card with no roll and tells nobody", async () => {
		const card = moderationCard({ data: null });

		await reject(card);

		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});
});

describe("push-roll", () => {
	const push = (button, message) =>
		CLICK_HANDLERS["push-roll"](button, message);

	it("marks the roll pushed and stores it", async () => {
		game.user.isGM = false;
		const roll = fakeRoll();
		const { message, button } = rollCard(roll);

		await push(button, message);

		expect(message.update).toHaveBeenCalledWith({
			rolls: [{ total: 9, options: { pushed: true } }],
		});
	});

	it("lets the Narrator push a roll they did not make", async () => {
		const { message, button } = rollCard(fakeRoll(), { isAuthor: false });

		await push(button, message);

		expect(message.update).toHaveBeenCalledTimes(1);
	});

	it("refuses a player who did not make the roll", async () => {
		game.user.isGM = false;
		const roll = fakeRoll();
		const { message, button } = rollCard(roll, { isAuthor: false });

		await push(button, message);

		expect(roll.options.pushed).toBeUndefined();
		expect(message.update).not.toHaveBeenCalled();
	});
});

describe("mark-improve", () => {
	const mark = (button, message) =>
		CLICK_HANDLERS["mark-improve"](button, message);

	const weaknesses = [
		{ type: "weakness_tag", name: "slow", uuid: "Effect.w1" },
		{ type: "relationship_tag", name: "rival", uuid: "Effect.r1" },
		{ type: "story_tag", name: "muddy", uuid: "Effect.s1" },
	];

	function improveCard(options = {}, card = {}) {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero);
		const roll = fakeRoll({ litm: { weaknessTags: weaknesses }, options });
		return { hero, roll, ...rollCard(roll, card) };
	}

	it("marks Improve for each invoked weakness and relationship tag, nothing else", async () => {
		game.user.isGM = false;
		const { hero, message, button } = improveCard();

		await mark(button, message);

		expect(gainImprovement.mock.calls).toEqual([
			[hero, weaknesses[0]],
			[hero, weaknesses[1]],
		]);
	});

	it("latches the roll so the marks cannot be taken twice", async () => {
		const { roll, message, button } = improveCard();

		await mark(button, message);
		await mark(button, message);

		expect(roll.options.gainedExp).toBe(true);
		expect(message.update).toHaveBeenCalledTimes(1);
		expect(message.update).toHaveBeenCalledWith({
			rolls: [{ total: 9, options: { gainedExp: true } }],
		});
		expect(gainImprovement).toHaveBeenCalledTimes(2);
	});

	it("does nothing on a roll whose Improve was already marked", async () => {
		const { message, button } = improveCard({ gainedExp: true });

		await mark(button, message);

		expect(gainImprovement).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
	});

	it("refuses a player who did not make the roll", async () => {
		game.user.isGM = false;
		const { message, button } = improveCard({}, { isAuthor: false });

		await mark(button, message);

		expect(gainImprovement).not.toHaveBeenCalled();
		expect(message.update).not.toHaveBeenCalled();
	});

	it("leaves the roll unlatched when its Hero is gone", async () => {
		const { roll, message, button } = improveCard();
		game.actors.get = vi.fn(() => null);

		await mark(button, message);

		expect(roll.options.gainedExp).toBeUndefined();
		expect(message.update).not.toHaveBeenCalled();
	});
});

describe("roll card context menu: Change roll values", () => {
	/** The entry `registerChatHooks` adds to a chat message's context menu. */
	function changeRollValues() {
		registerChatHooks();
		const [, callback] = Hooks.on.mock.calls.find(
			([name]) => name === "getChatMessageContextOptions",
		);
		const options = [];
		callback(null, options);
		return options.find((o) => o.label === "LITM.Ui.change_roll_values");
	}

	const li = (isRoll = true) =>
		fakeElement({
			dataset: { messageId: "m1" },
			one: { ".litm.dice-roll[data-type]": isRoll ? {} : null },
		});

	const answer = (values) => {
		foundry.applications.api.DialogV2.input = vi.fn(async () => values);
	};

	it("is offered to the Narrator and to the roll's author, on roll cards only", () => {
		const entry = changeRollValues();
		rollCard(fakeRoll(), { authorId: "alice" });

		expect(entry.visible(li())).toBe(true);
		expect(entry.visible(li(false))).toBe(false);

		game.user = { id: "bob", isGM: false };
		expect(entry.visible(li())).toBe(false);

		game.user = { id: "alice", isGM: false };
		expect(entry.visible(li())).toBe(true);
	});

	it("shifts the total by the change in modifier, so the outcome re-resolves", async () => {
		const roll = fakeRoll({
			total: 8,
			options: { modifier: 1, totalPower: 2 },
		});
		const { message } = rollCard(roll);
		answer({ modifier: 3, totalPower: 5 });

		await changeRollValues().onClick(null, li());

		expect(roll._total).toBe(10);
		expect(roll.options).toMatchObject({ modifier: 3, totalPower: 5 });
		expect(message.update).toHaveBeenCalledWith({
			content: "10",
			rolls: [{ total: 10, options: { modifier: 3, totalPower: 5 } }],
		});
	});

	// Storing this client's render would hand every player the Narrator's
	// unmasked tooltip; plain text makes each client render the roll itself,
	// behind its own concealment mask.
	it("stores the card as plain text, never as this client's rendered HTML", async () => {
		const roll = fakeRoll({ total: 8, options: { modifier: 0 } });
		roll.render = vi.fn(async () => "<div>Something the Narrator sees</div>");
		const { message } = rollCard(roll);
		answer({ modifier: -2, totalPower: 0 });

		await changeRollValues().onClick(null, li());

		const [update] = message.update.mock.calls[0];
		expect(update.content).toBe("6");
		expect(roll.render).not.toHaveBeenCalled();
	});

	it("changes nothing when the dialog is dismissed", async () => {
		const roll = fakeRoll({ total: 8, options: { modifier: 1 } });
		const { message } = rollCard(roll);
		answer(null);

		await changeRollValues().onClick(null, li());

		expect(roll._total).toBe(8);
		expect(message.update).not.toHaveBeenCalled();
	});
});
