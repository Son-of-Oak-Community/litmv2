import { beforeAll, describe, expect, it } from "vitest";
import {
	buildOperations,
	parseCampsiteEntries,
} from "../modules/apps/camping/camping-apply.js";
import {
	addThreatVignette,
	defaultCampingState,
	ensureHeroState,
	setActivity,
	setBackpackKept,
	setQualityTime,
	setReflectAbandon,
	setReflectMilestone,
	setReflectTarget,
	setRestChoice,
	setRestRecoverTag,
	setType,
} from "../modules/apps/camping/camping-state.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Provide the tag-string regex the apply module reaches for at parse time.
beforeAll(() => {
	globalThis.CONFIG ??= {};
	globalThis.CONFIG.litmv2 ??= {};
	globalThis.CONFIG.litmv2.tagStringRe =
		/\[([^[\]!:-]+)(!)?(?:([-:])(\d+)?)?\]/g;
});

function world({
	heroes = [],
	sceneEffects = [],
	fellowshipActor = null,
	threatItems = [],
} = {}) {
	return { heroes, sceneEffects, fellowshipActor, threatItems };
}

// The recap is stage-ordered (periods → quality time → pack up); these
// helpers navigate to a stage's hero entries.
const stage = (recap, key) => recap.stages.find((s) => s.key === key);
const stageLines = (recap, key, heroIndex = 0) =>
	stage(recap, key)?.heroes[heroIndex]?.lines ?? [];

describe("buildOperations — backpack scratch", () => {
	it("deactivates all backpack story tags by default (none in keep list)", () => {
		const fx = fakeEffect({
			name: "numbing salve",
			type: "story_tag",
			disabled: false,
		});
		const backpack = fakeItem({ type: "backpack", effects: [fx] });
		const hero = fakeActor({ items: [backpack] });
		hero.system = { backpackItem: backpack };

		const state = defaultCampingState();
		// no setBackpackKept call → not kept → deactivated
		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);

		expect(operations.disables).toContainEqual({ effect: fx });
		// The recap's Pack Up stage lists only what was kept — nothing here.
		expect(stage(recap, "packUp").heroes[0].kept).toEqual([]);
	});

	it("does not deactivate tags the player explicitly kept", () => {
		const fx = fakeEffect({
			name: "lucky charm",
			type: "story_tag",
			disabled: false,
		});
		const backpack = fakeItem({ type: "backpack", effects: [fx] });
		const hero = fakeActor({ items: [backpack] });
		hero.system = { backpackItem: backpack };

		const state = defaultCampingState();
		setBackpackKept(state, hero.id, fx.id, true);
		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);

		expect(operations.disables).toEqual([]);
		expect(stage(recap, "packUp").heroes[0].kept).toContainEqual({
			name: "lucky charm",
			isSingleUse: false,
		});
	});

	it("does not enqueue already-disabled tags (idempotent)", () => {
		const fx = fakeEffect({
			name: "wet match",
			type: "story_tag",
			disabled: true,
		});
		const backpack = fakeItem({ type: "backpack", effects: [fx] });
		const hero = fakeActor({ items: [backpack] });
		hero.system = { backpackItem: backpack };

		const state = defaultCampingState();
		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);

		expect(operations.disables).toEqual([]);
		expect(operations.enables).toEqual([]);
		expect(stage(recap, "packUp").heroes[0].kept).toEqual([]);
	});

	it("ticking a disabled tag enqueues an enable (re-enable at Pack Up)", () => {
		const fx = fakeEffect({
			name: "wet match",
			type: "story_tag",
			disabled: true,
		});
		const backpack = fakeItem({ type: "backpack", effects: [fx] });
		const hero = fakeActor({ items: [backpack] });
		hero.system = { backpackItem: backpack };

		const state = defaultCampingState();
		state.heroStates[hero.id] = {
			backpackKept: [fx.id],
			activities: [],
			qualityTime: {},
		};
		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);

		expect(operations.disables).toEqual([]);
		expect(operations.enables).toContainEqual({ effect: fx });
		expect(stage(recap, "packUp").heroes[0].kept).toContainEqual({
			name: "wet match",
			isSingleUse: false,
		});
	});

	it("partial keep: only unchecked tags get deactivated", () => {
		const keepMe = fakeEffect({
			name: "lucky charm",
			type: "story_tag",
		});
		const dropMe = fakeEffect({
			name: "soggy bread",
			type: "story_tag",
		});
		const backpack = fakeItem({ type: "backpack", effects: [keepMe, dropMe] });
		const hero = fakeActor({ items: [backpack] });
		hero.system = { backpackItem: backpack };

		const state = defaultCampingState();
		setBackpackKept(state, hero.id, keepMe.id, true);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));

		expect(operations.disables).toContainEqual({ effect: dropMe });
		expect(operations.disables).not.toContainEqual({ effect: keepMe });
	});
});

