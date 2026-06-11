# Image signal stretching (baked gain)

Supersedes the runtime `agc()` design. The idea: instead of computing a gain at
call time, **bake a per-pixel stretched colour array when an image loads**, so
the ten `this.col.*` behaviour signals are already stretched to fill their range.
A script just reads `this.col.r` (≈0..1) — no per-call gain needed.

## What is stretched, and why in a/b space (not angular hue)

The precomputed image buffer (`buildOKLChBuffer`, src/strudel/oklch.js) stores
**L, C, a, b** per pixel, and the comment there is explicit: the angular hue `h`
is *intentionally not used* — the system works in the **Cartesian a/b opponent
axes** to avoid the hue-wraparound discontinuity. The ten signals
(src/strudel/signals.js) are: `pxLt = L`; `pxChr = hypot(a,b)/N`; the primaries
`pxR/G/Y/B = max(0,±a or ±b)/N`; the diagonals `pxOr/Li/Cy/Pu` = 45° projections
of (a,b)/N — all over `PRIMARY_NORMALIZER N ≈ 0.3`.

So "stretch hue" is realised by **stretching the a and b axes**, not by rotating
an angle. This is simpler (linear, no circular range-finding), aligns with the
architecture, and — critically — handles the low-chroma-noise problem naturally:
a near-grey pixel has tiny (a,b); a *bounded* linear stretch keeps it tiny, so it
never injects hue noise. Angular stretching would have amplified the meaningless
hue of grey pixels; a/b stretching does not.

## The stretch (computed once per image, deterministic)

From a fixed-stride subsample (≤10k px) of the raw OKLCh buffer:

- **L (lightness)** — linear percentile. Take the 5th–95th percentile
  `[Llo, Lhi]`; `L' = clamp((L − Llo)/(Lhi − Llo), 0, 1)`. Always gives lightness
  range (works even on a grey image).
- **a, b (chromatic axes)** — independent, symmetric, **gain-capped** per axis:
  - `gainA = min(GAIN_CAP, N / p95(|a|))`, `a' = a · gainA` (then the signal layer
    clamps to ±N as today). Same for `b'` with `p95(|b|)`.
  - Scaling about 0 (not min→max) keeps the axis balanced — no hue-shifting the
    whole image. Independent gains for a and b deform the (a,b) cloud, which
    **spreads hue** as well as boosting chroma.
  - **`GAIN_CAP` is the chroma weighting.** A colourful image has `p95(|a|) ≈ N`,
    so gain ≈ 1 (no over-stretch). A near-grey image has tiny `p95(|a|)`, which
    would call for a huge gain — the cap holds it down, so grey stays grey
    (quiet chroma signals) instead of amplifying noise. You can't manufacture
    colour range from an image that has none; lightness still carries range.

`pxChr` falls out of the stretched `hypot(a',b')` automatically; no separate C
stretch. Constants (`AGC_LOW_PCT`, `AGC_HIGH_PCT`, `GAIN_CAP`, subsample stride)
are fixed module constants — no clock, no random ⇒ identical on every rerun, and
the colour→note mapping is frozen before the first note.

## Outputs

- **`this.col.*`** — derived from the stretched (L', a', b') via the SAME
  `imageSignalsFromOKLCh → colFromSignals` path, so the ten signals come out
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
