import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderModerationTooltip } from "../modules/apps/roll/moderation-render.js";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { executeRoll } from "../modules/apps/roll/roll-pipeline.js";
import { normalizeConfig } from "../modules/apps/story-tags/story-tag-helpers.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";

const secret = {
	uuid: "Actor.hidden.ActiveEffect.secret",
	name: "The king is a vampire",
	type: "status_tag",
	state: "negative",
	value: 4,
};
let config;
let source;
let render;

beforeEach(() => {
	vi.restoreAllMocks();
	game.user.isGM = false;
	game.users.filter = () => [];
	config = { actors: ["Actor.hidden"], hiddenActors: ["Actor.hidden"] };
	source = { id: "hidden", documentName: "Actor" };
	game.settings.get.mockImplementation((_scope, key) =>
		key === "storytags" ? config : undefined,
	);
	foundry.utils.parseUuid = (uuid) => ({
		collection: "Actor",
		type: uuid?.startsWith("Actor.") ? "Actor" : null,
	});
	foundry.utils.fromUuidSync.mockImplementation((uuid) =>
		uuid === "Actor.hidden"
			? source
			: uuid === secret.uuid && source
				? { parent: source }
				: null,
	);
	render = vi
		.spyOn(foundry.applications.handlebars, "renderTemplate")
		.mockImplementation(async (_path, data) => JSON.stringify(data));
	foundry.documents.ChatMessage.create.mockClear();
	StoryTagsStore.invalidateCache();
});

function tooltipFor(options) {
	const roll = new LitmRoll();
	roll.options = options;
	Object.defineProperty(roll, "outcome", { value: { label: "success" } });
	return roll.getTooltipData();
}

