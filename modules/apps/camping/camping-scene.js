import {
	statusTagEffect,
	storyTagEffect,
} from "../../active-effects/effect-factories.js";
import { ContentSources } from "../../system/content-sources.js";
import { Sockets } from "../../system/sockets.js";
import { getStoryTagSidebar, localize as t } from "../../utils.js";
import {
	applyOperations,
	buildOperations,
	parseCampsiteEntries,
} from "./camping-apply.js";
import {
	buildContext,
	buildThreatsContext,
	getCampingHeroes,
} from "./camping-context.js";
import {
	adjacentStep,
	defaultCampingState,
	SETTERS,
	sojournPowerBonus,
} from "./camping-state.js";

const FLAG_SCOPE = "litmv2";
const FLAG_PATH = "camping";

// Flag on the world-level "Camping" folder so we can find it across renames.
const CAMPING_FOLDER_ROLE = "camping-threats";

/**
 * Locate (or create on first use) the world-level Item folder that holds
 * threat vignettes authored from the camping scene. The folder is found
 * by a stable role flag so a GM-side rename or move doesn't lose it; if
 * none exists yet, a new one is created with the localized default name.
 */
async function getOrCreateCampingFolder() {
	const existing = game.folders?.find(
		(f) =>
			f.type === "Item" &&
			f.getFlag?.(FLAG_SCOPE, "role") === CAMPING_FOLDER_ROLE,
	);
	if (existing) return existing;
	return foundry.documents.Folder.create({
		name: t("LITM.Ui.camping_folder_name"),
		type: "Item",
		color: "#8b6f47",
		flags: { [FLAG_SCOPE]: { role: CAMPING_FOLDER_ROLE } },
	});
}

/**
 * Read the current camping state from the active scene's flags, returning
 * a deep clone so callers cannot accidentally mutate the live flag object.
 */
function readState() {
	const raw = canvas.scene?.flags?.[FLAG_SCOPE]?.[FLAG_PATH];
	if (!raw) return null;
	return foundry.utils.deepClone(raw);
}

/**
 * GM-side apply queue. Serializes ALL setter applications on the GM —
 * local clicks AND incoming socket dispatches — so the read-modify-write
 * cycle around setFlag is atomic per op. Without this, two near-
 * simultaneous incoming socket messages can each read the same baseline
 * state, apply their setter, and have the second setFlag overwrite the
 * first.
 */
let _applyQueue = Promise.resolve();
function enqueueApply(work) {
	_applyQueue = _applyQueue.catch(() => {}).then(work);
	return _applyQueue;
}

/**
 * Apply a named setter against the live scene flag. Runs on the GM only.
 * Drops the op if no camping session is active (i.e. `readState()` is
 * null) — this happens after Pack Up calls `unsetFlag`, and we don't want
 * a stale in-flight op to recreate the flag and resurrect a closed
 * camping session.
 */
async function applyOpOnGM(key, payload) {
	const setter = SETTERS[key];
	if (!setter) return;
	return enqueueApply(async () => {
		const state = readState();
		if (!state) return;
		setter(state, payload);
		await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_PATH, state);
	});
}

/**
 * Dispatch an op. GMs apply locally (serialized through `_applyQueue`).
 * Non-GMs send a `campingSaveOp` socket; the GM applies on receipt,
 * sharing the same queue so remote and local edits compose cleanly.
 */
export function enqueueOp(key, payload) {
	if (game.user.isGM) return applyOpOnGM(key, payload);
	Sockets.dispatch("campingSaveOp", { key, payload });
	return Promise.resolve();
}

/**
 * Extract a setter payload from a change-event target. Reads dataset fields
 * the templates declare alongside `data-update="<key>"`. Boolean inputs
 * report their `checked` state as `on`/`kept`; numeric inputs report Number
 * conversions; everything else passes through as a string `value`.
 */
function buildPayloadFromTarget(target) {
	const ds = target.dataset;
	const payload = {};
	if (ds.heroId) payload.heroId = ds.heroId;
	if (ds.effectId) payload.effectId = ds.effectId;
	if (ds.targetId) payload.targetId = ds.targetId;
	if (ds.itemId) payload.itemId = ds.itemId;
	if (ds.period != null) payload.period = Number(ds.period);
	if (ds.statusId) payload.statusId = ds.statusId;
	if (ds.maxTier != null) payload.maxTier = Number(ds.maxTier);
	if (ds.activity != null) payload.activity = ds.activity || null;
	if (ds.action != null) payload.action = ds.action;
	if (ds.field) payload.field = ds.field;

	const isCheckbox = target.type === "checkbox";
	if (isCheckbox) {
		if (ds.update === "backpack-kept") payload.kept = target.checked;
		else payload.on = target.checked;
	} else {
		payload.value = target.value ?? "";
	}
	return payload;
}

