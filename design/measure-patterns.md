# Measure-based beat-strength patterns

How a curve/sprite's rhythm is authored: a phrase of per-measure Strudel
mini-notation patterns, each measure a "Beat Strength Pattern" whose digits are
per-beat accents. This is the only beat-pattern system (the None / Manual /
Euclidean / Auto grid modes are gone; `beatPointsMode` is always `"strudel"`).

## Concept

Strudel keeps cycles short and has no phrase structure — each cycle is, in
effect, one measure. This system makes that explicit: the user authors a **row
of measures**, one short Strudel pattern per measure, and the row is the phrase.

- Digits `0`–`9` in a pattern are the per-beat **strength** (accent → velocity);
  `~` is a rest. All native Strudel operators work inside a measure
  (`[]`, `<>`, `*`, `/`, `@`, `?`, `|`, `(k,n,r)`, …).
- A measure's pattern is one Strudel cycle whose wall-clock length is the
  **master beats-per-measure** (quarter notes). The pattern subdivides that bar
  freely — `9 5 5` is three events across the bar, `9 5 5 5` is four.

## Master meter

Beats-per-measure is **global**, read from `scene.timeSignature[0]` (the
numerator), set by the existing time-signature control in the canvas toolbar
(`time-signature-input`, built in `toolbar.js`). It is NOT a per-object field.

- Quarter-note beats only — the denominator is ignored. A compound feel (e.g.
  triplet swing, half-time) is achieved with the `cycleSpeeds` field, which
  scales the cursor's progress, not with meter machinery.
- Changing the master meter retimes every object's bars (cycle durations scale).

## The model

Per object:

- **Measures** `M` — the phrase length, i.e. how many measure boxes show.
- **Repeats** `R` — how many times the whole phrase is laid end-to-end around
  the object's path.

So the path holds `M × R` measures. The cursor traverses the path once per sim
**cycle**; that cycle is `M × R × masterBeats` quarter notes long.

### Derivation (replaces the per-loop cycle-advance)

`deriveStrudelTiled` becomes measure-aware. For each path slice
`s = 0 … M·R − 1`:

- the measure is `measures[s mod M]` (the phrase tiles `R` times), after
  fill-down resolution (below);
- it is sampled at **Strudel cycle `s`** — so stochastic / alternating
  operators (`?`, `<a b>`, `t/2`) differ across the `M·R` slices of one path
  traversal;
- its events are placed into path-fraction `[s/(M·R), (s+1)/(M·R))`.

The whole `M·R`-slice array is **baked once** and **resets each path loop** (the
cursor wraps back to slice 0 / Strudel cycle 0). Evolution is therefore bounded
to one trip around the path: the groove is a fixed, reproducible phrase that
plays identically every loop, rewind-safe by construction.

> This **removes** the per-loop re-derivation added for the single-pattern mode
> (`_ensureStrudelBeatCycle`, the canvas `_refreshStrudelMarkersForLiveCycle`,
> and the `cycleOffset = cycleCount × repeats` plumbing). The single-pattern mode
> is just the `M = 1` case.

### Timing

`beatsPerCycle` is no longer stored — it is derived `= M × masterBeats` (one
phrase) and the sim's `effectiveBeatsPerCycle = M × R × masterBeats`. The beat
interval is fixed to a quarter note. `cycleDurationSeconds` is unchanged given
those inputs.

## Fill-down (sparse authoring)

An **empty** box repeats the nearest **filled** box to its left, so a pattern
that holds across bars is typed once.

- `[ A ][  ][  ][  ]` → `A A A A`
- `[ A ][  ][ B ][  ]` → `A A B B`
- A leading empty box (nothing to its left) is a rest.
- To force a **silent bar mid-phrase**, type a single `~` — it is non-empty, so
  it does not inherit; it fills the measure with a rest.

Resolution happens before slicing: build `resolvedMeasures[0…M−1]` by carrying
the last non-empty pattern forward, then slice as above.

## Storage

