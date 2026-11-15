import { defineConfig } from "vitest/config";

const isolatedTests = [
	"tests/camping-hud.test.js",
	"tests/camping-scene.test.js",
	"tests/call-for-roll-resolve-action.test.js",
	"tests/chat-actions-dispatch.test.js",
	"tests/enrichment-escaping.test.js",
	"tests/gain-improvement-relay.test.js",
	"tests/hero-sheet-roll-initiation.test.js",
	"tests/html-escaping.test.js",
	"tests/legacy-import.test.js",
	"tests/post-roll-scratch-relay.test.js",
	"tests/roll-dialog-hud.test.js",
	"tests/roll-submit-close.test.js",
	"tests/spend-power-parse-uuid.test.js",
	"tests/spend-power-scratch-single-use.test.js",
	"tests/spend-power-service-partial.test.js",
	"tests/spend-power-service-recover.test.js",
	"tests/spend-power-service-spent-flag.test.js",
	"tests/spend-power-service-status.test.js",
	"tests/spend-power-service-success.test.js",
	"tests/spend-power-service-tier-clamp.test.js",
	"tests/spend-power-service-unlinked.test.js",
	"tests/spend-power-tier-cap.test.js",
	"tests/spend-power-typed-syntax.test.js",
	"tests/tag-string-sync-enrich.test.js",
	"tests/tours-roll-preview.test.js",
	"tests/unpaid-sacrifice.test.js",
];

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "shared",
					environment: "node",
					exclude: isolatedTests,
					include: ["tests/**/*.test.js"],
					isolate: false,
					setupFiles: ["tests/setup.js"],
				},
			},
			{
				test: {
					name: "isolated",
					environment: "node",
					include: isolatedTests,
					setupFiles: ["tests/setup.js"],
				},
			},
		],
	},
});
