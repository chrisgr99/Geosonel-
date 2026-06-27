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

const sec = (label) => ({ type: "sectionOpen", label });
const bar1 = { type: "bar", barStyle: "single" };

test("a chartSection LABEL scopes the object to that section (first occurrence)", () => {
    // *A 4 bars  *B 4 bars — assigning "A" scopes the curve to A's 4 bars.
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            sec("A"), chord(1), bar1, chord(2), bar1, chord(3), bar1, chord(4), bar1,
            sec("B"), chord(5), bar1, chord(6), bar1, chord(1), bar1, chord(2), bar1,
            { type: "end" },
        ],
    };
    const obj = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x...", strength: "5", chartSection: "A" };
    deriveStrudelCycleLengths({ timeSignature: [4, 4], harmony, curves: [obj], sprites: [], triggers: [] });

    assert.equal(obj.foldedBarCount, 4);                  // A is 4 bars
    assert.deepEqual(obj.chartBarSeq, [0, 1, 2, 3]);
    assert.equal(obj.chartSectionBars, 4);
    // "x..." → one hit per bar → 4 points, not the whole form's 8.
    assert.equal(deriveCurveBeatPoints(obj).positions.length, 4);
});

test("an unassigned object plays every assigned section (multi-section)", () => {
    // *A 2 · *B 2 · *C 2 — B and C assigned to objects, A to nobody.
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            sec("A"), chord(1), bar1, chord(2), bar1,
            sec("B"), chord(3), bar1, chord(4), bar1,
            sec("C"), chord(5), bar1, chord(6), bar1,
            { type: "end" },
        ],
    };
    const objB = { id: "B1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x.", strength: "5", chartSection: "B" };
    const objC = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x.", strength: "5", chartSection: "C" };
    const objU = { id: "U1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x.,x.", strength: "5" };  // no chartSection
    deriveStrudelCycleLengths({ timeSignature: [4, 4], harmony, curves: [objB, objC, objU], sprites: [], triggers: [] });

    assert.equal(objU.chartMulti, true);
    assert.deepEqual(objU.chartMultiSectionBars, [2, 2]);   // B 2 bars, C 2 bars
    assert.equal(objU.foldedBarCount, 4);                   // editor = B + C concatenated
    assert.equal(objU.chartRowCount, 2);                    // B's row, C's row
    const secs = [...new Set(objU.chartMultiSegs.map((s) => s.sec))].sort();
    assert.deepEqual(secs, [0, 1]);                         // plays both B and C (A dropped)
    // assigned objects stay single-section.
    assert.equal(objB.chartMulti, undefined);
    assert.equal(objB.chartSectionBars, 2);
});

test("a recurring label plays at every occurrence (each its own pass)", () => {
    // *A 2 · *B 2 · *A 2 — assigning "A" binds BOTH A sections.
    const harmony = {
        key: { tonicPitchClass: 0, mode: "major" }, timeSignature: [4, 4],
        progression: [
            sec("A"), chord(1), bar1, chord(2), bar1,
            sec("B"), chord(5), bar1, chord(6), bar1,
            sec("A"), chord(1), bar1, chord(2), bar1,
            { type: "end" },
        ],
    };
    const obj = { id: "C1", beatPointsMode: "chart", beatInterval: "Qtr", phrasePatterns: "x.", strength: "5", chartSection: "A" };
    deriveStrudelCycleLengths({ timeSignature: [4, 4], harmony, curves: [obj], sprites: [], triggers: [] });

    assert.equal(obj.chartSectionBars, 2);                // the cycle = first A (2 bars)
    assert.equal(obj.chartFormSegs.length, 4);            // both A's: 2 + 2 in-section played bars
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
