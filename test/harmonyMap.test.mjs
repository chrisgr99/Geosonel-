// Unit tests for src/harmonyMap.js — the GeoSonix chord-tone-index model:
//   chordPitchClasses / chordTonesInRange / qualityIntervals / mapToHarmonyCore
//   / chordStructure.
//
// Pure module — no DOM, no esm.sh — so this runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  qualityIntervals,
  chordPitchClasses,
  chordTonesInRange,
  mapRange,
  mapToHarmonyCore,
  chordStructure,
} from "../src/harmonyMap.js";

/** @type {import("../src/irealChord.js").Key} */
const C = { tonicPitchClass: 0, mode: "major" };

/** Build a key-relative chord cell. */
function chord(degree, accidental, quality) {
  return { degree, accidental, quality, raw: "" };
}

// --- qualityIntervals ------------------------------------------------------

test("qualityIntervals: triads and sevenths", () => {
  assert.deepEqual(qualityIntervals(""), [0, 4, 7]);
  assert.deepEqual(qualityIntervals("-"), [0, 3, 7]);
  assert.deepEqual(qualityIntervals("+"), [0, 4, 8]);
  assert.deepEqual(qualityIntervals("7"), [0, 4, 7, 10]);
  assert.deepEqual(qualityIntervals("^7"), [0, 4, 7, 11]);
  assert.deepEqual(qualityIntervals("-7"), [0, 3, 7, 10]);
  assert.deepEqual(qualityIntervals("h7"), [0, 3, 6, 10]);
  assert.deepEqual(qualityIntervals("o7"), [0, 3, 6, 9]);
  assert.deepEqual(qualityIntervals("6"), [0, 4, 7, 9]);
  assert.deepEqual(qualityIntervals("-6"), [0, 3, 7, 9]);
});

test("qualityIntervals: extensions and alterations stack/adjust", () => {
  assert.deepEqual(qualityIntervals("9"), [0, 4, 7, 10, 14]);
  assert.deepEqual(qualityIntervals("13"), [0, 4, 7, 10, 14, 21]);
  // b9 adds the flat-9 to a dom7 WITHOUT a spurious natural 9.
  assert.deepEqual(qualityIntervals("7b9"), [0, 4, 7, 10, 13]);
  // #11 adds the sharp-11 to a dom7.
  assert.deepEqual(qualityIntervals("7#11"), [0, 4, 7, 10, 18]);
  // sus replaces the 3rd with the 4th on a dom7.
  assert.deepEqual(qualityIntervals("7sus"), [0, 5, 7, 10]);
  // alt drops the perfect 5th and adds b5/#5/b9/#9.
  assert.deepEqual(qualityIntervals("7alt"), [0, 4, 6, 8, 10, 13, 15]);
});

test("qualityIntervals: unknown suffix never empties or throws", () => {
  const r = qualityIntervals("wat");
  assert.ok(Array.isArray(r) && r.length >= 3);
  assert.equal(r[0], 0);
});

// --- chordPitchClasses -----------------------------------------------------

test("chordPitchClasses: I maj7 in C -> {0,4,7,11}", () => {
  assert.deepEqual(chordPitchClasses(chord(1, "", "^7"), C), [0, 4, 7, 11]);
});

test("chordPitchClasses: V7 in C -> {7,11,2,5} (sorted 2,5,7,11)", () => {
  assert.deepEqual(chordPitchClasses(chord(5, "", "7"), C), [2, 5, 7, 11]);
});

test("chordPitchClasses: vi (minor triad) in C -> {9,0,4} (sorted 0,4,9)", () => {
  assert.deepEqual(chordPitchClasses(chord(6, "", "-"), C), [0, 4, 9]);
});

test("chordPitchClasses: viiø7 in C -> {11,2,5,9} (sorted 2,5,9,11)", () => {
  assert.deepEqual(chordPitchClasses(chord(7, "", "h7"), C), [2, 5, 9, 11]);
});

test("chordPitchClasses: ii dim7 in C -> {2,5,8,11}", () => {
  assert.deepEqual(chordPitchClasses(chord(2, "", "o7"), C), [2, 5, 8, 11]);
});

test("chordPitchClasses: null / No-Chord -> empty", () => {
  assert.deepEqual(chordPitchClasses(null, C), []);
  assert.deepEqual(chordPitchClasses(undefined, C), []);
});

// --- chordTonesInRange -----------------------------------------------------

test("chordTonesInRange: Cmaj7 over 40..70 is ascending and only chord tones", () => {
  const tones = chordTonesInRange(chord(1, "", "^7"), C, 40, 70);
  // C, E, G, B pitch classes = 0,4,7,11. Ascending, in [40,70].
  assert.deepEqual(tones, [40, 43, 47, 48, 52, 55, 59, 60, 64, 67]);
  // Strictly ascending.
  for (let i = 1; i < tones.length; i++) assert.ok(tones[i] > tones[i - 1]);
  // Every tone is a chord pitch class.
  const pcs = new Set([0, 4, 7, 11]);
  for (const n of tones) assert.ok(pcs.has(n % 12));
});

test("chordTonesInRange: empty for null chord or empty range", () => {
  assert.deepEqual(chordTonesInRange(null, C, 40, 70), []);
  assert.deepEqual(chordTonesInRange(chord(1, "", "^7"), C, 70, 40).length, 0);
});

