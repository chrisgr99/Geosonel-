// @ts-check

/**
 * Event trace (GeoSonixV2) — a rolling buffer of the most recent
 * discrete musical events the simulation fired, for AI-assisted
 * composition through the disk mirror.
 *
 * The mirror lets an AI read and edit a running score, but it is blind
 * to what the score actually *does* as it plays — what notes fire,
 * with what velocities, and (crucially) what the driving signals were
 * at each firing. The trace closes that gap: each event callback
 * firing (onActiveBeat, collision, beenTriggered, …) records the
 * emitted note/sound together with a snapshot of the firing context's
 * colour signals (this.col.*) and velocity (this.vel). An AI reading
 * the trace can then see the actual value distribution a signal takes
 * — e.g. how the green channel ranges across recent beats — and reason
 * about how to scale it, instead of guessing.
 *
 * onTick is deliberately NOT traced: it fires continuously at the
 * control rate rather than on the beat points where musical events
 * happen, so it would flood the buffer with non-event data.
 *
 * The buffer is bounded (newest-wins). A monotonically increasing
 * `seq` lets a consumer (the mirror push pipeline) cheaply tell whether
 * anything changed since its last flush and skip a redundant write.
 */

export const EVENT_TRACE_CAPACITY = 64;

export class EventTrace {
    /**
     * @param {number} [capacity] Max entries retained (newest-wins).
     */
    constructor(capacity = EVENT_TRACE_CAPACITY) {
        this._capacity = (typeof capacity === "number" && capacity > 0)
            ? Math.floor(capacity)
            : EVENT_TRACE_CAPACITY;
        /** @type {object[]} */
        this._entries = [];
        // Monotonic: bumped on every record() and on clear(), never
        // reset, so a consumer can detect "trace emptied" as a change
        // too (seq advanced even though entries is now []).
        this._seq = 0;
    }

    /**
     * Append one event. Drops the oldest entry when at capacity.
     * @param {object} entry
     */
    record(entry) {
        this._entries.push(entry);
        if (this._entries.length > this._capacity) {
            this._entries.shift();
        }
        this._seq += 1;
    }

    /** @returns {number} The current change counter. */
    get seq() {
        return this._seq;
    }

    /** @returns {number} Number of entries currently buffered. */
    get length() {
        return this._entries.length;
    }

    /**
     * A point-in-time view: the change counter plus a shallow copy of
     * the entries (oldest first). The copy is defensive so a consumer
     * holding the snapshot isn't mutated by later record() calls.
     * @returns {{ seq: number, entries: object[] }}
     */
    snapshot() {
        return { seq: this._seq, entries: this._entries.slice() };
    }

    /**
     * Drop all buffered entries. Called on scene swap and rewind so the
     * trace reflects only the current run. Advances seq so a consumer
     * flushes the now-empty trace.
     */
    clear() {
        if (this._entries.length === 0) {
            // Still advance seq so an explicit clear is observable even
            // when the buffer was already empty.
            this._seq += 1;
            return;
        }
        this._entries = [];
        this._seq += 1;
    }
}
