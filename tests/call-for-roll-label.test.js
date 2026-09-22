import { describe, expect, it } from "vitest";
import { callForRollLabel } from "../modules/apps/roll/roll-request.js";

/**
 * An Action embedded on a Hero calls the roll for that Hero rather than
 * opening a picker with nobody chosen, so the button has to say whose roll it
 * is about to call. Anything else genuinely does open a picker.
 */
describe("callForRollLabel", () => {
	it("names the Hero an Action is embedded on", () => {
		expect(callForRollLabel({ type: "hero", name: "Rill" })).toBe(
			"LITM.Actions.call_for_actor",
		);
	});

	it("falls back to the generic label for a world or compendium Action", () => {
		expect(callForRollLabel(null)).toBe("LITM.Actions.request_dialog_title");
		expect(callForRollLabel(undefined)).toBe(
			"LITM.Actions.request_dialog_title",
		);
	});

	it("falls back for an Action embedded on something that is not a Hero", () => {
		expect(callForRollLabel({ type: "challenge", name: "The Gate" })).toBe(
			"LITM.Actions.request_dialog_title",
		);
	});
});
