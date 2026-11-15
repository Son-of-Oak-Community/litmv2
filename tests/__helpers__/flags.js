// Documents that keep flags, for the tests that read or write them.
//
// A real flag store round-trips through the database, so a value is cloned
// when it is written: a test that later mutates what it passed in does not
// change what was "saved".

import { vi } from "vitest";

/**
 * Back `doc`'s getFlag, setFlag and unsetFlag with `doc.flags`
 * (`{ [scope]: { [key]: value } }`), the shape Foundry stores them in.
 * The three methods are mocks; setFlag and unsetFlag resolve to the document.
 * @returns {object} `doc`
 */
export function withFlags(doc, flags = {}) {
	doc.flags = structuredClone(flags);
	doc.getFlag = vi.fn((scope, key) => doc.flags[scope]?.[key]);
	doc.setFlag = vi.fn(async (scope, key, value) => {
		doc.flags[scope] ??= {};
		doc.flags[scope][key] = structuredClone(value);
		return doc;
	});
	doc.unsetFlag = vi.fn(async (scope, key) => {
		delete doc.flags[scope]?.[key];
		return doc;
	});
	return doc;
}
