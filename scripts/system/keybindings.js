import { LitmActorSheet } from "../sheets/base-actor-sheet.js";
import { getStoryTagSidebar, localize as t } from "../utils.js";
import { LitmSettings } from "./settings.js";

/**
 * Toggle an ApplicationV2 window with bring-to-front semantics:
 * - If not rendered → render.
 * - If rendered but minimized → maximize.
 * - If rendered but not the active (top) window → bring to front.
 * - Otherwise (rendered and on top) → close.
 *
 * @param {foundry.applications.api.ApplicationV2|null|undefined} app
 * @param {() => void} renderFn  Called when the app needs to be rendered/created.
 */
function smartToggle(app, renderFn) {
	if (!app?.rendered) return renderFn();
	if (app.minimized) return app.maximize();
	if (ui.activeWindow !== app) return app.bringToFront();
	return app.close();
}

export class KeyBindings {
	static register() {
		game.keybindings.register("litmv2", "toggleEditMode", {
			name: t("LITM.Ui.toggle_edit_mode"),
			hint: t("LITM.Ui.toggle_edit_mode_hint"),
			editable: [
				{
					key: "KeyE",
				},
			],
			onDown: () => {
				let topSheet = null;
				let topZ = -1;
				for (const app of foundry.applications.instances.values()) {
					if (!(app instanceof LitmActorSheet)) continue;
					if (!app.rendered) continue;
					const z = Number.parseInt(app.element?.style.zIndex ?? 0, 10);
					if (z > topZ) {
						topZ = z;
						topSheet = app;
					}
				}
				if (!topSheet) return;
				return topSheet._onChangeSheetMode(new Event("keydown"));
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.NORMAL,
		});

		game.keybindings.register("litmv2", "wrapTagMarkup", {
			name: t("LITM.Ui.wrap_tag_markup"),
			hint: t("LITM.Ui.wrap_tag_markup_hint"),
			editable: [
				{
					key: "KeyT",
					modifiers: ["Alt"],
				},
			],
			onDown: () => {
				const el = document.activeElement;
				if (
					!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
				) {
					return;
				}
				const { selectionStart: start, selectionEnd: end, value } = el;
				if (start === null || end === null) return;

				const selected = value.slice(start, end);
				const replacement = selected ? `[${selected}]` : "[]";
				el.setRangeText(replacement, start, end, "end");
				// Place cursor between brackets when no selection
				if (!selected) el.setSelectionRange(start + 1, start + 1);
				el.dispatchEvent(new Event("input", { bubbles: true }));
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});

		game.keybindings.register("litmv2", "toggleTagsSidebar", {
			name: t("LITM.Ui.toggle_tags_sidebar"),
			hint: t("LITM.Ui.toggle_tags_sidebar_hint"),
			editable: [
				{
					key: "KeyT",
				},
			],
			onDown: () => {
				const sidebar = getStoryTagSidebar();
				if (!sidebar) return;
				smartToggle(sidebar.popout, () => sidebar.renderPopout());
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.NORMAL,
		});

		game.keybindings.register("litmv2", "toggleCharacterSheet", {
			name: t("LITM.Ui.toggle_character_sheet"),
			hint: t("LITM.Ui.toggle_character_sheet_hint"),
			editable: [
				{
					key: "KeyC",
				},
			],
			onDown: () => {
				const token = canvas?.ready && canvas.tokens.controlled.length === 1
					? canvas.tokens.controlled[0]
					: null;
				const actor = token ? token.actor : game.user.character;
				if (!actor) return false;
				smartToggle(actor.sheet, () => actor.sheet.render(true));
				return true;
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.NORMAL,
		});

		game.keybindings.register("litmv2", "openFellowshipSheet", {
			name: t("LITM.Ui.open_fellowship_sheet"),
			hint: t("LITM.Ui.open_fellowship_sheet_hint"),
			editable: [
				{
					key: "KeyF",
				},
			],
			onDown: () => {
				if (!LitmSettings.useFellowship) {
					return ui.notifications.warn("LITM.Ui.warn_no_fellowship", {
						localize: true,
					});
				}
				const fellowship = game.actors.find((a) => a.type === "fellowship");
				if (!fellowship) {
					return ui.notifications.warn("LITM.Ui.warn_no_fellowship", {
						localize: true,
					});
				}
				const sheet = fellowship.sheet;
				if (sheet.rendered) return sheet.close();
				return sheet.render(true);
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.NORMAL,
		});

		game.keybindings.register("litmv2", "openActionsApp", {
			name: t("LITM.Actions.open_actions_app"),
			hint: t("LITM.Actions.open_actions_app_hint"),
			editable: [
				{
					key: "KeyA",
					modifiers: ["Alt"],
				},
			],
			onDown: () => {
				const character = game.user.character;
				if (!character) {
					return ui.notifications.warn("LITM.Actions.warn_no_character", {
						localize: true,
					});
				}
				const app = character.sheet?.actionsApp;
				if (!app) return;
				if (app.rendered) app.close();
				else app.render(true);
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.NORMAL,
		});

		game.keybindings.register("litmv2", "openDiceRoller", {
			name: t("LITM.Ui.dice_roller"),
			hint: t("LITM.Ui.dice_roller_hint"),
			editable: [
				{
					key: "KeyR",
				},
			],
			onDown: () => {
				const sheet = game.user.character?.sheet;
				if (!sheet) {
					return ui.notifications.warn("LITM.Ui.warn_no_character", {
						localize: true,
					});
				}
				return sheet.renderRollDialog({ toggle: true });
			},
			onUp: () => {},
			restricted: false,
			precedence: foundry.CONST.KEYBINDING_PRECEDENCE.PRIORITY,
		});
	}
}
