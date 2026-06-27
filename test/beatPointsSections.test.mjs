// Stage A of the three-level phrase model (phrase ⊂ section ⊂ form): the
// additive `sections` field. Verifies it's purely a multiplier on the phrase
// count — total phrases = phrases (per section) × sections — and that omitting
// it (or sections = 1) reproduces the legacy two-level behaviour exactly.
//
// Pure string derivation (no DOM, no Strudel runtime) → runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveCurveBeatPoints, totalPhrases } from "../src/beatPoints.js";

function curve(fields) {
    return { id: "CRV1", beatPointsMode: "normal", activeBeats: "", strength: "", beatPattern: "", ...fields };
}

test("totalPhrases = phrases × sections, each coerced to an int >= 1, default 1", () => {
    assert.equal(totalPhrases({ phrases: 3, sections: 2 }), 6);
    assert.equal(totalPhrases({ phrases: 4 }), 4);              // sections absent → 1
    assert.equal(totalPhrases({ sections: 5 }), 5);             // phrases absent → 1
    assert.equal(totalPhrases({}), 1);                         // both absent
    assert.equal(totalPhrases(null), 1);                       // robust to null
    assert.equal(totalPhrases({ phrases: 0, sections: -2 }), 1); // <1 floors to 1
    assert.equal(totalPhrases({ phrases: 2.9, sections: 2.9 }), 4); // floor each, then ×
});

test("sections absent reproduces the legacy two-level result exactly", () => {
    // One active beat ("x") per 4-slot phrase; phrases=2 → 2 active points.
    const legacy = deriveCurveBeatPoints(curve({ beatsPerCycle: 4, phrases: 2, activeBeats: "x...", strength: "5" }));
    const withOne = deriveCurveBeatPoints(curve({ beatsPerCycle: 4, phrases: 2, sections: 1, activeBeats: "x...", strength: "5" }));
    assert.deepEqual(withOne.positions, legacy.positions);
    assert.deepEqual(withOne.strengths, legacy.strengths);
    assert.equal(legacy.positions.length, 2);
});

test("sections multiplies the phrase tilings (and so the baked beat points)", () => {
    const base = curve({ beatsPerCycle: 4, phrases: 2, activeBeats: "x...", strength: "5" });
    const one = deriveCurveBeatPoints({ ...base, sections: 1 });
    const two = deriveCurveBeatPoints({ ...base, sections: 2 });
    const three = deriveCurveBeatPoints({ ...base, sections: 3 });
    // phrases(2) × sections → 2 / 4 / 6 active beats, evenly spread around [0,1).
    assert.equal(one.positions.length, 2);
    assert.equal(two.positions.length, 4);
    assert.equal(three.positions.length, 6);
    // Positions stay normalised and sorted across the whole (longer) path.
    for (const p of two.positions) assert.ok(p >= 0 && p < 1);
    assert.deepEqual(two.positions, [...two.positions].sort((a, b) => a - b));
});

test("Euclidean/Auto modes also honour sections (one generated pattern tiled)", () => {
    const c = curve({ beatPointsMode: "euclidean", beatsPerCycle: 4, phrases: 1, sections: 2, activeBeats: "x.x.", strength: "5" });
    const pts = deriveCurveBeatPoints(c);
    // "x.x." → 2 active per 4-slot phrase; phrases(1)×sections(2)=2 phrases → 4.
    assert.equal(pts.positions.length, 4);
});
