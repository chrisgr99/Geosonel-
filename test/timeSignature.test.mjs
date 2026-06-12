// Unit tests for sanitiseTimeSignature (src/timeSignature.js): the
// pure coercion of a scene.json value into a supported [num, den]
// time signature. v1 supports only 3/4 and 4/4 (denominator always
// 4, numerator 3 or 4); everything else falls back to [4, 4]. Pure
// function — no DOM, no Strudel — so it runs directly under
// `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sanitiseTimeSignature } from "../src/timeSignature.js";

test("sanitiseTimeSignature: supported array signatures pass through", () => {
    assert.deepEqual(sanitiseTimeSignature([4, 4]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature([3, 4]), [3, 4]);
});

test("sanitiseTimeSignature: supported string signatures parse", () => {
    assert.deepEqual(sanitiseTimeSignature("4/4"), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature("3/4"), [3, 4]);
    assert.deepEqual(sanitiseTimeSignature("  3/4 "), [3, 4]);
});

test("sanitiseTimeSignature: unsupported numerator falls back to [4,4]", () => {
    assert.deepEqual(sanitiseTimeSignature([2, 4]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature([5, 4]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature("6/4"), [4, 4]);
});

test("sanitiseTimeSignature: non-4 denominator falls back to [4,4]", () => {
    assert.deepEqual(sanitiseTimeSignature([3, 8]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature([4, 2]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature("3/8"), [4, 4]);
});

test("sanitiseTimeSignature: junk and malformed input falls back to [4,4]", () => {
    assert.deepEqual(sanitiseTimeSignature(null), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature(undefined), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature("foo"), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature("4"), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature([4]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature([4, 4, 4]), [4, 4]);
    assert.deepEqual(sanitiseTimeSignature(44), [4, 4]);
});
