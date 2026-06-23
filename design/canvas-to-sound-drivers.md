# Canvas to Sound Drivers

One inspector band that collects every mapping from the canvas (colour under a
beat, or where an event happened) to a sound parameter, per object. It surfaces
drivers that used to be scattered — the beat-strength channel from the Rhythm
band, and the velocity/sustain image influence from the Style editor — so they
are all in one place and easy to play with.

## Inspector band order

Identity → Geometry → Behaviour Functions → **Voice** → **Rhythm** →
**Canvas to Sound Drivers** → (Global, unused)

Changes from the previous layout:

- **Voice** moves up, to sit between Behaviour Functions and Rhythm (was below).
- The **Timing band is removed.** Start at Cycle, Stop at Cycle, and Trigger
  Sync are dropped for now (may return later). Its three surviving fields —
  **Cycle Speeds**, **Time Lag In Object** (the multiplier), and the **interval**
  dropdown to its right — move into a new **bottom row of the Rhythm band**.
- **Canvas to Sound Drivers** is a new band directly below Rhythm.

## The band

Each row is a **channel/source dropdown** on the left and a **depth slider**
(**None ◀▶ Full**) on its right. The slider sets how strongly that channel
influences this object: None = no image influence, Full = maximum. Labels follow
the inspector convention (right-aligned, hugging their field).

| Row | Source dropdown | Depth | Fields |
| --- | --- | --- | --- |
| **Beat strength** | col channel | None ◀▶ Full | `strengthChannel`, `strengthDepth` |
| **Likelihood of beat** (drop) | col channel (default Chroma) | None ◀▶ Full | `dropChannel`, `dropDepth` |
| **Note velocity** | col channel | None ◀▶ Full | `velocityChannel`, `velocityDepth` |
| **Sustain** (note length) | col channel | None ◀▶ Full | `durationChannel`, `durationDepth` |
| **Pan** | mode (see below) | None ◀▶ Full | `panMode`, `panDepth` |
| **Bend** | — placeholder, TBD — | — | — |

The col-channel dropdowns list the ten image signals: `lt, chr, r, g, y, b, or,
li, cy, pu`. The Beat-strength dropdown is the one **moved out of the Rhythm
band** (it is no longer beatbox-only; it applies to every Strudel voice).

## Depth slider over the pattern digits (Beat strength & Drop)

The per-beat pattern digits stay per-beat: the strength token's swing digit is
that beat's variation range, and the drop digit is that beat's drop level. The
**depth slider is an object-wide influence applied first** — it scales the range
(and the drop level) before the per-beat digit is evaluated, so it affects all
beats together.

```
effRange = range · strengthDepth                 // strengthDepth 0..1, per object
lo = max(0, base − effRange);  hi = min(9, base + effRange)
effStrength = lo + cv·(hi − lo)                  // cv = strengthChannel under the beat
```

`strengthDepth = 1` (Full) reproduces the shipped behaviour; `0` (None) pins each
beat to its base strength (no image swing). Drop is analogous: `dropDepth` scales
the drop level before the threshold test, so None disables dropping object-wide
and Full uses each beat's drop digit as authored.

## Note velocity & Sustain — migrated out of Style

The Style editor's image-influence sliders (Velocity Mix / Sustain Mix and their
canvas Source/value choosers) are **removed**. No style depends on image colour
any more. The image channel + depth for velocity and sustain now live here, per
object, and still combine with the style the way they did before:

- `shapeVelocity` reads `velocityChannel` (the image value under the beat) as its
  `image` input and `velocityDepth` as its `weight`, blended against beat strength
  exactly as the old `style.velocity` / `style.velocityWeight` were.
- `shapeDuration` reads `durationChannel` + `durationDepth` likewise, blended
  against the fixed default sustain (old `style.duration` / `style.durationWeight`).

The style still shapes everything else (base level, accent response, phrasing);
only the image knobs move here.

## Pan

`panMode` dropdown:

- **None / Off** — pan fixed at centre.
- **Canvas L/R** — pan from the event's horizontal offset from the **centre of
  the image**: left of centre pans left, right pans right.
- **Collision L/R** — **greyed for now** (future: pan from the collision side).

`panDepth` (None ◀▶ Full) scales the spread.

## Bend

Placeholder, TBD. A greyed stub row, no runtime, reserved so the band's shape is
settled.

## Data model (per object — curves and sprites)

Already present: `strengthChannel`, `dropChannel`.

Add: `strengthDepth`, `dropDepth`, `velocityChannel`, `velocityDepth`,
`durationChannel`, `durationDepth`, `panMode`, `panDepth`.

Defaults:

- `strengthDepth`, `dropDepth` → **1 (Full)** — preserve the already-shipped
  digit behaviour.
- `velocityDepth`, `durationDepth` → **0 (None)** — new opt-in drivers; with the
  style no longer image-driven, default to no image influence until chosen.
- `strengthChannel` → `lt`, `dropChannel` → `chr` (current implicit defaults);
  `velocityChannel`, `durationChannel` → `lt`; `panMode` → None/Off.

## Milestones

Four, each independently testable and commit-able:

- **M1 — Inspector rearrangement (layout only).** Voice up; remove the Timing
  band; fold Cycle Speeds + Time Lag (multiplier + interval) into the Rhythm
  band's bottom row; drop Start/Stop/Trigger Sync. No behaviour change.
- **M2 — New band + Beat strength & Drop.** Scaffold the band below Rhythm; move
  the strength channel chooser in; add the drop channel chooser; add both depth
  sliders and the depth-over-digits wiring (`strengthDepth`, `dropDepth`).
- **M3 — Note velocity & Sustain.** Add the channel + depth fields and rows;
  reroute `shapeVelocity` / `shapeDuration` to read them; strip the image sliders
  and canvas Source/value choosers from the Style editor.
- **M4 — Pan & Bend.** Pan dropdown (Canvas L/R live, Collision L/R greyed) +
  depth; Bend placeholder stub.

See also: `measure-patterns.md` (the beat-pattern digit grammar that the Beat
strength and Drop rows scale), `styles.md` (what remains in a style once the
image knobs leave).
