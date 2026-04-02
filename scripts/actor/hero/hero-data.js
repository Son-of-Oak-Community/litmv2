export class HeroData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			description: new fields.HTMLField({ initial: "" }),
			relationships: new fields.ArrayField(
				new fields.SchemaField({
					actorId: new fields.StringField({ initial: "" }),
					name: new fields.StringField({ initial: "" }),
					tag: new fields.StringField({ initial: "" }),
					isScratched: new fields.BooleanField({ initial: false }),
				}),
				{
					initial: [],
				},
			),
			promise: new fields.NumberField({
				initial: 0,
				min: 0,
				max: 5,
				integer: true,
			}),
			mof: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField({ initial: "" }),
					description: new fields.HTMLField({ initial: "" }),
				}),
				{ initial: [] },
			),
			fellowshipId: new fields.StringField({ initial: "" }),
			limit: new fields.SchemaField({
				value: new fields.NumberField({ initial: 6, integer: true }),
				max: new fields.NumberField({ initial: 6, integer: true }),
			}),
		};
	}

	static getTrackableAttributes() {
		return {
			bar: ["limit"],
			value: [],
		};
	}

	get fellowshipActor() {
		if (this.fellowshipId) {
			const actor = game.actors.get(this.fellowshipId);
			if (actor) return actor;
		}
		// Fallback to the global singleton
		return game.litmv2?.fellowship ?? null;
	}

	get backpack() {
		const backpack = this.parent.items.find((item) => item.type === "backpack");
		if (!backpack) return [];
		return backpack.system.tags;
	}

	/** @type {Item[]|null} Cached by prepareDerivedData, cleared each cycle. */
	#cachedThemeItems = null;
	/** @type {ActiveEffect[]|null} Cached by prepareDerivedData, cleared each cycle. */
	#cachedEffectTags = null;

	get #themeItems() {
		if (this.#cachedThemeItems) return this.#cachedThemeItems;
		const ownThemes = this.parent.items.filter(
			(item) => item.type === "theme" || item.type === "story_theme",
		);
		const fellowship = this.fellowshipActor;
		if (!fellowship) {
			this.#cachedThemeItems = ownThemes;
			return ownThemes;
		}
		const fellowshipThemes = fellowship.items.filter(
			(item) => item.type === "theme" || item.type === "story_theme",
		);
		this.#cachedThemeItems = [...ownThemes, ...fellowshipThemes];
		return this.#cachedThemeItems;
	}

	get allTags() {
		const backpack = this.backpack;
		const themeTags = this.#themeItems.flatMap((item) => item.system.allTags);
		return [...backpack, ...themeTags];
	}

	get powerTags() {
		return this.allTags.filter(
			(tag) =>
				tag.type === "powerTag" ||
				tag.type === "themeTag" ||
				tag.type === "backpack",
		);
	}

	get weaknessTags() {
		return this.#themeItems.flatMap((item) => item.system.weaknessTags);
	}

	get availablePowerTags() {
		const backpack = this.backpack.filter(
			(tag) => tag.isActive && !tag.isScratched,
		);
		const themeTags = this.#themeItems.flatMap(
			(item) => item.system.availablePowerTags,
		);
		return [...backpack, ...themeTags];
	}

	get relationshipEntries() {
		const heroActors = (game.actors ?? []).filter(
			(actor) => actor.type === "hero" && actor.id !== this.parent.id,
		);
		const existing = Array.isArray(this.relationships)
			? this.relationships
			: [];
		return heroActors
			.map((actor) => {
				const existingEntry =
					existing.find((entry) => entry.actorId === actor.id) ||
					existing.find(
						(entry) =>
							!entry.actorId &&
							(entry.name ?? "").toLowerCase() === actor.name.toLowerCase(),
					);
				return {
					actorId: actor.id,
					name: actor.name,
					img: actor.img,
					tag: existingEntry?.tag ?? "",
					isScratched: existingEntry?.isScratched ?? false,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	get relationshipTags() {
		return this.relationshipEntries
			.map((entry) => {
				const tag = (entry?.tag ?? "").trim();
				if (!tag) return null;
				return {
					id: `relationship-${entry.actorId}`,
					name: `${entry.name} - ${tag}`,
					displayName: tag,
					themeId: `__relationship_${entry.actorId}`,
					themeName: entry.name,
					actorImg: entry.img,
					type: "relationshipTag",
					isSingleUse: true,
					isScratched: entry.isScratched,
					state: "",
					states: ",positive",
				};
			})
			.filter(Boolean);
	}

	/**
	 * All story_tag and status_card effects applicable to this hero,
	 * including transferred effects from embedded items (e.g. backpack).
	 * @returns {ActiveEffect[]}
	 */
	get effectTags() {
		if (this.#cachedEffectTags) return this.#cachedEffectTags;
		const effects = [];
		for (const effect of this.parent.allApplicableEffects()) {
			if (effect.type === "story_tag" || effect.type === "status_card") {
				effects.push(effect);
			}
		}
		this.#cachedEffectTags = effects;
		return effects;
	}

	get statuses() {
		return this.effectTags
			.filter((effect) => effect.type === "status_card")
			.filter((effect) => game.user.isGM || !effect.system?.isHidden)
			.map((effect) => {
				return {
					id: effect._id,
					name: effect.name,
					type: "status",
					value: effect.system.currentTier,
				};
			});
	}

	get storyTags() {
		return this.effectTags
			.filter((effect) => effect.type === "story_tag")
			.filter((effect) => game.user.isGM || !effect.system?.isHidden)
			.map((effect) => {
				return {
					id: effect._id,
					name: effect.name,
					type: "tag",
					isSingleUse: effect.system?.isSingleUse ?? false,
					value: 1,
				};
			});
	}

	/**
	 * All tags available for the roll dialog, in a consistent shape grouped by source.
	 * Includes theme tags, backpack tags, and relationship tags — only active, non-scratched.
	 * @returns {object[]}
	 */
	get rollableTags() {
		const tags = [];
		const fellowshipActor = this.fellowshipActor;
		const fellowshipItemIds = new Set(
			fellowshipActor?.items.map((i) => i.id) ?? [],
		);

		const ownThemes = this.parent.items
			.filter(
				(i) =>
					(i.type === "theme" && !i.system.isFellowship) ||
					i.type === "story_theme",
			)
			.sort((a, b) => a.sort - b.sort);

		const fellowshipThemes = fellowshipActor
			? fellowshipActor.items.filter(
					(i) => i.type === "theme" || i.type === "story_theme",
				)
			: [];

		for (const theme of [...ownThemes, ...fellowshipThemes]) {
			const isFellowship = !!theme.system?.isFellowship;
			const fromFellowship = fellowshipItemIds.has(theme.id);
			const themeImg = theme.img;
			const themeTag = theme.system?.themeTag;

			if (themeTag?.name && themeTag?.isActive && !themeTag?.isScratched) {
				tags.push({
					id: theme.id,
					name: theme.name,
					displayName: theme.name,
					themeId: theme.id,
					themeName: theme.name,
					themeImg,
					type: "themeTag",
					isSingleUse: isFellowship,
					fromFellowship,
					state: "",
					states: ",positive",
				});
			}

			for (const tag of theme.system?.powerTags ?? []) {
				if (tag?.name && tag?.isActive && !tag?.isScratched) {
					tags.push({
						id: tag.id,
						name: `${theme.name} - ${tag.name}`,
						displayName: tag.name,
						themeId: theme.id,
						themeName: theme.name,
						themeImg,
						type: tag.type ?? "powerTag",
						isSingleUse: isFellowship,
						fromFellowship,
						state: "",
						states: isFellowship
							? ",positive,negative"
							: ",positive,scratched",
					});
				}
			}

			for (const tag of theme.system?.weaknessTags ?? []) {
				if (tag?.name && tag?.isActive && !tag?.isScratched) {
					tags.push({
						id: tag.id,
						name: `${theme.name} - ${tag.name}`,
						displayName: tag.name,
						themeId: theme.id,
						themeName: theme.name,
						themeImg,
						type: tag.type ?? "weaknessTag",
						fromFellowship,
						state: "",
						states: ",negative,positive",
					});
				}
			}
		}

		// Backpack tags
		const backpack = this.parent.items.find((i) => i.type === "backpack");
		if (backpack) {
			for (const e of backpack.effects) {
				if (e.type !== "story_tag" || e.disabled || e.system.isScratched) continue;
				tags.push({
					id: e.id,
					name: e.name,
					displayName: e.name,
					themeId: backpack.id,
					themeName: backpack.name,
					type: "backpack",
					isSingleUse: e.system.isSingleUse ?? false,
					state: "",
					states: e.system.isSingleUse ? ",positive" : ",positive,scratched",
				});
			}
		}

		// Relationship tags
		tags.push(...this.relationshipTags);

		return tags;
	}

	/**
	 * All scratched tags across themes, backpack, and story effects.
	 * Used by SpendPowerApp for unscratch options.
	 * @returns {object[]}
	 */
	get scratchedTags() {
		const tags = [];
		const scratchableTypes = new Set(["theme", "story_theme", "backpack"]);

		for (const item of this.parent.items) {
			if (!scratchableTypes.has(item.type)) continue;
			for (const effect of item.effects) {
				if (!effect.system?.isScratched) continue;
				if (effect.type === "theme_tag" || effect.type === "story_tag") {
					tags.push({ id: effect.id, name: effect.name, source: "effect", itemId: item.id });
				}
			}
		}

		for (const effect of this.parent.effects) {
			if (effect.type === "story_tag" && effect.system?.isScratched) {
				tags.push({ id: effect.id, name: effect.name, source: "effect" });
			}
		}

		return tags;
	}

	/**
	 * Toggle scratch state of a tag.
	 * @param {object} tag  Tag object with at least `id` and `type`
	 */
	async toggleScratchTag(tag) {
		if (Hooks.call("litm.preTagScratched", this.parent, tag) === false) {
			return;
		}
		const fellowshipActor = this.fellowshipActor;
		switch (tag.type) {
			case "powerTag": {
				const findTheme = (actor) =>
					actor?.items.find(
						(i) =>
							["theme", "story_theme"].includes(i.type) &&
							i.effects.has(tag.id),
					);
				const parentTheme =
					findTheme(this.parent) ?? findTheme(fellowshipActor);
				if (!parentTheme) return;

				const effect = parentTheme.effects.get(tag.id);
				if (effect) {
					await parentTheme.updateEmbeddedDocuments("ActiveEffect", [
						{
							_id: effect.id,
							"system.isScratched": !effect.system.isScratched,
						},
					]);
				}
				break;
			}
			case "themeTag": {
				const theme =
					this.parent.items.get(tag.id) ?? fellowshipActor?.items.get(tag.id);
				if (!theme) return;
				const isScratched = theme.system.isScratched ?? false;
				await theme.parent.updateEmbeddedDocuments("Item", [
					{ _id: theme.id, "system.isScratched": !isScratched },
				]);
				break;
			}
			case "backpack": {
				const backpack = this.parent.items.find((i) => i.type === "backpack");
				if (!backpack) break;
				const effect = backpack.effects.get(tag.id);
				if (!effect) break;
				await backpack.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: effect.id, "system.isScratched": !effect.system.isScratched },
				]);
				break;
			}
			case "tag": {
				const allEffects = [...this.parent.allApplicableEffects()];
				const effect = allEffects.find(
					(e) => e.id === tag.id && e.type === "story_tag",
				);
				if (!effect) return;
				const isScratched = effect.system?.isScratched ?? false;
				await effect.parent.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: effect.id, "system.isScratched": !isScratched },
				]);
				break;
			}
			case "relationshipTag": {
				const actorId = tag.id.replace("relationship-", "");
				const relationships = foundry.utils.deepClone(
					this.relationships ?? [],
				);
				const entry = relationships.find((r) => r.actorId === actorId);
				if (!entry) return;
				entry.isScratched = !entry.isScratched;
				await this.parent.update({ "system.relationships": relationships });
				break;
			}
			default:
				return;
		}
		Hooks.callAll("litm.tagScratched", this.parent, tag);
	}

	/**
	 * Gain improvement from using a weakness tag or relationship tag as negative.
	 * Resolves the effect by UUID to trace it back to its parent theme.
	 * @param {object} tag  The tag with `uuid` and `type`
	 */
	async gainImprovement(tag) {
		// Relationship tags always improve the fellowship theme
		if (tag.type === "relationship_tag") {
			const fellowship = this.fellowshipActor;
			if (!fellowship) return;
			const theme = fellowship.items.find(
				(i) => i.type === "theme" && i.system.isFellowship,
			);
			if (!theme) return;
			await fellowship.updateEmbeddedDocuments("Item", [
				{ _id: theme.id, "system.improve.value": theme.system.improve.value + 1 },
			]);
			return;
		}

		// Trace effect → parent theme → owner actor via UUID
		if (!tag.uuid) return;
		const effect = await foundry.utils.fromUuid(tag.uuid);
		if (!effect) return;
		const parentTheme = effect.parent;
		if (!parentTheme || !["theme", "story_theme"].includes(parentTheme.type)) return;
		const owner = parentTheme.parent;
		if (!owner) return;
		await owner.updateEmbeddedDocuments("Item", [
			{ _id: parentTheme.id, "system.improve.value": parentTheme.system.improve.value + 1 },
		]);
	}

	getRollData() {
		return {
			promise: this.promise,
			limit: this.limit.value,
			limitMax: this.limit.max,
			power: this.availablePowerTags.length,
			weakness: this.weaknessTags.filter((t) => t.isActive && !t.isScratched)
				.length,
		};
	}

	prepareDerivedData() {
		super.prepareDerivedData();
		this.#cachedThemeItems = null;
		this.#cachedEffectTags = null;
		const highestStatus =
			this.statuses.sort((a, b) => b.value - a.value)[0]?.value || 0;
		this.limit.value = 6 - highestStatus;
		this.limit.max = 6;
	}
}
