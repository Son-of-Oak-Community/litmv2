import { PrintedCardsMixin } from "../../sheets/printed-cards-mixin.js";
import { FellowshipSheet } from "./fellowship-sheet.js";

/**
 * Printed-card Fellowship variant: story tags and statuses, the Fellowship
 * theme and the story themes as one row of printed cards. The card face and
 * flip come from `PrintedCardsMixin` (litmv2.css §25b), the board from §25c.
 * Edit mode keeps the classic form, with the cards' banners.
 */
export class FellowshipSheetCards extends PrintedCardsMixin(FellowshipSheet) {
	static DEFAULT_OPTIONS = {
		classes: ["litm-fellowship-cards"],
	};

	static PLAY_CONTENT_TEMPLATE =
		"systems/litmv2/templates/actor/fellowship-cards-play-content.html";

	/**
	 * The shared partials switch to their card rows, and the description to
	 * its clamp, on `cardsLayout`. The header part reads it as the hero's
	 * portrait panel, so the header does not get it.
	 * @override
	 */
	async _preparePartContext(partId, context, options) {
		const partContext = await super._preparePartContext(
			partId,
			context,
			options,
		);
		return partId === "header"
			? partContext
			: { ...partContext, cardsLayout: true };
	}
}