export class LitmCampingScene extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static #instance = null;

	static DEFAULT_OPTIONS = {
		id: "litm-camping-scene",
		classes: ["litm", "litm-camping-scene"],
		window: {
			title: "LITM.Ui.camping_title",
			resizable: true,
		},
		position: {
			width: 720,
			height: 720,
		},
		actions: {
			"set-camp-type": LitmCampingScene.#onSetCampType,
			"set-activity": LitmCampingScene.#onSetActivity,
			"begin-camp": LitmCampingScene.#onBeginCamp,
			"pack-up": LitmCampingScene.#onPackUp,
			cancel: LitmCampingScene.#onCancel,
			"toggle-third-period": LitmCampingScene.#onToggleThirdPeriod,
			"launch-camp-roll": LitmCampingScene.#onLaunchCampRoll,
			"add-threat": LitmCampingScene.#onAddThreat,
			"edit-threat": LitmCampingScene.#onEditThreat,
			"remove-threat": LitmCampingScene.#onRemoveThreat,
			"open-sheet": LitmCampingScene.#onOpenSheet,
			"rest-tier-delta": LitmCampingScene.#onRestTierDelta,
			"set-active-step": LitmCampingScene.#onSetActiveStep,
			"next-step": LitmCampingScene.#onNextStep,
			"prev-step": LitmCampingScene.#onPrevStep,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litmv2/templates/apps/camping/camping-scene.html",
			scrollable: [".litm-camping-scene__body"],
			templates: [
				"systems/litmv2/templates/apps/camping/camping-place-of-stay.html",
				"systems/litmv2/templates/apps/camping/camping-threats.html",
				"systems/litmv2/templates/apps/camping/step-timeline.html",
				"systems/litmv2/templates/apps/camping/step-period.html",
				"systems/litmv2/templates/apps/camping/step-quality-time.html",
				"systems/litmv2/templates/apps/camping/step-pack-up.html",
				"systems/litmv2/templates/apps/camping/hero-row.html",
				"systems/litmv2/templates/apps/camping/hero-row-period.html",
				"systems/litmv2/templates/apps/camping/hero-row-rest.html",
				"systems/litmv2/templates/apps/camping/hero-row-reflect.html",
				"systems/litmv2/templates/apps/camping/hero-row-camp-action.html",
				"systems/litmv2/templates/apps/camping/hero-row-quality-time.html",
				"systems/litmv2/templates/apps/camping/hero-row-pack-up.html",
			],
		},
	};

	/** Open or focus the singleton.
	 *
	 *  - GM clicks the camping icon → opens locally in `setup` phase. No
	 *    broadcast yet; players' clients stay quiet until "Begin Camp".
	 *  - Peer receives a `campingOpen` socket (fired only when the GM
	 *    transitions to `active`) → opens to render the active phase.
	 *    Both paths converge on a plain local render — neither
	 *    re-broadcasts.
	 */
	static open() {
		if (!canvas.scene) {
			ui.notifications?.warn(t("LITM.Ui.camping_no_scene"));
			return null;
		}
		if (!LitmCampingScene.#instance) {
			LitmCampingScene.#instance = new LitmCampingScene();
		}
		// The GM writes the initial flag (phase="setup" by default) so
		// `applyOpOnGM` can safely drop ops after pack-up clears it.
		// Non-GMs render against the fallback default until the flag
		// arrives via `updateScene`.
		if (game.user.isGM && !readState()) {
			canvas.scene?.setFlag(FLAG_SCOPE, FLAG_PATH, defaultCampingState());
		}
		LitmCampingScene.#instance.render(true);
		return LitmCampingScene.#instance;
	}

	static async close({ fromSocket = false } = {}) {
		if (!fromSocket) Sockets.dispatch("campingEnd", {});
		await LitmCampingScene.#instance?.close();
	}

	static get instance() {
		return LitmCampingScene.#instance;
	}

	async close(options) {
		LitmCampingScene.#instance = null;
		return super.close(options);
	}

	async _prepareContext(_options) {
		const state = readState() ?? defaultCampingState();
		const isGM = game.user.isGM;
		const ctx = buildContext(state);
		const {
			heroes,
			hasHeroes,
			placeOfStay,
			showThreats,
			threats,
			hasThreats,
			sceneStoryTags,
			hasSceneStoryTags,
			activeStep,
			steps,
			stepIsPeriod1,
			stepIsPeriod2,
			stepIsPeriod3,
			stepIsQualityTime,
			stepIsPackUp,
		} = ctx;
		const isSetup = state.phase === "setup";
		const isCamp = state.type === "camp";
		// Active-phase header is read-only — type + Power bonus + duration
		// were all locked in at Begin Camp. We pre-format it server-side so
		// the template stays markup-only.
		// Duration string already embeds the Power bonus
		// (e.g. "Days (+1 Power)"), so the title format just composes type +
		// duration — no second bonus interpolation needed.
		const activeTitle = isCamp
			? t("LITM.Ui.camping_camp")
			: game.i18n.format("LITM.Ui.camping_sojourn_title", {
					duration: t(`LITM.Ui.camping_duration_${state.sojournDuration}`),
				});
		// Footer button visibility for the active phase. Pack Up only on the
		// final step; Next on every step except the final; Previous on every
		// step except the first. All footer buttons are GM-only.
		const isFirstStep = activeStep === "period1";
		return {
			isGM,
			isCamp,
			sojournDuration: state.sojournDuration,
			isSetup,
			activeTitle,
			// "Begin Camp" stays as the setup-phase primary footer button.
			canBeginCamp: isGM && isSetup,
			canPackUp: isGM && !isSetup && stepIsPackUp,
			canStepNext: isGM && !isSetup && !stepIsPackUp,
			canStepPrev: isGM && !isSetup && !isFirstStep,
			heroes,
			hasHeroes,
			placeOfStay,
			showThreats,
			threats,
			hasThreats,
			sceneStoryTags,
			hasSceneStoryTags,
			activeStep,
			steps,
			stepIsPeriod1,
			stepIsPeriod2,
			stepIsPeriod3,
			stepIsQualityTime,
			stepIsPackUp,
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const html = this.element;
		if (!html) return;

		html.addEventListener("change", (ev) => {
			const target = ev.target;
			const key = target.dataset?.update;
			if (!key || !SETTERS[key]) return;
			const payload = buildPayloadFromTarget(target);
			enqueueOp(key, payload);
		});

		// Threat drop zone — accepts dragged vignette items from the items
		// directory or other sheets. Drops are GM-only; non-GMs can still
		// see the drop zone disabled, but the dispatch is gated below.
		const dropZone = html.querySelector('[data-drop-zone="threats"]');
		if (dropZone) {
			dropZone.addEventListener("dragover", (ev) => {
				if (!game.user.isGM) return;
				ev.preventDefault();
				dropZone.classList.add("dragover");
			});
			dropZone.addEventListener("dragleave", () => {
				dropZone.classList.remove("dragover");
			});
			dropZone.addEventListener("drop", (ev) => {
				dropZone.classList.remove("dragover");
				if (!game.user.isGM) return;
				ev.preventDefault();
				this.#onDropThreat(ev);
			});
		}
	}

	/**
	 * Resolve a drop event into a vignette item and add it to the threats
	 * list. Silently ignores non-vignette drops so dragging an actor or
	 * unrelated item onto the zone doesn't surface a noisy notification.
	 */
	async #onDropThreat(event) {
		const data =
			foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		if (data?.type !== "Item") return;
		const item = await foundry.documents.Item.implementation.fromDropData(data);
		if (!item || item.type !== "vignette") return;
		// Vignettes embedded on other documents (challenge/journey actors)
		// are scoped to that parent — we need a world-level copy so the
		// id we store remains resolvable from any client.
		const worldItem = item.parent
			? await this.#cloneIntoCampingFolder(item)
			: item;
		if (!worldItem?.id) return;
		await enqueueOp("threat-add", { itemId: worldItem.id });
	}

	/**
	 * Duplicate an embedded vignette into the world-level Camping folder.
	 * Used when the dragged source lives on an actor (challenge / journey)
	 * — that copy is owned by the parent and cannot be referenced globally.
	 */
	async #cloneIntoCampingFolder(item) {
		const folder = await getOrCreateCampingFolder();
		const data = item.toObject();
		delete data._id;
		data.folder = folder?.id ?? null;
		const [created] =
			await foundry.documents.Item.implementation.createDocuments([data]);
		return created;
	}

	static async #onSetCampType(_event, target) {
		const type = target.dataset.type;
		if (type !== "camp" && type !== "sojourn") return;
		await enqueueOp("set-type", { value: type });
	}

	static async #onSetActivity(_event, target) {
		const heroId = target.dataset.heroId;
		const period = Number(target.dataset.period);
		const requested = target.dataset.activity || null;
		// Toggle: clicking the current activity's chip clears it.
		const state = readState();
		const current =
			state?.heroStates?.[heroId]?.activities?.[period]?.activity ?? null;
		const next = current === requested ? null : requested;
		await enqueueOp("activity", { heroId, period, activity: next });
	}

	static async #onCancel() {
		// Non-GM Cancel only closes their own window — it must NOT broadcast
		// `campingEnd`, which would tear down the session for everyone else.
		// Only the GM can actually discard the session.
		if (!game.user.isGM) {
			await LitmCampingScene.#instance?.close();
			return;
		}
		// GM cancel = discard this session for the whole table. Close first
		// (nulls the singleton so the updateScene re-render hook short-
		// circuits), then clear the flag.
		await LitmCampingScene.close();
		// Roll back any campsite effects created at Begin Camp.
		const state = readState();
		const createdIds = state?.placeOfStay?.createdCampsiteEffectIds ?? [];
		if (createdIds.length) {
			await ContentSources.deleteStoryTags(createdIds);
			getStoryTagSidebar()?.render?.();
			Sockets.dispatch("storyTagsRender", {});
		}
		await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_PATH);
	}

	static async #onPackUp() {
		if (!game.user.isGM) return;
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: t("LITM.Ui.camping_pack_up") },
			content: `<p>${t("LITM.Ui.camping_pack_up_confirm")}</p>`,
			modal: true,
		});
		if (!confirmed) return;

		// Drain pending ops (local + remote) so the snapshot we read below
		// reflects every edit the players queued before clicking Pack Up.
		await _applyQueue;

		const state = readState();
		if (!state) {
			LitmCampingScene.close();
			return;
		}

		// Sweep every scene effect this camp session introduced. Includes
		// both Begin Camp-time campsite tags and any tags/statuses added via
		// the sidebar during the active phase, all stamped with state.campId.
		if (state.campId) {
			const stale = (await ContentSources.getStoryTags()).filter(
				(e) => e.getFlag?.(FLAG_SCOPE, "campId") === state.campId,
			);
			if (stale.length) {
				await ContentSources.deleteStoryTags(stale.map((e) => e.id));
			}
		}

		const heroes = getCampingHeroes();
		const fellowshipActor = heroes
			.map((h) => h.system?.fellowshipActor)
			.find(Boolean);
		const threatItems = buildThreatsContext(state);

		const { operations, recap } = buildOperations(state, {
			heroes,
			fellowshipActor,
			threatItems,
		});

		await applyOperations(operations);

		const content = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/apps/camping/camping-recap.html",
			recap,
		);
		const speakerAlias = fellowshipActor
			? game.i18n.format("LITM.Ui.camping_speaker_fellowship", {
					name: fellowshipActor.name,
				})
			: t("LITM.Ui.camping_speaker_default");
		await foundry.documents.ChatMessage.create({
			content,
			speaker: { alias: speakerAlias },
		});

		// Close before unsetFlag — the latter fires updateScene, whose handler
		// re-renders #instance if still set. Closing first nulls #instance.
		await LitmCampingScene.close();
		await canvas.scene?.unsetFlag(FLAG_SCOPE, FLAG_PATH);
	}

	/**
	 * Flip the camping session from "setup" to "active":
	 *   1. Expire any scene tags the GM flagged in setup (Core Book p.179:
	 *      old camp tags don't survive into a new one unless you keep them).
	 *   2. Materialize the GM's campsite-tags string into real scene
	 *      effects so heroes can invoke them in camp action rolls.
	 *   3. Record the created effect ids on state so Cancel can roll them
	 *      back; the expired ids are *not* tracked for rollback — the GM
	 *      decided to drop them, and any new campsite tag could share a
	 *      name we'd then have to deduplicate.
	 *   4. Clear sceneTagsToExpire (the work is done) and flip phase.
	 *   5. Broadcast open so peers render the active phase.
	 */
	static async #onBeginCamp() {
		if (!game.user.isGM) return;
		// Drain queue so we see every setup-phase edit before parsing.
		await _applyQueue;
		const state = readState();
		if (!state) return;

		const toExpire = (state.placeOfStay?.sceneTagsToExpire ?? []).slice();
		if (toExpire.length) {
			await ContentSources.deleteStoryTags(toExpire);
		}

		const campId = state.campId || foundry.utils.randomID();
		const entries = parseCampsiteEntries(state.placeOfStay?.campsiteTags);
		const stamp = { flags: { [FLAG_SCOPE]: { campId } } };
		const creationData = entries.map((entry) => {
			if (entry.type === "status_tag") {
				return {
					...statusTagEffect({ name: entry.name, tiers: entry.system?.tiers }),
					...stamp,
				};
			}
			return {
				...storyTagEffect({
					name: entry.name,
					isSingleUse: !!entry.system?.isSingleUse,
				}),
				...stamp,
			};
		});
		const created = creationData.length
			? ((await ContentSources.createStoryTags(creationData)) ?? [])
			: [];
		const createdIds = created.map((e) => e.id).filter(Boolean);

		await enqueueApply(async () => {
			const s = readState();
			if (!s) return;
			s.phase = "active";
			s.campId = campId;
			s.placeOfStay.createdCampsiteEffectIds = createdIds;
			s.placeOfStay.sceneTagsToExpire = [];
			await canvas.scene?.setFlag(FLAG_SCOPE, FLAG_PATH, s);
		});
		Sockets.dispatch("campingOpen", {});
		// Sidebar refresh so the new campsite tags appear immediately on
		// every client (Pack Up does the same; do it on Begin Camp too).
		getStoryTagSidebar()?.render?.();
		Sockets.dispatch("storyTagsRender", {});
	}

	/**
	 * Jump to a specific step via a timeline click. GM-only — players see
	 * the timeline as read-only markers. Free nav: every step is reachable
	 * regardless of completion state. Emits `litm.campingStepChanged` after
	 * the write so modules can react to the navigation.
	 */
	static async #onSetActiveStep(_event, target) {
		if (!game.user.isGM) return;
		const next = target.dataset.step;
		const state = readState();
		const from = state?.activeStep ?? null;
		if (!next || next === from) return;
		await enqueueOp("active-step", { value: next });
		Hooks.callAll("litm.campingStepChanged", { from, to: next });
	}

	/**
	 * Advance to the next step. Period 3's presence in the order depends
	 * on at least one hero opting in (see `stepOrder`), so this naturally
	 * skips over it when nobody has.
	 */
	static async #onNextStep() {
		if (!game.user.isGM) return;
		const state = readState();
		if (!state) return;
		const from = state.activeStep;
		const to = adjacentStep(state, "next");
		if (to === from) return;
		await enqueueOp("active-step", { value: to });
		Hooks.callAll("litm.campingStepChanged", { from, to });
	}

	/** Step backwards; symmetric to #onNextStep. */
	static async #onPrevStep() {
		if (!game.user.isGM) return;
		const state = readState();
		if (!state) return;
		const from = state.activeStep;
		const to = adjacentStep(state, "prev");
		if (to === from) return;
		await enqueueOp("active-step", { value: to });
		Hooks.callAll("litm.campingStepChanged", { from, to });
	}

	static async #onToggleThirdPeriod(_event, target) {
		const heroId = target.dataset.heroId;
		const state = readState();
		const current = state?.heroStates?.[heroId]?.thirdPeriodActive ?? false;
		await enqueueOp("third-period", { heroId, on: !current });
	}

	/**
	 * Create a fresh vignette item in the world-level Camping folder, open
	 * its sheet so the GM can fill in threat + consequences, and register
	 * it on the camping state. Only the GM authors threats.
	 */
	static async #onAddThreat() {
		if (!game.user.isGM) return;
		const folder = await getOrCreateCampingFolder();
		const created = await foundry.documents.Item.implementation.createDocuments(
			[
				{
					name: t("LITM.Ui.camping_threats_new"),
					type: "vignette",
					folder: folder?.id ?? null,
				},
			],
		);
		const vignette = created?.[0];
		if (!vignette?.id) return;
		await enqueueOp("threat-add", { itemId: vignette.id });
		vignette.sheet?.render(true);
	}

	static #onEditThreat(_event, target) {
		const itemId = target.dataset.itemId;
		const item = game.items?.get(itemId);
		item?.sheet?.render(true);
	}

	static #onOpenSheet(_event, target) {
		const heroId = target.dataset.heroId;
		const actor = game.actors?.get(heroId);
		actor?.sheet?.render(true);
	}

	static async #onRemoveThreat(_event, target) {
		if (!game.user.isGM) return;
		const itemId = target.dataset.itemId;
		if (!itemId) return;
		await enqueueOp("threat-remove", { itemId });
	}

	static async #onRestTierDelta(_event, target) {
		const heroId = target.dataset.heroId;
		const period = Number(target.dataset.period);
		const statusId = target.dataset.statusId;
		const maxTier = Number(target.dataset.maxTier);
		const delta = Number(target.dataset.delta);
		if (!heroId || !statusId || !Number.isFinite(period)) return;
		await enqueueOp("rest-tier-delta", {
			heroId,
			period,
			statusId,
			maxTier,
			delta,
		});
	}

	static #onLaunchCampRoll(_event, target) {
		const heroId = target.dataset.heroId;
		const actor = game.actors.get(heroId);
		if (!actor) return;
		const sheet = actor.sheet;
		// rollDialogInstance lazily creates — don't early-return on missing dialog.
		const dialog = sheet?.rollDialogInstance;
		if (!dialog) return;
		const state = readState();
		const bonus = state ? sojournPowerBonus(state) : 0;
		dialog.setCampAction({ sojournBonus: bonus });
		if (typeof sheet.renderRollDialog === "function") sheet.renderRollDialog();
		else if (!dialog.rendered) dialog.render(true);
	}

	/**
	 * Wire socket-receive hooks to render/refresh/close in response to other clients.
	 * Called once from system bootup.
	 */
	static registerSocketHooks() {
		// Stamp every story/status tag created in the scene story-tag pack
		// during an active camp session with the session's campId, so Pack
		// Up can later sweep them in one shot. Local hook only — the GM is
		// the canonical creator (sidebar adds + sockets both route here),
		// so a single stamp suffices for the table.
		Hooks.on("preCreateActiveEffect", (effect, _data, _options, _userId) => {
			if (!game.user.isGM) return;
			if (effect.pack !== "world.litmv2-story-tags") return;
			const state = readState();
			if (!state || state.phase !== "active" || !state.campId) return;
			if (effect.getFlag?.(FLAG_SCOPE, "campId")) return;
			effect.updateSource({
				[`flags.${FLAG_SCOPE}.campId`]: state.campId,
			});
		});

		Hooks.on("litm.camping.open", () => {
			LitmCampingScene.open();
		});
		Hooks.on("litm.camping.saveOp", async ({ key, payload }) => {
			// Exactly one GM applies the op, matching scratchEffect /
			// storyTagsUpdate. With every GM applying it, `rest-tier-delta`
			// (which computes from the persisted value) double-applies.
			if (game.user !== game.users.activeGM) return;
			await applyOpOnGM(key, payload);
		});
		Hooks.on("litm.camping.end", () => {
			LitmCampingScene.close({ fromSocket: true });
		});
		// Re-render when our scene flag changes, regardless of who wrote it.
		Hooks.on("updateScene", (scene, changes) => {
			if (scene.id !== canvas.scene?.id) return;
			if (
				!foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.${FLAG_PATH}`)
			)
				return;
			LitmCampingScene.#instance?.render();
		});
		// Re-render when a vignette referenced by Threats is edited — the
		// state stores ids, so name/threat/consequences edits don't trigger
		// the scene-flag hook above. Cheap-guard: bail out if camp isn't open.
		Hooks.on("updateItem", (item) => {
			if (!LitmCampingScene.#instance) return;
			if (item.type !== "vignette") return;
			const ids = readState()?.placeOfStay?.threats ?? [];
			if (!ids.includes(item.id)) return;
			LitmCampingScene.#instance.render();
		});
	}
}
