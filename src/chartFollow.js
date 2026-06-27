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

import { layoutChart, buildBarPlayback, groupRows, sectionLabelFor, rangesForLabel, chartSections } from "./harmonyChartLayout.js";

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

/**
 * @typedef {Object} SectionFormWindows
 * @property {number} formBeats   total beats of one whole-form pass (the form clock period)
 * @property {Array<{startBeat: number, endBeat: number}>} windows
 *   the spans, in form-beat space, where the played form is inside the section —
 *   one per contiguous occurrence (so a section that repeats yields one window
 *   per pass). Half-open [startBeat, endBeat).
 */

/**
 * Where, on the shared form clock, an object's assigned section is SOUNDING.
 * Form-gated playback uses this to let a scoped object play only while the chord
 * chart is inside its bars, tracing its curve once per occurrence and freezing
 * between. Walks the WHOLE-form unfolded timeline and collects each maximal
 * contiguous run of played bars whose folded index is in `range`.
 *
 * (A section that itself contains an internal repeat plays its run back-to-back,
 * which this reports as one longer window — matching chartBarSequence's
 * range-slice-plays-once model; sections are normally repeat-free blocks.)
 *
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @param {[number, number] | null} range  inclusive folded bar range, or null
 * @returns {SectionFormWindows | null}  null when there's no range / nothing playable
 */
export function sectionFormWindows(harmony, range) {
    if (!Array.isArray(range) || range.length !== 2) return null;
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
    const a = Math.max(0, Math.floor(Number(range[0])) || 0);
    const b = Math.min(bars.length - 1, Math.floor(Number(range[1])));
    if (!(b >= a)) return null;

    const { timeline, totalBeats } = buildBarPlayback(bars);
    if (timeline.length === 0) return null;

    /** @type {Array<{startBeat: number, endBeat: number}>} */
    const windows = [];
    let cur = null;
    for (const seg of timeline) {
        if (seg.index >= a && seg.index <= b) {
            if (cur === null) cur = { startBeat: seg.startBeat, endBeat: seg.endBeat };
            else cur.endBeat = seg.endBeat;
        } else if (cur !== null) {
            windows.push(cur);
            cur = null;
        }
    }
    if (cur !== null) windows.push(cur);
    if (windows.length === 0) return null;
    return { formBeats: totalBeats, windows };
}

/**
 * @typedef {Object} SectionFormBars
 * @property {number} formBeats     total beats of one whole-form pass (the form clock period)
 * @property {number} sectionBars   the section's folded bar count (its cycle length, in bars)
 * @property {Array<{startBeat: number, endBeat: number}>} segs
 *   one entry per IN-SECTION PLAYED bar, in form order, with its form-beat span.
 *   Consecutive entries are adjacent in the played form; a jump between an entry's
 *   endBeat and the next's startBeat is an out-of-section gap.
 */

/**
 * The per-played-bar map a form-gated object steps through. Unlike
 * {@link sectionFormWindows} (which merges a contiguous in-section run into one
 * span — wrong for the cursor when the form repeats the section's bars, smearing
 * the rhythm), this lists EACH in-section played bar separately. The engine then
 * advances the cursor one section-bar per played bar, so the rhythm stays locked
 * to the beat clock and re-traces every `sectionBars` regardless of how the form
 * repeats the section.
 *
 * Accepts ONE or SEVERAL bar ranges (an object assigned a label owns every
 * section bearing it). `sectionBars` is the FIRST range's bar count — the object
 * edits/curves against its first occurrence; later occurrences re-trace it.
 *
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @param {Array<[number, number]> | [number, number] | null} ranges  one range or a list
 * @returns {SectionFormBars | null}  null when there's no range / nothing playable
 */
