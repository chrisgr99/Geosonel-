/**
 * Auto pre-phraser.
 *
 * When a chart is chosen for a score, we mark its musical PHRASES up front so
 * the melodic line (nxtNote) starts and ends phrases on grounded tones rather
 * than drifting continuously. This module derives those phrase spans from the
 * chord changes alone — no user input — and they are stored on
 * scene.harmony.phrases (src/harmonyScene.js), where the engine reads them.
 *
 * The musical rules, from discussion with Chris:
 *   - Phrases run until a CADENCE. We detect the authentic cadence V→I: a
 *     dominant chord (scale degree 5) resolving to the tonic (degree 1). The
 *     phrase ends on the bar the tonic lands in, so the line cadences onto a
 *     resting tone (Phase-1 anchoring then leans the last note to the tonic).
 *   - Phrases are SHORT: a target of ~4 bars, and never longer than 8 (real
 *     phrases seldom exceed four bars, eight at the very most). When the next
 *     cadence is too far off, we break at the 4-bar target and carry on; when a
 *     cadence falls within reach we run to it (up to the 8-bar cap).
 *   - The phrases are CONTIGUOUS — back to back, covering the whole base cycle —
 *     so auto-phrasing never introduces silence; it only shapes where phrases
 *     begin and end. Gaps (rests) are an opt-in the manual drawing tool adds.
 *
 * Phrase spans are in BASE-CYCLE beats: the chart's repeat-expanded progression
 * (expandProgression), NOT the unwound layout. The engine folds the player beat
 * into this cycle, so one set of phrases applies to every unwind copy and every
 * loop. Degrees are key-relative in the stored model, so cadence detection
 * needs no key argument and is identical in major and minor.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

import { expandProgression } from "./harmonyPlayer.js";

/**
 * @typedef {{ start: number, end: number }} PhraseSpan
 */

/** A phrase aims for this many bars… */
const TARGET_BARS = 4;
/** …and is never longer than this. */
const MAX_BARS = 8;
/** A cadence shorter than this many bars doesn't, on its own, end a phrase. */
const MIN_BARS = 2;

/**
 * Whether a chord is the DOMINANT (scale degree 5, diatonic root) — the chord
 * that resolves at an authentic cadence. Quality is not required: degree 5
 * resolving to degree 1 is signal enough, and constraining the resolution to a
 * tonic keeps false positives out.
 * @param {any} chord  a key-relative Chord (src/irealChord.js), or null
 * @returns {boolean}
 */
function isDominant(chord) {
    return !!chord && chord.degree === 5 && (chord.accidental === "" || chord.accidental === undefined);
}

/**
 * Whether a chord is the TONIC (scale degree 1, diatonic root) — the goal of an
 * authentic cadence.
 * @param {any} chord
 * @returns {boolean}
 */
function isTonic(chord) {
    return !!chord && chord.degree === 1 && (chord.accidental === "" || chord.accidental === undefined);
}

/**
 * Derive automatic phrase spans for a chosen progression. Returns contiguous
 * { start, end } spans in base-cycle beats covering the whole progression, or
 * [] when there is nothing to phrase (no progression / zero length).
 *
 * @param {{ progression: any[], timeSignature: [number, number] }} harmony
 * @returns {PhraseSpan[]}
 */
export function autoPhrase(harmony) {
    if (!harmony || !Array.isArray(harmony.progression)) return [];
    const ts = Array.isArray(harmony.timeSignature) ? harmony.timeSignature : [4, 4];
    const beatsPerBar = Math.max(1, Math.round(ts[0]) || 4);

    const { spans, totalBeats } = expandProgression(harmony.progression, ts);
    if (totalBeats <= 0 || spans.length === 0) return [];

    const totalBars = Math.max(1, Math.round(totalBeats / beatsPerBar));

    // Cadence-end bars: the bar a tonic lands in, when the chord just before it
    // is a dominant. A phrase may end on such a bar.
    /** @type {Set<number>} */
    const cadenceEnd = new Set();
    for (let i = 1; i < spans.length; i += 1) {
        const prev = spans[i - 1];
        const cur = spans[i];
        if (cur.noChord || prev.noChord) continue;
        if (isDominant(prev.chord) && isTonic(cur.chord)) {
            cadenceEnd.add(Math.floor(cur.startBeat / beatsPerBar));
        }
    }

    /** @type {PhraseSpan[]} */
    const phrases = [];
    let start = 0; // first bar of the current phrase (0-based)
    while (start < totalBars) {
        const endBar = chooseEndBar(start, totalBars, cadenceEnd);
        phrases.push({
            start: start * beatsPerBar,
            end: Math.min((endBar + 1) * beatsPerBar, totalBeats),
        });
        start = endBar + 1;
    }
    return phrases;
}

/**
 * Pick the bar a phrase starting at `start` should end on. Preference:
 *   1. the FIRST cadence at or after the 4-bar target (run to the cadence,
 *      up to the 8-bar cap);
 *   2. else the LATEST cadence that is at least MIN_BARS long but shorter than
 *      the target (a genuine short cadential phrase);
 *   3. else the 4-bar target (no cadence in reach — break and carry on).
 * Always clamped to the piece end and the 8-bar cap.
 * @param {number} start
 * @param {number} totalBars
 * @param {Set<number>} cadenceEnd
 * @returns {number}
 */
function chooseEndBar(start, totalBars, cadenceEnd) {
    const lastBar = totalBars - 1;
    const winMax = Math.min(lastBar, start + MAX_BARS - 1);
    const targetBar = start + TARGET_BARS - 1;

    // 1. First cadence at/after the target, within the cap.
    for (let b = Math.min(targetBar, winMax); b <= winMax; b += 1) {
        if (cadenceEnd.has(b)) return b;
    }
    // 2. Latest cadence shorter than the target but at least MIN_BARS.
    const minBar = start + MIN_BARS - 1;
    for (let b = Math.min(targetBar - 1, winMax); b >= minBar; b -= 1) {
        if (cadenceEnd.has(b)) return b;
    }
    // 3. Default break at the target (clamped to the piece end / cap).
    return Math.max(start, Math.min(targetBar, lastBar, winMax));
}
