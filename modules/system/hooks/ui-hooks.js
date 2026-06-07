import { LitmRollDialog } from "../../apps/roll/roll-dialog.js";
import { SceneTagDialog } from "../../apps/story-tags/scene-tag-dialog.js";
import {
	classifyTagStringMatch,
	tagDragData,
} from "../../item/action/tag-string.js";
import { getStoryTagSidebar, localize as t } from "../../utils.js";

export function registerUiHooks() {
	_iconOnlyHeaderButtons();
	_replaceLoadSpinner();
	_listenToContentLinks();
	_addSceneTagsTool();
	_handleTagDropInEditor();
	_refreshOnPlayerChange();
	_renderRollDialogHudOnPlayers();
	_listenToTagDragTransfer();
	_refreshRollDialogsOnSceneTagChange();
	_refreshSidebarOnStoryTagsSetting();
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
		getStoryTagSidebar()?.invalidateCache();
		if (getStoryTagSidebar()?.rendered) getStoryTagSidebar().render();

		const fellowshipId = game.litmv2?.fellowship?.id;
		if (!fellowshipId) return;
		const fellowship = game.actors.get(fellowshipId);
		if (fellowship?.sheet?.rendered) fellowship.sheet.render();
	};

	Hooks.on("userConnected", refresh);
	Hooks.on("updateUser", (_user, changes) => {
		if ("character" in changes) refresh();
	});
}

function _handleTagDropInEditor() {
	const TAG_TYPES = new Set(["story_tag", "status_tag", "limit"]);

	Hooks.on("createProseMirrorEditor", (_uuid, plugins) => {
		const { Plugin, TextSelection, keymap } = foundry.prosemirror;
		const contentLinks = plugins.contentLinks;
		delete plugins.contentLinks;

		plugins.litmTagDrop = new Plugin({
			props: {
				handleDrop(view, event) {
					const data =
						foundry.applications.ux.TextEditor.implementation.getDragEventData(
							event,
						);
					if (!TAG_TYPES.has(data.type)) return;

					const pos = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					if (!pos) return;

					let markup;
					if (data.type === "limit")
						markup = data.value
							? `[${data.name}:${data.value}]`
							: `[${data.name}:]`;
					else {
						const Model = CONFIG.ActiveEffect.dataModels?.[data.type];
						markup = Model?.toDragMarkup
							? Model.toDragMarkup(data)
							: `[${data.name}]`;
					}

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
				const tr = state.tr.replaceWith(
					from,
					to,
					state.schema.text(replacement),
				);
				if (!selected) tr.setSelection(TextSelection.create(tr.doc, from + 1));
				dispatch(tr);
				return true;
			},
		});

		plugins.contentLinks = contentLinks;
	});
}

/**
 * Re-render the roll dialog HUD whenever the players list panel is re-rendered
 * (e.g. player connect/disconnect, character assignment changes).
 */
function _renderRollDialogHudOnPlayers() {
	Hooks.on("renderPlayers", () => {
		game.litmv2.rollDialogHud?.render?.();
	});
}

/**
 * Re-render any open LitmRollDialog when scene-tag state changes. Emitted by
 * StoryTagSidebar#broadcastRender after any CRUD on scene tags / statuses /
 * limits, so the dialog's contributed-tag groups stay in sync.
 */
function _refreshRollDialogsOnSceneTagChange() {
	Hooks.on("litm.sceneTagsChanged", () => {
		for (const app of foundry.applications.instances.values()) {
			if (app instanceof LitmRollDialog && app.rendered) app.render();
		}
	});
}

/**
 * Re-render the sidebar and open roll dialogs on remote clients after the
 * `storytags` world setting is updated. The custom `storyTagsRender` socket
 * fires synchronously, but Foundry's `modifyDocument` handler for the Setting
 * is async — so the sidebar can render before the new value lands in the
 * local cache. `updateSetting` fires after the local update is applied, so
 * this is the race-free signal for setting-driven changes (e.g. actor
 * hide/reveal, tracked-actor list, limits).
 */
function _refreshSidebarOnStoryTagsSetting() {
	Hooks.on("updateSetting", (setting, _change, _options, userId) => {
		if (setting.key !== "litmv2.storytags") return;
		if (userId === game.userId) return;
		const sidebar = getStoryTagSidebar();
		if (sidebar) {
			sidebar.invalidateCache();
			if (sidebar.rendered) sidebar.render();
		}
		for (const app of foundry.applications.instances.values()) {
			if (app instanceof LitmRollDialog && app.rendered) app.render();
		}
	});
}

function _listenToTagDragTransfer() {
	Hooks.on("ready", () => {
		document.addEventListener("dragstart", (event) => {
			const target = event.target.closest(
				".litm--tag, .litm--status, .litm-tag, .litm-status, .litm-limit, .litm-weakness_tag",
			);
			if (!target) return;

			const text = target.dataset.text || target.textContent;
			const match = [...`[${text}]`.matchAll(CONFIG.litmv2.tagStringRe)][0];
			if (!match) return;

			const c = classifyTagStringMatch(match);
			// Chip data-text is the bare name for weakness/limit/single-use
			// and variable-tier status chips (it doubles as the CSS stroke
			// underlay), so the chip's classes are the source of truth for
			// those kinds; a limit's max travels in data-value.
			const cls = target.classList;
			if (cls.contains("litm-weakness_tag")) c.kind = "weakness";
			else if (cls.contains("litm-limit")) {
				c.kind = "limit";
				if (target.dataset.value) c.value = target.dataset.value;
			} else if (cls.contains("litm-status") || cls.contains("litm--status"))
				c.kind = "status";
			if (cls.contains("litm--single-use")) c.isSingleUse = true;

			const appEl = target.closest(".sheet");
			const app = appEl ? foundry.applications.instances.get(appEl.id) : null;
			const data = tagDragData(c, {
				sourceActorId: app?.document?.id ?? null,
			});
			event.dataTransfer.setData("text/plain", JSON.stringify(data));
		});
	});
}
