import { LitmItem } from "../item/litm-item.js";
import { ACTOR_TYPES } from "../system/config.js";
import { createLegacyRelationshipEffects } from "./hero/hero-data.js";

/**
 * Turn the legacy data stashed on an actor and its embedded items into
 * ActiveEffects. Embedded items never fire createItem, so each is converted
 * here. Shared by the createActor hook and `LitmActor#importFromJSON`.
 * @param {Actor} actor
 */
export async function createLegacyActorEffects(actor) {
	for (const item of actor.items) {
		if (item.flags?.litmv2?.legacyTags || item.flags?.litmv2?.legacyContents) {
			await LitmItem.createLegacyEffects(item);
		}
		await LitmItem.ensureTitleTag(item);
	}
	await createLegacyRelationshipEffects(actor);
}

/**
 * Custom Actor document class for Legend in the Mist.
 *
 * Filters the fellowship type out of the Actor creation dialog so players
 * cannot accidentally create duplicate fellowship actors.
 *
 * migrateData stashes legacy hero relationships in flags before schema
 * validation prunes them. The createActor hook, the importFromJSON override
 * and the world migration read the flag and create proper relationship_tag
 * ActiveEffects.
 */
export class LitmActor extends foundry.documents.Actor {
	static async createDialog(data = {}, createOptions = {}, dialogOptions = {}) {
		dialogOptions.types ??= this.TYPES.filter(
			(t) => t !== ACTOR_TYPES.fellowship,
		);
		return super.createDialog(data, createOptions, dialogOptions);
	}

	/**
	 * Legacy heroes kept their relationships at `system.relationships`.
	 * Foundry runs this Document-level hook on the whole source *before* the
	 * system model's, and hands `HeroData.migrateData` the `system` object only,
	 * so `source.flags` is only reachable from here. The return value is
	 * discarded by Foundry: mutate `source` in place.
	 */
	static migrateData(source, options) {
		const relationships = source.system?.relationships;
		if (
			source.type === ACTOR_TYPES.hero &&
			Array.isArray(relationships) &&
			relationships.length
		) {
			source.flags ??= {};
			source.flags.litmv2 ??= {};
			source.flags.litmv2.legacyRelationships ??= relationships;
		}
		return super.migrateData(source, options);
	}

	/**
	 * @override
	 * Sidebar "Import Data" is an `update` with `noHook: true`, so createActor
	 * never fires and the stash `migrateData` wrote into the imported flags
	 * would never be consumed. Run the same consumer once the import landed.
	 * Foundry only calls this on the importing client, so no user gate is needed.
	 */
	async importFromJSON(json) {
		await super.importFromJSON(json);
		await createLegacyActorEffects(this);
		return this;
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
