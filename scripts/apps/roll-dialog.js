import { ACTOR_TAG_TYPES, ALL_TAG_TYPES, EFFECT_GROUP_LABELS, EFFECT_TAG_ORDER } from "../system/config.js";
import { LitmRoll } from "./roll.js";
import { Sockets } from "../system/sockets.js";
import { effectToPlain, getStoryTagSidebar, localize as t, viewLinkedRefAction } from "../utils.js";
import { executeRoll, resolveRollDialogOwnership } from "./roll-pipeline.js";
import { buildActionContext } from "./roll-dialog-context.js";
import { renderAction } from "../system/renderers/action-renderer.js";
import { LitmEmbedPopout } from "./embed-popout.js";

export { resolveRollDialogOwnership };

const sortByTypeThenName = (tags, typeOrder) =>
	[...tags].sort((a, b) => {
		const typeA = typeOrder[a.type] ?? 99;
		const typeB = typeOrder[b.type] ?? 99;
		if (typeA !== typeB) return typeA - typeB;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

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
			height: 550,
		},
		form: {
			handler: LitmRollDialog._onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			sendToNarrator: LitmRollDialog.#onSendToNarrator,
			viewLinkedRef: viewLinkedRefAction,
			viewActionCard: LitmRollDialog.#onViewActionCard,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/roll-dialog.html",
			scrollable: [".litm--roll-dialog-tags-fieldset", ".litm--roll-dialog-tags-fieldset section.tab"],
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

	/** Open the linked action's read-only embed card in a popout — the action
	 *  sheet is an editor, not a reference view. */
	static async #onViewActionCard() {
		if (!this.#actionDoc) return;
		new LitmEmbedPopout({ document: this.#actionDoc, render: renderAction }).render(true);
	}

	extractRollData(formData) {
		const data = foundry.utils.expandObject(formData.object);
		const { actorId, title, type, modifier, might, tradePower, sacrificeLevel, sacrificeThemeId } = data;
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
	#ownerId = null;
	#cachedTotalPower = null;
	#actionUuid = null;
	#actionDoc = null;

	constructor(options = {}) {
		if (options.actorId) options.id = `litm-roll-dialog-${options.actorId}`;
		super(options);

		this.#modifier = options.modifier || 0;
		this.#might = Number(options.might) || 0;
		this.#tradePower = options.tradePower || 0;
		this.#sacrificeLevel = options.sacrificeLevel || "painful";
		this.#sacrificeThemeId = options.sacrificeThemeId || null;
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
		if (this.#actionDoc?.name && !this.rollName) this.rollName = this.#actionDoc.name;
		return this.#actionDoc;
	}

	get actionUuid() {
		return this.#actionUuid;
	}

	setAction(uuid) {
		this.#actionUuid = uuid || null;
		this.#actionDoc = null;
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
		return this.#selectionMap.get(effectId) ?? { state: "", contributorId: null, effect: null, effectUuid: null };
	}

	setSelection(effectId, state, contributorId = null, { effect = null, effectUuid = null, ...contributorMeta } = {}) {
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
				...(Object.keys(contributorMeta).length ? contributorMeta : {
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
			.filter((actor) => actor.id !== this.actor.uuid && actor.id !== fellowshipUuid)
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
			modifier: this.#modifier,
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
		if (effect) { entry.effect = effect; return effect; }
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
				value: effect.type === "status_tag" ? (effect.system?.currentTier ?? 0) : undefined,
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
				.map((e) => e.tagId).filter(Boolean),
		);
		const negativeSuggestedIds = new Set(
			(action?.system.power?.negativeTags ?? [])
				.map((e) => e.tagId).filter(Boolean),
		);

		const decorateTag = (tag) => {
			const contributorId = tag.contributorId || null;
			const isOpposition =
				tag.actorType === "challenge" || tag.actorType === "journey";
			const states = isOpposition
				? ",negative,positive"
				: (tag.system?.allowedStates ?? tag.states ?? ",positive,negative");
			const tagId = tag.id ?? tag._id;
			return {
				...tag,
				_id: tag._id ?? tag.id,
				id: tagId,
				key: tag.uuid ?? tag.id ?? tag._id,
				contributorId,
				displayName: tag.displayName || tag.name,
				locked: !isOwner && contributorId && contributorId !== currentUserId,
				states,
				value: tag.type === "status_tag" ? (tag.system?.currentTier ?? tag.value ?? 0) : undefined,
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
		const sceneStoryItems = allStoryItems.filter((tag) => tag.actorName === null);
		const storyTagGroups = sceneStoryItems.length
			? [{ actorName: null, actorImg: null, tags: sceneStoryItems }]
			: [];

		const shared = { decorateTag, tagTypeOrder, allStoryItems, sceneStoryItems, isOwner, isGMViewer };
		return { shared, gmTagGroups, storyTagGroups };
	}

	async _prepareContext(_options) {
		await getStoryTagSidebar()?.loadStoryTags?.();
		await this.#resolveAction();

		const isOwner = this.isOwner;
		const isGMViewer = game.user.isGM && !isOwner;

		const actionContext = buildActionContext({ action: this.#actionDoc });

		const { shared, gmTagGroups, storyTagGroups } = this.#buildTagGroups({ isOwner, isGMViewer });

		let characterTagGroups = [];
		let fellowshipTagGroups = [];
		let gmViewerTabs = [];
		if (isGMViewer) {
			gmViewerTabs = this.#buildGmViewerContext(shared);
		} else {
			({ characterTagGroups, fellowshipTagGroups } = this.#buildOwnerContext(shared));
		}
		// Non-owners only see the rolling actor's tags that were selected
		if (!isOwner) {
			const filterSelected = (groups) => groups
				.map((g) => ({ ...g, tags: g.tags.filter((t) => t.state) }))
				.filter((g) => g.tags.length);
			characterTagGroups = filterSelected(characterTagGroups);
			fellowshipTagGroups = filterSelected(fellowshipTagGroups);
		}

		const contributedTagGroups = this.#buildContributedTagGroups(shared);

		return {
			actorId: this.actorId,
			characterTagGroups,
			fellowshipName: game.litmv2?.fellowship?.name ?? t("LITM.Terms.fellowship"),
			fellowshipTagGroups,
			contributedTagGroups,
			rollTypes: {
				quick: "LITM.Ui.roll_quick",
				tracked: "LITM.Ui.roll_tracked",
				mitigate: "LITM.Ui.roll_mitigate",
				sacrifice: "LITM.Ui.roll_sacrifice",
			},
			storyTagGroups,
			gmTagGroups,
			isGM: game.user.isGM,
			isGMViewer,
			gmViewerTabs,
			isOwner,
			title: this.rollName,
			type: this.type,
			totalPower: this.totalPower,
			modifier: this.#modifier,
			might: this.#might,
			mightRange: Array.from({ length: 13 }, (_, i) => i - 6),
			tradePower: this.#tradePower,
			canHedge: this.totalPower >= 2,
			sacrificeLevel: this.#sacrificeLevel,
			sacrificeLevelOptions: {
				painful: "LITM.Ui.sacrifice_painful",
				scarring: "LITM.Ui.sacrifice_scarring",
				grave: "LITM.Ui.sacrifice_grave",
			},
			sacrificeThemeId: this.#sacrificeThemeId,
			sacrificeThemes: this.#ensureSacrificeThemeSelected(),
			actionContext,
		};
	}

	/**
	 * Build per-actor tabs for GM viewers from the story tag sidebar actors.
	 * @param {object} shared - Shared context utilities from _prepareContext
	 * @returns {object[]} gmViewerTabs array
	 */
	#buildGmViewerContext({ decorateTag, tagTypeOrder, allStoryItems, sceneStoryItems, isOwner }) {
		const STORY_ACTOR_TYPES = new Set(["challenge", "journey", "story_theme"]);
		const gmViewerTabs = [];
		const storyGroups = [];
		const sidebarActors = this.#storyTagSidebar.actors ?? [];
		const sidebarActorIds = sidebarActors.map((a) => a.id);
		// Always include the rolling actor so the GM can see their tags
		const rollingUuid = this.actor.uuid;
		const storyTagActorIds = sidebarActorIds.includes(rollingUuid)
			? sidebarActorIds
			: [rollingUuid, ...sidebarActorIds];
		for (const actorId of storyTagActorIds) {
			const actor = foundry.utils.fromUuidSync(actorId);
			if (!actor) continue;
			const actorImg = actor.prototypeToken?.texture?.src || actor.img;
			const themeMap = new Map();
			// Use appliedEffects (active only) for GM viewer.
			// For actor-level effects (status_tag, story_tag, relationship_tag),
			// group by type rather than parent name to avoid a catch-all actor group.
			for (const e of actor.appliedEffects) {
				const sel = this.getSelection(e.uuid);
				const rawTag = effectToPlain(e);
				const tag = decorateTag({
					...rawTag,
					state: sel.state,
					contributorId: sel.contributorId,
				});
				// story_tag and status_tag effects always group by type so that
				// backpack-item tags and actor-level tags share one section.
				// Theme tags (power_tag, etc.) group by parent item.
				const groupByType = e.parent === actor
					|| ACTOR_TAG_TYPES.has(e.type);
				let groupKey, groupLabel, groupImg;
				if (groupByType) {
					groupKey = `__${e.type}`;
					const labelKey = EFFECT_GROUP_LABELS[e.type];
					groupLabel = labelKey ? t(labelKey)
						: e.type === "story_tag" ? (actor.system.backpackItem?.name ?? t("LITM.Terms.backpack"))
						: e.type;
					groupImg = e.type === "story_tag" ? (actor.system.backpackItem?.img ?? null) : null;
				} else {
					groupKey = rawTag.themeId ?? `__${rawTag.type}`;
					groupLabel = rawTag.themeName ?? rawTag.type;
					groupImg = e.parent?.img ?? null;
				}
				if (!themeMap.has(groupKey)) {
					themeMap.set(groupKey, {
						themeName: groupLabel,
						themeImg: groupImg,
						tags: [],
					});
				}
				themeMap.get(groupKey).tags.push(tag);
			}
			// Add actor story items to this tab
			const actorStory = allStoryItems
				.filter((tag) => tag.actorName === actor.name)
				.filter((tag) => isOwner || game.user.isGM || !!tag.state);
			if (actorStory.length) {
				themeMap.set("__actor_story", {
					themeName: t("LITM.Tags.story"),
					tags: sortByTypeThenName(actorStory, tagTypeOrder),
				});
			}
			const groups = [...themeMap.values()].map((g) => ({
				...g,
				tags: sortByTypeThenName(g.tags, tagTypeOrder),
			}));
			if (!groups.length) continue;
			if (STORY_ACTOR_TYPES.has(actor.type) && actor.id !== this.actorId) {
				for (const group of groups) {
					storyGroups.push({
						...group,
						themeName: group.themeName
							? `${actor.name} — ${group.themeName}`
							: actor.name,
						themeImg: group.themeImg ?? actorImg,
					});
				}
			} else {
				gmViewerTabs.push({
					id: actor.id,
					label: actor.name,
					actorImg,
					groups,
				});
			}
		}
		// Merged Story tab: scene-level story tags + challenge/journey/story_theme actors
		const mergedStoryTab = (sceneStoryItems.length || storyGroups.length)
			? {
					id: "__story",
					label: t("LITM.Tags.story"),
					icon: "fa-solid fa-tags",
					groups: [
						...(sceneStoryItems.length
							? [{ themeName: null, tags: sceneStoryItems }]
							: []),
						...storyGroups,
					],
				}
			: null;
		// Sort: rolling actor first, then Story, then Fellowship, then other heroes
		const fellowshipId = game.litmv2?.fellowship?.id;
		const rollingActorTab = gmViewerTabs.find((t) => t.id === this.actorId);
		const fellowshipTab = fellowshipId
			? gmViewerTabs.find((t) => t.id === fellowshipId)
			: null;
		const otherTabs = gmViewerTabs.filter(
			(t) => t.id !== this.actorId && t.id !== fellowshipId,
		);
		gmViewerTabs.length = 0;
		if (rollingActorTab) gmViewerTabs.push(rollingActorTab);
		if (mergedStoryTab) gmViewerTabs.push(mergedStoryTab);
		if (fellowshipTab) gmViewerTabs.push(fellowshipTab);
		gmViewerTabs.push(...otherTabs);
		// Initialize native tab group tracking
		const initialTab = gmViewerTabs[0]?.id;
		this.tabGroups["gm-viewer"] ??= initialTab;
		for (const tab of gmViewerTabs) {
			tab.cssClass = this.tabGroups["gm-viewer"] === tab.id ? "active" : "";
		}
		return gmViewerTabs;
	}

	/**
	 * Build character and fellowship tag groups for the dialog owner.
	 * @param {object} shared - Shared context utilities from _prepareContext
	 * @returns {{ characterTagGroups: object[], fellowshipTagGroups: object[] }}
	 */
	#buildOwnerContext({ decorateTag }) {
		const characterTagGroups = [];
		const fellowshipTagGroups = [];
		const sys = this.actor?.system;
		if (!sys) return { characterTagGroups, fellowshipTagGroups };

		const withSelection = (effect) => {
			const sel = this.getSelection(effect.uuid);
			return decorateTag({
				_id: effect._id,
				id: effect.id ?? effect._id,
				uuid: effect.uuid,
				name: effect.name,
				type: effect.type,
				system: effect.system,
				parent: effect.parent,
				state: sel.state,
				contributorId: sel.contributorId,
			});
		};

		// Hero themes
		for (const { theme, tags } of sys.themes) {
			const activeTags = tags.filter((e) => e.active).map(withSelection);
			if (activeTags.length) {
				characterTagGroups.push({
					themeName: theme.name,
					themeImg: theme.img,
					tags: activeTags,
				});
			}
		}

		// Backpack / story tags — use storyTags (allApplicableEffects) to catch
		// story_tag effects regardless of whether they live on the backpack item
		// or directly on the actor.
		const isVisibleTag = (e) => e.active && (game.user.isGM || !e.system?.isHidden);
		const backpackTags = (sys.storyTags ?? sys.backpack ?? []).filter(isVisibleTag).map(withSelection);
		if (backpackTags.length) {
			const backpackItem = this.actor.system.backpackItem;
			characterTagGroups.push({
				themeName: backpackItem?.name ?? t("LITM.Terms.backpack"),
				themeImg: backpackItem?.img ?? null,
				tags: backpackTags,
			});
		}

		// Hero statuses
		const heroStatuses = sys.statusEffects.filter(isVisibleTag).map(withSelection);
		if (heroStatuses.length) {
			characterTagGroups.push({
				themeName: t("LITM.Terms.statuses"),
				icon: "fa-solid fa-droplet",
				tags: heroStatuses,
			});
		}

		// Fellowship
		const fellowship = sys.fellowship;
		for (const { theme, tags } of fellowship.themes) {
			const activeTags = tags.filter((e) => e.active).map(withSelection);
			if (activeTags.length) {
				fellowshipTagGroups.push({
					themeName: theme.name,
					themeImg: theme.img,
					tags: activeTags,
				});
			}
		}
		const fellowshipTags = fellowship.tags.filter((e) => e.active).map(withSelection);
		if (fellowshipTags.length) {
			fellowshipTagGroups.push({
				themeName: t("LITM.Tags.tags_and_statuses"),
				icon: "fa-solid fa-tags",
				tags: fellowshipTags,
			});
		}

		// Relationship tags
		const relTags = sys.relationships.filter((e) => e.name).map(withSelection);
		if (relTags.length) {
			fellowshipTagGroups.push({
				themeName: t("LITM.Terms.relationship"),
				icon: "fa-solid fa-handshake",
				tags: relTags,
			});
		}

		return { characterTagGroups, fellowshipTagGroups };
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
				const themeImg = rawTag.themeId ? (actor.items.get(rawTag.themeId)?.img ?? null) : null;
				if (!themeMap.has(themeKey)) {
					themeMap.set(themeKey, { themeName: themeLabel, themeImg, tags: [] });
				}
				themeMap.get(themeKey).tags.push(tag);
			}
		}
		// Non-owners see their own character's tags for contribution
		if (!isOwner && !game.user.isGM) {
			const ownCharacter = game.user.character;
			if (
				ownCharacter &&
				ownCharacter.id !== this.actorId
			) {
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
		return [...contributedActorMap.values()].map(
			(entry) => ({
				actorName: entry.actorName,
				actorImg: entry.actorImg,
				themeGroups: [...entry.themeMap.values()].map((g) => ({
					...g,
					tags: sortByTypeThenName(g.tags, tagTypeOrder),
				})),
			}),
		);
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
			} else if (target.matches("[data-update='sacrificeLevel']")) {
				this.#handleSacrificeLevelChange(target);
			} else if (target.matches("[data-update='sacrificeThemeId']")) {
				this.#handleSacrificeThemeChange(target);
			} else if (target.matches("input[name='type']")) {
				this.#handleTypeChange(target);
			}
		});

		// Delegated click handler for tag label interactions (click to toggle, shift-click to scratch)
		this.element.addEventListener("click", (event) => {
			const label = event.target.closest("label.litm--roll-dialog-tag");
			if (!label || event.target.tagName === "LITM-SUPER-CHECKBOX") return;
			event.preventDefault();
			const checkbox = label.querySelector("litm-super-checkbox");
			if (!checkbox) return;

			if (event.shiftKey && !checkbox.disabled) {
				const canScratch = checkbox.getAttribute("states")?.includes("scratched");
				if (canScratch) {
					const newValue =
						checkbox.value === "scratched" ? "" : "scratched";
					checkbox.value = newValue;
					checkbox.dispatchEvent(new Event("change"));
					return;
				}
			}
			checkbox.click();
		});
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#totalPowerEl = null;
		this.#hedgeRadioEl = null;
		Hooks.callAll("litm.rollDialogRendered", this.actor, this);

		// Might scale tooltip (depends on elements recreated each render)
		const mightLabel = this.element.querySelector(".litm--might-name-wrapper");
		const mightTooltipTemplate = this.element.querySelector(".litm--might-tooltip-template");
		if (mightLabel && mightTooltipTemplate) {
			const tooltipContent = mightTooltipTemplate.content.firstElementChild.cloneNode(true);
			mightLabel.addEventListener("pointerenter", () => {
				game.tooltip.activate(mightLabel, { html: tooltipContent, direction: "DOWN" });
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
				const sidebarActorUuids = this.#storyTagSidebar.actors?.map((a) => a.id) ?? [];
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
							contributorActorImg: actor.prototypeToken?.texture?.src || actor.img,
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
							contributorActorImg: ownCharacter.prototypeToken?.texture?.src || ownCharacter.img,
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
		if (this.rendered) this.close();
		if (this.actor?.sheet?.rendered) this.actor.sheet.render(true);
	}

	async updatePresence(isOpen) {
		if (!this.isOwner) return;
		if (isOpen) {
			await this.actor?.setFlag("litmv2", "rollDialogOwner", {
				ownerId: this.ownerId,
				openedAt: Date.now(),
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
			if (wasRendered) Sockets.dispatch("closeRollDialog", { actorId: this.actorId });
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
				if (radio) label.classList.toggle("is-active", radio.value === this.type);
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
		if (mightFieldset) mightFieldset.classList.toggle("hidden", isSacrifice);
		if (totalPowerEl) totalPowerEl.classList.toggle("hidden", isSacrifice);
		if (sacrificeFieldset)
			sacrificeFieldset.classList.toggle("hidden", !isSacrifice);
		if (tagsFieldset) tagsFieldset.classList.toggle("hidden", isSacrifice);
		// Also toggle the theme selector based on current level
		if (isSacrifice) {
			this.#toggleSacrificeThemeSelector(this.#sacrificeLevel);
		} else {
			this.#toggleSacrificeThemeSelector(null);
		}
	}

	#handleSacrificeLevelChange(target) {
		this.#sacrificeLevel = target.value;
		this.#toggleSacrificeThemeSelector(this.#sacrificeLevel);
		this.#dispatchUpdate();
	}

	#handleSacrificeThemeChange(target) {
		this.#sacrificeThemeId = target.value || null;
		this.#dispatchUpdate();
	}

	#ensureSacrificeThemeSelected() {
		if (!this.actor) return {};
		const themes = this.actor.items
			.filter(
				(i) =>
					(i.type === "theme" && !i.system.isFellowship) ||
					i.type === "story_theme",
			)
			.sort((a, b) => a.sort - b.sort);
		const options = {};
		for (const theme of themes) {
			options[theme.id] = theme.name;
		}
		// Auto-select first theme if none selected
		if (!this.#sacrificeThemeId && themes.length > 0) {
			this.#sacrificeThemeId = themes[0].id;
		}
		return options;
	}

	#toggleSacrificeThemeSelector(level) {
		if (!this.element) return;
		const themeFieldset = this.element.querySelector(
			".litm--sacrifice-theme-fieldset",
		);
		if (themeFieldset) {
			const needsTheme = level === "painful" || level === "scarring";
			themeFieldset.classList.toggle("hidden", !needsTheme);
		}
	}

	#toggleTradePower(isTracked) {
		if (!this.element) return;
		const fieldset = this.element.querySelector(".litm--trade-power-fieldset");
		if (fieldset) fieldset.classList.toggle("hidden", !isTracked);
		// Reset trade power when switching away from tracked
		if (!isTracked && this.#tradePower !== 0) {
			this.#cachedTotalPower = null;
			this.#tradePower = 0;
			const checked = this.element.querySelector(
				"input[name='tradePower'][value='0']",
			);
			if (checked) checked.checked = true;
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
		this.element
			.querySelectorAll(".litm--might-option")
			.forEach((label) => {
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

	#updateTotalPower() {
		if (!this.element) return;
		const totalPower = this.totalPower;
		this.#totalPowerEl ??= this.element.querySelector("[data-update='totalPower']");
		this.#hedgeRadioEl ??= this.element.querySelector("input[name='tradePower'][value='1']");

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

		if (this.#hedgeRadioEl) {
			const canHedge = totalPower >= 2;
			this.#hedgeRadioEl.disabled = !canHedge;
			this.#hedgeRadioEl
				.closest(".litm--roll-type-option")
				?.classList.toggle("is-disabled", !canHedge);
			if (!canHedge && this.#tradePower === 1) {
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
		}
	}

	async _createModerationRequest(data) {
		const id = foundry.utils.randomID();
		const userId = game.user.id;
		const tags = LitmRoll.filterTags(data.tags);
		const { totalPower } = LitmRoll.calculatePower({
			...tags,
			modifier: data.modifier,
			might: data.might,
		});
		await foundry.documents.ChatMessage.create({
			content: await foundry.applications.handlebars.renderTemplate(
				"systems/litmv2/templates/chat/moderation.html",
				{
					title: t("LITM.Ui.roll_moderation"),
					id: this.actor.id,
					rollId: id,
					type: data.type,
					sacrificeLevel: data.sacrificeLevel,
					sacrificeThemeId: data.sacrificeThemeId,
					name: this.actor.name,
					hasTooltipData:
						tags.scratchedTags.length > 0 ||
						tags.powerTags.length > 0 ||
						tags.weaknessTags.length > 0 ||
						tags.positiveStatuses.length > 0 ||
						tags.negativeStatuses.length > 0 ||
						!!data.modifier,
					tooltipData: {
						...tags,
						modifier: data.modifier,
						might: data.might,
					},
					totalPower,
				},
			),
			flags: { litmv2: { id, userId, data } },
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
