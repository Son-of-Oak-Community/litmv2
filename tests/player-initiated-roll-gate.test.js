import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	blockPlayerInitiatedRoll,
	canUserInitiateRoll,
} from "../modules/apps/roll/roll-pipeline.js";

// roll-pipeline.js: "Gate an instigating entry point, warning the user when the
// table routes rolls through the Narrator. Returns true when the caller should
// stop." CLAUDE.md: `player_initiated_rolls` is "default on, and it gates
// players only... every GM entry point is therefore gated on `isGM` alone and
// never on this setting".

let setting;
beforeEach(() => {
	setting = true;
	game.settings.get.mockImplementation((scope, key) =>
		scope === "litmv2" && key === "player_initiated_rolls"
			? setting
			: undefined,
	);
});
afterEach(() => {
	game.settings.get.mockReset();
	ui.notifications.info.mockClear();
});

const as = (isGM) => {
	game.user = { id: isGM ? "gm" : "player", isGM };
};

describe("blockPlayerInitiatedRoll", () => {
	it("lets a player start a roll while the table allows it, saying nothing", () => {
		as(false);
		setting = true;
		expect(blockPlayerInitiatedRoll()).toBe(false);
		expect(ui.notifications.info).not.toHaveBeenCalled();
	});

	it("stops a player and tells them why when the Narrator calls every roll", () => {
		as(false);
		setting = false;
		expect(blockPlayerInitiatedRoll()).toBe(true);
		expect(ui.notifications.info).toHaveBeenCalledTimes(1);
		expect(ui.notifications.info).toHaveBeenCalledWith(
			"LITM.Ui.narrator_call_player_rolls_disabled",
		);
	});

	it.each([true, false])(
		"never stops the Narrator, whatever the setting says (setting: %s)",
		(value) => {
			as(true);
			setting = value;
			expect(blockPlayerInitiatedRoll()).toBe(false);
			expect(ui.notifications.info).not.toHaveBeenCalled();
		},
	);

	it("reads an unset value as on", () => {
		as(false);
		setting = undefined;
		expect(blockPlayerInitiatedRoll()).toBe(false);
	});

	it("reads the world's `player_initiated_rolls` setting each time it is asked", () => {
		as(false);
		setting = false;
		expect(blockPlayerInitiatedRoll()).toBe(true);
		setting = true;
		expect(blockPlayerInitiatedRoll()).toBe(false);
		expect(game.settings.get).toHaveBeenCalledWith(
			"litmv2",
			"player_initiated_rolls",
		);
	});

	it("still stops the player when notifications are not available", () => {
		as(false);
		setting = false;
		const { notifications } = ui;
		ui.notifications = undefined;
		try {
			expect(blockPlayerInitiatedRoll()).toBe(true);
		} finally {
			ui.notifications = notifications;
		}
	});
});

describe("canUserInitiateRoll", () => {
	it("judges the user it is given, not the current one", () => {
		as(false);
		setting = false;
		expect(canUserInitiateRoll({ isGM: true })).toBe(true);
		expect(canUserInitiateRoll({ isGM: false })).toBe(false);
	});

	it("falls back to the current user", () => {
		setting = false;
		as(true);
		expect(canUserInitiateRoll()).toBe(true);
		as(false);
		expect(canUserInitiateRoll()).toBe(false);
	});

	it("treats a missing user as a player", () => {
		setting = false;
		expect(canUserInitiateRoll(null)).toBe(false);
		setting = true;
		expect(canUserInitiateRoll(null)).toBe(true);
	});
});
