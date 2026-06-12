# Polyphony (voice limiting)

Limit how many notes an object — or a named group, or the whole score — may
have sounding at once. No inspector fields: it's set from script, modelled on
(but cleaner than) GeoSonix's per-note `"curveMono"`/`"groupMono"`/`"mono"`
arguments.

## API

```js
// setup (top-level script.js, runs once at load — like score.kinematics)
score.poly = 8;             // whole-score cap
score.groupPoly("G1", 2);   // cap for objects whose `group` field is "G1"

// in a callback (persists on the object)
this.poly = 1;              // this object is monophonic
```

- `this.poly = N` — settable property on the firing context; writes through to
  the object's persistent voice limit (a getter reads it back). `1` = mono,
  `N` ≥ 1 = up to N overlapping voices, unset = unlimited (`Infinity`).
- `score.poly = N` and `score.groupPoly(name, N)` — set on the `score` global in
  setup; read back into the scene after the top-level script runs (the same
  read-back path `score.kinematics` uses in sceneLoader). Unset = unlimited.
- An object's group is its existing `group` field (scene.js `this.group`).

## Enforcement — two regimes

### Per-object: STRICT, by duration-trimming (both engines)
The sim knows from the beat schedule when this object's upcoming notes fire, so
a note's duration is **trimmed** (only shortened, never extended) so it ends
just past the **N-th upcoming** beat's start — capping the object at N
overlapping voices. For `poly = 1` it ends just past the **next** beat's start,
plus a small **legato overlap** (`LEGATO_OVERLAP_SECONDS`, default 0.03 s) so a
mono line connects instead of clicking. Pure duration-shortening, so superdough
and MIDI behave identically and superdough never needs an (impossible) force-off.

- Time to the N-th upcoming beat is computed in the onActiveBeat path from
  `state._beatOrder` (the ordered upcoming beat positions, with their `g`
  directional-progress) and the effective cycle time
  (`cycleDurationSeconds(bpm, beatsPerCycle, beatInterval)` divided by the
  current cycleSpeeds factor). The N-th position is N entries ahead in the
  order, wrapping into the next cycle when needed.
- This applies to **onActiveBeat** notes (predictable schedule). For notes fired
  from `onTick` or collisions the next-note time is NOT known, so the per-object
  cap falls back to the count-based **suppress-new** rule below (no legato trim).

### Group / score: LOOSE, by suppress-new
No trimming, no cutting. At note-start, count the notes currently sounding in
the scope (a small active-note registry: `{objectId, group, endTime}`, pruned as
notes expire). If the scope is already at its cap, the **new note is dropped**;
already-sounding notes play out to their natural end. The per-object count-based
fallback (onTick/collisions) uses the same rule against the object's own count.

## Implementation shape

- State on the sim: `_objectPoly` (Map id→limit, written by `this.poly`),
  `scene.poly` / `scene.groupPoly` (from the score global), and a voice registry.
- Centralise emission: a `_emitNote(objectId, group, spec, timeToNextBeatSec)`
  helper that (1) trims duration for the strict per-object case, (2) runs the
  suppress-new checks (object-count when not trimming, then group, then score),
  (3) registers the surviving note's end time, (4) calls the existing
  `_audioSink`. Every context's `playNote` routes through it instead of calling
  `_audioSink` directly. `timeToNextBeatSec` is supplied only on the onActiveBeat
  path; null elsewhere.
- `this.poly` is a defineProperty getter/setter on each firing context, backed by
  `_objectPoly`. `score.poly`/`score.groupPoly` mirror the `kinematics` read-back.
- Registry pruning is by `endTime` against the current sim time; the limits are
  re-read each note so a mid-run `this.poly` change takes effect immediately.

## Deferred

- **Superdough legato when the next-note time is unknown** (onTick / collision):
  would need a look-ahead so durations could be trimmed there too. Out of scope
  for now — those sources use plain count-based suppress-new with no legato.
- Voice *stealing* (cutting an already-sounding note) is intentionally NOT done:
  superdough can't force a voice off, so the design avoids it everywhere for
  consistent behaviour across engines.
