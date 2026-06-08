// Unit tests for the event-trace rolling buffer (src/eventTrace.js).
// Pure, offline.

import { test } from "node:test";
import assert from "node:assert/strict";

import { EventTrace, EVENT_TRACE_CAPACITY } from "../src/eventTrace.js";

test("record appends and snapshot returns entries oldest-first", () => {
    const t = new EventTrace();
    t.record({ note: 1 });
    t.record({ note: 2 });
    const snap = t.snapshot();
    assert.equal(snap.entries.length, 2);
    assert.deepEqual(snap.entries.map((e) => e.note), [1, 2]);
});

test("seq advances on each record", () => {
    const t = new EventTrace();
    assert.equal(t.seq, 0);
    t.record({});
    assert.equal(t.seq, 1);
    t.record({});
    assert.equal(t.seq, 2);
});

test("buffer is bounded newest-wins at capacity", () => {
    const t = new EventTrace(3);
    for (let i = 0; i < 5; i++) t.record({ n: i });
    const snap = t.snapshot();
    assert.equal(snap.entries.length, 3);
    assert.deepEqual(snap.entries.map((e) => e.n), [2, 3, 4]);
});

test("default capacity is EVENT_TRACE_CAPACITY", () => {
    const t = new EventTrace();
    for (let i = 0; i < EVENT_TRACE_CAPACITY + 10; i++) t.record({ n: i });
    assert.equal(t.length, EVENT_TRACE_CAPACITY);
});

test("snapshot is defensive — later records don't mutate it", () => {
    const t = new EventTrace();
    t.record({ n: 0 });
    const snap = t.snapshot();
    t.record({ n: 1 });
    assert.equal(snap.entries.length, 1);
});

test("clear empties entries and advances seq", () => {
    const t = new EventTrace();
    t.record({});
    t.record({});
    const before = t.seq;
    t.clear();
    assert.equal(t.length, 0);
    assert.ok(t.seq > before);
});

test("clear on an empty buffer still advances seq (observable)", () => {
    const t = new EventTrace();
    const before = t.seq;
    t.clear();
    assert.ok(t.seq > before);
});

test("invalid capacity falls back to default", () => {
    const t = new EventTrace(0);
    for (let i = 0; i < EVENT_TRACE_CAPACITY + 5; i++) t.record({ n: i });
    assert.equal(t.length, EVENT_TRACE_CAPACITY);
});
