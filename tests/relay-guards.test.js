import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkCardBinding,
	checkImprove,
	checkScratch,
	checkStatusRelay,
	checkSuccessRelay,
	RelayReceipts,
	readRollCard,
	sanitizeHeroRequest,
	sanitizeStoryOp,
} from "../modules/system/relay-guards.js";
import { Sockets } from "../modules/system/sockets.js";

// The active GM writes on players' behalf through these relays. Each guard is
// the rule a forged packet from a player's console must fail.

const PLAYER = { id: "p1", isGM: false };
const OTHER = { id: "p2", isGM: false };
const GM = { id: "gm", isGM: true };

const ally = { uuid: "Actor.a.Item.t.ActiveEffect.burn" };
const second = { uuid: "Actor.a.Item.t.ActiveEffect.second" };
const single = { uuid: "Actor.a.ActiveEffect.single" };
const weak = { uuid: "Actor.a.Item.t.ActiveEffect.weak", type: "weakness_tag" };

function card(overrides = {}) {
	return {
		id: "m1",
		authorId: PLAYER.id,
		actorId: "h1",
		power: 3,
		canSpend: true,
		scratchedTags: [ally, second],
		powerTags: [single],
		weaknessTags: [weak],
		...overrides,
	};
}

const liveEffect = (uuid, overrides = {}) => ({
	uuid,
	type: "power_tag",
	isSingleUse: false,
	isHidden: false,
	...overrides,
});

let receipts;
beforeEach(() => {
	receipts = new RelayReceipts();
});

describe("readRollCard", () => {
	it("reads a litm roll off a message", () => {
		const message = {
			id: "m1",
			author: { id: "p1" },
			rolls: [
				{
					litm: { actorId: "h1", scratchedTags: [ally] },
					power: 4,
					canSpendPower: true,
				},
			],
		};
		expect(readRollCard(message)).toMatchObject({
			id: "m1",
			authorId: "p1",
			actorId: "h1",
			power: 4,
			canSpend: true,
			scratchedTags: [ally],
			powerTags: [],
		});
	});

	it("is null for a message without a litm roll", () => {
		expect(readRollCard({ id: "m1", rolls: [{ options: {} }] })).toBeNull();
		expect(readRollCard(null)).toBeNull();
	});
});

describe("checkCardBinding", () => {
	it("accepts the card's author", () => {
		expect(checkCardBinding({ sender: PLAYER, card: card() }).ok).toBe(true);
	});

	it("accepts the owner of the rolled actor (the Narrator rolled for them)", () => {
		const c = card({ authorId: GM.id });
		expect(
			checkCardBinding({ sender: PLAYER, card: c, ownsRollActor: true }).ok,
		).toBe(true);
	});

	it("rejects a forged identity: someone else's card", () => {
		expect(
			checkCardBinding({ sender: OTHER, card: card(), ownsRollActor: false }),
		).toEqual({ ok: false, reason: "card belongs to someone else" });
	});

	it("rejects a missing card and an unknown sender", () => {
		expect(checkCardBinding({ sender: PLAYER, card: null }).ok).toBe(false);
		expect(checkCardBinding({ sender: null, card: card() }).ok).toBe(false);
	});
});

