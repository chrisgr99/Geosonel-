# GXW TODO

Forward-looking work items for GXW. Organised by tier so
the natural reading order is the working order; items
within each tier sit in rough dependency order. References
to "section 27" and "section 28" mean
design/sections/section-27-strudel-pattern-language.md and
design/sections/section-28-pattern-authoring-and-cursor-model.md
respectively.

What's done already (Tier 1 foundations, Stage A of Tier 3,
the inspector bands 1-3, bidirectional navigation, the Code
tab rename, the cleanup of pre-section-27 dead code, the
integer-id naming refactor) lives in git log and in the
state file's "Where we are" prose; not repeated here.

## Currently in flight

Nothing.

## Tier 2: pattern evaluation primitive

Section 27 has the architecture and the resolved design
questions (the four "Resolved" items in its
Pre-implementation design tasks subsection). The audio
firing path decision is also resolved: full strudel-driven
path, implemented in phases. See section 27's "Audio
firing path: full strudel, phased rollout" subsection for
the reasoning.

Implementation proceeds in four phases so each step is
testable before the next builds on it.

Phase 1 — first sound. The minimum to fire a deterministic
pattern through superdough on a curve cursor sweep:
pattern primitive function, per-source cycle counter,
audio commit window, mute/solo gating, continuous firing
path. Static signals (sine, saw, square, tri, perlin) work
for free at this stage because they're pure functions of
cycle position.

Phase 2 — edit-time polish. Cancellation of pre-scheduled
events on pattern change, continue-on-edit cycle counter
semantics, concurrent firings tested with multiple sources.

Phase 3 — dynamic-signal substrate (plumbing only, no new
signals). Firing-context pointer in try-finally, two-pass
evaluation, per-tick state snapshot. Nothing observable
changes; the infrastructure regression surface is decoupled
from the new-signal behaviour.

Phase 4 — first dynamic signals. spriteV first (the
simulation already has velocity data), then spriteX and
spriteY, then the image-reading signals (imageLightness,
imageColor, imageColorAt). Phase 4 overlaps with what Tier
4 originally captured; that overlap is intentional now that
the plumbing dynamic signals consume lives in Tier 2.

The natural stop-and-back-out point is between Phase 2 and
Phase 3. If Phase 1 and 2 land but dynamic-signal
integration turns out intractable, the system is left in a
working hybrid state — full deterministic and static-signal
patterns work, dynamic signals don't — while the issue is
worked out.

Concrete deliverables across the phases:

- The pattern primitive function itself: takes a parsed
  Pattern, a cycle range, a wall-clock window, and a firing
  source identifier; produces scheduled superdough events.
- Pattern parse caching at edit-commit time; re-parse on
  user edit.
- Firing-context pointer mechanics: module-level pointer
  set inside a try-finally block so any exception during
  query doesn't strand the pointer.
- Two-pass evaluation: Pass 1 establishes event times from
  the pattern's structure at cycle start; Pass 2 re-queries
  a tiny window at near-play time to refresh value fields.
  Pass 1 wins on structure; Pass 2 only updates values.
- Audio commit window machinery. Per-tick rolling forward
  window (default 100ms) commits events whose audio play
  time falls within the window to superdough's absolute
  scheduling. Anything beyond the window stays on the
  per-source pending list until a later tick reaches it.
  Window size exposed as a configurable value for
  per-environment tuning.
- Cancellation of pre-scheduled events when a pattern
  changes mid-cycle. Provisional decision (section 27): always
  cancel; revisit once a working integration exists.
- Per-source cycle counter management. Provisional decision
  (section 27): continue-on-edit; an explicit reset
  inspector control covers the rare deliberate-restart case.
- Mute and solo gating in the primitive. The pattern
  evaluation layer respects mute and solo by skipping
  queryArc entirely when a source is silenced.
- Continuous firing path: cycle-wrap-triggered invocation
  on curves whose cursor loops, free sprites with cycle
  bindings, and so on. Sequential cycle counters advance
  cross-cycle modifiers naturally.
- Static signals working end-to-end (sine, saw, square,
  tri, perlin work because they're pure functions of cycle
  position; nothing dynamic-signal-specific needs to be in
  place for these).
