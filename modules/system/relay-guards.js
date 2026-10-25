import { IMPROVE_MARKING_TAG_TYPES } from "./config.js";

/**
 * Authorization for the GM-proxy socket relays (scratchEffect,
 * gainImprovement, storyTagsUpdate, createHeroAsGM, applySuccessAsGM,
 * applyStatusAsGM). The active GM's client performs those writes for players,
 * so every relay re-checks here what the player could legitimately ask for.
 *
 * `sender` is always the server-attested user (see `Sockets.on`), never a
 * payload field. Guards take plain objects and return `{ ok, reason? }`, so
 * they are unit-testable; `resolveRelayCard` is the one Foundry-facing reader.
 *
 * A roll card binds a relay to a roll the sender may act on. Its content is
 * author-writable, so it limits what a relay can reach, not what a player
 * who forges their own card can claim.
 */

const OK = Object.freeze({ ok: true });
const reject = (reason) => ({ ok: false, reason });

const uuidsOf = (tags) => (tags ?? []).map((t) => t?.uuid).filter(Boolean);

/**
 * Plain view of a ChatMessage carrying a litm roll, or null.
 * @param {ChatMessage|null|undefined} message
 * @returns {object|null}
 */
export function readRollCard(message) {
	const roll = message?.rolls?.[0];
	const litm = roll?.litm;
	if (!litm?.actorId) return null;
	return {
		id: message.id,
		authorId: message.author?.id ?? null,
		actorId: litm.actorId,
		power: Number(roll.power) || 0,
		canSpend: !!roll.canSpendPower,
		scratchedTags: litm.scratchedTags ?? [],
		powerTags: litm.powerTags ?? [],
		weaknessTags: litm.weaknessTags ?? [],
	};
}

/**
 * Resolve the card a relay names, and whether the sender owns the actor it
 * rolled for (the Narrator may roll on a Hero's behalf, then its owner spends).
 * @param {User|null|undefined} sender
 * @param {string|null|undefined} messageId
 * @returns {{ card: object|null, ownsRollActor: boolean }}
 */
export function resolveRelayCard(sender, messageId) {
	const card = readRollCard(messageId ? game.messages.get(messageId) : null);
	const actor = card ? game.actors.get(card.actorId) : null;
	return {
		card,
		ownsRollActor: !!(sender && actor?.testUserPermission?.(sender, "OWNER")),
	};
}

/** Rule 1: the sender authored the card, or owns the actor it rolled for. */
export function checkCardBinding({ sender, card, ownsRollActor }) {
	if (!sender) return reject("unknown sender");
	if (sender.isGM) return OK;
	if (!card) return reject("no roll card");
	if (card.authorId !== sender.id && !ownsRollActor)
		return reject("card belongs to someone else");
	return OK;
}

/**
 * Rule 2. `via: "roll"` is post-roll bookkeeping: the one burn, or a
 * single-use tag the roll invoked (judged by the live effect, not the card).
 * `via: "spend"` is Spend Power's scratch: a visible story tag on a card
 * that has Power to spend.
 * @param {object} args
 * @param {{ uuid: string, type: string, isSingleUse: boolean, isHidden: boolean }} args.effect
 *   The live effect.
 */
export function checkScratch({
	sender,
	card,
	ownsRollActor,
	via,
	effect,
	receipts,
}) {
	if (sender?.isGM) return OK;
	const bound = checkCardBinding({ sender, card, ownsRollActor });
	if (!bound.ok) return bound;
	if (receipts.has(card.id, `scratch:${effect.uuid}`))
		return reject("already scratched for this card");
	if (via === "roll") {
		if (card.scratchedTags[0]?.uuid === effect.uuid) return OK;
		const used = uuidsOf([...card.powerTags, ...card.weaknessTags]);
		if (used.includes(effect.uuid) && effect.isSingleUse) return OK;
		return reject("tag was not consumed by this roll");
	}
	if (via === "spend") {
		if (effect.type !== "story_tag") return reject("not a story tag");
		if (effect.isHidden) return reject("tag is hidden");
		if (!card.canSpend) return reject("card has no Power to spend");
		return OK;
	}
	return reject(`unknown scratch source "${via}"`);
}

/**
 * Rule 3. The tag must be a weakness/relationship the card invoked, by its
 * live type. `actorId` is the rolling actor gainImprovement credits, so it
 * must be the card's; the theme marked follows from the live effect.
 * @param {{ uuid: string, type: string }} args.effect  The live effect.
 */
