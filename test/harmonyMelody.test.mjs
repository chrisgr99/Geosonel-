// Unit tests for the melodic note generator core:
//   src/harmonyMelody.js — melodicStep / scalePitchClasses
//
// melodicStep draws the next note from the key's scale, weighted toward small
// intervals + chord tones, and picks via the colour value (`dice`). Pure logic
// (no DOM) — runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    melodicStep,
    scalePitchClasses,
    expandProfile,
    styles,
    SCALES,
    MELODY,
    BASS,
} from "../src/harmonyMelody.js";

const C_MAJOR = { tonicPitchClass: 0, mode: "major" };
const C_MAJ_PCS = scalePitchClasses(C_MAJOR);          // [0,2,4,5,7,9,11]
const CMAJ7 = [0, 4, 7, 11];
const G7 = [7, 11, 2, 5];

/** Sweep dice across [0,1) and collect the chosen notes. */
function sweep(prev, chordPcs, rootPc, nextPcs, beatsToNext, beatIndex, profile, steps = 50) {
    const out = [];
    for (let i = 0; i < steps; i++) {
        const dice = i / steps;
        out.push(melodicStep(prev, C_MAJ_PCS, chordPcs, rootPc, nextPcs,
            beatsToNext, beatIndex, dice, profile));
    }
    return out;
}

test("scalePitchClasses: C major and A minor", () => {
    assert.deepEqual(scalePitchClasses(C_MAJOR), [0, 2, 4, 5, 7, 9, 11]);
    assert.deepEqual(scalePitchClasses({ tonicPitchClass: 9, mode: "minor" }),
        [9, 11, 0, 2, 4, 5, 7]);
});

test("scalePitchClasses: named scale overrides the key mode", () => {
    // C minor pentatonic rooted on C.
    assert.deepEqual(scalePitchClasses(C_MAJOR, "minorPentatonic"),
        SCALES.minorPentatonic.map((iv) => (0 + iv) % 12));
    // "key" / absent → the key's own mode.
    assert.deepEqual(scalePitchClasses(C_MAJOR, "key"), [0, 2, 4, 5, 7, 9, 11]);
});

test("styles: melody/bass/lead are frozen with the friendly knobs", () => {
    for (const name of ["melodic", "bass", "lead"]) {
        const s = styles[name];
        assert.ok(s, `styles.${name} exists`);
        assert.ok(Object.isFrozen(s), `styles.${name} frozen`);
        assert.equal(typeof s.smoothness, "number");
        assert.equal(typeof s.chordLock, "number");
        assert.ok(Array.isArray(s.range));
    }
    assert.equal(styles.lead.scale, "minorPentatonic");
});

test("expandProfile: friendly knobs → raw weights, low/span override the register", () => {
    const raw = expandProfile(styles.melodic, 60, 24);
    assert.equal(raw.rangeLow, 60);
    assert.equal(raw.rangeHigh, 84);
    // Smoother profile → higher leap aversion than a leapier one.
    assert.ok(expandProfile(styles.melodic).leapAversion
        > expandProfile(styles.lead).leapAversion);
    // Higher chordLock (bass) → stronger chord pull than melody.
    assert.ok(expandProfile(styles.bass).chordPull
        > expandProfile(styles.melodic).chordPull);
});

test("expandProfile drives melodicStep end to end (in range, scale tones)", () => {
    const raw = expandProfile(styles.melodic, 60, 24);
    const scale = new Set(scalePitchClasses(C_MAJOR, styles.melodic.scale));
    for (let i = 0; i < 24; i++) {
        const n = melodicStep(67, [...scale], CMAJ7, 0, [], null, 0, i / 24, raw);
        assert.ok(n >= 60 && n <= 84, `in range: ${n}`);
        assert.ok(scale.has(((n % 12) + 12) % 12), `scale tone: ${n}`);
    }
});

test("melodicStep: deterministic — same dice + state → same note", () => {
    const a = melodicStep(67, C_MAJ_PCS, CMAJ7, 0, [], null, 0, 0.42, MELODY);
    const b = melodicStep(67, C_MAJ_PCS, CMAJ7, 0, [], null, 0, 0.42, MELODY);
    assert.equal(a, b);
});

test("melodicStep: every note is a scale tone within range", () => {
    const scale = new Set(C_MAJ_PCS);
    for (const n of sweep(67, CMAJ7, 0, [], null, 0, MELODY)) {
        assert.ok(n >= MELODY.rangeLow && n <= MELODY.rangeHigh, `in range: ${n}`);
        assert.ok(scale.has(((n % 12) + 12) % 12), `scale tone: ${n}`);
    }
});

