import { maxStatusTier } from "../active-effects/status-tag-data.js";
import {
	graceMoments,
	markMomentOfGrace,
	removeMomentOfGrace,
	secretGraceTier,
	toggleMomentOfGrace,
} from "../actor/hero/secret-grace.js";
import { confirmDelete, localize as t } from "../utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Narrator's window on a Hero's Secret Grace (Vol. II p.78): the tier,
 * and the moments of grace behind it — marked, scratched for history, or
 * removed. Opened from the hero sheet and from a Sacrifice's roll window; the
 * Narrator's alone, so it never opens for a player.
 */
export class SecretGraceApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm--secret-grace"],
		window: { icon: "fa-solid fa-dove", resizable: true },
		position: { width: 420 },
		actions: {
			markMomentOfGrace: SecretGraceApp.#onMark,
			scratchMomentOfGrace: SecretGraceApp.#onScratch,
			removeMomentOfGrace: SecretGraceApp.#onRemove,
		},
	};

	static PARTS = {
		main: {
			template: "systems/litmv2/templates/apps/secret-grace.html",
			scrollable: [".litm--grace-moments"],
		},
	};

	/** The id of a Hero's window, so it can follow the Hero's updates. */
	static idFor(actor) {
		return `litm-secret-grace-${actor.id}`;
	}

	/**
	 * Open, or raise, a Hero's Secret Grace. Narrator only.
	 * @param {Actor} actor
	 */
	static open(actor) {
		if (!game.user.isGM || !actor) return null;
		const open = foundry.applications.instances.get(this.idFor(actor));
		if (open) {
			open.bringToFront();
			return open;
		}
		return new this({ id: this.idFor(actor), actor }).render(true);
	}

	constructor({ actor, ...options } = {}) {
		super(options);
		this.actor = actor;
	}

	get title() {
		return `${t("LITM.Ui.sacrifice_grace")}: ${this.actor.name}`;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const tier = secretGraceTier(this.actor);
		return {
			...context,
			tier,
			tiers: Array.from({ length: maxStatusTier() }, (_, i) => i < tier),
			moments: graceMoments(this.actor),
		};
	}

	/** Mark one tier of Secret Grace for a moment the Narrator notes down. */
	static async #onMark() {
		const text = await foundry.applications.api.DialogV2.prompt({
			window: { title: t("LITM.Ui.secret_grace_mark") },
			content: `<p class="hint">${foundry.utils.escapeHTML(
				game.i18n.format("LITM.Ui.secret_grace_mark_prompt", {
					name: this.actor.name,
				}),
			)}</p><textarea name="text" rows="3" autofocus></textarea>`,
			ok: {
				label: t("LITM.Ui.secret_grace_mark"),
				callback: (_event, button) => button.form.elements.text.value,
			},
			rejectClose: false,
		});
		if (!text?.trim()) return;
		await markMomentOfGrace(this.actor, text);
	}

	/** Scratch a moment for history, or restore it. */
	static async #onScratch(_event, target) {
		await toggleMomentOfGrace(this.actor, target.dataset.momentId);
	}

	static async #onRemove(_event, target) {
		if (!(await confirmDelete("LITM.Ui.secret_grace_moment"))) return;
		await removeMomentOfGrace(this.actor, target.dataset.momentId);
	}
}
