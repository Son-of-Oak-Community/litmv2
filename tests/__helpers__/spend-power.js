// Builders shared by the Spend Power tests (tests/spend-power-*.test.js).
//
// This module is evaluated once per worker (most files share one module
// graph), while setup.js replaces `game`, `foundry` and `CONFIG` for every
// file. So nothing here reads those globals when the module loads: every
// access sits inside a function body.

import { vi } from "vitest";
import { fakeElement } from "./dom.js";
import { fakeActor, fakeEffect } from "./factories.js";

/** Point `game.actors.get` at the given actors, found by id. */
export function wireActors(...actors) {
	const byId = Object.fromEntries(actors.map((actor) => [actor.id, actor]));
	game.actors.get = vi.fn((id) => byId[id] ?? null);
}

/**
 * A status_tag effect whose system quacks like StatusTagData for reduce:
 * `calculateReduction(by)` marks the box `by` tiers down, and `reduceTier`
 * resolves without writing.
 */
export function fakeStatus({ id, name, tier, parent = null }) {
	const effect = fakeEffect({ id, name, type: "status_tag", parent });
	effect.system = {
		currentTier: tier,
		calculateReduction: vi.fn((by) => {
			const tiers = Array(6).fill(false);
			if (tier - by > 0) tiers[tier - by - 1] = true;
			return tiers;
		}),
		reduceTier: vi.fn(async () => {}),
	};
	return effect;
}

/** A "Blessed" status at tier 3: what the action's `Strip [Blessed-3]` removes. */
export function fakeBlessed({ id = "s1" } = {}) {
	return fakeEffect({
		id,
		type: "status_tag",
		name: "Blessed",
		system: { tiers: [false, false, true, false, false, false] },
	});
}

/**
 * An actor a spend writes to, standing in for a foe. Pass `isOwner: false` for
 * one the player cannot write. Its `addStatus` resolves without touching a
 * real status track. The actor type is left to `fakeActor`'s default.
 */
export function fakeTarget({ id = "c1", name = "Serpent", ...rest } = {}) {
	const target = fakeActor({ id, name, ...rest });
	target.system.addStatus = vi.fn(async () => {});
	return target;
}

/**
 * A roll message holding `flags`. `setFlag` writes them back, so a later
 * `getFlag` sees what a window just wrote, as on a real message.
 */
export function fakeRollMessage(flags = {}, { id = "m1" } = {}) {
	return {
		id,
		getFlag: vi.fn((_scope, key) => flags[key]),
		setFlag: vi.fn(async (_scope, key, value) => {
			flags[key] = value;
		}),
		update: vi.fn(async () => {}),
	};
}

/** Make `game.messages.get` return `message` for its own id and nothing else. */
export function wireMessage(message) {
	game.messages.get = vi.fn((id) => (id === message.id ? message : null));
	return message;
}

/** A roll message holding `flags`, already reachable through `game.messages`. */
export function rollMessage(flags = {}, options) {
	return wireMessage(fakeRollMessage(flags, options));
}

/** Roll message carrying the actionUuid flag and applied-success bookkeeping. */
export function actionRollMessage({ applied = [], costs = {} } = {}) {
	return fakeRollMessage({
		actionUuid: "Item.act1",
		appliedSuccesses: applied,
		appliedSuccessCosts: costs,
	});
}

/** Action item with a single weaken success: [Blessed-3] → fixed cost 3. */
export function fakeAction() {
	return {
		type: "action",
		name: "Sever Blessing",
		system: {
			successes: [{ id: "succ1", verb: "weaken", text: "Strip [Blessed-3]" }],
		},
	};
}

/** The intent `applySpendIntent` takes, around one or more options. */
export function spendIntent(options, overrides = {}) {
	return {
		options: [options].flat(),
		messageId: null,
		alreadySpent: 0,
		targetActorId: null,
		...overrides,
	};
}

/** An Inflict option; with no `entries` it inflicts [dazed-2]. */
export function inflictOption({
	entries = [{ name: "dazed", tier: 2, isSingleUse: false }],
	targetActorId = null,
	...rest
} = {}) {
	return {
		kind: "default",
		optionId: "inflict_status",
		label: "LITM.Effects.inflict.action",
		cost: 1,
		hasTier: true,
		draggable: true,
		entries,
		targetActorId,
		...rest,
	};
}

/** A Reduce option; each reduction is `{ effectId, name, actorId?, tiers }`. */
export function reduceOption(reductions) {
	return {
		kind: "statusPicker",
		optionId: "reduce_status",
		label: "LITM.Effects.reduce.action",
		cost: 1,
		reductions,
	};
}

/** A Scratch option; each chip is `{ tagId, tagName, actorId, ... }`. */
export function scratchOption(chips) {
	return {
		kind: "scratchPicker",
		optionId: "scratch_tag",
		label: "LITM.Effects.scratch.action",
		cost: 2,
		chips,
	};
}

/** A Recover option; each chip is `{ tagId, tagName, actorId? }`. */
export function recoverOption(chips) {
	return {
		kind: "picker",
		optionId: "recover_tag",
		label: "LITM.Effects.recover.action",
		cost: 2,
		chips,
	};
}

/** A counter option such as Discover a Detail, taken `count` times. */
export function counterOption(count, optionId = "discover_detail") {
	return {
		kind: "counter",
		optionId,
		label: "LITM.Effects.discover.action",
		cost: 1,
		count,
	};
}

// Shortcuts for the common case of an intent around a single option.

/** An intent that Inflicts: `inflict` is what `inflictOption` takes. */
export const inflictIntent = (inflict, overrides) =>
	spendIntent(inflictOption(inflict), overrides);

export const reduceIntent = (reductions, overrides) =>
	spendIntent(reduceOption(reductions), overrides);

export const scratchIntent = (chips, overrides) =>
	spendIntent(scratchOption(chips), overrides);

export const recoverIntent = (chips, overrides) =>
	spendIntent(recoverOption(chips), overrides);

// The dialog's DOM, as `parseSpendIntent` and the cost calculators read it.

/**
 * The Spend Power form around its option `rows`. `successTarget` is the
 * checked success-target radio, if any.
 */
export function spendForm(rows = [], { successTarget = null } = {}) {
	return fakeElement({
		all: { ".litm-spend-power__option": rows },
		one: { "input[name='success-target']:checked": successTarget },
	});
}

/** One option row, its "take this option" box ticked. */
export function optionRow(dataset, { one = {}, all = {} } = {}) {
	return fakeElement({
		dataset,
		one: { "[data-option-check]": { checked: true }, ...one },
		all,
	});
}

/** The dialog stub `parseSpendIntent` takes: the options it offered. */
export function spendDialog(spendingOptions) {
	return { spendingOptions, messageId: null, alreadySpent: 0 };
}
