// Form-gated chart playback (src/simulation.js _stepCurveFormGated): a scoped
// chart object's cursor is driven by the shared form clock, not its own
// accumulator — it sweeps 0→1 across each window where its section sounds, and
// parks at the start (t=0, no beats, beat order dropped) between occurrences.
//
// We call _stepCurveFormGated directly with the two collaborators it delegates
// to (physics + beat-crossing) stubbed out, so the test exercises the pure
// gating math offline (no canvas, no Strudel, no real transport).

import { test } from "node:test";
import assert from "node:assert/strict";

import { Simulation } from "../src/simulation.js";

function gatedSim(windows, formBeats) {
    const transport = { elapsedBeats: 0, audioTimeForElapsed: (t) => t };
    const sim = new Simulation(transport);
    let beatDetections = 0;
    sim._detectActiveBeatCrossings = () => { beatDetections += 1; };
    sim._stepCurvePhysics = () => {};
    const curve = { id: "C", chartFormWindows: windows, chartFormBeats: formBeats };
    const state = {
        speedList: [1], cycleCount: 0, cycleProgress: 0, t: 0,
        halted: false, _beatOrder: "stale",
    };
    const step = (beat) => { transport.elapsedBeats = beat; sim._stepCurveFormGated(curve, state, 1 / 240); };
    return { state, step, beats: () => beatDetections };
}

test("inside a window the cursor sweeps 0→1; outside it parks at 0", () => {
    // One window [16,32) of a 48-beat form (a no-repeat 4-bar section).
    const { state, step } = gatedSim([{ startBeat: 16, endBeat: 32 }], 48);

    step(8);                                   // before the window
    assert.equal(state.t, 0);
    assert.equal(state.cycleProgress, 0);
    assert.equal(state.halted, false);         // parked, NOT halted (still stepped)
    assert.equal(state._beatOrder, null);      // dropped so re-entry re-arms clean

    step(16);                                   // window start → downbeat
    assert.equal(state.cycleProgress, 0);
    assert.equal(state.cycleCount, 0);

    step(24);                                   // halfway through the window
    assert.ok(Math.abs(state.t - 0.5) < 1e-9);

    step(40);                                   // after the window → parked again
    assert.equal(state.t, 0);
    assert.equal(state._beatOrder, null);
});

test("a section in a repeat is one cycle per occurrence; firing only in-window", () => {
    // Two windows [0,4) and [8,12) of a 16-beat form (bar 0 of a 2-bar repeat).
    const { state, step, beats } = gatedSim(
        [{ startBeat: 0, endBeat: 4 }, { startBeat: 8, endBeat: 12 }], 16);

    step(2);                                    // first occurrence
    assert.equal(state.cycleCount, 0);
    assert.ok(Math.abs(state.cycleProgress - 0.5) < 1e-9);

    step(6);                                     // gap → parked, no beat detection
    const firedInGap = beats();
    step(6.01);
    assert.equal(beats(), firedInGap);          // still no firing while parked

    step(10);                                    // second occurrence → new cycle
    assert.equal(state.cycleCount, 1);
    assert.ok(Math.abs(state.cycleProgress - 0.5) < 1e-9);

    step(16 + 2);                                // next form pass, first occurrence again
    assert.equal(state.cycleCount, 2);           // pass 1 × 2 windows + window 0
});
