// Unit tests for the agc (automatic gain control) pure helpers —
// design/agc.md. agc is now thin sugar: the per-pixel signal stretch
// is baked at image load (see test/imageStretch.test.mjs), and agc maps
// the already-0..1 col[channel] to a chosen output range. The
// channel-name parse and the map+clamp+midpoint guard are the
// CDN/canvas-free pure functions that remain in simulation.js, so they
// run under `node --test`. The old runtime range-computation tests
// (agcPercentileRange over the live buffer) moved to the bake's tests.
// The repo root is CommonJS by default, so this file is .mjs to load as
// ESM.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    parseAgcChannel,
    agcMapClamp,
} from "../src/simulation.js";

const COL_KEYS = ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"];

test("parseAgcChannel: 'col.r' and bare 'r' both normalise to 'r'", () => {
    assert.equal(parseAgcChannel("col.r"), "r");
    assert.equal(parseAgcChannel("r"), "r");
});

test("parseAgcChannel: accepts every col key, with and without prefix", () => {
    for (const k of COL_KEYS) {
        assert.equal(parseAgcChannel(k), k, `bare ${k}`);
        assert.equal(parseAgcChannel("col." + k), k, `col.${k}`);
    }
});

test("parseAgcChannel: strips the col. prefix case-insensitively and trims", () => {
    assert.equal(parseAgcChannel("COL.lt"), "lt");
    assert.equal(parseAgcChannel("  col.cy  "), "cy");
});

test("parseAgcChannel: unknown channel / non-string → null", () => {
    assert.equal(parseAgcChannel("col.zzz"), null);
    assert.equal(parseAgcChannel("nope"), null);
    assert.equal(parseAgcChannel(""), null);
    assert.equal(parseAgcChannel("col."), null);
    assert.equal(parseAgcChannel(42), null);
    assert.equal(parseAgcChannel(null), null);
    assert.equal(parseAgcChannel(undefined), null);
});

test("agcMapClamp: maps the range to [lo, hi] linearly", () => {
    const range = { min: 0, max: 0.2 };
    // value at min → lo, at max → hi, halfway → midpoint.
    assert.equal(agcMapClamp(0, range, 48, 90), 48);
    assert.equal(agcMapClamp(0.2, range, 48, 90), 90);
    assert.equal(agcMapClamp(0.1, range, 48, 90), 69);
});

test("agcMapClamp: clamps values outside the range to lo / hi", () => {
    const range = { min: 0.2, max: 0.8 };
    assert.equal(agcMapClamp(0.0, range, 0, 1), 0); // below min → lo
    assert.equal(agcMapClamp(1.0, range, 0, 1), 1); // above max → hi
    assert.equal(agcMapClamp(-5, range, 10, 20), 10);
    assert.equal(agcMapClamp(99, range, 10, 20), 20);
});

test("agcMapClamp: default-style lo/hi of 0..1 pass through unit mapping", () => {
    const range = { min: 0, max: 1 };
    assert.equal(agcMapClamp(0.3, range, 0, 1), 0.3);
});

test("agcMapClamp: flat channel (max ≈ min) → midpoint, no divide-by-zero", () => {
    assert.equal(agcMapClamp(0.5, { min: 0.4, max: 0.4 }, 48, 90), 69);
    // span below epsilon also counts as flat.
    assert.equal(agcMapClamp(0.5, { min: 0.4, max: 0.4 + 1e-9 }, 0, 10), 5);
});

test("agcMapClamp: no range (null/undefined) → midpoint", () => {
    assert.equal(agcMapClamp(0.5, null, 48, 90), 69);
    assert.equal(agcMapClamp(0.5, undefined, 0, 1), 0.5);
});

test("agcMapClamp: non-finite value → midpoint", () => {
    const range = { min: 0, max: 1 };
    assert.equal(agcMapClamp(NaN, range, 48, 90), 69);
    assert.equal(agcMapClamp(undefined, range, 0, 1), 0.5);
});

test("agcMapClamp: tolerates lo > hi (clamps to the actual extremes)", () => {
    const range = { min: 0, max: 1 };
    // Reversed output range: value below the band clamps to the larger
    // bound's side correctly (clamp uses min/max of lo,hi).
    const out = agcMapClamp(-1, range, 90, 48);
    assert.ok(out >= 48 && out <= 90);
});

// _agc is now thin sugar: with the col signal pre-stretched to 0..1,
// agc(channel, lo, hi) is agcMapClamp(value, {min:0, max:1}, lo, hi)
// after a parseAgcChannel guard. These tests exercise that composition
// directly (the private _agc method itself wires the firing context,
// which needs the canvas; the pure pieces are what we cover here).

/** Mirror of _agc's body over the two exported pure helpers. */
function agcSugar(col, channel, lo, hi) {
    const loNum = Number.isFinite(lo) ? lo : 0;
    const hiNum = Number.isFinite(hi) ? hi : 1;
    const key = parseAgcChannel(channel);
    if (key === null) return (loNum + hiNum) / 2;
    const value = (col !== null && typeof col === "object") ? col[key] : undefined;
    return agcMapClamp(value, { min: 0, max: 1 }, loNum, hiNum);
}

test("_agc sugar: pre-stretched 0..1 value maps linearly onto [lo, hi]", () => {
    // value at 0 → lo, at 1 → hi, halfway → midpoint. The image bake
    // already stretched the channel to fill 0..1, so the input range is
    // the fixed {0, 1}.
    assert.equal(agcSugar({ r: 0 }, "col.r", 48, 90), 48);
    assert.equal(agcSugar({ r: 1 }, "col.r", 48, 90), 90);
    assert.equal(agcSugar({ r: 0.5 }, "col.r", 48, 90), 69);
    // Bare channel name works the same as the "col." form.
    assert.equal(agcSugar({ lt: 0.25 }, "lt", 0, 1), 0.25);
});

test("_agc sugar: a value already outside 0..1 clamps to lo / hi", () => {
    assert.equal(agcSugar({ r: 1.5 }, "col.r", 0, 10), 10);
    assert.equal(agcSugar({ r: -0.2 }, "col.r", 0, 10), 0);
});

test("_agc sugar: unknown channel → output midpoint", () => {
    assert.equal(agcSugar({ r: 0.9 }, "col.zzz", 48, 90), 69);
    assert.equal(agcSugar({ r: 0.9 }, "nope", 0, 1), 0.5);
});

test("_agc sugar: missing col value (undefined) → midpoint (non-finite guard)", () => {
    // A valid channel but no value present (e.g. no image / no firing
    // context col) is non-finite → agcMapClamp returns the midpoint.
    assert.equal(agcSugar({}, "col.r", 48, 90), 69);
    assert.equal(agcSugar(null, "col.r", 0, 1), 0.5);
});
