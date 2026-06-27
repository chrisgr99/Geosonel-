// Verifies the built-in TEST_PROGRESSIONS are well-formed SceneHarmony objects:
// they survive sanitiseSceneHarmony (the same gate scene-loaded harmony passes
// through), and each carries the expected chords. Pure, offline.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST_PROGRESSIONS, testProgressionByName } from "../src/samples/testProgressions.js";
import { sanitiseSceneHarmony } from "../src/harmonyScene.js";

test("every test progression sanitises to a valid SceneHarmony", () => {
    assert.ok(TEST_PROGRESSIONS.length >= 12);
    for (const p of TEST_PROGRESSIONS) {
        const clean = sanitiseSceneHarmony(p);
        assert.notEqual(clean, null, `"${p.title}" did not sanitise`);
        assert.equal(clean.key.mode === "major" || clean.key.mode === "minor", true);
        assert.ok(Array.isArray(clean.progression) && clean.progression.length > 0);
    }
});

test("chord cells carry key-relative Roman (degree 1-7) + a quality", () => {
    const blues = testProgressionByName("12-Bar Blues");
    assert.notEqual(blues, null);
    const chords = blues.progression.filter((c) => c.type === "chord");
    assert.equal(chords.length, 12);                       // 12 bars, one chord each
    for (const c of chords) {
        assert.ok(c.chord.degree >= 1 && c.chord.degree <= 7);
        assert.equal(c.chord.quality, "7");                // all dominant 7ths
    }
});

test("two chords in a bar produce two adjacent chord cells in that bar", () => {
    const fifties = testProgressionByName("50s (2/bar)");
    const chords = fifties.progression.filter((c) => c.type === "chord");
    assert.equal(chords.length, 8);                        // 4 bars × 2 chords
    // first bar: I (degree 1, major) then vi (degree 6, minor)
    assert.equal(chords[0].chord.degree, 1);
    assert.equal(chords[0].chord.quality, "");
    assert.equal(chords[1].chord.degree, 6);
    assert.equal(chords[1].chord.quality, "-");
});
