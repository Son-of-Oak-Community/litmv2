import { resolveEffect } from "../../active-effects/effect-queries.js";
import { scratchTag as applyScratch } from "../../active-effects/scratchable-mixin.js";
import { gainImprovement } from "../../actor/hero/hero-data.js";
import { warn } from "../../logger.js";
import { FLAGS, IMPROVE_MARKING_TAG_TYPES } from "../../system/config.js";
import { ContentSources } from "../../system/content-sources.js";
import { LitmSettings } from "../../system/settings.js";
import { Sockets } from "../../system/sockets.js";
import { LitmRoll } from "./roll.js";

/**
 * Roll execution + post-roll bookkeeping, lifted out of the dialog so the
 * roll pipeline is reusable (e.g. GM-approved rolls dispatched via socket)
 * and the dialog itself stays focused on UI state.
 */

/**
 * Build a preview shape from a raw tags payload — filtered tag buckets,
 * total power, and the tooltip data used by both the chat-card render and
 * the GM moderation card. Single source of truth: any new surface that
 * needs to display "what the roll would be" should call this rather than
 * re-invoking `filterTags` + `calculatePower` itself.
 *
 * @param {object} args
 * @param {object} args.tags         Selection payload from the roll dialog
 * @param {number} [args.modifier=0]
 * @param {number} [args.might=0]
 * @returns {{ tags: object, totalPower: number, tooltipData: object, hasTooltipData: boolean }}
 */
export function buildRollPreview({ tags, modifier = 0, might = 0 }) {
	const filtered = LitmRoll.filterTags(tags);
	const { totalPower } = LitmRoll.calculatePower({
		...filtered,
		modifier,
		might,
	});
	return {
		tags: filtered,
		totalPower,
		tooltipData: { ...filtered, modifier, might },
		hasTooltipData:
			filtered.scratchedTags.length > 0 ||
			filtered.powerTags.length > 0 ||
			filtered.weaknessTags.length > 0 ||
			filtered.positiveStatuses.length > 0 ||
			filtered.negativeStatuses.length > 0 ||
			!!modifier,
	};
}

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
	sacrificeStatusName,
	actionUuid = null,
	mitigation = null,
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
			sacrificeStatusName,
			mitigation,
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
				actor,
				roll,
				res,
				scratchedTags,
				powerTags,
				weaknessTags,
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
export async function processPostRollEffects({
	actor,
	roll,
	res,
	scratchedTags,
	powerTags,
	weaknessTags,
}) {
	const scratchTag = async (tag) => {
		if (actor) {
			const effect = resolveEffect(tag.id, actor, { fellowship: true });
			if (effect) {
				await applyScratch(actor, effect);
				return;
			}
		}
		// Scene tags live in the world story-tag pack. Players can't write
		// to the pack, so they route through the GM-mediated sidebar socket.
		if (tag.uuid?.startsWith("Compendium.")) {
			const update = [{ _id: tag._id, "system.isScratched": true }];
			if (game.user.isGM) await ContentSources.updateStoryTags(update);
			else
				Sockets.dispatch("storyTagsUpdate", {
					operation: "updateTags",
					data: update,
				});
			return;
		}
		// Ally tags — owner-picked from the Allies tab or helper-contributed —
		// live on another hero. Scratch directly when this client owns the
		// parent document; otherwise ask the active GM via socket.
		const effect = tag.uuid ? foundry.utils.fromUuidSync(tag.uuid) : null;
		if (effect) {
			const targetActor =
				effect.parent?.documentName === "Item"
					? effect.parent.parent
					: effect.parent;
			if (effect.isOwner) await applyScratch(targetActor, effect);
			else Sockets.dispatch("scratchEffect", { uuid: tag.uuid });
			return;
		}
		// Diagnostic: a tag came back from the dialog but neither the rolling
		// actor/fellowship lookup nor the uuid path could locate the live
		// document — this is the path the fellowship-title-tag bug report
		// hits. Logging the shape lets a repro session show whether the tag
		// is missing an id/uuid, the fellowship lookup is short-circuiting,
		// or allApplicableEffects just isn't yielding it.
		warn("post-roll scratchTag: effect not resolved", {
			tagId: tag.id,
			tagUuid: tag.uuid,
			tagType: tag.type,
			tagName: tag.name,
			actorId: actor?.id ?? null,
			fellowshipId: actor?.system?.fellowshipActor?.id ?? null,
		});
	};

	if (!actor?.system) return;

	// Burn cap: only the first scratched tag is actually scratched (p.158).
	// Defense in depth: the dialog also blocks selecting a second.
	if (scratchedTags.length > 0) {
		await scratchTag(scratchedTags[0]);
	}
	const allUsedTags = [...powerTags, ...weaknessTags];
	for (const tag of allUsedTags) {
		if (tag.system?.isSingleUse ?? tag.isSingleUse) {
			await scratchTag(tag);
		}
	}
	roll.options.isScratched = true;

	// World setting: tables that house-rule when Improve is marked can turn
	// off the automatic marking for invoked weakness/relationship tags. The
	// chat card then offers a manual "Mark Improve" button instead — see
	// `canMarkImprove` in LitmRoll#render and `_handleMarkImprove`.
	const realWeaknessTags = LitmSettings.autoMarkImprove
		? weaknessTags.filter((t) => IMPROVE_MARKING_TAG_TYPES.has(t.type))
		: [];
	for (const tag of realWeaknessTags) {
		await gainImprovement(actor, tag);
	}
	roll.options.gainedExp = LitmSettings.autoMarkImprove;

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
	const activeOwnerId =
		actor.getFlag("litmv2", FLAGS.rollDialogOwner)?.ownerId || null;
	const activeOwner = activeOwnerId ? game.users.get(activeOwnerId) : null;
	const hasActorPermission =
		game.user.isGM || actor.testUserPermission(game.user, "OWNER");
	const hasPlayerOwner = game.users.some(
		(u) => !u.isGM && actor.testUserPermission(u, "OWNER"),
	);
	const gmAsViewer =
		game.user.isGM &&
		hasPlayerOwner &&
		!!activeOwnerId &&
		!activeOwner?.isGM &&
		!!activeOwner?.active;
	const isOwner =
		!gmAsViewer &&
		(activeOwnerId === userId ||
			(!activeOwnerId && hasActorPermission) ||
			(!activeOwner?.active && hasActorPermission) ||
			(activeOwner?.isGM && hasActorPermission));
	return { isOwner, gmAsViewer, activeOwnerId };
}
