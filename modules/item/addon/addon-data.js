export class AddonData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			ratingBonus: new fields.NumberField({
				required: true,
				initial: 1,
				min: 0,
				integer: true,
			}),
			categories: new fields.ArrayField(
				new fields.StringField({ required: true, nullable: false }),
				{ initial: () => [] },
			),
			description: new fields.HTMLField({ initial: "" }),
			specialFeatures: new fields.HTMLField({ initial: "" }),
			tags: new fields.StringField({ initial: "" }),
			limits: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						initial: () => foundry.utils.randomID(),
					}),
					label: new fields.StringField({ initial: "" }),
					outcome: new fields.StringField({ initial: "" }),
					max: new fields.NumberField({ initial: 3, min: 0, integer: true }),
					value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
					// On a Challenge the addon's limit is tracked like the Challenge's
					// own, and its state is kept here (see ChallengeData#allLimits).
					advanced: new fields.NumberField({ initial: 0, integer: true }),
					hidden: new fields.BooleanField({ initial: true }),
				}),
				{ initial: () => [] },
			),
			might: new fields.ArrayField(
				new fields.SchemaField({
					level: new fields.StringField({
						initial: "adventure",
						choices: ["adventure", "greatness"],
					}),
					description: new fields.StringField({ initial: "" }),
				}),
				{ initial: () => [] },
			),
			threats: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField({ initial: "" }),
					threat: new fields.StringField({ initial: "" }),
					consequences: new fields.ArrayField(
						new fields.StringField({ required: false, nullable: false }),
						{ initial: () => [] },
					),
					isConsequenceOnly: new fields.BooleanField({ initial: false }),
				}),
				{ initial: () => [] },
			),
			sourceId: new fields.StringField({ initial: "" }),
		};
	}
}
