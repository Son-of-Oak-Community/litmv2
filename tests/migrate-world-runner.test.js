import { beforeEach, describe, expect, it, vi } from "vitest";

// The world migrations themselves are tested in their own files; here each is
// a spy, so what is under test is the runner: which ones it runs, in what
// order, and what version it stamps.
const ran = vi.hoisted(() => []);
vi.mock("../modules/system/migrations/001-legacy-effects.js", () => ({
	migrate: vi.fn(async () => void ran.push(1)),
}));
vi.mock("../modules/system/migrations/002-dedup-title-tags.js", () => ({
	migrate: vi.fn(async () => void ran.push(2)),
}));
vi.mock("../modules/system/migrations/003-redo-dedup-title-tags.js", () => ({
	migrate: vi.fn(async () => void ran.push(3)),
}));

import { migrate as migrateV2 } from "../modules/system/migrations/002-dedup-title-tags.js";
import { migrateWorld } from "../modules/system/migrations.js";
import { setGM } from "./__helpers__/users.js";

const LATEST = 3;

/** Run the pass on a world whose stored migration version is `version`. */
const runFrom = async (version) => {
	game.settings.get.mockImplementation((_scope, key) =>
		key === "systemMigrationVersion" ? version : undefined,
	);
	await migrateWorld();
};

const stamped = () =>
	game.settings.set.mock.calls
		.filter(([, key]) => key === "systemMigrationVersion")
		.map(([, , version]) => version);

beforeEach(() => {
	vi.clearAllMocks();
	ran.length = 0;
	setGM("gm");
	game.users.activeGM = game.user;
	Hooks.onError = vi.fn();
	vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("migrateWorld: which migrations run", () => {
	it("runs every migration, in order, on a world that has run none", async () => {
		await runFrom(0);

		expect(ran).toEqual([1, 2, 3]);
		expect(stamped()).toEqual([LATEST]);
	});

	it("runs only the migrations after the stored version", async () => {
		await runFrom(1);

		expect(ran).toEqual([2, 3]);
		expect(stamped()).toEqual([LATEST]);
	});

	it("runs the last one alone on a world one version behind", async () => {
		await runFrom(LATEST - 1);

		expect(ran).toEqual([LATEST]);
		expect(stamped()).toEqual([LATEST]);
	});

	it("runs nothing and writes nothing on a world that is up to date", async () => {
		await runFrom(LATEST);

		expect(ran).toEqual([]);
		expect(stamped()).toEqual([]);
		expect(ui.notifications.info).not.toHaveBeenCalled();
	});

	// A new world has nothing to migrate: it is stamped as up to date.
	it("stamps a new world with the latest version and runs nothing", async () => {
		await runFrom(-1);

		expect(ran).toEqual([]);
		expect(stamped()).toEqual([LATEST]);
		expect(ui.notifications.info).not.toHaveBeenCalled();
	});

	it("says when it starts and when it is done", async () => {
		await runFrom(0);

		expect(ui.notifications.info.mock.calls).toEqual([
			["LITM.Ui.migration_start", { permanent: true }],
			["LITM.Ui.migration_complete", { permanent: true }],
		]);
	});
});

// A stamp after a failure would mark the world migrated for good, with the
// failed migration never run again.
describe("migrateWorld: a migration that fails", () => {
	beforeEach(() => {
		migrateV2.mockImplementationOnce(async () => {
			ran.push("2 failed");
			throw new Error("boom");
		});
	});

	it("stops there and leaves the stored version alone", async () => {
		await runFrom(0);

		expect(ran).toEqual([1, "2 failed"]);
		expect(stamped()).toEqual([]);
	});

	it("resolves, reports the error and tells the Narrator", async () => {
		await expect(runFrom(0)).resolves.toBeUndefined();

		expect(Hooks.onError).toHaveBeenCalledTimes(1);
		const [location, err, options] = Hooks.onError.mock.calls[0];
		expect(location).toBe("litmv2.migrateWorld");
		expect(err.message).toBe("boom");
		expect(options.msg).toContain("version 2");
		expect(ui.notifications.error).toHaveBeenCalledWith(
			"LITM.Ui.migration_failed",
			{ permanent: true, console: false },
		);
		expect(ui.notifications.info).not.toHaveBeenCalledWith(
			"LITM.Ui.migration_complete",
			expect.anything(),
		);
	});

	it("runs the failed migration again on the next load", async () => {
		await runFrom(0);
		ran.length = 0;

		await runFrom(0);

		expect(ran).toEqual([1, 2, 3]);
		expect(stamped()).toEqual([LATEST]);
	});

	it("wraps a thrown value that is not an Error", async () => {
		migrateV2.mockReset();
		migrateV2.mockImplementationOnce(async () => {
			throw "plain text";
		});

		await runFrom(1);

		const [, err] = Hooks.onError.mock.calls[0];
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toBe("plain text");
		expect(stamped()).toEqual([]);
	});
});
