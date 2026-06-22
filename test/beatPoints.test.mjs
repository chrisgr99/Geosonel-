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

import { deriveCurveBeatPoints, splitMeasures, resolveMeasures } from "../src/beatPoints.js";

function curve(fields) {
    return { id: "CRV1", beatPointsMode: "normal", activeBeats: "", strength: "", beatPattern: "", ...fields };
}

/** A strudel measure-pattern curve; flat patterns (digits/~) derive offline. */
function strudel(beatPattern, measures, repeats) {
    return { id: "CRV1", beatPointsMode: "strudel", beatPattern, measures, repeats };
}

test("splitMeasures: top-level | splits, bracket | survives", () => {
    assert.deepEqual(splitMeasures("9 5 | 7 5"), ["9 5", "7 5"]);
    assert.deepEqual(splitMeasures("9 [5|7] | 3 5"), ["9 [5|7]", "3 5"]);
    assert.deepEqual(splitMeasures("9 5 ||~ 9|"), ["9 5", "", "~ 9", ""]);
});

test("resolveMeasures: empty box inherits the nearest filled box to its left", () => {
    assert.deepEqual(resolveMeasures(splitMeasures("9 5 ||~ 9|"), 4), ["9 5", "9 5", "~ 9", "~ 9"]);
    // A leading empty has nothing to inherit → a rest ("").
    assert.deepEqual(resolveMeasures(splitMeasures("| 7 5"), 2), ["", "7 5"]);
    // Fewer segments than M: the tail inherits the last filled.
    assert.deepEqual(resolveMeasures(["9"], 3), ["9", "9", "9"]);
});

test("two measures: each fills its own half of the path", () => {
    const r = deriveCurveBeatPoints(strudel("9 5 | 7 5", 2, 1));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [9, 5, 7, 5]);
});

test("repeats tiles the whole phrase around the path", () => {
    // 1-measure phrase × 2 repeats = the bar twice.
    const r = deriveCurveBeatPoints(strudel("9 5", 1, 2));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [9, 5, 9, 5]);
});

test("fill-down: an empty measure repeats the previous bar", () => {
    const r = deriveCurveBeatPoints(strudel("9 5 |", 2, 1));   // bar 2 empty → inherits bar 1
    assert.deepEqual(r.strengths, [9, 5, 9, 5]);
});

test("a ~ measure is a silent bar (no beats placed in its slice)", () => {
    const r = deriveCurveBeatPoints(strudel("9 5 | ~ | 7 5", 3, 1));
    // bar 1 in [0, 1/3), bar 2 (~) silent, bar 3 in [2/3, 1).
    assert.deepEqual(r.strengths, [9, 5, 7, 5]);
    assert.ok(r.positions.every((p) => p < 1 / 3 || p >= 2 / 3));
});

test("token sources: each beat maps to its source box + char span", () => {
    const r = deriveCurveBeatPoints(strudel("9 ~ 5 | 7 5", 2, 1));
    assert.deepEqual(r.sources, [
        { measure: 0, start: 0, end: 1 },   // "9"
        { measure: 0, start: 4, end: 5 },   // "5" (the ~ at 2 is skipped)
        { measure: 1, start: 0, end: 1 },   // "7"
        { measure: 1, start: 2, end: 3 },   // "5"
    ]);
});

test("token sources: an inherited bar sources the FILLED box it repeats", () => {
    const r = deriveCurveBeatPoints(strudel("9 5 |", 2, 1));   // bar 2 inherits bar 1
    assert.equal(r.sources.length, 4);
    assert.ok(r.sources.every((s) => s && s.measure === 0));    // all light box 0
});

test("canvas token NcM: base strength + canvas swing in `ranges` (stays flat)", () => {
    const r = deriveCurveBeatPoints(strudel("9 7c2 5 c3", 1, 1));
    assert.deepEqual(r.strengths, [9, 7, 5, 0]);        // base; cM → base 0
    assert.deepEqual(r.ranges, [0, 2, 0, 3]);            // 0 = fixed, > 0 = ±swing
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]); // placed natively (no engine)
});

