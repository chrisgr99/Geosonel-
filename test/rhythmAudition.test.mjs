// Unit tests for the Rhythm-style audition loop (src/rhythmAudition.js).
//
// The audio scheduling itself runs on the audio clock + setInterval, but the pure
// pieces — slot math from tempo/meter, the no-audio guard, and what a single
// scheduler tick fires — are testable with stub deps and a fake audio context.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RhythmAudition } from "../src/rhythmAudition.js";

test("RhythmAudition: slot math derives from tempo + meter (16th grid)", () => {
    const a = new RhythmAudition({ ensureAudioContext: () => null, fire: () => {} });
    a.setTempo(120); a.setBeatsPerBar(4);
    assert.equal(a._slotsPerBar(), 16);                  // 4 quarters × 4 sixteenths
    assert.ok(Math.abs(a._slotDuration() - 0.125) < 1e-9); // 16th at 120 BPM = 0.125 s
    a.setBeatsPerBar(3);
    assert.equal(a._slotsPerBar(), 12);                  // 3/4
    a.setTempo(60);
    assert.ok(Math.abs(a._slotDuration() - 0.25) < 1e-9);  // 16th at 60 BPM = 0.25 s
});

test("RhythmAudition: setters validate; bad values are ignored", () => {
    const a = new RhythmAudition({ ensureAudioContext: () => null, fire: () => {} });
    a.setTempo(-5); a.setTempo(0); a.setTempo(NaN);
    assert.equal(a._tempo, 120);                         // unchanged
    a.setTempo(90); assert.equal(a._tempo, 90);
    a.setBeatsPerBar(0); assert.equal(a._beatsPerBar, 4); // < 1 ignored
    a.setBeatsPerBar(5); assert.equal(a._beatsPerBar, 5);
    a.setMetronome(true); assert.equal(a._metronome, true);
});

test("RhythmAudition: start no-ops (returns false) without an audio context", () => {
    const a = new RhythmAudition({ ensureAudioContext: () => null, fire: () => {} });
    assert.equal(a.start(), false);
    assert.equal(a.isPlaying(), false);
});

test("RhythmAudition: a tick schedules the onset and (when on) the metronome", () => {
    const fakeCtx = { currentTime: 0 };
    const fired = [];
    const a = new RhythmAudition({ ensureAudioContext: () => fakeCtx, fire: (s) => fired.push(s) });
    a.setCoreProvider(() => ({ density: 1, syncopation: 0, dynamicRange: 1 }));
    a.setTempo(120); a.setBeatsPerBar(4); a.setMetronome(true);
    // Hand-drive one tick from slot 0 at t=0 (no real timer): only slot 0 falls
    // inside the 0.12 s look-ahead at a 0.125 s slot, so exactly one slot fires.
    a._playing = true; a._slot = 0; a._nextTime = 0;
    a._tick(fakeCtx);
    a._playing = false;
    assert.ok(fired.some((f) => f.sample === "hh"), "downbeat onset fired");
    assert.ok(fired.some((f) => f.sample === "rim"), "metronome downbeat fired");
    for (const f of fired) {
        assert.ok(f.amplitude > 0 && f.amplitude <= 1);
        assert.equal(f.audioTime, 0);
    }
});

test("RhythmAudition: metronome off → no metronome hit", () => {
    const fakeCtx = { currentTime: 0 };
    const fired = [];
    const a = new RhythmAudition({ ensureAudioContext: () => fakeCtx, fire: (s) => fired.push(s) });
    a.setCoreProvider(() => ({ density: 1, syncopation: 0, dynamicRange: 1 }));
    a.setTempo(120); a.setBeatsPerBar(4); a.setMetronome(false);
    a._playing = true; a._slot = 0; a._nextTime = 0;
    a._tick(fakeCtx);
    a._playing = false;
    assert.ok(fired.some((f) => f.sample === "hh"));
    assert.ok(!fired.some((f) => f.sample === "rim"));
});
