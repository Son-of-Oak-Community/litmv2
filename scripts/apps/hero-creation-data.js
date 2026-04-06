import { THEME_TAG_TYPES, POWER_TAG_TYPES } from "../system/config.js";
import { localize as t, powerTagEffect, weaknessTagEffect } from "../utils.js";
import { ContentSources } from "../system/content-sources.js";
const THEME_SLOTS = 4;

const LEVEL_ICONS = new Set(["origin", "adventure", "greatness", "variable"]);

// ---------------------------------------------------------------------------
// Pure transforms
// ---------------------------------------------------------------------------

/**
 * Convert legacy stashed tag flags into ActiveEffect entries on item data.
 * Old-format compendium items have tags stashed in flags.litmv2.legacyTags
 * by LitmItem.migrateData but no actual effects array. This injects the
 * effects so downstream code can work with a uniform shape.
 */
export function ensureLegacyEffects(data) {
	const effects = data.effects ?? [];
	if (effects.some((e) => THEME_TAG_TYPES.has(e.type))) {
		return data;
	}
	const legacy = data.flags?.litmv2?.legacyTags;
	if (!legacy) return data;

	const { powerTags = [], weaknessTags = [], isFellowship = false } = legacy;
	const powerType = isFellowship ? "fellowship_tag" : "power_tag";

	data.effects = [
		...effects,
		...powerTags.map((t) => powerTagEffect({
			name: t.name || "",
			isActive: t.isActive ?? false,
			question: t.question ?? null,
			isScratched: t.isScratched ?? false,
		})),
		...weaknessTags.map((t) => weaknessTagEffect({
			name: t.name || "",
			isActive: t.isActive ?? false,
			question: t.question ?? null,
		})),
	];

	// Add title tag effect
	if (data.name) {
		data.effects.push({
			name: data.name,
			type: powerType,
			disabled: false,
			system: { question: "0", isScratched: data.system?.isScratched ?? false, isTitleTag: true },
		});
	}

	delete data.flags.litmv2.legacyTags;
	return data;
}

/**
 * Convert tag arrays into ActiveEffect data for theme items.
 * Strips powerTags/weaknessTags from system data and adds effects array.
 */
export function tagsToEffects(data) {
	const sys = data.system || {};
	const powerTags = sys.powerTags || [];
	const weaknessTags = sys.weaknessTags || [];
	delete sys.powerTags;
	delete sys.weaknessTags;
	// Also handle story_theme nested path
	if (sys.theme) {
		const themePower = sys.theme.powerTags || [];
		const themeWeak = sys.theme.weaknessTags || [];
		delete sys.theme.powerTags;
		delete sys.theme.weaknessTags;
		powerTags.push(...themePower);
		weaknessTags.push(...themeWeak);
	}
	data.effects = (data.effects || []).concat(
		powerTags.map((tag) => powerTagEffect({
			name: tag.name || "",
			isActive: tag.isActive ?? false,
			question: tag.question ?? null,
			isScratched: tag.isScratched ?? false,
		})),
		weaknessTags.map((tag) => weaknessTagEffect({
			name: tag.name || "",
			isActive: tag.isActive ?? false,
			question: tag.question ?? null,
		})),
	);
	return data;
}

// ---------------------------------------------------------------------------
// HeroCreationData — data/index layer for the hero creation wizard
// ---------------------------------------------------------------------------

export class HeroCreationData {
	_cache = {
		loaded: false,
		tropes: [],
		themekits: [],
		themebooks: [],
		tropeDocs: new Map(),
		themeDocs: new Map(),
		themebookDocs: new Map(),
	};

	// ---------------------------------------------------------------------------
	// Index loading
	// ---------------------------------------------------------------------------

