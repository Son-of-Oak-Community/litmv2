import {
	computePowerBudget,
	getAllowedVerbs,
	getSuccessCost,
	scanMarkup,
} from "../item/action/action-rules.js";
import { getVerbDef } from "../item/action/verb-definitions.js";
import { localize as t } from "../utils.js";
import { adjustCounter, readVariableTiers } from "./counter-controls.js";
import { applySpendIntent } from "./spend-power-service.js";

/** Cost calculators by option type. Each receives (li, cost, entriesSection, hasTier). */
const COST_CALCULATORS = {
	statusPicker(_li, cost, entriesSection) {
		let total = 0;
		entriesSection
			.querySelectorAll(".litm-spend-power__status-item")
			.forEach((item) => {
				const count = Number(
					item.querySelector(".litm-spend-power__counter-value")?.textContent ??
						0,
				);
				total += cost * count;
			});
		return total;
	},
	counter(_li, cost, entriesSection) {
		const count = Number(
			entriesSection.querySelector(".litm-spend-power__counter-value")
				?.textContent ?? 1,
		);
		return cost * count;
	},
	picker(_li, cost, entriesSection) {
		const selected = entriesSection.querySelectorAll(
			".litm-spend-power__tag-chip.is-selected",
		);
		return cost * selected.length;
	},
};

function defaultCostCalculator(li, cost, _entriesSection, hasTier) {
	const entries = li.querySelectorAll(".litm-spend-power__entry");
	if (entries.length === 0) return cost;
	if (!hasTier) {
		// Single-use story tags cost 1 Power per entry (p.165); normal tags cost `cost`.
		let total = 0;
		entries.forEach((entry) => {
			const isSingleUse =
				entry.querySelector(".litm-spend-power__entry-single-use")?.checked ===
				true;
			total += isSingleUse ? 1 : cost;
		});
		return total;
	}
	let total = 0;
	entries.forEach((entry) => {
		const tier = Math.max(
			Number(entry.querySelector(".litm-spend-power__entry-tier")?.value ?? 1),
			1,
		);
		total += cost * tier;
	});
	return total;
}

/**
 * Determine the option type from its DOM structure.
 * Module-level so parseSpendIntent can call it without class-private access.
 * @param {HTMLElement} li  The option list item
 * @returns {{ type: string, entriesSection: HTMLElement|null, hasTier: boolean }}
 */
function getOptionType(li) {
	const entriesSection = li.querySelector(".litm-spend-power__entries");
	const hasTier = li.dataset.hasTier === "true";
	if (entriesSection && "statusPicker" in entriesSection.dataset)
		return { type: "statusPicker", entriesSection, hasTier };
	if (entriesSection && "counter" in entriesSection.dataset)
		return { type: "counter", entriesSection, hasTier };
	if (entriesSection && "picker" in entriesSection.dataset)
		return { type: "picker", entriesSection, hasTier };
	return { type: "default", entriesSection, hasTier };
}

