import { describe, expect, it } from "vitest";
import {
	addThreatVignette,
	adjustRestChoice,
	defaultCampingState,
	defaultHeroState,
	defaultQualityTime,
	ensureHeroState,
	removeThreatVignette,
	SETTERS,
	setActivity,
	setActivityDetail,
	setBackpackKept,
	setCampsiteTags,
	setPhase,
	setPlaceOfStayName,
	setQualityTime,
	setReflectAbandon,
	setReflectMilestone,
	setReflectTarget,
	setRestChoice,
	setRestRecoverTag,
	setSceneTagExpiry,
	setSojournDuration,
	setThirdPeriod,
	setType,
} from "../modules/apps/camping/camping-state.js";

describe("defaultCampingState", () => {
	it("starts as a camp, sojourn duration defaults to days, empty hero map", () => {
		const s = defaultCampingState();
		expect(s.type).toBe("camp");
		expect(s.sojournDuration).toBe("days");
		expect(s.heroStates).toEqual({});
		expect(s.placeOfStay).toEqual({
			name: "",
			campsiteTags: "",
			threats: [],
			sceneTagsToExpire: [],
			createdCampsiteEffectIds: [],
		});
	});

	it("starts in the setup phase (GM-private prep)", () => {
		const s = defaultCampingState();
		expect(s.phase).toBe("setup");
	});
});

describe("defaultHeroState", () => {
	it("has three activity slots and an empty qualityTime slot", () => {
		const h = defaultHeroState();
		expect(h.activities).toHaveLength(3);
		expect(h.activities[0]).toEqual({
			activity: null,
			campActionDetail: "",
			reflectTargetItemId: null,
			reflectAbandonItemId: null,
			reflectMilestoneItemId: null,
			restChoices: {},
			restRecoverTagIds: [],
		});
		expect(h.thirdPeriodActive).toBe(false);
		expect(h.backpackKept).toEqual([]);
		expect(h.qualityTime).toEqual(defaultQualityTime());
		expect(h.qualityTime.action).toBe("");
	});
});

describe("ensureHeroState", () => {
	it("creates a fresh hero entry on first touch", () => {
		const s = defaultCampingState();
		const h = ensureHeroState(s, "hero-1");
		expect(s.heroStates["hero-1"]).toBe(h);
		expect(h.activities).toHaveLength(3);
	});

	it("returns the same entry on second touch", () => {
		const s = defaultCampingState();
		const h1 = ensureHeroState(s, "hero-1");
		h1.backpackKept.push("fx-1");
		const h2 = ensureHeroState(s, "hero-1");
		expect(h2).toBe(h1);
		expect(h2.backpackKept).toEqual(["fx-1"]);
	});
});

describe("setBackpackKept", () => {
	it("adds an effect id to the keep list when checked", () => {
		const s = defaultCampingState();
		setBackpackKept(s, "hero-1", "fx-1", true);
		expect(s.heroStates["hero-1"].backpackKept).toEqual(["fx-1"]);
	});

	it("removes an effect id when unchecked", () => {
		const s = defaultCampingState();
		setBackpackKept(s, "hero-1", "fx-1", true);
		setBackpackKept(s, "hero-1", "fx-1", false);
		expect(s.heroStates["hero-1"].backpackKept).toEqual([]);
	});

	it("does not duplicate when checked twice", () => {
		const s = defaultCampingState();
		setBackpackKept(s, "hero-1", "fx-1", true);
		setBackpackKept(s, "hero-1", "fx-1", true);
		expect(s.heroStates["hero-1"].backpackKept).toEqual(["fx-1"]);
	});
});

describe("setActivityDetail", () => {
	it("stores the camp action detail text", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "campAction");
		setActivityDetail(s, "hero-1", 0, "stand watch");
		expect(s.heroStates["hero-1"].activities[0].campActionDetail).toBe(
			"stand watch",
		);
	});

	it("treats null/undefined as empty string", () => {
		const s = defaultCampingState();
		setActivityDetail(s, "hero-1", 0, null);
		expect(s.heroStates["hero-1"].activities[0].campActionDetail).toBe("");
	});
});

