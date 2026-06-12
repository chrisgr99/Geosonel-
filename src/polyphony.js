// Polyphony (voice limiting) — pure helpers (design/polyphony.md).
//
// Two enforcement regimes:
//   - Per-object STRICT, by duration-trimming (only on the onActiveBeat
//     path, where the next-note schedule is known): a note's duration is
//     shortened so it ends just past the N-th upcoming beat, plus a small
//     legato overlap, capping the object at N overlapping voices.
//   - Group / score LOOSE, by suppress-new: at note-start, count notes
//     currently sounding in the scope against a small voice registry; if the
//     scope is at its cap, drop the new note. The per-object count-based
//     fallback (onTick / collision) uses the same rule against the object's
//     own count.
//
// Everything here is a pure function of sim state + the deterministic beat
// schedule — no wall clock, no randomness — so MIDI and superdough behave
// identically and playback stays deterministic.

/**
 * Small legato overlap (seconds) added past the N-th-beat start when trimming
 * a strict per-object note, so a mono line connects instead of clicking.
 * @type {number}
 */
export const LEGATO_OVERLAP_SECONDS = 0.03;

/**
 * Trimmed duration for the strict per-object case. The note is shortened
 * (never extended) so it ends just past the N-th upcoming beat's start plus
 * the legato overlap. When the schedule can't be resolved (timeToNthBeatSec
 * is null/non-finite), the requested duration passes through unchanged.
 *
 * @param {number} requestedDuration  The note's authored/spec duration (s).
 * @param {number | null} timeToNthBeatSec  Time to the pObj-th upcoming beat
 *   (s), or null when the schedule is degenerate/unknown.
 * @returns {number} The (possibly shortened) duration.
 */
export function trimDuration(requestedDuration, timeToNthBeatSec) {
    if (timeToNthBeatSec === null
        || typeof timeToNthBeatSec !== "number"
        || !Number.isFinite(timeToNthBeatSec)) {
        return requestedDuration;
    }
    return Math.min(requestedDuration, timeToNthBeatSec + LEGATO_OVERLAP_SECONDS);
}

/**
 * Time (seconds) to the k-th upcoming beat in an onActiveBeat ordered
 * schedule, measured from the just-fired beat.
 *
 * `order` is the ordered upcoming beats (each `{ g, ... }`, sorted by `g` =
 * directional progress in [0, 1)). `nextIdx` already points PAST the just-
 * fired beat. `gJustFired` is the just-fired beat's own progress. For the
 * k-th upcoming beat we take `order[nextIdx + k - 1]`, wrapping into
 * subsequent cycles by adding 1 per full wrap to its `g`, and multiply the
 * progress delta by the effective cycle time.
 *
 * Returns null when the schedule is degenerate (empty order, non-finite
 * cycle time, k < 1), so the caller falls back to count-based suppression.
 *
 * @param {Array<{g: number}>} order  Ordered upcoming beats (sorted by g).
 * @param {number} nextIdx  Index past the just-fired beat.
 * @param {number} gJustFired  The just-fired beat's directional progress.
 * @param {number} k  Which upcoming beat (1 = the next beat).
 * @param {number} effectiveCycleTime  Wall-clock seconds for one cycle at the
 *   current speed.
 * @returns {number | null}
 */
export function timeToKthBeat(order, nextIdx, gJustFired, k, effectiveCycleTime) {
    if (!Array.isArray(order) || order.length === 0) return null;
    if (!Number.isFinite(k) || k < 1) return null;
    if (!Number.isFinite(effectiveCycleTime) || effectiveCycleTime <= 0) return null;
    if (!Number.isFinite(gJustFired)) return null;

    const len = order.length;
    // Absolute index of the k-th upcoming beat across cycle wraps.
    const absIdx = nextIdx + k - 1;
    if (absIdx < 0) return null;
    const wraps = Math.floor(absIdx / len);
    const slot = ((absIdx % len) + len) % len;
    const entry = order[slot];
    if (entry === undefined || !Number.isFinite(entry.g)) return null;
    const gKth = entry.g + wraps;
    const delta = gKth - gJustFired;
    if (!Number.isFinite(delta) || delta < 0) return null;
    return delta * effectiveCycleTime;
}

/**
 * Suppress-new decision: given the per-object / per-group / per-score limits
 * and the current sounding counts, decide whether a new note should be
 * dropped. Returns true to SUPPRESS (drop the note).
 *
 * `countObject` is checked against `pObj` only when `checkObject` is true
 * (the onTick / collision fallback). On the trimmed onActiveBeat path the
 * trim alone enforces the per-object cap, so `checkObject` is false there.
 * Group and score are always checked. An Infinity limit never suppresses.
 *
 * @param {Object} args
 * @param {boolean} args.checkObject  Whether to apply the per-object count cap.
 * @param {number} args.pObj  Per-object limit (Infinity = unlimited).
 * @param {number} args.countObject  Notes currently sounding for this object.
 * @param {number} args.pGrp  Per-group limit (Infinity = unlimited).
 * @param {number} args.countGroup  Notes currently sounding in this group.
 * @param {number} args.pScore  Whole-score limit (Infinity = unlimited).
 * @param {number} args.countScore  Total notes currently sounding.
 * @returns {boolean} true if the new note should be dropped.
 */
export function shouldSuppress(args) {
    const {
        checkObject, pObj, countObject,
        pGrp, countGroup,
        pScore, countScore,
    } = args;
    if (checkObject && Number.isFinite(pObj) && countObject >= pObj) return true;
    if (Number.isFinite(pGrp) && countGroup >= pGrp) return true;
    if (Number.isFinite(pScore) && countScore >= pScore) return true;
    return false;
}

/**
 * A small active-note registry. Tracks currently-sounding notes as
 * `{ objectId, group, endTime }` and answers per-object / per-group / total
 * counts. Pruning is by `endTime <= now` against the supplied sim time, so
 * the registry is a pure function of sim state (no wall clock).
 */
export class VoiceRegistry {
    constructor() {
        /** @type {Array<{objectId: string, group: string, endTime: number}>} */
        this._notes = [];
    }

    /**
     * Drop every note whose endTime is at or before `now` (sim seconds).
     * @param {number} now
     */
    prune(now) {
        if (this._notes.length === 0) return;
        const kept = [];
        for (const n of this._notes) {
            if (n.endTime > now) kept.push(n);
        }
        this._notes = kept;
    }

    /** @param {string} objectId @returns {number} */
    countObject(objectId) {
        let c = 0;
        for (const n of this._notes) if (n.objectId === objectId) c++;
        return c;
    }

    /** @param {string} group @returns {number} */
    countGroup(group) {
        let c = 0;
        for (const n of this._notes) if (n.group === group) c++;
        return c;
    }

    /** @returns {number} */
    countTotal() {
        return this._notes.length;
    }

    /**
     * Register a surviving note's sounding window.
     * @param {string} objectId
     * @param {string} group
     * @param {number} endTime  Sim time (s) at which the note stops sounding.
     */
    register(objectId, group, endTime) {
        this._notes.push({ objectId, group, endTime });
    }

    /** Drop all tracked notes (rewind / scene reset). */
    clear() {
        this._notes = [];
    }
}