export class SpendPowerApp extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-spend-power",
		classes: ["litm", "litm-spend-power"],
		tag: "form",
		window: {
			title: "LITM.Ui.spend_power_title",
			resizable: true,
		},
		position: {
			width: 600,
			height: 640,
		},
		form: {
			handler: SpendPowerApp.#onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			"counter-inc": SpendPowerApp.#onCounter,
			"counter-dec": SpendPowerApp.#onCounter,
			"add-entry": SpendPowerApp.#onAddEntryAction,
			"remove-entry": SpendPowerApp.#onRemoveEntry,
			"toggle-chip": SpendPowerApp.#onToggleChip,
			"toggle-option": SpendPowerApp.#onToggleOption,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/spend-power.html",
		},
	};

	constructor(options = {}) {
		super(options);
		this.actorId = options.actorId;
		this.messageId = options.messageId;
		this.totalPower = options.power || 0;
		const message = this.messageId ? game.messages.get(this.messageId) : null;
		this.alreadySpent = message?.getFlag("litmv2", "spentPower") ?? 0;
		this.power = this.totalPower - this.alreadySpent;
		this.spendingOptions = [
			{
				id: "create_recover_tag",
				label: "LITM.Effects.create.action",
				cost: 2,
				description: "LITM.Effects.create.description",
				draggable: true,
			},
			{
				id: "scratch_tag",
				label: "LITM.Effects.scratch.action",
				cost: 2,
				description: "LITM.Effects.scratch.description",
				draggable: true,
			},
			{
				id: "inflict_status",
				label: "LITM.Effects.inflict.action",
				cost: 1,
				description: "LITM.Effects.inflict.description",
				hasTier: true,
				draggable: true,
			},
			{
				id: "reduce_status",
				label: "LITM.Effects.reduce.action",
				cost: 1,
				description: "LITM.Effects.reduce.description",
				hasTier: true,
				draggable: true,
			},
			{
				id: "discover_detail",
				label: "LITM.Effects.discover.action",
				cost: 1,
				description: "LITM.Effects.discover.description",
				hasCounter: true,
			},
			{
				id: "extra_feat",
				label: "LITM.Effects.extra_feat.action",
				cost: 1,
				description: "LITM.Effects.extra_feat.description",
			},
		];
	}

	async _prepareContext(_options) {
		const actor = game.actors.get(this.actorId);
		const scratchedTags = actor ? this.#getScratchedTags(actor) : [];
		const statusCards = actor ? this.#getStatusCards(actor) : [];

		const options = this.spendingOptions
			.filter((o) => o.id !== "scratch_tag" || scratchedTags.length > 0)
			.filter((o) => o.id !== "reduce_status" || statusCards.length > 0)
			.map((o) => {
				if (o.id === "scratch_tag") return { ...o, scratchedTags };
				if (o.id === "reduce_status") return { ...o, statusCards };
				return o;
			});

		const actionSuccesses = await this.#getActionSuccesses();

		// Power displayed at the top must account for BOTH the generic options
		// already spent (spentPower flag) and the action successes already
		// applied (appliedSuccesses flag). Two flags, one budget.
		const message = this.messageId ? game.messages.get(this.messageId) : null;
		const action = await this.#getAction();
		const appliedKeys = message?.getFlag("litmv2", "appliedSuccesses") ?? [];
		const appliedSuccessesCost = action
			? appliedKeys.reduce((sum, key) => {
					const s = (action.system.successes ?? []).find((o) => o.id === key);
					if (!s) return sum;
					const c = getSuccessCost(s);
					return sum + c.fixed + c.variableTokens;
				}, 0)
			: 0;
		this.power = this.totalPower - this.alreadySpent - appliedSuccessesCost;

		return {
			actorId: this.actorId,
			power: this.power,
			options,
			actionSuccesses,
		};
	}

	async #getAction() {
		const message = this.messageId ? game.messages.get(this.messageId) : null;
		const uuid = message?.getFlag("litmv2", "actionUuid");
		if (!uuid) return null;
		const a = await foundry.utils.fromUuid(uuid);
		return a?.type === "action" ? a : null;
	}

	/**
	 * Build the action-success rows shown above the generic spend options.
	 * Empty array if the message wasn't bound to an action (eg. plain Tracked
	 * roll without an Action Grimoire entry).
	 */
	async #getActionSuccesses() {
		const message = this.messageId ? game.messages.get(this.messageId) : null;
		const action = await this.#getAction();
		if (!message || !action) return [];

		const sys = action.system;
		const applied = new Set(
			message.getFlag("litmv2", "appliedSuccesses") ?? [],
		);
		const roll = message.rolls?.[0];
		const allowedVerbs = getAllowedVerbs(roll);
		// Affordability uses the combined remaining (action-aware budget minus
		// generic power already spent on Create/Inflict/etc.).
		const { remaining: actionRemaining } = computePowerBudget(roll, sys, [
			...applied,
		]);
		const remaining = actionRemaining - this.alreadySpent;

		// Hide already-applied successes — their cost is baked into `this.power`,
		// so showing them as checked-and-disabled would double-count in
		// #updatePower. The chat history of action-applied messages is the
		// canonical record of what's been used.
		return (sys.successes ?? [])
			.filter((s) => allowedVerbs.has(s.verb))
			.filter((s) => !applied.has(s.id))
			.map((s) => {
				const def = getVerbDef(s.verb);
				const cost = getSuccessCost(s);
				// Variable tokens default to 0 ("skip") so the floor cost is
				// the fixed part alone. The badge updates as the player nudges
				// each [name-] counter upward in #onCounter.
				const minCost = cost.fixed;
				const isUnsupported = def?.kind === "unsupported";
				const cantAfford = minCost > remaining;

				// Variable-tier tokens get inline counters. We surface them in
				// scan order so the apply path can map counter values back to
				// `chosenTiers` indices in `applySuccess`.
				const varTokens = scanMarkup(s.text)
					.filter((tok) => tok.type === "status" && tok.isVariable)
					.map((tok, idx) => ({ idx, name: tok.name }));

				return {
					key: s.id,
					verbLabel: t(`LITM.Actions.verbs.${s.verb}`),
					verbKind: def?.displayKind ?? "self",
					text: s.text,
					cost: minCost,
					fixedCost: cost.fixed,
					varTokens,
					hasVariableTier: varTokens.length > 0,
					disabled: isUnsupported || cantAfford,
					reasonKey: isUnsupported
						? def.unsupportedMessageKey
						: cantAfford
							? "LITM.Actions.cant_afford_short"
							: null,
				};
			});
	}

	#getScratchedTags(actor) {
		return (actor.system.scratchedTags ?? []).map((effect) => ({
			id: effect.id,
			name: effect.name,
			itemId: effect.parent !== actor ? effect.parent?.id : "",
		}));
	}

	#getStatusCards(actor) {
		const statuses = [];
		for (const effect of actor.allApplicableEffects()) {
			if (effect.type === "status_tag") {
				const tier = effect.system?.currentTier ?? 0;
				if (tier > 0) {
					statuses.push({ id: effect.id, name: effect.name, tier });
				}
			}
		}
		return statuses;
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);

		const form = this.element;

		// Tier input changes — non-click event, must stay manual.
		form.addEventListener("input", (event) => {
			if (event.target.classList.contains("litm-spend-power__entry-tier")) {
				this.#updatePower(form);
			}
		});

		// Checkbox toggles reveal/hide their entry section. Native change event,
		// not covered by [data-action].
		form.addEventListener("change", (event) => {
			if (
				event.target.classList.contains("litm-spend-power__entry-single-use")
			) {
				this.#updatePower(form);
				return;
			}
			const checkbox = event.target.closest("[data-option-check]");
			if (!checkbox) return;
			const li = checkbox.closest(".litm-spend-power__option");
			this.#toggleEntries(li);
			this.#updatePower(form);
		});
	}

	/** @this {SpendPowerApp} */
	static #onCounter(_event, target) {
		const statusItem = target.closest(".litm-spend-power__status-item");
		const varTier = target.closest(".litm-spend-power__var-tier");
		// Variable-tier counters clamp 0..6 — 0 means "skip this token" so a
		// success listing many alternative statuses (eg. an Action Grimoire
		// Attack with [ferido-] [cortado-] [perfurado-] …) lets the player
		// pick which ones to apply. reduce_status clamps 0..currentTier.
		// Everything else clamps 1..∞.
		const min = statusItem || varTier ? 0 : 1;
		const max = statusItem
			? Number(statusItem.dataset.maxTier)
			: varTier
				? 6
				: Infinity;
		adjustCounter(target, { min, max });

		// Live cost label update for action-success rows.
		if (varTier) {
			const li = varTier.closest(".litm-spend-power__option");
			const costEl = li?.querySelector("[data-action-success-cost]");
			if (li && costEl) {
				const total = this.#calculateOptionCost(li, Number(li.dataset.cost));
				costEl.textContent = `${total} ${t("LITM.Tags.power")}`;
			}
		}

		this.#updatePower(this.element);
	}

	/** @this {SpendPowerApp} */
	static #onRemoveEntry(_event, target) {
		target.closest(".litm-spend-power__entry").remove();
		this.#updatePower(this.element);
	}

	/** @this {SpendPowerApp} */
	static #onToggleChip(_event, target) {
		target.classList.toggle("is-selected");
		this.#updatePower(this.element);
	}

	/** @this {SpendPowerApp} */
	static #onAddEntryAction(_event, target) {
		const li = target.closest(".litm-spend-power__option");
		this.#addEntry(li);
		this.#updatePower(this.element);
	}

	// The whole option card is clickable so users can hit anywhere on the row.
	// Clicks on chips, counters, add-entry, and remove-entry buttons resolve to
	// their own [data-action] first via closest() and never reach this handler.
	// Labels and the checkbox itself are excluded so native behavior (label
	// toggles checkbox, checkbox fires `change`) handles those paths instead —
	// otherwise we'd double-toggle.
	/** @this {SpendPowerApp} */
	static #onToggleOption(event, target) {
		if (event.target.closest(".litm-spend-power__entries")) return;
		if (event.target.closest("label")) return;
		if (event.target.closest("[data-option-check]")) return;

		const checkbox = target.querySelector("[data-option-check]");
		checkbox.checked = !checkbox.checked;
		this.#toggleEntries(target);
		this.#updatePower(this.element);
	}

	#toggleEntries(li) {
		const entriesSection = li.querySelector(".litm-spend-power__entries");
		if (!entriesSection) return;

		const checkbox = li.querySelector("[data-option-check]");
		const isPicker = "picker" in entriesSection.dataset;
		const isCounter = "counter" in entriesSection.dataset;
		const isStatusPicker = "statusPicker" in entriesSection.dataset;

		if (checkbox.checked) {
			entriesSection.classList.remove("is-hidden");
			if (!isPicker && !isCounter && !isStatusPicker) {
				const entryList = entriesSection.querySelector(
					".litm-spend-power__entry-list",
				);
				entryList.appendChild(
					this.#makeEntryRow(li.dataset.hasTier === "true"),
				);
			}
		} else {
			entriesSection.classList.add("is-hidden");
			if (isPicker) {
				// Deselect all chips when unchecking the option
				entriesSection
					.querySelectorAll(".litm-spend-power__tag-chip")
					.forEach((chip) => {
						chip.classList.remove("is-selected");
					});
			} else if (isStatusPicker) {
				// Reset all status counters to 0
				entriesSection
					.querySelectorAll(".litm-spend-power__counter-value")
					.forEach((el) => {
						el.textContent = "0";
					});
			} else if (isCounter) {
				// Reset counter to 1
				const valueEl = entriesSection.querySelector(
					".litm-spend-power__counter-value",
				);
				if (valueEl) valueEl.textContent = "1";
			} else {
				const entryList = entriesSection.querySelector(
					".litm-spend-power__entry-list",
				);
				entryList.innerHTML = "";
			}
		}
	}

	#addEntry(li) {
		const entryList = li.querySelector(".litm-spend-power__entry-list");
		entryList.appendChild(this.#makeEntryRow(li.dataset.hasTier === "true"));
	}

	#makeEntryRow(hasTier) {
		const templateId = hasTier
			? "entry-row-tier-template"
			: "entry-row-template";
		const template = this.element.querySelector(`#${templateId}`);
		return template.content.firstElementChild.cloneNode(true);
	}

	#updatePower(form) {
		let spent = 0;

		form.querySelectorAll(".litm-spend-power__option").forEach((li) => {
			const checkbox = li.querySelector("[data-option-check]");
			if (!checkbox.checked) return;

			const cost = Number(li.dataset.cost);
			spent += this.#calculateOptionCost(li, cost);
		});

		const remainingEl = form.querySelector(
			".litm-spend-power__power-remaining",
		);
		const remaining = this.power - spent;
		if (remainingEl) remainingEl.textContent = remaining;

		// Highlight if over budget and disable submit
		const overBudget = remaining < 0;
		remainingEl?.classList.toggle("is-over-budget", overBudget);
		const submitBtn = form.querySelector("[type='submit']");
		if (submitBtn) submitBtn.disabled = overBudget || spent === 0;
	}

	/**
	 * Calculate the power cost for a single checked option.
	 * @param {HTMLElement} li   The option list item
	 * @param {number} cost      Base cost per unit
	 * @returns {number}
	 */
	#calculateOptionCost(li, cost) {
		// Action-success rows: cost = fixed + sum(var-tier counter values).
		// Counter values default to 0 ("skip"), so the displayed `data-cost`
		// (min cost) is the fixed part alone until the player nudges a
		// [name-] counter upward.
		if (li.dataset.source === "action" && li.dataset.variableTier === "true") {
			const fixed = Number(li.dataset.fixedCost ?? 0);
			let varSum = 0;
			li.querySelectorAll(".litm-spend-power__var-tier").forEach((row) => {
				const raw = Number(
					row.querySelector(".litm-spend-power__counter-value")?.textContent ??
						0,
				);
				const val = Number.isFinite(raw) ? raw : 0;
				varSum += Math.max(0, val);
			});
			return fixed + varSum;
		}
		if (li.dataset.source === "action") return cost;

		const { type, hasTier } = getOptionType(li);
		const entriesSection = li.querySelector(".litm-spend-power__entries");
		const calculator = COST_CALCULATORS[type] ?? defaultCostCalculator;
		return calculator(li, cost, entriesSection, hasTier);
	}

	static async #onSubmit(_event, form, _formData) {
		const actor = game.actors.get(this.actorId);
		const intent = parseSpendIntent(form, this);
		const { results } = await applySpendIntent(actor, intent);
		await postSpendChat(actor, intent, results);
	}
}

