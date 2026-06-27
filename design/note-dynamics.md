# Note dynamics: scoring velocity and duration

How a note's **velocity** (accent) and **duration** (sustain) are decided. This
is the dynamics half of a `NoteStyle` (see [styles.md](styles.md)); **pitch /
note determination is a separate concern** — the pitch driver today, a
note-determination style later — and is out of scope here.

The model replaces the old per-note driver *blend* (image × weight + baseline)
with a **musical-scoring pipeline**: plan a cycle of notes ahead, score each note
for how strongly it should speak and how long it should last, turn each score
into a probability distribution of *musically-valid* options, let the canvas
**bias** that distribution, filter out anything that breaks the harmony or
groove, and sample. **One analysis emits both scores** — they share context, but
a note can be strong-and-short or soft-and-long, so they are weighted separately.

## Scope: built-in genres, no style-creation tool

The app ships a fixed **library of genres** (authored here, ~8–12 + a few
sub-feels), effectively read-only. Per score the user **picks one genre** and may
**adjust its sliders** (per role); that adjusted state is just part of *that
score's data*. There is **no user style-creation / library tool** — no UI to
build, name, save, and share custom styles across scores. The only "editing" is
moving sliders on the chosen genre, scoped to the current score. (A style is a
vector + the genre's flavour, so "save these slider positions as a named style"
is an easy future add if ever wanted — but it ships without one.)

## Core principle: knobs are inputs, dynamics are outputs

Every user control **parameterizes the score → output mapping** — it answers
*"how strongly does X influence the result"* (a weight, a range, a centre, a
temperature). The per-note velocity and duration are **outputs**, computed by the
scoring. A proposed control is only a valid knob if it can be phrased that way; a
knob that tries to *set* an output directly (e.g. "make every note long") is
wrong. (This is why the duration knob is **Articulation** — the overall
legato/staccato *register* the scoring rides on — not "Length.")

## Pipeline — per object, per cycle

1. **Plan.** Snapshot the cycle's beat points. The pitch sequence is already
   fixed, so run the line forward and resolve, per note: `pitch, onset,
   gapToNext, meter (beat + subdivision), chord, nextChord, phrasePos,
   chordToneClass, contourFlags`. Plus a **boundary peek** — the first note and
   the chord at the start of the *next* cycle — so the cycle's last note can be
   scored honestly (resolve / tie / cross-the-bar).
2. **Score.** Per note compute an **accent score** and a **sustain score**
   (weighted sub-sums, normalised 0..1).
3. **Distribute.** Map each score to a probability distribution: accent → a
   velocity distribution; sustain → gate buckets (`clip / legato / tie-1 / tie-2
   …`).
4. **Canvas bias (bias-then-filter).** The image value under the beat point
   *shifts the distribution's probabilities*, scaled by Canvas-depth. (The
   alternative — the canvas *indexing* the vetted set, "select" — is the fallback
   if bias proves too un-musical.)
5. **Filter.** Zero any option that violates a hard constraint: crossing a chord
   change while unstable, leaving no room for a needed resolution, density out of
   the genre's range.
6. **Sample.** Seeded RNG (`roll(seed, cycle, slot)`) picks from the
   biased-and-filtered distribution; its spread is the Variation knob. Bias +
   sample means the canvas *and* the dice both contribute.
7. **Play.** The beat callback plays the planned note's pitch with the sampled
   velocity and duration.

A later **pass 2** can smooth the cycle (don't make every strong beat loud or
every stable note long; preserve contrast). Deferred until 1–7 are solid.

### The seam — it all flows through `nxtSound`
The callback is unchanged: `playSound(nxtSound(style))`. `nxtSound` still returns
a coordinated `Note` (pitch + scored velocity + scored duration + pan) that
`playSound` → `_playVoiced` plays. The plan-and-score lives **inside**
`nxtSound`: on the first beat of a cycle it builds the whole cycle's plan, scores
it, and **caches** it; every beat (including the first) returns its pre-scored
Note from the cache. So the one-cycle look-ahead is hidden behind the existing
signature, and the auto-generated stub stays correct without edits.

### Look-ahead window
The unit is the **cycle**, snapshotted at its start, **plus a one-note / one-chord
peek** into the next cycle (so the last note's resolve/tie/cross decisions are
honest). Static object → the snapshot repeats every cycle (cache it); moving
curve → recompute per cycle (the motion projection is deterministic).

### Determinism
Each cycle is re-derivable from `(seed, cycleIndex, snapshot)`; sampling uses the
seeded RNG. Rewind / replay is bit-identical; the dice re-roll is a new seed.

## Duration is sustain, not rhythm

Onsets are fixed by the beat pattern, so "duration" means **how long the note
holds** — a **gate**, a fraction of the gap to the next onset, extended to **tie
across** one or more onsets for held tones. Low sustain → clip inside the gap
(staccato); mid → fill it (legato); high → tie across into a long tone. Choosing
onsets is the separate rhythm-style job.

