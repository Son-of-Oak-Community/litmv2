import {
	FellowshipTagData,
	PowerTagData,
	RelationshipTagData,
	StatusTagData,
	StoryTagData,
	WeaknessTagData,
} from "../active-effects/index.js";
import { ApplyActionMenuApp } from "../apps/apply-action-menu.js";
import { LitmCampingScene } from "../apps/camping/camping-scene.js";
import { CallForRollApp } from "../apps/roll/call-for-roll.js";
import { LitmRoll } from "../apps/roll/roll.js";
import { LitmRollDialog } from "../apps/roll/roll-dialog.js";
import { SecretGraceApp } from "../apps/secret-grace-app.js";
import { SpendPowerApp } from "../apps/spend-power.js";
import { StoryTagSidebar } from "../apps/story-tags/story-tag-sidebar.js";
import { ThemeAdvancementApp } from "../apps/theme-advancement.js";
import { ThemeBrowser } from "../apps/theme-browser.js";
import { ThemeEvolutionWizard } from "../apps/theme-evolution.js";
import { WelcomeOverlay } from "../apps/welcome/welcome-overlay.js";
import { showSacrificeBanner } from "../hud/sacrifice-banner.js";
import { ContentSources } from "./content-sources.js";
import { LitmSettings } from "./settings.js";

/**
 * The litmv2 system's public surface, exposed for module authors and
 * world-level macros as `game.litmv2`. The system aims to be
 * extensible/malleable — macros and modules may replace these classes (or
 * subclass them) to change behaviour. See the "Extensibility" section in
 * CLAUDE.md.
 *
 * - `data.*` — ActiveEffect data model classes
 * - `methods.calculatePower` — kept for backward compat; prefer
 *   `LitmRoll.calculatePower` directly
 * - `fellowship` — the singleton fellowship actor (or null when disabled)
 * - `LitmRoll`, `LitmRollDialog` — replaceable roll classes; combine with
 *   `CONFIG.litmv2.roll.{formula,resolver}` for third-party roll customisation
 * - `CallForRollApp` — the Narrator's Call: `CallForRollApp.open()` picks who
 *   is rolling, then the shared `LitmRollDialog` opens on both screens.
 *   `litm.narratorCall` fires (cancellable) before the call goes out
 * - `StoryTagApp`, `SpendPowerApp`, `ApplyActionMenuApp`,
 *   `ThemeAdvancementApp`, `ThemeEvolutionWizard`, `WelcomeOverlay` —
 *   replaceable app classes
 * - `SecretGraceApp` — the Narrator's window on a Hero's Secret Grace
 *   (Vol. II p.78): `SecretGraceApp.open(actor)`
 * - `ContentSources` — compendium loading and status seeding entry point
 * - `storyTags` — set at ready time to the sidebar tab instance
 * - `rollDialogHud` — mutable reference to the active roll-dialog HUD
 * - `callForRollHud` — mutable reference to the Narrator's main-screen
 *   call-for-roll control, which shares the players-panel region with it
 * - `campingHud` — mutable reference to the "rejoin camp" entry in the
 *   same region
 * - `showSacrificeBanner` — flash the sacrifice rite on peer clients;
 *   reassign to replace the default visual treatment
 *
 * A new object on every call: `litmv2.js` assigns it to `game.litmv2` on
 * `init`, and its slots are then filled and replaced in place.
 * @returns {object}
 */
export function buildPublicApi() {
	return {
		data: {
			PowerTagData,
			WeaknessTagData,
			FellowshipTagData,
			RelationshipTagData,
			StoryTagData,
			StatusTagData,
		},
		methods: {
			calculatePower: LitmRoll.calculatePower,
		},
		get fellowship() {
			if (!LitmSettings.useFellowship) return null;
			const id = LitmSettings.fellowshipId;
			return id ? (game.actors?.get(id) ?? null) : null;
		},
		LitmRollDialog,
		SecretGraceApp,
		LitmRoll,
		CallForRollApp,
		WelcomeOverlay,
		StoryTagApp: StoryTagSidebar,
		SpendPowerApp,
		ApplyActionMenuApp,
		ThemeAdvancementApp,
		ThemeEvolutionWizard,
		ThemeBrowser,
		LitmCampingScene,
		ContentSources,
		rollDialogHud: null,
		callForRollHud: null,
		campingHud: null,
		showSacrificeBanner,
	};
}