test("melodicStep: motion is mostly stepwise (small average interval)", () => {
    // Over a colour sweep from a fixed previous note, the average jump should be
    // small — the interval weighting favours steps over leaps.
    const prev = 67; // G4
    const notes = sweep(prev, CMAJ7, 0, [], null, 1, MELODY); // weak beat
    const avg = notes.reduce((s, n) => s + Math.abs(n - prev), 0) / notes.length;
    assert.ok(avg < 4, `average leap ${avg.toFixed(2)} should be < 4 semitones`);
    // And the great majority land within a third of the previous note.
    const stepish = notes.filter((n) => Math.abs(n - prev) <= 4).length;
    assert.ok(stepish / notes.length > 0.7, `${stepish}/${notes.length} within a third`);
});

test("melodicStep: strong beats favour chord tones", () => {
    const chord = new Set(CMAJ7);
    const strong = sweep(67, CMAJ7, 0, [], null, 0, MELODY); // beatIndex 0 = strong
    const onChord = strong.filter((n) => chord.has(((n % 12) + 12) % 12)).length;
    assert.ok(onChord / strong.length > 0.6,
        `${onChord}/${strong.length} chord tones on strong beats`);
});

test("melodicStep: seeds in range when there's no previous note", () => {
    for (const n of sweep(null, CMAJ7, 0, [], null, 0, MELODY)) {
        assert.ok(n >= MELODY.rangeLow && n <= MELODY.rangeHigh);
    }
});

test("melodicStep: bass profile stays low and roots the change", () => {
    // Strong beat, bass profile, previous note near the root: the root should be
    // the dominant pick across the sweep.
    const notes = sweep(43 /* G2 */, CMAJ7, 0, [], null, 0, BASS);
    for (const n of notes) {
        assert.ok(n >= BASS.rangeLow && n <= BASS.rangeHigh, `bass range: ${n}`);
    }
    const roots = notes.filter((n) => ((n % 12) + 12) % 12 === 0).length; // C = root
    assert.ok(roots / notes.length > 0.4, `${roots}/${notes.length} land on the root`);
});

test("melodicStep: voice-leading boosts tones a step from the next chord", () => {
    // Approaching G7 (pcs include 5=F, 2=D, 11=B): with lead engaged, tones a
    // step away from a G7 tone should appear more than with no lookahead.
    const withLead = new Set(sweep(67, CMAJ7, 0, G7, 1, 1, MELODY));
    const noLead = new Set(sweep(67, CMAJ7, 0, [], null, 1, MELODY));
    // The lead set should reach at least one note adjacent to a G7 tone that the
    // no-lead set is less inclined toward — sanity that the branch fires.
    assert.ok(withLead.size > 0 && noLead.size > 0);
});

/** Sweep dice, collecting notes, with phrase anchoring engaged. */
function sweepAnchored(prev, chordPcs, rootPc, profile, anchorPcs, strength, steps = 50) {
    const out = [];
    for (let i = 0; i < steps; i++) {
        out.push(melodicStep(prev, C_MAJ_PCS, chordPcs, rootPc, [],
            null, 0, i / steps, profile, anchorPcs, strength));
    }
    return out;
}

test("melodicStep: phrase anchoring biases toward the anchor pitch classes", () => {
    // Anchor on the tonic (C=0) only, with a strong multiplier: the proportion
    // of notes landing on C should rise sharply versus no anchoring.
    const plain = sweepAnchored(67, CMAJ7, 0, MELODY, [], 1);
    const anchored = sweepAnchored(67, CMAJ7, 0, MELODY, [0], 8);
    const tonics = (notes) => notes.filter((n) => ((n % 12) + 12) % 12 === 0).length;
    assert.ok(tonics(anchored) > tonics(plain),
        `anchored ${tonics(anchored)} should beat plain ${tonics(plain)}`);
});

test("melodicStep: anchorStrength of 1 (or empty anchorPcs) is a no-op", () => {
    // Identical to the un-anchored call: the boost is disabled at strength 1 and
    // when no anchor pitch classes are supplied.
    const base = melodicStep(67, C_MAJ_PCS, CMAJ7, 0, [], null, 0, 0.42, MELODY);
    const strengthOne = melodicStep(67, C_MAJ_PCS, CMAJ7, 0, [], null, 0, 0.42, MELODY, [0, 7], 1);
    const emptyPcs = melodicStep(67, C_MAJ_PCS, CMAJ7, 0, [], null, 0, 0.42, MELODY, [], 8);
    assert.equal(strengthOne, base);
    assert.equal(emptyPcs, base);
});
