// Unit tests for the baked image signal stretch (design/agc.md,
// src/strudel/imageStretch.js). The stretch is computed once per image:
// computeStretchParams derives the L percentile band and the a/b
// gain-capped scale from a raw OKLCh buffer; applyStretch produces a new
// stretched buffer the signal sampler reads. Both are pure functions of
// the buffer plus module constants (no clock, no randomness), so they
// run under `node --test`. The repo root is CommonJS by default, so this
// file is .mjs to load as ESM.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    computeStretchParams,
    applyStretch,
    agcPercentileRange,
    _STRETCH_CONSTANTS,
} from "../src/strudel/imageStretch.js";

const { PRIMARY_NORMALIZER: N, GAIN_CAP } = _STRETCH_CONSTANTS;

/**
 * Build a raw OKLCh Float32 buffer (L, C, a, b per pixel) from a list of
 * {L, a, b} pixels; C is filled as hypot(a, b) to mirror the real buffer.
 */
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

// ── agcPercentileRange (moved here from the agc tests) ────────────────

test("agcPercentileRange: trims extremes (5th–95th percentile by index)", () => {
    // 0..100 inclusive, 101 values. loIdx = floor(0.05*100)=5,
    // hiIdx = ceil(0.95*100)=95 → values 5 and 95.
    const values = [];
    for (let i = 0; i <= 100; i++) values.push(i);
    assert.deepEqual(agcPercentileRange(values), { min: 5, max: 95 });
});

test("agcPercentileRange: a lone outlier high pixel does not blow the max", () => {
    const values = [];
    for (let i = 0; i < 99; i++) values.push((i / 98) * 0.1);
    values.push(1.0);
    const r = agcPercentileRange(values);
    assert.ok(r !== null);
    assert.ok(r.max < 0.2, `trimmed max ${r.max} should ignore the 1.0 outlier`);
});

test("agcPercentileRange: empty / non-array → null", () => {
    assert.equal(agcPercentileRange([]), null);
    assert.equal(agcPercentileRange(null), null);
    assert.equal(agcPercentileRange(undefined), null);
});

// ── computeStretchParams: L percentile ────────────────────────────────

test("computeStretchParams: L band is the 5th/95th percentile of L", () => {
    // 101 pixels, L = 0.00 .. 1.00 in 0.01 steps, a/b zero. Stride 1
    // (101 ≤ 10000), so every L is sampled. loIdx 5 → 0.05, hiIdx 95 →
    // 0.95.
    const pixels = [];
    for (let i = 0; i <= 100; i++) pixels.push({ L: i / 100, a: 0, b: 0 });
    const { Llo, Lhi } = computeStretchParams(buildBuffer(pixels));
    assert.ok(Math.abs(Llo - 0.05) < 1e-6, `Llo ${Llo}`);
    assert.ok(Math.abs(Lhi - 0.95) < 1e-6, `Lhi ${Lhi}`);
});

// ── computeStretchParams: a/b gain cap ────────────────────────────────

test("computeStretchParams: tiny chroma → gain pinned to GAIN_CAP", () => {
    // All pixels near-grey: |a|, |b| ~ 1e-4, far below N. N / p95 would
    // be huge, so the cap must hold the gain at GAIN_CAP.
    const pixels = [];
    for (let i = 0; i < 50; i++) pixels.push({ L: 0.5, a: 1e-4, b: -1e-4 });
    const { gainA, gainB } = computeStretchParams(buildBuffer(pixels));
    assert.equal(gainA, GAIN_CAP);
    assert.equal(gainB, GAIN_CAP);
});

test("computeStretchParams: colourful axis → gain ≈ N / p95, below the cap", () => {
    // a axis ramps 0 .. 0.3 so p95(|a|) ≈ 0.285 (≈ N), giving gain
    // ≈ N / 0.285 ≈ 1.05 — well under GAIN_CAP and not 1 exactly.
    const pixels = [];
    for (let i = 0; i <= 100; i++) pixels.push({ L: 0.5, a: (i / 100) * 0.3, b: 0 });
    const { gainA } = computeStretchParams(buildBuffer(pixels));
    const p95 = agcPercentileRange(pixels.map((p) => Math.abs(p.a))).max;
    const expected = Math.min(GAIN_CAP, N / p95);
    assert.ok(Math.abs(gainA - expected) < 1e-6, `gainA ${gainA} vs ${expected}`);
    assert.ok(gainA < GAIN_CAP, `gainA ${gainA} should be below the cap`);
});