export function checkImprove({
	sender,
	card,
	ownsRollActor,
	actorId,
	effect,
	receipts,
}) {
	if (sender?.isGM) return OK;
	const bound = checkCardBinding({ sender, card, ownsRollActor });
	if (!bound.ok) return bound;
	if (actorId !== card.actorId) return reject("actor is not the card's");
	if (!IMPROVE_MARKING_TAG_TYPES.has(effect.type))
		return reject(`${effect.type} does not mark Improve`);
	if (!uuidsOf(card.weaknessTags).includes(effect.uuid))
		return reject("weakness not invoked on this card");
	if (receipts.has(card.id, `improve:${effect.uuid}`))
		return reject("Improve already marked for this card");
	return OK;
}

/** Shared by both Spend Power relays: a spendable card with Power left. */
function checkSpend({ sender, card, ownsRollActor, cost, spent }) {
	const bound = checkCardBinding({ sender, card, ownsRollActor });
	if (!bound.ok) return bound;
	if (!card.canSpend) return reject("card has no Power to spend");
	if (!Number.isInteger(cost) || cost < 0) return reject("invalid cost");
	if (spent + cost > card.power) return reject("over the card's Power");
	return OK;
}

/**
 * Rule 4, statuses: 1 Power per tier added or removed. `effect` is the live
 * status a reduce targets (absent for an add).
 */
export function checkStatusRelay({
	sender,
	card,
	ownsRollActor,
	cost,
	spent,
	effect = null,
}) {
	if (sender?.isGM) return OK;
	if (effect?.isHidden) return reject("status is hidden");
	return checkSpend({ sender, card, ownsRollActor, cost, spent });
}

/**
 * Rule 4, action successes: the card's own actor, each success once, and
 * tier choices that can't price a success below its markup.
 */
export function checkSuccessRelay({
	sender,
	card,
	ownsRollActor,
	actorId,
	successKey,
	chosenTiers,
	cost,
	spent,
	receipts,
}) {
	if (sender?.isGM) return OK;
	const spend = checkSpend({ sender, card, ownsRollActor, cost, spent });
	if (!spend.ok) return spend;
	if (actorId !== card.actorId) return reject("actor is not the card's");
	if (receipts.has(card.id, `success:${successKey}`))
		return reject("success already applied");
	if (
		!Array.isArray(chosenTiers ?? []) ||
		(chosenTiers ?? []).some(
			(n) => Number.isFinite(n) && (!Number.isInteger(n) || n < 1),
		)
	)
		return reject("invalid tier choice");
	return OK;
}

/** Flatten nested update data to dot paths; arrays are leaves. */
function flatten(obj, prefix = "", out = {}) {
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value))
			flatten(value, path, out);
		else out[path] = value;
	}
	return out;
}

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

const STORY_CREATE_TYPES = new Set(["story_tag", "status_tag"]);

function sanitizeCreate(data) {
	const out = [];
	for (const entry of data) {
		if (!isPlainObject(entry)) return reject("malformed tag");
		if (!STORY_CREATE_TYPES.has(entry.type))
			return reject(`cannot create ${entry.type}`);
		// Rebuilt rather than patched, so a top-level "system.isHidden" key
		// can't ride alongside the forced value.
		const { name, type, img, disabled, system } = entry;
		const tag = { name, type, img, disabled };
		for (const key of Object.keys(tag))
			if (tag[key] === undefined) delete tag[key];
		tag.system = { ...(isPlainObject(system) ? system : {}), isHidden: false };
		out.push(tag);
	}
	return { ok: true, data: out };
}

function sanitizeUpdate(data, { tags, limitIds, cardUuids }) {
	for (const entry of data) {
		if (!isPlainObject(entry)) return reject("malformed update");
		const flat = flatten(entry);
		const tag = tags.get(flat._id);
		if (!tag) return reject("unknown tag");
		for (const [key, value] of Object.entries(flat)) {
			if (key === "_id") continue;
			if (key === "sort" && Number.isFinite(value)) continue;
			if (key === "system.isScratched" && value === true) continue;
			if (key === "system.limitId" && (value === null || limitIds.has(value)))
				continue;
			return reject(`may not set ${key}`);
		}
		if (tag.isHidden) {
			const scratchOnly =
				Object.keys(flat).length === 2 && flat["system.isScratched"] === true;
			if (!scratchOnly || !cardUuids.has(tag.uuid))
				return reject("tag is hidden");
		}
	}
	return { ok: true, data };
}

