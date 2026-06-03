/**
 * Shared +/- counter handler for SpendPowerApp and ApplyActionMenuApp. Walks
 * up to the nearest counter container (status-reduce row, spend-power counter,
 * or var-tier row), reads the displayed value, clamps it to [min, max] based
 * on the direction in `data-action`, and writes it back.
 *
 * Returns the new value so callers can drive follow-up updates (live cost
 * label, power readout, etc).
 *
 * @param {HTMLElement} target  The +/- button that was clicked.
 * @param {{ min?: number, max?: number }} [bounds]
 * @returns {number|null} The new value, or null if no counter could be resolved.
 */
export function adjustCounter(target, { min = 1, max = Infinity } = {}) {
	const container = target.closest(
		".litm-spend-power__counter, .litm-spend-power__status-reduce, .litm-spend-power__var-tier",
	);
	const valueEl = container?.querySelector(".litm-spend-power__counter-value");
	if (!valueEl) return null;

	const raw = Number(valueEl.textContent);
	const current = Number.isFinite(raw) ? raw : min;
	const next =
		target.dataset.action === "counter-inc"
			? Math.min(current + 1, max)
			: Math.max(min, current - 1);
	valueEl.textContent = next;
	return next;
}

/**
 * Read chosen tiers from a container's variable-tier counter rows into a sparse
 * array indexed by `data-var-idx`, each clamped to [0, 6]. Shared by the Spend
 * Power dialog and the Apply Action menu, which both render
 * `.litm-spend-power__var-tier` rows with a `.litm-spend-power__counter-value`.
 *
 * @param {HTMLElement|null|undefined} containerEl  Element wrapping the rows.
 * @returns {number[]} Sparse tier array.
 */
export function readVariableTiers(containerEl) {
	const chosenTiers = [];
	containerEl
		?.querySelectorAll(".litm-spend-power__var-tier")
		.forEach((row) => {
			const idx = Number(row.dataset.varIdx);
			if (!Number.isInteger(idx) || idx < 0) return;
			const raw = Number(
				row.querySelector(".litm-spend-power__counter-value")?.textContent ?? 0,
			);
			const val = Number.isFinite(raw) ? raw : 0;
			chosenTiers[idx] = Math.max(0, Math.min(6, val));
		});
	return chosenTiers;
}
