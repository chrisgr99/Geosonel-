import { test } from "node:test";
import assert from "node:assert/strict";

import { migrateLegacySceneKeys } from "../src/sceneMigrate.js";

test("renames repeats/repeatPatterns/repeatStrengths on scene objects", () => {
    const data = {
        curves: [{ id: "CRV1", repeats: 2, repeatPatterns: "xxxx|", repeatStrengths: "9" }],
        sprites: [{ id: "SPR1", repeats: 3 }],
        triggers: [{ id: "TRG1", repeatStrengths: "5" }],
    };
    migrateLegacySceneKeys(data);
    assert.deepEqual(data.curves[0], { id: "CRV1", phrases: 2, phrasePatterns: "xxxx|", phraseStrengths: "9" });
    assert.deepEqual(data.sprites[0], { id: "SPR1", phrases: 3 });
    assert.deepEqual(data.triggers[0], { id: "TRG1", phraseStrengths: "5" });
});

test("new key wins and legacy key is dropped when both are present", () => {
    const data = { curves: [{ id: "CRV1", repeats: 2, phrases: 5 }] };
    migrateLegacySceneKeys(data);
    assert.equal(data.curves[0].phrases, 5);
    assert.ok(!("repeats" in data.curves[0]));
});

test("leaves unrelated keys untouched (patternRepeats, harmony)", () => {
    const data = {
        curves: [{ id: "CRV1", patternRepeats: 4 }],
        harmony: { repeats: 2 },   // not a scene-object group → untouched
    };
    migrateLegacySceneKeys(data);
    assert.equal(data.curves[0].patternRepeats, 4);
    assert.ok(!("phrases" in data.curves[0]));
    assert.equal(data.harmony.repeats, 2);
});

test("no-op on a scene with no legacy keys, and tolerates odd input", () => {
    const clean = { curves: [{ id: "CRV1", phrases: 1 }] };
    migrateLegacySceneKeys(clean);
    assert.deepEqual(clean.curves[0], { id: "CRV1", phrases: 1 });
    // Non-object / missing groups don't throw.
    assert.doesNotThrow(() => migrateLegacySceneKeys(null));
    assert.doesNotThrow(() => migrateLegacySceneKeys({}));
    assert.doesNotThrow(() => migrateLegacySceneKeys({ curves: "nope" }));
});
