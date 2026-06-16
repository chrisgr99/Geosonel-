// Unit tests for the NoteStyle voice foundation:
//   src/noteStyle.js — NoteStyle, resolveDrive, shapeVelocity, shapeDuration
//
// NoteStyle is the reusable INPUT half of the note pipeline (nxtNote turns it
// into a slim note). Each axis driver is a value | colour-channel | function;
// velocity/duration blend beat strength against an image drive and are shaped by
// phrase position. Pure logic — runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    NoteStyle, resolveDrive, shapeVelocity, shapeDuration,
} from "../src/noteStyle.js";

// ---- NoteStyle ----------------------------------------------------------

test("NoteStyle: a bare style has all defaults", () => {
    const s = new NoteStyle();
    assert.equal(s.scale, "key");
    assert.deepEqual(s.range, [60, 84]);
    assert.equal(s.pitch, "lt");
    assert.equal(s.velocity, "r");
    assert.equal(s.duration, "b");
    assert.equal(s.velocityWeight, 0.5);
});

test("NoteStyle: copy() is independent — mutating it doesn't touch the source", () => {
    const base = new NoteStyle();
    const lead = base.copy();
    lead.pitch = 0.7;
    lead.range[1] = 96;
    assert.equal(base.pitch, "lt");          // source untouched
    assert.equal(base.range[1], 84);         // range was cloned, not shared
    assert.equal(lead.pitch, 0.7);
});

test("NoteStyle: built from a plain style object inherits its fields + default drivers", () => {
    const plain = { scale: "minorPentatonic", range: [64, 88], smoothness: 0.5, chordLock: 0.4 };
    const s = new NoteStyle(plain);
    assert.equal(s.scale, "minorPentatonic"); // inherited
    assert.deepEqual(s.range, [64, 88]);
    assert.equal(s.chordLock, 0.4);
    assert.equal(s.pitch, "lt");              // default driver filled in
    assert.equal(s.articulation, 0.8);
});

// ---- resolveDrive -------------------------------------------------------

const CTX = { col: { r: 0.6, b: 0.2, lt: 0.9 }, vel: 0.7 };

test("resolveDrive: a string reads the named colour channel", () => {
    assert.equal(resolveDrive("r", CTX), 0.6);
    assert.equal(resolveDrive("lt", CTX), 0.9);
});

test("resolveDrive: a number is the value itself", () => {
    assert.equal(resolveDrive(0.42, CTX), 0.42);
});

test("resolveDrive: a function is called with the context (as this AND arg)", () => {
    assert.equal(resolveDrive((c) => c.col.r ** 2, CTX), 0.36);          // arrow, arg
    assert.equal(resolveDrive(function () { return this.col.lt; }, CTX), 0.9); // this
});

test("resolveDrive: unusable drivers → undefined (caller defaults)", () => {
    assert.equal(resolveDrive(undefined, CTX), undefined);
    assert.equal(resolveDrive("nope", CTX), undefined);        // unknown channel
    assert.equal(resolveDrive(() => "x", CTX), undefined);     // non-numeric result
});

// ---- shapeVelocity ------------------------------------------------------

test("shapeVelocity: weight=1 is all beat strength, weight=0 is all image", () => {
    assert.equal(shapeVelocity({ beatStrength: 0.8, image: 0.2, weight: 1 }), 0.8);
    assert.equal(shapeVelocity({ beatStrength: 0.8, image: 0.2, weight: 0 }), 0.2);
    // halfway blends
    assert.ok(Math.abs(shapeVelocity({ beatStrength: 0.8, image: 0.2, weight: 0.5 }) - 0.5) < 1e-9);
});

test("shapeVelocity: no image drive → the beat strength alone", () => {
    assert.equal(shapeVelocity({ beatStrength: 0.65, weight: 0.5 }), 0.65);
});

test("shapeVelocity: a phrase end is softer than a phrase start", () => {
    const base = { beatStrength: 0.6, weight: 1, phraseDynamics: 1 };
    const start = shapeVelocity({ ...base, phrase: { atStart: true } });
    const end = shapeVelocity({ ...base, phrase: { atEnd: true } });
    assert.ok(start > 0.6 && end < 0.6 && start > end);
});

test("shapeVelocity: accentResponse > 1 sharpens contrast (lowers a mid value)", () => {
    const linear = shapeVelocity({ beatStrength: 0.5, weight: 1, accentResponse: 1 });
    const punchy = shapeVelocity({ beatStrength: 0.5, weight: 1, accentResponse: 2 });
    assert.equal(linear, 0.5);
    assert.ok(punchy < linear); // 0.5^2 = 0.25
});

// ---- shapeDuration ------------------------------------------------------

test("shapeDuration: scales the slot (beatsToNext) by the articulation fraction", () => {
    // full legato, no image, no phrase shaping → ~articulation * slot
    const d = shapeDuration({ beatsToNext: 2, articulation: 1, phraseDynamics: 0 });
    assert.ok(Math.abs(d - 2) < 1e-9);
    const staccato = shapeDuration({ beatsToNext: 2, articulation: 0.25, phraseDynamics: 0 });
    assert.ok(Math.abs(staccato - 0.5) < 1e-9);
});

test("shapeDuration: more articulation → longer note", () => {
    const short = shapeDuration({ beatsToNext: 1, articulation: 0.3, phraseDynamics: 0 });
    const long = shapeDuration({ beatsToNext: 1, articulation: 0.9, phraseDynamics: 0 });
    assert.ok(long > short);
});

test("shapeDuration: a phrase end sustains longer than a mid-phrase beat", () => {
    const base = { beatsToNext: 1, articulation: 0.6, beatStrength: 0.5, phraseDynamics: 1 };
    const end = shapeDuration({ ...base, phrase: { atEnd: true } });
    const mid = shapeDuration({ ...base, phrase: null });
    assert.ok(end > mid);
});

test("shapeDuration: null/invalid beatsToNext falls back to a 1-beat slot", () => {
    const d = shapeDuration({ beatsToNext: null, articulation: 1, phraseDynamics: 0 });
    assert.ok(Math.abs(d - 1) < 1e-9);
});
