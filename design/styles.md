# Styles: Note styles and Rhythm styles

A **style** is a named, reusable, app-level musical behaviour. There are **two
kinds**, split along the axis of *response vs generation*:

- **`NoteStyle`** — the per-note RESPONSE: *what each note is* (pitch / velocity /
  sustain). Computed inside `nxtNote`, active in **every** beat mode.
- **`RhythmStyle`** — the per-phrase GENERATOR: *which beats fall and the rhythmic
  shape*. Holds the rhythm-generation controls (Density, Syncopation, Dynamic
  Range, Fills, Ratchets). Active
  in **Auto** beat mode only. Generation mechanics live in
  [rhythm-auto-generation.md](rhythm-auto-generation.md).

Class names are full words — no `m/r/v/g` letter prefixes.

## Why this is the split (Voice vs Rhythm, not melodic vs rhythmic)

Two axes are easy to tangle under "rhythm":
- *Does the voice have pitch?* melodic vs percussion — just a **flag**.
- *Does it respond or generate?* per-note vs per-phrase — the **real** boundary.

A percussion voice playing a hand-typed Manual pattern uses no generator, and a
melodic voice can use the Auto generator — so "percussion" and "rhythm
generation" are independent. NoteStyle and RhythmStyle are therefore separate
classes with separate libraries, and **the rhythm core lives only in
RhythmStyle**. Melodic vs percussion is a flag on NoteStyle, not a class.

## NoteStyle — the per-note voice

Pitch behaviour (scale / range / chordLock / smoothness / …), the per-note drivers
**pitch / velocity / sustain** (each a fixed value, a colour channel, or a
formula), and **phrasing** (Phrase End Breath / `breathe`) — phrasing is always-on,
so it lives here rather than in the Auto-only Rhythm style. Melodic = pitch on; percussion
= pitch off (the sound always comes from the object's voice, never the style).
**No rhythm core, and no role** — role is an object property, not a style field
(see "Choosing a style on an object").

`nxtNote` takes **no image argument** — the style's drivers already say which
channel feeds each axis (pitch ← `lt`, …), and it reads the ambient colour / beat
strength / phrase itself:
- `nxtNote()` → plays the object's assigned **`this.noteStyle`** (the no-code path)
- `nxtNote(styles.lead)` → override with a named library style
- a custom pitch drive = a **formula** driver on the style; the legacy
  `nxtNote(drive, style)` number-first form is superseded.

## RhythmStyle — the rhythm generator

Authored in the Styles-tab editor (one **Rhythm** band, no sub-title — the whole
band is the rhythm). Generation mechanics in
[rhythm-auto-generation.md](rhythm-auto-generation.md). The controls:

- **Density** + **Syncopation** — which beats play. They set the onset template;
  **Image Influence on Timing** (a None ◀▶ Strong slider + a colour channel) sets
  how much, and via which channel, the image bends those onsets.
- **Dynamic Range** — the beat-strength spread (flat ↔ wide). A **structural**
  knob, NOT image-driven; it becomes the **Velocity band's "A"** input, so the
  image reaches loudness only once, via the Velocity band's B (canvas). For a
  percussion voice (no Velocity band) it is the rhythm's only dynamics control.
- **Fills** — **Frequency** (how often, phrase-level) + **Intensity** (how big: a
  density surge with faster subdivision and a dynamic push into the downbeat).
- **Ratchets** — **Frequency** (how often a hit becomes a buzz/roll) + **Intensity**
  (how big the burst — sub-hit count / density).

A Frequency is a probability; it becomes concrete placements via a deterministic
0–1 **die per slot**. Onsets draw on the image (the chosen colour channel);
fills/ratchets draw on a **seed hash** — `hash(styleSalt, firstBeatColourOfRepeat,
slotIndex)` — seeded by the colour under each repeat's first beat, so each repeat
(at a different path position) varies, deterministically and reproducibly, with no
temporal state. `styleSalt` distinguishes styles and doubles as a **Variation**
re-roll. Any output's die is swappable (colour channel ⇄ seed hash), so
image-driving fills/ratchets later is just a die swap.

### Percussion: kit + lanes

A drum pattern is several instruments (kick, snare, hat) that must interlock, so
ONE RhythmStyle owns them: a list of **lanes** generated together on a shared
grid/phrase so they lock by construction. Shared (style-level): grid, phrase
shaping. Per-lane: the drum sound + its own Density / Syncopation / Dynamic Range
/ Fills / Ratchets. **Open:** exactly how a multi-lane RhythmStyle, the kit, and NoteStyle
compose for a drum object (sounds vs pattern) is not yet settled.

## Choosing a style on an object (inspector)

Each style is picked in the inspector band that **consumes** it:

- **Note Style** → a picker in the **Behaviour Functions** band (its consumer is
  the `onActiveBeat` callback → `nxtNote`). Sets the object property `this.noteStyle`.
- **Voice Role** → a second dropdown in the same band, beside Note Style: the
  voice's ensemble function (Foundation / Pulse / Accent / Lead / Pad / Fill /
  Counter / …). It is **not** a style field — the same voice can play different
  roles — but an object property `this.role`, which `nxtNote` reads to coordinate
  through the master object.
