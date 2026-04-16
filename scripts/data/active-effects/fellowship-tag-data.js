import { PowerTagData } from "./power-tag-data.js";

export class FellowshipTagData extends PowerTagData {
	get isSingleUse() {
		return true;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive";
	}

	toTagString(name) {
		return `[${name}]`;
	}
}
