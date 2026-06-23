/**
 * Pure helpers for the Reaction (mitigate) flow. A "mitigation context"
 * describes the consequence a player is reacting to:
 *   { effects: {kind:"status"|"story", name, tier?}[], sourceLabel, targetActorId }
 * It rides on the consequence chat card (flags.litmv2.consequence), is carried
 * into the roll dialog, and persists on the reaction roll (roll.litm.mitigation)
 * so the post-reaction Spend Power menu can pre-target the inflicted effects.
 */

/** "wounded-2 · tangled" — statuses show their tier, story tags don't. */
export function formatMitigationEffects(effects = []) {
	return effects
		.map((e) =>
			e.kind === "status" && e.tier ? `${e.name}-${e.tier}` : e.name,
		)
		.join(" · ");
}

/** Localized banner line for the mitigate dialog. "" when no context. */
export function mitigationBannerText(mitigation) {
	if (!mitigation) return "";
	const effects = formatMitigationEffects(mitigation.effects ?? []);
	const base = game.i18n.format("LITM.Actions.reacting_to", { effects });
	if (!mitigation.sourceLabel) return base;
	return `${base} ${game.i18n.format("LITM.Actions.reacting_from", {
		source: mitigation.sourceLabel,
	})}`;
}

/**
 * What to pre-select in the post-reaction Spend Power menu.
 * Statuses are only offered when the consequence landed on the rolling actor,
 * because `reduce_status` is own-actor only (multi-owner reduce is deferred).
 * Story tags carry their owner id, so `scratch_tag` (multi-owner) reaches them
 * even when reacting on behalf of a story-theme/fellowship.
 */
export function mitigationPreselect(mitigation, rollingActorId) {
	if (!mitigation) return null;
	const effects = mitigation.effects ?? [];
	const onSelf = mitigation.targetActorId === rollingActorId;
	return {
		statuses: onSelf
			? effects
					.filter((e) => e.kind === "status")
					.map((e) => ({ name: e.name, tier: e.tier ?? null }))
			: [],
		tags: effects.filter((e) => e.kind === "story").map((e) => e.name),
		tagOwnerId: mitigation.targetActorId ?? null,
	};
}
