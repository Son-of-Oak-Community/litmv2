import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	formatMitigationEffects,
	mitigationBannerText,
	mitigationPreselect,
} from "../modules/apps/mitigation.js";

const ctx = {
	effects: [
		{ kind: "status", name: "wounded", tier: 2 },
		{ kind: "story", name: "tangled" },
	],
	sourceLabel: "Bandit Captain",
	targetActorId: "h1",
};

// mitigationBannerText runs the inflicted effects + source through
// game.i18n.format. Stub it locally with the real format strings so this test
// verifies interpolation without depending on the shared key-echoing shim.
let originalFormat;
beforeEach(() => {
	originalFormat = game.i18n.format;
	const templates = {
		"LITM.Actions.reacting_to": "Reacting to {effects}",
		"LITM.Actions.reacting_from": "(from {source})",
	};
	game.i18n.format = (key, data = {}) =>
		Object.entries(data).reduce(
			(s, [k, v]) => s.replace(`{${k}}`, v),
			templates[key] ?? key,
		);
});
afterEach(() => {
	game.i18n.format = originalFormat;
});

describe("formatMitigationEffects", () => {
	it("joins statuses with tier and tags without, separated by ·", () => {
		expect(formatMitigationEffects(ctx.effects)).toBe("wounded-2 · tangled");
	});
	it("handles tier-less statuses and empty input", () => {
		expect(formatMitigationEffects([{ kind: "status", name: "dazed" }])).toBe(
			"dazed",
		);
		expect(formatMitigationEffects([])).toBe("");
	});
});

describe("mitigationBannerText", () => {
	it("interpolates effects and source into the localized format strings", () => {
		const text = mitigationBannerText(ctx);
		expect(text).toContain("wounded-2 · tangled");
		expect(text).toContain("Bandit Captain");
	});
	it("returns '' for a missing context", () => {
		expect(mitigationBannerText(null)).toBe("");
	});
});

describe("mitigationPreselect", () => {
	it("preselects statuses + tags when the consequence landed on the rolling actor", () => {
		expect(mitigationPreselect(ctx, "h1")).toEqual({
			statuses: [{ name: "wounded", tier: 2 }],
			tags: ["tangled"],
			tagOwnerId: "h1",
		});
	});
	it("drops status preselection when reacting on behalf of another actor, keeps tags", () => {
		expect(mitigationPreselect(ctx, "hero-rolling")).toEqual({
			statuses: [],
			tags: ["tangled"],
			tagOwnerId: "h1",
		});
	});
	it("returns null for a missing context", () => {
		expect(mitigationPreselect(null, "h1")).toBe(null);
	});
});
