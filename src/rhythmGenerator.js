/**
 * Auto rhythm generator (constrained-weighted) — v0.
 *
 * The rhythmic twin of harmonyMelody.js's melodic generator: a metric grid +
 * per-style weights + a `dice` draw produce a beat pattern. Output is the same
 * Active Beats (x / . / digit) and Beat Strength (0-9) strings the rest of the
 * engine already consumes, so nothing downstream changes — the generated
 * strings flow through the normal beat-points derivation.
 *
 * Pure and deterministic: a given (meter, length, style, dice) always yields the
 * same pattern. The `dice` array is the variation source — one value in [0,1)
 * per slot. v0 callers pass a neutral/deterministic dice, which yields the
 * canonical pattern for the style; a later milestone feeds the IMAGE colour
 * under each beat point as the dice, making the rhythm position-driven. Either
 * way this module never sees an image — the dice is the seam.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

/**
 * @typedef {Object} RhythmStyle
 * @property {number} onsetBias   baseline onset tendency (0..1) added to slope·metric
 * @property {number} onsetSlope  how strongly metric strength drives onsets
 * @property {number} accent      how punchy the strength values are (0..1+)
 */

/**
 * Built-in rhythmic styles (v0). Names align with the melodic styles
 * (harmonyMelody.js) so a "style" can later carry both a pitch and a rhythm
 * profile. Bass: sparse, locked to strong beats. Lead: busier, flatter. Melody:
 * in between.
 * @type {Record<"melody" | "lead" | "bass", RhythmStyle>}
 */
export const RHYTHM_STYLES = Object.freeze({
    bass: Object.freeze({ onsetBias: 0.0, onsetSlope: 1.0, accent: 1.0 }),
    melody: Object.freeze({ onsetBias: 0.2, onsetSlope: 0.7, accent: 0.85 }),
    lead: Object.freeze({ onsetBias: 0.4, onsetSlope: 0.5, accent: 0.7 }),
});

/** Resolve a style name or object to a RhythmStyle (defaults to melody). */
function resolveStyle(style) {
    if (style !== null && typeof style === "object") return style;
    if (typeof style === "string" && Object.prototype.hasOwnProperty.call(RHYTHM_STYLES, style)) {
        return RHYTHM_STYLES[/** @type {"melody"|"lead"|"bass"} */ (style)];
    }
    return RHYTHM_STYLES.melody;
}

/** Clamp to [0, 1]. */
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Metric strength of a slot at position `pos` within a bar of `beatsPerBar`
 * slots: the downbeat is strongest, the mid-bar slot next, then on-beats, then
 * off-beats. A coarse hierarchy — enough to anchor the groove musically; a
 * later milestone refines it.
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
 * Generate a beat pattern of `beatsPerPhrase` slots for a style and meter.
 * Returns the plain (un-barred) Active Beats and Beat Strength strings; the
 * caller bars them (repipeWithBars) to match Beats/Bar.
 *
 * A slot sounds when its style-weighted onset probability beats the dice draw
 * there (low dice → more likely to sound). The downbeat of the phrase is always
 * anchored. Strength tracks metric strength, scaled by the style's accent.
 *
 * @param {{ beatsPerBar: number, beatsPerPhrase: number,
 *   style?: string | RhythmStyle, dice?: number[] | null }} opts
 * @returns {{ activeBeats: string, strength: string }}
 */
export function generatePhrase(opts) {
    const beatsPerBar = Math.max(1, Math.round(opts.beatsPerBar) || 4);
    const N = Math.max(1, Math.round(opts.beatsPerPhrase) || beatsPerBar);
    const prof = resolveStyle(opts.style);
    const dice = Array.isArray(opts.dice) ? opts.dice : null;

    let activeBeats = "";
    let strength = "";
    for (let i = 0; i < N; i += 1) {
        const m = metricStrength(i % beatsPerBar, beatsPerBar);
        const onsetProb = clamp01(prof.onsetBias + prof.onsetSlope * m);
        // Neutral 0.5 when no dice supplied → canonical pattern (sounds where
        // onsetProb exceeds the midpoint, i.e. the metrically strong slots).
        const dRaw = dice !== null ? dice[i] : 0.5;
        const die = (typeof dRaw === "number" && Number.isFinite(dRaw)) ? clamp01(dRaw) : 0.5;
        const onset = i === 0 || die < onsetProb; // phrase downbeat always anchors
        activeBeats += onset ? "x" : ".";
        const s = onset
            ? clampDigit(1 + m * 8 * prof.accent)
            : clampDigit(m * 9);
        strength += String(s);
    }
    return { activeBeats, strength };
}
