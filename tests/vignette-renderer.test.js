import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	renderVignette,
	vignetteCard,
} from "../modules/system/renderers/vignette-renderer.js";

// Regression coverage for GH#94: a vignette description stored as HTML (e.g.
// "<p>With an eerie smile…</p>" pasted in from rules text) was being assigned
// via textContent and rendered as a literal string. The renderer now routes
// threat and consequence text through enrichHTML and assigns the result as
// innerHTML, so HTML markup survives as DOM rather than escaped text.

// --- Minimal element stub ---
// Vitest runs under `environment: "node"` (see vitest.config.js), so there's
// no DOM. The renderer only uses createElement, classList.add, appendChild,
// textContent, and innerHTML — a tiny stub covers it without bringing in
// jsdom or happy-dom.
class StubEl {
	constructor(tag) {
		this.tagName = tag.toLowerCase();
		this.children = [];
		this.classes = new Set();
		this.classList = {
			add: (...c) => c.forEach((x) => this.classes.add(x)),
			contains: (c) => this.classes.has(c),
		};
		this.textContent = "";
		this.innerHTML = "";
	}
	appendChild(child) {
		this.children.push(child);
		return child;
	}
	find(tag, cls) {
		for (const c of this.children) {
			if (
				c.tagName === tag &&
				(cls == null || c.classes.has(cls))
			) {
				return c;
			}
			const nested = c.find?.(tag, cls);
			if (nested) return nested;
		}
		return null;
	}
	findAll(tag, cls) {
		const out = [];
		for (const c of this.children) {
			if (
				c.tagName === tag &&
				(cls == null || c.classes.has(cls))
			) {
				out.push(c);
			}
			if (c.findAll) out.push(...c.findAll(tag, cls));
		}
		return out;
	}
}

const enrichHTML = vi.fn();
let prevDocument;
let prevUx;

beforeEach(() => {
	enrichHTML.mockReset();
	// Default: passthrough — return the input verbatim so HTML markup survives.
	enrichHTML.mockImplementation(async (text) => text ?? "");

	prevUx = foundry.applications.ux;
	foundry.applications.ux = { TextEditor: { enrichHTML } };

	prevDocument = globalThis.document;
	globalThis.document = { createElement: (tag) => new StubEl(tag) };
});

afterEach(() => {
	foundry.applications.ux = prevUx;
	globalThis.document = prevDocument;
});

function ownerDoc() {
	return { isOwner: true };
}

describe("vignetteCard", () => {
	it("renders threat HTML via innerHTML, not as escaped textContent (GH#94)", async () => {
		const card = await vignetteCard({
			label: "Spectre",
			threat: "<p>With an eerie smile, the ghost beckons.</p>",
			relativeTo: ownerDoc(),
		});

		const threat = card.find("div", "threat-text");
		expect(threat).not.toBeNull();
		// HTML lands in innerHTML — that's what lets the browser parse <p>.
		expect(threat.innerHTML).toBe(
			"<p>With an eerie smile, the ghost beckons.</p>",
		);
		// And nothing has been assigned via textContent (that's the bug).
		expect(threat.textContent).toBe("");
	});

	it("renders each consequence's HTML via innerHTML (GH#94)", async () => {
		const card = await vignetteCard({
			label: "Spectre",
			consequences: [
				"<p>You are <strong>haunted</strong>.</p>",
				"<p>The temperature drops.</p>",
			],
			relativeTo: ownerDoc(),
		});

		const items = card.findAll("li", "consequence-item");
		expect(items).toHaveLength(2);
		expect(items[0].innerHTML).toBe(
			"<p>You are <strong>haunted</strong>.</p>",
		);
		expect(items[1].innerHTML).toBe("<p>The temperature drops.</p>");
		for (const li of items) {
			expect(li.textContent).toBe("");
		}
	});

	it("passes the relativeTo document through to enrichHTML", async () => {
		const doc = ownerDoc();
		await vignetteCard({
			label: "Spectre",
			threat: "boo",
			consequences: ["chill", "dread"],
			relativeTo: doc,
		});

		// One call for threat, one per consequence.
		expect(enrichHTML).toHaveBeenCalledTimes(3);
		for (const call of enrichHTML.mock.calls) {
			expect(call[1]).toMatchObject({ relativeTo: doc });
		}
	});

	it("skips threat rendering when isConsequenceOnly is true", async () => {
		const card = await vignetteCard({
			label: "Spectre",
			threat: "<p>Should not appear</p>",
			consequences: ["<p>Only this</p>"],
			isConsequenceOnly: true,
			relativeTo: ownerDoc(),
		});

		expect(card.find("div", "threat-text")).toBeNull();
		expect(card.find("li", "consequence-item")).not.toBeNull();
		// enrichHTML must not have been called for the suppressed threat text.
		const enrichedTexts = enrichHTML.mock.calls.map(([t]) => t);
		expect(enrichedTexts).not.toContain("<p>Should not appear</p>");
	});

	it("uses the banner label as plain text (no enrichment)", async () => {
		const card = await vignetteCard({
			label: "<script>x</script>",
			relativeTo: ownerDoc(),
		});

		const legend = card.find("legend", "litm-banner");
		expect(legend).not.toBeNull();
		// textContent path — the browser would escape this. Label is not
		// expected to be a rich-text field and shouldn't be enriched.
		expect(legend.textContent).toBe("<script>x</script>");
		expect(legend.innerHTML).toBe("");
	});
});

describe("renderVignette", () => {
	it("defaults relativeTo to the item itself", async () => {
		const item = {
			name: "Spectre",
			isOwner: true,
			system: {
				threat: "<em>spooky</em>",
				consequences: [],
				isConsequenceOnly: false,
			},
		};

		await renderVignette(item);

		expect(enrichHTML).toHaveBeenCalledWith(
			"<em>spooky</em>",
			expect.objectContaining({ relativeTo: item }),
		);
	});

	it("honors an explicit relativeTo for mock-shaped items (addonThreats)", async () => {
		const mockItem = {
			name: "Mock",
			system: {
				threat: "<em>spooky</em>",
				consequences: [],
				isConsequenceOnly: false,
			},
		};
		const actor = ownerDoc();

		await renderVignette(mockItem, actor);

		expect(enrichHTML).toHaveBeenCalledWith(
			"<em>spooky</em>",
			expect.objectContaining({ relativeTo: actor }),
		);
	});
});
