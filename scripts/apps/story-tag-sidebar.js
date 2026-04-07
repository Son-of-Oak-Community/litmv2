import { StatusCardData } from "../data/active-effect-data.js";
import { buildTrackCompleteContent } from "../system/chat.js";
import { LitmSettings } from "../system/settings.js";
import { Sockets } from "../system/sockets.js";
import { confirmDelete, enrichHTML, localize as t } from "../utils.js";

const AbstractSidebarTab = foundry.applications.sidebar.AbstractSidebarTab;

/** Actor types that store limits in flags rather than system data. */
const FLAG_LIMIT_TYPES = new Set(["hero", "fellowship", "journey"]);

function getActorLimits(actor) {
	return actor.getFlag("litmv2", "limits") ?? [];
}

export class StoryTagSidebar extends foundry.applications.api.HandlebarsApplicationMixin(
	AbstractSidebarTab,
) {
	#dragDrop = null;
	#cachedActors = null;

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
			"add-limit": StoryTagSidebar.#onAddLimit,
			"remove-limit": StoryTagSidebar.#onRemoveLimit,
			"toggle-collapse": StoryTagSidebar.#onToggleCollapse,
			"quick-add": StoryTagSidebar.#onQuickAdd,
			"load-scene-tags": StoryTagSidebar.#onLoadSceneTags,
			"load-scene-tokens": StoryTagSidebar.#onLoadSceneTokens,
		},
	};

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

	get config() {
		const config = LitmSettings.storyTags;
		if (!config || foundry.utils.isEmpty(config)) {
			return { actors: [], tags: [], limits: [] };
		}
		return config;
	}

	invalidateCache() {
		this.#cachedActors = null;
	}

	get #userCharacterIds() {
		return new Set(
			game.users.filter((u) => u.active && u.character).map((u) => u.character._id),
		);
	}

	get actors() {
		if (this.#cachedActors) return this.#cachedActors;
		// Merge stored actors with user-assigned characters and the fellowship so they always appear
		const storedIds = this.config.actors ?? [];
		const userCharacterIds = this.#userCharacterIds;
		const fellowshipId = game.litmv2?.fellowship?.id;
		const autoIds = [...userCharacterIds];
		if (fellowshipId) autoIds.push(fellowshipId);
		const mergedIds = [...new Set([...autoIds, ...storedIds])];
		const result =
			mergedIds
				.map((id) => game.actors.get(id))
				.filter(Boolean)
				.map((actor) => ({
					name: actor.name,
					type: actor.type,
					img: actor.prototypeToken.texture.src || actor.img,
					id: actor._id,
					isOwner: actor.isOwner,
					isUserCharacter:
						userCharacterIds.has(actor._id) || actor._id === fellowshipId,
					hidden: (this.config.hiddenActors ?? []).includes(actor._id),
					tags: [...actor.effects]
						.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
						.filter((e) => e.type === "story_tag" || e.type === "status_card")
						.filter((e) => game.user.isGM || !(e.system?.isHidden ?? false))
						.map((e) => {
							const isStatus = e.type === "status_card";
							return {
								id: e._id,
								name: e.name,
								type: isStatus ? "status" : "tag",
								isScratched: e.system?.isScratched ?? false,
								isSingleUse: isStatus
									? false
									: (e.system?.isSingleUse ?? false),
								value: isStatus ? (e.system?.currentTier ?? 0) : 1,
								values: isStatus
									? (e.system?.tiers ?? new Array(6).fill(false))
									: new Array(6).fill(false),
								hidden: e.system?.isHidden ?? false,
								limitId: e.system?.limitId ?? null,
							};
						}),
				}))
				.filter((actor) => game.user.isGM || !actor.hidden) || [];
		this.#cachedActors = result;
		return result;
	}

	get tags() {
		return this.config.tags
			.map((tag) => ({
				...tag,
				isScratched: tag.isScratched ?? false,
				isSingleUse: tag.isSingleUse ?? false,
				hidden: tag.hidden ?? false,
				limitId: tag.limitId ?? null,
			}))
			.filter((tag) => game.user.isGM || !tag.hidden);
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

	async setTags(tags) {
		await LitmSettings.setStoryTags({ ...this.config, tags });
		return this.#broadcastRender();
	}

	async setLimits(limits) {
		await LitmSettings.setStoryTags({ ...this.config, limits });
		return this.#broadcastRender();
	}

	async addTag(target, type = "tag") {
		const isStatus = type === "status";
		const tag = {
			name: t(isStatus ? "LITM.Ui.name_status" : "LITM.Ui.name_tag"),
			values: isStatus
				? [true, false, false, false, false, false]
				: Array(6)
						.fill()
						.map(() => null),
			type,
			isScratched: false,
			isSingleUse: false,
			hidden: game.user.isGM,
			id: foundry.utils.randomID(),
		};

		// Auto-focus the new tag after render
		this._editOnRender = tag.id;

		if (target === "story") {
			if (game.user.isGM) return this.setTags([...this.tags, tag]);
			return this.#broadcastUpdate("tags", [...this.tags, tag]);
		}

		return this.#addTagToActor({ id: target, tag });
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	async _prepareContext(_options) {
		const context = await super._prepareContext(_options);
		context.isGM = game.user.isGM;
		const fellowshipId = game.litmv2?.fellowship?.id;
		context.actors = this.actors.sort((a, b) => {
			// User characters first
			if (a.isUserCharacter !== b.isUserCharacter) {
				return a.isUserCharacter ? -1 : 1;
			}
			// Fellowship before other user characters
			if (a.id === fellowshipId) return -1;
			if (b.id === fellowshipId) return 1;
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

			const sidebarActorIds = new Set(context.actors.map((a) => a.id));
			const newTokenActors = (canvas.tokens?.placeables ?? [])
				.map((t) => t.actor)
				.filter((a) => a && !sidebarActorIds.has(a.id));
			context.hasSceneTokens = newTokenActors.length > 0;
		} else {
			context.hasSceneTags = false;
			context.hasSceneTokens = false;
		}

		// Partition actor tags by limit (GM only)
		const heroLimit = LitmSettings.heroLimit;
		for (const actor of context.actors) {
			const actorDoc = game.actors.get(actor.id);
			const isChallenge = actor.type === "challenge";
			const isHero = actor.type === "hero";
			const usesFlagLimits = FLAG_LIMIT_TYPES.has(actor.type);

			actor.isChallenge = isChallenge;
			actor.fixedMax = isHero;

			const canSeeLimits = (isChallenge || usesFlagLimits) && actorDoc
				&& (game.user.isGM || (usesFlagLimits && actorDoc.isOwner));

			if (canSeeLimits) {
				const rawLimits = isChallenge
					? (actorDoc.system.limits ?? [])
					: getActorLimits(actorDoc);

				const actorLimits = await Promise.all(
					rawLimits.map(async (limit) => {
						const groupedTags = actor.tags.filter(
							(t) => t.limitId === limit.id,
						);
						const statusTierArrays = groupedTags
							.filter((t) => t.type === "status")
							.map((t) => t.values);
						const computedValue = StatusCardData.stackTiers(statusTierArrays);
						return {
							...limit,
							max: isHero ? heroLimit : limit.max,
							tags: groupedTags,
							computedValue,
							enrichedOutcome: isChallenge && limit.outcome
								? await enrichHTML(limit.outcome, actorDoc)
								: "",
						};
					}),
				);
				const groupedIds = new Set(
					actorLimits.flatMap((l) => l.tags.map((t) => t.id)),
				);
				actor.limits = actorLimits;
				actor.ungroupedTags = actor.tags.filter((t) => !groupedIds.has(t.id));
			} else {
				actor.limits = [];
				actor.ungroupedTags = actor.tags;
			}
		}

		// Partition story tags by limit (GM only)
		if (game.user.isGM) {
			const allStoryLimits = this.storyLimits;
			context.storyLimits = allStoryLimits.map((limit) => {
				const groupedTags = context.tags.filter((t) => t.limitId === limit.id);
				const statusTierArrays = groupedTags
					.filter((t) => t.type === "status")
					.map((t) => t.values);
				const computedValue = StatusCardData.stackTiers(statusTierArrays);
				return {
					...limit,
					tags: groupedTags,
					computedValue,
				};
			});
			const storyGroupedIds = new Set(
				context.storyLimits.flatMap((l) => l.tags.map((t) => t.id)),
			);
			context.tags = context.tags.filter((t) => !storyGroupedIds.has(t.id));
		} else {
			context.storyLimits = [];
		}

		// Split actors for two-column grid layout in popout
		const isRight = (a) => a.type === "challenge" || a.type === "journey";
		context.partyActors = context.actors.filter((a) => !isRight(a));
		context.sceneActors = context.actors.filter(isRight);

		return context;
	}

	/** Whether to suppress the next change-triggered form submit (set by pointerdown pre-submit) */
	_suppressNextChange = false;

	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);

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
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		this._dragDrop.bind(this.element);

		// Submit on change — the form is replaced on each render
		const form = this.element.querySelector("form");
		if (form) {
			form.addEventListener("change", () => {
				if (this._suppressNextChange) {
					this._suppressNextChange = false;
					return;
				}
				const formData = new foundry.applications.ux.FormDataExtended(form);
				this.onSubmit(null, form, formData).catch(console.error);
			});
			form.addEventListener("submit", (event) => event.preventDefault());
		}

		// Quick-add inputs — Enter to add tag/status
		this.element.querySelectorAll(".litm--quick-add-input").forEach((input) => {
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					this.#quickAddFromInput(input, input.dataset.sectionId);
				}
			});
			// Prevent change events from triggering form submission
			input.addEventListener("change", (event) => event.stopPropagation());
		});

		// Focus select
		this.element.querySelectorAll("[data-focus]").forEach((el) => {
			el.addEventListener("focus", (event) => event.currentTarget.select());
		});

		// Cache limit headers for dragover and double-click-to-edit
		const limitHeaders = this.element.querySelectorAll(".litm--limit-header");

		// Dragover highlighting for limit headers
		limitHeaders.forEach((header) => {
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

		// Double-click row to edit tag name; modifier-click shortcuts
		this.element.querySelectorAll("[data-tag-item]").forEach((li) => {
			const input = li.querySelector(".litm--tag-item-name");
			if (!input) return;
			const source = li.dataset.type;
			const isStory = source === "story";
			const isOwner = !isStory && game.actors.get(source)?.isOwner;
			if (!game.user.isGM && isStory) return;
			if (!isStory && !isOwner) return;

			li.addEventListener("dblclick", (event) => {
				if (event.target.closest("button, label, .litm--tag-item-status"))
					return;
				event.preventDefault();
				event.stopPropagation();
				input.classList.remove("litm--locked");
				input.focus();
				input.select();
			});

			// Shift+Click → toggle visibility, Alt+Click → remove
			li.addEventListener("click", (event) => {
				if (
					event.target.closest("button, label, input, .litm--tag-item-status")
				)
					return;
				const tagId = li.dataset.id;
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

			input.addEventListener("blur", () => {
				input.classList.add("litm--locked");
			});
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					input.blur();
				}
			});
		});

		// Double-click to edit limit label/max
		limitHeaders.forEach((header) => {
			const inputs = [...header.querySelectorAll("input.litm--locked")];
			if (!inputs.length) return;

			const enterEdit = () => {
				for (const input of inputs) {
					input.classList.remove("litm--locked");
				}
			};

			const exitEdit = () => {
				requestAnimationFrame(() => {
					const focused = document.activeElement;
					if (focused && inputs.includes(focused)) return;
					for (const inp of inputs) {
						inp.classList.add("litm--locked");
					}
				});
			};

			header.addEventListener("dblclick", (event) => {
				if (event.target.closest("button")) return;
				event.preventDefault();
				enterEdit();
				const target =
					event.target.closest("input") ||
					event.target.closest(".litm--limit-value")?.querySelector("input") ||
					inputs[0];
				target.focus();
				target.select();
			});

			for (const input of inputs) {
				input.addEventListener("blur", () => exitEdit());
				input.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						input.blur();
					}
				});
			}
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
				input.addEventListener(
					"blur",
					() => {
						input.classList.add("litm--locked");
					},
					{ once: true },
				);
				input.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						input.blur();
					}
				});
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

		const [, name, separator, value] = match;
		const isStatus = separator === "-";
		const data = {
			id: foundry.utils.randomID(),
			name,
			type: isStatus ? "status" : "tag",
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

		if (!["Actor", "tag", "status"].includes(data.type)) return;
		const id = data.uuid?.split(".").pop() || data.id;

		// Add tags and statuses to the story / Actor
		if (data.type === "tag" || data.type === "status") {
			const dropTarget = dragEvent.target.closest("[data-tag-item]");
			// Resolve the target container: use data-type on the tag item (actor ID
			// or "story"), or fall back to the nearest [data-id] ancestor (actor header).
			const dropContainer =
				dropTarget?.dataset.type ||
				dragEvent.target.closest("[data-id]")?.dataset.id;

			// Check if dropping onto a limit header (not onto a tag item within the group)
			const limitTarget = dragEvent.target.closest("[data-limit-id]");
			if (limitTarget && !dropTarget) {
				const limitId = limitTarget.dataset.limitId;
				const source = limitTarget.dataset.source;
				const isExternal = !data.sourceId;

				if (source === "story") {
					// Same container — update limitId on existing story tag
					const existingTag = data.sourceId && this.config.tags.find((t) => t.id === data.sourceId);
					if (existingTag) {
						const tags = this.config.tags.map((t) =>
							t.id === data.sourceId ? { ...t, limitId } : t,
						);
						if (game.user.isGM) await this.setTags(tags);
						else this.#broadcastUpdate("tags", tags);
						return;
					}
					// Cross-container or external — add new story tag with limitId
					const newTag = { ...data, id: data.id ?? foundry.utils.randomID(), limitId };
					const tags = [...this.config.tags, newTag];
					if (game.user.isGM) await this.setTags(tags);
					else this.#broadcastUpdate("tags", tags);
					if (data.sourceContainer) await this.#removeFromSource(data);
					return;
				}

				const actor = game.actors.get(source);
				if (!actor?.isOwner) return;

				if (isExternal) {
					// Create new effect on the actor with limitId
					// #addTagToActor handles recalculate + broadcast internally
					return this.#addTagToActor({ id: source, tag: { ...data, limitId } });
				}

				// Same actor — just update limitId
				if (actor.effects.has(data.sourceId)) {
					await actor.updateEmbeddedDocuments("ActiveEffect", [
						{ _id: data.sourceId, "system.limitId": limitId },
					]);
					await this.#recalculateActorLimits(source);
					return this.#broadcastRender();
				}

				// Cross-container — move tag to this actor's limit
				await this.#addTagToActor({ id: source, tag: { ...data, limitId } });
				return this.#removeFromSource(data);
			}

			// Same-container drop → sort instead of duplicate
			if (data.sourceContainer && data.sourceId) {
				const isSameContainer =
					data.sourceContainer === dropContainer ||
					(!dropContainer && data.sourceContainer === "story");

				if (isSameContainer) {
					// If dragging out of a limit group, clear limitId
					if (data.sourceContainer && data.sourceContainer !== "story") {
						const actor = game.actors.get(data.sourceContainer);
						const effect = actor?.effects.get(data.sourceId);
						if (
							effect?.system?.limitId &&
							!dropTarget?.closest(".litm--limit-group")
						) {
							await actor.updateEmbeddedDocuments("ActiveEffect", [
								{ _id: data.sourceId, "system.limitId": null },
							]);
							await this.#recalculateActorLimits(data.sourceContainer);
							return this.#broadcastRender();
						}
					}
					if (data.sourceContainer === "story") {
						const tag = this.config.tags.find((t) => t.id === data.sourceId);
						if (tag?.limitId && !dropTarget?.closest(".litm--limit-group")) {
							const tags = this.config.tags.map((t) =>
								t.id === data.sourceId ? { ...t, limitId: null } : t,
							);
							if (game.user.isGM) await this.setTags(tags);
							else this.#broadcastUpdate("tags", tags);
							return;
						}
					}
					return this.#sortTag(data, dropTarget);
				}
			}

			// Resolve actor ID for cross-container drops
			const actorTarget =
				dropContainer && dropContainer !== "story" ? dropContainer : null;
			if (actorTarget) {
				await this.#addTagToActor({
					id: actorTarget,
					tag: data,
				});
				return this.#removeFromSource(data);
			}

			if (game.user.isGM) await this.setTags([...this.tags, data]);
			else this.#broadcastUpdate("tags", [...this.tags, data]);
			return this.#removeFromSource(data);
		}

		if (this.actors.map((a) => a.id).includes(id)) return;

		// Add current tags and statuses from a challenge
		const actor = game.actors.get(id);
		if (!actor) return;
		if (
			(actor.type === "challenge" || actor.type === "journey") &&
			actor.effects.size === 0 &&
			actor.system.tags.length
		) {
			const tags = actor.system.tags.matchAll(CONFIG.litmv2.tagStringRe);
			await actor.createEmbeddedDocuments(
				"ActiveEffect",
				Array.from(tags).map(([_, name, separator, value]) => {
					const isStatus = separator === "-";
					const tier = Number.parseInt(value, 10);
					return {
						name,
						type: isStatus ? "status_card" : "story_tag",
						system: isStatus
							? {
									tiers: Array(6)
										.fill(false)
										.map((_, i) => i + 1 === tier),
								}
							: { isScratched: false, isSingleUse: false },
					};
				}),
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
		this.invalidateCache();
		const data = foundry.utils.expandObject(formData.object);
		if (foundry.utils.isEmpty(data)) return;

		const { story, limits: _limits, ...actors } = data;

		const toTiers = (values = []) => {
			if (!Array.isArray(values)) return new Array(6).fill(false);
			if (
				values.length === 6 &&
				values.some((v) => v === null || v === false)
			) {
				return values.map((v) => v !== null && v !== false && v !== "");
			}
			const tiers = new Array(6).fill(false);
			for (const value of values) {
				const index = Number.parseInt(value, 10) - 1;
				if (Number.isFinite(index) && index >= 0 && index < 6) {
					tiers[index] = true;
				}
			}
			return tiers;
		};

		await Promise.all(
			Object.entries(actors).map(([id, tags]) => {
				return this.#updateTagsOnActor({
					id,
					tags: Object.entries(tags).map(([tagId, data]) => {
						const isStatus = data.tagType === "status";
						const rawValues = Array.isArray(data.values)
							? data.values
							: data.values != null
								? [data.values]
								: [];
						return {
							_id: tagId,
							name: data.name,
							system: isStatus
								? { tiers: toTiers(rawValues), limitId: data.limitId || null }
								: {
										isScratched: data.isScratched ?? false,
										isSingleUse: data.isSingleUse ?? false,
										limitId: data.limitId || null,
									},
						};
					}),
				});
			}),
		);

		// Recalculate actor limits after tag updates
		for (const id of Object.keys(actors)) {
			if (game.actors.has(id)) await this.#recalculateActorLimits(id);
		}

		const storyTags = Object.entries(story || {}).map(([tagId, data]) => {
			const existing = this.config.tags.find((t) => t.id === tagId);
			const isStatus = existing?.type === "status";
			const rawValues = Array.isArray(data.values)
				? data.values
				: data.values != null
					? [data.values]
					: [];
			const tiers = toTiers(rawValues);
			return {
				id: tagId,
				name: data.name,
				values: isStatus ? tiers : new Array(6).fill(false),
				isScratched: isStatus ? false : (data.isScratched ?? false),
				isSingleUse: isStatus ? false : (data.isSingleUse ?? false),
				type: existing?.type ?? "tag",
				value: isStatus ? tiers.lastIndexOf(true) + 1 : null,
				hidden: existing?.hidden ?? false,
				limitId: data.limitId || existing?.limitId || null,
			};
		});

		// Process limit form data (namespaced as limits.{source}.{limitId}.*)
		let updatedLimits = this.config.limits ?? [];
		const limitsData = data.limits;
		if (limitsData && game.user.isGM) {
			// Story limits
			const storyLimitsData = limitsData.story;
			if (storyLimitsData) {
				updatedLimits = updatedLimits.map((limit) => {
					const formLimit = storyLimitsData[limit.id];
					if (!formLimit) return limit;
					return {
						...limit,
						label: formLimit.label ?? limit.label,
						max: formLimit.max ?? limit.max,
					};
				});
			}

			// Actor flag limits (hero/fellowship/journey)
			const flagUpdates = [];
			for (const [source, sourceLimits] of Object.entries(limitsData)) {
				if (source === "story") continue;
				const actor = game.actors.get(source);
				if (!actor?.isOwner) continue;
				if (!FLAG_LIMIT_TYPES.has(actor.type)) continue;
				const existing = getActorLimits(actor);
				const updated = existing.map((limit) => {
					const formLimit = sourceLimits[limit.id];
					if (!formLimit) return limit;
					return {
						...limit,
						label: formLimit.label ?? limit.label,
						max: actor.type === "hero" ? limit.max : (formLimit.max ?? limit.max),
					};
				});
				flagUpdates.push(actor.setFlag("litmv2", "limits", updated));
			}
			await Promise.all(flagUpdates);
		}

		// Write tags and limits together in a single setting update
		if (game.user.isGM) {
			await LitmSettings.setStoryTags({
				...this.config,
				tags: storyTags,
				limits: updatedLimits,
			});
			this.#broadcastRender();
		} else {
			this.#broadcastUpdate("tags", storyTags);
		}
	}

	/* -------------------------------------------- */
	/*  Action Handlers                             */
	/* -------------------------------------------- */

	static #onAddTag(_event, target) {
		const id = target.dataset.id;
		this.addTag(id, "tag");
	}

	static #onAddStatus(_event, target) {
		const id = target.dataset.id;
		this.addTag(id, "status");
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
		const raw = input.value.trim();
		if (!raw) return;

		// Limit: "name:N" or "name:" — story tags (GM), hero/fellowship actors (owner)
		const limitMatch = raw.match(/^(.+):(\d*)$/);
		if (limitMatch) {
			const label = limitMatch[1].trim();
			const heroLimit = LitmSettings.heroLimit;
			const actor = game.actors.get(sectionId);
			const isHeroActor = actor?.type === "hero";
			const defaultMax = isHeroActor ? heroLimit : 3;
			const max = limitMatch[2] ? Number(limitMatch[2]) : defaultMax;

			if (sectionId === "story" && game.user.isGM) {
				const limits = [
					...(this.config.limits ?? []),
					{ id: foundry.utils.randomID(), label, max, value: 0 },
				];
				input.value = "";
				await this.setLimits(limits);
				this.#refocusQuickAdd(sectionId);
				return;
			}

			if (actor?.isOwner && FLAG_LIMIT_TYPES.has(actor.type)) {
				const existing = getActorLimits(actor);
				await actor.setFlag("litmv2", "limits", [
					...existing,
					{ id: foundry.utils.randomID(), label, max: isHeroActor ? heroLimit : max, value: 0 },
				]);
				input.value = "";
				this.invalidateCache();
				this.#broadcastRender();
				this.#refocusQuickAdd(sectionId);
				return;
			}

			if (actor?.isOwner && actor.type === "challenge") {
				await actor.update({
					"system.limits": [
						...actor.system.limits,
						{ id: foundry.utils.randomID(), label, outcome: "", max, value: 0 },
					],
				});
				input.value = "";
				this.invalidateCache();
				this.#broadcastRender();
				this.#refocusQuickAdd(sectionId);
				return;
			}
		}

		// Status: "name-N" where N is 1-6
		const statusMatch = raw.match(/^(.+)-([1-6])$/);
		let name, type, values;

		if (statusMatch) {
			name = statusMatch[1].trim();
			type = "status";
			const tier = Number.parseInt(statusMatch[2], 10);
			values = Array.from({ length: 6 }, (_, i) => i === tier - 1);
		} else {
			name = raw;
			type = "tag";
			values = Array(6)
				.fill()
				.map(() => null);
		}

		const tag = {
			name,
			values,
			type,
			isScratched: false,
			isSingleUse: false,
			hidden: game.user.isGM,
			id: foundry.utils.randomID(),
		};

		input.value = "";

		if (sectionId === "story") {
			if (game.user.isGM) await this.setTags([...this.tags, tag]);
			else this.#broadcastUpdate("tags", [...this.tags, tag]);
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
		const actor = game.actors.get(id);
		if (!actor) return;
		actor.sheet.render(true);
	}

	static async #onToggleVisibility(_event, target) {
		const { id, type } = target.dataset;
		if (type === "actor") return this._toggleActorVisibility(id);
		if (type === "tag") return this._toggleTagVisibility(id);
	}

	static async #onToggleEffectVisibility(_event, target) {
		const { id, actorId } = target.dataset;
		return this._toggleEffectVisibility(id, actorId);
	}

	static #onAddActor(_event, _target) {
		ui.actors.renderPopout();
	}

	static #onRemoveTag(_event, target) {
		this.removeTag(target);
	}

	static async #onAddLimit(_event, target) {
		const source = target.dataset.source;

		if (source && source !== "story") {
			const actor = game.actors.get(source);
			if (!actor?.isOwner) return;
			if (!FLAG_LIMIT_TYPES.has(actor.type)) return;
			const existing = getActorLimits(actor);
			const heroLimit = LitmSettings.heroLimit;
			await actor.setFlag("litmv2", "limits", [
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
			const actor = game.actors.get(source);
			if (!actor?.isOwner) return;
			const existing = getActorLimits(actor);
			await actor.setFlag("litmv2", "limits", existing.filter((l) => l.id !== limitId));
			// Clear limitId on any effects referencing this limit
			const updates = [...actor.effects]
				.filter((e) => e.system?.limitId === limitId)
				.map((e) => ({ _id: e.id, "system.limitId": null }));
			if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
			this.invalidateCache();
			return this.#broadcastRender();
		}

		const limits = (this.config.limits ?? []).filter((l) => l.id !== limitId);

		// Clear limitId on any story tags referencing this limit
		const tags = this.config.tags.map((t) =>
			t.limitId === limitId ? { ...t, limitId: null } : t,
		);

		if (game.user.isGM) {
			await LitmSettings.setStoryTags({ ...this.config, limits, tags });
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
		const existingTags = config.tags ?? [];
		const existingLimits = config.limits ?? [];

		// Build a mapping from old limit IDs to new limit IDs
		const limitIdMap = new Map();
		const newLimits = (sceneData.limits ?? []).map((l) => {
			const newId = foundry.utils.randomID();
			limitIdMap.set(l.id, newId);
			return { ...l, id: newId };
		});

		// Copy tags with fresh IDs, remapped limitIds, and hidden by default
		const newTags = (sceneData.tags ?? []).map((t) => ({
			...t,
			id: foundry.utils.randomID(),
			limitId: t.limitId ? (limitIdMap.get(t.limitId) ?? null) : null,
			hidden: true,
		}));

		await LitmSettings.setStoryTags({
			...config,
			tags: [...existingTags, ...newTags],
			limits: [...existingLimits, ...newLimits],
		});
		this.#broadcastRender();
	}

	static async #onLoadSceneTokens(_event, _target) {
		const config = this.config;
		const existingActorIds = new Set(this.actors.map((a) => a.id));
		const tokenActorIds = (canvas.tokens?.placeables ?? [])
			.map((t) => t.actor?.id)
			.filter((id) => id && !existingActorIds.has(id));

		if (!tokenActorIds.length) return;

		// Deduplicate (multiple tokens may share the same actor)
		const uniqueNewIds = [...new Set(tokenActorIds)];

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
		const actor = game.actors.get(actorId);
		const effect = actor?.effects.get(effectId);
		if (!effect) return;
		await effect.update({ "system.isHidden": !effect.system.isHidden });
		return this.#broadcastRender();
	}

	async _toggleActorVisibility(id) {
		const hidden = new Set(this.config.hiddenActors ?? []);
		if (hidden.has(id)) hidden.delete(id);
		else hidden.add(id);
		await LitmSettings.setStoryTags({
			...this.config,
			hiddenActors: [...hidden],
		});
		return this.#broadcastRender();
	}

	async _toggleTagVisibility(id) {
		const tags = this.config.tags.map((tag) =>
			tag.id === id ? { ...tag, hidden: !tag.hidden } : tag,
		);
		if (game.user.isGM) await this.setTags(tags);
		else this.#broadcastUpdate("tags", tags);
	}

	/* -------------------------------------------- */
	/*  Context Menu                                */
	/* -------------------------------------------- */

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
		const id = target.dataset.id;

		switch (action) {
			case "remove-all-tags":
				event.preventDefault();
				event.stopPropagation();
				this.#removeAllTags();
				break;
			case "remove-actor":
				event.preventDefault();
				event.stopPropagation();
				this.#removeActor(id);
				break;
		}
	}

	/* -------------------------------------------- */
	/*  Tag CRUD (Private)                          */
	/* -------------------------------------------- */

	async #reduceStatus(source, tagId) {
		if (source === "story") {
			if (!game.user.isGM) return;
			const tag = this.config.tags.find((t) => t.id === tagId);
			if (!tag || tag.type !== "status") return;

			const tiers = tag.values ?? new Array(6).fill(false);
			if (!tiers.some(Boolean)) return;

			// Shift all marks left by 1 (same logic as StatusCardData#calculateReduction)
			const newTiers = Array(6).fill(false);
			for (let i = 0; i < 6; i++) {
				if (tiers[i]) {
					const newIndex = i - 1;
					if (newIndex >= 0) newTiers[newIndex] = true;
				}
			}

			const updatedTags = this.config.tags.map((t) => {
				if (t.id !== tagId) return t;
				return {
					...t,
					values: newTiers,
					value: newTiers.lastIndexOf(true) + 1,
				};
			});
			await this.setTags(updatedTags);
		} else {
			const actor = game.actors.get(source);
			if (!actor?.isOwner) return;

			const effect = actor.effects.get(tagId);
			if (!effect || effect.type !== "status_card") return;
			if (!effect.system.tiers.some(Boolean)) return;

			const newTiers = effect.system.calculateReduction(1);
			await actor.updateEmbeddedDocuments("ActiveEffect", [
				{ _id: tagId, "system.tiers": newTiers },
			]);
			await this.#recalculateActorLimits(source);
			this.#broadcastRender();
		}
	}

	async #recalculateActorLimits(actorId) {
		const actor = game.actors.get(actorId);
		if (!actor?.isOwner) return;

		const isChallenge = actor.type === "challenge";
		const isHero = actor.type === "hero";
		const usesFlagLimits = FLAG_LIMIT_TYPES.has(actor.type);
		if (!isChallenge && !usesFlagLimits) return;

		const oldLimits = isChallenge
			? (actor.system.limits ?? [])
			: getActorLimits(actor);
		if (!oldLimits.length) return;

		const effects = [...actor.effects]
			.filter((e) => e.type === "status_card" && e.system?.limitId)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

		const heroLimit = LitmSettings.heroLimit;

		const limits = oldLimits.map((limit) => {
			const grouped = effects.filter((e) => e.system.limitId === limit.id);
			const tierArrays = grouped.map((e) => e.system.tiers);
			const computedValue = StatusCardData.stackTiers(tierArrays);
			return { ...limit, value: computedValue };
		});

		// Detect limit-reached transitions (hero max is derived from setting, not stored)
		for (let i = 0; i < limits.length; i++) {
			const oldLimit = oldLimits[i];
			const newLimit = limits[i];
			const effectiveMax = isHero ? heroLimit : newLimit.max;
			if (!oldLimit || effectiveMax === 0) continue;
			if (oldLimit.value < effectiveMax && newLimit.value >= effectiveMax) {
				this.#sendLimitReachedMessage({ ...newLimit, max: effectiveMax }, actor);
			}
		}

		if (isChallenge) {
			await actor.update({ "system.limits": limits });
		} else {
			await actor.setFlag("litmv2", "limits", limits);
		}
	}

	async #sendLimitReachedMessage(limit, actor) {
		const text = limit.outcome
			? game.i18n.format("LITM.Ui.limit_reached_with_outcome", {
					label: limit.label,
					actor: actor.name,
					outcome: limit.outcome,
				})
			: game.i18n.format("LITM.Ui.limit_reached", {
					label: limit.label,
				});

		await foundry.documents.ChatMessage.create({
			content: buildTrackCompleteContent({ text, type: "limit" }),
			whisper: foundry.documents.ChatMessage.getWhisperRecipients("GM"),
			speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		});
	}

	async #removeFromSource(data) {
		if (!data.sourceContainer || !data.sourceId) return;

		if (data.sourceContainer === "story") {
			const tags = this.config.tags.filter((t) => t.id !== data.sourceId);
			if (game.user.isGM) return this.setTags(tags);
			return this.#broadcastUpdate("tags", tags);
		}

		const actor = game.actors.get(data.sourceContainer);
		if (!actor?.isOwner) return;
		if (!actor.effects.has(data.sourceId)) return;
		await actor.deleteEmbeddedDocuments("ActiveEffect", [data.sourceId]);
		return this.#broadcastRender();
	}

	async #sortTag(data, dropTarget) {
		const sourceId = data.sourceId;
		const container = data.sourceContainer;

		// Sort within an actor's effects
		if (container !== "story") {
			const actor = game.actors.get(container);
			if (!actor?.isOwner) return;

			const source = actor.effects.get(sourceId);
			if (!source) return;

			// Determine the target sibling from the drop position
			const target = dropTarget
				? actor.effects.get(dropTarget.dataset.id)
				: null;

			const siblings = actor.effects
				.filter(
					(e) =>
						e.id !== sourceId &&
						(e.type === "story_tag" || e.type === "status_card"),
				)
				.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

			const sortUpdates = foundry.utils.performIntegerSort(source, {
				target,
				siblings,
			});
			const updates = sortUpdates.map(({ target, update }) => ({
				_id: target.id,
				sort: update.sort,
			}));
			await actor.updateEmbeddedDocuments("ActiveEffect", updates);
			return this.#broadcastRender();
		}

		// Sort within story tags
		const tags = [...this.config.tags];
		const sourceIndex = tags.findIndex((t) => t.id === sourceId);
		if (sourceIndex === -1) return;

		const [moved] = tags.splice(sourceIndex, 1);
		const targetId = dropTarget?.dataset.id;
		const targetIndex = targetId
			? tags.findIndex((t) => t.id === targetId)
			: tags.length;
		tags.splice(targetIndex === -1 ? tags.length : targetIndex, 0, moved);

		if (game.user.isGM) return this.setTags(tags);
		return this.#broadcastUpdate("tags", tags);
	}

	async removeTag(target) {
		const id = target.dataset.id;
		const type = target.dataset.type;

		if (type === "story") {
			if (game.user.isGM) {
				return this.setTags(this.config.tags.filter((t) => t.id !== id));
			}
			return this.#broadcastUpdate(
				"tags",
				this.config.tags.filter((t) => t.id !== id),
			);
		}
		return this.#removeTagFromActor({ actorId: type, id });
	}

	async #removeAllTags() {
		if (!this.config.tags.length || !(await confirmDelete())) return;
		if (game.user.isGM) return this.setTags([]);
		return this.#broadcastUpdate("tags", []);
	}

	async #addTagToActor({ id, tag }) {
		const actor = game.actors.get(id);
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

		const hasValues = Array.isArray(tag.values)
			? tag.values.some((v) => v !== null && v !== false && v !== "")
			: false;
		const type = tag.type === "status" || hasValues ? "status" : "tag";
		const tiers = Array.isArray(tag.values)
			? tag.values.map(
					(value) => value !== null && value !== false && value !== "",
				)
			: new Array(6).fill(false);

		const maxSort = Math.max(0, ...actor.effects.map((e) => e.sort ?? 0));
		const systemData =
			type === "status"
				? { tiers, isHidden: game.user.isGM }
				: {
						isScratched: tag.isScratched ?? false,
						isSingleUse: tag.isSingleUse ?? false,
						isHidden: game.user.isGM,
					};
		if (tag.limitId) systemData.limitId = tag.limitId;
		const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
			{
				name: tag.name,
				type: type === "status" ? "status_card" : "story_tag",
				sort: maxSort + 1000,
				system: systemData,
			},
		]);
		if (created) this._editOnRender = created.id;
		await this.#recalculateActorLimits(id);
		return this.#broadcastRender();
	}

	async #updateTagsOnActor({ id, tags }) {
		const actor = game.actors.get(id);
		if (!actor?.isOwner) return;
		return actor.updateEmbeddedDocuments("ActiveEffect", tags);
	}

	async #removeTagFromActor({ actorId, id }) {
		const actor = game.actors.get(actorId);

		if (!actor) {
			return ui.notifications.error("LITM.Ui.error_no_actor", {
				localize: true,
			});
		}
		if (!actor.isOwner) return;

		await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
		await this.#recalculateActorLimits(actorId);
		return this.#broadcastRender();
	}

	async #removeActor(id) {
		if (!game.user.isGM) return;

		// User-assigned characters and the fellowship can't be removed from the sidebar
		if (this.#userCharacterIds.has(id)) {
			return ui.notifications.warn("LITM.Ui.warn_user_character", {
				localize: true,
			});
		}
		if (id === game.litmv2?.fellowship?.id) {
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

	#broadcastUpdate(component, data) {
		return Sockets.dispatch("storyTagsUpdate", { component, data });
	}

	#broadcastRender() {
		this.invalidateCache();
		Sockets.dispatch("storyTagsRender");
		// Always render the sidebar instance — its render() propagates to the popout.
		// If "this" IS the popout, we also need to tell the sidebar to render.
		const sidebar = ui.combat;
		if (sidebar && sidebar !== this) {
			sidebar.invalidateCache();
			sidebar.render();
		} else {
			this.render();
		}
		this.refreshRollDialogs();
	}

	refreshRollDialogs() {
		game.actors.forEach((actor) => {
			if (!actor.sheet?.hasRollDialog) return;
			const dialog = actor.sheet.rollDialogInstance;
			if (dialog?.rendered) dialog.render();
		});
	}

	async doUpdate(component, data) {
		if (!game.user.isGM) return;
		if (component === "tags") return this.setTags(data);
	}
}
