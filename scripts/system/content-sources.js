import { error, info } from "../logger.js";
import { LitmSettings } from "./settings.js";

/**
 * Map of category → compendium document class name.
 * Item categories filter by item type in consumers; statuses use ActiveEffect packs.
 */
const CATEGORY_DOC_TYPE = {
	themebooks: "Item",
	themekits: "Item",
	tropes: "Item",
	statuses: "ActiveEffect",
};

/** Map status names to Foundry SVG icons. */
const STATUS_ICONS = {
	wounded: "icons/svg/blood.svg",
	poisoned: "icons/svg/poison.svg",
	burned: "icons/svg/fire.svg",
	stunned: "icons/svg/daze.svg",
	paralyzed: "icons/svg/paralysis.svg",
	crushed: "icons/svg/stoned.svg",
	exhausted: "icons/svg/unconscious.svg",
	hungry: "icons/svg/tankard.svg",
	scared: "icons/svg/terror.svg",
	confused: "icons/svg/daze.svg",
	convinced: "icons/svg/book.svg",
	intimidated: "icons/svg/cowled.svg",
	humiliated: "icons/svg/down.svg",
	prone: "icons/svg/falling.svg",
	exposed: "icons/svg/eye.svg",
	surprised: "icons/svg/explosion.svg",
	drained: "icons/svg/degen.svg",
	cursed: "icons/svg/skull.svg",
	warded: "icons/svg/holy-shield.svg",
	alert: "icons/svg/eye.svg",
	hidden: "icons/svg/invisible.svg",
	inspired: "icons/svg/angel.svg",
	invigorated: "icons/svg/regen.svg",
};

/**
 * Curated default statuses from the Action Grimoire and Core Book.
 * @type {string[]}
 */
const DEFAULT_STATUSES = [
	"wounded",
	"poisoned",
	"burned",
	"stunned",
	"paralyzed",
	"crushed",
	"exhausted",
	"hungry",
	"scared",
	"confused",
	"convinced",
	"intimidated",
	"humiliated",
	"prone",
	"exposed",
	"surprised",
	"drained",
	"cursed",
	"warded",
	"alert",
	"hidden",
	"inspired",
	"invigorated",
];

const WORLD_STATUS_PACK_ID = "world.litmv2-statuses";
const WORLD_STORY_TAG_PACK_ID = "world.litmv2-story-tags";

export class ContentSources {
	/**
	 * Get compendium packs for a given category, filtered by the world setting.
	 * If the setting is empty, returns all packs of the matching document type.
	 * @param {string} category - One of: "themebooks", "themekits", "tropes", "statuses"
	 * @returns {CompendiumCollection[]}
	 */
	static getPacks(category) {
		const docType = CATEGORY_DOC_TYPE[category];
		if (!docType) {
			error(`ContentSources.getPacks: unknown category "${category}"`);
			return [];
		}

		const selected = LitmSettings.getCompendiumSetting(category);
		const allPacks = game.packs.filter((p) => p.documentName === docType);

		if (!selected?.length) return allPacks;

		const idSet = new Set(selected);
		return allPacks.filter((p) => idSet.has(p.collection));
	}

	/**
	 * Seed the world statuses compendium pack on first load.
	 * Creates the pack and populates it with curated default statuses.
	 * Idempotent — skips if already seeded.
	 */
	static async seedStatuses() {
		if (!game.user.isGM) return;
		if (LitmSettings.statusesSeeded) return;

		try {
			await ContentSources.#createAndPopulateStatusPack();
			await LitmSettings.setStatusesSeeded(true);
			info("Seeded world statuses compendium");
		} catch (err) {
			error("Failed to seed statuses compendium", err);
		}
	}

	/**
	 * Reset the world statuses pack to curated defaults.
	 * Deletes all existing documents and re-populates.
	 */
	static async resetStatuses() {
		const pack = game.packs.get(WORLD_STATUS_PACK_ID);
		if (!pack) {
			await ContentSources.#createAndPopulateStatusPack();
			return;
		}

		const docs = await pack.getDocuments();
		const ids = docs.map((d) => d.id);
		if (ids.length) {
			await foundry.documents.ActiveEffect.deleteDocuments(ids, {
				pack: pack.collection,
			});
		}
		await ContentSources.#populateStatusPack(pack);
		info("Reset world statuses compendium to defaults");
	}