describe("checkScratch", () => {
	const scratch = (args) =>
		checkScratch({ sender: PLAYER, card: card(), receipts, ...args });

	it("accepts the roll's one burn", () => {
		expect(scratch({ via: "roll", effect: liveEffect(ally.uuid) }).ok).toBe(
			true,
		);
	});

	it("rejects a second burn", () => {
		expect(scratch({ via: "roll", effect: liveEffect(second.uuid) }).ok).toBe(
			false,
		);
	});

	it("rejects a uuid not on the card", () => {
		expect(
			scratch({ via: "roll", effect: liveEffect("Actor.x.ActiveEffect.y") }).ok,
		).toBe(false);
	});

	it("accepts an invoked tag that is single-use on the live effect", () => {
		const effect = liveEffect(single.uuid, { isSingleUse: true });
		expect(scratch({ via: "roll", effect }).ok).toBe(true);
	});

	it("rejects single-use claimed only by the card, not the live effect", () => {
		const c = card({ powerTags: [{ ...single, isSingleUse: true }] });
		const effect = liveEffect(single.uuid, { isSingleUse: false });
		expect(scratch({ card: c, via: "roll", effect }).ok).toBe(false);
	});

	it("rejects a scratch the GM already made for this card", () => {
		receipts.add("m1", `scratch:${ally.uuid}`);
		expect(scratch({ via: "roll", effect: liveEffect(ally.uuid) }).ok).toBe(
			false,
		);
	});

	it("rejects a missing or foreign card", () => {
		const effect = liveEffect(ally.uuid);
		expect(scratch({ card: null, via: "roll", effect }).ok).toBe(false);
		expect(
			scratch({ card: card({ authorId: OTHER.id }), via: "roll", effect }).ok,
		).toBe(false);
	});

	it("spend: accepts a visible story tag on a spendable card", () => {
		const effect = liveEffect("Actor.c.ActiveEffect.s", { type: "story_tag" });
		expect(scratch({ via: "spend", effect }).ok).toBe(true);
	});

	it("spend: rejects a non-story tag, a hidden tag, and an unspendable card", () => {
		const uuid = "Actor.c.ActiveEffect.s";
		expect(scratch({ via: "spend", effect: liveEffect(uuid) }).ok).toBe(false);
		expect(
			scratch({
				via: "spend",
				effect: liveEffect(uuid, { type: "story_tag", isHidden: true }),
			}).ok,
		).toBe(false);
		expect(
			scratch({
				card: card({ canSpend: false }),
				via: "spend",
				effect: liveEffect(uuid, { type: "story_tag" }),
			}).ok,
		).toBe(false);
	});

	it("rejects an unknown source", () => {
		expect(scratch({ via: "toggle", effect: liveEffect(ally.uuid) }).ok).toBe(
			false,
		);
	});

	it("lets a GM sender through", () => {
		expect(
			checkScratch({
				sender: GM,
				card: null,
				via: "roll",
				effect: liveEffect("x"),
				receipts,
			}).ok,
		).toBe(true);
	});
});

describe("checkImprove", () => {
	const improve = (args) =>
		checkImprove({
			sender: PLAYER,
			card: card(),
			actorId: "h1",
			effect: { uuid: weak.uuid, type: "weakness_tag" },
			receipts,
			...args,
		});

	it("accepts a weakness the card invoked", () => {
		expect(improve().ok).toBe(true);
	});

	it("accepts a relationship tag the card lists", () => {
		const rel = { uuid: "Actor.h1.ActiveEffect.rel", type: "relationship_tag" };
		expect(
			improve({
				card: card({ weaknessTags: [rel] }),
				effect: { uuid: rel.uuid, type: "relationship_tag" },
			}).ok,
		).toBe(true);
	});

	it("rejects type spoofing: the live effect is a power tag", () => {
		const c = card({
			weaknessTags: [{ uuid: weak.uuid, type: "weakness_tag" }],
		});
		expect(
			improve({ card: c, effect: { uuid: weak.uuid, type: "power_tag" } }).ok,
		).toBe(false);
	});

	it("rejects a weakness not on the card", () => {
		expect(
			improve({
				effect: { uuid: "Actor.z.ActiveEffect.w", type: "weakness_tag" },
			}).ok,
		).toBe(false);
	});

	it("rejects an actor other than the card's", () => {
		expect(improve({ actorId: "h2" }).ok).toBe(false);
	});

	it("rejects a second mark for the same tag and card", () => {
		receipts.add("m1", `improve:${weak.uuid}`);
		expect(improve().ok).toBe(false);
	});

	it("rejects a foreign card", () => {
		expect(improve({ sender: OTHER }).ok).toBe(false);
	});
});