describe("setActivity", () => {
	it("writes activity and clears sub-state", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "reflect");
		setReflectTarget(s, "hero-1", 0, "theme-1");
		setActivity(s, "hero-1", 0, "rest");
		expect(s.heroStates["hero-1"].activities[0].activity).toBe("rest");
		expect(s.heroStates["hero-1"].activities[0].reflectTargetItemId).toBeNull();
	});

	it("accepts null to clear", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "rest");
		setActivity(s, "hero-1", 0, null);
		expect(s.heroStates["hero-1"].activities[0].activity).toBeNull();
	});

	it("rejects Rest in a second period when another period already claims it", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "rest");
		setActivity(s, "hero-1", 1, "rest");
		expect(s.heroStates["hero-1"].activities[1].activity).toBeNull();
	});

	it("rejects Reflect in a second period when another period already claims it", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "reflect");
		setActivity(s, "hero-1", 1, "reflect");
		expect(s.heroStates["hero-1"].activities[1].activity).toBeNull();
	});

	it("allows Camp Action in multiple periods (unrestricted per Core Book p.181)", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "campAction");
		setActivity(s, "hero-1", 1, "campAction");
		expect(s.heroStates["hero-1"].activities[0].activity).toBe("campAction");
		expect(s.heroStates["hero-1"].activities[1].activity).toBe("campAction");
	});

	it("allows re-setting the SAME activity in the same period (idempotent)", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "rest");
		setActivity(s, "hero-1", 0, "rest");
		expect(s.heroStates["hero-1"].activities[0].activity).toBe("rest");
	});

	it("allows Rest in a second period after the first clears", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "rest");
		setActivity(s, "hero-1", 0, null);
		setActivity(s, "hero-1", 1, "rest");
		expect(s.heroStates["hero-1"].activities[1].activity).toBe("rest");
	});
});

describe("setRestChoice", () => {
	it("stores action and amount per status effect id", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", {
			action: "reduce",
			amount: 2,
			maxTier: 5,
		});
		expect(
			s.heroStates["hero-1"].activities[0].restChoices["status-1"],
		).toEqual({
			action: "reduce",
			amount: 2,
		});
	});

	it("defaults amount to 1 when missing", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", { action: "reduce" });
		expect(
			s.heroStates["hero-1"].activities[0].restChoices["status-1"].amount,
		).toBe(1);
	});

	it("clamps amount to at least 1", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", { action: "reduce", amount: 0 });
		expect(
			s.heroStates["hero-1"].activities[0].restChoices["status-1"].amount,
		).toBe(1);
	});

	it("clamps amount to the provided maxTier", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", {
			action: "reduce",
			amount: 99,
			maxTier: 3,
		});
		expect(
			s.heroStates["hero-1"].activities[0].restChoices["status-1"].amount,
		).toBe(3);
	});
});

describe("adjustRestChoice", () => {
	const choice = (state, statusId = "status-1") =>
		state.heroStates["hero-1"].activities[0].restChoices[statusId];

	it("from keep, a -1 nudge enters reduce mode at amount 1", () => {
		const s = defaultCampingState();
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 3 });
		expect(choice(s)).toEqual({ action: "reduce", amount: 1 });
	});

	it("accumulating -1 nudges raises the reduction up to maxTier - 1, then flips to remove at cap", () => {
		const s = defaultCampingState();
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 3 });
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 3 });
		expect(choice(s)).toEqual({ action: "reduce", amount: 2 });
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 3 });
		expect(choice(s)).toEqual({ action: "remove", amount: 3 });
	});

	it("a +1 nudge from remove drops back into reduce at cap - 1", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", { action: "remove", maxTier: 3 });
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: 1, maxTier: 3 });
		expect(choice(s)).toEqual({ action: "reduce", amount: 2 });
	});

	it("a +1 nudge from reduce-1 returns to keep (entry deleted)", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", {
			action: "reduce",
			amount: 1,
			maxTier: 3,
		});
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: 1, maxTier: 3 });
		expect(choice(s)).toBeUndefined();
	});

	it("-1 past the cap stays at remove (no overflow)", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", { action: "remove", maxTier: 3 });
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 3 });
		expect(choice(s)).toEqual({ action: "remove", amount: 3 });
	});

	it("+1 past keep stays at keep (no underflow)", () => {
		const s = defaultCampingState();
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: 1, maxTier: 3 });
		expect(choice(s)).toBeUndefined();
	});

	it("defaults maxTier to 6 when not provided", () => {
		const s = defaultCampingState();
		for (let i = 0; i < 5; i++) {
			adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1 });
		}
		expect(choice(s)).toEqual({ action: "reduce", amount: 5 });
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1 });
		expect(choice(s)).toEqual({ action: "remove", amount: 6 });
	});

	it("clamps an invalid maxTier (zero or negative) to the default of 6", () => {
		const s = defaultCampingState();
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 0 });
		expect(choice(s)).toEqual({ action: "reduce", amount: 1 });
		for (let i = 0; i < 5; i++) {
			adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 0 });
		}
		expect(choice(s)).toEqual({ action: "remove", amount: 6 });
	});

	it("missing delta is a no-op", () => {
		const s = defaultCampingState();
		setRestChoice(s, "hero-1", 0, "status-1", {
			action: "reduce",
			amount: 2,
			maxTier: 3,
		});
		adjustRestChoice(s, "hero-1", 0, "status-1", { maxTier: 3 });
		expect(choice(s)).toEqual({ action: "reduce", amount: 2 });
	});

	it("interprets a stored reduce amount above the cap as the cap", () => {
		const s = defaultCampingState();
		// Stored state from a prior maxTier; new call uses a smaller cap.
		s.heroStates = {
			"hero-1": {
				...defaultHeroState(),
				activities: [
					{
						activity: "rest",
						campActionDetail: "",
						reflectTargetItemId: null,
						reflectAbandonItemId: null,
						reflectMilestoneItemId: null,
						restChoices: { "status-1": { action: "reduce", amount: 9 } },
						restRecoverTagIds: [],
					},
					...defaultHeroState().activities.slice(1),
				],
			},
		};
		adjustRestChoice(s, "hero-1", 0, "status-1", { delta: -1, maxTier: 3 });
		expect(choice(s)).toEqual({ action: "remove", amount: 3 });
	});
});

