// Unit tests for the chord-chart ROW grouping:
//   src/harmonyChartLayout.js — groupRows(bars, barsPerRow)
//
// groupRows turns the flat ChartBar[] into ROWS of cells for the equal-width
// grid so the chart reads like an iReal lead sheet:
//   - a section-opening bar starts a NEW row (column 1, left-aligned);
//   - within a section, pack barsPerRow bars per row, then wrap; a short final
//     row stays left-aligned (no end padding);
//   - alternative endings stack column-aligned: the 2nd ending starts a new
//     row left-padded with EMPTY cells to sit under the 1st ending's column.
//
// Pure logic (no DOM) — runs under `node --test`. groupRows reads only each
// bar's `.section` / `.ending`, so we hand it minimal bar-shaped objects.

import { test } from "node:test";
import assert from "node:assert/strict";

import { groupRows } from "../src/harmonyChartLayout.js";

/** A minimal ChartBar-shaped object carrying just what groupRows reads. */
function bar(index, extra = {}) {
    return { index, beatStart: index * 4, beats: 4, slots: [], ...extra };
}

/** Map a row of cells to a compact shape for assertions. */
function shape(row) {
    return row.map((c) => (c && c.empty === true ? "_" : c.index));
}

test("groupRows: packs 4 bars per row, wraps within a section", () => {
    const bars = [bar(0), bar(1), bar(2), bar(3), bar(4), bar(5)];
    const rows = groupRows(bars, 4);
    assert.deepEqual(rows.map(shape), [
        [0, 1, 2, 3],
        [4, 5],
    ]);
});

test("groupRows: a section-opening bar starts a NEW row at the left", () => {
    // 2 leading bars, then section A opens at bar 2, then section B at bar 5.
    const bars = [
        bar(0), bar(1),
        bar(2, { section: "A" }), bar(3), bar(4),
        bar(5, { section: "B" }), bar(6),
    ];
    const rows = groupRows(bars, 4);
    // A starts a fresh row even though the leading row had room; B too.
    assert.deepEqual(rows.map(shape), [
        [0, 1],
        [2, 3, 4],
        [5, 6],
    ]);
});

test("groupRows: short final row stays left-aligned (no trailing padding)", () => {
    const bars = [bar(0, { section: "A" }), bar(1), bar(2)];
    const rows = groupRows(bars, 4);
    // The row is left as-is (length 3); the renderer pads the tail, not us.
    assert.deepEqual(rows.map(shape), [[0, 1, 2]]);
    assert.equal(rows[0].length, 3);
});

test("groupRows: 2nd ending is left-padded to the 1st ending's column", () => {
    // Row: bars 0,1 then a 1st ending starting at bar 2 (column 3). The 2nd
    // ending (bar 4) must start a new row padded with 2 empties so it lands in
    // column 3 — directly beneath the 1st ending's first bar.
    const bars = [
        bar(0), bar(1),
        bar(2, { ending: 1 }), bar(3),
        bar(4, { ending: 2 }), bar(5),
    ];
    const rows = groupRows(bars, 4);
    assert.deepEqual(rows.map(shape), [
        [0, 1, 2, 3],
        ["_", "_", 4, 5],
    ]);
    // The 2nd ending's first real bar sits in the same column as the 1st.
    const firstEndingCol = rows[0].findIndex((c) => c.ending === 1);
    const secondEndingCol = rows[1].findIndex((c) => c && c.ending === 2);
    assert.equal(secondEndingCol, firstEndingCol);
});

test("groupRows: 1st ending continues on its current row (no forced break)", () => {
    const bars = [bar(0), bar(1, { ending: 1 }), bar(2)];
    const rows = groupRows(bars, 4);
    // The 1st ending does NOT start a new row.
    assert.deepEqual(rows.map(shape), [[0, 1, 2]]);
});