describe("checkStatusRelay", () => {
	const status = (args) =>
		checkStatusRelay({
			sender: PLAYER,
			card: card(),
			cost: 1,
			spent: 0,
			...args,
		});

	it("accepts within the card's Power", () => {
		expect(status({ cost: 2, spent: 1 }).ok).toBe(true);
	});

	it("rejects over budget", () => {
		expect(status({ cost: 2, spent: 2 })).toEqual({
			ok: false,
			reason: "over the card's Power",
		});
	});

	it("rejects a negative or fractional cost", () => {
		expect(status({ cost: -5 }).ok).toBe(false);
		expect(status({ cost: 1.5 }).ok).toBe(false);
	});

	it("rejects a hidden status", () => {
		expect(status({ effect: { isHidden: true } })).toEqual({
			ok: false,
			reason: "status is hidden",
		});
	});

	it("rejects an unspendable or missing card", () => {
		expect(status({ card: card({ canSpend: false }) }).ok).toBe(false);
		expect(status({ card: null }).ok).toBe(false);
	});
});

describe("checkSuccessRelay", () => {
	const success = (args) =>
		checkSuccessRelay({
			sender: PLAYER,
			card: card(),
			actorId: "h1",
			successKey: "s1",
			chosenTiers: [],
			cost: 3,
			spent: 0,
			receipts,
			...args,
		});

	it("accepts a first apply within budget", () => {
		expect(success().ok).toBe(true);
	});

	it("rejects a duplicate successKey", () => {
		receipts.add("m1", "success:s1");
		expect(success()).toEqual({ ok: false, reason: "success already applied" });
	});

	it("rejects over budget", () => {
		expect(success({ spent: 1 }).ok).toBe(false);
	});

	it("rejects an actor other than the card's", () => {
		expect(success({ actorId: "c1" }).ok).toBe(false);
	});

	it("rejects tier choices that would price a success below cost", () => {
		expect(success({ chosenTiers: [-4] }).ok).toBe(false);
		expect(success({ chosenTiers: [0] }).ok).toBe(false);
		expect(success({ chosenTiers: "2" }).ok).toBe(false);
	});

	it("rejects an unresolved success (no cost)", () => {
		expect(success({ cost: null }).ok).toBe(false);
	});
});

describe("RelayReceipts", () => {
	it("tracks keys and spend per card, and forgets a card", () => {
		receipts.add("m1", "scratch:x");
		receipts.charge("m1", 2);
		receipts.charge("m1", 1);
		expect(receipts.has("m1", "scratch:x")).toBe(true);
		expect(receipts.has("m2", "scratch:x")).toBe(false);
		expect(receipts.spent("m1")).toBe(3);
		receipts.forget("m1");
		expect(receipts.has("m1", "scratch:x")).toBe(false);
		expect(receipts.spent("m1")).toBe(0);
	});
});