test("computeStretchParams: flat (all-zero) axis → finite gain, no NaN/Inf", () => {
    // a ≡ 0, b ≡ 0: p95 is 0, the guard returns GAIN_CAP (finite) so
    // a' stays 0 with no division blow-up.
    const pixels = [];
    for (let i = 0; i < 20; i++) pixels.push({ L: 0.3 + i * 0.01, a: 0, b: 0 });
    const { gainA, gainB } = computeStretchParams(buildBuffer(pixels));
    assert.ok(Number.isFinite(gainA) && Number.isFinite(gainB));
    assert.equal(gainA, GAIN_CAP);
    assert.equal(gainB, GAIN_CAP);
});

test("computeStretchParams: empty buffer → identity-ish params, no throw", () => {
    const p = computeStretchParams(new Float32Array(0));
    assert.deepEqual(p, { Llo: 0, Lhi: 1, gainA: 1, gainB: 1 });
    assert.deepEqual(computeStretchParams(null), { Llo: 0, Lhi: 1, gainA: 1, gainB: 1 });
});

// ── applyStretch: L mapping ───────────────────────────────────────────

test("applyStretch: L maps Llo→0, Lhi→1, midpoint→0.5, and clamps outside", () => {
    const params = { Llo: 0.2, Lhi: 0.8, gainA: 1, gainB: 1 };
    // Pixels at L = 0.1 (below), 0.2 (Llo), 0.5 (mid), 0.8 (Lhi), 0.9 (above).
    const buf = buildBuffer([
        { L: 0.1, a: 0, b: 0 },
        { L: 0.2, a: 0, b: 0 },
        { L: 0.5, a: 0, b: 0 },
        { L: 0.8, a: 0, b: 0 },
        { L: 0.9, a: 0, b: 0 },
    ]);
    const out = applyStretch(buf, params);
    // out[4] / out[12] use a tolerance: the pixel L round-trips through
    // Float32 storage while params.Llo/Lhi are JS doubles, so "at Llo"
    // lands a sub-1e-8 epsilon off exact 0 (not a clamp boundary).
    assert.equal(out[0], 0);                       // below Llo → clamp 0
    assert.ok(Math.abs(out[4] - 0) < 1e-6);        // at Llo → 0
    assert.ok(Math.abs(out[8] - 0.5) < 1e-6);      // midpoint → 0.5
    assert.ok(Math.abs(out[12] - 1) < 1e-6);       // at Lhi → 1
    assert.equal(out[16], 1);                      // above Lhi → clamp 1
});

test("applyStretch: flat L band (Lhi ≈ Llo) → every L' is 0.5", () => {
    const params = { Llo: 0.4, Lhi: 0.4, gainA: 1, gainB: 1 };
    const buf = buildBuffer([
        { L: 0.1, a: 0, b: 0 },
        { L: 0.9, a: 0, b: 0 },
    ]);
    const out = applyStretch(buf, params);
    assert.equal(out[0], 0.5);
    assert.equal(out[4], 0.5);
});

// ── applyStretch: a/b scaling and C' ──────────────────────────────────

test("applyStretch: a' = a·gainA, b' = b·gainB, C' = hypot(a', b'), unclamped", () => {
    const params = { Llo: 0, Lhi: 1, gainA: 3, gainB: 2 };
    // a = 0.2, b = -0.15 → a' = 0.6, b' = -0.3 (a' well past N: NOT clamped).
    const buf = buildBuffer([{ L: 0.5, a: 0.2, b: -0.15 }]);
    const out = applyStretch(buf, params);
    assert.ok(Math.abs(out[2] - 0.6) < 1e-6, `a' ${out[2]}`);
    assert.ok(Math.abs(out[3] - (-0.3)) < 1e-6, `b' ${out[3]}`);
    assert.ok(Math.abs(out[1] - Math.hypot(0.6, 0.3)) < 1e-6, `C' ${out[1]}`);
    // a' = 0.6 is left unclamped (the signal layer clamps to ±N later).
    assert.ok(out[2] > N, "a' must be left raw, above N");
});

// ── determinism ───────────────────────────────────────────────────────

test("determinism: same buffer ⇒ identical params and identical output", () => {
    const pixels = [];
    for (let i = 0; i < 200; i++) {
        pixels.push({ L: (i % 100) / 100, a: ((i % 7) - 3) * 0.05, b: ((i % 5) - 2) * 0.06 });
    }
    const buf1 = buildBuffer(pixels);
    const buf2 = buildBuffer(pixels);
    const p1 = computeStretchParams(buf1);
    const p2 = computeStretchParams(buf2);
    assert.deepEqual(p1, p2);
    const out1 = applyStretch(buf1, p1);
    const out2 = applyStretch(buf2, p2);
    assert.equal(out1.length, out2.length);
    for (let i = 0; i < out1.length; i++) {
        assert.equal(out1[i], out2[i], `index ${i}`);
    }
});
