import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyActorTagUpdates,
	applyLimitUpdates,
	buildStoryTagUpdates,
} from "../modules/apps/story-tags/story-tag-form-processor.js";
import { LitmConfig } from "../modules/system/config.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// The sidebar submits the whole form on any change. A form rendered before a
// concurrent change still carries the old value of every row the user never
// touched, so the processor may only send what differs from the form's own
// render-time values (`baseline`), never from the live documents: an untouched
// stale row differs from live by definition, and sending it is the bug.

const original = CONFIG.litmv2;
const originalUser = game.user;

beforeEach(() => {
	CONFIG.litmv2 = Object.create(LitmConfig);
	CONFIG.litmv2.heroLimit = 5;
	CONFIG.litmv2._maxStatusTierOverride = null;
	game.user = { isGM: true, id: "gm" };
});

afterEach(() => {
	CONFIG.litmv2 = original;
	game.user = originalUser;
});

/** A tier track as FormDataExtended submits it: the box's tier, or null. */
const tierBoxes = (marked = [], length = 6) =>
	Array.from({ length }, (_, i) =>
		marked.includes(i + 1) ? `${i + 1}` : null,
	);

/** A story_tag row as the sidebar form submits it. */
const tagRow = (over = {}) => ({
	tagType: "story_tag",
	limitId: "",
	name: "lantern",
	isSingleUse: false,
	isScratched: false,
	...over,
});

/** A status_tag row as the sidebar form submits it. */
const statusRow = (marked = [], over = {}) => ({
	tagType: "status_tag",
	limitId: "",
	name: "cold",
	values: tierBoxes(marked),
	...over,
});

/** An actor holding one effect per id, so updateEffectsByParent can route. */
const actorWith = (...effectIds) =>
	fakeActor({
		effects: effectIds.map((id) => fakeEffect({ id, system: {} })),
	});

const written = (actor) =>
	actor.updateEmbeddedDocuments.mock.calls.flatMap(([, updates]) => updates);

