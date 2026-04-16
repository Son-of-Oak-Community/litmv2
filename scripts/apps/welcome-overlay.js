import { error, warn } from "../logger.js";
import { HeroCreationData } from "./hero-creation-data.js";
import { createSampleHero } from "../system/sample-hero.js";
import { LitmSettings } from "../system/settings.js";
import { getThemeLevels, getDefaultThemeLevel } from "../system/config.js";
import { sleep, localize as t, toQuestionOptions } from "../utils.js";

const THEME_SLOTS = 4;

const HERO_NAMES = [
	"Willow",
	"Bear",
	"Heath",
	"Zephyr",
	"Solace",
	"Brave",
	"Felicity",
	"Rowan",
	"Yarrow",
	"Onyx",
	"Bayleaf",
	"Rust",
	"Marrow",
	"Daisy",
	"Bait",
	"Aster",
	"Bramble",
	"Clement",
	"Steadfast",
	"Peregrine",
	"Mila",
	"Tidin",
	"Kahira",
	"Fondo",
	"Thedea",
	"Neilem",
	"Kelda",
	"Nona",
	"Bolb",
	"Eerik",
	"Gofer",
	"Thelma",
	"Jaro",
	"Koral",
	"Noxen",
	"Emille",
	"Hela",
	"Veles",
	"Berglitz",
	"Gilla",
	"Elswith",
	"Laurantadeara",
	"Aleonora",
	"Belladonna",
	"Chrysanthemum",
	"Amalthea",
	"Yelizaveta",
	"Rosamund",
	"Milorada",
	"Azeria",
	"Silverata",
	"Shozauka",
	"Sepheera",
	"Gerrick",
	"Hythalmun",
	"Leyla Tanner",
	"Aurora Beaks",
	"Colin Stillwater",
	"Emeralda Fogley",
	"Karis Hillfell",
	"Arsinia Hawthorne",
	"Eerik Kallop",
	"Hela Grange",
	"Radym Desimir",
	"Veles Hayes",
	"Valen Bertrand",
	"Nessie Tarnfolk",
	"Heather Bellrose",
	"Samuil Flagstone",
	"Killian Farstride",
	"Lance Tubroot",
	"Thedor Cloudborne",
	"Fleece Oakenfoot",
	"Jarko Cooper",
	"Yule the Wood Whisperer",
	"Torben of Ravenhome",
	"Tarn of Milkrest",
	"Froll the Replenisher",
	"Kurri Blackcurrant",
	"Riyori of the Kawa",
	"Nochika",
	"Gild",
	"Maol of the Boar",
	"Ferika of the Vulture",
	"Ethain of the Bear",
	"Thrad Pine-Splitter",
	"Tillis Nebelclaw",
	"Igraine Demerand",
	"Demetria Rosethorne",
	"Dythara Lowtower",
	"Justine Tanner",
	"Ferrox the Flamer",
	"Liliwen Clipped-Wing",
	"Maxin the Laughing One",
	"Worel of Stormhelm",
	"Sidurg the Crafty",
	"Muddy Med",
	"Old Dinger",
	"Stares-to-Horizon",
	"Ear-to-Ground",
	"Cedar",
	"Flint",
	"Moss",
	"Lark",
	"Ash",
	"Sedge",
	"Thistle",
	"Merit",
	"Patience",
	"Verity",
	"Joy",
	"Knot",
	"Etch",
	"Walric Hywell",
	"Darius Pyke",
	"Rosamund Field",
	"Bram Miller",
	"Kaelen Smith",
	"Elra of Underbough",
	"Jarko Hillcrester",
	"Mila Fletcher",
	"Tidin Potter",
	"Kahira Weaver",
	"Olek Scribe",
	"Anika of Pasture",
	"Gavlar Woodsman",
	"Iryna Baker",
	"Lev Mason",
	"Chesna Shepherd",
	"Bogdan Trapper",
	"Liafail Mackross",
	"Azeria Fox",
	"Petor \"Chiselheart\"",
	"Noxen \"Cowtipper\"",
	"\"Amber-Blood\" Hela",
	"\"The Whisperer\" Gilla",
	"\"Steadyoars\" Farkus",
	"\"Greytail\" the Vole",
	"Greycheeks",
	"Cracked Twig",
	"Wake-Runner",
	"Fork-It",
	"\"The Queen\" Heather",
	"Old Soot",
	"The Rimy Beaver",
	"Stone-Carver",
	"Mud-Walker",
	"Honey-Tongue",
	"Silver-Stitch",
	"Crow-Friend",
	"Bramble-Bound",
	"Arkady",
	"Anton",
	"Artyom",
	"Bersha",
	"Katya",
	"Kazimir",
	"Loukiya",
	"Maksym",
	"Mirjana",
	"Nastasya",
	"Rodion",
	"Sameyra",
	"Valadymyr",
	"Yovanka",
	"Eryk",
	"Filipa",
	"Fyodor",
	"Alderman Petor Hillsfar",
	"Wise One Mikhail",
	"Bogatyr Gavlar",
	"Knight-Errant Fosten",
	"Portent Gold-mender",
	"Deda Houlk the Wizened",
	"Risa",
	"Olek",
	"Bogdan",
	"Ziv",
	"Lev",
	"Filipa Volgin",
	"Maksym Kozlov",
	"Maryana Larchok",
	"Olek Pokva",
	"Pelanda Hodzic",
	"Aleksandra Markov",
	"Andrej Todrov",
	"Anton Prokov",
	"Jurik Kodro",
	"Nikalai Lovic",
	"Yulia Shiverborn",
	"Artyom Desimir",
	"Milena Blackcurrant",
	"Kazimir Oakenfoot",
	"Lidia Shiverborn",
	"Yevgeny",
	"Zora",
	"Valescu",
	"\"Broken-Nosed\" Emille",
	"\"The Exact\" Cecile",
	"\"The Drowned\" Vodan",
	"\"The Ratter\" Chet",
	"Alderman Lorne",
	"Chief Aleksandra",
];

const GENERAL_STORE = {
	armor: [
		"buff coat",
		"leather armor",
		"chainmail",
		"buckler",
		"wooden shield",
	],
	weapons: [
		"axe",
		"hunting bow",
		"dirk",
		"shortsword",
		"quarterstaff",
		"slingshot",
	],
	supplies: [
		"bedroll",
		"carving knife",
		"cloth tent",
		"frying pan",
		"repair kit",
		"waterskin",
	],
	clothing: [
		"bracers",
		"cape",
		"gloves",
		"sturdy boots",
		"travel cloak",
		"oilskins",
	],
	medicinal: [
		"antidote",
		"bandages",
		"healing brew",
		"foot ointment",
		"soothing salves",
	],
	personal: [
		"family signet",
		"grandmother's shawl",
		"pipe & tobacco",
		"parchment & ink",
	],
	notes: [
		"funny anecdote",
		"leftover meal recipe",
		"little prayer",
		"strong comeback",
	],
	trinkets: ["good luck charm", "prayer beads", "religious icon", "talisman"],
};

