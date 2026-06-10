// Builders for fake Foundry documents in unit tests.
//
// Conventions:
// - Actors expose allApplicableEffects() — own + embedded items' effects (we
//   treat item effects as transferred for simplicity; tests can opt out by
//   passing `transfer: false` on the item).
// - All async-ish doc methods (createEmbeddedDocuments, updateEmbeddedDocuments,
//   deleteEmbeddedDocuments) are vi.fn() so assertions can inspect calls.
// - Effects carry a back-reference to their parent so resolveEffect /
//   updateEffectsByParent can route correctly.

import { vi } from "vitest";

let _id = 0;
const nextId = (prefix) => `${prefix}-${++_id}`;

export function fakeEffect({
	id = nextId("effect"),
	name = "tag",
	type = "story_tag",
	system = {},
	disabled = false,
	parent = null,
} = {}) {
	const effect = {
		_id: id,
		id,
		uuid: `Effect.${id}`,
		name,
		type,
		system,
		disabled,
		parent,
		update: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	};
	return effect;
}

export function fakeItem({
	id = nextId("item"),
	name = "item",
	type = "theme",
	effects = [],
	transfer = true,
	parent = null,
} = {}) {
	const item = {
		_id: id,
		id,
		uuid: `Item.${id}`,
		name,
		type,
		effects,
		parent,
		_transfer: transfer,
		update: vi.fn().mockResolvedValue(undefined),
		createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	};
	for (const e of effects) e.parent = item;
	return item;
}

export function fakeActor({
	id = nextId("actor"),
	name = "actor",
	type = "hero",
	effects = [],
	items = [],
	system = {},
	isOwner = true,
} = {}) {
	const actor = {
		_id: id,
		id,
		uuid: `Actor.${id}`,
		name,
		type,
		effects,
		items,
		system,
		isOwner,
		update: vi.fn().mockResolvedValue(undefined),
		createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		*allApplicableEffects() {
			for (const e of this.effects) yield e;
			for (const item of this.items) {
				if (item._transfer === false) continue;
				for (const e of item.effects) yield e;
			}
		},
	};
	for (const e of effects) e.parent = actor;
	for (const item of items) item.parent = actor;
	return actor;
}
