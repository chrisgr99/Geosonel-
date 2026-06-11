# AGC — automatic gain control for image colour signals

## Purpose

A script reads image colour at the firing point via `this.col.<chan>` (the ten
perceptual signals `lt, chr, r, g, y, b, or, li, cy, pu`). For a given image,
most channels occupy only a sliver of `[0,1]` (e.g. `col.r` in `[0, 0.15]`), so
a naive `map(this.col.r, 0, 1, lo, hi)` barely moves. AGC removes the need to
know the bounds: it auto-fits the input range so any channel can be stretched to
a chosen output range.

## API

```js
note = agc("col.r", 48, 90);   // current col.r, mapped from its image range to [48,90]
x    = agc("col.r");           // lo/hi default to 0..1
```

- First arg: the colour channel name (`"col.r"`, `"col.lt"`, …; bare `"r"` also
  accepted).
- `lo`, `hi`: output range; default `0`/`1`.
- Returns the **current callback's** `col[chan]` value (the firing or collision
  point) mapped from the channel's whole-image range to `[lo, hi]`, clamped.
- Bare form (no `this.`): the **range is object-independent** (whole image), so
  there is no "which object/path" to resolve — only the value comes from the
  ambient callback context, exactly like bare `playNote`. Works in any callback
  that has a `col` (onActiveBeat, onTick, hasCollided, beenTriggered).

## Range source

The whole background image, per channel, with **extremes trimmed**: sort the
channel's pixel values, take the 5th–95th percentile as `[min, max]` so a few
outlier pixels (specular highlights, black specks) cannot blow the gain out and
crush the majority into a sliver. Values outside the band clamp to `lo`/`hi`.

Flat-channel guard: if trimmed `max ≈ min`, return the midpoint of `[lo, hi]`
(no divide-by-zero).

## Determinism (hard requirement)

- Computed **once** from the static image (a pure function of pixels + the fixed
  percentile cut), cached, recomputed only when the image itself changes.
- **No running/adaptive component.** The gain is fixed before any note plays and
  for the whole run, so: identical on every rerun, and a fixed mapping (the same
  colour always yields the same note, start to finish — no mid-phrase drift,
  no learning period).

## Deferred: curve-path AGC (`this.fitPath`)

If the global image range is too loose for a curve sitting in a calm region of a
busy image, add a per-curve variant later:

- Sample **all** the curve's beat points (active AND inactive — so future
  active-beat mutation cannot shift the gain) against the image.
- **Re-sample at the start of every cycle**, because a curve can have velocity /
  bounce off canvas edges — its position each cycle is deterministic, so the
  per-cycle range is deterministic. Fixed within a cycle, updated only at clean
  cycle boundaries → still not a running AGC.
- Object-bound, so written `this.fitPath("col.r", lo, hi)` — `this` names the
  curve whose path is meant. (For onTick, a dense whole-path snapshot instead of
  just beat points.)

Build order: `agc` (whole-image) first; `fitPath` only if precision demands it.
