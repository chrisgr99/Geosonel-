// Unit tests for phrase ↔ chart geometry:
//   src/harmonyPhraseGeometry.js — phraseSegments / beatAtFraction / locateBeat
//
// Pure mapping between phrase spans (base-cycle beats) and displayed-bar
// fractions. Runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    phraseSegments,
    beatAtFraction,
    locateBeat,
} from "../src/harmonyPhraseGeometry.js";

/** Four 4-beat bars: a 16-beat base cycle. */
function fourBars() {
    return [
        { index: 0, beatStart: 0, beats: 4, slots: [] },
        { index: 1, beatStart: 4, beats: 4, slots: [] },
        { index: 2, beatStart: 8, beats: 4, slots: [] },
        { index: 3, beatStart: 12, beats: 4, slots: [] },
    ];
}

test("phraseSegments: a bar-aligned phrase covers whole bars, capped at the ends", () => {
    const segs = phraseSegments(fourBars(), 16, [{ start: 0, end: 8 }]);
    assert.deepEqual(segs, [
        { phraseIndex: 0, barIndex: 0, x0: 0, x1: 1, isStart: true, isEnd: false },
        { phraseIndex: 0, barIndex: 1, x0: 0, x1: 1, isStart: false, isEnd: true },
    ]);
});

test("phraseSegments: a mid-bar phrase yields fractional segments", () => {
    // beats 2..10 → bar0 second half, all of bar1, bar2 first half.
    const segs = phraseSegments(fourBars(), 16, [{ start: 2, end: 10 }]);
    assert.deepEqual(segs, [
        { phraseIndex: 0, barIndex: 0, x0: 0.5, x1: 1, isStart: true, isEnd: false },
        { phraseIndex: 0, barIndex: 1, x0: 0, x1: 1, isStart: false, isEnd: false },
        { phraseIndex: 0, barIndex: 2, x0: 0, x1: 0.5, isStart: false, isEnd: true },
    ]);
});

test("phraseSegments: folds onto every unwind copy", () => {
    // Eight bars = two copies of a 16-beat cycle. A phrase at base beats [0,4)
    // paints bar 0 AND bar 4 (the copy-2 instance of the same base bar).
    const bars = [];
    for (let i = 0; i < 8; i += 1) bars.push({ index: i, beatStart: i * 4, beats: 4, slots: [] });
    const segs = phraseSegments(bars, 16, [{ start: 0, end: 4 }]);
    assert.deepEqual(segs.map((s) => s.barIndex), [0, 4]);
});

test("phraseSegments: no overlap → no segment", () => {
    const segs = phraseSegments(fourBars(), 16, [{ start: 12, end: 16 }]);
    assert.deepEqual(segs.map((s) => s.barIndex), [3]);
});

test("beatAtFraction: snaps to the nearest whole beat, clamped to the bar", () => {
    const bar = { index: 1, beatStart: 4, beats: 4, slots: [] };
    assert.equal(beatAtFraction(bar, 0, 16), 4);
    assert.equal(beatAtFraction(bar, 0.5, 16), 6);
    assert.equal(beatAtFraction(bar, 1, 16), 8);     // right edge reachable
    assert.equal(beatAtFraction(bar, 0.3, 16), 5);   // 4 + 1.2 → 5
    assert.equal(beatAtFraction(bar, 2, 16), 8);     // clamp past the edge
});

test("locateBeat: start beats land on the bar that begins there", () => {
    const bars = fourBars();
    assert.deepEqual(locateBeat(bars, 16, 0), { barIndex: 0, frac: 0 });
    assert.deepEqual(locateBeat(bars, 16, 8), { barIndex: 2, frac: 0 });
    assert.deepEqual(locateBeat(bars, 16, 6), { barIndex: 1, frac: 0.5 });
});

test("locateBeat: end beats land on the bar that ends there", () => {
    const bars = fourBars();
    // beat 8 as an END belongs to bar 1 (its right edge), not bar 2's left.
    assert.deepEqual(locateBeat(bars, 16, 8, true), { barIndex: 1, frac: 1 });
    assert.deepEqual(locateBeat(bars, 16, 16, true), { barIndex: 3, frac: 1 });
});