function chatCard({ actor, action, body, power }) {
	return foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/chat/spend-power.html",
		{
			actorImg: actor.img,
			actorName: actor.name,
			action,
			body,
			costLine: `${power} ${t("LITM.Tags.power")}`,
		},
	);
}

/**
 * Parse the checked options from the spend-power form into a structured intent
 * that `applySpendIntent` can consume without touching the DOM.
 *
 * @param {HTMLFormElement} form   The bound form element
 * @param {SpendPowerApp}   dialog The app instance (for spendingOptions, messageId, alreadySpent)
 * @returns {object} SpendIntent
 */
function parseSpendIntent(form, dialog) {
	const checkedOptions = [
		...form.querySelectorAll(".litm-spend-power__option"),
	].filter((li) => li.querySelector("[data-option-check]").checked);

	const options = [];

	for (const li of checkedOptions) {
		// Action-success rows
		if (li.dataset.source === "action") {
			const chosenTiers = readVariableTiers(li);
			options.push({
				source: "action",
				successKey: li.dataset.successKey,
				chosenTiers,
			});
			continue;
		}

		const optionId = li.dataset.optionId;
		const option = dialog.spendingOptions.find((o) => o.id === optionId);
		if (!option) continue;

		const { type, entriesSection, hasTier } = getOptionType(li);

		if (type === "statusPicker") {
			const reductions = [
				...entriesSection.querySelectorAll(".litm-spend-power__status-item"),
			]
				.map((item) => ({
					effectId: item.dataset.effectId,
					name: item.dataset.statusName,
					tiers: Number(
						item.querySelector(".litm-spend-power__counter-value")
							?.textContent ?? 0,
					),
				}))
				.filter(({ tiers }) => tiers > 0);
			if (reductions.length === 0) continue;
			options.push({
				kind: "statusPicker",
				optionId,
				label: option.label,
				cost: option.cost,
				reductions,
			});
			continue;
		}

		if (type === "counter") {
			const count = Number(
				entriesSection.querySelector(".litm-spend-power__counter-value")
					?.textContent ?? 1,
			);
			options.push({
				kind: "counter",
				optionId,
				label: option.label,
				cost: option.cost,
				count,
			});
			continue;
		}

		if (type === "picker") {
			const chips = [
				...entriesSection.querySelectorAll(
					".litm-spend-power__tag-chip.is-selected",
				),
			].map((chip) => ({
				tagId: chip.dataset.tagId,
				tagName: chip.dataset.tagName,
			}));
			if (chips.length === 0) continue;
			options.push({
				kind: "picker",
				optionId,
				label: option.label,
				cost: option.cost,
				chips,
			});
			continue;
		}

		// default
		const entries = [...li.querySelectorAll(".litm-spend-power__entry")]
			.map((row) => ({
				name: row.querySelector(".litm-spend-power__entry-name").value.trim(),
				tier: hasTier
					? Number(
							row.querySelector(".litm-spend-power__entry-tier")?.value ?? 1,
						)
					: null,
				isSingleUse:
					!hasTier &&
					row.querySelector(".litm-spend-power__entry-single-use")?.checked ===
						true,
			}))
			.filter(({ name }) => name !== "");
		options.push({
			kind: "default",
			optionId,
			label: option.label,
			cost: option.cost,
			hasTier,
			draggable: !!option.draggable,
			entries,
		});
	}

	return {
		options,
		messageId: dialog.messageId,
		alreadySpent: dialog.alreadySpent,
	};
}