describe("buildOperations — rest", () => {
	it("queues status reduction and removal", () => {
		const s1 = fakeEffect({
			name: "tired",
			type: "status_tag",
			system: { currentTier: 3 },
		});
		const s2 = fakeEffect({
			name: "bruised",
			type: "status_tag",
			system: { currentTier: 2 },
		});
		const hero = fakeActor({ effects: [s1, s2] });

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "rest");
		setRestChoice(state, hero.id, 0, s1.id, { action: "reduce", amount: 2 });
		setRestChoice(state, hero.id, 0, s2.id, { action: "remove" });

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.statusReductions).toContainEqual({
			effect: s1,
			amount: 2,
		});
		expect(operations.statusDeletes).toContainEqual({ effect: s2 });
		// The recap files the rest under Period 1 with chip-ready lines.
		expect(stage(recap, "period1").heroes[0].activity).toBe("rest");
		expect(stageLines(recap, "period1")).toContainEqual({
			kind: "status-reduced",
			name: "tired",
			from: 3,
			to: 1,
		});
		expect(stageLines(recap, "period1")).toContainEqual({
			kind: "status-cleared",
			name: "bruised",
			tier: 2,
		});
	});

	it("clamps reduce amount to the status's currentTier", () => {
		const s1 = fakeEffect({
			name: "tired",
			type: "status_tag",
			system: { currentTier: 3 },
		});
		const hero = fakeActor({ effects: [s1] });
		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "rest");
		// Inject an inflated amount past the setter (simulates stale state).
		ensureHeroState(state, hero.id).activities[0].restChoices[s1.id] = {
			action: "reduce",
			amount: 99,
		};
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.statusReductions).toContainEqual({
			effect: s1,
			amount: 3,
		});
	});

	it("queues power-tag unscratch for selected scratched tags", () => {
		const fx = fakeEffect({
			name: "sharp eye",
			type: "power_tag",
			system: { isScratched: true },
		});
		const theme = fakeItem({ type: "theme", effects: [fx] });
		const hero = fakeActor({ items: [theme] });

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "rest");
		setRestRecoverTag(state, hero.id, 0, fx.id, true);

		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.unscratches).toContainEqual({ effect: fx });
	});
});

describe("buildOperations — camp-mode reflect", () => {
	it("queues improve+1 on the chosen own theme", () => {
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = { improve: { value: 1 } };
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, theme.id);

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.improves).toContainEqual({
			theme,
			owner: hero,
			newValue: 2,
		});
		expect(operations.improvements).toEqual([]);
		expect(stageLines(recap, "period1")).toContainEqual(
			expect.objectContaining({ kind: "reflect", themeName: theme.name }),
		);
	});

	it("queues improve+1 on the fellowship theme via fellowship actor", () => {
		const fwTheme = fakeItem({ type: "theme", effects: [] });
		fwTheme.system = { isFellowship: true, improve: { value: 0 } };
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const hero = fakeActor();
		hero.system = { themes: [], fellowshipActor };

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, fwTheme.id);

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero], fellowshipActor }),
		);
		expect(operations.improves).toContainEqual({
			theme: fwTheme,
			owner: fellowshipActor,
			newValue: 1,
		});
		expect(stageLines(recap, "period1")).toContainEqual(
			expect.objectContaining({
				kind: "reflect",
				themeName: `${fellowshipActor.name}: ${fwTheme.name}`,
			}),
		);
	});

	it("two heroes both reflecting on the fellowship theme accumulate into one op", () => {
		const fwTheme = fakeItem({ type: "theme", effects: [] });
		fwTheme.system = { isFellowship: true, improve: { value: 1 } };
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const heroA = fakeActor();
		heroA.system = { themes: [], fellowshipActor };
		const heroB = fakeActor();
		heroB.system = { themes: [], fellowshipActor };

		const state = defaultCampingState();
		setActivity(state, heroA.id, 0, "reflect");
		setReflectTarget(state, heroA.id, 0, fwTheme.id);
		setActivity(state, heroB.id, 0, "reflect");
		setReflectTarget(state, heroB.id, 0, fwTheme.id);

		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB], fellowshipActor }),
		);
		const fwImproves = operations.improves.filter((i) => i.theme === fwTheme);
		expect(fwImproves).toHaveLength(1);
		expect(fwImproves[0].newValue).toBe(3); // 1 baseline + 1 + 1
	});
});

