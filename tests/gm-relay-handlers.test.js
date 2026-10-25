import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";
import { asSender, PLAYER, rollCardFields } from "./__helpers__/relay-card.js";

// The reported exploit: a player emits a GM-proxy packet from the console and
// the active GM's client performs the write. Each test here replays one such
// packet against the real handler, next to the legitimate request it mimics.

function handler(event) {
	return Hooks.on.mock.calls.find(
		([name]) => name === `litm.socket.${event}`,
	)[1];
}

function scratchable(uuid, system = {}) {
	const effect = {
		uuid,
		type: "power_tag",
		parent: null,
		system: {
			isScratched: false,
			setScratched: vi.fn(async (v) => {
				effect.system.isScratched = v;
			}),
			...system,
		},
	};
	return effect;
}

beforeEach(() => {
	vi.clearAllMocks();
	game.socket = { on: vi.fn(), emit: vi.fn() };
	game.user = { id: "gm", isGM: true };
	game.users.activeGM = game.user;
	asSender();
	Sockets.registerListeners();
});

describe("scratchEffect relay", () => {
	const burn = "Actor.ally.Item.t.ActiveEffect.burn";

	it("refuses a forged scratch of a tag on no card", async () => {
		const effect = scratchable("Actor.ally.ActiveEffect.anything");
		foundry.utils.fromUuid.mockResolvedValue(effect);
		game.messages.get = vi.fn(() => null);

		await handler("scratchEffect")({
			senderId: PLAYER.id,
			data: { uuid: effect.uuid, via: "roll" },
		});

		expect(effect.system.setScratched).not.toHaveBeenCalled();
	});

	it("scratches the card's burn once, however often it is replayed", async () => {
		const effect = scratchable(burn);
		foundry.utils.fromUuid.mockResolvedValue(effect);
		game.messages.get = vi.fn(() => ({
			id: "m1",
			...rollCardFields({ scratchedTags: [{ uuid: burn }] }),
		}));
		const packet = {
			senderId: PLAYER.id,
			data: { uuid: burn, messageId: "m1", via: "roll" },
		};

		await handler("scratchEffect")(packet);
		effect.system.isScratched = false; // recovered since
		await handler("scratchEffect")(packet);

		expect(effect.system.setScratched).toHaveBeenCalledTimes(1);
		expect(effect.system.setScratched).toHaveBeenCalledWith(true);
	});
});

describe("storyTagsUpdate relay", () => {
	const sidebar = { doUpdate: vi.fn() };
	beforeEach(() => {
		game.litmv2 = { storyTags: sidebar };
		vi.spyOn(ContentSources, "getStoryTags").mockResolvedValue([
			{ id: "fog", uuid: "C.fog", system: { isHidden: false } },
			{ id: "ambush", uuid: "C.ambush", system: { isHidden: true } },
		]);
		game.messages.get = vi.fn(() => null);
	});

	it("refuses to wipe the Narrator's scene tags", async () => {
		await handler("storyTagsUpdate")({
			senderId: PLAYER.id,
			data: { operation: "deleteTags", data: ["fog", "ambush"] },
		});
		expect(sidebar.doUpdate).not.toHaveBeenCalled();
	});

	it("applies a player's single visible delete", async () => {
		await handler("storyTagsUpdate")({
			senderId: PLAYER.id,
			data: { operation: "deleteTags", data: ["fog"] },
		});
		expect(sidebar.doUpdate).toHaveBeenCalledWith("deleteTags", ["fog"]);
	});
});

describe("createHeroAsGM relay", () => {
	beforeEach(() => {
		foundry.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 } };
		foundry.documents.Actor.create = vi.fn(async () => ({ id: "new" }));
		PLAYER.character = null;
		PLAYER.update = vi.fn();
	});

	it("creates only what the wizard sends, owned by the sender", async () => {
		await handler("createHeroAsGM")({
			senderId: PLAYER.id,
			data: {
				userId: PLAYER.id,
				assignToUser: null,
				actorData: {
					name: "Gerrin",
					type: "challenge",
					ownership: { default: 3 },
					items: [{ name: "Origin", type: "theme" }],
					flags: { litmv2: { heroWizardRequestId: "r1" } },
				},
			},
		});

		expect(foundry.documents.Actor.create).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "hero",
				ownership: { default: 0, [PLAYER.id]: 3 },
			}),
			expect.anything(),
		);
		expect(PLAYER.update).toHaveBeenCalledWith({ character: "new" });
	});

	it("refuses a request naming another user", async () => {
		await handler("createHeroAsGM")({
			senderId: PLAYER.id,
			data: { userId: "victim", assignToUser: "victim", actorData: {} },
		});
		expect(foundry.documents.Actor.create).not.toHaveBeenCalled();
	});
});