export function sectionFormBars(harmony, ranges) {
    // Accept a bare [start,end] or a list of them.
    const list = Array.isArray(ranges) && ranges.length > 0 && Array.isArray(ranges[0])
        ? /** @type {Array<[number, number]>} */ (ranges)
        : (Array.isArray(ranges) && ranges.length === 2 && typeof ranges[0] === "number"
            ? [/** @type {[number, number]} */ (ranges)] : null);
    if (list === null || list.length === 0) return null;
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
    // Clamp each range to the chart; keep only valid ones.
    const clamped = list
        .map((r) => [Math.max(0, Math.floor(Number(r[0])) || 0), Math.min(bars.length - 1, Math.floor(Number(r[1])))])
        .filter((r) => r[1] >= r[0]);
    if (clamped.length === 0) return null;
    const inAny = (i) => clamped.some((r) => i >= r[0] && i <= r[1]);

    const { timeline, totalBeats } = buildBarPlayback(bars);
    if (timeline.length === 0) return null;

    /** @type {Array<{startBeat: number, endBeat: number}>} */
    const segs = [];
    for (const seg of timeline) {
        if (inAny(seg.index)) segs.push({ startBeat: seg.startBeat, endBeat: seg.endBeat });
    }
    if (segs.length === 0) return null;
    return { formBeats: totalBeats, sectionBars: clamped[0][1] - clamped[0][0] + 1, segs };
}

/**
 * @typedef {Object} FormMap
 * @property {number} chartTotal       whole-chart unfolded length, in beats
 * @property {number} compressedTotal  the kept (assigned) length, in beats
 * @property {Array<{ chartStart: number, compStart: number, len: number }>} segments
 *   the kept runs: a compressed beat in [compStart, compStart+len) maps to chart
 *   beat chartStart + (c - compStart). Sorted by compStart.
 */

/**
 * The COMPRESSED form: the chart's played timeline with every bar NOT in an
 * assigned section dropped, so the shared form clock spends no time on unassigned
 * sections (no dead air). Returns a piecewise map from compressed-form beats to
 * real chart beats, or null when nothing is assigned OR nothing is dropped (the
 * form is then just the whole chart — identity, no compression needed).
 *
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @param {Array<[number, number]>} assignedRanges  union of all assigned section ranges
 * @returns {FormMap | null}
 */
export function compressedForm(harmony, assignedRanges) {
    if (harmony == null || !Array.isArray(harmony.progression)) return null;
    if (!Array.isArray(assignedRanges) || assignedRanges.length === 0) return null;
    const ts = Array.isArray(harmony.timeSignature)
        ? /** @type {[number, number]} */ (harmony.timeSignature) : [4, 4];
    const bars = layoutChart(
        /** @type {any} */ (harmony.progression),
        /** @type {any} */ (harmony.key || DEFAULT_KEY),
        "letter",
        ts,
    );
    if (bars.length === 0) return null;
    const inAny = (i) => assignedRanges.some((r) => i >= r[0] && i <= r[1]);

    const { timeline, totalBeats } = buildBarPlayback(bars);
    if (timeline.length === 0) return null;

    // Contiguous runs of KEPT played bars, in chart-beat space.
    /** @type {Array<{ chartStart: number, chartEnd: number }>} */
    const runs = [];
    let cur = null;
    for (const seg of timeline) {
        if (inAny(seg.index)) {
            if (cur === null) cur = { chartStart: seg.startBeat, chartEnd: seg.endBeat };
            else cur.chartEnd = seg.endBeat;
        } else if (cur !== null) { runs.push(cur); cur = null; }
    }
    if (cur !== null) runs.push(cur);
    if (runs.length === 0) return null;

    let comp = 0;
    const segments = runs.map((r) => {
        const len = r.chartEnd - r.chartStart;
        const out = { chartStart: r.chartStart, compStart: comp, len };
        comp += len;
        return out;
    });
    // Nothing dropped → no compression (the whole chart is the form).
    if (Math.abs(comp - totalBeats) < 1e-9) return null;
    return { chartTotal: totalBeats, compressedTotal: comp, segments };
}

/**
 * @typedef {Object} UnassignedChartData
 * @property {number[]} order        editor played-bar order (identity over the concatenation)
 * @property {number} foldedCount    total bars across all active sections (the editor grid)
 * @property {number[]} barBeats     per-concatenated-bar beat count
 * @property {number[]} barRow       per-concatenated-bar editor row
 * @property {number[]} barPos       per-concatenated-bar position within its row
 * @property {number} rowCount       editor rows (across all active sections)
 * @property {number[]} sectionBars  bar count of each active section, in concat order
 * @property {Array<{startBeat:number,endBeat:number,sec:number,barInSec:number,occ:number}>} segs
 *   every played bar of the compressed form, tagged with its active-section index,
 *   bar-within-occurrence, and a global occurrence counter (re-trace boundary).
 */

