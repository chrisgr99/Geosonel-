// Variable-length phrases: a chart-following object carries a `phraseBars` list
// (one entry per chart phrase, length in bars) so its phrases are DIFFERENT
// lengths laid end to end — the basis for following a chart's irregular phrase
// structure. Verifies the per-phrase slot maths, that each phrase still loops its
// own pattern + strength (ghost/fill-forward preserved), and that an object with
// no list is unaffected. Pure → `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveCurveBeatPoints, chartPhraseSlots } from "../src/beatPoints.js";

function curve(fields) {
    return { id: "CRV1", beatPointsMode: "normal", activeBeats: "", strength: "", beatPattern: "", ...fields };
}
const approx = (a, b) => Math.abs(a - b) < 1e-9;

test("chartPhraseSlots: phraseBars × cells-per-bar, or null when absent", () => {
    assert.deepEqual(chartPhraseSlots({ phraseBars: [2, 1, 4], beatsPerBar: 4 }), [8, 4, 16]);
    assert.deepEqual(chartPhraseSlots({ phraseBars: [8, 6], beatsPerBar: 1 }), [8, 6]);
    assert.equal(chartPhraseSlots({ beatsPerBar: 4 }), null);          // no list → uniform
    assert.equal(chartPhraseSlots({ phraseBars: [] }), null);
    assert.equal(chartPhraseSlots(null), null);
});

test("variable phrases: a 2-bar then 1-bar phrase lay end to end, each looping its pattern", () => {
    // cells/bar = 4 → slots [8, 4], total 12. Pattern "x..." → one hit per 4 slots.
    const pts = deriveCurveBeatPoints(curve({
        phraseBars: [2, 1], beatsPerBar: 4, activeBeats: "x...", strength: "5",
    }));
    // phrase 0 (8 slots): hits at slot 0 and 4 → 0/12, 4/12; phrase 1 (4 slots): slot 0 → 8/12.
    assert.equal(pts.positions.length, 3);
    assert.ok(approx(pts.positions[0], 0));
    assert.ok(approx(pts.positions[1], 4 / 12));
    assert.ok(approx(pts.positions[2], 8 / 12));
    assert.deepEqual(pts.strengths, [5, 5, 5]);
});

test("variable phrases honour PER-PHRASE patterns (fill-forward across uneven lengths)", () => {
    // phrase 0 "x...", phrase 1 "xx.." — both 1 bar (4 slots) → total 8.
    const pts = deriveCurveBeatPoints(curve({
        phraseBars: [1, 1], beatsPerBar: 4, phrasePatterns: "x...,xx..", strength: "5",
    }));
    // phrase 0: hit at 0 → 0/8; phrase 1: hits at slots 0,1 → 4/8, 5/8.
    assert.equal(pts.positions.length, 3);
    assert.ok(approx(pts.positions[0], 0));
    assert.ok(approx(pts.positions[1], 4 / 8));
    assert.ok(approx(pts.positions[2], 5 / 8));
});

test("variable phrases keep ghost (inactive) positions for the rests", () => {
    const pts = deriveCurveBeatPoints(curve({
        phraseBars: [1, 1], beatsPerBar: 4, activeBeats: "x...", strength: "5",
    }));
    // 8 slots, 2 active (one per phrase) → 6 inactive ghost positions.
    assert.equal(pts.positions.length, 2);
    assert.equal(pts.inactivePositions.length, 6);
});

test("no phraseBars → identical to the uniform path (regression)", () => {
    const uniform = deriveCurveBeatPoints(curve({ beatsPerCycle: 4, phrases: 3, activeBeats: "x...", strength: "5" }));
    // 3 phrases × one hit each, evenly spread.
    assert.equal(uniform.positions.length, 3);
    assert.ok(approx(uniform.positions[0], 0));
    assert.ok(approx(uniform.positions[1], 4 / 12));
    assert.ok(approx(uniform.positions[2], 8 / 12));
});
