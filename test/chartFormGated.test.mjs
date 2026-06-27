// Form-gated chart playback (src/simulation.js _stepCurveFormGated): a scoped
// chart object's cursor is driven by the shared form clock, not its own
// accumulator. It advances ONE section-bar per in-section PLAYED bar
// (chartFormSegs), so the rhythm stays beat-locked and re-traces every
// sectionBars no matter how the form repeats the section — and parks (t=0, no
// beats) between in-section bars.
//
// We call _stepCurveFormGated directly with the two collaborators it delegates
// to (physics + beat-crossing) stubbed out, so the test exercises the pure
// gating math offline (no canvas, no Strudel, no real transport).

import { test } from "node:test";
import assert from "node:assert/strict";

import { Simulation } from "../src/simulation.js";

/** segs: per in-section played bar {startBeat,endBeat}; sectionBars: folded count. */
function gatedSim(segs, sectionBars, formBeats) {
    // formBeats is the form clock the gated step reads (elapsedBeats + loop
    // offset); with no practice loop it equals elapsedBeats.
    const transport = {
        elapsedBeats: 0, _off: 0,
        get formBeats() { return this.elapsedBeats + this._off; },
        setLoopOffsetBeats(b) { this._off = b; },
        audioTimeForElapsed: (t) => t,
    };
    const sim = new Simulation(transport);
    let beatDetections = 0;
    sim._detectActiveBeatCrossings = () => { beatDetections += 1; };
    sim._stepCurvePhysics = () => {};
    const curve = {
        id: "C", chartFormSegs: segs, chartSectionBars: sectionBars, chartFormBeats: formBeats,
    };
    const state = {
        speedList: [1], cycleCount: 0, cycleProgress: 0, t: 0,
        halted: false, _beatOrder: "stale",
    };
    const step = (beat) => { transport.elapsedBeats = beat; sim._stepCurveFormGated(curve, state, 1 / 240); };
    return { state, step, sim, transport, beats: () => beatDetections };
}

// A 4-bar section sounding once at form beats [16,32): one segment per bar.
const fourBarOnce = [
    { startBeat: 16, endBeat: 20 }, { startBeat: 20, endBeat: 24 },
    { startBeat: 24, endBeat: 28 }, { startBeat: 28, endBeat: 32 },
];

test("inside the section the cursor sweeps 0→1 by bar; outside it parks at 0", () => {
    const { state, step } = gatedSim(fourBarOnce, 4, 48);

    step(8);                                   // before the section
    assert.equal(state.t, 0);
    assert.equal(state.cycleProgress, 0);
    assert.equal(state.halted, false);         // parked, NOT halted (still stepped)
    assert.equal(state._beatOrder, null);      // dropped so re-entry re-arms clean

    step(16);                                   // first bar → downbeat
    assert.equal(state.cycleProgress, 0);
    assert.equal(state.cycleCount, 0);

    step(24);                                   // third bar (index 2 of 4) → halfway
    assert.ok(Math.abs(state.t - 0.5) < 1e-9);

    step(40);                                   // after the section → parked again
    assert.equal(state.t, 0);
    assert.equal(state._beatOrder, null);
});

test("a 1-bar section in a repeat is one cycle per occurrence; no firing while parked", () => {
    // Bar 0 of a 2-bar repeat: in-section played bars at [0,4) and [8,12).
    const segs = [{ startBeat: 0, endBeat: 4 }, { startBeat: 8, endBeat: 12 }];
    const { state, step, beats } = gatedSim(segs, 1, 16);

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
    assert.equal(state.cycleCount, 2);
});

test("constant rhythm rate across uneven repeated runs (the variable-speed fix)", () => {
    // A 2-bar section that plays once (bars at [0,8)), then back-to-back 3× as a
    // 6-bar run (bars at [20,44)). The OLD merged-window model stretched the
    // pattern over each run's whole span (8 vs 24 beats) → different speeds. The
    // per-bar model advances 1 bar per played bar, so the rate is identical.
    const segs = [
        { startBeat: 0, endBeat: 4 }, { startBeat: 4, endBeat: 8 },           // once
        { startBeat: 20, endBeat: 24 }, { startBeat: 24, endBeat: 28 },        // then 3× back-to-back
        { startBeat: 28, endBeat: 32 }, { startBeat: 32, endBeat: 36 },
        { startBeat: 36, endBeat: 40 }, { startBeat: 40, endBeat: 44 },
    ];
    const { state, step } = gatedSim(segs, 2, 48);

    // At every in-section bar START the cursor is at 0 (even bar) or 0.5 (odd) —
    // never stretched — in BOTH the lone occurrence and the long run.
    const progAtBarStart = (beat) => { step(beat); return state.cycleProgress; };
    assert.ok(Math.abs(progAtBarStart(0) - 0) < 1e-9);
    assert.ok(Math.abs(progAtBarStart(4) - 0.5) < 1e-9);
    assert.ok(Math.abs(progAtBarStart(20) - 0) < 1e-9);   // long run, same phase
    assert.ok(Math.abs(progAtBarStart(24) - 0.5) < 1e-9);
    assert.ok(Math.abs(progAtBarStart(28) - 0) < 1e-9);

    // Mid-bar the advance is identical in both runs: 0→0.25 over the same 2 beats.
    step(0); const a0 = state.cycleProgress; step(2); const a1 = state.cycleProgress;
    step(20); const b0 = state.cycleProgress; step(22); const b1 = state.cycleProgress;
    assert.ok(Math.abs((a1 - a0) - (b1 - b0)) < 1e-9);    // same rate, run-independent
    assert.ok(Math.abs((a1 - a0) - 0.25) < 1e-9);

    // Each 2-bar traversal is its own cycle (so the pattern re-arms each pass).
    step(0);  assert.equal(state.cycleCount, 0);
    step(20); assert.equal(state.cycleCount, 1);
    step(28); assert.equal(state.cycleCount, 2);
    step(36); assert.equal(state.cycleCount, 3);
});

