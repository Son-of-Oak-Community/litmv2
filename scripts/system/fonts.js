import { info } from "../logger.js";

export class Fonts {
	static register() {
		info("Registering Fonts...");
		const { FontConfig } = foundry.applications.settings.menus;
		FontConfig.loadFont("LitM Dice", {
			fonts: [
				{
					name: "LitM Dice",
					urls: ["systems/litmv2/assets/fonts/litm-dice.otf"],
				},
			],
		});
		FontConfig.loadFont("Norse Bold", {
			editor: true,
			fonts: [
				{
					name: "Norse Bold",
					urls: ["systems/litmv2/assets/fonts/norse-b.otf"],
				},
			],
			weight: "bold",
		});
		FontConfig.loadFont("Ysgarth", {
			editor: true,
			fonts: [
				{
					name: "Ysgarth",
					urls: ["systems/litmv2/assets/fonts/ysgarth.ttf"],
				},
			],
		});
		FontConfig.loadFont("CaslonAntique", {
			editor: true,
			fonts: [
				{
					name: "CaslonAntique",
					urls: ["systems/litmv2/assets/fonts/caslon.ttf"],
					sizeAdjust: "120%",
				},
				{
					name: "CaslonAntique",
					urls: ["systems/litmv2/assets/fonts/caslon-b.ttf"],
					weight: "bold",
					sizeAdjust: "120%",
				},
				{
					name: "CaslonAntique",
					urls: ["systems/litmv2/assets/fonts/caslon-i.ttf"],
					style: "italic",
					sizeAdjust: "120%",
				},
			],
		});
		FontConfig.loadFont("Germania One", {
			editor: true,
			fonts: [
				{
					name: "Germania One",
					urls: ["systems/litmv2/assets/fonts/germania-one.ttf"],
				},
			],
		});
		FontConfig.loadFont("Luminari", {
			editor: true,
			fonts: [
				{
					name: "Luminari",
					urls: ["systems/litmv2/assets/fonts/luminari.ttf"],
					sizeAdjust: "90%",
				},
			],
		});
		FontConfig.loadFont("Trattatello", {
			editor: true,
			fonts: [
				{
					name: "Trattatello",
					urls: ["systems/litmv2/assets/fonts/trattatello.ttf"],
				},
			],
		});
		FontConfig.loadFont("STFU", {
			editor: true,
			fonts: [
				{
					name: "STFU",
					urls: ["systems/litmv2/assets/fonts/stfu.woff"],
				},
			],
		});
		FontConfig.loadFont("LuxuriousRoman", {
			editor: true,
			fonts: [
				{
					name: "LuxuriousRoman",
					urls: ["systems/litmv2/assets/fonts/luxurious-roman.ttf"],
				},
			],
		});
		FontConfig.loadFont("Fraunces", {
			editor: true,
			fonts: [
				{
					name: "Fraunces",
					urls: ["systems/litmv2/assets/fonts/fraunces.ttf"],
					weight: "300 800",
				},
				{
					name: "Fraunces",
					urls: ["systems/litmv2/assets/fonts/fraunces-i.ttf"],
					style: "italic",
					weight: "300 800",
				},
			],
		});
		FontConfig.loadFont("Labrada", {
			editor: true,
			fonts: [
				{
					name: "Labrada",
					urls: ["systems/litmv2/assets/fonts/labrada.ttf"],
					weight: "100 900",
					ascentOverride: "80%",
				},
				{
					name: "Labrada",
					urls: ["systems/litmv2/assets/fonts/labrada-i.ttf"],
					style: "italic",
					weight: "100 900",
					ascentOverride: "80%",
				},
			],
		});
		FontConfig.loadFont("AlchemyItalic", {
			editor: true,
			fonts: [
				{
					name: "AlchemyItalic",
					urls: ["systems/litmv2/assets/fonts/alchemy-i.ttf"],
				},
			],
		});
		FontConfig.loadFont("PackardAntique", {
			editor: true,
			fonts: [
				{
					name: "PackardAntique",
					urls: ["systems/litmv2/assets/fonts/packard.ttf"],
				},
				{
					name: "PackardAntique",
					urls: ["systems/litmv2/assets/fonts/packard-b.ttf"],
					weight: "bold",
				},
			],
		});
		FontConfig.loadFont("PowellAntique", {
			editor: true,
			fonts: [
				{
					name: "PowellAntique",
					urls: ["systems/litmv2/assets/fonts/powell.ttf"],
				},
				{
					name: "PowellAntique",
					urls: ["systems/litmv2/assets/fonts/powell-b.ttf"],
					weight: "bold",
				},
			],
		});
	}
}
