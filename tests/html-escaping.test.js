// Names players can set (status names, tag names, actor names) reach hand-built
// HTML that is broadcast to every client. These tests pin the escaping so a
// future edit to either sink can't silently reopen the hole.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { dialogContent } from "../modules/system/renderers/renderer-utils.js";
import { buildTooltipHTML } from "../modules/hud/token-tooltip.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

/** The classic stored-XSS payload a player can type into a name field. */
const PAYLOAD = `<img src=x onerror="alert(1)">`;

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
	game.messages.get = vi.fn(() => null);
});

describe("token tooltip escapes player-controlled names", () => {
	function tooltipActor({ tagName = "rope", statusName = "wounded" } = {}) {
		return {
			system: {
				storyTags: [
					{ active: true, name: tagName, system: { isHidden: false } },
				],
				statusEffects: [
					{
						active: true,
						name: statusName,
						system: { isHidden: false, currentTier: 2 },
					},
				],
			},
		};
	}

	it("escapes a story tag name", () => {
		const html = buildTooltipHTML(tooltipActor({ tagName: PAYLOAD }), true);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	it("escapes a status name", () => {
		const html = buildTooltipHTML(tooltipActor({ statusName: PAYLOAD }), true);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	it("still renders ordinary names and the status tier", () => {
		const html = buildTooltipHTML(tooltipActor(), true);
		expect(html).toContain("rope");
		expect(html).toContain("wounded 2");
	});

	it("hides GM-hidden entries from non-owners", () => {
		const actor = {
			system: {
				storyTags: [
					{ active: true, name: "secret", system: { isHidden: true } },
				],
				statusEffects: [],
			},
		};
		expect(buildTooltipHTML(actor, false)).toBe("");
		expect(buildTooltipHTML(actor, true)).toContain("secret");
	});
});

describe("Spend Power reduce-status chat body escapes names", () => {
	function fakeStatus({ id, name, tier }) {
		const effect = fakeEffect({ id, name, type: "status_tag" });
		effect.system = {
			currentTier: tier,
			calculateReduction: vi.fn((by) => {
				const tiers = Array(6).fill(false);
				if (tier - by > 0) tiers[tier - by - 1] = true;
				return tiers;
			}),
			reduceTier: vi.fn(async () => {}),
		};
		return effect;
	}

	function statusPickerIntent(reductions) {
		return {
			options: [
				{
					kind: "statusPicker",
					optionId: "reduce_status",
					label: "LITM.Effects.reduce.action",
					cost: 1,
					reductions,
				},
			],
			messageId: null,
			alreadySpent: 0,
			targetActorId: null,
		};
	}

	async function reduce({ statusName, ownerName }) {
		const status = fakeStatus({ id: "s1", name: statusName, tier: 4 });
		const foe = fakeActor({
			id: "c1",
			name: ownerName,
			effects: [status],
			isOwner: true,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			statusPickerIntent([
				{ effectId: "s1", name: statusName, actorId: "c1", tiers: 1 },
			]),
		);
		return results[0].bodyLines.join("");
	}

	it("escapes a malicious status name", async () => {
		const body = await reduce({ statusName: PAYLOAD, ownerName: "Serpent" });
		expect(body).not.toContain("<img");
		expect(body).toContain("&lt;img");
	});

	it("escapes a malicious owning-actor name", async () => {
		const body = await reduce({ statusName: "enraged", ownerName: PAYLOAD });
		expect(body).not.toContain("<img");
		expect(body).toContain("&lt;img");
	});

	it("keeps the ordinary owner-prefixed label and tier arrow intact", async () => {
		const body = await reduce({ statusName: "enraged", ownerName: "Serpent" });
		expect(body).toContain("Serpent: enraged-4");
		expect(body).toContain("&rarr;");
		expect(body).toContain("<strong>enraged-3</strong>");
	});
});

describe("dialogContent escapes interpolated values", () => {
	// The test i18n shim treats the key itself as the template, so a key with a
	// {placeholder} exercises the real substitution path.
	it("escapes a value before it reaches the confirm body", () => {
		const html = dialogContent("Remove {name}?", { name: PAYLOAD });
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	it("escapes every value, not just the first", () => {
		const html = dialogContent("Swap {current} for {dropped}", {
			current: PAYLOAD,
			dropped: PAYLOAD,
		});
		expect(html).not.toContain("<img");
		expect(html.match(/&lt;img/g)).toHaveLength(2);
	});

	it("wraps the localized text in a paragraph", () => {
		expect(dialogContent("Are you sure?")).toBe("<p>Are you sure?</p>");
	});

	it("leaves ordinary names readable", () => {
		expect(dialogContent("Remove {name}?", { name: "Gerrin" })).toBe(
			"<p>Remove Gerrin?</p>",
		);
	});
});
