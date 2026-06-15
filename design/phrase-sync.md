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

## Settled (Q&A with Chris)

- **Beat pattern drives, not the chart.** The groove is the master clock; the
  chart is OPTIONAL (no chart → the groove just plays). This is cleaner than
  "chart defines the skeleton" because the user may not care about changes.
- **One "beat-pattern phrase" = one generated pattern** (the Beats/Phrase unit),
  even when Repeats lays several copies around the object. So Repeats = N means N
  phrase-slots per path sweep, each mapping to one chart phrase 1:1 (and each
  slot can carry its own colour-driven groove + its own chord phrase — the
  compose-by-phrases picture).
- **Stretch, never drop.** A chart phrase is time-scaled to fit its beat-pattern
  phrase; no chords lost. Lengths are usually integer multiples so the stretch
  lands on bar lines; the awkward case (a short groove phrase, < 4 bars, vs a
  longer chart phrase) gets reasonable-results rules TBD. We may enforce
  nice (multiple-of-4-ish) lengths on the beat-pattern side.
- **Master object** = any one beat-pattern object (curve OR sprite — sprites have
  patterns too). Mutually exclusive (designating one clears the previous), opt-in
  (none by default). Other voices read whatever chord the master is on (one
  shared harmony clock, many independent grooves).
- **Chart phrases** = the existing `scene.harmony.phrases`; chords laid out
  proportionally inside each. The auto-phraser (`autoPhrase`) should be TWEAKED
  to avoid extremes — merge a sub-minimum remainder (no 1-bar tail), and keep a
  tighter band (no 8-bar monsters) — which also keeps the stretch ratios sane.
- **Breath set aside** (see below) until we know we need it.

## Still open

1. **Multiple grooves with different lengths.** Confirmed one master drives the
   chord clock; the open part is whether non-master objects snap to the master's
   phrase boundaries or free-run (default: free-run, just reading the chords).
2. **The stretch edge case** — a short groove phrase vs a longer chart phrase
   (extreme compression). Reasonable-results rules to design.
3. **Terminology.** Rename the Auto "Beats/Phrase" to e.g. "Beats/Figure" /
   "Pattern Length" — it's the groove's repeat unit, not articulation phrasing.

## Done already / regardless of the above

- The auto-breath is SET ASIDE — disabled behind `BREATH_ENABLED = false` in
  src/harmonyPhrasing.js (`phraseStateAt` produces no release-cap). Drawn-gap
  rests and start/end anchoring still apply; only the note-clipping breath is
  off. The mechanism (the release computation and nxtNote's handling) is intact,
  so flipping the flag restores it. Revisit once the sync lands and we can see
  whether a breath landing cleanly on groove boundaries is wanted.
- The degenerate near-zero note is fixed regardless: a note trimmed below ~5 ms
  now RESTS instead of emitting an inaudible click (src/simulation.js,
  MIN_AUDIBLE_DURATION_SECONDS).

## Build status

Staged: (1) master designation + autoPhrase tweak; (2) harmony-slaving +
proportional stretch; (3) UI polish.

- **(1) DONE.** `scene.masterObjectId` (a top-level nullable string; scene.js,
  sceneLoader.js, sceneSchema.js) names the master object. One value, so it is
  naturally mutually exclusive — designating a new one replaces the old. Set via
  `setSceneMasterObjectId` (sceneEditor.js, validates the id exists / clears a
  dangling one). UI: a **"Master" entry in the Harmony chart's hamburger menu**
  (alongside Chords / Key / Unwind), a flyout listing "None" + every candidate
  object — chosen at Chris's suggestion over per-object toggles, since one
  dropdown where the chords live reads clearer. Candidates = objects with a beat
  pattern (`beatPointsMode !== "none"`), built in main.js (`buildMasterCandidates`)
  and pushed via `harmonyPanel.setMasterContext`; the pick dispatches through
  `applySceneEdit`. NO behaviour yet — the field is stored and surfaced; the
  slaving is stage 2. `autoPhrase` also TWEAKED: a sub-minimum tail phrase now
  folds into a neighbour (no 1-bar remainders), keeping lengths in a sane band.
- **(2) next** — harmony lookup becomes phrase-relative off the master's groove
  progress; chart phrases stretch to fit. Nothing reads `masterObjectId` until
  this lands.

## Relationship to compose-by-phrases

This is [variations-and-repeats.md](variations-and-repeats.md)'s "compose by
phrases" maturing: a phrase becomes the top-level unit carrying chords (from the
chart) + groove (from the beat pattern) + a shared, commensurate length. The
chart supplies harmonic content per phrase; the groove supplies rhythm and the
clock; the commensurability rule binds them without warping.
