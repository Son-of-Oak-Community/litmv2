import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { localize as t, removeAtIndex } from "../../utils.js";
import { SUCCESS_VERBS, SUCCESS_QUALITIES, ACTION_CATEGORIES } from "./action-data.js";
import { sendRollRequest } from "../../apps/roll-request.js";
import { POWER_REF_TAG_TYPES } from "../../system/config.js";

/**
 * Action sheet for Legend in the Mist.
 * Represents an authored Action Grimoire entry or a personal rote — a
 * structured description of a hero action with suggested tags, structured
 * successes (verb + payload), and consequence prose.
 */
export class ActionSheet extends LitmItemSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-action-sheet"],
		tag: "form",
		position: {
			width: 620,
			height: "auto",
		},
		actions: {
			addExample: ActionSheet.#onAddExample,
			removeExample: ActionSheet.#onRemoveExample,
			addPositiveTag: ActionSheet.#onAddPositiveTag,
			removePositiveTag: ActionSheet.#onRemovePositiveTag,
			addNegativeTag: ActionSheet.#onAddNegativeTag,
			removeNegativeTag: ActionSheet.#onRemoveNegativeTag,
			addSuccess: ActionSheet.#onAddSuccess,
			removeSuccess: ActionSheet.#onRemoveSuccess,
			addConsequence: ActionSheet.#onAddConsequence,
			removeConsequence: ActionSheet.#onRemoveConsequence,
			sendRollRequest: ActionSheet.#onSendRollRequest,
			clearPowerTagId: ActionSheet.#onClearPowerTagId,
			pickPowerTagId: ActionSheet.#onPickPowerTagId,
		},
		form: {
			handler: ActionSheet.#onSubmit,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-scroll",
			resizable: true,
		},
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/action.html",
			scrollable: [""],
		},
	};

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const enriched = await this._enrichFields("description");

		const verbOptions = Object.fromEntries(
			SUCCESS_VERBS.map((v) => [v, t(`LITM.Actions.verbs.${v}`)]),
		);
		const qualityOptions = Object.fromEntries(
			SUCCESS_QUALITIES.map((q) => [q, t(`LITM.Actions.qualities.${q}`)]),
		);
		const sortedCategories = ACTION_CATEGORIES
			.filter((c) => c)
			.map((c) => [c, t(`LITM.Actions.categories.${c}`)])
			.sort(([, a], [, b]) => a.localeCompare(b));
		const categoryOptions = Object.fromEntries([["", "—"], ...sortedCategories]);

		return {
			...context,
			item: this.document,
			system: this.system,
			enriched,
			verbOptions,
			qualityOptions,
			categoryOptions,
			isRote: this.system.isRote,
			isGM: game.user.isGM,
		};
	}

	static async #onSubmit(_event, _form, formData) {
		await this.document.update(formData.object);
	}

	static async #onAddExample() {
		const examples = [...this.system.actionExamples, ""];
		await this.document.update({ "system.actionExamples": examples });
	}

	static async #onRemoveExample(_event, target) {
		await removeAtIndex(this.document, "system.actionExamples", Number(target.dataset.index));
	}

	static async #onAddPositiveTag() {
		const list = [...this.system.power.positiveTags.map((t) => ({ ...t })), { label: "", tagId: null }];
		await this.document.update({ "system.power.positiveTags": list });
	}

	static async #onRemovePositiveTag(_event, target) {
		await removeAtIndex(this.document, "system.power.positiveTags", Number(target.dataset.index));
	}

	static async #onAddNegativeTag() {
		const list = [...this.system.power.negativeTags.map((t) => ({ ...t })), { label: "", tagId: null }];
		await this.document.update({ "system.power.negativeTags": list });
	}

	static async #onRemoveNegativeTag(_event, target) {
		await removeAtIndex(this.document, "system.power.negativeTags", Number(target.dataset.index));
	}

	static async #onAddSuccess() {
		const successes = [...this.system.successes.map((o) => o.toObject?.() ?? o)];
		successes.push({
			id: foundry.utils.randomID(),
			verb: "enhance",
			quality: "quick",
			label: "",
			description: "",
			payload: {
				tagName: "",
				statusName: "",
				tier: null,
				polarity: "positive",
				isSingleUse: false,
				scratchTag: false,
				target: "self",
			},
		});
		await this.document.update({ "system.successes": successes });
	}

	static async #onRemoveSuccess(_event, target) {
		await removeAtIndex(this.document, "system.successes", Number(target.dataset.index));
	}

	static async #onAddConsequence() {
		const list = [...this.system.consequences, ""];
		await this.document.update({ "system.consequences": list });
	}

	static async #onRemoveConsequence(_event, target) {
		await removeAtIndex(this.document, "system.consequences", Number(target.dataset.index));
	}

	static async #onSendRollRequest() {
		await sendRollRequest({ action: this.document });
	}

	static async #onClearPowerTagId(_event, target) {
		const slot = target.closest("[data-power-tag-target]");
		if (!slot) return;
		const list = slot.dataset.list;
		const index = Number(slot.dataset.tagIndex);
		const path = `system.power.${list}Tags`;
		const arr = (foundry.utils.getProperty(this.document, path) ?? []).map((e) => ({ ...e }));
		if (!arr[index]) return;
		arr[index] = { ...arr[index], tagId: null };
		await this.document.update({ [path]: arr });
	}

	/**
	 * Open a picker dialog of the owning actor's eligible tags and link the
	 * chosen one. Drop is the canonical path; this is a fallback for when
	 * the user can't drag (eg. macro-pad players, mobile users, or actor
	 * sheets that don't expose tags as draggable handles).
	 * @param {Event} _event
	 * @param {HTMLElement} target  The clicked link icon button
	 */
	static async #onPickPowerTagId(_event, target) {
		const slot = target.closest("[data-power-tag-target]");
		if (!slot) return;

		const actor = this.document.parent ?? game.user.character;
		if (!actor) {
			ui.notifications.warn(t("LITM.Actions.power_pick_no_actor"));
			return;
		}

		const entries = [];
		const groupsByKey = new Map();

		const addEffect = (effect, ownerActor) => {
			if (!POWER_REF_TAG_TYPES.has(effect.type)) return;
			const sourceItem = effect.parent !== ownerActor ? effect.parent : null;
			const groupKey = sourceItem?.uuid ?? `${ownerActor.uuid}:self`;

			const entry = {
				index: entries.length,
				id: effect.id,
				name: effect.name,
				type: effect.type,
				isTitleTag: !!effect.system?.isTitleTag,
			};
			entries.push(entry);

			if (!groupsByKey.has(groupKey)) {
				const isOtherActor = ownerActor !== actor;
				const fallbackLabel = sourceItem
					? (isOtherActor ? `${ownerActor.name} — ${sourceItem.name}` : sourceItem.name)
					: ownerActor.name;
				groupsByKey.set(groupKey, {
					fallbackLabel,
					img: sourceItem?.img ?? ownerActor.img,
					sortOrder: (isOtherActor ? 1000 : 0) + (sourceItem?.sort ?? Number.POSITIVE_INFINITY),
					titleEntry: null,
					entries: [],
				});
			}
			const group = groupsByKey.get(groupKey);
			if (entry.isTitleTag && !group.titleEntry) {
				group.titleEntry = entry;
			} else {
				group.entries.push(entry);
			}
		};

		for (const effect of actor.allApplicableEffects()) addEffect(effect, actor);

		const fellowshipActor = actor.system?.fellowshipActor;
		if (fellowshipActor && fellowshipActor !== actor) {
			for (const effect of fellowshipActor.allApplicableEffects()) {
				addEffect(effect, fellowshipActor);
			}
		}

		if (!entries.length) {
			ui.notifications.warn(t("LITM.Actions.power_pick_no_tags"));
			return;
		}

		const groups = [...groupsByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);

		const content = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/apps/tag-picker-form.html",
			{ groups },
		);

		let pickedIdx;
		try {
			pickedIdx = await foundry.applications.api.DialogV2.prompt({
				window: { title: t("LITM.Actions.power_pick_title") },
				classes: ["litm", "litm--picker", "litm--tag-picker-dialog"],
				content,
				position: { width: 420 },
				ok: {
					label: t("LITM.Actions.pick_confirm"),
					callback: (_event, button) => {
						const checked = button.form?.querySelector("input[name='picked']:checked");
						return checked ? Number(checked.value) : null;
					},
				},
				rejectClose: false,
			});
		} catch {
			return;
		}
		if (pickedIdx == null) return;

		const picked = entries[pickedIdx];
		const list = slot.dataset.list;
		const index = Number(slot.dataset.tagIndex);
		const path = `system.power.${list}Tags`;
		const arr = (foundry.utils.getProperty(this.document, path) ?? []).map((e) => ({ ...e }));
		if (!arr[index]) return;
		arr[index] = { ...arr[index], tagId: picked.id, label: picked.name };
		await this.document.update({ [path]: arr });
	}

	/**
	 * Handle a tag effect drop onto a power-tag suggestion row, upgrading it
	 * from a freeform text label to an identity link.
	 * @param {DragEvent} event
	 * @param {HTMLElement} slot   The element matching `[data-power-tag-target]`
	 */
	async _onDropPowerTagRef(event, slot) {
		const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		if (!data?.uuid || data.type !== "ActiveEffect") return;

		event.preventDefault();
		event.stopPropagation();

		const effect = await foundry.utils.fromUuid(data.uuid);
		if (!effect || !POWER_REF_TAG_TYPES.has(effect.type)) {
			ui.notifications.warn(t("LITM.Actions.power_drop_only_tag"));
			return;
		}

		const list = slot.dataset.list;
		const index = Number(slot.dataset.tagIndex);
		const path = `system.power.${list}Tags`;
		const arr = (foundry.utils.getProperty(this.document, path) ?? []).map((e) => ({ ...e }));
		if (!arr[index]) return;
		arr[index] = { ...arr[index], tagId: effect.id, label: effect.name };
		await this.document.update({ [path]: arr });
	}
}
