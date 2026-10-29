// Plain-text StringFields (theme special-improvement descriptions, action and
// vignette consequences, vignette threats) are authored in a textarea, but
// every sink renders the enriched result with a triple-stash. `enrichHTML`
// assigns its input to a detached div's innerHTML, so an `<img onerror>` fires
// during enrichment itself. These tests pin that the text is escaped *before*
// it reaches `TextEditor.enrichHTML`, while the bracket chip markup survives.
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ApplyActionMenuApp } from "../modules/apps/apply-action-menu.js";
import { LitmActorSheet } from "../modules/sheets/base-actor-sheet.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { enrichPlainText } from "../modules/utils.js";

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

const mocks = vi.hoisted(() => ({ tracked: [] }));
vi.mock("../modules/apps/story-tags/story-tags-store.js", () => ({
	StoryTagsStore: { resolveTrackedActors: () => mocks.tracked },
}));
vi.mock("../modules/apps/target-picker.js", () => ({
	getTargetCandidates: () => [],
}));

/** The classic stored-XSS payload a player can type into a textarea. */
const PAYLOAD = `<img src=x onerror="alert(1)">`;

/** Every string handed to `TextEditor.enrichHTML`. */
let enriched;

beforeAll(() => {
	Object.defineProperty(CONFIG.litmv2, "tagStringRe", {
		configurable: true,
		get: () => makeTagStringRe(),
	});
});

beforeEach(() => {
	enriched = [];
	foundry.applications.ux = {
		TextEditor: {
			enrichHTML: vi.fn(async (text) => {
				enriched.push(text);
				return text;
			}),
		},
	};
});

afterEach(() => {
	delete foundry.applications.ux;
	mocks.tracked = [];
});

const expectEscaped = (html) => {
	expect(html).not.toContain("<img");
	expect(html).toContain("&lt;img");
};

describe("theme special improvements escape their description before enrichment", () => {
	const prepare = (improvements, { edit = false, themebook = null } = {}) => {
		game.items = { find: vi.fn(() => themebook) };
		const sheet = { document: { isOwner: true }, _isEditMode: edit };
		const themeContext = {
			system: { themebook: themebook?.name, specialImprovements: improvements },
		};
		return LitmActorSheet.prototype._prepareThemeImprovements
			.call(sheet, themeContext)
			.then(() => themeContext.system.specialImprovements);
	};

	it("escapes an active improvement's description", async () => {
		const [imp] = await prepare([
			{ name: "Sly", description: PAYLOAD, isActive: true },
		]);
		expectEscaped(imp.enrichedDescription);
		expectEscaped(enriched[0]);
	});

	it("escapes a locked themebook preview's description", async () => {
		const themebook = {
			name: "Fire",
			type: "themebook",
			system: {
				specialImprovements: [{ name: "Ember", description: PAYLOAD }],
			},
		};
		const result = await prepare([], { edit: true, themebook });
		const locked = result.find((imp) => imp.isLocked);
		expectEscaped(locked.enrichedDescription);
	});

	it("leaves bracket chip markup intact for the enrichers", async () => {
		const [imp] = await prepare([
			{
				name: "Sly",
				description: "Gain [swift!] or [shaken-3].",
				isActive: true,
			},
		]);
		expect(imp.enrichedDescription).toBe("Gain [swift!] or [shaken-3].");
	});

	it("passes an empty description through as empty", async () => {
		const [imp] = await prepare([{ name: "Sly", isActive: true }]);
		expect(imp.enrichedDescription).toBe("");
		expect(
			foundry.applications.ux.TextEditor.enrichHTML,
		).not.toHaveBeenCalled();
	});
});

describe("apply-action menu escapes consequence text before enrichment", () => {
	const prepare = ({ consequences = [], vignettes = [] } = {}) => {
		const message = {
			getFlag: vi.fn(() => []),
			rolls: [],
			speaker: {},
		};
		const action = {
			name: "Cross the Ford",
			system: { consequences },
		};
		if (vignettes.length) {
			mocks.tracked = [
				{
					actor: {
						type: "challenge",
						name: "River",
						system: { publicName: "River" },
						items: vignettes,
					},
				},
			];
		}
		const app = {
			_getMessage: () => message,
			_getAction: async () => action,
		};
		return ApplyActionMenuApp.prototype._prepareContext.call(app, {});
	};

	it("escapes an action consequence", async () => {
		const ctx = await prepare({ consequences: [PAYLOAD] });
		expectEscaped(ctx.items[0].text);
		expectEscaped(enriched[0]);
	});

	it("escapes a contributed vignette consequence and its threat", async () => {
		const ctx = await prepare({
			vignettes: [
				{
					type: "vignette",
					uuid: "Item.v1",
					name: "Flood",
					system: { threat: PAYLOAD, consequences: [PAYLOAD] },
				},
			],
		});
		const [vignette] = ctx.sources[0].vignettes;
		expectEscaped(vignette.items[0].text);
		expectEscaped(vignette.threat);
	});

	it("leaves bracket chip markup intact for the enrichers", async () => {
		const ctx = await prepare({
			consequences: ["Inflict [wounded-3], lose [rope!], gain [grit]."],
		});
		expect(ctx.items[0].text).toBe(
			"Inflict [wounded-3], lose [rope!], gain [grit].",
		);
	});

	it("still scans variable tiers from the raw text", async () => {
		const ctx = await prepare({ consequences: ["Heroes are [shaken-]"] });
		expect(ctx.items[0].varTokens).toEqual([{ idx: 0, name: "shaken" }]);
	});
});

describe("enrichPlainText", () => {
	const doc = { isOwner: true };

	it("hands the enrichers escaped text", async () => {
		const html = await enrichPlainText(`Watch out ${PAYLOAD}`, doc);
		expectEscaped(enriched[0]);
		expectEscaped(html);
	});

	it("keeps tag, status and link markup for the enrichers", async () => {
		await enrichPlainText("Inflict [wounded-3] on @UUID[Actor.abc]{Gerrin}", doc);
		expect(enriched[0]).toBe("Inflict [wounded-3] on @UUID[Actor.abc]{Gerrin}");
	});

	it("skips enrichment for empty text", async () => {
		expect(await enrichPlainText("", doc)).toBe("");
		expect(await enrichPlainText(undefined, doc)).toBe("");
		expect(enriched).toEqual([]);
	});
});
