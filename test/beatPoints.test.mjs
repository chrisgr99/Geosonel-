// Unit tests for beat-point derivation (src/beatPoints.js), the
// normal / euclidean paths.
//
// These walk the activeBeats x/dot string and the strength digit
// string — pure string work, no DOM and no Strudel runtime — so they
// run under `node --test`. The Strudel path is NOT exercised here: it
// needs window + the loaded Strudel globals and is verified in the
// browser. beatPoints imports patternParse, which is self-contained
// (it only touches `window` inside its function body), so importing
// the module offline is safe as long as the Strudel path isn't called.

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveCurveBeatPoints } from "../src/beatPoints.js";

function curve(fields) {
    return { id: "CRV1", beatPointsMode: "normal", activeBeats: "", strength: "", beatPattern: "", ...fields };
}

test("mode none yields no beat points", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "none", activeBeats: "x.x." }));
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.strengths, []);
    assert.deepEqual(r.inactivePositions, []);
});

test("mode auto derives from its generated pattern strings (like Manual)", () => {
    // Auto generates into activeBeats/strength, then plays through the same
    // looped derivation as Manual.
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "auto", activeBeats: "x.x.", strength: "9595" }));
    assert.deepEqual(r.positions, [0, 0.5]);
    assert.deepEqual(r.strengths, [9, 9]);
});

test("normal: every-slot pattern places a beat per x at slot fraction", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x.x.", strength: "9595" }));
    assert.deepEqual(r.positions, [0, 0.5]);
    assert.deepEqual(r.strengths, [9, 9]);
});

test("normal: dot slots become inactive positions (drawn small, not fired)", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x.x.", strength: "9595" }));
    // x at slots 0,2 (active); . at slots 1,3 (inactive) -> .25, .75
    assert.deepEqual(r.positions, [0, 0.5]);
    assert.deepEqual(r.inactivePositions, [0.25, 0.75]);
});

test("normal: all-rest pattern is all inactive positions", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "....", strength: "9999" }));
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.inactivePositions, [0, 0.25, 0.5, 0.75]);
});

test("normal: strengths align slot-for-slot, including on rest slots", () => {
    // active at slots 0 and 3 of 4; strengths read at those slots (7 and 4).
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x..x", strength: "7654" }));
    assert.deepEqual(r.positions, [0, 0.75]);
    assert.deepEqual(r.strengths, [7, 4]);
});

test("ratchet: a digit slot becomes that many evenly-spaced sub-hits", () => {
    // 4-slot cycle; slot 1 is a 4-ratchet -> 4 sub-hits across [0.25, 0.5).
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x4x.", strength: "9999" }));
    assert.deepEqual(r.positions, [0, 0.25, 0.3125, 0.375, 0.4375, 0.5]);
    assert.deepEqual(r.strengths, [9, 9, 9, 9, 9, 9]);
    assert.deepEqual(r.inactivePositions, [0.75]);
});

test("ratchet: all sub-hits carry the slot's strength digit", () => {
    // 2-slot cycle; slot 0 = x (strength 7); slot 1 = 2-ratchet (strength 5).
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x2", strength: "75" }));
    assert.deepEqual(r.positions, [0, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [7, 5, 5]);
});

test("ratchet: x is one hit; 0 and . are rests", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x1.0", strength: "9999" }));
    assert.deepEqual(r.positions, [0, 0.25]);
    assert.deepEqual(r.inactivePositions, [0.5, 0.75]);
});

test("bars and whitespace are layout only and ignored", () => {
    const a = deriveCurveBeatPoints(curve({ activeBeats: "x.x.|x.x.", strength: "9999|9999", beatPointsMode: "normal" }));
    // 8 slots, x at 0,2,4,6 -> fractions 0, .25, .5, .75
    assert.deepEqual(a.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(a.strengths, [9, 9, 9, 9]);
});

test("euclidean: missing/non-digit strength slot falls back to default 9 (no loop)", () => {
    // euclidean reads strength slot-for-slot and defaults the rest —
    // it does NOT loop (normal does; see the normal-loop tests below).
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "euclidean", activeBeats: "xxxx", strength: "12" }));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [1, 2, 9, 9]);
});

test("strength digit 0 is a real zero-strength beat (still a beat point)", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "xx", strength: "09" }));
    assert.deepEqual(r.positions, [0, 0.5]);
    assert.deepEqual(r.strengths, [0, 9]);
});

