/**
 * Mixin for AE data models that have an isScratched field + toggleScratch method.
 * @param {typeof foundry.data.ActiveEffectTypeDataModel} Base
 */
export function ScratchableMixin(Base) {
	return class extends Base {
		get isSuppressed() {
			return this.isScratched;
		}

		async toggleScratch() {
			return this.parent.update({ "system.isScratched": !this.isScratched });
		}

		/**
		 * Set the scratch state absolutely (no-op when already there). Prefer
		 * this over toggleScratch when the caller wants a known end state.
		 * @param {boolean} value
		 */
		async setScratched(value) {
			if (!!this.isScratched === !!value) return;
			return this.parent.update({ "system.isScratched": !!value });
		}
	};
}

/**
 * Scratch/unscratch an effect with proper hook guards.
 * Centralizes the pre/post hook pattern used across sheets.
 * @param {Actor} actor   The owning actor
 * @param {ActiveEffect} effect  The effect to toggle
 * @returns {Promise<boolean>} false if blocked by preTagScratched hook
 */
export async function scratchTag(actor, effect) {
	if (Hooks.call("litm.preTagScratched", actor, effect) === false) return false;
	await effect.system.toggleScratch();
	Hooks.callAll("litm.tagScratched", actor, effect);
	return true;
}

/**
 * Scratch as a consequence: an absolute set, never a toggle, with the same
 * hook guards. A roll that runs twice (a double press, a retried submit, two
 * approvals, a replayed relay) must not un-burn what the first run burned.
 * @param {ActiveEffect} effect
 */
export async function scratchOnce(effect) {
	if (effect.system?.isScratched) return;
	const owner =
		effect.parent?.documentName === "Item"
			? effect.parent.parent
			: effect.parent;
	if (Hooks.call("litm.preTagScratched", owner, effect) === false) return;
	await effect.system.setScratched(true);
	Hooks.callAll("litm.tagScratched", owner, effect);
}
