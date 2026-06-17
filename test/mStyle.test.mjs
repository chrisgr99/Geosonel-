// Unit tests for the vStyle voice-style foundation:
//   src/mStyle.js — MStyle, Note, resolveDrive, shapeVelocity, shapeDuration,
//   and the app-wide serialize/materialize round-trip.
//
// A vStyle is the reusable INPUT half of the note pipeline (nxtNote turns it
// into a slim Note). Each axis driver is a value | colour-channel | function;
// velocity/duration blend beat strength against an image drive and are shaped by
// phrase position. For the app-wide library a vStyle round-trips through JSON
// (drivers tagged fixed | channel | formula). Pure logic — runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    MStyle, Note, resolveDrive, shapeVelocity, shapeDuration,
    serializeMStyle, materializeMStyle,
    driverToStored, driverFromStored, compileFormula,
    RHYTHM_CORE_FIELDS, defaultRhythmCore,
} from "../src/mStyle.js";

// ---- MStyle -------------------------------------------------------------

test("MStyle: a bare style has all defaults", () => {
    const s = new MStyle();
    assert.equal(s.scale, "key");
    assert.deepEqual(s.range, [60, 84]);
    assert.equal(s.pitch, "lt");
    assert.equal(s.velocity, "r");
    assert.equal(s.duration, "b");
    assert.equal(s.velocityWeight, 0.5);
});

test("MStyle: copy() is independent — mutating it doesn't touch the source", () => {
    const base = new MStyle();
    const lead = base.copy();
    lead.pitch = 0.7;
    lead.range[1] = 96;
    assert.equal(base.pitch, "lt");          // source untouched
    assert.equal(base.range[1], 84);         // range was cloned, not shared
    assert.equal(lead.pitch, 0.7);
});

test("MStyle: built from a plain style object inherits its fields + default drivers", () => {
    const plain = { scale: "minorPentatonic", range: [64, 88], smoothness: 0.5, chordLock: 0.4 };
    const s = new MStyle(plain);
    assert.equal(s.scale, "minorPentatonic"); // inherited
    assert.deepEqual(s.range, [64, 88]);
    assert.equal(s.chordLock, 0.4);
    assert.equal(s.pitch, "lt");              // default driver filled in
    assert.equal(s.articulation, 0.8);
});

// ---- rhythm core --------------------------------------------------------

test("MStyle: carries a rhythm core with the five knobs at their defaults", () => {
    const s = new MStyle();
    assert.deepEqual(Object.keys(s.rhythm).sort(), [...RHYTHM_CORE_FIELDS].sort());
    assert.equal(s.rhythm.density, 0.5);
    assert.equal(s.rhythm.syncopation, 0.2);
    assert.equal(s.rhythm.imageInfluence, 0.5);
    assert.equal(s.rhythm.accent, 0.5);
    assert.equal(s.rhythm.ratchets, 0);
});

test("MStyle: copy()'s rhythm core is independent of the source", () => {
    const base = new MStyle();
    const c = base.copy();
    c.rhythm.density = 0.9;
    assert.equal(base.rhythm.density, 0.5);   // source untouched
    assert.equal(c.rhythm.density, 0.9);
});

test("MStyle: a partial rhythm core fills missing knobs from the defaults", () => {
    const s = new MStyle({ rhythm: { density: 0.8 } });
    assert.equal(s.rhythm.density, 0.8);       // provided wins
    assert.equal(s.rhythm.syncopation, 0.2);   // filled from default
    assert.equal(s.rhythm.ratchets, 0);
});

test("serialize/materialize: the rhythm core round-trips", () => {
    const s = new MStyle();
    s.rhythm.syncopation = 0.6;
    s.rhythm.ratchets = 0.3;
    const back = materializeMStyle(JSON.parse(JSON.stringify(serializeMStyle(s))));
    assert.equal(back.rhythm.syncopation, 0.6);
    assert.equal(back.rhythm.ratchets, 0.3);
    assert.equal(back.rhythm.density, 0.5);    // untouched knob keeps its default
});

test("defaultRhythmCore: a fresh, independent default core", () => {
    const a = defaultRhythmCore();
    const b = defaultRhythmCore();
    a.density = 0.1;
    assert.equal(b.density, 0.5);
    assert.deepEqual(Object.keys(a).sort(), [...RHYTHM_CORE_FIELDS].sort());
});

test("MStyle: bend defaults to Off (undefined); Note carries a bend field", () => {
    assert.equal(new MStyle().bend, undefined);
    const n = new Note({ note: 60, bend: { type: "static", semis: 0.5 } });
    assert.deepEqual(n.bend, { type: "static", semis: 0.5 });
    assert.equal(new Note({ note: 60 }).bend, undefined);
});

// ---- serialize / materialize (app-wide library round-trip) --------------

test("driver tagged form: number / string / function ↔ stored", () => {
    assert.deepEqual(driverToStored(0.5), { src: "fixed", value: 0.5 });
    assert.deepEqual(driverToStored("y"), { src: "channel", channel: "y" });
    assert.deepEqual(driverToStored(undefined), { src: "off" });
    assert.equal(driverFromStored({ src: "fixed", value: 0.5 }), 0.5);
    assert.equal(driverFromStored({ src: "channel", channel: "y" }), "y");
    assert.equal(driverFromStored({ src: "off" }), undefined);
    assert.equal(driverFromStored(0.7), 0.7);     // tolerant of a bare value
    assert.equal(driverFromStored("r"), "r");
});

test("serialize: drivers tag, non-driver fields pass through, range is cloned", () => {
    const s = new MStyle();
    s.pitch = 0.3;          // fixed
    s.velocity = "g";       // channel
    s.scale = "blues";
    const json = serializeMStyle(s);
    assert.deepEqual(json.pitch, { src: "fixed", value: 0.3 });
    assert.deepEqual(json.velocity, { src: "channel", channel: "g" });
    assert.equal(json.scale, "blues");
    assert.deepEqual(json.range, [60, 84]);
    json.range[0] = 0;            // mutate the serialized copy
    assert.equal(s.range[0], 60); // source untouched
});

test("materialize: a stored formula compiles to a working driver function", () => {
    const json = serializeMStyle(new MStyle());
    json.velocity = { src: "formula", expr: "c.col.r ** 2" };
    const vs = materializeMStyle(json);
    assert.equal(typeof vs.velocity, "function");
    assert.equal(resolveDrive(vs.velocity, { col: { r: 0.5 } }), 0.25);
    // round-trips back to the same stored expr (carried on __src)
    assert.deepEqual(driverToStored(vs.velocity), { src: "formula", expr: "c.col.r ** 2" });
});

test("materialize: fixed + channel drivers survive a JSON.stringify round-trip", () => {
    const s = new MStyle();
    s.pitch = 0.3;
    s.velocity = "g";
    const back = materializeMStyle(JSON.parse(JSON.stringify(serializeMStyle(s))));
    assert.equal(back.pitch, 0.3);
    assert.equal(back.velocity, "g");
    assert.equal(back.duration, "b");   // untouched default driver
});

test("materialize: null / garbage → all defaults", () => {
    for (const bad of [null, undefined, 42, "x"]) {
        const vs = materializeMStyle(bad);
        assert.equal(vs.pitch, "lt");
        assert.equal(vs.scale, "key");
        assert.deepEqual(vs.range, [60, 84]);
    }
});

test("compileFormula: a bad expression → undefined (the engine can't crash)", () => {
    assert.equal(compileFormula("this is ) not js"), undefined);
    assert.equal(compileFormula(""), undefined);
    assert.equal(compileFormula(null), undefined);
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
