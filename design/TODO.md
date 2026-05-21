# GXW TODO

## How this file is organized

Items are grouped by component or feature area. Each component has a Shipped subsection (what is in the implementation today) and a Pending subsection (what is designed but not yet implemented). Items move from Pending to Shipped as they land. The design doc captures the design itself; this file is the implementation-status companion.

For the previous tier-based view of work, see git log and earlier revisions of this file.

## Score structure

Scene data model: three object kinds (curves, triggers, sprites), score-level fields, and the optional background image.

### Shipped

- Three object arrays in scene.json: curves, triggers, sprites.
- Per-object string id with kind prefix (CRV*, TRG*, SPR*).
- mute boolean per object, suppressing cursor rendering and the firing that depends on it.
- hide boolean per curve for geometry rendering, surfaced only in the JSON tab.
- Score-level fields in SCENE_FIELDS: bpm, tonic, scaleName, root, chordName, range, rangeLow, mapNotesTo, imageName, output, triggerScale, spriteScale.
- Optional background image resampled to 1000x1000 as a scalar field.

### Pending

- Schema cleanup of unused trigger fields: remove the payload field (type object, default null) and the note field (type integer, default null) next time the schema is updated.

## Curves

Geometric paths with cyclePattern, optional cursor, and behaviour slots.

### Shipped

- Shape types: line, ellipse, piste.
- Cursor extents (cursorL, cursorR) defining a perpendicular line segment that sweeps along the curve.
- stopAtCycle integer field that halts the cursor after the specified number of cycles.
- Per-object curveThickness and cursorThickness fields for visual styling.

### Pending

- Bezier shape support in the implementation if it becomes a priority (deferred from the deprecated GeoMaestro shape catalogue).

## Triggers

Static positions with cyclePattern firing on collision and three behaviour slots.

### Shipped

- Position (x, y), size (visual disc radius), color, and mute fields with inspector surface.

### Pending

- Inspector greying of canHit and hasHitFunction rows for triggers; hasHit does not apply since triggers have no cursor.
- Trigger one-shot cyclePattern firing helper, callable from beenHit. The design intent is that the cyclePattern plays for one cycle when the trigger is hit; the user opts in by calling the helper from their beenHit code.
- Trigger schema cleanup of payload and note fields (covered under Score structure: Pending).

## Sprites

Autonomous agents with physics-driven motion, optional cursor, and behaviour slots.

### Shipped

- Schema fields: x, y, vx, vy, maxSpeed, displayDiameter, color, mute, cursorR, cursorL.
- Cursor extents (cursorL, cursorR) in the schema and inspector surface.
- Initial velocity inspector field in Band 2: vX and vY in the Starting State row.
- Canvas-wall collision under the inside-only rule (section 22).
- Deterministic simulation: from (initial state, elapsed beats) the event sequence is bit-identical on every replay.

### Pending

