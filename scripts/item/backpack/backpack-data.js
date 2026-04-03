export class BackpackData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		return {};
	}

	static migrateData(source) {
		// Legacy contents field is ignored by the schema — no action needed.
		// Migration v1 in migrations.js handles converting contents to effects.
		return super.migrateData(source);
	}

	/** All story_tag effects on this backpack item. */
	get tags() {
		return this.parent.effects
			.filter((e) => e.type === "story_tag");
	}

	/** Active, non-scratched tags. */
	get activeTags() {
		return this.tags.filter((e) => e.active);
	}
}
