import { error } from "../../logger.js";

export function registerItemHooks() {
	_prepareThemeOnCreate();
	_syncThemeImageOnLevelChange();
	_safeUpdateItemSheet();
	_syncBackpackOnUpdate();
}

function _prepareThemeOnCreate() {
	Hooks.on("preCreateItem", (item, data) => {
		if (item.img !== "icons/svg/item-bag.svg") return;

		const { icons } = CONFIG.litmv2.assets;
		const { base } = icons;
		let img = base;
		switch (data.type) {
			case "theme": {
				const level =
					data.system?.level ?? Object.keys(CONFIG.litmv2.theme_levels)[0];
				img = `systems/litmv2/assets/media/icons/${level}.svg`;
				break;
			}
			case "themebook": {
				const tbLevel = data.system?.theme_level ?? "origin";
				img = `systems/litmv2/assets/media/icons/${tbLevel}.svg`;
				break;
			}
			case "addon":
				img += icons.vignette;
				break;
			case "vignette":
				img += icons.vignette;
				break;
			case "backpack":
				img += icons.backpack;
				break;
			case "trope":
				img = "icons/svg/target.svg";
				break;
			default:
				img = icons.default;
		}
		item.updateSource({ img });
	});
}

function _syncThemeImageOnLevelChange() {
	Hooks.on("preUpdateItem", (item, data) => {
		if (item.type === "theme") {
			const newLevel = data.system?.level ?? data["system.level"];
			if (newLevel) {
				data.img = `systems/litmv2/assets/media/icons/${newLevel}.svg`;
			}
		} else if (item.type === "themebook") {
			const newLevel = data.system?.theme_level ?? data["system.theme_level"];
			if (newLevel) {
				data.img = `systems/litmv2/assets/media/icons/${newLevel}.svg`;
			}
		}
	});
}

/**
 * When a backpack item is updated, re-sync its contents → effects
 * and notify the story tag sidebar.
 */
function _syncBackpackOnUpdate() {
	Hooks.on("updateItem", (item, changes) => {
		if (item.type !== "backpack") return;
		if (!changes.system?.contents) return;
		const actor = item.parent;
		if (actor?.type !== "hero") return;
		const sheet = actor.sheet;
		if (!sheet || sheet._syncing) return;
		sheet._syncContentsToEffects();
	});
}

function _safeUpdateItemSheet() {
	Hooks.on("preUpdateItem", (_, data) => {
		function getArray(data) {
			return Array.isArray(data) ? data : Object.values(data);
		}

		const { schema: tagSchema } = game.litmv2.data.TagData;
		const { system = {} } = data;

		const { powerTags = [], weaknessTags = [], contents = [] } = system;
		const toValidate = [
			...getArray(powerTags),
			...getArray(weaknessTags),
			...getArray(contents),
		];
		if (!toValidate.length) return;

		const validationErrors = toValidate
			.map((item) => tagSchema.validate(item, { strict: true, partial: false }))
			.filter(Boolean);

		if (validationErrors.length) {
			error("Validation errors", validationErrors);
			ui.notifications.error("LITM.Ui.error_validating_item", {
				localize: true,
			});
			return false;
		}
	});
}
