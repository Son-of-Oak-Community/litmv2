import { info } from "../../logger.js";
import { LitmItem } from "../../item/litm-item.js";

/**
 * One-time cleanup: remove duplicate title tag effects from theme items.
 * Prior to the race-condition fix in ensureTitleTag, concurrent calls could
 * create multiple title tags on a single theme.
 */
export async function migrate() {
	for (const actor of game.actors) {
		for (const item of actor.items) {
			await LitmItem.ensureTitleTag(item);
		}
	}
	info("Dedup title tags migration complete");
}
