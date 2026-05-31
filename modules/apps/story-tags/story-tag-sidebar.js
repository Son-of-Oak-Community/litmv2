import {
	statusTagEffect,
	storyTagEffect,
	updateEffectsByParent,
} from "../../active-effects/effect-factories.js";
import { resolveEffect } from "../../active-effects/effect-queries.js";
import {
	classifyTagStringMatch,
	parseTagStringMatch,
} from "../../item/action/tag-string.js";
import { error, info } from "../../logger.js";
import { ACTOR_TAG_TYPES, FLAG_LIMIT_TYPES } from "../../system/config.js";
import {
	ContentSources,
	WORLD_STORY_TAG_PACK_ID,
} from "../../system/content-sources.js";
import { LitmSettings } from "../../system/settings.js";
import { Sockets } from "../../system/sockets.js";
import {
	confirmDelete,
	enrichHTML,
	getStoryTagSidebar,
	localize as t,
	viewLinkedRefAction,
} from "../../utils.js";
import {
	applyActorTagUpdates,
	applyLimitUpdates,
	buildStoryTagUpdates,
} from "./story-tag-form-processor.js";
import {
	disambiguateNames,
	mapEffectForUI,
	normalizeConfig,
	parseQuickAddInput,
	partitionTagsByLimit,
	toTiers,
} from "./story-tag-helpers.js";

const AbstractSidebarTab = foundry.applications.sidebar.AbstractSidebarTab;

const STORY_TAG_OPERATIONS = {
	createTags: (data) => ContentSources.createStoryTags(data),
	updateTags: (data) => ContentSources.updateStoryTags(data),
	deleteTags: (data) => ContentSources.deleteStoryTags(data),
};

