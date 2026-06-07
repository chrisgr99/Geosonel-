// Unit tests for emitter argument parsing (src/emitters.js) — the
// playNote / playSound call-form normalization (§3.3). Pure, offline.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildNoteSpec, buildSoundSpec, looksLikeNoteName } from "../src/emitters.js";

const DEF = 0.5; // stand-in for the firing context's vel.

// --- playNote ---

test("playNote(note): note only, velocity defaults to context vel", () => {
    assert.deepEqual(buildNoteSpec([60], DEF), { sound: null, note: 60, velocity: 0.5, duration: undefined, pan: undefined });
});

test("playNote(note, vel): explicit velocity", () => {
    assert.deepEqual(buildNoteSpec([60, 0.8], DEF), { sound: null, note: 60, velocity: 0.8, duration: undefined, pan: undefined });
});

test("playNote(instrument, note, vel): leading string overrides the voice", () => {
    assert.deepEqual(buildNoteSpec(["xylophone", 60, 0.8], DEF), { sound: "xylophone", note: 60, velocity: 0.8, duration: undefined, pan: undefined });
});

test("playNote(instrument, note, vel, dur, pan): full positional", () => {
    assert.deepEqual(buildNoteSpec(["piano", 60, 0.8, 0.25, -1], DEF), { sound: "piano", note: 60, velocity: 0.8, duration: 0.25, pan: -1 });
});

test("playNote(noteName): a lone note-name string is the note, not an instrument", () => {
    assert.deepEqual(buildNoteSpec(["c4"], DEF), { sound: null, note: "c4", velocity: 0.5, duration: undefined, pan: undefined });
});

test("playNote(noteName, vel): note name with velocity is not mistaken for instrument", () => {
    assert.deepEqual(buildNoteSpec(["c4", 0.7], DEF), { sound: null, note: "c4", velocity: 0.7, duration: undefined, pan: undefined });
});

test("playNote(instrument, noteName): both strings — instrument then note", () => {
    assert.deepEqual(buildNoteSpec(["marimba", "e3"], DEF), { sound: "marimba", note: "e3", velocity: 0.5, duration: undefined, pan: undefined });
});

test("playNote: omitted/invalid velocity falls back to context vel", () => {
    assert.equal(buildNoteSpec([60, undefined], DEF).velocity, 0.5);
    assert.equal(buildNoteSpec([60, "loud"], DEF).velocity, 0.5);
});

test("playNote({...}): options form with vel alias", () => {
    assert.deepEqual(buildNoteSpec([{ note: 60, vel: 0.7, pan: -0.5 }], DEF), { sound: null, note: 60, velocity: 0.7, duration: undefined, pan: -0.5 });
});

test("playNote({...}): options form with velocity key and sound", () => {
    assert.deepEqual(buildNoteSpec([{ sound: "marimba", note: 62, velocity: 0.3, duration: 0.5 }], DEF), { sound: "marimba", note: 62, velocity: 0.3, duration: 0.5, pan: undefined });
});

// --- playSound ---

test("playSound(sample): sample only, velocity defaults", () => {
    assert.deepEqual(buildSoundSpec(["bd"], DEF), { bank: null, sample: "bd", velocity: 0.5 });
});

test("playSound(sample, vel): explicit velocity", () => {
    assert.deepEqual(buildSoundSpec(["bd", 0.8], DEF), { bank: null, sample: "bd", velocity: 0.8 });
});

test("playSound(bank, sample, vel): two leading strings = bank then sample", () => {
    assert.deepEqual(buildSoundSpec(["RolandTR909", "bd", 0.8], DEF), { bank: "RolandTR909", sample: "bd", velocity: 0.8 });
});

test("playSound(bank, sample): bank override, velocity defaults", () => {
    assert.deepEqual(buildSoundSpec(["LinnDrum", "sn"], DEF), { bank: "LinnDrum", sample: "sn", velocity: 0.5 });
});

test("playSound({...}): options form", () => {
    assert.deepEqual(buildSoundSpec([{ sample: "sn", bank: "LinnDrum", vel: 0.6 }], DEF), { bank: "LinnDrum", sample: "sn", velocity: 0.6 });
});

// --- looksLikeNoteName ---

test("looksLikeNoteName recognizes pitches and rejects instrument/sample names", () => {
    for (const n of ["c", "C", "c4", "C#4", "eb3", "f#-1", "g", "a", "b"]) {
        assert.equal(looksLikeNoteName(n), true, `${n} should look like a note`);
    }
    for (const s of ["bd", "sn", "hh", "piano", "xylophone", "RolandTR909", "marimba"]) {
        assert.equal(looksLikeNoteName(s), false, `${s} should NOT look like a note`);
    }
});
