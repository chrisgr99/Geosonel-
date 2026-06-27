// The chart-mirror hook + derivation end to end: deriveStrudelCycleLengths fills
// a "chart"-mode object's played-bar timeline from the loaded chart, and
// deriveCurveBeatPoints plays the chart's UNFOLDED form (repeats replay the
// per-measure patterns), falling back to the grid path when no chart is loaded.

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveStrudelCycleLengths } from "../src/simulation.js";
import { deriveCurveBeatPoints } from "../src/beatPoints.js";
import { chartBarSequence } from "../src/chartFollow.js";
import { TEST_PROGRESSIONS } from "../src/samples/testProgressions.js";

const chord = (d) => ({ type: "chord", chord: { degree: d, accidental: "", quality: "", raw: String(d) }, raw: String(d) });

test("chart-mode object takes the played-bar timeline + cells-per-bar from the chart", () => {
    const harmony = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    const obj = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x...", strength: "5" };
    const scene = { timeSignature: [4, 4], harmony, curves: [obj], sprites: [], triggers: [] };

    deriveStrudelCycleLengths(scene);

    assert.equal(obj.beatsPerBar, 4);
    assert.equal(obj.foldedBarCount, 12);
    assert.deepEqual(obj.chartBarSeq, chartBarSequence(harmony).order);
    // "x..." in measure 0 ghosts to all 12 bars → one hit per bar = 12 beat points.
    assert.equal(deriveCurveBeatPoints(obj).positions.length, 12);
});

test("chartSection scopes the object to its bar range (fewer beat points, re-traced)", () => {
    const harmony = TEST_PROGRESSIONS.find((p) => p.title === "12-Bar Blues");
    const obj = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x...", strength: "5", chartSection: [4, 7] };
    deriveStrudelCycleLengths({ timeSignature: [4, 4], harmony, curves: [obj], sprites: [], triggers: [] });

    assert.equal(obj.foldedBarCount, 4);                  // just the assigned 4-bar section
    assert.deepEqual(obj.chartBarSeq, [0, 1, 2, 3]);      // 0-based sub-chart, played once (loops)
    // "x..." → one hit per bar → 4 points, not the whole form's 12.
    assert.equal(deriveCurveBeatPoints(obj).positions.length, 4);
});

test("a repeated group replays its per-measure pattern (played order, not folded)", () => {
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            { type: "repeatOpen" }, chord(1), { type: "bar", barStyle: "single" }, chord(5),
            { type: "repeatClose" }, { type: "end" },
        ],
    };
    const obj = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x...", strength: "5" };
    const scene = { timeSignature: [4, 4], harmony, curves: [obj], sprites: [], triggers: [] };

    deriveStrudelCycleLengths(scene);

    assert.deepEqual(obj.chartBarSeq, [0, 1, 0, 1]);
    // 2 folded bars played 4 times; "x..." → one hit per bar → 4 points.
    assert.equal(deriveCurveBeatPoints(obj).positions.length, 4);
});

test("meter change: bar beats are captured; per-row playback is currently uniform", () => {
    const bar = { type: "bar", barStyle: "single" };
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            chord(1), bar, chord(1), bar, chord(1), bar,
            { type: "timeSignature", timeSignature: [2, 4] }, chord(1), bar,
            { type: "timeSignature", timeSignature: [4, 4] }, chord(1), { type: "end" },
        ],
    };
    // The 2/4 meter IS captured in the timeline (kept for the variable-width step).
    assert.deepEqual(chartBarSequence(harmony).barBeats, [4, 4, 4, 2, 4]);

    const obj = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x...", strength: "5" };
    deriveStrudelCycleLengths({ timeSignature: [4, 4], harmony, curves: [obj], sprites: [], triggers: [] });
    assert.deepEqual(obj.chartBarBeats, [4, 4, 4, 2, 4]);

    // PER-ROW model plays a uniform master cells-per-bar for now (variable widths are
    // the pending follow-up): 5 bars × 4 cells = 20, one "x..." hit per bar, evenly spread.
    const pts = deriveCurveBeatPoints(obj);
    assert.equal(pts.positions.length, 5);
    assert.ok(Math.abs(pts.positions[4] - 16 / 20) < 1e-9);
});

test("no chart loaded → timeline cleared, falls back to the grid path", () => {
    const obj = {
        id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", measures: 1, phrases: 2,
        activeBeats: "x...", strength: "5", chartBarSeq: [0, 1], foldedBarCount: 2,
    };
    const scene = { timeSignature: [4, 4], harmony: null, curves: [obj], sprites: [], triggers: [] };

    deriveStrudelCycleLengths(scene);

    assert.equal(obj.chartBarSeq, undefined);
    assert.equal(obj.foldedBarCount, undefined);
    // Grid fallback: measures(1)×cells(4)=4-slot phrase × phrases(2) → "x..." one per phrase = 2.
    assert.equal(deriveCurveBeatPoints(obj).positions.length, 2);
});
