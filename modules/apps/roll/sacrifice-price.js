import { maxStatusTier } from "../../active-effects/status-tag-data.js";
import { FLAGS, POWER_TAG_TYPES } from "../../system/config.js";
import { dialogContent } from "../../system/renderers/renderer-utils.js";
import { levelIcon, localize as t } from "../../utils.js";
import { effectiveSacrificeLevel } from "./sacrifice-rules.js";

/**
 * Paying a Sacrifice (Core Book p.159). The price a Sacrifice roll leaves owing
 * is kept on the Hero — the `pendingSacrifice` flag — rather than on its chat
 * card, so deleting the card or clearing the log does not cancel it. Whoever
 * owns the Hero pays it, from the card or the ribbon above the player list;
 * the Narrator's payment dialog also offers to forgive it.
 */

/** A payment dialog's answer when the Narrator forgives the debt instead. */
const FORGIVE = Symbol("forgive");

/**
 * The price a Hero still owes, or null.
 * @param {Actor} actor
 * @returns {{level: string, outcome: string, themeId?: string, statusName?: string, messageId?: string}|null}
 */
export function pendingSacrifice(actor) {
	return actor?.getFlag?.("litmv2", FLAGS.pendingSacrifice) ?? null;
}

/**
 * Record the price a Sacrifice roll left owing. Runs on the roller's client,
 * which owns the Hero.
 * @param {Actor} actor
 * @param {LitmRoll} roll
 * @param {ChatMessage} message  The card the roll posted.
 */
export function recordPendingSacrifice(actor, roll, message) {
	if (!actor?.isOwner) return;
	const { sacrificeLevel, sacrificeThemeId, sacrificeStatusName } = roll.litm;
	return actor.setFlag("litmv2", FLAGS.pendingSacrifice, {
		level: sacrificeLevel || "painful",
		outcome: roll.outcome?.label ?? "",
		themeId: sacrificeThemeId ?? null,
		statusName: sacrificeStatusName ?? null,
		messageId: message?.id ?? null,
	});
}

/**
 * The id of a Hero's payment dialog, so it can be closed once the debt is
 * settled from another client.
 * @param {Actor} actor
 * @returns {string}
 */
export function paymentDialogId(actor) {
	return `litm-sacrifice-pay-${actor.id}`;
}

/** Whether `actor` still owes exactly the debt `debt` was read from. */
function stillOwes(actor, debt) {
	const now = pendingSacrifice(actor);
	return (
		!!now && now.messageId === debt.messageId && now.level === debt.level
	);
}

/**
 * Ask the player to pay the Hero's owed price, apply it, and clear the debt.
 * @param {Actor} actor
 * @returns {Promise<boolean>} whether the price was paid
 */
export async function completePendingSacrifice(actor) {
	const pending = pendingSacrifice(actor);
	if (!pending || !actor.isOwner) return false;
	const effective = effectiveSacrificeLevel(pending.level, pending.outcome);
	// A copy: askToPay marks it `claimed`, and the flag's own object must not change.
	const debt = { ...pending };
	let result;
	try {
		result = await confirmAndApplySacrifice(actor, {
			effective,
			themeId: pending.themeId,
			statusName: pending.statusName,
			debt,
		});
	} catch (err) {
		// The debt was cleared before the price went on; a price that failed
		// to apply is still owed.
		if (debt.claimed) {
			const { claimed: _claimed, ...flag } = debt;
			await actor.setFlag("litmv2", FLAGS.pendingSacrifice, flag);
		}
		throw err;
	}
	if (!result) return false;
	// Settled without a dialog: nothing was left to pay with.
	if (!debt.claimed) await actor.unsetFlag("litmv2", FLAGS.pendingSacrifice);
	if (result === FORGIVE)
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_forgiven", { name: actor.name }),
		);
	else notifyPaid(actor, effective, result);
	return true;
}

/**
 * The payment dialog: Complete Sacrifice, and for the Narrator Forgive — the
 * escape hatch for a roll made by mistake or a price the table settled another
 * way; nothing is applied on Forgive. There is no Cancel: a price is not
 * declined. Closing the window only defers it, and the Hero stays held.
 *
 * The debt can be settled elsewhere while this stays open — the Narrator
 * forgives, another owner pays. The answer is checked against the debt the
 * dialog was opened for, so a late Complete applies nothing. A live answer
 * clears the debt at once, before the price is applied, so a second owner
 * answering a moment later finds it settled rather than paying it again.
 * @param {object} options
 * @param {Actor} options.actor
 * @param {object} options.debt  The pendingSacrifice flag the dialog is for.
 * @param {string} options.content
 * @param {Function} [options.pay] Reads the answer off the form; defaults to true.
 * @param {object} [options.dialog] Extra DialogV2 options (classes, position).
 * @returns {Promise<*>} pay's answer, FORGIVE, or null when cancelled or settled
 */
