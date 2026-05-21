const ROOT_CLASS = "litm--sacrifice-rite";
const VISIBLE_CLASS = "is-visible";

// Total runtime ≈ 5.2s. The hush should be felt — long enough for the table
// to lean back from the screen, short enough not to overstay.
const FADE_IN_MS = 900;
const HOLD_MS = 3500;
const FADE_OUT_MS = 800;

/**
 * Announce that another character is preparing a Sacrifice. The banner is
 * not a notification: it's an inscription on the table. A faint vignette
 * darkens the periphery; a horizontal ink wash settles across the upper
 * third of the screen, bleeding at its edges; a single line of blackletter
 * — flanked by extending rules — appears within it. After a held beat,
 * the world resumes.
 *
 * Motion is opacity-only and gated on `prefers-reduced-motion`. Z-index
 * tracks Foundry's running window stack so the rite floats above any open
 * Application windows.
 */
export function showSacrificeBanner(characterName) {
	document.querySelector(`.${ROOT_CLASS}`)?.remove();

	const root = document.createElement("div");
	root.className = ROOT_CLASS;
	root.setAttribute("role", "status");
	root.setAttribute("aria-live", "polite");

	const AV2 = foundry.applications.api.ApplicationV2;
	root.style.zIndex = String((AV2?._maxZ ?? 100) + 1);

	const scrim = document.createElement("div");
	scrim.className = `${ROOT_CLASS}__scrim`;

	const inscription = document.createElement("div");
	inscription.className = `${ROOT_CLASS}__inscription`;

	const ruleStart = document.createElement("span");
	ruleStart.className = `${ROOT_CLASS}__rule`;
	ruleStart.setAttribute("aria-hidden", "true");

	const text = document.createElement("span");
	text.className = `${ROOT_CLASS}__text`;
	text.textContent = game.i18n.format("LITM.Ui.sacrifice_banner_message", {
		name: characterName,
	});

	const ruleEnd = document.createElement("span");
	ruleEnd.className = `${ROOT_CLASS}__rule`;
	ruleEnd.setAttribute("aria-hidden", "true");

	inscription.append(ruleStart, text, ruleEnd);
	scrim.appendChild(inscription);
	root.appendChild(scrim);
	document.body.appendChild(root);

	requestAnimationFrame(() => root.classList.add(VISIBLE_CLASS));

	window.setTimeout(() => {
		root.classList.remove(VISIBLE_CLASS);
		window.setTimeout(() => root.remove(), FADE_OUT_MS);
	}, FADE_IN_MS + HOLD_MS);
}
