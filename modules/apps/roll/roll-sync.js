import { findBurnedSelection } from "./burn-cap.js";
import { findHeroTagConflict, refusesHelperTag } from "./group-roll.js";

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (value) => structuredClone(value);

/**
 * One writer for the shared roll: the roller accepts small edit operations and
 * publishes canonical snapshots. In particular, a contributor never publishes
 * their (possibly stale) copy of anybody else's selections or scalar fields.
 *
 * Pending edits are replayed until acknowledged, so a snapshot already in
 * flight cannot erase a click made after it was sent. The owner rechecks both
 * caps against the merged state, not the contributor's stale local view.
 */
export class RollSync {
	constructor(state, peerId, session = null, revision = 0) {
		this.peerId = peerId;
		this.state = copy(state);
		this.view = copy(state);
		this.sequence = 0;
		this.revision = revision;
		this.ack = {};
		this.pending = [];
		this.session = session;
		// Set while a reloaded owner waits for a viewer's canonical view; see
		// `expectReseat`. `early` holds the edits accepted in the meantime.
		this.awaitingReseat = false;
		this.early = [];
		// Whether this peer holds the owner's draft, from a snapshot or a
		// reseat. A viewer that never heard from an owner must not answer a
		// reseat: its blank view would wipe the Narrator's call.
		this.heard = false;
	}

	apply(state, operation) {
		const next = { ...copy(state), ...copy(operation.fields) };
		const selections = new Map(next.selections);
		for (const [id, entry] of operation.selections) {
			if (
				entry?.state &&
				(findHeroTagConflict(selections, {
					uuid: id,
					tagActorId: entry.tagActorId,
					participantIds: next.participantIds,
				}) ||
					(entry.state === "scratched" &&
						findBurnedSelection(selections, id)) ||
					(!next.participantIds?.length &&
						refusesHelperTag(selections, id, entry)))
			)
				continue;
			if (entry === null) selections.delete(id);
			else selections.set(id, copy(entry));
		}
		next.selections = [...selections];
		return next;
	}

	edit(current, isOwner) {
		const fields = {};
		for (const [key, value] of Object.entries(current)) {
			if (key !== "selections" && !equal(value, this.view[key]))
				fields[key] = copy(value);
		}
		const before = new Map(this.view.selections);
		const after = new Map(current.selections);
		const selections = [];
		for (const id of new Set([...before.keys(), ...after.keys()])) {
			if (!equal(before.get(id), after.get(id)))
				selections.push([id, after.get(id) ?? null]);
		}
		if (!Object.keys(fields).length && !selections.length) return null;
		const operation = {
			kind: "edit",
			peerId: this.peerId,
			sequence: ++this.sequence,
			fields,
			selections,
			session: this.session,
		};
		if (isOwner) {
			this.accept(operation);
			return this.snapshot();
		}
		this.pending.push(operation);
		this.view = copy(current);
		return operation;
	}

	accept(operation) {
		if (operation.sequence <= (this.ack[operation.peerId] ?? 0)) return;
		this.state = this.apply(this.state, operation);
		this.ack[operation.peerId] = operation.sequence;
		this.revision++;
		this.view = copy(this.state);
		if (this.awaitingReseat) this.early.push(operation);
	}

	snapshot() {
		this.session ??= this.peerId;
		return {
			kind: "snapshot",
			revision: this.revision,
			ack: { ...this.ack },
			state: copy(this.state),
			session: this.session,
		};
	}

	/**
	 * The owner's client came back after a reload and has asked the viewers for
	 * the draft they still hold. Until one answers, or the wait is abandoned,
	 * this sync is still entitled to {@link adopt} even though same-session edits
	 * (the Narrator's, say) may have reached it first and moved its revision.
	 * Those edits are kept so the adopted draft can be rebuilt with them.
	 *
	 * Only a sync that holds no revision yet can wait. `renderRollDialog` asks
	 * for a reseat whenever the assigned owner renders, a live roll included, and
	 * an owner already holding revisions must keep its draft whoever answers.
	 */
	expectReseat() {
		if (this.revision > 0) return;
		this.awaitingReseat = true;
		this.early = [];
	}

	/** Nobody answered in time: carry on with the draft as it stands. */
	abandonReseat() {
		this.awaitingReseat = false;
		this.early = [];
	}

	/**
	 * Take over a draft from a peer's canonical view, keeping its session and
	 * revision. Used when the owner's client comes back after a reload with an
	 * empty dialog while the rest of the table still holds the roll.
	 *
	 * Without a pending {@link expectReseat} only an untouched sync adopts. With
	 * one, the first valid view wins whatever revision this sync has reached: it
	 * is replayed under the edits accepted since the wait began, and the
	 * revision is moved past the adopted one by as many edits, so viewers
	 * already at the adopted revision do not drop the next snapshot as stale.
	 * @param {{state: object, revision: number, session: string}} message
	 * @returns {boolean} Whether the draft was adopted
	 */
	adopt(message) {
		if (!message?.state) return false;
		if (this.revision > 0 && !this.awaitingReseat) return false;
		if (this.session && message.session && this.session !== message.session)
			return false;
		const early = this.early;
		this.session = message.session ?? this.session;
		this.revision = (message.revision ?? 0) + early.length;
		this.state = early.reduce(
			(state, operation) => this.apply(state, operation),
			copy(message.state),
		);
		this.view = copy(this.state);
		// `ack` keeps what the early edits earned, so their senders stop replaying
		// them once the next snapshot lands. It is empty when there were none.
		this.pending = [];
		this.abandonReseat();
		this.heard = true;
		return true;
	}

	receive(message, isOwner) {
		if (message.kind === "edit") {
			if (!isOwner) return null;
			if (message.session && message.session !== (this.session ?? this.peerId))
				return null;
			this.accept(message);
			return this.snapshot();
		}
		if (
			isOwner ||
			message.kind !== "snapshot" ||
			message.revision < this.revision
		)
			return null;
		if (this.session && this.session !== message.session) return null;
		this.session = message.session;
		this.revision = message.revision;
		this.state = copy(message.state);
		this.heard = true;
		this.pending = this.pending.filter(
			(op) => op.sequence > (message.ack[this.peerId] ?? 0),
		);
		this.view = this.pending.reduce(
			(state, op) => this.apply(state, op),
			copy(this.state),
		);
		return null;
	}
}