test("euclidean uses the same activeBeats-string path", () => {
    // euclidean stores its generated pattern in activeBeats; derivation
    // is identical to normal.
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "euclidean", activeBeats: "x..x..x.", strength: "99999999" }));
    assert.deepEqual(r.positions, [0, 0.375, 0.75]);
    assert.deepEqual(r.strengths, [9, 9, 9]);
});

test("all-rest pattern yields no beat points", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "....", strength: "9999" }));
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.strengths, []);
});

test("euclidean: empty activeBeats yields no beat points", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "euclidean", activeBeats: "", strength: "" }));
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.strengths, []);
});

// --- Normal mode: the activeBeats and strength strings LOOP (each
// sampled modulo its own length) to fill Per Cycle (beatsPerCycle)
// beats, so a short string drives a long cycle. Normal-only — euclidean
// and strudel do not loop. ---

test("normal loop: short pattern repeats across Per Cycle beats", () => {
    // "xx.x" over 16 beats -> the 4-beat pattern repeats four times;
    // a rest falls on every i where i % 4 === 2.
    const r = deriveCurveBeatPoints(curve({ activeBeats: "xx.x", beatsPerCycle: 16 }));
    const expectedActive = [];
    for (let i = 0; i < 16; i++) if (i % 4 !== 2) expectedActive.push(i / 16);
    assert.deepEqual(r.positions, expectedActive);
    assert.deepEqual(r.inactivePositions, [2 / 16, 6 / 16, 10 / 16, 14 / 16]);
});

test("normal loop: strength string loops independently by beat", () => {
    // all 16 beats active (single 'x'); strength "90" -> 9,0,9,0,...
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x", strength: "90", beatsPerCycle: 16 }));
    assert.equal(r.positions.length, 16);
    const expected = [];
    for (let i = 0; i < 16; i++) expected.push(i % 2 === 0 ? 9 : 0);
    assert.deepEqual(r.strengths, expected);
});

test("normal loop: single 'x' fills the whole cycle (all active)", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x", strength: "9", beatsPerCycle: 4 }));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [9, 9, 9, 9]);
    assert.deepEqual(r.inactivePositions, []);
});

test("normal loop: Per Cycle (not string length) sets the beat count", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x.", beatsPerCycle: 8 }));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.inactivePositions, [1 / 8, 3 / 8, 5 / 8, 7 / 8]);
});

test("normal loop: empty strings fall back to an all-active default grid", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "", strength: "", beatsPerCycle: 3 }));
    assert.deepEqual(r.positions, [0, 1 / 3, 2 / 3]);
    assert.deepEqual(r.strengths, [9, 9, 9]);
});

test("uppercase X is also treated as a beat", () => {
    const r = deriveCurveBeatPoints(curve({ activeBeats: "X.", strength: "9" }));
    assert.deepEqual(r.positions, [0]);
    assert.deepEqual(r.strengths, [9]);
});

// --- Strudel mode: flat space-separated sequences parse natively
// (no engine). Operator patterns route to the engine and aren't
// exercised here.

test("strudel flat: 'x x x x' places four even beats, no engine", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "strudel", beatPattern: "x x x x" }));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [9, 9, 9, 9]);
});

test("strudel flat: '0 3 ~ 9' reads digit strengths; the rest is an inactive position", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "strudel", beatPattern: "0 3 ~ 9" }));
    assert.deepEqual(r.positions, [0, 0.25, 0.75]);
    assert.deepEqual(r.strengths, [0, 3, 9]);
    assert.deepEqual(r.inactivePositions, [0.5]);
});

test("strudel flat: off-grid eighths via rests, rests recorded as inactive", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "strudel", beatPattern: "x ~ x ~ x ~ x ~" }));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [9, 9, 9, 9]);
    assert.deepEqual(r.inactivePositions, [0.125, 0.375, 0.625, 0.875]);
});

test("strudel flat: extra whitespace between tokens is tolerated", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "strudel", beatPattern: "  x   x  " }));
    assert.deepEqual(r.positions, [0, 0.5]);
    assert.deepEqual(r.strengths, [9, 9]);
});

test("strudel empty pattern yields no beat points", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "strudel", beatPattern: "   " }));
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.strengths, []);
});
