# GXW Design Document

Version 2.2 — Updated April 2026
Status: Living document.

Naming: GXW is the web-based successor to GeoSonix. The W stands for Web. The project folder and repository live at /Users/chrisgr/ProgrammingProjects/GXW. An earlier Python desktop prototype, GXM, exists at /Users/chrisgr/ProgrammingProjects/GX2 and remains preserved as reference; GXW supersedes it as the active development path.

Revision v2.2 documents several changes that have accumulated since v2.1.

The bundle file layout was split: a score's data and its behaviour now live in two files — scene.json (declarative data: piece-level parameters plus arrays of curves, triggers, and sprites with their declarative properties) and behaviours.js (named JavaScript functions referenced from scene.json by name). The scene loader stitches them together at run time. This split makes scenes editable through structured tooling — a property inspector, AI assistants operating on JSON, a graphical editor — without competing with the JavaScript editor for the same source. See Sections 14 and 16.

Direct manipulation of the scene through a canvas toolbar arrived. A toolbar above the canvas exposes object-creation tools (Add Sprite at this milestone, with Add Trigger and the curve-shape tools to follow), and the canvas itself supports selection (click, shift-click, marquee) across all three object kinds, drag-to-move for sprites, and Delete-key removal across all kinds. Canvas edits flow through scene.json text mutations that respect the existing explicit-save model. See Section 13.

Disk mirroring (the v2.1-era attempt to make scores accessible to AI assistants via a folder on disk that polls for external changes) is now deprecated. The browser permission lifecycle proved too fragile to rely on, the File System Access API doesn't expose absolute paths to assistants, and the round-trip introduced subtle bugs. The code is preserved unchanged but is not actively recommended; the Settings → Storage panel still exposes the controls for users who want to opt in. The successor in the v2.3 milestone window is the AI Handoff feature: a simpler user-controlled export-and-reload mechanism for sharing the current score with Claude through a configured folder. The longer-term direction beyond v2.3 is an embedded API key letting Claude operate on score state through the same in-memory pipeline the toolbar and inspector use, eliminating the disk hop entirely. See Section 15 for the AI Handoff design and Section 25 question 17 for the embedded-API-key direction.

Curve cycle parameters were simplified. The GeoSonix triplet of cycleDuration, cursorSpeed, and cycleTime collapses to a single stored field — cycleDuration, the cycle's duration in score beats — with cycleSpeeds and stopAtCycle providing per-cycle modulation and finite playback respectively. The Time Lock toggle that GeoSonix needed to disambiguate which of the three was the source of truth disappears with the unification. The active-beats and strength strings both become free-length cycling rather than the active-beats string being pegged to beats-per-cycle, which removes the beatsPerCycle field. See Section 4 for the new cycle-parameter model and Section 10 for the rhythm-string model.

Underlying revisions v2.0 and v2.1 remain in effect: the three-object model (Curves, Triggers, Sprites) and the Mover-to-Sprite renaming. No conceptual changes to the object model in v2.2.

The underlying v2.0 rework remains in effect: a substantial reshaping of the object model following detailed comparison with both GeoMaestro and GeoSonix. The v1.0 split between Projectors and Movers has been replaced by a three-object model — Curves, Triggers, and Sprites — that better reflects the compositional vocabulary the composer actually uses. Several v1.0 concepts have been removed or folded in: the separate Projector type, the separate Cursor object, the Distortion Function as a first-class concept, and the cross-paradigm BeatPattern resource. The GeoMaestro projector capability is preserved through the Curve's extended cursor; distortion behavior lives in the Curve's sweep function. See Section 24 for the discussion of what survived from each parent system and why.

---

## Table of Contents