describe("buildOperations — reflect Quest marks", () => {
	it("queues an abandon mark when reflectAbandonItemId is set", () => {
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = {
			abandon: { value: 0 },
			milestone: { value: 0 },
			improve: { value: 0 },
		};
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, hero.id, 0, "reflect");
		setReflectAbandon(state, hero.id, 0, theme.id);

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.questMarks).toContainEqual({
			theme,
			owner: hero,
			track: "abandon",
			newValue: 1,
			sourceHero: hero,
		});
		expect(stageLines(recap, "period1")).toContainEqual(
			expect.objectContaining({
				kind: "reflect-quest-mark",
				track: "abandon",
				themeName: theme.name,
			}),
		);
	});

	it("queues a milestone mark when reflectMilestoneItemId is set", () => {
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = {
			abandon: { value: 0 },
			milestone: { value: 1 },
			improve: { value: 0 },
		};
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, hero.id, 0, "reflect");
		setReflectMilestone(state, hero.id, 0, theme.id);

		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.questMarks).toContainEqual({
			theme,
			owner: hero,
			track: "milestone",
			newValue: 2,
			sourceHero: hero,
		});
	});

	it("Improve, Abandon, and Milestone can all be set in the same Reflect (different or same themes)", () => {
		const themeA = fakeItem({ type: "theme", effects: [] });
		themeA.system = {
			improve: { value: 0 },
			abandon: { value: 0 },
			milestone: { value: 0 },
		};
		const themeB = fakeItem({ type: "theme", effects: [] });
		themeB.system = {
			improve: { value: 0 },
			abandon: { value: 0 },
			milestone: { value: 0 },
		};
		const hero = fakeActor({ items: [themeA, themeB] });
		hero.system = {
			themes: [
				{ theme: themeA, tags: [] },
				{ theme: themeB, tags: [] },
			],
		};

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, themeA.id);
		setReflectAbandon(state, hero.id, 0, themeB.id);
		setReflectMilestone(state, hero.id, 0, themeA.id);

		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.improvements).toContainEqual({
			theme: themeA,
			owner: hero,
			sourceHero: hero,
		});
		expect(operations.questMarks).toContainEqual({
			theme: themeB,
			owner: hero,
			track: "abandon",
			newValue: 1,
			sourceHero: hero,
		});
		expect(operations.questMarks).toContainEqual({
			theme: themeA,
			owner: hero,
			track: "milestone",
			newValue: 1,
			sourceHero: hero,
		});
	});

	it("two heroes both marking Abandon on the same fellowship theme stack into one update", () => {
		const fwTheme = fakeItem({ type: "theme", effects: [] });
		fwTheme.system = {
			isFellowship: true,
			abandon: { value: 0 },
			milestone: { value: 0 },
			improve: { value: 0 },
		};
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const heroA = fakeActor();
		heroA.system = { themes: [], fellowshipActor };
		const heroB = fakeActor();
		heroB.system = { themes: [], fellowshipActor };

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, heroA.id, 0, "reflect");
		setReflectAbandon(state, heroA.id, 0, fwTheme.id);
		setActivity(state, heroB.id, 0, "reflect");
		setReflectAbandon(state, heroB.id, 0, fwTheme.id);

		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB], fellowshipActor }),
		);
		const abandons = operations.questMarks.filter(
			(m) => m.track === "abandon" && m.theme === fwTheme,
		);
		expect(abandons).toHaveLength(1);
		expect(abandons[0].newValue).toBe(2);
	});

	it("accumulated marks clamp at the track max (3) — extras in the same pack-up are dropped", () => {
		// Baseline of 2; two heroes reflect on the same fellowship theme.
		// Without clamping, newValue would land at 4 and detectTrackCompletion
		// (exact-match at 3) would never fire.
		const fwTheme = fakeItem({ type: "theme", effects: [] });
		fwTheme.system = {
			isFellowship: true,
			abandon: { value: 0 },
			milestone: { value: 0 },
			improve: { value: 2 },
		};
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const heroA = fakeActor();
		heroA.system = { themes: [], fellowshipActor };
		const heroB = fakeActor();
		heroB.system = { themes: [], fellowshipActor };

		const state = defaultCampingState();
		setActivity(state, heroA.id, 0, "reflect");
		setReflectTarget(state, heroA.id, 0, fwTheme.id);
		setActivity(state, heroB.id, 0, "reflect");
		setReflectTarget(state, heroB.id, 0, fwTheme.id);

		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB], fellowshipActor }),
		);
		const improves = operations.improves.filter((i) => i.theme === fwTheme);
		expect(improves).toHaveLength(1);
		expect(improves[0].newValue).toBe(3);
	});

	it("single-hero mark against a track already at max clamps at 3 (doesn't overflow)", () => {
		// Edge case: a previous camp's improvement chat card is unresolved
		// (improve.value sitting at 3). Bumping again must not silently
		// write 4.
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = {
			improve: { value: 3 },
			abandon: { value: 0 },
			milestone: { value: 0 },
		};
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, theme.id);

		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.improves[0].newValue).toBe(3);
	});

	it("sojourn-mode Reflect with Quest marks still does +1 on the Quest tracks (sojourn only accelerates Improve)", () => {
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = {
			improve: { value: 0 },
			abandon: { value: 0 },
			milestone: { value: 2 },
		};
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, theme.id);
		setReflectMilestone(state, hero.id, 0, theme.id);

		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.improvements).toHaveLength(1);
		// Quest mark stays +1, not boosted to track-completion.
		expect(operations.questMarks).toContainEqual({
			theme,
			owner: hero,
			track: "milestone",
			newValue: 3,
			sourceHero: hero,
		});
	});
});