describe("setRestRecoverTag", () => {
	it("toggles an effect id in the recover list", () => {
		const s = defaultCampingState();
		setRestRecoverTag(s, "hero-1", 0, "fx-1", true);
		setRestRecoverTag(s, "hero-1", 0, "fx-2", true);
		expect(s.heroStates["hero-1"].activities[0].restRecoverTagIds).toEqual([
			"fx-1",
			"fx-2",
		]);
		setRestRecoverTag(s, "hero-1", 0, "fx-1", false);
		expect(s.heroStates["hero-1"].activities[0].restRecoverTagIds).toEqual([
			"fx-2",
		]);
	});
});

describe("setThirdPeriod", () => {
	it("per-hero opt-in", () => {
		const s = defaultCampingState();
		setThirdPeriod(s, "hero-1", true);
		expect(s.heroStates["hero-1"].thirdPeriodActive).toBe(true);
		expect(ensureHeroState(s, "hero-2").thirdPeriodActive).toBe(false);
	});

	it("clears the third slot when turned off", () => {
		const s = defaultCampingState();
		setThirdPeriod(s, "hero-1", true);
		setActivity(s, "hero-1", 2, "rest");
		setThirdPeriod(s, "hero-1", false);
		expect(s.heroStates["hero-1"].activities[2].activity).toBeNull();
	});
});

describe("setQualityTime", () => {
	it("setting the action stores it on qualityTime", () => {
		const s = defaultCampingState();
		setQualityTime(s, "hero-1", "action", "recoverFellowship");
		expect(s.heroStates["hero-1"].qualityTime.action).toBe("recoverFellowship");
	});

	it("rejects unknown actions (coerces to '')", () => {
		const s = defaultCampingState();
		setQualityTime(s, "hero-1", "action", "garbage");
		expect(s.heroStates["hero-1"].qualityTime.action).toBe("");
	});

	it("sub-field writes only land when an action is selected", () => {
		const s = defaultCampingState();
		setQualityTime(s, "hero-1", "fellowshipTagId", "fx-1");
		expect(s.heroStates["hero-1"].qualityTime.fellowshipTagId).toBe("");
		setQualityTime(s, "hero-1", "action", "recoverFellowship");
		setQualityTime(s, "hero-1", "fellowshipTagId", "fx-1");
		expect(s.heroStates["hero-1"].qualityTime.fellowshipTagId).toBe("fx-1");
	});

	it("switching action clears sub-fields of the previous selection", () => {
		const s = defaultCampingState();
		setQualityTime(s, "hero-1", "action", "rephraseRelationship");
		setQualityTime(s, "hero-1", "relationshipEffectId", "rel-1");
		setQualityTime(s, "hero-1", "relationshipRephrase", "uneasy allies");
		setQualityTime(s, "hero-1", "action", "newRelationship");
		expect(s.heroStates["hero-1"].qualityTime.relationshipEffectId).toBe("");
		expect(s.heroStates["hero-1"].qualityTime.relationshipRephrase).toBe("");
	});

	it("ignores unknown sub-fields", () => {
		const s = defaultCampingState();
		setQualityTime(s, "hero-1", "action", "newRelationship");
		setQualityTime(s, "hero-1", "garbageField", "x");
		expect(s.heroStates["hero-1"].qualityTime).not.toHaveProperty(
			"garbageField",
		);
	});
});

