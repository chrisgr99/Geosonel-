// Unit tests for the phrase-sync mapping:
//   src/phraseSync.js — phraseSyncBeat
//
// phraseSyncBeat maps a master beat-pattern object's groove phase (cycleCount +
// cycleProgress, divided into `repeats` groove phrases per sweep) onto a
// base-cycle harmony beat: which chart phrase, and where inside it, snapping
// chord changes to the master's onsets (option B). Pure — runs under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";

import { phraseSyncBeat } from "../src/phraseSync.js";

// Two 4-bar phrases (4/4), base-cycle beats. Four onsets per sweep on the
// quarter-note grid (the master's downbeats).
const PHRASES = [{ start: 0, end: 16 }, { start: 16, end: 32 }];
const ONSETS4 = [0, 0.25, 0.5, 0.75];

test("phraseSyncBeat: no phrases → null", () => {
    assert.equal(phraseSyncBeat({
        phrases: [], cycleCount: 0, cycleProgress: 0, repeats: 1,
        onsets: ONSETS4, reversed: false,
    }), null);
});

test("phraseSyncBeat: sweep start sits at the first phrase's downbeat", () => {
    assert.equal(phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0, repeats: 1,
        onsets: ONSETS4, reversed: false,
    }), 0);
});

test("phraseSyncBeat: chord position snaps DOWN to the most recent onset", () => {
    // cp 0.30 → past the 0.25 onset, before 0.5 → snaps to 0.25 → beat 4 of
    // phrase 0 (0.25 * 16). NOT 0.30*16 = 4.8 (that would be the un-snapped slide).
    assert.equal(phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0.30, repeats: 1,
        onsets: ONSETS4, reversed: false,
    }), 4);
    // cp 0.60 → snaps to 0.5 → beat 8.
    assert.equal(phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0.60, repeats: 1,
        onsets: ONSETS4, reversed: false,
    }), 8);
});

test("phraseSyncBeat: repeats=2 → two groove phrases per sweep, one per chart phrase", () => {
    const base = {
        phrases: PHRASES, cycleCount: 0, repeats: 2, onsets: ONSETS4, reversed: false,
    };
    // First half of the sweep → groove phrase 0 → chart phrase 0.
    assert.equal(phraseSyncBeat({ ...base, cycleProgress: 0.10 }), 0); // before onset 0.25? onset 0 → start
    // cp 0.30 in phrase 0 ([0,0.5)): onsets 0,0.25 → snaps 0.25 → local 0.5 → beat 8.
    assert.equal(phraseSyncBeat({ ...base, cycleProgress: 0.30 }), 8);
    // Second half → groove phrase 1 → chart phrase 1. cp 0.60: onsets 0.5 → local 0 → phrase 1 start = 16.
    assert.equal(phraseSyncBeat({ ...base, cycleProgress: 0.60 }), 16);
    // cp 0.80: onsets 0.5,0.75 → snaps 0.75 → local 0.5 → 16 + 0.5*16 = 24.
    assert.equal(phraseSyncBeat({ ...base, cycleProgress: 0.80 }), 24);
});

test("phraseSyncBeat: the chart phrase index wraps across sweeps", () => {
    // repeats=1: sweep 0 → phrase 0, sweep 1 → phrase 1, sweep 2 → phrase 0 again.
    const at = (cc) => phraseSyncBeat({
        phrases: PHRASES, cycleCount: cc, cycleProgress: 0, repeats: 1,
        onsets: ONSETS4, reversed: false,
    });
    assert.equal(at(0), 0);   // phrase 0 start
    assert.equal(at(1), 16);  // phrase 1 start
    assert.equal(at(2), 0);   // wrapped to phrase 0 start
});

test("phraseSyncBeat: reversed sweep maps onsets by 1 - f but plays the chart forward", () => {
    // Reversed: an onset at path fraction f is reached at time-progress 1 - f.
    // At cp 0.30, the most recent onset (g <= 0.30) comes from f = 0.75 → g 0.25.
    // local 0.25 → beat 4 of phrase 0. Chart still advances forward in time.
    assert.equal(phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0.30, repeats: 1,
        onsets: ONSETS4, reversed: true,
    }), 4);
});

test("phraseSyncBeat: no onsets → proportional slide (no snapping)", () => {
    // cp 0.30, no onsets → 0.30 * 16 = 4.8 (the un-snapped position).
    assert.equal(phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0.30, repeats: 1,
        onsets: [], reversed: false,
    }), 4.8);
});

test("phraseSyncBeat: before the first onset of a groove phrase, holds the phrase start", () => {
    // Onsets only at 0.5 and 0.75 (none at the phrase start). cp 0.20 has no
    // onset behind it → holds phrase 0's first chord (beat 0), not a slide.
    assert.equal(phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0.20, repeats: 1,
        onsets: [0.5, 0.75], reversed: false,
    }), 0);
});

test("phraseSyncBeat: cycleProgress at the very top of the sweep stays in the last groove phrase", () => {
    // cp → 1 must not index past the last groove phrase (clamped below 1).
    const beat = phraseSyncBeat({
        phrases: PHRASES, cycleCount: 0, cycleProgress: 0.999999999, repeats: 2,
        onsets: ONSETS4, reversed: false,
    });
    // Groove phrase 1 → chart phrase 1 → between 16 and 32.
    assert.ok(beat >= 16 && beat < 32, `expected phrase 1 range, got ${beat}`);
});
