/**
 * Time-signature helpers.
 *
 * A time signature is stored as a 2-element array [numerator,
 * denominator]. v1 supports only 3/4 and 4/4: the denominator is
 * always 4 (quarter-note beats) and the numerator is 3 or 4. The
 * transport bar's numerator dropdown enforces this on input; this
 * module sanitises values arriving from scene.json (hand-edited or
 * legacy) down to one of the two supported signatures.
 *
 * v1 simplification (see Transport.musicalPosition): the numerator
 * is the beats-per-bar counted against the master BPM beat, and the
 * denominator is display-only. A future version can widen the
 * allowed set and scale the beat unit by the denominator.
 *
 * No esm.sh dependencies, so this is importable by a node --test.
 */

// @ts-check

/** @typedef {[number, number]} TimeSignature  [numerator, denominator] */

/** Allowed numerators (beats per bar) in v1. */
const VALID_NUMERATORS = new Set([3, 4]);

/** The only denominator v1 supports (quarter-note beats). */
const FIXED_DENOMINATOR = 4;

/**
 * Coerce an arbitrary value (typically from a hand-edited or legacy
 * scene.json) into a supported time signature, falling back to
 * [4, 4] when absent or unsupported. Accepts a 2-element
 * [numerator, denominator] array or a "n/d" string; the numerator
 * must be 3 or 4 and the denominator must be 4, otherwise the
 * default [4, 4] is returned.
 *
 * @param {unknown} value
 * @returns {TimeSignature}
 */
export function sanitiseTimeSignature(value) {
    let num = NaN;
    let den = NaN;
    if (Array.isArray(value) && value.length === 2) {
        num = Number(value[0]);
        den = Number(value[1]);
    } else if (typeof value === "string") {
        const m = /^\s*(\d+)\/(\d+)\s*$/.exec(value);
        if (m !== null) {
            num = Number(m[1]);
            den = Number(m[2]);
        }
    }
    if (VALID_NUMERATORS.has(num) && den === FIXED_DENOMINATOR) {
        return [num, FIXED_DENOMINATOR];
    }
    return [4, 4];
}
