import { BURN_POWER, ROLL_TYPES } from "../system/config.js";
import { localize as t } from "../utils.js";

export class LitmRoll extends foundry.dice.Roll {
	static CHAT_TEMPLATE = "systems/litmv2/templates/chat/message.html";
	static TOOLTIP_TEMPLATE =
		"systems/litmv2/templates/chat/message-tooltip.html";

	get litm() {
		return this.options || {};
	}

	get actor() {
		return game.actors.get(this.litm.actorId);
	}

	get speaker() {
		const actor = this.actor;
		return { alias: actor?.name || "Unknown" };
	}

	get flavor() {
		const cfg = ROLL_TYPES[this.litm.type] ?? ROLL_TYPES.quick;
		const key = cfg.flavor(this);
		return key.includes(" ") ? key.split(" ").map(k => t(k)).join(" ") : t(key);
	}

	get effect() {
		const cfg = ROLL_TYPES[this.litm.type] ?? ROLL_TYPES.quick;
		return cfg.effect(this);
	}

	get power() {
		const { label: outcome } = this.outcome;
		const cfg = ROLL_TYPES[this.litm.type] ?? ROLL_TYPES.quick;

		if (!cfg.hasPower) return null;

		if (outcome === "consequences") return 0;

		let totalPower = Math.max(this.litm.totalPower, 1);

		const tradePower = this.litm.tradePower || 0;
		if (tradePower) {
			totalPower = Math.max(totalPower - tradePower, 1);
		}

		if (this.litm.type === "mitigate" && outcome === "success") {
			totalPower += 1;
		}

		if (this.litm.pushed) {
			totalPower += 1;
		}

		return totalPower;
	}

	get outcome() {
		const { resolver } = CONFIG.litmv2.roll;
		if (typeof resolver === "function") return resolver(this);

		const cfg = ROLL_TYPES[this.litm.type] ?? ROLL_TYPES.quick;
		if (cfg.outcome) return cfg.outcome(this);

		const diceTotal = this.dice.reduce((sum, die) => sum + die.total, 0);

		if (diceTotal === 2) {
			return { label: "consequences", description: "LITM.Ui.roll_failure" };
		}

		if (diceTotal === 12 || this.total > 9) {
			if (this.litm.pushed) {
				return { label: "snc", description: "LITM.Ui.roll_consequence" };
			}
			return { label: "success", description: "LITM.Ui.roll_success" };
		}

		if (this.total >= 7) {
			return { label: "snc", description: "LITM.Ui.roll_consequence" };
		}

		return { label: "consequences", description: "LITM.Ui.roll_failure" };
	}

	#getSacrificeThemeName() {
		const themeId = this.litm.sacrificeThemeId;
		if (!themeId) return null;
		const actor = this.actor;
		const theme = actor?.items?.get(themeId);
		return theme?.name || null;
	}

	get modifier() {
		return this.options.modifier || 0;
	}

	async render({
		template = this.constructor.CHAT_TEMPLATE,
		isPrivate = false,
	} = {}) {
		if (!this._evaluated) await this.evaluate();

		const chatData = {
			actor: this.actor,
			formula: isPrivate ? "???" : this.formula.replace(/\s\+0/, ""),
			flavor: isPrivate ? null : this.flavor,
			outcome: isPrivate ? "???" : this.outcome,
			power: isPrivate ? "???" : this.power,
			result: isPrivate ? "???" : this.result,
			title: this.litm.title || this.flavor,
			tooltip: isPrivate ? "" : await this.getTooltip(),
			total: isPrivate ? "" : Math.round(this.total * 100) / 100,
			type: this.litm.type,
			effect: this.effect,
			modifier: isPrivate ? "???" : this.modifier,
			tradePower: this.litm.tradePower || 0,
			sacrificeLevel: this.litm.sacrificeLevel || null,
			sacrificeThemeName: this.#getSacrificeThemeName(),
			user: game.user.id,
			isOwner: game.user.isGM || this.actor?.isOwner,
			canSpendPower:
				this.litm.type === "tracked" &&
				(this.outcome.label === "success" ||
					this.outcome.label === "snc") &&
				this.power > 0,
			canCompleteSacrifice:
				this.litm.type === "sacrifice" &&
				!!this.litm.sacrificeThemeId &&
				(this.litm.sacrificeLevel === "painful" ||
					this.litm.sacrificeLevel === "scarring") &&
				!this.litm.sacrificeCompleted,
		};

		return foundry.applications.handlebars.renderTemplate(template, chatData);
	}

	async getTooltip() {
		const parts = this.dice.map((d) => d.getTooltipData());
		const data = this.getTooltipData();
		return foundry.applications.handlebars.renderTemplate(
			LitmRoll.TOOLTIP_TEMPLATE,
			{ data, parts },
		);
	}

	static calculatePower(tags) {
		const scratchedTags = tags.scratchedTags ?? [];
		const scratchedValue = scratchedTags.length * BURN_POWER;

		const powerValue = tags.powerTags.length;

		const weaknessValue = tags.weaknessTags.length;

		const statusValue = (t) => t.system?.currentTier ?? Number.parseInt(t.value, 10) ?? 0;
		const positiveStatusValue = tags.positiveStatuses.reduce(
			(max, t) => Math.max(max, statusValue(t)),
			0,
		);

		const negativeStatusValue = tags.negativeStatuses.reduce(
			(max, t) => Math.max(max, statusValue(t)),
			0,
		);

		const modifier = Number(tags.modifier) || 0;

		const mightOffset = Number(tags.might) || 0;

		const totalPower =
			scratchedValue +
			powerValue +
			positiveStatusValue -
			weaknessValue -
			negativeStatusValue +
			modifier +
			mightOffset;

		return {
			scratchedValue,
			scratchedTags,
			powerValue,
			weaknessValue,
			positiveStatusValue,
			negativeStatusValue,
			totalPower,
			modifier,
			mightOffset,
		};
	}

	static filterTags(tags) {
		const scratchedTags = tags.filter(
			(t) => t.state === "scratched",
		);
		const isStatus = (t) => t.type === "status_tag";
		const powerTags = tags.filter(
			(t) => !isStatus(t) && t.state === "positive",
		);
		const weaknessTags = tags.filter(
			(t) => !isStatus(t) && t.state === "negative",
		);
		const positiveStatuses = tags.filter(
			(t) => isStatus(t) && t.state === "positive",
		);
		const negativeStatuses = tags.filter(
			(t) => isStatus(t) && t.state === "negative",
		);

		return {
			scratchedTags,
			powerTags,
			weaknessTags,
			positiveStatuses,
			negativeStatuses,
		};
	}

	getTooltipData() {
		const { label: outcome } = this.outcome;
		return {
			mitigate: this.litm.type === "mitigate" && outcome === "success",
			scratchedTags: this.litm.scratchedTags ?? [],
			powerTags: this.litm.powerTags,
			weaknessTags: this.litm.weaknessTags,
			positiveStatuses: this.litm.positiveStatuses,
			negativeStatuses: this.litm.negativeStatuses,
			modifier: this.modifier,
			mightOffset: this.litm.mightOffset || 0,
			might: this.litm.might ?? 0,
		};
	}
}