- Sprite cursor visualisation on the canvas, including the default-direction convention for a stationary sprite (spec'd as horizontal) and the cursor behaviour at the apex of a parabolic trajectory. Schema and inspector fields are in place; canvas rendering is deferred.
- Cycle-end position-reset semantics for beatsPerCycle > 0, giving a deterministic looping wander when the sprite is image-driven.

## Cursor-as-collider model

Cursors initiate collisions; collisions test the cursor line segment against the target's centerpoint. Self-firing within a source's own cyclePattern is not a collision.

### Shipped

- Cursor extents on curves (cursorL, cursorR) and on sprites (in schema).
- Line-vs-centerpoint collision geometry.

### Pending

- Cursor-vs-trigger collision detection (cursor line segment vs trigger point).
- Cursor-vs-curve collision detection (cursor line segment vs curves' cyclePattern markers).
- Cursor-vs-sprite collision detection.
- Context availability for procedural code in collisions and onTick: ctx population for marker-collision-driven beenHit (Hap payload from the firing pattern flows into ctx) plus image-driven acceleration in onTick (the typical sprite physics pattern reading image colour from ctx). Precise ctx fields settle when collision firing and onTick context are wired up.
- Continuous collision detection (CCD) within each physics step so a fast-moving cursor cannot skip past a small target between frames.
- beenHit-then-hasHit firing order for inter-source collisions.

## Pattern firing primitive

The Strudel-driven evaluation primitive that converts cyclePattern strings into scheduled events.

### Shipped

- Pattern primitive function: takes a parsed Pattern, a cycle range, a wall-clock window, and a firing source identifier; produces scheduled events.
- Parse caching at edit-commit time with re-parse on user edit.
- Firing-context pointer mechanics: module-level pointer set inside a try-finally block.
- Two-pass evaluation: Pass 1 establishes event times at cycle start, Pass 2 refreshes value fields near play time (one-cycle-ahead scheduling with late-refresh dispatch).
- Audio commit window machinery: per-tick rolling forward window, default 100ms, configurable for environment tuning.
- Cycle-boundary takeover and position-zero downbeat reliability.
- No-cancellation on mid-cycle pattern edits: pending events from the old pattern play through cleanly to the next cycle wrap.
- Per-source cycle counter continues across pattern recompile; alternation continues across edits at the next cycle index.
- Mute and solo gating in the primitive; silenced sources skip queryArc entirely.
- Continuous firing path for cursor-bearing sources.
- Static signals end-to-end: sine, saw, square, tri, perlin work as pure functions of cycle position.
- Concurrent firings across multiple sources at the same simulation tick.
- Editor undo and redo across Cmd-Enter promote.

### Pending

- Explicit reset gesture for a source's per-source cycle counter, surfaced as a small inspector control. Covers the rare case where a composer wants to restart cross-cycle modifier progress (alternation, .every, .iter) deliberately rather than letting the counter continue across pattern edits as it does by default.
- One-shot firing path for trigger and sprite collisions: one-shot invocation with cycle counter zero and a user-chosen flourish duration.
- Flourish duration field on relevant sources; default one beat at master BPM, override available per-source.
- Inspector surface for the flourish-duration field.
- Soft warning in the editor for context-inappropriate modifiers: cross-cycle modifiers used on one-shot sources surface as a yellow squiggle but do not hard-reject.

## Dynamic signals

Image-colour and sprite kinematic signals consumed by patterns; firing-context plumbing.

### Shipped

- SignalRegistry plumbing: firing-context pointer infrastructure, per-tick state snapshot.
- pxLt (OKLCh perceptual lightness) as the first end-to-end signal.
- Per-tick state snapshot mechanism; snapshot captured in firingEngine, exposed to dynamic signals via firingContext.js.

### Pending

- Remaining image-colour signals: pxChr (perceptual saturation), the four opponent-axis primaries (pxR, pxG, pxY, pxB), and the four hue intermediates (pxOr, pxPu, pxCy, pxLi). Each is a trivial projection of the precomputed OKLab values.
- Sprite kinematic signals: spriteX, spriteY, spriteVx, spriteVy, spriteV.
- currentScale and tonal-context signals; defer until tonal integration lands (see Harmony).
- Distance-derivatives of image signals (dpxLt_ds, dpxR_ds, and so on) computed against arc length traversed.
- EMA smoothing of dynamic signal values.
- defineSignal helper for composer-defined signals expressed as JavaScript formulas over the standard vocabulary.

## Transport and tempo

Master BPM, beat counter, per-source cycle periods, play/stop/rewind, and determinism.

### Shipped

- Master BPM in scene.json's bpm field; one tempo per score.
- Per-source beatsPerCycle (default 4) giving cycle length in master beats.
- Wall-clock cycle period derived as beatsPerCycle / master BPM × 60 seconds; tempo changes rescale automatically.
- Play, stop, and rewind transport controls in the transport bar.
- Rewind resets dynamic state (sprite positions, cursor positions, behaviour-internal counters) to authored starting state.
- AudioContext.currentTime as the transport clock, providing sub-millisecond timing accuracy.
- BPM field editable at runtime from the transport bar.
- Determinism property: (initial scene state, elapsed beats) determines the event sequence; replay is bit-identical.

### Pending

- Musical-subdivision duration extension to the inspector: allow durations to be specified not just as integer beats but as subdivisions of beats, for example "16 eighth notes" or "9 triplet quarter notes".

## Harmony

Score-level harmony with per-object override, eventually integrated with @strudel/tonal.

### Shipped

- Schema fields in SCENE_FIELDS for tonic, scaleName, root, chordName, range, rangeLow, mapNotesTo. Inspector surface deferred.
- HARMONY_OVERRIDE_FIELDS per object: the same keys with null default meaning "inherit from the score".

### Pending

- Inspector fields for scene-level harmony in the Properties tab.
- Per-object harmony override surface where relevant.
- @strudel/tonal modifier integration in patterns so a pattern can reference the inherited harmonic context.
- currentScale and related dynamic signals exposing the active scale to dynamic-signal-driven patterns.
- Voicing, transpose, and chord-progression support per the @strudel/tonal vocabulary plus the GeoSonix model.

## Inspector

The form-based property panel: Bands 1 (Identity), 2 (Geometry / visual), and 3 (Callback slots).

### Shipped

- Band 1: Object ID (read-only, single-select), Hide Cursor (stored in mute), cycle-duration row ("Cycles In [N] beats" with beatsPerCycle field), pattern row with Create / Go-to button.
- Band 2: Starting State (X, Y, vX, vY), Curve Size (W, H), Curve Thickness, Cursor R/L, Cursor Thickness, Sprite/Trigger Size, Color.
- Band 3: three callback rows (hasHit, beenHit, onTick) each with Can-X checkbox, function-name field, and Create / Go-to button.
- Edit lifecycle with hard / soft / ok validation: hard errors squiggle red and refuse to commit on Enter, blur silently reverts; soft warnings squiggle yellow and commit; ok values commit cleanly.
- Numeric scroll-wheel adjustment on numeric fields with 0.3 increments and validator clamping.
- Greying rules for selection-dependent fields: multi-select restrictions and kind-specific fields.
- Tri-state checkbox for boolean fields with mixed values in multi-select ("varies").
- Selection summary and single-select title in the title bar.
- Default function name proposal: slotName_objectId, e.g. onTick_sp_a3f7.
- Create / Go-to button routing: createFunctionStub for missing functions, goToFunction for existing ones; createPatternBlock and goToObjectInCode for the pattern row.

### Pending

- validateFunctionName for the three callback function-name fields; currently accept any text.
- Greying of canHit and hasHitFunction rows for triggers (covered under Triggers: Pending).
- Sprite cursor visualisation (covered under Sprites: Pending).
- Musical-subdivision duration input parsing in the cycle-duration row (covered under Transport and tempo: Pending).

## Code tab and behaviors.js

The score's authoring surface for callbacks and labelled cyclePattern blocks.

### Shipped

- behaviors.js file structure: mix of procedural function declarations (for hasHit, beenHit, onTick), labelled pattern statements of the form $objectId: expression, and any helper functions or variables the user needs.
- CodeMirror-based editor with JavaScript syntax highlighting, error squiggles, undo, explicit-save.
- Edits trigger a scene reload through the same pipeline that reloads on scene.json edits.
- Stage A3 of the pattern-authoring pivot: pattern row at the bottom of Band 1 with Create / Go-to button that scaffolds or navigates to labelled blocks.
- Stage A4: Cmd-Enter routing that promotes a labelled block's expression body to the named object's cyclePattern field in scene.json.

### Pending

- Live parse validation for labelled pattern blocks in the Code tab; parse errors as squiggles as the user types.
- Edit-time pattern preview: a "play this pattern once" affordance on labelled blocks, using a one-shot invocation of the firing primitive.
- Strudel code completion and popup keyword help in the Code tab editor: autocomplete for sound, note, gain, legato, and the rest of the strudel vocabulary; popup help on cursor over a keyword.
- Mini-notation autocomplete in pattern editing surfaces: sample names from loaded banks, modifier names, signal names.
- MIDI note helpers for callback-driven authoring: noteOn, noteOff, controlChange, pitchBend callable from hasHit, beenHit, onTick handlers.
- JavaScript helper library for declarative features ported from GeoSonix; specific targets determined by use in practice.

## Canvas rendering

Visual presentation of curves, sprites, triggers, cursors, and markers on the live canvas.

### Shipped

- Object rendering for curves (line, ellipse, piste geometries), sprites (disc), triggers (disc with color and size).
- Marker rendering for curves: diamond glyphs at each event position derived from the curve's cyclePattern, with the parsed Pattern queried for one cycle's events and each event's fractional begin position mapped onto the curve's geometry.
- Selection highlighting and selection markers.
- Curve cursor rendering: cursor extents as perpendicular line segment.
- Image background rendering at the underlying 1000x1000 resolution.

### Pending

- Sprite cursor visualisation (covered under Sprites: Pending).
- Pre-firing glyphs for deterministic patterns: visible markers showing where events will fire within an upcoming cycle.
- After-the-fact breadcrumbs for patterns whose positions do not render well as static markers (stochastic, dynamic-signal-driven).
- Cursor-trail effects, optional polish.
- Fix for Cmd-Plus and Cmd-Minus canvas-zoom hijack: scope the canvas keyboard handler so the browser's page-zoom shortcut works when focus is outside the canvas.
- Investigate the faintness of canvas objects at normal canvas zoom (cause unknown; possibly CSS or DPR side-effect).

## Audio output

Audio playback path via superdough for in-browser sound.

### Shipped

- Superdough integration for the initial first-sound milestone.

### Pending

- Audio output preservation as a parallel path alongside MIDI: superdough remains useful for monitoring or for sources that explicitly want audio when MIDI is the default output.
- Per-source output routing: each curve, sprite, or trigger selects audio, MIDI, or both (covered under MIDI output: Pending).

## MIDI output

Web MIDI output as the default playback target for real-time external synths.

### Shipped

- Web MIDI initialisation in the MIDISender class.
- Audio-to-MIDI time conversion.
- send(value, audioTime, duration) producing noteOn / noteOff with note from value.note, velocity from value.gain (default 64), channel from value.midichan (default 1), duration multiplied by value.clip.
- Firing engine routes through midiSender.send instead of runtime.play; superdough path is dormant but the module remains in place.
- IAC bus preference with first-output fallback.
- Transport bar MIDI indicator with port name and per-send flash.

### Pending

- Port selection UI: dropdown in the inspector top bar or a small menu in the Run menu, populated from MIDIAccess.outputs. Persisted per-bundle so a score's MIDI routing is part of its scene state.
- Per-source output routing: each curve or sprite selects audio (superdough), MIDI, or both.
- Per-pattern routing via the strudel .midi() modifier; patterns with .midi() force MIDI regardless of per-source default.
- Polyphony tracking when the same note number on the same channel retriggers before its first noteOff fires.

## Score bundle

Persistence: scene.json + behaviors.js + image, with load, save, autoreload, and version-management mechanisms.

### Shipped

- Disk-mirror infrastructure for reading and writing score bundles.
- scene.json and behaviors.js editable through tabbed CodeMirror editors with explicit-save semantics.

### Pending

- Score-sharing mechanism: export to disk (exists), import a shared score, possibly a URL-shareable format.

## Authoring workflow

End-to-end flow for authoring a score: object creation, property editing, callback writing, pattern composition.

### Shipped

- Object creation via the canvas toolbar; sprites currently.
- Inspector-driven property editing for all object kinds.
- behaviors.js authoring with the labelled-block plus procedural-function structure.

### Pending

- Toolbar buildout: extend the canvas toolbar with the ability to create triggers and curves (currently sprites only), plus the rest of the GeoSonix-style tool palette.

## AI handoff

Mechanisms for AI assistants (Claude and similar) to read, edit, and reason about scores. Implemented as a disk mirror at `~/Library/Application Support/GeoSonel/Active/`; see Section 15 for full design.

### Shipped

- Design doc (Section 15 modernized) plus the live HANDOFF.md and CLAUDE.md system bootstrap.
- behaviors.js as a regular text file readable and editable through the standard file tools.

### Pending (Phase 1 — composition mirror)

- Main-process mirror module managing the Active/ folder lifecycle: creation on startup, content refresh on bundle change, clear and refill on score switch, cleanup of leftover *.tmp files on startup.
- Debounced push pipeline: bundle dirty change → ~500ms timer → write scene.json, behaviours.js, image, snapshot.png, snapshot-annotated.png, snapshot-description.md, active-score.json to Active/ via temp-and-rename atomic-write pattern.
- snapshot.png and snapshot-annotated.png canvas capture from the renderer: full canvas pixel rendering, with id-label overlay for the annotated variant.
- snapshot-description.md generation: structured text rendering of canvas state (per-object id, kind, position, key properties).
- active-score.json writer: protocolVersion, score (displayName, path, dirty), sync block, transport snapshot, files lists (roundTrip and observationOnly), atomicWrites convention block, isLive flag, lastApplyResult.
- fs.watch on Active/ in the main process with *.tmp filter, quiescence-based debouncer (500ms reset on each event), and .pending sentinel detection with 60-second default timeout for orphan handling.
- IPC channel for forwarding AI-originated batch events to the renderer's bundle.updateContent pipeline.
- Validation and rollback: AI-write batches validated (JSON parse, sceneSchema, Acorn syntax check); any failure rejects entire batch, re-pushes last-known-good content to mirror, populates lastApplyResult with rich per-file error info (object reference, field path, invalid value, expected shape, valid values, near-match suggestion, human-readable message).
- Score-switch handling: cancel any pending watcher batch with user notification.
- App quit handling: set isLive:false in active-score.json.
- Message-area integration for AI-edit notifications and rejection summaries.
- AGENTS.md drafting: AI-facing orientation doc covering GXW concepts (paths, cursors, sprites, triggers, cyclePattern, simulation tick model), the mirror protocol, editing patterns for scene.json and behaviours.js, workflow conventions, and (when Phase 2 lands) log interpretation.
- sceneSchema.md drafting: reference describing scene.json structure for AI grounding. Likely hand-written; could be partially auto-generated from sceneSchema.js if precedent emerges.

### Pending (Phase 2 — event logging)

- Hook at the central note-emission function in the simulation layer to capture noteOn, noteOff, suppressed, controlChange events with full context (source object, cursor, pattern step, cause / trigger reason).
- noteOff reason field: natural, voiceStolen, transportStop, overriddenByNoteOn; stealing source named when applicable.
- Suppressed reason field: patternEmittedRest, objectMuted, voiceLimit.
- Async-buffered append-only write to run-log.ndjson with header line declaring schema, type codes, cause codes, and object/cursor legend at run start.
- Hybrid string-or-index encoding for the object field (numeric legend index for run-start objects, full string ID for mid-run additions).
- Transport-start clearing and transport-stop finalization lifecycle.
- run-summary.json aggregator: per-object stats, per-pitch stats, per-time-bucket stats, totals.
- run-log-schema.md drafting: reference describing the wire format and code tables.

### Deferred (Phase 3 and beyond)

- On-demand motion-query mechanism (AI writes motion-query.json, bundle responds with motion-result.json).
- Continuous motion sampling (per-object position and velocity at ~1Hz) and motion-summary.json aggregate.
- Per-run persistence in a motion-history/ subfolder.
- SQLite database layer for long-term analysis.
- History-as-compositional-substrate API for behaviour callbacks (in-memory history buffer, narrow query API).
- Phrase extraction to MIDI / Strudel patterns / bundle-native clips.

## Accessibility

The author's setup uses zoom, Speak Selection, and dictation. Deliberate accessibility passes for keyboard, screen-reader, and contrast are deferred until the core experience is stable.

### Shipped

- Inspector layout designed for the author's zoom-based workflow.
- Dark mode throughout.
- High-contrast field styling: bright white labels, green frames, muted greys for disabled fields.

### Pending

- Keyboard navigation through the inspector and the canvas.
- Screen-reader audit.
- Contrast review.

## Project completion

What "finished" looks like for GXW. Items intentionally general; they sharpen as earlier work lands.

### Pending

- Package GXW as a desktop application via Electron (or Tauri if bundle size matters). Reclaims browser chrome's vertical space, eliminates accidental browser-shortcut firing, gives native macOS file dialogs and persistent window state, removes the esm.sh network dependency by local-bundling imports, and lets right-click context menus carry GXW operations.
- Performance pass: profiling and optimisation for scenes with many sources, large cycle counts, and dense patterns.
- Cross-browser check: Chrome is the primary target; verify Firefox and Safari for the core flows.
- Example scores: a curated set of small scores demonstrating common idioms such as a single cycling curve, a trigger-collision rhythm, and a dynamic-signal-driven melody. Doubles as documentation and as a smoke-test suite.
- README and user guide: install, author a score, cursor-as-collider model, patterns and slots.
- License audit: confirm @strudel/web licence compatibility and surface attribution where needed.
- Final design pass through DESIGN.md once everything is implemented, with the implemented-versus-designed gap reconciled.

## Other ongoing items

Items that span multiple components and don't sit neatly under any one.

### Pending

- Mute and solo carryover from GXSTR: per-source mute as persisted, Solo Selected as runtime-only.
- Strudel version sync: GXW pins to a specific @strudel/web version; track strudel releases that affect the promoted modifier vocabulary.
- Per-source flourish duration default shape: scene-level, per-kind, or per-source. Settle once one-shot pattern use surfaces the right shape.
