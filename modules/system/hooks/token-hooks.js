import { onCanvasPan, onHoverToken } from "../../hud/token-tooltip.js";

export function registerTokenHooks() {
	Hooks.on("hoverToken", onHoverToken);
	Hooks.on("canvasPan", onCanvasPan);
	Hooks.on("refreshToken", _maskConcealedNameplate);
	Hooks.on("updateActor", _refreshNameplatesOnConcealChange);
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
