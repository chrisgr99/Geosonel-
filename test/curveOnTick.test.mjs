// Focused tests for curve onTick dispatch (src/simulation.js
// _runCurveOnTick) and the onBeatInterval gate it exposes.
//
// We drive the helper directly on a Simulation instance whose fields we
// populate by hand (scene, curve runtime state, audio sink), rather than
// running the whole fixed-step loop — that keeps the test offline (no
// canvas, no Strudel, no transport clock) while exercising the REAL
// gating logic, context construction, and firing path. The audio sink
// captures fires so we can assert what the callback emitted.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Simulation } from "../src/simulation.js";

// Minimal transport stub: _runCurveOnTick reads .bpm (passed in as the
// bpm arg here, so unused) and .audioTimeForElapsed for the note stamp.
const stubTransport = {
    bpm: 120,
    audioTimeForElapsed: (t) => t,
};

// Build a Simulation with the just-enough state _runCurveOnTick touches.
// `fn` is the curve's onTick callback; `curveOverrides` lets a test flip
// canTick / state / onTickFunction to probe the gates.
function makeSim(fn, curveOverrides = {}) {
    const sim = new Simulation(stubTransport);
    const fires = [];
    sim._audioSink = (id, spec) => fires.push({ id, ...spec });
    const curve = {
        id: "CRV1",
        kind: "curve",
        canTick: true,
        state: "active",
        onTickFunction: "tick",
        color: "#ff0000",
        shape: { type: "line", x1: 0, y1: 0, x2: 100, y2: 0 },
        ...curveOverrides,
    };
    sim._scene = {
        curves: [curve],
        triggers: [],
        sprites: [],
        functionMap: { tick: fn },
    };
    // Runtime cursor state the firing-position/centre helpers read.
    sim._curveState.set(curve.id, { t: 0.5, dx: 0, dy: 0 });
    sim._simTime = 0;
    return { sim, curve, fires };
}

test("curve onTick fires when canTick and onTickFunction resolve", () => {
    let ran = 0;
    const { sim, curve, fires } = makeSim(function () {
        ran += 1;
        this.playNote(60);
    });
    sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    assert.equal(ran, 1);
    assert.equal(fires.length, 1);
    assert.equal(fires[0].id, "CRV1");
    assert.equal(fires[0].note, 60);
});

test("curve onTick context exposes curve identity, position and colour", () => {
    let ctx = null;
    const { sim, curve } = makeSim(function () { ctx = this; });
    sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    assert.equal(ctx.kind, "curve");
    assert.equal(ctx.id, "CRV1");
    // Cursor at t=0.5 on the 0..100 line -> firing x = 50.
    assert.equal(ctx.x, 50);
    assert.equal(ctx.y, 0);
    // Default tick velocity is full (no beat accent).
    assert.equal(ctx.vel, 1);
    // Tick context has NO beat accent fields.
    assert.equal(ctx.beatIndex, undefined);
    assert.equal(ctx.beatStrength, undefined);
    // Authored colour decoded to signals (red -> r channel high).
    assert.equal(typeof ctx.color, "object");
    assert.ok(ctx.color.r > 0);
});

test("curve onTick does not fire when canTick is false", () => {
    let ran = 0;
    const { sim, curve } = makeSim(() => { ran += 1; }, { canTick: false });
    sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    assert.equal(ran, 0);
});

test("curve onTick does not fire when the curve is disabled", () => {
    let ran = 0;
    const { sim, curve } = makeSim(() => { ran += 1; }, { state: "disabled" });
    sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    assert.equal(ran, 0);
});

test("curve onTick does not fire with no resolved onTickFunction", () => {
    let ran = 0;
    const { sim, curve } = makeSim(() => { ran += 1; }, { onTickFunction: "" });
    sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    assert.equal(ran, 0);
});

test("a throwing curve onTick is disabled for the session", () => {
    let ran = 0;
    const { sim, curve } = makeSim(() => { ran += 1; throw new Error("boom"); });
    // Suppress the expected console.error noise.
    const origErr = console.error;
    console.error = () => {};
    try {
        sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
        // Second call must be gated out by the session-disable set.
        sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    } finally {
        console.error = origErr;
    }
    assert.equal(ran, 1);
    assert.ok(sim._onTickDisabled.has("CRV1"));
});

test("ctx.onBeatInterval crosses a Qtr boundary as sim time advances", () => {
    // At 120 BPM a beat is 0.5 s; ONTICK_DT (1/60 s) advances the beat
    // position by 120/60 * 1/60 = 1/30 beat per tick. Stepping simTime
    // across the beat-1 boundary should fire exactly once for "Qtr".
    let ctx = null;
    const { sim, curve } = makeSim(function () { ctx = this; });

    const hits = [];
    // Walk simTime from just before to just after 0.5 s (beat 1.0).
    for (let st = 0.48; st <= 0.54; st += 1 / 60) {
        sim._simTime = st;
        sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
        hits.push(ctx.onBeatInterval("Qtr"));
    }
    // Exactly one of the ticks straddled the beat-1 boundary.
    assert.equal(hits.filter(Boolean).length, 1);
});

test("ctx.onBeatInterval no-ops for an unparseable interval", () => {
    let result = true;
    const { sim, curve } = makeSim(function () {
        result = this.onBeatInterval("nonsense");
    });
    sim._simTime = 0.5;
    sim._runCurveOnTick(curve, sim._curveState.get(curve.id), 1 / 60, 120);
    assert.equal(result, false);
});
