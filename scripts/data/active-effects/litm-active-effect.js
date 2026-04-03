/**
 * Custom ActiveEffect document class for Legend in the Mist.
 *
 * Document-level migrateData renames legacy effect types before Foundry
 * validates the type field. This runs automatically on every document load,
 * ensuring old type names (theme_tag, status_card) are transparently
 * converted to the new names (power_tag, weakness_tag, fellowship_tag,
 * status_tag) without requiring a world migration to run first.
 */
export class LitmActiveEffect extends foundry.documents.ActiveEffect {
	static migrateData(source) {
		if (source.type === "status_card") {
			source.type = "status_tag";
		}

		if (source.type === "theme_tag") {
			const tagType = source.system?.tagType;
			if (tagType === "weaknessTag") {
				source.type = "weakness_tag";
			} else {
				// Determine fellowship from parent context if available,
				// default to power_tag (migration will fix fellowship later)
				source.type = "power_tag";
			}
			if (source.system) {
				delete source.system.tagType;
				delete source.system.isSingleUse;
			}
		}

		return super.migrateData(source);
	}
}