describe("buildOperations — sojourn-mode reflect", () => {
	it("queues an improvement (not an improve tick) on the chosen own theme", () => {
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = { improve: { value: 0 } };
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, theme.id);

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.improves).toEqual([]);
		expect(operations.improvements).toContainEqual({
			theme,
			owner: hero,
			sourceHero: hero,
		});
		expect(stageLines(recap, "period1")).toContainEqual(
			expect.objectContaining({
				kind: "reflect-improvement",
				themeName: theme.name,
			}),
		);
	});

	it("two heroes sojourn-reflecting on the fellowship theme produce TWO improvements (no accumulator)", () => {
		const fwTheme = fakeItem({ type: "theme", effects: [] });
		fwTheme.system = { isFellowship: true, improve: { value: 0 } };
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const heroA = fakeActor();
		heroA.system = { themes: [], fellowshipActor };
		const heroB = fakeActor();
		heroB.system = { themes: [], fellowshipActor };

		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, heroA.id, 0, "reflect");
		setReflectTarget(state, heroA.id, 0, fwTheme.id);
		setActivity(state, heroB.id, 0, "reflect");
		setReflectTarget(state, heroB.id, 0, fwTheme.id);

		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB], fellowshipActor }),
		);
		expect(operations.improvements).toHaveLength(2);
		expect(operations.improves).toEqual([]);
	});
});

