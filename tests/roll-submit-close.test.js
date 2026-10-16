import { describe, expect, it, vi } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn(), on: vi.fn() },
}));

// The dialog closes itself after a submit; Foundry's closeOnSubmit would also
// close it after a guard refused the roll, ending the shared roll with it.
describe("roll dialog submit closes only on success", () => {
	it("keeps the window open when a guard refuses the roll", async () => {
		const dialog = {
			isOwner: true,
			painfulSacrificeHasNoTarget: () => true,
			close: vi.fn(),
		};
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});
		expect(dialog.close).not.toHaveBeenCalled();
	});

	it("closes after posting a moderation request", async () => {
		const dialog = {
			isOwner: true,
			requiresApproval: true,
			painfulSacrificeHasNoTarget: () => false,
			extractRollData: () => ({ type: "quick", tags: [] }),
			_createModerationRequest: vi.fn(),
			suspendForModeration: vi.fn(),
			close: vi.fn(),
		};
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});
		expect(dialog.close).toHaveBeenCalledWith({ submitted: true });
	});
});

// Tags stored on a moderation card lose data-model getters in the flag round
// trip; the plain fields the dialog now stores carry the same answers.
describe("roll tags survive the moderation round trip", () => {
	it("still refuses a burn the tag can't take", () => {
		const tag = JSON.parse(
			JSON.stringify({ state: "scratched", type: "story_tag", canBurn: false, system: {} }),
		);
		expect(LitmRoll.filterTags([tag]).scratchedTags).toHaveLength(0);
	});
});
