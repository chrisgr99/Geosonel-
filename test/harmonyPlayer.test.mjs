// Unit tests for the PURE harmony player: src/harmonyPlayer.js
//   - expandProgression: folded progression → played ChordSpan[] honouring
//     repeats, first/second endings, similes, and intra-bar chord timing.
//   - harmonyAt: current/next/nextAfter/beatsToNext queries, including the
//     loop-seam lookahead and the loop=false ended state.
//
// Progressions are hand-built via tokenizeBody + parseChord so they match the
// REAL folded cell shapes from commit 1 (chord cells carry { chord, raw }).
// Pure modules — no DOM, no esm.sh — so this runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenizeBody } from "../src/irealParse.js";
import { parseChord, parseKey } from "../src/irealChord.js";
import {
  expandProgression,
  harmonyAt,
  HarmonyPlayer,
} from "../src/harmonyPlayer.js";

const KEY_C = parseKey("C");

/**
 * Build a folded progression (the harmonyModel cell shape) from an iReal body
 * string, resolving chords to key-relative Chord objects.
 * @param {string} body
 * @returns {import("../src/harmonyModel.js").ProgressionCell[]}
 */
function build(body) {
  return tokenizeBody(body).map((c) =>
    c.type === "chord" && !c.noChord
      ? { type: "chord", chord: parseChord(c.symbol, KEY_C), raw: c.symbol }
      : c,
  );
}

/** Compact span description: [start,end)deg-quality. */
function describe(spans) {
  return spans.map(
    (s) => `[${s.startBeat},${s.endBeat})` +
      (s.noChord ? "NC" : `${s.chord.degree}${s.chord.quality}`),
  );
}

// --- expandProgression: repeat with N1/N2 endings -------------------------

test("expandProgression: { … } repeat with N1/N2 endings plays both passes", () => {
  // {C |Am N1 Dm |G } N2 |C
  // Pass 1: C Am Dm G   Pass 2: C Am C
  const exp = expandProgression(build("{C|A-|N1D-|G}N2C Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), [
    "[0,4)1",   // C  (I)   pass 1
    "[4,8)6-",  // Am (vi)  pass 1
    "[8,12)2-", // Dm (ii)  N1, pass 1
    "[12,16)5", // G  (V)   N1, pass 1
    "[16,20)1", // C  (I)   pass 2
    "[20,24)6-",// Am (vi)  pass 2
    "[24,28)1", // C  (I)   N2, pass 2
  ]);
  assert.equal(exp.totalBeats, 28);
  assert.deepEqual(exp.notes, []);
});

test("expandProgression: the repeated bars appear twice", () => {
  // The bars before the first ending (C, Am) play on BOTH passes.
  const exp = expandProgression(build("{C|A-|N1D-|G}N2C Z"), [4, 4]);
  const degrees = exp.spans.map((s) => s.chord.degree);
  // Two I's and two vi's from the repeated head, one ii + one V (N1), one I (N2).
  assert.equal(degrees.filter((d) => d === 1).length, 3); // C×2 head + N2 C
  assert.equal(degrees.filter((d) => d === 6).length, 2); // Am ×2 head
  assert.equal(degrees.filter((d) => d === 2).length, 1); // Dm only on N1
});

test("expandProgression: simple {A|B} repeat plays twice (default 2 passes)", () => {
  const exp = expandProgression(build("{C|G} Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,4)1", "[4,8)5", "[8,12)1", "[12,16)5"]);
  assert.equal(exp.totalBeats, 16);
});

// --- expandProgression: 12-bar-blues shape --------------------------------

test("expandProgression: 12-bar blues → 12 bars × beatsPerBar, chords on right beats", () => {
  // C7 C7 C7 C7 | F7 F7 C7 C7 | G7 F7 C7 G7  (one chord per bar, 12 bars)
  const body = "C7|C7|C7|C7|F7|F7|C7|C7|G7|F7|C7|G7 Z";
  const exp = expandProgression(build(body), [4, 4]);
  assert.equal(exp.spans.length, 12);
  assert.equal(exp.totalBeats, 12 * 4);
  // Each bar is a whole-bar span at the right beat.
  exp.spans.forEach((s, i) => {
    assert.equal(s.startBeat, i * 4);
    assert.equal(s.endBeat, (i + 1) * 4);
  });
  // The IV chord (F7) lands at bar 5 (beat 16) and bar 10 (beat 36).
  assert.equal(exp.spans[4].startBeat, 16);
  assert.equal(exp.spans[4].chord.degree, 4);
  assert.equal(exp.spans[9].startBeat, 36);
  assert.equal(exp.spans[9].chord.degree, 4);
  // The V chord (G7) closes the form at bar 12 (beat 44).
  assert.equal(exp.spans[11].startBeat, 44);
  assert.equal(exp.spans[11].chord.degree, 5);
});