describe("buildOperations — Fellowship Quality Time (exclusive choice)", () => {
	it("does NOT auto-unscratch relationship tags when no quality-time action is selected", () => {
		const rel = fakeEffect({
			name: "rival",
			type: "relationship_tag",
			system: { isScratched: true },
		});
		const hero = fakeActor({ effects: [rel] });

		const state = defaultCampingState();
		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.unscratches).not.toContainEqual({ effect: rel });
		// No quality-time action → no Quality Time stage at all.
		expect(stage(recap, "qualityTime")).toBeUndefined();
	});

	it("recoverFellowship: unscratches the chosen scratched fellowship_tag", () => {
		const fsTag = fakeEffect({
			name: "we never give up",
			type: "fellowship_tag",
			system: { isScratched: true },
		});
		const fwTheme = fakeItem({ type: "theme", effects: [fsTag] });
		fwTheme.system = { isFellowship: true };
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const hero = fakeActor({ items: [fwTheme] });
		hero.system = { fellowshipActor };

		const state = defaultCampingState();
		setQualityTime(state, hero.id, "action", "recoverFellowship");
		setQualityTime(state, hero.id, "fellowshipTagId", fsTag.id);

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero], fellowshipActor }),
		);
		expect(operations.unscratches).toContainEqual({ effect: fsTag });
		expect(stageLines(recap, "qualityTime")).toContainEqual(
			expect.objectContaining({ kind: "fellowship-tag-recovered" }),
		);
	});

	it("recoverFellowship: silently drops a stale fellowshipTagId that doesn't match anything", () => {
		const hero = fakeActor();
		const state = defaultCampingState();
		setQualityTime(state, hero.id, "action", "recoverFellowship");
		setQualityTime(state, hero.id, "fellowshipTagId", "ghost-id");
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.unscratches).toEqual([]);
	});

	it("recoverFellowship: does not target a non-scratched fellowship_tag", () => {
		const fsTag = fakeEffect({
			name: "we endure",
			type: "fellowship_tag",
			system: { isScratched: false },
		});
		const fwTheme = fakeItem({ type: "theme", effects: [fsTag] });
		fwTheme.system = { isFellowship: true };
		const hero = fakeActor({ items: [fwTheme] });

		const state = defaultCampingState();
		setQualityTime(state, hero.id, "action", "recoverFellowship");
		setQualityTime(state, hero.id, "fellowshipTagId", fsTag.id);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.unscratches).toEqual([]);
	});

	it("rephraseRelationship without a rename: unscratches and reports as 'renewed'", () => {
		const rel = fakeEffect({
			name: "rival",
			type: "relationship_tag",
			system: { isScratched: true },
		});
		const hero = fakeActor({ effects: [rel] });

		const state = defaultCampingState();
		setQualityTime(state, hero.id, "action", "rephraseRelationship");
		setQualityTime(state, hero.id, "relationshipEffectId", rel.id);

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.unscratches).toContainEqual({ effect: rel });
		expect(operations.renames).toEqual([]);
		expect(stageLines(recap, "qualityTime")).toContainEqual(
			expect.objectContaining({ kind: "relationship-renewed" }),
		);
	});

	it("rephraseRelationship with a new name: unscratches AND renames", () => {
		const rel = fakeEffect({
			name: "rival",
			type: "relationship_tag",
			system: { isScratched: true },
		});
		const hero = fakeActor({ effects: [rel] });

		const state = defaultCampingState();
		setQualityTime(state, hero.id, "action", "rephraseRelationship");
		setQualityTime(state, hero.id, "relationshipEffectId", rel.id);
		setQualityTime(state, hero.id, "relationshipRephrase", "uneasy allies");

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [hero] }),
		);
		expect(operations.unscratches).toContainEqual({ effect: rel });
		expect(operations.renames).toContainEqual({
			effect: rel,
			newName: "uneasy allies",
		});
		expect(stageLines(recap, "qualityTime")).toContainEqual(
			expect.objectContaining({
				kind: "relationship-rephrased",
				from: "rival",
				to: "uneasy allies",
			}),
		);
	});

	it("rephraseRelationship works on a non-scratched relationship tag (renew + reframe)", () => {
		const rel = fakeEffect({
			name: "rival",
			type: "relationship_tag",
			system: { isScratched: false },
		});
		const hero = fakeActor({ effects: [rel] });

		const state = defaultCampingState();
		setQualityTime(state, hero.id, "action", "rephraseRelationship");
		setQualityTime(state, hero.id, "relationshipEffectId", rel.id);
		setQualityTime(state, hero.id, "relationshipRephrase", "uneasy allies");

		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.unscratches).toEqual([{ effect: rel }]);
		expect(operations.renames).toEqual([
			{ effect: rel, newName: "uneasy allies" },
		]);
	});

	it("newRelationship: forges a relationship toward a fellowship hero with no existing one", () => {
		const heroA = fakeActor({ name: "Alice" });
		const heroB = fakeActor({ name: "Bob" });
		const state = defaultCampingState();
		setQualityTime(state, heroA.id, "action", "newRelationship");
		setQualityTime(state, heroA.id, "newRelationshipTargetId", heroB.id);
		setQualityTime(state, heroA.id, "newRelationshipName", "comrades");

		const { operations, recap } = buildOperations(
			state,
			world({ heroes: [heroA, heroB] }),
		);
		expect(operations.relationshipCreations).toContainEqual({
			heroActor: heroA,
			targetId: heroB.id,
			name: "comrades",
		});
		expect(stageLines(recap, "qualityTime")).toContainEqual(
			expect.objectContaining({
				kind: "relationship-created",
				name: "comrades",
				partnerName: "Bob",
			}),
		);
	});

	it("newRelationship: does not create a duplicate if the relationship already exists", () => {
		const heroA = fakeActor({ name: "Alice" });
		const heroB = fakeActor({ name: "Bob" });
		const rel = fakeEffect({
			name: "rival",
			type: "relationship_tag",
			system: { targetId: heroB.id, isScratched: false },
		});
		heroA.effects.push(rel);
		rel.parent = heroA;

		const state = defaultCampingState();
		setQualityTime(state, heroA.id, "action", "newRelationship");
		setQualityTime(state, heroA.id, "newRelationshipTargetId", heroB.id);
		setQualityTime(state, heroA.id, "newRelationshipName", "comrades");

		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB] }),
		);
		expect(operations.relationshipCreations).toEqual([]);
	});

	it("newRelationship: ignores targets that aren't fellowship heroes", () => {
		const heroA = fakeActor({ name: "Alice" });
		const state = defaultCampingState();
		setQualityTime(state, heroA.id, "action", "newRelationship");
		setQualityTime(state, heroA.id, "newRelationshipTargetId", "stranger-id");
		setQualityTime(state, heroA.id, "newRelationshipName", "comrades");

		const { operations } = buildOperations(state, world({ heroes: [heroA] }));
		expect(operations.relationshipCreations).toEqual([]);
	});

	it("newRelationship requires both a target and a non-empty name", () => {
		const heroA = fakeActor({ name: "Alice" });
		const heroB = fakeActor({ name: "Bob" });
		const state = defaultCampingState();
		setQualityTime(state, heroA.id, "action", "newRelationship");
		setQualityTime(state, heroA.id, "newRelationshipTargetId", heroB.id);
		// name not set
		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB] }),
		);
		expect(operations.relationshipCreations).toEqual([]);
	});
});

