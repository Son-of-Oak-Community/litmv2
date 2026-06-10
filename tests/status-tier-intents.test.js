import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusTagData } from "../modules/active-effects/status-tag-data.js";

// toggleTier / reduceTier — the single tier-mutation path shared by the hero
// sheet, base sheet, sidebar, token HUD, and spend-power. The delete-on-empty
// policy is the caller's explicit choice.

const makeStatus = (tiers) => {
	const model = new StatusTagData({ tiers });
	model.parent = {
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	};
	return model;
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("StatusTagData#toggleTier", () => {
	it("toggles the requested tier box on", async () => {
		const status = makeStatus([false, false, false, false, false, false]);
		await status.toggleTier(3);
		expect(status.parent.update).toHaveBeenCalledWith({
			"system.tiers": [false, false, true, false, false, false],
		});
	});

	it("keeps a tier-less status by default when the last box is unmarked", async () => {
		const status = makeStatus([false, true, false, false, false, false]);
		await status.toggleTier(2);
		expect(status.parent.update).toHaveBeenCalledWith({
			"system.tiers": [false, false, false, false, false, false],
		});
		expect(status.parent.delete).not.toHaveBeenCalled();
	});

	it("deletes instead when deleteOnEmpty is set and no tier remains", async () => {
		const status = makeStatus([false, true, false, false, false, false]);
		await status.toggleTier(2, { deleteOnEmpty: true });
		expect(status.parent.delete).toHaveBeenCalled();
		expect(status.parent.update).not.toHaveBeenCalled();
	});

	it("is a no-op for out-of-range tiers", async () => {
		const status = makeStatus([true, false, false, false, false, false]);
		await status.toggleTier(7);
		await status.toggleTier(0);
		expect(status.parent.update).not.toHaveBeenCalled();
	});
});

describe("StatusTagData#reduceTier", () => {
	it("shifts all marked tiers down by the amount", async () => {
		const status = makeStatus([false, false, true, false, false, false]);
		await status.reduceTier(1);
		expect(status.parent.update).toHaveBeenCalledWith({
			"system.tiers": [false, true, false, false, false, false],
		});
	});

	it("is a no-op when nothing is marked", async () => {
		const status = makeStatus([false, false, false, false, false, false]);
		await status.reduceTier(1);
		expect(status.parent.update).not.toHaveBeenCalled();
		expect(status.parent.delete).not.toHaveBeenCalled();
	});

	it("deletes when the reduction empties the status and deleteOnEmpty is set", async () => {
		const status = makeStatus([true, false, false, false, false, false]);
		await status.reduceTier(1, { deleteOnEmpty: true });
		expect(status.parent.delete).toHaveBeenCalled();
	});

	it("keeps the emptied status without deleteOnEmpty", async () => {
		const status = makeStatus([true, false, false, false, false, false]);
		await status.reduceTier(1);
		expect(status.parent.update).toHaveBeenCalledWith({
			"system.tiers": [false, false, false, false, false, false],
		});
		expect(status.parent.delete).not.toHaveBeenCalled();
	});
});
