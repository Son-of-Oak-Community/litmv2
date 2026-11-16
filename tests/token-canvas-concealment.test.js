// What the canvas may show a player about a token they are not meant to read:
// the nameplate of a concealed Challenge, and the tag chips of a token the
// Narrator has hidden. A hidden token whose actor has no hidden story-tag
// column is protected by `Token#visible` alone, in both the highlight-key
// tooltips and the persistent labels.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	onDisplayTooltip,
	refreshPersistentLabels,
} from "../modules/hud/token-tooltip.js";
import { registerTokenHooks } from "../modules/system/hooks/token-hooks.js";
import { stubSettings } from "./__helpers__/settings.js";

let hooks;
let hud;
let removedLabels;

/** The handlers `registerTokenHooks` put on `name`. */
const handlers = (name) =>
	Hooks.on.mock.calls.filter(([hook]) => hook === name).map(([, fn]) => fn);

function token(id, { visible = true, tag = `${id}'s tag` } = {}) {
	return {
		id,
		visible,
		bounds: { x: 0, y: 0, height: 100 },
		actor: {
			id: `actor-${id}`,
			isOwner: false,
			system: {
				storyTags: [{ active: true, name: tag, system: { isHidden: false } }],
				statusEffects: [],
			},
		},
	};
}

const labels = () => hud.appended.map((el) => el.html);

beforeEach(() => {
	game.user.isGM = false;
	game.users.filter = () => [];
	stubSettings(
		{ token_tooltip_statuses_only: false, persistent_token_labels: false },
		{ fallback: false },
	);
	Hooks.on.mockClear();
	registerTokenHooks();
	hooks = { highlight: handlers("highlightObjects")[0] };

	removedLabels = 0;
	hud = { appended: [] };
	hud.append = (el) => hud.appended.push(el);
	globalThis.CSS = { escape: (s) => s };
	globalThis.document = {
		getElementById: (id) => (id === "hud" ? hud : null),
		querySelector: () => null,
		// The persistent labels currently on the HUD, for `clearPersistentLabels`.
		querySelectorAll: () =>
			hud.appended.map((el) => ({
				remove: () => {
					removedLabels += 1;
				},
				el,
			})),
		createElement: () => {
			const el = {
				classList: { add: () => {} },
				dataset: {},
				style: {},
				html: "",
			};
			Object.defineProperty(el, "innerHTML", {
				set: (v) => {
					el.html = v;
				},
			});
			return el;
		},
	};
	globalThis.canvas = {
		dimensions: { uiScale: 1 },
		tokens: { placeables: [] },
	};
});

afterEach(() => {
	// Release the module's "highlight key held" latch for the next test.
	onDisplayTooltip(token("reset"), false);
	globalThis.document = undefined;
	globalThis.canvas = undefined;
	globalThis.CSS = undefined;
	delete game.users.filter;
});

describe("the nameplate of a concealed Challenge", () => {
	const mask = (tok) => {
		for (const fn of handlers("refreshToken")) fn(tok);
		return tok.nameplate?.text;
	};

	beforeEach(() => {
		// The persistent-label handler on the same hook stays out of the way.
		stubSettings({ persistent_token_labels: false }, { fallback: false });
	});

	it("is replaced by the alias for a viewer the name is masked from", () => {
		const tok = {
			id: "t",
			visible: true,
			actor: { system: { maskedName: "Something Stirs" } },
			nameplate: { text: "Baron Vasil" },
		};
		expect(mask(tok)).toBe("Something Stirs");
	});

	it("keeps the real name when nothing is masked (the Narrator, an owner)", () => {
		const tok = {
			id: "t",
			visible: true,
			actor: { system: { maskedName: null } },
			nameplate: { text: "Baron Vasil" },
		};
		expect(mask(tok)).toBe("Baron Vasil");
	});

	it("tolerates a token with no nameplate or no actor", () => {
		expect(() =>
			mask({ id: "t", actor: { system: { maskedName: "Alias" } } }),
		).not.toThrow();
		expect(mask({ id: "t", actor: null, nameplate: { text: "Crate" } })).toBe(
			"Crate",
		);
	});
});

describe("holding the highlight key", () => {
	it("shows a tooltip for each visible token and none for a hidden one", () => {
		canvas.tokens.placeables = [
			token("seen"),
			token("hidden", { visible: false, tag: "ambush" }),
			token("also-seen"),
		];

		hooks.highlight(true);

		expect(labels()).toHaveLength(2);
		expect(labels().join()).toContain("seen&#39;s tag");
		expect(labels().join()).not.toContain("ambush");
	});

	it("still releases the highlight for a token that went hidden while it was held", () => {
		const tok = token("seen");
		canvas.tokens.placeables = [tok];
		hooks.highlight(true);
		tok.visible = false;
		const removeAll = vi.fn();
		document.querySelectorAll = () => [{ remove: removeAll }];

		hooks.highlight(false);

		expect(removeAll).toHaveBeenCalled();
	});
});

describe("persistent token labels", () => {
	const persistent = (on) =>
		stubSettings(
			{ token_tooltip_statuses_only: false, persistent_token_labels: on },
			{ fallback: false },
		);

	it("labels each visible token and skips a hidden one", () => {
		persistent(true);
		canvas.tokens.placeables = [
			token("seen"),
			token("hidden", { visible: false, tag: "ambush" }),
		];

		refreshPersistentLabels();

		expect(labels()).toHaveLength(1);
		expect(labels()[0]).not.toContain("ambush");
		expect(hud.appended[0].dataset.tokenId).toBe("seen");
	});

	it("draws nothing, and clears what was there, when the setting is off", () => {
		persistent(true);
		canvas.tokens.placeables = [token("seen")];
		refreshPersistentLabels();
		expect(labels()).toHaveLength(1);

		persistent(false);
		refreshPersistentLabels();

		expect(removedLabels).toBeGreaterThan(0);
		expect(labels()).toHaveLength(1); // nothing new drawn
	});

	it("skips a token with nothing to show", () => {
		persistent(true);
		const bare = token("bare");
		bare.actor.system.storyTags = [];
		canvas.tokens.placeables = [bare];

		refreshPersistentLabels();

		expect(labels()).toHaveLength(0);
	});
});
