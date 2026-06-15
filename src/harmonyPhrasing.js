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
 *   - SECTIONS come first. A section opening (a rehearsal-letter / double-bar
 *     boundary, recovered from the expanded spans) is a HARD phrase boundary —
 *     a phrase never straddles it. In lead-sheet music the section is the top
 *     structural unit, so we phrase each section independently. This stops the
 *     unmusical case of a cadence-run leaking across a boundary (or orphaning a
 *     section's last bar into the next section's phrase).
 *   - Within a section we prefer 4- and 8-bar phrases — the lengths real phrases
 *     take, and the ones that map cleanly onto a beat-pattern phrase under
 *     phrase-sync (design/phrase-sync.md). A cadence landing on the 4-bar grid
 *     carves a 4-bar phrase; otherwise the section reads as 8-bar arcs. Off-grid
 *     cadences are deliberately ignored in favour of the 4/8 shape. We still
 *     detect the authentic cadence V→I (dominant degree 5 → tonic degree 1),
 *     extending a cadence through a HELD tonic so a repeated/sustained cadence
 *     bar isn't clipped (the iReal `Kcl` idiom).
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

/** The shorter preferred phrase length (a 4-bar unit / the grid we snap to). */
const TARGET_BARS = 4;
/** The longer preferred phrase length (and the chunk a long section carves into). */
const MAX_BARS = 8;
/** A phrase shorter than this folds into its neighbour (no lone-bar phrases). */
const MIN_BARS = 2;

/**
 * The automatic BREATH at a phrase's tail: the line releases this many beats
 * before the phrase ends, so a wind player (or the ear) gets a short pause
 * before the next phrase, the way real phrases breathe — even when the spans
 * sit edge to edge with no drawn gap. A fraction of a beat, so the breath is
 * short and independent of the beat-point grid (it shortens the last note's
 * sounding, rather than resting a whole beat point).
 */
const BREATH_BEATS = 0.5;
/** …applied only when at least this many beats remain voiced (don't gut a short phrase). */
const MIN_VOICED_BEATS = 2;

/**
 * The auto-breath is SET ASIDE for now (it clipped notes at chord-phrase ends
 * that drifted against the groove; see design/phrase-sync.md). Drawn-gap rests
 * and start/end anchoring still apply — only the release-cap breath is off. Flip
 * to true to restore it (the logic below and nxtNote's handling are intact).
 */
const BREATH_ENABLED = false;

/**
 * Resolve the phrase state at a base-cycle beat for the melodic line. What a
 * voice reads:
 *   - `inGap`  — a real gap between phrases (or outside them all). Every phrased
 *     voice rests here; it's deliberate silence.
 *   - `release` — beats this note may sound before the phrase's auto-breath
 *     (`(end - BREATH) - beat`), or null when the phrase is too short to breathe
 *     (or the beat is in a gap). A BREATHING voice caps its note to this so the
 *     line releases just before the next phrase; a value <= 0 means the beat
 *     itself falls in the breath tail (rest it). A bass / accompaniment ignores
 *     `release` and plays through.
 *   - `atStart` / `atEnd` — anchor the first beat to a primary tone and the last
 *     beat to a cadential tone.
 *
 * `beat` must already be folded into [0, cycle). Returns null when there are no
 * phrases (the line plays continuously).
 *
 * @param {PhraseSpan[]} phrases  spans in base-cycle beats
 * @param {number} beat           a base-cycle beat
 * @returns {{ inGap: boolean, release: number | null, atStart: boolean, atEnd: boolean } | null}
 */
