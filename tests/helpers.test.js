import { describe, expect, it } from "vitest";
import { fakeFlagActor, withFlags } from "./__helpers__/flags.js";
import { stubSettings } from "./__helpers__/settings.js";
import { asUser, setGM, setPlayer, setUser } from "./__helpers__/users.js";

// The shared test helpers carry a little logic of their own; these pin it so
// a change to a helper does not quietly change what forty files assert.

describe("users", () => {
	it("setUser makes a player unless told otherwise, and replaces the user whole", () => {
		game.user.extra = "left behind";

		const user = setUser("p1");

		expect(game.user).toBe(user);
		expect(game.user).toEqual({ id: "p1", isGM: false });
	});

	it("setUser keeps extra properties", () => {
		setUser("gm", { isGM: true, name: "Narrator" });

		expect(game.user).toEqual({ id: "gm", isGM: true, name: "Narrator" });
	});

	it("setGM and setPlayer default to the ids the suite uses", () => {
		setGM();
		expect(game.user).toEqual({ id: "gm", isGM: true });

		setPlayer();
		expect(game.user).toEqual({ id: "player", isGM: false });

		setGM("gm-2");
		expect(game.user).toEqual({ id: "gm-2", isGM: true });

		setPlayer("p", { name: "Ada" });
		expect(game.user).toEqual({ id: "p", isGM: false, name: "Ada" });
	});

	it("setGM wins over an isGM passed in the extras", () => {
		setGM("g", { isGM: false });

		expect(game.user.isGM).toBe(true);
	});

	it("asUser runs fn as that user and returns its result; only 'gm' is a Narrator", () => {
		expect(asUser("gm", () => game.user.isGM)).toBe(true);
		expect(asUser("gm-2", () => game.user.isGM)).toBe(false);
		expect(asUser("player", () => game.user.id)).toBe("player");
	});
});

describe("stubSettings", () => {
	it("answers from a map and gives the fallback for a key it lacks", () => {
		stubSettings({ a: 1, b: false }, { fallback: "none" });

		expect(game.settings.get("litmv2", "a")).toBe(1);
		expect(game.settings.get("litmv2", "b")).toBe(false);
		expect(game.settings.get("litmv2", "c")).toBe("none");
	});

	it("answers undefined with no fallback", () => {
		stubSettings({});

		expect(game.settings.get("litmv2", "a")).toBeUndefined();
	});

	it("takes a function, read at call time, and keeps null as an answer", () => {
		let selected = "x";
		stubSettings((key) => (key === "k" ? selected : undefined), {
			fallback: "none",
		});

		expect(game.settings.get("litmv2", "k")).toBe("x");
		selected = null;
		expect(game.settings.get("litmv2", "k")).toBeNull();
		expect(game.settings.get("litmv2", "other")).toBe("none");
	});

	it("replaces what an earlier call stubbed", () => {
		stubSettings({ a: 1 });
		stubSettings({ a: 2 });

		expect(game.settings.get("litmv2", "a")).toBe(2);
	});
});

describe("withFlags", () => {
	it("reads, writes and removes flags by scope and key", async () => {
		const doc = withFlags({ id: "d" }, { litmv2: { a: 1 } });

		expect(doc.getFlag("litmv2", "a")).toBe(1);
		expect(doc.getFlag("litmv2", "missing")).toBeUndefined();
		expect(doc.getFlag("other", "a")).toBeUndefined();

		await doc.setFlag("litmv2", "b", 2);
		await doc.setFlag("fresh", "c", 3);
		expect(doc.flags).toEqual({ litmv2: { a: 1, b: 2 }, fresh: { c: 3 } });

		await doc.unsetFlag("litmv2", "a");
		expect(doc.getFlag("litmv2", "a")).toBeUndefined();
		await doc.unsetFlag("nowhere", "x");
	});

	it("resolves setFlag and unsetFlag to the document, as Foundry does", async () => {
		const doc = withFlags({});

		expect(await doc.setFlag("litmv2", "a", 1)).toBe(doc);
		expect(await doc.unsetFlag("litmv2", "a")).toBe(doc);
	});

	it("clones what goes in, so a later mutation is not a save", async () => {
		const seed = { litmv2: { list: [1] } };
		const doc = withFlags({}, seed);
		const value = [1, 2];

		await doc.setFlag("litmv2", "other", value);
		value.push(3);
		seed.litmv2.list.push(9);

		expect(doc.getFlag("litmv2", "other")).toEqual([1, 2]);
		expect(doc.getFlag("litmv2", "list")).toEqual([1]);
	});

	it("records its calls", async () => {
		const doc = withFlags({});

		await doc.setFlag("litmv2", "a", 1);

		expect(doc.setFlag).toHaveBeenCalledWith("litmv2", "a", 1);
	});

	it("does not share flags between documents", () => {
		const a = withFlags({});
		const b = withFlags({});
		a.flags.litmv2 = { x: 1 };

		expect(b.flags).toEqual({});
	});
});

describe("fakeFlagActor", () => {
	it("is a fakeActor that keeps flags", async () => {
		const actor = fakeFlagActor({
			id: "h1",
			type: "journey",
			flags: { litmv2: { limits: [] } },
		});

		expect(actor).toMatchObject({ id: "h1", type: "journey" });
		expect(actor.getFlag("litmv2", "limits")).toEqual([]);
		await actor.setFlag("litmv2", "limits", [1]);
		expect(actor.flags.litmv2.limits).toEqual([1]);
		expect([...actor.allApplicableEffects()]).toEqual([]);
	});

	it("starts with no flags", () => {
		expect(fakeFlagActor().flags).toEqual({});
	});
});
