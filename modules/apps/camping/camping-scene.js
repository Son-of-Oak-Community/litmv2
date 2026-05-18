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
import { buildContext, getCampingHeroes } from "./camping-context.js";
import {
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
	}
	if (ds.update === "rest-choice") {
		// Two related inputs share this key: the <select> sets `action`, the
		// <input type="number"> sets `amount`. The unset side keeps its prior
		// value via the existing restChoice (read at apply time in the setter).
		const row = target.closest("tr");
		const sel = row?.querySelector(".litm-camping-scene__rest-action");
		const amt = row?.querySelector(".litm-camping-scene__rest-amount");
		payload.action = sel?.value ?? "";
		payload.amount = Math.max(1, parseInt(amt?.value, 10) || 1);
	}
	if (!isCheckbox && ds.update !== "rest-choice") {
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
			frame: false,
			positioned: false,
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
		},
	};

	static PARTS = {
		main: {
			template: "systems/litmv2/templates/apps/camping/camping-scene.html",
			scrollable: [".litm-camping-scene__body"],
			templates: [
				"systems/litmv2/templates/apps/camping/camping-hero-column.html",
				"systems/litmv2/templates/apps/camping/camping-place-of-stay.html",
				"systems/litmv2/templates/apps/camping/camping-threats.html",
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
		const {
			heroes,
			hasHeroes,
			placeOfStay,
			threats,
			hasThreats,
			sceneStoryTags,
			hasSceneStoryTags,
		} = buildContext(state);
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
		return {
			isGM,
			isCamp,
			sojournDuration: state.sojournDuration,
			isSetup,
			activeTitle,
			// "Begin Camp" replaces "Pack Up" in the footer during setup.
			canBeginCamp: isGM && isSetup,
			canPackUp: isGM && !isSetup,
			heroes,
			hasHeroes,
			placeOfStay,
			threats,
			hasThreats,
			sceneStoryTags,
			hasSceneStoryTags,
		};
	}

	_onFirstRender(context, options) {
		super._onFirstRender?.(context, options);
		// Elevate camping above whatever window spawned it (e.g. a fellowship
		// sheet). We can't call ApplicationV2.bringToFront — it short-circuits
		// when `frame: false` — so we participate in the same _maxZ counter
		// directly. Only doing this on first render is important: re-renders
		// triggered by updateItem / updateScene hooks must NOT re-elevate, or
		// child windows (vignette sheet, hero sheet, roll dialog) opened from
		// camping would slip back underneath after their parent re-renders.
		const AV2 = foundry.applications.api.ApplicationV2;
		AV2._maxZ = (AV2._maxZ ?? 100) + 1;
		this.element.style.zIndex = String(AV2._maxZ);
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
			// Visibility: when a rest-choice action select flips between
			// reduce/other, the amount input needs to show/hide immediately
			// without waiting for the next render.
			if (
				key === "rest-choice" &&
				target.classList.contains("litm-camping-scene__rest-action")
			) {
				const row = target.closest("tr");
				const amt = row?.querySelector(".litm-camping-scene__rest-amount");
				if (amt) amt.hidden = target.value !== "reduce";
			}
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
		const [created] = await foundry.documents.Item.implementation.createDocuments(
			[data],
		);
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
		// Cancel = discard this session. Close first (nulls the singleton
		// so the updateScene re-render hook short-circuits), then clear
		// the flag. Only the GM has setFlag rights; non-GMs just close.
		await LitmCampingScene.close();
		if (!game.user.isGM) return;
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

		const heroes = getCampingHeroes();
		const fellowshipActor = heroes
			.map((h) => h.system?.fellowshipActor)
			.find(Boolean);
		const sidebar = getStoryTagSidebar();
		const sceneEffects = sidebar?.sceneStoryEffects ?? [];
		const threatItems = (state.placeOfStay?.threats ?? [])
			.map((id) => game.items?.get(id))
			.filter(Boolean)
			.map((item) => ({
				id: item.id,
				name: item.name,
				threat: item.system?.threat ?? "",
				consequences: [...(item.system?.consequences ?? [])],
				isConsequenceOnly: !!item.system?.isConsequenceOnly,
			}));

		const { operations, recap } = buildOperations(state, {
			heroes,
			fellowshipActor,
			sceneEffects,
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

		const entries = parseCampsiteEntries(state.placeOfStay?.campsiteTags);
		const creationData = entries.map((entry) => {
			if (entry.type === "status_tag") {
				const tiers = entry.system?.tiers ?? [
					false,
					false,
					false,
					false,
					false,
					false,
				];
				return statusTagEffect({ name: entry.name, tiers });
			}
			return storyTagEffect({
				name: entry.name,
				isSingleUse: !!entry.system?.isSingleUse,
			});
		});
		const created = creationData.length
			? ((await ContentSources.createStoryTags(creationData)) ?? [])
			: [];
		const createdIds = created.map((e) => e.id).filter(Boolean);

		await enqueueApply(async () => {
			const s = readState();
			if (!s) return;
			s.phase = "active";
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
		const created = await foundry.documents.Item.implementation.createDocuments([
			{
				name: t("LITM.Ui.camping_threats_new"),
				type: "vignette",
				folder: folder?.id ?? null,
			},
		]);
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
		Hooks.on("litm.camping.open", () => {
			LitmCampingScene.open();
		});
		Hooks.on("litm.camping.saveOp", async ({ key, payload }) => {
			if (!game.user.isGM) return;
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
