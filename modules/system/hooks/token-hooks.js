import {
	onCanvasPan,
	onCanvasTearDown,
	onHoverToken,
	onRefreshToken,
	scheduleLabelRefresh,
} from "../../hud/token-tooltip.js";

/**
 * Signals that can change *what* a persistent token label says, or which
 * tokens deserve one. All of them rebuild every label, so none has to resolve
 * which actor a mutation belongs to — see `refreshPersistentLabels`.
 *
 * - Effect CRUD covers sidebar statuses, Spend Power, scratching, and the
 *   item-parented backpack story tags (whose hook `parent` is the Item).
 * - Item CRUD is needed *as well*: Foundry fires no `*ActiveEffect` hook for
 *   effects that arrive or leave inside their parent Item, so dropping a
 *   tag-bearing backpack on a hero, or deleting one, is invisible otherwise.
 * - `updateActor` catches token-synthetic (unlinked) actor deltas, and
 *   `deleteActor` the case of a token left behind by its world actor.
 * - `litm.sceneTagsChanged` is the story-tag sidebar's own broadcast.
 * - `sightRefresh` is the one signal per vision recomputation, so a token that
 *   comes into view picks up a label.
 * - `renderHeadsUpDisplayContainer` re-runs after the HUD replaces its own
 *   innerHTML, which would otherwise silently drop every label.
 */
const LABEL_REFRESH_HOOKS = [
	"createActiveEffect",
	"updateActiveEffect",
	"deleteActiveEffect",
	"createItem",
	"deleteItem",
	"updateActor",
	"deleteActor",
	"createToken",
	"updateToken",
	"deleteToken",
	"litm.sceneTagsChanged",
	"sightRefresh",
	"canvasReady",
	"renderHeadsUpDisplayContainer",
];

export function registerTokenHooks() {
	Hooks.on("hoverToken", onHoverToken);
	Hooks.on("canvasPan", onCanvasPan);
	Hooks.on("refreshToken", _maskConcealedNameplate);
	Hooks.on("updateActor", _refreshNameplatesOnConcealChange);

	Hooks.on("refreshToken", onRefreshToken);
	for (const hook of LABEL_REFRESH_HOOKS) Hooks.on(hook, scheduleLabelRefresh);
	Hooks.on("canvasTearDown", onCanvasTearDown);
}

/**
 * Mask the canvas nameplate of concealed challenges. Foundry resets
 * `nameplate.text` to the token's real name on every nameplate refresh
 * (Token#_refreshNameplate), so this hook re-applies the alias afterwards.
 * GM and owners get `maskedName === null` and keep the real name.
 * @param {Token} token
 */
function _maskConcealedNameplate(token) {
	const masked = token.actor?.system?.maskedName;
	if (masked && token.nameplate) token.nameplate.text = masked;
}

/**
 * Re-render nameplates when a challenge's concealment settings change.
 * Fires for both world actors and token-synthetic actors (delta updates).
 * @param {Actor} actor
 * @param {object} changes
 */
function _refreshNameplatesOnConcealChange(actor, changes) {
	if (actor.type !== "challenge") return;
	const sys = changes.system ?? {};
	if (!("concealName" in sys) && !("alias" in sys)) return;
	for (const token of actor.getActiveTokens()) {
		token.renderFlags.set({ refreshNameplate: true });
	}
}