// --- mapRange (clamping) ---------------------------------------------------

test("mapRange: clamps source value and handles degenerate range", () => {
  assert.equal(mapRange(0.5, 0, 1, 0, 10), 5);
  assert.equal(mapRange(-1, 0, 1, 0, 10), 0); // clamped below
  assert.equal(mapRange(2, 0, 1, 0, 10), 10); // clamped above
  assert.equal(mapRange(7, 5, 5, 3, 9), 3); // degenerate -> low2
});

// --- mapToHarmonyCore ----------------------------------------------------------

test("mapToHarmonyCore: endpoints and midpoint pick lowest/highest/middle tones", () => {
  const ch = chord(1, "", "^7");
  const tones = chordTonesInRange(ch, C, 40, 70);
  const lowest = tones[0];
  const highest = tones[tones.length - 1];
  assert.equal(mapToHarmonyCore(ch, C, 0, 0, 1, 40, 70), lowest);
  assert.equal(mapToHarmonyCore(ch, C, 1, 0, 1, 40, 70), highest);
  const mid = mapToHarmonyCore(ch, C, 0.5, 0, 1, 40, 70);
  assert.ok(mid > lowest && mid < highest);
});

test("mapToHarmonyCore: every result is an actual chord tone", () => {
  const ch = chord(5, "", "7");
  const tones = new Set(chordTonesInRange(ch, C, 40, 70));
  for (let v = 0; v <= 1.0001; v += 0.05) {
    const n = mapToHarmonyCore(ch, C, v, 0, 1, 40, 70);
    assert.ok(tones.has(n), `value ${v} -> ${n} not a chord tone`);
  }
});

test("mapToHarmonyCore: clamps values outside [low,high] to the endpoints", () => {
  const ch = chord(1, "", "^7");
  const tones = chordTonesInRange(ch, C, 40, 70);
  assert.equal(mapToHarmonyCore(ch, C, -5, 0, 1, 40, 70), tones[0]);
  assert.equal(mapToHarmonyCore(ch, C, 9, 0, 1, 40, 70), tones[tones.length - 1]);
});

test("mapToHarmonyCore: no-chord fallback maps linearly across the MIDI range", () => {
  // null chord -> linear map of value across [rangeLow, rangeHigh], rounded.
  assert.equal(mapToHarmonyCore(null, C, 0, 0, 1, 40, 70), 40);
  assert.equal(mapToHarmonyCore(null, C, 1, 0, 1, 40, 70), 70);
  assert.equal(mapToHarmonyCore(null, C, 0.5, 0, 1, 40, 70), 55);
  // No key also degrades to the linear fallback.
  assert.equal(mapToHarmonyCore(chord(1, "", "^7"), null, 0.5, 0, 1, 40, 70), 55);
});

// --- chordStructure --------------------------------------------------------

test("chordStructure: C maj7 in C -> root 48, notes [0,4,7,11]", () => {
  assert.deepEqual(chordStructure(chord(1, "", "^7"), C), {
    root: 48,
    notes: [0, 4, 7, 11],
  });
});

test("chordStructure: C minor-7 in C -> root 48, notes [0,3,7,10]", () => {
  assert.deepEqual(chordStructure(chord(1, "", "-7"), C), {
    root: 48,
    notes: [0, 3, 7, 10],
  });
});

test("chordStructure: iv min7 (degree 4 in C) -> root at F (53), notes [0,3,7,10]", () => {
  // Degree 4 in C major resolves to F (pitch class 5) -> root MIDI 48+5 = 53.
  assert.deepEqual(chordStructure(chord(4, "", "-7"), C), {
    root: 53,
    notes: [0, 3, 7, 10],
  });
});

test("chordStructure: dominant 7th -> notes [0,4,7,10]", () => {
  assert.deepEqual(chordStructure(chord(5, "", "7"), C).notes, [0, 4, 7, 10]);
});

test("chordStructure: dom9 folds the 9th (14) down to 2", () => {
  // [0,4,7,10,14] -> 14 % 12 = 2, so notes include 2.
  assert.deepEqual(chordStructure(chord(5, "", "9"), C).notes, [0, 2, 4, 7, 10]);
});

test("chordStructure: null / no-chord cell -> null", () => {
  assert.equal(chordStructure(null, C), null);
  assert.equal(chordStructure(undefined, C), null);
  assert.equal(chordStructure({ degree: null, quality: "", raw: "" }, C), null);
});

test("chordStructure: baseMidi shifts the root octave", () => {
  assert.equal(chordStructure(chord(1, "", "^7"), C, 60).root, 60);
});

test("chordStructure: notes are folded 0-11, sorted ascending, include 0", () => {
  // dom13 has wide intervals (incl. 21); every note must fold into 0..11.
  const s = chordStructure(chord(5, "", "13"), C);
  assert.ok(s !== null);
  assert.equal(s.notes[0], 0, "first note is the root (0)");
  for (let i = 0; i < s.notes.length; i++) {
    assert.ok(s.notes[i] >= 0 && s.notes[i] <= 11, `note ${s.notes[i]} in 0..11`);
    if (i > 0) assert.ok(s.notes[i] > s.notes[i - 1], "strictly ascending (deduped)");
  }
});
