# Built-in harmony: chord-progression generators

The chord chart **structures the whole song and supplies its phrasing** — the
note-dynamics scorer reads its sections and cadences for phrase-importance and
arrival ([note-dynamics.md](note-dynamics.md)). Besides iReal Pro **import**, the
app ships a built-in library the user picks from, so a **harmonic context is
always present** even with nothing imported.

## Charts are generic and read-only

- **Generic, archetypal progressions** (12-bar blues, I–V–vi–IV, ii–V–I, the
  Andalusian cadence, …) — *not* transcriptions of copyrighted songs. Chord
  progressions aren't copyrightable; iReal Pro's *shared* charts are user
  transcriptions of real tunes and must not be bundled. We author our own.
- Authored in the **iReal Pro format**, so they import and **display natively** in
  the harmony view (key, meter, labelled sections, repeats).
- **Display-only** — GX2 cannot edit charts. So the generator's settings are the
  *entire* harmonic control surface: a **parametric editor** (adjust a setting →
  the chart re-derives), not a direct chord editor.

## Each genre is a GENERATOR, not a chart

One fixed chart per genre is stifling; a giant fixed library is unmaintainable.
Instead each genre is a **chart generator** — a **form template** + per-section
**menus** of genre-appropriate progressions + a **color** and **mood** control. A
few deterministic choices select a point in a large, *coherent* space (coherent
by construction — only good options go in the menus). Mirrors the dynamics model:
a genre is a space, a couple of dials pick the point.

### Deterministic — no randomness
The chart derives deterministically from its settings; same settings → same
chart. Variety comes from explicit choice, never a re-roll:
- **Per-section pickers** — Verse / Chorus / Bridge (etc.), each a short menu.
- **Harmonic color** (0..1) — triads → 7ths → 9ths/13ths → chromatic, by a fixed
  extension rule.
- **Mood / mode** — major ↔ minor (a parallel menu set).
- **Variant stepper** (optional) — a single `1..N` index walks the picker
  combinations in fixed order; quick exploration, still deterministic (Variant 73
  is always Variant 73).

### Audition loop — choose by ear
A **"Play chords"** button comps the whole chart through a default voice
(piano/pad), **fast and looping**, via the existing `HarmonyPlayer`, independent
of any canvas objects. Adjust a setting → hear it within a beat → adjust again →
settle. Useful for *any* loaded chart, imported or generated.

### Output
A normal **read-only iReal chart** in the harmony view. To change it, change a
setting and re-derive — there is no hand-edit (no chart editor). So the menus must
be rich: I author them **generously**, and they're **expandable** — a reachability
gap is fixed by adding an option to a section menu, widening the space for
everyone, deterministically.

## Form & length

**Single-pass** form (one trip through the structure); the user sets a **repeat
count** to fill the song. Most genres are full **song-forms** (their sections
give the phrasing); a few simple **4-bar loops** exist for deliberately minimal
music.

Harmony and dynamics-genre are **separate axes** — any dynamics feel can sit over
any progression (a funk feel over a blues form).

## The library

**Full song-form generators**
- Pop (verse–chorus), Ballad, 12-Bar Blues, Jazz Standard (AABA), Rhythm Changes,
  Jazz Blues, Bossa Nova, Funk (vamp–bridge–vamp), EDM/Dance (intro–build–drop…),
  Lo-Fi/Hip-Hop (loop + verse/hook), Cinematic/Ambient (slow evolving form).

**Simple loops** (minimal music)
- Pop Axis (I–V–vi–IV), Doo-Wop (I–vi–IV–V), Three-Chord (I–IV–V), Trap Minor
  (i–VI–VII), Modal Vamp, Drone (I↔bVII).

Ship a tight set first (~Pop, Ballad, 12-Bar Blues, Jazz AABA, EDM, Lo-Fi + the
loops); the rest are easy adds.

## Worked example — the Pop generator

**Form** (single pass): `Intro 4 · Verse 8 · Chorus 8 · Verse 8 · Chorus 8 ·
Bridge 8 · Chorus 8 · Outro 4`. Pickers on **Verse / Chorus / Bridge**;
Intro/Outro derive from the chosen Chorus loop; an optional **Pre-chorus 4**
toggle adds a lift. Key shown as C major / A minor; transposable.

**Verse** (the 4-bar loop ×2)
| | Roman | C major |
|---|---|---|
| V1 | vi IV I V | Am F C G |
| V2 | I V vi IV | C G Am F |
| V3 | I vi IV V | C Am F G |
| V4 | vi iii IV V | Am Em F G |
| V5 | I iii vi IV | C Em Am F |

**Chorus**
| | Roman | C major |
|---|---|---|
| C1 | I V vi IV | C G Am F |
| C2 | IV I V vi | F C G Am |
| C3 | I IV V IV | C F G F |
| C4 | vi IV I V | Am F C G |
| C5 | I V IV I | C G F C |

**Bridge**
| | Roman | C major |
|---|---|---|
| B1 | IV V vi iii | F G Am Em |
| B2 | vi iii IV V | Am Em F G |
| B3 | ii V vi IV | Dm G Am F |
| B4 | IV V I I | F G C C |
| B5 | vi V IV III7 | Am G F E7 |

