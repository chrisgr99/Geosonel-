// Ghosted-module fill (src/beatPoints.js moduleLoopFill): the chart-mirror's
// per-measure inheritance. A run of typed measures LOOPS forward into the blanks
// after it until the next typed measure starts a new loop. Pure → `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { moduleLoopFill } from "../src/beatPoints.js";

test("one typed measure repeats every bar", () => {
    assert.deepEqual(moduleLoopFill("A", 4, ""), ["A", "A", "A", "A"]);
});

test("two typed measures repeat as a pair", () => {
    assert.deepEqual(moduleLoopFill("A,B", 6, ""), ["A", "B", "A", "B", "A", "B"]);
});

test("three typed measures snap to a 4-bar cycle (3 + a rest), looped", () => {
    // The user's case: type 3, leave the 4th blank → "A B C ." every four bars.
    assert.deepEqual(moduleLoopFill("A,B,C", 8, ""),
        ["A", "B", "C", ".", "A", "B", "C", "."]);
});

test("four typed measures loop as a clean 4-bar cycle", () => {
    assert.deepEqual(moduleLoopFill("A,B,C,D", 8, ""),
        ["A", "B", "C", "D", "A", "B", "C", "D"]);
});

test("five typed measures snap up to an 8-bar cycle (5 + 3 rests)", () => {
    assert.deepEqual(moduleLoopFill("A,B,C,D,E", 8, ""),
        ["A", "B", "C", "D", "E", ".", ".", "."]);
});

test("a new pattern after blanks starts a fresh module", () => {
    // A,B loop until C is typed at measure 4, which begins a new loop.
    assert.deepEqual(moduleLoopFill("A,B,,,C", 8, ""),
        ["A", "B", "A", "B", "C", "C", "C", "C"]);
});

test("measure 0 blank falls back to the legacy single pattern", () => {
    assert.deepEqual(moduleLoopFill("", 3, "X"), ["X", "X", "X"]);
});

test("leading blanks before any typed measure are rests", () => {
    // No fallback, nothing typed at 0 → rest bars until the first typed module.
    assert.deepEqual(moduleLoopFill(",,A", 4, ""), [".", ".", "A", "A"]);
});
