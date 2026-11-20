const { DialogV2 } = foundry.applications.api;

/**
 * The hero's notes window. A long note must not vanish on one stray Escape:
 * closing with unsaved changes asks first, and the editor's own save (its
 * button, Ctrl+S) saves the dialog rather than doing nothing.
 */
export class NotesDialog extends DialogV2 {
	/** The note as the editor first read it; edited means it differs from this. */
	#initial = null;

	/** Set once the window is on its way out, by save or by a confirmed discard. */
	#closing = false;

	/** The discard question is up; a second Escape doesn't ask twice. */
	#asking = false;

	get #editor() {
		return this.element?.querySelector("prose-mirror");
	}

	/** Whether the note's text changed since the window opened. (The editor's
	 * own `isDirty` turns true on a mere click, so it can't be the test.) */
	get isDirty() {
		return this.#initial !== null && this.#editor?.value !== this.#initial;
	}

	/** @override */
	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);
		const editor = this.#editor;
		if (!editor) return;
		// The editor starts after the first render and may rewrite the stored
		// HTML as it reads it, so the baseline is its first own value.
		const baseline = () => (this.#initial ??= editor.value);
		if (editor.classList.contains("active")) baseline();
		else editor.addEventListener("open", baseline, { once: true });
		// Closing also fires the editor's save (as it leaves the page): only a
		// save asked for while the window is open submits it.
		editor.addEventListener("save", (event) => {
			if (this.#closing) return;
			event.preventDefault();
			this.element.querySelector("button[data-action='ok']")?.click();
		});
	}

	/** @override */
	async close(options = {}) {
		if (!options.submitted && !this.#closing && this.isDirty) {
			if (this.#asking) return this;
			this.#asking = true;
			const discard = await DialogV2.confirm({
				window: { title: game.i18n.localize("LITM.Ui.notes_discard_title") },
				// Above the notes window, which otherwise covers it.
				modal: true,
				content: `<p>${game.i18n.localize("LITM.Ui.notes_discard")}</p>`,
				rejectClose: false,
			});
			this.#asking = false;
			if (!discard) return this;
		}
		this.#closing = true;
		return super.close(options);
	}
}
