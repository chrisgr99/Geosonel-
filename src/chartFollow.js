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

/**
 * The played-bar timeline for a chart, or null when there is nothing playable.
 * `order[k]` is the FOLDED (displayed) bar index sounding at played position k;
 * `foldedCount` is the number of displayed measures (the editor's grid size);
 * `barBeats[i]` is folded measure i's BEAT count (its meter numerator), so a
 * mid-tune meter change (e.g. a 2/4 bar) carries through to the groove and editor
 * rather than being forced to the master meter. A repeated 8-bar group of folded
 * bars [0..7] played twice yields an order of [0..7, 0..7] over foldedCount 8.
 *
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @returns {ChartBarSequence | null}
 */
export function chartBarSequence(harmony) {
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

    const { timeline } = buildBarPlayback(bars);
    if (timeline.length === 0) return null;

    // Group the bars into rows exactly as the chart display does, and record each
    // folded bar's row + position so the editor can show one field per row and the
    // engine can map a played bar onto that row's pattern.
    const rows = groupRows(bars, BARS_PER_ROW);
    const barRow = new Array(bars.length).fill(0);
    const barPos = new Array(bars.length).fill(0);
    rows.forEach((row, ri) => {
        let pos = 0;
        for (const cell of row) {
            if (cell && cell.empty === true) continue;       // alignment padding, not a real bar
            const bi = /** @type {any} */ (cell).index;
            if (bi >= 0 && bi < bars.length) { barRow[bi] = ri; barPos[bi] = pos; }
            pos += 1;
        }
    });

    return {
        order: timeline.map((t) => t.index),
        foldedCount: bars.length,
        barBeats: bars.map((b) => Math.max(1, Math.floor(Number(b.beats)) || 1)),
        barRow,
        barPos,
        rowCount: rows.length,
    };
}
