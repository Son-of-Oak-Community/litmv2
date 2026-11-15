// World settings, for the tests that read them through `game.settings.get`.
//
// setup.js hands every test file a fresh `game.settings.get` mock, so what a
// test stubs here never outlives its file; a file that stubs per test calls
// this again in `beforeEach`.

/**
 * Make `game.settings.get(scope, key)` answer from `source`: a map of
 * key → value, or a function of the key (for a value the test changes later).
 * A key the source does not answer (undefined) gets `fallback`; null and false
 * are answers.
 */
export function stubSettings(source = {}, { fallback } = {}) {
	game.settings.get.mockImplementation((_scope, key) => {
		const value = typeof source === "function" ? source(key) : source[key];
		return value === undefined ? fallback : value;
	});
}
