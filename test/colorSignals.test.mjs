// Unit tests for colorSignalsFromHex — the helper that exposes an
// object's OWN authored hex colour as the firing context's `col`-shaped
// signal object (this.color.*). Pure math (hex -> sRGB -> OKLab ->
// signals), no DOM or network, so it runs under `node --test`. The repo
// root is CommonJS by default, so this file is .mjs to load as ESM.

import { test } from "node:test";
import assert from "node:assert/strict";

import { colorSignalsFromHex } from "../src/simulation.js";

// The keys colFromSignals produces, asserted present so a rename of the
// signal shape is caught here too.
const COL_KEYS = ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"];

function assertColShape(c) {
    assert.deepEqual(Object.keys(c).sort(), [...COL_KEYS].sort());
    for (const k of COL_KEYS) assert.ok(Number.isFinite(c[k]), `${k} finite`);
}

test("colorSignalsFromHex: pure red is red-dominant", () => {
    const c = colorSignalsFromHex("#ff0000");
    assertColShape(c);
    // Continuous, opposite-inverse model: redness sits well above the grey
    // midpoint and greenness is its exact inverse (low, but NOT a dead zero).
    assert.ok(c.r > 0.5, "redness above neutral");
    assert.ok(Math.abs(c.g - (1 - c.r)) < 1e-9, "greenness is the inverse of redness");
    assert.ok(c.r > c.g && c.r > c.b, "red is the strongest hue channel");
    assert.ok(c.chr > 0, "saturated colour has chroma");
});

test("colorSignalsFromHex: pure green is green-dominant", () => {
    const c = colorSignalsFromHex("#00ff00");
    assertColShape(c);
    assert.ok(c.g > 0.5, "greenness above neutral");
    assert.ok(Math.abs(c.r - (1 - c.g)) < 1e-9, "redness is the inverse of greenness");
    assert.ok(c.g > c.r, "green beats red");
});

test("colorSignalsFromHex: white is light and (near) achromatic", () => {
    const c = colorSignalsFromHex("#ffffff");
    assertColShape(c);
    assert.ok(c.lt > 0.9, "white is near-maximal lightness");
    assert.ok(c.chr < 0.05, "white has negligible chroma");
});

test("colorSignalsFromHex: shorthand and missing '#' parse the same", () => {
    assert.deepEqual(colorSignalsFromHex("#f00"), colorSignalsFromHex("#ff0000"));
    assert.deepEqual(colorSignalsFromHex("ff0000"), colorSignalsFromHex("#ff0000"));
});

test("colorSignalsFromHex: null / invalid input returns zero defaults", () => {
    const zero = colorSignalsFromHex("#000000-zero-marker-invalid");
    assertColShape(zero);
    for (const k of COL_KEYS) assert.equal(zero[k], 0, `${k} defaults to 0`);
    // null, undefined, non-string, wrong length all degrade to the same
    // zero-signal default that "no image" produces.
    for (const bad of [null, undefined, 42, "#12", "nothex"]) {
        const c = colorSignalsFromHex(bad);
        for (const k of COL_KEYS) assert.equal(c[k], 0, `${k} zero for ${String(bad)}`);
    }
});
