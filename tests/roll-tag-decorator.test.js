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

	it("names a relationship's Hero with their portrait", () => {
		game.user = { id: "player", isGM: false };
		const get = game.actors.get;
		game.actors.get = (id) =>
			id === "h2" ? { name: "Arsinia Hawt", img: "arsinia.webp" } : null;
		try {
			const row = makeTagDecorator({ isOwner: true })({
				id: "r1",
				type: "relationship_tag",
				system: { targetId: "h2" },
			});
			expect(row.targetName).toBe("Arsinia Hawt");
			expect(row.targetImg).toBe("arsinia.webp");
		} finally {
			game.actors.get = get;
		}
	});
});
