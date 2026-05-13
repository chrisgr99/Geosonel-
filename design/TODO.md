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

MIDI output integration is landed. Phase 3 is the next
concrete action. The order:

Phase 1 — first sound. Landed.

Phase 2 — edit-time polish. Landed. Cycle-boundary takeover,
position-zero downbeat reliability via one-cycle-ahead
scheduling, editor undo/redo across Cmd-Enter promote.

MIDI output integration. Landed. Routes GXW pattern firing
through Web MIDI as the default output, replacing strudel's
built-in samples for real-time external synth playback.
See section 27's One-cycle-ahead scheduling and dynamic-
signal late-refresh subsection for how it interacts with
the Phase 3 dynamic-signal substrate. The "MIDI output
integration" subsection below remains for follow-up items.

Phase 3 — dynamic-signal substrate (plumbing only, no new
signals). Firing-context pointer in try-finally, two-pass
evaluation reconciled with the Phase 2 one-cycle-ahead
scheduling via late-refresh dispatch (events are populated
at cycle start for timing accuracy, but value fields
refresh just before each event's audioTime so dynamic
signals read simulation state at audible-near-play time),
per-tick state snapshot. See section 27's One-cycle-ahead
scheduling and dynamic-signal late-refresh subsection for
the detailed design. Nothing observable changes at Phase
3; the infrastructure regression surface is decoupled
from the new-signal behaviour.

Phase 4 — first dynamic signals. Image-colour signals first
because sprite kinematic signals have no varying state to
read until image-driven physics lands. imageLightness as
the first end-to-end signal exercising the full pixel-
lookup and OKLCh-conversion pipeline; the rest of the
OKLCh set (imageChroma, imageLum, imageRedness,
imageGreenness, imageYellowness, imageBlueness) following
in close succession since they share the conversion.
Sprite kinematic signals (spriteX, spriteY, spriteV) as a
separate later step. Phase 4 overlaps with what Tier 4
originally captured; that overlap is intentional now that
the plumbing dynamic signals consume lives in Tier 2. See
section 27 for the OKLCh rationale and the deferred items
(distance-derivatives, EMA smoothing, composer-defined
defineSignal).

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
  changes mid-cycle. Resolved by Phase 2's shipped
  behaviour to no-cancellation: pattern edits preserve
  pending events so the old pattern's current cycle plays
  through cleanly to the next cycle wrap; superdough
  cancellation primitives stay unused for this Tier 2
  pattern-edit case. (Tier 5 one-shot work may still need
  cancellation machinery for trigger-deletion edge cases.)
- Per-source cycle counter management. Confirmed by
  Phase 2 to continue-on-edit: cycle counter preserved
  across pattern recompile, alternation continues across
  edits at the next cycle index. An explicit reset
  inspector control covers the rare deliberate-restart
  case (TODO).
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

## MIDI output integration follow-ups

The initial MIDI output integration is landed (see section
27 for the architecture and the state file for what
shipped). Remaining follow-up work:

First-cut scope, landed:

- Web MIDI initialisation in MIDISender class.
- Audio-to-MIDI time conversion.
- send(value, audioTime, duration) producing noteOn /
  noteOff with note from value.note, velocity from
  value.gain (default 64), channel from value.midichan
  (default 1), duration multiplied by value.clip.
- Firing engine routes through midiSender.send instead
  of runtime.play; the superdough path is dormant but the
  module remains in place.
- IAC bus preference with first-output fallback.
- Transport bar MIDI indicator with port name and per-
  send flash.

Follow-ups, separate sessions:

- Port selection UI. Dropdown in the inspector top bar
  or a small menu in the Run menu, populated from
  MIDIAccess.outputs. Persisted per-bundle so a score's
  MIDI routing is part of its scene state.
- Per-source output routing. Each curve or sprite
  selects audio (superdough), MIDI, or both. Without
  this, all sources go to the global default output.
- Per-pattern routing via the strudel .midi() modifier.
  Patterns with .midi() force MIDI regardless of
  per-source default.
- Polyphony tracking. When the same note number on the
  same channel retriggers before its first noteOff fires,
  decide whether to insert an explicit noteOff first
  (cleaner) or rely on the receiving synth's voice
  handling (simpler but synth-dependent).
- Audio output preservation. Once MIDI is default, the
  superdough path may still be useful for monitoring or
  for sources that explicitly want audio. Keep both
  paths alive.

## Tier 3 deferred polish

Stage A (the pattern-authoring surface) is complete.
Remaining Tier 3 polish items, none blocking Tier 2:

- Cmd-Plus and Cmd-Minus globally hijacked by canvas
  zoom. The canvas's own keyboard handler for zoom-in /
  zoom-out intercepts these keystrokes regardless of
  where focus is, which means Chrome's page-zoom shortcut
  never reaches the browser; only the Chrome View menu's
  zoom command works. The handler is presumably attached
  at window level rather than scoped to the canvas DOM
  node. Fix is to make the handler focus-aware so the
  browser handles Cmd-Plus when focus is outside the
  canvas (in the editor, the inspector, the message bar,
  the menu bar). Worth a small pass; cosmetic but it gets
  in the way for users who rely on Chrome page-zoom.
