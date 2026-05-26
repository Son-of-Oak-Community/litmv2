import { info } from "../logger.js";
import { proseChipsHtml } from "./renderers/renderer-utils.js";

export class HandlebarsHelpers {
	static register() {
		info("Registering Handlebars Helpers...");

		Handlebars.registerHelper(
			"prose-chips",
			(text) => new Handlebars.SafeString(proseChipsHtml(text ?? "")),
		);

		Handlebars.registerHelper("add", (...args) => {
			args.pop();
			return args.reduce((acc, val) => acc + val, 0);
		});

		Handlebars.registerHelper(
			"progress-buttons",
			function (current, max, block) {
				let acc = "";
				const data = Handlebars.createFrame(block.data);
				for (let i = 0; i < max; ++i) {
					data.index = i;
					data.checked = i < current;
					acc += block.fn(this, { data });
				}
				return acc;
			},
		);

		Handlebars.registerHelper("toJSON", (obj) => JSON.stringify(obj ?? {}));

		Handlebars.registerHelper("join", (array, separator) => {
			if (!Array.isArray(array)) return "";
			return array.join(typeof separator === "string" ? separator : ", ");
		});

		Handlebars.registerHelper("sum", (a, b) => a + b);
	}
}

export class HandlebarsPartials {
	// Templates referenced via `{{> "path"}}` from multiple sheets, or from
	// chat/enricher contexts that have no ApplicationV2 lifecycle to hang a
	// per-part `templates: []` off of. Sheet-local partials live on their
	// owning sheet's `PARTS.<id>.templates` instead. Templates that are only
	// invoked via top-level `renderTemplate(path, data)` are not listed --
	// `getTemplate` lazy-loads and caches them on first call.
	static partials = [
		"systems/litmv2/templates/partials/play-tag.html",
		"systems/litmv2/templates/partials/play-theme-tags.html",
		"systems/litmv2/templates/partials/play-theme-tracks.html",
		"systems/litmv2/templates/partials/theme-special-improvements.html",
		"systems/litmv2/templates/partials/theme-card-header.html",
		"systems/litmv2/templates/partials/theme-description.html",
		"systems/litmv2/templates/partials/play-profile-img.html",
		"systems/litmv2/templates/partials/rating-star.html",
		"systems/litmv2/templates/partials/control-legend.html",
		"systems/litmv2/templates/partials/weakness-chevron.html",
	];

	static register() {
		info("Registering Handlebars Partials...");
		foundry.applications.handlebars.loadTemplates(HandlebarsPartials.partials);
	}
}
