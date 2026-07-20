const { JournalEntrySheet } = foundry.applications.sheets.journal;

/**
 * Rulebook-styled JournalEntry sheet: adds the `litm-journal` class (which the
 * journal stylesheet keys off for the parchment/serif look) and opens in the
 * multi-page view. Ported from the legend-in-the-mist module so converted LitM
 * content reads like the printed book. Registered non-default — journals opt in
 * per document (the converter sets flags.core.sheetClass).
 */
export class LitmJournalSheet extends JournalEntrySheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm-journal"],
		position: {
			width: 680,
			height: 800,
		},
	};

	_configureRenderOptions(options) {
		if (!this.rendered) {
			options.mode = 2; // JournalEntrySheet.VIEW_MODES.MULTIPLE
			options.expanded = false;
		}
		super._configureRenderOptions(options);
	}
}