/**
 * Post chat messages summarising what was spent. One message per generic
 * option; action-success cards are posted by applySpendIntent directly.
 *
 * @param {Actor}    actor    The acting character
 * @param {object}   intent   The parsed intent (for option labels)
 * @param {object[]} results  The results returned by applySpendIntent
 */
async function postSpendChat(actor, intent, results) {
	const speaker = foundry.documents.ChatMessage.getSpeaker({ actor });

	for (const result of results) {
		// Action successes post their own chat cards inside the service
		if (result.source === "action") continue;

		switch (result.kind) {
			case "statusPicker": {
				const opt = intent.options.find((o) => o.optionId === result.optionId);
				await foundry.documents.ChatMessage.create({
					content: await chatCard({
						actor,
						action: t(opt.label),
						body: result.bodyLines.join(""),
						power: result.power,
					}),
					speaker,
				});
				break;
			}
			case "counter": {
				const opt = intent.options.find((o) => o.optionId === result.optionId);
				await foundry.documents.ChatMessage.create({
					content: await chatCard({
						actor,
						action: t(opt.label),
						body:
							result.count > 1
								? `<span class="litm-spend-chat__count">&times;${result.count}</span>`
								: "",
						power: result.power,
					}),
					speaker,
				});
				break;
			}
			case "picker": {
				const opt = intent.options.find((o) => o.optionId === result.optionId);
				await foundry.documents.ChatMessage.create({
					content: await chatCard({
						actor,
						action: t(opt.label),
						body: result.names
							.map((n) => `<strong>${foundry.utils.escapeHTML(n)}</strong>`)
							.join(" "),
						power: result.power,
					}),
					speaker,
				});
				break;
			}
			default: {
				const opt = intent.options.find((o) => o.optionId === result.optionId);
				await foundry.documents.ChatMessage.create({
					content: await chatCard({
						actor,
						action: t(opt.label),
						body: result.body,
						power: result.power,
					}),
					speaker,
				});
				break;
			}
		}
	}
}
