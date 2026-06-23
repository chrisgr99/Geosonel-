# Chord-chart playback: the chart as the top-level form

How a chord chart provides a harmonic sequence and cadences to a scene, and how
the whole piece loops, without any object being slaved to it.

## The two layers

- **Chart phrasing** (`scene.harmony.phrases`) shapes the melodic LINE: where it
  breathes, rests, and anchors to grounded/cadential tones over the changes.
  It's a property of the HARMONY and reaches a voice through `nxtNote` (the
  ambient phrase state). It answers "how does the line shape itself over the
  chords?"
- **Beat-pattern phrasing** (an object's measures × repeats) shapes the GROOVE:
  which beat points fire, their strength, how the pattern tiles around the path.
  A per-object rhythm property. It answers "when do I hit?"

These are orthogonal and run on independent clocks. The chart does NOT drive any
object's groove, and no object drives the chart. Each object loops on its own
path cycle; the chart loops on its own length.

## How the chart plays

The progression is stored folded (repeats/sections as markers) on
`scene.harmony`. At `setScene` it is expanded (repeat barlines unrolled) into
timed `ChordSpan`s over a beat axis — one bar lasts `timeSignature[0]` beats.

Playback is **pull-based on the transport clock**. Each firing object, at its
fire beat `globalBeat = elapsedSeconds × BPM / 60`, looks up the spanning chord
and the phrase state and reads them as context (`ctx.chord`, `ctx.nextChord`,
the ambient phrase). An Instrument voice uses that to choose pitches
(`melodicStep`); a Beatbox voice ignores it. The chord chart never emits notes
itself.

The chart wraps at its end: the chord lookup folds the beat into the chart's
total length, so the progression repeats. `scene.harmony.phrases` are authored
in that same base-cycle beat space, so the phrase grid applies to every loop.

## The ensemble loop (objects restart with the form)

The chord chart is the top-level musical form, so when it has played through
once the **whole piece** returns to the top together: the transport rewinds at
the chart's end.

- The period is `simulation._syncLoopBeats` = `_harmonyBaseCycleBeats`, the
  chart's full expanded length in beats (the same value the chord lookup wraps
  at), recomputed in `setScene`. Null when there is no chart (ordinary,
  non-looping play).
- `tick()` watches `transport.elapsedBeats` against that period and calls
  `transport.rewind()` at the boundary — a genuine backward jump that BOTH the
  sim (`_rewind`: object home, melody memory, voice registry, metronome) and the
  firing engine reset on via their existing backward-jump detection. So every
  object restarts its own cycle from the beginning at the top of the form.
- Deferred while an audition boundary is armed (the two loops are exclusive).

This is keyed to the actual chord progression repeating, so the reset lands at
a musically meaningful point — the top of the form — rather than at some
sub-multiple commensurate with nothing.

### Notes ring out across the wrap

The rewind must not chop sounding notes. It doesn't: superdough notes are
fire-and-forget through Web Audio, scheduled with their full durations, and the
backward-jump detection only **panics MIDI** — nothing cancels scheduled
superdough voices. So notes already sounding at the seam play to their natural
end while the new pass begins. (GX2 is superdough-only; the MIDI panic is the
legacy path.)

### The commensurability note

An object whose own cycle length does not divide the chart length is cut
mid-cycle at the wrap. That is inherent to "the form repeats as one unit" and is
predictable — it always happens at the top of the form. Give an object a cycle
that divides the chart length to avoid it; that is a compositional choice, not
something the engine forces.

## What was removed

An earlier "master object" design slaved the chord clock to one designated
beat-pattern object's groove (chords snapping to its onsets) and looped the
transport at a master-derived sub-period. It was abandoned: the reset landed at
points that didn't correspond to anything the objects did, and it gave the chart
control over every object's repeats. The chart now runs free and wraps at its
own end; objects keep their independent cycles. (`scene.masterObjectId`,
`src/phraseSync.js`, the chart's Master dropdown, and the master-slaved harmony
lookup are all gone.)