- Canvas objects look noticeably fainter than in earlier
  sessions at a normal canvas zoom level. Cause unknown
  as of 2026-05-12; possibly a CSS or DPR side-effect
  from a recent commit, possibly orthogonal. Worth
  investigating when next touching canvas rendering.

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
- Image-colour signals derived from the OKLCh
  perceptually-uniform colour space and the source's
  canvas position: imageLightness (perceptual brightness),
  imageChroma (perceptual saturation), imageRedness and
  imageGreenness (opposite ends of the red-green opponent
  axis, each the negation of the other), imageYellowness
  and imageBlueness (the same shape on the yellow-blue
  axis), and imageLum (a separate grayscale Rec. 709 luma
  convenience field). See section 27 for why OKLCh and
  why opponent axes rather than angular hue.
- Sprite kinematic signals: spriteX, spriteY, spriteVx,
  spriteVy, spriteV (scalar speed).
- currentScale and the tonal-context signals (defer until
  a tonal integration decision lands; see ongoing items).
- Per-tick state snapshot mechanism: landed in Tier 2
  Phase 3 (snapshot captured in firingEngine._capture-
  Snapshot, exposed to dynamic signals via
  firingContext.js). Phase 4 signals read from it via the
  firing-context pointer.
- Distance-derivatives of image signals (dlightness_ds,
  dredness_ds, and so on) computed against arc length
  traversed, and EMA smoothing of values: deferred to a
  follow-up phase once the raw signals are working. Both
  layer on top of the basic plumbing rather than altering
  it.
- defineSignal helper for composer-defined signals
  expressed as plain JavaScript formulas over the
  standard signal vocabulary: deferred to a follow-up
  phase. Once it lands, composers can write things like
  defineSignal('warmth', ({redness, yellowness}) => ...)
  in their behaviors.js.

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
  they surface in practice: most provisional decisions
  (pre-scheduled cancellation, cycle-counter-on-edit) were
  revisited and resolved firmly during Tier 2 Phase 2.
  Any remaining ones get revisited here as Tier 5 and
  Tier 6 work surfaces them.

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

- Strudel code completion and popup keyword help in the
  Code tab editor. Autocomplete for sound, note, gain,
  legato, and the rest of the strudel vocabulary; popup
  help when the cursor lands on a keyword (signature,
  short description, example). Strudel exposes its
  CodeMirror completion sources as reusable packages, so
  the integration is largely a matter of pulling those in
  and wiring them into GXW's editor; the customisation
  layer adds GXW-specific tokens on top — the dynamic
  signal names once they land in Phase 4 (imageLightness,
  imageChroma, imageLum, imageRedness, imageGreenness,
  imageYellowness, imageBlueness, spriteX, spriteY,
  spriteV), the labelled-block syntax ($id: ...), and
  the callback function name templates with object-id
  completion drawn from the current scene's objects
  (hasHit_SPR1, beenHit_TRG3, onTick_CRV1, etc.). Worth
  pulling forward to the start of Tier 2 phase work —
  having strudel's vocabulary autocomplete materially
  reduces friction when sketching test patterns to hear,
  and the GXW-specific extensions can grow alongside the
  rest of Tier 2 as new signals and conventions land.
- MIDI note helpers for Web MIDI output for callback-
  driven authoring. The MIDI output integration described
  in the Tier 2 section above routes pattern firing
  through Web MIDI as the default output; this entry is
  the complementary piece for behaviors.js callbacks that
  want to construct MIDI events procedurally. Functions
  like noteOn(channel, note, velocity), noteOff(channel,
  note), controlChange(channel, controller, value),
  pitchBend(channel, value). Callable from hasHit,
  beenHit, onTick handlers. Useful when a one-off event
  tied to canvas state doesn't fit into a pattern.
  Lower priority than the pattern-driven MIDI work; lands
  when there's a real use case from authoring scores.
- JavaScript helper library for the declarative features
  GeoSonix offered, ported and adapted for GXW. Specific
  targets for porting determined by which GeoSonix
  utilities prove useful in practice during GXW score
  authoring.

## Toward project completion (later stages, general)

These describe what "finished" looks like for GXW. Items
here are intentionally general; they sharpen as earlier
tiers land.

- Package GXW as a desktop application via Electron (or
  Tauri if bundle size becomes a concern). Reclaims the
  browser chrome's vertical space, which matters more for
  an accessibility-zoom user than the average — Chrome's
  URL bar plus tab strip plus bookmarks bar costs roughly
  100-150 vertical pixels of canvas real estate at typical
  zoom levels. Also eliminates accidental browser-shortcut
  firing (Cmd-W closing a tab, Cmd-T opening one, Cmd-L
  jumping to the URL bar) and stray URL-bar dictation
  capture, gives native macOS file dialogs and persistent
  window state, removes the network dependency on esm.sh
  by bundling imports locally so the app runs fully
  offline, and lets right-click context menus carry useful
  GXW operations rather than the browser's defaults.
  Conversion is mechanical for an app structured like
  GXW: small Electron main-process entry point opens a
  BrowserWindow on index.html, local-bundling of CDN
  imports, Electron Builder configuration for distribution.
  A session or two of focused work once the browser-mode
  core is doing useful musical work.
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