describe("Reflect Quest mark setters", () => {
	it("setReflectAbandon stores the theme id only when Reflect is the activity", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "reflect");
		setReflectAbandon(s, "hero-1", 0, "theme-1");
		expect(s.heroStates["hero-1"].activities[0].reflectAbandonItemId).toBe(
			"theme-1",
		);
	});

	it("setReflectMilestone stores the theme id", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "reflect");
		setReflectMilestone(s, "hero-1", 0, "theme-1");
		expect(s.heroStates["hero-1"].activities[0].reflectMilestoneItemId).toBe(
			"theme-1",
		);
	});

	it("falsy ids clear the field", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "reflect");
		setReflectAbandon(s, "hero-1", 0, "theme-1");
		setReflectAbandon(s, "hero-1", 0, "");
		expect(
			s.heroStates["hero-1"].activities[0].reflectAbandonItemId,
		).toBeNull();
	});

	it("switching activity clears all three reflect targets (Improve / Abandon / Milestone)", () => {
		const s = defaultCampingState();
		setActivity(s, "hero-1", 0, "reflect");
		setReflectTarget(s, "hero-1", 0, "theme-1");
		setReflectAbandon(s, "hero-1", 0, "theme-2");
		setReflectMilestone(s, "hero-1", 0, "theme-3");
		setActivity(s, "hero-1", 0, "rest");
		const a = s.heroStates["hero-1"].activities[0];
		expect(a.reflectTargetItemId).toBeNull();
		expect(a.reflectAbandonItemId).toBeNull();
		expect(a.reflectMilestoneItemId).toBeNull();
	});
});

describe("place of stay mutators", () => {
	it("setPlaceOfStayName", () => {
		const s = defaultCampingState();
		setPlaceOfStayName(s, "Old shepherd's hut");
		expect(s.placeOfStay.name).toBe("Old shepherd's hut");
	});

	it("addThreatVignette appends a vignette id once", () => {
		const s = defaultCampingState();
		addThreatVignette(s, "vignette-1");
		addThreatVignette(s, "vignette-1");
		addThreatVignette(s, "vignette-2");
		expect(s.placeOfStay.threats).toEqual(["vignette-1", "vignette-2"]);
	});

	it("addThreatVignette ignores non-strings and empty values", () => {
		const s = defaultCampingState();
		addThreatVignette(s, "");
		addThreatVignette(s, null);
		addThreatVignette(s, { not: "a string" });
		expect(s.placeOfStay.threats).toEqual([]);
	});

	it("removeThreatVignette drops a registered id; absent ids are a no-op", () => {
		const s = defaultCampingState();
		addThreatVignette(s, "vignette-1");
		addThreatVignette(s, "vignette-2");
		removeThreatVignette(s, "vignette-1");
		removeThreatVignette(s, "ghost");
		expect(s.placeOfStay.threats).toEqual(["vignette-2"]);
	});

	it("setCampsiteTags stores the raw string verbatim (parsing happens at apply)", () => {
		const s = defaultCampingState();
		setCampsiteTags(s, "[warm fire] [rainy-2]");
		expect(s.placeOfStay.campsiteTags).toBe("[warm fire] [rainy-2]");
	});

	it("setCampsiteTags coerces non-strings to empty", () => {
		const s = defaultCampingState();
		setCampsiteTags(s, ["bad", "input"]);
		expect(s.placeOfStay.campsiteTags).toBe("");
	});

	it("setSceneTagExpiry toggles ids", () => {
		const s = defaultCampingState();
		setSceneTagExpiry(s, "fx-1", true);
		setSceneTagExpiry(s, "fx-2", true);
		setSceneTagExpiry(s, "fx-1", false);
		expect(s.placeOfStay.sceneTagsToExpire).toEqual(["fx-2"]);
	});
});

describe("setPhase", () => {
	it("only accepts 'setup' or 'active'", () => {
		const s = defaultCampingState();
		setPhase(s, "active");
		expect(s.phase).toBe("active");
		setPhase(s, "setup");
		expect(s.phase).toBe("setup");
		setPhase(s, "garbage");
		expect(s.phase).toBe("setup");
	});

	it("dispatch via SETTERS['set-phase']", () => {
		const s = defaultCampingState();
		SETTERS["set-phase"](s, { value: "active" });
		expect(s.phase).toBe("active");
	});
});

describe("setType / setSojournDuration", () => {
	it("switching to camp resets the duration to days", () => {
		const s = defaultCampingState();
		setType(s, "sojourn");
		setSojournDuration(s, "months");
		setType(s, "camp");
		expect(s.sojournDuration).toBe("days");
	});

	it("setSojournDuration rejects unknown values", () => {
		const s = defaultCampingState();
		setSojournDuration(s, "centuries");
		expect(s.sojournDuration).toBe("days");
	});
});

