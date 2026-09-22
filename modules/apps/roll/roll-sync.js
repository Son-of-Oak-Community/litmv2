import { findBurnedSelection } from "./burn-cap.js";
import { findHeroTagConflict } from "./group-roll.js";

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
	constructor(state, peerId, session = null) {
		this.peerId = peerId;
		this.state = copy(state);
		this.view = copy(state);
		this.sequence = 0;
		this.revision = 0;
		this.ack = {};
		this.pending = [];
		this.session = session;
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
					(entry.state === "scratched" && findBurnedSelection(selections, id)))
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