describe("applyActorTagUpdates", () => {
	it("sends nothing for a form the user did not change", async () => {
		const actor = actorWith("a", "b");
		const form = { Actor__x: { a: tagRow(), b: statusRow([2]) } };

		const touched = await applyActorTagUpdates(
			form,
			() => actor,
			structuredClone(form),
		);

		expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(touched).toEqual([]);
	});

	it("sends only the field that changed", async () => {
		const actor = actorWith("a");
		const baseline = { Actor__x: { a: tagRow() } };
		const form = { Actor__x: { a: tagRow({ isScratched: true }) } };

		await applyActorTagUpdates(form, () => actor, baseline);

		expect(written(actor)).toEqual([
			{ _id: "a", system: { isScratched: true } },
		]);
	});

	it("does not write a stale untouched row back over a concurrent change", async () => {
		// The player scratched `a` from their hero sheet after this GM's form was
		// rendered, so live holds isScratched: true while the form still says
		// false. The GM ticks a tier on `b`. `a` must not be sent.
		const live = fakeEffect({ id: "a", system: { isScratched: true } });
		const status = fakeEffect({ id: "b", system: {} });
		const actor = fakeActor({ effects: [live, status] });
		const baseline = { Actor__x: { a: tagRow(), b: statusRow([1]) } };
		const form = { Actor__x: { a: tagRow(), b: statusRow([1, 2]) } };

		await applyActorTagUpdates(form, () => actor, baseline);

		expect(written(actor)).toEqual([
			{ _id: "b", system: { tiers: [true, true, false, false, false, false] } },
		]);
	});

	it("sends only the name when only the name changed", async () => {
		const actor = actorWith("a");
		const baseline = { Actor__x: { a: tagRow() } };
		const form = { Actor__x: { a: tagRow({ name: "torch" }) } };

		await applyActorTagUpdates(form, () => actor, baseline);

		expect(written(actor)).toEqual([{ _id: "a", name: "torch" }]);
	});

	it("sends the whole tier array when one box changes", async () => {
		const actor = actorWith("s");
		const baseline = { Actor__x: { s: statusRow([1, 3]) } };
		const form = { Actor__x: { s: statusRow([1, 3, 4]) } };

		await applyActorTagUpdates(form, () => actor, baseline);

		expect(written(actor)).toEqual([
			{ _id: "s", system: { tiers: [true, false, true, true, false, false] } },
		]);
	});

	it("does not treat a status row's name or tiers as scratch fields", async () => {
		const actor = actorWith("s");
		const baseline = { Actor__x: { s: statusRow([2]) } };
		const form = { Actor__x: { s: statusRow([2], { name: "frozen" }) } };

		await applyActorTagUpdates(form, () => actor, baseline);

		expect(written(actor)).toEqual([{ _id: "s", name: "frozen" }]);
	});

	it("sends a changed limit assignment as null when it is cleared", async () => {
		const actor = actorWith("a");
		const baseline = { Actor__x: { a: tagRow({ limitId: "L1" }) } };
		const form = { Actor__x: { a: tagRow({ limitId: "" }) } };

		await applyActorTagUpdates(form, () => actor, baseline);

		expect(written(actor)).toEqual([{ _id: "a", system: { limitId: null } }]);
	});

	it("falls back to the full update for a row the baseline never saw", async () => {
		const actor = actorWith("a");
		const form = { Actor__x: { a: tagRow({ isScratched: true }) } };

		await applyActorTagUpdates(form, () => actor, { Actor__x: {} });

		expect(written(actor)).toEqual([
			{
				_id: "a",
				name: "lantern",
				system: { isScratched: true, isSingleUse: false, limitId: null },
			},
		]);
	});

	it("falls back to the full update when there is no baseline at all", async () => {
		const actor = actorWith("s");
		const form = { Actor__x: { s: statusRow([2]) } };

		await applyActorTagUpdates(form, () => actor);

		expect(written(actor)).toEqual([
			{
				_id: "s",
				name: "cold",
				system: { tiers: [false, true, false, false, false, false] },
			},
		]);
	});

	it("reports only the actors it wrote, and skips actors the user does not own", async () => {
		const mine = actorWith("a");
		const quiet = actorWith("q");
		const theirs = fakeActor({
			isOwner: false,
			effects: [fakeEffect({ id: "t" })],
		});
		const actors = { mine, quiet, theirs };
		const baseline = {
			mine: { a: tagRow() },
			quiet: { q: tagRow() },
			theirs: { t: tagRow() },
		};
		const form = {
			mine: { a: tagRow({ isScratched: true }) },
			quiet: { q: tagRow() },
			theirs: { t: tagRow({ isScratched: true }) },
		};

		const touched = await applyActorTagUpdates(
			form,
			(id) => actors[id],
			baseline,
		);

		expect(touched).toEqual(["mine"]);
		expect(quiet.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theirs.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("buildStoryTagUpdates", () => {
	it("builds nothing for a form the user did not change", () => {
		const form = { a: tagRow(), b: statusRow([3]) };

		expect(buildStoryTagUpdates(form, structuredClone(form))).toEqual([]);
	});

	it("builds only the dotted key that changed", () => {
		const baseline = { a: tagRow(), b: tagRow({ name: "rope" }) };
		const form = {
			a: tagRow({ isScratched: true }),
			b: tagRow({ name: "rope" }),
		};

		expect(buildStoryTagUpdates(form, baseline)).toEqual([
			{ _id: "a", "system.isScratched": true },
		]);
	});

	it("builds the whole tier array when one box changes", () => {
		const baseline = { s: statusRow([1]) };
		const form = { s: statusRow([1, 5]) };

		expect(buildStoryTagUpdates(form, baseline)).toEqual([
			{ _id: "s", "system.tiers": [true, false, false, false, true, false] },
		]);
	});

	it("leaves the limit assignment alone when the form does not carry one", () => {
		const row = tagRow({ name: "torch" });
		delete row.limitId;
		const baseline = { a: { ...row, name: "lantern" } };

		expect(buildStoryTagUpdates({ a: row }, baseline)).toEqual([
			{ _id: "a", name: "torch" },
		]);
	});

	it("falls back to the full update for a row the baseline never saw", () => {
		expect(
			buildStoryTagUpdates({ a: tagRow({ isSingleUse: true }) }, {}),
		).toEqual([
			{
				_id: "a",
				name: "lantern",
				"system.isScratched": false,
				"system.isSingleUse": true,
				"system.limitId": null,
			},
		]);
	});

	it("tolerates an empty form", () => {
		expect(buildStoryTagUpdates(undefined, undefined)).toEqual([]);
	});
});

describe("applyLimitUpdates", () => {
	const storyLimits = () => [
		{ id: "L1", label: "Doom", max: 5 },
		{ id: "L2", label: "Fear", max: 3 },
	];
	const noActor = () => null;

	it("reports nothing to persist when no limit field changed", async () => {
		const form = {
			story: {
				L1: { label: "Doom", max: "5" },
				L2: { label: "Fear", max: "3" },
			},
		};

		const result = await applyLimitUpdates(
			form,
			storyLimits(),
			noActor,
			structuredClone(form),
		);

		expect(result.storyLimits).toBeNull();
		expect(result.flagLimitsWritten).toBe(false);
	});

	it("changes only the edited label and keeps live values for the rest", async () => {
		// The form was rendered when L2 read "Terror"; live has since moved on to
		// "Fear". The user only renamed L1, so L2 keeps its live label.
		const baseline = {
			story: {
				L1: { label: "Doom", max: "5" },
				L2: { label: "Terror", max: "3" },
			},
		};
		const form = {
			story: {
				L1: { label: "Ruin", max: "5" },
				L2: { label: "Terror", max: "3" },
			},
		};

		const result = await applyLimitUpdates(
			form,
			storyLimits(),
			noActor,
			baseline,
		);

		expect(result.storyLimits).toEqual([
			{ id: "L1", label: "Ruin", max: 5 },
			{ id: "L2", label: "Fear", max: 3 },
		]);
	});

	it("keeps the edited max as the form submitted it", async () => {
		const baseline = { story: { L1: { label: "Doom", max: "5" } } };
		const form = { story: { L1: { label: "Doom", max: "7" } } };

		const result = await applyLimitUpdates(
			form,
			storyLimits(),
			noActor,
			baseline,
		);

		expect(result.storyLimits[0]).toEqual({
			id: "L1",
			label: "Doom",
			max: "7",
		});
	});

	it("reports nothing to persist when the edit already matches live", async () => {
		const baseline = { story: { L1: { label: "Doom", max: "4" } } };
		const form = { story: { L1: { label: "Doom", max: "5" } } };

		const result = await applyLimitUpdates(
			form,
			storyLimits(),
			noActor,
			baseline,
		);

		expect(result.storyLimits).toBeNull();
	});

	it("applies every field when there is no baseline", async () => {
		const form = { story: { L1: { label: "Ruin", max: "7" } } };

		const result = await applyLimitUpdates(form, storyLimits(), noActor);

		expect(result.storyLimits[0]).toEqual({
			id: "L1",
			label: "Ruin",
			max: "7",
		});
	});

	it("does nothing for a player", async () => {
		game.user = { isGM: false, id: "p" };
		const form = { story: { L1: { label: "Ruin", max: "7" } } };

		const result = await applyLimitUpdates(form, storyLimits(), noActor, {});

		expect(result.storyLimits).toBeNull();
		expect(result.flagLimitsWritten).toBe(false);
	});

	describe("per-actor limits", () => {
		const journey = (limits) =>
			fakeActor({
				type: "journey",
				system: { limits, setLimits: vi.fn().mockResolvedValue(undefined) },
			});

		it("does not rewrite an actor whose limits are unchanged", async () => {
			const actor = journey([{ id: "J1", label: "Hunger", max: 4 }]);
			const form = { Actor__j: { J1: { label: "Hunger", max: "4" } } };

			const result = await applyLimitUpdates(
				{ ...form },
				[],
				() => actor,
				structuredClone(form),
			);

			expect(actor.system.setLimits).not.toHaveBeenCalled();
			expect(result.flagLimitsWritten).toBe(false);
		});

		it("writes only the edited label back through setLimits", async () => {
			const actor = journey([
				{ id: "J1", label: "Hunger", max: 4 },
				{ id: "J2", label: "Cold", max: 2 },
			]);
			const baseline = {
				Actor__j: {
					J1: { label: "Hunger", max: "4" },
					J2: { label: "Chill", max: "2" },
				},
			};
			const form = {
				Actor__j: {
					J1: { label: "Thirst", max: "4" },
					J2: { label: "Chill", max: "2" },
				},
			};

			const result = await applyLimitUpdates(form, [], () => actor, baseline);

			expect(actor.system.setLimits).toHaveBeenCalledWith([
				{ id: "J1", label: "Thirst", max: 4 },
				{ id: "J2", label: "Cold", max: 2 },
			]);
			expect(result.flagLimitsWritten).toBe(true);
		});

		it("writes a Challenge's edited max through its own setLimits", async () => {
			const challenge = fakeActor({
				type: "challenge",
				system: {
					limits: [{ id: "C1", label: "Harm", max: 3, hidden: false }],
					setLimits: vi.fn().mockResolvedValue(undefined),
				},
			});
			const baseline = { Actor__c: { C1: { label: "Harm", max: "3" } } };
			const form = { Actor__c: { C1: { label: "Harm", max: "4" } } };

			await applyLimitUpdates(form, [], () => challenge, baseline);

			expect(challenge.system.setLimits).toHaveBeenCalledWith([
				{ id: "C1", label: "Harm", max: "4", hidden: false },
			]);
		});

		it("never writes a hero's max, which is fixed by the world", async () => {
			const hero = fakeActor({
				type: "hero",
				system: {
					limits: [{ id: "H1", label: "Despair", max: 5 }],
					setLimits: vi.fn().mockResolvedValue(undefined),
				},
			});
			const baseline = { Actor__h: { H1: { label: "Despair", max: "4" } } };
			const form = { Actor__h: { H1: { label: "Despair", max: "9" } } };

			await applyLimitUpdates(form, [], () => hero, baseline);

			expect(hero.system.setLimits).not.toHaveBeenCalled();
		});
	});
});

// The max box renders empty with a "~" placeholder for "no maximum".
describe("applyLimitUpdates — empty max box", () => {
	const run = (formMax, renderedMax, liveMax) =>
		applyLimitUpdates(
			{ story: { l1: { label: "Wall", max: formMax } } },
			[{ id: "l1", label: "Wall", max: liveMax }],
			() => null,
			{ story: { l1: { label: "Wall", max: renderedMax } } },
		);

	it("leaves an untouched no-maximum limit alone", async () => {
		const result = await run("", "", 0);
		expect(result.storyLimits).toBeNull();
	});

	it("does not overwrite a max someone else changed while the box sat empty", async () => {
		const result = await run("", "", 5);
		expect(result.storyLimits).toBeNull();
	});

	it("clearing a max makes it no maximum", async () => {
		const result = await run("", "4", 4);
		expect(result.storyLimits[0].max).toBe(0);
	});
});