describe("buildOperations — fellowship_tag is NOT recoverable via Rest", () => {
	// Fellowship tags are shared resources; the Quality Time choice is their
	// only refresh path. The Rest activity's recovery list is power_tag only
	// — buildRestOps filters by type so a stale id from a buggy client
	// can't unilaterally restore a shared fellowship resource.
	it("Rest recover-tag silently drops fellowship_tag ids", () => {
		const tag = fakeEffect({
			name: "we never give up",
			type: "fellowship_tag",
			system: { isScratched: true },
		});
		const fellowshipTheme = fakeItem({ type: "theme", effects: [tag] });
		fellowshipTheme.system = { isFellowship: true };
		const hero = fakeActor({ items: [fellowshipTheme] });

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "rest");
		setRestRecoverTag(state, hero.id, 0, tag.id, true);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.unscratches).toEqual([]);
	});

	it("Rest recover-tag still unscratches a normal scratched power_tag", () => {
		const tag = fakeEffect({
			name: "iron will",
			type: "power_tag",
			system: { isScratched: true },
		});
		const theme = fakeItem({ type: "theme", effects: [tag] });
		const hero = fakeActor({ items: [theme] });

		const state = defaultCampingState();
		setActivity(state, hero.id, 0, "rest");
		setRestRecoverTag(state, hero.id, 0, tag.id, true);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.unscratches).toContainEqual({ effect: tag });
	});
});

