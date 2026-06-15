// Unit tests for phrase ↔ chart geometry:
//   src/harmonyPhraseGeometry.js — phraseSegments / beatAtSegmentFraction /
//   locateBeat / segmentForBar
//
// Mapping runs through the playback TIMELINE (expanded beats → displayed bar),
// so repeats and unwind copies map to the right bars. Runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    phraseSegments,
    beatAtSegmentFraction,
    locateBeat,
    segmentForBar,
} from "../src/harmonyPhraseGeometry.js";

/** A plain 4-bar timeline (no repeats): a 16-beat base cycle. */
function plainTimeline() {
    return [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
        { index: 2, startBeat: 8, endBeat: 12 },
        { index: 3, startBeat: 12, endBeat: 16 },
    ];
}

/**
 * A timeline where displayed bars 0–1 sound twice (an internal repeat) before
 * bars 2–3: { bar0 bar1 } bar2 bar3 → 24 expanded beats over 4 displayed bars.
 */
function repeatTimeline() {
    return [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
        { index: 0, startBeat: 8, endBeat: 12 },
        { index: 1, startBeat: 12, endBeat: 16 },
        { index: 2, startBeat: 16, endBeat: 20 },
        { index: 3, startBeat: 20, endBeat: 24 },
    ];
}

test("phraseSegments: a bar-aligned phrase covers whole bars, capped at the ends", () => {
    const segs = phraseSegments(plainTimeline(), 16, [{ start: 0, end: 8 }]);
    assert.deepEqual(segs, [
        { phraseIndex: 0, barIndex: 0, x0: 0, x1: 1, isStart: true, isEnd: false },
        { phraseIndex: 0, barIndex: 1, x0: 0, x1: 1, isStart: false, isEnd: true },
    ]);
});

test("phraseSegments: a mid-bar phrase yields fractional segments", () => {
    const segs = phraseSegments(plainTimeline(), 16, [{ start: 2, end: 10 }]);
    assert.deepEqual(segs, [
        { phraseIndex: 0, barIndex: 0, x0: 0.5, x1: 1, isStart: true, isEnd: false },
        { phraseIndex: 0, barIndex: 1, x0: 0, x1: 1, isStart: false, isEnd: false },
        { phraseIndex: 0, barIndex: 2, x0: 0, x1: 0.5, isStart: false, isEnd: true },
    ]);
});

test("phraseSegments: an expanded phrase maps onto the right repeat pass", () => {
    // A phrase at expanded beats [16,20) is bar 2 — NOT the repeated bar 0/1
    // that a folded beatStart of 8 would wrongly hit.
    const segs = phraseSegments(repeatTimeline(), 24, [{ start: 16, end: 20 }]);
    assert.deepEqual(segs.map((s) => s.barIndex), [2]);
});

test("phraseSegments: a folded repeated bar is drawn once (first pass), not stacked", () => {
    // [0,16) spans both passes of bars 0 and 1, but each displayed cell gets a
    // single line (from pass one) — no lines stacked on top of one another.
    const segs = phraseSegments(repeatTimeline(), 24, [{ start: 0, end: 16 }]);
    assert.deepEqual(segs.map((s) => s.barIndex), [0, 1]);
});

test("phraseSegments: folds onto every unwind copy", () => {
    // Two copies of a 16-beat cycle. A phrase at base beats [0,4) paints bar 0
    // in both copies (the copy-2 segment folds back to the same base beats).
    const tl = [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
        { index: 2, startBeat: 16, endBeat: 20 }, // copy 2, bar 0 (folds to [0,4))
    ];
    const segs = phraseSegments(tl, 16, [{ start: 0, end: 4 }]);
    assert.deepEqual(segs.map((s) => s.barIndex), [0, 2]);
});

test("beatAtSegmentFraction: snaps to the nearest whole beat, clamped", () => {
    const seg = { index: 1, startBeat: 4, endBeat: 8 };
    assert.equal(beatAtSegmentFraction(seg, 0, 16), 4);
    assert.equal(beatAtSegmentFraction(seg, 0.5, 16), 6);
    assert.equal(beatAtSegmentFraction(seg, 1, 16), 8);   // right edge reachable
    assert.equal(beatAtSegmentFraction(seg, 2, 16), 8);   // clamp past the edge
});

test("beatAtSegmentFraction: the cycle's final beat does not wrap to 0", () => {
    const last = { index: 3, startBeat: 20, endBeat: 24 };
    assert.equal(beatAtSegmentFraction(last, 1, 24), 24); // not 0
});

test("locateBeat: start beats land on the bar that begins there", () => {
    const tl = plainTimeline();
    assert.deepEqual(locateBeat(tl, 16, 0), { barIndex: 0, frac: 0 });
    assert.deepEqual(locateBeat(tl, 16, 8), { barIndex: 2, frac: 0 });
    assert.deepEqual(locateBeat(tl, 16, 6), { barIndex: 1, frac: 0.5 });
});

test("locateBeat: end beats land on the bar that ends there", () => {
    const tl = plainTimeline();
    assert.deepEqual(locateBeat(tl, 16, 8, true), { barIndex: 1, frac: 1 });
    assert.deepEqual(locateBeat(tl, 16, 16, true), { barIndex: 3, frac: 1 });
});

test("segmentForBar: returns the first (pass-one) segment for a bar", () => {
    const seg = segmentForBar(repeatTimeline(), 1);
    assert.deepEqual(seg, { index: 1, startBeat: 4, endBeat: 8 });
    assert.equal(segmentForBar(repeatTimeline(), 9), null);
});
