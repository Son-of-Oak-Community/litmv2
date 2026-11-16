import { describe, expect, it, vi } from "vitest";

// The stub classes are shared by every file in a worker (isolate: false);
// tests/setup.js runs again for each file and puts their statics back. Some
// files assign statics (fellowship-hooks sets Actor.create, dialog tests
// replace DialogV2.confirm). Each test here dirties the classes the way such
// a file does, runs the setup file once more, as vitest does before the next
// file, and looks at what that file would see.

// Run tests/setup.js again. The query makes each a fresh module; it is a
// literal because the import is resolved at transform time.
const rerunSetup = [
	() => import("./setup.js?rerun=1"),
	() => import("./setup.js?rerun=2"),
	() => import("./setup.js?rerun=3"),
];

describe("tests/setup.js, run again for the next file", () => {
	it("removes a static another file added", async () => {
		const { Actor } = foundry.documents;
		Actor.create = vi.fn();
		Actor.updateDocuments = vi.fn();

		await rerunSetup[0]();

		expect(foundry.documents.Actor).toBe(Actor);
		expect(Object.hasOwn(Actor, "create")).toBe(false);
		expect(Object.hasOwn(Actor, "updateDocuments")).toBe(false);
	});

	it("puts back a static another file replaced", async () => {
		const { DialogV2 } = foundry.applications.api;
		DialogV2.confirm = () => Promise.resolve(true);
		DialogV2.wait = () => Promise.resolve("picked");

		await rerunSetup[1]();

		await expect(DialogV2.confirm()).resolves.toBe(false);
		await expect(DialogV2.wait()).resolves.toBeNull();
	});

	it("hands out chat-message mocks with no call history", async () => {
		const { ChatMessage } = foundry.documents;
		await ChatMessage.create({ content: "left over" });
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);

		await rerunSetup[2]();

		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
		await expect(
			foundry.documents.ChatMessage.create({ a: 1 }),
		).resolves.toEqual({ a: 1 });
	});
});
