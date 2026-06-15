// Engine-level tests for musical phrasing in the melodic line:
//   src/callbackContext.js — nxtNote's phrase gate (rest) and anchor.
//
// The simulation resolves a phrase state ({ inGap, atStart, atEnd }) from
// scene.harmony.phrases and binds it via setCallbackHarmony. nxtNote then:
//   · returns 0 (a rest — playNote plays nothing) when the beat is in a gap;
//   · favours a primary/cadential tone at a phrase's first/last beat;
//   · plays continuously when no phrase grid is present.
// Pure of the audio engine (no DOM) — runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    nxtNote,
    setCallbackContext,
    clearCallbackContext,
    setCallbackHarmony,
    clearCallbackHarmony,
    clearMelodyState,
} from "../src/callbackContext.js";
import { styles } from "../src/harmonyMelody.js";

const C_MAJOR = { tonicPitchClass: 0, mode: "major" };
// The firing context exposes the chord as { root: MIDI, notes: offsets }.
const CMAJ7 = { root: 60, notes: [0, 4, 7, 11] };

/** A minimal firing context for a melodic object. */
function fctx(id) {
    return { id, chord: CMAJ7, nextChord: null, beatsToNext: null, beatIndex: 0 };
}

test("nxtNote: returns 0 (a rest) when the beat is in a phrase gap", () => {
    clearMelodyState();
    setCallbackContext(fctx("A"));
    setCallbackHarmony({
        chord: null, key: C_MAJOR,
        phrase: { inGap: true, atStart: false, atEnd: false },
    });
    // Any drive value rests in the gap — for a bass too (a gap is real silence).
    assert.equal(nxtNote(0.5, styles.melody), 0);
    assert.equal(nxtNote(0.0, styles.bass), 0);
    clearCallbackHarmony();
    clearCallbackContext();
});

test("nxtNote: in a phrase breath tail, a breathing voice rests but the bass plays", () => {
    // release <= 0 marks the breath tail.
    const tail = { inGap: false, release: 0, atStart: false, atEnd: false };
    clearMelodyState();
    setCallbackContext(fctx("M"));
    setCallbackHarmony({ chord: {}, key: C_MAJOR, phrase: tail });
    assert.equal(nxtNote(0.5, styles.melody), 0); // melody breathes → rests
    clearCallbackHarmony();
    clearCallbackContext();
    clearMelodyState();
    setCallbackContext({ id: "B", chord: { root: 36, notes: [0, 4, 7] }, nextChord: null,
        beatsToNext: null, beatIndex: 0, bpm: 120 });
    setCallbackHarmony({ chord: {}, key: C_MAJOR, phrase: tail });
    const n = nxtNote(0.5, styles.bass);
    assert.ok(Number.isFinite(n) && n > 0, `bass plays through the breath, got ${n}`);
    clearCallbackHarmony();
    clearCallbackContext();
});

test("nxtNote: a breathing voice stamps the note's breath-release; a bass doesn't", () => {
    const ctx = fctx("M");
    ctx.bpm = 120;
    setCallbackContext(ctx);
    setCallbackHarmony({
        chord: {}, key: C_MAJOR,
        phrase: { inGap: false, release: 0.5, atStart: false, atEnd: true },
    });
    clearMelodyState();
    nxtNote(0.5, styles.melody);
    assert.equal(ctx._breathReleaseBeats, 0.5); // melody caps its release
    clearMelodyState();
    nxtNote(0.5, styles.bass);
    assert.equal(ctx._breathReleaseBeats, undefined); // bass plays through (no cap)
    clearCallbackHarmony();
    clearCallbackContext();
});

test("nxtNote: with no phrase grid, plays a real note (continuous line)", () => {
    clearMelodyState();
    setCallbackContext(fctx("B"));
    setCallbackHarmony({ chord: {}, key: C_MAJOR }); // no phrase field
    const n = nxtNote(0.5, styles.melody);
    assert.ok(Number.isFinite(n) && n > 0, `expected a real note, got ${n}`);
    const [lo, hi] = styles.melody.range;
    assert.ok(n >= lo && n <= hi, `note ${n} should sit in [${lo}, ${hi}]`);
    clearCallbackHarmony();
    clearCallbackContext();
});

test("nxtNote: a phrase start leans on a primary tone (the tonic)", () => {
    const sweepTonics = (phrase) => {
        clearMelodyState();
        setCallbackContext(fctx("C"));
        let tonics = 0;
        const N = 60;
        for (let i = 0; i < N; i++) {
            setCallbackHarmony({ chord: {}, key: C_MAJOR, phrase });
            const n = nxtNote(i / N, styles.melody);
            if (((n % 12) + 12) % 12 === 0) tonics++;
        }
        clearCallbackHarmony();
        clearCallbackContext();
        return tonics;
    };
    const atStart = sweepTonics({ inGap: false, atStart: true, atEnd: false });
    const mid = sweepTonics({ inGap: false, atStart: false, atEnd: false });
    assert.ok(atStart > mid, `phrase start ${atStart} should favour the tonic over mid-phrase ${mid}`);
});
