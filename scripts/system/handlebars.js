import { info } from "../logger.js";

export class HandlebarsHelpers {
	static register() {
		info("Registering Handlebars Helpers...");

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
	}
}

export class HandlebarsPartials {
	static partials = [
		"systems/litmv2/templates/apps/loot-dialog.html",
		"systems/litmv2/templates/chat/message.html",
		"systems/litmv2/templates/chat/message-tooltip.html",
		"systems/litmv2/templates/chat/moderation.html",
		"systems/litmv2/templates/partials/play-tag.html",
		"systems/litmv2/templates/partials/play-theme-tags.html",
		"systems/litmv2/templates/partials/play-theme-tracks.html",
		"systems/litmv2/templates/partials/edit-theme-tags-activatable.html",
		"systems/litmv2/templates/partials/theme-special-improvements.html",
		"systems/litmv2/templates/partials/theme-card-header.html",
		"systems/litmv2/templates/partials/play-profile-img.html",
		"systems/litmv2/templates/partials/vignette-card-edit.html",
		"systems/litmv2/templates/partials/vignette-card-play.html",
		"systems/litmv2/templates/partials/rating-star.html",
		"systems/litmv2/templates/partials/control-legend.html",
		"systems/litmv2/templates/partials/icon-fellowship-hint.html",
		"systems/litmv2/templates/apps/welcome-overlay/wizard-footer.html",
	];

	static register() {
		info("Registering Handlebars Partials...");
		foundry.applications.handlebars.loadTemplates(HandlebarsPartials.partials);
	}
}