test("canvas token highlights as one whole token", () => {
    const r = deriveCurveBeatPoints(strudel("9 7c2", 1, 1));
    assert.deepEqual(r.sources, [
        { measure: 0, start: 0, end: 1 },   // "9"
        { measure: 0, start: 2, end: 5 },   // "7c2" — the whole token
    ]);
});

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

test("euclidean derives like Manual: the strength string loops over its length", () => {
    // Euclidean now flows through the same looped derivation as Manual, so a
    // short strength string loops (modulo its length) rather than defaulting.
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "euclidean", activeBeats: "xxxx", strength: "12" }));
    assert.deepEqual(r.positions, [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(r.strengths, [1, 2, 1, 2]);
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

test("euclidean: an all-rest pattern (k=0 result) yields no beat points", () => {
    const r = deriveCurveBeatPoints(curve({ beatPointsMode: "euclidean", activeBeats: "........", strength: "99999999" }));
    assert.deepEqual(r.positions, []);
    assert.deepEqual(r.strengths, []);
});

test("repeats lays N copies of the pattern end-to-end (N x beat points)", () => {
    // "x.x." (4 slots, beats at 0 & 2) with beatsPerCycle 4 and repeats 3 →
    // 12 slots, the pattern tiled 3 times, beats at 0,2,4,6,8,10 of 12.
    const r = deriveCurveBeatPoints(curve({
        beatPointsMode: "euclidean", activeBeats: "x.x.", strength: "9999",
        beatsPerCycle: 4, repeats: 3,
    }));
    assert.deepEqual(r.positions, [0, 2 / 12, 4 / 12, 6 / 12, 8 / 12, 10 / 12]);
    assert.equal(r.positions.length, 6); // 2 beats per copy x 3 copies
});

test("repeats defaults to 1 (one copy) when absent or < 1", () => {
    const one = deriveCurveBeatPoints(curve({ activeBeats: "x.x.", strength: "9999", beatsPerCycle: 4 }));
    const zero = deriveCurveBeatPoints(curve({ activeBeats: "x.x.", strength: "9999", beatsPerCycle: 4, repeats: 0 }));
    assert.deepEqual(one.positions, [0, 0.5]);
    assert.deepEqual(zero.positions, [0, 0.5]);
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

// ---- Pattern variation (vary = max flips/cycle, varySeed, per-Repeat) ----

const onsetCount = (r) => r.positions.length;

test("vary 0 (or absent) leaves the pattern exactly as authored", () => {
    const fields = { activeBeats: "x.x.x.x.", strength: "9", beatsPerCycle: 8 };
    const off = deriveCurveBeatPoints(curve(fields));
    const zero = deriveCurveBeatPoints(curve({ ...fields, vary: 0, varySeed: 99 }));
    assert.equal(off.positions.length, 4);                 // 4 onsets
    assert.deepEqual(zero.positions, off.positions);       // vary 0 == unchanged
    assert.deepEqual(zero.strengths, off.strengths);
});

test("vary flips at most `vary` notes per cycle (a delta from the original)", () => {
    // 8-slot pattern, 4 onsets. With vary up to 2, the onset count can move by at
    // most 2 from the original (4) on a single cycle (reps 1).
    const base = { activeBeats: "x.x.x.x.", strength: "9", beatsPerCycle: 8, repeats: 1 };
    for (let seed = 0; seed < 25; seed++) {
        const r = deriveCurveBeatPoints(curve({ ...base, vary: 2, varySeed: seed }));
        assert.ok(Math.abs(onsetCount(r) - 4) <= 2, `seed ${seed}: ${onsetCount(r)} onsets`);
    }
});

test("vary is deterministic per seed and varies across seeds", () => {
    const fields = { activeBeats: "x.x.x.x.x.x.x.x.", strength: "9", beatsPerCycle: 16, vary: 3 };
    const a1 = deriveCurveBeatPoints(curve({ ...fields, varySeed: 1 }));
    const a2 = deriveCurveBeatPoints(curve({ ...fields, varySeed: 1 }));
    const b = deriveCurveBeatPoints(curve({ ...fields, varySeed: 7 }));
    assert.deepEqual(a1.positions, a2.positions);          // same seed → same pattern
    assert.notDeepEqual(a1.positions, b.positions);        // different seed → different
});

test("each Repeat (cycle) is its own variation — the tiles differ", () => {
    // 8-slot pattern, 3 repeats, vary 2. Split the 24 slots into 3 cycles; at least
    // two of them should differ (independent per-cycle deltas, not one tiled cycle).
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x.x.x.x.", strength: "9", beatsPerCycle: 8, repeats: 3, vary: 2, varySeed: 4 }));
    // Onsets land at i/24; bucket them by cycle (0..7, 8..15, 16..23).
    const cyc = [new Set(), new Set(), new Set()];
    for (const p of r.positions) { const i = Math.round(p * 24); cyc[Math.floor(i / 8)].add(i % 8); }
    const keys = cyc.map((s) => [...s].sort((a, b) => a - b).join(","));
    assert.ok(new Set(keys).size >= 2, `cycles should differ: ${keys.join(" | ")}`);
});

test("vary keeps the authored pattern length (loops, not expanded to beatsPerCycle)", () => {
    // A 4-char pattern over an 8-beat cycle: the varied 4-cell pattern LOOPS to fill
    // the cycle, so the two halves are identical — it is not expanded to 8 cells
    // with the looped copies flipped independently.
    const r = deriveCurveBeatPoints(curve({ activeBeats: "x.x.", strength: "9", beatsPerCycle: 8, vary: 1, varySeed: 5 }));
    const beats = r.positions.map((p) => Math.round(p * 8));      // beat indices 0..7
    const firstHalf = beats.filter((b) => b < 4);
    const secondHalf = beats.filter((b) => b >= 4).map((b) => b - 4);
    assert.deepEqual(firstHalf, secondHalf);                       // the 4-cell varied pattern tiles
});

test("vary protects the downbeat — slot 0 flips far less often than uniform", () => {
    // All-active 8-cell pattern, vary 1: each cycle one cell flips to a rest. The
    // downbeat (beat 0) should go silent far less than a uniform 1/8 would predict.
    const trials = 400;
    let downbeatLost = 0;
    let anyLost = 0;
    for (let s = 0; s < trials; s++) {
        const r = deriveCurveBeatPoints(curve({ activeBeats: "xxxxxxxx", strength: "9", beatsPerCycle: 8, vary: 1, varySeed: s }));
        const beats = new Set(r.positions.map((p) => Math.round(p * 8)));
        if (!beats.has(0)) downbeatLost++;
        if (beats.size < 8) anyLost++;
    }
    assert.ok(anyLost > trials * 0.5, "variation should usually flip a cell");   // feature is live
    assert.ok(downbeatLost < trials / 16, `downbeat lost ${downbeatLost}/${trials} (uniform would be ~${trials / 8})`);
});

test("vary protects the first beat of EACH bar (uses the time signature)", () => {
    // 8 cells, 4 beats/bar → bars start at 0 and 4; BOTH should be protected.
    const trials = 400;
    const lost = new Array(8).fill(0);
    for (let s = 0; s < trials; s++) {
        const r = deriveCurveBeatPoints(curve({ activeBeats: "xxxxxxxx", strength: "9", beatsPerCycle: 8, beatsPerBar: 4, vary: 1, varySeed: s }));
        const on = new Set(r.positions.map((p) => Math.round(p * 8)));
        for (let b = 0; b < 8; b++) if (!on.has(b)) lost[b]++;
    }
    const downbeats = (lost[0] + lost[4]) / 2;
    const others = (lost[1] + lost[2] + lost[3] + lost[5] + lost[6] + lost[7]) / 6;
    assert.ok(downbeats < others / 2, `bar downbeats lost ~${downbeats} avg vs others ~${others.toFixed(1)} avg`);
});

test("vary added onsets take the looped strength digit", () => {
    // All rests, strength "5", 2-slot cycle: with vary 2 both slots can flip to
    // onsets, and any onset uses strength 5.
    const r = deriveCurveBeatPoints(curve({ activeBeats: "..", strength: "5", beatsPerCycle: 2, vary: 2, varySeed: 3 }));
    for (const s of r.strengths) assert.equal(s, 5);
    assert.ok(r.positions.length >= 1);
});
