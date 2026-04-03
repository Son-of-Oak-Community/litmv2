/**
 * Generate compendium pack source files for the litmv2 system.
 * Run with: node scripts/system/build-packs.js
 *
 * This creates JSON source files in packs/<pack>/_source/ which can be
 * compiled into LevelDB packs using: fvtt package pack <name>
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = join(import.meta.dirname, "..", "..");
const PACKS = join(ROOT, "packs");

function id() {
	return randomUUID().replace(/-/g, "").slice(0, 16);
}

function statusCard(name, tier = 1) {
	const tiers = [false, false, false, false, false, false];
	for (let i = 0; i < Math.min(tier, 6); i++) tiers[i] = true;
	const _id = id();
	return {
		_id,
		_key: `!effects!${_id}`,
		name,
		type: "status_tag",
		img: "systems/litmv2/assets/media/icons/consequences.svg",
		disabled: false,
		showIcon: 2, // ALWAYS
		system: {
			isHidden: false,
			tiers,
			limitId: null,
		},
	};
}

// Common consequences from the Action Grimoire
const statuses = [
	// Battle
	"wounded",
	"prone",
	"off-balance",
	"distracted",
	"surprised",
	"exposed",
	"cornered",
	"restrained",
	"knocked-back",
	// Magic
	"drained",
	"cursed",
	// Social
	"scared",
	"angered",
	"charmed",
	"convinced",
	"embarrassed",
	"indebted",
	"intoxicated",
	// Travel & Survival
	"exhausted",
	"poisoned",
	"hungry",
	"thirsty",
	"lost",
	"sickened",
	"frostbite",
	"sunburned",
	// General
	"panicked",
	"confused",
	"blinded",
	"marked",
];

const dir = join(PACKS, "status-effects", "_source");
mkdirSync(dir, { recursive: true });

for (const name of statuses) {
	const data = statusCard(name);
	const filename = `${name}_${data._id}.json`;
	writeFileSync(join(dir, filename), JSON.stringify(data, null, "\t") + "\n");
}

console.log(`Created ${statuses.length} status card source files in ${dir}`);