export function phraseStateAt(phrases, beat) {
    if (!Array.isArray(phrases) || phrases.length === 0) return null;
    for (const p of phrases) {
        if (beat >= p.start && beat < p.end) {
            const breathes = BREATH_ENABLED
                && (p.end - p.start) - BREATH_BEATS >= MIN_VOICED_BEATS;
            const release = breathes ? (p.end - BREATH_BEATS) - beat : null;
            return {
                inGap: false,
                release,
                atStart: beat < p.start + 1,
                atEnd: beat >= p.end - 1,
            };
        }
    }
    return { inGap: true, release: null, atStart: false, atEnd: false };
}

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
            // The phrase ends when the resolving tonic FINISHES sounding, not on
            // its first bar. Extend through any bars where that tonic is HELD —
            // a repeated or sustained tonic (e.g. an iReal `Kcl` repeat of the
            // cadence bar) — so a cadence onto a held tonic isn't clipped a bar
            // short. Use the last held bar's end, which also covers a tonic span
            // that itself runs longer than one bar.
            let j = i;
            while (j + 1 < spans.length
                && !spans[j + 1].noChord
                && isTonic(spans[j + 1].chord)) {
                j += 1;
            }
            cadenceEnd.add(Math.floor((spans[j].endBeat - 1) / beatsPerBar));
        }
    }

    // Phrase each SECTION independently. A section opening (a rehearsal-letter
    // boundary / double barline) is a HARD phrase boundary — a phrase never
    // straddles it — because in lead-sheet music the section is the top
    // structural unit and phrases sit inside it. Within a section we prefer 4-
    // and 8-bar phrases (see phraseLen), which read musically and map cleanly
    // onto a beat-pattern phrase under phrase-sync (design/phrase-sync.md).
    const sectionStarts = sectionStartBars(spans, beatsPerBar, totalBars);

    /** @type {PhraseSpan[]} */
    const phrases = [];
    for (let s = 0; s < sectionStarts.length; s += 1) {
        const secStart = sectionStarts[s];
        const secEnd = (s + 1 < sectionStarts.length) ? sectionStarts[s + 1] : totalBars;
        if (secEnd <= secStart) continue;

        // Carve the section into [startBar, endBar) pairs by the 4/8 preference.
        /** @type {Array<[number, number]>} */
        const pairs = [];
        for (let start = secStart; start < secEnd;) {
            const len = phraseLen(start, secEnd, cadenceEnd);
            pairs.push([start, start + len]);
            start += len;
        }
        // Fold a sub-minimum tail (a lone leftover bar in an odd-length section)
        // back into its neighbour — WITHIN the section, never across the
        // boundary — so a section can't strand a 1-bar phrase or leak it into
        // the next section.
        for (let i = pairs.length - 1; i >= 1; i -= 1) {
            if (pairs[i][1] - pairs[i][0] >= MIN_BARS) continue;
            pairs[i - 1][1] = pairs[i][1];
            pairs.splice(i, 1);
        }

        for (const [a, b] of pairs) {
            phrases.push({
                start: a * beatsPerBar,
                end: Math.min(b * beatsPerBar, totalBeats),
            });
        }
    }
    return phrases;
}

/**
 * The bar indices where a new SECTION opens (a rehearsal-letter / double-bar
 * boundary), always including bar 0. expandProgression tags the first span of a
 * section with its label, so we read those off and convert to bar indices.
 * @param {any[]} spans       expanded chord spans (carry `.section` + `.startBeat`)
 * @param {number} beatsPerBar
 * @param {number} totalBars
 * @returns {number[]}  sorted, ascending, starting at 0
 */
function sectionStartBars(spans, beatsPerBar, totalBars) {
    /** @type {Set<number>} */
    const starts = new Set([0]);
    for (const sp of spans) {
        if (typeof sp.section === "string" && sp.section !== "") {
            const bar = Math.round(sp.startBeat / beatsPerBar);
            if (bar > 0 && bar < totalBars) starts.add(bar);
        }
    }
    return [...starts].sort((a, b) => a - b);
}

/**
 * How many bars the phrase starting at `start` (within its section, which ends
 * at `secEnd`) should span — biased to 4 and 8 bars so phrases read musically
 * and map cleanly onto a beat-pattern phrase. In order:
 *   - 5 bars or fewer left → take the whole rest (no tiny tails);
 *   - a cadence landing exactly on the 4-bar mark → a 4-bar phrase (a real
 *     cadential 4-bar unit, even mid-section);
 *   - 6–8 bars left → take the whole rest (one 6/7/8-bar phrase);
 *   - more than 8 → carve an 8-bar chunk and continue.
 * Off-grid cadences are deliberately IGNORED in favour of the 4/8 shape — a
 * cadence at bar 6 doesn't force a 6-bar phrase.
 * @param {number} start          first bar of the phrase (global bar index)
 * @param {number} secEnd         one past the section's last bar
 * @param {Set<number>} cadenceEnd cadence-end bars (global)
 * @returns {number}  phrase length in bars (>= 1)
 */
function phraseLen(start, secEnd, cadenceEnd) {
    const rem = secEnd - start;
    if (rem <= TARGET_BARS + 1) return rem;
    if (cadenceEnd.has(start + TARGET_BARS - 1)) return TARGET_BARS;
    if (rem <= MAX_BARS) return rem;
    return MAX_BARS;
}
