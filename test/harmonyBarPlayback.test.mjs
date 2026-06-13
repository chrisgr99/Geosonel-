// Unit tests for the now-playing playback map:
//   src/harmonyChartLayout.js — buildBarPlayback(bars)
//
// buildBarPlayback unrolls the FOLDED displayed bars into the PLAYED order
// (honouring {} repeats over 2 passes and 1st/2nd endings), tagging each
// played bar with an expanded beat range and the DISPLAYED bar index it maps
// back to. A now-playing cursor binary-searches this to light the right bar.
//
// Pure logic (no DOM) — runs under `node --test`. We hand it minimal
// ChartBar-shaped objects carrying just the fields buildBarPlayback reads
// (index, beats, repeatOpen, repeatClose, ending, section, end).

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBarPlayback } from "../src/harmonyChartLayout.js";

/** A minimal ChartBar carrying just what buildBarPlayback reads. */
function bar(index, extra = {}) {
    return { index, beats: 4, slots: [], ...extra };
}

/** Compact view: the displayed-bar index played in each slot, in order. */
function order(timeline) {
    return timeline.map((p) => p.index);
}

test("buildBarPlayback: plain bars play once, beats accumulate", () => {
    const { timeline, totalBeats } = buildBarPlayback([bar(0), bar(1), bar(2)]);
    assert.deepEqual(order(timeline), [0, 1, 2]);
    assert.deepEqual(timeline[0], { index: 0, startBeat: 0, endBeat: 4 });
    assert.deepEqual(timeline[2], { index: 2, startBeat: 8, endBeat: 12 });
    assert.equal(totalBeats, 12);
});

test("buildBarPlayback: empty input", () => {
    assert.deepEqual(buildBarPlayback([]), { timeline: [], totalBeats: 0 });
});

test("buildBarPlayback: a { } block plays twice", () => {
    // { A B } C  →  A B A B C
    const bars = [
        bar(0, { repeatOpen: true }),
        bar(1, { repeatClose: true }),
        bar(2),
    ];
    const { timeline, totalBeats } = buildBarPlayback(bars);
    assert.deepEqual(order(timeline), [0, 1, 0, 1, 2]);
    assert.equal(totalBeats, 20);
    // Second pass beats continue past the first.
    assert.deepEqual(timeline[2], { index: 0, startBeat: 8, endBeat: 12 });
});

test("buildBarPlayback: 1st/2nd endings select by pass", () => {
    // { A | N1 B :} | N2 C | D  →  A B (loop) A C D
    const bars = [
        bar(0, { repeatOpen: true }),
        bar(1, { ending: 1, repeatClose: true }),
        bar(2, { ending: 2 }),
        bar(3),
    ];
    const { timeline } = buildBarPlayback(bars);
    assert.deepEqual(order(timeline), [0, 1, 0, 2, 3]);
});

test("buildBarPlayback: multi-bar 1st ending skipped on 2nd pass", () => {
    // { A | N1 B C :} | N2 D | E  →  A B C (loop) A D E
    const bars = [
        bar(0, { repeatOpen: true }),
        bar(1, { ending: 1 }),
        bar(2, { repeatClose: true }),
        bar(3, { ending: 2 }),
        bar(4),
    ];
    const { timeline } = buildBarPlayback(bars);
    assert.deepEqual(order(timeline), [0, 1, 2, 0, 3, 4]);
});

test("buildBarPlayback: beat ranges are contiguous and monotonic", () => {
    const bars = [
        bar(0, { repeatOpen: true }),
        bar(1, { repeatClose: true }),
        bar(2),
    ];
    const { timeline, totalBeats } = buildBarPlayback(bars);
    let prev = 0;
    for (const p of timeline) {
        assert.equal(p.startBeat, prev);
        assert.ok(p.endBeat > p.startBeat);
        prev = p.endBeat;
    }
    assert.equal(prev, totalBeats);
});

test("buildBarPlayback: respects a per-bar beats count (3/4)", () => {
    const { timeline, totalBeats } = buildBarPlayback([
        bar(0, { beats: 3 }),
        bar(1, { beats: 3 }),
    ]);
    assert.deepEqual(timeline[1], { index: 1, startBeat: 3, endBeat: 6 });
    assert.equal(totalBeats, 6);
});