→ 5 × 5 × 5 = **125 skeletons** before color/mood.

**Color** (0..1), deterministic extension rule:
- `.0` triads — `C F Am G`
- `.33` 7ths on I/IV/vi/ii — `Cmaj7 Fmaj7 Am7 Dm7`, V stays `G`
- `.66` + add9 on I/IV, sus on V — `Cadd9 Fadd9 Am7 Gsus4`
- `1.0` + one secondary-dominant / bVII passing chord at a turnaround (`E7→Am`,
  or a `Bb` modal tint)

**Mood / mode:** Major (above) ↔ Minor (the A-minor "sad-pop" menu set: i–VI–III–VII
`Am F C G`, i–VII–VI `Am G F`, …).

**Variant stepper:** `1..125` walks (Verse × Chorus × Bridge).

**Worked instance** — *Verse V1, Chorus C1, Bridge B1, Color .33, Major*:
```
Intro   | Cmaj7 | G | Am7 | Fmaj7 |
Verse   | Am7 | Fmaj7 | Cmaj7 | G | Am7 | Fmaj7 | Cmaj7 | G |
Chorus  | Cmaj7 | G | Am7 | Fmaj7 | Cmaj7 | G | Am7 | Fmaj7 |
Verse   | (repeat) |
Chorus  | (repeat) |
Bridge  | Fmaj7 | G | Am7 | Em7 | Fmaj7 | G | Am7 | Em7 |
Chorus  | (repeat) |
Outro   | Cmaj7 | G | Am7 | Fmaj7 |
```
Change Chorus to C2 → re-derives instantly; nudge Color to .66 → every chord
thickens. The other genres are templated the same way (form + section menus +
color + mood).

## Sourcing the fragments — mine the imports, augment with theory

The fragment library is **mined from the iReal-imported chart library** (already
tagged by style, with section markers), then cleaned and filled by music theory —
not hand-invented. Precedent: Hooktheory built its progression database the same
way.

Decomposition pipeline (a tool we build):
1. Parse the tagged charts into their Roman form (which GX2 already stores).
2. Segment each into fragments — by section marker, phrase, 4-bar loop, or short cell.
3. Normalise to mode-relative Roman so transposition collapses (all keys fold).
4. Aggregate per `(style, role)` — count occurrences, **keep the recurring, drop the rare**.
5. Tag — style from the chart, role inferred from section structure/position (+ judgment).
6. Augmentation pass — clean, dedupe, fill coverage gaps, add idiomatic variants.

### Copyright
**Chord progressions are not copyrightable** (functional building blocks); the
protectable parts of a song are the **melody, lyrics, and recording**. We:
- never touch the melody (GX2 generates pitch from canvas + harmony),
- **recompose** fragments into NEW charts (the output reproduces no song),
- drop **titles** (not copyrightable, but trademark/association makes "no song
  names" the right call).

So the imported library is a **private analysis input**; the *shipped* library is
generic fragments recombined — clean by construction. Filtering for *common*
fragments is therefore a **quality** choice (idiomatic, recombinable bricks), no
longer a legal one. (Not legal advice; this is the mainstream view corpus tools
rely on.)

## Implementation plan

A **vertical slice**: build the whole pipeline for **one genre (Pop)**
end-to-end, then expand (mostly data). Lean on the existing harmony stack — import,
Roman storage (`SceneHarmony`), the chart display, and `HarmonyPlayer` — so the
generator only has to **emit the same `SceneHarmony` format**; everything
downstream comes free.

- **Phase 0 — contracts.** Study the stored harmony format (now for *both* reading
  imports to decompose *and* writing generated charts). Lock the fragment schema,
  the form-template schema, the `generate(genre, mood, color, variation)` signature,
  and the tab layout (`Genre · Mood · Color · Variation · ▶Play`).
- **Phase 1 — Pop slice.** Build the decomposition tool → mine the Pop charts →
  augmentation pass → Pop fragment DB. Implement the generator as a pure, unit-
  tested function. Wire generate → `SceneHarmony` → verify it **displays** via the
  existing renderer. Add the **audition** loop (`HarmonyPlayer`, fast + looping).
  Add the **tab controls**. Audition-tune the Pop pool.
- **Phase 2 — expand.** Each new genre = its fragment pool + form template (+ any
  genre color/mood rule), then audition-tune. Generator and UI already done.

### Build order / status
The harmony tab + generator is **designed, not yet built** — it is deferred behind
the **note-dynamics and melody-determination styles**, which are built first. To
develop those without the generator, a small set of hand-authored simple
progressions lives at **`src/samples/testProgressions.js`** (generic 4 / 8 /
12-bar `SceneHarmony` objects — Pop Axis, Doo-Wop, blues, minor axis, ii–V–I, …),
verified to load through `sanitiseSceneHarmony`. They are *test scaffolding*, not
the real library.

## Out of scope

A direct iReal **chart editor** (the generator covers the need parametrically),
and the chord *voicing*/comping detail of the audition voice (a default is fine).