// --- expandProgression: intra-bar timing ----------------------------------

test("expandProgression: two adjacent chords in one 4/4 bar split 2+2", () => {
  // F^7 A7 | C   (no comma, no empties → even spread)
  const exp = expandProgression(build("F^7 A7|C Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,2)4^7", "[2,4)67", "[4,8)1"]);
});

test("expandProgression: comma divider pins the second chord onto beat 3", () => {
  // C,G | Am  → comma places C on beat 1, G on beat 3 (2+2 in 4/4)
  const exp = expandProgression(build("C,G|A- Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,2)1", "[2,4)5", "[4,8)6-"]);
});

test("expandProgression: empty (XyQ) cells hold the previous chord's beats", () => {
  // C XyQ G XyQ | F  → C holds beats 1-2, G holds beats 3-4
  const exp = expandProgression(build("CXyQG XyQ|F Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,2)1", "[2,4)5", "[4,8)4"]);
});

test("expandProgression: one chord fills the whole bar", () => {
  const exp = expandProgression(build("C|G Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,4)1", "[4,8)5"]);
});

test("expandProgression: 3/4 bar respects beatsPerBar = 3", () => {
  const exp = expandProgression(build("C|G Z"), [3, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,3)1", "[3,6)5"]);
  assert.equal(exp.totalBeats, 6);
});

// --- expandProgression: similes -------------------------------------------

test("expandProgression: repeatLastBar (Kcl) duplicates the previous bar", () => {
  const exp = expandProgression(build("C|G|Kcl Z"), [4, 4]);
  assert.deepEqual(describe(exp.spans), ["[0,4)1", "[4,8)5", "[8,12)5"]);
});

test("expandProgression: repeatTwoBars (r) duplicates the previous two bars", () => {
  const exp = expandProgression(build("C|G|r Z"), [4, 4]);
  // C G then the two-bar simile reproduces C, G again.
  assert.deepEqual(describe(exp.spans), [
    "[0,4)1", "[4,8)5", "[8,12)1", "[12,16)5",
  ]);
});

// --- expandProgression: unmodelled navigation -----------------------------

test("expandProgression: segno/coda navigation is noted, never crashes", () => {
  const exp = expandProgression(build("SC|GQ Z"), [4, 4]);
  // Both bars still expand; a note records the unmodelled markers.
  assert.equal(exp.spans.length, 2);
  assert.ok(exp.notes.some((n) => /segno/.test(n)));
  assert.ok(exp.notes.some((n) => /coda/.test(n)));
});

// --- harmonyAt: current / next / beatsToNext ------------------------------

test("harmonyAt: current/next/nextAfter/beatsToNext mid-piece", () => {
  // C G Am F  (4 whole bars)
  const exp = expandProgression(build("C|G|A-|F Z"), [4, 4]);
  // At beat 5 (inside bar 2, the G span [4,8)):
  const r = harmonyAt(exp, 5, { loop: false });
  assert.equal(r.current.degree, 5);          // G
  assert.equal(r.currentStartBeat, 4);
  assert.equal(r.currentEndBeat, 8);
  assert.equal(r.beatsToNext, 3);             // 8 - 5
  assert.equal(r.next.degree, 6);             // Am
  assert.equal(r.nextAfter.degree, 4);        // F
});

test("harmonyAt: at a span boundary, current is the span STARTING there", () => {
  const exp = expandProgression(build("C|G|A-|F Z"), [4, 4]);
  const r = harmonyAt(exp, 8, { loop: false }); // start of Am [8,12)
  assert.equal(r.current.degree, 6);
  assert.equal(r.currentStartBeat, 8);
  assert.equal(r.beatsToNext, 4);
});

test("harmonyAt: loop=false past the end → current is null (ended)", () => {
  const exp = expandProgression(build("C|G Z"), [4, 4]); // totalBeats 8
  const r = harmonyAt(exp, 8, { loop: false });
  assert.equal(r.current, null);
  assert.equal(r.currentStartBeat, null);
  assert.equal(r.beatsToNext, null);
  assert.equal(r.next, null);
  assert.equal(r.nextAfter, null);
  // Well past the end too.
  assert.equal(harmonyAt(exp, 100, { loop: false }).current, null);
});

test("harmonyAt: loop=true wraps globalBeat modulo totalBeats", () => {
  const exp = expandProgression(build("C|G Z"), [4, 4]); // totalBeats 8
  // beat 9 wraps to beat 1 → inside C span [0,4).
  const r = harmonyAt(exp, 9, { loop: true });
  assert.equal(r.current.degree, 1);
  assert.equal(r.currentStartBeat, 0);
  assert.equal(r.beatsToNext, 3); // 4 - 1
});

test("harmonyAt: LOOP-SEAM lookahead wraps next/nextAfter back to bar 1", () => {
  // C G Am F. On the LAST span (F, [12,16)), with loop=true, next should wrap
  // to bar 1 (C) and nextAfter to bar 2 (G) so a walking bass leads home.
  const exp = expandProgression(build("C|G|A-|F Z"), [4, 4]);
  const r = harmonyAt(exp, 14, { loop: true }); // inside F [12,16)
  assert.equal(r.current.degree, 4);   // F (last span)
  assert.equal(r.next.degree, 1);      // wraps to C (bar 1)
  assert.equal(r.nextAfter.degree, 5); // wraps to G (bar 2)
  assert.equal(r.beatsToNext, 2);      // 16 - 14
});

test("harmonyAt: loop=false on the last span → next/nextAfter are null", () => {
  const exp = expandProgression(build("C|G|A-|F Z"), [4, 4]);
  const r = harmonyAt(exp, 14, { loop: false }); // inside F [12,16)
  assert.equal(r.current.degree, 4);
  assert.equal(r.next, null);
  assert.equal(r.nextAfter, null);
});

test("harmonyAt: empty expansion returns the ended shape", () => {
  const exp = { spans: [], totalBeats: 0, notes: [] };
  const r = harmonyAt(exp, 0, { loop: true });
  assert.equal(r.current, null);
  assert.equal(r.next, null);
});

// --- HarmonyPlayer holder -------------------------------------------------

test("HarmonyPlayer: builds expansion from a scene.harmony and queries it", () => {
  const sceneHarmony = {
    title: "T",
    composer: "C",
    key: { tonicPitchClass: 0, mode: "major" },
    timeSignature: [4, 4],
    progression: build("{C|G} Z"),
  };
  const player = new HarmonyPlayer(sceneHarmony);
  assert.equal(player.hasHarmony, true);
  assert.equal(player.totalBeats, 16); // {C|G} ×2 passes
  const r = player.getHarmonyAt(5, true); // inside G [4,8) pass 1
  assert.equal(r.current.degree, 5);
  assert.equal(r.next.degree, 1); // back to C (pass 2 head)
});

test("HarmonyPlayer: null harmony → no harmony, ended query shape", () => {
  const player = new HarmonyPlayer(null);
  assert.equal(player.hasHarmony, false);
  assert.equal(player.totalBeats, 0);
  const r = player.getHarmonyAt(0, true);
  assert.equal(r.current, null);
  assert.equal(r.beatsToNext, null);
});

// --- N.C. (No-Chord) cells -------------------------------------------------

test("expandProgression: explicit No-Chord cell yields a null-chord span", () => {
  // n is the No-Chord token; one N.C. bar then a C bar.
  const exp = expandProgression(build("n|C Z"), [4, 4]);
  assert.equal(exp.spans.length, 2);
  assert.equal(exp.spans[0].noChord, true);
  assert.equal(exp.spans[0].chord, null);
  assert.equal(exp.spans[1].chord.degree, 1);
  // harmonyAt over the N.C. span reports current null but a real next.
  const r = harmonyAt(exp, 1, { loop: false });
  assert.equal(r.current, null);
  assert.equal(r.currentNoChord, true);
  assert.equal(r.next.degree, 1);
});
