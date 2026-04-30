/**
 * Euclidean rhythm generator.
 *
 * Produces an activeBeats string from the four parameters
 * that GXW's beat-points "euclidean" mode exposes: cycle
 * length, active count, rotational shift, and internal
 * repeat count. The generator is a pure function — given
 * the same parameters it always produces the same string —
 * which lets sceneEditor.js call it as the regeneration
 * step whenever any of the inputs changes on a curve in
 * euclidean mode. See DESIGN.md §10's "Beat-points mode".
 *
 * Algorithm. The base distribution uses the modulo formula:
 *   slot i (0-indexed) fires iff (i × k) mod n < k
 * where k is the active count and n is the slot count. This
 * produces the canonical Bjorklund pattern with the first
 * beat at slot 0, matching how musicians typically read
 * Euclidean rhythms (E(3,8) is the Cuban tresillo
 * "x..x..x.", E(5,8) is the cinquillo "x.x.xx.x", E(3,4)
 * is "x.xx", and so on). The formula is O(n) and avoids
 * the recursion of Bjorklund proper.
 *
 * An equivalent floor formula — floor((i+1)k/n) > floor(ik/n)
 * — produces the same set of patterns rotated by one slot
 * (so E(3,6) becomes ".x.x.x" rather than "x.x.x."). The
 * mod formula is preferred because the canonical zero-shift
 * placement is what musicians expect; rotation is then
 * cleanly expressed via the beatShift parameter.
 *
 * Repeats. When repeats > 1, the generator builds a sub-
 * pattern of length floor(cycleDuration / repeats) carrying
 * round(activeBeatsCount / repeats) actives, then
 * concatenates that sub-pattern `repeats` times. If the
 * concatenation falls short of cycleDuration (because the
 * division wasn't exact), the remainder pads with rests; if
 * it overshoots (which shouldn't happen given the floor
 * division but defensive against degenerate inputs), it
 * truncates to cycleDuration. This matches DESIGN.md §10's
 * "Numeric field bounds": repeats values that don't divide
 * cycleDuration evenly produce a partial-segment final bar
 * rather than rejecting the commit.
 *
 * Beat shift. Positive beatShift values rotate the pattern
 * to the right by N slots (delaying every beat by N slots);
 * negative values rotate left. The shift is normalised
 * modulo cycleDuration so any integer is acceptable input,
 * matching the "no clamp" rule for the beatShift field.
 *
 * No pipe insertion here. The generator returns the raw
 * x/dot string. Pipes for the inspector's display, when
 * needed, are inserted by sceneEditor's repipeWithBars
 * helper after generation. Keeping the generator pipe-free
 * means tests against the algorithm exercise just the
 * distribution math.
 */

// @ts-check

/**
 * Generate the activeBeats string for a curve in euclidean
 * mode.
 *
 * @param {number} cycleDuration  The cycle's slot count, ≥ 1.
 * @param {number} activeBeatsCount  Count of actives to distribute, in [0, cycleDuration].
 * @param {number} beatShift  Rotational offset in slots (any integer; modulo applied internally).
 * @param {number} repeats  Internal repetition count, in [1, cycleDuration].
 * @returns {string}  A string of length cycleDuration containing only "x" and ".".
 */
export function generateEuclideanPattern(cycleDuration, activeBeatsCount, beatShift, repeats) {
    const n = Math.max(0, Math.round(cycleDuration));
    if (n === 0) return "";

    const k = Math.max(0, Math.min(n, Math.round(activeBeatsCount)));
    const r = Math.max(1, Math.min(n, Math.round(repeats)));

    // Sub-pattern length and per-segment active count. With
    // repeats === 1 this collapses to the simple "k actives
    // in n slots" case. With repeats > 1, each segment
    // carries floor(k / repeats) actives; the rounding here
    // keeps the per-segment count an integer at the cost of
    // possibly losing 1-2 actives across the full cycle for
    // non-divisible inputs. Acceptable because repeats > 1
    // with k not divisible by r is a degenerate corner of
    // the parameter space; users hitting it are expected to
    // adjust k or r to a sensible pairing.
    const segmentLength = Math.floor(n / r);
    const segmentActives = segmentLength === 0 ? 0 : Math.round(k / r);

    let pattern;
    if (segmentLength === 0) {
        // Defensive fallback: repeats greater than n means
        // each segment has zero slots. Treat as repeats === 1.
        pattern = euclideanFloorFormula(k, n);
    } else {
        const sub = euclideanFloorFormula(segmentActives, segmentLength);
        let acc = "";
        for (let i = 0; i < r; i++) acc += sub;
        if (acc.length > n) acc = acc.substring(0, n);
        while (acc.length < n) acc += ".";
        pattern = acc;
    }

    return rotateRight(pattern, beatShift);
}

/**
 * The base Euclidean rhythm using the modulo formula. Slot
 * i fires iff (i*k) mod n < k. Returns a string of length
 * `n` containing only "x" and ".". The first beat lands at
 * slot 0 (the canonical Bjorklund placement) for any
 * 0 < k < n.
 *
 * Edge cases. k <= 0 returns all rests; k >= n returns all
 * actives. n <= 0 returns the empty string.
 *
 * @param {number} k
 * @param {number} n
 * @returns {string}
 */
function euclideanFloorFormula(k, n) {
    if (n <= 0) return "";
    if (k <= 0) return ".".repeat(n);
    if (k >= n) return "x".repeat(n);
    let result = "";
    for (let i = 0; i < n; i++) {
        result += ((i * k) % n) < k ? "x" : ".";
    }
    return result;
}

/**
 * Rotate a string to the right by N positions. Positive N
 * shifts characters right (wrapping the tail to the front);
 * negative N shifts left. N is normalised modulo length so
 * any integer is accepted. The empty string returns unchanged.
 *
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function rotateRight(s, n) {
    if (s.length === 0) return s;
    const shift = ((n % s.length) + s.length) % s.length;
    if (shift === 0) return s;
    return s.substring(s.length - shift) + s.substring(0, s.length - shift);
}
