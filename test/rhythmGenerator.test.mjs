// Unit tests for the Auto rhythm generator (v0):
//   src/rhythmGenerator.js — generatePhrase / metricStrength
//
// Pure, deterministic generation of Active Beats + Beat Strength strings.
// Runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generatePhrase, metricStrength, RHYTHM_STYLES } from "../src/rhythmGenerator.js";

test("metricStrength: downbeat strongest, mid-bar next, on/off beats below", () => {
    assert.equal(metricStrength(0, 4), 1);    // downbeat
    assert.equal(metricStrength(2, 4), 0.7);  // mid-bar
    assert.equal(metricStrength(1, 4), 0.3);  // off-beat (odd)
    assert.equal(metricStrength(3, 4), 0.3);
    assert.equal(metricStrength(0, 3), 1);    // 3/4 downbeat
    assert.equal(metricStrength(2, 3), 0.5);  // 3/4 on-beat (even, not mid)
});

test("generatePhrase: output length equals beatsPerPhrase", () => {
    const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, style: "melody" });
    assert.equal(r.activeBeats.length, 16);
    assert.equal(r.strength.length, 16);
});

test("generatePhrase: deterministic — same inputs, same pattern", () => {
    const a = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, style: "bass" });
    const b = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, style: "bass" });
    assert.deepEqual(a, b);
});

test("generatePhrase: the phrase downbeat always sounds", () => {
    for (const style of ["melody", "lead", "bass"]) {
        const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, style });
        assert.equal(r.activeBeats[0], "x", `${style} should anchor slot 0`);
    }
});

test("generatePhrase: bass is sparse and locks to strong beats", () => {
    // 4/4, two bars. Neutral dice → onsets only where onsetProb > 0.5: bass
    // (slope 1, bias 0) sounds the downbeats (metric 1) and mid-bar (0.7).
    const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, style: "bass" });
    assert.equal(r.activeBeats, "x.x.x.x.");
});

test("generatePhrase: lead is busier than bass", () => {
    const bass = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, style: "bass" });
    const lead = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, style: "lead" });
    const count = (s) => [...s].filter((c) => c === "x").length;
    assert.ok(count(lead.activeBeats) > count(bass.activeBeats),
        `lead ${count(lead.activeBeats)} should exceed bass ${count(bass.activeBeats)}`);
});

test("generatePhrase: strength digits are 0-9 and onsets carry strength >= 1", () => {
    const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, style: "melody" });
    for (let i = 0; i < r.activeBeats.length; i += 1) {
        const d = Number(r.strength[i]);
        assert.ok(Number.isInteger(d) && d >= 0 && d <= 9);
        if (r.activeBeats[i] === "x") assert.ok(d >= 1, `onset ${i} should have strength >= 1`);
    }
});

test("generatePhrase: dice drives onsets (all-low dice fills, all-high empties but the downbeat)", () => {
    const N = 8;
    const lowDice = Array(N).fill(0);   // 0 < onsetProb always → all sound
    const highDice = Array(N).fill(0.999); // beats every onsetProb → only the anchored downbeat
    const filled = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: N, style: "melody", dice: lowDice });
    const sparse = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: N, style: "melody", dice: highDice });
    assert.equal(filled.activeBeats, "xxxxxxxx");
    assert.equal(sparse.activeBeats, "x.......");
});

test("RHYTHM_STYLES exposes melody/lead/bass", () => {
    assert.deepEqual(Object.keys(RHYTHM_STYLES).sort(), ["bass", "lead", "melody"]);
});
