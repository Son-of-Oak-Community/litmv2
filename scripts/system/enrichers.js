import { sendRollRequest } from "../apps/roll-request.js";
import { renderAction } from "./renderers/action-renderer.js";
import { renderChallenge } from "./renderers/challenge-renderer.js";
import { renderHero } from "./renderers/hero-renderer.js";
import { renderJourney } from "./renderers/journey-renderer.js";
import { renderTheme } from "./renderers/theme-renderer.js";
import { renderThemebook } from "./renderers/themebook-renderer.js";
import { renderTrope } from "./renderers/trope-renderer.js";
import { renderVignette } from "./renderers/vignette-renderer.js";

const RENDERERS = {
	action: renderAction,
	vignette: renderVignette,
	challenge: renderChallenge,
	hero: renderHero,
	journey: renderJourney,
	theme: renderTheme,
	themebook: renderThemebook,
	trope: renderTrope,
};

function _actionAnchor(uuid, display, esc) {
	const t = document.createElement("template");
	t.innerHTML = `<a class="content-link litm--action-link" draggable="true" data-uuid="${uuid}" data-type="Item" data-tooltip="LITM.Actions.open_action"><i class="fa-solid fa-scroll"></i> ${esc(display)}</a>`;
	return t.content.firstChild;
}

let _actionLookup = null;

function _invalidateActionLookup(doc) {
	if (doc && doc.documentName === "Item" && doc.type !== "action") return;
	_actionLookup = null;
}

async function _buildActionLookup() {
	const map = new Map();
	for (const it of game.items?.contents ?? []) {
		if (it.type !== "action") continue;
		const k = it.name?.toLowerCase();
		if (k && !map.has(k)) map.set(k, it.uuid);
	}
	const packs = game.packs?.filter((p) => p.documentName === "Item") ?? [];
	for (const pack of packs) {
		try {
			const index = await pack.getIndex({ fields: ["type", "name"] });
			for (const e of index) {
				if (e.type !== "action") continue;
				const k = e.name?.toLowerCase();
				if (!k || map.has(k)) continue;
				map.set(k, `Compendium.${pack.collection}.Item.${e._id}`);
			}
		} catch { /* skip pack on error */ }
	}
	return map;
}

async function _resolveActionUuid(name) {
	if (!_actionLookup) _actionLookup = await _buildActionLookup();
	return _actionLookup.get(name.toLowerCase()) ?? null;
}

// Body-level delegated handlers for @render embed cards. The enriched card is
// inserted into chat/journal/sheet HTML as a serialized string, so any DOM
// listener attached at enrich time would be discarded — delegation is the
// only path that survives.
const RENDER_ACTIONS = {
	"open-sheet": async (target) => {
		const doc = await foundry.utils.fromUuid(target.dataset.uuid);
		doc?.sheet?.render(true);
	},
	"send-roll-request": async (target) => {
		if (!game.user.isGM) return;
		const action = await foundry.utils.fromUuid(target.dataset.uuid);
		if (action?.type === "action") await sendRollRequest({ action });
	},
};

async function _onRenderCardActivate(event) {
	const target = event.target.closest("[data-render-action]");
	if (!target) return;
	const handler = RENDER_ACTIONS[target.dataset.renderAction];
	if (!handler) return;
	event.preventDefault();
	event.stopPropagation();
	await handler(target);
}

function _onRenderCardKeydown(event) {
	if (event.key !== "Enter" && event.key !== " ") return;
	if (!event.target.closest?.("[data-render-action]")) return;
	_onRenderCardActivate(event);
}

export class Enrichers {
	static register() {
		Enrichers.#enrichRender();
		Enrichers.#enrichBold();
		Enrichers.#enrichMight();
		Enrichers.#enrichBanner();
		Enrichers.#enrichSceneLinks();
		Enrichers.#enrichAction();
		// Note that this one has to go last for now
		Enrichers.#enrichTags();
		Enrichers.#registerInserts();

		document.body.addEventListener("click", _onRenderCardActivate);
		document.body.addEventListener("keydown", _onRenderCardKeydown);

		// Invalidate the @action[] lookup cache when world or pack contents
		// change. Compendium edits to existing packs fire createItem/deleteItem/
		// updateItem on the embedded document. (No equivalent hook exists for
		// whole-pack add/remove; those are rare mid-session and a reload is fine.)
		Hooks.on("createItem", _invalidateActionLookup);
		Hooks.on("deleteItem", _invalidateActionLookup);
		Hooks.on("updateItem", _invalidateActionLookup);
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
					`<img class="litm--might-icon" src="systems/litmv2/assets/media/icons/${key}.svg" alt="${Enrichers.#esc(
						key,
					)}" />`,
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

	static #enrichAction() {
		const esc = Enrichers.#esc;
		// Pattern: @action[Name] or @action[Name|alt label]
		CONFIG.TextEditor.enrichers.push({
			id: "litm.action",
			pattern: /@action\[([^\]|]+)(?:\|([^\]]+))?\]/gi,
			enricher: async ([text, name, label]) => {
				const trimmed = name.trim();
				const display = (label || trimmed).trim();
				const uuid = await _resolveActionUuid(trimmed);
				if (uuid) return _actionAnchor(uuid, display, esc);
				return document.createTextNode(text);
			},
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
							style="font-style:normal;font-size:inherit;font-weight:600;color:var(--color-light-2);position:relative;top:-0.13em;right:-0.1em;">${esc(
								value,
							)}</span>`
					: "";
				return Enrichers.#html(
					`<span class="litm-limit" data-text="${esc(
						clean,
					)}" data-tooltip="${tooltip}" draggable="true">${esc(
						clean,
					)}${valueHtml}</span>`,
				);
			}
			// Statuses: [name-N] or [name-]
			if (separator === "-") {
				const cleanStatus = value ? `-${value}` : "";
				return Enrichers.#html(
					`<span class="litm-status" draggable="true" data-tooltip="${tooltip}" data-text="${esc(
						name,
					)}${esc(cleanStatus)}">${esc(name)}${esc(cleanStatus)}</span>`,
				);
			}
			// Plain tags: [name]
			return Enrichers.#html(
				`<span class="litm-tag" draggable="true" data-tooltip="${tooltip}" data-text="${esc(
					name,
				)}">${esc(name)}</span>`,
			);
		};
		CONFIG.TextEditor.enrichers.push({
			id: "litm.tag",
			pattern: CONFIG.litmv2.tagStringRe,
			enricher: enrichTags,
		});
	}
}
