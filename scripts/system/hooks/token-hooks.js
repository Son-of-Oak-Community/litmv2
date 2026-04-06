// scripts/system/hooks/token-hooks.js
import { info } from "../../logger.js";
import { ContentSources } from "../content-sources.js";
import { onHoverToken, onCanvasPan } from "../../hud/token-tooltip.js";

/**
 * Load statuses from configured compendium packs and populate CONFIG.statusEffects.
 */
export async function loadStatusCompendium() {
	const packs = ContentSources.getPacks("statuses");
	if (!packs.length) return;
	const allDocs = [];
	for (const pack of packs) {
		const docs = await pack.getDocuments();
		allDocs.push(...docs);
	}
	CONFIG.statusEffects = allDocs.map((doc) => ({
		id: doc.name.slugify({ strict: true }),
		_id: doc.id,
		name: doc.name,
		img: doc.img,
	}));
	info(`Loaded ${allDocs.length} statuses from ${packs.length} compendium pack(s)`);
}

export function registerTokenHooks() {
	Hooks.on("hoverToken", onHoverToken);
	Hooks.on("canvasPan", onCanvasPan);
}
