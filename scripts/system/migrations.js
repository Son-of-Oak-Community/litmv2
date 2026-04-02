import { info } from "../logger.js";
import { localize as t } from "../utils.js";
import { LitmSettings } from "./settings.js";

/**
 * Registry of world-level migrations.
 * Each entry has a `version` (sequential integer) and an async `migrate` function.
 * Migrations run in ascending order for any version higher than the stored
 * migration version. The version counter is independent of the system version
 * in system.json — it tracks only how many migrations have been applied.
 *
 * To add a new migration:
 * 1. Add an entry to MIGRATIONS with the next sequential version number
 *
 * Example:
 * { version: 1, migrate: async () => { ... } }
 */
const MIGRATIONS = [
	{
		version: 1,
		migrate: async () => {
			// Convert theme/story_theme powerTags & weaknessTags arrays to ActiveEffects
			for (const actor of game.actors) {
				const themeItems = actor.items.filter(
					(i) => i.type === "theme" || i.type === "story_theme",
				);
				for (const item of themeItems) {
					// Skip if already migrated
					if (item.effects.some((e) => e.type === "theme_tag")) continue;

					const raw = item.toObject();
					const isStoryTheme = item.type === "story_theme";
					const powerTags = isStoryTheme
						? (raw.system?.theme?.powerTags ?? [])
						: (raw.system?.powerTags ?? []);
					const weaknessTags = isStoryTheme
						? (raw.system?.theme?.weaknessTags ?? [])
						: (raw.system?.weaknessTags ?? []);

					const effectData = [];
					for (const tag of powerTags) {
						effectData.push({
							name: tag.name || "",
							type: "theme_tag",
							disabled: !(tag.isActive ?? false),
							system: {
								tagType: "powerTag",
								question: tag.question ?? null,
								isScratched: tag.isScratched ?? false,
								isSingleUse: tag.isSingleUse ?? false,
							},
							flags: { litmv2: { tagId: tag.id } },
						});
					}
					for (const tag of weaknessTags) {
						effectData.push({
							name: tag.name || "",
							type: "theme_tag",
							disabled: !(tag.isActive ?? false),
							system: {
								tagType: "weaknessTag",
								question: tag.question ?? null,
								isScratched: tag.isScratched ?? false,
								isSingleUse: tag.isSingleUse ?? false,
							},
							flags: { litmv2: { tagId: tag.id } },
						});
					}

					if (effectData.length) {
						await item.createEmbeddedDocuments("ActiveEffect", effectData);
					}
				}
			}
		},
	},
];

/**
 * Run all pending world-level migrations.
 * Called once during the "ready" hook, GM-only.
 */
export async function migrateWorld() {
	if (!game.user.isGM) return;

	const storedVersion = LitmSettings.systemMigrationVersion;

	// First load ever — stamp and skip
	if (storedVersion === -1) {
		const latest = MIGRATIONS.length
			? Math.max(...MIGRATIONS.map((m) => m.version))
			: 0;
		info(`First world load — stamping migration version to ${latest}`);
		await LitmSettings.setSystemMigrationVersion(latest);
		return;
	}

	// Collect and sort pending migrations
	const pending = MIGRATIONS.filter((m) => m.version > storedVersion).sort(
		(a, b) => a.version - b.version,
	);
	if (!pending.length) return;

	// Run pending migrations in order
	ui.notifications.info(t("LITM.Ui.migration_start"), { permanent: true });

	for (const { version, migrate } of pending) {
		try {
			info(`Running migration to version ${version}...`);
			await migrate();
			info(`Migration to version ${version} complete`);
		} catch (err) {
			const error =
				err instanceof Error ? err : new Error(String(err), { cause: err });
			Hooks.onError("litmv2.migrateWorld", error, {
				msg: `[litmv2] Migration to version ${version} failed`,
				log: "error",
				notify: null,
			});
			ui.notifications.error(t("LITM.Ui.migration_failed"), {
				permanent: true,
				console: false,
			});
			// Stop running further migrations on failure
			return;
		}
	}

	// Stamp the highest migration version applied
	const highestApplied = pending[pending.length - 1].version;
	await LitmSettings.setSystemMigrationVersion(highestApplied);

	ui.notifications.info(t("LITM.Ui.migration_complete"), { permanent: true });
}