/**
 * The chart data for an UNASSIGNED object under a compressed form: it plays EVERY
 * assigned section, re-tracing per occurrence. The editor shows the active
 * sections concatenated (each label's first occurrence, in chart order) so beats
 * can be authored per section; `segs` drives playback, tagging each played bar
 * with which section it belongs to and which occurrence (so the object restarts
 * its section's pattern each time that section comes round).
 *
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @param {string[]} assignedLabels  labels assigned to some object
 * @returns {UnassignedChartData | null}
 */
export function unassignedChartData(harmony, assignedLabels) {
    if (harmony == null || !Array.isArray(harmony.progression)) return null;
    if (!Array.isArray(assignedLabels) || assignedLabels.length === 0) return null;
    const ts = Array.isArray(harmony.timeSignature)
        ? /** @type {[number, number]} */ (harmony.timeSignature) : [4, 4];
    const bars = layoutChart(
        /** @type {any} */ (harmony.progression),
        /** @type {any} */ (harmony.key || DEFAULT_KEY),
        "letter",
        ts,
    );
    if (bars.length === 0) return null;

    const secs = chartSections(bars);                 // every occurrence {label, range}
    // Active sections: unique assigned labels, FIRST occurrence, in chart order.
    const firstByLabel = new Map();
    for (const s of secs) {
        if (assignedLabels.includes(s.label) && !firstByLabel.has(s.label)) {
            firstByLabel.set(s.label, s.range);
        }
    }
    const active = [...firstByLabel.entries()].map(([label, range]) => ({ label, range }));
    if (active.length === 0) return null;
    const labelIdx = new Map(active.map((a, i) => [a.label, i]));

    // Editor concatenation: each active section's first-occurrence bars, in order.
    /** @type {any[]} */
    const concat = [];
    for (const a of active) for (let i = a.range[0]; i <= a.range[1]; i += 1) concat.push(bars[i]);
    const sectionBars = active.map((a) => a.range[1] - a.range[0] + 1);

    // Form segs: every played bar in an active section, tagged sec/barInSec/occ.
    const { timeline } = buildBarPlayback(bars);
    /** @type {Array<{startBeat:number,endBeat:number,sec:number,barInSec:number,occ:number}>} */
    const segs = [];
    let occ = -1; let prevSec = -1; let prevBarInSec = -1;
    for (const t of timeline) {
        const f = t.index;
        const occRange = secs.find((s) => s.range[0] <= f && f <= s.range[1] && labelIdx.has(s.label));
        if (!occRange) continue;                       // not an active section → dropped
        const sec = /** @type {number} */ (labelIdx.get(occRange.label));
        const barInSec = f - occRange.range[0];
        if (sec !== prevSec || barInSec !== prevBarInSec + 1) occ += 1;   // new occurrence
        segs.push({ startBeat: t.startBeat, endBeat: t.endBeat, sec, barInSec, occ });
        prevSec = sec; prevBarInSec = barInSec;
    }
    if (segs.length === 0) return null;

    return {
        order: concat.map((_, i) => i),
        foldedCount: concat.length,
        barBeats: concat.map(beatsOf),
        ...rowsOf(concat),
        sectionBars,
        segs,
    };
}

/**
 * Resolve an object's stored `chartSection` (a section LABEL, or a legacy
 * `[start,end]` range) to the label and ALL its bar ranges in chart order.
 * @param {import("./harmonyScene.js").SceneHarmony | null | undefined} harmony
 * @param {unknown} chartSection
 * @returns {{ label: string, ranges: Array<[number, number]> } | null}
 */
export function objectSectionRanges(harmony, chartSection) {
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
    const label = sectionLabelFor(bars, chartSection);
    if (label === null) return null;
    const ranges = rangesForLabel(bars, label);
    if (ranges.length === 0) return null;
    return { label, ranges };
}
