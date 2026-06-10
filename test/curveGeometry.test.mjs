// Unit tests for shapeCenter — the object-centre helper that backs
// the firing context's this.centerX / this.centerY. Pure geometry, no
// DOM or network, so it runs under `node --test`. The repo root is
// CommonJS by default, so this file is .mjs to load as ESM and import
// the ESM source directly.

import { test } from "node:test";
import assert from "node:assert/strict";

import { shapeCenter } from "../src/curveGeometry.js";

test("shapeCenter: ellipse returns its centre (cx, cy)", () => {
    const c = shapeCenter({ type: "ellipse", cx: 120, cy: 80, w: 40, h: 20 });
    assert.deepEqual(c, { x: 120, y: 80 });
});

test("shapeCenter: line returns the midpoint of its endpoints", () => {
    const c = shapeCenter({ type: "line", x1: 0, y1: 0, x2: 100, y2: 40 });
    assert.deepEqual(c, { x: 50, y: 20 });
});

test("shapeCenter: piste returns the centroid of its points", () => {
    const c = shapeCenter({
        type: "piste",
        points: [[0, 0], [10, 0], [10, 10], [0, 10]],
    });
    assert.deepEqual(c, { x: 5, y: 5 });
});

test("shapeCenter: spline returns the centroid of its control points", () => {
    const c = shapeCenter({
        type: "spline",
        points: [[2, 4], [6, 8]],
    });
    assert.deepEqual(c, { x: 4, y: 6 });
});

test("shapeCenter: degenerate / unknown shapes fall back to origin", () => {
    assert.deepEqual(shapeCenter({ type: "piste", points: [] }), { x: 0, y: 0 });
    assert.deepEqual(shapeCenter({ type: "bezier" }), { x: 0, y: 0 });
});
