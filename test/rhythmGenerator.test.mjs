// Unit tests for the Auto rhythm generator (M1: structural onsets) —
//   src/rhythmGenerator.js — generatePhrase / metricStrength.
//
// generatePhrase reads a RhythmStyle's rhythm core { density, syncopation,
// dynamicRange, salt } and a meter, and returns the Active Beats (x/./digit) and
// Beat Strength (0-9) strings. Pure + deterministic — with no `dice` it draws a
// structural die from (salt, slot index). Runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generatePhrase, metricStrength } from "../src/rhythmGenerator.js";

const onsetCount = (s) => [...s].filter((c) => c === "x").length;

/** Onset rate on strong (m >= 0.7) vs off (m <= 0.3) slots for a 4/4 phrase. */
function strongVsOff(activeBeats) {
    let strongOn = 0, strong = 0, offOn = 0, off = 0;
    for (let i = 0; i < activeBeats.length; i += 1) {
        const m = metricStrength(i % 4, 4);
        const on = activeBeats[i] === "x";
        if (m >= 0.7) { strong += 1; if (on) strongOn += 1; }
        else if (m <= 0.3) { off += 1; if (on) offOn += 1; }
    }
    return { strong: strongOn / strong, off: offOn / off };
}

// ---- metricStrength ------------------------------------------------------

test("metricStrength: downbeat strongest, mid-bar next, on/off beats below", () => {
    assert.equal(metricStrength(0, 4), 1);    // downbeat
    assert.equal(metricStrength(2, 4), 0.7);  // mid-bar
    assert.equal(metricStrength(1, 4), 0.3);  // off-beat (odd)
    assert.equal(metricStrength(3, 4), 0.3);
    assert.equal(metricStrength(0, 3), 1);    // 3/4 downbeat
    assert.equal(metricStrength(2, 3), 0.5);  // 3/4 on-beat (even, not mid)
});

// ---- generatePhrase ------------------------------------------------------

test("generatePhrase: output length equals beatsPerPhrase", () => {
    const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, core: { density: 0.5 } });
    assert.equal(r.activeBeats.length, 16);
    assert.equal(r.strength.length, 16);
});

test("generatePhrase: deterministic — same inputs, same pattern", () => {
    const core = { density: 0.5, syncopation: 0.2, dynamicRange: 0.5, salt: 3 };
    const a = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, core });
    const b = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, core });
    assert.equal(a.activeBeats, b.activeBeats);
    assert.equal(a.strength, b.strength);
});

test("generatePhrase: the phrase downbeat always sounds", () => {
    for (const density of [0, 0.5, 1]) {
        const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 8, core: { density } });
        assert.equal(r.activeBeats[0], "x");
    }
});

test("generatePhrase: higher density yields more onsets", () => {
    const sparse = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, core: { density: 0.15 } });
    const dense = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, core: { density: 0.9 } });
    assert.ok(onsetCount(dense.activeBeats) > onsetCount(sparse.activeBeats));
});

test("generatePhrase: no syncopation favours the strong beats over the off-beats", () => {
    const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 64, core: { density: 0.4, syncopation: 0 } });
    const rate = strongVsOff(r.activeBeats);
    assert.ok(rate.strong > rate.off);
});

test("generatePhrase: full syncopation flips the preference toward the off-beats", () => {
    const r = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 64, core: { density: 0.5, syncopation: 1 } });
    const rate = strongVsOff(r.activeBeats);
    assert.ok(rate.off > rate.strong);
});

test("generatePhrase: dice overrides the structural die (low fills, high empties but the downbeat)", () => {
    const N = 16;
    const filled = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: N, core: { density: 0.5 }, dice: new Array(N).fill(0) });
    const sparse = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: N, core: { density: 0.5 }, dice: new Array(N).fill(0.99) });
    assert.equal(filled.activeBeats, "x".repeat(N));        // all-low dice → every slot sounds
    assert.equal(onsetCount(sparse.activeBeats), 1);        // all-high dice → only the anchored downbeat
    assert.equal(sparse.activeBeats[0], "x");
});

test("generatePhrase: dynamicRange controls the strength spread; digits stay 0-9", () => {
    const flat = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, core: { density: 1, dynamicRange: 0 } });
    const punchy = generatePhrase({ beatsPerBar: 4, beatsPerPhrase: 16, core: { density: 1, dynamicRange: 1 } });
    for (const ch of flat.strength + punchy.strength) {
        const d = Number(ch);
        assert.ok(Number.isInteger(d) && d >= 0 && d <= 9);
    }
    assert.equal(new Set([...flat.strength]).size, 1);      // dynamicRange 0 → flat strength
    assert.ok(new Set([...punchy.strength]).size > 1);      // dynamicRange 1 → varied by meter
});