	async ensureIndexes() {
		if (this._cache.loaded) return;

		this._cache.tropes = await this.#loadPackIndex("tropes", "trope", [
			"name",
			"img",
			"type",
			"system.category",
		]);
		this._cache.themekits = await this.#loadPackIndex("themekits", "theme", [
			"name",
			"img",
			"type",
			"system.level",
		]);
		this._cache.themebooks = await this.#loadPackIndex("themebooks", "themebook", [
			"name",
			"img",
			"type",
			"system.theme_level",
		]);

		this._cache.loaded = true;
	}

	async #loadPackIndex(category, type, fields) {
		const packs = ContentSources.getPacks(category);
		const results = [];

		for (const pack of packs) {
			await pack.getIndex({ fields });
			for (const entry of pack.index?.contents || []) {
				if (entry.type !== type) continue;
				const id = entry._id ?? entry.id;
				const uuid =
					entry.uuid || (id ? `Compendium.${pack.collection}.${id}` : "");
				if (!uuid) continue;
				const level = entry.system?.theme_level || entry.system?.level || "";
				results.push({
					uuid,
					name: entry.name || "",
					img: entry.img || "",
					category: entry.system?.category || "",
					themeLevel: level,
					themeLevelIcon: HeroCreationData.#levelIcon(level),
					sourceLabel: pack.metadata?.label || pack.collection,
					tagTooltip: "",
				});
			}
		}

		for (const item of game.items) {
			if (item.type !== type) continue;
			const lvl = item.system?.theme_level || item.system?.level || "";
			results.push({
				uuid: item.uuid || item.id,
				name: item.name,
				img: item.img || "",
				category: item.system?.category || "",
				themeLevel: lvl,
				themeLevelIcon: HeroCreationData.#levelIcon(lvl),
				sourceLabel: "World",
				tagTooltip: HeroCreationData.buildTagTooltip([...item.effects]),
			});
		}

		return results.sort((a, b) => a.name.localeCompare(b.name));
	}

	// ---------------------------------------------------------------------------
	// Lookups & transforms
	// ---------------------------------------------------------------------------

	buildLookup(entries) {
		const lookup = new Map();
		for (const entry of entries) {
			lookup.set(entry.uuid, {
				name: entry.name,
				img: entry.img || "",
				sourceLabel: entry.sourceLabel,
				displayLabel: entry.name,
				themeLevel: entry.themeLevel || "",
				themeLevelIcon: entry.themeLevelIcon || "",
				tagTooltip: entry.tagTooltip || "",
			});
		}
		return lookup;
	}

	groupByCategory(entries) {
		const grouped = new Map();
		const bannerImages = new Map();
		for (const entry of entries) {
			const category =
				entry.category || t("LITM.Ui.hero_creation_uncategorized");
			if (entry.name === entry.category) {
				if (!bannerImages.has(category)) bannerImages.set(category, entry.img);
				continue;
			}
			if (!grouped.has(category)) grouped.set(category, []);
			grouped.get(category).push(entry);
		}
		return Array.from(grouped.entries())
			.filter(([, items]) => items.length > 0)
			.map(([name, items]) => ({
				name,
				img: bannerImages.get(name) || "",
				items,
			}));
	}

	filterBySearch(entries, searchTerm) {
		const term = (searchTerm || "").trim().toLowerCase();
		if (!term) return entries;
		return entries.filter((entry) => entry.name.toLowerCase().includes(term));
	}

	resolveKitLabels(uuids, lookup) {
		return uuids.map((uuid) => {
			const entry = lookup.get(uuid);
			return {
				uuid,
				name: entry?.name || "",
				img: entry?.img || "",
				sourceLabel: entry?.sourceLabel || "",
				displayLabel: entry?.displayLabel || uuid,
				themeLevel: entry?.themeLevel || "",
				themeLevelIcon: entry?.themeLevelIcon || "",
				tagTooltip: entry?.tagTooltip || "",
			};
		});
	}

	toLookupMap(values) {
		return (values || []).reduce((acc, value) => {
			if (value) acc[value] = true;
			return acc;
		}, {});
	}

	static #levelIcon(level) {
		return LEVEL_ICONS.has(level) ? level : "";
	}

	static buildTagTooltip(effects) {
		const power = (effects ?? [])
			.filter((e) => e.type === "power_tag" && !e.system?.isTitleTag)
			.map((e) => e.name)
			.filter(Boolean);
		const weakness = (effects ?? [])
			.filter((e) => e.type === "weakness_tag")
			.map((e) => e.name)
			.filter(Boolean);
		if (!power.length && !weakness.length) return "";
		const sections = [];
		if (power.length) {
			sections.push(
				`<div class="tag-tooltip-group"><label>${t(
					"LITM.Tags.power_tags",
				)}</label>${power
					.map(
						(n) => { const s = foundry.utils.escapeHTML(n); return `<span class="litm-power_tag" data-text="${s}">${s}</span>`; },
					)
					.join(" ")}</div>`,
			);
		}
		if (weakness.length) {
			sections.push(
				`<div class="tag-tooltip-group"><label>${t(
					"LITM.Tags.weakness_tags",
				)}</label>${weakness
					.map(
						(n) => { const s = foundry.utils.escapeHTML(n); return `<span class="litm-weakness_tag" data-text="${s}">${s}</span>`; },
					)
					.join(" ")}</div>`,
			);
		}
		return `<div class="litmv2 tag-tooltip-content">${sections.join("")}</div>`;
	}

	// ---------------------------------------------------------------------------
	// Doc cache
	// ---------------------------------------------------------------------------

	async #getCachedDoc(cacheKey, uuid) {
		if (!uuid) return null;
		const cache = this._cache[cacheKey];
		if (cache.has(uuid)) return cache.get(uuid);
		const doc = await foundry.utils.fromUuid(uuid);
		if (doc) cache.set(uuid, doc);
		return doc;
	}

	async getTropeDoc(uuid) {
		return this.#getCachedDoc("tropeDocs", uuid);
	}

	async getThemeDoc(uuid) {
		return this.#getCachedDoc("themeDocs", uuid);
	}

	async getThemebookDoc(uuid) {
		return this.#getCachedDoc("themebookDocs", uuid);
	}

	async getThemebookByName(name) {
		if (!name) return null;
		for (const entry of this._cache.themebooks) {
			if (entry.name === name) {
				return this.getThemebookDoc(entry.uuid);
			}
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// Trope & theme data assembly
	// ---------------------------------------------------------------------------

	async getTropeDetails(uuid, themeKitLookup) {
		if (!uuid) return null;
		const doc = await this.getTropeDoc(uuid);
		if (!doc) return null;

		const fixed = this.resolveKitLabels(
			doc.system?.themeKits?.fixed || [],
			themeKitLookup,
		);
		const optional = this.resolveKitLabels(
			doc.system?.themeKits?.optional || [],
			themeKitLookup,
		);

		return {
			uuid: doc.uuid,
			name: doc.name,
			img: doc.img,
			category: doc.system?.category || "",
			description: doc.system?.description || "",
			fixed,
			optional,
			backpackChoices: doc.system?.backpackChoices || [],
		};
	}

	getThemeTagOptions(themeDoc) {
		const effects = [...(themeDoc?.effects ?? [])];
		const hasTagEffects = effects.some((e) => THEME_TAG_TYPES.has(e.type));

		if (hasTagEffects) {
			return {
				powerTags: effects
					.filter((e) => POWER_TAG_TYPES.has(e.type) && !e.system?.isTitleTag)
					.map((e) => e.name)
					.filter(Boolean),
				weaknessTags: effects
					.filter((e) => e.type === "weakness_tag")
					.map((e) => e.name)
					.filter(Boolean),
			};
		}

		const legacy = themeDoc?.flags?.litmv2?.legacyTags;
		if (legacy) {
			return {
				powerTags: (legacy.powerTags ?? []).map((t) => t.name).filter(Boolean),
				weaknessTags: (legacy.weaknessTags ?? []).map((t) => t.name).filter(Boolean),
			};
		}

		return { powerTags: [], weaknessTags: [] };
	}

	async syncTropeThemes(appState, selectedTrope) {
		const fixed = selectedTrope?.fixed?.map((entry) => entry.uuid) || [];
		const optional = appState.trope.optionalUuid
			? [appState.trope.optionalUuid]
			: [];
		const kitUuids = [...fixed, ...optional].filter(Boolean);
		const state = appState.trope.themes;
		const same =
			kitUuids.length === state.kitUuids.length &&
			kitUuids.every((uuid, index) => uuid === state.kitUuids[index]);
		if (same) {
			for (const choice of state.choices) {
				if (!choice.kitName) {
					const themeDoc = await this.getThemeDoc(choice.kitUuid);
					const tagOptions = this.getThemeTagOptions(themeDoc);
					const selectedPowerTags = new Set(choice.powerTags || []);
					choice.kitName = themeDoc?.name || "";
					choice.kitLevel = themeDoc?.system?.level || "origin";
					choice.kitThemebook = themeDoc?.system?.themebook || "";
					choice.powerTagOptions = tagOptions.powerTags.map((tag) => ({
						name: tag,
						checked: selectedPowerTags.has(tag),
					}));
					choice.weaknessTagOptions = tagOptions.weaknessTags.map((tag) => ({
						name: tag,
						checked: tag === choice.weaknessTag,
					}));
					choice.powerTagsMap = this.toLookupMap(choice.powerTags || []);
					const themebookName = themeDoc?.system?.themebook || "";
					const parentBook = await this.getThemebookByName(themebookName);
					const allPQs = (parentBook?.system?.powerTagQuestions || [])
						.map((q) => `${q ?? ""}`.trim())
						.filter(Boolean);
					choice.powerTagQuestions = allPQs.slice(1);
					choice.weaknessTagQuestions = (
						parentBook?.system?.weaknessTagQuestions || []
					)
						.map((q) => `${q ?? ""}`.trim())
						.filter(Boolean);
				}
			}
			return;
		}
		state.kitUuids = kitUuids;
		state.index = 0;
		state.choices = [];
		for (const uuid of kitUuids) {
			const themeDoc = await this.getThemeDoc(uuid);
			const tagOptions = this.getThemeTagOptions(themeDoc);
			const themebookName = themeDoc?.system?.themebook || "";
			const parentBook = await this.getThemebookByName(themebookName);
			const allPQs = (parentBook?.system?.powerTagQuestions || [])
				.map((q) => `${q ?? ""}`.trim())
				.filter(Boolean);
			state.choices.push({
				kitUuid: uuid,
				kitName: themeDoc?.name || "",
				kitLevel: themeDoc?.system?.level || "origin",
				kitThemebook: themeDoc?.system?.themebook || "",
				powerTags: [],
				weaknessTag: "",
				powerTagOptions: tagOptions.powerTags.map((tag) => ({
					name: tag,
					checked: false,
				})),
				weaknessTagOptions: tagOptions.weaknessTags.map((tag) => ({
					name: tag,
					checked: false,
				})),
				powerTagsMap: {},
				powerTagQuestions: allPQs.slice(1),
				weaknessTagQuestions: (parentBook?.system?.weaknessTagQuestions || [])
					.map((q) => `${q ?? ""}`.trim())
					.filter(Boolean),
			});
		}
	}

	// ---------------------------------------------------------------------------
	// Validation
	// ---------------------------------------------------------------------------

	isCustomReady(appState) {
		const themes = appState.custom.themes;
		return themes.every((theme) => {
			if (!theme.method) return false;
			if (theme.method === "themekit") return Boolean(theme.themekitUuid);
			if (theme.method === "themebook") {
				return Boolean(theme.themebookUuid) && Boolean(theme.name);
			}
			if (theme.method === "manual") return Boolean(theme.name);
			return false;
		});
	}

	/**
	 * Validate all custom themes. Returns the index of the first invalid theme,
	 * or -1 if all are valid. The caller is responsible for showing notifications.
	 * @param {object} appState
	 * @returns {{ index: number, reason: string }|null}
	 */
	validateAllCustomThemes(appState) {
		const themes = appState.custom.themes;

		for (let i = 0; i < THEME_SLOTS; i++) {
			const theme = themes[i];

			if (!theme.method) {
				return { index: i, reason: "LITM.Ui.hero_creation_select_method" };
			}
			if (theme.method === "themekit" && !theme.themekitUuid) {
				return { index: i, reason: "LITM.Ui.hero_creation_select_themekit" };
			}
			if (theme.method === "themebook") {
				if (!theme.themebookUuid) {
					return { index: i, reason: "LITM.Ui.select_themebook" };
				}
				if (!theme.name) {
					return { index: i, reason: "LITM.Ui.hero_creation_manual_name_required" };
				}
			}
			if (theme.method === "manual" && !theme.name) {
				return { index: i, reason: "LITM.Ui.hero_creation_manual_name_required" };
			}
		}

		return null;
	}

	// ---------------------------------------------------------------------------
	// Review assembly
	// ---------------------------------------------------------------------------

	async buildReviewThemes(appState, selectedTrope, themeKitLookup, themebookLookup) {
		if (!appState.mode) return [];

		if (appState.mode === "trope") {
			const fixed = selectedTrope?.fixed || [];
			const optionalUuid = appState.trope.optionalUuid;
			const optional = optionalUuid
				? this.resolveKitLabels([optionalUuid], themeKitLookup)
				: [];
			const allKits = [...fixed, ...optional];
			const selections = appState.trope.themes.choices;

			const themes = [];
			for (let index = 0; index < allKits.length; index++) {
				const kit = allKits[index];
				const choice = selections[index];
				const themeDoc = await this.getThemeDoc(kit.uuid);
				const level = themeDoc?.system?.level || "origin";
				themes.push({
					level,
					levelLabel: t(`LITM.Terms.${level}`),
					themebook: themeDoc?.system?.themebook || "",
					name: kit.name || kit.displayLabel,
					powerTags: choice?.powerTags || [],
					weaknessTag: choice?.weaknessTag || "",
					method: "themekit",
				});
			}
			return themes;
		}

		const themes = [];
		for (const theme of appState.custom.themes) {
			if (theme.method === "themekit") {
				const entry = themeKitLookup.get(theme.themekitUuid);
				const themeDoc = await this.getThemeDoc(theme.themekitUuid);
				const level = themeDoc?.system?.level || "origin";
				themes.push({
					level,
					levelLabel: t(`LITM.Terms.${level}`),
					themebook: themeDoc?.system?.themebook || "",
					name: entry?.name || theme.themekitUuid,
					powerTags: theme.selectedPowerTags || [],
					weaknessTag: theme.selectedWeaknessTag || "",
					method: "themekit",
				});
			} else if (theme.method === "manual") {
				themes.push({
					level: "origin",
					levelLabel: t("LITM.Terms.origin"),
					themebook: "",
					name: theme.name || t("LITM.Ui.theme_title"),
					powerTags: theme.powerTags?.filter(Boolean) || [],
					weaknessTag: theme.weaknessTag || "",
					quest: theme.quest || "",
					method: "manual",
				});
			} else if (theme.method === "themebook") {
				const themebook = themebookLookup.get(theme.themebookUuid);
				const bookLevel = themebook?.themeLevel || "origin";
				const level =
					bookLevel === "variable" ? theme.level || "origin" : bookLevel;
				themes.push({
					level,
					levelLabel: t(`LITM.Terms.${level}`),
					themebook: themebook?.name || "",
					name: theme.name || themebook?.name || theme.themebookUuid,
					powerTags: theme.powerTags?.filter(Boolean) || [],
					weaknessTag: theme.weaknessTag || "",
					quest: theme.quest || "",
					method: "themebook",
				});
			}
		}
		return themes;
	}

	// ---------------------------------------------------------------------------
	// Hero creation (document writes)
	// ---------------------------------------------------------------------------

	/**
	 * Build the hero actor from wizard state. Returns the created Actor.
	 * @param {object} appState
	 * @param {{ assignToUser?: string|null }} [options]
	 * @returns {Promise<Actor|null>}
	 */
	async createHero(appState, { assignToUser = null } = {}) {
		const name = appState.actorName || t("LITM.Ui.hero_name");
		const items = [];

		const trope =
			appState.mode === "trope"
				? await this.getTropeDoc(appState.trope.selectedUuid)
				: null;

		if (appState.mode === "trope") {
			const fixed = trope?.system?.themeKits?.fixed || [];
			const optional = appState.trope.optionalUuid
				? [appState.trope.optionalUuid]
				: [];
			const themeUuids = [...fixed, ...optional];
			const selections = appState.trope.themes.choices;

			for (let index = 0; index < themeUuids.length; index += 1) {
				const uuid = themeUuids[index];
				const themeDoc = await this.getThemeDoc(uuid);
				if (!themeDoc) continue;
				const data = themeDoc.toObject();
				delete data._id;
				delete data._stats;
				ensureLegacyEffects(data);
				const choice = selections[index];
				const hasPowerSelection = choice?.powerTags?.some(Boolean);
				const hasWeaknessSelection = Boolean(choice?.weaknessTag);
				if (choice && (hasPowerSelection || hasWeaknessSelection)) {
					const selectedPowerTags = hasPowerSelection
						? new Set(choice.powerTags.filter(Boolean))
						: null;
					data.effects = (data.effects || []).map((e) => {
						if (selectedPowerTags && e.type === "power_tag" && !e.system?.isTitleTag) {
							return { ...e, disabled: !selectedPowerTags.has(e.name) };
						}
						if (hasWeaknessSelection && e.type === "weakness_tag") {
							return { ...e, disabled: e.name !== choice.weaknessTag };
						}
						return e;
					});
				}
				items.push(data);
			}
		} else {
			for (const themeState of appState.custom.themes) {
				if (!themeState.method) continue;

				if (themeState.method === "themekit") {
					const themeDoc = await this.getThemeDoc(themeState.themekitUuid);
					if (!themeDoc) continue;
					const data = themeDoc.toObject();
					delete data._id;
					delete data._stats;
					ensureLegacyEffects(data);
					const hasPowerSelection = themeState.selectedPowerTags?.some(Boolean);
					const hasWeaknessSelection = Boolean(themeState.selectedWeaknessTag);
					if (hasPowerSelection || hasWeaknessSelection) {
						const selectedPower = hasPowerSelection
							? new Set(themeState.selectedPowerTags.filter(Boolean))
							: null;
						data.effects = (data.effects || []).map((e) => {
							if (selectedPower && e.type === "power_tag" && !e.system?.isTitleTag) {
								return { ...e, disabled: !selectedPower.has(e.name) };
							}
							if (hasWeaknessSelection && e.type === "weakness_tag") {
								return { ...e, disabled: e.name !== themeState.selectedWeaknessTag };
							}
							return e;
						});
					}
					items.push(data);
					continue;
				}

				if (themeState.method === "manual") {
					items.push(tagsToEffects({
						name: themeState.name || t("LITM.Ui.theme_title"),
						type: "theme",
						system: {
							themebook: "",
							level: "origin",
							isScratched: false,
							powerTags: [
								{
									id: foundry.utils.randomID(),
									name: "",
									type: "powerTag",
									question: "",
									isActive: true,
									isScratched: false,
								},
								{
									id: foundry.utils.randomID(),
									name: "",
									type: "powerTag",
									question: "",
									isActive: false,
									isScratched: false,
								},
							],
							weaknessTags: [
								{
									id: foundry.utils.randomID(),
									name: "",
									type: "weaknessTag",
									question: "",
									isActive: true,
									isScratched: false,
								},
							],
							quest: {
								description: themeState.quest || t("LITM.Ui.name_quest"),
								tracks: {
									abandon: { value: 0 },
									milestone: { value: 0 },
								},
							},
							specialImprovements: [],
							improve: { value: 0 },
						},
					}));
					continue;
				}

				// themebook method
				const themebookDoc = await this.getThemebookDoc(
					themeState.themebookUuid,
				);
				const themebookName = themebookDoc?.name || "";
				const bookLevel = themebookDoc?.system?.theme_level || "origin";
				const level =
					bookLevel === "variable" ? themeState.level || "origin" : bookLevel;
				const nameValue =
					themeState.name || themebookName || t("LITM.Ui.theme_title");

				const powerTags = themeState.powerTags.map((tagName, index) => ({
					id: foundry.utils.randomID(),
					name: tagName,
					type: "powerTag",
					question: themeState.powerQuestions[index] || "",
					isActive: true,
					isScratched: false,
				}));
				const weaknessTags = [
					{
						id: foundry.utils.randomID(),
						name: themeState.weaknessTag,
						type: "weaknessTag",
						question: themeState.weaknessQuestion || "",
						isActive: true,
						isScratched: false,
					},
				];

				items.push(tagsToEffects({
					name: nameValue,
					type: "theme",
					system: {
						themebook: themebookName,
						level,
						isScratched: false,
						powerTags,
						weaknessTags,
						quest: {
							description: themeState.quest || t("LITM.Ui.name_quest"),
							tracks: {
								abandon: { value: 0 },
								milestone: { value: 0 },
							},
						},
						specialImprovements: [],
						improve: { value: 0 },
					},
				}));
			}
		}

		// Backpack item
		const backpackTags =
			appState.mode === "trope"
				? (trope?.system?.backpackChoices || []).filter(Boolean)
				: appState.custom.backpackTags.filter(Boolean);
		const selectedBackpackTag =
			appState.trope.backpackChoice || backpackTags[0];

		items.push({
			name: t("TYPES.Item.backpack"),
			type: "backpack",
			effects: backpackTags.map((tag, index) => ({
				name: tag,
				type: "story_tag",
				transfer: true,
				disabled:
					appState.mode === "trope"
						? tag !== selectedBackpackTag
						: index !== appState.custom.activeBackpackIndex,
				system: {
					isScratched: false,
					isSingleUse: false,
					isHidden: false,
				},
			})),
		});

		const actorData = {
			name,
			type: "hero",
			system: {},
			items,
		};
		const actor = await foundry.documents.Actor.create(actorData, {
			renderSheet: false,
			fromSidebar: false,
			litm: {
				skipHeroWizard: true,
				skipAutoSetup: true,
			},
		});

		if (!actor) return null;

		if (assignToUser) {
			const user = game.users.get(assignToUser);
			if (user && !user.character) {
				await user.update({ character: actor.id });
			}
		}

		return actor;
	}
}
