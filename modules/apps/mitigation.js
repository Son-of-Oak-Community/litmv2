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
 * Both effect kinds carry the owner (the actor the consequence landed on):
 * `reduce_status` and `scratch_tag` are multi-owner pickers, so the preselect
 * matches rows by name + owner even when reacting on behalf of a
 * story-theme/fellowship.
 */
export function mitigationPreselect(mitigation, _rollingActorId) {
	if (!mitigation) return null;
	const effects = mitigation.effects ?? [];
	return {
		statuses: effects
			.filter((e) => e.kind === "status")
			.map((e) => ({ name: e.name, tier: e.tier ?? null })),
		statusOwnerId: mitigation.targetActorId ?? null,
		tags: effects.filter((e) => e.kind === "story").map((e) => e.name),
		tagOwnerId: mitigation.targetActorId ?? null,
	};
}
