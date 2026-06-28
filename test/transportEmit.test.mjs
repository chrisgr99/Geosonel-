// Transport event dispatch (src/transport.js _emit): listeners are isolated, so
// one throwing listener must not starve the others. This matters most for the
// disc mirror, whose flush/runtime-push subscribes to "play" alongside the
// canvas, transport bar, and audition handlers — before the guard, a throw in an
// earlier-subscribed listener silently froze every later one (the mirror went
// stale mid-session while scene pushes, a separate path, kept working).

import { test } from "node:test";
import assert from "node:assert/strict";

import { Transport } from "../src/transport.js";

test("a throwing listener does not prevent later listeners from running", () => {
    const t = new Transport();
    const calls = [];
    t.on("play", () => { calls.push("a"); throw new Error("boom"); });
    t.on("play", () => { calls.push("b"); });
    t.on("play", () => { calls.push("c"); });

    const origWarn = console.warn;
    let warnings = 0;
    console.warn = () => { warnings += 1; };
    try {
        t._emit("play");
    } finally {
        console.warn = origWarn;
    }

    assert.deepEqual(calls, ["a", "b", "c"]);   // every listener ran
    assert.equal(warnings, 1);                  // the throw was logged, not rethrown
});

test("unsubscribing during dispatch is safe (iterates a snapshot)", () => {
    const t = new Transport();
    const calls = [];
    let off2 = () => {};
    t.on("play", () => { calls.push("1"); off2(); });   // removes #2 mid-dispatch
    off2 = t.on("play", () => { calls.push("2"); });
    t.on("play", () => { calls.push("3"); });

    t._emit("play");
    // #2 still fires this round (snapshot taken before dispatch); it's gone next round.
    assert.deepEqual(calls, ["1", "2", "3"]);
    t._emit("play");
    assert.deepEqual(calls, ["1", "2", "3", "1", "3"]);
});
