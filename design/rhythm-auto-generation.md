# Auto beat-pattern generation & rhythmic styles

DEFERRED design, settled in discussion with Chris. Not yet built — captured so
the arc isn't lost. This is the near-term, concrete feature; the broader
"compose by phrases / repeat the scene" vision lives in
[variations-and-repeats.md](variations-and-repeats.md) and shares concepts
(styles, the Mutability vocabulary, image-as-dice).

> **Update (June 2026):** the STYLE-SYSTEM structure here is superseded by
> [styles.md](styles.md) — styles split into two types (vStyle voice / rStyle
> rhythm) sharing a rhythm core, edited in a Styles tab (not a popover), and
> percussion gains a kit + multi-lane voicing model. The generation MECHANICS
> below (constrained-weighted generator, image-as-dice, per-cycle regen,
> Repeats-as-spatial-variation, swing-from-onset-placement, and the five
> calibration knobs) all still stand; the knobs ARE the shared rhythm core.

## The problem

A curve's rhythm — which beat points sound, how strongly, and where ratchets
fall — is authored by hand (the Active Beats `x`/`.`/digit string) or spread
evenly (Euclidean). It does NOT respond to the image, so dropping or moving an
image changes pitch and loudness but never the rhythm, which is a fundamental
part of the sound and gets tiresome on repeat. We want the image to shape the
rhythm too — deterministically, so the same position reproduces the same groove
— and we want a way to generate whole, musically-plausible phrases per a style.

## The beat-pattern source menu

`beatPointsMode` is the source dropdown. Today: `none / normal / euclidean /
strudel`. New shape:

- **Manual** (renamed from `normal`) — you type the `x`/`.`/digit pattern.
- **Euclidean** (unchanged) — K onsets spread as evenly as possible over N.
- **Auto** (new) — generate a whole phrase from a style.
- (`strudel` drops out in the procedural rework.)

Choosing **Auto** reveals a Style submenu whose names line up with the `nxtNote`
styles (melody / lead / bass), plus an optional Genre submenu.

## The generator (constrained-weighted)

A pure, deterministic, `node --test`-able module — the rhythmic twin of
`harmonyMelody.js`, which already does "colour-as-dice → weighted pick" for
pitch. Here the same machine picks rhythm:

```
generatePhrase({ beatsPerBar, beatsPerPhrase, subdivision,
                 style, genre, dice[] }) -> { activeBeats, strength }
```

Output is the existing pattern strings, so the rest of the engine is unchanged.

Pipeline:

1. **Metric grid** — each slot's metric strength from beatsPerBar + subdivision
   (recursive-halving hierarchy: downbeat strongest, then mid-bar, then beats,
   then off-beats). Pure.
2. **Style weights** — map metric strength → onset-probability, strength value,
   ratchet-likelihood, plus a syncopation bias and a target density. (Bass:
   steep, strong beats only. Lead: flatter + more syncopation + ratchets.)
3. **Genre overlay** — small multipliers / accent masks tilting the style
   weights (swing lean, clave, backbeat…).
4. **Colour-as-dice draw** — the colour value under each beat point is the
   deterministic draw: compare against the combined weight for onset, pick a
   strength within the style's range, threshold for a ratchet.
5. **Phrase-level constraints** — the part that makes it read as a phrase, not
   noise: enforce a target density (nudge the weakest/strongest eligible slots
   if off), anchor the downbeat, give the last bar a cadential shape, place
   ratchets as pickups into strong beats, suppress pathologies (five rests in a
   row, ratchet clutter).

The honest part: the code is the same weighted-draw-plus-constraints machine as
the melody generator; the real work is **calibration** — first-cut weights sound
mechanical, and making bass/lead/melody actually FEEL like themselves is an
iterate-by-ear loop. Budget a tuning pass, and stand up a tiny audition harness
early so the loop is fast. No corpus or ML — the profiles are hand-authored from
music theory (metric hierarchy, role archetypes, syncopation measures, genre
accent patterns; Euclidean rhythms can seed the onset skeleton for some genres).

