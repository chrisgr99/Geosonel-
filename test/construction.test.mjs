// Unit tests for the construction builder (src/construction.js).
//
// The builder is thin sugar over the operation set; these tests confirm each
// call desugars to the right operation and that a small build reads cleanly.
// Pure data, runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSceneOps } from "../src/sceneOps.js";
import { createBuilder, builderGlobals, MATH_GLOBALS } from "../src/construction.js";

function freshBuild() {
    const data = { curves: [], triggers: [], sprites: [] };
    const ops = createSceneOps(data);
    return { data, ops, b: createBuilder(ops) };
}

test("add* create the object, set it current, and return its id", () => {
    const { data, b } = freshBuild();
    const cid = b.addCurve();
    assert.equal(cid, "CRV1");
    assert.equal(b.current, "CRV1");
    const tid = b.addTrigger("TRG7");
    assert.equal(tid, "TRG7");
    assert.equal(b.current, "TRG7");
    assert.equal(data.curves.length, 1);
    assert.equal(data.triggers.length, 1);
});

test("bare setters act on the current object", () => {
    const { data, b } = freshBuild();
    b.addSprite("SPR1");
    b.set("mass", 2).setColor("#fff").setName("lead").setSpeed("1 -0.5").position(4, 5);
    const s = data.sprites[0];
    assert.equal(s.mass, 2);
    assert.equal(s.color, "#fff");
    assert.equal(s.name, "lead");
    assert.equal(s.cycleSpeeds, "1 -0.5");
    assert.deepEqual([s.x, s.y], [4, 5]);
});

test("setGroup tags the current object; groupOn / setOn / positionOn take a selector", () => {
    const { data, b } = freshBuild();
    b.addCurve("CRV1");
    b.setGroup("lines");
    b.addCurve("CRV2");
    b.setGroup("lines");
    assert.equal(data.curves[0].group, "lines");
    assert.equal(data.curves[1].group, "lines");
    // Group-wide styling via a selector.
    b.setOn("lines", "color", "#0a0");
    assert.equal(data.curves[0].color, "#0a0");
    assert.equal(data.curves[1].color, "#0a0");
    assert.deepEqual(b.ids("lines").sort(), ["CRV1", "CRV2"]);
});

test("select re-points the current target", () => {
    const { b } = freshBuild();
    b.addCurve("CRV1");
    b.addCurve("CRV2");
    assert.equal(b.current, "CRV2");
    b.select("CRV1");
    assert.equal(b.current, "CRV1");
    b.setColor("#111"); // acts on CRV1 now
});

test("a small reference-style build composes, and re-running merges", () => {
    const { data, b } = freshBuild();
    // Build three triggers in a group, coloured by group.
    b.clear();
    for (let i = 0; i < 3; i++) {
        b.addTrigger(`TRG${1000 + i}`);
        b.setGroup("ring");
        b.position(i, i * 2);
    }
    b.setOn("ring", "color", "#abcdef");
    assert.equal(data.triggers.length, 3);
    assert.equal(data.triggers[1].x, 1);
    assert.equal(data.triggers[1].y, 2);
    assert.equal(data.triggers[2].color, "#abcdef");

    // A user hand-edits one trigger's colour.
    b.setOn("TRG1001", "color", "gold");
    // Re-running the build (no clear) sets positions again, not colour.
    for (let i = 0; i < 3; i++) {
        b.addTrigger(`TRG${1000 + i}`);
        b.position(i + 10, i);
    }
    assert.equal(data.triggers.length, 3, "re-run addressed, did not duplicate");
    assert.equal(data.triggers[1].color, "gold", "hand edit retained through re-run");
    assert.equal(data.triggers[1].x, 11, "construction re-applied position");
});

test("builderGlobals expose bare verbs that mutate the scene (the SETUP surface)", () => {
    // Mirror what the setup runner does: build ops + builder, flatten to bare
    // globals, and call them the way a setup() body would.
    const data = { curves: [], triggers: [], sprites: [] };
    const ops = createSceneOps(data);
    const g = builderGlobals(createBuilder(ops));
    g.clear();
    const id = g.addTrigger("TRG1");
    g.setColor("#f0f");
    g.position(3, 4);
    g.setGroup("ring");
    g.set("note", 64);
    assert.equal(id, "TRG1");
    const t = data.triggers[0];
    assert.equal(t.color, "#f0f");
    assert.equal(t.x, 3);
    assert.equal(t.y, 4);
    assert.equal(t.group, "ring");
    assert.equal(t.note, 64);
    assert.deepEqual(g.ids("ring"), ["TRG1"]);
});

test("MATH_GLOBALS.map is the linear remap, with a safe zero-span", () => {
    assert.equal(MATH_GLOBALS.map(5, 0, 10, 0, 100), 50);
    assert.equal(MATH_GLOBALS.map(0, 0, 4, -1, 1), -1);
    assert.equal(MATH_GLOBALS.map(3, 2, 2, 9, 9), 9); // zero input span -> outLo
    assert.equal(MATH_GLOBALS.TWO_PI, Math.PI * 2);
    assert.equal(typeof MATH_GLOBALS.sin, "function");
});

test("clear resets the scene", () => {
    const { data, b } = freshBuild();
    b.addCurve();
    b.addSprite();
    assert.equal(data.curves.length + data.sprites.length, 2);
    b.clear();
    assert.equal(data.curves.length, 0);
    assert.equal(data.sprites.length, 0);
    assert.equal(b.current, null);
});
