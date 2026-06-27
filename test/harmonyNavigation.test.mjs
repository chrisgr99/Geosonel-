// Unit tests for src/harmonyNavigation.js — the shared play-order engine:
//   classifyNavComment — read iReal comment text → nav intent
//   sequenceBars       — structural bars → the order they actually play
// Pure module, runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyNavComment, sequenceBars } from "../src/harmonyNavigation.js";

// --- classifyNavComment ---------------------------------------------

test("classifyNavComment: D.S./D.C. al Coda/Fine variants", () => {
    assert.deepEqual(classifyNavComment("D.S. al Coda"),
        { kind: "jump", from: "DS", target: { type: "coda" } });
    assert.deepEqual(classifyNavComment("D.C. al Coda"),
        { kind: "jump", from: "DC", target: { type: "coda" } });
    assert.deepEqual(classifyNavComment("D.C. al Fine"),
        { kind: "jump", from: "DC", target: { type: "fine" } });
    assert.deepEqual(classifyNavComment("D.S. al Fine"),
        { kind: "jump", from: "DS", target: { type: "fine" } });
});

test("classifyNavComment: strips *NN and XyQ noise", () => {
    assert.deepEqual(classifyNavComment("*66D.S. al Coda"),
        { kind: "jump", from: "DS", target: { type: "coda" } });
    assert.deepEqual(classifyNavComment("XyQXyQ  D.S. al Coda"),
        { kind: "jump", from: "DS", target: { type: "coda" } });
    assert.deepEqual(classifyNavComment("*68  Fine"), { kind: "fine" });
});

test("classifyNavComment: al Nth ending", () => {
    assert.deepEqual(classifyNavComment("D.C. al 2nd ending"),
        { kind: "jump", from: "DC", target: { type: "ending", n: 2 } });
    assert.deepEqual(classifyNavComment("D.C. al 3rd End."),
        { kind: "jump", from: "DC", target: { type: "ending", n: 3 } });
    assert.deepEqual(classifyNavComment("D.S. al 2nd End."),
        { kind: "jump", from: "DS", target: { type: "ending", n: 2 } });
});

test("classifyNavComment: prose-wrapped + lowercase + on-cue", () => {
    assert.deepEqual(classifyNavComment("Solos on CD, after solos D.S. al Coda"),
        { kind: "jump", from: "DS", target: { type: "coda" } });
    assert.deepEqual(classifyNavComment("D.C. al coda"),
        { kind: "jump", from: "DC", target: { type: "coda" } });
    assert.deepEqual(classifyNavComment("D.C. on cue"),
        { kind: "jump", from: "DC", target: { type: "end" } });
});

test("classifyNavComment: Fine marker and repeat count", () => {
    assert.deepEqual(classifyNavComment("Fine"), { kind: "fine" });
    assert.deepEqual(classifyNavComment("3x"), { kind: "repeat", times: 3 });
    assert.deepEqual(classifyNavComment("7x"), { kind: "repeat", times: 7 });
});

test("classifyNavComment: non-navigational comments → null", () => {
    assert.equal(classifyNavComment("Repeat and Fade"), null);
    assert.equal(classifyNavComment("original in E, G"), null);
    assert.equal(classifyNavComment("Solos"), null);
    assert.equal(classifyNavComment(""), null);
});

// --- sequenceBars: repeats + endings (no nav) -----------------------

test("sequenceBars: a plain { } repeat plays twice", () => {
    const bars = [{ repeatOpen: true }, {}, { repeatClose: true }];
    assert.deepEqual(sequenceBars(bars).order, [0, 1, 2, 0, 1, 2]);
});

test("sequenceBars: passes override (<3x>) plays three times", () => {
    const bars = [{ repeatOpen: true, passes: 3 }, { repeatClose: true }];
    assert.deepEqual(sequenceBars(bars).order, [0, 1, 0, 1, 0, 1]);
});

test("sequenceBars: 1st/2nd endings select by pass", () => {
    // {  A  | B  | N1 C :}  N2 D
    const bars = [
        { repeatOpen: true }, {},
        { ending: 1, repeatClose: true },
        { ending: 2 },
    ];
    // pass1: 0,1, ending1 plays, loop; pass2: 0,1, ending1 skipped→ending2.
    assert.deepEqual(sequenceBars(bars).order, [0, 1, 2, 0, 1, 3]);
});

// --- sequenceBars: navigation ---------------------------------------

test("sequenceBars: D.S. al Coda — To-Coda sign at bar START skips that bar", () => {
    // 0:segno 1 2:coda(toCoda, at bar start) 3:nav 4:coda(start) 5
    const bars = [
        { segno: true }, {}, { coda: true },
        { nav: { from: "DS", target: { type: "coda" } } },
        { coda: true }, {},
    ];
    const { order } = sequenceBars(bars);
    // normal to the nav bar, then from segno: replay 0,1, reach the To-Coda sign at
    // the START of bar 2 → jump to the Coda (4) WITHOUT playing 2, then 5.
    assert.deepEqual(order, [0, 1, 2, 3, 0, 1, 4, 5]);
});

test("sequenceBars: D.S. al Coda — To-Coda sign at bar END plays that bar then jumps", () => {
    // Same form, but the To-Coda §Q sits at bar 2's END (codaAfter) — iReal's common
    // case (All My Loving). Bar 2 must be PLAYED on the return before the jump.
    const bars = [
        { segno: true }, {}, { coda: true, codaAfter: true },
        { nav: { from: "DS", target: { type: "coda" } } },
        { coda: true }, {},
    ];
    const { order } = sequenceBars(bars);
    assert.deepEqual(order, [0, 1, 2, 3, 0, 1, 2, 4, 5]);
});

test("sequenceBars: D.C. al Fine returns to top and stops at Fine", () => {
    const bars = [
        {}, { fine: true }, {},
        { nav: { from: "DC", target: { type: "fine" } } },
    ];
    const { order } = sequenceBars(bars);
    assert.deepEqual(order, [0, 1, 2, 3, 0, 1]);
});

test("sequenceBars: D.S. al 2nd ending takes the chosen ending on return", () => {
    // Real shape: endings live inside a completed repeat; the D.S. sits at the
    // end of a later section. { S A | B | N1 C :} N2 D | E | <D.S. al 2nd End.>
    const bars = [
        { segno: true, repeatOpen: true }, {},
        { ending: 1, repeatClose: true }, { ending: 2 },
        {}, { nav: { from: "DS", target: { type: "ending", n: 2 } } },
    ];
    const { order } = sequenceBars(bars);
    // Normal pass takes N1 then N2 (indices 2 then 3); the nav fires at bar 5;
    // the return trip re-reaches the 2nd ending (index 3) without re-looping.
    const navAt = order.indexOf(5);
    assert.ok(navAt >= 0, "nav bar is played");
    assert.ok(order.slice(navAt + 1).includes(3), "2nd ending taken on return");
    assert.ok(!order.slice(navAt + 1).includes(2), "1st ending skipped on return");
});

test("sequenceBars: D.S. with no segno is noted and ignored", () => {
    const bars = [{}, {}, { nav: { from: "DS", target: { type: "coda" } } }];
    const { order, notes } = sequenceBars(bars);
    assert.deepEqual(order, [0, 1, 2]); // plays straight through
    assert.ok(notes.some((m) => /no segno/i.test(m)));
});

test("sequenceBars: empty input is safe", () => {
    assert.deepEqual(sequenceBars([]), { order: [], notes: [] });
    assert.deepEqual(sequenceBars(/** @type {any} */ (null)), { order: [], notes: [] });
});
