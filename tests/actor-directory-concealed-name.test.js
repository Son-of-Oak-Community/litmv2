// ui-hooks.js: "Concealed Challenges show their alias in the Actors sidebar,
// as they do on the sheet title, the story-tag sidebar and the token
// nameplate. Foundry renders the real name there."
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/apps/roll/roll-dialog.js", () => ({
	LitmRollDialog: class {},
}));
vi.mock("../modules/apps/story-tags/scene-tag-dialog.js", () => ({
	SceneTagDialog: class {},
}));

import { registerUiHooks } from "../modules/system/hooks/ui-hooks.js";
import { fakeElement } from "./__helpers__/dom.js";

let renderDirectory;
let onUpdateActor;
let actors;

/** One row of the Actors directory, as Foundry renders it. */
function row(id, name) {
	const link = { textContent: name };
	const thumb = {
		alt: name,
		setAttribute: (key, value) => (thumb[key] = value),
	};
	return {
		link,
		thumb,
		li: fakeElement({
			dataset: { entryId: id },
			one: { ".entry-name": link, "img.thumbnail": thumb },
		}),
	};
}

const directory = (...rows) =>
	fakeElement({ all: { "[data-entry-id]": rows.map((r) => r.li) } });

beforeEach(() => {
	actors = {
		baron: { system: { maskedName: "Something Stirs" } },
		hero: { system: { maskedName: null } },
		crate: { system: {} },
	};
	game.actors = { get: (id) => actors[id] };
	game.user.isGM = false;
	globalThis.ui.actors = { render: vi.fn() };
	Hooks.on.mockClear();
	registerUiHooks();
	const on = (name) =>
		Hooks.on.mock.calls.filter(([hook]) => hook === name).map(([, fn]) => fn);
	[renderDirectory] = on("renderActorDirectory");
	// Several features listen to updateActor; run them all, as Foundry would.
	onUpdateActor = (...args) => {
		for (const fn of on("updateActor")) fn(...args);
	};
});

afterEach(() => {
	delete globalThis.ui.actors;
});

describe("the Actors directory", () => {
	it("shows a player a concealed Challenge's alias, on the name and the thumbnail", () => {
		const baron = row("baron", "Baron Vasil");

		renderDirectory(null, directory(baron));

		expect(baron.link.textContent).toBe("Something Stirs");
		expect(baron.thumb.alt).toBe("Something Stirs");
	});

	it("leaves every other entry's name alone", () => {
		const hero = row("hero", "Gerrin");
		const crate = row("crate", "Crate");
		const gone = row("deleted", "Ghost");

		renderDirectory(null, directory(hero, crate, gone));

		expect(hero.link.textContent).toBe("Gerrin");
		expect(crate.link.textContent).toBe("Crate");
		expect(gone.link.textContent).toBe("Ghost");
	});

	it("shows the Narrator the real name", () => {
		game.user.isGM = true;
		const baron = row("baron", "Baron Vasil");

		renderDirectory(null, directory(baron));

		expect(baron.link.textContent).toBe("Baron Vasil");
	});
});

describe("a Challenge's concealment changing", () => {
	const challenge = { id: "baron", type: "challenge" };

	it.each([
		["concealName", { system: { concealName: true } }],
		["alias", { system: { alias: "The Stranger" } }],
	])("re-renders a player's directory when %s changes", (_field, changes) => {
		onUpdateActor(challenge, changes);
		expect(ui.actors.render).toHaveBeenCalledTimes(1);
	});

	it("does not re-render for any other change, or any other actor type", () => {
		onUpdateActor(challenge, { system: { might: 2 } });
		onUpdateActor(challenge, { name: "Baron" });
		onUpdateActor({ id: "h", type: "hero" }, { system: { alias: "x" } });
		expect(ui.actors.render).not.toHaveBeenCalled();
	});

	it("does not re-render for the Narrator, who sees real names", () => {
		game.user.isGM = true;
		onUpdateActor(challenge, { system: { concealName: true } });
		expect(ui.actors.render).not.toHaveBeenCalled();
	});
});
