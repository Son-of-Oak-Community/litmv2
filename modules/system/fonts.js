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
		FontConfig.loadFont("Uncial Antiqua", {
			editor: true,
			fonts: [
				{
					name: "Uncial Antiqua",
					urls: ["systems/litmv2/assets/fonts/uncial-antiqua.ttf"],
				},
			],
		});
		FontConfig.loadFont("Grenze", {
			editor: true,
			fonts: [
				{
					name: "Grenze",
					urls: ["systems/litmv2/assets/fonts/grenze.ttf"],
				},
				{
					name: "Grenze",
					urls: ["systems/litmv2/assets/fonts/grenze-b.ttf"],
					weight: "bold",
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
		FontConfig.loadFont("Caveat", {
			editor: true,
			fonts: [
				{
					name: "Caveat",
					urls: ["systems/litmv2/assets/fonts/caveat.ttf"],
				},
				{
					name: "Caveat",
					urls: ["systems/litmv2/assets/fonts/caveat-b.ttf"],
					weight: "bold",
				},
			],
		});
		FontConfig.loadFont("Caveat Brush", {
			editor: true,
			fonts: [
				{
					name: "Caveat Brush",
					urls: ["systems/litmv2/assets/fonts/caveat-brush.ttf"],
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
