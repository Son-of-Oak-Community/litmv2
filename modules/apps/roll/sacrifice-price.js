import { maxStatusTier } from "../../active-effects/status-tag-data.js";
import { FLAGS, POWER_TAG_TYPES } from "../../system/config.js";
import { dialogContent } from "../../system/renderers/renderer-utils.js";
import { levelIcon, localize as t } from "../../utils.js";
import { resolveSharedRollOwner } from "./roll-authority.js";
import { effectiveSacrificeLevel } from "./sacrifice-rules.js";
import { spendSecretGrace } from "../../actor/hero/secret-grace.js";
import { ThemeEvolutionWizard } from "../theme-evolution.js";

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
 * @returns {{level: string, outcome: string, themeId?: string, statusName?: string, messageId?: string, graceBonus?: number}|null}
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
	const {
		sacrificeLevel,
		sacrificeThemeId,
		sacrificeStatusName,
		sacrificeBonus,
	} = roll.litm;
	return actor.setFlag("litmv2", FLAGS.pendingSacrifice, {
		level: sacrificeLevel || "painful",
		outcome: roll.outcome?.label ?? "",
		themeId: sacrificeThemeId ?? null,
		statusName: sacrificeStatusName ?? null,
		messageId: message?.id ?? null,
		// The Secret Grace the roll was granted, spent only once the price is
		// paid (Vol. II p.78); a forgiven Sacrifice keeps it.
		graceBonus: Number(sacrificeBonus) || 0,
	});
}

/**
 * The one user who pays a Hero's debt: an active player owning the Hero, else
 * the Narrator — the same seat a shared roll picks. One payer, so two owners
 * can't both press Complete in the same moment and pay it twice; any
 * Narrator may still forgive.
 * @param {Actor} actor
 * @returns {string|null}
 */
export function sacrificePayerId(actor) {
	return resolveSharedRollOwner({
		owners: game.users.filter((u) => actor.testUserPermission(u, "OWNER")),
		gmUserId: game.users.activeGM?.id ?? null,
	});
}

/**
 * Whether `user` may open the payment dialog: the payer, or a Narrator to
 * forgive.
 * @param {Actor} actor
 * @param {User} [user]
 * @returns {boolean}
 */
export function canSettleSacrifice(actor, user = game.user) {
	return !!actor && (user.isGM || sacrificePayerId(actor) === user.id);
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
	if (!pending || !canSettleSacrifice(actor)) return false;
	const effective = effectiveSacrificeLevel(pending.level, pending.outcome);
	const result = await confirmAndApplySacrifice(actor, {
		effective,
		themeId: pending.themeId,
		statusName: pending.statusName,
		debt: pending,
	});
	// Closed, settled elsewhere, or the theme or tag went first: still owed.
	if (!result) return false;
	// Cleared only once the price is on, so a payer who drops away mid-payment
	// leaves the debt owed rather than gone unpaid.
	await actor.unsetFlag("litmv2", FLAGS.pendingSacrifice);
	if (result === FORGIVE)
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_forgiven", { name: actor.name }),
		);
	else {
		notifyPaid(actor, effective, result);
		// Grace is spent with a price paid, not with a debt that had none left.
		if (!result.nothing)
			await spendSecretGrace(actor, pending.graceBonus)?.catch(console.error);
	}
	return true;
}

/**
 * {@link completePendingSacrifice} for a click: a price that failed to apply
 * stays owed, and the player is told rather than left with a silent
 * console error.
 * @param {Actor} actor
 */
export function payPendingSacrifice(actor) {
	return completePendingSacrifice(actor).catch((err) => {
		console.error(err);
		ui.notifications.error(
			game.i18n.format("LITM.Ui.sacrifice_pay_failed", { name: actor.name }),
		);
		return false;
	});
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
 * stands until the price is applied; {@link completePendingSacrifice} clears
 * it then. Only the payer is offered Complete, so it is never paid twice.
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
			...(sacrificePayerId(actor) === game.user.id
				? [
						{
							action: "pay",
							label: t("LITM.Ui.sacrifice_complete"),
							icon: "fa-solid fa-hand-holding-heart",
							default: true,
							callback: (_event, button) => pay(button) ?? null,
						},
					]
				: []),
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
	if (stillOwes(actor, debt)) return answer;
	ui.notifications.info(
		game.i18n.format("LITM.Ui.sacrifice_already_settled", { name: actor.name }),
	);
	return null;
}

function notifyPaid(actor, effective, result) {
	// The Replace wizard has announced the new theme already.
	if (result.replaced) return;
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
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_theme_scratched", {
				theme: result.themeName,
			}),
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
			? "LITM.Ui.sacrifice_confirm_scarring_replace"
			: "LITM.Ui.sacrifice_confirm_painful";
	const answer = await askToPay({
		actor,
		debt,
		content: `${await sacrificeThemeHeader(theme)}${dialogContent(confirmKey, { theme: theme.name, name: actor.name })}`,
	});
	if (answer !== true) return answer;
	if (effective === "scarring") return replaceSacrificedTheme(actor, theme);
	return applyThemeSacrifice(actor, effective, { themeId });
}

/**
 * A Scarring price replaces the theme (Core Book p.159), and replacing a
 * theme is the p.192 procedure: Promise for the replacement and for each
 * extra the theme carried, then a new nascent theme — title tag, weakness
 * tag and Quest — in its place. The Replace wizard does exactly that, so
 * the price is paid there, and only once the player confirms it. Closing
 * the wizard leaves the Sacrifice owed.
 * @param {Actor} actor
 * @param {Item} theme
 * @returns {Promise<{themeName: string, replaced: true}|null>}
 */
async function replaceSacrificedTheme(actor, theme) {
	const themeName = theme.name;
	// A story theme can no longer be staked on Scarring, but a debt recorded
	// before that still names one. It has no Quest or Promise to replace it
	// by, so it is simply lost.
	if (theme.type !== "theme") {
		await actor.deleteEmbeddedDocuments("Item", [theme.id]);
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_story_theme_lost", { theme: themeName }),
		);
		return { themeName, replaced: true };
	}
	const Wizard = game.litmv2?.ThemeEvolutionWizard ?? ThemeEvolutionWizard;
	const wizard = new Wizard({
		actorId: actor.id,
		themeId: theme.id,
		forceReplace: true,
	});
	await wizard.render(true);
	return (await wizard.done) ? { themeName, replaced: true } : null;
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
 * a theme's tags for painful and by a status at the world's top tier — the
 * one that kills or transforms — for grave. Scarring replaces the theme
 * through the Replace wizard instead ({@link replaceSacrificedTheme}).
 * Performs document mutations only; notifications are shown by the caller.
 * @param {Actor} actor
 * @param {"painfulOne"|"painful"|"grave"} level - The *effective* price level
 * @param {object} [opts]
 * @param {string} [opts.themeId]   Required for painfulOne/painful
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

	const powerEffects = theme.effects.filter((e) =>
		POWER_TAG_TYPES.has(e.type),
	);
	if (powerEffects.length) {
		await theme.updateEmbeddedDocuments(
			"ActiveEffect",
			powerEffects.map((e) => ({ _id: e.id, "system.isScratched": true })),
		);
	}

	return { themeName };
}