## Voice-kind fork

- **Instrument** → accent **and** sustain, full harmonic/melodic terms.
- **Beatbox** → accent **only**. A hit is a one-shot (sample's own length), so the
  sustain side is skipped; pitch/harmony terms drop, and accent leans on the
  rhythmic/percussive terms (metre, groove, syncopation, ghost notes, role).

## Instant vs sequence terms

Each sub-score is tagged:
- **instant-context** — harmony, phrase, role, canvas: available at any single
  moment.
- **sequence** — grid-metre, gating-to-next-onset, contour, motif: need the
  planned line.

`onActiveBeat` notes use **both**. `hasCollided` / `beenTriggered` fire off-grid
and sporadically, so they use **only the instant terms** — the style still
*colours* the hit (role/genre character, harmony/phrase response, canvas, and the
**base** absolute duration register) but the sequence machinery is absent. This
is exactly the existing `shapeDuration` "no next note → absolute sustain"
fallback.

## The two scores (instrument)

### Accent score → velocity
| sub-score | weight | kind |
|---|---|---|
| Metrical strength (user beat-strength digit / beat position) | 30% | sequence |
| Harmonic importance (chord-tone class at onset) | 20% | instant |
| Phrase importance (start / end / cadence) | 20% | instant |
| Contour importance (peak / valley / leap / first-after-rest) | 10% | sequence |
| Motif importance (repetition of position / cell) — *deferred* | 10% | sequence |
| Genre accent bias | 10% | instant |

### Sustain score → duration
Weighted sum minus penalties:
| sub-score | weight | kind |
|---|---|---|
| Harmonic stability across the held span (current + next chord) | 25% | instant |
| Available space (gap to next onset) | 20% | sequence |
| Future-chord compatibility | 20% | instant |
| Phrase arrival (cadence / phrase end) | 15% | instant |
| Contour arrival | 10% | sequence |
| Genre duration bias | 10% | instant |

minus penalties: unresolved tension, collision (chord change / next note),
excess density.

## Harmony is always present

A built-in **chord-progression generator library** ([harmony-progressions.md](harmony-progressions.md))
guarantees a harmonic context even with no iReal import. Generated charts are the
**same iReal format the import produces** (chords, change times, cadence points,
sections), so the scorer reads one format and the chart's sections *are* the
phrase structure it reads. The harmonic terms therefore never vanish.

## Where the settings live

The dynamics knobs are **not** per-object — that would get too complex. They sit
at the **score** level; an object carries only its **role**, and **genre × role**
is the bridge that turns "what world" + "what's your job" into "how you speak."

**Score level** — the shared world:
- Tempo, master meter — exist.
- **Harmony** — imported iReal chart *or* a picked built-in progression + key.
- **Style / Genre** — the dynamics genre, which *is* the roles → slider-vectors +
  flavour table. Optional per-role slider **adjustments** live here too (they
  affect every object of that role).

**Object level** — the player:
- **Voice** — instrument vs beatbox, bank / sample / instrument.
- **Role** — foundation / pulse / lead / pad / accent / fill / counter. The key
  dynamics differentiator; beatbox defaults it from the sample name
  (`bd→foundation`, `sn→accent`, `hh→pulse`). It needs to reach the firing
  context and be read by the scorer (today it is stored but unused).
- **Beat pattern** — the rhythm.
- **Pitch behaviour** — note determination (separate style).
- **Canvas driver mappings** — see below.

Two same-role voices play identically (they read the same row). If that ever bites,
the *minimal* escape hatch is **one** per-object dial (an "intensity" 0..1 scaling
its Punch/Variation), never a panel — ship with none.

## The control model: sliders, fan-out, flavour

- Everything the user adjusts is a **0..1 slider**. A style is a **vector** of
  sliders — trivially serialisable, morphable (interpolate between styles), and
  automatable.
- A **genre/preset is a named point** in that space — *but it also carries hidden
  **flavour** parameters the sliders don't expose.* The slider sets the **amount**
  of something; the genre sets the **kind**:
  - Syncopation = *how much* offbeat; the genre's pattern = funk eighths vs Latin
    **clave** vs reggae **skank**.
  - Punch = *how much* accent spread; the genre's **accent curve** (sharp
    transient vs swell).
  - Articulation = *how* short; the genre's **gate-bucket shape** and **swing /
    timing** feel.
  So a slider vector is the **visible projection** of a genre; the genre is the
  full param set. Two genres can share slider positions and still differ.
- **Three layers:** sliders (visible) → fan-out internal params (a slider drives
  several) → genre flavour (hidden). A sub-variant ("Funk 2") earns its own preset
  only if it changes a **flavour**, not merely slider amounts (which you'd reach
  by dialling).

