/**
 * Harmony UNWIND.
 *
 * Turns a folded chord progression into a fully-unwound one: every repeat,
 * ending, and simile is written out flat (no repeat marks), and the resulting
 * one-pass song is then laid end-to-end N times, each copy opening a section
 * labelled "Repeat 1", "Repeat 2", … This is what lets a short looping
 * progression (a dub/hip-hop vamp) become N independent, addressable sections
 * — one per intended variation — instead of a single collapsing repeat.
 *
 * Built ON TOP of the player's {@link expandProgression}: that already unrolls
 * repeats/endings/similes into a timed span list, so we reconstruct a flat
 * cell list from those spans rather than re-walking the repeat structure. The
 * stored (folded) progression is never mutated — callers derive an unwound
 * copy on demand from a scene's `harmony.unwind` setting.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

import { expandProgression } from "./harmonyPlayer.js";

/**
 * @typedef {import("./harmonyModel.js").ProgressionCell} ProgressionCell
 */

/** Clamp an unwind setting to the supported range, or null for "off". */
const MAX_UNWIND = 8;

/**
 * @param {[number, number]} timeSignature
 * @returns {number} beats per bar (numerator, >= 1)
 */
function beatsPerBarOf(timeSignature) {
    const n = Array.isArray(timeSignature) ? Math.round(timeSignature[0]) : 4;
    return Math.max(1, n || 4);
}

/**
 * Reconstruct one pass of FLAT cells (chords + bar markers, no repeats) from
 * an expanded span list. Each span sits within a single bar; we emit a chord
 * cell at each span's start beat, padding earlier beats with `empty` cells so
 * a mid-bar chord lands on its beat, then a `bar` marker to close the bar.
 *
 * @param {import("./harmonyPlayer.js").ChordSpan[]} spans
 * @param {number} totalBeats
 * @param {number} beatsPerBar
 * @returns {ProgressionCell[]}
 */
function cellsFromSpans(spans, totalBeats, beatsPerBar) {
    /** @type {ProgressionCell[]} */
    const cells = [];
    const barCount = Math.max(0, Math.round(totalBeats / beatsPerBar));

    for (let b = 0; b < barCount; b += 1) {
        const barStart = b * beatsPerBar;
        const barEnd = barStart + beatsPerBar;
        const inBar = spans
            .filter((s) => s.startBeat >= barStart && s.startBeat < barEnd)
            .sort((s1, s2) => s1.startBeat - s2.startBeat);

        // Preserve the song's own section opening at this bar (tagged on the
        // bar's first span by expandProgression).
        const section = inBar.length > 0 ? inBar[0].section : undefined;
        if (typeof section === "string" && section !== "") {
            cells.push(/** @type {ProgressionCell} */ ({ type: "sectionOpen", label: section }));
        }

        const emitChord = (/** @type {import("./harmonyPlayer.js").ChordSpan} */ s) => {
            cells.push(s.noChord
                ? /** @type {ProgressionCell} */ ({ type: "chord", noChord: true })
                : /** @type {ProgressionCell} */ ({ type: "chord", chord: s.chord }));
        };

        const k = inBar.length;
        // If the chords are EVENLY spread (the common case), emit them adjacent
        // and let the layout/player re-spread them — clean, no filler slots. If
        // they carry explicit placement, pad with `empty` cells to preserve the
        // exact beats.
        const evenlySpread = k > 0 && inBar.every(
            (s, i) => (s.startBeat - barStart) === Math.floor((i * beatsPerBar) / k));

        if (evenlySpread) {
            for (const s of inBar) emitChord(s);
        } else if (k > 0) {
            let cursor = 0; // relative beat within the bar
            for (const s of inBar) {
                const relStart = s.startBeat - barStart;
                while (cursor < relStart) {
                    cells.push(/** @type {ProgressionCell} */ ({ type: "empty" }));
                    cursor += 1;
                }
                emitChord(s);
                cursor += 1;
            }
        } else {
            // A silent bar (no spans) still occupies its beats: keep it visible.
            cells.push(/** @type {ProgressionCell} */ ({ type: "empty" }));
        }
        cells.push(/** @type {ProgressionCell} */ ({ type: "bar" }));
    }

    return cells;
}

/**
 * Fully unwind a folded progression and lay it out `iterations` times.
 * Returns a flat cell list with a "Repeat k" section opening each copy.
 *
 * @param {ProgressionCell[]} progression
 * @param {[number, number]} timeSignature
 * @param {number} iterations  how many copies (1..8)
 * @returns {ProgressionCell[]}
 */
export function unwindProgression(progression, timeSignature, iterations) {
    const n = Math.max(1, Math.min(MAX_UNWIND, Math.round(iterations) || 1));
    const beatsPerBar = beatsPerBarOf(timeSignature);

    // One fully-flat pass (all internal AND whole-song repeats written out).
    // expandProgression tags each bar's first span with the song's section, so
    // the rebuilt cells carry the original A/B sections.
    const { spans, totalBeats } = expandProgression(progression, timeSignature);
    const onePass = cellsFromSpans(spans, totalBeats, beatsPerBar);

    /** @type {ProgressionCell[]} */
    const out = [];
    for (let k = 1; k <= n; k += 1) {
        // Identify the iteration with a "Repeat k" section. If the song opens
        // on its own section (A), fold the number into that label so we don't
        // stack two section marks on one bar: "Repeat k: A". Otherwise emit a
        // standalone "Repeat k" before the content.
        const first = onePass[0];
        if (first !== undefined && first.type === "sectionOpen") {
            const label = /** @type {any} */ (first).label;
            out.push(/** @type {ProgressionCell} */ (
                { type: "sectionOpen", label: `Repeat ${k}: ${label}` }));
            for (let i = 1; i < onePass.length; i += 1) out.push(onePass[i]);
        } else {
            out.push(/** @type {ProgressionCell} */ ({ type: "sectionOpen", label: `Repeat ${k}` }));
            for (const cell of onePass) out.push(cell);
        }
    }
    return out;
}

/**
 * Normalise a raw `unwind` setting to null ("No"/folded) or an integer 1..8.
 * @param {unknown} value
 * @returns {number | null}
 */
export function sanitiseUnwind(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const n = Math.round(value);
    if (n < 1) return null;
    return Math.min(MAX_UNWIND, n);
}

/**
 * Given a SceneHarmony, return the harmony the chart and player should
 * actually use: unchanged when `unwind` is off, or a copy whose progression
 * is the unwound (and N-times repeated) cell list. The stored harmony is
 * never mutated.
 *
 * @template {{ progression: any[], timeSignature: [number, number], unwind?: number|null }} T
 * @param {T | null} harmony
 * @returns {T | null}
 */
export function applyUnwind(harmony) {
    if (harmony === null) return null;
    const n = sanitiseUnwind(harmony.unwind);
    if (n === null) return harmony;
    return {
        ...harmony,
        progression: unwindProgression(
            /** @type {ProgressionCell[]} */ (harmony.progression),
            harmony.timeSignature,
            n,
        ),
    };
}
