import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

/**
 * Most test files share one module graph per worker (`isolate: false`),
 * which is where the suite's speed comes from. A file runs isolated when it
 * would leak into the files after it:
 * - it swaps modules out (`vi.mock`, `vi.doMock`, `vi.unmock`,
 *   `vi.resetModules`), detected here; or
 * - it relies on module state a shared file may already have set, or patches
 *   a shared prototype. Such a file says so with a comment naming the reason:
 *   `// vitest-isolate: <why>`.
 * New files are sorted automatically; there is no list to keep.
 */
const ISOLATE =
	/\bvi\.(?:mock|doMock|unmock|resetModules)\(|\/\/\s*vitest-isolate:/;

const isolatedTests = readdirSync("tests", { recursive: true })
	.filter((name) => name.endsWith(".test.js"))
	.map((name) => `tests/${name}`)
	.filter((path) => ISOLATE.test(readFileSync(path, "utf8")))
	.sort();

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "shared",
					environment: "node",
					include: ["tests/**/*.test.js"],
					exclude: ["**/node_modules/**", ...isolatedTests],
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