test("formBeatToChartBeat expands a compressed form beat to the chart beat", () => {
    const { sim } = gatedSim([{ startBeat: 0, endBeat: 4 }], 1, 32);
    sim._formMap = { chartTotal: 32, compressedTotal: 24, segments: [
        { chartStart: 8, compStart: 0, len: 8 },     // run 1: chart 8..16
        { chartStart: 24, compStart: 8, len: 16 },   // run 2: chart 24..40 (a dropped gap before it)
    ] };
    assert.equal(sim.formBeatToChartBeat(0), 8);     // form 0 → start of run 1
    assert.equal(sim.formBeatToChartBeat(4), 12);    // within run 1
    assert.equal(sim.formBeatToChartBeat(8), 24);    // form 8 → start of run 2 (jumped the gap)
    assert.equal(sim.formBeatToChartBeat(10), 26);
    sim._formMap = null;
    assert.equal(sim.formBeatToChartBeat(5), 5);     // identity when uncompressed
});

test("a gated object reads the chart beat through the compressed-form map", () => {
    // Section A sounds at chart beats [8,16) (2 bars); the intro [0,8) is dropped,
    // so under compression form beat 0 lands on A's first bar.
    const segs = [{ startBeat: 8, endBeat: 12 }, { startBeat: 12, endBeat: 16 }];
    const { state, step, sim } = gatedSim(segs, 2, 32);
    sim._formMap = { chartTotal: 32, compressedTotal: 24, segments: [{ chartStart: 8, compStart: 0, len: 24 }] };

    step(0);                                    // form 0 → chart 8 = A bar 0 downbeat
    assert.equal(state.cycleProgress, 0);
    assert.equal(state.cycleCount, 0);
    step(2);                                    // form 2 → chart 10 = quarter through bar 0
    assert.ok(Math.abs(state.cycleProgress - 0.25) < 1e-9);
});

test("multi-section: the active beat array swaps per section, re-tracing each occurrence", () => {
    const transport = {
        elapsedBeats: 0, _off: 0,
        get formBeats() { return this.elapsedBeats + this._off; },
        setLoopOffsetBeats(b) { this._off = b; },
    };
    const sim = new Simulation(transport);
    sim._detectActiveBeatCrossings = () => {};
    sim._stepCurvePhysics = () => {};
    // Form: B(occ0) C(occ1) B(occ2) — two sections, B recurs.
    const curve = {
        id: "U", chartMulti: true, chartMultiSectionBars: [2, 2],
        chartMultiSegs: [
            { startBeat: 0, endBeat: 4, sec: 0, barInSec: 0, occ: 0 },
            { startBeat: 4, endBeat: 8, sec: 0, barInSec: 1, occ: 0 },
            { startBeat: 8, endBeat: 12, sec: 1, barInSec: 0, occ: 1 },
            { startBeat: 12, endBeat: 16, sec: 1, barInSec: 1, occ: 1 },
            { startBeat: 16, endBeat: 20, sec: 0, barInSec: 0, occ: 2 },
            { startBeat: 20, endBeat: 24, sec: 0, barInSec: 1, occ: 2 },
        ],
    };
    const state = {
        speedList: [1], cycleCount: 0, cycleProgress: 0, t: 0, halted: false, _beatOrder: "stale",
        _activeSec: -1, _chartMultiBeats: [
            { positions: [0], strengths: [5], ranges: [], drops: [] },      // section 0 (B)
            { positions: [0.5], strengths: [5], ranges: [], drops: [] },    // section 1 (C)
        ],
    };
    const step = (b) => { transport.elapsedBeats = b; sim._stepCurveMultiSection(curve, state, 1 / 240); };

    step(0);                                     // B, occ 0
    assert.equal(state._activeSec, 0);
    assert.equal(state.cycleCount, 0);
    assert.deepEqual(state._beatFractions, [0]);     // B's beats

    step(9);                                     // C, occ 1 → swap to section 1
    assert.equal(state._activeSec, 1);
    assert.equal(state.cycleCount, 1);
    assert.deepEqual(state._beatFractions, [0.5]);   // C's beats
    // bar 0 of a 2-bar section, a quarter into the bar → (0 + 0.25)/2 = 0.125.
    assert.ok(Math.abs(state.cycleProgress - 0.125) < 1e-9);

    step(16);                                    // B again, occ 2 → swap back to section 0
    assert.equal(state._activeSec, 0);
    assert.equal(state.cycleCount, 2);
    assert.deepEqual(state._beatFractions, [0]);
});

test("a practice loop offsets the form clock so the loop maps onto the section", () => {
    // The section sounds only at form beats [16,32). A practice loop over those 16
    // beats runs the transport [0,16) but offsets the form clock by +16 → the
    // object plays its section every pass with no parked stretch.
    const { state, step, sim, transport } = gatedSim(fourBarOnce, 4, 48);
    sim.setPracticeLoop(16, 16);
    assert.equal(transport._off, 16);            // offset applied to the transport
    assert.equal(sim._practiceLoopBeats, 16);    // wrap shortened to the loop length

    step(0);                                      // transport 0 → form beat 16 = bar 0
    assert.equal(state.cycleProgress, 0);
    assert.equal(state.t, 0);

    step(8);                                       // transport 8 → form beat 24 = bar 2 → halfway
    assert.ok(Math.abs(state.t - 0.5) < 1e-9);

    sim.clearPracticeLoop();
    assert.equal(transport._off, 0);
    assert.equal(sim._practiceLoopBeats, null);
});
