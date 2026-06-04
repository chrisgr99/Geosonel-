// Unit tests for the seeded offset computation.
//
// Pure functions, no DOM and no network, so they run under
// `node --test`. The module lives in src/seed/, which carries
// its own { "type": "module" } package.json so Node loads it as
// ESM; this file uses .mjs so it is ESM regardless of the repo
// root's CommonJS default.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    computeOffset,
    standardGaussian,
    POSITION_SD_FRACTION,
    VELOCITY_SD,
    CLAMP_SD,
} from "../src/seed/seedOffset.js";

const W = 32;
const H = 24;

test("seed 0 yields no offset (today's behaviour)", () => {
    assert.deepEqual(computeOffset(0, "SPR1", 1, W, H), { dx: 0, dy: 0, dvx: 0, dvy: 0 });
});

test("variability 0 yields no offset (object locked)", () => {
    assert.deepEqual(computeOffset(5, "SPR1", 0, W, H), { dx: 0, dy: 0, dvx: 0, dvy: 0 });
    assert.deepEqual(computeOffset(5, "SPR1", -3, W, H), { dx: 0, dy: 0, dvx: 0, dvy: 0 });
});

test("same inputs always give the same offset (determinism)", () => {
    const a = computeOffset(7, "SPR1", 2, W, H);
    const b = computeOffset(7, "SPR1", 2, W, H);
    assert.deepEqual(a, b);
});

test("different seeds give different offsets", () => {
    const a = computeOffset(1, "SPR1", 2, W, H);
    const b = computeOffset(2, "SPR1", 2, W, H);
    assert.notDeepEqual(a, b);
});

test("different object ids give different offsets under the same seed", () => {
    const a = computeOffset(3, "SPR1", 2, W, H);
    const b = computeOffset(3, "SPR2", 2, W, H);
    assert.notDeepEqual(a, b);
});

test("position and velocity components are independent draws", () => {
    const o = computeOffset(9, "SPR1", 2, W, H);
    // Extremely unlikely for independent draws to collide exactly.
    assert.notEqual(o.dx, o.dy);
    assert.notEqual(o.dx, o.dvx);
});

test("the standard-normal clamp holds at CLAMP_SD", () => {
    // Sweep many keys; no sample may exceed the clamp.
    for (let seed = 1; seed <= 200; seed++) {
        for (const id of ["SPR1", "CRV2", "TRG3"]) {
            for (const prop of /** @type {const} */ (["pos", "vel"])) {
                for (const comp of /** @type {const} */ (["x", "y"])) {
                    const z = standardGaussian(seed, id, prop, comp);
                    assert.ok(z <= CLAMP_SD && z >= -CLAMP_SD, `z=${z} out of clamp`);
                }
            }
        }
    }
});

test("offset magnitude is bounded by clamp * variability * referenceSD", () => {
    const variability = 4;
    const maxPosX = CLAMP_SD * variability * POSITION_SD_FRACTION * W;
    const maxPosY = CLAMP_SD * variability * POSITION_SD_FRACTION * H;
    const maxVel = CLAMP_SD * variability * VELOCITY_SD;
    for (let seed = 1; seed <= 300; seed++) {
        const o = computeOffset(seed, "SPR1", variability, W, H);
        assert.ok(Math.abs(o.dx) <= maxPosX + 1e-9);
        assert.ok(Math.abs(o.dy) <= maxPosY + 1e-9);
        assert.ok(Math.abs(o.dvx) <= maxVel + 1e-9);
        assert.ok(Math.abs(o.dvy) <= maxVel + 1e-9);
    }
});

test("offset scales with variability (twice the dial, twice the offset)", () => {
    const a = computeOffset(11, "SPR1", 1, W, H);
    const b = computeOffset(11, "SPR1", 2, W, H);
    assert.ok(Math.abs(b.dx - 2 * a.dx) < 1e-9);
    assert.ok(Math.abs(b.dvy - 2 * a.dvy) < 1e-9);
});