const SLIDE_TEMPLATES = {
	welcome: "systems/litmv2/templates/apps/welcome-overlay/welcome.html",
	modeSelect: "systems/litmv2/templates/apps/welcome-overlay/mode-select.html",
	tropeSelect:
		"systems/litmv2/templates/apps/welcome-overlay/trope-select.html",
	tropeThemes:
		"systems/litmv2/templates/apps/welcome-overlay/trope-themes.html",
	customTheme0:
		"systems/litmv2/templates/apps/welcome-overlay/custom-theme.html",
	customTheme1:
		"systems/litmv2/templates/apps/welcome-overlay/custom-theme.html",
	customTheme2:
		"systems/litmv2/templates/apps/welcome-overlay/custom-theme.html",
	customTheme3:
		"systems/litmv2/templates/apps/welcome-overlay/custom-theme.html",
	customBackpack:
		"systems/litmv2/templates/apps/welcome-overlay/custom-backpack.html",
	review: "systems/litmv2/templates/apps/welcome-overlay/review.html",
	heroCreated:
		"systems/litmv2/templates/apps/welcome-overlay/hero-created.html",
};

export class WelcomeOverlay {
	/** @type {WelcomeOverlay|null} */
	static #instance = null;

	/** @type {HTMLElement|null} */
	#el = null;

	/** @type {Function|null} */
	#onKeyDown = null;

	/** @type {number} */
	#currentSlideIndex = 0;

	/** @type {string[]} */
	#slideFlow = ["welcome"];

	/** @type {boolean} */
	#isAnimating = false;

