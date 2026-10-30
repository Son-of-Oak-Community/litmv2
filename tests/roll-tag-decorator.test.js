import { describe, expect, it } from "vitest";
import { makeTagDecorator } from "../modules/apps/roll/roll-dialog-context.js";

describe("makeTagDecorator", () => {
	it("keeps the Narrator's inversion in a player's cycle so the row shows it", () => {
		game.user = { id: "player", isGM: false };
		const row = makeTagDecorator({ isOwner: true })({
			id: "t1",
			type: "power_tag",
			state: "negative",
			narrator: true,
			system: { playerAllowedStates: ",positive,scratched" },
		});
		expect(row.states.split(",")).toContain("negative");
		expect(row.locked).toBe(true);
	});

	it("leaves an ordinary cycle alone", () => {
		game.user = { id: "player", isGM: false };
		const row = makeTagDecorator({ isOwner: true })({
			id: "t1",
			type: "power_tag",
			state: "positive",
			system: { playerAllowedStates: ",positive,scratched" },
		});
		expect(row.states).toBe(",positive,scratched");
	});
});
