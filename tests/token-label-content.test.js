// The hover tooltip and the persistent on-canvas labels must never show
// different chips for the same actor and the same viewer. They share
// `tokenTooltipHTML`, so these pin the content contract that both paths get:
// who counts as an owner, and the statuses-only filter.
//
// Also pinned: hover produces nothing while persistent labels are on, and
// unhover still cleans up. That guard regressed once during development — a
// stranded hover tooltip sat on top of the persistent label and survived
// unhover — so it gets a test even though it is DOM-adjacent.
//
// Where labels get attached and when they are rebuilt is not unit-testable
// against this repo's node-environment Foundry shim, and is covered by runtime
// verification instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildTooltipHTML,
	onHoverToken,
	tokenTooltipHTML,
} from "../modules/hud/token-tooltip.js";

/** `LitmSettings.tokenTooltipStatusesOnly` reads this key. */
function settingsOnly(statusesOnly) {
	game.settings.get = vi.fn((_ns, key) =>
		key === "token_tooltip_statuses_only" ? statusesOnly : false,
	);
}

/** Both tooltip keys, so the persistent-mode guard can be exercised. */
function settings({ statusesOnly = false, persistent = false } = {}) {
	game.settings.get = vi.fn((_ns, key) => {
		if (key === "token_tooltip_statuses_only") return statusesOnly;
		if (key === "persistent_token_labels") return persistent;
		return false;
	});
}

function fakeToken({ isOwner = false, tags = ["rope"], statuses = [] } = {}) {
	return {
		id: "tok-1",
		actor: {
			isOwner,
			system: {
				storyTags: tags.map((name) => ({
					active: true,
					name,
					system: { isHidden: false },
				})),
				statusEffects: statuses.map(([name, currentTier]) => ({
					active: true,
					name,
					system: { isHidden: false, currentTier },
				})),
			},
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	game.user.isGM = false;
	game.user.id = "player-1";
	settingsOnly(false);
});

describe("tokenTooltipHTML", () => {
	it("returns nothing for a token with no actor", () => {
		expect(tokenTooltipHTML({ id: "tok-1", actor: null })).toBe("");
	});

	it("renders an owned actor's tags and statuses for a plain player", () => {
		const html = tokenTooltipHTML(
			fakeToken({ isOwner: true, tags: ["rope"], statuses: [["wounded", 2]] }),
		);
		expect(html).toContain("rope");
		expect(html).toContain("wounded 2");
	});

	it("gives the same markup the hover tooltip builds for the same viewer", () => {
		const token = fakeToken({
			isOwner: true,
			tags: ["rope"],
			statuses: [["wounded", 2]],
		});
		expect(tokenTooltipHTML(token)).toBe(buildTooltipHTML(token.actor, true));
	});

	it("treats a GM as an owner of a token they do not own", () => {
		game.user.isGM = true;
		const token = fakeToken({ isOwner: false, tags: ["secret plan"] });
		expect(tokenTooltipHTML(token)).toBe(buildTooltipHTML(token.actor, true));
	});

	it("does not grant owner sight to a non-GM non-owner", () => {
		const token = fakeToken({ isOwner: false, tags: ["rope"] });
		expect(tokenTooltipHTML(token)).toBe(buildTooltipHTML(token.actor, false));
	});
});

describe("the statuses-only filter governs both tooltip paths", () => {
	it("drops story tags but keeps statuses when it is on", () => {
		settingsOnly(true);
		const html = tokenTooltipHTML(
			fakeToken({ isOwner: true, tags: ["rope"], statuses: [["wounded", 2]] }),
		);
		expect(html).not.toContain("rope");
		expect(html).toContain("wounded 2");
	});

	it("yields no label at all for an actor whose only chips are story tags", () => {
		settingsOnly(true);
		const html = tokenTooltipHTML(
			fakeToken({ isOwner: true, tags: ["rope"], statuses: [] }),
		);
		expect(html).toBe("");
	});
});

describe("hover is suppressed while persistent labels are on", () => {
	// A stand-in for just the corners of the DOM the hover path touches.
	let hud;
	let removed;

	beforeEach(() => {
		removed = 0;
		hud = { appended: [] };
		hud.append = (el) => hud.appended.push(el);
		globalThis.CSS = { escape: (s) => s };
		globalThis.document = {
			getElementById: (id) => (id === "hud" ? hud : null),
			querySelector: () => ({
				remove: () => {
					removed += 1;
				},
			}),
			querySelectorAll: () => [],
			createElement: () => ({
				classList: { add: () => {} },
				dataset: {},
				style: {},
				set innerHTML(_v) {},
			}),
		};
		globalThis.canvas = { dimensions: { uiScale: 1 } };
	});

	afterEach(() => {
		globalThis.document = undefined;
		globalThis.canvas = undefined;
		globalThis.CSS = undefined;
	});

	function hoverToken() {
		return {
			id: "tok-1",
			bounds: { x: 100, y: 100, height: 100 },
			actor: {
				isOwner: true,
				system: {
					storyTags: [
						{ active: true, name: "rope", system: { isHidden: false } },
					],
					statusEffects: [],
				},
			},
		};
	}

	it("builds a hover tooltip when persistent labels are off", () => {
		settings({ persistent: false });
		onHoverToken(hoverToken(), true);
		expect(hud.appended).toHaveLength(1);
	});

	it("builds nothing on hover when persistent labels are on", () => {
		settings({ persistent: true });
		onHoverToken(hoverToken(), true);
		expect(hud.appended).toHaveLength(0);
	});

	it("still removes the hover tooltip on unhover in persistent mode", () => {
		// The setting can be switched on while a tooltip is up; skipping the
		// removal strands it on top of that token's persistent label.
		settings({ persistent: true });
		onHoverToken(hoverToken(), false);
		expect(removed).toBe(1);
	});
});
