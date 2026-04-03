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
	};
}