- Concurrent firings: confirm per-source cycle counter
  management behaves cleanly when multiple sources fire
  patterns at the same simulation tick.

## Tier 3 deferred polish

Stage A (the pattern-authoring surface) is complete.
Remaining Tier 3 polish items, none blocking Tier 2:

- Toolbar buildout: extend the canvas toolbar with the
  ability to create triggers and curves (currently sprites
  only), plus the rest of the GeoSonix-style tool palette
  for score authoring.
- Initial velocity inspector field for Band 2 (sprite vx
  and vy have no editing surface yet).
- Sprite cursorL and cursorR schema, plus matching
  inspector fields. Currently sprites have no per-object
  cursor-extent fields; cursor-as-collider treats sprites
  with a single point. Edge cases to settle as part of this
  work: stationary sprites' default direction (spec'd as
  horizontal), and the cursor's behaviour during a brief
  pause at the apex of a parabolic trajectory (presumably
  stays in last direction).
- Marker rendering for curves: visible glyphs at active
  beat points.
- Cursor visibility gating tied to extent fields and mute.
  A cursor with zero extent or a muted source shouldn't
  render.
- Greying of cursor extent fields when mute is checked
  (companion to the gating above; visual cue that the
  fields have no effect while muted).
- validateFunctionName for the callback-slot function-name
  fields. Currently the fields accept any text; a soft
  warning for invalid JS identifiers would catch typos
  before they reach behaviors.js.
- Live parse validation for labelled pattern blocks in the
  Code tab. Cmd-Enter promote already parses and reports;
  the labelled-block-aware linter would surface parse
  errors as squiggles as the user types.
- Edit-time pattern preview: a "play this pattern once"
  affordance on labelled blocks. One-shot invocation of the
  Tier 2 primitive with a small flourish window. Inherits
  the user-gesture-for-AudioContext requirement, so a first
  preview also serves as the engine-load gesture.
- Mini-notation autocomplete in pattern editing surfaces:
  sample names from loaded banks, modifier names, signal
  names.

## Tier 4: dynamic signals

Section 27's SignalRegistry plus firing-context plumbing
plus the first signals. The firing-context plumbing
overlaps with Tier 2 — implementing it there is fine; this
tier adds the signals themselves.

- SignalRegistry: shared registry mapping signal name to
  query function. Signals consult the firing-context
  pointer to learn which source's state to read.
- spriteV (sprite velocity magnitude): natural first
  signal since the simulation already has the data.
- spriteX, spriteY: position signals.
- imageLightness, imageColor, imageColorAt: pixel readings
  under the firing source.
- currentScale and the tonal-context signals (defer until
  a tonal integration decision lands; see ongoing items).
- Per-tick state snapshot mechanism so Pass 2 readings
  reflect simulation state at near-play time rather than
  cycle-start time.

## Score-level harmony and tonal context

Scene-level harmony definition that objects inherit, taking
the GeoSonix harmony model and extending it with strudel's
@strudel/tonal module. Substantial enough to deserve its
own section between Tier 4 and Tier 5: it carries scene-
level schema, inspector fields, and pattern-modifier
integration together.

- Scene-level harmony schema fields in scene.json (scale,
  key, possibly chord progression).
- Object-level inheritance mechanism: per-object override
  available, default inherits from scene.
- Inspector fields for the scene-level harmony in the
  Properties tab; per-object override surface where
  relevant.
- @strudel/tonal modifier integration in patterns so a
  pattern can reference the inherited harmonic context.
- currentScale and related signals exposing the active
  scale to dynamic-signal-driven patterns (overlaps with
  Tier 4 signal work; can be implemented there if
  convenient).
- Voicing, transpose, and chord-progression support per
  the @strudel/tonal vocabulary plus the GeoSonix model.

## Tier 5: one-shot firing

Trigger collisions and sprite-hit events through the same
primitive, plus the surrounding collision detection
machinery.

- Cursor-vs-trigger collision detection (cursor line
  segment vs trigger point).
- Cursor-vs-curve and cursor-vs-sprite collision detection.
  Sprite-vs-sprite collision explicitly deferred.
