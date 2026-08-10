import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceFlagLimit } from "../modules/actor/mixins/actor-limits.js";
import { LitmSettings } from "../modules/system/settings.js";

// Regression: a Hero Limit above the status track's depth is unreachable —
// the hero is simply unkillable. Status tracks now grow with the setting
// (CONFIG.litmv2.maxStatusTier = heroLimit + 1), so the only bound left is
// keeping the deepest homebrew track renderable at ten boxes. Values stored
// outside the range are clamped on read rather than migrated.
describe("LitmSettings.heroLimit clamping", () => {
	beforeEach(() => {
		game.settings.get.mockReset();
	});

	const storedAs = (value) => {
		game.settings.get.mockReturnValue(value);
		return LitmSettings.heroLimit;
	};

	it("passes through values in range, homebrew included", () => {
		expect(storedAs(3)).toBe(3);
		expect(storedAs(5)).toBe(5);
		expect(storedAs(7)).toBe(7);
		expect(storedAs(9)).toBe(9);
	});

	it("clamps values above the renderable track depth", () => {
		expect(storedAs(10)).toBe(9);
		expect(storedAs(99)).toBe(9);
	});

	it("clamps below the minimum", () => {
		expect(storedAs(0)).toBe(1);
		expect(storedAs(-4)).toBe(1);
	});

	it("falls back to the core-book default for unusable values", () => {
		expect(storedAs(undefined)).toBe(5);
		expect(storedAs("not a number")).toBe(5);
	});
});

// `CONFIG.litmv2.heroLimit` has two writers — the ready hook (via the getter)
// and the setting's own onChange. Both must clamp, or a `game.settings.set`
// from a macro would leave an unreachable limit in CONFIG.
describe("hero_limit onChange", () => {
	it("clamps the value it writes to CONFIG", () => {
		game.settings.register.mockClear();
		game.settings.registerMenu ??= vi.fn();
		globalThis.CONFIG ??= {};
		CONFIG.litmv2 ??= {};
		LitmSettings.register();

		const call = game.settings.register.mock.calls.find(
			([, key]) => key === "hero_limit",
		);
		expect(call).toBeDefined();
		const [, , definition] = call;
		expect(definition.range).toEqual({ min: 1, max: 9, step: 1 });

		definition.onChange(12);
		expect(CONFIG.litmv2.heroLimit).toBe(9);

		definition.onChange(4);
		expect(CONFIG.litmv2.heroLimit).toBe(4);
	});
});

// Hero limits derive their max from the world setting rather than the stored
// per-limit max (HeroData.getEffectiveMax), so a limit created while the
// setting was 8 keeps a stale `max: 8` on the flag. The manual Advance path
// must clamp to the effective max, not the stale one.
describe("advanceFlagLimit max override", () => {
	const makeActor = (limits) => {
		const stored = { value: limits };
		return {
			getFlag: vi.fn(() => stored.value),
			setFlag: vi.fn(async (_scope, _key, next) => {
				stored.value = next;
				return next;
			}),
			stored,
		};
	};

	const staleLimit = { id: "L1", label: "Wounded", max: 8, value: 5 };

	it("clamps to the override instead of the stale stored max", async () => {
		const actor = makeActor([{ ...staleLimit }]);

		const result = await advanceFlagLimit(actor, "L1", 3, { max: 6 });

		expect(result.value).toBe(6);
		expect(result.max).toBe(6);
		expect(actor.stored.value[0].value).toBe(6);
	});

	it("falls back to the stored max when no override is given", async () => {
		const actor = makeActor([{ ...staleLimit }]);

		const result = await advanceFlagLimit(actor, "L1", 3);

		expect(result.value).toBe(8);
		expect(result.max).toBe(8);
	});

	it("honours a max of 0 (a Limit with no maximum) instead of falling back to 6", async () => {
		const actor = makeActor([{ ...staleLimit, value: 0 }]);

		const result = await advanceFlagLimit(actor, "L1", 4, { max: 0 });

		expect(result.max).toBe(0);
		expect(result.value).toBe(0);
	});

	it("falls back past a blank stored max", async () => {
		const actor = makeActor([{ id: "L1", label: "Ritual", max: "", value: 0 }]);

		const result = await advanceFlagLimit(actor, "L1", 2);

		expect(result.max).toBe(6);
		expect(result.value).toBe(2);
	});

	it("still floors at zero when setting a limit back", async () => {
		const actor = makeActor([{ ...staleLimit, value: 1 }]);

		const result = await advanceFlagLimit(actor, "L1", -4, { max: 6 });

		expect(result.value).toBe(0);
	});
});