describe("sanitizeStoryOp", () => {
	const fog = {
		uuid: "Compendium.world.tags.ActiveEffect.fog",
		isHidden: false,
	};
	const ambush = {
		uuid: "Compendium.world.tags.ActiveEffect.ambush",
		isHidden: true,
	};
	const ctx = (overrides = {}) => ({
		sender: PLAYER,
		tags: new Map([
			["fog", fog],
			["ambush", ambush],
		]),
		limitIds: new Set(["L1"]),
		card: null,
		ownsRollActor: false,
		...overrides,
	});
	const op = (operation, data, overrides) =>
		sanitizeStoryOp(operation, data, ctx(overrides));

	it("rejects an unknown or inherited operation", () => {
		expect(op("wipeTags", ["fog"]).ok).toBe(false);
		expect(op("toString", ["fog"]).ok).toBe(false);
		expect(op("__proto__", ["fog"]).ok).toBe(false);
	});

	it("rejects empty or malformed data", () => {
		expect(op("deleteTags", []).ok).toBe(false);
		expect(op("deleteTags", "fog").ok).toBe(false);
	});

	it("passes a GM sender through unchanged", () => {
		const data = [{ _id: "ambush", "system.isHidden": false }];
		expect(op("updateTags", data, { sender: GM })).toEqual({ ok: true, data });
	});

	describe("createTags", () => {
		it("creates a story tag or status, forced visible", () => {
			const result = op("createTags", [
				{
					name: "smoke",
					type: "story_tag",
					img: "i.svg",
					disabled: false,
					system: { isHidden: true, isSingleUse: false },
				},
				{ name: "wet", type: "status_tag", system: { tiers: [true] } },
			]);
			expect(result).toEqual({
				ok: true,
				data: [
					{
						name: "smoke",
						type: "story_tag",
						img: "i.svg",
						disabled: false,
						system: { isHidden: false, isSingleUse: false },
					},
					{
						name: "wet",
						type: "status_tag",
						system: { tiers: [true], isHidden: false },
					},
				],
			});
		});

		it("drops a dotted isHidden key riding beside the system object", () => {
			const result = op("createTags", [
				{ name: "smoke", type: "story_tag", "system.isHidden": true },
			]);
			expect(result.data[0]).toEqual({
				name: "smoke",
				type: "story_tag",
				system: { isHidden: false },
			});
		});

		it("rejects other effect types", () => {
			expect(op("createTags", [{ name: "x", type: "power_tag" }]).ok).toBe(
				false,
			);
		});
	});

	describe("updateTags", () => {
		it("allows sort, a story limit, clearing a limit and scratching", () => {
			for (const entry of [
				{ _id: "fog", sort: 100 },
				{ _id: "fog", "system.limitId": "L1" },
				{ _id: "fog", "system.limitId": null },
				{ _id: "fog", "system.isScratched": true },
				{ _id: "fog", system: { isScratched: true } },
			])
				expect(op("updateTags", [entry]).ok).toBe(true);
		});

		it("rejects unscratching, renaming, and an unknown limit", () => {
			expect(
				op("updateTags", [{ _id: "fog", "system.isScratched": false }]).ok,
			).toBe(false);
			expect(op("updateTags", [{ _id: "fog", name: "clear" }]).ok).toBe(false);
			expect(
				op("updateTags", [{ _id: "fog", "system.limitId": "nope" }]).ok,
			).toBe(false);
		});

		it("rejects revealing a hidden tag, flattened or nested", () => {
			expect(
				op("updateTags", [{ _id: "ambush", "system.isHidden": false }]).ok,
			).toBe(false);
			expect(
				op("updateTags", [{ _id: "fog", system: { isHidden: false } }]).ok,
			).toBe(false);
			expect(
				op("updateTags", [{ _id: "ambush", system: { isHidden: false } }]).ok,
			).toBe(false);
		});

		it("rejects a packet if any entry fails", () => {
			expect(
				op("updateTags", [
					{ _id: "fog", sort: 1 },
					{ _id: "ambush", sort: 2 },
				]).ok,
			).toBe(false);
		});

		it("rejects an unknown target", () => {
			expect(op("updateTags", [{ _id: "gone", sort: 1 }]).ok).toBe(false);
		});

		it("scratches a hidden tag only for a card that lists it", () => {
			const scratch = [{ _id: "ambush", "system.isScratched": true }];
			expect(op("updateTags", scratch).ok).toBe(false);
			const listing = card({ scratchedTags: [{ uuid: ambush.uuid }] });
			expect(op("updateTags", scratch, { card: listing }).ok).toBe(true);
			// Someone else's card doesn't count.
			expect(
				op("updateTags", scratch, { card: { ...listing, authorId: OTHER.id } })
					.ok,
			).toBe(false);
			// And it is a scratch, not a sort.
			expect(
				op("updateTags", [{ _id: "ambush", sort: 5 }], { card: listing }).ok,
			).toBe(false);
		});
	});

	describe("deleteTags", () => {
		it("deletes one visible tag", () => {
			expect(op("deleteTags", ["fog"])).toEqual({ ok: true, data: ["fog"] });
		});

		it("rejects a multi-id delete", () => {
			expect(op("deleteTags", ["fog", "fog"]).ok).toBe(false);
		});

		it("rejects a hidden or unknown tag", () => {
			expect(op("deleteTags", ["ambush"]).ok).toBe(false);
			expect(op("deleteTags", ["gone"]).ok).toBe(false);
		});
	});
});

