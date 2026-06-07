// Unit tests for the scene-operations substrate (src/sceneOps.js).
//
// Pure data operations over a parsed scene.json object — no DOM and no
// network — so they run under `node --test`. The module depends only on
// idGen, which is dependency-free.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSceneOps } from "../src/sceneOps.js";

function freshData() {
    return { curves: [], triggers: [], sprites: [] };
}

test("create with an explicit id appends one entry and sets current", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    const id = ops.create("trigger", "TRG9");
    assert.equal(id, "TRG9");
    assert.equal(ops.current, "TRG9");
    assert.equal(data.triggers.length, 1);
    assert.equal(data.triggers[0].id, "TRG9");
});

test("create with no id auto-numbers in the conventional shape", () => {
    const ops = createSceneOps(freshData());
    const a = ops.create("curve");
    const b = ops.create("curve");
    assert.match(a, /^CRV[1-9]\d*$/);
    assert.equal(a, "CRV1");
    assert.equal(b, "CRV2");
});

test("create with an existing id ADDRESSES rather than duplicating", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("sprite", "SPR1");
    ops.set("SPR1", "color", "#abc");
    const again = ops.create("sprite", "SPR1");
    assert.equal(again, "SPR1");
    assert.equal(data.sprites.length, 1, "no duplicate entry");
    assert.equal(ops.current, "SPR1");
    assert.equal(data.sprites[0].color, "#abc", "addressing kept the prior field");
});

test("set writes only the named field — the selective merge", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("trigger", "TRG1");
    ops.set("TRG1", "color", "#f00");
    ops.set("TRG1", "size", 0.5);
    // A second run that only sets color must retain size (a user hand-edit
    // scenario: re-running construction does not clobber untouched fields).
    ops.set("TRG1", "color", "#0f0");
    assert.equal(data.triggers[0].color, "#0f0");
    assert.equal(data.triggers[0].size, 0.5);
});

test("a hand edit survives a construction re-run that does not set it", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    // "Construction" creates T5 and sets its position, never its colour.
    ops.create("trigger", "TRG5");
    ops.position("TRG5", 1, 2);
    // "User" hand-edits the colour in the inspector.
    ops.set("TRG5", "color", "red");
    // "Construction" re-runs: addresses T5, sets position again, not colour.
    ops.create("trigger", "TRG5");
    ops.position("TRG5", 3, 4);
    assert.equal(data.triggers[0].color, "red", "hand edit retained");
    assert.deepEqual([data.triggers[0].x, data.triggers[0].y], [3, 4]);
});

test("group tags the group field; position moves sprites/triggers but not curves", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("curve", "CRV1");
    ops.create("sprite", "SPR1");
    ops.group("all", "ring");
    assert.equal(data.curves[0].group, "ring");
    assert.equal(data.sprites[0].group, "ring");
    ops.position("all", 5, 6);
    assert.equal(data.sprites[0].x, 5);
    assert.equal(data.sprites[0].y, 6);
    assert.equal(data.curves[0].x, undefined, "curve position is geometry, skipped here");
});

test("selectors: all / current / id / group-name, with id winning over group", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("curve", "CRV1");
    ops.create("curve", "CRV2");
    ops.group("CRV1", "lines");
    ops.group("CRV2", "lines");
    assert.deepEqual(ops.ids("all").sort(), ["CRV1", "CRV2"]);
    assert.deepEqual(ops.ids("lines").sort(), ["CRV1", "CRV2"]);
    assert.deepEqual(ops.ids("current"), ["CRV2"]);
    assert.deepEqual(ops.ids("CRV1"), ["CRV1"]);
    // An object id that also names a group would resolve as the id; here the
    // id match for "CRV1" wins regardless.
    assert.deepEqual(ops.ids("CRV1"), ["CRV1"]);
});

test("the selection selector reads the host-supplied canvas selection", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("sprite", "SPR1"); // index 0
    ops.create("sprite", "SPR2"); // index 1
    ops.setSelection({ sprites: [1] });
    assert.deepEqual(ops.ids("selection"), ["SPR2"]);
});

test("clear empties the arrays but keeps id counters so auto-ids never collide", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    assert.equal(ops.create("curve"), "CRV1");
    ops.clear();
    assert.equal(data.curves.length, 0);
    assert.equal(ops.current, null);
    // The next auto curve is CRV2, not a re-used CRV1.
    assert.equal(ops.create("curve"), "CRV2");
});

test("get reads the first resolved field; kindOf reports kind or null", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("trigger", "TRG1");
    ops.set("TRG1", "note", 60);
    assert.equal(ops.get("TRG1", "note"), 60);
    assert.equal(ops.get("TRG1", "missing"), undefined);
    assert.equal(ops.get("NOPE", "note"), undefined);
    assert.equal(ops.kindOf("TRG1"), "trigger");
    assert.equal(ops.kindOf("NOPE"), null);
});

test("select re-points current at an existing object (last match wins)", () => {
    const ops = createSceneOps(freshData());
    ops.create("curve", "CRV1");
    ops.create("curve", "CRV2");
    ops.group("all", "g");
    assert.equal(ops.current, "CRV2");
    ops.select("CRV1");
    assert.equal(ops.current, "CRV1");
    const last = ops.select("g");
    assert.equal(last, "CRV2");
    assert.equal(ops.current, "CRV2");
});
