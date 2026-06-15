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
 * Repeats. The "Repeats" control is NOT handled here. It no
 * longer subdivides the cycle; it lays whole copies of the
 * generated pattern end-to-end around the path (N copies →
 * N × beat points, the cursor sweeping all of them in one
 * longer traversal). That multiplication lives in the
 * beat-points derivation (src/beatPoints.js), so this
 * generator only ever produces one base pattern.
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
 * @returns {string}  A string of length cycleDuration containing only "x" and ".".
 */
export function generateEuclideanPattern(cycleDuration, activeBeatsCount, beatShift) {
    const n = Math.max(0, Math.round(cycleDuration));
    if (n === 0) return "";

    const k = Math.max(0, Math.min(n, Math.round(activeBeatsCount)));
    // A single Euclidean distribution of k actives over n slots. "Repeats" no
    // longer subdivides the pattern; it lays whole copies of this base pattern
    // end-to-end around the path (applied in the beat-points derivation, not
    // here), so this generator produces only the one base pattern.
    const pattern = euclideanFloorFormula(k, n);
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
