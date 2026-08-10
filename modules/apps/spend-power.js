import { isEffectVisible } from "../active-effects/effect-queries.js";
import { maxStatusTier } from "../active-effects/status-tiers.js";
import {
	computePowerBudget,
	computeSuccessSpend,
	getAllowedVerbs,
	getMinSuccessCost,
	getSuccessCost,
	scanMarkup,
	unionAppliedSuccessKeys,
} from "../item/action/action-rules.js";
import {
	getVerbDef,
	successTargetMode,
} from "../item/action/verb-definitions.js";
import { FLAGS } from "../system/config.js";
import {
	formatCostLabel,
	tagChipHtml,
} from "../system/renderers/renderer-utils.js";
import { localize as t } from "../utils.js";
import { adjustCounter, readVariableTiers } from "./counter-controls.js";
import { mitigationPreselect } from "./mitigation.js";
import { collectScratchableTags } from "./scratch-sources.js";
import { applySpendIntent } from "./spend-power-service.js";
import { collectReducibleStatuses } from "./status-sources.js";
import { StoryTagsStore } from "./story-tags/story-tags-store.js";
import { getTargetCandidates } from "./target-picker.js";

/** Cost calculators by option type. Each receives (li, cost, entriesSection, hasTier). */
const COST_CALCULATORS = {
	// Status counters show the *resulting* tier (start = current tier, minus
	// reduces) — the paid amount is the drop from the current tier.
	statusPicker(_li, cost, entriesSection) {
		let total = 0;
		entriesSection
			.querySelectorAll(".litm-spend-power__status-item")
			.forEach((item) => {
				const max = Number(item.dataset.maxTier);
				const value = Number(
					item.querySelector(".litm-spend-power__counter-value")?.textContent ??
						max,
				);
				total += cost * Math.max(0, max - value);
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

// Scratch reuses the picker calculator — both price one unit per selected chip.
COST_CALCULATORS.scratchPicker = COST_CALCULATORS.picker;

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
	if (entriesSection && "scratchPicker" in entriesSection.dataset)
		return { type: "scratchPicker", entriesSection, hasTier };
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
				id: "recover_tag",
				label: "LITM.Effects.recover.action",
				cost: 2,
				description: "LITM.Effects.recover.description",
			},
			{
				id: "scratch_tag",
				label: "LITM.Effects.scratch.action",
				cost: 2,
				description: "LITM.Effects.scratch.description",
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
		// Scene story tags live in the world pack; ensure it's loaded, then
		// surface the unscratched, visible ones as a shared scratch group.
		await StoryTagsStore.loadStoryTags();
		const sceneTags = StoryTagsStore.packStoryTags
			.filter(
				(e) =>
					e.type === "story_tag" &&
					!e.system?.isScratched &&
					!e.disabled &&
					isEffectVisible(e),
			)
			.map((e) => ({ id: e._id ?? e.id, name: e.name }));
		// Candidate owners for scratch/reduce/inflict are the actors tracked by
		// the story-tag sidebar (not every observable world actor) — the same
		// list the Apply Consequences menu draws from. Hidden columns stay
		// GM-only; concealed challenges show their masked name.
		const sidebarCandidates = this.#getSidebarCandidates();
		// Hidden tags/statuses on candidates must not leak to players. Own tags
		// are never filtered — collectors skip the filter for the isOwn group.
		const effectFilter = (e) => !e.disabled && isEffectVisible(e);
		const scratchGroups = actor
			? collectScratchableTags(actor, sidebarCandidates, sceneTags, {
					tagFilter: effectFilter,
				})
			: [];
		const statusGroups = actor
			? collectReducibleStatuses(actor, sidebarCandidates, {
					statusFilter: effectFilter,
				})
			: [];
		const inflictTargets = sidebarCandidates.map((c) => ({
			id: c.id,
			name: c.label,
			img: c.img,
		}));

		const options = this.spendingOptions
			.filter((o) => o.id !== "recover_tag" || scratchedTags.length > 0)
			.filter((o) => o.id !== "scratch_tag" || scratchGroups.length > 0)
			.filter((o) => o.id !== "reduce_status" || statusGroups.length > 0)
			.map((o) => {
				if (o.id === "recover_tag") return { ...o, scratchedTags };
				if (o.id === "scratch_tag") return { ...o, scratchGroups };
				if (o.id === "reduce_status") return { ...o, statusGroups };
				if (o.id === "inflict_status") return { ...o, targets: inflictTargets };
				return o;
			});

		const actionSuccesses = await this.#getActionSuccesses();

		// Power displayed at the top must account for BOTH the generic options
		// already spent (spentPower flag) and the action successes already
		// applied (appliedSuccesses flag). Two flags, one budget —
		// computePowerBudget is the single accountant (it reads the actual
		// costs paid from appliedSuccessCosts, recomputing only for messages
		// from before that flag existed).
		const message = this.messageId ? game.messages.get(this.messageId) : null;
		this._mitigationPreselect = mitigationPreselect(
			message?.rolls?.[0]?.litm?.mitigation ?? null,
			this.actorId,
		);
		const action = await this.#getAction();
		const { spent: appliedSuccessesCost } = computePowerBudget(
			message?.rolls?.[0],
			action?.system,
			message?.getFlag("litmv2", "appliedSuccesses") ?? [],
			message?.getFlag("litmv2", "appliedSuccessCosts") ?? {},
		);
		this.power = this.totalPower - this.alreadySpent - appliedSuccessesCost;

		// Target chip row — only when a listed success targets another actor
		// (Attack, Weaken, Bestow on an ally, …). Mirrors the Apply
		// Consequences menu so players see who they're hitting before they
		// spend, instead of being prompted after the fact.
		let targets = [];
		if (actionSuccesses.some((s) => s.needsActorTarget)) {
			const preferredId = [...(game.user.targets ?? [])][0]?.actor?.id ?? null;
			targets = getTargetCandidates({ allowSelf: true }).map((c) => ({
				id: c.id,
				name: c.label,
				img: c.img,
				selected: c.id === preferredId,
			}));
		}

		return {
			actorId: this.actorId,
			power: this.power,
			options,
			actionSuccesses,
			targets,
		};
	}

	async #getAction() {
		const message = this.messageId ? game.messages.get(this.messageId) : null;
		const uuid = message?.getFlag("litmv2", FLAGS.actionUuid);
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
		const appliedCosts = message.getFlag("litmv2", "appliedSuccessCosts") ?? {};
		const applied = new Set(
			unionAppliedSuccessKeys(
				message.getFlag("litmv2", "appliedSuccesses"),
				appliedCosts,
			),
		);
		const roll = message.rolls?.[0];
		const allowedVerbs = getAllowedVerbs(roll);
		// Affordability uses the combined remaining (action-aware budget minus
		// generic power already spent on Create/Inflict/etc.).
		const { remaining: actionRemaining } = computePowerBudget(
			roll,
			sys,
			[...applied],
			appliedCosts,
		);
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
				// The affordability floor: variable tokens default to 0 ("skip")
				// and a multi-tag success only needs its cheapest tag, so a
				// player who can afford *some* of the success may still apply it.
				const minCost = getMinSuccessCost(cost);
				const isUnsupported = def?.kind === "unsupported";
				const cantAfford = minCost > remaining;

				// Variable-tier tokens get inline counters. We surface them in
				// scan order so the apply path can map counter values back to
				// `chosenTiers` indices in `applySuccess`.
				const varTokens = scanMarkup(s.text)
					.filter((tok) => tok.type === "status" && tok.isVariable)
					.map((tok, idx) => ({ idx, name: tok.name }));

				// Successes listing 2+ tags ("gain a [bow], a [knife]") render
				// each tag as a deselectable chip — the prose usually means
				// "either or both", so the player picks and pays per tag.
				// Chips only exist where the cost model prices tags
				// individually (cost.tagCosts) — flat-rate verbs like Extra
				// Feat apply all their tags for one fixed price, no chips.
				const hasSelectableTags = (cost.tagCosts ?? []).length >= 2;
				const tagTokens = hasSelectableTags
					? scanMarkup(s.text)
							.filter((tok) => tok.type === "tag")
							.map((tok, idx) => ({
								idx,
								name: tok.name,
								isSingleUse: tok.isSingleUse,
								cost: cost.tagCosts[idx],
							}))
					: [];

				return {
					key: s.id,
					verbLabel: t(`LITM.Actions.verbs.${s.verb}`),
					verbKind: def?.displayKind ?? "self",
					text: s.text,
					costLabel: formatCostLabel(cost, def),
					// The static part of the live cost: everything that isn't a
					// counter or a chip (= the spend with every chip dropped).
					// Chips default to selected, so the initial computed total
					// equals the full fixed cost.
					fixedCost: hasSelectableTags
						? computeSuccessSpend(cost, {
								chosenTags: tagTokens.map(() => false),
							})
						: cost.fixed,
					staticCost: cost.fixed,
					varTokens,
					hasVariableTier: varTokens.length > 0,
					tagTokens,
					hasSelectableTags,
					needsActorTarget: ["opponent", "ally"].includes(
						successTargetMode(def),
					),
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

	/**
	 * Candidate owners for the scratch/reduce/inflict pickers: the story-tag
	 * sidebar's tracked actors, matching what the sidebar itself shows —
	 * hidden columns are GM-only, concealed challenges wear their mask.
	 * @returns {{id:string,label:string,img:string,actor:Actor}[]}
	 */
	#getSidebarCandidates() {
		const hiddenUuids = new Set(StoryTagsStore.config.hiddenActors ?? []);
		const seen = new Set();
		const candidates = [];
		for (const { uuid, actor } of StoryTagsStore.resolveTrackedActors()) {
			if (!game.user.isGM && hiddenUuids.has(uuid)) continue;
			// A tracked token and its sidebar actor resolve to the same document.
			if (seen.has(actor.id)) continue;
			seen.add(actor.id);
			candidates.push({
				id: actor.id,
				label: actor.system.maskedName ?? actor.name,
				img: actor.img,
				actor,
			});
		}
		return candidates;
	}

	/**
	 * Pre-open and pre-fill the mitigation options when this menu was opened
	 * from a Reaction: set the inflicted status's reduce counter and select the
	 * inflicted tag's scratch chip. Matching is by name (+ owner for tags).
	 */
	#applyMitigationPreselect(form) {
		const pre = this._mitigationPreselect;
		if (!pre) return;

		if (pre.statuses.length) {
			const li = form.querySelector(
				'.litm-spend-power__option[data-option-id="reduce_status"]',
			);
			if (li) {
				const checkbox = li.querySelector("[data-option-check]");
				checkbox.checked = true;
				this.#toggleEntries(li);
				for (const { name, tier } of pre.statuses) {
					const item = [
						...li.querySelectorAll(".litm-spend-power__status-item"),
					].find(
						(el) =>
							el.dataset.statusName?.toLowerCase() === name.toLowerCase() &&
							(!pre.statusOwnerId ||
								el.dataset.actorId === pre.statusOwnerId),
					);
					if (!item) continue;
					// Counters show the resulting tier — preselect the full drop.
					const max = Number(item.dataset.maxTier);
					const reduceBy = Math.min(tier ?? max, max);
					const valueEl = item.querySelector(
						".litm-spend-power__counter-value",
					);
					if (valueEl) valueEl.textContent = String(max - reduceBy);
				}
			}
		}

		if (pre.tags.length) {
			const li = form.querySelector(
				'.litm-spend-power__option[data-option-id="scratch_tag"]',
			);
			if (li) {
				const checkbox = li.querySelector("[data-option-check]");
				checkbox.checked = true;
				this.#toggleEntries(li);
				for (const name of pre.tags) {
					const chip = [
						...li.querySelectorAll(".litm-spend-power__tag-chip"),
					].find(
						(c) =>
							c.dataset.tagName?.toLowerCase() === name.toLowerCase() &&
							(!pre.tagOwnerId || c.dataset.actorId === pre.tagOwnerId),
					);
					if (chip) chip.classList.add("is-selected");
				}
			}
		}

		this.#updatePower(form);
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
			if (li.dataset.source === "action") this.#updateActionRowCost(li);
			this.#updatePower(form);
		});

		this.#applyMitigationPreselect(form);
	}

	/** @this {SpendPowerApp} */
	static #onCounter(_event, target) {
		const statusItem = target.closest(".litm-spend-power__status-item");
		const varTier = target.closest(".litm-spend-power__var-tier");
		// Variable-tier counters clamp to the world's status track depth — 0
		// means "skip this token" so a success listing many alternative
		// statuses (eg. an Action Grimoire Attack with [ferido-] [cortado-]
		// [perfurado-] …) lets the player pick which ones to apply.
		// reduce_status clamps 0..currentTier. Everything else clamps 1..∞.
		const min = statusItem || varTier ? 0 : 1;
		const max = statusItem
			? Number(statusItem.dataset.maxTier)
			: varTier
				? maxStatusTier()
				: Infinity;
		adjustCounter(target, { min, max });

		if (varTier) {
			const li = varTier.closest(".litm-spend-power__option");
			if (li) {
				this.#syncActionRowSelection(li);
				this.#updateActionRowCost(li);
			}
		}

		this.#updatePower(this.element);
	}

	/**
	 * Nudging a tier counter or toggling a tag chip on an action-success row
	 * is itself an act of selection — sync the row's checkbox so the player
	 * isn't required to also click the row. A row whose only costs are
	 * counters/chips unchecks again when everything is back at zero; a row
	 * with a fixed part stays checked (the fixed part still applies).
	 */
	#syncActionRowSelection(li) {
		const checkbox = li.querySelector("[data-option-check]");
		if (!checkbox || checkbox.disabled) return;
		const anyTier = [
			...li.querySelectorAll(
				".litm-spend-power__var-tier .litm-spend-power__counter-value",
			),
		].some((el) => Number(el.textContent) > 0);
		const anyChip = !!li.querySelector(
			".litm-spend-power__tag-chip.is-selected",
		);
		if (anyTier || anyChip) checkbox.checked = true;
		else if (Number(li.dataset.fixedCost ?? 0) <= 0) checkbox.checked = false;
	}

	/** Live cost label update for an action-success row. */
	#updateActionRowCost(li) {
		const costEl = li.querySelector("[data-action-success-cost]");
		if (!costEl) return;
		const total = this.#calculateOptionCost(li, Number(li.dataset.cost));
		costEl.textContent = `${total} ${t("LITM.Tags.power")}`;
	}

	/** @this {SpendPowerApp} */
	static #onRemoveEntry(_event, target) {
		target.closest(".litm-spend-power__entry").remove();
		this.#updatePower(this.element);
	}

	/** @this {SpendPowerApp} */
	static #onToggleChip(_event, target) {
		target.classList.toggle("is-selected");
		const li = target.closest(".litm-spend-power__option");
		if (li?.dataset.source === "action") {
			this.#syncActionRowSelection(li);
			this.#updateActionRowCost(li);
		}
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
		if (target.dataset.source === "action") this.#updateActionRowCost(target);
		this.#updatePower(this.element);
	}

	#toggleEntries(li) {
		const entriesSection = li.querySelector(".litm-spend-power__entries");
		if (!entriesSection) return;

		const checkbox = li.querySelector("[data-option-check]");
		const isPicker = "picker" in entriesSection.dataset;
		const isScratchPicker = "scratchPicker" in entriesSection.dataset;
		const isCounter = "counter" in entriesSection.dataset;
		const isStatusPicker = "statusPicker" in entriesSection.dataset;

		if (checkbox.checked) {
			entriesSection.classList.remove("is-hidden");
			if (!isPicker && !isScratchPicker && !isCounter && !isStatusPicker) {
				const entryList = entriesSection.querySelector(
					".litm-spend-power__entry-list",
				);
				entryList.appendChild(
					this.#makeEntryRow(li.dataset.hasTier === "true"),
				);
			}
		} else {
			entriesSection.classList.add("is-hidden");
			if (isPicker || isScratchPicker) {
				// Deselect all chips when unchecking the option
				entriesSection
					.querySelectorAll(".litm-spend-power__tag-chip")
					.forEach((chip) => {
						chip.classList.remove("is-selected");
					});
			} else if (isStatusPicker) {
				// Reset all status counters back to their current tier (no drop)
				entriesSection
					.querySelectorAll(".litm-spend-power__status-item")
					.forEach((item) => {
						const valueEl = item.querySelector(
							".litm-spend-power__counter-value",
						);
						if (valueEl) valueEl.textContent = item.dataset.maxTier;
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
		let anyChecked = false;

		form.querySelectorAll(".litm-spend-power__option").forEach((li) => {
			const checkbox = li.querySelector("[data-option-check]");
			if (!checkbox.checked) return;
			anyChecked = true;

			const cost = Number(li.dataset.cost);
			spent += this.#calculateOptionCost(li, cost);
		});

		const remainingEl = form.querySelector(
			".litm-spend-power__power-remaining",
		);
		const remaining = this.power - spent;
		if (remainingEl) remainingEl.textContent = remaining;

		// Highlight if over budget and disable submit. Selection, not cost,
		// gates the button — a free narrative success is still worth applying.
		const overBudget = remaining < 0;
		remainingEl?.classList.toggle("is-over-budget", overBudget);
		const submitBtn = form.querySelector("[type='submit']");
		if (submitBtn) submitBtn.disabled = overBudget || !anyChecked;
	}

	/**
	 * Calculate the power cost for a single checked option.
	 * @param {HTMLElement} li   The option list item
	 * @param {number} cost      Base cost per unit
	 * @returns {number}
	 */
	#calculateOptionCost(li, cost) {
		// Action-success rows: cost = static base (data-fixed-cost, the part
		// that is neither a counter nor a chip) + selected tag chips + var-tier
		// counter values. Plain rows (no counters, no chips) are just their
		// full fixed cost.
		if (li.dataset.source === "action") {
			const hasVar = li.dataset.variableTier === "true";
			const hasTags = li.dataset.selectableTags === "true";
			if (!hasVar && !hasTags) return cost;

			let total = Number(li.dataset.fixedCost ?? 0);
			li.querySelectorAll(".litm-spend-power__tag-chip.is-selected").forEach(
				(chip) => {
					total += Number(chip.dataset.tagCost ?? 0);
				},
			);
			li.querySelectorAll(".litm-spend-power__var-tier").forEach((row) => {
				const raw = Number(
					row.querySelector(".litm-spend-power__counter-value")?.textContent ??
						0,
				);
				const val = Number.isFinite(raw) ? raw : 0;
				total += Math.max(0, val);
			});
			return total;
		}

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
			// Tag chips (multi-tag successes): sparse boolean array in tag-scan
			// order. Undefined when the row has no chips — appliers then apply
			// every tag, the single-tag path.
			let chosenTags;
			const chips = li.querySelectorAll(
				".litm-spend-power__tag-chip[data-tag-idx]",
			);
			if (chips.length) {
				chosenTags = [];
				chips.forEach((chip) => {
					chosenTags[Number(chip.dataset.tagIdx)] =
						chip.classList.contains("is-selected");
				});
			}
			options.push({
				source: "action",
				successKey: li.dataset.successKey,
				chosenTiers,
				chosenTags,
			});
			continue;
		}

		const optionId = li.dataset.optionId;
		const option = dialog.spendingOptions.find((o) => o.id === optionId);
		if (!option) continue;

		const { type, entriesSection, hasTier } = getOptionType(li);

		if (type === "statusPicker") {
			// Counters display the resulting tier; the reduction is the drop
			// from the status's current tier (data-max-tier).
			const reductions = [
				...entriesSection.querySelectorAll(".litm-spend-power__status-item"),
			]
				.map((item) => {
					const max = Number(item.dataset.maxTier);
					const value = Number(
						item.querySelector(".litm-spend-power__counter-value")
							?.textContent ?? max,
					);
					return {
						effectId: item.dataset.effectId,
						name: item.dataset.statusName,
						actorId: item.dataset.actorId,
						tiers: Math.max(0, max - value),
					};
				})
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

		if (type === "scratchPicker") {
			const chips = [
				...entriesSection.querySelectorAll(
					".litm-spend-power__tag-chip.is-selected",
				),
			].map((chip) => ({
				tagId: chip.dataset.tagId,
				tagName: chip.dataset.tagName,
				actorId: chip.dataset.actorId,
				isScene: chip.dataset.sceneTag === "true",
			}));
			if (chips.length === 0) continue;
			options.push({
				kind: "scratchPicker",
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
		// Inflict's optional target chip — "" (post to chat) parses to null,
		// which keeps the legacy draggable-chat-chip behavior.
		const targetActorId =
			li.querySelector("input[name='inflict-target']:checked")?.value || null;
		options.push({
			kind: "default",
			optionId,
			label: option.label,
			cost: option.cost,
			hasTier,
			draggable: !!option.draggable,
			entries,
			targetActorId,
		});
	}

	return {
		options,
		targetActorId:
			form.querySelector("input[name='success-target']:checked")?.value ?? null,
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
			// Recover and scratch both render their tags as chips: recovered ones
			// are live chips, scratched ones carry the scratch glyph + line-through.
			// tagChipHtml (not the play-tag partial) because Foundry strips inline
			// <svg> from chat content — see the scratched glyph note in tagChipHtml.
			case "picker":
			case "scratchPicker": {
				const opt = intent.options.find((o) => o.optionId === result.optionId);
				const body = (result.tags ?? [])
					.map((tag) =>
						tagChipHtml(
							{ kind: "story", name: tag.name, isSingleUse: false },
							{ scratched: tag.isScratched },
						),
					)
					.join(" ");
				// Every tag may have been skipped (owner/effect gone, scene write
				// undeliverable) — nothing applied, so don't post an empty card.
				if (!body) break;
				await foundry.documents.ChatMessage.create({
					content: await chatCard({
						actor,
						action: t(opt.label),
						body,
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