describe("parseCampsiteEntries", () => {
	it("parses [tag] syntax → story_tag entries", () => {
		const entries = parseCampsiteEntries("[warm fire] [dry roof]");
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ name: "warm fire", type: "story_tag" });
		expect(entries[1]).toMatchObject({ name: "dry roof", type: "story_tag" });
	});

	it("parses [name-N] syntax → status_tag entries with the tier set", () => {
		const entries = parseCampsiteEntries("[rainy-2] [annoying gnats]");
		const status = entries.find((e) => e.type === "status_tag");
		expect(status).toBeDefined();
		expect(status.name).toBe("rainy");
		expect(status.system.tiers).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("parses [name!] syntax → single-use story_tag", () => {
		const entries = parseCampsiteEntries("[lucky charm!]");
		expect(entries[0]).toMatchObject({
			name: "lucky charm",
			type: "story_tag",
			system: { isSingleUse: true },
		});
	});

	it("returns [] on empty / null / non-string input", () => {
		expect(parseCampsiteEntries("")).toEqual([]);
		expect(parseCampsiteEntries(null)).toEqual([]);
		expect(parseCampsiteEntries(undefined)).toEqual([]);
		expect(parseCampsiteEntries(42)).toEqual([]);
	});
});

describe("buildOperations — place of stay", () => {
	it("echoes campsite entries on the recap (creation happens at Begin Camp, not here)", () => {
		const state = defaultCampingState();
		state.placeOfStay.name = "Old shepherd's hut";
		state.placeOfStay.campsiteTags = "[warm fire] [rainy-2]";

		const { recap } = buildOperations(state, world({}));
		expect(recap.placeOfStay.name).toBe("Old shepherd's hut");
		expect(recap.placeOfStay.campsiteTags).toEqual([
			{ name: "warm fire", isStatus: false, tier: 0, isSingleUse: false },
			{ name: "rainy", isStatus: true, tier: 2, isSingleUse: false },
		]);
	});

	it("does NOT queue scene-tag expiry at Pack Up (expiry happens at Begin Camp now)", () => {
		const sceneFx = fakeEffect({ name: "spies everywhere", type: "story_tag" });
		const state = defaultCampingState();
		// Even if the flag still held expiry ids (it shouldn't after Begin
		// Camp clears it), the apply layer must not enqueue duplicate deletes.
		state.placeOfStay.sceneTagsToExpire = [sceneFx.id];

		const { recap } = buildOperations(
			state,
			world({ sceneEffects: [sceneFx] }),
		);
		expect(recap.placeOfStay).not.toHaveProperty("sceneTagsExpired");
	});

	it("does not throw on empty / null campsiteTags", () => {
		const state = defaultCampingState();
		state.placeOfStay.campsiteTags = null;
		expect(() => buildOperations(state, world({}))).not.toThrow();
		state.placeOfStay.campsiteTags = "";
		expect(() => buildOperations(state, world({}))).not.toThrow();
	});

	it("surfaces resolved threat vignettes on the recap (no ops generated)", () => {
		const state = defaultCampingState();
		addThreatVignette(state, "vignette-1");

		const threatItems = [
			{
				id: "vignette-1",
				name: "Gathering clouds",
				threat: "A storm is brewing on the horizon.",
				consequences: ["Heroes wake [drenched-2]"],
				isConsequenceOnly: false,
			},
		];
		const { recap } = buildOperations(state, world({ threatItems }));
		expect(recap.placeOfStay.threats).toEqual([
			{
				id: "vignette-1",
				name: "Gathering clouds",
				threat: "A storm is brewing on the horizon.",
				consequences: ["Heroes wake [drenched-2]"],
				isConsequenceOnly: false,
			},
		]);
	});

	it("no threats → empty recap list", () => {
		const state = defaultCampingState();
		const { recap } = buildOperations(state, world({}));
		expect(recap.placeOfStay.threats).toEqual([]);
	});
});
