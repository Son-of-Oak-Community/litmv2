import { ACTOR_TYPES } from "../system/config.js";

/**
 * Custom Actor document class for Legend in the Mist.
 *
 * Filters the fellowship type out of the Actor creation dialog so players
 * cannot accidentally create duplicate fellowship actors.
 */
export class LitmActor extends foundry.documents.Actor {
	static async createDialog(data = {}, createOptions = {}, dialogOptions = {}) {
		dialogOptions.types ??= this.TYPES.filter(
			(t) => t !== ACTOR_TYPES.fellowship,
		);
		return super.createDialog(data, createOptions, dialogOptions);
	}

	/**
	 * @override
	 * Vignette items (embedded in Challenges and Journeys) hold consequence
	 * markup as `system.consequences` strings, surfaced to the GM via the
	 * consequence menu. Legacy worlds may still carry vignette-owned
	 * ActiveEffects created before consequence-sync was removed; those are
	 * display cruft, not the owning actor's own tags/statuses, yet they
	 * transfer by Foundry's default. Skipping them here keeps any such
	 * effects out of every applicable-effect consumer (story-tag sidebar,
	 * sheets, token HUD/tooltip, `addStatus` stacking, limit recompute,
	 * rolls) in one place, with no stored-data migration.
	 */
	*allApplicableEffects() {
		for (const effect of super.allApplicableEffects()) {
			if (effect.parent?.type === "vignette") continue;
			yield effect;
		}
	}
}