async function askToPay({ actor, debt, content, pay = () => true, dialog = {} }) {
	const answer = await foundry.applications.api.DialogV2.wait({
		id: paymentDialogId(actor),
		window: { title: t("LITM.Ui.sacrifice_confirm_title") },
		content,
		buttons: [
			{
				action: "pay",
				label: t("LITM.Ui.sacrifice_complete"),
				icon: "fa-solid fa-hand-holding-heart",
				default: true,
				callback: (_event, button) => pay(button) ?? null,
			},
			...(game.user.isGM
				? [
						{
							action: "forgive",
							label: t("LITM.Ui.sacrifice_forgive"),
							icon: "fa-solid fa-feather",
							callback: () => FORGIVE,
						},
					]
				: []),
		],
		rejectClose: false,
		modal: true,
		...dialog,
	});
	if (answer == null) return null;
	if (stillOwes(actor, debt)) {
		debt.claimed = true;
		await actor.unsetFlag("litmv2", FLAGS.pendingSacrifice);
		return answer;
	}
	ui.notifications.info(
		game.i18n.format("LITM.Ui.sacrifice_already_settled", { name: actor.name }),
	);
	return null;
}

function notifyPaid(actor, effective, result) {
	if (result.nothing) {
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_nothing_to_pay", { name: actor.name }),
		);
	} else if (result.statusName) {
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_status_applied", {
				actor: actor.name,
				status: result.statusName,
			}),
		);
	} else if (result.tagName) {
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_tag_scratched", {
				tag: result.tagName,
				theme: result.themeName,
			}),
		);
	} else if (result.themeName) {
		const notifKey =
			effective === "scarring"
				? "LITM.Ui.sacrifice_theme_removed"
				: "LITM.Ui.sacrifice_theme_scratched";
		ui.notifications.info(
			game.i18n.format(notifKey, { theme: result.themeName }),
		);
	}
}

/**
 * Confirm with the player and apply the sacrifice consequence. The dialog
 * pre-collected the theme (always) and status name (grave-only), so this
 * step is a confirm-or-cancel, not a re-collection.
 * @param {Actor} actor
 * @param {object} ctx
 * @param {"painfulOne"|"painful"|"scarring"|"grave"} ctx.effective
 * @param {string} [ctx.themeId]
 * @param {string} [ctx.statusName]
 * @param {object} ctx.debt  The pendingSacrifice flag being paid.
 * @returns {Promise<{themeName?: string, tagName?: string, statusName?: string, nothing?: true}|symbol|null>}
 *   what was paid, FORGIVE, or null when cancelled
 */
async function confirmAndApplySacrifice(
	actor,
	{ effective, themeId, statusName, debt },
) {
	if (effective === "grave") {
		const name =
			(statusName || "").trim() || t("LITM.Ui.sacrifice_grave_default");
		// Status name is user input from the roll dialog; dialogContent escapes
		// it, and the raw `name` still goes to addStatus below.
		const tier = maxStatusTier();
		const chip = foundry.utils.escapeHTML(`${name}-${tier}`);
		const answer = await askToPay({
			actor,
			debt,
			content: `<div class="flexrow noflex"><span class="noflex litm-status" data-text="${chip}">${chip}</span></div>${dialogContent(
				"LITM.Ui.sacrifice_confirm_grave_named",
				{ status: name, tier, name: actor.name },
			)}`,
		});
		if (answer !== true) return answer;
		return applyThemeSacrifice(actor, "grave", { statusName: name });
	}

	const theme = themeId ? actor.items.get(themeId) : null;
	// A theme already gone, or a Miracle with no tag left to scratch, leaves
	// nothing to pay; settle the debt so it doesn't block the Hero's next roll.
	if (!theme) return { nothing: true };
	if (effective === "painfulOne") {
		const live = scratchableTags(theme);
		if (!live.length) return { nothing: true };
		const tagId = await pickSacrificeTag(actor, theme, live, debt);
		if (typeof tagId !== "string") return tagId;
		return applyThemeSacrifice(actor, effective, { themeId, tagId });
	}
	const confirmKey =
		effective === "scarring"
			? "LITM.Ui.sacrifice_confirm_scarring"
			: "LITM.Ui.sacrifice_confirm_painful";
	const answer = await askToPay({
		actor,
		debt,
		content: `${await sacrificeThemeHeader(theme)}${dialogContent(confirmKey, { theme: theme.name, name: actor.name })}`,
	});
	if (answer !== true) return answer;
	return applyThemeSacrifice(actor, effective, { themeId });
}

