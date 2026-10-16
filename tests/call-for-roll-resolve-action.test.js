import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/apps/roll/roll-request.js", () => ({
	openSharedRoll: vi.fn(async () => undefined),
}));

const { CallForRollApp } = await import(
	"../modules/apps/roll/call-for-roll.js"
);
const { openSharedRoll } = await import("../modules/apps/roll/roll-request.js");

const ACTION_UUID = "Item.cleave";
const OTHER_UUID = "Item.parry";

const deferred = () => {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

const action = (uuid, name) => ({ uuid, name, img: `${name}.webp` });

const hero = {
	id: "hero-1",
	type: "hero",
	name: "Rill",
	img: "rill.webp",
	items: [],
};

/**
 * An app with Rill picked as the roller. `#selectedId` is private and the
 * roster's change listener is the only way to set it, so drive that.
 */
const openApp = (options = {}) => {
	const app = new CallForRollApp();
	app.render = vi.fn();
	app.close = vi.fn();
	app.configure(options);

	let onChange;
	app.element = {
		querySelectorAll: () => [
			{
				dataset: { roster: "target" },
				addEventListener: (_type, listener) => {
					onChange = listener;
				},
			},
		],
	};
	app._onRender({}, {});
	onChange({
		target: {
			closest: () => ({ closest: () => ({ dataset: { rowId: hero.id } }) }),
		},
	});
	return app;
};

const clear = (app) =>
	CallForRollApp.DEFAULT_OPTIONS.actions.clearAction.call(app);
const callRoll = (app) =>
	CallForRollApp.DEFAULT_OPTIONS.actions.callRoll.call(app);

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.Actor = foundry.documents.Actor;
	foundry.applications.api.ApplicationV2.prototype._onRender = () => {};
	foundry.utils.fromUuid.mockReset();
	foundry.utils.fromUuid.mockImplementation(async () => null);
	game.actors = { get: vi.fn(() => hero), filter: vi.fn(() => [hero]) };
	game.users.filter = () => [];
});

describe("CallForRollApp action lookup", () => {
	it("titles the roll after the chosen Action once its lookup lands", async () => {
		const lookup = deferred();
		foundry.utils.fromUuid.mockImplementationOnce(() => lookup.promise);
		const app = openApp({ actionUuid: ACTION_UUID });

		const context = app._prepareContext();
		lookup.resolve(action(ACTION_UUID, "Cleave"));

		expect((await context).actionName).toBe("Cleave");
		await callRoll(app);
		expect(openSharedRoll).toHaveBeenCalledWith(
			expect.objectContaining({ actionUuid: ACTION_UUID, title: "Cleave" }),
		);
	});

	it("does not put a cleared Action back when a slow lookup finishes after Clear", async () => {
		const lookup = deferred();
		foundry.utils.fromUuid.mockImplementationOnce(() => lookup.promise);
		const app = openApp({ actionUuid: ACTION_UUID });

		const context = app._prepareContext();
		clear(app);
		lookup.resolve(action(ACTION_UUID, "Cleave"));

		expect((await context).actionName).toBe("");
		await callRoll(app);
		expect(openSharedRoll).toHaveBeenCalledWith(
			expect.objectContaining({ actionUuid: null, title: "" }),
		);
	});

	it("ignores a lookup for an Action that was replaced while it was in flight", async () => {
		const slow = deferred();
		foundry.utils.fromUuid
			.mockImplementationOnce(() => slow.promise)
			.mockImplementationOnce(async () => action(OTHER_UUID, "Parry"));
		const app = openApp({ actionUuid: ACTION_UUID });

		const stale = app._prepareContext();
		app.configure({ actionUuid: OTHER_UUID });
		const current = await app._prepareContext();
		slow.resolve(action(ACTION_UUID, "Cleave"));

		expect(current.actionName).toBe("Parry");
		expect((await stale).actionName).toBe("Parry");
		await callRoll(app);
		expect(openSharedRoll).toHaveBeenCalledWith(
			expect.objectContaining({ actionUuid: OTHER_UUID, title: "Parry" }),
		);
	});
});
