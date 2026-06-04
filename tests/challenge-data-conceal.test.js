import { afterEach, describe, expect, it } from "vitest";
import { ChallengeData } from "../modules/actor/challenge/challenge-data.js";
import { fakeActor } from "./__helpers__/factories.js";

// "Keep it a mystery by not naming it" (Core Book p.~8913 region): a Challenge
// with `concealName` shows `alias` (or a localized fallback) instead of its
// real name to non-GM, non-owner viewers.
//
// Two accessors with different visibility semantics:
// - `publicName`  — viewer-INDEPENDENT. For persisted strings (chat summaries)
//                   generated once and shown to everyone: must be the alias
//                   even when the GM is the one generating.
// - `maskedName`  — viewer-DEPENDENT. Null when the current user may see the
//                   real name (GM/owner/not concealed); callers fall back with
//                   `actor.system.maskedName ?? actor.name`.
describe("ChallengeData conceal-name accessors", () => {
	const makeChallenge = ({
		concealName = false,
		alias = "",
		isOwner = false,
		name = "Waken Sentry",
	} = {}) => {
		const model = new ChallengeData({ concealName, alias });
		model.parent = fakeActor({ type: "challenge", name, isOwner });
		return model;
	};

	afterEach(() => {
		game.user.isGM = false;
	});

	describe("publicName", () => {
		it("returns the real name when not concealed", () => {
			expect(makeChallenge().publicName).toBe("Waken Sentry");
		});

		it("returns the alias when concealed", () => {
			const model = makeChallenge({
				concealName: true,
				alias: "A Watchful Shape",
			});
			expect(model.publicName).toBe("A Watchful Shape");
		});

		it("falls back to the localized placeholder when the alias is blank", () => {
			const model = makeChallenge({ concealName: true, alias: "   " });
			// setup.js i18n stub echoes the key
			expect(model.publicName).toBe("LITM.Ui.unknown_challenge");
		});

		it("stays masked for the GM (persisted strings must never leak)", () => {
			game.user.isGM = true;
			const model = makeChallenge({ concealName: true, alias: "The Shape" });
			expect(model.publicName).toBe("The Shape");
		});
	});

	describe("maskedName", () => {
		it("is null when not concealed", () => {
			expect(makeChallenge().maskedName).toBeNull();
		});

		it("returns the alias for a non-owner player when concealed", () => {
			const model = makeChallenge({ concealName: true, alias: "The Shape" });
			expect(model.maskedName).toBe("The Shape");
		});

		it("is null for the GM", () => {
			game.user.isGM = true;
			const model = makeChallenge({ concealName: true, alias: "The Shape" });
			expect(model.maskedName).toBeNull();
		});

		it("is null for an owner", () => {
			const model = makeChallenge({
				concealName: true,
				alias: "The Shape",
				isOwner: true,
			});
			expect(model.maskedName).toBeNull();
		});
	});
});
