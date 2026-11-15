// A stand-in for the DOM node a handler reads, for the tests that run
// application code without a browser (there is no jsdom here).
//
// A test says which selectors resolve to what; every other selector finds
// nothing, as a node without that child would. Nothing here reads a global,
// so the module is safe to share between files.

import { vi } from "vitest";

/** `source` is a map from selector to result, or a function of the selector. */
const lookup = (source, fallback) => (selector) =>
	typeof source === "function"
		? source(selector)
		: (source[selector] ?? fallback);

/**
 * @param {object} [spec]
 * @param {Record<string, string>} [spec.dataset]  The node's `data-*` values.
 * @param {object|Function} [spec.one]  `querySelector`: selector → node (or null).
 * @param {object|Function} [spec.all]  `querySelectorAll`: selector → node[].
 * @param {object|Function} [spec.closest]  `closest`: selector → node (or null).
 * @param {...any} [spec.props]  Anything else (`value`, `checked`, `tagName`,
 *   `classList`, `innerHTML`, a `matches` function, ...) lands on the node as is.
 * @returns {object} The node. Its `listeners` array records every
 *   `addEventListener` call as `{ type, listener, options }`, and
 *   `emit(type, event)` runs the listeners registered for `type`.
 */
export function fakeElement({
	dataset = {},
	one = {},
	all = {},
	closest = {},
	...props
} = {}) {
	const listeners = [];
	return {
		dataset,
		...props,
		querySelector: lookup(one, null),
		querySelectorAll: lookup(all, []),
		closest: lookup(closest, null),
		addEventListener: vi.fn((type, listener, options) => {
			listeners.push({ type, listener, options });
		}),
		listeners,
		emit(type, event) {
			for (const entry of listeners) {
				if (entry.type === type) entry.listener(event);
			}
		},
	};
}
