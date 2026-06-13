// Unit tests for the iReal-style chord typography splitter:
//   src/harmonyChartLayout.js — formatChordParts(label, mode)
//
// formatChordParts takes a FULLY-RENDERED chord label (the string that
// chordToLetter / chordToRoman already produced) and splits it into the
// typographic pieces a renderer needs: a big {root}, a raised {accidental}
// glyph, and a small subscripted {ext} quality/extension run (plus an
// optional slash {bass}). It glyphifies accidentals (b→♭, #→♯), the maj7
// marker (→△), and the leading minor marker (m→-), and falls back to a
// {plain:true} raw label for anything it cannot parse.
//
// Pure module — no DOM — so this runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatChordParts } from "../src/harmonyChartLayout.js";

test("formatChordParts: F minor 6 → root F, ext -6", () => {
    assert.deepEqual(formatChordParts("Fm6", "letter"), {
        root: "F", accidental: "", ext: "-6",
    });
});

test("formatChordParts: Bb7 → root B, accidental ♭, ext 7", () => {
    assert.deepEqual(formatChordParts("Bb7", "letter"), {
        root: "B", accidental: "♭", ext: "7",
    });
});

test("formatChordParts: plain dominant (C7) splits root/ext", () => {
    assert.deepEqual(formatChordParts("C7", "letter"), {
        root: "C", accidental: "", ext: "7",
    });
});

test("formatChordParts: maj7 marker becomes a triangle", () => {
    assert.deepEqual(formatChordParts("Cmaj7", "letter"), {
        root: "C", accidental: "", ext: "△7",
    });
});

test("formatChordParts: sharp root keeps the ♯ glyph", () => {
    const p = formatChordParts("F#m7", "letter");
    assert.equal(p.root, "F");
    assert.equal(p.accidental, "♯");
    assert.equal(p.ext, "-7");
});

test("formatChordParts: alteration accidentals glyphify (G7b9)", () => {
    assert.deepEqual(formatChordParts("G7b9", "letter"), {
        root: "G", accidental: "", ext: "7♭9",
    });
});

test("formatChordParts: slash bass is split out", () => {
    assert.deepEqual(formatChordParts("Am7/E", "letter"), {
        root: "A", accidental: "", ext: "-7", bass: "E",
    });
});

test("formatChordParts: slash bass accidental glyphifies", () => {
    const p = formatChordParts("C/Bb", "letter");
    assert.equal(p.root, "C");
    assert.equal(p.ext, "");
    assert.equal(p.bass, "B♭");
});

test("formatChordParts: roman numeral root with flat accidental", () => {
    assert.deepEqual(formatChordParts("bVII7", "roman"), {
        root: "VII", accidental: "♭", ext: "7",
    });
});

test("formatChordParts: lowercase roman (minor) numeral preserved", () => {
    assert.deepEqual(formatChordParts("i7", "roman"), {
        root: "i", accidental: "", ext: "7",
    });
});

test("formatChordParts: N.C. falls back to plain", () => {
    assert.deepEqual(formatChordParts("N.C.", "letter"), {
        plain: true, root: "N.C.", accidental: "", ext: "",
    });
});

test("formatChordParts: unparseable label falls back to plain raw text", () => {
    assert.deepEqual(formatChordParts("???", "letter"), {
        plain: true, root: "???", accidental: "", ext: "",
    });
});

test("formatChordParts: empty label yields empty pieces", () => {
    assert.deepEqual(formatChordParts("", "letter"), {
        root: "", accidental: "", ext: "",
    });
});
