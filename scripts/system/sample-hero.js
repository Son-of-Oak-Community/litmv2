import { info } from "../logger.js";

const SAMPLE_HERO_JSON = "systems/litmv2/assets/sample-hero.json";

/**
 * Create a pre-built sample hero actor for tours and onboarding.
 * Imports from the bundled JSON export so the hero arrives fully
 * populated with themes, tags, and a backpack.
 * @returns {Promise<Actor|null>} The created actor, or null if one already exists
 */
export async function createSampleHero() {
	// Don't create if one already exists
	const existing = game.actors.find(
		(a) => a.type === "hero" && a.getFlag("litmv2", "isSampleHero"),
	);
	if (existing) return existing;

	info("Creating sample hero...");

	const response = await foundry.utils.fetchJsonWithTimeout(SAMPLE_HERO_JSON);
	// Ensure the sample hero is only visible to the GM
	response.ownership = {
		default: foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
	};

	// Convert legacy tag arrays in theme items to ActiveEffect data
	for (const itemData of response.items ?? []) {
		if (itemData.type !== "theme" && itemData.type !== "story_theme") continue;
		const sys = itemData.system || {};
		const tags = [
			...(sys.powerTags ?? []).map((t) => ({ ...t, tagType: "powerTag" })),
			...(sys.weaknessTags ?? []).map((t) => ({ ...t, tagType: "weaknessTag" })),
			...(sys.theme?.powerTags ?? []).map((t) => ({ ...t, tagType: "powerTag" })),
			...(sys.theme?.weaknessTags ?? []).map((t) => ({ ...t, tagType: "weaknessTag" })),
		];
		delete sys.powerTags;
		delete sys.weaknessTags;
		if (sys.theme) {
			delete sys.theme.powerTags;
			delete sys.theme.weaknessTags;
		}
		itemData.effects = (itemData.effects ?? []).concat(
			tags.map((tag) => ({
				name: tag.name || "",
				type: tag.tagType === "weaknessTag" ? "weakness_tag" : "power_tag",
				disabled: !(tag.isActive ?? false),
				system: {
					question: tag.question ?? null,
					...(tag.tagType !== "weaknessTag" ? { isScratched: tag.isScratched ?? false } : {}),
				},
			})),
		);
	}

	const actor = await foundry.documents.Actor.create(response, {
		litm: { skipHeroWizard: true, skipAutoSetup: true },
	});

	if (!actor) return null;

	await game.user.update({ character: actor.id });

	info("Sample hero created:", actor.name);
	return actor;
}
