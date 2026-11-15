import { describe, expect, it } from "vitest";

// The stub classes are shared by every file in a worker (isolate: false);
// tests/setup.js puts their statics back for each file. Some files assign
// statics (fellowship-hooks sets Actor.create, dialog tests replace
// DialogV2.confirm). If the reset broke, this file would see their values
// whenever one of them ran before it in the same worker.
describe("stub classes at the start of a file", () => {
	it("carry none of another file's statics", () => {
		const { Actor } = foundry.documents;
		expect(Object.hasOwn(Actor, "create")).toBe(false);
		expect(Object.hasOwn(Actor, "updateDocuments")).toBe(false);
	});

	it("have the stock dialog answers", async () => {
		const { DialogV2 } = foundry.applications.api;
		await expect(DialogV2.confirm()).resolves.toBe(false);
		await expect(DialogV2.wait()).resolves.toBeNull();
	});

	it("have fresh chat-message mocks", () => {
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});
});
