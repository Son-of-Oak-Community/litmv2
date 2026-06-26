// Minimal Foundry shim for unit tests.
//
// The principle: stub only what gets touched at module-import time or by the
// code under test. Anything deeper (rendering, document CRUD, hooks dispatch)
// belongs in Quench/integration tests, not here.
//
// Grow this file when a new import fails — keep each stub as small as possible.

import { vi } from "vitest";

// --- String.prototype.slugify ---
// Faithful-enough port of Foundry's slugify for tests: lowercase, collapse
// whitespace/replacement runs to the replacement, and (strict) drop anything
// non-alphanumeric. The full Latin/Cyrillic CHAR_MAP is omitted — tests use
// ASCII names, which is all the status-effect dedup logic keys on.
if (!String.prototype.slugify) {
	Object.defineProperty(String.prototype, "slugify", {
		value: function ({
			replacement = "-",
			strict = false,
			lowercase = true,
		} = {}) {
			let slug = this.trim();
			if (lowercase) slug = slug.toLowerCase();
			slug = slug.replace(new RegExp(`[\\s${replacement}]+`, "g"), replacement);
			if (strict)
				slug = slug.replace(new RegExp(`[^a-zA-Z0-9${replacement}]`, "g"), "");
			return slug;
		},
	});
}

// --- foundry.utils ---
// Real enough setProperty for nested form-key parsing.
const setProperty = (obj, path, value) => {
	const parts = path.split(".");
	let cursor = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		if (cursor[key] == null || typeof cursor[key] !== "object") {
			cursor[key] = {};
		}
		cursor = cursor[key];
	}
	cursor[parts[parts.length - 1]] = value;
	return true;
};

const getProperty = (obj, path) => {
	if (!obj) return undefined;
	return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
};

const fromUuidSync = vi.fn(() => null);
const fromUuid = vi.fn(async () => null);

// --- foundry.data.* ---
// Just enough that `class Foo extends foundry.data.ActiveEffectTypeDataModel`
// parses. defineSchema is only called when Foundry boots; tests that hit
// static methods don't need real field types.
class StubDataModel {
	static defineSchema() {
		return {};
	}
	static migrateData(source) {
		return source;
	}
	constructor(source = {}) {
		Object.assign(this, source);
	}
	prepareDerivedData() {}
}

class StubField {
	constructor(options = {}) {
		this.options = options;
	}
}

// --- foundry.dice.Roll ---
// LitmRoll extends this. We never instantiate it in unit tests; we only call
// static methods like calculatePower, so an empty base class is fine.
class StubRoll {}

// --- foundry.documents.Actor ---
// LitmActor extends this. Mirrors core's allApplicableEffects (own effects +
// item effects gated on `effect.transfer`) so overrides that call
// `super.allApplicableEffects()` behave like the real document.
class StubActor {
	constructor(source = {}) {
		Object.assign(this, { effects: [], items: [], ...source });
	}
	*allApplicableEffects() {
		for (const effect of this.effects) yield effect;
		for (const item of this.items) {
			for (const effect of item.effects) {
				if (effect.transfer) yield effect;
			}
		}
	}
}

// --- foundry.applications.* ---
// Several utility modules transitively import ApplicationV2 / DialogV2 /
// HandlebarsApplicationMixin at module-load time. They never get rendered in
// unit tests, but their classes still have to *exist* for the imports to
// resolve. Stub classes + a passthrough mixin do the job.
class StubAppV2 {
	static DEFAULT_OPTIONS = {};
	static PARTS = {};
}
class StubDialogV2 extends StubAppV2 {
	static confirm = () => Promise.resolve(false);
	static prompt = () => Promise.resolve(null);
	static input = () => Promise.resolve(null);
}
const HandlebarsApplicationMixin = (Base) =>
	class extends Base {
		static PARTS = {};
	};

let randomIdCounter = 0;
const randomID = () => `test-id-${++randomIdCounter}`;

const HTML_ESCAPE = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);

globalThis.foundry = {
	utils: {
		setProperty,
		getProperty,
		fromUuid,
		fromUuidSync,
		randomID,
		escapeHTML,
		deepClone: (v) => (v === undefined ? v : structuredClone(v)),
		isEmpty: (v) =>
			v == null || (typeof v === "object" && Object.keys(v).length === 0),
	},
	abstract: { TypeDataModel: StubDataModel },
	data: {
		ActiveEffectTypeDataModel: StubDataModel,
		TypeDataModel: StubDataModel,
		fields: {
			BooleanField: StubField,
			StringField: StubField,
			NumberField: StubField,
			ArrayField: StubField,
			SchemaField: StubField,
			ObjectField: StubField,
			HTMLField: StubField,
			DocumentIdField: StubField,
		},
		validation: {
			DataModelValidationError: class extends Error {},
		},
		operators: {
			ForcedDeletion: class {},
		},
	},
	dice: { Roll: StubRoll },
	documents: { Actor: StubActor },
	applications: {
		api: {
			ApplicationV2: StubAppV2,
			DialogV2: StubDialogV2,
			HandlebarsApplicationMixin,
		},
		sheets: {
			ActorSheetV2: StubAppV2,
			ItemSheetV2: StubAppV2,
		},
		handlebars: {
			renderTemplate: () => Promise.resolve(""),
		},
	},
};

// --- game (i18n, settings — passthroughs) ---
globalThis.game = {
	i18n: {
		localize: (key) => key,
		format: (key, data = {}) =>
			Object.entries(data).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key),
		has: () => true,
	},
	settings: {
		get: vi.fn(),
		set: vi.fn(),
		register: vi.fn(),
	},
	actors: { get: vi.fn() },
	user: { isGM: false },
};

// --- Hooks (no-op) ---
globalThis.Hooks = {
	on: vi.fn(),
	once: vi.fn(),
	off: vi.fn(),
	call: vi.fn(() => true),
	callAll: vi.fn(),
};

// --- ui (notifications) ---
// chat-actions, addStoryTagToActor, and several apps surface user-facing
// warnings/info through ui.notifications. Tests assert on these calls.
globalThis.ui = {
	notifications: {
		warn: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
};

// --- CONFIG (minimal) ---
globalThis.CONFIG = {
	Actor: {},
	Item: {},
	ActiveEffect: {},
	litmv2: {
		tagStringRe: null,
		roll: { formula: null, resolver: null },
		improveThreshold: 3,
	},
};
