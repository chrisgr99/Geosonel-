// Unit tests for the agc (automatic gain control) pure helpers —
// design/agc.md. agc maps a firing context's col[channel] from that
// channel's whole-image trimmed range to a chosen output range. The
// channel-name parse, the 5th–95th percentile range, and the
// map+clamp+midpoint guard are CDN/canvas-free pure functions, so they
// run under `node --test`. The repo root is CommonJS by default, so this
// file is .mjs to load as ESM.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    parseAgcChannel,
    agcPercentileRange,
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

test("agcPercentileRange: trims extremes (5th–95th percentile by index)", () => {
    // 0..100 inclusive, 101 values. loIdx = floor(0.05*100)=5,
    // hiIdx = ceil(0.95*100)=95 → values 5 and 95.
    const values = [];
    for (let i = 0; i <= 100; i++) values.push(i);
    const r = agcPercentileRange(values);
    assert.deepEqual(r, { min: 5, max: 95 });
});

test("agcPercentileRange: a lone outlier high pixel does not blow the max", () => {
    // 99 values clustered in [0, 0.1], one specular 1.0 outlier. The 95th
    // percentile must stay in the cluster, not jump to the outlier.
    const values = [];
    for (let i = 0; i < 99; i++) values.push((i / 98) * 0.1);
    values.push(1.0);
    const r = agcPercentileRange(values);
    assert.ok(r !== null);
    assert.ok(r.max < 0.2, `trimmed max ${r.max} should ignore the 1.0 outlier`);
});

test("agcPercentileRange: sorts unsorted input deterministically", () => {
    const a = agcPercentileRange([100, 0, 50, 25, 75, 10, 90, 40, 60, 5, 95]);
    const b = agcPercentileRange([5, 95, 0, 100, 50, 25, 75, 10, 90, 40, 60]);
    assert.deepEqual(a, b);
});

test("agcPercentileRange: empty / non-array → null", () => {
    assert.equal(agcPercentileRange([]), null);
    assert.equal(agcPercentileRange(null), null);
    assert.equal(agcPercentileRange(undefined), null);
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
