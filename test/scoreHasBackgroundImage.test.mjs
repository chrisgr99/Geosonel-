// Unit tests for sceneDataHasBackgroundImage — the predicate that
// backs the script-facing score.hasBackgroundImage flag (see
// sceneLoader.load, which defines score.hasBackgroundImage as a getter
// delegating here). True exactly when scene.json names a non-empty
// imageName. Pure, no DOM or network, so it runs under `node --test`;
// .mjs to load as ESM against the repo-root CommonJS default.
//
// The loader's full load() path is not unit-tested directly because
// sceneLoader.js imports acorn from a CDN URL that Node's ESM loader
// cannot resolve headlessly — hence the shared pure predicate in
// scene.js, which the loader's getter and these tests both consume.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sceneDataHasBackgroundImage } from "../src/scene.js";

test("hasBackgroundImage: true for a non-empty imageName", () => {
    assert.equal(sceneDataHasBackgroundImage({ imageName: "bg.png" }), true);
});

test("hasBackgroundImage: false when imageName is absent", () => {
    assert.equal(sceneDataHasBackgroundImage({}), false);
});

test("hasBackgroundImage: false for empty / non-string imageName", () => {
    assert.equal(sceneDataHasBackgroundImage({ imageName: "" }), false);
    assert.equal(sceneDataHasBackgroundImage({ imageName: null }), false);
    assert.equal(sceneDataHasBackgroundImage({ imageName: 42 }), false);
});

test("hasBackgroundImage: false for non-object input", () => {
    assert.equal(sceneDataHasBackgroundImage(null), false);
    assert.equal(sceneDataHasBackgroundImage(undefined), false);
    assert.equal(sceneDataHasBackgroundImage("bg.png"), false);
});
