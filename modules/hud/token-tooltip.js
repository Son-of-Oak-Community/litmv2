import { LitmSettings } from "../system/settings.js";

/** Shared chrome for both the hover tooltip and the persistent labels. */
const LABEL_CLASS = "litm-token-tooltip";
/** Marks the single transient hover tooltip, so unhover can't wipe the rest. */
const HOVER_CLASS = "litm-token-tooltip--hover";

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
 * Chip markup for a token, resolving the viewer's own permissions. The hover
 * tooltip and the persistent labels both go through here, so their content can
 * never drift apart.
 * @param {Token} token
 * @returns {string} HTML string, or empty string if there is nothing to show
 */
export function tokenTooltipHTML(token) {
	const actor = token.actor;
	if (!actor) return "";
	return buildTooltipHTML(actor, game.user.isGM || actor.isOwner);
}

/**
 * Build a label element and attach it to the HUD layer.
 * @param {Token} token
 * @param {string} html
 * @param {{hover?: boolean}} [options]
 * @returns {HTMLElement|null}
 */
function _createLabel(token, html, { hover = false } = {}) {
	const hud = document.getElementById("hud");
	if (!hud) return null;

	const label = document.createElement("div");
	label.classList.add(LABEL_CLASS, "placeable-hud");
	if (hover) label.classList.add(HOVER_CLASS);
	else label.dataset.tokenId = token.id;
	label.innerHTML = html;
	hud.append(label);

	_positionTooltip(token, label);
	return label;
}

/**
 * Position and show the hover tooltip above a token.
 * @param {Token} token
 */