function sanitizeDelete(data, { tags }) {
	if (data.length !== 1) return reject("delete one tag at a time");
	const tag = tags.get(data[0]);
	if (!tag) return reject("unknown tag");
	if (tag.isHidden) return reject("tag is hidden");
	return { ok: true, data };
}

const STORY_OPS = {
	createTags: sanitizeCreate,
	updateTags: sanitizeUpdate,
	deleteTags: sanitizeDelete,
};

/**
 * Rule 5: re-apply the sidebar's player policy to a scene-tag write.
 * @param {string} operation
 * @param {unknown} data
 * @param {object} ctx
 * @param {{ id: string, isGM: boolean }|null} ctx.sender
 * @param {Map<string, { uuid: string, isHidden: boolean }>} ctx.tags  Pack tags by id
 * @param {Set<string>} ctx.limitIds  Story limit ids
 * @param {object|null} [ctx.card]  The card a hidden-tag scratch cites
 * @param {boolean} [ctx.ownsRollActor]
 * @returns {{ ok: true, data: unknown }|{ ok: false, reason: string }}
 */
export function sanitizeStoryOp(operation, data, ctx) {
	if (!ctx.sender) return reject("unknown sender");
	if (ctx.sender.isGM) return { ok: true, data };
	if (!Object.hasOwn(STORY_OPS, operation))
		return reject(`unknown operation "${operation}"`);
	if (!Array.isArray(data) || !data.length) return reject("no data");
	const bound = ctx.card && checkCardBinding(ctx).ok;
	const cardUuids = new Set(
		bound
			? uuidsOf([
					...ctx.card.scratchedTags,
					...ctx.card.powerTags,
					...ctx.card.weaknessTags,
				])
			: [],
	);
	return STORY_OPS[operation](data, { ...ctx, cardUuids });
}

const HERO_ITEM_TYPES = new Set(["theme", "backpack"]);

/**
 * Rule 6: rebuild a hero-wizard request from what the wizard sends, owned by
 * the sender and nobody else.
 * @param {object} args
 * @param {{ id: string, isGM: boolean }|null} args.sender
 * @param {object} args.payload  `{ actorData, userId, assignToUser }`
 * @param {{ NONE: number, OWNER: number }} args.levels  Ownership levels
 * @returns {{ ok: true, actorData: object }|{ ok: false, reason: string }}
 */
export function sanitizeHeroRequest({ sender, payload, levels }) {
	if (!sender) return reject("unknown sender");
	if (sender.isGM) return reject("GMs create heroes directly");
	if (payload?.userId !== sender.id) return reject("userId is not the sender");
	if (payload.assignToUser != null && payload.assignToUser !== sender.id)
		return reject("may only assign to the sender");
	const source = isPlainObject(payload.actorData) ? payload.actorData : {};
	const items = Array.isArray(source.items) ? source.items : [];
	return {
		ok: true,
		actorData: {
			name: String(source.name ?? ""),
			type: "hero",
			system: {},
			items: items.filter(
				(i) => isPlainObject(i) && HERO_ITEM_TYPES.has(i.type),
			),
			flags: {
				litmv2: {
					heroWizardRequestId: String(
						source.flags?.litmv2?.heroWizardRequestId ?? "",
					),
				},
			},
			ownership: { default: levels.NONE, [sender.id]: levels.OWNER },
		},
	};
}

/**
 * Rule 7: what the active GM has already done for each card. In memory, so it
 * resets on a GM reload or an active-GM handover.
 */
export class RelayReceipts {
	#byMessage = new Map();

	#entry(id) {
		let entry = this.#byMessage.get(id);
		if (!entry) {
			entry = { keys: new Set(), spent: 0 };
			this.#byMessage.set(id, entry);
		}
		return entry;
	}

	has(id, key) {
		return this.#byMessage.get(id)?.keys.has(key) ?? false;
	}

	add(id, key) {
		this.#entry(id).keys.add(key);
	}

	spent(id) {
		return this.#byMessage.get(id)?.spent ?? 0;
	}

	charge(id, power) {
		this.#entry(id).spent += power;
	}

	forget(id) {
		this.#byMessage.delete(id);
	}
}

export const relayReceipts = new RelayReceipts();