describe("sanitizeHeroRequest", () => {
	const levels = { NONE: 0, OWNER: 3 };
	const payload = (overrides = {}) => ({
		userId: PLAYER.id,
		assignToUser: null,
		actorData: {
			name: "Gerrin",
			type: "hero",
			system: {},
			items: [
				{ name: "Origin", type: "theme" },
				{ name: "Backpack", type: "backpack" },
			],
			flags: { litmv2: { heroWizardRequestId: "req1" } },
		},
		...overrides,
	});
	const hero = (args) =>
		sanitizeHeroRequest({
			sender: PLAYER,
			payload: payload(),
			levels,
			...args,
		});

	it("rebuilds what the wizard sends, owned by the sender alone", () => {
		expect(hero()).toEqual({
			ok: true,
			actorData: {
				name: "Gerrin",
				type: "hero",
				system: {},
				items: [
					{ name: "Origin", type: "theme" },
					{ name: "Backpack", type: "backpack" },
				],
				flags: { litmv2: { heroWizardRequestId: "req1" } },
				ownership: { default: 0, p1: 3 },
			},
		});
	});

	it("drops payload ownership, folder, type, system, flags and stray items", () => {
		const evil = payload();
		Object.assign(evil.actorData, {
			type: "challenge",
			folder: "f1",
			ownership: { default: 3, p2: 3 },
			system: { promise: 5 },
			flags: { litmv2: { heroWizardRequestId: "req1", other: 1 }, core: {} },
		});
		evil.actorData.items.push({ name: "Boss", type: "addon" });
		const { actorData } = hero({ payload: evil });
		expect(actorData.type).toBe("hero");
		expect(actorData.folder).toBeUndefined();
		expect(actorData.system).toEqual({});
		expect(actorData.ownership).toEqual({ default: 0, p1: 3 });
		expect(actorData.flags).toEqual({
			litmv2: { heroWizardRequestId: "req1" },
		});
		expect(actorData.items.map((i) => i.type)).toEqual(["theme", "backpack"]);
	});

	it("coerces the name to a string", () => {
		const p = payload();
		p.actorData.name = { toString: () => "Obj" };
		expect(hero({ payload: p }).actorData.name).toBe("Obj");
	});

	it("rejects a userId that is not the sender (forged identity)", () => {
		expect(hero({ payload: payload({ userId: OTHER.id }) }).ok).toBe(false);
	});

	it("rejects assigning the hero to another user", () => {
		expect(hero({ payload: payload({ assignToUser: OTHER.id }) }).ok).toBe(
			false,
		);
		expect(hero({ payload: payload({ assignToUser: PLAYER.id }) }).ok).toBe(
			true,
		);
	});

	it("rejects a GM or unknown sender", () => {
		expect(hero({ sender: GM, payload: payload({ userId: GM.id }) }).ok).toBe(
			false,
		);
		expect(hero({ sender: null }).ok).toBe(false);
	});
});

describe("Sockets.on — attested sender", () => {
	let listener;
	beforeEach(() => {
		vi.clearAllMocks();
		game.socket = {
			on: vi.fn((_name, fn) => {
				listener = fn;
			}),
			emit: vi.fn(),
		};
		game.userId = "gm";
		game.users.get = vi.fn((id) => ({ p1: PLAYER, gm: GM })[id]);
		Sockets.on("probe", vi.fn());
	});

	it("passes the server's sender id, overriding a forged payload senderId", () => {
		listener({ id: "x", event: "probe", data: { a: 1 }, senderId: "gm" }, "p1");
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.socket.probe", {
			id: "x",
			data: { a: 1 },
			senderId: "p1",
		});
	});

	it("drops a packet with no attested sender", () => {
		listener({ id: "x", event: "probe", data: {}, senderId: "p1" });
		listener({ id: "x", event: "probe", data: {} }, "not-a-user");
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});

	it("drops its own echo", () => {
		listener({ id: "x", event: "probe", data: {} }, "gm");
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});
});