- [Section 1 — Vision](#section-1--vision)
- [Section 2 — Conceptual Model](#section-2--conceptual-model)
- [Section 3 — Scene Structure](#section-3--scene-structure)
- [Section 4 — Curves](#section-4--curves)
- [Section 5 — Triggers](#section-5--triggers)
- [Section 6 — Sprites](#section-6--sprites)
- [Section 7 — Transport and Tempo](#section-7--transport-and-tempo)
- [Section 8 — Collision Model](#section-8--collision-model)
- [Section 9 — Function Slots and Context Objects](#section-9--function-slots-and-context-objects)
- [Section 10 — Beat Points and Strength Strings](#section-10--beat-points-and-strength-strings)
- [Section 10.5 — Unified Bound-Trigger Model (Proposed)](#section-105--unified-bound-trigger-model-proposed)
- [Section 11 — Harmony Framework](#section-11--harmony-framework)
- [Section 12 — Phrases and the Compositor](#section-12--phrases-and-the-compositor)
- [Section 13 — User Interface](#section-13--user-interface)
- [Section 14 — Authoring Workflow](#section-14--authoring-workflow)
- [Section 15 — AI Handoff](#section-15--ai-handoff)
- [Section 16 — Score Bundle](#section-16--score-bundle)
- [Section 17 — Version Management via Git](#section-17--version-management-via-git)
- [Section 18 — Auto-Reload](#section-18--auto-reload)
- [Section 19 — Audio and MIDI Output](#section-19--audio-and-midi-output)
- [Section 20 — Implementation](#section-20--implementation)
- [Section 21 — Canvas Coordinate System](#section-21--canvas-coordinate-system)
- [Section 22 — Sprite Physics Details](#section-22--sprite-physics-details)
- [Section 23 — Module Overview](#section-23--module-overview)
- [Section 24 — GeoMaestro and GeoSonix Reference](#section-24--geomaestro-and-geosonix-reference)
- [Section 25 — Open Questions](#section-25--open-questions)

---

## Section 1 — Vision

GXW is a web app for composing music that emerges from 2D scenes. A scene is a substrate of curves and triggers placed at considered positions. Curves have intrinsic rhythmic structure and play their own beat points on internal cycles; curves with extended cursors also sweep through the scene, triggering any triggers they encounter — this is the GeoMaestro projector idea preserved as a property of every curve. Sprites are autonomous agents that wander the scene, reading its image-as-scalar-field and firing musical events based on their environment. All agents share one transport and one musical framework.

The composer works by editing a JavaScript sketch file describing the scene, its objects, and their behaviour. GXW watches the sketch and re-executes it whenever it changes. A canvas shows the scene and its animation. Sound is produced by the browser's Web Audio API, and optionally routed to external synthesisers via Web MIDI where supported.

Sketches are typically constructed and modified through conversation with Claude, which edits the sketch directly. The conversational authoring experience is a first-class concern of GXW rather than an external workflow.

---

## Section 2 — Conceptual Model

A GXW scene holds three kinds of first-class objects — curves, triggers, and sprites — plus an optional background image that acts as a scalar field and a transport that keeps global tempo and time.

Curves are geometric shapes (line, circle, piste, bezier, and other named forms) with intrinsic rhythmic structure. Each curve has a set of beat points distributed around its shape according to an algorithmic generator (primarily Euclidean) or a hand-authored pattern string. Each curve has a visible cursor that advances through its cycle over a settable number of beats. When the cursor reaches an active beat point, the curve's beat function fires. If the cursor has non-zero extent on either side of the curve direction, it sweeps through space as it advances, and any triggers in the swept region fire. Curves combine geometry, rhythm, and projection into one coherent compositional object.

Triggers are static positions in the scene with optional payload. They do not move. They fire when a curve's extended cursor sweeps over them, or on an optional auto-timer. Triggers are the free-standing musical atoms of the scene — positions the composer places with compositional intent.

Sprites are autonomous agents that move through the scene under their own logic. Each sprite has a step function called every physics step, in which it reads its environment (image colour under its position, vector field forces, transport state) and can mutate its own velocity and position and fire musical events directly. Sprites do not collide with anything; they only initiate musical events from inside their own step logic or on an optional auto-timer. The sprite is the autonomous-creature-in-a-field idea from GeoSonix, made first-class.

The transport is global: tempo, time signature, beat position, play state. All objects reference it. Curves advance their cycles from transport time. Triggers tick their auto timers from transport time. Sprites integrate physics against transport time. One shared clock keeps everything rhythmically locked by default.

Three object types, each with a clear compositional role. Two collision participants (the curve's extended cursor as collider, the trigger as collidee), one direction of interaction. Three function-slot budgets per object type, each slot named for what it reacts to. The mental model fits in a paragraph.

---

## Section 3 — Scene Structure

A scene's data model:

- An optional image, resampled to 1000x1000. The image is a scalar field: at any 2D position it provides r, g, b, luminance, hue, saturation. Consulted by sprites (via their step functions) and available as context fields in all other functions.

- A collection of curves, each with a geometric shape, a set of beat points, a cursor, and zero to two functions.

- A collection of triggers, each with a position, optional payload, and zero to two functions.

- A collection of sprites, each with a position, velocity, motion parameters, and zero to two functions.

- A vector field built from one or more field sources (attractors, repulsors, uniform flows, pixel-gradient flows) that combine to produce a force vector at any position. Consulted by sprites during integration.

- Optional named regions — 2D areas with boolean membership and optional scalar data.

- Score-level harmonic parameters (see Section 11) — tonic, scale, root, chord, range — that objects inherit unless they override.

The canvas is always live and displays whatever state the model currently holds. There is no separate edit and run mode at the canvas level; editing happens by modifying the sketch, and the canvas reflects the result after the sketch re-executes.

---

## Section 4 — Curves

A curve is the most structured object in GXW. It bundles geometry, rhythm, a moving cursor, and up to two functions.

Shape. A curve has a geometric form — line segment, circle, piste (polyline), bezier, or a more elaborate named type (helice, rose, spiral, and other shapes from the GeoMaestro catalogue). The shape defines the curve's spatial presence and the path along which the cursor advances. Shape types in implementation priority order: line segment, circle, piste, bezier, helice.

Beat points. A curve's rhythm is defined by two independent free-length strings (full treatment in Section 10). The active-beats string uses "x" and "." to mark which positions fire; the strength string uses digits 0-9 to set the emphasis of each firing. Both strings cycle independently as cycle positions advance, so each can be any length the composer chooses; when the lengths don't share simple ratios with each other or with the cycle, the audible rhythm pattern evolves cycle-to-cycle as the strings drift, which is a generative property the composer can deliberately exploit. Beat points render as tick marks along the curve at the cycle positions corresponding to the active beats, with active positions visually distinguishable from inactive ones. Active beat points pulse briefly when fired, with the pulse's brightness reflecting the firing's current strength. Strength-zero firings do not produce sound and do not pulse.

Cursor. A curve has a visible cursor that advances through its cycle at a rate governed by the curve's cycleDuration field (see "Cycle length and per-cycle modulation" below). The cursor has two extent values, R (right of curve direction) and L (left of curve direction), set independently. When both are zero, the cursor is a single point on the curve — purely a progress indicator with no spatial presence, visible only to the composer watching playback. When either R or L is non-zero, the cursor becomes a line segment of that length perpendicular to the curve's direction, and as the cursor advances, the segment sweeps through space.

Extended cursors collide with triggers in the scene. This is the GeoMaestro projector capability preserved as a property of every curve. A line-segment curve with R=5 and L=5 sweeping from A to B over 4 beats is a classic projector. Setting both extents to zero turns the curve back into a pure rhythmic player with no spatial sweep. The extent is continuous property, not a mode switch — any curve can be a projector by setting extent, or stop being one by setting it back to zero.

Functions. A curve has two optional function slots:

- The beat function fires when the curve's cursor reaches an active beat point during internal cycle advancement. It does not fire on external collisions.
- The sweep function fires when the curve's extended cursor collides with a trigger in the scene (either a free-standing trigger or a beat-as-trigger on another curve). It does not fire on internal beat points.

Either or both slots may be undefined. A curve with only a beat function and a zero-extent cursor is a rhythmic player. A curve with only a sweep function is a projector that doesn't play its own beat points. A curve with both is a rhythmic projector that simultaneously plays its own rhythm and sweeps other objects. A curve with neither is pure visual scaffolding, drawn but silent.

Beats-as-triggers property. A curve has a "beats are triggers" property (default false). When true, the curve's active beat points become externally collidable — another curve's extended cursor sweeping across these positions will fire them, with context including which curve was hit and which beat point was struck. See Section 10 for how the strength string cycles under external collisions.

Cycle length and per-cycle modulation. A curve has a single stored field for cycle duration in beats: cycleDuration, an integer with default 4. The cursor takes that many score beats to traverse one full cycle of the curve at the score's current tempo, and the value also defines the cycle's tick-position resolution — one tick per beat. Cycle time in seconds is derived at runtime from cycleDuration and the score's BPM, never stored, so a tempo change rescales every curve's cycle time automatically without per-curve adjustments.

This collapses the GeoSonix triplet of cycleDuration, cursorSpeed, and cycleTime into one field, which removes the Time Lock checkbox that GeoSonix needed to disambiguate which of the three was the source of truth at any moment. The musical capability that GeoSonix's Cursor Speed field provided — temporal modulation of the cursor's traversal — is preserved through two other fields described below.

cycleSpeeds is a string of space-separated numeric multipliers (default "1") applied to cycleDuration cycle by cycle. With cycleSpeeds = "0.4 2 -1", the first cycle takes 0.4×cycleDuration beats, the second takes 2×cycleDuration beats, the third reverses direction (negative values reverse), and the list cycles when it runs out. Single-value lists like "1" or "0.5" produce uniform cycle pacing; multi-value lists produce per-cycle modulation including reverse motion. Fractional values are allowed.

stopAtCycle is an integer (default -1) that halts the cursor after a specified number of cycles. The default -1 means play forever; setting it to 3 means the cursor completes three full cycles and then stops, regardless of what's in cycleSpeeds. Useful for finite-length compositional gestures and for cycle-counted phrases.

---

## Section 5 — Triggers

A trigger is a static musical position in the scene. It has:

- A position in canvas coordinates.
- A size, which serves as the collision radius for cursor-sweep detection.
- Optional payload — a note specification, controller value, parameter set, pre-rendered phrase, or callback function. Used by the firing function as this.note, this.cc, etc.
- Up to two optional function slots:
  - A collision function fires when a curve's extended cursor sweeps over the trigger. Context includes the curve that hit it and the hit geometry.
  - An auto function fires on the trigger's own timer at an interval set in the trigger's properties.

Both functions are optional. A trigger can be pure data — position and payload with no functions — in which case nothing fires when the trigger is hit. This is specifically useful when the composer wants the colliding curve's sweep function to do all the musical work, reading the trigger's payload as context. See Section 8 for the collision resolution rule that makes this pattern work.

Triggers do not move. They do not observe the scene. They do not carry per-step logic. They sit at their position and fire when hit or when their auto timer ticks.

---

## Section 6 — Sprites

A sprite is an autonomous agent that moves through the scene under its own logic.

Geometry. A sprite is a point. It has a position and a velocity but no spatial extent. This falls out of the collision model: since sprites do not collide with anything (see Section 8), they have no need for geometric size. Visual rendering draws the sprite as a small filled circle so the composer can see it, but the circle's size is purely a rendering concern — the sprite itself is the moving point at its current position.

Motion. Sprites move freely in the scene. They are not path-constrained — if the composer wants sweep-along-a-path behavior, that is handled by a curve with an extended cursor, not by a sprite. Sprites have a position and velocity, sample the vector field at each step, integrate forces, and bounce off canvas boundaries (see Section 21 for physics details).

Per physics step:

1. The sprite's step function is called (if defined). Inside it the sprite reads its environment and may mutate its velocity, position, or other properties, and may emit musical events.
2. The vector field force at current position is sampled and added to velocity.
3. Velocity is capped at maxSpeed and absoluteMaxSpeed.
4. Position updates from velocity × dt.
5. Boundary collisions with the canvas's implicit bounding box are resolved via continuous collision detection.

Functions. A sprite has two optional function slots:

- The step function is called every physics step, before physics integration. Inside the function the sprite has access to its current state, the image colour under its position, the vector field force, region membership, and transport state. The function can mutate the sprite's properties (velocity is the most common case, producing image-driven wandering) and can fire musical events — emit notes, trigger phrases, send controller messages — on any condition the composer expresses in code. The step function is the richest authoring surface in GXW and is the heart of what makes sprites expressive. A sprite that fires "every time luminance crosses 0.5 upward" produces non-rhythmic event streams driven purely by the scene's scalar field; a sprite that fires "on any red value above 0.8" produces color-triggered events; a sprite that integrates image-gradient into its velocity and fires on position-over-time conditions produces behaviors unique to the scene.
- The auto function fires on the sprite's own timer at an interval set in the sprite's properties. This is the rhythmic emission slot — useful for sprites that play on a beat clock regardless of where they are or what they're doing.

Either or both slots may be undefined. A sprite with only a step function is a pure autonomous agent. A sprite with only an auto function is a drifting metronome. A sprite with both does both. A sprite with neither is a position reference that moves under pure physics without playing.

Sprites do not have a collision function. They do not collide with triggers, curves, or other sprites. If a sprite wants to fire triggers based on proximity, its step function reads scene state and does so explicitly — "is there a trigger within 2 units of me, and did I just enter that radius?" is a three-line check in the step function. This asymmetry — sprites only initiate, never receive — keeps the collision model single-directional and simple. See Section 8.

Soft UI convention: six sprites in the default palette, based on empirical experience from GeoSonix that parameter management past six becomes overwhelming. Not a data-model limit.

---

## Section 7 — Transport and Tempo

The transport is global, with state: BPM, time signature, current beat position, play/stop/pause/rewind, and optional tempo automation.

Curves convert their cycle time from beats to wall-clock seconds using the current BPM at evaluation time. Tempo changes during a cycle affect pacing accordingly. Triggers' auto timers tick in beats, converted to wall-clock time via BPM. Sprites drive physics from the transport's beat clock — physics time step is expressed in beats; wall-clock mapping happens via tempo. Halving tempo doubles the time it takes a sprite to cover the same spatial trajectory; forces and field values don't depend on tempo, only pacing does.

Duration overrides: each curve's cycle time, each trigger's auto interval, and each sprite's auto interval can be specified in beats (default), absolute seconds (ignores tempo), or proportional units relative to some reference.

Per-object tempo override is available but deferred. Common case is one global tempo.

Transport controls are exposed in a bar along the bottom of the main window: a rewind button and a play-pause toggle on the left, followed by an elapsed-time readout, a BPM field, and a read-only time signature display. BPM and time signature defaults are defined in the sketch's setup() function (see Section 14). BPM is editable at runtime from the transport bar for live experimentation; runtime changes do not write back to the sketch, so a sketch reload restores the value defined in setup(). Time signature is read-only in the UI, since changing it at runtime has non-trivial musical implications best reserved for sketch edits.

The transport clock is driven by the browser's AudioContext.currentTime, which provides sub-millisecond timing accuracy independent of animation frame timing.

---

## Section 8 — Collision Model

GXW has exactly one collision rule, applying to exactly one participant pair.

The collider. An extended cursor — a curve's cursor with non-zero R or L extent — is the only thing that initiates collisions. Cursors with zero extent are pure progress indicators and do not collide.

The collidee. A trigger is the only thing that can be collided with. Curves with the "beats are triggers" property true also expose their active beat points as collidees for this purpose, firing using the curve's beat-function context augmented with external-collision information.

The rule. When a curve's extended cursor sweeps through a trigger's collision radius during a physics step, a collision event fires. Continuous collision detection within each step ensures a fast-moving cursor cannot skip past a small trigger between frames.

Functions fired on collision. Both the trigger's collision function and the curve's sweep function fire, in that order, if both are defined. If only one is defined, only it fires. The composer chooses per object which function to define, which enables several compositional patterns:

- Define only the trigger's collision function: the trigger controls its own firing regardless of which curve hit it. Each trigger sounds the same way no matter how it was struck. The classical trigger-as-sound-emitter pattern.
- Define only the curve's sweep function: triggers are pure data (position plus payload); the curve decides how to interpret each hit. This is the GeoMaestro distortion-function pattern — centralized firing logic reading trigger data as context. A single function with distance-based pitch and angle-based pan, applied uniformly to every trigger the curve sweeps.
- Define both: two things fire per collision. Useful when one function emits a note and the other logs, animates, or triggers a secondary effect.
- Define neither: silent hit. Rarely useful except as a placeholder during authoring.

What does not collide. Sprites do not collide — not with triggers, not with curves, not with other sprites. If a sprite wants to fire a trigger by proximity, its step function reads scene state and does so explicitly. Curves do not collide with other curves (except via the beats-as-triggers mechanism, which makes beat points collidable as triggers, not the curve itself). Triggers do not collide with other triggers.

This one-rule model replaces the five firing types of GeoSonix (cursor-auto, curve-auto, curve-beat, trigger-auto, trigger-collision) with an architecture where firing situations map one-to-one onto named function slots on the relevant object. Beat points fire on internal curve cycles via the curve's beat function. Triggers fire on auto timers via their auto function or on cursor-sweep collisions via their collision function (or the colliding curve's sweep function). Sprites fire on auto timers via their auto function or from inside their step function. Each firing situation has its own named function slot, so no source-switching logic inside functions is needed.

---

## Section 9 — Function Slots and Context Objects

Each object type has a fixed set of optional function slots. Defining a function means writing a named JavaScript function in the sketch and referencing it by name in the object's property.

- Curve: beat, sweep.
- Trigger: collision, auto.
- Sprite: step, auto.

All slots are optional. An object with no defined functions is visually and structurally present but musically silent.

When a function fires, it is called with `this` bound to the firing object and a `ctx` argument carrying additional fields specific to the firing reason. Single-purpose functions mean no source-switching is required — each function has a fixed context shape.

Curve beat function context. Fires on internal beat points.
- this: the curve (id, note, channel, port, object-level harmony overrides)
- ctx.beatIndex: position within the cycle, 0-based, ranging from 0 to cycleDuration-1
- ctx.strength: current strength digit (1-9; zeros do not fire)
- ctx.cyclePosition: 0-1 fractional position around the curve
- ctx.r, g, b, lum, hue, sat: image values at the beat point's canvas position
- ctx.scale, root, chord, tonic, bpm, timeSignature: current harmony and transport state

Curve sweep function context. Fires when the extended cursor collides with a trigger.
- this: the curve
- ctx.trigger: the trigger hit (full object access — this.note from the trigger, its payload, position)
- ctx.d: perpendicular distance from curve to trigger
- ctx.side: +1 or -1 indicating which side of the curve the trigger lies on
- ctx.angle: the curve's local direction angle at the hit point
- ctx.cursorParam: 0-1 position along the curve at the moment of hit
- ctx.r, g, b, lum, hue, sat: image values at the trigger's canvas position
- Harmony and transport fields

Trigger collision function context. Fires when a curve's extended cursor sweeps the trigger.
- this: the trigger (position, payload, id)
- ctx.curve: the curve whose cursor hit it
- ctx.d, side, angle, cursorParam: the geometry of the hit, as in the curve sweep context
- ctx.r, g, b, lum, hue, sat: image values at this trigger's position
- Harmony and transport fields

Trigger auto function context. Fires on the trigger's own timer.
- this: the trigger
- ctx.beatNumber: position in the trigger's auto cycle
- ctx.r, g, b, lum, hue, sat: image values at this trigger's position
- Harmony and transport fields

Sprite step function context. Fires every physics step before integration.
- this: the sprite (position, velocity, id, payload)
- ctx.x, y: current position (also accessible as this.x, this.y)
- ctx.vx, vy: current velocity
- ctx.v: scalar speed sqrt(vx² + vy²)
- ctx.r, g, b, lum, hue, sat: image values under the sprite's current position
- ctx.fx, fy: vector field force at current position (before physics applies it)
- ctx.region: region membership (if regions defined)
- ctx.transport: beat, bar, time signature, BPM
- Mutation: the step function can assign to this.vx, this.vy, this.x, this.y, and other sprite properties — mutations take effect before physics integration runs for this step. Returning a musical-params object fires an event.

Sprite auto function context. Fires on the sprite's own timer.
- this: the sprite
- ctx.beatNumber: position in the auto cycle
- ctx.r, g, b, lum, hue, sat: image values under the sprite's current position
- Harmony and transport fields

Firing behavior. Functions return an object with musical parameters (`{ note, velocity, duration, channel, port }`) to fire a musical event, or return null/undefined to remain silent. Sprite step functions can fire events and separately mutate sprite state in the same invocation — the returned object only affects audio; mutations happen via assignment to this.*.

Pre-loaded helpers available globally to all functions: scaleMap, rangeMap, chordMap, harmonyMap, listMap. Plus Math.

---

## Section 10 — Beat Points and Strength Strings

A curve's rhythm is defined by two independent strings plus a few numeric parameters. The separation of the two strings is deliberate: it preserves a compositional capability from GeoSonix (polyrhythmic drift between position and emphasis) that a single combined string cannot express.

Active-beats string. Uses "x" for an active position and "." for an inactive position. The string can be any length the composer chooses, and cycles as cycle positions advance — a single "x" means every position fires, "x." means every other position fires, "x.." means every third, and irregular patterns like "x.x..x." cycle through their length and produce drifting rhythm against the cycle's tick count. The string is authored by hand (property editor or direct JSON edit) or generated algorithmically through the Beat Points type — None disables firing entirely, Normal uses the user-typed string as-is, and Euclidean distributes a target count of active beats evenly across a chosen number of positions. Example: `..x...x...x...x.` places four active beats at positions 2, 6, 10, 14 within its sixteen-position cycle, regardless of the cycle's own tick count.

Strength string. Uses digits 0 through 9 to specify the emphasis of each firing. A 0 is a silent position (cycle position is consumed but no sound is emitted); 1 through 9 are increasing emphasis. The strength string's length is independent of the active-beats string. If strength is shorter than active-beats, it cycles and produces polyrhythmic drift against the position pattern. A single-digit strength like `9` means all firings at strength 9.

Example of drift. A curve with cycleDuration 16, active-beats `..x...x...x...x.`, and strength `9272` produces firings at cycle positions 2, 6, 10, 14 with strengths 9, 2, 7, 2 — aligned exactly because the strength string length (4) equals the number of active beats. If the strength were `927` instead (length 3), the first cycle would fire 9, 2, 7, 9, the second would fire 2, 7, 9, 2, the third 7, 9, 2, 7, and so on. This drifting-emphasis pattern is a genuine compositional tool and is why the two strings stay independent rather than merging into a single `/9614/9224` form. The same drifting-rhythm logic applies to the active-beats string itself when its length doesn't divide evenly into the cycle.

Strength pointer semantics. A curve maintains a pointer into the strength string that advances by one on each firing of an active beat. The pointer wraps when it reaches the end of the string. A strength of 0 still advances the pointer (silent firings consume positions in the cycle). Inactive positions in the active-beats string (`.`) do not advance the strength pointer — they produce no firing, internal or external.

External collision pointer. When a curve's "beats are triggers" property is true, the curve maintains a second, independent strength-string pointer for external collisions. When another curve's extended cursor sweeps over one of this curve's active beat points, the external pointer reads and advances, just as the internal pointer does for internal cycle firing. The two pointers do not interact. This preserves clean polyrhythmic structure in both streams independently: even if the internal cycle has fired `9 2 7 9` and is part-way through `2 7 9 2`, the external pointer can be independently on its own position in the string.

Only active positions are externally collidable. Inactive positions (`.`) are not rendered as tick marks and are not collidable, even when "beats are triggers" is on. The active-beats string fully determines where beat points visibly exist on the curve.

---

## Section 10.5 — Unified Bound-Trigger Model (Proposed)

A captured proposal for evolving the trigger and beat-point model in a future revision. The current "beats are triggers" property described in Sections 4 and 10 makes a curve's active beat points externally collidable but leaves them rendered as tick marks and conceptually distinct from triggers. This proposal goes further: visualise and treat curve beat points as triggers themselves — geometrically bound to their parent curve and inheriting their behaviour from the curve, but otherwise the same kind of object as standalone triggers. The unification removes a redundant concept, gives beat points a more visible and consistent visual identity, and unlocks compositional capabilities the current model does not offer. The proposal supersedes the "beats are triggers" property: in the new model, beat points are always triggers, and a separate visibility setting controls only whether they are exposed to other curves' cursors.

Visual rendering. Each active beat point on a curve renders as a diamond — a small four-pointed glyph rotated so two opposite points lie on the curve and the other two extend perpendicular to it. The diamond reads simultaneously as "this is a trigger" (matching the standalone trigger glyph at first glance) and "this is bound to its curve" (the orientation declares which curve owns it without further ornament). Inactive positions in the active-beats string render no glyph; strength-zero positions, which already do not fire, also render no glyph for consistency with their silent semantics. Edits to the active-beats string cause diamonds to appear and disappear in place, the same way tick marks behave today.

Inheritance model. Every property of a bound trigger lives on the parent curve, not on the individual diamond. The bound-trigger function (the slot that fires when any cursor sweeps the bound trigger), the visual styling, the visibility setting described below, and any other declarative properties are all curve-level. The individual diamonds have no separately editable state; they are visual manifestations of the curve's beat pattern, with positions derived from the curve's parameterisation. This dodges the multi-select-across-many-beats problem in the property inspector: editing "this curve's bound-trigger function" is one edit on the curve, not one edit per diamond, and the alternative of multi-selecting all the bound triggers on a curve would be awkward when other unrelated objects sit between them on the canvas. It also avoids the orphaning problem that per-beat property overrides would cause whenever the active-beats string is rewritten. Per-beat differentiation — accenting every fourth beat, for instance — is achieved by the bound-trigger function reading its beat-index argument from context and varying its behaviour accordingly. The function is shared; the data feeding it is per-beat. The strength string is one such per-beat data channel today; richer per-beat data is discussed under "Future direction" below.

External visibility. A curve has a visibility property controlling whether its bound triggers are exposed to other curves' cursors. The default is bound-only: bound triggers respond only to their parent curve's cursor, matching the typical case of a curve playing its own rhythm. When externally visible, the bound triggers become collidable by any cursor in the scene, including the parent's, and the existing one-and-only collision rule (extended cursor hits trigger) handles cross-curve sweep without modification. When an external cursor sweeps an externally-visible bound trigger, the parent curve's bound-trigger function fires — not the visiting curve's sweep function. The bound trigger remains the source of truth for what happens when it is hit, regardless of who hit it, matching how standalone triggers already behave. The strength-pointer dual described in Section 10 (one pointer for internal cycles, a separate pointer for external collisions) carries forward into this model unchanged. Inspector label wording is to be settled when the inspector exposes the field; "Visible to other curves" and "Externally triggerable" are candidates.

Function precedence with sweep functions. When a cursor with a defined sweep function hits a trigger that also has a defined function (whether a standalone trigger's collision function or a curve's bound-trigger function), two conceptual models compete. Cursor-as-actor treats the cursor as the player and the trigger as a position-only target. Trigger-as-actor treats the trigger as the locus of musical content and the cursor as the playhead. Compositions may legitimately want either. The proposed rule is whichever-has-a-function wins, as long as only one does: if only the trigger has a function, the trigger fires; if only the cursor's curve has a sweep function, the cursor's sweep function fires. The data shape declares the conceptual model implicitly. The both-defined case is deferred for a future decision, with leading candidates being both-fire-in-defined-order (event-with-multiple-handlers semantics, simpler to reason about but allowing two events per collision) and delegation (the cursor's function receives the trigger as an argument and may choose to invoke its function explicitly or not, more powerful but requiring the function author to think about the call chain). Until the both-defined case is decided, the runtime should pick one consistently and the inspector should make the both-defined state visually apparent.

Compositional value. The strongest argument for the unification is the cross-curve case. Today there is no clean way to have one curve's cursor play a rhythmic pattern derived from another curve's geometry; bound triggers with the visibility setting checked make this work as a special case of the existing one-and-only collision rule, with no extra mechanism required. The pattern-laying ergonomics are the second argument: typing a pattern string is much faster than placing many triggers individually, and the pattern can be shifted along the curve by editing parameterisation, with the diamond positions following automatically.

Future direction: phrase-pasting. The current active-beats and strength strings encode timing and emphasis, but the bound-trigger architecture accommodates a richer pattern grammar where each active position can carry additional per-beat data — pitch, duration, arbitrary payload. With such a grammar, a melodic phrase like Yankee Doodle could be pasted onto a curve as a sequence of bound triggers with appropriate pitches, stretched over the curve's parameterisation. The shared bound-trigger function reads pitch and the other per-beat parameters from its context and constructs the musical event. This was a capability of GeoMaestro (paste a MIDI phrase onto a piste) and was wished for in GeoSonix without being implemented. The architecture admits it without disturbing the inheritance model: per-beat data is data, not per-trigger property overrides. The grammar design itself is left for a future milestone.

Visualisation. The composer's working vision for how a pasted MIDI phrase renders on the curve: each note's onset shows as a tick mark on the curve at the corresponding cycle position, with measure-boundary tick marks rendered larger than note tick marks so the phrase's metric structure stays legible at a glance. Pitch, duration, velocity, and other per-note parameters do not render geometrically on the curve — they appear in the property inspector when the composer selects the curve or zooms in on a specific bound trigger. This keeps the curve's visual language compact (positions are visible, parameters are not) while the inspector serves as the rich-data side panel that conventional notation would otherwise need to occupy. Other rendering options will be considered when the feature is implemented; this is the working starting point.

Implementation note. The model change is larger than the code change. The collision pipeline today already runs every cursor against every trigger; under the proposed model it runs every cursor against the same set augmented by all bound triggers belonging to its own curve plus all externally-visible bound triggers from other curves. That augmentation applies during existing collision detection — the structural pipeline does not change. The bound triggers themselves are computed from each curve's active-beats string and parameterisation, either on demand or with a cache invalidated when the string or geometry changes.

Status. Captured for future work; not in the v2.3 milestone. The property inspector currently in progress does not need to anticipate this change. Section 13's existing description of the Beat Points band continues to apply during v2.3, editing active-beats and strength strings and the cycle parameters as it does today. When the unified model lands, the inspector's behaviour for curves gains the bound-trigger function slot and the visibility setting alongside the existing fields, and the standalone triggers' inspector treatment is unchanged. The "beats are triggers" property described in Sections 4 and 10 disappears, replaced by the visibility setting described above.

---

## Section 11 — Harmony Framework

GXW inherits GeoSonix's two-level harmony model. The score has global harmonic parameters and each object can inherit these from the score or override them individually.

Score-level parameters, set in setup():
- tonic(name): the piece's tonic center (e.g. "C").
- scale(name): the piece's scale (e.g. "Major", "D minor", "Dorian").
- root(name): root note for the active chord, often identical to tonic but separable.
- chord(name): the piece's current chord ("Major", "m7", etc.).
- range(semitones): the number of semitones spanned by the output range.
- rangeLow(midi): the lowest MIDI note in the output range.
- mapNotesTo("Score" | "Scale" | "Chord" | "None"): the final mapping target.

Object-level overrides. Each object has the same parameters, defaulting to "inherit from score". Inheritance is the common case; per-object overrides let one curve play in D dorian while the rest of the piece stays in C major without rewriting the score. The override model is uniform across curves, triggers, and sprites — any object can override any parameter.

Map-notes-to target. Controls the final pitch mapping:
- "Score" — use the current effective scale and chord from the object's point of view (considering overrides).
- "Scale" — map notes to the active scale only, ignoring chord.
- "Chord" — map notes to chord tones only (typically one to four notes per octave).
- "None" — no mapping; notes are emitted as-is from the function.

Helper functions in message-function bodies consult these parameters. `scaleMap(value, { scale: ctx.scale, root: ctx.root })` maps a 0-1 input value into a note within the currently effective scale. `chordMap(index, { chord: ctx.chord })` returns the indexed chord tone. These helpers read from the context (which carries the current effective harmony for the firing object) rather than from score-level globals, so per-object overrides are automatically respected.

---

## Section 12 — Phrases and the Compositor

Curves, triggers, and sprites all emit Phrases — time-indexed event streams in beats.

A Phrase has:
- A sequence of events, each with time offset in beats and musical parameters, plus optional metadata.
- An overall duration in beats.
- An optional name.

The Compositor accepts phrases from any source (rendered curve output, recorded trigger output, accumulated sprite output, imported MIDI files) and arranges them on a beat-indexed timeline via a box-graph model inherited from GeoMaestro. Echo boxes, iterative boxes, synth boxes, mix boxes, effect boxes.

The Compositor is deferred. Initial releases produce phrases but arrange them trivially.

---

## Section 13 — User Interface

GXW's main window is divided into four regions. A top menu bar. A canvas pane on the left, showing the live scene. A tabbed code editor on the right, showing one tab per JavaScript file in the score bundle. A transport bar along the bottom. Three-pixel grey dividers separate every region so the window structure stays visually clear.

The canvas pane occupies roughly half the window width by default and can be resized by dragging its right edge. A menu option can pop the canvas out into a separate floating browser window for composers who prefer a Processing-style two-window layout.

The tabbed editor shows every .js file in the current bundle as a tab. Tabs are left-aligned. The editor uses CodeMirror 6 with a dark theme, warm off-white text on a near-black background. A grey divider runs along the bottom of the tab bar and breaks under the currently selected tab so that tab visually connects to the editor content below it.

Tab labels show a dot prefix when the tab has unsaved changes. Save and Save All actions live in the File menu alongside New Score, Open Score, Save Score As, New Module, and Delete Current Module. Recent scores are tracked and reopenable from an Open Recent submenu, and the last opened score reopens automatically on launch.

The transport bar at the bottom contains, from left to right: a rewind button, a play-pause toggle button, an elapsed-time readout in minutes, seconds, and hundredths, a BPM field editable via up-down stepper arrows, and a read-only time signature display. A vertical grey divider separates these controls from the right half of the bar, which is reserved for error and status output from sketch execution.

The canvas is a live viewer. It displays the scene: background image, vector field visualisation (optional), curves rendered as their geometric shapes with tick marks at beat points and animated cursors (extended cursors render as perpendicular lines showing their sweep region), triggers rendered as filled dots sized by their collision radius, sprites rendered as filled circles coloured from the pixel underneath with white ring outline, and optional trails fading behind sprites.

Canvas toolbar and direct manipulation. A toolbar strip across the top of the canvas pane holds object-creation tools. Each tool has three states: idle, armed (one-shot — single placement, then back to idle), and locked (repeat placements until the user disarms). Single-clicking a tool button arms it; double-clicking locks it; clicking the active tool again disarms at any state; the Escape key disarms from any state. While armed or locked the cursor over the canvas is a crosshair, and clicks place a new object at the click position. Mouse-down on a tool button briefly flashes green so the click feels acknowledged in real time, and the armed/locked classes carry that green forward into the persistent state. The current toolbar exposes a single tool, Add Sprite; Add Trigger and the curve-shape tools follow.

Selection model. With no tool armed, the canvas behaves as a selection surface. Clicking an object selects it (replacing any previous selection); shift-clicking toggles the object's membership in the selection; clicking empty space clears everything. Dragging from empty space draws a marquee — a translucent grey rectangle that follows the mouse — and on release every object the marquee touches joins the selection (or replaces it when shift is not held). Dragging from a selected sprite moves all selected sprites together; dragging from an unselected sprite first replaces the selection with just that sprite, then moves it. Selection is multi-kind: sprites, triggers, and curves can all be selected together, with selection markers as yellow dotted squares around sprites and triggers, and yellow dotted bounding-box rectangles around curves. Hit-testing tries sprites first, then triggers, then curves so the visually-topmost object wins ties. Drag-to-move is sprite-only at this milestone; triggers and curves can be selected and deleted but not moved through the canvas yet.

Edit pipeline. Canvas operations — Add Sprite, drag-to-move sprites, Delete to remove objects of any kind — commit by parsing scene.json, mutating the parsed data, stringifying back, updating the bundle in place, refreshing the editor's Properties JSON view, then re-running the scene. Re-running auto-saves first, so each canvas edit also persists through the normal save pipeline. The Delete and Backspace keys remove all currently-selected objects; the listener checks the focus target so typing in the JSON tab still does the obvious thing. Selection is filtered against array lengths after each scene reload so a move-style edit (which preserves indexes) keeps the user's selection through the consequent re-render, while a delete or score switch prunes stale entries.

Property inspector. The form-based property inspector ships in v1 form, occupying the Properties tab as the primary editing surface for object properties. It renders six bands sized by their constraint rows (identity; geometry and visual; message functions; auto message interval; beat points; cycle parameters) with selection-driven greying — fields that don't apply to the current selection stay in their fixed positions but lose their green frame and brighten only when active, so the form's layout never reflows when the selection changes. The inspector is blank when nothing is selected, matching GeoSonix's empty-selection convention. v1 is partially data-bound: Band 1 (identity) reads and writes real object data, including JS-identifier validation on the Name field with hard-error and soft-conflict squiggly underlines; multi-select greying and tri-state varies indicators on the Mute and Hide checkboxes work across all kinds. Bands 5 (beat points) and 6 (cycle parameters) are next. Bands 2 (geometry), 3 (message functions), and 4 (auto interval) remain layout-only with placeholder values. Function-slot dropdowns sourced from behaviours.js, Create button scaffolding for stub functions, and harmony-override fields are all later-milestone work tracked in Section 25 question 1. The raw scene.json view that the inspector replaces moves to a Properties JSON tab, kept available as a fallback until the inspector covers every editable field.

AI authoring pane. A conversational pane is available for chatting with Claude. Requests like "add two more triggers near the top right" or "make the sprite wander faster" cause Claude to edit the sketch. The pane is toggleable and can be hidden when not in use. This is described further in Section 14.

No REPL in the initial release. No live-coding during playback initially (edit-and-rerun loop only). A future milestone may expose per-line and per-function evaluation of sketch code into a live workspace, matching the GeoSonix execution model; this is an open question flagged in Section 25.

Keyboard shortcuts: Spacebar toggles play-pause. R rewinds. Cmd-S saves the active tab. Cmd-Shift-S saves all tabs. Cmd-O opens a score. Cmd-N creates a new score.

A version history panel (toggleable visibility) shows the bundle's git history as a scrollable list of versions: milestones prominent, time-based markers next, auto-commits available via a "show all versions" toggle. Each entry has a human-readable timestamp and description. Click to view or restore.

Accessibility. Limited vision is a first-class concern in the UI. Large bold fonts throughout, a dark theme, and visible grey dividers segmenting every window region. No use of colour alone to convey information. Browser ARIA attributes and screen reader compatibility are preserved. Browser zoom composes cleanly with any OS-level zoom.

---

## Section 14 — Authoring Workflow

A score's data and behaviour are split across two files in the bundle: scene.json (declarative data) and behaviours.js (named JavaScript functions). The two files are tied together by name reference: scene.json's function-slot fields hold strings that name functions defined in behaviours.js, and the scene loader resolves them at run time.

scene.json contains piece-level parameters (bpm, time signature, harmony framework, output target, image name, per-score scales) plus three arrays — curves, triggers, sprites — each entry of which is a flat object with the declarative properties for one object (geometry, rhythm strings, position, function-slot names, harmony overrides). No JavaScript runs from scene.json; it's pure data that any tool can read or write.

behaviours.js contains named JavaScript functions referenced from scene.json. Top-level function declarations and top-level const/let bindings to function expressions and arrows are exposed by name; the file is executed once on every scene load to build a function map. The split lets a property inspector, the canvas toolbar, or an AI assistant edit scene.json directly without parsing or rewriting any code, while the JavaScript editor keeps full freedom over behaviours.js.

Example scene.json:

```json
{
  "bpm": 120,
  "timeSignature": [4, 4],
  "tonic": "D",
  "scaleName": "D minor",
  "imageName": "background.jpg",
  "triggerScale": 1,
  "spriteScale": 1,
  "curves": [
    {
      "shape": { "type": "circle", "cx": 0, "cy": 0, "r": 5 },
      "cycleDuration": 4,
      "cycleSpeeds": "1",
      "stopAtCycle": -1,
      "activeBeats": "x",
      "strength": "9",
      "cursorR": 3,
      "cursorL": 0,
      "beat": "circleBeat",
      "sweep": "projectorSweep"
    }
  ],
  "triggers": [
    { "x": 3, "y": 4, "note": 60, "collision": "triggerHit" },
    { "x": -4, "y": 2, "note": 64, "collision": "triggerHit" },
    { "x": 2, "y": -3, "note": 67, "collision": "triggerHit" }
  ],
  "sprites": [
    { "x": 0, "y": 0, "vx": 1, "vy": 0, "step": "wander" }
  ]
}
```

Corresponding behaviours.js:

```javascript
// Curve functions.
function circleBeat(ctx) {
    // An arpeggio keyed to which beat of the cycle fired.
    const degrees = [0, 2, 4, 5];
    const note = scaleMap(degrees[ctx.beatIndex % 4] / 7,
                          { scale: ctx.scale, root: ctx.root });
    return { note, velocity: ctx.strength * 14, duration: 200 };
}

function projectorSweep(ctx) {
    // Distance-based pitch — GeoMaestro distortion pattern.
    return {
        note: ctx.trigger.note - Math.floor(ctx.d),
        velocity: Math.max(0, 127 - Math.floor(ctx.d * 8)),
        duration: 400,
    };
}

// Trigger functions.
function triggerHit(ctx) {
    return { note: this.note, velocity: 100, duration: 300 };
}

// Sprite functions.
function wander(ctx) {
    // Image colour drives velocity — red pushes right, blue pushes left.
    this.vx += (ctx.r - ctx.b) * 0.1;
    this.vy += (ctx.g - 0.5) * 0.1;
    // Fire a note when luminance crosses into a bright region.
    if (ctx.lum > 0.7 && this.wasDark) {
        this.wasDark = false;
        return {
            note: scaleMap(ctx.hue, { scale: ctx.scale, root: ctx.root }),
            velocity: 80,
            duration: 150,
        };
    } else if (ctx.lum < 0.3) {
        this.wasDark = true;
    }
    return null;  // no firing this step
}
```

Authoring routes. The form-based property inspector lives in the Properties tab as a display surface for object properties; in v1 it shows selection-driven layout but is not yet a modification route (data binding from scene.json into the form is the next milestone — see Section 13). Modifications to a score happen through three routes, all of which converge on the same in-memory bundle and the same explicit-save model:

1. The Properties JSON tab in the editor lets the composer edit scene.json directly. Standard JSON syntax with linting; saving persists.
2. The Behaviours tab lets the composer edit behaviours.js. Standard JavaScript with syntax linting; saving persists.
3. The canvas toolbar and direct-manipulation gestures let the composer add, move, and delete objects through the canvas. Each operation parses scene.json, mutates it, stringifies back, and refreshes the editor view. The user then sees the same content in the JSON tab and can continue editing there, or save with Cmd-S, or run with Cmd-Enter (which auto-saves first).

Run Scene (Cmd-Enter, or the Run menu) re-executes the scene loader: parses scene.json, parses behaviours.js with Acorn to find top-level function names, executes behaviours.js to build a function map, walks the scene.json arrays resolving function-name strings against the map, and constructs a Scene that the canvas renders. Errors at any stage are reported in the message area at the bottom of the canvas pane with line numbers where possible.

AI-assisted authoring. A conversation pane within GXW talks to Claude via the Anthropic API. The user converses in natural language; Claude edits scene.json and behaviours.js directly through the bundle's in-memory representation. Each edit triggers the same parse-and-run pipeline as a manual save. Claude's knowledge of GXW's API is supplied through an API.md reference document that the integration pre-loads into the conversation context.

---

## Section 15 — AI Handoff

The AI Handoff is a user-controlled mechanism for sharing a score with Claude (or another AI assistant) for inspection, comment, and editing, without requiring an in-browser API integration. It replaces the deprecated disk-mirror feature with a simpler model: rather than continuously mirroring every score in IndexedDB to disk and polling for external changes, the user explicitly hands off the current score to a configured folder, talks with Claude about it, and explicitly fetches the result back. Two menu items drive the entire interaction: Hand Off to AI and Fetch from AI. Planned for v2.3, after the property inspector ships.

The configured handoff folder. In Settings, the user picks a folder once (the first time the feature is used) — typically something like ~/GXW-handoff or any other location convenient for both GXW and the AI assistant. The folder handle is stored persistently and survives across sessions. The browser revokes the actual filesystem permission on each tab restart, so the first Hand Off or Fetch after launching the browser produces a one-click permission prompt; thereafter the rest of the session runs silently. The folder always holds exactly one score's worth of files — the most recent handoff — with no per-score subfolders or accumulating history. Each Hand Off overwrites whatever was there.

Hand Off to AI. The user invokes Hand Off to AI from the File menu. GXW writes the entire current bundle to the handoff folder as a folder tree: scene.json, behaviours.js, image.png at the top level, and a resources/ folder with whatever modules the score uses, mirroring the bundle's internal structure exactly. Alongside the bundle files, GXW writes three observation-only artefacts. snapshot.png captures the canvas's current pixels at the moment of handoff, showing the actual visual state of the score with cursors, sprites, triggers, and any selection markers visible. snapshot-annotated.png captures the same canvas with object indices labelled next to each sprite, trigger, and curve, so Claude can refer to specific objects by the same indices that scene.json uses. handoff.json is a manifest naming the score, recording the export timestamp and per-file modification times, capturing the transport state (elapsed seconds, total beat count from start of playback, measure number and beat-within-measure given the score's time signature, and the current play state), and flagging which files round-trip on Fetch and which are observation-only. The .git folder and any other GXW-internal metadata are excluded.

Fetch from AI. The user invokes Fetch from AI from the File menu after Claude has made changes. GXW reads handoff.json to verify the folder is a recognised handoff (and warns if it does not look like one — accidental wrong folder), then walks the folder tree comparing every file against the current bundle. Files whose modification time is newer than what handoff.json recorded at handoff time are pulled back into the bundle. Files present at handoff but missing now are removed from the bundle. Files added since handoff are added to the bundle. Snapshots and the manifest itself are never reloaded — they are observation-only, and any "edits" Claude tries to make to them are silently ignored. After the file-level changes are applied, the scene is re-run, just like any other edit. If the editor has unsaved changes when Fetch is invoked, GXW warns the user and offers to discard them or cancel the fetch.

The image as a round-trip artefact. The image (typically image.png) participates in the round-trip the same way scene.json and behaviours.js do. If Claude modifies the image — to brighten a region, mask out a section, generate a fresh background, or rotate or flip the existing one — the modified image is pulled back on Fetch. To keep the implementation simple, GXW expects the image to remain named image.png; if Claude writes image.jpg or any other format, Fetch reports a clear error and asks for the file to be saved as image.png. This avoids format-conversion code in the round-trip path while still allowing image edits as a genuine creative use case.

Snapshots versus the background image. The two snapshot files (snapshot.png and snapshot-annotated.png) are conceptually different from image.png. The background image is part of the score's source material and round-trips. The snapshots are moment-in-time observations, designed to give Claude visual context for conversation: where are the sprites at the current playback position, which triggers have recently fired, what does the cursor on this curve look like in motion. The snapshots reflect simulated state, not source state, and the manifest makes this asymmetry explicit so Claude understands the relationship and can talk about the source layer and the simulated layer separately. A common conversational pattern enabled by this: the composer pauses the score at a musically interesting moment, hands off, and asks where the sprites are tending to drift toward at this point in the piece, or whether the lower-right region is producing too much firing — questions about emergent behaviour that require seeing the snapshot, not just the source.

Workflow shape. The AI Handoff is most ergonomic when paired with Claude Desktop's filesystem MCP, where Claude can read and write the handoff folder directly. The composer hands off, switches to Claude Desktop, points Claude at the handoff folder, has the conversation, switches back to GXW, and fetches. The web-chat workflow is also possible but clunkier: the composer hands off, drags the files into chat, gets edits back as code blocks, manually saves them into the handoff folder, then fetches. The feature is designed for the first workflow but does not preclude the second.

Relationship to other authoring routes. The AI Handoff is a fourth way to modify a score, alongside the JSON tab, the Behaviours tab, and the canvas direct-manipulation toolbar (see Section 14). All four routes converge on the same in-memory bundle, the same explicit-save model, and the same parse-mutate-stringify edit pipeline. Fetch from AI ends up calling the same bundle.updateContent path that the canvas toolbar calls, so the existing dirty-state tracking, auto-save, and re-run mechanics all apply without modification.

Relationship to the deprecated disk mirror. The disk mirror (Section 25, question 17) attempted to make the entire IndexedDB score collection continuously visible on disk, with automatic detection of external changes via polling. It proved too fragile in practice: browser permissions lapse on every reload, the File System Access API cannot expose absolute paths to the assistant, browser module caches mask external edits until a hard reload, and the round-trip introduced subtle formatting bugs. The AI Handoff is the simpler successor: explicit user-driven export and reload, only the current score, only on demand. The complexity that made the disk mirror unworkable is sidestepped because the user controls the timing of every read and write. The disk-mirror code remains in the repository in deprecated state for users who opt in via the Settings → Storage panel, but the AI Handoff is the recommended path going forward.

Timeline placement. The AI Handoff sits in the v2.3 milestone window, coming after the property inspector. The property inspector is the more central daily-use feature and is the next development priority; the AI Handoff is a narrower nice-to-have that becomes increasingly valuable once the inspector exists, because the inspector is the natural place from which to invoke an ask-Claude-about-this-object gesture, and the snapshot in the handoff naturally captures whatever the inspector currently has selected. After the AI Handoff ships, the longer-term direction described in Section 25 question 17 — an embedded Anthropic API key letting Claude operate on score state through the same in-memory pipeline — would render the disk handoff redundant for most use cases. Both can coexist for some time, with the embedded-API-key path covering interactive iteration and the AI Handoff covering deeper inspection sessions where the composer wants to read along with Claude through a longer conversation.

---

## Section 16 — Score Bundle

A GXW score is a bundle — a collection of related files — containing:

```
MyScore/
    scene.json           # declarative scene data
    behaviours.js        # named JavaScript functions referenced from scene.json
    image.png            # background image (1000x1000 PNG, optional)
    resources/           # user support files (helper modules, data tables)
    .git/                # version history (see Section 17)
```

Bundles are stored in the browser's persistent storage (IndexedDB) by default, with export and import functions to move bundles between machines or share them. The deprecated disk-mirror feature (Section 25, question 17) optionally exposed bundles as real folders on disk; the v2.3-planned successor is the AI Handoff feature (see Section 15) and the longer-term direction is in-app via an embedded API key rather than through disk round-trips.

The last opened score name is stored in application settings and reopened on launch.

The bundle is deliberately lean. The data/behaviour split (scene.json plus behaviours.js) replaces the v2.0-era single sketch.js file. No audio assets beyond the background image: GXW synthesises sound internally via Web Audio and optionally sends MIDI. No conversation history as bundle state — conversation history lives with the user session, not with the score.

The resources folder holds user-managed support files. behaviours.js can import from it using standard ES module imports. Custom harmony definitions, data tables, helper modules, alternate tunings — anything the behaviours call on beyond the core GXW API. JavaScript files in the bundle (behaviours.js at the top level and any modules inside resources/) appear as their own tabs in the editor; scene.json appears as the Properties JSON tab, while the form-based property inspector occupies the Properties tab itself (see Section 13).

---

## Section 17 — Version Management via Git

Each GXW bundle contains a git repository. Git operations are performed in the browser by isomorphic-git, a pure-JavaScript git implementation that works against both IndexedDB-backed bundles and File System Access folders.

Commit policy:
- Auto-commit on every successful sketch reload. Default message: timestamp.
- User-initiated milestone commits via a "Save milestone" action that prompts for a description. Internally stored as a git tag.
- Time-based tags created by a background cleanup pass: one per hour for the last day, one per day for the last week, one per week for the last month.

Version history UI:
- A unified history panel listing versions.
- By default shows milestones prominently and time-based tags chronologically.
- A "show all versions" toggle expands to include auto-commits.
- Each entry: human-readable timestamp, description, click to view or restore.

Restore behaviour: "restore to this version" copies that version's files over the current ones, which triggers auto-reload and a new auto-commit. History stays linear from the user's perspective. No detached-HEAD confusion.

What gets committed: everything in the bundle except .git itself and anything in .gitignore. sketch.js, image.png, resources/. Image versioning means you can see when the background changed.

Pushing to a remote (GitHub, personal git server) is available via isomorphic-git's push support. Requires the user to provide credentials. Optional and secondary.

---

## Section 18 — Auto-Reload

When the active sketch is saved in the editor, GXW re-executes it after a short debounce (a few hundred milliseconds) to absorb multiple rapid writes.

Transport state is preserved across reload where possible. If the transport is playing when the sketch reloads, it keeps playing. Function definition changes take effect on next call. Scene construction changes apply as diffs: new objects appear, deleted objects disappear, existing objects update their declarative properties (position, functions, cursor extent, beat strings, and so on) while preserving runtime-dynamic state (current cursor cycle position, current velocity for sprites, strength-pointer position).

Module caches for files in resources/ are invalidated on reload, so changes to imported support modules are picked up too.

Auto-reload requires no user action. This behaviour is proven to work from GeoSonix, which had the same mechanism for JavaScript sketches.

Errors during reload do not block loading. Errors in scene construction cause the affected objects to be skipped, and the scene loads without them. Errors in function definitions cause affected functions to be skipped; curves, triggers, or sprites referencing them will fail when they fire. Errors are reported in the status area at the bottom of the editor window.

When bundles are stored in the File System Access API and modified externally, GXW polls for changes at a low frequency (every second or two) since browsers do not expose a filesystem notification API.

---

## Section 19 — Audio and MIDI Output

GXW produces sound internally via the Web Audio API. The default synthesis is an embedded voice bank sufficient for prototyping and most compositional work. A preferences panel lets the user choose among built-in voice options and adjust output levels.

For composers who want to drive external synthesisers or DAWs, GXW supports Web MIDI output on browsers that implement it (Chrome, Edge, and Firefox recent versions). Safari lacks Web MIDI support at time of writing; on Safari the built-in synthesis is the only option. The sketch specifies an output preference in setup():

```javascript
function setup() {
    bpm(120);
    output("internal");  // or output("midi", "IAC Bus 1");
}
```

Audio timing is scheduled against AudioContext.currentTime with a lookahead window. Events are scheduled a few frames ahead and fire at precise audio-clock times. This pattern gives sub-millisecond timing accuracy regardless of browser frame rate jitter.

Reintroducing richer synthesis via embedded engines (SoundFont, wavetable) is a possible future direction. Out of scope for initial version.

---

## Section 20 — Implementation

GXW is implemented as a static web application. Source files are HTML, CSS, and JavaScript (with JSDoc type annotations for IDE support). No build step is required for development; files are served directly by a local HTTP server during development and by any static host in production.

Core technologies:
- Language: Modern JavaScript (ES2022+) with JSDoc type hints.
- Editor: CodeMirror 6 for the tabbed sketch editor.
- Graphics: HTML Canvas 2D for scene rendering.
- Audio: Web Audio API for synthesis and timing.
- MIDI: Web MIDI API (where supported).
- Storage: IndexedDB (primary) and File System Access API (optional).
- Version control: isomorphic-git.
- AI authoring: Anthropic API via direct browser fetch with a lightweight authentication proxy.

No framework. Vanilla JavaScript with ES modules. Small helper utilities may be added as needed but there is no React, Vue, or similar.

Development workflow: edit files, reload browser. A simple local HTTP server (Python's http.server or similar) serves the project folder. Modern browsers' DevTools handle debugging. VS Code with the built-in JavaScript and TypeScript language server provides type checking from JSDoc annotations.

The repository is at /Users/chrisgr/ProgrammingProjects/GXW. The earlier Python prototype at /Users/chrisgr/ProgrammingProjects/GX2 is preserved but not referenced.

---

## Section 21 — Canvas Coordinate System

Canvas coordinates are Cartesian and origin-centred. The origin (0, 0) sits at the centre of the viewport. Positive X points right, positive Y points up. Both axes share the same metric — one unit in X represents the same displayed distance as one unit in Y — so geometry preserves its shape regardless of the viewport's aspect ratio.

The default viewport at zoom level 1 shows at least ±16 canvas units horizontally and ±12 canvas units vertically, a 32 × 24 region with 4:3 aspect. When the canvas pane's aspect ratio differs from 4:3, the visible region is extended along the longer axis rather than letterboxed, so no grid space is wasted — extra canvas simply shows.

The coordinate system has no inherent boundary. The visible region changes only through zoom, which is always centred on the origin: the viewport always shows the canvas centred on (0, 0) regardless of zoom level. Panning is not supported.

Images, when loaded into a scene, are stretched to fit the ±16 by ±12 default region (32 × 24 units). Any source aspect ratio becomes 4:3. This is intentional: images serve as scalar fields providing colour and luminance, not pictures to be viewed for their own sake, so stretching is acceptable. This inherits GeoSonix's behaviour.

The grid is drawn at 1-unit spacing, with the X=0 and Y=0 axes rendered slightly brighter than the minor grid so the origin is visually anchored. Major 5-unit lines may be drawn slightly brighter than minor 1-unit lines for a subtle ruler effect. No numeric labels — the grid is frequent enough that position can be read by counting cells.

Zoom methods: a View menu with Zoom In, Zoom Out, and Reset Zoom items; keyboard shortcuts (Cmd-plus, Cmd-minus, Cmd-0); and the mouse scroll wheel while the pointer is over the canvas. All three converge on the same Transport-style state; zoom always centres on the origin.

Sprite visual rendering: drawn as a filled circle, default 1.5 canvas units diameter, for composer visibility. The diameter is a display-only setting; sprites themselves are points with no spatial extent (see Section 6).

Trigger render size: controlled per-trigger by its size property, which also serves as the collision radius. Default 0.4 to 0.6 canvas units; the glyph shape indicates payload type.

Curve rendering uses canvas units directly for geometry. Beat points are drawn as tick marks sized by a system constant that reads well at typical zoom levels.

---

## Section 22 — Sprite Physics Details

Canvas units are origin-centred with equal metric along both axes (see Section 21).

Sprite visual rendering diameter user-settable, default 1.5 canvas units. This is purely a display setting (see Section 6); sprites are points geometrically and have no spatial extent. The only collision sprites participate in is canvas-boundary reflection, which works against the sprite's point position.

Velocity ceiling, two-level:
- maxSpeed: user-settable per sprite, default 16 canvas units/sec, range 1 to 64.
- absoluteMaxSpeed: hard system ceiling of 64 canvas units/sec, enforced every step.

Applied by scaling the velocity vector to preserve direction.

At absoluteMaxSpeed=64 and dt=1/60, max travel per step is ~1.07 units. Since sprites are points (they don't collide with triggers or curves or each other), the only collision detection is against the implicit canvas-boundary box, which is straightforward even at high speeds.

Bounding region: since the canvas has no inherent boundary, sprites are contained by an implicit bounding box matching the default viewable region (±16 by ±12 units) against which they collide and reflect. A scene or sprite may configure a larger or smaller box, or disable bounding entirely (letting sprites fly off indefinitely). Default bounding is on.

Boundary collision detection: continuous within each time step. Calculates exact time when sprite reaches each wall, moves to that point, reflects velocity, continues for remaining time. Up to 10 bounces per step resolved. Final position clamp as safety net.

Reflection: angle of incidence equals angle of reflection. Speed preserved exactly. Corner hits reflect both components.

Physics step order:
1. Sprite step function is called (if defined).
2. Sample vector field at current position.
3. Integrate velocity and position.
4. Apply velocity ceiling.
5. Resolve boundary collisions.
6. Sample image colour at final position (for next frame's context).
7. Check auto-timer firing against transport.

Curve cursor motion is not physics-integrated. Cursors advance along their curve's geometry at the rate set by cycleDuration and the cycleSpeeds modulation list, evaluated against transport time. Continuous-collision detection applies to cursor-trigger interactions: the cursor's sweep segment from its previous position to its current position is tested for intersection against trigger disks.

Physics may run in a Web Worker so that audio-rate scheduling on the main thread is not starved. Final architecture of the physics-worker split is to be determined during implementation.

---

## Section 23 — Module Overview

JavaScript modules in dependency order:

1. Image — 1000x1000 pixel array, colour sampling, file loading, resampling.
2. Field — vector force at any position, combining sources and optional image-gradient contribution.
3. Trigger — position, size, payload, collision and auto function references.
4. Sprite — position, velocity, step and auto function references, integrates field and boundary collisions.
5. Curve — geometric shape, beat points (active-beats and strength strings), cursor (with R/L extent), beat and sweep function references.
6. BeatPoint — the per-position firing record within a curve (internal representation; not a separately-addressable object).
7. Scene — holds image, field, regions, curves, triggers, sprites, and score-level harmony parameters.
8. SceneLoader — parses scene.json plus behaviours.js with Acorn, resolves function-name references against behaviours' top-level declarations, builds a Scene. Replaces the v2.0 SketchRunner.
9. SceneEditor — pure parse/mutate/stringify functions for scene.json text, used by canvas direct-manipulation operations to commit edits without disturbing the editor's view of the file. Includes addSpriteAt, setSpritePositions, removeObjects, plus a custom stringifier that approximates the hand-written formatting style of the default template.
10. Transport — global clock, tempo, beat position, play state, AudioContext integration.
11. Phrase — time-indexed event sequence emitted by curves, triggers, and sprites.
12. Audio — Web Audio synthesis, voice management, output routing.
13. MIDI — Web MIDI wrapper, scheduling, port management.
14. Simulation — fixed time step, advances curve cursors, runs sprite physics, detects cursor-trigger collisions, fires functions at the appropriate times.
15. Bundle — loads, creates, saves, duplicates, and lists the files within score bundles in IndexedDB.
16. VersionControl — isomorphic-git wrappers, commit on reload, milestone tags, time-based tags, history queries.
17. UI — top menu bar, canvas pane (with toolbar), tabbed editor (form-based Properties tab via the Inspector module, Behaviours tab for behaviours.js, transitional Properties JSON tab for raw scene.json), bottom message area, AI authoring pane, deferred history panel.
18. Canvas — the rendering surface plus the gesture machinery: hit-testing, selection state, marquee drag, sprite drag-to-move, click-to-place when a creation tool is armed.
19. Toolbar — horizontal strip across the top of the canvas pane holding object-creation tools. Owns the idle/armed/locked state machine and the click-versus-double-click disambiguation; communicates outward via an onChange callback consumed by the Canvas.
20. Inspector — form-based property inspector for the Properties tab. Subscribes to the canvas's selectionChanged event and renders six bands of fields with selection-driven greying. Blank when nothing is selected. v1 is layout-only; data binding from scene.json into field values is the next milestone.
21. DiskMirror — deprecated at v2.2 (see Section 25 question 17). The module remains in the codebase for users who opt in via Settings, but is not actively recommended.
22. AIAuthoring — conversation pane, Anthropic API integration, scene.json/behaviours.js edit application.
23. Compositor — deferred.

Note that several v1.0 modules have been removed: Event (replaced by Trigger), Projector (folded into Curve), DistortionFunction (folded into Curve's sweep function), BeatPattern (removed; curves own their rhythm intrinsically, sprites and triggers use a simple interval). MessageFunction as a separate module is also gone; functions are plain JavaScript referenced by name from object properties. v2.1 renamed the Mover module to Sprite. v2.2 split SketchRunner into SceneLoader (which reads scene.json and behaviours.js) and added SceneEditor (which writes scene.json) plus Toolbar (object-creation tools). v2.3 (in progress) added the Inspector module for the form-based property inspector that now occupies the Properties tab.

---

## Section 24 — GeoMaestro and GeoSonix Reference

GXW succeeds two earlier programs.

GeoMaestro (Stéphane Rollandin, 2000-2004, KeyKit-based) is archived at /Users/chrisgr/ProgrammingProjects/GeoMaestro/doc/. Entry points: READ_ME_FIRST.txt, eGM0.html, CHANGES.txt for design evolution, paper1.html and paper2.html for conceptual introduction.

GeoSonix (Chris Graham, ~2012, Qt/IanniX-derived desktop app) was a predecessor by the same author. Source is not preserved, but the compiled app and ~33 sample score files in /Users/chrisgr/Documents/Geosonix Scores provide extensive reference. GeoSonix used JavaScript as its sketch language; GXW's JavaScript choice is partly continuity with that lineage.

Carried forward from GeoMaestro:
- Timeless scenes with musical atoms at spatial positions (now called triggers in GXW, formerly called events in GeoMaestro).
- Curves with projector-style sweeping behavior (now a property of every GXW curve via cursor extent).
- Distortion-function pattern — sweep function with distance/angle/side context (now the Curve sweep function's context).
- Piste (polyline path) as a geometric primitive.
- Compositor concept.
- Event payloads including callbacks.
- Open-ended user scripting.

Carried forward from GeoSonix:
- Moving autonomous agents (called sprites in GXW) that read image colour and wander fields.
- JavaScript sketch language with named-function references from object properties.
- Script editor with multi-granularity execution (the specific selection/line/function/all pattern is deferred to a future milestone — see Section 25).
- Beat-point rhythms intrinsic to curves, authored by Euclidean generator or direct string.
- Two-string rhythm model (active-beats plus strength) with independent cycling for polyrhythmic drift.
- Emphasis values 0-9 per firing.
- Per-object harmony overrides layered on score-level harmony.
- MIDI routing per object (port, channel, base note).
- Time-shift in ticks per object (deferred to a future milestone).
- Extended cursor with left/right extents as the collision mechanism.
- "Beats are triggers" property for cross-curve cascading.
- Named shared functions invoked by multiple objects via name lookup.
- Auto-reload of external sketch files.
- Resources folder for support modules.
- Scale/chord/tonic/root as score-level musical framework.
- Property-inspector vocabulary (deferred but informing Section 25).

Simplifications in GXW relative to both parents:
- Three object types (curves, triggers, sprites) replacing GeoSonix's four (curves, cursors, triggers, plus the Score).
- One collision rule (extended cursor hits trigger) replacing five firing types in GeoSonix.
- No separate Projector type — the GeoMaestro projector is a curve with extended cursor.
- No separate DistortionFunction concept — distortion behavior lives in the curve's sweep function.
- No separate BeatPattern resource — curves own rhythm intrinsically; sprites and triggers use simple intervals.
- No separate Cursor object — the cursor is part of its curve, not independently addressable.
- Sprites do not have collision functions — they only initiate musical events, never receive them.

Terminology note. The autonomous-agent object is called "Sprite" in GXW, a term borrowed from game development where it is widely understood. v1.0 and v2.0 called this object "Mover"; v2.1 renamed it to Sprite for vocabulary clarity. No behavioural differences.

Capabilities not yet decided whether to carry forward:
- 3D positions. GeoSonix had Z coordinates and a 3D rendering mode. GXW currently specifies 2D (with image sampling as a scalar field doing the work 3D was sometimes used for). The screenshots and score files show Z=0 throughout, suggesting 3D was rarely used in practice. Deferring unless demand emerges. See Section 25.
- Populate-beat-points-with-triggers as an authoring action. GeoSonix offered this and the user found it added friction. The "beats are triggers" property on curves covers the musical capability without requiring the extra trigger objects. Not implemented as an action.
- Per-object time-shift-in-ticks. Useful compositional capability but adds fields to property editors. Deferred.

---

## Section 25 — Open Questions

1. Property inspector design. v2.3 ships v1 of the form-based property inspector as the primary Properties tab: six bands (identity; geometry and visual; message functions; auto message interval; beat points; cycle parameters) sized by their constraint rows, with selection-driven greying based on which kinds appear in the canvas selection, and a blank state when nothing is selected. The natural minimum form width is roughly 500 pixels, set by the Auto Message Interval row and the Cycle Parameters row 2. v1 is layout-only — fields show placeholder values rather than live data. Open and remaining: live data binding from scene.json into the form (the next milestone); a commit pipeline so inspector edits flow through the same parse-mutate-stringify path the canvas toolbar uses; multi-select rendering refinements (varies indicators, tri-state checkboxes for partially-checked Enable/Hide); how function-slot bindings are entered (a dropdown of names sourced from behaviours.js, free text, or both); the Create button scaffolding stub functions in behaviours.js when the named function does not yet exist; how the inspector composes with manual JSON editing when both can modify the same object (see also question 3 below); and how far into advanced fields (harmony overrides, per-object MIDI routing) the inspector goes before falling back to the Properties JSON tab.

2. Object-creation toolbar design. v2.2 ships the first iteration: a toolbar above the canvas with a single tool, Add Sprite. State machine: idle, armed (one-shot), locked (repeating). Single-click arms, double-click locks, Esc disarms, click on the active tool disarms at any state. Add Trigger and the curve-shape tools are the next additions. Open: whether shape variants (line, circle, piste, bezier) are one tool with a dropdown or separate tools — v2.2 leans toward separate tools matching GeoSonix's toolbar, since each shape places differently (single click for circle, click-drag for line, click-click-...-double-click for piste).

3. Editing routes and synchronisation. v2.2 settled the question raised in earlier versions: scene data is its own file (scene.json) separate from behaviour code (behaviours.js), so the historical "sketch versus inspector data store" tension dissolves. There is one source of truth (scene.json) that three routes will be able to edit: the Properties JSON tab in the editor, the canvas toolbar and gesture system, and the form-based property inspector once data binding ships. The canvas's edit pipeline (parse → mutate → stringify → update bundle → refresh editor view → re-run scene) preserves field ordering and approximates the hand-written formatting style of the default template; the inspector will use the same pipeline when its edits go live. Open: how the property inspector composes with manual JSON editing when both can modify the same object — inspector edits during JSON dirty state should probably be blocked with a message, the same way canvas edits are blocked when the JSON has a parse error.

4. REPL / workspace execution model. GeoSonix maintained a persistent JavaScript workspace and allowed the composer to execute individual lines, selections, functions, or the whole script from within the script editor. This is a valuable pattern for incremental development. GXW currently specifies "save-triggers-reload" which is simpler but less interactive. Whether to add GeoSonix-style workspace execution in a later milestone is open.

5. Vector field normalisation algorithm.

6. Sprite step function mutation conventions. Currently the step function both mutates the sprite (via this.vx = ...) and fires events (via return value). Should mutations be wrapped in a helper function for clarity, or is direct assignment idiomatic enough? Is returning null to not fire clear enough, or should there be a separate explicit "fire" helper?

7. Sprite-fires-trigger-by-proximity pattern. This is the common case the step function will handle. Should GXW provide a helper like `ctx.nearbyTriggers(radius)` so the composer doesn't have to write the scene-scan logic by hand every time? If so, what's the API?

8. Full curve shape catalogue beyond the initial four or five.

9. Distortion helper library. GeoMaestro had a rich catalogue of named distortion functions (Volume, Pit, Dur, Pan, Time, Mer). GXW folds these into the curve's sweep function, but named presets for common distortion patterns would speed authoring. Open whether to ship a standard library of them.

10. Curve sweep-modulation by internal beat pattern. A curve's cursor could advance non-uniformly, pausing on silent beats and accelerating through high-strength beats, driven by the curve's own rhythm. This is a compositional capability from GeoMaestro's projector modulation. Whether to expose it in the initial release is open.

11. Per-agent tempo overrides.

12. External transport sync (Ableton Link, MIDI clock).

13. Multi-scene scores and how scenes relate in the Compositor.

14. Compositor design in detail.

15. Default internal synthesis voice bank scope and quality.

16. Web Worker boundary for physics and simulation.

17. Anthropic API authentication model — direct in browser, lightweight proxy, or user-supplied API key. v2.2 deprecated the disk-mirror approach (which was an attempt to side-step in-browser API access by giving Claude Desktop direct filesystem access through MCP). v2.3 introduces the AI Handoff feature (see Section 15) as a simpler user-controlled successor for sharing scores with Claude through a configured folder. The longer-term direction beyond v2.3 is an embedded API key letting Claude operate on score state through the same in-memory pipeline as the canvas toolbar. Open questions remain about credential storage (where the key lives, how it's protected from accidental exposure in screenshots and exported bundles), rate limiting, cost transparency, and whether scene-edit operations should run as tool calls (Claude proposes structured edits that GXW applies through the same parse-mutate-stringify pipeline as the canvas toolbar) or as free-form JSON rewrites.

18. 3D support. GeoSonix had Z coordinates but in practice kept Z=0 almost everywhere. GXW specifies 2D. Whether to reintroduce Z is open; current decision is to defer.

19. Video instead of static images for the scalar-field background.

20. MIDI input for score parameter control.

21. OSC output via WebSocket bridge.

22. Default helper functions in the mapping library beyond the initial set.

23. Bundle sharing mechanism — URL-based, export file, hosted gallery.

24. Save-snapshot / recall-snapshot feature. GeoSonix's .score format suggested the possibility of multiple named snapShots of scene state. Whether GXW supports this is open; the sketch re-execution model already makes scene state reproducible from source, so snapshots would be a convenience for exploratory work more than a necessity.

25. Unified bound-trigger model. Section 10.5 captures a proposed evolution that visualises and treats curve beat points as triggers bound to their parent curve, rendered as diamonds rotated so two opposite vertices lie on the curve, with shared inheritance from the curve, an external-visibility setting controlling exposure to other curves' cursors, and a whichever-has-a-function-wins rule for resolving cursor sweep functions against trigger functions. Open issues within the proposal: the both-defined case for the function-precedence rule (the choice between both-fire-in-order and delegation), the inspector wording for the visibility setting, and the pattern-grammar design for the phrase-pasting future direction (encoding per-beat pitch and payload alongside the existing strength data so a melodic phrase can be pasted onto a curve as bound triggers). The proposal sits in a post-v2.3 milestone window; the v2.3 property-inspector work does not need to anticipate it.

---

*End of design document version 2.2*
