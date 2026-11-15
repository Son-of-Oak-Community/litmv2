// Who `game.user` is, for the tests that depend on the viewer.
//
// Each call replaces `game.user` with a fresh object. setup.js hands every
// test file its own `game`, so the choice never outlives the file.

/** Make the viewer the user `id`; a player unless `isGM` says otherwise. */
export function setUser(id, { isGM = false, ...rest } = {}) {
	game.user = { id, isGM, ...rest };
	return game.user;
}

/** Make the viewer a Narrator. */
export const setGM = (id = "gm", rest) => setUser(id, { ...rest, isGM: true });

/** Make the viewer a player. */
export const setPlayer = (id = "player", rest) => setUser(id, rest);

/** Run `fn` as the user `id`; only the id "gm" is a Narrator. */
export function asUser(id, fn) {
	setUser(id, { isGM: id === "gm" });
	return fn();
}
