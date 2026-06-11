// Unit tests for the onTick beat-interval helpers (src/beatIntervals.js):
// parseBeatInterval (token / fraction / number / invalid) and the pure
// crossesInterval boundary predicate that backs the onTick
// `onBeatInterval(interval)` gate. Both are pure functions — no DOM, no
// Strudel, no sim — so they run directly under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBeatInterval, crossesInterval } from "../src/beatIntervals.js";

test("parseBeatInterval: tokens map to their quarterNotes", () => {
    assert.equal(parseBeatInterval("Qtr"), 1);
    assert.equal(parseBeatInterval("8th"), 0.5);
    assert.equal(parseBeatInterval("16th"), 0.25);
    // A dotted token (Dot 16th = 3/8 quarter) and a triplet token
    // (Qtr Tr = 1/3 quarter).
    assert.equal(parseBeatInterval("Dot 16th"), 3 / 8);
    assert.equal(parseBeatInterval("Qtr Tr"), 1 / 3);
});

test("parseBeatInterval: fractions are note values relative to a whole note", () => {
    // beats = 4 * (N / D): a whole note is 4 beats.
    assert.equal(parseBeatInterval("1/8"), 0.5);
    assert.equal(parseBeatInterval("1/4"), 1);
    assert.equal(parseBeatInterval("3/32"), 0.375);
    assert.equal(parseBeatInterval("1/1"), 4);
    // Whitespace is trimmed around the value and around each side.
    assert.equal(parseBeatInterval("  1/4 "), 1);
});

test("parseBeatInterval: plain finite numbers are taken as beats", () => {
    assert.equal(parseBeatInterval(2), 2);
    assert.equal(parseBeatInterval("2"), 2);
    assert.equal(parseBeatInterval(0.5), 0.5);
});

test("parseBeatInterval: invalid input returns 0 (gate no-ops)", () => {
    assert.equal(parseBeatInterval(""), 0);
    assert.equal(parseBeatInterval("   "), 0);
    assert.equal(parseBeatInterval("x"), 0);
    assert.equal(parseBeatInterval("1/0"), 0);    // zero denominator
    assert.equal(parseBeatInterval("1/x"), 0);    // non-finite denominator
    assert.equal(parseBeatInterval("0"), 0);      // non-positive
    assert.equal(parseBeatInterval(-1), 0);       // non-positive number
    assert.equal(parseBeatInterval(null), 0);
    assert.equal(parseBeatInterval(undefined), 0);
    assert.equal(parseBeatInterval({}), 0);
    assert.equal(parseBeatInterval(NaN), 0);
});

test("crossesInterval: fires exactly once when the boundary is crossed", () => {
    // A Qtr (interval 1) boundary at beat 1: prev .98, cur 1.01 -> floor
    // ticked from 0 to 1 -> true.
    assert.equal(crossesInterval(0.98, 1.01, 1), true);
});

test("crossesInterval: no boundary crossed yields false", () => {
    // prev 1.2 / cur 1.25, interval 1: both floor to 1 -> false.
    assert.equal(crossesInterval(1.2, 1.25, 1), false);
});

test("crossesInterval: a non-positive interval is a no-op", () => {
    assert.equal(crossesInterval(0.98, 1.01, 0), false);
    assert.equal(crossesInterval(0.98, 1.01, -1), false);
});

test("crossesInterval: non-finite beat positions are a no-op", () => {
    assert.equal(crossesInterval(NaN, 1.01, 1), false);
    assert.equal(crossesInterval(0.98, Infinity, 1), false);
});

test("crossesInterval: sub-beat intervals tick on their own grid", () => {
    // interval 0.5 (an 8th): crossing 0.5 fires, staying within a half
    // does not.
    assert.equal(crossesInterval(0.48, 0.52, 0.5), true);
    assert.equal(crossesInterval(0.52, 0.58, 0.5), false);
});