function _showTooltip(token) {
	_removeTooltip();

	const html = tokenTooltipHTML(token);
	if (!html) return;

	_createLabel(token, html, { hover: true });
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
 * Remove the hover tooltip. Persistent labels are keyed separately and survive.
 */
function _removeTooltip() {
	document.querySelector(`.${HOVER_CLASS}`)?.remove();
}

/**
 * Selector for persistent labels: one token's, or all of them. Built in one
 * place so the two callers can never drift — a lookup that still matched while
 * the clear did not would accumulate labels on every rebuild.
 * @param {string} [tokenId] Omit for every persistent label.
 * @returns {string}
 */
function _labelSelector(tokenId) {
	const key = tokenId ? `="${CSS.escape(tokenId)}"` : "";
	return `#hud > .${LABEL_CLASS}[data-token-id${key}]`;
}

/**
 * The persistent label currently attached to a token, if any.
 * The DOM is the source of truth: Foundry's HUD container replaces its own
 * innerHTML on every render, so a cached Map would hold detached nodes.
 * @param {string} tokenId
 * @returns {HTMLElement|null}
 */
function _persistentLabel(tokenId) {
	return document.querySelector(_labelSelector(tokenId));
}

/**
 * Remove every persistent label from the HUD.
 */
export function clearPersistentLabels() {
	for (const label of document.querySelectorAll(_labelSelector())) {
		label.remove();
	}
}

/**
 * Rebuild every persistent label from scratch.
 *
 * Deliberately unconditional over all placeables rather than diffing against
 * the mutated document: backpack story tags are effects on the *item*, so an
 * effect hook's `parent` is the Item and not the Actor. Rebuilding everything
 * sidesteps that resolution entirely, and the cost is one pass over the scene's
 * tokens on a discrete user action.
 */
export function refreshPersistentLabels() {
	clearPersistentLabels();
	if (!LitmSettings.persistentTokenLabels) return;

	// A tooltip from a hover already in progress when the setting was switched
	// on would sit on top of the label we are about to draw for that token.
	_removeTooltip();

	for (const token of canvas?.tokens?.placeables ?? []) {
		// `Token#visible` already encodes the hover rules: hidden tokens are
		// GM-only, and vision/fog/culling are accounted for.
		if (!token.visible) continue;
		const html = tokenTooltipHTML(token);
		if (!html) continue;
		_createLabel(token, html);
	}
}

/**
 * Coalesce refresh requests. Several of the signals below fire in bursts
 * (a status change touches the effect and the sidebar), and the rebuild is
 * O(tokens in scene).
 *
 * Built on first use rather than at module scope: this module is imported by
 * unit tests whose Foundry shim has no `foundry.utils.debounce`.
 *
 * The delay is load-bearing, not just coalescing: `restrictVisibility()` sets
 * the `refreshVisibility` render flags and fires `sightRefresh` in the same
 * tick, but `token.visible` is only recomputed on the next ticker frame. The
 * rebuild has to outlast that frame or it reads stale visibility. Do not drop
 * it to 0, and do not call `refreshPersistentLabels` straight from a hook.
 */
let _debouncedRefresh = null;
export function scheduleLabelRefresh() {
	_debouncedRefresh ??= foundry.utils.debounce(refreshPersistentLabels, 50);
	_debouncedRefresh();
}

/**
 * Drop a pending rebuild. Called on tear-down: the timer would otherwise land
 * on a canvas whose dimensions have gone, and `_positionTooltip` reads
 * `canvas.dimensions.uiScale`.
 */
function _cancelLabelRefresh() {
	_debouncedRefresh?.cancel();
}

/**
 * Last visibility we acted on, per token. `refreshVisibility` fires every
 * animation frame, but only the false-to-true edge can mean "this token needs
 * a label it does not have" — and `foundry.utils.debounce` re-arms its timer on
 * every call, so scheduling on each frame instead of on the edge would starve
 * the rebuild for as long as anything on the canvas keeps moving.
 *
 * Keyed on the Token object, so a canvas redraw discards the old entries.
 * @type {WeakMap<Token, boolean>}
 */
const _lastVisible = new WeakMap();

/**
 * Handle the hoverToken hook.
 *
 * In persistent mode every visible token already carries its label, and hover
 * can only fire on a visible token — so a hover tooltip would only ever
 * duplicate chips that are already on screen.
 *
 * Unhover still cleans up unconditionally: the setting can be switched on
 * while a tooltip is up, and skipping the removal would strand it.
 * @param {Token} token
 * @param {boolean} hovered
 */
export function onHoverToken(token, hovered) {
	if (!hovered) return _removeTooltip();
	if (LitmSettings.persistentTokenLabels) return;
	_showTooltip(token);
}

/**
 * Keep a persistent label glued to its token.
 *
 * `refreshToken` fires once per animation frame while a token moves, so this
 * only moves an existing element — chip content is rebuilt on the discrete
 * mutation signals instead.
 *
 * A token that has gone invisible drops its label. One that has just *become*
 * visible schedules a rebuild, so it can pick a label up. That case is not
 * hypothetical: opening a token's config sheet makes the original invisible
 * behind its preview clone (`Token#isVisible` returns false while
 * `_previewType === "config"`), and closing the sheet without saving fires no
 * effect or document hook that would bring the label back.
 *
 * The rebuild is scheduled on the false-to-true edge only, never on every
 * visible frame — see `_lastVisible`.
 * @param {Token} token
 * @param {object} [flags] Render flags Foundry applied for this refresh.
 */
export function onRefreshToken(token, flags) {
	if (!LitmSettings.persistentTokenLabels) return;

	const visible = token.visible;
	if (flags?.refreshVisibility) {
		const became = visible && _lastVisible.get(token) === false;
		_lastVisible.set(token, visible);
		if (became) scheduleLabelRefresh();
	}

	const label = _persistentLabel(token.id);
	if (!label) return;
	if (!visible) label.remove();
	else _positionTooltip(token, label);
}

/**
 * Clean up the hover tooltip on canvas pan.
 *
 * Persistent labels stay: `#hud` is positioned and scaled to the canvas by
 * `HeadsUpDisplayContainer#align()`, so canvas-space children track pan and
 * zoom on their own.
 */
export function onCanvasPan() {
	_removeTooltip();
}

/**
 * Drop the labels, and the pending rebuild with them, when the scene goes away.
 * Cancelling matters: a timer armed just before tear-down would otherwise run
 * against a canvas whose `dimensions` are gone.
 */
export function onCanvasTearDown() {
	_cancelLabelRefresh();
	clearPersistentLabels();
}
