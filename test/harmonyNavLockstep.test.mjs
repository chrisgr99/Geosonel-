// Lockstep guard: the AUDIO expansion (harmonyPlayer.expandProgression) and the
// CHART CURSOR timeline (harmonyChartLayout.layoutChart → buildBarPlayback) must
// agree on total played beats for every chart — otherwise the now-playing
// highlight drifts from the sound. Both drive the same sequenceBars engine, but
// over SEPARATELY-grouped bar lists, so this cross-checks that the two groupings
// stay aligned across repeats, endings, similes, meter, and navigation.
//
// (The full 2000+ song sweep over the real iReal libraries lives in the local,
// gitignored _nav_validate.mjs; this uses small embedded bodies so it runs in CI.)

import { test } from "node:test";
import assert from "node:assert/strict";

import { tokenizeBody } from "../src/irealParse.js";
import { parseChord, parseKey } from "../src/irealChord.js";
import { expandProgression } from "../src/harmonyPlayer.js";
import { layoutChart, buildBarPlayback } from "../src/harmonyChartLayout.js";

const KEY_C = parseKey("C");

function build(body) {
    return tokenizeBody(body).map((c) =>
        c.type === "chord" && !c.noChord
            ? { type: "chord", chord: parseChord(c.symbol, KEY_C), raw: c.symbol }
            : c,
    );
}

/** Total beats the audio plays vs. the total the cursor timeline spans. */
function lockstep(body, ts = [4, 4]) {
    const prog = build(body);
    const audio = expandProgression(prog, ts).totalBeats;
    const cursor = buildBarPlayback(layoutChart(prog, KEY_C, "letter", ts)).totalBeats;
    return { audio, cursor };
}

const CHARTS = [
    ["plain four bars", "C|A-|D-|G Z"],
    ["{ } repeat", "{C|A-|D-|G} Z"],
    ["N1/N2 endings", "{C|A-|N1D-|G}N2C Z"],
    ["one-bar simile %", "C|G|x Z"],
    ["two-bar simile r", "C|G|r Z"],
    ["last-bar simile Kcl", "C|G|Kcl Z"],
    ["one-bar { } with <6x>", "C {G <6x> }A- Z"],
    ["<4x> before content", "C {<4x>G|A-}D- Z"],
    ["empty tail before } (Fine)", "{C|D| <Fine> }E Z"],
    ["mid-tune meter change", "C|T34A-|T44D-|G Z"],
    ["D.S. al Coda", "SC|G|QF|<D.S. al Coda>A- Z QD-|E Z"],
    ["D.C. al Fine", "C|<Fine>G|F|<D.C. al Fine>A- Z"],
    ["D.C. al Coda", "C|G|QF|<D.C. al Coda>A- Z QD-|E Z"],
    ["bare segno/coda, no jump", "SC|GQ Z"],
];

for (const [name, body] of CHARTS) {
    test(`lockstep: ${name}`, () => {
        const { audio, cursor } = lockstep(body);
        assert.equal(audio, cursor, `audio ${audio} ≠ cursor ${cursor} for "${body}"`);
        assert.ok(audio > 0, "chart expands to a positive length");
    });
}
