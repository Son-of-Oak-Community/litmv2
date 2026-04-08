// scripts/hud/token-tooltip.js

const TOOLTIP_ID = "litm-token-tooltip";

/**
 * Build tooltip HTML from an actor's story tags and status effects.
 * Respects isHidden — hidden tags only visible to GM/owner.
 * @param {Actor} actor
 * @param {boolean} isOwnerOrGM
 * @returns {string} HTML string, or empty string if no visible tags
 */
function _buildTooltipHTML(actor, isOwnerOrGM) {
	const storyTags = actor.system.storyTags ?? [];
	const statuses = actor.system.statusEffects ?? [];

	const visibleTags = storyTags.filter(
		(e) => e.active && (isOwnerOrGM || !e.system.isHidden),
	);
	const visibleStatuses = statuses.filter(
		(e) => e.active && (isOwnerOrGM || !e.system.isHidden),
	);

	if (!visibleTags.length && !visibleStatuses.length) return "";

	const parts = [];
	for (const tag of visibleTags) {
		parts.push(
			`<span class="litm-tag" data-text="${tag.name}">${tag.name}</span>`,
		);
	}
	for (const status of visibleStatuses) {
		const tier = status.system.currentTier;
		const label = tier > 0 ? `${status.name} ${tier}` : status.name;
		parts.push(
			`<span class="litm-status" data-text="${label}">${label}</span>`,
		);
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
	const html = _buildTooltipHTML(actor, isOwnerOrGM);
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
	tooltip.style.left = `${x -8}px`;
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
