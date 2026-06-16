// Unit tests for the baked image signal stretch (design/agc.md,
// src/strudel/imageStretch.js). The stretch is computed once per image:
// computeStretchParams derives a 5th–95th percentile band for each of L, a, b,
// C from a raw OKLCh buffer; applyStretch produces a new buffer with every
// channel percentile-stretched to [0, 1] (a flat axis → neutral). Both are pure
// functions of the buffer plus module constants, so they run under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    computeStretchParams,
    applyStretch,
    agcPercentileRange,
    _STRETCH_CONSTANTS,
} from "../src/strudel/imageStretch.js";

const { CHROMA_FLAT_EPSILON } = _STRETCH_CONSTANTS;

/** Build a raw OKLCh Float32 buffer (L, C, a, b per pixel) from {L, a, b}; C = hypot(a, b). */
function buildBuffer(pixels) {
    const out = new Float32Array(pixels.length * 4);
    for (let i = 0; i < pixels.length; i++) {
        const { L, a, b } = pixels[i];
        out[i * 4] = L;
        out[i * 4 + 1] = Math.hypot(a, b);
        out[i * 4 + 2] = a;
        out[i * 4 + 3] = b;
    }
    return out;
}

// ── agcPercentileRange ────────────────────────────────────────────────

test("agcPercentileRange: trims extremes (5th–95th percentile by index)", () => {
    const vals = [];
    for (let i = 0; i <= 100; i++) vals.push(i / 100); // 0.00 … 1.00
    const r = agcPercentileRange(vals);
    assert.ok(Math.abs(r.min - 0.05) < 1e-9);
    assert.ok(Math.abs(r.max - 0.95) < 1e-9);
});

test("agcPercentileRange: a lone outlier high pixel does not blow the max", () => {
    const vals = [];
    for (let i = 0; i < 99; i++) vals.push(0.1);
    vals.push(100); // outlier
    const r = agcPercentileRange(vals);
    assert.ok(r.max < 1, `max ${r.max} should ignore the outlier`);
});

test("agcPercentileRange: empty / non-array → null", () => {
    assert.equal(agcPercentileRange([]), null);
    assert.equal(agcPercentileRange(null), null);
});

// ── computeStretchParams: per-channel bands ───────────────────────────

test("computeStretchParams: each channel's band is its 5th/95th percentile", () => {
    // 101 pixels spanning a known range on each channel, so 5–95 trims to a
    // predictable band.
    const pixels = [];
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        pixels.push({ L: t, a: -0.3 + 0.6 * t, b: -0.2 + 0.4 * t });
    }
    const p = computeStretchParams(buildBuffer(pixels));
    assert.ok(Math.abs(p.Llo - 0.05) < 1e-6 && Math.abs(p.Lhi - 0.95) < 1e-6);
    assert.ok(Math.abs(p.aLo - (-0.3 + 0.6 * 0.05)) < 1e-6);
    assert.ok(Math.abs(p.aHi - (-0.3 + 0.6 * 0.95)) < 1e-6);
    assert.ok(Math.abs(p.bLo - (-0.2 + 0.4 * 0.05)) < 1e-6);
    assert.ok(p.cHi > p.cLo && p.cLo >= 0); // chroma band non-negative, non-degenerate
});

test("computeStretchParams: empty / null → OKLab-magnitude defaults", () => {
    const def = { Llo: 0, Lhi: 1, aLo: -0.3, aHi: 0.3, bLo: -0.3, bHi: 0.3, cLo: 0, cHi: 0.3 };
    assert.deepEqual(computeStretchParams(new Float32Array(0)), def);
    assert.deepEqual(computeStretchParams(null), def);
});

// ── applyStretch: per-channel [0,1] mapping ───────────────────────────

const FLAT = { Llo: 0, Lhi: 1, aLo: -0.3, aHi: 0.3, bLo: -0.3, bHi: 0.3, cLo: 0, cHi: 0.3 };

test("applyStretch: L maps Llo→0, Lhi→1, midpoint→0.5, clamps outside", () => {
    const params = { ...FLAT, Llo: 0.2, Lhi: 0.8 };
    const buf = buildBuffer([{ L: 0.2, a: 0, b: 0 }, { L: 0.5, a: 0, b: 0 },
        { L: 0.8, a: 0, b: 0 }, { L: 0.0, a: 0, b: 0 }, { L: 1.0, a: 0, b: 0 }]);
    const out = applyStretch(buf, params);
    assert.ok(Math.abs(out[0] - 0) < 1e-6);
    assert.ok(Math.abs(out[4] - 0.5) < 1e-6);
    assert.ok(Math.abs(out[8] - 1) < 1e-6);
    assert.equal(out[12], 0);   // below Llo → clamp 0
    assert.equal(out[16], 1);   // above Lhi → clamp 1
});

test("applyStretch: a is percentile-banded to [0,1] redness (green→0, grey→0.5, red→1)", () => {
    const params = { ...FLAT, aLo: -0.2, aHi: 0.2 };
    const buf = buildBuffer([{ L: 0.5, a: -0.2, b: 0 }, { L: 0.5, a: 0, b: 0 },
        { L: 0.5, a: 0.2, b: 0 }, { L: 0.5, a: 0.4, b: 0 }]);
    const out = applyStretch(buf, params);
    assert.equal(out[2], 0);                 // greenest → 0
    assert.ok(Math.abs(out[6] - 0.5) < 1e-6); // grey (a=0) → 0.5
    assert.equal(out[10], 1);                // reddest in band → 1
    assert.equal(out[14], 1);                // beyond band → clamp 1
});

test("applyStretch: a flat band (grey image) → neutral 0.5", () => {
    const params = { ...FLAT, aLo: 0, aHi: CHROMA_FLAT_EPSILON / 2 }; // span below the chroma epsilon
    const buf = buildBuffer([{ L: 0.5, a: 0.001, b: 0 }, { L: 0.5, a: 0.005, b: 0 }]);
    const out = applyStretch(buf, params);
    assert.equal(out[2], 0.5);
    assert.equal(out[6], 0.5);
});

test("applyStretch: C flat band (grey image) → 0 colourfulness", () => {
    const params = { ...FLAT, cLo: 0, cHi: CHROMA_FLAT_EPSILON / 2 };
    const buf = buildBuffer([{ L: 0.5, a: 0.001, b: 0 }, { L: 0.5, a: 0.003, b: 0 }]);
    const out = applyStretch(buf, params);
    assert.equal(out[1], 0); // chroma neutral = no colour
    assert.equal(out[5], 0);
});

test("applyStretch: every output channel stays within [0, 1]", () => {
    const buf = buildBuffer([{ L: 0.1, a: -0.5, b: 0.5 }, { L: 0.9, a: 0.4, b: -0.4 },
        { L: 0.5, a: 0.0, b: 0.0 }]);
    const out = applyStretch(buf, computeStretchParams(buf));
    for (const v of out) assert.ok(v >= 0 && v <= 1, `out of range: ${v}`);
});