	/** @type {boolean} */
	#reducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	#slideContextBuilders = {
		welcome: () => this.#prepareWelcomeContext(),
		modeSelect: () => this.#prepareModeSelectContext(),
		tropeSelect: () => this.#prepareTropeSelectContext(),
		tropeThemes: () => this.#prepareTropeThemesContext(),
		customTheme0: () => this.#prepareCustomThemeContext(0),
		customTheme1: () => this.#prepareCustomThemeContext(1),
		customTheme2: () => this.#prepareCustomThemeContext(2),
		customTheme3: () => this.#prepareCustomThemeContext(3),
		customBackpack: () => this.#prepareCustomBackpackContext(),
		review: () => this.#prepareReviewContext(),
		heroCreated: () => this.#prepareHeroCreatedContext(),
	};

	/** @type {string|null} */
	#assignToUser = null;

	_appState = {
		mode: "",
		actorName: "",
		search: { tropes: "", themekits: "", themebooks: "" },
		trope: {
			selectedUuid: "",
			optionalUuid: "",
			backpackChoice: "",
			themes: { index: 0, kitUuids: [], choices: [] },
		},
		custom: {
			themeIndex: 0,
			themes: Array(THEME_SLOTS)
				.fill(null)
				.map(() => ({
					method: "",
					themekitUuid: "",
					themebookUuid: "",
					level: "",
					name: "",
					powerTags: ["", ""],
					powerQuestions: ["", ""],
					weaknessTag: "",
					weaknessQuestion: "",
					quest: "",
					powerTagOptions: [],
					weaknessTagOptions: [],
					selectedPowerTags: [],
					selectedWeaknessTag: "",
					powerTagQuestions: [],
					weaknessTagQuestions: [],
				})),
			backpackTags: ["", "", ""],
			activeStoreCategory: "",
			activeBackpackIndex: 0,
		},
	};

	/** @type {HeroCreationData} */
	_data = new HeroCreationData();

	get _cache() { return this._data._cache; }

	constructor({ assignToUser = null } = {}) {
		this.#assignToUser = assignToUser;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	get currentSlideKey() {
		return this.#slideFlow[this.#currentSlideIndex] ?? "welcome";
	}

	/**
	 * Create the overlay DOM, render the initial slide, and animate in.
	 */
	async show() {
		if (this.#el) return;

		// Singleton guard — dismiss any previous instance
		if (WelcomeOverlay.#instance) {
			await WelcomeOverlay.#instance.dismiss();
		}
		WelcomeOverlay.#instance = this;

		// Preload slide templates
		await foundry.applications.handlebars.loadTemplates(
			Object.values(SLIDE_TEMPLATES),
		);

		this.#el = document.createElement("div");
		this.#el.id = "litm-welcome-overlay";
		this.#el.classList.add("litm", "litm--welcome-overlay", "application");
		this.#el.style.opacity = "0";

		// Background scrim
		const bg = document.createElement("div");
		bg.classList.add("litm--welcome-overlay__bg");
		this.#el.appendChild(bg);

		// Slides container
		const slides = document.createElement("div");
		slides.classList.add("litm--welcome-overlay__slides");
		this.#el.appendChild(slides);

		document.body.appendChild(this.#el);

		// Keydown handler for Escape dismiss and Tab focus trap
		this.#onKeyDown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.dismiss();
				return;
			}
			if (event.key === "Tab") {
				const focusable = [
					...this.#el.querySelectorAll(
						'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
					),
				].filter((el) => !el.disabled && el.offsetParent !== null);
				if (!focusable.length) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			}
		};
		document.addEventListener("keydown", this.#onKeyDown);

		await this.#renderCurrentSlide();
		await this.#animateEnter();
	}

	/**
	 * Animate the overlay out and remove it from the DOM.
	 */
	async dismiss({ skipSampleHero = false } = {}) {
		if (!this.#el || this.#isAnimating) return;

		// Remove keydown listener
		if (this.#onKeyDown) {
			document.removeEventListener("keydown", this.#onKeyDown);
			this.#onKeyDown = null;
		}

		// GM auto-creates sample hero on plain dismiss (not tour start)
		if (!skipSampleHero && game.user.isGM) {
			createSampleHero().catch((err) =>
				warn("Failed to create sample hero", err),
			);
		}

		await this.#animateExit();
		this.#el.remove();
		this.#el = null;
		WelcomeOverlay.#instance = null;
	}

	/**
	 * Advance to the next slide in the flow.
	 */
	async next() {
		if (this.#isAnimating) return;
		if (this.#currentSlideIndex >= this.#slideFlow.length - 1) return;
		this.#currentSlideIndex++;
		await this.#transitionSlide("forward");
	}

	/**
	 * Go back to the previous slide.
	 */
	async back() {
		if (this.#isAnimating) return;
		if (this.#currentSlideIndex <= 0) return;
		this.#currentSlideIndex--;
		await this.#transitionSlide("backward");
	}

	/**
	 * Jump to a specific slide by key.
	 * @param {string} slideKey
	 */
	async goToSlide(slideKey) {
		if (this.#isAnimating) return;
		const index = this.#slideFlow.indexOf(slideKey);
		if (index === -1) return;
		const direction = index > this.#currentSlideIndex ? "forward" : "backward";
		this.#currentSlideIndex = index;
		await this.#transitionSlide(direction);
	}

	// ---------------------------------------------------------------------------
	// Slide flow
	// ---------------------------------------------------------------------------

	/**
	 * Build the ordered array of slide keys based on the selected mode.
	 * @param {string} [fromSlide="welcome"] - The starting slide key.
	 * @returns {string[]}
	 */
	#buildSlideFlow(fromSlide = "welcome") {
		// Welcome is always the first slide
		const flow = ["welcome"];

		if (fromSlide === "welcome") return flow;

		// Mode select is always next
		flow.push("modeSelect");
		if (fromSlide === "modeSelect") return flow;

		// Branch based on mode
		const mode = this._appState.mode;
		if (mode === "trope") {
			const tropeSlides = [
				"tropeSelect",
				"tropeThemes",
				"review",
				"heroCreated",
			];
			for (const slide of tropeSlides) {
				flow.push(slide);
				if (slide === fromSlide) break;
			}
		} else if (mode === "custom") {
			const customSlides = [
				"customTheme0",
				"customTheme1",
				"customTheme2",
				"customTheme3",
				"customBackpack",
				"review",
				"heroCreated",
			];
			for (const slide of customSlides) {
				flow.push(slide);
				if (slide === fromSlide) break;
			}
		} else {
			// No mode selected yet — just include up to the requested slide
			const heroSlides = [
				"tropeSelect",
				"tropeThemes",
				"customTheme0",
				"customTheme1",
				"customTheme2",
				"customTheme3",
				"customBackpack",
				"review",
				"heroCreated",
			];
			for (const slide of heroSlides) {
				flow.push(slide);
				if (slide === fromSlide) break;
			}
		}

		return flow;
	}

	// ---------------------------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------------------------

	/**
	 * Render the current slide template into the slides container.
	 */
	async #renderCurrentSlide() {
		if (!this.#el) return;

		const slideKey = this.currentSlideKey;
		const templatePath = SLIDE_TEMPLATES[slideKey];
		if (!templatePath) {
			warn(`WelcomeOverlay: No template for slide "${slideKey}"`);
			return;
		}

		const context = await this.#prepareSlideContext(slideKey);
		const html = await foundry.applications.handlebars.renderTemplate(
			templatePath,
			context,
		);

		const container = this.#el.querySelector(".litm--welcome-overlay__slides");
		if (!container) return;

		// Save scroll positions before replacing content
		const scrollPositions = new Map();
		for (const el of container.querySelectorAll(
			".scrollable, .litm--welcome-overlay__wizard-body",
		)) {
			const key = `${el.className}|${el.dataset.tab ?? ""}`;
			scrollPositions.set(key, el.scrollTop);
		}

		container.innerHTML = html;

		// Restore scroll positions
		for (const el of container.querySelectorAll(
			".scrollable, .litm--welcome-overlay__wizard-body",
		)) {
			const key = `${el.className}|${el.dataset.tab ?? ""}`;
			if (scrollPositions.has(key)) el.scrollTop = scrollPositions.get(key);
		}

		const slideEl = container.firstElementChild;
		if (slideEl) this.#bindSlideListeners(slideEl);
	}

	/**
	 * Prepare the template context for the given slide.
	 * @param {string} slideKey
	 * @returns {Promise<object>}
	 */
	async #prepareSlideContext(slideKey) {
		const builder = this.#slideContextBuilders[slideKey];
		return builder ? builder() : {};
	}

	/**
	 * Build context for the welcome slide.
	 * @returns {object}
	 */
	#prepareWelcomeContext() {
		const permissions = game.settings.get("core", "permissions");
		const playerCanCreate =
			permissions.ACTOR_CREATE?.includes(foundry.CONST.USER_ROLES.PLAYER) ??
			false;

		const canCreateHero = game.user.can("ACTOR_CREATE");

		const tours = [];
		for (const [id, tour] of game.tours.entries()) {
			if (!id.startsWith("litmv2.")) continue;
			tours.push({
				id,
				title: game.i18n.localize(tour.title),
				description: game.i18n.localize(tour.description),
			});
		}

		return {
			logo: CONFIG.litmv2.assets.logo,
			isGM: game.user.isGM,
			playerCanCreate,
			canCreateHero,
			tours,
			customDiceEnabled: LitmSettings.customDice,
			popoutTagsEnabled: LitmSettings.popoutTagsSidebar,
		};
	}

	/**
	 * Build context for the mode select slide.
	 * @returns {object}
	 */
	#prepareModeSelectContext() {
		return {
			mode: this._appState.mode,
		};
	}

	/**
	 * Build context for the trope select slide.
	 * @returns {Promise<object>}
	 */
	async #prepareTropeSelectContext() {
		await this._data.ensureIndexes();

		const themeKitLookup = this._data.buildLookup(this._cache.themekits);
		const tropes = this._data.filterBySearch(
			this._cache.tropes,
			this._appState.search.tropes,
		);
		const tropesByCategory = this._data.groupByCategory(tropes);
		const selectedTrope = await this._data.getTropeDetails(
			this._appState.trope.selectedUuid,
			themeKitLookup,
		);

		// Auto-select first optional themekit if none selected
		if (
			selectedTrope &&
			selectedTrope.optional?.length > 0 &&
			!this._appState.trope.optionalUuid
		) {
			this._appState.trope.optionalUuid = selectedTrope.optional[0].uuid;
		}

		// Find the category banner image for the selected trope
		let selectedCategoryImg = "";
		if (selectedTrope?.category) {
			const cat = tropesByCategory.find(
				(g) => g.name === selectedTrope.category,
			);
			if (cat?.img) selectedCategoryImg = cat.img;
		}

		return {
			mode: this._appState.mode,
			state: this._appState,
			search: this._appState.search,
			hasTropes: this._cache.tropes.length > 0,
			tropesByCategory,
			selectedTrope,
			selectedTropeUuid: this._appState.trope.selectedUuid,
			selectedCategoryImg,
		};
	}

	/**
	 * Build context for the trope themes slide.
	 * @returns {Promise<object>}
	 */
	async #prepareTropeThemesContext() {
		await this._data.ensureIndexes();

		const themeKitLookup = this._data.buildLookup(this._cache.themekits);
		const selectedTrope = await this._data.getTropeDetails(
			this._appState.trope.selectedUuid,
			themeKitLookup,
		);

		await this._data.syncTropeThemes(this._appState, selectedTrope);

		const choices = this._appState.trope.themes.choices;
		for (const choice of choices) {
			const powerCount = (choice.powerTags || []).filter(Boolean).length;
			const hasWeakness = Boolean(choice.weaknessTag);
			choice.powerTagCount = powerCount;
			choice.hasWeakness = hasWeakness;
			choice.isComplete = powerCount >= 2 && hasWeakness;
		}

		return {
			mode: this._appState.mode,
			state: this._appState,
			tropeThemeChoices: choices,
		};
	}

	/**
	 * Build step indicator data for custom theme slides.
	 * @param {string} activeSlide - The currently active slide key
	 * @returns {object[]}
	 */
	#buildCustomStepIndicator(activeSlide) {
		const themes = this._appState.custom.themes;
		const steps = [];
		for (let i = 0; i < THEME_SLOTS; i++) {
			const theme = themes[i];
			const slideKey = `customTheme${i}`;
			const isComplete =
				theme.method === "themekit"
					? Boolean(theme.themekitUuid)
					: theme.method === "themebook"
						? Boolean(theme.themebookUuid) && Boolean(theme.name)
						: theme.method === "manual"
							? Boolean(theme.name)
							: false;
			const isActive = activeSlide === slideKey;
			const tooltip = theme.name
				? theme.name
				: game.i18n.format("LITM.Ui.hero_creation_step_theme", { n: i + 1 });
			steps.push({
				label: String(i + 1),
				slide: slideKey,
				active: isActive,
				complete: isComplete,
				icon: isComplete && !isActive ? "fa-solid fa-check" : null,
				tooltip,
			});
		}
		steps.push({
			label: "",
			slide: "customBackpack",
			active: activeSlide === "customBackpack",
			complete: true,
			icon: "fa-solid fa-suitcase",
			tooltip: t("LITM.Terms.backpack"),
		});
		return steps;
	}

	/**
	 * Build context for a single custom theme slide.
	 * @param {number} index - Theme index (0-3)
	 * @returns {Promise<object>}
	 */
	async #prepareCustomThemeContext(index) {
		await this._data.ensureIndexes();
		this._appState.custom.themeIndex = index;

		const currentTheme = this._appState.custom.themes[index];

		const selectedThemebook = await this._data.getThemebookDoc(
			currentTheme.themebookUuid,
		);

		const isVariableLevel =
			selectedThemebook?.system?.theme_level === "variable";
		if (isVariableLevel && !currentTheme.level) {
			currentTheme.level = getDefaultThemeLevel();
		}
		const levelOptions = isVariableLevel
			? getThemeLevels().map((key) => ({
					value: key,
					label: t(`LITM.Terms.${key}`),
					selected: currentTheme.level === key,
				}))
			: [];

		const allPowerQs = (selectedThemebook?.system?.powerTagQuestions || []).map(
			(q) => `${q ?? ""}`.trim(),
		);
		const allWeaknessQs = (
			selectedThemebook?.system?.weaknessTagQuestions || []
		).map((q) => `${q ?? ""}`.trim());

		const powerQuestionOptions = toQuestionOptions(allPowerQs, 1);
		const powerQuestionTexts = Object.fromEntries(
			allPowerQs
				.map((q, i) => [String(i), q])
				.filter(([i, q]) => Number(i) > 0 && `${q ?? ""}`.trim()),
		);

		const weaknessQuestionOptions = toQuestionOptions(allWeaknessQs, 0);
		const weaknessQuestionTexts = Object.fromEntries(
			allWeaknessQs
				.map((q, i) => [String(i), q])
				.filter(([, q]) => `${q ?? ""}`.trim()),
		);

		const namePlaceholder =
			allPowerQs[0] || t("LITM.Ui.hero_creation_theme_name");

		const questIdeas =
			selectedThemebook?.system?.questIdeas?.filter(Boolean) || [];

		return {
			mode: this._appState.mode,
			state: this._appState,
			themeIndex: index,
			themeNumber: index + 1,
			currentTheme,
			hasThemekits: this._cache.themekits.length > 0,
			themekits: this._data.filterBySearch(
				this._cache.themekits,
				this._appState.search.themekits,
			),
			themebooks: this._data.filterBySearch(
				this._cache.themebooks,
				this._appState.search.themebooks,
			),
			isVariableLevel,
			levelOptions,
			powerQuestionOptions,
			powerQuestionTexts,
			weaknessQuestionOptions,
			weaknessQuestionTexts,
			namePlaceholder,
			questIdeas,
			steps: this.#buildCustomStepIndicator(`customTheme${index}`),
		};
	}

	/**
	 * Build context for the custom backpack slide.
	 * @returns {Promise<object>}
	 */
	async #prepareCustomBackpackContext() {
		const backpackTags = this._appState.custom.backpackTags;
		const activeIdx = this._appState.custom.activeBackpackIndex;
		const chosenSet = new Set(backpackTags.filter(Boolean));

		const activeCategory = this._appState.custom.activeStoreCategory;
		const generalStore = Object.entries(GENERAL_STORE).map(([key, items]) => ({
			key,
			label: t(`LITM.Ui.hero_creation_store_${key}`),
			items: items.map((item) => ({
				name: item,
				chosen: chosenSet.has(item),
			})),
			active: activeCategory === key,
		}));

		return {
			mode: this._appState.mode,
			state: this._appState,
			backpackTags: backpackTags.map((tag, i) => ({
				value: tag,
				index: i,
				isActive: i === activeIdx,
			})),
			generalStore,
			steps: this.#buildCustomStepIndicator("customBackpack"),
		};
	}

	// ---------------------------------------------------------------------------
	// Listener binding
	// ---------------------------------------------------------------------------

	/**
	 * Attach click handlers for [data-action] and input handlers for [data-bind].
	 * @param {HTMLElement} slideEl
	 */
	#bindSlideListeners(slideEl) {
		// Action buttons — delegate clicks via checkbox-aware handler
		slideEl.addEventListener("click", async (event) => {
			const target = event.target.closest("[data-action]");
			if (!target) return;

			// For checkboxes, the click fires after the checked state changes,
			// so we can read target.checked directly in the handler.
			if (target.dataset.action) {
				try {
					await this.#handleAction(event, target);
				} catch (err) {
					error("Welcome overlay action failed:", err);
					ui.notifications.error(
						"Something went wrong. Check the console for details.",
					);
				}
			}
		});

		// Data-bind inputs
		slideEl.querySelectorAll("[data-bind]").forEach((input) => {
			const eventName = input.tagName === "SELECT" ? "change" : "input";
			input.addEventListener(eventName, () => {
				const path = input.dataset.bind;
				if (!path) return;
				const value =
					input.type === "number" ? Number(input.value) : input.value;
				foundry.utils.setProperty(this._appState, path, value);
				if (input.dataset.render === "true") {
					this.#renderCurrentSlide();
				}
			});
		});

		// Radio inputs for tropeOptional
		slideEl.querySelectorAll('input[name="tropeOptional"]').forEach((input) => {
			input.addEventListener("change", () => {
				if (!input.checked) return;
				this._appState.trope.optionalUuid = input.value || "";
				this._appState.trope.themes.index = 0;
				this.#renderCurrentSlide();
			});
		});
	}

	// ---------------------------------------------------------------------------
	// Action handling
	// ---------------------------------------------------------------------------

	/** @type {Record<string, (event: Event, target: HTMLElement) => Promise<void>>} */
	#ACTION_HANDLERS = {
		// Welcome slide actions
		"createHero": this.#handleCreateHero,
		"dismiss": this.#handleDismiss,
		"dismissHeroCreated": this.#handleDismissHeroCreated,
		"enablePlayerCreation": this.#handleEnablePlayerCreation,
		"toggleCustomDice": this.#handleToggleCustomDice,
		"togglePopoutTags": this.#handleTogglePopoutTags,
		"startTour": this.#handleStartTour,
		// Mode select
		"selectMode": this.#handleSelectMode,
		// Trope selection
		"selectTrope": this.#handleSelectTrope,
		"selectTropeOptional": this.#handleSelectTropeOptional,
		"selectTropeBackpack": this.#handleSelectTropeBackpack,
		// Trope theme tag toggling
		"toggleTropePowerTag": this.#handleToggleTropePowerTag,
		"toggleTropeWeaknessTag": this.#handleToggleTropeWeaknessTag,
		// Custom theme actions
		"jumpToCustomStep": this.#handleJumpToCustomStep,
		"selectActiveBackpack": this.#handleSelectActiveBackpack,
		"selectThemeMethod": this.#handleSelectThemeMethod,
		"selectThemeKit": this.#handleSelectThemeKit,
		"selectThemebook": this.#handleSelectThemebook,
		// Custom themekit tag toggling
		"toggleCustomPowerTag": this.#handleToggleCustomPowerTag,
		"toggleCustomWeaknessTag": this.#handleToggleCustomWeaknessTag,
		// Backpack suggestions
		"selectStoreCategory": this.#handleSelectStoreCategory,
		"fillBackpackFromStore": this.#handleFillBackpackFromStore,
		// Navigation
		"back": this.#handleBack,
		"next": this.#handleNext,
		"create": this.#handleCreate,
		// Review slide
		"suggestHeroName": this.#handleSuggestHeroName,
		"cancel": this.#handleCancel,
	};

	/**
	 * Dispatch an action by name.
	 * @param {Event} event
	 * @param {HTMLElement} target
	 */
	async #handleAction(event, target) {
		if (this.#isAnimating) return;
		const action = target.dataset.action;
		if (!action) return;
		const handler = this.#ACTION_HANDLERS[action];
		if (handler) return handler.call(this, event, target);
		warn(`WelcomeOverlay: Unknown action "${action}"`);
	}

	// Welcome slide action handlers

	async #handleCreateHero(_event, _target) {
		this.#slideFlow = this.#buildSlideFlow("modeSelect");
		this.#currentSlideIndex = 0;
		await this.next();
	}

	async #handleDismiss(_event, _target) {
		LitmSettings.setWelcomed(true);
		await this.dismiss();
	}

	async #handleDismissHeroCreated(_event, _target) {
		LitmSettings.setWelcomed(true);
		await this.dismiss({ skipSampleHero: true });
	}

	async #handleEnablePlayerCreation(_event, _target) {
		await this.#enablePlayerCreation();
	}

	async #handleToggleCustomDice(_event, target) {
		await game.settings.set(
			"litmv2",
			"custom_dice",
			!LitmSettings.customDice,
		);
		target
			.querySelector(".litm--welcome-overlay__switch")
			?.classList.toggle("active", LitmSettings.customDice);
	}

	async #handleTogglePopoutTags(_event, target) {
		await game.settings.set(
			"litmv2",
			"popout_tags_sidebar",
			!LitmSettings.popoutTagsSidebar,
		);
		target
			.querySelector(".litm--welcome-overlay__switch")
			?.classList.toggle("active", LitmSettings.popoutTagsSidebar);
	}

	async #handleStartTour(_event, target) {
		await this.#startTour(target.dataset.tourId);
	}

	// Mode select action handler

	async #handleSelectMode(_event, target) {
		const mode = target.dataset.mode || "";
		if (!mode) return;
		this._appState.mode = mode;
		this.#slideFlow = this.#buildSlideFlow("heroCreated");
		await this.next();
	}

	// Trope selection action handlers

	async #handleSelectTrope(_event, target) {
		this._appState.trope.selectedUuid = target.dataset.uuid || "";
		this._appState.trope.optionalUuid = "";
		this._appState.trope.backpackChoice = "";
		this._appState.trope.themes.index = 0;
		await this.#renderCurrentSlide();
	}

	async #handleSelectTropeOptional(_event, target) {
		this._appState.trope.optionalUuid = target.dataset.uuid || "";
		this._appState.trope.themes.index = 0;
		await this.#renderCurrentSlide();
	}

	async #handleSelectTropeBackpack(_event, target) {
		this._appState.trope.backpackChoice = target.dataset.value || "";
		await this.#renderCurrentSlide();
	}

	// Trope theme tag toggling action handlers

	async #handleToggleTropePowerTag(_event, target) {
		const index = Number(target.dataset.index || 0);
		const choice = this._appState.trope.themes.choices[index];
		if (!choice) return;
		const value = target.value;
		const selected = new Set(choice.powerTags.filter(Boolean));
		if (target.checked) {
			if (selected.has(value)) return;
			if (selected.size >= 2) {
				target.checked = false;
				ui.notifications.warn("LITM.Ui.hero_creation_max_power_tags", {
					localize: true,
				});
				return;
			}
			selected.add(value);
		} else {
			selected.delete(value);
		}
		choice.powerTags = Array.from(selected);
		choice.powerTagsMap = this._data.toLookupMap(choice.powerTags);
		choice.powerTagOptions.forEach((tagOpt) => {
			tagOpt.checked = selected.has(tagOpt.name);
		});
		await this.#renderCurrentSlide();
	}

	async #handleToggleTropeWeaknessTag(_event, target) {
		const index = Number(target.dataset.index || 0);
		const choice = this._appState.trope.themes.choices[index];
		if (!choice) return;
		const value = target.value;
		if (target.checked) {
			choice.weaknessTag = value;
		} else if (choice.weaknessTag === value) {
			choice.weaknessTag = "";
		}
		choice.weaknessTagOptions.forEach((tagOpt) => {
			tagOpt.checked = tagOpt.name === choice.weaknessTag;
		});
		await this.#renderCurrentSlide();
	}

	// Custom theme action handlers

	async #handleJumpToCustomStep(_event, target) {
		await this.goToSlide(target.dataset.slide);
	}

	async #handleSelectActiveBackpack(_event, target) {
		const idx = Number(target.dataset.index);
		if (idx >= 0 && idx < 3) {
			this._appState.custom.activeBackpackIndex = idx;
		}
		await this.#renderCurrentSlide();
	}

	async #handleSelectThemeMethod(_event, target) {
		const method = target.dataset.method || "";
		const idx = Number(
			target.dataset.index ?? this._appState.custom.themeIndex,
		);
		const theme = this._appState.custom.themes[idx];
		if (!theme) return;
		theme.method = method;
		theme.themekitUuid = "";
		theme.themebookUuid = "";
		theme.powerTagOptions = [];
		theme.weaknessTagOptions = [];
		theme.selectedPowerTags = [];
		theme.selectedWeaknessTag = "";
		await this.#renderCurrentSlide();
	}

	async #handleSelectThemeKit(_event, target) {
		const idx = Number(
			target.dataset.index ?? this._appState.custom.themeIndex,
		);
		const theme = this._appState.custom.themes[idx];
		if (!theme) return;
		const uuid =
			target.tagName === "SELECT"
				? target.value
				: target.dataset.uuid || "";
		theme.method = "themekit";
		theme.themekitUuid = uuid;
		// Populate tag options from the themekit
		if (uuid) {
			const themeDoc = await this._data.getThemeDoc(uuid);
			const tagOptions = this._data.getThemeTagOptions(themeDoc);
			theme.powerTagOptions = tagOptions.powerTags.map((name) => ({
				name,
				checked: false,
			}));
			theme.weaknessTagOptions = tagOptions.weaknessTags.map((name) => ({
				name,
				checked: false,
			}));
			theme.selectedPowerTags = [];
			theme.selectedWeaknessTag = "";
			// Resolve parent themebook questions
			const themebookName = themeDoc?.system?.themebook || "";
			const parentBook = await this._data.getThemebookByName(themebookName);
			const allPQs = (parentBook?.system?.powerTagQuestions || [])
				.map((q) => `${q ?? ""}`.trim())
				.filter(Boolean);
			theme.powerTagQuestions = allPQs.slice(1);
			theme.weaknessTagQuestions = (
				parentBook?.system?.weaknessTagQuestions || []
			)
				.map((q) => `${q ?? ""}`.trim())
				.filter(Boolean);
		} else {
			theme.powerTagOptions = [];
			theme.weaknessTagOptions = [];
			theme.selectedPowerTags = [];
			theme.selectedWeaknessTag = "";
			theme.powerTagQuestions = [];
			theme.weaknessTagQuestions = [];
		}
		await this.#renderCurrentSlide();
	}

	async #handleSelectThemebook(_event, target) {
		const idx = Number(
			target.dataset.index ?? this._appState.custom.themeIndex,
		);
		const theme = this._appState.custom.themes[idx];
		if (!theme) return;
		const uuid =
			target.tagName === "SELECT"
				? target.value
				: target.dataset.uuid || "";
		theme.method = "themebook";
		theme.themebookUuid = uuid;
		await this.#renderCurrentSlide();
	}

	// Custom themekit tag toggling action handlers

	async #handleToggleCustomPowerTag(_event, target) {
		const idx = Number(
			target.dataset.index ?? this._appState.custom.themeIndex,
		);
		const theme = this._appState.custom.themes[idx];
		if (!theme) return;
		const value = target.value;
		const selected = new Set(theme.selectedPowerTags.filter(Boolean));
		if (target.checked) {
			if (selected.has(value)) return;
			if (selected.size >= 2) {
				target.checked = false;
				ui.notifications.warn("LITM.Ui.hero_creation_max_power_tags", {
					localize: true,
				});
				return;
			}
			selected.add(value);
		} else {
			selected.delete(value);
		}
		theme.selectedPowerTags = Array.from(selected);
		theme.powerTagOptions.forEach((tagOpt) => {
			tagOpt.checked = selected.has(tagOpt.name);
		});
		await this.#renderCurrentSlide();
	}

	async #handleToggleCustomWeaknessTag(_event, target) {
		const idx = Number(
			target.dataset.index ?? this._appState.custom.themeIndex,
		);
		const theme = this._appState.custom.themes[idx];
		if (!theme) return;
		const value = target.value;
		if (target.checked) {
			theme.selectedWeaknessTag = value;
		} else if (theme.selectedWeaknessTag === value) {
			theme.selectedWeaknessTag = "";
		}
		theme.weaknessTagOptions.forEach((tagOpt) => {
			tagOpt.checked = tagOpt.name === theme.selectedWeaknessTag;
		});
		await this.#renderCurrentSlide();
	}

	// Backpack suggestion action handlers

	async #handleSelectStoreCategory(_event, target) {
		const cat = target.dataset.value || "";
		this._appState.custom.activeStoreCategory = cat;
		await this.#renderCurrentSlide();
	}

	async #handleFillBackpackFromStore(_event, target) {
		const tag = target.dataset.value || "";
		const tags = this._appState.custom.backpackTags;
		const emptyIdx = tags.findIndex((t) => !t);
		if (emptyIdx !== -1) {
			tags[emptyIdx] = tag;
		}
		await this.#renderCurrentSlide();
	}

	// Navigation action handlers

	async #handleBack(_event, _target) {
		await this.back();
	}

	async #handleNext(_event, _target) {
		await this.#onWizardNext();
	}

	async #handleCreate(_event, _target) {
		await this.#createHero();
	}

	// Review slide action handler

	async #handleSuggestHeroName(_event, _target) {
		const name = HERO_NAMES[Math.floor(Math.random() * HERO_NAMES.length)];
		this._appState.actorName = name;
		await this.#renderCurrentSlide();
	}

	async #handleCancel(_event, _target) {
		LitmSettings.setWelcomed(true);
		await this.dismiss();
	}

	/**
	 * Validate the current slide before advancing to the next.
	 */
	async #onWizardNext() {
		const slideKey = this.currentSlideKey;
		const validator = this.#SLIDE_VALIDATORS[slideKey];
		if (validator) return validator.call(this);
		await this.next();
	}

	/** @type {Record<string, () => Promise<void>>} */
	#SLIDE_VALIDATORS = {
		"modeSelect": this.#validateModeSelect,
		"tropeSelect": this.#validateTropeSelect,
		"tropeThemes": this.#validateTropeThemes,
		"customTheme0": this.#validateCustomTheme,
		"customTheme1": this.#validateCustomTheme,
		"customTheme2": this.#validateCustomTheme,
		"customTheme3": this.#validateCustomTheme,
		"customBackpack": this.#validateCustomBackpack,
	};

	async #validateModeSelect() {
		if (!this._appState.mode) {
			ui.notifications.warn("LITM.Ui.hero_creation_select_mode", {
				localize: true,
			});
			return;
		}
		await this.next();
	}

	async #validateTropeSelect() {
		if (!this._appState.trope.selectedUuid) {
			ui.notifications.warn("LITM.Ui.hero_creation_select_trope", {
				localize: true,
			});
			return;
		}
		await this.next();
	}

	async #validateTropeThemes() {
		// Trope themes validation is lenient — always allow advancing
		await this.next();
	}

	async #validateCustomTheme() {
		await this.next();
	}

	async #validateCustomBackpack() {
		const invalidIdx = await this.validateAllCustomThemes();
		if (invalidIdx !== -1) {
			await this.goToSlide(`customTheme${invalidIdx}`);
			return;
		}
		await this.next();
	}

	// ---------------------------------------------------------------------------
	// Welcome-specific actions
	// ---------------------------------------------------------------------------

	/**
	 * Grant Player role the ACTOR_CREATE permission.
	 */
	async #enablePlayerCreation() {
		const permissions = game.settings.get("core", "permissions");
		const roles = permissions.ACTOR_CREATE || [];
		if (!roles.includes(foundry.CONST.USER_ROLES.PLAYER)) {
			roles.push(foundry.CONST.USER_ROLES.PLAYER);
			permissions.ACTOR_CREATE = roles;
			await game.settings.set("core", "permissions", permissions);
			ui.notifications.info("LITM.Ui.gm_welcome_creation_granted", {
				localize: true,
			});
		}
		await this.#renderCurrentSlide();
	}

	/**
	 * Dismiss the overlay and start a guided tour.
	 * For GM, ensures the sample hero exists first.
	 * @param {string} tourId
	 */
	async #startTour(tourId) {
		if (!tourId) return;
		const tour = game.tours.get(tourId);
		if (!tour) return;

		if (this._createdActor) {
			tour.targetActor = this._createdActor;
		} else if (game.user.isGM) {
			await createSampleHero();
			tour.targetActor ??= game.actors.find(
				(a) => a.type === "hero" && a.getFlag("litmv2", "isSampleHero"),
			);
		} else {
			tour.targetActor ??= game.user.character ?? null;
		}

		await this.dismiss({ skipSampleHero: true });
		await tour.reset();
		tour.start();
	}

	// ---------------------------------------------------------------------------
	// Review + Hero Created contexts
	// ---------------------------------------------------------------------------

	/**
	 * Build context for the review slide.
	 * @returns {Promise<object>}
	 */
	async #prepareReviewContext() {
		await this._data.ensureIndexes();

		const themeKitLookup = this._data.buildLookup(this._cache.themekits);
		const themebookLookup = this._data.buildLookup(this._cache.themebooks);
		const selectedTrope = await this._data.getTropeDetails(
			this._appState.trope.selectedUuid,
			themeKitLookup,
		);

		const reviewThemes = await this.buildReviewThemes(
			selectedTrope,
			themeKitLookup,
			themebookLookup,
		);

		const reviewBackpackChoices =
			this._appState.mode === "trope"
				? selectedTrope?.backpackChoices || []
				: this._appState.custom.backpackTags.filter(Boolean);
		const reviewBackpackSelection =
			this._appState.mode === "trope"
				? this._appState.trope.backpackChoice || reviewBackpackChoices[0]
				: reviewBackpackChoices[this._appState.custom.activeBackpackIndex] ||
					null;

		return {
			logo: CONFIG.litmv2.assets.logo,
			actorName: this._appState.actorName,
			mode: this._appState.mode,
			tropeName: selectedTrope?.name || "",
			reviewThemes,
			reviewBackpackChoices,
			reviewBackpackSelection,
		};
	}

	/**
	 * Build context for the hero-created slide.
	 * @returns {object}
	 */
	#prepareHeroCreatedContext() {
		const tours = [];
		for (const [id, tour] of game.tours.entries()) {
			if (!id.startsWith("litmv2.")) continue;
			tours.push({
				id,
				title: game.i18n.localize(tour.title),
				description: game.i18n.localize(tour.description),
			});
		}

		return {
			logo: CONFIG.litmv2.assets.logo,
			heroName: this._appState.actorName || t("LITM.Ui.hero_name"),
			tours,
		};
	}

	// ---------------------------------------------------------------------------
	// Review theme builder (ported from HeroCreationApp)
	// ---------------------------------------------------------------------------

	/**
	 * Build an array of review theme objects for display.
	 * @param {object|null} selectedTrope
	 * @param {Map} themeKitLookup
	 * @param {Map} themebookLookup
	 * @returns {Promise<object[]>}
	 */
	buildReviewThemes(selectedTrope, themeKitLookup, themebookLookup) {
		return this._data.buildReviewThemes(this._appState, selectedTrope, themeKitLookup, themebookLookup);
	}

	// ---------------------------------------------------------------------------
	// Hero creation
	// ---------------------------------------------------------------------------

	/**
	 * Create the hero actor from the wizard state, show the heroCreated slide,
	 * then auto-start the tour and dismiss the overlay.
	 */
	async #createHero() {
		const actor = await this._data.createHero(this._appState, {
			assignToUser: this.#assignToUser,
		});
		if (!actor) return;

		actor.sheet.render(true);
		this._createdActor = actor;

		if (!this.#slideFlow.includes("heroCreated")) {
			this.#slideFlow.push("heroCreated");
		}
		await this.goToSlide("heroCreated");
	}

	async validateAllCustomThemes() {
		const result = this._data.validateAllCustomThemes(this._appState);
		if (result) {
			const label = `${game.i18n.localize("TYPES.Item.theme")} ${result.index + 1}`;
			ui.notifications.warn(`${label}: ${t(result.reason)}`);
			return result.index;
		}
		return -1;
	}

	// ---------------------------------------------------------------------------
	// Animations (Web Animations API)
	// ---------------------------------------------------------------------------

	/**
	 * Helper: animate an element and return a promise that resolves on finish.
	 * @param {Element} el
	 * @param {Keyframe[]} keyframes
	 * @param {KeyframeAnimationOptions} options
	 * @returns {Promise<void>}
	 */
	static #animate(el, keyframes, options) {
		return new Promise((resolve) => {
			const anim = el.animate(keyframes, {
				fill: "forwards",
				...options,
			});
			anim.onfinish = () => resolve();
		});
	}

	/**
	 * Animate the overlay entrance.
	 */
	async #animateEnter() {
		if (!this.#el) return;

		const bg = this.#el.querySelector(".litm--welcome-overlay__bg");
		const logo = this.#el.querySelector(".litm--welcome-overlay__logo");
		const content = this.#el.querySelector(".litm--welcome-overlay__content");

		if (this.#reducedMotion) {
			this.#el.style.opacity = "1";
			return;
		}

		this.#isAnimating = true;

		// Hide children before revealing the container to prevent flash
		if (bg) bg.style.opacity = "0";
		if (logo) logo.style.opacity = "0";
		if (content) {
			for (const child of content.children) child.style.opacity = "0";
		}

		// Now reveal the container — children are hidden so no flash
		this.#el.style.opacity = "1";

		// Run all animations simultaneously
		const animations = [];

		// Background fades in
		if (bg) {
			animations.push(
				WelcomeOverlay.#animate(bg, [{ opacity: 0 }, { opacity: 1 }], {
					duration: 500,
				}),
			);
		}

		// Logo scales in alongside background
		if (logo) {
			animations.push(
				WelcomeOverlay.#animate(
					logo,
					[
						{ opacity: 0, transform: "scale(0.9)" },
						{ opacity: 1, transform: "scale(1)" },
					],
					{ duration: 400, delay: 200, easing: "ease-out" },
				),
			);
		}

		// Content children stagger in alongside background
		if (content?.children.length) {
			for (let i = 0; i < content.children.length; i++) {
				animations.push(
					WelcomeOverlay.#animate(
						content.children[i],
						[
							{
								opacity: 0,
								transform: "translateY(20px)",
							},
							{ opacity: 1, transform: "translateY(0)" },
						],
						{
							duration: 300,
							delay: 300 + i * 150,
							easing: "ease-out",
						},
					),
				);
			}
		}

		await Promise.all(animations);
		this.#isAnimating = false;
	}

	/**
	 * Animate the overlay exit. Returns a promise that resolves when done.
	 * @returns {Promise<void>}
	 */
	async #animateExit() {
		const el = this.#el;
		if (!el) return;

		if (this.#reducedMotion) {
			el.style.opacity = "0";
			return;
		}

		this.#isAnimating = true;

		const slide = el.querySelector(".litm--welcome-overlay__slides");
		const bg = el.querySelector(".litm--welcome-overlay__bg");

		// Slide fades + slides down
		if (slide) {
			await WelcomeOverlay.#animate(
				slide,
				[
					{
						opacity: 1,
						transform: "translateY(0)",
					},
					{ opacity: 0, transform: "translateY(30px)" },
				],
				{
					duration: 400,
					easing: "ease-in",
				},
			);
		}

		// Background dissolves
		if (bg) {
			await WelcomeOverlay.#animate(bg, [{ opacity: 1 }, { opacity: 0 }], {
				duration: 400,
				easing: "ease-in",
			});
		}

		this.#isAnimating = false;
	}

	/**
	 * Transition between slides with directional animation.
	 * @param {"forward"|"backward"} direction
	 */
	async #transitionSlide(direction) {
		if (!this.#el) return;

		const container = this.#el.querySelector(".litm--welcome-overlay__slides");
		if (!container) return;

		const oldSlide = container.firstElementChild;

		this.#isAnimating = true;

		if (this.#reducedMotion) {
			if (oldSlide) oldSlide.style.opacity = "0";
			await this.#renderCurrentSlide();
			const newSlide = container.firstElementChild;
			if (newSlide) {
				await WelcomeOverlay.#animate(
					newSlide,
					[
						{ opacity: 0 },
						{
							opacity: 1,
						},
					],
					{ duration: 200 },
				);
			}
			this.#isAnimating = false;
			return;
		}

		const exitX = direction === "forward" ? -100 : 100;
		const enterX = direction === "forward" ? 100 : -100;
		const easing = "cubic-bezier(0.7, 0, 0.3, 1)";

		// Exit old slide
		if (oldSlide) {
			await WelcomeOverlay.#animate(
				oldSlide,
				[
					{ opacity: 1, transform: "translateX(0)" },
					{ opacity: 0, transform: `translateX(${exitX}px)` },
				],
				{ duration: 400, easing },
			);
		}

		// Render new slide
		await this.#renderCurrentSlide();
		const newSlide = container.firstElementChild;

		// Enter new slide
		if (newSlide) {
			await WelcomeOverlay.#animate(
				newSlide,
				[
					{ opacity: 0, transform: `translateX(${enterX}px)` },
					{ opacity: 1, transform: "translateX(0)" },
				],
				{ duration: 400, easing },
			);
		}

		this.#isAnimating = false;
	}

	// ---------------------------------------------------------------------------
	// Static entry points
	// ---------------------------------------------------------------------------

	/**
	 * Called from the ready hook. Delegates to GM setup or player welcome.
	 */
	static async showOnReady() {
		if (game.user.isGM) {
			await WelcomeOverlay.#gmSetupAndShow();
		} else {
			WelcomeOverlay.#playerShowIfNeeded();
		}
	}

	/**
	 * First-time GM world setup: create scene, sample hero, rename narrator, then show overlay.
	 */
	static async #gmSetupAndShow() {
		if (LitmSettings.welcomed) return;
		if (!game.user.isGM) return;

		const sceneName = game.i18n.localize("LITM.Name");
		const existingScene = game.scenes.getName(sceneName);
		if (existingScene) {
			await existingScene.activate();
			await createSampleHero();
			const overlay = new WelcomeOverlay();
			await overlay.show();
			return;
		}

		const sceneData = {
			name: sceneName,
			ownership: { default: foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
			navigation: true,
			width: 1920,
			height: 1080,
			initial: { x: 1490, y: 839, scale: 0.7 },
			grid: { type: 0 },
			tokenVision: false,
			environment: { globalLight: { enabled: true } },
			background: {
				src: CONFIG.litmv2.assets.splash,
				color: "#000000",
			},
		};

		const levelId = foundry.documents.BaseScene.metadata.defaultLevelId;
		sceneData.fog = { mode: foundry.CONST.FOG_EXPLORATION_MODES.DISABLED };
		sceneData.levels = [
			{
				_id: levelId,
				name: sceneName,
				background: sceneData.background,
			},
		];
		sceneData.initialLevel = levelId;

		const scene = await foundry.documents.Scene.create(sceneData);

		const { thumb } = await scene.createThumbnail();
		await scene.update({ thumb });

		await sleep(300);
		await scene.activate();
		await sleep(300);

		await createSampleHero();

		// Set the GM's display name to "Narrator" (thematic default)
		if (game.user.name !== t("LITM.Terms.narrator")) {
			await game.user.update({ name: t("LITM.Terms.narrator") });
		}

		const overlay = new WelcomeOverlay();
		await overlay.show();
	}

	/**
	 * Show the overlay for players without a character.
	 */
	static #playerShowIfNeeded() {
		if (game.user.isGM) return;
		if (game.user.character) return;

		const overlay = new WelcomeOverlay({ assignToUser: game.user.id });
		overlay.show();
	}

	/**
	 * Show the overlay from a chat command or other programmatic trigger.
	 * @param {string} [startSlide="welcome"] - The slide to start on.
	 * @returns {WelcomeOverlay}
	 */
	static showFromCommand(startSlide = "welcome") {
		const overlay = new WelcomeOverlay({ assignToUser: game.user.id });
		overlay.#slideFlow = overlay.#buildSlideFlow(startSlide);
		const index = overlay.#slideFlow.indexOf(startSlide);
		if (index !== -1) overlay.#currentSlideIndex = index;
		overlay.show();
		return overlay;
	}
}
