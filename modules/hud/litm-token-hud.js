import {
	isEffectVisible,
	resolveEffect,
} from "../active-effects/effect-queries.js";
import { StatusTagData } from "../active-effects/index.js";
import { ContentSources } from "../system/content-sources.js";
import { getStoryTagSidebar, localize as t } from "../utils.js";

const { TokenHUD } = foundry.applications.hud;

export class LitmTokenHUD extends TokenHUD {
	static DEFAULT_OPTIONS = {
		actions: {
			effect: { handler: LitmTokenHUD.#onToggleEffect, buttons: [0, 2] },
			tier: { handler: LitmTokenHUD.#onClickTier, buttons: [0, 2] },
			visibility: LitmTokenHUD.#onToggleVisibility,
			sidebar: LitmTokenHUD.#onToggleSidebar,
		},
	};

	static PARTS = {
		hud: {
			root: true,
			template: "systems/litmv2/templates/hud/token-hud.hbs",
		},
	};

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		const palette = this.element.querySelector(
			'.palette[data-palette="effects"]',
		);
		if (!palette) return;
		const html = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/hud/token-hud-effects.html",
			{
				statusEffects: context.statusEffects,
				statusRows: context.statusRows,
			},
		);
		palette.innerHTML = html;
	}

	/**
	 * Diff the compendium index against CONFIG.statusEffects and rebuild if stale.
	 */
	async #syncStatuses() {
		const packs = ContentSources.getPacks("statuses");
		if (!packs.length) return;

		// Cheap staleness check from indices, keyed by slugified id (the same
		// key CONFIG.statusEffects dedupes on). Deduping here keeps the size
		// comparison honest when two docs slugify to the same id.
		const indexIds = new Set();
		for (const pack of packs) {
			const index = await pack.getIndex();
			for (const entry of index)
				indexIds.add(entry.name.slugify({ strict: true }));
		}

		// Spread (array iterator) is safe even if the Proxy's ownKeys is
		// currently corrupt by duplicate ids — Object.values is not.
		const current = [...CONFIG.statusEffects];
		const currentIds = new Set(current.map((s) => s.id));
		const stale =
			current.length !== currentIds.size || // already corrupt — self-heal
			currentIds.size !== indexIds.size ||
			[...indexIds].some((id) => !currentIds.has(id));
		if (!stale) return;