- **Rhythm Style** → a picker in the **Rhythm** band, shown only when the beat
  source is **Auto** (hidden for Manual / Euclidean).

`this.noteStyle` and `this.role` are **object** properties: they apply wherever
`nxtNote` is called (including hasCollided / beenTriggered), and are merely
surfaced on the `onActiveBeat` slot. The Auto/Rhythm controls are gated on an
`onActiveBeat` callback existing; an object using only hasCollided / beenTriggered
has them disabled. What role and the rhythm fields mean for those off-grid events
is the same unsettled question.

## The Styles tab

Where styles are **authored** (the inspector only *picks* a named one). Top to
bottom: a **kind selector (Note / Rhythm)** — which replaces the old melodic/
rhythmic Type and swaps the library + editor — a name chooser for that kind
(dropdown + New / Duplicate / Delete), then the editor:

- **Note style:** a melodic/percussion flag (off collapses the Pitch band), then
  Pitch (melodic only) · Velocity · Sustain · phrasing.
- **Rhythm style:** the Rhythm band (Density / Syncopation / Dynamic Range /
  Fills / Ratchets) + (for percussion) lanes.

**Knob controls:** 0..1 knobs render as a slider + an adjacent editable number
(slider for feedback, number for exact entry), kept in sync; a too-tight row falls
back to the number alone.

## Editing model — a sandbox, two modes

Editing always happens in a sandbox (a working copy), never on the stored record:

- **Library editing (Styles tab):** applies nowhere live; reaches the library only
  on explicit **Save** (same name → "Replace?"; new name → new style). Built-ins
  are never overwritten — saving an edited built-in writes a user style.
- **Live editing (from a callback):** the sandbox applies IMMEDIATELY to that
  object's generation, so you hear changes as you dial; **Save as new style**
  promotes them. Per-score object overrides hold unsaved tweaks.

A diverged sandbox marks its name with a trailing `*` until Saved or reverted.

## Entry points & the live/library chooser

Live editing (tune by ear while it plays) is the dominant workflow:

1. **Styles-tab chooser** — surfaces **in-use styles at the top**, one per playing
   object, labelled `styleName (objectID)` (e.g. `bass (CRV5)`). Selecting one is
   LIVE editing of that object's style; below sit the Built-in and Custom library
   entries (library editing). Filtered by the current Note / Rhythm kind.
2. **Script tab** — right-click a style reference → **"Edit Style"** jumps to the
   tab with it loaded.

Style names must be valid JS identifiers (so `styles.theName` autocompletes; refs
are dot-access, never quoted). The library feeds both the runtime `styles`
namespace and the Script-tab autocomplete.

## App-wide library + persistence

Styles are app-wide, like the image gallery — define once, use across scores. A
store module mirrors `gallery.js` (list/get/save/remove + a synchronous in-memory
cache the engine reads per-note). Web: an IndexedDB store. Electron: a `styles`
array in settings.json via a preload bridge. The store is **type-aware** — it holds
the Note-style and Rhythm-style libraries separately. Built-ins are code-level
fallback templates; resolution reads the cache, then the built-ins.

## Open questions

- How NoteStyle + kit + a multi-lane RhythmStyle compose for percussion.
- Whether `density` is a true target dial or emergent per-slot probability.
- What a RhythmStyle's fields mean off-grid (hasCollided / beenTriggered).
- The tonal multi-lane (ensemble) generalisation — bass + comp from one object.

## Build status

- **NoteStyle data model** — built (currently class `MStyle` in `src/mStyle.js`;
  rename to `NoteStyle` pending), with the pitch/velocity/sustain drivers and JSON
  serialize/materialize. The rhythm core embedded here **moves to RhythmStyle**.
- **Next:** the app-wide type-aware store + name resolution; the Styles tab (Note
  side first); then the Auto-rhythm engine (RhythmStyle generator, image-as-dice,
  per-repeat regen, onActiveBeat-sourced); then percussion (kit + lanes).
