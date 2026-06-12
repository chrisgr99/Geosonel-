// Unit tests for the pure polyphony helpers (src/polyphony.js):
// the suppress-new decision, the duration-trim formula, the k-th-beat
// time computation, and the active-note registry. Pure, offline — no
// canvas, audio, or transport. See design/polyphony.md.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    LEGATO_OVERLAP_SECONDS,
    trimDuration,
    timeToKthBeat,
    shouldSuppress,
    VoiceRegistry,
} from "../src/polyphony.js";

// ---------------------------------------------------------------------------
// trimDuration — duration = min(requested, timeToKth + legato), shorten only.
// ---------------------------------------------------------------------------

test("trimDuration shortens a long note to timeToKth + legato", () => {
    // Requested 2 s, next-beat at 0.5 s => trimmed to 0.5 + 0.03.
    assert.equal(trimDuration(2, 0.5), 0.5 + LEGATO_OVERLAP_SECONDS);
});

test("trimDuration never extends a short note", () => {
    // Requested 0.1 s, next-beat at 0.5 s => min keeps 0.1 (no extend).
    assert.equal(trimDuration(0.1, 0.5), 0.1);
});

test("trimDuration uses the legato overlap exactly at the boundary", () => {
    // Requested exactly equals timeToKth + legato => unchanged.
    const t = 0.4;
    assert.equal(trimDuration(t + LEGATO_OVERLAP_SECONDS, t), t + LEGATO_OVERLAP_SECONDS);
});

test("trimDuration passes through when the schedule is unknown (null)", () => {
    assert.equal(trimDuration(2, null), 2);
});

test("trimDuration passes through on a non-finite next-beat time", () => {
    assert.equal(trimDuration(2, Infinity), 2);
    assert.equal(trimDuration(2, NaN), 2);
});

// ---------------------------------------------------------------------------
// timeToKthBeat — (gKth - gJustFired) * effectiveCycleTime, with cycle wrap.
// ---------------------------------------------------------------------------

// A small synthetic order: four evenly spaced beats, sorted by g.
const ORDER = [
    { g: 0.0 },
    { g: 0.25 },
    { g: 0.5 },
    { g: 0.75 },
];
const CYCLE = 4; // seconds per cycle

test("timeToKthBeat: k=1 from the first beat is one step ahead", () => {
    // Just fired beat at g=0 (nextIdx=1 points past it). k=1 => order[1] g=0.25.
    // (0.25 - 0) * 4 = 1 s.
    assert.equal(timeToKthBeat(ORDER, 1, 0.0, 1, CYCLE), 1);
});

test("timeToKthBeat: k=2 is two steps ahead", () => {
    // k=2 => order[1 + 2 - 1] = order[2] g=0.5. (0.5 - 0) * 4 = 2 s.
    assert.equal(timeToKthBeat(ORDER, 1, 0.0, 2, CYCLE), 2);
});

test("timeToKthBeat wraps into the next cycle by adding 1 per wrap", () => {
    // Just fired the last beat g=0.75 (nextIdx=4 = past end). k=1 wraps to
    // order[0] in the next cycle: gKth = 0.0 + 1 = 1.0. (1.0 - 0.75) * 4 = 1 s.
    assert.equal(timeToKthBeat(ORDER, 4, 0.75, 1, CYCLE), 1);
});

test("timeToKthBeat: k that exceeds the order wraps multiple cycles", () => {
    // nextIdx=1, k=5 => absIdx = 1 + 5 - 1 = 5 => one wrap, slot 1 g=0.25,
    // wraps=1 => gKth = 1.25. (1.25 - 0) * 4 = 5 s.
    assert.equal(timeToKthBeat(ORDER, 1, 0.0, 5, CYCLE), 5);
});

test("timeToKthBeat returns null on a degenerate (empty) order", () => {
    assert.equal(timeToKthBeat([], 0, 0, 1, CYCLE), null);
});

test("timeToKthBeat returns null on non-positive or non-finite cycle time", () => {
    assert.equal(timeToKthBeat(ORDER, 1, 0.0, 1, 0), null);
    assert.equal(timeToKthBeat(ORDER, 1, 0.0, 1, Infinity), null);
});

test("timeToKthBeat returns null for k < 1", () => {
    assert.equal(timeToKthBeat(ORDER, 1, 0.0, 0, CYCLE), null);
});

