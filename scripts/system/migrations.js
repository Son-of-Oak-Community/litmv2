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
	// { version: 1, migrate: async () => { ... } },
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
	const pending = MIGRATIONS
		.filter((m) => m.version > storedVersion)
		.sort((a, b) => a.version - b.version);
	if (!pending.length) return;

	// Run pending migrations in order
	ui.notifications.info(
		t("LITM.Ui.migration_start"),
		{ permanent: true },
	);

	for (const { version, migrate } of pending) {
		try {
			info(`Running migration to version ${version}...`);
			await migrate();
			info(`Migration to version ${version} complete`);
		} catch (err) {
			console.error(`litm | Migration to version ${version} failed`, err);
			ui.notifications.error(
				t("LITM.Ui.migration_failed"),
				{ permanent: true },
			);
			// Stop running further migrations on failure
			return;
		}
	}

	// Stamp the highest migration version applied
	const highestApplied = pending[pending.length - 1].version;
	await LitmSettings.setSystemMigrationVersion(highestApplied);

	ui.notifications.info(
		t("LITM.Ui.migration_complete"),
		{ permanent: true },
	);
}
