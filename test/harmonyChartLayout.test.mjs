// Unit tests for the chord-chart BAR layout:
//   src/harmonyChartLayout.js — layoutChart(progression, key, mode, ts)
//
// Focus: a measure-repeat (simile) occupies its OWN bar. A common iReal idiom
// writes `C-7 XyQ Kcl` with NO barline before the repeat ("bar 1 = C-7, bar 2 =
// repeat bar 1"). The simile must not be swallowed into the chord's bar — doing
// so dropped a whole measure from the chart (e.g. the last bar of a section that
// ended in a repeat). expandProgression already groups this way; layoutChart
// must agree so the chart and playback show the same bar count.
//
// Pure logic (no DOM) — runs under `node --test`. We feed raw-only chord cells
// (no parsed Chord), so labels fall back to the raw symbol — enough to assert
// bar STRUCTURE without building Chord objects.

import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutChart, sectionBarRange } from "../src/harmonyChartLayout.js";

const KEY = { tonicPitchClass: 0, mode: "major" };
const TS = /** @type {[number, number]} */ ([4, 4]);

const chord = (raw) => ({ type: "chord", raw });
const empty = () => ({ type: "empty" });
const div = () => ({ type: "barDivider" });
const barline = () => ({ type: "bar" });
const kcl = () => ({ type: "repeatLastBar" });

/** Compact view of a bar's slots for assertions. */
const slotsOf = (bar) =>
    bar.slots.map((s) => (s.simile ? `SIM:${s.simile}` : s.empty ? "_" : s.label));

test("layoutChart: a repeat with NO barline before it becomes its own bar", () => {
    // The `C-7 , XyQ Kcl` idiom → bar 1 = C-7, bar 2 = the repeat. Before the
    // fix the Kcl was appended to the C-7 bar and the measure vanished.
    const bars = layoutChart([chord("C-7"), div(), empty(), kcl()], KEY, "letter", TS);
    assert.equal(bars.length, 2);
    assert.deepEqual(slotsOf(bars[0]), ["C-7", "_"]);
    assert.deepEqual(slotsOf(bars[1]), ["SIM:last"]);
});

test("layoutChart: a repeat WITH a barline before it stays a single bar (unchanged)", () => {
    const bars = layoutChart([chord("C-7"), barline(), kcl()], KEY, "letter", TS);
    assert.equal(bars.length, 2);
    assert.deepEqual(slotsOf(bars[0]), ["C-7"]);
    assert.deepEqual(slotsOf(bars[1]), ["SIM:last"]);
});

test("layoutChart: the final barline lands on the standalone repeat bar", () => {
    // `… F6 , XyQ Kcl Z` — the repeat is the last measure and carries the end (Z).
    const bars = layoutChart(
        [chord("F6"), div(), empty(), kcl(), { type: "end" }], KEY, "letter", TS);
    assert.equal(bars.length, 2);
    assert.deepEqual(slotsOf(bars[1]), ["SIM:last"]);
    assert.equal(bars[1].end, true);
});

test("sectionBarRange: a section stops before a trailing tag, not at the chart end", () => {
    // *A a | b | *B c | d }   { e | f }   — A then B, B's repeat closes, then a
    // separate "tag" repeat block. Clicking B must select just B's two bars; the
    // tag block (and any spacer) is excluded — mirrors the "repeat and fade" tag.
    const bars = layoutChart([
        { type: "sectionOpen", label: "A" }, chord("a"), barline(), chord("b"), barline(),
        { type: "sectionOpen", label: "B" }, chord("c"), barline(), chord("d"), { type: "repeatClose" },
        { type: "repeatOpen" }, chord("e"), barline(), chord("f"), { type: "repeatClose" },
    ], KEY, "letter", TS);
    const aBar = bars.find((b) => b.section === "A").index;
    const bBar = bars.find((b) => b.section === "B").index;
    const bClose = bars.find((b) => b.repeatClose && b.index > bBar).index;
    assert.deepEqual(sectionBarRange(bars, aBar), [aBar, bBar - 1]);   // A → just up to B
    assert.deepEqual(sectionBarRange(bars, bBar), [bBar, bClose]);     // B → ends at its close, no tag
    assert.ok(bClose < bars.length - 1);                              // the tag is real, beyond B
});

test("layoutChart: a section ending in a repeat keeps its full bar count", () => {
    // Two 2-bar sections, each ending in a no-barline repeat:
    //   *A  C-7 _ Kcl   *B  F7 _ Kcl
    // Each section must be 2 bars (chord + repeat), not 1.
    const bars = layoutChart([
        { type: "sectionOpen", label: "A" }, chord("C-7"), empty(), kcl(),
        { type: "sectionOpen", label: "B" }, chord("F7"), empty(), kcl(),
    ], KEY, "letter", TS);
    assert.equal(bars.length, 4);
    assert.equal(bars[0].section, "A");
    assert.deepEqual(slotsOf(bars[1]), ["SIM:last"]);
    assert.equal(bars[2].section, "B");
    assert.deepEqual(slotsOf(bars[3]), ["SIM:last"]);
    // The A→B boundary caps the first section's last (repeat) bar.
    assert.equal(bars[1].doubleRight, true);
});
