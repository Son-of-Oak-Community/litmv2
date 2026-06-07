import { localize as t } from "../../utils.js";
import { parseQuickAddInput, toTiers } from "./story-tag-helpers.js";

export class SceneTagDialog extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-scene-tag-dialog",
		classes: ["litm", "litm--scene-tag-dialog"],
		tag: "form",
		window: {
			title: "LITM.Ui.scene_tag_dialog_title",
			resizable: true,
		},
		position: {
			width: 480,
			height: 400,
		},
		form: {
			handler: SceneTagDialog.#onSubmit,
			closeOnSubmit: false,
		},
		actions: {
			"quick-add": SceneTagDialog.#onQuickAdd,
			"remove-tag": SceneTagDialog.#onRemoveTag,
			"remove-limit": SceneTagDialog.#onRemoveLimit,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/scene-tag-dialog.html",
			scrollable: [".litm--scene-tags-list"],
		},
	};

	get scene() {
		return canvas.scene;
	}

	get sceneData() {
		const data = this.scene?.getFlag("litmv2", "sceneTags");
		if (!data || foundry.utils.isEmpty(data)) return { tags: [], limits: [] };
		const tags = (data.tags ?? []).map((tag) =>
			tag.type === "status"
				? { ...tag, type: "status_tag" }
				: tag.type === "tag"
					? { ...tag, type: "story_tag" }
					: tag,
		);
		return { ...data, tags };
	}

	async _prepareContext(_options) {
		const context = await super._prepareContext(_options);
		const data = this.sceneData;
		context.tags = data.tags ?? [];
		context.limits = data.limits ?? [];
		context.sceneName = this.scene?.name ?? "";
		context.hint = t("LITM.Ui.scene_tag_dialog_hint");

		// Build limit options for the dropdown on each tag
		context.limitOptions = [
			{ value: "", label: "—" },
			...context.limits.map((l) => ({ value: l.id, label: l.label })),
		];

		// Attach limitId-based cssClass for display grouping
		for (const tag of context.tags) {
			tag.limitOptions = context.limitOptions.map((opt) => ({
				...opt,
				selected: opt.value === (tag.limitId ?? ""),
			}));
		}

		return context;
	}

	_onRender(context, options) {
		super._onRender(context, options);

		// Change listener on the root element — only attach once since it persists across renders
		if (!this._changeListenerAttached) {
			this.element.addEventListener("change", () => this.onSubmit());
			this._changeListenerAttached = true;
		}

		// Enter key in quick-add input triggers the add action (re-attaches since input is replaced)
		const input = this.element.querySelector(".litm--quick-add-input");
		input?.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.#quickAddFromInput(input);
			}
		});
	}

	async onSubmit() {
		const formData = new foundry.applications.ux.FormDataExtended(this.element);
		await SceneTagDialog.#onSubmit.call(this, null, this.element, formData);
	}

	static async #onSubmit(_event, _form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		if (foundry.utils.isEmpty(data)) return;

		const current = this.sceneData;
		const updatedTags = [];
		const updatedLimits = [];

		// Process tags from form data
		if (data.tags) {
			for (const [id, tagData] of Object.entries(data.tags)) {
				const existing = current.tags.find((t) => t.id === id);
				if (!existing) continue;
				updatedTags.push({
					...existing,
					name: tagData.name ?? existing.name,
					limitId: tagData.limitId || null,
					isSingleUse: tagData.isSingleUse ?? existing.isSingleUse,
					values:
						existing.type === "status_tag"
							? toTiers(
									Array.isArray(tagData.values)
										? tagData.values
										: tagData.values != null
											? [tagData.values]
											: [],
								)
							: existing.values,
				});
			}
		}

		// Process limits from form data
		if (data.limits) {
			for (const [id, limitData] of Object.entries(data.limits)) {
				const existing = current.limits.find((l) => l.id === id);
				if (!existing) continue;
				updatedLimits.push({
					...existing,
					label: limitData.label ?? existing.label,
					max: Number(limitData.max) || existing.max,
				});
			}
		}

		await this.scene.setFlag("litmv2", "sceneTags", {
			tags: updatedTags,
			limits: updatedLimits,
		});
		this.render();
	}

	async #quickAddFromInput(input) {
		const parsed = parseQuickAddInput(input.value.trim());
		if (!parsed) return;

		const current = this.sceneData;

		if (parsed.type === "limit") {
			const limits = [
				...current.limits,
				{
					id: foundry.utils.randomID(),
					label: parsed.name,
					max: parsed.limitMax ?? 3,
					value: 0,
				},
			];
			input.value = "";
			await this.scene.setFlag("litmv2", "sceneTags", { ...current, limits });
			this.render();
			this.#refocusQuickAdd();
			return;
		}

		const isStatus = parsed.type === "status_tag";
		const tag = {
			name: parsed.name,
			values: isStatus
				? Array.from({ length: 6 }, (_, i) => i === parsed.tier - 1)
				: Array(6).fill(null),
			type: parsed.type,
			isScratched: false,
			isSingleUse: parsed.isSingleUse ?? false,
			hidden: false,
			id: foundry.utils.randomID(),
			limitId: null,
		};

		input.value = "";
		await this.scene.setFlag("litmv2", "sceneTags", {
			...current,
			tags: [...current.tags, tag],
		});
		this.render();
		this.#refocusQuickAdd();
	}

	#refocusQuickAdd() {
		requestAnimationFrame(() => {
			const newInput = this.element?.querySelector(".litm--quick-add-input");
			newInput?.focus();
		});
	}

	static #onQuickAdd(_event, _target) {
		const input = this.element.querySelector(".litm--quick-add-input");
		if (!input) return;
		this.#quickAddFromInput(input);
	}

	static async #onRemoveTag(_event, target) {
		const id = target.dataset.id;
		const current = this.sceneData;
		await this.scene.setFlag("litmv2", "sceneTags", {
			...current,
			tags: current.tags.filter((t) => t.id !== id),
		});
		this.render();
	}

	static async #onRemoveLimit(_event, target) {
		const id = target.dataset.id;
		const current = this.sceneData;
		// Remove limit and clear limitId references on tags
		const tags = current.tags.map((t) =>
			t.limitId === id ? { ...t, limitId: null } : t,
		);
		await this.scene.setFlag("litmv2", "sceneTags", {
			tags,
			limits: current.limits.filter((l) => l.id !== id),
		});
		this.render();
	}
}