## Image as the dice (position-deterministic)

For each beat point — INCLUDING the rests, which today aren't sampled at all
(only active beats fire and read `this.col`) — sample the image colour at that
slot's position. That one engine change (sample every slot, not just the firing
ones) makes the whole effective pattern a pure function of (beat-point position,
baked image). Move the curve → slots sample different pixels → the groove
shifts; move it back → identical pixels → identical groove. No harmony involved,
so it works for a bare percussion curve and slots into the repeat-the-scene idea
for free.

Generation happens **per cycle** (the whole phrase at once, at cycle restart),
NOT slot-by-slot on the fly — musical plausibility is a phrase-level property
(density arc, anchored downbeats, ratchet pickups, sensible ending) that needs
all N slots visible together. Per-cycle regen also lands live edits at phrase
boundaries, not mid-bar.

`Vary-per-cycle` (a temporal variation knob) was considered and DROPPED: with
variation coming from the image and from Repeats (below), the generator stays
purely position-driven — trivially reproducible, reproduces on rewind, no
temporal state. A static curve plays the same phrases every cycle; ongoing
variation comes from motion and Repeats, which are authored.

## Repeats = spatial variation

`patternRepeats` today tiles the same pattern around the path. Under Auto it
reinterprets as **N independently-generated phrase instances**: Beats/Phrase =
the phrase length, Repeats = the count, so each instance occupies a different
arc of the path, samples a different region of the image, and comes out
different — but deterministically. One sweep of the cursor plays N related-but-
distinct phrases; next cycle it's identical; move the curve and all N reshape.
Spatial variation kills tiresome repetition WITHIN a cycle and stays
reproducible.

Each instance is seeded from the colours under ALL its beat points (its whole
arc), not just its start point. Optionally pass the instance index (1-of-N) so
the set can take a shape (statement / variation / cadential close) — start with
independent variations, keep the index in pocket.

## Swing