describe("roll concealment across persisted and rendered paths", () => {
	it("does not discard concealment when a sidebar column is removed", () => {
		config.actors = [];
		expect(normalizeConfig(config).config.hiddenActors).toEqual([
			"Actor.hidden",
		]);
		expect(StoryTagsStore.concealedActorIds.has("hidden")).toBe(true);
		source = null;
		StoryTagsStore.invalidateCache();
		expect(StoryTagsStore.concealedActorIds.has("hidden")).toBe(true);
		game.user.isGM = true;
		expect(StoryTagsStore.concealedActorIds.size).toBe(0);
		expect(StoryTagsStore.hiddenActorIds.has("hidden")).toBe(true);
	});

	it("records metadata in executeRoll and keeps historical tooltips masked after removal/deletion", async () => {
		let options;
		game.user.isGM = true;
		game.litmv2 = {
			LitmRoll: class {
				constructor(_formula, _data, opts) {
					options = opts;
				}
				toMessage() {
					return Promise.resolve({ rolls: [] });
				}
			},
		};
		game.actors.get.mockReturnValue(null);
		CONFIG.litmv2 = { roll: {} };
		await executeRoll({ actorId: "hero", tags: [secret], type: "quick" });
		expect(options.negativeStatuses[0]).toMatchObject({
			name: secret.name,
			concealedAtRoll: true,
			tagActorId: "hidden",
			value: 4,
		});
		config = { actors: [], hiddenActors: [] };
		source = null;
		StoryTagsStore.invalidateCache();
		game.user.isGM = false;
		const stored = JSON.parse(JSON.stringify(options));
		expect(tooltipFor(stored).negativeStatuses[0]).toMatchObject({
			name: "LITM.Ui.roll_concealed_tag",
			value: 4,
		});
		game.user.isGM = true;
		expect(tooltipFor(stored).negativeStatuses[0].name).toBe(secret.name);
		expect(secret.concealedAtRoll).toBeUndefined();
	});

	it.each([
		false,
		true,
	])("stores masked HTML with raw flags (GM: %s)", async (isGM) => {
		game.user.isGM = isGM;
		await LitmRollDialog.prototype._createModerationRequest.call(
			{
				actor: { id: "hero", name: "Hero" },
			},
			{ type: "quick", actorId: "hero", tags: [secret] },
		);
		const message = foundry.documents.ChatMessage.create.mock.calls[0][0];
		expect(message.content).not.toContain(secret.name);
		expect(message.content).toContain("LITM.Ui.roll_concealed_tag");
		expect(message.flags.litmv2.data.tags[0]).toMatchObject({
			name: secret.name,
			value: 4,
			concealedAtRoll: true,
		});
	});

	it.each([
		false,
		true,
	])("replaces legacy tooltip per viewer (GM: %s)", async (isGM) => {
		game.user.isGM = isGM;
		const tooltip = { replaceChildren: vi.fn(), outerHTML: secret.name };
		const element = {
			querySelector: (selector) =>
				selector === ".dice-tooltip" ? tooltip : {},
		};
		const pending = renderModerationTooltip(
			{
				getFlag: () => ({ tags: [secret], type: "quick" }),
			},
			element,
		);
		expect(tooltip.replaceChildren).toHaveBeenCalledOnce();
		await pending;
		expect(tooltip.outerHTML.includes(secret.name)).toBe(isGM);
		expect(render.mock.calls[0][1].data.negativeStatuses[0].value).toBe(4);
	});

	it("fails closed for legacy missing actor sources but not scene tags", () => {
		source = null;
		config = { actors: [], hiddenActors: [] };
		const data = tooltipFor({
			negativeStatuses: [secret],
			powerTags: [{ uuid: "Compendium.scene.tags.tag", name: "Rain" }],
		});
		expect(data.negativeStatuses[0].name).toBe("LITM.Ui.roll_concealed_tag");
		expect(data.powerTags[0].name).toBe("Rain");
	});

	it("allows an explicit reveal of a live source to unmask historical cards", () => {
		const tags = LitmRoll.captureConcealment([secret]);
		config.hiddenActors = [];
		StoryTagsStore.invalidateCache();
		expect(
			tooltipFor({ negativeStatuses: tags }).negativeStatuses[0].name,
		).toBe(secret.name);
	});

	it("uses the safe moderation path for mandatory approval", async () => {
		const dialog = {
			isOwner: true,
			requiresApproval: true,
			actor: { id: "hero", name: "Hero" },
			painfulSacrificeHasNoTarget: () => false,
			extractRollData: () => ({ type: "quick", tags: [secret] }),
			suspendForModeration: vi.fn(),
			_createModerationRequest:
				LitmRollDialog.prototype._createModerationRequest,
		};
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});
		const message = foundry.documents.ChatMessage.create.mock.calls[0][0];
		expect(message.content).not.toContain(secret.name);
		expect(message.flags.litmv2.data.tags[0].name).toBe(secret.name);
	});

	it("follows actor policy even after an individual effect is consumed", () => {
		const tags = LitmRoll.captureConcealment([secret]);
		foundry.utils.fromUuidSync.mockImplementation((uuid) =>
			uuid === "Actor.hidden" ? source : null,
		);
		config.actors = [];
		StoryTagsStore.invalidateCache();
		expect(
			tooltipFor({ negativeStatuses: tags }).negativeStatuses[0].name,
		).toBe("LITM.Ui.roll_concealed_tag");
		config.hiddenActors = [];
		expect(
			tooltipFor({ negativeStatuses: tags }).negativeStatuses[0].name,
		).toBe(secret.name);
	});

	it.each([
		"scratchedTags",
		"powerTags",
		"weaknessTags",
		"positiveStatuses",
		"negativeStatuses",
	])("projects %s without changing raw identities or magnitude", (bucket) => {
		const raw = { [bucket]: LitmRoll.captureConcealment([secret]) };
		expect(tooltipFor(raw)[bucket][0]).toMatchObject({
			name: "LITM.Ui.roll_concealed_tag",
			value: 4,
		});
		expect(raw[bucket][0].name).toBe(secret.name);
		game.user.isGM = true;
		expect(tooltipFor(raw)[bucket][0].name).toBe(secret.name);
	});
});
