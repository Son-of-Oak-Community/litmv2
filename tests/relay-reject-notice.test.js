import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sockets } from "../modules/system/sockets.js";

describe("Sockets.reportRejected", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		game.users.get.mockImplementation((id) =>
			id === "p1" ? { name: "Player One" } : undefined,
		);
	});

	it("tells the Narrator who asked and for what", () => {
		Sockets.reportRejected("scratchEffect", "no roll card", "p1");
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.relay_rejected",
		);
		// The mock format() fills the placeholders it finds; the key has none,
		// so assert on the data passed instead.
		const spy = vi.spyOn(game.i18n, "format");
		Sockets.reportRejected("gainImprovement", "no roll card", "p1");
		expect(spy).toHaveBeenCalledWith("LITM.Ui.relay_rejected", {
			user: "Player One",
			action: "LITM.Ui.relay_action_improve",
		});
	});

	it("shows a flood of refusals from one sender once", () => {
		Sockets.reportRejected("applyStatusAsGM", "over budget", "p2");
		Sockets.reportRejected("applyStatusAsGM", "over budget", "p2");
		Sockets.reportRejected("applyStatusAsGM", "over budget", "p2");
		expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
	});
});
