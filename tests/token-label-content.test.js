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
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import {
	onDisplayTooltip,
	onHoverToken,
	tokenTooltipHTML,
} from "../modules/hud/token-tooltip.js";
import { stubSettings } from "./__helpers__/settings.js";

/** `LitmSettings.tokenTooltipStatusesOnly` reads this key. */
function settingsOnly(statusesOnly) {
	stubSettings(
		{ token_tooltip_statuses_only: statusesOnly },
		{ fallback: false },
	);
}

/** Both tooltip keys, so the persistent-mode guard can be exercised. */
function settings({ statusesOnly = false, persistent = false } = {}) {
	stubSettings(
		{
			token_tooltip_statuses_only: statusesOnly,
			persistent_token_labels: persistent,
		},
		{ fallback: false },
	);
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
});

// CLAUDE.md: "Hiding a column also hides the actor on the canvas ... the token
// hover tooltip and persistent labels show players nothing for it." A hidden
// column is the only thing that separates a GM, an owner and a bystander here:
// with nothing concealed all three get the same chips.
describe("a token whose story-tag column is hidden", () => {
	const lurker = { id: "lurker", documentName: "Actor" };

	/** Hide (or show) the lurker's column. */
	function column({ hidden }) {
		stubSettings(
			{
				token_tooltip_statuses_only: false,
				storytags: {
					actors: ["Actor.lurker"],
					hiddenActors: hidden ? ["Actor.lurker"] : [],
					limits: [],
				},
			},
			{ fallback: false },
		);
		StoryTagsStore.invalidateCache();
	}

	function lurkerToken({ isOwner = false } = {}) {
		const token = fakeToken({
			isOwner,
			tags: ["poisoned blade"],
			statuses: [["lurking", 3]],
		});
		token.actor.id = lurker.id;
		return token;
	}

	beforeEach(() => {
		game.users.filter = () => [];
		foundry.utils.parseUuid = (uuid) => ({
			collection: "Actor",
			type: uuid?.startsWith("Actor.") ? "Actor" : null,
		});
		foundry.utils.fromUuidSync.mockImplementation((uuid) =>
			uuid === "Actor.lurker" ? lurker : null,
		);
		column({ hidden: true });
	});

	afterEach(() => {
		foundry.utils.fromUuidSync.mockReset();
		delete foundry.utils.parseUuid;
		delete game.users.filter;
		StoryTagsStore.invalidateCache();
	});

	it("shows a player who does not own it nothing at all", () => {
		expect(tokenTooltipHTML(lurkerToken())).toBe("");
	});

	it("still shows the Narrator its chips", () => {
		game.user.isGM = true;
		const html = tokenTooltipHTML(lurkerToken());
		expect(html).toContain("poisoned blade");
		expect(html).toContain("lurking 3");
	});

	it("still shows its owner their own chips", () => {
		const html = tokenTooltipHTML(lurkerToken({ isOwner: true }));
		expect(html).toContain("poisoned blade");
		expect(html).toContain("lurking 3");
	});

	it("shows a bystander the chips again once the column is revealed", () => {
		column({ hidden: false });
		expect(tokenTooltipHTML(lurkerToken())).toContain("poisoned blade");
	});

	it("leaves another actor's token alone", () => {
		const token = lurkerToken();
		token.actor.id = "someone-else";
		expect(tokenTooltipHTML(token)).toContain("poisoned blade");
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

	it("leaves hover alone while the highlight key is held, and resumes after", () => {
		settings({ persistent: false });
		onDisplayTooltip(hoverToken(), true);
		expect(hud.appended).toHaveLength(1);
		onHoverToken(hoverToken(), true);
		expect(hud.appended).toHaveLength(1);
		onDisplayTooltip(hoverToken(), false);
		onHoverToken(hoverToken(), true);
		expect(hud.appended).toHaveLength(2);
	});
});
