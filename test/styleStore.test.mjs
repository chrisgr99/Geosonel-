// Unit tests for the app-wide style library (src/styleStore.js) and its
// integration with resolveStyleByName (src/harmonyMelody.js).
//
// The store keeps a synchronous in-memory cache the engine reads per note;
// persistence (settings.json / IndexedDB) is best-effort and not exercised here
// (no backend under node — saveStyle/removeStyle update the cache synchronously
// and swallow the persist failure). Pure record helpers are tested directly.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    upsertRecord, removeRecord,
    listStyles, getStyleRecord, getMaterializedMelodic,
    saveStyle, removeStyle, _resetForTest,
} from "../src/styleStore.js";
import { serializeMStyle, MStyle } from "../src/mStyle.js";
import { resolveStyleByName, styles } from "../src/harmonyMelody.js";

/** Build a voice library record from a MStyle. */
function voiceRecord(name, vStyle) {
    return { type: "melodic", name, def: serializeMStyle(vStyle) };
}

// ---- pure record helpers ------------------------------------------------

test("upsertRecord: adds a new record, replaces a same type+name one", () => {
    const a = { type: "melodic", name: "x", def: { k: 1 } };
    const b = { type: "melodic", name: "x", def: { k: 2 } };
    const c = { type: "rhythmic", name: "x", def: { k: 3 } };
    let list = upsertRecord([], a);
    assert.equal(list.length, 1);
    list = upsertRecord(list, b);                 // same type+name → replace
    assert.equal(list.length, 1);
    assert.equal(list[0].def.k, 2);
    list = upsertRecord(list, c);                 // different type → add
    assert.equal(list.length, 2);
});

test("removeRecord: drops only the matching type+name", () => {
    const list = [
        { type: "melodic", name: "x", def: {} },
        { type: "rhythmic", name: "x", def: {} },
    ];
    const out = removeRecord(list, "melodic", "x");
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "rhythmic");
});

// ---- stateful cache + materialisation -----------------------------------

test("saveStyle / listStyles / getMaterializedMelodic round-trip a voice", () => {
    _resetForTest();
    const s = new MStyle();
    s.pitch = 0.3;
    s.rhythm.syncopation = 0.7;
    saveStyle(voiceRecord("myLead", s));

    assert.equal(listStyles("melodic").length, 1);
    assert.ok(getStyleRecord("melodic", "myLead") !== null);

    const mat = getMaterializedMelodic("myLead");
    assert.ok(mat instanceof MStyle);
    assert.equal(mat.pitch, 0.3);                 // driver survived
    assert.equal(mat.rhythm.syncopation, 0.7);    // rhythm core survived
    _resetForTest();
});

test("removeStyle drops the voice from the cache", () => {
    _resetForTest();
    saveStyle(voiceRecord("tmp", new MStyle()));
    assert.ok(getMaterializedMelodic("tmp") !== null);
    removeStyle("melodic", "tmp");
    assert.equal(getMaterializedMelodic("tmp"), null);
    assert.equal(listStyles().length, 0);
    _resetForTest();
});

test("getMaterializedMelodic ignores rhythm-typed records", () => {
    _resetForTest();
    saveStyle({ type: "rhythmic", name: "bossa", def: { lanes: [] } });
    assert.equal(getMaterializedMelodic("bossa"), null);   // not a voice
    assert.equal(listStyles("rhythmic").length, 1);
    _resetForTest();
});

// ---- resolveStyleByName integration -------------------------------------

test("resolveStyleByName: user library shadows built-ins, then falls back", () => {
    _resetForTest();
    // A user style named "lead" shadows the built-in lead.
    const custom = new MStyle();
    custom.scale = "wholeTone";
    saveStyle(voiceRecord("lead", custom));
    assert.equal(resolveStyleByName("lead").scale, "wholeTone");   // user wins

    // A name only the built-ins know still resolves to the built-in.
    assert.equal(resolveStyleByName("bass"), styles.bass);

    // Unknown / empty → the default melodic style.
    assert.equal(resolveStyleByName("nope"), styles.melodic);
    assert.equal(resolveStyleByName(""), styles.melodic);
    _resetForTest();
    // After reset the shadow is gone — built-in lead resolves again.
    assert.equal(resolveStyleByName("lead"), styles.lead);
});
