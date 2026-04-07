// scripts/hud/litm-token-hud.js
import { ContentSources } from "../system/content-sources.js";
import { localize as t, resolveEffect } from "../utils.js";

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
		const palette = this.element.querySelector('.palette[data-palette="effects"]');
		if (!palette) return;
		const html = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/hud/token-hud-effects.html",
			{ statusEffects: context.statusEffects },
		);
		palette.innerHTML = html;
	}

	/**
	 * Diff the compendium index against CONFIG.statusEffects and rebuild if stale.
	 */
	async #syncStatuses() {
		const packs = ContentSources.getPacks("statuses");
		if (!packs.length) return;

		// Build a combined index from all status packs
		const indexIds = new Set();
		for (const pack of packs) {
			const index = await pack.getIndex();
			for (const entry of index) indexIds.add(entry._id);
		}

		const currentIds = new Set(CONFIG.statusEffects.map((s) => s._id));
		const stale =
			currentIds.size !== indexIds.size ||
			[...indexIds].some((id) => !currentIds.has(id));
		if (!stale) return;

		const allDocs = [];
		for (const pack of packs) {
			const docs = await pack.getDocuments();
			allDocs.push(...docs);
		}
		CONFIG.statusEffects = allDocs.map((doc) => ({
			id: doc.name.slugify({ strict: true }),
			_id: doc.id,
			name: doc.name,
			img: doc.img,
		}));
	}

	/** @override */
	async _prepareContext(options) {
		await this.#syncStatuses();
		const context = await super._prepareContext(options);
		const isLocked = this.#isSidebarLocked();
		const isInSidebar = this.#isInSidebar();
		context.canToggleSidebar = ui.combat !== null;
		context.sidebarClass = isInSidebar ? "active" : "";
		context.sidebarLocked = isLocked;
		context.sidebarTooltip = isLocked
			? t("LITM.Hud.sidebar_locked")
			: t("LITM.Hud.toggle_sidebar");
		return context;
	}

	#isSidebarLocked() {
		if (!this.actor) return false;
		const userCharacterIds = new Set(
			game.users.filter((u) => u.character).map((u) => u.character._id),
		);
		const fellowshipId = game.litmv2?.fellowship?.id;
		return userCharacterIds.has(this.actor.id) || this.actor.id === fellowshipId;
	}

	#isInSidebar() {
		if (!this.actor) return false;
		return ui.combat?.actors?.some((a) => a.id === this.actor.id) ?? false;
	}

	#canToggleSidebarVisibility() {
		return !this.#isSidebarLocked();
	}

	/**
	 * Override to match active status_tag effects by name instead of statuses Set.
	 * @override
	 */
	_getStatusEffectChoices() {
		const choices = {};
		const statuses = Object.values(CONFIG.statusEffects).sort(
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
				tiers: null,
				currentTier: 0,
			};
		}

		// Match active status_tag effects on the actor by name
		const activeEffects = this.actor ? [...this.actor.allApplicableEffects()] : [];
		for (const effect of activeEffects) {
			if (effect.type !== "status_tag") continue;
			const slug = effect.name.slugify({ strict: true });
			const status = choices[slug];
			if (!status) continue;
			status.isActive = true;
			status.effectId = effect.id;
			status.tiers = [...effect.system.tiers];
			status.currentTier = effect.system.currentTier;
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
	static async #onToggleEffect(event, target) {
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
				tiers: [true, false, false, false, false, false],
				img: choice.src,
			});
		}
	}

	/**
	 * Toggle the actor's presence in the Tags sidebar.
	 * @this {LitmTokenHUD}
	 */
	static async #onToggleSidebar(event, target) {
		if (!this.actor || !ui.combat) return;
		if (this.#isSidebarLocked()) return;

		const sidebar = ui.combat;
		const isInSidebar = this.#isInSidebar();

		if (isInSidebar) {
			const actors = sidebar.config.actors.filter((id) => id !== this.actor.id);
			await sidebar.setActors(actors);
		} else {
			await sidebar.setActors([...sidebar.config.actors, this.actor.id]);
		}

		target.classList.toggle("active", !isInSidebar);
	}

	/**
	 * Toggle actor visibility — uses the tag sidebar for non-user-character actors,
	 * falls back to default token hidden toggle for user characters.
	 * @this {LitmTokenHUD}
	 */
	static async #onToggleVisibility(event, target) {
		if (!this.actor) return;
		const isHidden = !!this.document?.hidden;
		const updates = this.layer.controlled.map((o) => ({ _id: o.id, hidden: !isHidden }));
		target.classList.toggle("active", !isHidden);
		await canvas.scene.updateEmbeddedDocuments(this.document.documentName, updates);
		// Also toggle sidebar visibility for non-user-character actors
		if (this.#canToggleSidebarVisibility()) {
			await ui.combat?._toggleActorVisibility(this.actor.id, { syncTokens: false });
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

		const effect = resolveEffect(effectId, this.actor, { fellowship: false });
		if (!effect) return;

		// Right-click: reduce by 1
		if (event.button === 2) {
			if (!effect.system.tiers.some(Boolean)) return;
			const newTiers = effect.system.calculateReduction(1);
			if (newTiers.every((t) => !t)) {
				await this.actor.system.removeStatus(effectId);
				return;
			}
			await effect.update({ "system.tiers": newTiers });
			return;
		}

		// Left-click: toggle the individual tier box
		const newTiers = [...effect.system.tiers];
		newTiers[tier - 1] = !newTiers[tier - 1];
		if (newTiers.every((t) => !t)) {
			await this.actor.system.removeStatus(effectId);
			return;
		}
		await effect.update({ "system.tiers": newTiers });
	}
}
