import { LitmRoll } from "./roll.js";
import { Sockets } from "../system/sockets.js";
import { ContentSources } from "../system/content-sources.js";
import { resolveEffect } from "../utils.js";
import { scratchTag as applyScratch } from "../data/active-effects/scratchable-mixin.js";
import { gainImprovement } from "../actor/hero/hero-data.js";
import { buildTrackCompleteContent } from "../system/chat.js";

/**
 * Roll execution + post-roll bookkeeping, lifted out of the dialog so the
 * roll pipeline is reusable (e.g. GM-approved rolls dispatched via socket)
 * and the dialog itself stays focused on UI state.
 */

/**
 * Resolve the formula for a given roll request, honouring any
 * `CONFIG.litmv2.roll.formula` override.
 */
export function resolveRollFormula(args) {
	const { type } = args;
	// Sacrifice rolls use only 2d6 — no Power is added.
	const defaultFormula =
		type === "sacrifice"
			? "2d6"
			: "2d6 + (@scratchedValue + @powerValue + @positiveStatusValue - @weaknessValue - @negativeStatusValue + @modifier + @mightOffset + @tradePower)";

	return typeof CONFIG.litmv2.roll.formula === "function"
		? CONFIG.litmv2.roll.formula(args)
		: CONFIG.litmv2.roll.formula || defaultFormula;
}

/**
 * Execute a Legend in the Mist roll. Posts a chat message and runs
 * post-roll side effects (scratch used tags, gain improvements, broadcast
 * sockets). Returns the chat message document.
 *
 * @param {object} args
 * @returns {Promise<ChatMessage|undefined>}
 */
export function executeRoll({
	actorId,
	tags,
	title,
	type,
	speaker,
	modifier = 0,
	might = 0,
	tradePower = 0,
	sacrificeLevel,
	sacrificeThemeId,
	actionUuid = null,
}) {
	const {
		scratchedTags,
		powerTags,
		weaknessTags,
		positiveStatuses,
		negativeStatuses,
	} = LitmRoll.filterTags(tags);

	const {
		scratchedValue,
		powerValue,
		weaknessValue,
		positiveStatusValue,
		negativeStatusValue,
		totalPower,
		mightOffset,
	} = LitmRoll.calculatePower({
		scratchedTags,
		powerTags,
		weaknessTags,
		positiveStatuses,
		negativeStatuses,
		modifier: Number(modifier) || 0,
		might,
	});

	const formula = resolveRollFormula({
		type,
		scratchedTags,
		powerTags,
		weaknessTags,
		positiveStatuses,
		negativeStatuses,
		scratchedValue,
		powerValue,
		weaknessValue,
		positiveStatusValue,
		negativeStatusValue,
		totalPower,
		actorId,
		title,
		modifier,
		might,
		mightOffset,
	});

	const actor = game.actors.get(actorId);
	if (
		Hooks.call("litm.preRoll", {
			tags,
			formula,
			modifier,
			power: totalPower,
			actor,
		}) === false
	) {
		return;
	}

	const roll = new game.litmv2.LitmRoll(
		formula,
		{
			scratchedValue,
			powerValue,
			positiveStatusValue,
			weaknessValue,
			negativeStatusValue,
			modifier: Number(modifier) || 0,
			mightOffset,
			tradePower: Number(tradePower) || 0,
		},
		{
			actorId,
			title,
			type,
			scratchedTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			speaker,
			totalPower,
			modifier,
			might,
			mightOffset,
			tradePower: Number(tradePower) || 0,
			sacrificeLevel,
			sacrificeThemeId,
		},
	);

	return roll
		.toMessage({
			speaker,
			flavor: title || roll.flavor,
			flags: actionUuid ? { litmv2: { actionUuid } } : undefined,
		})
		.then(async (res) => {
			Hooks.callAll("litm.roll", roll, res);
			const actor = game.actors.get(actorId);
			await processPostRollEffects({
				actor, roll, res, scratchedTags, powerTags, weaknessTags,
			});
			res.rolls[0]?.actor?.sheet.resetRollDialog();
			Sockets.dispatch("resetRollDialog", { actorId });
			return res;
		});
}

/**
 * Apply post-roll side effects: scratch used tags, gain improvements,
 * update roll JSON. Pure of UI concerns.
 */
export async function processPostRollEffects({ actor, roll, res, scratchedTags, powerTags, weaknessTags }) {
	const scratchTag = async (tag) => {
		if (actor) {
			const effect = resolveEffect(tag.id, actor, { fellowship: true });
			if (effect) {
				await applyScratch(actor, effect);
				return;
			}
		}
		if (tag.uuid) {
			const parsed = foundry.utils.parseUuid(tag.uuid);
			if (parsed?.collection) {
				await ContentSources.updateStoryTags([{ _id: tag._id, "system.isScratched": true }]);
			}
		}
	};

	if (!actor?.system) return;

	for (const tag of scratchedTags) {
		await scratchTag(tag);
	}
	const allUsedTags = [...powerTags, ...weaknessTags];
	for (const tag of allUsedTags) {
		if (tag.system?.isSingleUse ?? tag.isSingleUse) {
			await scratchTag(tag);
		}
	}
	roll.options.isScratched = true;

	const realWeaknessTags = weaknessTags.filter(
		(t) => t.type === "weakness_tag" || t.type === "relationship_tag",
	);
	for (const tag of realWeaknessTags) {
		const trackInfo = await gainImprovement(actor, tag);
		if (trackInfo) {
			await foundry.documents.ChatMessage.create({
				content: await buildTrackCompleteContent(trackInfo),
				speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
			});
		}
	}
	roll.options.gainedExp = true;

	if (scratchedTags.length > 0 || realWeaknessTags.length > 0) {
		await res.update({ rolls: [roll.toJSON()] });
	}
}

/**
 * Determine ownership state for the roll dialog. Pure logic — used by both
 * the dialog itself and the hero sheet to decide whether the open-dialog
 * action should claim ownership or render in viewer mode.
 *
 * @param {Actor} actor - The hero actor
 * @param {string} userId - The current user's ID
 * @returns {{ isOwner: boolean, gmAsViewer: boolean, activeOwnerId: string|null }}
 */
export function resolveRollDialogOwnership(actor, userId) {
	const activeOwnerId = actor.getFlag("litmv2", "rollDialogOwner")?.ownerId || null;
	const activeOwner = activeOwnerId ? game.users.get(activeOwnerId) : null;
	const hasActorPermission = game.user.isGM || actor.testUserPermission(game.user, "OWNER");
	const hasPlayerOwner = game.users.some(
		(u) => !u.isGM && actor.testUserPermission(u, "OWNER"),
	);
	const gmAsViewer = game.user.isGM && hasPlayerOwner
		&& !!activeOwnerId && !activeOwner?.isGM && !!activeOwner?.active;
	const isOwner =
		!gmAsViewer &&
		(activeOwnerId === userId ||
			(!activeOwnerId && hasActorPermission) ||
			(!activeOwner?.active && hasActorPermission) ||
			(activeOwner?.isGM && hasActorPermission));
	return { isOwner, gmAsViewer, activeOwnerId };
}
