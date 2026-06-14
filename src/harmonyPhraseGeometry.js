/**
 * Phrase ↔ chart geometry (pure).
 *
 * The phrasing drawing tool (src/harmonyPanel.js) needs to turn the stored
 * phrase spans — { start, end } in BASE-CYCLE beats (src/harmonyPhrasing.js) —
 * into per-bar pixel segments to paint a light-orange line over the chord
 * chart, and to turn a click on a bar back into a base-cycle beat. Both
 * directions are pure functions of the laid-out bars; the panel only does the
 * DOM positioning. Kept here so the math is `node --test`-able and the panel
 * stays a thin renderer.
 *
 * BEAT SPACES. A displayed {@link ChartBar} carries `beatStart`/`beats` in the
 * laid-out chart's beat space. Phrases live in base-cycle beats. We bridge the
 * two by FOLDING the bar's start modulo the base cycle: one phrase grid then
 * paints onto every unwind copy (each copy folds to the same base beats) and
 * onto every loop. This is exact when the displayed layout-beat space lines up
 * with the base cycle — unwind off (any number of copies fold cleanly) and no
 * internal `{…}` repeats. A folded chart that hides an internal repeat shows
 * the displayed instance only; the engine's phrasing stays correct regardless.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — importable by a
 * `node --test` and checkable by `node --check`.
 */

// @ts-check

/**
 * @typedef {import("./harmonyChartLayout.js").ChartBar} ChartBar
 * @typedef {{ start: number, end: number }} PhraseSpan
 */

/**
 * One bar-local segment of a phrase line: the fraction of bar `barIndex`'s
 * width the line covers, [x0, x1] in 0..1 (left to right). The panel positions
 * an orange rule inside that bar's cell from x0 to x1.
 * @typedef {Object} PhraseSegment
 * @property {number} phraseIndex  index into the phrases array
 * @property {number} barIndex     displayed ChartBar.index this segment sits in
 * @property {number} x0           left edge, fraction of the bar (0..1)
 * @property {number} x1           right edge, fraction of the bar (0..1)
 * @property {boolean} isStart     this segment holds the phrase's true START
 *   (so the renderer can cap it) — false for a continuation from a prior row.
 * @property {boolean} isEnd       this segment holds the phrase's true END.
 */

/** Fold a beat into [0, cycle); identity when cycle <= 0. */
function fold(beat, cycle) {
    if (!(cycle > 0)) return beat;
    return ((beat % cycle) + cycle) % cycle;
}

/**
 * The base-cycle beat range a displayed bar occupies: [b0, b0 + beats), where
 * b0 is the bar's start folded into the cycle.
 * @param {ChartBar} bar
 * @param {number} baseCycle
 * @returns {{ b0: number, b1: number, beats: number }}
 */
function barBaseRange(bar, baseCycle) {
    const beats = bar.beats > 0 ? bar.beats : 1;
    const b0 = fold(bar.beatStart, baseCycle);
    return { b0, b1: b0 + beats, beats };
}

/**
 * Compute the per-bar segments that paint all phrases over the laid-out bars.
 * For each bar and each phrase, the overlap of the phrase span with the bar's
 * (folded) base range becomes a fractional [x0, x1] segment.
 *
 * @param {ChartBar[]} bars
 * @param {number} baseCycle  base-cycle length in beats (0 = no folding)
 * @param {PhraseSpan[]} phrases
 * @returns {PhraseSegment[]}
 */
export function phraseSegments(bars, baseCycle, phrases) {
    /** @type {PhraseSegment[]} */
    const out = [];
    if (!Array.isArray(bars) || !Array.isArray(phrases)) return out;
    for (const bar of bars) {
        if (!bar || typeof bar.beatStart !== "number") continue;
        const { b0, b1, beats } = barBaseRange(bar, baseCycle);
        for (let pi = 0; pi < phrases.length; pi += 1) {
            const p = phrases[pi];
            const s = Math.max(p.start, b0);
            const e = Math.min(p.end, b1);
            if (e <= s) continue;
            out.push({
                phraseIndex: pi,
                barIndex: bar.index,
                x0: (s - b0) / beats,
                x1: (e - b0) / beats,
                isStart: s === p.start,
                isEnd: e === p.end,
            });
        }
    }
    return out;
}

/**
 * The base-cycle beat at a horizontal fraction across a displayed bar, snapped
 * to the nearest whole beat and clamped to the bar's own range (inclusive of
 * the bar's right edge, so the final beat is reachable). Used to turn a click /
 * drag x-position on a bar into a phrase boundary.
 *
 * @param {ChartBar} bar
 * @param {number} frac  0..1 across the bar (values outside are clamped)
 * @param {number} baseCycle
 * @returns {number} a base-cycle beat in [b0, b0 + beats]
 */
export function beatAtFraction(bar, frac, baseCycle) {
    const { b0, b1, beats } = barBaseRange(bar, baseCycle);
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    const beat = Math.round(b0 + f * beats);
    return beat < b0 ? b0 : beat > b1 ? b1 : beat;
}

/**
 * Locate the bar + fraction for a base-cycle beat, for positioning a phrase's
 * end handle. Returns the FIRST displayed bar whose folded range contains the
 * beat (a half-open [b0, b1) test); an end beat sitting exactly on a bar
 * boundary is reported on the bar that ENDS there (so a phrase end handle sits
 * at the right edge of its last bar, not the left edge of the next). Returns
 * null when no bar matches.
 *
 * @param {ChartBar[]} bars
 * @param {number} baseCycle
 * @param {number} beat
 * @param {boolean} [isEnd=false]  treat the beat as a right edge
 * @returns {{ barIndex: number, frac: number } | null}
 */
export function locateBeat(bars, baseCycle, beat, isEnd = false) {
    if (!Array.isArray(bars)) return null;
    for (const bar of bars) {
        if (!bar || typeof bar.beatStart !== "number") continue;
        const { b0, b1, beats } = barBaseRange(bar, baseCycle);
        const inside = isEnd ? (beat > b0 && beat <= b1) : (beat >= b0 && beat < b1);
        if (inside) {
            return { barIndex: bar.index, frac: (beat - b0) / beats };
        }
    }
    return null;
}
