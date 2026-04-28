import { error } from "../logger.js";
import { localize as t, viewLinkedRefAction } from "../utils.js";
import { sendRollRequest } from "./roll-request.js";
import { ACTION_CATEGORIES } from "../item/action/action-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Standalone application listing the action items owned by a hero.
 * Provides drop-import (drag an Action item from compendium/world to copy
 * it onto the actor), edit, view linked reference, and (in later slices)
 * roll-from-action.
 */
export class ActionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
	#actor;
	#filterText = "";
	#filterCategory = "";
	#hookIds = [];

	constructor(options = {}) {
		const { actor, ...rest } = options;
		super(rest);
		this.#actor = actor;
	}

	/** @type {Actor} */
	get actor() {
		return this.#actor;
	}

	/** @override */
	get title() {
		return `${t("LITM.Actions.app_title")} — ${this.#actor?.name ?? ""}`;
	}

	/** @override */
	static DEFAULT_OPTIONS = {
		id: "litm-actions-app-{id}",
		classes: ["litm", "litm-actions-app"],
		tag: "section",
		position: {
			width: 560,
			height: 640,
		},
		window: {
			icon: "fa-solid fa-scroll",
			resizable: true,
		},
		actions: {
			editAction: ActionsApp.#onEditAction,
			deleteAction: ActionsApp.#onDeleteAction,
			viewLinkedRef: viewLinkedRefAction,
			createBlankAction: ActionsApp.#onCreateBlankAction,
			rollAction: ActionsApp.#onRollAction,
			sendActionRequest: ActionsApp.#onSendActionRequest,
		},
	};

	/** @override */
	static PARTS = {
		body: {
			template: "systems/litmv2/templates/apps/actions-app.html",
			scrollable: [".litm--actions-list"],
		},
	};

	/** @override */
	async _prepareContext(_options) {
		const all = this.#actor?.items
			.filter((it) => it.type === "action")
			.sort((a, b) => a.name.localeCompare(b.name)) ?? [];

		const text = this.#filterText.trim().toLowerCase();
		const category = this.#filterCategory;

		const filtered = all.filter((item) => {
			if (category && item.system.category !== category) return false;
			if (!text) return true;
			const haystack = [
				item.name,
				item.system.practitioners,
				...(item.system.actionExamples ?? []),
			].filter(Boolean).join(" ").toLowerCase();
			return haystack.includes(text);
		});

		const categoryOptions = [
			{ value: "", label: t("LITM.Actions.filter_all_categories") },
			...ACTION_CATEGORIES
				.filter((c) => c)
				.map((c) => ({ value: c, label: t(`LITM.Actions.categories.${c}`) }))
				.sort((a, b) => a.label.localeCompare(b.label)),
		];

		return {
			actor: this.#actor,
			isOwner: !!(game.user.isGM || this.#actor?.isOwner),
			isGM: game.user.isGM,
			filterText: this.#filterText,
			filterCategory: this.#filterCategory,
			categoryOptions,
			totalCount: all.length,
			actions: filtered.map((item) => ({
				id: item.id,
				uuid: item.uuid,
				name: item.name,
				img: item.img,
				practitioners: item.system.practitioners,
				category: item.system.category,
				categoryLabel: item.system.categoryLabel,
				examples: item.system.actionExamples?.filter(Boolean) ?? [],
				successCount: item.system.successes?.length ?? 0,
				consequenceCount: item.system.consequences?.length ?? 0,
				linkedRefUuid: item.system.linkedRefUuid,
				isRote: item.system.isRote,
			})),
		};
	}

	/** @override */
	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);
		this.element.addEventListener("dragover", (event) => {
			if (this.#isAcceptableDrag(event)) event.preventDefault();
		});
		this.element.addEventListener("drop", (event) => this.#onDrop(event));

		// Re-render when this actor's action items change. Without this, dropping
		// or deleting an action leaves the list stale.
		const onItemChange = (item) => {
			if (item?.parent !== this.#actor) return;
			if (item.type !== "action") return;
			this.render();
		};
		const hooks = ["createItem", "updateItem", "deleteItem"];
		this.#hookIds = hooks.map((name) => [name, Hooks.on(name, onItemChange)]);
	}

	/** @override */
	_onClose(options) {
		for (const [name, id] of this.#hookIds) Hooks.off(name, id);
		this.#hookIds = [];
		return super._onClose(options);
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);

		const search = this.element.querySelector("[data-filter='text']");
		if (search) {
			search.addEventListener("input", (event) => {
				this.#filterText = event.currentTarget.value;
				this.render();
			});
			// Restore focus after a re-render that was triggered by typing.
			if (document.activeElement?.tagName !== "INPUT" && this.#filterText) {
				const start = search.value.length;
				search.focus();
				search.setSelectionRange(start, start);
			}
		}

		const categorySelect = this.element.querySelector("[data-filter='category']");
		if (categorySelect) {
			categorySelect.addEventListener("change", (event) => {
				this.#filterCategory = event.currentTarget.value;
				this.render();
			});
		}

		this.element.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			const focused = document.activeElement?.closest?.("[data-action-id]");
			if (!focused) return;
			event.preventDefault();
			const cards = [...this.element.querySelectorAll("[data-action-id]")];
			const idx = cards.indexOf(focused);
			const next = event.key === "ArrowDown"
				? cards[Math.min(idx + 1, cards.length - 1)]
				: cards[Math.max(idx - 1, 0)];
			next?.querySelector("button[data-action='rollAction'], button[data-action='editAction']")?.focus();
		});
	}

	#isAcceptableDrag(event) {
		const types = event.dataTransfer?.types;
		if (!types) return false;
		return types.includes("text/plain") || types.includes("application/json");
	}

	async #onDrop(event) {
		event.preventDefault();
		event.stopPropagation();
		if (!this.#actor?.isOwner) return;

		const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		if (data?.type !== "Item" || !data.uuid) return;

		const source = await foundry.utils.fromUuid(data.uuid);
		if (!source || source.type !== "action") {
			ui.notifications.warn(t("LITM.Actions.drop_only_action"));
			return;
		}

		// Prevent dropping an action that already exists on this actor.
		if (source.parent === this.#actor) return;

		const itemData = source.toObject();
		delete itemData._id;
		foundry.utils.setProperty(itemData, "flags.litmv2.actionSourceUuid", source.uuid);

		await this.#actor.createEmbeddedDocuments("Item", [itemData]);
	}

	static async #onEditAction(_event, target) {
		const id = target.closest("[data-action-id]")?.dataset.actionId;
		const item = id ? this.#actor.items.get(id) : null;
		item?.sheet?.render(true);
	}

	static async #onDeleteAction(_event, target) {
		const id = target.closest("[data-action-id]")?.dataset.actionId;
		const item = id ? this.#actor.items.get(id) : null;
		if (!item) return;
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: t("LITM.Actions.confirm_remove_title") },
			content: `<p>${game.i18n.format("LITM.Actions.confirm_remove_content", { name: item.name })}</p>`,
			no: { default: true },
		}).catch(() => false);
		if (!confirmed) return;
		await item.delete();
	}

	static async #onSendActionRequest(_event, target) {
		const id = target.closest("[data-action-id]")?.dataset.actionId;
		const item = id ? this.#actor.items.get(id) : null;
		if (!item) return;
		await sendRollRequest({ action: item });
	}

	static async #onRollAction(_event, target) {
		const id = target.closest("[data-action-id]")?.dataset.actionId;
		const item = id ? this.#actor.items.get(id) : null;
		if (!item) return;
		const sheet = this.#actor.sheet;
		const dialog = sheet?.rollDialogInstance;
		if (!dialog) return;
		dialog.setAction(item.uuid);
		if (typeof sheet.renderRollDialog === "function") {
			sheet.renderRollDialog();
		} else if (!dialog.rendered) {
			dialog.render(true);
		}
	}

	static async #onCreateBlankAction() {
		if (!this.#actor?.isOwner) return;
		try {
			const [item] = await this.#actor.createEmbeddedDocuments("Item", [{
				name: t("LITM.Actions.new_action_name"),
				type: "action",
			}]);
			item?.sheet?.render(true);
		} catch (e) {
			error("Failed to create action item:", e);
		}
	}
}
