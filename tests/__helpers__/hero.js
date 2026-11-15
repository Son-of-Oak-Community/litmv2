// A HeroData attached to a fake hero actor, for the tests of its getters and
// writers.
//
// The stub base constructor only does Object.assign(this, source) and the
// real schema is not enforced, so each test seeds the fields the method under
// test reads, as plain properties.

import { HeroData } from "../../modules/actor/hero/hero-data.js";
import { fakeActor } from "./factories.js";

/**
 * @param {object} [options]
 * @param {object} [options.actor]  Options for `fakeActor` (items, effects, ...).
 * @param {...any} [options.fields]  Properties to seed on the model.
 * @returns {{ model: HeroData, actor: object }}
 */
export function fakeHeroModel({ actor: actorOptions = {}, ...fields } = {}) {
	const actor = fakeActor({ type: "hero", ...actorOptions });
	const model = new HeroData();
	model.parent = actor;
	Object.assign(model, fields);
	return { model, actor };
}
