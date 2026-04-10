import { info } from "../logger.js";
import { localize as t } from "../utils.js";
import { LitmSettings } from "./settings.js";
import { migrate as migrateV1 } from "./migrations/001-legacy-effects.js";

/**
 * Registry of world-level migrations.
 * Each entry has a `version` (sequential integer) and an async `migrate` function
 * imported from a module in `./migrations/`.
 *
 * Migrations run in ascending order for any version higher than the stored
 * migration version. The version counter is independent of the system version
 * in system.json — it tracks only how many migrations have been applied.
 *
 * To add a new migration:
 * 1. Create a new module in `./migrations/` (e.g. `002-my-migration.js`)
 *    exporting an async `migrate()` function.
 * 2. Import it here and append an entry with the next sequential version.
 */
const MIGRATIONS = [
	{ version: 1, migrate: migrateV1 },
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
			const error = err instanceof Error
				? err
				: new Error(String(err), { cause: err });
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
