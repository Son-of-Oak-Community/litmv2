import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { executeRoll } from "../modules/apps/roll/roll-pipeline.js";
import { Sockets } from "../modules/system/sockets.js";

let actor;

beforeEach(() => {
	vi.restoreAllMocks();
	actor = {
		id: "hero",
		sheet: {
			hasRollDialog: true,
			rollDialogInstance: { syncSession: "current" },
			resetRollDialog: vi.fn(),
		},
	};
	game.actors.get.mockReturnValue(actor);
	game.litmv2 = {
		LitmRoll: class {
			toMessage() {
				return Promise.resolve({ rolls: [{ actor }] });
			}
		},
	};
	vi.spyOn(LitmRoll, "captureConcealment").mockImplementation((tags) => tags);
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
});

describe("roll result session", () => {
	it.each([
		["current", true],
		["an-older-call", false],
		[null, true],
	])("resets only its own draft (session %s)", async (syncSession, reset) => {
		await executeRoll({
			actorId: "hero",
			tags: [],
			type: "quick",
			syncSession,
		});
		expect(actor.sheet.resetRollDialog).toHaveBeenCalledTimes(reset ? 1 : 0);
		expect(Sockets.dispatch).toHaveBeenCalledWith("resetRollDialog", {
			actorId: "hero",
			syncSession,
		});
	});
});
