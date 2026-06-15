// Unit tests for the auto pre-phraser:
//   src/harmonyPhrasing.js — autoPhrase
//
// autoPhrase derives contiguous phrase spans (in base-cycle beats) from a
// progression: phrases run to V→I cadences, target ~4 bars, cap 8, and cover
// the whole chart with no gaps. Pure logic (no DOM) — runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { autoPhrase, phraseStateAt } from "../src/harmonyPhrasing.js";
import { parseChord, parseKey } from "../src/irealChord.js";

const KEY = parseKey("C"); // C major: C=I (degree 1), G=V (degree 5)

/** One chord per bar → a folded progression (chord, bar, chord, bar, …). */
function barsToProgression(symbols) {
    const out = [];
    for (const sym of symbols) {
        out.push({ type: "chord", chord: parseChord(sym, KEY), raw: sym });
        out.push({ type: "bar" });
    }
    return out;
}

/** Build the harmony object autoPhrase consumes (4/4). */
function harmonyOf(symbols) {
    return { progression: barsToProgression(symbols), timeSignature: [4, 4] };
}

test("autoPhrase: splits at V→I cadences (two 4-bar phrases)", () => {
    // bars: C F G7 C | A-7 D-7 G7 C  → cadences end bars 3 and 7.
    const phrases = autoPhrase(harmonyOf(["C", "F", "G7", "C", "A-7", "D-7", "G7", "C"]));
    assert.deepEqual(phrases, [{ start: 0, end: 16 }, { start: 16, end: 32 }]);
});

test("autoPhrase: a 4-bar loop with no internal cadence is one phrase", () => {
    // C^7 A-7 D-7 G7 — the only V→I is across the loop seam (not detected),
    // so the whole cycle is a single phrase.
    const phrases = autoPhrase(harmonyOf(["C^7", "A-7", "D-7", "G7"]));
    assert.deepEqual(phrases, [{ start: 0, end: 16 }]);
});

test("autoPhrase: with no cadence, breaks at the 4-bar target and caps the tail", () => {
    // 10 cadence-free bars → 4 + 4 + 2.
    const phrases = autoPhrase(harmonyOf(
        ["C", "F", "C", "F", "C", "F", "C", "F", "C", "F"]));
    assert.deepEqual(phrases, [
        { start: 0, end: 16 },
        { start: 16, end: 32 },
        { start: 32, end: 40 },
    ]);
});

test("autoPhrase: runs PAST the target to reach a cadence (up to the cap)", () => {
    // 9 bars, the only cadence ends bar 8 (V bar7 → I bar8). First phrase has no
    // cadence in reach → breaks at 4; second runs 5 bars to the cadence.
    const phrases = autoPhrase(harmonyOf(
        ["C", "F", "C", "F", "C", "F", "C", "G7", "C"]));
    assert.deepEqual(phrases, [{ start: 0, end: 16 }, { start: 16, end: 36 }]);
});

test("autoPhrase: never exceeds the 8-bar cap", () => {
    // 16 cadence-free bars → four 4-bar phrases, none longer than 8.
    const phrases = autoPhrase(harmonyOf(Array(16).fill("C")));
    assert.equal(phrases.length, 4);
    for (const p of phrases) assert.ok((p.end - p.start) / 4 <= 8);
});

test("autoPhrase: phrases are contiguous and cover the whole cycle", () => {
    const phrases = autoPhrase(harmonyOf(
        ["C", "F", "G7", "C", "A-7", "D-7", "G7", "C", "F", "G7", "C"]));
    assert.ok(phrases.length > 0);
    assert.equal(phrases[0].start, 0);
    assert.equal(phrases[phrases.length - 1].end, 11 * 4);
    for (let i = 1; i < phrases.length; i += 1) {
        assert.equal(phrases[i].start, phrases[i - 1].end, "no gap/overlap");
    }
});

test("autoPhrase: empty / malformed input yields no phrases", () => {
    assert.deepEqual(autoPhrase(null), []);
    assert.deepEqual(autoPhrase({ progression: [], timeSignature: [4, 4] }), []);
    assert.deepEqual(autoPhrase({ timeSignature: [4, 4] }), []);
});

// ---- phraseStateAt: gate, anchor, and the automatic breath ----------

test("phraseStateAt: no phrases → null (continuous line)", () => {
    assert.equal(phraseStateAt([], 4), null);
    assert.equal(phraseStateAt(undefined, 4), null);
});

test("phraseStateAt: a beat between phrases rests (a gap)", () => {
    const phrases = [{ start: 0, end: 8 }, { start: 16, end: 24 }];
    assert.deepEqual(phraseStateAt(phrases, 12),
        { inGap: true, release: null, atStart: false, atEnd: false });
});

test("phraseStateAt: the auto-breath is set aside — release is always null", () => {
    // BREATH_ENABLED is off, so no release-cap is produced anywhere in a phrase.
    // Anchoring (atStart/atEnd) still works; only the breath note-shortening is
    // disabled. (Flip BREATH_ENABLED to restore, and these become 0.5/4.5/7.5.)
    const phrases = [{ start: 0, end: 8 }];
    assert.deepEqual(phraseStateAt(phrases, 7),
        { inGap: false, release: null, atStart: false, atEnd: true });
    assert.deepEqual(phraseStateAt(phrases, 3),
        { inGap: false, release: null, atStart: false, atEnd: false });
    assert.deepEqual(phraseStateAt(phrases, 0),
        { inGap: false, release: null, atStart: true, atEnd: false });
});

test("phraseStateAt: a gap still rests; an in-phrase beat does not", () => {
    const phrases = [{ start: 0, end: 8 }, { start: 16, end: 24 }];
    assert.equal(phraseStateAt(phrases, 7).inGap, false);   // in a phrase → plays
    assert.equal(phraseStateAt(phrases, 10).inGap, true);   // drawn gap → rests
    assert.equal(phraseStateAt(phrases, 10).release, null);
});