describe("SETTERS dispatch table", () => {
	it("every entry is a callable function", () => {
		for (const [key, fn] of Object.entries(SETTERS)) {
			expect(typeof fn, `SETTERS["${key}"]`).toBe("function");
		}
	});

	it("set-type routes through setType", () => {
		const s = defaultCampingState();
		SETTERS["set-type"](s, { value: "sojourn" });
		expect(s.type).toBe("sojourn");
	});

	it("backpack-kept routes through setBackpackKept", () => {
		const s = defaultCampingState();
		SETTERS["backpack-kept"](s, { heroId: "h1", effectId: "fx1", kept: true });
		expect(s.heroStates.h1.backpackKept).toEqual(["fx1"]);
	});

	it("rest-choice routes amount + maxTier clamping", () => {
		const s = defaultCampingState();
		SETTERS["rest-choice"](s, {
			heroId: "h1",
			period: 0,
			statusId: "fx",
			action: "reduce",
			amount: 99,
			maxTier: 2,
		});
		expect(s.heroStates.h1.activities[0].restChoices.fx).toEqual({
			action: "reduce",
			amount: 2,
		});
	});

	it("activity routes through setActivity and respects once-per-scene", () => {
		const s = defaultCampingState();
		SETTERS.activity(s, { heroId: "h", period: 0, activity: "rest" });
		SETTERS.activity(s, { heroId: "h", period: 1, activity: "rest" });
		expect(s.heroStates.h.activities[0].activity).toBe("rest");
		expect(s.heroStates.h.activities[1].activity).toBeNull();
	});

	it("scene-tag-expiry toggles via `on` flag", () => {
		const s = defaultCampingState();
		SETTERS["scene-tag-expiry"](s, { effectId: "fx", on: true });
		expect(s.placeOfStay.sceneTagsToExpire).toEqual(["fx"]);
		SETTERS["scene-tag-expiry"](s, { effectId: "fx", on: false });
		expect(s.placeOfStay.sceneTagsToExpire).toEqual([]);
	});

	it("quality-time routes through setQualityTime, multiplexed by field", () => {
		const s = defaultCampingState();
		SETTERS["quality-time"](s, {
			heroId: "h1",
			field: "action",
			value: "newRelationship",
		});
		SETTERS["quality-time"](s, {
			heroId: "h1",
			field: "newRelationshipTargetId",
			value: "h2",
		});
		SETTERS["quality-time"](s, {
			heroId: "h1",
			field: "newRelationshipName",
			value: "comrades",
		});
		expect(s.heroStates.h1.qualityTime.action).toBe("newRelationship");
		expect(s.heroStates.h1.qualityTime.newRelationshipTargetId).toBe("h2");
		expect(s.heroStates.h1.qualityTime.newRelationshipName).toBe("comrades");
	});

	it("threat-add routes through addThreatVignette", () => {
		const s = defaultCampingState();
		SETTERS["threat-add"](s, { itemId: "vignette-1" });
		SETTERS["threat-add"](s, { itemId: "vignette-2" });
		expect(s.placeOfStay.threats).toEqual(["vignette-1", "vignette-2"]);
	});

	it("threat-remove routes through removeThreatVignette", () => {
		const s = defaultCampingState();
		s.placeOfStay.threats = ["vignette-1", "vignette-2"];
		SETTERS["threat-remove"](s, { itemId: "vignette-1" });
		expect(s.placeOfStay.threats).toEqual(["vignette-2"]);
	});

	it("reflect-target / reflect-abandon / reflect-milestone read the select's `value` payload", () => {
		// The camping-scene change handler puts the <select>'s chosen
		// option into payload.value (the select element doesn't carry a
		// data-item-id attribute).
		const s = defaultCampingState();
		SETTERS.activity(s, { heroId: "h1", period: 0, activity: "reflect" });
		SETTERS["reflect-target"](s, { heroId: "h1", period: 0, value: "theme-I" });
		SETTERS["reflect-abandon"](s, {
			heroId: "h1",
			period: 0,
			value: "theme-A",
		});
		SETTERS["reflect-milestone"](s, {
			heroId: "h1",
			period: 0,
			value: "theme-M",
		});
		expect(s.heroStates.h1.activities[0].reflectTargetItemId).toBe("theme-I");
		expect(s.heroStates.h1.activities[0].reflectAbandonItemId).toBe("theme-A");
		expect(s.heroStates.h1.activities[0].reflectMilestoneItemId).toBe(
			"theme-M",
		);
	});
});