		CONFIG.statusEffects = await ContentSources.getStatusEffectConfigs(packs);
	}

	/** @override */
	async _prepareContext(options) {
		await this.#syncStatuses();
		const context = await super._prepareContext(options);
		const isLocked = !this.#canToggleSidebarVisibility();
		const isInSidebar = this.#isInSidebar();
		context.canToggleSidebar = getStoryTagSidebar() !== null;
		context.sidebarClass = isInSidebar ? "active" : "";
		context.sidebarLocked = isLocked;
		context.sidebarTooltip = isLocked
			? t("LITM.Hud.sidebar_locked")
			: t("LITM.Hud.toggle_sidebar");
		context.statusRows = this.#getStatusRows();
		return context;
	}

	/** All status_tag effects on the actor this user may see. */
	*#visibleStatusEffects() {
		if (!this.actor) return;
		for (const effect of this.actor.allApplicableEffects()) {
			if (effect.type !== "status_tag") continue;
			if (!isEffectVisible(effect)) continue;
			yield effect;
		}
	}

	/**
	 * Tier rows rendered below the icon grid — one per visible active
	 * status_tag, whether or not its name matches a CONFIG.statusEffects icon.
	 */
	#getStatusRows() {
		const rows = [];
		for (const effect of this.#visibleStatusEffects()) {
			rows.push({
				title: effect.name,
				effectId: effect.id,
				tiers: [...effect.system.tiers],
				currentTier: effect.system.currentTier,
			});
		}
		return rows;
	}

	#isInSidebar() {
		if (!this.actor) return false;
		return (
			getStoryTagSidebar()?.actors?.some((a) => a.id === this.actor.uuid) ??
			false
		);
	}

	#canToggleSidebarVisibility() {
		if (!this.actor) return false;

		// Either it's not the Fellowship
		if (this.actor.uuid === game.litmv2?.fellowship?.uuid) return false;

		// Or it is not the character of an active user
		const userCharacterUuids = new Set(
			game.users
				.filter((u) => u.active && u.character)
				.map((u) => u.character.uuid),
		);
		return !userCharacterUuids.has(this.actor.uuid);
	}

	/**
	 * Override to match active status_tag effects by name instead of statuses Set.
	 * @override
	 */
	_getStatusEffectChoices() {
		const choices = {};
		// Iterate via the array spread, not Object.values: the v14
		// CONFIG.statusEffects Proxy throws on Object.values if any third-party
		// pack introduces a duplicate slugified id. choices is keyed by id, so
		// any positional duplicates collapse harmlessly here.
		const statuses = [...CONFIG.statusEffects].sort(
			(a, b) =>
				(a.order ?? 0) - (b.order ?? 0) ||
				(a.name ?? "").localeCompare(b.name ?? "", game.i18n.lang),
		);

		for (const status of statuses) {
			choices[status.id] = {
				_id: status._id,
				id: status.id,
				title: status.name,
				src: status.img,
				isActive: false,
				isOverlay: false,
				cssClass: "",
			};
		}

		// Mark grid icons whose name matches a visible active status_tag.
		// Tier rows are built separately in #getStatusRows — they cover all
		// statuses, matched or not.
		for (const effect of this.#visibleStatusEffects()) {
			const status = choices[effect.name.slugify({ strict: true })];
			if (!status) continue;
			status.isActive = true;
			status.effectId = effect.id;
		}

		for (const status of Object.values(choices)) {
			status.cssClass = status.isActive ? "active" : "";
		}
		return choices;
	}

	/**
	 * Handle toggling a status effect — creates/removes status_tag ActiveEffects.
	 * Left-click: add at tier 1 if not present, remove if present.
	 * Right-click: remove entirely.
	 * @this {LitmTokenHUD}
	 */
	static async #onToggleEffect(_event, target) {
		if (!this.actor) {
			ui.notifications.warn("HUD.WarningEffectNoActor", { localize: true });
			return;
		}
		const statusId = target.dataset.statusId;
		const choice = this._getStatusEffectChoices()[statusId];
		if (!choice) return;

		if (choice.isActive) {
			await this.actor.system.removeStatus(choice.effectId);
		} else {
			await this.actor.system.addStatus(choice.title, {
				tiers: StatusTagData.oneHot(1),
				img: choice.src,
			});
		}
	}

	/**
	 * Toggle the actor's presence in the Tags sidebar.
	 * @this {LitmTokenHUD}
	 */
	static async #onToggleSidebar(_event, target) {
		if (!this.actor || !getStoryTagSidebar()) return;
		if (!this.#canToggleSidebarVisibility()) return;

		const sidebar = getStoryTagSidebar();
		const isInSidebar = this.#isInSidebar();

		if (isInSidebar) {
			const actors = sidebar.config.actors.filter(
				(id) => id !== this.actor.uuid,
			);
			await sidebar.setActors(actors);
		} else {
			await sidebar.setActors([...sidebar.config.actors, this.actor.uuid]);
		}

		target.classList.toggle("active", !isInSidebar);
	}

	/**
	 * Toggle actor visibility — uses the tag sidebar for non-user-character actors,
	 * falls back to default token hidden toggle for user characters.
	 * @this {LitmTokenHUD}
	 */
	static async #onToggleVisibility(_event, _target) {
		if (!this.actor) return;
		const isHidden = !!this.document?.hidden;
		const updates = this.layer.controlled.map((o) => ({
			_id: o.id,
			hidden: !isHidden,
		}));
		await canvas.scene.updateEmbeddedDocuments(
			this.document.documentName,
			updates,
		);

		// Sync sidebar visibility
		const sidebar = getStoryTagSidebar();
		if (this.#canToggleSidebarVisibility() && sidebar) {
			const uuid = this.actor.uuid;
			const shouldBeHidden = !isHidden;
			const isHiddenInSidebar = (sidebar.config.hiddenActors ?? []).includes(
				uuid,
			);
			if (shouldBeHidden !== isHiddenInSidebar) {
				await sidebar._toggleActorVisibility(uuid);
			}
		}
	}

	/**
	 * Handle clicking a tier box on an active status.
	 * Left-click: mark/unmark individual tiers.
	 * Right-click: reduce by 1 tier (shift all marks down).
	 * @this {LitmTokenHUD}
	 */
	static async #onClickTier(event, target) {
		const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
		const tier = Number(target.dataset.tier);
		if (!effectId || !tier) return;

		const effect = resolveEffect(effectId, this.actor);
		if (!effect) return;

		// Right-click: reduce by 1
		if (event.button === 2) {
			return effect.system.reduceTier(1, { deleteOnEmpty: true });
		}

		// Left-click: toggle the individual tier box
		await effect.system.toggleTier(tier, { deleteOnEmpty: true });
	}
}
