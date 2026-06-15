/**
 * Phrase ↔ chart geometry (pure).
 *
 * The phrasing drawing tool (src/harmonyPanel.js) needs to turn the stored
 * phrase spans — { start, end } in BASE-CYCLE beats (src/harmonyPhrasing.js) —
 * into per-bar pixel segments to paint a light-orange line over the chord
 * chart, and to turn a click on a bar back into a base-cycle beat. Both
 * directions are pure functions of the PLAYBACK TIMELINE; the panel only does
 * the DOM positioning. Kept here so the math is `node --test`-able and the
 * panel stays a thin renderer.
 *
 * WHY THE TIMELINE. A displayed {@link ChartBar} carries a `beatStart` in the
 * laid-out chart's FOLDED beat space, but the engine — and the stored phrases —
 * live in the EXPANDED beat space (repeats unrolled). The two diverge whenever
 * the chart hides an internal `{…}` repeat. So we never map through a bar's own
 * beatStart; we map through {@link buildBarPlayback}'s timeline, which pairs
 * each EXPANDED beat range with the displayed bar sounding there — exactly the
 * bridge the now-playing highlight uses.
 *
 * FOLDED REPEATS. A repeated bar appears in several timeline segments (one per
 * pass), all pointing at the SAME displayed cell. We draw each written measure
 * from its FIRST pass only — one line per bar, no lines stacked on top of one
 * another — so the chart shows the phrasing as written. (The engine still gates
 * every pass on its own expanded beats; this is purely how the folded chart
 * renders. Unwind the chart to see and edit each pass separately.) Click, drag,
 * and handle placement use the same first-pass segment, so editing stays
 * consistent with what's drawn. Under unwind the timeline runs over all N
 * copies — distinct displayed bars — so each copy keeps its own line; folding a
 * segment's start modulo the base cycle paints one phrase grid onto every copy.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

/**
 * @typedef {import("./harmonyChartLayout.js").PlaybackBar} PlaybackBar
 * @typedef {{ start: number, end: number }} PhraseSpan
 */

/**
 * One bar-local segment of a phrase line: the fraction of displayed bar
 * `barIndex`'s width the line covers, [x0, x1] in 0..1. The panel positions an
 * orange rule inside that bar's cell from x0 to x1.
 * @typedef {Object} PhraseSegment
 * @property {number} phraseIndex  index into the phrases array
 * @property {number} barIndex     displayed ChartBar.index this segment sits in
 * @property {number} x0           left edge, fraction of the bar (0..1)
 * @property {number} x1           right edge, fraction of the bar (0..1)
 * @property {boolean} isStart     this segment holds the phrase's true START.
 * @property {boolean} isEnd       this segment holds the phrase's true END.
 */

/** Fold a beat into [0, cycle); identity when cycle <= 0. */
function fold(beat, cycle) {
    if (!(cycle > 0)) return beat;
    return ((beat % cycle) + cycle) % cycle;
}

/**
 * The base-cycle beat range a timeline segment occupies: [s0, s0 + len), where
 * s0 is the segment's expanded start folded into the base cycle. A segment is
 * one displayed bar's worth of beats and never crosses the base-cycle seam.
 * @param {PlaybackBar} seg
 * @param {number} baseCycle
 * @returns {{ s0: number, s1: number, len: number }}
 */
function segBaseRange(seg, baseCycle) {
    const len = seg.endBeat - seg.startBeat;
    const s0 = fold(seg.startBeat, baseCycle);
    return { s0, s1: s0 + len, len: len > 0 ? len : 1 };
}

/**
 * Compute the per-bar segments that paint all phrases over the chart, mapping
 * through the playback timeline so repeats and unwind copies are honoured.
 *
 * @param {PlaybackBar[]} timeline  buildBarPlayback timeline (expanded beats → displayed bar)
 * @param {number} baseCycle        base-cycle length in beats (0 = no folding)
 * @param {PhraseSpan[]} phrases
 * @returns {PhraseSegment[]}
 */
export function phraseSegments(timeline, baseCycle, phrases) {
    /** @type {PhraseSegment[]} */
    const out = [];
    if (!Array.isArray(timeline) || !Array.isArray(phrases)) return out;
    // Draw each displayed bar once: a folded repeat lists the same bar on
    // several passes, which would stack identical lines on the one cell.
    const seen = new Set();
    for (const seg of timeline) {
        if (!seg || typeof seg.startBeat !== "number") continue;
        if (seen.has(seg.index)) continue;
        seen.add(seg.index);
        const { s0, len } = segBaseRange(seg, baseCycle);
        for (let pi = 0; pi < phrases.length; pi += 1) {
            const p = phrases[pi];
            const s = Math.max(p.start, s0);
            const e = Math.min(p.end, s0 + len);
            if (e <= s) continue;
            out.push({
                phraseIndex: pi,
                barIndex: seg.index,
                x0: (s - s0) / len,
                x1: (e - s0) / len,
                isStart: s === p.start,
                isEnd: e === p.end,
            });
        }
    }
    return out;
}

/**
 * The base-cycle beat at a horizontal fraction across a timeline segment,
 * snapped to the nearest whole beat and clamped to the segment's own range
 * (inclusive of its right edge, so the final beat — and the very end of the
 * cycle — is reachable without wrapping to 0). Used to turn a click / drag
 * x-position on a bar into a phrase boundary.
 *
 * @param {PlaybackBar} seg
 * @param {number} frac  0..1 across the bar (clamped)
 * @param {number} baseCycle
 * @returns {number} a base-cycle beat in [s0, s0 + len]
 */
export function beatAtSegmentFraction(seg, frac, baseCycle) {
    const { s0, s1, len } = segBaseRange(seg, baseCycle);
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    const beat = Math.round(s0 + f * len);
    return beat < s0 ? s0 : beat > s1 ? s1 : beat;
}

/**
 * Locate the displayed bar + fraction for a base-cycle beat, for positioning a
 * phrase's handles. Returns the FIRST timeline segment whose folded range
 * contains the beat (half-open for a start, half-open-from-the-right for an
 * end, so an end sitting on a bar boundary reports the bar that ENDS there).
 * Returns null when no segment matches.
 *
 * @param {PlaybackBar[]} timeline
 * @param {number} baseCycle
 * @param {number} beat
 * @param {boolean} [isEnd=false]
 * @returns {{ barIndex: number, frac: number } | null}
 */
export function locateBeat(timeline, baseCycle, beat, isEnd = false) {
    if (!Array.isArray(timeline)) return null;
    for (const seg of timeline) {
        if (!seg || typeof seg.startBeat !== "number") continue;
        const { s0, s1, len } = segBaseRange(seg, baseCycle);
        const inside = isEnd ? (beat > s0 && beat <= s1) : (beat >= s0 && beat < s1);
        if (inside) return { barIndex: seg.index, frac: (beat - s0) / len };
    }
    return null;
}

/**
 * The first timeline segment for a displayed bar index (a repeated bar has
 * several; the first — pass one — anchors click/drag edits). Returns null when
 * the bar isn't in the timeline.
 * @param {PlaybackBar[]} timeline
 * @param {number} barIndex
 * @returns {PlaybackBar | null}
 */
export function segmentForBar(timeline, barIndex) {
    if (!Array.isArray(timeline)) return null;
    for (const seg of timeline) {
        if (seg && seg.index === barIndex) return seg;
    }
    return null;
}
