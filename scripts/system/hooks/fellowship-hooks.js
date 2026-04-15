import { localize as t } from "../../utils.js";
import { LitmSettings } from "../settings.js";
import { ACTOR_TYPES } from "../config.js";

export function registerFellowshipHooks() {
	_hideFromCreateDialog();

	if (!LitmSettings.useFellowship) return;

	_ensureFellowshipSingleton();
	_blockDuplicateFellowship();
	_blockFellowshipDeletion();
	_blockFellowshipAsCharacter();
	_autoLinkNewHeroes();
	_rerenderHeroSheetsOnFellowshipChange();
}

/**
 * On ready, ensure exactly one fellowship actor exists and its ID is stored.
 * Then auto-link all heroes to it. GM-only.
 *
 * NOTE: Foundry does NOT await async hook callbacks, so the hero-linking
 * logic lives here (after the awaits) rather than in a separate ready hook.
 */
function _ensureFellowshipSingleton() {
	Hooks.once("ready", async () => {
		if (!game.user.isGM) return;

		const storedId = LitmSettings.fellowshipId;
		const storedActor = storedId ? game.actors.get(storedId) : null;

		let fellowshipId;

		if (storedActor?.type === ACTOR_TYPES.fellowship) {
			// Stored ID is valid — nothing to create
			fellowshipId = storedId;
		} else {
			// Find existing fellowship actors (pick first match)
			const existing = game.actors.find((a) => a.type === ACTOR_TYPES.fellowship);

			if (existing) {
				fellowshipId = existing.id;
				await LitmSettings.setFellowshipId(fellowshipId);
			} else {
				// No fellowship exists — create one
				const actor = await foundry.documents.Actor.create(
					{
						name: t("LITM.Terms.fellowship"),
						type: ACTOR_TYPES.fellowship,
						ownership: {
							default: foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
						},
					},
					{ litm: { skipSingletonCheck: true } },
				);
				fellowshipId = actor.id;
				await LitmSettings.setFellowshipId(fellowshipId);
			}
		}

		// Auto-link all heroes with stale/missing fellowship links
		await _linkAllHeroes(fellowshipId);
	});
}

/**
 * Update all hero actors whose fellowshipId doesn't match the singleton.
 * @param {string} fellowshipId  The singleton fellowship actor ID
 */
async function _linkAllHeroes(fellowshipId) {
	if (!fellowshipId) return;

	const updates = game.actors
		.filter((a) => a.type === ACTOR_TYPES.hero && a.system.fellowshipId !== fellowshipId)
		.map((a) => ({
			_id: a.id,
			"system.fellowshipId": fellowshipId,
		}));

	if (updates.length > 0) {
		await foundry.documents.Actor.updateDocuments(updates);
	}
}

/**
 * Block creation of duplicate fellowship actors via any path (API, macro, etc.)
 */
function _blockDuplicateFellowship() {
	Hooks.on("preCreateActor", (actor, _data, options) => {
		if (actor.type !== ACTOR_TYPES.fellowship) return;
		if (options?.litm?.skipSingletonCheck) return;

		const existingId = LitmSettings.fellowshipId;
		const existing = existingId ? game.actors.get(existingId) : null;

		if (existing) {
			ui.notifications.warn(t("LITM.Ui.warn_fellowship_singleton"));
			return false;
		}
	});
}

/**
 * Prevent deletion of the singleton fellowship actor.
 * Pass option `{ litm: { forceDelete: true } }` to bypass.
 */
function _blockFellowshipDeletion() {
	Hooks.on("preDeleteActor", (actor, options) => {
		if (actor.type !== ACTOR_TYPES.fellowship) return;
		if (options?.litm?.forceDelete) return;

		const singletonId = LitmSettings.fellowshipId;
		if (actor.id === singletonId) {
			ui.notifications.warn(t("LITM.Ui.warn_fellowship_no_delete"));
			return false;
		}
	});
}

/**
 * Prevent assigning the fellowship actor as a user's character.
 */
function _blockFellowshipAsCharacter() {
	Hooks.on("preUpdateUser", (user, changes) => {
		if (!("character" in changes)) return;
		const fellowshipId = LitmSettings.fellowshipId;
		if (changes.character === fellowshipId) {
			ui.notifications.warn(t("LITM.Ui.warn_fellowship_not_character"));
			return false;
		}
	});
}

/**
 * Filter fellowship out of the Actor creation dialog type dropdown.
 */
function _hideFromCreateDialog() {
	Hooks.once("ready", () => {
		const ActorCls = foundry.documents.Actor;
		const original = ActorCls.createDialog;
		ActorCls.createDialog = function (data, options, dialogOptions = {}) {
			dialogOptions.types ??= ActorCls.TYPES.filter(
				(type) => type !== ACTOR_TYPES.fellowship,
			);
			return original.call(this, data, options, dialogOptions);
		};
	});
}

/**
 * Cross-render: re-render hero sheets when fellowship changes,
 * and re-render the fellowship sheet when hero data changes (party overview).
 * Uses a single set of hooks with a debounced fellowship re-render.
 */
function _rerenderHeroSheetsOnFellowshipChange() {
	let fellowshipRenderTimer = null;

	const onDocumentChange = (actorOrItem) => {
		const fellowshipId = LitmSettings.fellowshipId;
		if (!fellowshipId) return;

		let doc = actorOrItem;
		while (doc?.parent && doc.parent.documentName !== "Actor") doc = doc.parent;
		const actorId = doc?.parent?.id ?? doc?.id;

		// Fellowship changed → re-render linked hero sheets
		if (actorId === fellowshipId) {
			for (const actor of game.actors) {
				if (actor.type !== ACTOR_TYPES.hero) continue;
				if (actor.system.fellowshipId !== fellowshipId) continue;
				if (actor.sheet?.rendered) actor.sheet.render();
			}
			return;
		}

		// Hero changed → debounce re-render of fellowship sheet (party overview)
		const actor = game.actors.get(actorId);
		if (!actor || actor.type !== ACTOR_TYPES.hero) return;
		if (!game.user.isGM) return;

		const fellowship = game.actors.get(fellowshipId);
		if (!fellowship?.sheet?.rendered) return;

		clearTimeout(fellowshipRenderTimer);
		fellowshipRenderTimer = setTimeout(() => fellowship.sheet.render(), 200);
	};

	const hooks = [
		"updateActor",
		"updateItem",
		"createItem",
		"deleteItem",
		"updateActiveEffect",
		"createActiveEffect",
		"deleteActiveEffect",
	];
	for (const hook of hooks) {
		Hooks.on(hook, onDocumentChange);
	}
}

/**
 * Auto-link newly created heroes to the singleton fellowship.
 */
function _autoLinkNewHeroes() {
	Hooks.on("createActor", async (actor) => {
		if (actor.type !== ACTOR_TYPES.hero) return;
		if (!game.user.isGM) return;

		const fellowshipId = LitmSettings.fellowshipId;
		if (!fellowshipId) return;
		if (actor.system.fellowshipId === fellowshipId) return;

		await actor.update({ "system.fellowshipId": fellowshipId });
	});
}