	/**
	 * Create the world status pack and populate it.
	 */
	static async #createAndPopulateStatusPack() {
		let pack = game.packs.get(WORLD_STATUS_PACK_ID);
		if (!pack) {
			pack = await foundry.documents.collections.CompendiumCollection
				.createCompendium({
					name: "litmv2-statuses",
					label: "Statuses",
					type: "ActiveEffect",
					system: "litmv2",
				});
		}
		await ContentSources.#populateStatusPack(pack);

		// Auto-add to the statuses setting
		const current = LitmSettings.getCompendiumSetting("statuses");
		if (!current.includes(pack.collection)) {
			await LitmSettings.setCompendiumSetting("statuses", [
				...current,
				pack.collection,
			]);
		}
	}

	/**
	 * Populate a pack with the curated default status documents.
	 * @param {CompendiumCollection} pack
	 */
	static async #populateStatusPack(pack) {
		const statusData = DEFAULT_STATUSES.map((name) => ({
			name,
			type: "status_tag",
			img: STATUS_ICONS[name] ?? "icons/svg/circle.svg",
			disabled: false,
			system: {
				isHidden: false,
				tiers: [false, false, false, false, false, false],
				limitId: null,
			},
		}));
		await foundry.documents.ActiveEffect.createDocuments(statusData, {
			pack: pack.collection,
		});
	}

	/**
	 * Get or create the world story tag compendium pack.
	 * @returns {Promise<CompendiumCollection>}
	 */
	static async getStoryTagPack() {
		let pack = game.packs.get(WORLD_STORY_TAG_PACK_ID);
		if (!pack) {
			pack = await foundry.documents.collections.CompendiumCollection
				.createCompendium({
					name: "litmv2-story-tags",
					label: "Story Tags",
					type: "ActiveEffect",
					system: "litmv2",
				});
		}
		return pack;
	}

	/**
	 * Load all documents from the story tag pack.
	 * @returns {Promise<ActiveEffect[]>}
	 */
	static async getStoryTags() {
		const pack = await ContentSources.getStoryTagPack();
		return pack.getDocuments();
	}

	/**
	 * Create story/status tag ActiveEffects in the pack.
	 * @param {object[]} data - Array of AE creation data
	 * @returns {Promise<ActiveEffect[]>}
	 */
	static async createStoryTags(data) {
		const pack = await ContentSources.getStoryTagPack();
		return foundry.documents.ActiveEffect.createDocuments(data, {
			pack: pack.collection,
		});
	}

	/**
	 * Update story/status tag ActiveEffects in the pack.
	 * @param {object[]} updates - Array of `{ _id, ...changes }` objects
	 * @returns {Promise<ActiveEffect[]>}
	 */
	static async updateStoryTags(updates) {
		const pack = await ContentSources.getStoryTagPack();
		return foundry.documents.ActiveEffect.updateDocuments(updates, {
			pack: pack.collection,
		});
	}

	/**
	 * Delete story/status tag ActiveEffects from the pack.
	 * @param {string[]} ids - Array of document IDs to delete
	 * @returns {Promise<void>}
	 */
	static async deleteStoryTags(ids) {
		const pack = await ContentSources.getStoryTagPack();
		return foundry.documents.ActiveEffect.deleteDocuments(ids, {
			pack: pack.collection,
		});
	}

	/**
	 * Convert a legacy JSON scene tag to ActiveEffect creation data.
	 * @param {object} tag - Legacy tag from settings `{ id, name, type, values, isScratched, isSingleUse, hidden, limitId }`
	 * @returns {object} ActiveEffect creation data
	 */
	static legacyTagToEffectData(tag) {
		const isStatus = tag.type === "status";
		return {
			name: tag.name,
			type: isStatus ? "status_tag" : "story_tag",
			img: "systems/litmv2/assets/media/icons/consequences.svg",
			disabled: false,
			system: isStatus
				? {
					isHidden: tag.hidden ?? false,
					tiers: (tag.values ?? []).map((v) => v === true),
					limitId: tag.limitId ?? null,
				}
				: {
					isScratched: tag.isScratched ?? false,
					isSingleUse: tag.isSingleUse ?? false,
					isHidden: tag.hidden ?? false,
					limitId: tag.limitId ?? null,
				},
		};
	}
}

export { WORLD_STORY_TAG_PACK_ID };
