import fs from "node:fs";
import path from "node:path";

// Load en.json and flatten keys
const en = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
const flatten = (obj, prefix = "") => {
	return Object.entries(obj).flatMap(([k, v]) => {
		const key = prefix ? `${prefix}.${k}` : k;
		return v && typeof v === "object" && !Array.isArray(v)
			? flatten(v, key)
			: [key];
	});
};
const enKeys = new Set(flatten(en));

// Scan all JS and HTML files
const files = [];
const walk = (dir) => {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name.startsWith(".")) continue;
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (["packs", "foundry", "node_modules", "scripts"].includes(ent.name))
				continue;
			walk(full);
		} else if ([".js", ".html"].includes(path.extname(ent.name))) {
			files.push(full);
		}
	}
};
walk(".");

// Extract localization keys from files with locations
const keyUsage = new Map(); // key -> [{file, line}]
const dynamicVarSites = []; // {file, line} — localize(varname) where the key is fully dynamic
const hardcodedPlaceholders = []; // {file, line, value}
for (const file of files) {
	const txt = fs.readFileSync(file, "utf8");
	const lines = txt.split("\n");

	lines.forEach((line, idx) => {
		// Match various literal-key localization patterns.
		// `localize` matches both the imported function and `t` alias (since
		// the alias is established via `import { localize as t }`); we match
		// both call names explicitly below.
		const patterns = [
			// JS: localize("KEY") / t("KEY") / game.i18n.localize("KEY") / game.i18n.format("KEY", ...)
			/(?:^|[^\w.])(?:t|localize)\s*\(\s*["']([^"']+)["']/g,
			/i18n\.(?:localize|format)\s*\(\s*["']([^"']+)["']/g,
			// Handlebars: {{localize "KEY"}}
			/\{\{localize\s+["']([^"']+)["']/g,
			// Quoted full keys in JS: "LITM.X.Y", "LITM.X.Y.Z", "TYPES.Actor.hero", etc.
			/["'`]((?:LITM|TYPES)\.[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)["'`]/g,
		];

		for (const pattern of patterns) {
			for (const m of line.matchAll(pattern)) {
				const key = m[1];
				if (!keyUsage.has(key)) keyUsage.set(key, []);
				keyUsage
					.get(key)
					.push({ file: file.replace(process.cwd() + "/", ""), line: idx + 1 });
			}
		}

		// Flag hardcoded placeholder attributes in templates.
		// Empty placeholders (placeholder="") are intentional no-ops, not localization gaps.
		const placeholderPatterns = [
			/placeholder\s*=\s*"([^"]+)"/g,
			/placeholder\s*=\s*'([^']+)'/g,
		];
		for (const pattern of placeholderPatterns) {
			for (const m of line.matchAll(pattern)) {
				const value = m[1].trim();
				if (!value) continue;
				if (value.includes("{{")) continue;
				hardcodedPlaceholders.push({
					file: file.replace(process.cwd() + "/", ""),
					line: idx + 1,
					value,
				});
			}
		}

		// Fully-dynamic localize: `{{localize varname}}` or `{{localize obj.prop}}`,
		// `localize(varname)` / `t(varname)`. We can't know which keys are used,
		// so just remember that there's an unrecoverable dynamic call site.
		const fullyDynamicPatterns = [
			/\{\{localize\s+([a-zA-Z_][\w.]*)\s*\}\}/g, // {{localize foo}} / {{localize foo.bar}}
			/(?:^|[^\w.])(?:t|localize)\s*\(\s*([a-zA-Z_][\w.]*)\s*[,)]/g, // t(foo)/localize(foo)
		];
		for (const pattern of fullyDynamicPatterns) {
			for (const m of line.matchAll(pattern)) {
				// Skip if the "variable" is actually a string literal helper name
				// like "concat", "lookup", "format" — those are paren-call openers
				// caught by other patterns.
				const name = m[1];
				if (["concat", "lookup", "format"].includes(name)) continue;
				dynamicVarSites.push({
					file: file.replace(process.cwd() + "/", ""),
					line: idx + 1,
					expr: name,
				});
			}
		}
	});

	// Dynamic prefix+suffix patterns — run against the whole file text so we
	// catch multi-line template literals like:
	//   game.i18n.localize(`LITM.Ui.${
	//     cond ? "switch_to_play_mode" : "switch_to_edit_mode"
	//   }`);
	const fullText = txt;
	const dynamicPatterns = [
		// {{localize (concat "PREFIX" var "SUFFIX" ...)}} — capture prefix + optional suffix
		/\{\{localize\s+\(concat\s+["']([^"']+)["'](?:\s+[\w.[\]]+(?:\s+["']([^"']+)["'])?)?/g,
		// localize(`PREFIX.${...}SUFFIX`) / t(`PREFIX.${...}SUFFIX`)
		/(?:^|[^\w.])(?:t|localize)\s*\(\s*`([^`$]+)\$\{[\s\S]+?\}([^`]*)`/g,
		// i18n.localize(`PREFIX.${...}SUFFIX`) / i18n.format(`PREFIX.${...}SUFFIX`)
		/i18n\.(?:localize|format)\s*\(\s*`([^`$]+)\$\{[\s\S]+?\}([^`]*)`/g,
	];
	for (const pattern of dynamicPatterns) {
		for (const m of fullText.matchAll(pattern)) {
			const prefix = m[1];
			const suffix = m[2] || "";
			const marker = `${prefix}\x00${suffix}`;
			if (!keyUsage.has(marker)) keyUsage.set(marker, []);
			keyUsage.get(marker).push({
				file: file.replace(process.cwd() + "/", ""),
				line: fullText.slice(0, m.index).split("\n").length,
				dynamic: true,
			});
		}
	}
}

// Separate literal-key uses from dynamic prefix+suffix markers.
const allMarkers = [...keyUsage.keys()];
const literalReferences = allMarkers.filter((k) => !k.includes("\x00"));
const dynamicTuples = allMarkers
	.filter((k) => k.includes("\x00"))
	.map((k) => {
		const [prefix, suffix] = k.split("\x00");
		return { prefix, suffix };
	});

const allReferencedKeys = literalReferences
	.filter((k) => k !== "KEY") // ignore the regex example string
	.filter((k) => k !== "PREFIX.")
	.filter((k) => !k.endsWith("_")) // ignore incomplete dynamic keys
	.filter((k) => !(k.endsWith(".") && k.startsWith("LITM."))); // ignore dynamic prefixes

// Only flag missing keys under our own namespace — Foundry core keys like
// "Configure", "TOKEN.Title", "JOURNAL.*" are provided by Foundry, not our en.json.
const isOurKey = (k) => k.startsWith("LITM.") || k.startsWith("TYPES.");
const missing = allReferencedKeys
	.filter(isOurKey)
	.filter((k) => !enKeys.has(k))
	.sort();

// Find superfluous keys (in en.json but not used)
const usedKeys = new Set(allReferencedKeys);

// Add keys that match a dynamic prefix+suffix tuple
for (const key of enKeys) {
	// TYPES.* are used by Foundry core
	if (key.startsWith("TYPES.")) {
		usedKeys.add(key);
		continue;
	}

	// Top-level bare keys (no dot) are usually string-table targets for fully-
	// dynamic `{{localize outcome.label}}`-style call sites. When such sites
	// exist we can't statically resolve which keys they reach, so exempt them.
	if (!key.includes(".") && dynamicVarSites.length > 0) {
		usedKeys.add(key);
		continue;
	}

	for (const { prefix, suffix } of dynamicTuples) {
		if (!key.startsWith(prefix)) continue;
		if (suffix && !key.endsWith(suffix)) continue;
		// Reject if the middle portion is empty (e.g. prefix="LITM.X.foo_" suffix=""
		// shouldn't claim "LITM.X.foo_" itself; the variable always supplies content).
		const middle = key.slice(prefix.length, key.length - suffix.length);
		if (!middle) continue;
		usedKeys.add(key);
		break;
	}
}

const superfluous = [...enKeys].filter((k) => !usedKeys.has(k)).sort();

console.log(`\n=== Localization Key Validation ===`);
console.log(`Total keys in en.json: ${enKeys.size}`);
console.log(`Total keys referenced: ${allReferencedKeys.length}`);
console.log(`Missing keys: ${missing.length}`);
console.log(`Superfluous keys: ${superfluous.length}\n`);

if (hardcodedPlaceholders.length > 0) {
	console.log("⚠️  Hardcoded placeholder strings found:\n");
	for (const entry of hardcodedPlaceholders) {
		console.log(`  ${entry.file}:${entry.line} -> ${entry.value}`);
	}
	console.log("");
}

if (missing.length > 0) {
	console.log("❌ Keys referenced in code but not found in en.json:\n");
	for (const k of missing) {
		console.log(`  ${k}`);
		const locations = keyUsage.get(k) || [];
		for (const loc of locations) console.log(`    ${loc.file}:${loc.line}`);
	}
	console.log("");
}

if (superfluous.length > 0) {
	console.log("⚠️  Keys in en.json but not used anywhere:\n");
	for (const k of superfluous) console.log(`  - ${k}`);
	console.log("");
}

if (dynamicVarSites.length > 0) {
	console.log(
		`ℹ️  ${dynamicVarSites.length} fully-dynamic localize call site(s) — key is a runtime variable, so the superfluous-key check cannot see them. Review these manually:\n`,
	);
	for (const site of dynamicVarSites) {
		console.log(`  ${site.file}:${site.line} — localize(${site.expr})`);
	}
	console.log("");
}

if (
	missing.length === 0 &&
	superfluous.length === 0 &&
	hardcodedPlaceholders.length === 0
) {
	console.log("✓ All localization keys are valid and used");
} else if (missing.length === 0) {
	console.log("✓ All referenced keys are present in en.json");
}

if (
	missing.length > 0 ||
	hardcodedPlaceholders.length > 0 ||
	superfluous.length > 0
) {
	process.exitCode = 1;
}
