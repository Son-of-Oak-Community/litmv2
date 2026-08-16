import { LitmSettings } from "../system/settings.js";

const TOOLTIP_ID = "litm-token-tooltip";

/**
 * Chip markup for one effect. Names are escaped — they are free text a player
 * can author, and the result goes through innerHTML.
 * @param {string} baseClass  Tag chrome class (`litm-tag` / `litm-status`)
 * @param {ActiveEffect} effect
 * @param {string} label  Display text (statuses append their tier)
 * @returns {string}
 */
function _chip(baseClass, effect, label) {
	const esc = foundry.utils.escapeHTML;
	// Only a GM/owner ever sees a hidden effect here, and it is content the
	// players cannot see — dim it the way the sheets and sidebar do.
	const cls = effect.system.isHidden
		? `${baseClass} litm--tag-hidden`
		: baseClass;
	return `<span class="${cls}" data-text="${esc(label)}">${esc(label)}</span>`;
}

/**
 * Build tooltip HTML from an actor's story tags and status effects.
 * Respects isHidden — hidden tags only visible to GM/owner.
 *
 * Names are player-controlled on owned documents and land in `innerHTML`, so
 * every interpolation is escaped. Exported for unit tests that pin that.
 * @param {Actor} actor
 * @param {boolean} isOwnerOrGM
 * @returns {string} HTML string, or empty string if no visible tags
 */
export function buildTooltipHTML(actor, isOwnerOrGM) {
	const storyTags = actor.system.storyTags ?? [];
	const statuses = actor.system.statusEffects ?? [];

	const isVisible = (e) => e.active && (isOwnerOrGM || !e.system.isHidden);
	// Statuses are inflicted and worth tracking at a glance; story/backpack tags
	// are reached for on demand, so the tooltip can be narrowed to statuses.
	const visibleTags = LitmSettings.tokenTooltipStatusesOnly
		? []
		: storyTags.filter(isVisible);
	const visibleStatuses = statuses.filter(isVisible);

	if (!visibleTags.length && !visibleStatuses.length) return "";

	const parts = [];
	for (const tag of visibleTags) {
		parts.push(_chip("litm-tag", tag, tag.name));
	}
	for (const status of visibleStatuses) {
		const tier = status.system.currentTier;
		const label = tier > 0 ? `${status.name} ${tier}` : status.name;
		parts.push(_chip("litm-status", status, label));
	}
	return parts.join("");
}

/**
 * Position and show the tooltip element above a token.
 * @param {Token} token
 */
function _showTooltip(token) {
	_removeTooltip();

	const actor = token.actor;
	if (!actor) return;

	const isOwnerOrGM = game.user.isGM || actor.isOwner;
	const html = buildTooltipHTML(actor, isOwnerOrGM);
	if (!html) return;

	const tooltip = document.createElement("div");
	tooltip.id = TOOLTIP_ID;
	tooltip.classList.add("placeable-hud");
	tooltip.innerHTML = html;
	document.getElementById("hud").append(tooltip);

	_positionTooltip(token, tooltip);
}

/**
 * Position the tooltip to the left of the token, vertically centered.
 * Coordinates are in canvas space — the #hud container handles zoom scaling.
 * We apply uiScale to match Foundry's own HUD sizing (see BasePlaceableHUD._updatePosition).
 * @param {Token} token
 * @param {HTMLElement} tooltip
 */
function _positionTooltip(token, tooltip) {
	const { x, y, height } = token.bounds;
	const s = canvas.dimensions.uiScale;
	tooltip.style.left = `${x - 8}px`;
	tooltip.style.top = `${y + height / 2}px`;
	tooltip.style.transformOrigin = "right center";
	tooltip.style.transform = `translate(-100%, -50%) scale(${s})`;
}

/**
 * Remove the tooltip element from the DOM.
 */
function _removeTooltip() {
	document.getElementById(TOOLTIP_ID)?.remove();
}

/**
 * Handle the hoverToken hook.
 * @param {Token} token
 * @param {boolean} hovered
 */
export function onHoverToken(token, hovered) {
	if (hovered) _showTooltip(token);
	else _removeTooltip();
}

/**
 * Clean up tooltip on canvas pan or tear down.
 */
export function onCanvasPan() {
	_removeTooltip();
}
