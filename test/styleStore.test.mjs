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
    listStyles, getStyleRecord, getMaterializedVoice,
    saveStyle, removeStyle, _resetForTest,
} from "../src/styleStore.js";
import { serializeVStyle, VStyle } from "../src/vStyle.js";
import { resolveStyleByName, styles } from "../src/harmonyMelody.js";

/** Build a voice library record from a VStyle. */
function voiceRecord(name, vStyle) {
    return { type: "voice", name, def: serializeVStyle(vStyle) };
}

// ---- pure record helpers ------------------------------------------------

test("upsertRecord: adds a new record, replaces a same type+name one", () => {
    const a = { type: "voice", name: "x", def: { k: 1 } };
    const b = { type: "voice", name: "x", def: { k: 2 } };
    const c = { type: "rhythm", name: "x", def: { k: 3 } };
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
        { type: "voice", name: "x", def: {} },
        { type: "rhythm", name: "x", def: {} },
    ];
    const out = removeRecord(list, "voice", "x");
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "rhythm");
});

// ---- stateful cache + materialisation -----------------------------------

test("saveStyle / listStyles / getMaterializedVoice round-trip a voice", () => {
    _resetForTest();
    const s = new VStyle();
    s.pitch = 0.3;
    s.rhythm.syncopation = 0.7;
    saveStyle(voiceRecord("myLead", s));

    assert.equal(listStyles("voice").length, 1);
    assert.ok(getStyleRecord("voice", "myLead") !== null);

    const mat = getMaterializedVoice("myLead");
    assert.ok(mat instanceof VStyle);
    assert.equal(mat.pitch, 0.3);                 // driver survived
    assert.equal(mat.rhythm.syncopation, 0.7);    // rhythm core survived
    _resetForTest();
});

test("removeStyle drops the voice from the cache", () => {
    _resetForTest();
    saveStyle(voiceRecord("tmp", new VStyle()));
    assert.ok(getMaterializedVoice("tmp") !== null);
    removeStyle("voice", "tmp");
    assert.equal(getMaterializedVoice("tmp"), null);
    assert.equal(listStyles().length, 0);
    _resetForTest();
});

test("getMaterializedVoice ignores rhythm-typed records", () => {
    _resetForTest();
    saveStyle({ type: "rhythm", name: "bossa", def: { lanes: [] } });
    assert.equal(getMaterializedVoice("bossa"), null);   // not a voice
    assert.equal(listStyles("rhythm").length, 1);
    _resetForTest();
});

// ---- resolveStyleByName integration -------------------------------------

test("resolveStyleByName: user library shadows built-ins, then falls back", () => {
    _resetForTest();
    // A user style named "lead" shadows the built-in lead.
    const custom = new VStyle();
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
