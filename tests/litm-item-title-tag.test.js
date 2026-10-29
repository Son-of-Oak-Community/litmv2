import { afterEach, describe, expect, it } from "vitest";
import { LitmItem } from "../modules/item/litm-item.js";
import { fakeEffect, fakeItem } from "./__helpers__/factories.js";

class RequiresTitleTag {
	static requiresTitleTag = true;
}

const theme = (effects = []) => {
	const item = fakeItem({ type: "theme", name: "Hardened Warrior", effects });
	item.system = new RequiresTitleTag();
	return item;
};

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LitmItem.ensureTitleTag", () => {
	const unhandled = [];
	const onUnhandled = (reason) => unhandled.push(reason);

	afterEach(() => {
		process.off("unhandledRejection", onUnhandled);
		unhandled.length = 0;
	});

	it("surfaces a failed create to the caller without a second unhandled rejection", async () => {
		process.on("unhandledRejection", onUnhandled);
		const item = theme();
		item.createEmbeddedDocuments.mockRejectedValue(new Error("create failed"));

		await expect(LitmItem.ensureTitleTag(item)).rejects.toThrow(
			"create failed",
		);
		await nextMacrotask();

		expect(unhandled).toEqual([]);
	});

	it("retries after a failure instead of caching the rejected promise", async () => {
		const item = theme();
		item.createEmbeddedDocuments
			.mockRejectedValueOnce(new Error("create failed"))
			.mockResolvedValueOnce([]);

		await expect(LitmItem.ensureTitleTag(item)).rejects.toThrow();
		await LitmItem.ensureTitleTag(item);

		expect(item.createEmbeddedDocuments).toHaveBeenCalledTimes(2);
	});

	it("shares one create between concurrent calls", async () => {
		const item = theme();

		await Promise.all([
			LitmItem.ensureTitleTag(item),
			LitmItem.ensureTitleTag(item),
		]);

		expect(item.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
	});

	it("leaves an item that already has a title tag alone", async () => {
		const item = theme([
			fakeEffect({ type: "power_tag", system: { isTitleTag: true } }),
		]);

		await LitmItem.ensureTitleTag(item);

		expect(item.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

// Migrations 002/003 and the createItem/createActor hooks all funnel through
// here. A burn is persistent state on the title tag, so a duplicate that is
// scratched has to be the one that survives.
describe("LitmItem.ensureTitleTag duplicates", () => {
	const titleTag = (isScratched) =>
		fakeEffect({
			type: "power_tag",
			system: { isTitleTag: true, isScratched },
		});

	it("keeps the first title tag when none are scratched", async () => {
		const [keep, dupe] = [titleTag(false), titleTag(false)];
		const item = theme([keep, dupe]);

		await LitmItem.ensureTitleTag(item);

		expect(item.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			dupe.id,
		]);
	});

	it("keeps the scratched title tag so the burn is not undone", async () => {
		const [fresh, burned] = [titleTag(false), titleTag(true)];
		const item = theme([fresh, burned]);

		await LitmItem.ensureTitleTag(item);

		expect(item.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			fresh.id,
		]);
	});

	it("deletes every other copy when several are present", async () => {
		const [a, b, c] = [titleTag(false), titleTag(true), titleTag(false)];
		const item = theme([a, b, c]);

		await LitmItem.ensureTitleTag(item);

		expect(item.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			a.id,
			c.id,
		]);
	});
});
