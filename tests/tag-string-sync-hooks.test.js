import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagStringSyncMixin } from "../modules/sheets/tag-string-sync-mixin.js";

// In play mode a Challenge's or Journey's effects are canonical, and the
// sheet mirrors each change back into `system.tags`, the string edit mode
// saves. A change that misses the string is undone by the next mode switch.

const effect = (name, type, { tier = 0, isSingleUse = false, addon } = {}) => ({
	name,
	type,
	parent: null,
	system: {
		currentTier: tier,
		toTagString: (n) =>
			type === "status_tag"
				? `[${n}-${tier}]`
				: isSingleUse
					? `[${n}!]`
					: `[${n}]`,
	},
	getFlag: (_scope, key) => (key === "addonId" ? addon : undefined),
});

/** An open sheet on a Challenge whose tag string is `tags`. */
const openSheet = async (tags, { isOwner = true } = {}) => {
	const document = {
		isOwner,
		type: "challenge",
		// One effect already behind the string, so first render has nothing
		// to converge and the listeners are all that runs.
		effects: tags ? [{ type: "story_tag", getFlag: () => undefined }] : [],
		update: vi.fn(async () => {}),
	};
	const Sheet = TagStringSyncMixin(
		class {
			async _onFirstRender() {}
			_onClose() {}
		},
	);
	const sheet = new Sheet();
	sheet.document = document;
	sheet.system = { tags };
	await sheet._onFirstRender({}, {});
	const handler = (hook) =>
		Hooks.on.mock.calls.findLast(([name]) => name === hook)[1];
	const fire = (hook, fx) => handler(hook)({ ...fx, parent: document });
	return { sheet, document, fire, handler };
};

const written = (document) => document.update.mock.calls.at(-1)?.[0];

beforeEach(() => {
	Hooks.on.mockClear();
	Hooks.off.mockClear();
});

describe("TagStringSyncMixin: a status changes in play mode", () => {
	it("writes the new tier into the string", async () => {
		const { document, fire } = await openSheet("[wounded-1], [fog]");
		fire("updateActiveEffect", effect("wounded", "status_tag", { tier: 3 }));
		expect(written(document)).toEqual({
			"system.tags": "[wounded-3], [fog]",
		});
	});

	it("writes a tier onto a status typed without one", async () => {
		const { document, fire } = await openSheet("[wounded-], [fog]");
		fire("updateActiveEffect", effect("wounded", "status_tag", { tier: 2 }));
		expect(written(document)).toEqual({
			"system.tags": "[wounded-2], [fog]",
		});
	});

	it("leaves a limit of the same name as a limit", async () => {
		const { document, fire } = await openSheet("[storm:3], [storm-1]");
		fire("updateActiveEffect", effect("storm", "status_tag", { tier: 2 }));
		expect(written(document)).toEqual({
			"system.tags": "[storm:3], [storm-2]",
		});
	});

	it("writes nothing when the string already says so", async () => {
		const { document, fire } = await openSheet("[wounded-2]");
		fire("updateActiveEffect", effect("wounded", "status_tag", { tier: 2 }));
		expect(document.update).not.toHaveBeenCalled();
	});

	it("ignores a story tag's update", async () => {
		const { document, fire } = await openSheet("[fog]");
		fire("updateActiveEffect", effect("fog", "story_tag"));
		expect(document.update).not.toHaveBeenCalled();
	});
});

describe("TagStringSyncMixin: an effect is deleted in play mode", () => {
	it("takes a single-use story tag out of the string", async () => {
		const { document, fire } = await openSheet("[rope!], [fog]");
		fire("deleteActiveEffect", effect("rope", "story_tag"));
		expect(written(document)).toEqual({ "system.tags": "[fog]" });
	});

	it("takes a tier-less status out of the string", async () => {
		const { document, fire } = await openSheet("[fog], [wounded-]");
		fire("deleteActiveEffect", effect("wounded", "status_tag"));
		expect(written(document)).toEqual({ "system.tags": "[fog]" });
	});

	it("keeps a limit that shares the deleted story tag's name", async () => {
		const { document, fire } = await openSheet("[storm:3], [storm]");
		fire("deleteActiveEffect", effect("storm", "story_tag"));
		expect(written(document)).toEqual({ "system.tags": "[storm:3]" });
	});

	it("keeps a status that shares the deleted story tag's name", async () => {
		const { document, fire } = await openSheet("[storm], [storm-2]");
		fire("deleteActiveEffect", effect("storm", "story_tag"));
		expect(written(document)).toEqual({ "system.tags": "[storm-2]" });
	});

	it("leaves the string alone for an addon's effect", async () => {
		const { document, fire } = await openSheet("[fog]");
		fire("deleteActiveEffect", effect("fog", "story_tag", { addon: "a1" }));
		expect(document.update).not.toHaveBeenCalled();
	});
});

describe("TagStringSyncMixin: an effect is created in play mode", () => {
	it("appends its markup to the string", async () => {
		const { document, fire } = await openSheet("[fog]");
		fire(
			"createActiveEffect",
			effect("rope", "story_tag", { isSingleUse: true }),
		);
		expect(written(document)).toEqual({ "system.tags": "[fog], [rope!]" });
	});

	it("starts the string when it was empty", async () => {
		const { document, fire } = await openSheet("");
		fire("createActiveEffect", effect("hurt", "status_tag", { tier: 2 }));
		expect(written(document)).toEqual({ "system.tags": "[hurt-2]" });
	});

	it("leaves the string alone for an addon's effect", async () => {
		const { document, fire } = await openSheet("[fog]");
		fire("createActiveEffect", effect("bramble", "story_tag", { addon: "a1" }));
		expect(document.update).not.toHaveBeenCalled();
	});
});

describe("TagStringSyncMixin: whose change it mirrors", () => {
	it("ignores another document's effects", async () => {
		const { document, handler } = await openSheet("[fog]");
		for (const hook of [
			"createActiveEffect",
			"updateActiveEffect",
			"deleteActiveEffect",
		]) {
			handler(hook)({ ...effect("fog", "story_tag"), parent: {} });
		}
		expect(document.update).not.toHaveBeenCalled();
	});

	it("writes nothing on a client that does not own the document", async () => {
		const { document, fire } = await openSheet("[fog], [hurt-1]", {
			isOwner: false,
		});
		fire("createActiveEffect", effect("rope", "story_tag"));
		fire("updateActiveEffect", effect("hurt", "status_tag", { tier: 2 }));
		fire("deleteActiveEffect", effect("fog", "story_tag"));
		expect(document.update).not.toHaveBeenCalled();
	});

	it("drops its three listeners when the sheet closes", async () => {
		Hooks.on.mockImplementation((name) => `id-${name}`);
		try {
			const { sheet } = await openSheet("[fog]");
			sheet._onClose({});
			expect(Hooks.off.mock.calls).toEqual([
				["createActiveEffect", "id-createActiveEffect"],
				["updateActiveEffect", "id-updateActiveEffect"],
				["deleteActiveEffect", "id-deleteActiveEffect"],
			]);
		} finally {
			Hooks.on.mockReset();
		}
	});
});
