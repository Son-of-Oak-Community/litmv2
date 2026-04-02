import { error, info } from "../logger.js";
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
/**
 * Migrate a single item's legacy tag arrays to ActiveEffects.
 * @param {Item} item
 */
async function _migrateItemTags(item) {
	if (item.type === "theme" || item.type === "story_theme") {
		if (item.effects.some((e) => e.type === "theme_tag")) return;
		const sys = item._source?.system ?? {};
		const isStory = item.type === "story_theme";
		const power = isStory
			? (sys.theme?.powerTags ?? sys.powerTags ?? [])
			: (sys.powerTags ?? []);
		const weakness = isStory
			? (sys.theme?.weaknessTags ?? sys.weaknessTags ?? [])
			: (sys.weaknessTags ?? []);
		const effects = [
			...power.map((t) => ({
				name: t.name || "", type: "theme_tag",
				disabled: !(t.isActive ?? false),
				system: { tagType: "powerTag", question: t.question ?? null,
					isScratched: t.isScratched ?? false, isSingleUse: t.isSingleUse ?? false },
			})),
			...weakness.map((t) => ({
				name: t.name || "", type: "theme_tag",
				disabled: !(t.isActive ?? false),
				system: { tagType: "weaknessTag", question: t.question ?? null,
					isScratched: t.isScratched ?? false, isSingleUse: t.isSingleUse ?? false },
			})),
		];
		if (effects.length) {
			await item.createEmbeddedDocuments("ActiveEffect", effects);
		}
	}

	if (item.type === "backpack") {
		if (item.effects.some((e) => e.type === "story_tag")) return;
		const contents = item._source?.system?.contents ?? [];
		if (!contents.length) return;
		await item.createEmbeddedDocuments("ActiveEffect", contents.map((t) => ({
			name: t.name || "", type: "story_tag", transfer: true,
			disabled: !(t.isActive ?? true),
			system: { isScratched: t.isScratched ?? false,
				isSingleUse: t.isSingleUse ?? false, isHidden: false },
		})));
		await item.update({ "system.-=contents": null });
	}
}

const MIGRATIONS = [
	{
		version: 1,
		migrate: async () => {
			// World actors and their embedded items
			for (const actor of game.actors) {
				for (const item of actor.items) {
					try { await _migrateItemTags(item); }
					catch (err) { error(`Migration: ${item.uuid}`, err); }
				}
			}

			// Standalone world items
			for (const item of game.items) {
				try { await _migrateItemTags(item); }
				catch (err) { error(`Migration: ${item.uuid}`, err); }
			}

			// Compendium packs that use this system (system's own + content modules)
			for (const pack of game.packs.filter((p) =>
				p.metadata.system === "litmv2" &&
				(p.documentName === "Actor" || p.documentName === "Item")
			)) {
				const docs = await pack.getDocuments();
				for (const doc of docs) {
					const items = doc.documentName === "Actor" ? doc.items : [doc];
					for (const item of items) {
						try { await _migrateItemTags(item); }
						catch (err) { error(`Migration: ${item.uuid}`, err); }
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