- Trigger-collision firing path: one-shot invocation of
  the primitive with cycle counter zero and a user-chosen
  flourish duration.
- Sprite-hit-event firing path.
- Flourish duration field on relevant sources (default one
  beat at master BPM, override available per-source).
- Inspector surface for the flourish-duration field.
- ctx population for marker-collision-driven beenHit. Hap
  payload from the firing pattern flows into ctx; precise
  mechanism settles here.
- Soft warning in the editor for context-inappropriate
  modifiers: cross-cycle modifiers (.slow, .late, .early,
  alternation across firings) used on one-shot sources.
  Yellow squiggle matching the soft-error pattern; doesn't
  hard-reject.

## Tier 6: visualisation and polish

Mostly absorbed into earlier tiers via marker rendering;
Tier 6 is what's left.

- Pre-firing glyphs for deterministic patterns: visible
  markers showing where events will fire within an
  upcoming cycle.
- After-the-fact breadcrumbs for patterns whose positions
  don't render well as static markers (stochastic,
  dynamic-signal-driven).
- Cursor-trail effects (optional polish).
- Resolution of section 27's deferred design questions as
  they surface in practice: provisional decisions on
  pre-scheduled cancellation and cycle-counter-on-edit get
  revisited here with real audio to listen to.

## Ongoing or future considerations

Items that don't sit in a single tier but are worth
tracking:

- Pass through DESIGN.md sections 1-26 identifying parts
  that fit naturally under the section 27/28 framing and
  parts that need revision. Deferred indefinitely as a big
  pass; instead, picked up section by section when adjacent
  work surfaces a stale piece worth fixing.
- Per-source flourish duration default shape: scene-level,
  per-kind, or per-source. Real use during Tier 5 will tell
  us which feels right.
- Mute and solo carryover from GXSTR: GXSTR has Solo
  Selected as runtime-only and per-source mute as persisted.
  Both should carry to GXW.
- Strudel version sync. Ongoing maintenance concern;
  GXW pins to a specific @strudel/web version (matching
  GXSTR's). Track strudel releases that affect the
  promoted modifier vocabulary.
- Original GXW project's TODO.md: doesn't exist on disk;
  this file replaces it.

## Authoring helpers and utility libraries

Utility code that supports score authoring in
behaviors.js. Not tier-aligned; pick up whenever appetite
arises.

- MIDI note helpers for Web MIDI output: functions that
  construct MIDI events (note on, note off, controllers,
  channel routing) for use from behaviors.js, providing a
  parallel MIDI output channel alongside the strudel audio
  path.
- JavaScript helper library for the declarative features
  GeoSonix offered, ported and adapted for GXW. Specific
  targets for porting determined by which GeoSonix
  utilities prove useful in practice during GXW score
  authoring.

## Toward project completion (later stages, general)

These describe what "finished" looks like for GXW. Items
here are intentionally general; they sharpen as earlier
tiers land.

- Performance pass: profiling and optimisation for scenes
  with many sources, large cycle counts, dense patterns.
- Accessibility pass: keyboard navigation through the
  inspector and the canvas, screen-reader audit, contrast
  review. The author's own accessibility needs (zoom,
  Speak Selection, dictation) drive a lot of this in
  practice but a deliberate pass at the end is worth doing.
- Cross-browser check: Chrome is the primary target; verify
  Firefox and Safari behaviour at least for the core flows
  (load score, run scene, edit pattern, hear audio).
- Example scores: a curated set of small scores
  demonstrating common idioms — a single cycling curve,
  a trigger-collision rhythm, a dynamic-signal-driven
  melody. Doubles as documentation and as a smoke-test
  suite.
- README and user guide: how to install (or open the URL),
  how to author a score, how the cursor-as-collider model
  works, how patterns and slots fit together.
- Score-sharing mechanism: export to disk (already exists
  via the disk mirror), import a shared score, possibly a
  URL-shareable format.
- License audit: confirm @strudel/web licence compatibility
  and surface attribution where needed.
- Final design pass through DESIGN.md once everything is
  implemented, with the implemented-versus-designed gap
  reconciled.