/**
 * What the sacrifice-theme partial needs to head a theme: its name and its
 * Might (level) icon. Shared with the chat card.
 * @param {Item} theme
 * @returns {{name: string, icon: string|null, levelLabel: string}}
 */
export function sacrificeThemeView(theme) {
	const level = theme.system?.level;
	return {
		name: theme.name,
		icon: level ? levelIcon(level) : null,
		levelLabel: level ? t(`LITM.Terms.${level}`) : "",
	};
}

/** The theme being sacrificed, headed as the roll dialog and the card head it. */
function sacrificeThemeHeader(theme) {
	return foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/partials/sacrifice-theme.html",
		sacrificeThemeView(theme),
	);
}

/** A theme's enabled, unscratched power tags: what a lessened Painful can take. */
function scratchableTags(theme) {
	return theme.effects.filter(
		(e) => POWER_TAG_TYPES.has(e.type) && !e.disabled && !e.system?.isScratched,
	);
}

/**
 * A Miracle on a Painful Sacrifice scratches one tag of the theme (Core Book
 * p.159), and the player picks which. Offers the same tags a full Painful
 * price would scratch, minus the ones already scratched.
 * @param {Actor} actor
 * @param {Item} theme
 * @param {ActiveEffect[]} live  The theme's tags still to scratch; not empty.
 * @param {object} debt  The pendingSacrifice flag being paid.
 * @returns {Promise<string|symbol|null>} the chosen effect id, or FORGIVE
 */
async function pickSacrificeTag(actor, theme, live, debt) {
	const titleTag = live.find((e) => e.system?.isTitleTag);
	// Pre-check the first tag shown, so OK always names one: a Miracle still pays.
	const first = titleTag ?? live[0];
	const entry = (e) => ({
		index: e.id,
		name: e.name,
		type: e.type,
		checked: e === first,
	});
	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/apps/tag-picker-form.html",
		{
			groups: [
				{
					img: theme.img,
					fallbackLabel: theme.name,
					titleEntry: titleTag ? entry(titleTag) : null,
					entries: live.filter((e) => e !== titleTag).map(entry),
				},
			],
		},
	);
	return askToPay({
		actor,
		debt,
		// The picker's group heading already shows the theme's icon and title.
		content: `${dialogContent("LITM.Ui.sacrifice_confirm_painful_one", { theme: theme.name, name: actor.name })}${content}`,
		pay: (button) =>
			button.form?.querySelector("input[name='picked']:checked")?.value,
		dialog: {
			classes: ["litm", "litm--picker", "litm--tag-picker-dialog"],
			position: { width: 420 },
		},
	});
}

/**
 * Apply the consequence of a sacrifice roll to a hero. The price is paid by
 * a theme for painful/scarring and by a status at the world's top tier — the
 * one that kills or transforms — for grave.
 * Performs document mutations only; notifications are shown by the caller.
 * @param {Actor} actor
 * @param {"painfulOne"|"painful"|"scarring"|"grave"} level - The *effective* price level
 * @param {object} [opts]
 * @param {string} [opts.themeId]   Required for painfulOne/painful/scarring
 * @param {string} [opts.tagId]     Required for painfulOne — the one tag to scratch
 * @param {string} [opts.statusName] Required for grave
 * @returns {Promise<{themeName?: string, tagName?: string, statusName?: string}|null>}
 */
async function applyThemeSacrifice(
	actor,
	level,
	{ themeId, tagId, statusName } = {},
) {
	if (level === "grave") {
		if (!statusName) return null;
		await actor.system.addStatus(statusName, { tier: maxStatusTier() });
		return { statusName };
	}

	const theme = themeId ? actor.items.get(themeId) : null;
	if (!theme) return null;
	const themeName = theme.name;

	if (level === "painfulOne") {
		const tag = theme.effects.get(tagId);
		if (!tag) return null;
		await tag.update({ "system.isScratched": true });
		return { themeName, tagName: tag.name };
	}

	if (level === "painful") {
		const powerEffects = theme.effects.filter((e) =>
			POWER_TAG_TYPES.has(e.type),
		);
		if (powerEffects.length) {
			await theme.updateEmbeddedDocuments(
				"ActiveEffect",
				powerEffects.map((e) => ({ _id: e.id, "system.isScratched": true })),
			);
		}
	} else if (level === "scarring") {
		await actor.deleteEmbeddedDocuments("Item", [theme.id]);
	}

	return { themeName };
}
