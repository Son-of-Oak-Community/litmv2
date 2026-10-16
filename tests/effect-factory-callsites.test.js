import { beforeEach, describe, expect, it, vi } from "vitest";
import { maxStatusTier } from "../modules/active-effects/status-tag-data.js";
import { HeroCreationData } from "../modules/apps/welcome/hero-creation-data.js";
import { ContentSources } from "../modules/system/content-sources.js";

// Call sites that build story_tag / status_tag creation data must go through
// the effect factories. These pin the shape the call sites produced when they
// hand-built it, so routing them through the factories stays equivalent. The
// one addition is `limitId: null`, which is the data models' own initial.

describe("HeroCreationData backpack effects", () => {
	let created;

	beforeEach(() => {
		created = null;
		game.user.can = vi.fn(() => true);
		foundry.documents.Actor.create = vi.fn(async (data) => {
			created = data;
			return { id: "a1" };
		});
	});

	const appState = {
		actorName: "Gerrin",
		mode: "custom",
		trope: { backpackChoice: null },
		custom: {
			themes: [],
			backpackTags: ["rope", "", "lantern"],
			activeBackpackIndex: 1,
		},
	};

	it("builds one story_tag effect per chosen tag, active by index", async () => {
		await new HeroCreationData().createHero(appState);

		const backpack = created.items.find((i) => i.type === "backpack");
		expect(backpack.effects).toEqual([
			{
				name: "rope",
				type: "story_tag",
				disabled: true,
				system: {
					isScratched: false,
					isSingleUse: false,
					isHidden: false,
					limitId: null,
				},
			},
			{
				name: "lantern",
				type: "story_tag",
				disabled: false,
				system: {
					isScratched: false,
					isSingleUse: false,
					isHidden: false,
					limitId: null,
				},
			},
		]);
	});
});

describe("ContentSources default status pack", () => {
	it("populates status_tag creation data with an empty track and an icon", async () => {
		const createDocuments = vi.fn(async () => []);
		foundry.documents.ActiveEffect = { createDocuments };
		game.packs = {
			get: vi.fn(() => ({
				collection: "world.litmv2-statuses",
				getDocuments: vi.fn(async () => []),
			})),
		};

		await ContentSources.resetStatuses();

		const [data, options] = createDocuments.mock.calls[0];
		expect(options).toEqual({ pack: "world.litmv2-statuses" });
		expect(data.length).toBeGreaterThan(0);
		for (const entry of data) {
			expect(entry).toEqual({
				name: expect.any(String),
				type: "status_tag",
				img: expect.stringMatching(/\.svg$/),
				disabled: false,
				system: {
					isHidden: false,
					tiers: Array(maxStatusTier()).fill(false),
					limitId: null,
				},
			});
		}
		expect(data.map((e) => e.name)).toContain("wounded");
	});
});
