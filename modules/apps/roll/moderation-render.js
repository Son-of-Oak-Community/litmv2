import { LitmRoll } from "./roll.js";
import { buildRollPreview } from "./roll-pipeline.js";

/**
 * Replace public, masked moderation HTML with this viewer's projection.
 * Remove the old tooltip before awaiting rendering, including legacy cards
 * whose stored HTML may contain names that should never be shown to players.
 */
export async function renderModerationTooltip(message, element) {
	if (!element.querySelector(".litm--moderation-actions")) return;
	const tooltip = element.querySelector(".dice-tooltip");
	if (!tooltip) return;
	const data = message.getFlag("litmv2", "data");
	tooltip.replaceChildren();
	if (!Array.isArray(data?.tags) || data.type === "sacrifice") return;
	const preview = buildRollPreview(data);
	const html = await foundry.applications.handlebars.renderTemplate(
		LitmRoll.TOOLTIP_TEMPLATE,
		{ parts: [], data: LitmRoll.maskTooltipData(preview.tooltipData) },
	);
	tooltip.outerHTML = html;
}
