// The chord-guide shell voicing (src/chordGuide.js).

import { test } from "node:test";
import assert from "node:assert/strict";

import { shellVoicing } from "../src/chordGuide.js";

test("dominant 7th → shell of root, 3rd, 7th", () => {
    // G7 from chordStructure: root 55 (G3), notes [0,4,7,10].
    assert.deepEqual(shellVoicing({ root: 55, notes: [0, 4, 7, 10] }), [55, 59, 65]);
});

test("minor 7th keeps the minor 3rd and the b7", () => {
    assert.deepEqual(shellVoicing({ root: 50, notes: [0, 3, 7, 10] }), [50, 53, 60]);
});

test("a triad (no 7th) falls back to the 5th", () => {
    // C major triad: notes [0,4,7] → root, 3rd, 5th.
    assert.deepEqual(shellVoicing({ root: 48, notes: [0, 4, 7] }), [48, 52, 55]);
});

test("a sus chord keeps its colour tone when there's no 3rd", () => {
    // sus4: [0,5,7] → root, 5th, then the sus4 isn't a 3rd so colour picks the 5th.
    const v = shellVoicing({ root: 48, notes: [0, 5, 7] });
    assert.equal(v[0], 48);
    assert.ok(v.length >= 2 && v.length <= 3);
    assert.ok(v.every((n) => [48, 53, 55].includes(n)));
});

test("a bare root just sounds the root; empty/no chord → []", () => {
    assert.deepEqual(shellVoicing({ root: 60, notes: [0] }), [60]);
    assert.deepEqual(shellVoicing(null), []);
    assert.deepEqual(shellVoicing({ root: 60, notes: [] }), []);
});
