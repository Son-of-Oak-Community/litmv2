import { renderChallenge } from "./renderers/challenge-renderer.js";
import { renderHero } from "./renderers/hero-renderer.js";
import { renderJourney } from "./renderers/journey-renderer.js";
import { renderTheme } from "./renderers/theme-renderer.js";
import { renderThemebook } from "./renderers/themebook-renderer.js";
import { renderTrope } from "./renderers/trope-renderer.js";
import { renderVignette } from "./renderers/vignette-renderer.js";

const RENDERERS = {
	vignette: renderVignette,
	challenge: renderChallenge,
	hero: renderHero,
	journey: renderJourney,
	theme: renderTheme,
	themebook: renderThemebook,
	trope: renderTrope,
};

export class Enrichers {
	static register() {
		Enrichers.#enrichRender();
		Enrichers.#enrichBold();
		Enrichers.#enrichMight();
		Enrichers.#enrichBanner();
		Enrichers.#enrichSceneLinks();
		// Note that this one has to go last for now
		Enrichers.#enrichTags();
		Enrichers.#registerInserts();
	}

	static #esc(str) {
		return foundry.utils.escapeHTML(str);
	}

	static #html(string) {
		const t = document.createElement("template");
		t.innerHTML = string.trim();
		return t.content.firstChild;
	}

	static #enrichRender() {
		CONFIG.TextEditor.enrichers.push({
			id: "litm.render",
			pattern: /@render\[([^\]]+)\]/gi,
			enricher: async ([text, uuid]) => {
				try {
					const doc = await foundry.utils.fromUuid(uuid);
					if (!doc) return document.createTextNode(text);

					const type = doc.type ?? doc.documentName;
					const renderer = RENDERERS[type];
					if (!renderer) return doc.toAnchor();

					return await renderer(doc);
				} catch (err) {
					Hooks.onError(
						"litmv2.enrichRender",
						err instanceof Error ? err : new Error(String(err), { cause: err }),
						{
							msg: `[litmv2] @render[${uuid}] failed`,
							log: "warn",
							notify: null,
						},
					);
					return document.createTextNode(text);
				}
			},
		});
	}

	static #enrichBold() {
		CONFIG.TextEditor.enrichers.push({
			id: "litm.bold",
			pattern: /\*\*([^*]+)\*\*/g,
			enricher: ([_text, content]) =>
				Enrichers.#html(`<strong>${Enrichers.#esc(content)}</strong>`),
		});
	}

	static #enrichMight() {
		const mights = new Set(["origin", "adventure", "greatness"]);
		CONFIG.TextEditor.enrichers.push({
			id: "litm.might",
			pattern: /@might\[(\w+)\]/gi,
			enricher: ([text, might]) => {
				const key = might.toLowerCase();
				if (!mights.has(key)) return document.createTextNode(text);
				return Enrichers.#html(
					`<img class="litm--might-icon" src="systems/litmv2/assets/media/icons/${key}.svg" alt="${
						Enrichers.#esc(
							key,
						)
					}" />`,
				);
			},
		});
	}

	static #enrichBanner() {
		CONFIG.TextEditor.enrichers.push({
			id: "litm.banner",
			pattern: /@banner\[([^\]]+)\]/gi,
			enricher: ([_text, content]) =>
				Enrichers.#html(
					`<span class="litm-banner">${Enrichers.#esc(content)}</span>`,
				),
		});
	}

	static #enrichSceneLinks() {
		const enrichSceneLinks = ([text, sceneId, flavour]) => {
			const id = sceneId.replace(/^Scene./, "");

			const scene = game.scenes.get(id) || game.scenes.getName(id);
			if (!scene) return document.createTextNode(text);

			const label = Enrichers.#esc(flavour || scene.navName);
			return Enrichers.#html(
				`<a class="content-link" draggable="true" data-uuid="Scene.${scene._id}" data-id="${scene._id}" data-type="ActivateScene" data-tooltip="Scene"><i class="far fa-map"></i>${label}</a>`,
			);
		};
		CONFIG.TextEditor.enrichers.push({
			id: "litm.sceneLink",
			pattern: CONFIG.litmv2.sceneLinkRe,
			enricher: enrichSceneLinks,
		});
	}

	static #registerInserts() {
		if (!CONFIG.TextEditor.inserts) return;
		CONFIG.TextEditor.inserts.push({
			action: "litm-ingress",
			title: "LITM.Editor.ingress",
			inline: true,
			html: '<span class="litm--ingress"><selection></selection></span>',
		});
	}

	static #enrichTags() {
		const tooltip = game.i18n.localize("LITM.Ui.drag_apply");
		const esc = Enrichers.#esc;
		const enrichTags = ([_text, name, separator, value]) => {
			// Limits: new [name:N] syntax or old [-name] syntax
			if (separator === ":" || name.startsWith("-")) {
				const clean = name.replace(/^-/, "");
				const valueHtml = value
					? `<img src="systems/litmv2/assets/media/icons/limit.svg"
							style="height:1.4em;width:1.4em;position:absolute;right:-0.5em;top:-0.05em;z-index:-1;" /> <span
							style="font-style:normal;font-size:inherit;font-weight:600;color:var(--color-light-2);position:relative;top:-0.13em;right:-0.1em;">${
						esc(
							value,
						)
					}</span>`
					: "";
				return Enrichers.#html(
					`<span class="litm-limit" data-text="${
						esc(
							clean,
						)
					}" data-tooltip="${tooltip}" draggable="true">${
						esc(
							clean,
						)
					}${valueHtml}</span>`,
				);
			}
			// Statuses: [name-N] or [name-]
			if (separator === "-") {
				const cleanStatus = value ? `-${value}` : "";
				return Enrichers.#html(
					`<span class="litm-status" draggable="true" data-tooltip="${tooltip}" data-text="${
						esc(
							name,
						)
					}${esc(cleanStatus)}">${esc(name)}${esc(cleanStatus)}</span>`,
				);
			}
			// Plain tags: [name]
			return Enrichers.#html(
				`<span class="litm-tag" draggable="true" data-tooltip="${tooltip}" data-text="${
					esc(
						name,
					)
				}">${esc(name)}</span>`,
			);
		};
		CONFIG.TextEditor.enrichers.push({
			id: "litm.tag",
			pattern: CONFIG.litmv2.tagStringRe,
			enricher: enrichTags,
		});
	}
}