export class StoryTagSidebar extends foundry.applications.api.HandlebarsApplicationMixin(
	AbstractSidebarTab,
) {
	#dragDrop = null;
	#cachedActors = null;

	/** @type {Array<[string, number]>} Hook name/ID pairs registered for cache invalidation */
	#cacheHookIds = [];

	/** @type {Token[]} Currently highlighted tokens from sidebar hover */
	_highlighted = [];

	/** @type {Set<string>} Actor IDs whose sections are collapsed */
	_collapsedActors = new Set();

	/** @type {string|null} Tag ID to auto-focus after next render */
	_editOnRender = null;

	get _dragDrop() {
		this.#dragDrop ??= new foundry.applications.ux.DragDrop.implementation({
			dragSelector: "[data-tag-item]",
			permissions: {
				dragstart: () => true,
				drop: this._canDragDrop.bind(this),
			},
			callbacks: {
				dragstart: this._onDragStart.bind(this),
				drop: this._onDrop.bind(this),
			},
		});
		return this.#dragDrop;
	}

	static tabName = "combat";

	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--story-tags"],
		window: {
			title: "LITM.Ui.manage_tags",
			resizable: true,
		},
		position: {
			width: 960,
			height: 600,
		},
		actions: {
			"add-tag": StoryTagSidebar.#onAddTag,
			"add-status": StoryTagSidebar.#onAddStatus,
			"open-sheet": StoryTagSidebar.#onOpenSheet,
			"toggle-visibility": StoryTagSidebar.#onToggleVisibility,
			"toggle-effect-visibility": StoryTagSidebar.#onToggleEffectVisibility,
			"add-actor": StoryTagSidebar.#onAddActor,
			"remove-tag": StoryTagSidebar.#onRemoveTag,
			"deactivate-tag": StoryTagSidebar.#onDeactivateTag,
			"add-limit": StoryTagSidebar.#onAddLimit,
			"remove-limit": StoryTagSidebar.#onRemoveLimit,
			"toggle-collapse": StoryTagSidebar.#onToggleCollapse,
			"quick-add": StoryTagSidebar.#onQuickAdd,
			"load-scene-tags": StoryTagSidebar.#onLoadSceneTags,
			"load-scene-tokens": StoryTagSidebar.#onLoadSceneTokens,
			viewLinkedRef: viewLinkedRefAction,
		},
	};

	/**
	 * Register this app as the combat sidebar tab replacement.
	 * Called once from the system init hook.
	 */
	static registerSidebarTab() {
		CONFIG.ui.combat = StoryTagSidebar;
		foundry.applications.sidebar.Sidebar.TABS.combat = {
			tooltip: "LITM.Ui.manage_tags",
			icon: "fa-solid fa-tags",
		};
	}

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/story-tags.html",
			scrollable: [
				".litm--grid-form",
				".litm--grid-col-party",
				".litm--grid-col-right",
				".litm--grid-col-story",
				".litm--grid-col-scene",
			],
		},
	};

	/* -------------------------------------------- */
	/*  Safety getters for modules expecting        */
	/*  CombatTracker API on ui.combat              */
	/* -------------------------------------------- */

	get viewed() {
		return null;
	}

	get combats() {
		return [];
	}

	/* -------------------------------------------- */
	/*  Data Accessors                              */
	/* -------------------------------------------- */

	/**
	 * Gets the story tags configuration, validating and normalizing actor UUIDs.
	 *
	 * @returns {Object} The story tags configuration object
	 * @returns {string[]} config.actors - Array of valid actor UUIDs
	 * @returns {Object[]} config.limits - Array of tag limits
	 * @returns {string[]} config.hiddenActors - Array of hidden actor UUIDs
	 *
	 * @description
	 * - Returns default empty config if settings are empty
	 * - Validates all actor IDs to ensure they are valid Actor UUIDs
	 * - Normalizes legacy bare actor IDs to full Actor UUIDs (e.g., "abc123" → "Actor.abc123")
	 * - Persists normalized config to settings if user is GM
	 * - Filters out invalid actor references before normalization
	 */
	get config() {
		const raw = LitmSettings.storyTags;
		if (!raw || foundry.utils.isEmpty(raw)) {
			return { actors: [], limits: [] };
		}

		const { config, changed } = normalizeConfig(raw);
		if (changed && game.user?.isGM && game.ready) {
			void LitmSettings.setStoryTags(config).catch(error);
		}
		return config;
	}

	invalidateCache() {
		this.#cachedActors = null;
	}

	/** Re-render any open roll dialogs so scene-tag/status changes propagate. */
	refreshRollDialogs() {
		for (const actor of game.actors ?? []) {
			if (!actor.sheet?.hasRollDialog) continue;
			const dialog = actor.sheet.rollDialogInstance;
			if (dialog?.rendered) dialog.render();
		}
	}

	/** Synchronous pack documents — populated once `loadStoryTags()` has run. */
	get #packStoryTags() {
		return game.packs.get(WORLD_STORY_TAG_PACK_ID)?.contents ?? [];
	}

	/** Public read-only accessor over the scene story-tag pack effects.
	 *  Used by the Camping app to list scene tags eligible for expiry. */
	get sceneStoryEffects() {
		return this.#packStoryTags;
	}

	/**
	 * Ensure the story tag pack documents are loaded. Foundry caches pack
	 * documents on the CompendiumCollection itself; subsequent reads via
	 * `#packStoryTags` are synchronous.
	 * @returns {Promise<ActiveEffect[]>}
	 */
	async loadStoryTags() {
		try {
			return await ContentSources.getStoryTags();
		} catch {
			return [];
		}
	}

	/**
	 * Migrate legacy JSON tags from the storyTags setting to the compendium pack.
	 * Idempotent — only runs if the setting still contains a tags array.
	 */
	async #migrateLegacyTags() {
		if (!game.ready || !game.user.isGM) return;
		const config = LitmSettings.storyTags;
		const legacyTags = config?.tags;
		if (!legacyTags?.length) return;

		const effectsData = legacyTags.map((t) =>
			ContentSources.legacyTagToEffectData(t),
		);
		await ContentSources.createStoryTags(effectsData);

		// Remove tags from settings, keep actors/limits/hiddenActors
		const { tags: _, ...rest } = config;
		await LitmSettings.setStoryTags(rest);
		info("Migrated legacy story tags to compendium pack");
	}

	/**
	 * Resolve a stored UUID (or raw actor ID for legacy compat) to the correct actor.
	 * Token document UUIDs (unlinked tokens) resolve via `.actor`.
	 * @param {string} id  A UUID like `Actor.xxx` / `Scene.xxx.Token.yyy`, or a raw actor ID
	 * @returns {Actor|null}
	 */
	#resolveActor(id) {
		if (!id) return null;
		// Decode encoded form keys (dots replaced with __ for expandObject safety)
		const decoded = id.includes("__") ? id.replaceAll("__", ".") : id;
		return (
			foundry.utils.fromUuidSync(decoded) ?? game.actors.get(decoded) ?? null
		);
	}

	/**
	 * Find the canvas Token placeable for a sidebar UUID.
	 * Token document UUIDs resolve directly; actor UUIDs find the first matching token.
	 * @param {string} uuid
	 * @returns {Token|null}
	 */
	#findToken(uuid) {
		if (!canvas.ready) return null;

		const doc = foundry.utils.fromUuidSync(uuid);
		if (!doc) return null;

		if (doc.isToken) return [doc.token.object];
		return doc.getActiveTokens();
	}

	get #userCharacterUuids() {
		return new Set(
			game.users
				.filter((u) => u.active && u.character)
				.map((u) => u.character.uuid),
		);
	}

	get actors() {
		if (this.#cachedActors) return this.#cachedActors;
		// Merge stored UUIDs with user-assigned characters and the fellowship so they always appear
		const storedUuids = this.config.actors ?? [];
		const userCharacterUuids = this.#userCharacterUuids;
		const fellowshipUuid = game.litmv2?.fellowship?.uuid;
		const autoUuids = [...userCharacterUuids];
		if (fellowshipUuid) autoUuids.push(fellowshipUuid);
		const mergedUuids = [...new Set([...autoUuids, ...storedUuids])];
		const result =
			mergedUuids
				.map((uuid) => {
					const doc = foundry.utils.fromUuidSync(uuid, { strict: false });
					if (!doc) return null;
					const isToken = doc.documentName === "Token";
					const actor = isToken ? doc.actor : doc;
					return actor ? { uuid, actor, tokenDoc: isToken ? doc : null } : null;
				})
				.filter(Boolean)
				.map(({ uuid, actor, tokenDoc }) => ({
					name: tokenDoc?.name ?? actor.name,
					type: actor.type,
					img:
						tokenDoc?.texture?.src ||
						actor.prototypeToken?.texture?.src ||
						actor.img,
					id: uuid,
					actorId: uuid.replaceAll(".", "__"),
					isOwner: actor.isOwner,
					isUserCharacter:
						userCharacterUuids.has(actor.uuid) || actor.uuid === fellowshipUuid,
					hidden: (this.config.hiddenActors ?? []).includes(uuid),
					tags: [
						...(actor.system.storyTags ?? []),
						...(actor.system.statusEffects ?? []),
					]
						.filter((e) => !e.disabled)
						.filter((e) => game.user.isGM || !(e.system?.isHidden ?? false))
						.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
						.map(mapEffectForUI),
				}))
				.filter((actor) => game.user.isGM || !actor.hidden) || [];
		disambiguateNames(result);
		this.#cachedActors = result;
		return result;
	}

	get tags() {
		const effects = this.#packStoryTags;
		return effects
			.filter((e) => game.user.isGM || !e.system.isHidden)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
			.map(mapEffectForUI);
	}

	get storyLimits() {
		return this.config.limits ?? [];
	}

	/* -------------------------------------------- */
	/*  Public API                                  */
	/* -------------------------------------------- */

	async setActors(actors) {
		await LitmSettings.setStoryTags({
			...this.config,
			actors,
		});
		return this.#broadcastRender();
	}

	async setLimits(limits) {
		await LitmSettings.setStoryTags({ ...this.config, limits });
		return this.#broadcastRender();
	}

	async addTag(target, type = "story_tag") {
		const isStatus = type === "status_tag";
		const effectData = isStatus
			? {
					...statusTagEffect({
						name: t("LITM.Ui.name_status"),
						tiers: [true, false, false, false, false, false],
						isHidden: game.user.isGM,
					}),
					img: "systems/litmv2/assets/media/icons/consequences.svg",
					disabled: false,
				}
			: {
					...storyTagEffect({
						name: t("LITM.Ui.name_tag"),
						isHidden: game.user.isGM,
					}),
					img: "systems/litmv2/assets/media/icons/consequences.svg",
					disabled: false,
				};

		if (target === "story") {
			if (game.user.isGM) {
				const [created] = await ContentSources.createStoryTags([effectData]);
				this._editOnRender = created._id;
				return this.#broadcastRender();
			}
			return this.#broadcastUpdate("createTags", [effectData]);
		}

		// Actor tags still use the legacy shape for #addTagToActor
		const tag = {
			name: effectData.name,
			type: isStatus ? "status_tag" : "story_tag",
			values: isStatus
				? [true, false, false, false, false, false]
				: Array(6)
						.fill()
						.map(() => null),
			isScratched: false,
			isSingleUse: false,
			hidden: game.user.isGM,
			id: foundry.utils.randomID(),
		};
		this._editOnRender = tag.id;
		return this.#addTagToActor({ id: target, tag });
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	async _prepareContext(_options) {
		await this.loadStoryTags();
		const context = await super._prepareContext(_options);
		context.isGM = game.user.isGM;
		const fellowshipUuid = game.litmv2?.fellowship?.uuid;
		context.actors = this.actors.sort((a, b) => {
			// User characters first
			if (a.isUserCharacter !== b.isUserCharacter) {
				return a.isUserCharacter ? -1 : 1;
			}
			// Fellowship before other user characters
			if (a.id === fellowshipUuid) return -1;
			if (b.id === fellowshipUuid) return 1;
			// Then non-challenges before challenges
			if ((a.type === "challenge") !== (b.type === "challenge")) {
				return a.type === "challenge" ? 1 : -1;
			}
			// Alphabetical within each group
			return a.name.localeCompare(b.name);
		});

		context.tags = this.tags || [];

		// Scene load button visibility
		if (game.user.isGM) {
			const sceneData = canvas.scene?.getFlag("litmv2", "sceneTags");
			context.hasSceneTags = !!(
				sceneData?.tags?.length || sceneData?.limits?.length
			);

			const sidebarUuids = new Set(context.actors.map((a) => a.id));
			const newTokenActors = (canvas.tokens?.placeables ?? []).filter((t) => {
				if (!t.actor) return false;
				const uuid = t.actor.uuid;
				return !sidebarUuids.has(uuid);
			});
			context.hasSceneTokens = newTokenActors.length > 0;
		} else {
			context.hasSceneTags = false;
			context.hasSceneTokens = false;
		}

		// Partition actor tags by limit (GM only)
		const heroLimit = LitmSettings.heroLimit;
		for (const actor of context.actors) {
			await this.#prepareActorContext(actor, heroLimit);
		}

		// Partition story tags by limit (GM only)
		if (game.user.isGM) {
			const storyPartitioned = partitionTagsByLimit(
				context.tags,
				this.storyLimits,
			);
			context.storyLimits = storyPartitioned.limits;
			context.tags = storyPartitioned.ungroupedTags;
		} else {
			context.storyLimits = [];
		}

		// Split actors for two-column grid layout in popout
		const isRight = (a) => a.type === "challenge" || a.type === "journey";
		context.partyActors = context.actors.filter((a) => !isRight(a));
		context.sceneActors = context.actors.filter(isRight);

		return context;
	}

	async #prepareActorContext(actor, _heroLimit) {
		const actorDoc = this.#resolveActor(actor.id);
		const isChallenge = actor.type === "challenge";
		const isHero = actor.type === "hero";
		const usesFlagLimits = FLAG_LIMIT_TYPES.has(actor.type);

		actor.isChallenge = isChallenge;
		actor.fixedMax = isHero;

		const canSeeLimits =
			(isChallenge || usesFlagLimits) &&
			actorDoc &&
			(game.user.isGM || (usesFlagLimits && actorDoc.isOwner));

		if (canSeeLimits) {
			const rawLimits = actorDoc.system.limits ?? [];
			const overridden = rawLimits.map((l) => ({
				...l,
				max: actorDoc.system.getEffectiveMax(l),
			}));

			const partitioned = partitionTagsByLimit(actor.tags, overridden);
			// Enrich outcomes for challenge limits
			if (isChallenge) {
				for (const limit of partitioned.limits) {
					limit.enrichedOutcome = limit.outcome
						? await enrichHTML(limit.outcome, actorDoc)
						: "";
				}
			}
			actor.limits = partitioned.limits;
			actor.ungroupedTags = partitioned.ungroupedTags;
		} else {
			actor.limits = [];
			actor.ungroupedTags = actor.tags;
		}
	}

	/** Whether to suppress the next change-triggered form submit (set by pointerdown pre-submit) */
	_suppressNextChange = false;

	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);
		await this.#migrateLegacyTags();

		// One-time contextmenu listener on the persistent outer element
		this.element.addEventListener("contextmenu", this._onContext.bind(this));

		// Submit the form on pointerdown when an action button is clicked while
		// an input is focused, preventing the blur→change→re-render from detaching
		// the button before the click event fires.
		this.element.addEventListener(
			"pointerdown",
			(event) => {
				const actionBtn = event.target.closest("[data-action]");
				if (!actionBtn) return;

				const form = this.element.querySelector("form");
				if (!form) return;

				const focused = document.activeElement;
				if (!focused || !form.contains(focused)) return;
				if (!["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName)) return;

				// Prevent click from firing (per Pointer Events spec, preventDefault on
				// pointerdown suppresses the subsequent click). We execute the action
				// manually after the form submit, since click would otherwise fire after
				// the render replaces the DOM.
				event.preventDefault();

				const action = actionBtn.dataset.action;
				const dataset = { ...actionBtn.dataset };

				this._suppressNextChange = true;
				const formData = new foundry.applications.ux.FormDataExtended(form);
				this.onSubmit(null, form, formData)
					.then(() => {
						const handler = this.options.actions[action];
						const fn = typeof handler === "object" ? handler.handler : handler;
						if (!fn) return;
						const syntheticTarget = document.createElement("button");
						Object.assign(syntheticTarget.dataset, dataset);
						fn.call(this, event, syntheticTarget);
					})
					.catch(console.error);
			},
			{ capture: true },
		);

		// --- Delegated listeners on the stable outer element ---

		// Submit on change (delegated so it survives form replacement)
		this.element.addEventListener("change", (event) => {
			if (event.target.closest(".litm--quick-add-input")) {
				event.stopPropagation();
				return;
			}
			const form = event.target.closest("form");
			if (!form?.isConnected) return;
			if (this._suppressNextChange) {
				this._suppressNextChange = false;
				return;
			}
			const formData = new foundry.applications.ux.FormDataExtended(form);
			this.onSubmit(null, form, formData).catch(console.error);
		});

		this.element.addEventListener("submit", (event) => event.preventDefault());

		// Quick-add inputs — Enter to add tag/status
		this.element.addEventListener("keydown", (event) => {
			const quickAdd = event.target.closest(".litm--quick-add-input");
			if (quickAdd && event.key === "Enter") {
				event.preventDefault();
				this.#quickAddFromInput(quickAdd, quickAdd.dataset.sectionId);
				return;
			}

			// Enter on any .litm--locked input or .litm--tag-item-name → blur
			const lockedInput = event.target.closest(
				".litm--tag-item-name, .litm--limit-header input.litm--locked",
			);
			if (lockedInput && event.key === "Enter") {
				event.preventDefault();
				lockedInput.blur();
			}
		});

		// Focus select for [data-focus] elements
		this.element.addEventListener(
			"focus",
			(event) => {
				if (event.target.closest("[data-focus]")) {
					event.target.select();
				}
			},
			true,
		);

		// Double-click row to edit tag name
		this.element.addEventListener("dblclick", (event) => {
			// Tag items
			const tagItem = event.target.closest("[data-tag-item]");
			if (tagItem) {
				if (event.target.closest("button, label, .litm--tag-item-status")) {
					return;
				}
				const input = tagItem.querySelector(".litm--tag-item-name");
				if (!input) return;
				const source = tagItem.dataset.type;
				const isStory = source === "story";
				const isOwner = !isStory && this.#resolveActor(source)?.isOwner;
				if (!game.user.isGM && isStory) return;
				if (!isStory && !isOwner) return;
				event.preventDefault();
				event.stopPropagation();
				input.classList.remove("litm--locked");
				input.focus();
				input.select();
				return;
			}

			// Limit headers
			const limitHeader = event.target.closest(".litm--limit-header");
			if (limitHeader) {
				if (event.target.closest("button")) return;
				const inputs = [...limitHeader.querySelectorAll("input.litm--locked")];
				if (!inputs.length) return;
				event.preventDefault();
				for (const inp of inputs) inp.classList.remove("litm--locked");
				const target =
					event.target.closest("input") ||
					event.target.closest(".litm--limit-value")?.querySelector("input") ||
					inputs[0];
				target.focus();
				target.select();
			}
		});

		// Shift+Click → toggle visibility, Alt+Click → remove
		this.element.addEventListener("click", (event) => {
			if (!event.shiftKey && !event.altKey) return;
			const tagItem = event.target.closest("[data-tag-item]");
			if (!tagItem) return;
			if (event.target.closest("button, label, input, .litm--tag-item-status"))
				return;
			const source = tagItem.dataset.type;
			const isStory = source === "story";
			const isOwner = !isStory && this.#resolveActor(source)?.isOwner;
			if (!game.user.isGM && isStory) return;
			if (!isStory && !isOwner) return;
			const tagId = tagItem.dataset.id;
			if (event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				if (isStory) this._toggleTagVisibility(tagId);
				else this._toggleEffectVisibility(tagId, source);
			} else if (event.altKey) {
				event.preventDefault();
				event.stopPropagation();
				this.removeTag({ dataset: { id: tagId, type: source } });
			}
		});

		// Blur on tag name / limit inputs → re-lock
		this.element.addEventListener(
			"blur",
			(event) => {
				const tagName = event.target.closest(".litm--tag-item-name");
				if (tagName) {
					tagName.classList.add("litm--locked");
					return;
				}
				const limitHeader = event.target.closest(".litm--limit-header");
				if (limitHeader && event.target.matches("input.litm--locked, input")) {
					requestAnimationFrame(() => {
						const focused = document.activeElement;
						if (focused && limitHeader.contains(focused)) return;
						for (const inp of limitHeader.querySelectorAll("input")) {
							inp.classList.add("litm--locked");
						}
					});
				}
			},
			true,
		);

		// Highlight token on canvas when hovering over an actor section header
		this.element.addEventListener(
			"pointerenter",
			(event) => {
				const header = event.target.closest(".litm--section-header[data-id]");
				if (!header) return;
				const tokens = this.#findToken(header.dataset.id);
				if (!tokens) return;
				for (const tk of tokens) {
					if (!tk?.visible) continue;
					tk._onHoverIn(event);
					this._highlighted.push(tk);
				}
			},
			true,
		);

		this.element.addEventListener(
			"pointerleave",
			(event) => {
				const header = event.target.closest(".litm--section-header[data-id]");
				if (!header) return;
				for (const tk of this._highlighted) {
					tk._onHoverOut(event);
				}
				this._highlighted = [];
			},
			true,
		);

		// Register cache-busting hooks so the sidebar stays fresh when
		// actors, effects, or items change without explicit invalidateCache() calls.
		const invalidate = () => this.invalidateCache();
		const hooks = [
			"updateActor",
			"createActiveEffect",
			"updateActiveEffect",
			"deleteActiveEffect",
			"createItem",
			"updateItem",
			"deleteItem",
		];
		this.#cacheHookIds = hooks.map((name) => [
			name,
			Hooks.on(name, invalidate),
		]);
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		this._dragDrop.bind(this.element);

		// Dragover highlighting for limit headers (per-element drag handlers)
		this.element.querySelectorAll(".litm--limit-header").forEach((header) => {
			header.addEventListener("dragover", (e) => {
				e.preventDefault();
				header.classList.add("dragover");
			});
			header.addEventListener("dragleave", () => {
				header.classList.remove("dragover");
			});
			header.addEventListener("drop", () => {
				header.classList.remove("dragover");
			});
		});

		// Restore collapsed state without triggering the transition
		if (this._collapsedActors.size > 0) {
			const selector = [...this._collapsedActors]
				.map((id) => `[data-id="${id}"]`)
				.join(",");
			for (const section of this.element.querySelectorAll(selector)) {
				const body = section.querySelector(".litm--section-body");
				if (body) body.style.transition = "none";
				section.classList.add("litm--collapsed");
				if (body) requestAnimationFrame(() => (body.style.transition = ""));
			}
		}

		// Auto-focus newly added tag
		if (this._editOnRender) {
			const tagId = this._editOnRender;
			this._editOnRender = null;
			const input = this.element.querySelector(
				`[data-tag-item][data-id="${tagId}"] .litm--tag-item-name`,
			);
			if (input) {
				input.classList.remove("litm--locked");
				input.focus();
				input.select();
			}
		}
	}

	/**
	 * Blur any focused input inside the form so that the change event fires
	 * and the form submits before the window closes or minimizes.
	 */
	_flushActiveInput() {
		const form = this.element?.querySelector("form");
		if (!form) return;
		const focused = document.activeElement;
		if (!focused || !form.contains(focused)) return;
		if (["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName)) {
			focused.blur();
		}
	}

	_onClose(options) {
		this._flushActiveInput();
		for (const [name, id] of this.#cacheHookIds) Hooks.off(name, id);
		this.#cacheHookIds = [];
		return super._onClose(options);
	}

	async minimize() {
		this._flushActiveInput();
		return super.minimize();
	}

	/* -------------------------------------------- */
	/*  Drag and Drop                               */
	/* -------------------------------------------- */

	_canDragDrop() {
		return true;
	}

	_onDragStart(event) {
		const target = event.currentTarget.closest("[data-tag-item]");
		if (!target) return;

		const text = target.dataset.text;
		if (!text) return;

		const matches = `{${text}}`.matchAll(CONFIG.litmv2.tagStringRe);
		const match = [...matches][0];
		if (!match) return;

		const { name, isStatus, value } = classifyTagStringMatch(match);
		const data = {
			id: foundry.utils.randomID(),
			name,
			type: isStatus ? "status_tag" : "story_tag",
			values: Array(6)
				.fill(null)
				.map((_, i) => (Number.parseInt(value, 10) === i + 1 ? value : null)),
			isScratched: false,
			value,
			sourceId: target.dataset.id,
			sourceContainer: target.dataset.type,
		};
		event.dataTransfer.setData("text/plain", JSON.stringify(data));
	}

	async _onDrop(dragEvent) {
		let data;
		try {
			const dragData = dragEvent.dataTransfer.getData("text/plain");
			data = JSON.parse(dragData);
		} catch {
			return;
		}

		if (!["Actor", "story_tag", "status_tag"].includes(data.type)) return;

		if (data.type === "story_tag" || data.type === "status_tag") {
			return this.#handleEffectDrop(dragEvent, data);
		}
		return this.#handleActorDrop(data);
	}

	/**
	 * Handle drops of story_tag / status_tag payloads onto the sidebar.
	 * Routes to limit-header, same-container sort, or cross-container move.
	 * @param {DragEvent} dragEvent
	 * @param {object} data  Parsed drag payload
	 */
	async #handleEffectDrop(dragEvent, data) {
		const dropTarget = dragEvent.target.closest("[data-tag-item]");
		// Resolve the target container: use data-type on the tag item (actor ID
		// or "story"), or fall back to the nearest [data-id] ancestor (actor header).
		const dropContainer =
			dropTarget?.dataset.type ||
			dragEvent.target.closest("[data-id]")?.dataset.id;

		// Check if dropping onto a limit header (not onto a tag item within the group)
		const limitTarget = dragEvent.target.closest("[data-limit-id]");
		if (limitTarget && !dropTarget) {
			return this.#handleLimitHeaderDrop(
				dragEvent,
				data,
				limitTarget,
				dropTarget,
			);
		}

		// Same-container drop → sort instead of duplicate
		if (data.sourceContainer && data.sourceId) {
			const isSameContainer =
				data.sourceContainer === dropContainer ||
				(!dropContainer && data.sourceContainer === "story");

			if (isSameContainer) {
				return this.#handleSameContainerDrop(data, dropTarget);
			}
		}

		// Cross-container move
		return this.#handleCrossContainerDrop(data, dropContainer);
	}

	/**
	 * Handle a tag drop onto a limit-group header (assigns or moves tag into a limit).
	 * @param {DragEvent} dragEvent
	 * @param {object} data  Parsed drag payload
	 * @param {HTMLElement} limitTarget  The [data-limit-id] element that was dropped onto
	 * @param {HTMLElement|null} dropTarget  The [data-tag-item] element (null for header drops)
	 */
	async #handleLimitHeaderDrop(_dragEvent, data, limitTarget, _dropTarget) {
		const limitId = limitTarget.dataset.limitId;
		const source = limitTarget.dataset.source;
		const isExternal = !data.sourceId;

		if (source === "story") {
			// Same container — update limitId on existing pack AE
			if (data.sourceId) {
				const update = [{ _id: data.sourceId, "system.limitId": limitId }];
				if (game.user.isGM) await ContentSources.updateStoryTags(update);
				else this.#broadcastUpdate("updateTags", update);
				this.#broadcastRender();
				return;
			}
			// External — create new pack AE with limitId
			const effectData = ContentSources.legacyTagToEffectData({
				...data,
				limitId,
			});
			if (game.user.isGM) {
				await ContentSources.createStoryTags([effectData]);
			} else this.#broadcastUpdate("createTags", [effectData]);
			if (data.sourceContainer) await this.#removeFromSource(data);
			this.#broadcastRender();
			return;
		}

		const actor = this.#resolveActor(source);
		if (!actor?.isOwner) return;

		if (isExternal) {
			// Create new effect on the actor with limitId
			// #addTagToActor handles recalculate + broadcast internally
			return this.#addTagToActor({ id: source, tag: { ...data, limitId } });
		}

		// Same actor — just update limitId
		const existing = resolveEffect(data.sourceId, actor);
		if (existing) {
			await existing.parent.updateEmbeddedDocuments("ActiveEffect", [
				{ _id: data.sourceId, "system.limitId": limitId },
			]);
			await this.#triggerLimitRecalc(source);
			return this.#broadcastRender();
		}

		// Cross-container — move tag to this actor's limit
		await this.#addTagToActor({ id: source, tag: { ...data, limitId } });
		return this.#removeFromSource(data);
	}

	/**
	 * Handle a same-container drop (sort reorder, or limit-group exit clearing limitId).
	 * @param {object} data  Parsed drag payload
	 * @param {HTMLElement|null} dropTarget  The [data-tag-item] element dropped onto
	 */
	async #handleSameContainerDrop(data, dropTarget) {
		// If dragging out of a limit group, clear limitId on actor effects
		if (data.sourceContainer && data.sourceContainer !== "story") {
			const actor = this.#resolveActor(data.sourceContainer);
			const effect = [...(actor?.allApplicableEffects() ?? [])].find(
				(e) => e.id === data.sourceId,
			);
			if (
				effect?.system?.limitId &&
				!dropTarget?.closest(".litm--limit-group")
			) {
				await effect.parent.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: data.sourceId, "system.limitId": null },
				]);
				await this.#triggerLimitRecalc(data.sourceContainer);
				return this.#broadcastRender();
			}
		}
		if (data.sourceContainer === "story") {
			const effect = this.#packStoryTags.find((e) => e._id === data.sourceId);
			if (
				effect?.system?.limitId &&
				!dropTarget?.closest(".litm--limit-group")
			) {
				const update = [{ _id: data.sourceId, "system.limitId": null }];
				if (game.user.isGM) await ContentSources.updateStoryTags(update);
				else this.#broadcastUpdate("updateTags", update);
				this.#broadcastRender();
				return;
			}
		}
		return this.#sortTag(data, dropTarget);
	}

	/**
	 * Handle a cross-container drop (move tag to a different actor or story section).
	 * @param {object} data  Parsed drag payload
	 * @param {string|null|undefined} dropContainer  Target container id or "story" or null
	 */
	async #handleCrossContainerDrop(data, dropContainer) {
		const actorTarget =
			dropContainer && dropContainer !== "story" ? dropContainer : null;
		if (actorTarget) {
			await this.#addTagToActor({
				id: actorTarget,
				tag: data,
			});
			return this.#removeFromSource(data);
		}

		const effectData = ContentSources.legacyTagToEffectData(data);
		if (game.user.isGM) await ContentSources.createStoryTags([effectData]);
		else this.#broadcastUpdate("createTags", [effectData]);
		await this.#removeFromSource(data);
		return this.#broadcastRender();
	}

	/**
	 * Handle an Actor document drop onto the sidebar (adds the actor to the sidebar).
	 *
	 * For challenge/journey actors that have not yet been opened or migrated via
	 * TagStringSyncMixin, the `system.tags` string may still be the canonical source
	 * of truth (the field was removed from the schema only after the actor is saved).
	 * We keep this migration here rather than in migrateData() because migrateData()
	 * only sees the model's own declared fields — by the time it runs the `tags` string
	 * has already been stripped, so there is nothing left to migrate. This is a one-shot
	 * operation: once the effects exist the condition (`effects.size === 0 && tags.length`)
	 * will be false on any subsequent drop.
	 * @param {object} data  Parsed drag payload (type === "Actor")
	 */
	async #handleActorDrop(data) {
		const id = data.uuid || `Actor.${data.id}`;

		if (this.actors.map((a) => a.id).includes(id)) return;

		const actor = this.#resolveActor(id);
		if (!actor) return;

		// Legacy system.tags migration: challenge/journey actors that were never
		// opened may still encode their tags as a string. Migrate them to effects now.
		if (
			(actor.type === "challenge" || actor.type === "journey") &&
			actor.effects.size === 0 &&
			actor.system.tags.length
		) {
			const tags = Array.from(
				actor.system.tags.matchAll(CONFIG.litmv2.tagStringRe),
			);
			await actor.createEmbeddedDocuments(
				"ActiveEffect",
				tags.map(parseTagStringMatch),
			);
		}

		const hiddenActors = [...(this.config.hiddenActors ?? []), id];
		await LitmSettings.setStoryTags({
			...this.config,
			actors: [...this.config.actors, id],
			hiddenActors,
		});
		return this.#broadcastRender();
	}

	/* -------------------------------------------- */
	/*  Form Handling                               */
	/* -------------------------------------------- */

	async onSubmit(_event, _form, formData) {
		this.#cachedActors = null;
		const data = foundry.utils.expandObject(formData.object);
		if (foundry.utils.isEmpty(data)) return;

		const { story, limits: _limits, ...actors } = data;
		const resolveActor = (id) => this.#resolveActor(id);

		await applyActorTagUpdates(actors, resolveActor);
		for (const id of Object.keys(actors)) await this.#triggerLimitRecalc(id);

		const storyTagUpdates = buildStoryTagUpdates(story);
		const updatedLimits = await applyLimitUpdates(
			data.limits,
			this.config.limits,
			resolveActor,
		);

		if (game.user.isGM) {
			if (storyTagUpdates.length) {
				await ContentSources.updateStoryTags(storyTagUpdates);
			}
			await LitmSettings.setStoryTags({
				...this.config,
				limits: updatedLimits,
			});
			this.#broadcastRender();
		} else if (storyTagUpdates.length) {
			this.#broadcastUpdate("updateTags", storyTagUpdates);
		}
	}

	/* -------------------------------------------- */
	/*  Action Handlers                             */
	/* -------------------------------------------- */

	static #onAddTag(_event, target) {
		const id = target.dataset.id;
		this.addTag(id, "story_tag");
	}

	static #onAddStatus(_event, target) {
		const id = target.dataset.id;
		this.addTag(id, "status_tag");
	}

	static #onQuickAdd(_event, target) {
		const sectionId = target.dataset.id;
		const input = this.element.querySelector(
			`.litm--quick-add-input[data-section-id="${sectionId}"]`,
		);
		if (!input) return;
		this.#quickAddFromInput(input, sectionId);
	}

	/**
	 * Parse the quick-add input value and create the appropriate tag, status, or limit.
	 * Plain text → tag. Suffix -N (1-6) → status with tiers 1-N. Suffix :N → limit with max N.
	 */
	async #quickAddFromInput(input, sectionId) {
		const parsed = parseQuickAddInput(input.value.trim());
		if (!parsed) return;

		if (parsed.type === "limit") {
			const heroLimit = LitmSettings.heroLimit;
			const actor = this.#resolveActor(sectionId);
			const isHeroActor = actor?.type === "hero";
			const defaultMax = isHeroActor ? heroLimit : 3;
			const max = parsed.limitMax ?? defaultMax;

			if (sectionId === "story" && game.user.isGM) {
				const limits = [
					...(this.config.limits ?? []),
					{ id: foundry.utils.randomID(), label: parsed.name, max, value: 0 },
				];
				input.value = "";
				await this.setLimits(limits);
				this.#refocusQuickAdd(sectionId);
				return;
			}

			if (actor?.isOwner && FLAG_LIMIT_TYPES.has(actor.type)) {
				const existing = actor.system.limits;
				const newMax = isHeroActor ? heroLimit : max;
				await actor.system.setLimits([
					...existing,
					{
						id: foundry.utils.randomID(),
						label: parsed.name,
						max: newMax,
						value: 0,
					},
				]);
				input.value = "";
				this.invalidateCache();
				this.#broadcastRender();
				this.#refocusQuickAdd(sectionId);
				return;
			}

			if (actor?.isOwner && actor.type === "challenge") {
				await actor.system.setLimits([
					...actor.system.limits,
					{
						id: foundry.utils.randomID(),
						label: parsed.name,
						outcome: "",
						max,
						value: 0,
					},
				]);
				input.value = "";
				this.invalidateCache();
				this.#broadcastRender();
				this.#refocusQuickAdd(sectionId);
				return;
			}
		}

		const isStatus = parsed.type === "status_tag";
		const values = isStatus
			? Array.from({ length: 6 }, (_, i) => i === parsed.tier - 1)
			: Array(6)
					.fill()
					.map(() => null);

		const tag = {
			name: parsed.name,
			values,
			type: isStatus ? "status_tag" : "story_tag",
			isScratched: false,
			isSingleUse: false,
			hidden: game.user.isGM,
			id: foundry.utils.randomID(),
		};

		input.value = "";

		if (sectionId === "story") {
			const effectData = ContentSources.legacyTagToEffectData(tag);
			if (game.user.isGM) {
				await ContentSources.createStoryTags([effectData]);
				this.#broadcastRender();
			} else {
				this.#broadcastUpdate("createTags", [effectData]);
			}
		} else {
			await this.#addTagToActor({ id: sectionId, tag });
		}

		this.#refocusQuickAdd(sectionId);
	}

	#refocusQuickAdd(sectionId) {
		requestAnimationFrame(() => {
			const newInput = this.element?.querySelector(
				`.litm--quick-add-input[data-section-id="${sectionId}"]`,
			);
			newInput?.focus();
		});
	}

	static #onOpenSheet(_event, target) {
		const id = target.dataset.id;
		const actor = this.#resolveActor(id);
		if (!actor) return;
		actor.sheet.render(true);
	}

	static async #onToggleVisibility(_event, target) {
		if (!game.user.isGM) return;
		const { id, type } = target.dataset;
		if (type === "actor") return this._toggleActorVisibility(id);
		if (type === "story_tag") return this._toggleTagVisibility(id);
	}

	static async #onToggleEffectVisibility(_event, target) {
		if (!game.user.isGM) return;
		const { id, actorId } = target.dataset;
		return this._toggleEffectVisibility(id, actorId);
	}

	static #onAddActor(_event, _target) {
		ui.actors.renderPopout();
	}

	static #onRemoveTag(_event, target) {
		this.removeTag(target);
	}

	static async #onDeactivateTag(_event, target) {
		const id = target.dataset.id;
		const actorId = target.dataset.actorId;
		const actor = this.#resolveActor(actorId);
		if (!actor?.isOwner) return;
		await updateEffectsByParent(actor, [{ _id: id, disabled: true }]);
		this.invalidateCache();
		return this.#broadcastRender();
	}

	static async #onAddLimit(_event, target) {
		const source = target.dataset.source;

		if (source && source !== "story") {
			const actor = this.#resolveActor(source);
			if (!actor?.isOwner) return;
			if (!FLAG_LIMIT_TYPES.has(actor.type)) return;
			const existing = actor.system.limits;
			const heroLimit = LitmSettings.heroLimit;
			await actor.system.setLimits([
				...existing,
				{
					id: foundry.utils.randomID(),
					label: game.i18n.localize("LITM.Ui.new_limit"),
					max: actor.type === "hero" ? heroLimit : 3,
					value: 0,
				},
			]);
			this.invalidateCache();
			return this.#broadcastRender();
		}

		const limits = [
			...(this.config.limits ?? []),
			{
				id: foundry.utils.randomID(),
				label: game.i18n.localize("LITM.Ui.new_limit"),
				max: 3,
				value: 0,
			},
		];
		this.setLimits(limits);
	}

	static async #onRemoveLimit(_event, target) {
		const limitId = target.dataset.limitId;
		if (!limitId) return;
		const source = target.dataset.source;

		// Actor flag limits (hero/fellowship/journey)
		if (source && source !== "story") {
			const actor = this.#resolveActor(source);
			if (!actor?.isOwner) return;
			const existing = actor.system.limits;
			await actor.system.setLimits(existing.filter((l) => l.id !== limitId));
			// Clear limitId on any effects referencing this limit
			// (includes transferred backpack story_tags — route via parent)
			const updates = [...actor.allApplicableEffects()]
				.filter((e) => e.system?.limitId === limitId)
				.map((e) => ({ _id: e.id, "system.limitId": null }));
			if (updates.length) {
				await updateEffectsByParent(actor, updates);
			}
			this.invalidateCache();
			return this.#broadcastRender();
		}

		const limits = (this.config.limits ?? []).filter((l) => l.id !== limitId);

		// Clear limitId on any story tags referencing this limit
		const storyUpdates = this.#packStoryTags
			.filter((e) => e.system?.limitId === limitId)
			.map((e) => ({ _id: e._id, "system.limitId": null }));

		if (game.user.isGM) {
			if (storyUpdates.length) {
				await ContentSources.updateStoryTags(storyUpdates);
			}
			await LitmSettings.setStoryTags({ ...this.config, limits });
			return this.#broadcastRender();
		}
	}

	static #onToggleCollapse(_event, target) {
		const id = target.dataset.collapseId;
		if (!id) return;
		const section = this.element.querySelector(`[data-id="${id}"]`);
		if (!section) return;
		if (this._collapsedActors.has(id)) {
			this._collapsedActors.delete(id);
			section.classList.remove("litm--collapsed");
		} else {
			this._collapsedActors.add(id);
			section.classList.add("litm--collapsed");
		}
	}

	/* -------------------------------------------- */
	/*  Scene Loading                               */
	/* -------------------------------------------- */

	static async #onLoadSceneTags(_event, _target) {
		const sceneData = canvas.scene?.getFlag("litmv2", "sceneTags");
		if (!sceneData) return;

		const config = this.config;
		const existingLimits = config.limits ?? [];

		const limitIdMap = new Map();
		const newLimits = (sceneData.limits ?? []).map((l) => {
			const newId = foundry.utils.randomID();
			limitIdMap.set(l.id, newId);
			return { ...l, id: newId };
		});

		const effectsData = (sceneData.tags ?? []).map((t) => {
			const data = ContentSources.legacyTagToEffectData(t);
			data.system.isHidden = true;
			if (t.limitId) data.system.limitId = limitIdMap.get(t.limitId) ?? null;
			return data;
		});

		if (effectsData.length) await ContentSources.createStoryTags(effectsData);
		await LitmSettings.setStoryTags({
			...config,
			limits: [...existingLimits, ...newLimits],
		});
		this.#broadcastRender();
	}

	static async #onLoadSceneTokens(_event, _target) {
		const config = this.config;
		const existingUuids = new Set(this.actors.map((a) => a.id));
		const tokenUuids = (canvas.tokens?.placeables ?? [])
			.filter((t) => t.actor)
			.map((t) => t.actor.uuid)
			.filter((uuid) => !existingUuids.has(uuid));

		if (!tokenUuids.length) return;

		// Deduplicate (multiple tokens may share the same actor)
		const uniqueNewIds = [...new Set(tokenUuids)];

		await LitmSettings.setStoryTags({
			...config,
			actors: [...config.actors, ...uniqueNewIds],
			hiddenActors: [...(config.hiddenActors ?? []), ...uniqueNewIds],
		});
		this.#broadcastRender();
	}

	/* -------------------------------------------- */
	/*  Visibility Toggles                          */
	/* -------------------------------------------- */

	async _toggleEffectVisibility(effectId, actorId) {
		const actor = this.#resolveActor(actorId);
		if (!actor) return;
		const effect = resolveEffect(effectId, actor);
		if (!effect) return;
		await effect.update({ "system.isHidden": !effect.system.isHidden });
		return this.#broadcastRender();
	}

	async _toggleActorVisibility(id, { syncTokens = true } = {}) {
		const hidden = new Set(this.config.hiddenActors ?? []);
		if (hidden.has(id)) hidden.delete(id);
		else hidden.add(id);
		await LitmSettings.setStoryTags({
			...this.config,
			hiddenActors: [...hidden],
		});
		// Sync token visibility on the canvas
		if (syncTokens) {
			const isHidden = hidden.has(id);
			const actor = this.#resolveActor(id);
			const tokens = actor
				? (canvas.scene?.tokens?.filter((t) => t.actorId === actor._id) ?? [])
				: [];
			if (tokens.length) {
				await canvas.scene.updateEmbeddedDocuments(
					"Token",
					tokens.map((t) => ({ _id: t.id, hidden: isHidden })),
				);
			}
		}
		return this.#broadcastRender();
	}

	async _toggleTagVisibility(id) {
		const effect = this.#packStoryTags.find((e) => e._id === id);
		if (!effect) return;
		const newHidden = !effect.system.isHidden;
		if (game.user.isGM) {
			await ContentSources.updateStoryTags([
				{
					_id: id,
					"system.isHidden": newHidden,
				},
			]);
			return this.#broadcastRender();
		}
		return this.#broadcastUpdate("updateTags", [
			{
				_id: id,
				"system.isHidden": newHidden,
			},
		]);
	}

	/* -------------------------------------------- */
	/*  Context Menu                                */
	/* -------------------------------------------- */

	static #contextActions = {
		"remove-all-tags": (sidebar, _id) => sidebar.#removeAllTags(),
		"remove-actor": (sidebar, id) => sidebar.#removeActor(id),
	};

	_onContext(event) {
		// Right-click on status tier boxes → reduce by 1
		const statusTarget = event.target.closest(".litm--tag-item-status");
		if (statusTarget) {
			const row = statusTarget.closest("[data-tag-item]");
			if (row) {
				event.preventDefault();
				event.stopPropagation();
				const source = row.dataset.type;
				const tagId = row.dataset.id;
				if (source && tagId) this.#reduceStatus(source, tagId);
				return;
			}
		}

		const target = event.target.closest("[data-context]");
		if (!target) return;

		const action = target.dataset.context;
		const handler = StoryTagSidebar.#contextActions[action];
		if (!handler) return;

		event.preventDefault();
		event.stopPropagation();
		handler(this, target.dataset.id);
	}

	/* -------------------------------------------- */
	/*  Tag CRUD (Private)                          */
	/* -------------------------------------------- */

	async #reduceStatus(source, tagId) {
		if (source === "story") {
			if (!game.user.isGM) return;
			const effect = this.#packStoryTags.find((e) => e._id === tagId);
			if (!effect || effect.type !== "status_tag") return;
			if (!effect.system.tiers.some(Boolean)) return;

			const newTiers = effect.system.calculateReduction(1);
			await ContentSources.updateStoryTags([
				{
					_id: tagId,
					"system.tiers": newTiers,
				},
			]);
			return this.#broadcastRender();
		} else {
			const actor = this.#resolveActor(source);
			if (!actor?.isOwner) return;

			const effect = resolveEffect(tagId, actor);
			if (!effect || effect.type !== "status_tag") return;
			if (!effect.system.tiers.some(Boolean)) return;

			const newTiers = effect.system.calculateReduction(1);
			await effect.parent.updateEmbeddedDocuments("ActiveEffect", [
				{ _id: tagId, "system.tiers": newTiers },
			]);
			await this.#triggerLimitRecalc(source);
			this.#broadcastRender();
		}
	}

	/**
	 * Thin wrapper: resolves the actor from an id, delegates limit recalculation
	 * to the data model, and emits `litm.limitReached` for each newly-crossed limit.
	 * @param {string} actorId
	 * @returns {Promise<void>}
	 */
	async #triggerLimitRecalc(actorId) {
		const actor = this.#resolveActor(actorId);
		if (!actor?.isOwner) return;
		if (typeof actor.system?.recalculateLimitValues !== "function") return;
		const result = await actor.system.recalculateLimitValues();
		for (const limit of result.reached) {
			Hooks.callAll("litm.limitReached", { actor, limit });
		}
	}

	async #removeFromSource(data) {
		if (!data.sourceContainer || !data.sourceId) return;

		if (data.sourceContainer === "story") {
			if (game.user.isGM) await ContentSources.deleteStoryTags([data.sourceId]);
			else this.#broadcastUpdate("deleteTags", [data.sourceId]);
			return this.#broadcastRender();
		}

		const actor = this.#resolveActor(data.sourceContainer);
		if (!actor?.isOwner) return;

		const effect = resolveEffect(data.sourceId, actor);
		if (!effect) return;
		await effect.parent.deleteEmbeddedDocuments("ActiveEffect", [
			data.sourceId,
		]);
		return this.#broadcastRender();
	}

	async #sortTag(data, dropTarget) {
		const sourceId = data.sourceId;
		const container = data.sourceContainer;

		// Sort within an actor's effects
		if (container !== "story") {
			const actor = this.#resolveActor(container);
			if (!actor?.isOwner) return;

			const allEffects = [...actor.allApplicableEffects()];
			const source = allEffects.find((e) => e.id === sourceId);
			if (!source) return;

			// Determine the target sibling from the drop position
			const target = dropTarget
				? allEffects.find((e) => e.id === dropTarget.dataset.id)
				: null;

			const siblings = allEffects
				.filter((e) => e.id !== sourceId && ACTOR_TAG_TYPES.has(e.type))
				.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

			const sortUpdates = foundry.utils.performIntegerSort(source, {
				target,
				siblings,
			});
			const updates = sortUpdates.map(({ target, update }) => ({
				_id: target.id,
				sort: update.sort,
			}));

			await updateEffectsByParent(actor, updates);
			return this.#broadcastRender();
		}

		// Sort within story tags (pack AEs)
		const effects = this.#packStoryTags;
		const source = effects.find((e) => e._id === sourceId);
		if (!source) return;

		const target = dropTarget
			? effects.find((e) => e._id === dropTarget.dataset.id)
			: null;

		const siblings = effects
			.filter((e) => e._id !== sourceId)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

		const sortUpdates = foundry.utils.performIntegerSort(source, {
			target,
			siblings,
		});
		const updates = sortUpdates.map(({ target: t, update }) => ({
			_id: t._id,
			sort: update.sort,
		}));

		if (updates.length) {
			if (game.user.isGM) await ContentSources.updateStoryTags(updates);
			else this.#broadcastUpdate("updateTags", updates);
		}
		return this.#broadcastRender();
	}

	async removeTag(target) {
		const id = target.dataset.id;
		const type = target.dataset.type;

		if (type === "story") {
			if (game.user.isGM) {
				await ContentSources.deleteStoryTags([id]);
				return this.#broadcastRender();
			}
			return this.#broadcastUpdate("deleteTags", [id]);
		}
		return this.#removeTagFromActor({ actorId: type, id });
	}

	async #removeAllTags() {
		const tags = this.#packStoryTags;
		if (!tags.length || !(await confirmDelete())) return;
		if (game.user.isGM) {
			await ContentSources.deleteStoryTags(tags.map((t) => t._id));
			return this.#broadcastRender();
		}
		return this.#broadcastUpdate(
			"deleteTags",
			tags.map((t) => t._id),
		);
	}

	async #addTagToActor({ id, tag }) {
		const actor = this.#resolveActor(id);
		if (!actor) {
			return ui.notifications.error("LITM.Ui.error_no_actor", {
				localize: true,
			});
		}
		if (!actor.isOwner) {
			return ui.notifications.error("LITM.Ui.warn_not_owner", {
				localize: true,
			});
		}

		// Determine whether the incoming tag is a status or a story tag
		const hasValues = Array.isArray(tag.values)
			? tag.values.some((v) => v !== null && v !== false && v !== "")
			: false;
		const isStatus = tag.type === "status_tag" || hasValues;

		const tiers = toTiers(tag.values);

		const effectData = isStatus
			? statusTagEffect({
					name: tag.name,
					tiers,
					isHidden: game.user.isGM,
					limitId: tag.limitId,
				})
			: storyTagEffect({
					name: tag.name,
					isScratched: tag.isScratched ?? false,
					isSingleUse: tag.isSingleUse ?? false,
					isHidden: game.user.isGM,
					limitId: tag.limitId,
				});

		// For heroes, addStoryTag routes story tags through the backpack
		if (!isStatus) {
			const created = await actor.system.addStoryTag(effectData);
			if (created?.[0]) this._editOnRender = created[0].id;
			await this.#triggerLimitRecalc(id);
			return this.#broadcastRender();
		}

		// Statuses are always created directly on the actor
		const maxSort = Math.max(0, ...actor.effects.map((e) => e.sort ?? 0));
		const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
			{ ...effectData, sort: maxSort + 1000 },
		]);
		if (created) this._editOnRender = created.id;
		await this.#triggerLimitRecalc(id);
		return this.#broadcastRender();
	}

	async #removeTagFromActor({ actorId, id }) {
		const actor = this.#resolveActor(actorId);

		if (!actor) {
			return ui.notifications.error("LITM.Ui.error_no_actor", {
				localize: true,
			});
		}
		if (!actor.isOwner) return;

		const effect = resolveEffect(id, actor);
		if (!effect) return;
		await effect.parent.deleteEmbeddedDocuments("ActiveEffect", [id]);
		await this.#triggerLimitRecalc(actorId);
		return this.#broadcastRender();
	}

	async #removeActor(id) {
		if (!game.user.isGM) return;

		// User-assigned characters and the fellowship can't be removed from the sidebar
		const actor = this.#resolveActor(id);
		if (actor && this.#userCharacterUuids.has(actor.uuid)) {
			return ui.notifications.warn("LITM.Ui.warn_user_character", {
				localize: true,
			});
		}
		if (actor && actor.uuid === game.litmv2?.fellowship?.uuid) {
			return ui.notifications.warn("LITM.Ui.warn_user_character", {
				localize: true,
			});
		}

		if (!(await confirmDelete("Actor"))) return;

		await this.setActors(this.config.actors.filter((a) => a !== id));
		this.#broadcastRender();
	}

	/* -------------------------------------------- */
	/*  Socket Methods                              */
	/* -------------------------------------------- */

	#broadcastUpdate(operation, data) {
		return Sockets.dispatch("storyTagsUpdate", { operation, data });
	}

	#broadcastRender() {
		this.invalidateCache();
		Sockets.dispatch("storyTagsRender");
		// Always render the sidebar instance — its render() propagates to the popout.
		// If "this" IS the popout, we also need to tell the sidebar to render.
		const sidebar = getStoryTagSidebar();
		if (sidebar && sidebar !== this) {
			sidebar.invalidateCache();
			sidebar.render();
		} else {
			this.render();
		}
		// Notify dependent UI (roll dialogs, etc.) that scene-tag state changed.
		// Listeners live in modules/system/hooks/ui-hooks.js.
		Hooks.callAll("litm.sceneTagsChanged");
	}

	async doUpdate(operation, data) {
		if (!game.user.isGM) return;
		const handler = STORY_TAG_OPERATIONS[operation];
		if (handler) await handler(data);
		return this.#broadcastRender();
	}
}
