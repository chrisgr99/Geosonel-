// Unit tests for harmony UNWIND:
//   src/harmonyUnwind.js — unwindProgression / sanitiseUnwind / applyUnwind
//
// Unwinding writes every repeat/ending/simile out flat, then lays the
// one-pass song end-to-end N times, each copy opening a "Repeat k" section.
// Built on the player's expandProgression, so it inherits its repeat logic.
//
// Pure logic (no DOM) — runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    unwindProgression,
    sanitiseUnwind,
    applyUnwind,
} from "../src/harmonyUnwind.js";

const TS = /** @type {[number, number]} */ ([4, 4]);

/** A chord cell whose chord we tag with an id so we can read it back. */
function ch(id) {
    return { type: "chord", chord: { id } };
}

/** Compact view of a cell list: chord ids, "|" bars, "[Label" sections, "." empties. */
function shape(cells) {
    return cells.map((c) => {
        if (c.type === "chord") return c.noChord ? "NC" : c.chord.id;
        if (c.type === "bar") return "|";
        if (c.type === "empty") return ".";
        if (c.type === "sectionOpen") return "[" + c.label;
        return c.type;
    });
}

test("unwindProgression: plain bars, 1 iteration → one Repeat 1 section", () => {
    const prog = [ch("A"), { type: "bar" }, ch("B"), { type: "bar" }, ch("C")];
    const out = unwindProgression(prog, TS, 1);
    assert.deepEqual(shape(out), ["[Repeat 1", "A", "|", "B", "|", "C", "|"]);
});

test("unwindProgression: a { } repeat is written out flat", () => {
    // { A | B }  →  A B A B  (expandProgression default 2 passes)
    const prog = [
        { type: "repeatOpen" },
        ch("A"), { type: "bar" },
        ch("B"),
        { type: "repeatClose" },
    ];
    const out = unwindProgression(prog, TS, 1);
    assert.deepEqual(shape(out), ["[Repeat 1", "A", "|", "B", "|", "A", "|", "B", "|"]);
    // No repeat markers survive.
    assert.ok(!out.some((c) => c.type === "repeatOpen" || c.type === "repeatClose"));
});

test("unwindProgression: N iterations each get a numbered section", () => {
    const prog = [ch("A"), { type: "bar" }, ch("B")];
    const out = unwindProgression(prog, TS, 3);
    const sections = out.filter((c) => c.type === "sectionOpen").map((c) => c.label);
    assert.deepEqual(sections, ["Repeat 1", "Repeat 2", "Repeat 3"]);
    // Each iteration repeats the same flat content.
    assert.deepEqual(shape(out), [
        "[Repeat 1", "A", "|", "B", "|",
        "[Repeat 2", "A", "|", "B", "|",
        "[Repeat 3", "A", "|", "B", "|",
    ]);
});

test("unwindProgression: a whole-song repeat is also written out, then ×N", () => {
    // { A B } with iterations 2  →  expand to A B A B, then twice.
    const prog = [
        { type: "repeatOpen" },
        ch("A"), { type: "bar" },
        ch("B"),
        { type: "repeatClose" },
    ];
    const out = unwindProgression(prog, TS, 2);
    const bars = out.filter((c) => c.type === "chord").map((c) => c.chord.id);
    assert.deepEqual(bars, ["A", "B", "A", "B", "A", "B", "A", "B"]);
});

test("unwindProgression: evenly-spread split bar stays adjacent (no filler)", () => {
    // Two chords in one 4/4 bar (even spread) → emitted adjacent, no empties.
    const prog = [ch("A"), ch("B")];
    const out = unwindProgression(prog, TS, 1);
    assert.deepEqual(shape(out), ["[Repeat 1", "A", "B", "|"]);
});

test("unwindProgression: a song's own sections survive, tagged per repeat", () => {
    // *A C | *B G   →   sections A (one bar) then B (one bar). Unwind 2.
    const prog = [
        { type: "sectionOpen", label: "A" }, ch("C"), { type: "bar" },
        { type: "sectionOpen", label: "B" }, ch("G"),
    ];
    const out = unwindProgression(prog, TS, 2);
    const sections = out.filter((c) => c.type === "sectionOpen").map((c) => c.label);
    // First section of each repeat folds the number in; inner sections keep
    // their letter.
    assert.deepEqual(sections, ["Repeat 1: A", "B", "Repeat 2: A", "B"]);
});

test("sanitiseUnwind: off / range / clamp", () => {
    assert.equal(sanitiseUnwind(null), null);
    assert.equal(sanitiseUnwind(undefined), null);
    assert.equal(sanitiseUnwind(0), null);
    assert.equal(sanitiseUnwind(-3), null);
    assert.equal(sanitiseUnwind(1), 1);
    assert.equal(sanitiseUnwind(8), 8);
    assert.equal(sanitiseUnwind(100), 8); // clamp to max
    assert.equal(sanitiseUnwind(3.4), 3); // round
});

test("applyUnwind: null harmony, off harmony, and on harmony", () => {
    assert.equal(applyUnwind(null), null);

    const folded = {
        progression: [ch("A"), { type: "bar" }, ch("B")],
        timeSignature: TS,
    };
    // No unwind field → returned unchanged (same reference).
    assert.equal(applyUnwind(folded), folded);

    const on = { ...folded, unwind: 2 };
    const eff = applyUnwind(on);
    assert.notEqual(eff, on);
    assert.equal(eff.unwind, 2);
    const sections = eff.progression.filter((c) => c.type === "sectionOpen");
    assert.equal(sections.length, 2);
    // Original progression untouched.
    assert.equal(on.progression.length, 3);
});
