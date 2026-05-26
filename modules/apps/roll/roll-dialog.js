import { effectToPlain } from "../../active-effects/effect-queries.js";
import { ALL_TAG_TYPES, EFFECT_TAG_ORDER } from "../../system/config.js";
import { renderAction } from "../../system/renderers/action-renderer.js";
import { Sockets } from "../../system/sockets.js";
import {
	getStoryTagSidebar,
	localize as t,
	viewLinkedRefAction,
} from "../../utils.js";
import { LitmEmbedPopout } from "../embed-popout.js";
import { LitmRoll } from "./roll.js";
import {
	buildActionContext,
	buildGmViewerContext,
	buildOwnerContext,
	sortByTypeThenName,
} from "./roll-dialog-context.js";
import {
	buildRollPreview,
	executeRoll,
	resolveRollDialogOwnership,
} from "./roll-pipeline.js";

export { resolveRollDialogOwnership };

export class LitmRollDialog extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-roll-dialog",
		classes: ["litm", "litm--roll"],
		tag: "form",
		window: {
			title: "LITM.Ui.roll_title",
			resizable: true,
		},
		position: {
			width: 600,
			height: 720,
		},
		form: {
			handler: LitmRollDialog._onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			sendToNarrator: LitmRollDialog.#onSendToNarrator,
			"spend-half": LitmRollDialog.#onSpendHalf,
			viewLinkedRef: viewLinkedRefAction,
			viewActionCard: LitmRollDialog.#onViewActionCard,
			clearAction: LitmRollDialog.#onClearAction,
			toggleRollTag: LitmRollDialog.#onToggleRollTag,
			selectSacrificeTheme: LitmRollDialog.#onSelectSacrificeTheme,
			setSacrificeLevel: LitmRollDialog.#onSetSacrificeLevel,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/roll-dialog.html",
			scrollable: [
				".litm--roll-dialog-tags-fieldset",
				".litm--roll-dialog-tags-fieldset section.tab",
			],
		},
	};

	static create(options) {
		return new LitmRollDialog(options);
	}

	/** Delegates to {@link executeRoll} for the actual roll pipeline. Kept
	 *  as a static for socket dispatch and preserved external callers. */
	static roll(data) {
		return executeRoll(data);
	}

	static async _onSubmit(_event, _form, formData) {
		if (!this.isOwner) return;
		return executeRoll(this.extractRollData(formData));
	}

	static async #onSendToNarrator(_event, _target) {
		if (!this.isOwner) return;
		const formData = new foundry.applications.ux.FormDataExtended(this.element);
		const rollData = this.extractRollData(formData);
		await this._createModerationRequest(rollData);
		this.close();
	}

	static #onSetSacrificeLevel(_event, target) {
		if (!this.isOwner) return;
		const level = target?.dataset?.level;
		if (!level || level === this.#sacrificeLevel) return;
		this.#sacrificeLevel = level;
		const root = this.element;
		if (root) {
			for (const label of root.querySelectorAll(
				"[data-action='setSacrificeLevel']",
			)) {
				label.classList.toggle("is-active", label.dataset.level === level);
			}
		}
		this.#toggleSacrificeSubfields(this.#sacrificeLevel);
		this.#dispatchUpdate();
	}

	static #onSelectSacrificeTheme(_event, target) {
		if (!this.isOwner) return;
		const themeId = target?.dataset?.themeId;
		if (!themeId || themeId === this.#sacrificeThemeId) return;
		this.#sacrificeThemeId = themeId;
		const root = this.element;
		if (root) {
			for (const card of root.querySelectorAll(
				"[data-action='selectSacrificeTheme']",
			)) {
				const isSelected = card.dataset.themeId === themeId;
				card.classList.toggle("is-selected", isSelected);
				card.setAttribute("aria-checked", isSelected ? "true" : "false");
			}
			const hidden = root.querySelector(
				"input[type='hidden'][name='sacrificeThemeId']",
			);
			if (hidden) hidden.value = themeId;
		}
		this.#dispatchUpdate();
	}

	static async #onSpendHalf(_event, _target) {
		const power = this.totalPower;
		if (power < 1) {
			ui.notifications?.warn(t("LITM.Ui.camping_spend_half_no_power"));
			return;
		}
		const half = Math.ceil(power / 2);
		const actor = this.actor;
		if (!actor) return;
		await this.close();
		const { SpendPowerApp } = await import("../spend-power.js");
		new SpendPowerApp({ actorId: actor.id, power: half }).render(true);
	}

	/** Open the linked action's read-only embed card in a popout — the action
	 *  sheet is an editor, not a reference view. */
	static async #onViewActionCard() {
		const doc = this.actionDoc;
		if (!doc) return;
		new LitmEmbedPopout({
			document: doc,
			render: renderAction,
		}).render(true);
	}

	/** Detach the linked action from this dialog without rolling. Lets the
	 *  player back out of an action they opened by mistake, or downgrade to a
	 *  plain roll without closing the window and losing their tag selections. */
	static #onClearAction() {
		if (!this.actionUuid) return;
		this.setAction(null);
		this.rollName = "";
	}

	/**
	 * Click on a tag's label cycles the embedded super-checkbox; shift-click
	 * jumps straight to (or out of) the "scratched" state when the tag allows
	 * it. The early return covers re-entry: the programmatic checkbox.click()
	 * below bubbles a fresh click event back through the same data-action.
	 */
	static #onToggleRollTag(event, target) {
		if (event.target.tagName === "LITM-SUPER-CHECKBOX") return;
		event.preventDefault();
		const checkbox = target.querySelector("litm-super-checkbox");
		if (!checkbox) return;

		if (event.shiftKey && !checkbox.disabled) {
			const canScratch = checkbox.getAttribute("states")?.includes("scratched");
			if (canScratch) {
				checkbox.value = checkbox.value === "scratched" ? "" : "scratched";
				checkbox.dispatchEvent(new Event("change"));
				return;
			}
		}
		checkbox.click();
	}

	extractRollData(formData) {
		const data = foundry.utils.expandObject(formData.object);
		const {
			actorId,
			title,
			modifier,
			might,
			tradePower,
			sacrificeLevel,
			sacrificeThemeId,
			sacrificeStatusName,
		} = data;
		// Sacrifice hides the type radio bar entirely, so the form yields no
		// `type` value in that mode. Fall back to the dialog's tracked type
		// so the resulting payload is always self-describing.
		const type = data.type || this.type || "quick";
		const tags = this.#buildTagsFromMap();
		return {
			actorId,
			type,
			tags,
			title,
			speaker: this.speaker,
			modifier,
			might: Number(might) || 0,
			tradePower: Number(tradePower) || 0,
			sacrificeLevel: type === "sacrifice" ? sacrificeLevel : undefined,
			sacrificeThemeId: type === "sacrifice" ? sacrificeThemeId : undefined,
			sacrificeStatusName:
				type === "sacrifice" && sacrificeLevel === "grave"
					? sacrificeStatusName
					: undefined,
			actionUuid: this.#actionUuid,
		};
	}

	get title() {
		const base = game.i18n.localize("LITM.Ui.roll_title");
		const name = this.actor?.name;
		return name ? `${name} — ${base}` : base;
	}

	/**
	 * @typedef {object} SelectionEntry
	 * @property {string} state - "positive"|"negative"|"scratched"|""
	 * @property {string|null} contributorId - user ID who selected this tag
	 * @property {ActiveEffect|null} effect - resolved AE reference (null until resolved)
	 * @property {string|null} effectUuid - AE UUID for cross-client resolution
	 * @property {string|null} [contributorActorId] - actor ID of the contributing character
	 * @property {string|null} [contributorActorName] - display name of the contributing character
	 * @property {string|null} [contributorActorImg] - image of the contributing character
	 */

	/** @type {Map<string, SelectionEntry>} */
	#selectionMap = new Map();

	#modifier = 0;
	#might = 0;
	#tradePower = 0;
	#sacrificeLevel = "painful";
	#sacrificeThemeId = null;
	#sacrificeStatusName = "";
	#ownerId = null;
	#cachedTotalPower = null;
	#actionUuid = null;
	#actionDoc = null;
	#sojournBonus = 0;

	constructor(options = {}) {
		if (options.actorId) options.id = `litm-roll-dialog-${options.actorId}`;
		super(options);

		this.#modifier = options.modifier || 0;
		this.#might = Number(options.might) || 0;
		this.#tradePower = options.tradePower || 0;
		this.#sacrificeLevel = options.sacrificeLevel || "painful";
		this.#sacrificeThemeId = options.sacrificeThemeId || null;
		this.#sacrificeStatusName = options.sacrificeStatusName || "";
		this.#ownerId = options.ownerId || null;
		this.#actionUuid = options.actionUuid || null;

		this.actorId = options.actorId;
		this.speaker =
			options.speaker ||
			foundry.documents.ChatMessage.getSpeaker({ actor: this.actor });
		this.rollName = options.title || "";
		this.type = options.type || "quick";
	}

	/**
	 * Resolve the linked action document if not already cached. Async-safe;
	 * supports compendium UUIDs that aren't preloaded.
	 * @returns {Promise<Item|null>}
	 */
	async #resolveAction() {
		if (!this.#actionUuid) {
			this.#actionDoc = null;
			return null;
		}
		if (this.#actionDoc?.uuid === this.#actionUuid) return this.#actionDoc;
		this.#actionDoc = await foundry.utils.fromUuid(this.#actionUuid);
		if (this.#actionDoc?.name && !this.rollName)
			this.rollName = this.#actionDoc.name;
		return this.#actionDoc;
	}

	get actionUuid() {
		return this.#actionUuid;
	}

	get actionDoc() {
		return this.#actionDoc;
	}

	setAction(uuid) {
		this.#actionUuid = uuid || null;
		this.#actionDoc = null;
		// Action rolls and sacrifice are mutually exclusive — rolling an
		// action while the dialog is parked in sacrifice mode must drop
		// sacrifice, mirroring the Roll button's behaviour in hero-sheet.
		if (this.#actionUuid && this.type === "sacrifice") {
			this.type = "quick";
			this.updatePresence(true);
		}
		if (this.rendered) this.render();
	}

	setType(type) {
		if (!type) return;
		// Sacrifice is its own ritual — clear any pending action so the
		// dialog never shows the action strip alongside the sacrifice grid.
		if (type === "sacrifice") {
			this.#actionUuid = null;
			this.#actionDoc = null;
		}
		this.type = type;
		if (this.rendered) this.render();
		// Refresh presence so peers can react to the new type — e.g. the
		// sacrifice banner fires off the flag transition to "sacrifice".
		this.updatePresence(true);
	}

	/**
	 * Configure this dialog for a camp action. Sets type="campAction" so the
	 * template exposes the no-roll "Spend half" submit option, and adds a
	 * sojourn bonus into the power computation (0 for camp; 1/2/3 for sojourn
	 * by duration). Callers (the camping wizard) compute the bonus and pass it.
	 */
	setCampAction({ sojournBonus = 0 } = {}) {
		this.#sojournBonus = Math.max(0, Number(sojournBonus) || 0);
		this.#cachedTotalPower = null;
		this.type = "campAction";
		if (this.rendered) this.render();
	}

	get ownerId() {
		return this.#ownerId;
	}

	set ownerId(value) {
		this.#ownerId = value;
	}

	get isOwner() {
		return this.#ownerId === game.user.id;
	}

	get actor() {
		return game.actors.get(this.actorId);
	}

	/** @returns {SelectionEntry} */
	getSelection(effectId) {
		return (
			this.#selectionMap.get(effectId) ?? {
				state: "",
				contributorId: null,
				effect: null,
				effectUuid: null,
			}
		);
	}

	setSelection(
		effectId,
		state,
		contributorId = null,
		{ effect = null, effectUuid = null, ...contributorMeta } = {},
	) {
		this.#cachedTotalPower = null;
		if (!state) {
			this.#selectionMap.delete(effectId);
		} else {
			const existing = this.#selectionMap.get(effectId);
			const entry = {
				state,
				contributorId,
				effect: effect ?? existing?.effect ?? null,
				effectUuid: effectUuid ?? effect?.uuid ?? existing?.effectUuid ?? null,
				...(Object.keys(contributorMeta).length
					? contributorMeta
					: {
							contributorActorId: existing?.contributorActorId ?? null,
							contributorActorName: existing?.contributorActorName ?? null,
							contributorActorImg: existing?.contributorActorImg ?? null,
						}),
			};
			this.#selectionMap.set(effectId, entry);
		}
	}

	clearSelections() {
		this.#cachedTotalPower = null;
		this.#selectionMap.clear();
	}

	get selections() {
		return this.#selectionMap;
	}

	get #storyTagSidebar() {
		return getStoryTagSidebar() ?? {};
	}

	get storyTagSidebar() {
		return this.#storyTagSidebar;
	}

	get statuses() {
		const { tags = [] } = this.#storyTagSidebar;
		const sceneStatuses = tags
			.filter((tag) => tag.values?.some((v) => !!v))
			.map((tag) => {
				const sel = this.getSelection(tag.uuid);
				return {
					...tag,
					type: "status_tag",
					value: tag.values ? tag.values.lastIndexOf(true) + 1 : 0,
					actorName: null,
					actorImg: null,
					state: sel.state || "",
					contributorId: sel.contributorId || null,
					states: ",positive,negative",
				};
			});
		return sceneStatuses;
	}

	get tags() {
		if (!this.actor) return [];
		const { tags = [] } = this.#storyTagSidebar;
		const sceneTags = tags
			.filter((tag) => tag.values.every((v) => !v))
			.map((tag) => {
				const sel = this.getSelection(tag.uuid);
				return {
					...tag,
					type: "story_tag",
					actorName: null,
					actorImg: null,
					state: sel.state || "",
					contributorId: sel.contributorId || null,
					states: tag.isSingleUse
						? ",positive,negative"
						: ",positive,negative,scratched",
				};
			});
		return sceneTags;
	}

	get gmTags() {
		if (!game.user.isGM) return [];

		const { actors } = this.#storyTagSidebar;
		if (!actors) return [];
		const fellowshipUuid = game.litmv2?.fellowship?.uuid;
		const tags = actors
			.filter(
				(actor) => actor.id !== this.actor.uuid && actor.id !== fellowshipUuid,
			)
			.flatMap((actor) =>
				actor.tags.map((tag) => ({
					...tag,
					actorName: actor.name,
					actorImg: actor.img,
					actorType: actor.type,
				})),
			);
		return tags.map((tag) => {
			const sel = this.getSelection(tag.uuid);
			return {
				...tag,
				state: sel.state || "",
				contributorId: sel.contributorId || null,
			};
		});
	}

	get totalPower() {
		if (this.#cachedTotalPower != null) return this.#cachedTotalPower;
		const tags = this.#buildTagsFromMap();
		const filtered = LitmRoll.filterTags(tags);
		const { totalPower } = LitmRoll.calculatePower({
			...filtered,
			modifier: this.#modifier + this.#sojournBonus,
			might: this.#might,
		});
		this.#cachedTotalPower = totalPower;
		return totalPower;
	}

	/**
	 * Resolve an ActiveEffect by ID, searching the rolling actor, fellowship, and contributor actors.
	 * Caches the result on the selection entry for subsequent calls.
	 * @param {string} effectId
	 * @param {SelectionEntry} entry
	 * @returns {ActiveEffect|null}
	 */
	#resolveEffect(effectId, entry) {
		if (entry.effect) return entry.effect;
		const effect = foundry.utils.fromUuidSync(effectId);
		if (effect) {
			entry.effect = effect;
			return effect;
		}
		return null;
	}

	/**
	 * Build the tag array for a roll from the selection map.
	 * Each tag includes the full AE metadata (uuid, system, type).
	 * All tags (character effects and scene compendium effects) are resolved via fromUuidSync.
	 * @returns {object[]}
	 */
	#buildTagsFromMap() {
		const result = [];
		for (const [effectId, sel] of this.#selectionMap) {
			if (!sel.state) continue;
			const effect = this.#resolveEffect(effectId, sel);
			if (!effect) continue;
			result.push({
				_id: effect._id,
				id: effect.id,
				uuid: effect.uuid,
				name: effect.name,
				type: effect.type,
				system: effect.system,
				state: sel.state,
				value:
					effect.type === "status_tag"
						? (effect.system?.currentTier ?? 0)
						: undefined,
			});
		}
		return result;
	}

	#buildTagGroups({ isOwner, isGMViewer }) {
		const currentUserId = game.user.id;
		const tagTypeOrder = EFFECT_TAG_ORDER;

		// Tag IDs the current action suggests as helpful / hindering, used to
		// decorate matching tag rows with a highlight in the dialog.
		const action = this.#actionDoc;
		const positiveSuggestedIds = new Set(
			(action?.system.power?.positiveTags ?? [])
				.map((e) => e.tagId)
				.filter(Boolean),
		);
		const negativeSuggestedIds = new Set(
			(action?.system.power?.negativeTags ?? [])
				.map((e) => e.tagId)
				.filter(Boolean),
		);

		const isGM = game.user.isGM;
		const decorateTag = (tag) => {
			const contributorId = tag.contributorId || null;
			const isOpposition =
				tag.actorType === "challenge" || tag.actorType === "journey";
			// Already-scratched (unavailable) tags cannot be invoked or re-burned;
			// lock the row so the super-checkbox has no valid transitions.
			const isUnavailable = tag.system?.isScratched === true;
			// Narrator-only inversion (Core Book p.76): power/weakness tags
			// expose a wider cycle for the GM. Players see the natural-polarity
			// cycle only — `playerAllowedStates` falls back to `allowedStates`
			// for tag types that aren't restricted.
			const baseStates =
				!isGM && tag.system?.playerAllowedStates
					? tag.system.playerAllowedStates
					: (tag.system?.allowedStates ?? tag.states ?? ",positive,negative");
			const states = isUnavailable
				? ""
				: isOpposition
					? ",negative,positive"
					: baseStates;
			const tagId = tag.id ?? tag._id;
			return {
				...tag,
				_id: tag._id ?? tag.id,
				id: tagId,
				key: tag.uuid ?? tag.id ?? tag._id,
				contributorId,
				displayName: tag.displayName || tag.name,
				locked:
					isUnavailable ||
					(!isOwner && contributorId && contributorId !== currentUserId),
				isUnavailable,
				states,
				value:
					tag.type === "status_tag"
						? (tag.system?.currentTier ?? tag.value ?? 0)
						: undefined,
				isPositiveSuggestion: positiveSuggestedIds.has(tagId),
				isNegativeSuggestion: negativeSuggestedIds.has(tagId),
			};
		};

		const gmTagsFlat = sortByTypeThenName(
			this.gmTags.map(decorateTag),
			tagTypeOrder,
		);
		const gmTagGroupMap = new Map();
		for (const tag of gmTagsFlat) {
			const key = tag.actorName || "";
			if (!gmTagGroupMap.has(key)) {
				gmTagGroupMap.set(key, {
					actorName: tag.actorName,
					actorImg: tag.actorImg,
					tags: [],
				});
			}
			gmTagGroupMap.get(key).tags.push(tag);
		}
		const gmTagGroups = [...gmTagGroupMap.values()];

		// Separate story items by source: scene stays below, actor items join character groups
		const allStoryItems = [
			...sortByTypeThenName(this.statuses.map(decorateTag), tagTypeOrder),
			...sortByTypeThenName(this.tags.map(decorateTag), tagTypeOrder),
		];
		const sceneStoryItems = allStoryItems.filter(
			(tag) => tag.actorName === null,
		);
		const storyTagGroups = sceneStoryItems.length
			? [{ actorName: null, actorImg: null, tags: sceneStoryItems }]
			: [];

		const shared = {
			decorateTag,
			tagTypeOrder,
			allStoryItems,
			sceneStoryItems,
			isOwner,
			isGMViewer,
		};
		return { shared, gmTagGroups, storyTagGroups };
	}

	async _prepareContext(_options) {
		await getStoryTagSidebar()?.loadStoryTags?.();
		await this.#resolveAction();

		const isOwner = this.isOwner;
		const isGMViewer = game.user.isGM && !isOwner;

		const actionContext = buildActionContext({ action: this.#actionDoc });

		const { shared, gmTagGroups, storyTagGroups } = this.#buildTagGroups({
			isOwner,
			isGMViewer,
		});

		let characterTagGroups = [];
		let fellowshipTagGroups = [];
		let gmViewerTabs = [];
		if (isGMViewer) {
			gmViewerTabs = this.#buildGmViewerContext(shared);
		} else {
			({ characterTagGroups, fellowshipTagGroups } =
				this.#buildOwnerContext(shared));
		}
		// Non-owners only see the rolling actor's tags that were selected
		if (!isOwner) {
			const filterSelected = (groups) =>
				groups
					.map((g) => ({ ...g, tags: g.tags.filter((t) => t.state) }))
					.filter((g) => g.tags.length);
			characterTagGroups = filterSelected(characterTagGroups);
			fellowshipTagGroups = filterSelected(fellowshipTagGroups);
		}

		const contributedTagGroups = this.#buildContributedTagGroups(shared);

		// Owner-view tabs (Hero / Allies / Scene) group the tag sections
		// the way the story-tag sidebar does for GMs: each tab is a clean
		// column of related sources. Non-owner views show only selected
		// tags and don't need the tab chrome. GM viewers have their own
		// per-actor tab group above and are handled separately.
		let ownerTabs = [];
		if (isOwner) {
			this.tabGroups["roll-tags"] ??= "hero";
			ownerTabs = [
				{ id: "hero", label: t("LITM.Ui.roll_tab_hero") },
				{ id: "allies", label: t("LITM.Ui.roll_tab_allies") },
				{ id: "scene", label: t("LITM.Ui.roll_tab_scene") },
			];
			for (const tab of ownerTabs) {
				tab.cssClass = this.tabGroups["roll-tags"] === tab.id ? "active" : "";
			}
		}

		return {
			actorId: this.actorId,
			characterTagGroups,
			fellowshipName:
				game.litmv2?.fellowship?.name ?? t("LITM.Terms.fellowship"),
			fellowshipTagGroups,
			contributedTagGroups,
			ownerTabs,
			rollTypes: {
				quick: "LITM.Ui.roll_quick",
				tracked: "LITM.Ui.roll_tracked",
				mitigate: "LITM.Ui.roll_mitigate",
			},
			storyTagGroups,
			gmTagGroups,
			isGM: game.user.isGM,
			isGMViewer,
			gmViewerTabs,
			isOwner,
			title: this.rollName,
			type: this.type,
			isCampAction: this.type === "campAction",
			sojournBonus: this.#sojournBonus,
			totalPower: this.totalPower,
			modifier: this.#modifier,
			might: this.#might,
			mightRange: Array.from({ length: 13 }, (_, i) => i - 6),
			tradePower: this.#tradePower,
			canHedge: this.totalPower >= 2,
			canCaution: this.totalPower <= 2,
			sacrificeLevel: this.#sacrificeLevel,
			sacrificeLevelOptions: ["painful", "scarring", "grave"].map((key) => ({
				value: key,
				label: t(`LITM.Ui.sacrifice_${key}`),
				description: t(`LITM.Ui.sacrifice_${key}_price`),
				selected: this.#sacrificeLevel === key,
			})),
			sacrificeThemeId: this.#sacrificeThemeId,
			sacrificeThemes: this.#ensureSacrificeThemeSelected(),
			sacrificeStatusName: this.#sacrificeStatusName,
			// The theme selector serves a different rhetorical purpose per
			// level — Painful scratches it, Scarring removes it, Grave only
			// touches it on Miracle. The legend/hint reflect that intent.
			sacrificeThemeLegend: t(
				this.#sacrificeLevel === "grave"
					? "LITM.Ui.sacrifice_theme_grave_legend"
					: "LITM.Ui.sacrifice_choose_theme",
			),
			sacrificeThemeHint:
				this.#sacrificeLevel === "grave"
					? t("LITM.Ui.sacrifice_theme_grave_hint")
					: "",
			actionContext,
		};
	}

	/**
	 * Build per-actor tabs for GM viewers from the story tag sidebar actors.
	 * @param {object} shared - Shared context utilities from _prepareContext
	 * @returns {object[]} gmViewerTabs array
	 */
	#buildGmViewerContext(shared) {
		return buildGmViewerContext(this, shared);
	}

	#buildOwnerContext(shared) {
		return buildOwnerContext(this, shared);
	}

	/**
	 * Build contributed tag groups from other characters' selections.
	 * @param {object} shared - Shared context utilities from _prepareContext
	 * @returns {object[]} contributedTagGroups array
	 */
	#buildContributedTagGroups({ decorateTag, tagTypeOrder, isOwner }) {
		const contributedActorMap = new Map();
		if (isOwner) {
			for (const [effectId, sel] of this.#selectionMap) {
				if (!sel.contributorActorId || !sel.state) continue;
				const actor = game.actors.get(sel.contributorActorId);
				if (!actor) continue;
				const allTags = actor.sheet?._buildAllRollTags?.() ?? [];
				const rawTag = allTags.find((t) => t.uuid === effectId);
				if (!rawTag) continue;
				const tag = decorateTag({
					...rawTag,
					state: sel.state,
					contributorId: sel.contributorId,
				});
				const actorKey = sel.contributorActorId;
				if (!contributedActorMap.has(actorKey)) {
					contributedActorMap.set(actorKey, {
						actorName: sel.contributorActorName ?? actor.name,
						actorImg: sel.contributorActorImg ?? actor.img,
						themeMap: new Map(),
					});
				}
				const themeMap = contributedActorMap.get(actorKey).themeMap;
				const themeKey = rawTag.themeId ?? `__${rawTag.type}`;
				const themeLabel = rawTag.themeName ?? rawTag.type;
				const themeImg = rawTag.themeId
					? (actor.items.get(rawTag.themeId)?.img ?? null)
					: null;
				if (!themeMap.has(themeKey)) {
					themeMap.set(themeKey, { themeName: themeLabel, themeImg, tags: [] });
				}
				themeMap.get(themeKey).tags.push(tag);
			}
		}
		// Non-owners see their own character's tags for contribution
		if (!isOwner && !game.user.isGM) {
			const ownCharacter = game.user.character;
			if (ownCharacter && ownCharacter.id !== this.actorId) {
				const actorKey = ownCharacter.id;
				const actorImg =
					ownCharacter.prototypeToken?.texture?.src || ownCharacter.img;
				if (!contributedActorMap.has(actorKey)) {
					contributedActorMap.set(actorKey, {
						actorName: ownCharacter.name,
						actorImg,
						themeMap: new Map(),
					});
				}
				const themeMap = contributedActorMap.get(actorKey).themeMap;
				for (const e of ownCharacter.appliedEffects) {
					const rawTag = effectToPlain(e);
					const sel = this.getSelection(rawTag.uuid);
					const tag = decorateTag({
						...rawTag,
						state: sel.state,
						contributorId: sel.contributorId,
					});
					const themeKey = rawTag.themeId ?? `__${rawTag.type}`;
					const themeLabel = rawTag.themeName ?? rawTag.type;
					const themeImg = e.parent?.img ?? null;
					if (!themeMap.has(themeKey)) {
						themeMap.set(themeKey, {
							themeName: themeLabel,
							themeImg,
							tags: [],
						});
					}
					themeMap.get(themeKey).tags.push(tag);
				}
			}
		}
		return [...contributedActorMap.values()].map((entry) => ({
			actorName: entry.actorName,
			actorImg: entry.actorImg,
			themeGroups: [...entry.themeMap.values()].map((g) => ({
				...g,
				tags: sortByTypeThenName(g.tags, tagTypeOrder),
			})),
		}));
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);

		// Delegated change handler — routes to the appropriate handler based on target
		this.element.addEventListener("change", (event) => {
			const target = event.target;
			if (target.tagName === "LITM-SUPER-CHECKBOX") {
				this._onTagChange(event);
			} else if (target.matches("input[name='might']")) {
				this.#handleMightChange(target);
			} else if (target.matches("input[name='tradePower']")) {
				this.#handleTradePowerChange(target);
			} else if (target.matches("input[name='sacrificeLevel']")) {
				this.#handleSacrificeLevelChange(target);
			} else if (target.matches("[data-update='sacrificeThemeId']")) {
				this.#handleSacrificeThemeChange(target);
			} else if (target.matches("input[name='sacrificeStatusName']")) {
				this.#handleSacrificeStatusNameChange(target);
			} else if (target.matches("input[name='type']")) {
				this.#handleTypeChange(target);
			}
		});
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#totalPowerEl = null;
		this.#hedgeRadioEl = null;
		this.#cautionRadioEl = null;
		Hooks.callAll("litm.rollDialogRendered", this.actor, this);

		// Might scale tooltip (depends on elements recreated each render)
		const mightLabel = this.element.querySelector(".litm--might-name-wrapper");
		const mightTooltipTemplate = this.element.querySelector(
			".litm--might-tooltip-template",
		);
		if (mightLabel && mightTooltipTemplate) {
			const tooltipContent =
				mightTooltipTemplate.content.firstElementChild.cloneNode(true);
			mightLabel.addEventListener("pointerenter", () => {
				game.tooltip.activate(mightLabel, {
					html: tooltipContent,
					direction: "DOWN",
				});
			});
			mightLabel.addEventListener("pointerleave", () => {
				game.tooltip.deactivate();
			});
		}

		// Apply initial type-dependent visibility
		this.#toggleSacrificeMode(this.type === "sacrifice");
		this.#toggleTradePower(this.type === "tracked");
		this.#updateTotalPower();

		if (!this.isOwner) {
			this.#applyReadOnlyState();
		}
	}

	#applyReadOnlyState() {
		this.element.querySelectorAll("input[name='type']").forEach((input) => {
			input.disabled = true;
			input.setAttribute("aria-disabled", "true");
		});
	}

	#canModifyTag(selOrTag) {
		if (this.isOwner) return true;
		if (!selOrTag) return false;
		const contributorId = selOrTag.contributorId || null;
		return !contributorId || contributorId === game.user.id;
	}

	#revertTagChange(target, currentValue) {
		if (!target) return;
		target.value = currentValue || "";
	}

	_onTagChange(event) {
		const target = event.target;
		const { name: id, value } = target;
		const { type } = target.dataset;
		const isCharacterTag = ALL_TAG_TYPES.has(type);
		// For non-owners, register contributor metadata on first interaction
		if (isCharacterTag && !this.isOwner && !this.#selectionMap.has(id)) {
			// GM viewer: look up from any sidebar actor
			if (game.user.isGM) {
				const sidebarActorUuids =
					this.#storyTagSidebar.actors?.map((a) => a.id) ?? [];
				for (const actorUuid of sidebarActorUuids) {
					const actor = foundry.utils.fromUuidSync(actorUuid);
					if (!actor || actor.id === this.actor?.id) continue;
					const allTags = actor.sheet?._buildAllRollTags?.() ?? [];
					const found = allTags.find((t) => t.uuid === id);
					if (found) {
						this.setSelection(id, "", null, {
							effectUuid: found.uuid,
							contributorActorId: actor.id,
							contributorActorName: actor.name,
							contributorActorImg:
								actor.prototypeToken?.texture?.src || actor.img,
						});
						break;
					}
				}
			}
			// Non-owner player: look up from own character
			if (!this.#selectionMap.has(id)) {
				const ownCharacter = game.user.character;
				if (ownCharacter) {
					const ownTags = ownCharacter.sheet?._buildAllRollTags?.() ?? [];
					const found = ownTags.find((t) => t.uuid === id);
					if (found) {
						this.setSelection(id, "", null, {
							effectUuid: found.uuid,
							contributorActorId: ownCharacter.id,
							contributorActorName: ownCharacter.name,
							contributorActorImg:
								ownCharacter.prototypeToken?.texture?.src || ownCharacter.img,
						});
					}
				}
			}
		}

		// Check permission: non-owners can only modify tags they contributed or unclaimed tags
		const existingSel = this.getSelection(id);
		if (!this.#canModifyTag(existingSel)) {
			this.#revertTagChange(target, existingSel.state);
			return;
		}

		// Burn cap: only one tag may be burned per roll (p.158).
		if (value === "scratched") {
			for (const [otherId, entry] of this.#selectionMap) {
				if (otherId !== id && entry.state === "scratched") {
					ui.notifications?.warn(t("LITM.Ui.burn_cap_warning"));
					this.#revertTagChange(target, existingSel.state);
					return;
				}
			}
		}

		const contributorId = value ? game.user.id : null;
		this.setSelection(id, value, contributorId);

		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	addTag(tag, toScratch) {
		const state =
			tag.type === "weakness_tag"
				? "negative"
				: toScratch
					? "scratched"
					: "positive";
		this.setSelection(tag.uuid ?? tag.id ?? tag._id, state, game.user.id);
	}

	removeTag(tag) {
		this.setSelection(tag.uuid ?? tag.id ?? tag._id, "");
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	setCharacterTagState(tagId, state) {
		const contributorId = state ? game.user.id : null;
		this.setSelection(tagId, state || "", contributorId);
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	reset() {
		this.#cachedTotalPower = null;
		this.clearSelections();
		this.#modifier = 0;
		this.#might = 0;
		this.#tradePower = 0;
		this.#sacrificeLevel = "painful";
		this.#sacrificeThemeId = null;
		this.#sacrificeStatusName = "";
		this.#actionUuid = null;
		this.#actionDoc = null;
		this.#sojournBonus = 0;
		this.rollName = "";
		this.type = "quick";
		if (this.rendered) this.close();
		if (this.actor?.sheet?.rendered) this.actor.sheet.render(true);
	}

	async updatePresence(isOpen) {
		if (!this.isOwner) return;
		if (isOpen) {
			const existing = this.actor?.getFlag("litmv2", "rollDialogOwner");
			await this.actor?.setFlag("litmv2", "rollDialogOwner", {
				ownerId: this.ownerId,
				// Preserve the original openedAt across type changes so the
				// banner watcher doesn't re-fire on every setType refresh.
				openedAt: existing?.openedAt ?? Date.now(),
				type: this.type ?? "quick",
			});
		} else {
			await this.actor?.unsetFlag("litmv2", "rollDialogOwner");
		}
	}

	async close(options) {
		const wasRendered = this.rendered;
		const shouldClosePresence = this.isOwner;
		const result = await super.close(options);
		if (shouldClosePresence) {
			await this.updatePresence(false);
			if (wasRendered)
				Sockets.dispatch("closeRollDialog", { actorId: this.actorId });
		}
		if (wasRendered) Hooks.callAll("litm.rollDialogClosed", this.actor);
		return result;
	}

	#handleTypeChange(target) {
		this.type = target.value;
		// Update active state on toggle bar — use closest bar to scope the query
		const bar = target.closest(".litm--roll-type-bar");
		if (bar) {
			for (const label of bar.children) {
				const radio = label.querySelector("input[type='radio']");
				if (radio)
					label.classList.toggle("is-active", radio.value === this.type);
			}
		}
		this.#toggleSacrificeMode(this.type === "sacrifice");
		this.#toggleTradePower(this.type === "tracked");
		this.#dispatchUpdate();
	}

	#toggleSacrificeMode(isSacrifice) {
		if (!this.element) return;
		// Hide might/modifier and total power for sacrifice rolls
		const mightFieldset = this.element
			.querySelector(".litm--roll-dialog-might")
			?.closest("fieldset");
		const totalPowerEl = this.element.querySelector(
			".litm--roll-dialog-total-power",
		);
		const sacrificeFieldset = this.element.querySelector(
			".litm--sacrifice-level-fieldset",
		);
		const tagsFieldset = this.element.querySelector(
			".litm--roll-dialog-tags-fieldset",
		);
		// The owner-view tag-category nav lives in the same column wrapper
		// as the tags fieldset — hide them together so the column collapses
		// entirely during sacrifice rolls instead of leaving an orphan nav.
		const tagsColumn = this.element.querySelector(
			".litm--roll-dialog-tags-column",
		);
		const typeBar = this.element.querySelector(".litm--roll-type-bar");
		if (mightFieldset) mightFieldset.classList.toggle("hidden", isSacrifice);
		if (totalPowerEl) totalPowerEl.classList.toggle("hidden", isSacrifice);
		if (sacrificeFieldset)
			sacrificeFieldset.classList.toggle("hidden", !isSacrifice);
		if (tagsFieldset) tagsFieldset.classList.toggle("hidden", isSacrifice);
		if (tagsColumn) tagsColumn.classList.toggle("hidden", isSacrifice);
		// Sacrifice is its own ritual — quick/tracked/mitigate make no sense
		// during it. Hide the roll-type bar entirely in sacrifice mode.
		if (typeBar) typeBar.classList.toggle("hidden", isSacrifice);
		// Toggle level-specific subfields (theme selector + grave status input)
		this.#toggleSacrificeSubfields(isSacrifice ? this.#sacrificeLevel : null);
	}

	#toggleSacrificeSubfields(level) {
		if (!this.element) return;
		const themeFieldset = this.element.querySelector(
			".litm--sacrifice-theme-fieldset",
		);
		const graveFieldset = this.element.querySelector(
			".litm--sacrifice-grave-fieldset",
		);
		// Theme selector is shown for every sacrifice level — it represents
		// the theme that is paid (painful/scarring) or the theme to lose on
		// Miracle (grave). Hidden only when sacrifice mode itself is off.
		const showTheme =
			level === "painful" || level === "scarring" || level === "grave";
		if (themeFieldset) themeFieldset.classList.toggle("hidden", !showTheme);
		// Grave-only: status name input for the tier-6 status on fail/snc.
		if (graveFieldset)
			graveFieldset.classList.toggle("hidden", level !== "grave");
	}

	#handleSacrificeLevelChange(target) {
		const level = target.value;
		if (!level || level === this.#sacrificeLevel) return;
		this.#sacrificeLevel = level;
		const root = this.element;
		if (root) {
			for (const label of root.querySelectorAll(
				"[data-action='setSacrificeLevel']",
			)) {
				label.classList.toggle("is-active", label.dataset.level === level);
			}
		}
		this.#toggleSacrificeSubfields(this.#sacrificeLevel);
		this.#dispatchUpdate();
	}

	#handleSacrificeThemeChange(target) {
		this.#sacrificeThemeId = target.value || null;
		this.#dispatchUpdate();
	}

	#handleSacrificeStatusNameChange(target) {
		this.#sacrificeStatusName = target.value || "";
		this.#dispatchUpdate();
	}

	#ensureSacrificeThemeSelected() {
		if (!this.actor) return [];
		const themes = this.actor.items
			.filter(
				(i) =>
					(i.type === "theme" && !i.system.isFellowship) ||
					i.type === "story_theme",
			)
			.sort((a, b) => a.sort - b.sort);
		// Auto-select first theme if none selected
		if (!this.#sacrificeThemeId && themes.length > 0) {
			this.#sacrificeThemeId = themes[0].id;
		}
		const trackPips = (value) =>
			Array.from({ length: 3 }, (_, i) => ({ filled: i < (value ?? 0) }));
		return themes.map((theme) => {
			const effects = [...theme.effects];
			const powerTags = effects
				.filter(
					(e) =>
						(e.type === "power_tag" || e.type === "fellowship_tag") &&
						!e.disabled &&
						!e.system?.isTitleTag,
				)
				.map((e) => e.name);
			const weaknessTags = effects
				.filter((e) => e.type === "weakness_tag" && !e.disabled)
				.map((e) => e.name);
			const specialImprovements = (theme.system?.specialImprovements ?? [])
				.filter((si) => si.isActive && (si.name || "").trim())
				.map((si) => si.name);
			const level = theme.system?.level || "";
			return {
				id: theme.id,
				name: theme.name,
				themebook: theme.system?.themebook || "",
				level,
				levelLabel: level ? game.i18n.localize(`LITM.Terms.${level}`) : "",
				quest: theme.system?.quest?.description || "",
				powerTags,
				weaknessTags,
				specialImprovements,
				hasTags: powerTags.length + weaknessTags.length > 0,
				tracks: [
					{
						label: game.i18n.localize("LITM.Themes.abandon"),
						pips: trackPips(theme.system?.quest?.tracks?.abandon?.value),
					},
					{
						label: game.i18n.localize("LITM.Ui.improve"),
						pips: trackPips(theme.system?.improve?.value),
					},
					{
						label: game.i18n.localize("LITM.Themes.milestone"),
						pips: trackPips(theme.system?.quest?.tracks?.milestone?.value),
					},
				],
				selected: theme.id === this.#sacrificeThemeId,
			};
		});
	}

	#toggleTradePower(isTracked) {
		if (!this.element) return;
		const fieldset = this.element.querySelector(".litm--trade-power-fieldset");
		if (fieldset) fieldset.classList.toggle("hidden", !isTracked);
		if (!isTracked && this.#tradePower !== 0) {
			this.#resetTradePower();
			this.#updateTotalPower();
		}
	}

	#handleTradePowerChange(target) {
		this.#cachedTotalPower = null;
		this.#tradePower = Number(target.value) || 0;
		// Update active state on trade power bar
		this.element
			.querySelectorAll(".litm--trade-power-bar .litm--roll-type-option")
			.forEach((label) => {
				const radio = label.querySelector("input[type='radio']");
				label.classList.toggle(
					"is-active",
					radio?.value === String(this.#tradePower),
				);
			});
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	#handleMightChange(target) {
		this.#cachedTotalPower = null;
		this.#might = Number(target.value) || 0;
		this.element.querySelectorAll(".litm--might-option").forEach((label) => {
			const radio = label.querySelector("input[type='radio']");
			label.classList.toggle("is-active", radio?.value === String(this.#might));
		});
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	/** @type {HTMLElement|null} Cached by _onRender. */
	#totalPowerEl = null;
	/** @type {HTMLInputElement|null} Cached by _onRender. */
	#hedgeRadioEl = null;
	/** @type {HTMLInputElement|null} Cached by _onRender. */
	#cautionRadioEl = null;

	#updateTotalPower() {
		if (!this.element) return;
		const totalPower = this.totalPower;
		this.#totalPowerEl ??= this.element.querySelector(
			"[data-update='totalPower']",
		);
		this.#hedgeRadioEl ??= this.element.querySelector(
			"input[name='tradePower'][value='1']",
		);
		this.#cautionRadioEl ??= this.element.querySelector(
			"input[name='tradePower'][value='-1']",
		);

		if (this.#cautionRadioEl) {
			const canCaution = totalPower <= 2;
			this.#cautionRadioEl.disabled = !canCaution;
			this.#cautionRadioEl
				.closest(".litm--roll-type-option")
				?.classList.toggle("is-disabled", !canCaution);
			if (!canCaution && this.#tradePower === -1) this.#resetTradePower();
		}

		if (this.#hedgeRadioEl) {
			const canHedge = totalPower >= 2;
			this.#hedgeRadioEl.disabled = !canHedge;
			this.#hedgeRadioEl
				.closest(".litm--roll-type-option")
				?.classList.toggle("is-disabled", !canHedge);
			if (!canHedge && this.#tradePower === 1) this.#resetTradePower();
		}

		if (this.#totalPowerEl) {
			const trade = this.#tradePower;
			if (trade) {
				const rollPower = totalPower + trade;
				const spendPower = Math.max(totalPower - trade, 1);
				this.#totalPowerEl.innerHTML = `${totalPower} <span class="litm--trade-annotation">(${t("LITM.Terms.roll")}: ${rollPower >= 0 ? "+" : ""}${rollPower}, ${t("LITM.Ui.spend_power")}: ${spendPower})</span>`;
			} else {
				this.#totalPowerEl.textContent = totalPower;
			}
		}
	}

	#resetTradePower() {
		this.#cachedTotalPower = null;
		this.#tradePower = 0;
		const noneRadio = this.element.querySelector(
			"input[name='tradePower'][value='0']",
		);
		if (noneRadio) noneRadio.checked = true;
		this.element
			.querySelectorAll(".litm--trade-power-bar .litm--roll-type-option")
			.forEach((label) => {
				const radio = label.querySelector("input[type='radio']");
				label.classList.toggle("is-active", radio?.value === "0");
			});
	}

	async _createModerationRequest(data) {
		const id = foundry.utils.randomID();
		const userId = game.user.id;
		const type = data.type || "quick";
		const isSacrifice = type === "sacrifice";
		// Sacrifice rolls are pure 2d6 — tags and Power don't contribute, so
		// the tooltip/total-power block is irrelevant on the moderation card.
		const preview = isSacrifice
			? null
			: buildRollPreview({
					tags: data.tags,
					modifier: data.modifier,
					might: data.might,
				});
		const actionName =
			this.rollName || this.actionDoc?.name || data.title || "";
		const sacrificeLevelLabel =
			isSacrifice && data.sacrificeLevel
				? t(`LITM.Ui.sacrifice_${data.sacrificeLevel}`)
				: "";
		const themeName =
			isSacrifice && data.sacrificeThemeId
				? this.actor?.items?.get(data.sacrificeThemeId)?.name || ""
				: "";
		const rollTypeLabel = t(`LITM.Ui.roll_${type}`);
		await foundry.documents.ChatMessage.create({
			content: await foundry.applications.handlebars.renderTemplate(
				"systems/litmv2/templates/chat/moderation.html",
				{
					title: t("LITM.Ui.roll_moderation"),
					id: this.actor.id,
					rollId: id,
					type,
					isSacrifice,
					actionName,
					rollTypeLabel,
					sacrificeLevel: data.sacrificeLevel,
					sacrificeLevelLabel,
					sacrificeThemeId: data.sacrificeThemeId,
					themeName,
					name: this.actor.name,
					hasTooltipData: preview?.hasTooltipData ?? false,
					tooltipData: preview?.tooltipData ?? {},
					totalPower: preview?.totalPower ?? 0,
				},
			),
			flags: { litmv2: { id, userId, data: { ...data, type } } },
		});
	}

	#dispatchUpdate() {
		// Strip non-serializable AE references from selection entries
		const selections = [...this.#selectionMap].map(([id, entry]) => {
			const { effect, ...serializable } = entry;
			return [id, serializable];
		});
		Sockets.dispatch("updateRollDialog", {
			actorId: this.actorId,
			selections,
			type: this.type,
			modifier: this.#modifier,
			might: this.#might,
			tradePower: this.#tradePower,
			sacrificeLevel: this.#sacrificeLevel,
			sacrificeThemeId: this.#sacrificeThemeId,
			sacrificeStatusName: this.#sacrificeStatusName,
			ownerId: this.ownerId,
		});
	}

	dispatchSync() {
		this.#dispatchUpdate();
	}

	async receiveUpdate({
		selections,
		actorId,
		type,
		modifier,
		might,
		tradePower,
		sacrificeLevel,
		sacrificeThemeId,
		sacrificeStatusName,
		ownerId,
	}) {
		if (actorId !== this.actorId) return;

		this.#cachedTotalPower = null;
		if (type !== undefined) this.type = type;
		if (modifier !== undefined) this.#modifier = modifier;
		if (might !== undefined) this.#might = might;
		if (tradePower !== undefined) this.#tradePower = tradePower;
		if (sacrificeLevel !== undefined) this.#sacrificeLevel = sacrificeLevel;
		if (sacrificeThemeId !== undefined)
			this.#sacrificeThemeId = sacrificeThemeId;
		if (sacrificeStatusName !== undefined)
			this.#sacrificeStatusName = sacrificeStatusName;
		if (ownerId !== undefined) this.ownerId = ownerId;

		// Merge selectionMap: prefer local entries where this user contributed
		if (selections) {
			const incoming = new Map(selections);
			const merged = new Map(incoming);
			for (const [id, local] of this.#selectionMap) {
				if (local.contributorId === game.user.id && local.state) {
					merged.set(id, local);
				}
			}
			this.#selectionMap = merged;
		}

		if (this.actor?.sheet?.rendered) this.actor.sheet.render();
		if (this.rendered) this.render();
	}
}