### Instrument sliders (0..1)
| slider | 0 | 1 |
|---|---|---|
| Articulation | staccato | held / tied |
| Punch | flat | hard accents |
| Harmony hold | loose (tolerate tension) | strict (only stable notes hold) |
| Phrasing | flat | expressive (breathe at ends) |
| Variation | steady | loose |
| Syncopation | on-beat / metrical | offbeat / anticipated |
| Canvas depth | none | full |

### Beatbox sliders (0..1)
Drops Articulation and Harmony-hold (one-shot, no pitch); adds Ghost.
| slider | 0 | 1 |
|---|---|---|
| Punch | even | hard accents |
| Syncopation | on-beat | offbeat |
| Ghost | none | many quiet in-between hits |
| Variation | steady | loose |
| Canvas depth | none | full |
| Phrasing | flat | grooves that breathe |

## Canvas influence (per object)

The image drives through **colour channels** (~10 signals: lightness, chroma, the
RGB/CMY-ish channels, …). A driver = *pick a channel + how much*.

- **Pitch ← channel** (1 picker) — GX2's signature driver; essentially always on.
  Range/scale belong to the pitch style.
- **Dynamics ← channel + Canvas-depth** (1 picker + 1 slider) — **one** channel
  biases *both* velocity and duration. Optional: at depth 0 the scoring fully
  handles dynamics and the image has no say. (Splitting velocity/duration into
  separate channels is a later option, only if the ear asks.)
- **Pan ← channel**, **Drop/gate ← channel** — advanced, off by default.

So a typical object's canvas surface is **pitch channel + (optional) dynamics
channel + dynamics depth** (~3 core), pan/drop as advanced extras.

## Genre library

- **~8–12 base genres**, distinguished by *dynamics/groove* character (deeper
  genre identity comes from harmony + the future note style, not these sliders):
  Ballad, Pop/Rock, Funk, R&B/Soul, Jazz (swing/bebop), Jazz ballad, Latin,
  Hip-hop/Trap, Dance/House, Ambient/Cinematic (+ easy adds: Folk, Classical,
  Reggae, Gospel).
- A **flat list** (optionally family-grouped), not a Genre→Variant hierarchy.
  Sub-feels are added only where they change a flavour.
- **Authored from musical knowledge** (the assistant owns the library — the user
  has no time to hand-craft); the user only auditions and nudges.

Sample instrument vectors (`Art Punch Harm Phr Var Syn`):
| Genre | Role | Art | Punch | Harm | Phr | Var | Syn |
|---|---|---|---|---|---|---|---|
| Ballad | Lead | .75 | .45 | .70 | .85 | .30 | .20 |
| Ballad | Pad | .95 | .15 | .85 | .50 | .10 | .05 |
| Funk | Lead | .25 | .80 | .40 | .30 | .50 | .80 |
| Funk | Foundation | .30 | .75 | .60 | .20 | .30 | .70 |
| Jazz | Lead (bebop) | .45 | .60 | .45 | .60 | .75 | .60 |
| Ambient | Pad | 1.0 | .10 | .60 | .75 | .20 | .05 |

## Internal parameters (set by the preset, nudged by the knobs)

Hidden from the user; the preset sets a full profile + flavour, the dials scale
parts of it.

- **Accent weights** `Wa = {metrical, harmonic, phrase, contour, motif, genreBias}`.
- **Velocity map** `{velMin, velMax, velGamma}` (accent 0..1 → velocity) + the
  accent **curve** (flavour).
- **Sustain weights** `Ws = {harmStability, space, futureHarmony, phraseArrival, contour, genreBias}`.
- **Penalties** `{tension, collision, density}`.
- **Gate buckets** `{pClip, pLegato, pTie1, pTie2}` + gate fractions + bucket
  **shape** (flavour).
- **Density target**, **sampling temperature**, **canvas bias** `{velBias, durBias}`.
- **Constraints** `{chordCrossTolerance, resolutionRoom, densityRange}`.
- **Flavour** (not slider-exposed): syncopation **pattern**, accent **curve**,
  swing / **timing** feel.

Knob → internal mapping:
- **Style preset** → sets all of the above (incl. flavour) to a named profile.
- **Articulation** → gate buckets / legato gate fraction.
- **Punch** → `velGamma`, `velMin/Max` spread.
- **Harmony hold** → `Wa.harmonic`, `Ws.harmStability/futureHarmony`, the `tension`
  penalty, `chordCrossTolerance`.
- **Phrasing** → `Wa.phrase`, `Ws.phraseArrival`, phrase-end stretch.
- **Syncopation** → metrical-vs-offbeat weighting (against the genre's pattern).
- **Variation** → sampling temperature.
- **Canvas depth** → `velBias`, `durBias`.

## Out of scope here

Pitch / note determination (a separate style), the RhythmStyle generator, and
pass-2 smoothing (a later refinement).
