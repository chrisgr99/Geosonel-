/**
 * Auto rhythm generator (constrained-weighted) — M1: structural onsets.
 *
 * The rhythmic twin of harmonyMelody.js's melodic generator: a metric grid + a
 * RhythmStyle's rhythm core + a per-slot `dice` draw produce a beat pattern.
 * Output is the same Active Beats (x / . / digit) and Beat Strength (0-9) strings
 * the rest of the engine already consumes, so nothing downstream changes.
 *
 * Pure and deterministic. The `dice` array is the variation seam — one value in
 * [0,1) per slot. M1 has no image and no per-repeat variation: with no dice the
 * generator draws a deterministic STRUCTURAL die from the style's salt + slot
 * index, so a slot fires the same way every cycle. M3 will feed the IMAGE colour
 * under each beat as the dice (with a per-repeat seed), making the rhythm
 * position-driven — this module still never sees an image; the dice is the seam.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

/** Clamp to [0, 1]. */
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A finite number, or `fallback`. */
function num(v, fallback) {
    return (typeof v === "number" && Number.isFinite(v)) ? v : fallback;
}

/**
 * Metric strength of a slot at position `pos` within a bar of `beatsPerBar`
 * slots: the downbeat is strongest, the mid-bar slot next, then on-beats, then
 * off-beats. A coarse hierarchy — enough to anchor the rhythm; a later milestone
 * refines it.
 * @param {number} pos          0-based slot index within the bar
 * @param {number} beatsPerBar  slots per bar
 * @returns {number} 0..1
 */
export function metricStrength(pos, beatsPerBar) {
    if (pos === 0) return 1;
    if (beatsPerBar % 2 === 0 && pos === beatsPerBar / 2) return 0.7;
    if (pos % 2 === 0) return 0.5;
    return 0.3;
}

/** Clamp a number to a single 0-9 strength digit. */
function clampDigit(n) {
    const r = Math.round(n);
    return r < 0 ? 0 : r > 9 ? 9 : r;
}

/**
 * Deterministic pseudo-random value in [0,1) from (salt, slot index) — the M1
 * structural die. No Math.random, so the same slot yields the same draw every
 * cycle (no per-repeat variation yet); M3 replaces this with the image colour.
 * @param {number} salt @param {number} i @returns {number}
 */
function structuralDie(salt, i) {
    let h = (Math.imul(((salt | 0) ^ 0x9e3779b9) >>> 0, 0x85ebca6b) + (i + 1)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// Onset shaping: a slot's onset probability is `density` scaled by its effective
// metric weight w, so the average onset rate is ~density when w averages ~0.5.
// These are the calibration constants ("how much does meter matter").
const K_LO = 0.4;
const K_HI = 1.2;

/**
 * Generate a beat pattern of `beatsPerPhrase` slots from a RhythmStyle's rhythm
 * `core` and the meter. Returns the plain (un-barred) Active Beats and Beat
 * Strength strings; the caller bars them (repipeWithBars) to match Beats/Bar.
 *
 * Onsets: each slot's metric strength m is reshaped by `syncopation` (invert-
 * blend — s=0 favours the strong beats, s=0.5 is flat, s=1 favours the off-beats)
 * into a weight w; the onset probability is density·(K_LO + K_HI·w); the slot
 * sounds when the die beats it. The phrase downbeat always anchors. Strength
 * spreads around a mid velocity by w, the spread scaled by `dynamicRange`
 * (0 = every hit equal, 1 = full 1–9 spread strong↔weak).
 *
 * @param {{ beatsPerBar: number, beatsPerPhrase: number,
 *   core?: { density?: number, syncopation?: number, dynamicRange?: number, salt?: number },
 *   dice?: number[] | null }} opts
 * @returns {{ activeBeats: string, strength: string }}
 */
export function generatePhrase(opts) {
    const beatsPerBar = Math.max(1, Math.round(opts.beatsPerBar) || 4);
    const N = Math.max(1, Math.round(opts.beatsPerPhrase) || beatsPerBar);
    const core = (opts.core !== null && typeof opts.core === "object") ? opts.core : {};
    const density = clamp01(num(core.density, 0.5));
    const sync = clamp01(num(core.syncopation, 0.2));
    const dynamicRange = clamp01(num(core.dynamicRange, 0.5));
    const salt = num(core.salt, 0) | 0;
    const dice = Array.isArray(opts.dice) ? opts.dice : null;

    let activeBeats = "";
    let strength = "";
    for (let i = 0; i < N; i += 1) {
        const m = metricStrength(i % beatsPerBar, beatsPerBar);
        const w = (1 - sync) * m + sync * (1 - m);   // invert-blend syncopation
        const onsetProb = clamp01(density * (K_LO + K_HI * w));
        const dRaw = dice !== null ? dice[i] : structuralDie(salt, i);
        const die = clamp01(num(dRaw, 0.5));
        const onset = i === 0 || die < onsetProb;     // phrase downbeat always anchors
        activeBeats += onset ? "x" : ".";
        // Spread around a mid velocity (5) by w∈[0,1], scaled by dynamicRange:
        // 0 ⇒ every hit 5, 1 ⇒ strong beats → 9, weak beats → 1.
        strength += String(clampDigit(5 + (w - 0.5) * 8 * dynamicRange));
    }
    return { activeBeats, strength };
}