One `beatPattern` string, measures joined by **`|`** (the bar line). Splitting
into boxes is **bracket-depth-aware**: a `|` only separates measures at depth 0,
so `[a|b]` random-choice *inside* a measure survives. Example (4 bars, 1 & 3
filled): `"9 5 7 5||~ 9 ~ 9|"`.

The string may hold **more** segments than `M`: lowering Measures **hides** the
trailing bars (they stay in the string) so raising it again restores them; a
fat-fingered Measures change never destroys typed bars. Only the first `M`
segments render and play.

## The pattern field — measure boxes

One field frame with internal **marker** dividers partitioning it into `M`
regions; each region is its own small auto-sizing input (discrete inputs make
the rubber-band and wrap robust; visually it reads as one field with markers).

- **Rubber-band** — each region sizes to its content; empty regions are narrow,
  so the markers start close together and a region grows as it is typed, pushing
  the regions to its right.
- **Wrap** — when a row outgrows the sidebar width, regions wrap to the next
  line.
- **Measure numbers** — a small `1 2 3 …` in each region's corner.
- **Inherited bars are ghosted** — an empty box shows a faint grey-italic echo
  of the bar it repeats (what *will* play); typing replaces the ghost, clearing
  back to empty restores it.
- Commit on blur (matches the other inspector fields); monospace.
- Sane cap: ~16 measures.

## Token-level playing highlight

As the cursor sweeps, the **currently-sounding token** (the specific `9`, `~`,
or atom) is highlighted in its box — the same translucent-overlay technique as
the old x/dot playing-beat highlight, positioned per token. During an
**inherited** bar the highlight lights the token in the **source** box (bars
1→2 both light box 1).

Mapping a firing beat → source token uses the hap **`loc`** (source character
span within the mini-notation), already produced by `parsePatternToPositions`
and used by the Code-tab active-token highlighter. The derivation must carry,
per beat point, which measure box and which character span it came from.

## Canvas-driven strength — `NcM` tokens (beatbox)

A beat token can be **`NcM`** (base strength N, swing ±M) or **`cM`** (base 0)
instead of a fixed digit. It stays a flat token (no engine); the derivation
records the base in `strengths[i]` and M in a parallel `ranges[i]` (0 = fixed).

At fire time the object's **Driver-from-Canvas channel** (`strengthChannel`, one
of the col image signals: lt, chr, r, g, y, b, or, li, cy, pu) is read under
THAT beat's point on the curve (cv, 0..1) and mapped **linearly across the valid
span**, endpoints clamped:

```
lo = max(0, base − range);  hi = min(9, base + range)
effStrength = lo + cv·(hi − lo)
```

So `7c1` → [6, 8], `c9` → [0, 9] (a full dark→loud sweep). The whole channel
range is used (clamping the endpoints, not the output, so no half is silenced).
The strength is per-beat-POSITION: a static image + curve gives each beat a
fixed level; variation comes across beats at different positions or as the
object/image moves. A high-contrast image yields near-bimodal levels; a gradient
gives a smooth sweep.

Beatbox voices read no note **style** — the drum's velocity IS this
(canvas-resolved) strength. The Driver-from-Canvas channel sits at the right of
the Rhythm band for beatbox voices; the nxtNote-style picker is hidden for them.
Canvas tokens are flat-only (operator patterns would need a later special-case).

## Rhythm band fields (final)

- **Beat Pattern** — the measure boxes.
- **Measures** — phrase length.
- **Repeats** — phrase tilings around the path.
- **Driver from Canvas** (beatbox voices only) — the channel an `NcM` token reads.

Removed: Beat Interval (gone earlier), Qtr-Notes/Cycle (derived now), the
mode picker (strudel-only), per-object Beats/Measure (master).

## Samples

`beatboxKit` and `harmonyLines` are re-authored in this form (per-measure
`|` patterns, `measures` + `repeats`, master meter). No migration path for old
single-pattern scores — there are none of consequence.
