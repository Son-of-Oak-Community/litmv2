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

	get playerAllowedStates() {
		// Fellowship tags are single-use and cannot be scratched; players get
		// the same positive-only cycle as the GM. Without this override the
		// inherited PowerTagData getter would let players scratch them, and
		// scratched fellowship tags are silently dropped from the roll.
		return ",positive";
	}

	toTagString(name) {
		return `[${name}]`;
	}
}
