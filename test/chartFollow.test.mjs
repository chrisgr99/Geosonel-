// Chart-following timeline (src/chartFollow.js chartBarSequence): the played-bar
// order a chart-mirror object follows. `order` lists the FOLDED measure index at
// each played position (so repeats replay folded bars); `foldedCount` is the
// editor's grid size. Pure → `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { chartBarSequence, sectionFormWindows, compressedForm } from "../src/chartFollow.js";
import { TEST_PROGRESSIONS } from "../src/samples/testProgressions.js";

/** A chord cell at a diatonic degree. */
const chord = (d) => ({ type: "chord", chord: { degree: d, accidental: "", quality: "", raw: String(d) }, raw: String(d) });

test("no-repeat chart → identity timeline (each folded bar played once, in order)", () => {
    const blues = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    const seq = chartBarSequence(blues);
    assert.equal(seq.foldedCount, 12);
    assert.deepEqual(seq.order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("a repeated group replays its folded bars (order loops, grid shown once)", () => {
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            { type: "repeatOpen" }, chord(1), { type: "bar", barStyle: "single" }, chord(5),
            { type: "repeatClose" }, { type: "end" },
        ],
    };
    const seq = chartBarSequence(harmony);
    assert.equal(seq.foldedCount, 2);           // two displayed measures
    assert.deepEqual(seq.order, [0, 1, 0, 1]);  // played twice
});

test("a section range scopes the timeline to that bar slice (0-based sub-chart)", () => {
    const blues = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    assert.equal(chartBarSequence(blues, null).foldedCount, 12);   // whole form
    const scoped = chartBarSequence(blues, [4, 7]);                 // bars 5-8 (0-based 4..7)
    assert.equal(scoped.foldedCount, 4);
    assert.deepEqual(scoped.order, [0, 1, 2, 3]);                   // played once, the object loops it
    assert.deepEqual(scoped.barBeats, [4, 4, 4, 4]);
});

test("an end-before-start range → null", () => {
    const blues = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    assert.equal(chartBarSequence(blues, [7, 4]), null);
});

test("form windows: a no-repeat section sounds in one contiguous window", () => {
    const blues = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    const fw = sectionFormWindows(blues, [4, 7]);          // bars 5-8 (0-based 4..7)
    assert.equal(fw.formBeats, 48);                        // 12 bars × 4
    assert.deepEqual(fw.windows, [{ startBeat: 16, endBeat: 32 }]);  // bars 4..7 → beats 16..32
});

test("form windows: a section inside a repeat sounds once per pass", () => {
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            { type: "repeatOpen" }, chord(1), { type: "bar", barStyle: "single" }, chord(5),
            { type: "repeatClose" }, { type: "end" },
        ],
    };
    // 2 folded bars played twice (order [0,1,0,1]); section = just bar 0.
    const fw = sectionFormWindows(harmony, [0, 0]);
    assert.equal(fw.formBeats, 16);                        // 4 played bars × 4
    assert.deepEqual(fw.windows, [
        { startBeat: 0, endBeat: 4 },                      // first pass of bar 0
        { startBeat: 8, endBeat: 12 },                     // second pass of bar 0
    ]);
});

test("form windows: null range / no harmony → null", () => {
    const blues = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    assert.equal(sectionFormWindows(blues, null), null);
    assert.equal(sectionFormWindows(null, [0, 1]), null);
});

test("compressedForm: drops unassigned sections, keeping assigned in chart order", () => {
    const bar = { type: "bar", barStyle: "single" };
    const cells = [];
    for (let i = 0; i < 8; i += 1) { cells.push(chord(1)); if (i < 7) cells.push(bar); }
    cells.push({ type: "end" });
    const harmony = { key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4], progression: cells };
    // 8 bars × 4 = 32 beats. Keep bars 2-5, drop 0-1 and 6-7 → one 16-beat run.
    const map = compressedForm(harmony, [[2, 3], [4, 5]]);
    assert.equal(map.chartTotal, 32);
    assert.equal(map.compressedTotal, 16);
    assert.deepEqual(map.segments, [{ chartStart: 8, compStart: 0, len: 16 }]);

    // Interior gap: keep bars 0-1 and 4-5 (drop 2-3 between) → two runs.
    const gap = compressedForm(harmony, [[0, 1], [4, 5]]);
    assert.deepEqual(gap.segments, [
        { chartStart: 0, compStart: 0, len: 8 },
        { chartStart: 16, compStart: 8, len: 8 },
    ]);

    assert.equal(compressedForm(harmony, [[0, 7]]), null);   // nothing dropped → no compression
    assert.equal(compressedForm(harmony, []), null);         // nothing assigned → none
});

test("null / empty harmony → null", () => {
    assert.equal(chartBarSequence(null), null);
    assert.equal(chartBarSequence({}), null);
    assert.equal(chartBarSequence({ progression: [] }), null);
});
