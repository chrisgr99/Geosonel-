# Image signal stretching (baked percentile bands)

Supersedes the runtime `agc()` design. The idea: instead of computing a gain at
call time, **bake a per-pixel stretched colour array when an image loads**, so
the ten `this.col.*` behaviour signals are already normalised to fill [0, 1]. A
script just reads `this.col.r` (0..1, continuous) — no per-call gain needed.

## What the signals are, and why a/b space (not angular hue)

The precomputed image buffer (`buildOKLChBuffer`, src/strudel/oklch.js) stores
**L, C, a, b** per pixel, and the comment there is explicit: the angular hue `h`
is *intentionally not used* — the system works in the **Cartesian a/b opponent
axes** to avoid the hue-wraparound discontinuity.

After the stretch (below), every axis arrives in [0, 1] and the ten signals
(src/strudel/signals.js, `imageSignalsFromOKLCh`) are **continuous** reads of it
— never half-wave-rectified:

- `pxLt = L'` (lightness), `pxChr = C'` (colourfulness).
- The opponent primaries are the stretched axes read directly, with neutral grey
  at 0.5: `pxR = a'` (0 greenest … 0.5 grey … 1 reddest), `pxY = b'`
  (yellowness). Greenness and blueness are their **exact inverses**:
  `pxG = 1 − pxR`, `pxB = 1 − pxY`.
- The four hue diagonals are the **symmetric mean of the two adjacent
  primaries**, also inverse pairs: `pxOr = (pxR + pxY)/2`,
  `pxLi = (pxG + pxY)/2`, `pxCy = 1 − pxOr`, `pxPu = 1 − pxLi`.

Every channel is therefore guaranteed in [0, 1] and varies *continuously* over
the image. This is the deliberate correction to an earlier half-wave-rectified
design: a channel clamped dead to zero across a whole colour region is
discontinuous and useless as a control input. Here a channel is "how far toward
this colour", and its opposite is the mirror — no dead zones.

Working in a/b (not angular hue) is what makes this clean: stretching the linear
a and b axes spreads hue without circular range-finding, and a near-grey pixel —
tiny (a, b) — degrades to neutral rather than injecting amplified hue noise (see
the flat-axis rule below).

## The stretch (computed once per image, deterministic)

From a fixed-stride subsample (≤ `STRETCH_MAX_SAMPLES`, 10k px) of the raw OKLCh
buffer, each of the four channels — **L, a, b, C** — is banded **independently**
by its own 5th–95th percentile `[lo, hi]` and stretched to fill [0, 1]:

    chan' = clamp((chan − lo) / (hi − lo), 0, 1)

(`computeStretchParams` derives the eight band edges `Llo/Lhi`, `aLo/aHi`,
`bLo/bHi`, `cLo/cHi`; `applyStretch` maps each pixel.) Outliers beyond a band
saturate to 0 or 1, so a few stray pixels cannot blow the range out.

- **a and b** stretch about their own percentile band, so the image's whole
  redness/yellowness spread fills [0, 1] with grey landing near 0.5. Independent
  per-axis bands deform the (a, b) cloud, which **spreads hue** as well as
  scaling chroma.
- **C (colourfulness)** is banded on its own rather than recomputed from
  `hypot(a', b')`, so `pxChr` reflects the image's actual chroma spread directly.
- **L (lightness)** bands the same way and always carries range, even on a grey
  image.

**Flat-axis rule (grey degrades cleanly).** An axis whose percentile band is
narrower than a flatness epsilon carries no real signal (a grey / near-grey
image), so it is **neutralised, not amplified**: a and b map to 0.5 (neutral, no
hue bias), C maps to 0 (no colour), L to 0.5. The chromatic epsilon
(`CHROMA_FLAT_EPSILON ≈ 0.02`) is a small fraction of a vivid sRGB chroma, so a
genuinely colourful axis is always stretched while a near-grey one stays put; L
uses a tiny epsilon (`STRETCH_FLAT_EPSILON`) since lightness essentially always
has range. You can't manufacture colour from an image that has none.

All constants (`AGC_LOW_PCT`, `AGC_HIGH_PCT`, the flatness epsilons, the
subsample stride) are fixed module constants — no clock, no random ⇒ identical on
every rerun, and the colour→note mapping is frozen before the first note.

## A single authored colour (this.color.*)

`colorSignalsFromHex` (src/simulation.js) exposes an object's own authored hex
through the same `imageSignalsFromOKLCh → colFromSignals` path. A single colour
has **no image distribution to percentile against**, so instead of a band it maps
the colour's raw OKLab axes to the same [0, 1] inputs with a **fixed magnitude
scale** `N = 0.3`, centred so grey (a = 0) is 0.5: `a01 = clamp((a/N + 1)/2)`,
likewise `b01`, and `C01 = clamp(hypot(a,b)/N)`. The continuous, opposite-inverse
shape is then identical to the image signals.

## Outputs

- **`this.col.*`** — derived from the stretched (L', a', b', C') via
  `imageSignalsFromOKLCh → colFromSignals`, so the ten signals come out
  pre-stretched and mutually consistent.
- **Object colour under the cursor** — stretched (L', a', b') → sRGB,
  gamut-clamped: a vivid, hue-spread "intense" version. Object tint only.
- **Background** — drawn from the RAW image bitmap, never stretched (the canvas
  already renders the bitmap, not the sample buffer). The raw OKLCh buffer is
  retained as well, for any future true-colour need.

## `agc()` becomes thin sugar

With pre-stretched signals, `agc("col.r", lo, hi)` is just
`lo + this.col.r·(hi−lo)`. Keep `agc` as a convenience (channel parse + map a
pre-stretched 0..1 value, same midpoint guards) so existing scripts keep working,
but remove its runtime range computation — the percentile/stretch logic now lives
in the image bake.

## Storage / determinism / deferred

- Two sample buffers per image: raw (display/true-colour) + stretched (signals +
  object tint). Standard size bounds memory.
- Recompute only when the image changes (cache key = the raw buffer reference).
- **Deferred, unchanged:** per-curve / per-cycle stretch for moving curves
  (`this.fitPath`). The bake is whole-image only.
