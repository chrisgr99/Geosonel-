// Unit tests for the vStyle voice-style foundation:
//   src/vStyle.js — VStyle, Note, resolveDrive, shapeVelocity, shapeDuration,
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
    VStyle, Note, resolveDrive, shapeVelocity, shapeDuration,
    serializeVStyle, materializeVStyle,
    driverToStored, driverFromStored, compileFormula,
} from "../src/vStyle.js";

// ---- VStyle -------------------------------------------------------------

test("VStyle: a bare style has all defaults", () => {
    const s = new VStyle();
    assert.equal(s.scale, "key");
    assert.deepEqual(s.range, [60, 84]);
    assert.equal(s.pitch, "lt");
    assert.equal(s.velocity, "r");
    assert.equal(s.duration, "b");
    assert.equal(s.velocityWeight, 0.5);
});

test("VStyle: copy() is independent — mutating it doesn't touch the source", () => {
    const base = new VStyle();
    const lead = base.copy();
    lead.pitch = 0.7;
    lead.range[1] = 96;
    assert.equal(base.pitch, "lt");          // source untouched
    assert.equal(base.range[1], 84);         // range was cloned, not shared
    assert.equal(lead.pitch, 0.7);
});

test("VStyle: built from a plain style object inherits its fields + default drivers", () => {
    const plain = { scale: "minorPentatonic", range: [64, 88], smoothness: 0.5, chordLock: 0.4 };
    const s = new VStyle(plain);
    assert.equal(s.scale, "minorPentatonic"); // inherited
    assert.deepEqual(s.range, [64, 88]);
    assert.equal(s.chordLock, 0.4);
    assert.equal(s.pitch, "lt");              // default driver filled in
    assert.equal(s.articulation, 0.8);
});

test("VStyle: bend defaults to Off (undefined); Note carries a bend field", () => {
    assert.equal(new VStyle().bend, undefined);
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
    const s = new VStyle();
    s.pitch = 0.3;          // fixed
    s.velocity = "g";       // channel
    s.scale = "blues";
    const json = serializeVStyle(s);
    assert.deepEqual(json.pitch, { src: "fixed", value: 0.3 });
    assert.deepEqual(json.velocity, { src: "channel", channel: "g" });
    assert.equal(json.scale, "blues");
    assert.deepEqual(json.range, [60, 84]);
    json.range[0] = 0;            // mutate the serialized copy
    assert.equal(s.range[0], 60); // source untouched
});

test("materialize: a stored formula compiles to a working driver function", () => {
    const json = serializeVStyle(new VStyle());
    json.velocity = { src: "formula", expr: "c.col.r ** 2" };
    const vs = materializeVStyle(json);
    assert.equal(typeof vs.velocity, "function");
    assert.equal(resolveDrive(vs.velocity, { col: { r: 0.5 } }), 0.25);
    // round-trips back to the same stored expr (carried on __src)
    assert.deepEqual(driverToStored(vs.velocity), { src: "formula", expr: "c.col.r ** 2" });
});

test("materialize: fixed + channel drivers survive a JSON.stringify round-trip", () => {
    const s = new VStyle();
    s.pitch = 0.3;
    s.velocity = "g";
    const back = materializeVStyle(JSON.parse(JSON.stringify(serializeVStyle(s))));
    assert.equal(back.pitch, 0.3);
    assert.equal(back.velocity, "g");
    assert.equal(back.duration, "b");   // untouched default driver
});

test("materialize: null / garbage → all defaults", () => {
    for (const bad of [null, undefined, 42, "x"]) {
        const vs = materializeVStyle(bad);
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
