# Phrase as the shared sync unit (chart phrasing ↔ beat-pattern phrasing)

DEFERRED design, in discussion with Chris. The companion to
[rhythm-auto-generation.md](rhythm-auto-generation.md) (the Auto groove) and
[variations-and-repeats.md](variations-and-repeats.md) (compose-by-phrases) —
this note is about making those two notions of "phrase" line up instead of
fighting, which a real bug exposed (below).

## Two different things wearing one word

- **Chart phrasing** (`scene.harmony.phrases`) shapes the melodic LINE: where it
  breathes, rests, and anchors to grounded tones over the changes. It's a
  property of the HARMONY, and it reaches a voice through `nxtNote` (the ambient
  phrase state). It answers "how does the line shape itself over the chords?"
- **Beat-pattern phrasing** (the Auto generator's Beats/Phrase + Repeats) shapes
  the GROOVE: which beat points fire, their strength, ratchets, how the pattern
  repeats around the path. A per-curve rhythm property. It answers "when do I
  hit?"

They are orthogonal LAYERS — rhythm picks the onsets; chart phrasing articulates
the line that plays on them.

## The bug that motivates this

A curve (CRV4) in Auto rhythm mode whose callback is `nxtNote(styles.melody)` is
BOTH a generated groove and a melodic line. It inherited the chart breath
automatically (every `nxtNote` voice does, gated only by `breathe`), so notes
got clipped at chord-phrase ends that have nothing to do with the groove. The
event-trace showed durations 0.9 → 0.75 → 0.50 → 3e-10 (a near-silent click)
approaching a phrase end at base-cycle beat 75.5, exactly matching
`release = (phraseEnd − 0.5) − beat`. Because the auto-phrases are cadence-
length (28/16/32/16/32/4 beats) and the cursor cycles every 4 beats, the breaths
landed every 4–8 cursor cycles — "irregular pauses unrelated to the groove".

Two takeaways: (1) following the chart phrasing is currently automatic and
invisible; (2) the chart phrase boundaries and the groove boundaries DRIFT, so
the breath lands in musically arbitrary spots.

## The direction: make the phrase the shared boundary

Instead of the harmony running on its own beat loop and each groove on its own
cursor loop (so they drift), LOCK them together: one chart phrase's chord
changes play across one groove phrase, and when the groove phrase completes the
composition advances to the next chart phrase (looping the chart after the
last). Then the two phrasings stop being two things — they're the same
boundaries by construction:

- Chord changes apply sensibly to a groove-generated tune (the line plays the
  current phrase's changes).
- The chart's breath/anchor land exactly at groove-phrase ends — a musically
  right spot, and the drift-induced pauses can't happen.

Harmony lookup becomes PHRASE-RELATIVE: at groove progress p (0→1 through the
groove phrase), the chord is "this chart phrase's chord at p × phraseLength".
Everything downstream (`nxtNote`, breath, anchoring) follows for free.

## The commensurability constraint (Chris)

The danger is an ugly stretch: a 5-bar chart phrase warped onto an 11-bar groove
phrase is a 2.2× scale — chords slide off the bar lines and fly by at irrational
spots. So REQUIRE the two phrase lengths to be COMMENSURATE: equal, or one an
integer multiple of the other (and we lean toward power-of-two-friendly lengths,
as real phrases usually are 2/4/8 bars). Three clean cases, no ugly stretch:

- **1:1** — groove phrase length = chart phrase length (in bars). No stretch at
  all; chords sit on the groove's bar lines. The simplest and the default we'd
  aim for.
- **Groove = k × chart phrase** — the chart phrase's chords stretch by an
  INTEGER k (each chord lasts k× the bars, still landing on bar lines), or the
  chart phrase repeats k times.
- **Chart phrase = k × groove** — the groove repeats k times within the chart
  phrase.

Anything non-integer (5↔11) is disallowed rather than stretched.

The cleanest way to GUARANTEE commensurability is to derive one length from the
other rather than set them independently and hope: e.g. the groove phrase length
SNAPS to the current chart phrase's bar count (1:1), so the groove adapts its
generated length per phrase (a 4-bar phrase → a 4-bar groove, a 6-bar phrase → a
6-bar groove). That removes stretch entirely; the chart phrase structure becomes
the skeleton and the groove fills each phrase exactly.

## Open decisions

1. **Master/skeleton.** Chris's first framing was "groove is master, stretch the
   chords." With the commensurability constraint, the simplest is closer to
   "the chart phrase defines the bar count, the groove fills it 1:1" — the chart
   supplies structure + chords, the groove supplies rhythm + the clock. Decide
   which side owns the length (and whether it's authored or derived).
2. **What is "one groove phrase"** — the unit that maps to a chart phrase? The
   generated phrase (Beats/Phrase) is the natural candidate; Repeats then means
   "this chart phrase spans N groove phrases" (a clean integer multiple).
3. **Multiple grooves with different lengths.** The harmony is global but grooves
   are per-curve. Likely: the harmony owns a phrase clock; nominate one curve
   (the lead) as the clock source; others snap to the same phrase boundaries (or
   free-run). Their lengths must each be commensurate with the phrase.
4. **Per-voice opt-in to chart phrasing.** Following the chart phrasing should be
   a deliberate per-voice choice (one switch gating breath + gaps + anchoring),
   defaulting on for melodic roles (tune/lead), off for grooves/percussion. The
   current `breathe` flag folds into this. A pure groove then never inherits a
   breath it didn't ask for, even before the full sync lands.
5. **Terminology.** Rename the Auto "Beats/Phrase" to e.g. "Beats/Figure" /
   "Pattern Length" — it's the groove's repeat unit, not articulation phrasing.
   Reserve "phrase/phrasing" for the chart's melodic articulation. This removes
   most of the conceptual collision on its own.

## Done already / regardless of the above

- The degenerate near-zero note is fixed: a note trimmed below ~5 ms (the breath
  landing on a beat, or any degenerate trim) now RESTS instead of emitting an
  inaudible click (src/simulation.js, MIN_AUDIBLE_DURATION_SECONDS).
- Interim relief while we design: clear a score's `scene.harmony.phrases` to stop
  the breaths, or set a voice's style to a non-breathing one.

## Relationship to compose-by-phrases

This is [variations-and-repeats.md](variations-and-repeats.md)'s "compose by
phrases" maturing: a phrase becomes the top-level unit carrying chords (from the
chart) + groove (from the beat pattern) + a shared, commensurate length. The
chart supplies harmonic content per phrase; the groove supplies rhythm and the
clock; the commensurability rule binds them without warping.
