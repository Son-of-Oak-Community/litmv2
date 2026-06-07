import { describe, expect, it } from "vitest";
import { proseChipsHtml } from "../modules/system/renderers/renderer-utils.js";

// proseChipsHtml turns bracket markup into colored chips for the Action
// Grimoire embed card and chat-card success panel, via the canonical
// tagChipHtml builder (shared with the text enricher). Non-markup text is
// HTML-escaped to keep authored prose safe in DOM.

describe("proseChipsHtml", () => {
	it("returns empty string for null/empty input", () => {
		expect(proseChipsHtml("")).toBe("");
		expect(proseChipsHtml(null)).toBe("");
		expect(proseChipsHtml(undefined)).toBe("");
	});

	it("escapes plain prose with no markup", () => {
		expect(proseChipsHtml("Find a path <here>")).toBe(
			"Find a path &lt;here&gt;",
		);
	});

	it("renders [name] as a yellow tag chip", () => {
		const html = proseChipsHtml("Get a [map].");
		expect(html).toContain('class="litm-tag"');
		expect(html).toContain(">map<");
		expect(html).not.toContain("litm--single-use");
		expect(html.startsWith("Get a ")).toBe(true);
		expect(html.endsWith(".")).toBe(true);
	});

	it("renders [name!] as a single-use tag chip with marker", () => {
		const html = proseChipsHtml("Stash a [smoke bomb!].");
		expect(html).toContain('class="litm-tag litm--single-use"');
		// Display label gets the marker glyph appended.
		expect(html).toContain("smoke bomb ✱");
		// data-text stays clean (no marker) — it doubles as the CSS stroke
		// underlay; the dragstart handler reads litm--single-use instead.
		expect(html).toContain('data-text="smoke bomb"');
	});

	it("renders [name-N] as a green status chip with tier", () => {
		const html = proseChipsHtml("Inflict [wounded-2].");
		expect(html).toContain('class="litm-status"');
		expect(html).toContain(">wounded-2<");
		// data-text carries the tier so drags re-parse as a status.
		expect(html).toContain('data-text="wounded-2"');
	});

	it("renders [name-] as a variable-tier status chip without tier suffix", () => {
		const html = proseChipsHtml("Cause [bleeding-]");
		expect(html).toContain('class="litm-status litm--variable-tier"');
		expect(html).toContain(">bleeding<");
		expect(html).not.toContain("?");
	});

	it("renders [name:N] as a limit chip with the max badge", () => {
		const html = proseChipsHtml("Track [Suspicion:3]");
		expect(html).toContain('class="litm-limit"');
		expect(html).toContain('data-text="Suspicion"');
		expect(html).toContain(">3</span>");
		// The max also travels as data-value so the dragstart handler can
		// rebuild the full limit payload (data-text stays the bare name).
		expect(html).toContain('data-value="3"');
	});

	it("renders an out-of-range tier as a variable-tier chip", () => {
		// [guard-7] has no mechanical tier (classify clamps to 0), so the chip
		// must not pretend to be a definite "guard-7" status.
		const html = proseChipsHtml("Post a [guard-7]");
		expect(html).toContain('class="litm-status litm--variable-tier"');
		expect(html).toContain('data-text="guard"');
		expect(html).not.toContain("guard-7");
	});

	it("renders [-name] as a weakness chip with the dash stripped", () => {
		const html = proseChipsHtml("Carry [-Cowardly]");
		expect(html).toContain('class="litm-weakness_tag"');
		expect(html).toContain('data-text="Cowardly"');
		expect(html).not.toContain("-Cowardly");
	});

	it("renders multiple tokens in one string and preserves order", () => {
		const html = proseChipsHtml("Grant [aim] and [focused-1].");
		const aimIdx = html.indexOf(">aim<");
		const focusedIdx = html.indexOf(">focused-1<");
		expect(aimIdx).toBeGreaterThan(-1);
		expect(focusedIdx).toBeGreaterThan(-1);
		expect(aimIdx).toBeLessThan(focusedIdx);
	});

	it("escapes special chars in tag names defensively", () => {
		const html = proseChipsHtml("Mark [<scary>]");
		// The regex's name char class excludes brackets, so `<scary>` is captured.
		// HTML chars must be escaped in both data-text and label.
		expect(html).toContain('data-text="&lt;scary&gt;"');
		expect(html).not.toContain("<scary>");
	});

	it("emits draggable spans (drag/drop compatibility with existing chip handling)", () => {
		const html = proseChipsHtml("[map]");
		expect(html).toContain('draggable="true"');
	});
});