No special machinery — swing FALLS OUT of the existing model, where the grid
encodes ONSET POSITIONS only and note DURATION is set by the callback
(`playNote`'s duration argument), never by the grid.

Choose an even subdivision (e.g. `8th`) and group it in threes; onsets on slots
1 & 3 of each group (`x.x`) give the long-short swing spacing — the first onset
spans two slots, the second spans one, a 2:1 feel — and ticking all three
(`xxx`) gives straight triplets. The notes' actual sustain (legato vs staccato)
is the callback's concern; the swing lives in the onset spacing. So swing,
shuffle, and triplets are all just onset placements on an even grid grouped in
threes — nothing swing-specific to build.

(The triplet beat intervals `Qtr Tr` / `8th Tr` are an alternative route to the
same feel — three slots per beat — but aren't required; plain subdivision + a
group-of-three already does it. The ratio is the grid's 2:1, "close enough"; a
continuous timing nudge stays a deferred option.)

For Auto, a swing/shuffle GENRE just groups onsets in threes and favours slots 1
& 3 — the generator places onsets + strength, durations stay the script's
concern, exactly as Manual and Euclidean already work.

## Calibration knobs (the creative surface)

Rather than ship one "correct" calibration, expose it. A style is a PRESET of a
few macro knobs (like `smoothness`/`chordLock` on the melody styles), and the
user nudges from there — the one-tap path stays "pick a style," the knobs are
optional refinement, and they're dictation-friendly named scalars.

Core three (change the feel most):

- **Density** — sparse ↔ busy (onset threshold / target hits-per-bar).
- **Syncopation** — straight ↔ off-beat (shifts weight off the strong beats).
- **Image Influence** — archetype-locked ↔ image-driven (how far the colour-dice
  may deviate from the template; tunes how much movement reshapes the groove).

Secondary two (refinement):

- **Accent** — even ↔ punchy (spread of the strength values).
- **Fills / Ratchets** — none ↔ busy (ratchet-likelihood + max count).

Style sets the base positions, Genre tilts them, the user has the final say —
one set of knobs, preset then adjustable. A possible sixth, Phrase Contour
(flat ↔ building), is left out of the core to keep the panel lean.

## UI: band vs editor

Two surfaces, kept separate so the inspector stays lean — the band is for USING
a style, a popover is for AUTHORING one.

**Rhythm band (inline, Auto chosen):** the per-curve choice only —

- Row 1 (character): `Source: Auto` · `Style ▾` (with an "Edit… / New…"
  affordance) · `Genre ▾` (optional, neutral default)
- Row 2 (grid & length): `Beat Interval ▾` · `Beats / Bar` · `Beats / Phrase` ·
  `Repeats`. (Swing is not a field — it emerges from onset placement on an even
  grid grouped in threes; see Swing below.)
- Result (read-only, Euclidean-style locked fields): `Active Beats` (locked) ·
  `Beat Strength` (locked) — show both, so you see the whole generated result.

`Beats/Bar` is a real creative control (lets a curve run 3/4 or 5/4 against a 4/4
tune — polymeter), defaults to the score/harmony time signature, overridable.
`beatsPerCycle` is derived (= Beats/Phrase × Repeats), not separately editable —
the three are locked by that identity, so author the two meaningful ones.

**Style editor (a non-modal popover from the Style dropdown):** the style
*library* (list: select / duplicate / rename / delete; built-in + user styles)
and the calibration knobs. The only place the knobs are exposed. Live:

- Knob changes regenerate immediately; per-cycle regen means you hear the new
  groove next cycle. No "Regenerate" button.
- A loop/audition toggle holds a phrase looping while you dial, played NON-TONAL
  by default (neutral click; strength → accent, ratchets → subdivisions) so you
  hear placement, with a toggle to the real colour-pitched voice for context.
- Tweaking knobs changes the character in place (position-deterministic);
  different *realizations* come from moving the object or Repeats, not a re-roll.

## Style as a standalone, reusable object

Styles are a named library, app-level so they cross scores (the chart-library
pattern again): a curve references a style BY NAME and may carry small local
tweaks (like spreading `{...styles.bass, ...}`). A tuned, named set IS a new
style. Design the style as a STANDALONE named object now, so that when a "style"
later carries BOTH a pitch profile (`nxtNote`) and a rhythm profile (Auto) — the
unified voice-identity idea — the editor can grow into its own home (a Styles
area / tab) without rework.

## Relationship to image-driven rhythm "flip"

A lighter, related idea: instead of generating, PERTURB an authored Manual
pattern by the image — each slot flips `x`↔`.` or simplifies a ratchet based on
its colour (dark thins, bright fills), bounded by an amount and protecting
strong beats (read from Beat Strength). That's fine to do LOCAL/per-slot because
it nudges an already-coherent pattern; Auto has no authored pattern to lean on,
so it needs the whole-phrase pass. They share the per-slot colour-sampling
machinery — two features, two appropriate timings.

## Terminology caution

"Phrase" now means two things: the Harmony tab's MELODIC phrasing (breath/gap
spans) and the curve's RHYTHMIC phrase (the generated `Beats/Phrase` unit). Keep
labels distinct ("Beats/Phrase" reads as the rhythmic unit; the harmony feature
stays "phrasing"). If they still feel collidable, the rhythmic unit could be a
"figure" or "cell". The deeper question of making the two phrasings line up in
time (and whether to rename this one) is its own design: see
[phrase-sync.md](phrase-sync.md).

## Determinism summary

The generated rhythm is a pure function of (beat-point positions / image,
geometry, style + knobs). Same position ⇒ same groove. Reproduces on rewind and
under the repeat-the-scene feature. No temporal state.
