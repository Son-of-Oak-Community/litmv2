import { SceneTagDialog } from "../../apps/scene-tag-dialog.js";
import { localize as t } from "../../utils.js";

export function registerUiHooks() {
	_iconOnlyHeaderButtons();
	_replaceLoadSpinner();
	_listenToContentLinks();
	_addSceneTagsTool();
	_handleTagDropInEditor();
	_refreshOnPlayerChange();
}

function _iconOnlyHeaderButtons() {
	// Abstracted function to replace header buttons
	const replaceHeaderButton = (html, action, icon, label) => {
		const element = html;
		const button = element.querySelector(`.${action}`);
		if (!button) return;

		const newButton = document.createElement("a");
		newButton.classList.add("header-button", "control", action);
		newButton.ariaLabel = label;
		newButton.dataset.tooltip = label;
		newButton.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;

		button.replaceWith(newButton);
	};

	const buttons = [
		{
			action: "configure-sheet",
			icon: "fas fa-cog",
			label: t("Configure"),
		},
		{
			action: "configure-token",
			icon: "fas fa-user-circle",
			label: t("TOKEN.Title"),
		},
		{
			action: "share-image",
			icon: "fas fa-eye",
			label: t("JOURNAL.ActionShow"),
		},
		{ action: "close", icon: "fas fa-times", label: t("Close") },
	];

	for (const hook of [
		"renderItemSheetV2",
		"renderActorSheetV2",
		"renderJournalSheet",
		"renderApplication",
	]) {
		Hooks.on(hook, (_app, html) => {
			for (const { action, icon, label } of buttons) {
				replaceHeaderButton(html, action, icon, label);
			}

			// Add the document ID link to the header if it's not already there
			if (hook === "renderActorSheetV2" || hook === "renderItemSheetV2") {
				const element = html;
				const link = element.querySelector(".window-title>.document-id-link");
				const header = element.querySelector(".window-header");
				if (link && header) header.prepend(link);
			}
		});
	}
}

function _replaceLoadSpinner() {
	Hooks.on("renderGamePause", (_, html) => {
		const img = html.querySelector("img");
		if (!img) return;
		img.src = CONFIG.litmv2.assets.marshal_crest;
		img.classList.remove("fa-spin");
	});
}

function _addSceneTagsTool() {
	Hooks.on("getSceneControlButtons", (controls) => {
		if (!controls.notes) return;
		controls.notes.tools["scene-tags"] = {
			name: "scene-tags",
			title: "LITM.Ui.scene_tags",
			icon: "fa-solid fa-tags",
			order: Object.keys(controls.notes.tools).length,
			button: true,
			onChange: () => new SceneTagDialog().render(true),
		};
	});
}

function _listenToContentLinks() {
	Hooks.on("renderJournalSheet", (_app, html) => {
		const element = html;
		element.addEventListener("click", (event) => {
			const target = event.target.closest(".content-link");
			if (!target) return;

			const { id, type } = target.dataset;
			if (type !== "ActivateScene") return;

			event.preventDefault();
			event.stopPropagation();

			const scene = game.scenes.get(id);
			if (!scene) return;
			scene.view();
		});
	});
}

/**
 * Re-render the story tag sidebar and fellowship sheet when players connect/disconnect
 * or change their assigned character, so that only active players' heroes appear.
 */
function _refreshOnPlayerChange() {
	const refresh = () => {
		ui.combat?.invalidateCache();
		if (ui.combat?.rendered) ui.combat.render();

		const fellowshipId = game.litmv2?.fellowship?.id;
		if (!fellowshipId) return;
		const fellowship = game.actors.get(fellowshipId);
		if (fellowship?.sheet?.rendered) fellowship.sheet.render();
	};

	Hooks.on("userConnected", refresh);
	Hooks.on("updateUser", (user, changes) => {
		if ("character" in changes) refresh();
	});
}

function _handleTagDropInEditor() {
	const TAG_TYPES = new Set(["tag", "status", "limit"]);

	Hooks.on("createProseMirrorEditor", (_uuid, plugins) => {
		const { Plugin, TextSelection, keymap } = foundry.prosemirror;
		const contentLinks = plugins.contentLinks;
		delete plugins.contentLinks;

		plugins.litmTagDrop = new Plugin({
			props: {
				handleDrop(view, event) {
					const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
					if (!TAG_TYPES.has(data.type)) return;

					const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
					if (!pos) return;

					let markup;
					if (data.type === "status") markup = `[${data.name}-${data.value ?? ""}]`;
					else if (data.type === "limit") markup = data.value ? `[${data.name}:${data.value}]` : `[${data.name}:]`;
					else markup = `[${data.name}]`;

					const tr = view.state.tr.insertText(markup, pos.pos);
					view.dispatch(tr);
					setTimeout(view.focus.bind(view), 0);
					return true;
				},
			},
		});

		plugins.litmTagWrap = keymap({
			"Alt-t": (state, dispatch) => {
				const { from, to } = state.selection;
				const selected = state.doc.textBetween(from, to);
				const replacement = selected ? `[${selected}]` : "[]";
				const tr = state.tr.replaceWith(from, to, state.schema.text(replacement));
				if (!selected) tr.setSelection(TextSelection.create(tr.doc, from + 1));
				dispatch(tr);
				return true;
			},
		});

		plugins.contentLinks = contentLinks;
	});
}
