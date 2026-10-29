import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { executeRoll } from "../modules/apps/roll/roll-pipeline.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeEffect } from "./__helpers__/factories.js";

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

describe("roll result bookkeeping failure", () => {
	// The chat card already exists by the time the post-roll effects run. A
	// failed scratch must not leave the dialog open and armed: Roll could be
	// pressed again and post a second card for the same roll.
	it("still resets the dialog and tells the table when a scratch fails", async () => {
		const burned = fakeEffect({
			id: "burned",
			type: "power_tag",
			system: {
				setScratched: vi.fn().mockRejectedValue(new Error("scratch refused")),
			},
		});
		actor.system = {};
		actor.allApplicableEffects = () => [burned];
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await executeRoll({
			actorId: "hero",
			tags: [{ id: "burned", type: "power_tag", state: "scratched" }],
			type: "quick",
			syncSession: "current",
		});

		expect(result).toBeDefined();
		expect(console.error).toHaveBeenCalled();
		expect(actor.sheet.resetRollDialog).toHaveBeenCalledTimes(1);
		expect(Sockets.dispatch).toHaveBeenCalledWith("resetRollDialog", {
			actorId: "hero",
			syncSession: "current",
		});
	});
});
