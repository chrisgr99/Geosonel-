/**
 * Chart-following: the played-bar timeline a beat object mirrors.
 *
 * For a beat-points object in "chart" (Harmony-driven) mode, the rhythm editor
 * shows the chart's MEASURES (one editable beat field per chart bar) and the
 * object plays the chart's UNFOLDED form: it walks the chart's played-bar
 * timeline — the same one the chord-chart cursor uses (buildBarPlayback over
 * layoutChart), navigation-honouring since the nav stage — so repeats, D.S. and
 * coda replay the per-measure patterns and the now-playing highlight cycles
 * through a folded repeat group each pass.
 *
 * This module exposes that timeline as a flat sequence of FOLDED bar indices
 * (the displayed measure each played bar belongs to) plus the folded measure
 * count. The beat-points derivation turns each played bar into one cell-group;
 * the editor renders `foldedCount` measures via the same layout.
 *
 * Pure (layoutChart + buildBarPlayback only) → `node --test`.
 */

// @ts-check

import { layoutChart, buildBarPlayback, groupRows } from "./harmonyChartLayout.js";

/** Bars per displayed row (mirrors the Harmony tab's chart layout). */
const BARS_PER_ROW = 4;

/**
 * @typedef {Object} ChartBarSequence
 * @property {number[]} order        folded bar index sounding at each played position
 * @property {number} foldedCount    number of displayed measures
 * @property {number[]} barBeats     folded measure i's beat count (its meter)
 * @property {number[]} barRow       folded measure i's ROW index (the editor field it lives in)
 * @property {number[]} barPos       folded measure i's position WITHIN its row (0-based)
 * @property {number} rowCount       number of rows (editor fields)
 */

const DEFAULT_KEY = { tonicPitchClass: 0, mode: "major" };

/** A bar's beat count (meter numerator), clamped to >= 1. */
const beatsOf = (bar) => Math.max(1, Math.floor(Number(bar.beats)) || 1);

/**
 * Per-bar row index + position-within-row, indexed by each bar's POSITION in the
 * given `bars` array (0-based) — so it works for both the whole chart and a
 * re-indexed section slice. Groups exactly as the chart display does.
 * @param {any[]} bars
 * @returns {{ barRow: number[], barPos: number[], rowCount: number }}
 */
function rowsOf(bars) {
    const rows = groupRows(bars, BARS_PER_ROW);
    const at = new Map();
    bars.forEach((bar, i) => at.set(bar, i));        // bar object → its index in `bars`
    const barRow = new Array(bars.length).fill(0);
    const barPos = new Array(bars.length).fill(0);
    rows.forEach((row, ri) => {
        let pos = 0;
        for (const cell of row) {
            if (cell && cell.empty === true) continue;   // alignment padding, not a real bar
            const i = at.get(cell);
            if (i !== undefined) { barRow[i] = ri; barPos[i] = pos; }
            pos += 1;
        }
    });
    return { barRow, barPos, rowCount: rows.length };
}

/**
 * The played-bar timeline a chart-following object mirrors, or null when there is
 * nothing playable.
 *
 * With no `range`, it's the WHOLE chart's unfolded timeline (repeats / navigation
 * expanded): `order[k]` is the folded bar sounding at played position k, so a
 * repeated 8-bar group [0..7] played twice gives order [0..7, 0..7] over
 * foldedCount 8.
 *
 * With a `range` [start, end] of folded bar indices (the object's assigned
 * SECTION), it's instead just those displayed bars as a fresh 0-based sub-chart,
 * played ONCE — the object loops its section (form-syncing comes later). barBeats
 * carries each bar's meter; barRow/barPos/rowCount describe the editor's rows.
 *
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @param {[number, number] | null} [range]  inclusive folded bar range, or null for the whole form
 * @returns {ChartBarSequence | null}
 */
export function chartBarSequence(harmony, range) {
    if (harmony == null || !Array.isArray(harmony.progression)) return null;
    const ts = Array.isArray(harmony.timeSignature)
        ? /** @type {[number, number]} */ (harmony.timeSignature) : [4, 4];

    const bars = layoutChart(
        /** @type {any} */ (harmony.progression),
        /** @type {any} */ (harmony.key || DEFAULT_KEY),
        "letter",
        ts,
    );
    if (bars.length === 0) return null;

    // SCOPED to a section: the object's chart is just the bar slice, played once
    // (it loops its section), re-indexed to a 0-based sub-chart.
    if (Array.isArray(range) && range.length === 2) {
        const a = Math.max(0, Math.floor(Number(range[0])) || 0);
        const b = Math.min(bars.length - 1, Math.floor(Number(range[1])));
        if (!(b >= a)) return null;
        const slice = bars.slice(a, b + 1);
        return {
            order: slice.map((_, i) => i),
            foldedCount: slice.length,
            barBeats: slice.map(beatsOf),
            ...rowsOf(slice),
        };
    }

    // WHOLE FORM: the unfolded played timeline.
    const { timeline } = buildBarPlayback(bars);
    if (timeline.length === 0) return null;
    return {
        order: timeline.map((t) => t.index),
        foldedCount: bars.length,
        barBeats: bars.map(beatsOf),
        ...rowsOf(bars),
    };
}