// ---------------------------------------------------------------------------
// shouldSuppress — object (fallback only) / group / score count vs limit.
// ---------------------------------------------------------------------------

const NONE = {
    checkObject: false,
    pObj: Infinity, countObject: 0,
    pGrp: Infinity, countGroup: 0,
    pScore: Infinity, countScore: 0,
};

test("shouldSuppress: all unlimited never suppresses", () => {
    assert.equal(shouldSuppress({ ...NONE, countObject: 99, countGroup: 99, countScore: 99 }), false);
});

test("shouldSuppress: object count enforced only when checkObject is true", () => {
    // At the cap with checkObject false (trimmed onActiveBeat path) => allowed.
    assert.equal(shouldSuppress({ ...NONE, checkObject: false, pObj: 1, countObject: 1 }), false);
    // Same counts with checkObject true (onTick/collision) => suppressed.
    assert.equal(shouldSuppress({ ...NONE, checkObject: true, pObj: 1, countObject: 1 }), true);
});

test("shouldSuppress: object count below the cap is allowed", () => {
    assert.equal(shouldSuppress({ ...NONE, checkObject: true, pObj: 2, countObject: 1 }), false);
});

test("shouldSuppress: group cap drops the new note at or above the limit", () => {
    assert.equal(shouldSuppress({ ...NONE, pGrp: 2, countGroup: 2 }), true);
    assert.equal(shouldSuppress({ ...NONE, pGrp: 2, countGroup: 1 }), false);
});

test("shouldSuppress: score cap drops the new note at or above the limit", () => {
    assert.equal(shouldSuppress({ ...NONE, pScore: 8, countScore: 8 }), true);
    assert.equal(shouldSuppress({ ...NONE, pScore: 8, countScore: 7 }), false);
});

test("shouldSuppress: any scope at its cap suppresses (group while object ok)", () => {
    assert.equal(shouldSuppress({
        ...NONE, checkObject: true, pObj: 4, countObject: 1,
        pGrp: 2, countGroup: 2,
    }), true);
});

// ---------------------------------------------------------------------------
// VoiceRegistry — prune-by-endTime, scope counts, register, clear.
// ---------------------------------------------------------------------------

test("VoiceRegistry counts per object, group, and total", () => {
    const r = new VoiceRegistry();
    r.register("A", "G1", 10);
    r.register("A", "G1", 11);
    r.register("B", "G1", 12);
    r.register("C", "G2", 13);
    assert.equal(r.countObject("A"), 2);
    assert.equal(r.countObject("B"), 1);
    assert.equal(r.countGroup("G1"), 3);
    assert.equal(r.countGroup("G2"), 1);
    assert.equal(r.countTotal(), 4);
});

test("VoiceRegistry prunes notes whose endTime <= now", () => {
    const r = new VoiceRegistry();
    r.register("A", "G1", 5);   // ends at 5
    r.register("A", "G1", 10);  // ends at 10
    r.prune(5);                 // 5 <= 5 dropped, 10 kept
    assert.equal(r.countObject("A"), 1);
    assert.equal(r.countTotal(), 1);
    r.prune(10);                // 10 <= 10 dropped
    assert.equal(r.countTotal(), 0);
});

test("VoiceRegistry.clear empties everything", () => {
    const r = new VoiceRegistry();
    r.register("A", "", 100);
    r.clear();
    assert.equal(r.countTotal(), 0);
});

// ---------------------------------------------------------------------------
// Integration of the helpers: registry counts feed shouldSuppress decisions
// the way _emitNote uses them (object-count fallback path).
// ---------------------------------------------------------------------------

test("registry + shouldSuppress: mono object fallback drops the 2nd voice", () => {
    const r = new VoiceRegistry();
    const now = 0;
    // First note (object mono, count fallback): nothing sounding => allowed.
    r.prune(now);
    assert.equal(shouldSuppress({
        ...NONE, checkObject: true, pObj: 1, countObject: r.countObject("A"),
    }), false);
    r.register("A", "", now + 1); // sounds until t=1
    // Second note at t=0.5 while the first still sounds => suppressed.
    r.prune(0.5);
    assert.equal(shouldSuppress({
        ...NONE, checkObject: true, pObj: 1, countObject: r.countObject("A"),
    }), true);
    // After the first expires (t=1) => allowed again.
    r.prune(1);
    assert.equal(shouldSuppress({
        ...NONE, checkObject: true, pObj: 1, countObject: r.countObject("A"),
    }), false);
});
