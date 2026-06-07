// Unit tests for the object and score handles (src/sceneHandles.js).
//
// The handles read/write through the operation set and a parsed scene.json
// object; no DOM, no network. sceneHandles imports sceneSchema (pure data),
// so the whole chain loads under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSceneOps } from "../src/sceneOps.js";
import { createObjectHandle, createScoreHandle } from "../src/sceneHandles.js";

function freshData() {
    return { curves: [], triggers: [], sprites: [] };
}

test("object handle reports id, kind, and existence", () => {
    const ops = createSceneOps(freshData());
    ops.create("trigger", "TRG1");
    const h = createObjectHandle(ops, "TRG1");
    assert.equal(h.id, "TRG1");
    assert.equal(h.kind, "trigger");
    assert.equal(h.exists, true);
    const missing = createObjectHandle(ops, "NOPE");
    assert.equal(missing.kind, null);
    assert.equal(missing.exists, false);
});

test("authored fields read and write through the operation set (merge preserved)", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("sprite", "SPR1");
    const h = createObjectHandle(ops, "SPR1");
    h.x = 10;
    h.color = "#123456";
    assert.equal(h.x, 10);
    assert.equal(data.sprites[0].x, 10);
    assert.equal(data.sprites[0].color, "#123456");
    // Writing one field leaves the other (the selective merge).
    h.x = 20;
    assert.equal(data.sprites[0].x, 20);
    assert.equal(data.sprites[0].color, "#123456");
});

test("the generic get/set escape hatches cover any field name", () => {
    const ops = createSceneOps(freshData());
    ops.create("curve", "CRV1");
    const h = createObjectHandle(ops, "CRV1");
    h.set("customFlag", true);
    assert.equal(h.get("customFlag"), true);
});

test("derived reads default inert and reject assignment", () => {
    const ops = createSceneOps(freshData());
    ops.create("sprite", "SPR1");
    const h = createObjectHandle(ops, "SPR1");
    assert.equal(h.speed, 0);
    assert.equal(h.cyclePhase, 0);
    assert.equal(h.flipX, false);
    assert.equal(h.pxR, 0);
    assert.throws(() => { h.speed = 1; }, /derived runtime read/);
});

test("a runtime adapter supplies derived reads", () => {
    const ops = createSceneOps(freshData());
    ops.create("sprite", "SPR1");
    const runtime = {
        read(id, key) {
            assert.equal(id, "SPR1");
            return key === "speed" ? 3.5 : (key === "flipX" ? true : 0);
        },
    };
    const h = createObjectHandle(ops, "SPR1", { runtime });
    assert.equal(h.speed, 3.5);
    assert.equal(h.flipX, true);
    assert.equal(h.pxG, 0);
});

test("a handle stays valid by id across an address-existing re-create", () => {
    const data = freshData();
    const ops = createSceneOps(data);
    ops.create("trigger", "TRG1");
    const h = createObjectHandle(ops, "TRG1");
    h.color = "blue";
    // Re-create by the same id addresses the same entry; the handle still reads it.
    ops.create("trigger", "TRG1");
    assert.equal(h.color, "blue");
    assert.equal(h.exists, true);
});

test("score handle reads and writes piece-wide fields", () => {
    const data = { curves: [], triggers: [], sprites: [], bpm: 120, output: "midi" };
    const score = createScoreHandle(data);
    assert.equal(score.bpm, 120);
    assert.equal(score.output, "midi");
    score.output = "superdough";
    assert.equal(data.output, "superdough");
});

test("score bpm write forwards to the transport when one is wired", () => {
    const data = { bpm: 100 };
    let lastBpm = null;
    const transport = { setBpm: (v) => { lastBpm = v; } };
    const score = createScoreHandle(data, { transport });
    score.bpm = 90;
    assert.equal(data.bpm, 90);
    assert.equal(lastBpm, 90);
});

test("transport methods forward when present and no-op when absent", () => {
    const calls = [];
    const transport = {
        play: (s) => calls.push(["play", s]),
        stop: () => calls.push(["stop"]),
        rewind: () => calls.push(["rewind"]),
    };
    const withT = createScoreHandle({}, { transport });
    withT.play(2);
    withT.stop();
    withT.rewind();
    assert.deepEqual(calls, [["play", 2], ["stop"], ["rewind"]]);
    // No transport: the methods are safe no-ops returning the handle.
    const noT = createScoreHandle({});
    assert.doesNotThrow(() => { noT.play(); noT.stop(); noT.rewind(); });
});

test("hasBackgroundImage derives from the image name", () => {
    assert.equal(createScoreHandle({}).hasBackgroundImage, false);
    assert.equal(createScoreHandle({ imageName: "" }).hasBackgroundImage, false);
    assert.equal(createScoreHandle({ imageName: "Jazz.png" }).hasBackgroundImage, true);
});

test("selection reads from the injected source", () => {
    let sel = { sprites: [0] };
    const score = createScoreHandle({}, { selectionSource: () => sel });
    assert.deepEqual(score.selection, { sprites: [0] });
    sel = { curves: [2] };
    assert.deepEqual(score.selection, { curves: [2] });
});
