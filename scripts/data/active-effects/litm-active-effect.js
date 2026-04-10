/**
 * Custom ActiveEffect document class for Legend in the Mist.
 *
 * Document-level migrateData renames legacy effect types before Foundry
 * validates the type field. This runs automatically on every document load,
 * ensuring the old "status_card" type name is transparently converted to
 * "status_tag" without requiring a world migration to run first.
 */
export class LitmActiveEffect extends foundry.documents.ActiveEffect {
	/** @override */
	static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
		baseTypeAllowed: false,
	}, { inplace: false }));

	static migrateData(source) {
		if (source.type === "status_card") {
			source.type = "status_tag";
		}
		return super.migrateData(source);
	}
}
