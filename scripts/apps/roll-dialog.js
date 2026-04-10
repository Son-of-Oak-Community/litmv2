import { LitmRoll } from "./roll.js";
import { Sockets } from "../system/sockets.js";
import { localize as t, resolveEffect } from "../utils.js";

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
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/roll-dialog.html",
			scrollable: [".litm--roll-dialog-content"],
		},
	};

	static create(options) {
		return new LitmRollDialog(options);
	}

	static roll({
		actorId,
		tags,
		title,
		type,
		speaker,
		modifier = 0,
		might = 0,
		tradePower = 0,
		sacrificeLevel,
		sacrificeThemeId,
	}) {
		// Separate tags
		const {
			scratchedTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
		} = LitmRoll.filterTags(tags);

		// Values
		const {
			scratchedValue,
			powerValue,
			weaknessValue,
			positiveStatusValue,
			negativeStatusValue,
			totalPower,
			mightOffset,
		} = game.litmv2.methods.calculatePower({
			scratchedTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
			modifier: Number(modifier) || 0,
			might,
		});

		// Sacrifice rolls use only 2d6 — no Power is added.
		const defaultFormula =
			type === "sacrifice"
				? "2d6"
				: "2d6 + (@scratchedValue + @powerValue + @positiveStatusValue - @weaknessValue - @negativeStatusValue + @modifier + @mightOffset + @tradePower)";

		const formula =
			typeof CONFIG.litmv2.roll.formula === "function"
				? CONFIG.litmv2.roll.formula({
						scratchedTags,
						powerTags,
						weaknessTags,
						positiveStatuses,
						negativeStatuses,
						scratchedValue,
						powerValue,
						weaknessValue,
						positiveStatusValue,
						negativeStatusValue,
						totalPower,
						actorId,
						type,
						title,
						modifier,
						might,
						mightOffset,
					})
				: CONFIG.litmv2.roll.formula || defaultFormula;

		// Allow modules to cancel or modify the roll
		const actor = game.actors.get(actorId);
		if (
			Hooks.call("litm.preRoll", {
				tags,
				formula,
				modifier,
				power: totalPower,
				actor,
			}) === false
		) {
			return;
		}

		// Roll
		const roll = new game.litmv2.LitmRoll(
			formula,
			{
				scratchedValue,
				powerValue,
				positiveStatusValue,
				weaknessValue,
				negativeStatusValue,
				modifier: Number(modifier) || 0,
				mightOffset,
				tradePower: Number(tradePower) || 0,
			},
			{
				actorId,
				title,
				type,
				scratchedTags,
				powerTags,
				weaknessTags,
				positiveStatuses,
				negativeStatuses,
				speaker,
				totalPower,
				modifier,
				might,
				mightOffset,
				tradePower: Number(tradePower) || 0,
				sacrificeLevel,
				sacrificeThemeId,
			},
		);

		return roll
			.toMessage({
				speaker,
				flavor: title || roll.flavor,
			})
			.then(async (res) => {
				Hooks.callAll("litm.roll", roll, res);

				// Auto-scratch tags used in "scratched" state + single-use tags
				const actor = game.actors.get(actorId);
				const scratchTag = async (tag) => {
					// Actor-backed tags
					if (actor?.system?.toggleScratchTag) {
						await actor.system.toggleScratchTag(tag);
						return;
					}
					// Scene/sidebar tags — update settings storage
					const sidebar = game.litmv2.storyTags ?? ui.combat;
					if (sidebar?.tags && sidebar?.setTags) {
						const updated = sidebar.tags.map((t) =>
							t.id === tag.id ? { ...t, isScratched: true } : t,
						);
						await sidebar.setTags(updated);
					}
				};

				if (actor?.system) {
					for (const tag of scratchedTags) {
						await scratchTag(tag);
					}
					const allUsedTags = [...powerTags, ...weaknessTags];
					for (const tag of allUsedTags) {
						if (tag.system?.isSingleUse ?? tag.isSingleUse) {
							await scratchTag(tag);
						}
					}
					roll.options.isScratched = true;

					// Auto-gain improvement for weakness tags and relationship tags used as negatives
					const realWeaknessTags = weaknessTags.filter(
						(t) => t.type === "weakness_tag" || t.type === "relationship_tag",
					);
					for (const tag of realWeaknessTags) {
						await actor.system.gainImprovement(tag);
					}
					roll.options.gainedExp = true;

					if (scratchedTags.length > 0 || realWeaknessTags.length > 0) {
						await res.update({ rolls: [roll.toJSON()] });
					}
				}

				// Reset roll dialog
				res.rolls[0]?.actor?.sheet.resetRollDialog();
				Sockets.dispatch("resetRollDialog", { actorId });
				return res;
			});
	}



	static async _onSubmit(_event, _form, formData) {
		if (!this.isOwner) return;
		return LitmRollDialog.roll(this.extractRollData(formData));
	}

	static async #onSendToNarrator(_event, _target) {
		if (!this.isOwner) return;
		const formData = new foundry.applications.ux.FormDataExtended(this.element);
		const rollData = this.extractRollData(formData);
		await this._createModerationRequest(rollData);
		this.close();
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

	constructor(options = {}) {
		if (options.actorId) options.id = `litm-roll-dialog-${options.actorId}`;
		super(options);

		this.tagState = options.tagState || [];
		this.#modifier = options.modifier || 0;
		this.#might = Number(options.might) || 0;
		this.#tradePower = options.tradePower || 0;
		this.#sacrificeLevel = options.sacrificeLevel || "painful";
		this.#sacrificeThemeId = options.sacrificeThemeId || null;
		this.#ownerId = options.ownerId || null;

		this.actorId = options.actorId;
		this.speaker =
			options.speaker ||
			foundry.documents.ChatMessage.getSpeaker({ actor: this.actor });
		this.rollName = options.title || "";
		this.type = options.type || "quick";
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
		this.#selectionMap.clear();
	}

	get selections() {
		return this.#selectionMap;
	}

	#tagStateMap() {
		return new Map(this.tagState.map((t) => [t.id, t]));
	}

	get statuses() {
		const { tags } = game.litmv2.storyTags ?? ui.combat ?? { tags: [] };
		const sceneStatuses = tags
			.filter((tag) => tag.values?.some((v) => !!v))
			.map((tag) => ({ ...tag, actorName: null, actorImg: null }));
		const stateMap = this.#tagStateMap();
		return sceneStatuses.map((tag) => {
			const ts = stateMap.get(tag.id);
			return {
				...tag,
				state: ts?.state || "",
				contributorId: ts?.contributorId || null,
				states: ",positive,negative",
			};
		});
	}

	get tags() {
		if (!this.actor) return [];
		const { tags } = game.litmv2.storyTags ?? ui.combat ?? { tags: [] };
		const sceneTags = tags
			.filter((tag) => tag.values.every((v) => !v))
			.map((tag) => ({ ...tag, actorName: null, actorImg: null }));
		const stateMap = this.#tagStateMap();
		return sceneTags.map((tag) => {
			const ts = stateMap.get(tag.id);
			return {
				...tag,
				state: ts?.state || "",
				contributorId: ts?.contributorId || null,
				states: tag.isSingleUse
					? ",positive,negative"
					: ",positive,negative,scratched",
			};
		});
	}

	get gmTags() {
		if (!game.user.isGM) return [];

		const storyTags = game.litmv2.storyTags ?? ui.combat;
		if (!storyTags) return [];
		const { actors } = storyTags;
		const fellowshipId = game.litmv2?.fellowship?.id;
		const tags = actors
			.filter((actor) => actor.id !== this.actorId && actor.id !== fellowshipId)
			.flatMap((actor) =>
				actor.tags.map((tag) => ({
					...tag,
					actorName: actor.name,
					actorImg: actor.img,
					actorType: actor.type,
				})),
			);
		const stateMap = this.#tagStateMap();
		return tags.map((tag) => {
			const ts = stateMap.get(tag.id);
			return {
				...tag,
				state: ts?.state || "",
				contributorId: ts?.contributorId || null,
			};
		});
	}

	get totalPower() {
		const tags = this.#buildTagsFromMap();
		const filtered = LitmRoll.filterTags(tags);
		const { totalPower } = LitmRoll.calculatePower({
			...filtered,
			modifier: this.#modifier,
			might: this.#might,
		});
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
		const actor = this.actor;
		const effect = actor ? resolveEffect(effectId, actor) : null;
		if (effect) { entry.effect = effect; return effect; }
		// Search contributor actor (other hero contributing tags to this roll)
		if (entry.contributorActorId) {
			const contrib = game.actors.get(entry.contributorActorId);
			if (contrib) {
				const ce = resolveEffect(effectId, contrib, { fellowship: false });
				if (ce) { entry.effect = ce; return ce; }
			}
		}
		return null;
	}

	/**
	 * Build the tag array for a roll from the selection map.
	 * Each tag includes the full AE metadata (uuid, system, type).
	 * Scene tags from tagState are appended as-is.
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
		// Scene tags from tagState
		for (const t of this.tagState) {
			if (t.state) result.push(t);
		}
		return result;
	}

	async _prepareContext(_options) {
		const isOwner = this.isOwner;
		const isGMViewer = game.user.isGM && !isOwner;
		const currentUserId = game.user.id;
		const tagTypeOrder = {
			power_tag: 1,
			fellowship_tag: 2,
			weakness_tag: 3,
			relationship_tag: 4,
			story_tag: 5,
			status_tag: 6,
		};
		const decorateTag = (tag) => {
			const contributorId = tag.contributorId || null;
			const isOpposition =
				tag.actorType === "challenge" || tag.actorType === "journey";
			const states = isOpposition
				? ",negative,positive"
				: (tag.system?.allowedStates ?? tag.states ?? ",positive,negative");
			return {
				...tag,
				_id: tag._id ?? tag.id,
				id: tag.id ?? tag._id,
				contributorId,
				displayName: tag.displayName || tag.name,
				locked: !isOwner && contributorId && contributorId !== currentUserId,
				states,
				value: tag.type === "status_tag" ? (tag.system?.currentTier ?? 0) : undefined,
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

		let characterTagGroups = [];
		let fellowshipTagGroups = [];
		// GM viewer builds per-actor tabs from the story tag app
		const gmViewerTabs = [];
		if (isGMViewer) {
			const sidebarActors = game.litmv2.storyTags?.actors ?? [];
			const sidebarActorIds = sidebarActors.map((a) => a.id);
			// Always include the rolling actor so the GM can see their tags
			const storyTagActorIds = sidebarActorIds.includes(this.actorId)
				? sidebarActorIds
				: [this.actorId, ...sidebarActorIds];
			// Index sidebar actor data for non-hero actors (challenges/journeys)
			const sidebarActorMap = new Map(sidebarActors.map((a) => [a.id, a]));
			for (const actorId of storyTagActorIds) {
				const actor = game.actors.get(actorId);
				if (!actor) continue;
				const actorImg = actor.prototypeToken?.texture?.src || actor.img;
				const themeMap = new Map();
				// Heroes: use sheet's _buildAllRollTags for full tag list
				if (actor.sheet?._buildAllRollTags) {
					const actorTags = actor.sheet._buildAllRollTags();
					for (const rawTag of actorTags) {
						const sel = this.getSelection(rawTag.id);
						const tag = decorateTag({
							...rawTag,
							state: sel.state,
							contributorId: sel.contributorId,
						});
						const groupKey = rawTag.themeId ?? `__${rawTag.type}`;
						const groupLabel = rawTag.themeName ?? rawTag.type;
						if (!themeMap.has(groupKey)) {
							themeMap.set(groupKey, {
								themeName: groupLabel,
								tags: [],
							});
						}
						themeMap.get(groupKey).tags.push(tag);
					}
				}
				// Non-heroes (challenges/journeys): use sidebar tags
				const sidebarEntry = sidebarActorMap.get(actorId);
				if (sidebarEntry?.tags?.length && !actor.sheet?._buildAllRollTags) {
					for (const sTag of sidebarEntry.tags) {
						const sel = this.getSelection(sTag.id);
						const tag = decorateTag({
							...sTag,
							actorName: actor.name,
							actorImg,
							actorType: actor.type,
							state: sel.state,
							contributorId: sel.contributorId,
						});
						const groupKey = `__${sTag.type}`;
						if (!themeMap.has(groupKey)) {
							themeMap.set(groupKey, {
								themeName: actor.name,
								tags: [],
							});
						}
						themeMap.get(groupKey).tags.push(tag);
					}
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
				if (groups.length) {
					gmViewerTabs.push({
						id: actorId,
						label: actor.name,
						actorImg,
						groups,
					});
				}
			}
			// "Story" tab for scene-level story tags
			const storyTab = sceneStoryItems.length
				? {
						id: "__scene_story",
						label: t("LITM.Tags.story"),
						icon: "fa-solid fa-tags",
						groups: [{ themeName: null, tags: sceneStoryItems }],
					}
				: null;
			// Sort: rolling actor first, then Story, then Fellowship, then the rest
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
			if (storyTab) gmViewerTabs.push(storyTab);
			if (fellowshipTab) gmViewerTabs.push(fellowshipTab);
			gmViewerTabs.push(...otherTabs);
			// Initialize native tab group tracking
			const initialTab = gmViewerTabs[0]?.id;
			this.tabGroups["gm-viewer"] ??= initialTab;
			for (const tab of gmViewerTabs) {
				tab.cssClass = this.tabGroups["gm-viewer"] === tab.id ? "active" : "";
			}
		} else {
			// Owner path: build groups from the actor's structured getters
			const sys = this.actor?.system;
			if (sys) {
				const withSelection = (effect) => {
					const sel = this.getSelection(effect.id ?? effect._id);
					return decorateTag({
						_id: effect._id,
						id: effect.id ?? effect._id,
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

				// Backpack
				const backpackTags = sys.backpack.filter((e) => e.active).map(withSelection);
				if (backpackTags.length) {
					const backpackItem = this.actor.system.backpackItem;
					characterTagGroups.push({
						themeName: backpackItem?.name ?? t("LITM.Terms.backpack"),
						themeImg: backpackItem?.img ?? null,
						tags: backpackTags,
					});
				}

				// Hero statuses
				const heroStatuses = sys.statuses.filter((e) => e.active).map(withSelection);
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
			}
		}
		// Contributed tags from other characters, grouped by contributor
		const contributedActorMap = new Map();
		if (isOwner) {
			for (const [effectId, sel] of this.#selectionMap) {
				if (!sel.contributorActorId || !sel.state) continue;
				const actor = game.actors.get(sel.contributorActorId);
				if (!actor) continue;
				const allTags = actor.sheet?._buildAllRollTags?.() ?? [];
				const rawTag = allTags.find((t) => (t.id ?? t._id) === effectId);
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
				if (!themeMap.has(themeKey)) {
					themeMap.set(themeKey, { themeName: themeLabel, tags: [] });
				}
				themeMap.get(themeKey).tags.push(tag);
			}
		}
		// Non-owners see their own character's tags for contribution
		if (!isOwner && !game.user.isGM) {
			const ownCharacter = game.user.character;
			if (
				ownCharacter &&
				ownCharacter.id !== this.actorId &&
				ownCharacter.sheet?._buildAllRollTags
			) {
				const ownTags = ownCharacter.sheet._buildAllRollTags();
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
				for (const rawTag of ownTags) {
					const sel = this.getSelection(rawTag.id);
					const tag = decorateTag({
						...rawTag,
						state: sel.state,
						contributorId: sel.contributorId,
					});
					const themeKey = rawTag.themeId ?? `__${rawTag.type}`;
					const themeLabel = rawTag.themeName ?? rawTag.type;
					if (!themeMap.has(themeKey)) {
						themeMap.set(themeKey, {
							themeName: themeLabel,
							tags: [],
						});
					}
					themeMap.get(themeKey).tags.push(tag);
				}
			}
		}
		const contributedTagGroups = [...contributedActorMap.values()].map(
			(entry) => ({
				actorName: entry.actorName,
				actorImg: entry.actorImg,
				themeGroups: [...entry.themeMap.values()].map((g) => ({
					...g,
					tags: sortByTypeThenName(g.tags, tagTypeOrder),
				})),
			}),
		);
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
		};
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);

		// Delegated listener for checkbox changes
		this.element.addEventListener("change", (event) => {
			if (event.target.tagName === "LITM-SUPER-CHECKBOX") {
				this._onTagChange(event);
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

		// Setup might change listener (radio buttons)
		this.element
			.querySelectorAll("input[name='might']")
			.forEach((radio) => radio.addEventListener("change", this.#handleMightChange.bind(this)));

		// Might scale tooltip
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

		// Setup trade power change listener
		this.element
			.querySelectorAll("input[name='tradePower']")
			.forEach((input) => {
				input.addEventListener(
					"change",
					this.#handleTradePowerChange.bind(this),
				);
			});

		// Setup sacrifice level change listener
		this.element
			.querySelector("[data-update='sacrificeLevel']")
			?.addEventListener("change", this.#handleSacrificeLevelChange.bind(this));

		// Setup sacrifice theme change listener
		this.element
			.querySelector("[data-update='sacrificeThemeId']")
			?.addEventListener("change", this.#handleSacrificeThemeChange.bind(this));

		// Setup roll type change listener
		this.element.querySelectorAll("input[name='type']").forEach((input) => {
			input.addEventListener("change", this.#handleTypeChange.bind(this));
		});

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

	#assignContributor(tag, value) {
		if (!tag) return;
		if (!value) {
			tag.contributorId = null;
			return;
		}
		tag.contributorId = game.user.id;
	}

	#mergeTagState(local, incoming) {
		const localById = new Map(local.map((t) => [t.id, t]));
		const incomingById = new Map(incoming.map((t) => [t.id, t]));

		// For tags in both: prefer local if current user set state on it
		const merged = incoming.map((t) => {
			const localTag = localById.get(t.id);
			if (localTag?.contributorId === game.user.id && localTag.state) {
				return localTag;
			}
			return t;
		});

		// Add locally-contributed tags not present in incoming (race condition)
		for (const t of local) {
			if (
				t.contributorId === game.user.id &&
				t.state &&
				!incomingById.has(t.id)
			) {
				merged.push(t);
			}
		}

		return merged;
	}

	#revertTagChange(target, currentValue) {
		if (!target) return;
		target.value = currentValue || "";
	}

	_onTagChange(event) {
		const target = event.target;
		const { name: id, value } = target;
		const { type } = target.dataset;
		const isCharacterTag = [
			"power_tag",
			"weakness_tag",
			"fellowship_tag",
			"relationship_tag",
			"story_tag",
			"status_tag",
		].includes(type);
		// For non-owners, register contributor metadata on first interaction
		if (isCharacterTag && !this.isOwner && !this.#selectionMap.has(id)) {
			// GM viewer: look up from any sidebar actor
			if (game.user.isGM) {
				const sidebarActorIds = game.litmv2.storyTags?.actors?.map((a) => a.id) ?? [];
				for (const actorId of sidebarActorIds) {
					if (actorId === this.actorId) continue;
					const actor = game.actors.get(actorId);
					const allTags = actor?.sheet?._buildAllRollTags?.() ?? [];
					const found = allTags.find((t) => t.id === id);
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
					const found = ownTags.find((t) => t.id === id);
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

		switch (type) {
			case "power_tag":
			case "weakness_tag":
			case "fellowship_tag":
			case "relationship_tag":
			case "story_tag":
			case "status_tag": {
				const contributorId = value ? game.user.id : null;
				this.setSelection(id, value, contributorId);
				break;
			}
			default: {
				const existingTag = this.tagState.find((t) => t.id === id);
				if (existingTag) {
					existingTag.state = value;
					this.#assignContributor(existingTag, value);
				} else {
					const tag = [...this.tags, ...this.statuses, ...this.gmTags].find(
						(t) => t.id === id,
					);
					if (tag) {
						this.tagState.push({
							...tag,
							state: value,
							contributorId: value ? game.user.id : null,
						});
					}
				}
				this.setSelection(id, value, value ? game.user.id : null);
			}
		}

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
		this.setSelection(tag.id ?? tag._id, state, game.user.id);
	}

	removeTag(tag) {
		this.setSelection(tag.id ?? tag._id, "");
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
		this.tagState = [];
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

	#handleTypeChange(event) {
		this.type = event.currentTarget.value;
		// Update active state on toggle bar — use closest bar to scope the query
		const bar = event.currentTarget.closest(".litm--roll-type-bar");
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

	#handleSacrificeLevelChange(event) {
		const select = event.currentTarget;
		this.#sacrificeLevel = select.value;
		this.#toggleSacrificeThemeSelector(this.#sacrificeLevel);
		this.#dispatchUpdate();
	}

	#handleSacrificeThemeChange(event) {
		const select = event.currentTarget;
		this.#sacrificeThemeId = select.value || null;
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
			this.#tradePower = 0;
			const checked = this.element.querySelector(
				"input[name='tradePower'][value='0']",
			);
			if (checked) checked.checked = true;
		}
	}

	#handleTradePowerChange(event) {
		const input = event.currentTarget;
		this.#tradePower = Number(input.value) || 0;
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

	#handleMightChange(event) {
		const input = event.currentTarget;
		this.#might = Number(input.value) || 0;
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
		const { totalPower } = game.litmv2.methods.calculatePower({
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
			tagState: this.tagState,
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
		tagState,
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

		if (tagState) this.tagState = this.#mergeTagState(this.tagState, tagState);
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
