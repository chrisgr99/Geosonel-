// Sprites play beat points exactly like curves: the shared crossing detector
// (_detectActiveBeatCrossings) fires a sprite's onActiveBeat as the cycle clock
// crosses its baked beats. We drive the detector directly on a Simulation with a
// hand-built sprite + runtime state (no canvas, no transport loop), the same
// offline style as curveOnTick.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Simulation } from "../src/simulation.js";

const stubTransport = { bpm: 120, audioTimeForElapsed: (t) => t };

function makeSpriteSim(fn, spriteOverrides = {}) {
    const sim = new Simulation(stubTransport);
    const fires = [];
    sim._audioSink = (id, spec) => fires.push({ id, ...spec });
    const sprite = {
        id: "SPR1", kind: "sprite", state: "active",
        canActiveBeat: true, onActiveBeatFunction: "beat",
        color: "#ff0000", x: 30, y: 40,
        ...spriteOverrides,
    };
    sim._scene = { curves: [], sprites: [sprite], triggers: [], functionMap: { beat: fn } };
    // A baked single beat at cycle-fraction 0, forward order — the sprite's
    // runtime state carries the same beat fields a curve's does.
    const state = {
        x: 30, y: 40, dx: 0, dy: 0, cycleProgress: 0, cycleCount: 0,
        speedList: [1], _beatFractions: [0], _beatStrengths: [5], _beatRanges: [], _beatDrops: [],
        _beatOrder: null, _beatOrderSign: 0, _lastBeatCycle: -1, _beatNextIdx: 0,
    };
    sim._spriteState.set("SPR1", state);
    sim._simTime = 0;
    return { sim, sprite, state, fires };
}

test("a sprite fires onActiveBeat at its baked beats, with kind 'sprite'", () => {
    let ran = 0;
    let ctxKind = null;
    const { sim, sprite, state, fires } = makeSpriteSim(function () {
        ran += 1;
        ctxKind = this.kind;
        this.playNote(60);
    });
    // cycleProgress 0 with a downbeat at fraction 0 → fires it.
    sim._detectActiveBeatCrossings(sprite, state, "sprite");
    assert.equal(ran, 1);
    assert.equal(ctxKind, "sprite");          // fired through the sprite path
    assert.equal(fires.length, 1);
    assert.equal(fires[0].id, "SPR1");
    assert.equal(fires[0].note, 60);
});

test("a sprite with canActiveBeat off does not fire", () => {
    let ran = 0;
    const { sim, sprite, state } = makeSpriteSim(function () { ran += 1; }, { canActiveBeat: false });
    sim._detectActiveBeatCrossings(sprite, state, "sprite");
    assert.equal(ran, 0);
});

test("the cycle phase tracks the master clock exactly; cycleSpeeds scales the rate", () => {
    // The phase is derived from the clock (no accumulator), so cycleProgress is an
    // exact function of time — that's what keeps a sprite tempo-locked / drift-free.
    const progAt = (cycleSpeeds, t) => {
        // Transport with no formBeats → the step falls back to _simTime, which we drive.
        const sim = new Simulation({ bpm: 120, audioTimeForElapsed: (x) => x });
        const sprite = {
            id: "S", kind: "sprite", state: "active", x: 0, y: 0, vx: 0, vy: 0,
            beatsPerCycle: 4, beatInterval: "Qtr", cycleSpeeds, canActiveBeat: false,
        };
        sim.setScene({ curves: [], sprites: [sprite], triggers: [], functionMap: {}, canvasW: 200, canvasH: 200, kinematics: null });
        sim._simTime = t;
        sim._stepSprites(0.001, 120, false);
        return sim._spriteState.get("S").cycleProgress;
    };
    // cd = 4 quarters @120bpm = 2s. cycleProgress = (t / cycleDuration) mod 1.
    assert.ok(Math.abs(progAt("1", 0.5) - 0.25) < 1e-9);   // 0.5 / 2
    assert.ok(Math.abs(progAt("1", 1.5) - 0.75) < 1e-9);   // exact, no drift
    assert.ok(Math.abs(progAt("2", 0.5) - 0.5) < 1e-9);    // speed 2 → cycle = 1s → 0.5/1
});

test("the sprite firing context reports the sprite's own position", () => {
    let ctxX = null;
    let ctxY = null;
    const { sim, sprite, state } = makeSpriteSim(function () { ctxX = this.x; ctxY = this.y; });
    sim._detectActiveBeatCrossings(sprite, state, "sprite");
    // The beat fires at the sprite's position (not a point along a curve).
    assert.equal(ctxX, 30);
    assert.equal(ctxY, 40);
});
