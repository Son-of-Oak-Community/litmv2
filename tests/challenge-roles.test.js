import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChallengeData } from "../modules/actor/challenge/challenge-data.js";
import { ChallengeSheet } from "../modules/actor/challenge/challenge-sheet.js";

// Typical Challenge Roles (Core Book p.110). The field keeps its old
// comma-separated string: book roles as keys, custom ones as typed.
describe("Challenge roles", () => {
	beforeEach(() => {
		CONFIG.litmv2.challengeRoles = ["mystery", "pursuer", "quarry"];
	});
	afterEach(() => {
		delete CONFIG.litmv2.challengeRoles;
	});

	it("reads older typed text as the book role it names", () => {
		expect(ChallengeData.parseRoles(" Quarry, mystery ")).toEqual([
			"quarry",
			"mystery",
		]);
	});

	it("reads a role typed by its translated name as the book role", () => {
		const localize = game.i18n.localize;
		game.i18n.localize = (key) =>
			key === "LITM.ChallengeRoles.quarry" ? "Здобич" : key;
		try {
			expect(ChallengeData.parseRoles("здобич, Rival")).toEqual([
				"quarry",
				"Rival",
			]);
		} finally {
			game.i18n.localize = localize;
		}
	});

	it("keeps a custom role as typed and drops repeats", () => {
		expect(
			ChallengeData.parseRoles("Rival, pursuer, rival, Pursuer,,"),
		).toEqual(["Rival", "pursuer"]);
	});

	it("derives each role once with addon categories, keeping keys", () => {
		expect(
			ChallengeData.deriveRoles("quarry,Rival", ["Pursuer", "rival"]),
		).toEqual([
			{ role: "pursuer", label: "LITM.ChallengeRoles.pursuer" },
			{ role: "quarry", label: "LITM.ChallengeRoles.quarry" },
			{ role: "Rival", label: "Rival" },
		]);
	});

	describe("saving from the picker", () => {
		const pill = (role, checked) => ({ dataset: { role }, checked });
		const form = {
			querySelectorAll: () => [
				pill("quarry", true),
				pill("mystery", false),
				pill("Rival", true),
			],
		};

		it("stores the checked pills plus the typed custom role", () => {
			expect(
				ChallengeSheet.rolesFromForm(form, { dataset: { role: "quarry" } }),
			).toBe("quarry,Rival");
			expect(
				ChallengeSheet.rolesFromForm(
					form,
					{ name: "customRole", dataset: {} },
					"Pursuer",
				),
			).toBe("quarry,Rival,pursuer");
		});

		it("leaves the roles alone when another field changed", () => {
			expect(
				ChallengeSheet.rolesFromForm(form, { name: "name", dataset: {} }),
			).toBeNull();
			expect(ChallengeSheet.rolesFromForm(form, null)).toBeNull();
		});
	});

	it("calls the edit header stale once it no longer shows the saved data", () => {
		const header = (stars, roles) => ({
			querySelectorAll: (sel) =>
				sel.startsWith(".litm--rating-star")
					? Array(stars).fill({})
					: roles.map((role) => ({ dataset: { role } })),
		});
		const saved = { rating: 2, category: "Quarry,Rival" };
		expect(
			ChallengeSheet.headerIsStale(header(2, ["Rival", "quarry"]), saved),
		).toBe(false);
		// Another GM added a role, or a star was clicked.
		expect(ChallengeSheet.headerIsStale(header(2, ["quarry"]), saved)).toBe(
			true,
		);
		expect(
			ChallengeSheet.headerIsStale(header(3, ["quarry", "Rival"]), saved),
		).toBe(true);
	});

	it("labels a book role through its key and a custom one as typed", () => {
		expect(ChallengeData.roleLabel("quarry")).toBe(
			"LITM.ChallengeRoles.quarry",
		);
		expect(ChallengeData.roleLabel("Rival")).toBe("Rival");
	});
});
