# GXW Design Document

Version 2.4 — Updated April 2026
Status: Living document.

Naming: GXW is the web-based successor to GeoSonix. The W stands for Web. The project folder and repository live at /Users/chrisgr/ProgrammingProjects/GXW. An earlier Python desktop prototype, GXM, exists at /Users/chrisgr/ProgrammingProjects/GX2 and remains preserved as reference; GXW supersedes it as the active development path.

Revision v2.4 specifies the message-function model that drives sprite motion and event firing across all three object kinds. Section 9 is rewritten to reflect the resolved callback names (Motion Update and Auto on sprites, Collision and Auto on triggers, Hit Beat and Hit Trigger on curves), the acceleration-return shape for sprite Motion Update, the shared-default rule that has every sprite running one common Motion Update function unless the composer creates a per-sprite override, and the auto-generated function-naming convention that combines callback role with object name (hitTrigger_drum, auto_kick) to produce sensible defaults the composer can accept with a single click. The behaviours.js file in the score bundle carries these named functions; it is edited in the same CodeMirror tab as the score's other text files. Section 9 also documents the simulation tick order through which Motion Update integrates: clamp velocity to maxSpeed, run Motion Update for acceleration, apply acceleration to velocity, clamp again, integrate position, resolve walls under the inside-only rule from Section 22.

Revision v2.3 introduces an accessibility section (Section 26) and a first feature within it: perceptual brightness reduction for imported background images. The transformation is spatially aware — a base/detail decomposition that pulls down large continuously-bright regions while leaving small bright features and midtones untouched — so that broad bright areas of an imported image stop dominating the canvas while local contrast and detail throughout the image remain readable. The transformation affects only the displayed image; the underlying pixel data used by triggers and sprites for music generation passes through unchanged. Three parameters (blur radius, threshold, maximum attenuation) are exposed as user settings with a bypass toggle for direct comparison. See Section 26.

Revision v2.3 also locks down the full per-curve musical-timing model and the three-mode beat-points authoring system, both of which had been partially specified in earlier revisions. Each curve now carries its own time signature (beatsPerBar with beatInterval as the denominator) plus a beatOffset shifting the cursor's score-beat-zero position, in addition to the existing cycleDuration field. The score-level time signature is removed from the transport in this revision, with a future revision possibly reintroducing it as something curves can opt to inherit. Beat-points authoring acquires three modes — normal (the composer types the active-beats string), euclidean (the inspector generates the string from numeric parameters), and none (no beats fire) — with the active-beats string remaining the engine's source of truth across all modes. Pattern strings accept space and pipe characters as visual formatting that the engine strips before interpretation; pipes auto-insert at bar boundaries to give immediate visual confirmation of completed bars as the composer types. The strength string's cycling semantic is changed from the prior pointer-based model to a slot-modulo model — slot k reads strength[k mod len(strength)] regardless of whether the slot fires — which makes active-beats and strength cycle on the same slot-index master clock and admits clean reasoning about polyrhythmic drift between coprime-length strings. See Section 7 for the transport changes and Section 10 for the full beat-points and strength-string treatment.

Revision v2.2 documents several changes that have accumulated since v2.1.

The bundle file layout was split: a score's data and its behaviour now live in two files — scene.json (declarative data: piece-level parameters plus arrays of curves, triggers, and sprites with their declarative properties) and behaviours.js (named JavaScript functions referenced from scene.json by name). The scene loader stitches them together at run time. This split makes scenes editable through structured tooling — a property inspector, AI assistants operating on JSON, a graphical editor — without competing with the JavaScript editor for the same source. See Sections 14 and 16.

Direct manipulation of the scene through a canvas toolbar arrived. A toolbar above the canvas exposes object-creation tools (Add Sprite at this milestone, with Add Trigger and the curve-shape tools to follow), and the canvas itself supports selection (click, shift-click, marquee) across all three object kinds, drag-to-move for sprites, and Delete-key removal across all kinds. Canvas edits flow through scene.json text mutations that respect the existing explicit-save model. See Section 13.

Disk mirroring (the v2.1-era attempt to make scores accessible to AI assistants via a folder on disk that polls for external changes) is now deprecated. The browser permission lifecycle proved too fragile to rely on, the File System Access API doesn't expose absolute paths to assistants, and the round-trip introduced subtle bugs. The code is preserved unchanged but is not actively recommended; the Settings → Storage panel still exposes the controls for users who want to opt in. The successor in the v2.3 milestone window is the AI Handoff feature: a simpler user-controlled export-and-reload mechanism for sharing the current score with Claude through a configured folder. The longer-term direction beyond v2.3 is an embedded API key letting Claude operate on score state through the same in-memory pipeline the toolbar and inspector use, eliminating the disk hop entirely. See Section 15 for the AI Handoff design and Section 25 question 17 for the embedded-API-key direction.

Curve cycle parameters were simplified. The GeoSonix triplet of cycleDuration, cursorSpeed, and cycleTime collapses to a single stored field — cycleDuration, the cycle's duration in score beats — with cycleSpeeds and stopAtCycle providing per-cycle modulation and finite playback respectively. The Time Lock toggle that GeoSonix needed to disambiguate which of the three was the source of truth disappears with the unification. The active-beats and strength strings both become free-length cycling rather than the active-beats string being pegged to beats-per-cycle, which removes the beatsPerCycle field. See Section 4 for the new cycle-parameter model and Section 10 for the rhythm-string model.

Underlying revisions v2.0 and v2.1 remain in effect: the three-object model (Curves, Triggers, Sprites) and the Mover-to-Sprite renaming. No conceptual changes to the object model in v2.2.

The underlying v2.0 rework remains in effect: a substantial reshaping of the object model following detailed comparison with both GeoMaestro and GeoSonix. The v1.0 split between Projectors and Movers has been replaced by a three-object model — Curves, Triggers, and Sprites — that better reflects the compositional vocabulary the composer actually uses. Several v1.0 concepts have been removed or folded in: the separate Projector type, the separate Cursor object, the Distortion Function as a first-class concept, and the cross-paradigm BeatPattern resource. The GeoMaestro projector capability is preserved through the Curve's extended cursor; distortion behaviour lives in the Curve's Hit Trigger function (called the sweep function in earlier revisions; renamed in v2.4 along with the broader callback-naming review). See Section 24 for the discussion of what survived from each parent system and why.

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
- [Section 26 — Accessibility](#section-26--accessibility)
- [Section 27 — Tonal and Strudel Integration](#section-27--tonal-and-strudel-integration)

---

## Section 1 — Vision

GXW is a web app for composing music that emerges from 2D scenes. A scene is a substrate of curves and triggers placed at considered positions. Curves have intrinsic rhythmic structure and play their own beat points on internal cycles; curves with extended cursors also sweep through the scene, triggering any triggers they encounter — this is the GeoMaestro projector idea preserved as a property of every curve. Sprites are autonomous agents that wander the scene, reading its image-as-scalar-field and firing musical events based on their environment. All agents share one transport and one musical framework.

The composer works by editing a JavaScript sketch file describing the scene, its objects, and their behaviour. GXW watches the sketch and re-executes it whenever it changes. A canvas shows the scene and its animation. Sound is produced by the browser's Web Audio API, and optionally routed to external synthesisers via Web MIDI where supported.

Sketches are typically constructed and modified through conversation with Claude, which edits the sketch directly. The conversational authoring experience is a first-class concern of GXW rather than an external workflow.

---

## Section 2 — Conceptual Model

A GXW scene holds three kinds of first-class objects — curves, triggers, and sprites — plus an optional background image that acts as a scalar field and a transport that keeps global tempo and time.

Curves are geometric shapes (line, ellipse, piste, bezier, and other named forms) with intrinsic rhythmic structure. Each curve has a set of beat points distributed around its shape according to an algorithmic generator (primarily Euclidean) or a hand-authored pattern string. Each curve has a visible cursor that advances through its cycle over a settable number of beats. When the cursor reaches an active beat point, the curve's Hit Beat function fires. If the cursor has non-zero extent on either side of the curve direction, it sweeps through space as it advances, and any triggers in the swept region fire the curve's Hit Trigger function. Curves combine geometry, rhythm, and projection into one coherent compositional object.

Triggers are static positions in the scene with optional payload. They do not move. They fire when a curve's extended cursor sweeps over them, or on an optional auto-timer. Triggers are the free-standing musical atoms of the scene — positions the composer places with compositional intent.

Sprites are autonomous agents that move through the scene under their own logic. Each sprite has a Motion Update function called every physics step, in which it reads its environment (image colour under its position, vector field forces, transport state) and returns an acceleration vector that the simulation adds to its velocity before integrating position. Sprites do not collide with anything; they fire musical events through an Auto function on a beat-aligned timer or by side effects inside their Motion Update logic. The sprite is the autonomous-creature-in-a-field idea from GeoSonix, made first-class.

The transport is global: tempo, time signature, beat position, play state. All objects reference it. Curves advance their cycles from transport time. Triggers tick their auto timers from transport time. Sprites integrate physics against transport time. One shared clock keeps everything rhythmically locked by default.

Three object types, each with a clear compositional role. Two collision participants (the curve's extended cursor as collider, the trigger as collidee), one direction of interaction. Three function-slot budgets per object type, each slot named for what it reacts to. The mental model fits in a paragraph.

---

## Section 3 — Scene Structure

A scene's data model:

- An optional image, resampled to 1000x1000. The image is a scalar field: at any 2D position it provides r, g, b, luminance, hue, saturation. Consulted by sprites (via their Motion Update functions) and available as context fields in all other functions.

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

Shape. A curve has a geometric form — line segment, ellipse, piste (polyline), bezier, or a more elaborate named type (helice, rose, spiral, and other shapes from the GeoMaestro catalogue). The shape defines the curve's spatial presence and the path along which the cursor advances. Shape types in implementation priority order: line segment, ellipse, piste, bezier, helice. A circle is an ellipse with equal width and height — the two are stored as one shape primitive so that a toolbar-created circle and a runtime-distorted ellipse share one geometry, and the inspector's W and H fields can be edited independently without the shape's type string flipping as a side effect of typing in a number.

Beat points. A curve's rhythm is defined by two independent strings — active-beats and strength — plus a beat-points mode controlling how active-beats is authored. The active-beats string uses "x" and "." to mark which slot positions fire; the strength string uses digits 0–9 to set the emphasis of each firing. Both strings cycle independently as the cursor advances through the cycle's slots, so each can be any length the composer chooses; when the two lengths do not share simple ratios with each other or with cycleDuration, the audible rhythm pattern evolves slot-to-slot as the strings drift, a generative property the composer can deliberately exploit. The mode field selects between three authoring routes — normal (compose the string by typing), euclidean (generate the string from numeric parameters), and none (no beats fire) — without changing what the engine sees: the active-beats string remains the engine's source of truth in every mode. Beat points render as tick marks along the curve at the cycle positions corresponding to the active beats, with active positions visually distinguishable from inactive ones. Active beat points pulse briefly when fired, with the pulse's brightness reflecting the firing's current strength. Strength-zero firings emit musical events at velocity 0 (semantically distinct from a rest, which emits no event); they do not produce audible sound on most synthesisers but they do count as firings. Section 10 is the full treatment.

Cursor. A curve has a visible cursor that advances through its cycle at a rate governed by the curve's cycleDuration field (see "Cycle length and per-cycle modulation" below). The cursor has two extent values, R (right of curve direction) and L (left of curve direction), set independently. When both are zero, the cursor is a single point on the curve — purely a progress indicator with no spatial presence, visible only to the composer watching playback. When either R or L is non-zero, the cursor becomes a line segment of that length perpendicular to the curve's direction, and as the cursor advances, the segment sweeps through space.

Extended cursors collide with triggers in the scene. This is the GeoMaestro projector capability preserved as a property of every curve. A line-segment curve with R=5 and L=5 sweeping from A to B over 4 beats is a classic projector. Setting both extents to zero turns the curve back into a pure rhythmic player with no spatial sweep. The extent is continuous property, not a mode switch — any curve can be a projector by setting extent, or stop being one by setting it back to zero.

Functions. A curve has two optional function slots:

- The Hit Beat function fires when the curve's cursor reaches an active beat point during internal cycle advancement. It does not fire on external collisions — hits on the curve's beats from other curves' cursors fire the curve's Hit Trigger function instead, since under the bound-trigger model (Section 10.5) those beats are external triggers from the colliding curve's perspective.
- The Hit Trigger function fires when the curve's extended cursor collides with a trigger in the scene (a free-standing trigger or a beat-as-trigger on another curve). It does not fire on internal beat points.

Either or both slots may be undefined. A curve with only a Hit Beat function and a zero-extent cursor is a rhythmic player. A curve with only a Hit Trigger function is a projector that doesn't play its own beat points. A curve with both is a rhythmic projector that simultaneously plays its own rhythm and sweeps other objects. A curve with neither is pure visual scaffolding, drawn but silent.

Beats-as-triggers property. A curve has a "beats are triggers" property (default false). When true, the curve's active beat points become externally collidable — another curve's extended cursor sweeping across these positions will fire them, with context including which curve was hit and which beat point was struck. See Section 10 for how the strength string cycles under external collisions.

Cycle length and per-cycle modulation. A curve's cycle is divided into slots. cycleDuration (positive integer, default 4) gives the number of slots; beatInterval (string token, default "Qtr") gives each slot's musical duration. Together they determine how long the cursor takes to traverse one cycle of the curve in score time: cycleDuration × beatInterval expressed in quarter-notes at the score's current tempo. beatInterval is drawn from a fixed dropdown of musical note values spanning 384th-note up to four-whole-notes per slot (full list in Section 10), so different curves can quantize to different note values within the same score, producing polyrhythmic and polymetric textures. beatsPerBar (positive integer, default 4) is the numerator of the curve's time signature with beatInterval as the denominator — beatInterval Quarter with beatsPerBar 3 reads as 3/4 time, beatInterval 8th with beatsPerBar 6 reads as 6/8. beatsPerBar drives the inspector's visual structure of the active-beats and strength strings (see Section 10's pipe-character rule) and is reserved for future bar-aware features (per-bar chord changes, downbeat emphasis, bar-aligned canvas rendering); it does not affect cursor traversal timing. beatOffset (signed integer, default 0) shifts where the cursor sits at score-beat zero by that many slots, which is also where rewind sends the cursor — a beatOffset of 2 makes the curve's slot 0 fire two slots' worth of musical time after the score begins. Cycle time in seconds is derived at runtime from cycleDuration, beatInterval, and the score's BPM; never stored, so a tempo change rescales every curve's cycle time automatically without per-curve adjustment.

This collapses the GeoSonix triplet of cycleDuration, cursorSpeed, and cycleTime into one duration field, which removes the Time Lock checkbox that GeoSonix needed to disambiguate which of the three was the source of truth at any moment. The musical capability that GeoSonix's Cursor Speed field provided — temporal modulation of the cursor's traversal — is preserved through two other fields described below.

cycleSpeeds is a string of space-separated numeric multipliers (default "1") applied to the cycle's score-time duration cycle by cycle. With cycleSpeeds = "0.4 2 -1", the first cycle takes 0.4 × (cycleDuration × beatInterval) quarter-notes, the second takes 2 × the same, the third reverses direction at the same per-quarter-note rate (negative values reverse), and the list cycles when it runs out. Single-value lists like "1" or "0.5" produce uniform cycle pacing; multi-value lists produce per-cycle modulation including reverse motion. Fractional values are allowed. The multiplier scales the cycle's wall-clock duration, not its slot count: every slot is visited every cycle regardless of speed, so the rhythm pattern encoded in the active-beats and strength strings plays in full at any speed (a 0.5 multiplier compresses the same pattern into half the time; a -1 multiplier runs it backward in normal time). Each slot's effective musical duration during a cycle is therefore beatInterval × |speedMultiplier|, with the sign of speedMultiplier controlling cursor direction.

stopAtCycle is an integer (default -1) that halts the cursor after a specified number of cycles. The default -1 means play forever; setting it to 3 means the cursor completes three full cycles and then stops, regardless of what's in cycleSpeeds. Useful for finite-length compositional gestures and for cycle-counted phrases.

---

## Section 5 — Triggers

A trigger is a static musical position in the scene. It has:

- A position in canvas coordinates.
- A size, which serves as the collision radius for cursor-sweep detection.
- Optional payload — a note specification, controller value, parameter set, pre-rendered phrase, or callback function. Used by the firing function as this.note, this.cc, etc.
- Up to two optional function slots:
  - A Collision function fires when a curve's extended cursor sweeps over the trigger. Context includes the curve that hit it and the hit geometry.
  - An Auto function fires on the trigger's own timer at an interval set in the trigger's properties.

Both functions are optional. A trigger can be pure data — position and payload with no functions — in which case nothing fires when the trigger is hit. This is specifically useful when the composer wants the colliding curve's Hit Trigger function to do all the musical work, reading the trigger's payload as context. See Section 8 for the collision resolution rule that makes this pattern work.

Triggers do not move. They do not observe the scene. They do not carry per-step logic. They sit at their position and fire when hit or when their auto timer ticks.

---

## Section 6 — Sprites

A sprite is an autonomous agent that moves through the scene under its own logic.

Geometry. A sprite has a position, a velocity, and a visible disc rendered at its position with a configurable display diameter. The disc is the sprite's visual presence on the canvas; the display diameter combined with the score's spriteScale also defines the bounding circle the simulation uses for canvas-wall collision under the inside-only rule (Section 22). Sprites do not collide with triggers, curves, or other sprites — see Section 8 — so the disc plays no role in object-to-object collision; it serves only the wall-bounce check and the visual identity of the sprite on the canvas.

Motion. Sprites move freely in the scene. They are not path-constrained — if the composer wants sweep-along-a-path behaviour, that is handled by a curve with an extended cursor, not by a sprite. Each sprite has authored x, y, vx, vy, and maxSpeed fields in scene.json that define its initial state at score-beat zero and its rewind state. At runtime the simulation maintains a separate per-sprite runtime state holding the live position and velocity; the canvas reads this runtime state for rendering and hit-testing, while the inspector continues to display the authored fields for editing. See Section 22 for the integration step, the inside-only wall rule, and the runtime/authored split.

Functions. A sprite has two optional function slots:

- The Motion Update function is called every physics step before integration. It receives a context object describing the sprite's current state and environment (Section 9) and returns an acceleration vector `{ ax, ay }` that the simulation adds to velocity before integrating position. This is where image-driven wandering, gradient-following, viscosity, and other continuous physics responses are expressed. Motion Update does not fire musical events — it shapes trajectory only. Multiple sprites typically share one Motion Update function (the conventional default behaviour, see Section 9) since they share the same image and force field; per-sprite overrides are available when a sprite needs distinct physics.
- The Auto function fires on the sprite's own timer at an interval set in the sprite's properties. This is the rhythmic emission slot, used for sprites that play on a beat clock regardless of where they are or what they're doing. Auto returns musical-event parameters or undefined for silence; it does not affect motion.

Either or both slots may be undefined. A sprite with only a Motion Update function is a pure autonomous wanderer that produces no sound on its own — visible motion only. A sprite with only an Auto function is a metronome moving inertially under whatever initial velocity it was authored with. A sprite with both is the typical case: image-driven motion with rhythmic events. A sprite with neither is a position reference that drifts under pure inertia and walls.

Sprites do not have a collision function. They do not collide with triggers, curves, or other sprites. If a sprite wants to fire triggers based on proximity, its Motion Update or Auto function reads scene state and does so explicitly — "is there a trigger within 2 units of me, and did I just enter that radius?" is a three-line check inside the function body. This asymmetry — sprites only initiate, never receive — keeps the collision model single-directional and simple. See Section 8.

Soft UI convention: six sprites in the default palette, based on empirical experience from GeoSonix that parameter management past six becomes overwhelming. Not a data-model limit.

---

## Section 7 — Transport and Tempo

The transport is global, with state: BPM, current beat position, play/stop/pause/rewind, and optional tempo automation. Time signature is per-curve in v2.3 (see Section 10's beatsPerBar and beatInterval); the score-level transport does not carry a time signature in this revision. A future revision may reintroduce a score-level time signature that curves can opt to inherit through a per-curve flag, but the current model leaves time-signature decisions entirely with each curve, which directly enables polyrhythmic and polymetric textures across curves on the same canvas.

Curves convert their cycle time from slots to wall-clock seconds using cycleDuration × beatInterval × current BPM at evaluation time (see Section 4 and Section 10 for the per-curve fields). Tempo changes during a cycle affect pacing accordingly. Triggers' auto timers tick in beats, converted to wall-clock time via BPM. Sprites drive physics from the transport's beat clock — physics time step is expressed in beats; wall-clock mapping happens via tempo. Halving tempo doubles the time it takes a sprite to cover the same spatial trajectory; forces and field values don't depend on tempo, only pacing does.

Duration overrides: each curve's cycle time, each trigger's auto interval, and each sprite's auto interval can be specified in beats (default), absolute seconds (ignores tempo), or proportional units relative to some reference.

Per-object tempo override is available but deferred. Common case is one global tempo.

Determinism. The transport's job is to advance a beat counter; the simulation's evolution is exclusively a function of (initial scene state, elapsed beats), with no dependence on wall-clock timing during the run. Rewind resets every piece of dynamic state — sprite positions, cursor positions, behaviour-internal counters — to whatever the scene declares as initial state, so a piece played from beat zero through to beat N produces the identical sequence of events on every replay regardless of how fast the audio callback runs in wall time. This determinism property is the foundation for repeatable composition (the composer can rate a piece without it changing under them) and for offline rendering (the same simulation, run faster than realtime, produces sample-identical audio output). The simulation's master time unit is integer ticks at 960 ticks per quarter-note, chosen so every value in the beatInterval dropdown maps to an integer tick count.

Transport controls are exposed in a bar along the bottom of the main window: a rewind button and a play-pause toggle on the left, followed by an elapsed-time readout and a BPM field. The BPM default is defined in the sketch's setup() function (see Section 14); BPM is editable at runtime from the transport bar for live experimentation, and runtime changes do not write back to the sketch, so a sketch reload restores the value defined in setup().

The transport clock is driven by the browser's AudioContext.currentTime, which provides sub-millisecond timing accuracy independent of animation frame timing.

---

## Section 8 — Collision Model

GXW has exactly one collision rule, applying to exactly one participant pair.

The collider. An extended cursor — a curve's cursor with non-zero R or L extent — is the only thing that initiates collisions. Cursors with zero extent are pure progress indicators and do not collide.

The collidee. A trigger is the only thing that can be collided with. Curves with the "beats are triggers" property true also expose their active beat points as collidees for this purpose, firing using the curve's Hit Beat function context augmented with external-collision information.

The rule. When a curve's extended cursor sweeps through a trigger's collision radius during a physics step, a collision event fires. Continuous collision detection within each step ensures a fast-moving cursor cannot skip past a small trigger between frames.

Functions fired on collision. Both the trigger's Collision function and the curve's Hit Trigger function fire, in that order, if both are defined. If only one is defined, only it fires. The composer chooses per object which function to define, which enables several compositional patterns:

- Define only the trigger's Collision function: the trigger controls its own firing regardless of which curve hit it. Each trigger sounds the same way no matter how it was struck. The classical trigger-as-sound-emitter pattern.
- Define only the curve's Hit Trigger function: triggers are pure data (position plus payload); the curve decides how to interpret each hit. This is the GeoMaestro distortion-function pattern — centralised firing logic reading trigger data as context. A single function with distance-based pitch and angle-based pan, applied uniformly to every trigger the curve sweeps.
- Define both: two things fire per collision. Useful when one function emits a note and the other logs, animates, or triggers a secondary effect.
- Define neither: silent hit. Rarely useful except as a placeholder during authoring.

What does not collide. Sprites do not collide — not with triggers, not with curves, not with other sprites. If a sprite wants to fire a trigger by proximity, its Motion Update or Auto function reads scene state and does so explicitly. Curves do not collide with other curves (except via the beats-as-triggers mechanism, which makes beat points collidable as triggers, not the curve itself). Triggers do not collide with other triggers.

This one-rule model replaces the five firing types of GeoSonix (cursor-auto, curve-auto, curve-beat, trigger-auto, trigger-collision) with an architecture where firing situations map one-to-one onto named function slots on the relevant object. Beat points fire on internal curve cycles via the curve's Hit Beat function. Triggers fire on auto timers via their Auto function or on cursor-sweep collisions via their Collision function (or the colliding curve's Hit Trigger function). Sprites fire on auto timers via their Auto function or by side effects from inside their Motion Update function. Each firing situation has its own named function slot, so no source-switching logic inside functions is needed.

---

## Section 9 — Function Slots and Context Objects

Each object kind has a fixed set of optional function slots whose names appear in the property inspector and whose semantics are described below. Defining a function means writing a named JavaScript function in the score's behaviours.js file and referencing it by name in the object's matching slot field; an empty slot leaves the corresponding event unhandled.

### Slot inventory

- Sprite: Motion Update, Auto.
- Trigger: Collision, Auto.
- Curve: Hit Beat, Hit Trigger.

The names describe the event from the firing object's perspective. Sprite Motion Update updates the sprite's motion every physics tick. Sprite Auto fires on the sprite's own beat-aligned timer. Trigger Collision fires when something collides with the trigger (currently only a curve's extended cursor; sprite-trigger collisions are a future milestone). Trigger Auto fires on the trigger's own timer. Curve Hit Beat fires when the curve's cursor reaches one of its own active beat points during cycle advancement. Curve Hit Trigger fires when the curve's extended cursor sweeps across a trigger or a beats-as-trigger position on another curve.

The pair Curve Hit Trigger and Trigger Collision describe the same physical event from the two participants' perspectives — the curve hit something, and the trigger was hit. Both functions fire when both are defined; the order is documented under Section 8 and Section 10.5. The asymmetric naming reflects the asymmetric perspective: "hit" is what the curve's cursor does, "collision" is what happens to the trigger. When the unified bound-trigger model in Section 10.5 lands, beat points become triggers themselves and the same Hit Trigger / Collision pair fires for cursor-on-beat events; Curve Hit Beat continues to fire only when the curve's own cursor reaches its own beats internally, never on external collision.

### The behaviours.js file

Callback functions live in a behaviours.js file inside the score bundle, alongside scene.json. The file is a regular bundle text file edited in the same CodeMirror tab system that hosts scene.json: full JavaScript syntax highlighting, parser-driven error squiggles, undo, and the existing explicit-save model. Edits to behaviours.js trigger a scene reload through the same pipeline that reloads on scene.json edits, so a saved behaviour change takes effect on the next runScene cycle without restarting playback.

The file's content is plain top-level function declarations:

```
function motionUpdate(ctx) {
    const c = ctx.imageColor;
    const brightness = (c.r + c.g + c.b) / 3;
    return { ax: (brightness - 128) * 0.5, ay: 0 };
}

function auto_kick(ctx) {
    return { note: 36, velocity: 96, duration: 0.1 };
}
```

No export statements, no module wrapper. The simulation evaluates the file once per reload and indexes its top-level function declarations by name; objects in scene.json reference functions by exact name in their slot fields. A name in scene.json that does not resolve to a function in behaviours.js is a soft error — the slot stays inert for that object, and the inspector renders the field's content with a warning indicator. The scene continues to run.

behaviours.js may also contain helper functions that are not bound to any slot; objects' slot bindings reference only the top-level functions, but the body of a slot function may call any helper defined elsewhere in the file. Helpers are typical for shared math or for response curves the composer wants to tune in one place across multiple slots.

### Auto-generated function names

When the composer clicks the Create button next to a slot field in the property inspector, the inspector generates a stub function in behaviours.js with a default name and binds the slot to it. The default name combines the slot's role with the object's typed name using the convention `role_objectName`, where `role` is one of `motionUpdate`, `auto`, `collision`, `hitBeat`, `hitTrigger`, and `objectName` is whatever the composer typed into the object's Name field. A trigger named `kick` with an empty Auto slot offers `auto_kick` as the default; clicking Create writes a stub `function auto_kick(ctx) { ... }` to behaviours.js and sets the slot field to `auto_kick`. The composer can edit the field before clicking Create to override the default name.

When the object has no typed name, the default falls back to `role_<id>` using the object's generated id (e.g. `auto_sp_a3f7`). The composer can rename the function and the field separately afterward; the binding is by name, so renaming the function in behaviours.js without updating the slot field breaks the binding and produces the soft error described above.

If the named function already exists in behaviours.js when the composer clicks Create, the button does nothing and is rendered disabled. The composer can either choose a different name (typing in the field changes the proposed default) or accept the existing function as the binding (in which case the field is left as-is, since the function is already there). This protects against accidental overwrites of behaviours the composer has already authored.

### Shared default for Sprite Motion Update

Sprite Motion Update is the one slot that defaults to a shared function across all sprites in the score. The convention is that all sprites typically inhabit the same image and respond to the same compositional intent (the same force field, the same colour-driven physics), so one function describing how a sprite responds to its environment usually suffices. The shared default function is named `motionUpdate` (no underscore suffix, no per-object qualifier) so its identity as the score-wide motion behaviour is encoded in its name.

The rule for the inspector's Motion Update field on a sprite:

- When the field is empty, the simulation looks up `motionUpdate` in behaviours.js. If it exists, every sprite with an empty field uses it. If it does not exist, every sprite with an empty field has no Motion Update and runs pure inertial physics (Section 22's milestone-2 behaviour: integrate by velocity, bounce off walls).
- The inspector field renders the implicit `motionUpdate` name as a placeholder hint when the slot is empty, so the composer can see what would be invoked.
- The Create button on an empty Motion Update field offers `motionUpdate` as the default name. Clicking Create when `motionUpdate` does not yet exist creates the shared function. Clicking Create when `motionUpdate` already exists is disabled (the function is already there; the empty field is already bound to it through the convention).
- The composer overrides the default for a single sprite by typing a different name into the field. The inspector then offers that name as the Create default — if the name is `motionUpdate_specialSprite`, clicking Create scaffolds that function. The override takes precedence over the shared default for that sprite only; other sprites still resolve through `motionUpdate`.

No other slot has a shared-default convention. Curve Hit Beat, Curve Hit Trigger, Trigger Collision, Trigger Auto, and Sprite Auto all default to per-object names like `hitBeat_kick` or `auto_drum`, on the principle that each curve plays its own beat pattern, each trigger represents a different musical event, and each sprite that has its own Auto handler is firing different events than its peers. Composers who do want shared functions for these slots can achieve it by typing the same name into multiple objects' fields — the binding is by name, so two triggers both bound to `auto_kick` share that function.

### Sprite Motion Update context and return shape

The Motion Update function receives a context object and returns an acceleration vector. The acceleration is added to the sprite's velocity before position integration, with the maxSpeed clamp applied both before Motion Update runs and again after the acceleration has been applied. The simulation's per-sprite per-tick order is:

1. Clamp velocity to the sprite's authored maxSpeed.
2. Call Motion Update if a function is bound (either through the per-sprite override or the shared `motionUpdate` default). Receive `{ ax, ay }` or `null`/`undefined` for no acceleration this tick.
3. Apply acceleration: `vx += ax * dt`, `vy += ay * dt`.
4. Clamp velocity to maxSpeed again, so Motion Update cannot push velocity past the ceiling.
5. Integrate position: `x += vx * dt`, `y += vy * dt`.
6. Resolve canvas walls under the inside-only rule (Section 22).

The acceleration semantics mean Motion Update expresses physics in the natural language of force fields: "image brightness pulls me harder" reads as a larger acceleration value, not as a velocity delta. Sprites have no defined mass, so the distinction between acceleration and force is uninteresting — the value the function returns is whatever the composer wants the rate of velocity change to be, in canvas-units-per-second-squared. The simulation handles the dt multiplication; the composer reasons about acceleration directly.

Motion Update does not fire musical events. Returning `{ note: ..., velocity: ... }` is meaningless in this slot — the simulation reads only `ax` and `ay` from the return value. Composers who want sprite motion to also drive events use the Auto slot for rhythmic events, or compute event-firing conditions inside Motion Update and emit them through a side channel (a future capability; in v2.4 Motion Update is purely physics).

The context object on every Motion Update call carries:

- `ctx.dt`: the simulation time step in real seconds (currently 1/240 s; see Section 22).
- `ctx.x`, `ctx.y`: the sprite's current runtime position in canvas units.
- `ctx.vx`, `ctx.vy`: the sprite's current runtime velocity, after the maxSpeed clamp at the top of the tick.
- `ctx.imageColor`: the image pixel colour at the sprite's current position as `{ r, g, b }` in 0–255. Returns the no-image fill colour `{ r: 64, g: 64, b: 64 }` when no image is loaded or when the sprite is outside the canvas region.
- `ctx.imageColorAt(x, y)`: a function returning the image colour at an arbitrary canvas-unit position. Used for gradient sampling — "what colour is one unit ahead of me?" — and for any pattern where the sprite reads multiple positions per tick. Same fallback when out of canvas or no image.
- Harmony and transport state will be added in Section 11's harmony milestone; in v2.4 the context covers physics-relevant fields only.

### Other slots' context shapes

The other five slots' context objects are documented here as the v2.4 plan; the simulation hooks for them land in subsequent milestones. The Motion Update slot is the first message-function slot to ship (milestone 3 of the v2.4 development cycle), with Sprite Auto, Trigger Auto, and Curve Hit Beat following once the Strudel-driven beat-firing path lands (Section 27). Trigger Collision and Curve Hit Trigger arrive with the trigger-collision implementation milestone.

Sprite Auto. Fires on the sprite's beat-aligned timer.
- `this`: the sprite (id, position, payload).
- `ctx.beatNumber`: the index of this firing within the score's overall beat sequence.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: as in Motion Update, sampled at the sprite's current runtime position.
- Harmony and transport fields.
- Returns `{ note, velocity, duration, channel, port }` to fire a musical event, or `null`/`undefined` for silence.

Trigger Collision. Fires when a curve's extended cursor sweeps over the trigger.
- `this`: the trigger (position, payload, id).
- `ctx.curve`: the curve whose cursor hit it.
- `ctx.d`, `ctx.side`, `ctx.angle`, `ctx.cursorParam`: the geometry of the hit — perpendicular distance, side of the curve, local curve direction, position along the curve.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the trigger's position.
- Harmony and transport fields.
- Returns musical-event parameters.

Trigger Auto. Fires on the trigger's beat-aligned timer.
- `this`: the trigger.
- `ctx.beatNumber`: as in Sprite Auto.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the trigger's position.
- Harmony and transport fields.
- Returns musical-event parameters.

Curve Hit Beat. Fires when the curve's cursor reaches an active beat point during cycle advancement.
- `this`: the curve (id, cycle parameters, harmony overrides).
- `ctx.beatIndex`: the slot index of the firing beat, 0-based, in [0, cycleDuration).
- `ctx.strength`: the velocity digit from the strength string, 0–9.
- `ctx.cyclePosition`: the cursor's position around the curve as a fraction in [0, 1).
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the beat point's canvas position.
- Harmony and transport fields.
- Returns musical-event parameters.

Curve Hit Trigger. Fires when the curve's extended cursor collides with a trigger (or with a beats-as-trigger position on another curve).
- `this`: the curve.
- `ctx.trigger`: the trigger that was hit (full object access, including its own payload and position).
- `ctx.d`, `ctx.side`, `ctx.angle`, `ctx.cursorParam`: hit geometry as in Trigger Collision.
- `ctx.imageColor`, `ctx.imageColorAt(x, y)`: image samples at the trigger's position.
- Harmony and transport fields.
- Returns musical-event parameters.

When both ends of a Curve Hit Trigger / Trigger Collision pair are bound, both fire — the trigger's Collision first, then the curve's Hit Trigger — and each runs with its own context object. Coordination between the two functions, if needed, happens through composer-managed shared state (a payload field on the trigger that the curve reads, a global counter, a side-channel object); the simulation does not enforce a precedence model. Section 10.5 expands on the case where beat points become triggers under the unified bound-trigger model.

### Helpers and globals

The pre-v2.4 helper functions — scaleMap, rangeMap, chordMap, harmonyMap, listMap — remain available globally to all callbacks, alongside Math. The harmony helpers will be reimplemented over Tonal in the phase documented in Section 27; existing call sites will continue to work unchanged.

All slot functions also have access to the score-level scene object through a `scene` global, which lets a callback read other objects' positions, payloads, and runtime state. Use is by convention rather than enforcement — the scene is mutable, and a callback that modifies scene state outside its bound object's properties is doing something unusual that the simulation will faithfully execute. This power is occasionally useful (a Motion Update function that reads other sprites' positions to implement flocking, for instance) and is the usual escape hatch for any compositional pattern not covered by a single object's context fields.

### Simulation tick rate

Motion Update fires at the simulation's fixed-step rate, currently 1/240 s per step (~4.17 ms, 240 Hz). At this rate even naive Euler-style physics produce smooth motion, and the per-tick cost is bounded — a hundred sprites running non-trivial Motion Update functions consume a small fraction of the per-frame budget. The other slots fire on event boundaries (beat points reached, collisions detected, auto timers expiring) rather than per tick, and their cost is therefore proportional to event density rather than to the simulation rate.

### Authoring workflow summary

The end-to-end flow for adding a behaviour to a score is:

1. Select the object in the canvas. The property inspector shows the object's slots in band 3.
2. Click Create on the desired slot's row, or type a custom name into the slot field first and then click Create. The inspector creates a stub function in behaviours.js using the default name (or the typed name) and binds the slot field to that name.
3. Switch to the behaviours.js tab and edit the function body. Save when ready.
4. The simulation reload picks up the new function; the next time the slot's event fires, the new behaviour runs.

Binding multiple objects to one shared function is a matter of typing the same name into each object's slot field; deleting an object does not remove its bound functions from behaviours.js, on the principle that the composer may want to reuse them. Cleanup of orphaned functions is manual.

---

## Section 10 — Beat Points and Strength Strings

A curve's rhythm and cursor timing are defined by a set of musical-timing fields plus two strings (active-beats and strength) authored under one of three modes. Every aspect of a curve's musical timing is per-curve; the score provides only the global tempo (BPM, see Section 7). This section is the full treatment; Section 4 summarizes.

### Per-curve musical-timing fields

These fields exist on every curve regardless of beat-points mode, and they carry across mode changes.

- **cycleDuration** (positive integer, default 4). The number of slots in one full cycle of the curve. The cursor advances through the cycle one slot at a time, taking cycleDuration slots to complete a cycle. cycleDuration is also the resolution at which the active-beats and strength strings are sampled by the engine cycling rule below.

- **beatInterval** (string token, default "Qtr"). The musical duration of one slot. Drawn from a fixed dropdown list, ordered roughly from shortest to longest with triplet and dotted variants interspersed: 384th, 128th, 64th, 32nd, 8th Tr, 16th, Qtr Tr, Dot 16th, 8th, Half Tr, Dot 8th, Qtr, Dot Qtr, Half, Dot Half, Whole, 2 x Wh, 4 x Wh. Triplet variants ("Tr") are two-thirds of the named duration; dotted variants ("Dot") are one-and-a-half times the named duration; "2 x Wh" and "4 x Wh" are two- and four-times whole-note durations for slow events. The token resolves at use time to a rational duration in quarter-notes through a fixed conversion table. Combined with cycleDuration, beatInterval determines the curve's cycle duration in score time: a curve with cycleDuration 32 and beatInterval "16th" has a cycle lasting 8 quarter-notes; the same cycleDuration with beatInterval "Whole" lasts 128 quarter-notes. beatInterval is per-curve, allowing different curves to quantize to different note values within the same score (one curve playing 16ths against another playing triplet 8ths produces a 16-against-12 polyrhythm).

- **beatsPerBar** (positive integer, default 4). The numerator of the curve's time signature, with beatInterval as the denominator. beatInterval Quarter with beatsPerBar 3 is 3/4 time; beatInterval 8th with beatsPerBar 6 is 6/8 time. Currently consumed by the inspector for visual structure of the active-beats and strength strings (see "Pipe characters" below) and reserved for future bar-aware features (per-bar chord changes, downbeat emphasis on the canvas, bar-level shared properties applied across a curve). beatsPerBar does not affect cursor traversal timing in the simulation.

- **beatOffset** (signed integer, default 0). The slot at which the cursor sits at score-beat zero, which is also where rewind sends it. With beatOffset 0, the cursor begins at slot 0 when the score is rewound. With beatOffset 2, the cursor effectively begins two slots earlier — slot 2 is what plays at score-beat zero, and slot 0 plays beatInterval × 2 quarter-notes later in score time. Negative values are allowed and have the inverse effect, advancing the curve into its first cycle before score-beat zero.

The curve's score-time cycle duration is therefore cycleDuration × beatInterval (in quarter-notes), modulated cycle-by-cycle by cycleSpeeds (see Section 4). Rewind resets the cursor to (-beatOffset) mod cycleDuration. A curve added mid-piece via a behaviour callback starts at its own slot 0 at the moment of spawning; beatOffset still applies as the offset from the spawn moment, but the spawned curve does not retroactively act as if it had been running since score-beat zero.

### Beat-points mode

A curve's `beatPointsMode` field selects how the active-beats string is authored. The mode never affects what the engine sees — the engine reads only the active-beats string itself. The mode controls authoring ergonomics in the inspector.

- **normal** (default). The composer types the active-beats string directly. The string is the source of truth.

- **euclidean**. The active-beats string is generated by the inspector from three numeric parameters: `activeBeatsCount` (the count of active beats to distribute), `beatShift` (a rotational offset that shifts the entire pattern around the cycle by N slots), and `repeats` (an internal repetition count: a Euclidean rhythm of length cycleDuration ÷ repeats with activeBeatsCount ÷ repeats actives is generated and then concatenated `repeats` times to fill cycleDuration slots). The generated string is exactly cycleDuration characters long and is stored as the curve's active-beats string for the engine to consume. The inspector renders the active-beats field read-only in this mode; only the numeric parameters drive the rhythm. Switching from euclidean to normal freezes the currently-generated string as the new source of truth, which the composer may then edit.

- **none**. No beats fire. The active-beats string is conceptually absent; the inspector stores a single "." so the engine validators stay satisfied. The diamond beat-point markers do not render on the curve. Useful for curves that exist purely as paths for cursor sweep against external triggers.

Mode switching is loss-tolerant. Going from euclidean to normal preserves the generated string. Going from normal to euclidean defaults the parameters to whatever produces the closest pattern, or to a neutral starting state — the inspector decides; the runtime is unaffected. Switching to none stashes the active-beats string for restoration if the user switches back to the previous mode within the session.

Read-only field behaviour. The activeBeats field is read-only when the mode is euclidean or none. Read-only here means the field accepts focus and allows text selection and copy-to-clipboard, but rejects all keystrokes that would mutate the content (typing, paste, cut, delete). The visual treatment matches the inspector's existing greying-when-inapplicable pattern: the green frame is replaced by a more muted styling so the field reads as not-currently-editable. Hover or focus reveals a small inline hint near the field along the lines of "Read-only in Euclidean mode — change the mode to type a custom pattern." The hint disappears when focus moves away. The mode dropdown is the documented escape hatch: switching to normal mode preserves the currently-displayed string as the new editable starting content. The strength field is editable as normal in euclidean mode, since only activeBeats is generated; in none mode both strings are conceptually empty and both fields are read-only with placeholder text indicating no pattern.

### The active-beats string

The string accepts four character classes: `x` (active position), `.` (rest position), space (display-only formatting), and `|` (display-only bar separator, auto-inserted by the inspector). The first two are meaningful to the engine; the latter two are stripped before any engine-level interpretation.

The user types only `x`, `.`, and optionally space. Any non-`.` non-space character typed in normal mode is canonicalized to `x` on commit, so uppercase X, capital letters, digits, and other characters all become `x`. The JSON only ever stores lowercase `x`, `.`, space, and pipe. Pipe characters are inserted by the inspector, never typed. Position 0 of the stripped string must be `x` or `.`; the inspector rejects any commit that would violate this, and the inspector also rejects any commit where the stripped string is empty.

Spaces and pipes are formatting characters preserved in the JSON exactly as the inspector renders them, so that re-loading a score reproduces the same visual structure the user typed. Engine cycling operates on the stripped string (spaces and pipes removed) and uses its length for the modulo operation. Consecutive spaces typed by the user collapse to a single space on commit, so that two users typing visually-identical patterns end up with byte-identical JSON.

### Pipe characters in displayed strings

A pipe character (`|`) appears in the displayed string at every position k × beatsPerBar where the count of typed beat characters (after stripping spaces and pipes) is at least k × beatsPerBar. Pipes are inserted and removed by the inspector as the user types; the user does not type pipes, and the user cannot prevent them from appearing.

A pipe at the end of a string confirms that a bar has been completed; a pipe between characters confirms a bar boundary in the middle. Pipes provide immediate feedback as the user types:

```
beatsPerBar = 3:
User types "x"          →  display "x"
User types "xx"         →  display "xx"
User types "xxx"        →  display "xxx|"     (bar completed; pipe appears)
User types "xxxx"       →  display "xxx|x"
User types "xxxxxx"     →  display "xxx|xxx|" (second bar completed)
User types "xxxxxxx"    →  display "xxx|xxx|x"
```

Deletion produces the inverse: a pipe disappears as soon as the bar it was confirming becomes incomplete. In Euclidean mode, the generated string fills exactly cycleDuration slots, so pipes appear at every k × beatsPerBar position where k × beatsPerBar ≤ cycleDuration. With cycleDuration 15 and beatsPerBar 4, pipes appear at positions 4, 8, 12 — the final segment of three slots is partial and the position-16 pipe is suppressed because there is no character at position 16 to be confirmed.

Pipes are display-only. The engine strips them along with spaces before applying the cycling rule.

When the user changes beatsPerBar with content already typed in activeBeats or strength, the inspector recomputes pipe positions for both strings on commit of the beatsPerBar field. The mechanic is: strip existing pipes from each displayed string, apply the typed-character-count rule above using the new beatsPerBar, re-insert pipes at the new positions, write the result back to the curve. The engine sees no change since pipes are stripped before cycling, but the displayed and stored JSON representations change. In a multi-select where curves with different content all change beatsPerBar together, each curve's re-pipe pass runs against that curve's own typed-character count, so the curves may end up looking very different after the change even though they were edited together — the difference reflects their different content and is correct.

### The strength string

The strength string accepts digits 0–9, spaces, and pipes. Position 0 of the stripped string must be a digit; the inspector rejects commits that would violate this, and rejects commits where the stripped string is empty. Non-digit non-space characters are rejected outright (no canonicalization, since digits don't have an obvious mapping for arbitrary letters). Spaces and pipes follow the same rules as in active-beats: stored verbatim in JSON with collapse, stripped by the engine, pipes auto-inserted at bar boundaries determined by beatsPerBar and the count of typed digits.

A strength digit applies to a slot only when that slot fires. Strength 0 means "fires silently" — a musical event is emitted at velocity 0, semantically distinct from a `.` rest in active-beats (which is no event at all). On most synthesisers a velocity-0 note is inaudible, but the firing still counts: it advances any beat-counted state in the curve's beat function, it triggers visual pulse rendering (which may be near-invisible at velocity 0), and instruments that respond to velocity-0 events as note-offs receive them.

### Engine cycling rule

For each slot k in 0 .. cycleDuration − 1 of the cycle:

1. Let A be the active-beats string with spaces and pipes stripped. Let S be the strength string with spaces and pipes stripped.
2. The slot fires iff `A[k mod A.length] == 'x'`.
3. When the slot fires, its velocity is the digit at `S[k mod S.length]`.

Both strings cycle independently at their own lengths against the same slot-index master clock. When A.length and S.length are coprime or otherwise non-aligned with each other or with cycleDuration, the audible compound pattern's period extends to lcm(cycleDuration, lcm(A.length, S.length)) before truly repeating — an evolving rhythm derived from short typed strings, which is a genuine compositional tool.

Note that this slot-modulo cycling rule is a deliberate change from the pre-v2.3 spec, which described a pointer-based model where the strength string advanced only on active firings. The slot-modulo model unifies the cycling semantics of the two strings (both indexed by slot k), simplifies the simulation engine (no per-curve pointer state to track and reset), and admits clean reasoning about polyrhythmic drift between coprime-length strings without dependence on which slots happen to be active in the current cycle.

The validators guarantee A.length ≥ 1 and S.length ≥ 1 after stripping, so the modulo is always well-defined. Empty stripped strings cannot be committed.

cycleSpeeds (a separate field; see Section 4) advances per cycleDuration iteration, not per compound period. A curve with cycleDuration 16 and cycleSpeeds "0.4 2 -1" runs the first 16 slots at the 0.4 multiplier regardless of where the active-beats and strength strings happen to be in their independent cycles, then the next 16 slots at the 2 multiplier, and so on.

### Score-curve independence and rewind

Curves play independently of any global score-level structure. The score provides global tempo (BPM) only; the score does not have its own time signature in v2.3. Each curve's cycle starts at score-beat zero (offset by beatOffset slots) and advances at its own rate from there. Curves drift freely against each other and against any notional score bar lines.

Rewind resets all dynamic state to the scene's declared initial state (Section 7). Cursor positions return to (-beatOffset) mod cycleDuration. Sprite positions return to whatever positions the scene declares. Behaviour-internal counters reset to their initial values. Played from beat zero through to beat N, the score always produces the identical sequence of musical events because the simulation's evolution is exclusively a function of (initial state, elapsed beats).

### "Beats are triggers" and external collision

When a curve's `beatsAreTriggers` property is true, its active beat points become collidable as triggers by other curves' extended cursors. Section 4 discusses the property in the context of the curve's collision role; Section 8 describes the one collision rule. The slot-modulo cycling rule above applies identically whether a beat is fired by the internal cursor advancing through the cycle or by an external cursor sweeping the position: in both cases, the slot is the slot, and `S[k mod S.length]` gives the velocity. There is no separate external pointer (the prior pointer-based model had one); a single slot-indexed read is sufficient under the unified rule.

Only active positions are externally collidable. Inactive positions (`.`) produce no firing internal or external, and render no diamond marker on the curve. The active-beats string fully determines where beat points visibly exist on the curve and where external cursors can collide with them.

### Validation summary

The inspector commits are guarded by these validation rules. A commit attempt that would violate any of them is rejected, with the field's value reverting to its previous state and a hint shown to the user.

- cycleDuration: positive integer
- beatInterval: token from the fixed dropdown list
- beatsPerBar: positive integer
- beatOffset: signed integer
- beatPointsMode: one of "normal", "euclidean", "none"
- activeBeats (after stripping spaces and pipes): length ≥ 1; position 0 is `x` or `.`; all characters in {`x`, `.`}
- strength (after stripping spaces and pipes): length ≥ 1; position 0 is a digit; all characters digits 0–9

---

## Section 10.5 — Unified Bound-Trigger Model (Proposed)

A captured proposal for evolving the trigger and beat-point model in a future revision. The current "beats are triggers" property described in Sections 4 and 10 makes a curve's active beat points externally collidable but leaves them rendered as tick marks and conceptually distinct from triggers. This proposal goes further: visualise and treat curve beat points as triggers themselves — geometrically bound to their parent curve and inheriting their behaviour from the curve, but otherwise the same kind of object as standalone triggers. The unification removes a redundant concept, gives beat points a more visible and consistent visual identity, and unlocks compositional capabilities the current model does not offer. The proposal supersedes the "beats are triggers" property: in the new model, beat points are always triggers, and a separate visibility setting controls only whether they are exposed to other curves' cursors.

Visual rendering. Each active beat point on a curve renders as a diamond — a small four-pointed glyph rotated so two opposite points lie on the curve and the other two extend perpendicular to it. The diamond reads simultaneously as "this is a trigger" (matching the standalone trigger glyph at first glance) and "this is bound to its curve" (the orientation declares which curve owns it without further ornament). Inactive positions in the active-beats string render no glyph; strength-zero positions, which already do not fire, also render no glyph for consistency with their silent semantics. Edits to the active-beats string cause diamonds to appear and disappear in place, the same way tick marks behave today.

Inheritance model. Every property of a bound trigger lives on the parent curve, not on the individual diamond. The bound-trigger function (the slot that fires when any cursor sweeps the bound trigger), the visual styling, the visibility setting described below, and any other declarative properties are all curve-level. The individual diamonds have no separately editable state; they are visual manifestations of the curve's beat pattern, with positions derived from the curve's parameterisation. This dodges the multi-select-across-many-beats problem in the property inspector: editing "this curve's bound-trigger function" is one edit on the curve, not one edit per diamond, and the alternative of multi-selecting all the bound triggers on a curve would be awkward when other unrelated objects sit between them on the canvas. It also avoids the orphaning problem that per-beat property overrides would cause whenever the active-beats string is rewritten. Per-beat differentiation — accenting every fourth beat, for instance — is achieved by the bound-trigger function reading its beat-index argument from context and varying its behaviour accordingly. The function is shared; the data feeding it is per-beat. The strength string is one such per-beat data channel today; richer per-beat data is discussed under "Future direction" below.

External visibility. A curve has a visibility property controlling whether its bound triggers are exposed to other curves' cursors. The default is bound-only: bound triggers respond only to their parent curve's cursor, matching the typical case of a curve playing its own rhythm. When externally visible, the bound triggers become collidable by any cursor in the scene, including the parent's, and the existing one-and-only collision rule (extended cursor hits trigger) handles cross-curve sweep without modification. When an external cursor sweeps an externally-visible bound trigger, the parent curve's bound-trigger function fires — not the visiting curve's Hit Trigger function. The bound trigger remains the source of truth for what happens when it is hit, regardless of who hit it, matching how standalone triggers already behave. The strength-pointer dual described in Section 10 (one pointer for internal cycles, a separate pointer for external collisions) carries forward into this model unchanged. Inspector label wording is to be settled when the inspector exposes the field; "Visible to other curves" and "Externally triggerable" are candidates.

Function precedence with Hit Trigger functions. When a cursor with a defined Hit Trigger function hits a trigger that also has a defined function (whether a standalone trigger's Collision function or a curve's bound-trigger function), two conceptual models compete. Cursor-as-actor treats the cursor as the player and the trigger as a position-only target. Trigger-as-actor treats the trigger as the locus of musical content and the cursor as the playhead. Compositions may legitimately want either. The rule is whichever-has-a-function wins when only one is defined: if only the trigger has a function, the trigger fires; if only the cursor's curve has a Hit Trigger function, the cursor's Hit Trigger function fires. When both are defined, both fire in defined order: the trigger's function fires first, then the cursor's Hit Trigger function. Each runs with its normal context object as documented in Section 9; neither knows about the other. Two musical events per collision is the expected outcome and is treated as a feature — the trigger's function might emit a note while the cursor's Hit Trigger function emits a controller change, logs the hit, animates a secondary effect, or fires its own note. A composer who wants the cursor's Hit Trigger function alone to control the collision response defines only that function and leaves the trigger's function undefined; a composer who wants the trigger to fire identically regardless of which cursor hits it defines only the trigger's function. The data shape declares the conceptual model: defined-ness is the switch, both-defined means both run, and there is no third hidden mode where the runtime chooses between the two. If the trigger's function and the cursor's Hit Trigger function need to coordinate (for instance, suppressing the cursor's emission when the trigger has already handled the hit), they do so through shared context state the composer reads and writes, not through a precedence rule the runtime enforces.

Compositional value. The strongest argument for the unification is the cross-curve case. Today there is no clean way to have one curve's cursor play a rhythmic pattern derived from another curve's geometry; bound triggers with the visibility setting checked make this work as a special case of the existing one-and-only collision rule, with no extra mechanism required. The pattern-laying ergonomics are the second argument: typing a pattern string is much faster than placing many triggers individually, and the pattern can be shifted along the curve by editing parameterisation, with the diamond positions following automatically.

Future direction: phrase-pasting. The current active-beats and strength strings encode timing and emphasis, but the bound-trigger architecture accommodates a richer pattern grammar where each active position can carry additional per-beat data — pitch, duration, arbitrary payload. With such a grammar, a melodic phrase like Yankee Doodle could be pasted onto a curve as a sequence of bound triggers with appropriate pitches, stretched over the curve's parameterisation. The shared bound-trigger function reads pitch and the other per-beat parameters from its context and constructs the musical event. This was a capability of GeoMaestro (paste a MIDI phrase onto a piste) and was wished for in GeoSonix without being implemented. The architecture admits it without disturbing the inheritance model: per-beat data is data, not per-trigger property overrides. The grammar design itself is left for a future milestone.

Visualisation. The composer's working vision for how a pasted MIDI phrase renders on the curve: each note's onset shows as a tick mark on the curve at the corresponding cycle position, with measure-boundary tick marks rendered larger than note tick marks so the phrase's metric structure stays legible at a glance. Pitch, duration, velocity, and other per-note parameters do not render geometrically on the curve — they appear in the property inspector when the composer selects the curve or zooms in on a specific bound trigger. This keeps the curve's visual language compact (positions are visible, parameters are not) while the inspector serves as the rich-data side panel that conventional notation would otherwise need to occupy. Other rendering options will be considered when the feature is implemented; this is the working starting point.

Implementation note. The model change is larger than the code change. The collision pipeline today already runs every cursor against every trigger; under the proposed model it runs every cursor against the same set augmented by all bound triggers belonging to its own curve plus all externally-visible bound triggers from other curves. That augmentation applies during existing collision detection — the structural pipeline does not change. The bound triggers themselves are computed from each curve's active-beats string and parameterisation, either on demand or with a cache invalidated when the string or geometry changes.

Status. Captured for future work; not in the v2.4 milestone. The property inspector currently in progress does not need to anticipate this change. Section 13's existing description of the Beat Points band continues to apply during v2.4, editing active-beats and strength strings and the cycle parameters as it does today. When the unified model lands, the inspector's behaviour for curves gains the bound-trigger function slot and the visibility setting alongside the existing fields, and the standalone triggers' inspector treatment is unchanged. The "beats are triggers" property described in Sections 4 and 10 disappears, replaced by the visibility setting described above.

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

Helper functions in message-function bodies consult these parameters. `scaleMap(value, { scale: ctx.scale, root: ctx.root })` maps a 0-1 input value into a note within the currently effective scale. `chordMap(index, { chord: ctx.chord })` returns the indexed chord tone. These helpers read from the context (which carries the current effective harmony for the firing object) rather than from score-level globals, so per-object overrides are automatically respected. The harmony-framework vocabulary, including the named scales and chords accepted by these fields, will broaden substantially when Tonal becomes the underlying theory engine; see Section 27.

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

The transport bar at the bottom contains, from left to right: a rewind button, a play-pause toggle button, an elapsed-time readout in minutes, seconds, and hundredths, and a BPM field editable via up-down stepper arrows. Time signature is per-curve in v2.3 (Section 10) and does not appear on the transport bar. A vertical grey divider separates these controls from the right half of the bar, which is reserved for error and status output from sketch execution.

The canvas is a live viewer. It displays the scene: background image, vector field visualisation (optional), curves rendered as their geometric shapes with tick marks at beat points and animated cursors (extended cursors render as perpendicular lines showing their sweep region), triggers rendered as filled dots sized by their collision radius, sprites rendered as filled circles coloured from the pixel underneath with white ring outline, and optional trails fading behind sprites.

Canvas toolbar and direct manipulation. A toolbar strip across the top of the canvas pane holds object-creation tools. Each tool has three states: idle, armed (one-shot — single placement, then back to idle), and locked (repeat placements until the user disarms). Single-clicking a tool button arms it; double-clicking locks it; clicking the active tool again disarms at any state; the Escape key disarms from any state. While armed or locked the cursor over the canvas is a crosshair, and clicks place a new object at the click position. Mouse-down on a tool button briefly flashes green so the click feels acknowledged in real time, and the armed/locked classes carry that green forward into the persistent state. The current toolbar exposes a single tool, Add Sprite; Add Trigger and the curve-shape tools follow.

Selection model. With no tool armed, the canvas behaves as a selection surface. Clicking an object selects it (replacing any previous selection); shift-clicking toggles the object's membership in the selection; clicking empty space clears everything. Dragging from empty space draws a marquee — a translucent grey rectangle that follows the mouse — and on release every object the marquee touches joins the selection (or replaces it when shift is not held). Dragging from a selected sprite moves all selected sprites together; dragging from an unselected sprite first replaces the selection with just that sprite, then moves it. Selection is multi-kind: sprites, triggers, and curves can all be selected together, with selection markers as yellow dotted squares around sprites and triggers, and yellow dotted bounding-box rectangles around curves. Hit-testing tries sprites first, then triggers, then curves so the visually-topmost object wins ties. Drag-to-move is sprite-only at this milestone; triggers and curves can be selected and deleted but not moved through the canvas yet.

Edit pipeline. Canvas operations — Add Sprite, drag-to-move sprites, Delete to remove objects of any kind — commit by parsing scene.json, mutating the parsed data, stringifying back, updating the bundle in place, refreshing the editor's Properties JSON view, then re-running the scene. Re-running auto-saves first, so each canvas edit also persists through the normal save pipeline. The Delete and Backspace keys remove all currently-selected objects; the listener checks the focus target so typing in the JSON tab still does the obvious thing. Selection is filtered against array lengths after each scene reload so a move-style edit (which preserves indexes) keeps the user's selection through the consequent re-render, while a delete or score switch prunes stale entries.

Property inspector. The form-based property inspector ships in v1 form, occupying the Properties tab as the primary editing surface for object properties. It renders six bands sized by their constraint rows (identity; geometry and visual; message functions; auto message interval; beat points; cycle parameters) with selection-driven greying — fields that don't apply to the current selection stay in their fixed positions but lose their green frame and brighten only when active, so the form's layout never reflows when the selection changes. The inspector is blank when nothing is selected, matching GeoSonix's empty-selection convention.

Reflow rule. Each band has a fixed vertical height that does not change for any reason — not for selection changes, not for mode changes, not for any other state. Bands occupy fixed vertical positions in the inspector and never move. Within a band, fields may appear, disappear, or swap based on selection or mode, provided the band's overall height stays constant. For example, the beat-points band's Euclidean parameter row shows when the mode is euclidean and hides when the mode is normal or none, but the band reserves the same vertical space in either case so that bands below it (cycle parameters, etc.) never shift position. This stability is an accessibility concern: the user, particularly under accessibility zoom, can rely on each band sitting in a consistent location and can build muscle memory for where to look for a given field. The cost is some always-reserved space that may be empty under certain modes, which is acceptable.

Vertical fit. The inspector targets fitting bands 1 through 6 (identity, geometry/visual, message functions, auto interval, beat points, cycle parameters) without vertical scrolling in a normally-sized browser window. The bands below that point — the deferred harmony and MIDI-routing area, including Object MIDI, Object Harmony, and Score Harmony when those land — may require vertical scrolling to access; this is acceptable because they are edited less frequently than the per-object bands above. If the user resizes the browser window smaller than typical, scrolling may also be required to reach the lower per-object bands, which is also acceptable but expected to be rare. The natural inspector pane width grows as needed to fit the constraint rows of the per-object bands; v2.3 targets approximately 700 pixels wide as the natural width, set by Band 5's Curve Beat Points timing row and Band 6's cycle-parameters row.

v1 is partially data-bound: Band 1 (identity) reads and writes real object data, including JS-identifier validation on the Name field with hard-error and soft-conflict squiggly underlines; multi-select greying and tri-state varies indicators on the Mute and Hide checkboxes work across all kinds. Bands 5 (beat points) and 6 (cycle parameters) are next. Bands 2 (geometry), 3 (message functions), and 4 (auto interval) remain layout-only with placeholder values. Function-slot dropdowns sourced from behaviours.js, Create button scaffolding for stub functions, and harmony-override fields are all later-milestone work tracked in Section 25 question 1. The raw scene.json view that the inspector replaces moves to a Properties JSON tab, kept available as a fallback until the inspector covers every editable field.

AI authoring pane. A conversational pane is available for chatting with Claude. Requests like "add two more triggers near the top right" or "make the sprite wander faster" cause Claude to edit the sketch. The pane is toggleable and can be hidden when not in use. This is described further in Section 14.

No REPL in the initial release. No live-coding during playback initially (edit-and-rerun loop only). A future milestone may expose per-line and per-function evaluation of sketch code into a live workspace, matching the GeoSonix execution model; this is an open question flagged in Section 25.

Keyboard shortcuts: Spacebar toggles play-pause. R rewinds. Cmd-S saves the active tab. Cmd-Shift-S saves all tabs. Cmd-O opens a score. Cmd-N creates a new score.

A version history panel (toggleable visibility) shows the bundle's git history as a scrollable list of versions: milestones prominent, time-based markers next, auto-commits available via a "show all versions" toggle. Each entry has a human-readable timestamp and description. Click to view or restore.

Accessibility. Limited vision is a first-class concern in the UI. Large bold fonts throughout, a dark theme, and visible grey dividers segmenting every window region. No use of colour alone to convey information. Browser ARIA attributes and screen reader compatibility are preserved. Browser zoom composes cleanly with any OS-level zoom. Imported background images pass through a perceptual brightness reduction transform before display so that broad bright regions do not dominate the canvas while local contrast and detail are preserved; only the displayed image is affected, the pixel data used for music generation passes through unchanged. The transform's parameters and bypass toggle live in Settings. See Section 26 for the full description.

---

## Section 14 — Authoring Workflow

A score's data and behaviour are split across two files in the bundle: scene.json (declarative data) and behaviours.js (named JavaScript functions). The two files are tied together by name reference: scene.json's function-slot fields hold strings that name functions defined in behaviours.js, and the scene loader resolves them at run time.

scene.json contains piece-level parameters (bpm, time signature, harmony framework, output target, image name, per-score scales) plus three arrays — curves, triggers, sprites — each entry of which is a flat object with the declarative properties for one object (geometry, rhythm strings, position, function-slot names, harmony overrides). No JavaScript runs from scene.json; it's pure data that any tool can read or write.

behaviours.js contains named JavaScript functions referenced from scene.json. Top-level function declarations and top-level const/let bindings to function expressions and arrows are exposed by name; the file is executed once on every scene load to build a function map. The split lets a property inspector, the canvas toolbar, or an AI assistant edit scene.json directly without parsing or rewriting any code, while the JavaScript editor keeps full freedom over behaviours.js.

Example scene.json:

```json
{
  "bpm": 120,
  "tonic": "D",
  "scaleName": "D minor",
  "imageName": "background.jpg",
  "triggerScale": 1,
  "spriteScale": 1,
  "curves": [
    {
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 10, "h": 10 },
      "cycleDuration": 4,
      "beatInterval": "Qtr",
      "beatsPerBar": 4,
      "beatOffset": 0,
      "cycleSpeeds": "1",
      "stopAtCycle": -1,
      "beatPointsMode": "normal",
      "activeBeats": "x",
      "strength": "9",
      "cursorR": 3,
      "cursorL": 0,
      "hitBeat": "hitBeat_circle",
      "hitTrigger": "hitTrigger_circle"
    }
  ],
  "triggers": [
    { "x": 3, "y": 4, "note": 60, "collision": "collision_node" },
    { "x": -4, "y": 2, "note": 64, "collision": "collision_node" },
    { "x": 2, "y": -3, "note": 67, "collision": "collision_node" }
  ],
  "sprites": [
    { "x": 0, "y": 0, "vx": 1, "vy": 0, "motionUpdate": "" }
  ]
}
```

Corresponding behaviours.js:

```javascript
// Curve functions.
function hitBeat_circle(ctx) {
    // An arpeggio keyed to which beat of the cycle fired.
    const degrees = [0, 2, 4, 5];
    const note = scaleMap(degrees[ctx.beatIndex % 4] / 7,
                          { scale: ctx.scale, root: ctx.root });
    return { note, velocity: ctx.strength * 14, duration: 200 };
}

function hitTrigger_circle(ctx) {
    // Distance-based pitch — GeoMaestro distortion pattern.
    return {
        note: ctx.trigger.note - Math.floor(ctx.d),
        velocity: Math.max(0, 127 - Math.floor(ctx.d * 8)),
        duration: 400,
    };
}

// Trigger functions.
function collision_node(ctx) {
    return { note: this.note, velocity: 100, duration: 300 };
}

// Sprite functions. The shared Motion Update default — every sprite
// with an empty motionUpdate field invokes this function.
function motionUpdate(ctx) {
    // Image colour drives acceleration — red pulls right, blue pulls
    // left, the green channel pushes vertically. The simulation adds
    // the returned ax/ay to velocity before integrating position.
    const c = ctx.imageColor;
    return {
        ax: (c.r - c.b) * 0.05,
        ay: (c.g - 128) * 0.05,
    };
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

Possible extension: change-summary artefact. Captured as an idea for the implementation phase, not part of the current v2.3 specification. The handoff folder could include a CHANGES.md file written by the AI side and treated as observation-only by GXW on Fetch — flagged in handoff.json alongside the snapshots so that any apparent edits to it are silently ignored. The file's purpose is to give the composer a brief description of what the AI added, modified, or removed since the handoff, what reasoning shaped those choices, and what alternatives were considered but set aside. The bootstrap-and-tweak workflow benefits particularly: when the composer fetches new behaviour code, the change summary explains the AI's thinking before the composer reads any code, which lowers the cognitive cost of refining the result. Display would initially be outside GXW (the AI's conversation transcript itself, or any text editor opened on the file); a dedicated panel inside GXW surfacing the most recent change summary alongside the score is a possible later refinement. Whether this carries enough weight to specify is a judgment call to be settled when the AI Handoff feature is implemented.

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

GXW produces sound internally via the Web Audio API. The default synthesis engine is **superdough** — the Web Audio sampler-and-synth originally built for Strudel and published as a standalone npm package with no dependency on Strudel itself. Adopting superdough gives GXW an immediate rich sound palette without specifying a voice bank from scratch: a built-in sample map covering the tidal-drum-machines library (TR808, TR909, LinnDrum, and similar, accessible through short names like `bd`, `sd`, `hh`, `cp` with bank prefixes), the VCSL orchestral instrument samples, and over 1000 AKWF wavetables; subtractive and FM synthesis with selectable waveforms (sine, sawtooth, square, triangle, plus pink/white/brown noise and crackle); an effect catalogue covering filters with envelopes, convolution reverb with generated impulse responses, phaser, delay, sidechain ducking, and the Dirt-inheritance effects vowel, crush, coarse, and shape; and arbitrary sample loading from any URL, with a `github:user/repo` shorthand for repositories that publish a `strudel.json` manifest. Sample loading is lazy: maps load at init while individual audio files load on first playback, keeping the runtime cost low until a sound is actually used.

A GXW preferences panel lets the user choose among superdough's voice categories and adjust output levels. Behaviours request voices through the parameter shape superdough uses internally (`{s: "bd"}`, `{s: "sawtooth", note: 60}`, and so on); GXW's musical-event format is a thin wrapper over that parameter object.

The choice to adopt superdough is independent of the Strudel pattern-engine commitments documented in Section 27. superdough is its own npm package with no Strudel dependencies, so GXW installs and uses it on its own without pulling in any Strudel pattern code. Section 27 documents the packaging boundaries and the staged adoption plan.

For composers who want to drive external synthesisers or DAWs, GXW supports Web MIDI output on browsers that implement it (Chrome, Edge, and Firefox recent versions). Safari lacks Web MIDI support at time of writing; on Safari, superdough is the only output option. The sketch specifies an output preference in setup():

```javascript
function setup() {
    bpm(120);
    output("internal");  // or output("midi", "IAC Bus 1");
}
```

Audio timing is scheduled against AudioContext.currentTime with a lookahead window. Events are scheduled a few frames ahead and fire at precise audio-clock times, producing sub-millisecond timing accuracy regardless of browser frame rate jitter.

Future direction. superdough's authors are exploring single-AudioWorklet implementations of the engine (the **supradough** and **dough** projects) that consolidate its many Web Audio nodes into a single signal-processing thread. These remain experimental as of this revision, but the migration path is well-defined within superdough's own roadmap, so GXW would inherit any stabilised improvement automatically when it lands.

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

25. Unified bound-trigger model. Section 10.5 captures a proposed evolution that visualises and treats curve beat points as triggers bound to their parent curve, rendered as diamonds rotated so two opposite vertices lie on the curve, with shared inheritance from the curve, an external-visibility setting controlling exposure to other curves' cursors, and a whichever-has-a-function-wins-when-only-one-is-defined rule (with both-fire-in-defined-order when both are defined) for resolving cursor sweep functions against trigger functions. Open issues within the proposal: the inspector wording for the visibility setting, and the pattern-grammar design for the phrase-pasting future direction (encoding per-beat pitch and payload alongside the existing strength data so a melodic phrase can be pasted onto a curve as bound triggers). The proposal sits in a post-v2.3 milestone window; the v2.3 property-inspector work does not need to anticipate it.

26. Trigger Sync to Beat semantics, ownership, and inspector placement. The curve-inspector's Band 6 has carried a placeholder Trigger Sync to Beat combo since the inspector first shipped, with no specified semantics and no data binding. The intended meaning is quantization: a non-Off setting from the eighteen beat-interval tokens defers a triggered firing from the moment of physical collision to the next boundary of the chosen grid in score time, while Off fires at collision. The grid is the score's tempo grid, independent of any curve's beatInterval setting. Three open questions remain. First, ownership: per-trigger (the property lives on the trigger; one trigger fires on its own grid no matter who hits it; auto-fired events defer to the same grid; different curves hitting the same trigger get the same quantization), per-curve (the property lives on the curve; one curve produces quantized firings on its own grid no matter which trigger it sweeps; auto-fired triggers don't participate; different curves hitting the same trigger get different quantization), or both with a precedence rule. The per-trigger view fits the natural reading that quantization is a property of the firing event and the firing event lives on the trigger; it also extends cleanly to auto-fired triggers. The per-curve view fits the reading that the cursor's motion owns the timing of the collision-detection event; it also extends to a curve's own internal beat firings landing on a separate grid from its slot grid (though slot firings already land on slot boundaries by definition, so this case is mostly degenerate). Historical GeoSonix behaviour and which view best serves real composition both inform the choice. Second, semantics edge cases: what happens when multiple collisions occur within one quantization interval (collapse to one firing? all fire on the boundary?); how Off interacts with auto-firing; whether the deferred firing carries the original collision context (which curve, which sweep position) or recomputes context at the firing moment. Third, inspector placement: Band 6 of the curve view continues to hold the placeholder combo through v2.3 regardless of where ownership lands, because adding a trigger-specific band or row for one field would cost more than is justified at this point. If ownership turns out to be per-trigger, the placeholder will eventually move to the trigger-property inspector when broader trigger-property work happens; if per-curve, the placeholder is already in the right place and just needs data binding. The data-model field, validator, and engine consumption (in the Simulation module) are all deferred until ownership is settled and real binding lands.

---

## Section 26 — Accessibility

Limited vision is a first-class design concern for GXW, not an afterthought. Every UI decision is checked against whether it remains usable when accessibility zoom is active and when bright regions cause physical discomfort. This section collects accessibility provisions that are substantial enough to warrant their own design treatment; smaller provisions — large bold fonts, dark theme, visible grey dividers, no colour-alone signalling, ARIA attributes, muted scrollbars — live in Section 13 alongside the rest of the UI specification.

Perceptual brightness reduction for imported images. Imported background images on the canvas pass through a non-linear brightness transformation before display. The goal is to reduce eye strain from large continuously-bright regions while preserving local contrast and detail throughout the image. A simple global brightness or gamma reduction would be insufficient: it darkens dim regions and midtones equally, making the image as a whole hard to read, while still leaving large bright areas relatively dominant in proportion to the rest. The required behaviour is spatially aware — small bright features (a highlight, a specular dot, a thin bright line) sitting in an otherwise dark region must retain their brightness, while large continuously-bright regions (a bright sky, a white wall, a broad light area) must be dimmed substantially. Dimmer regions and midtones are untouched or nearly so.

Approach: base-detail decomposition. A blurred copy of the image serves as an estimate of regional luminance, the base layer. For each pixel of the original image, the regional luminance from the blurred image is read and used to compute an attenuation factor; that factor is multiplied into the original pixel's RGB values to produce the displayed pixel. Because the factor is derived from the blurred neighbourhood but applied to the unblurred pixel, local contrast and fine detail are fully preserved — the dimming responds to broad spatial trends, not to per-pixel intensity. Broad bright regions get pulled down; bright pixels embedded in dark regions stay bright because their neighbourhood is dark.

Attenuation curve. The factor is 1.0 (no attenuation) below a configurable threshold of regional luminance, then rolls off smoothly above the threshold using a smoothstep or similar easing function so the transition does not produce visible banding. At maximum regional luminance the factor reaches the configured maximum-attenuation floor (a value below 1.0; for example 0.5 means the brightest large regions are halved). The smooth roll-off makes the transition between protected and dimmed luminance ranges visually continuous; a hard step would introduce visible contour lines tracking the threshold's iso-luminance curves through the image.

Music generation is unaffected. The transformation runs in the rendering layer only. The pixel-sampling array used by triggers and sprites for image-driven music generation reads from the original, untransformed image data. This is a hard requirement: the visual representation of the image is an accessibility concern, but the image's role as scalar field driving the composition must remain faithful to the source. Two image snapshots are maintained side by side at import time — the original for sampling, the transformed for display — and the canvas renderer always draws the transformed snapshot while `_sampleImageAt` and equivalent paths always read from the original.

When the transform runs. Once at the moment of import, with the result cached. "Import" here covers the full set of paths through which an image arrives in the bundle: user-initiated image import via the file menu or drag-drop, score load from IndexedDB or the AI Handoff folder, and any other event that mutates the bundle's image bytes. Whenever the bundle's image bytes change, the transform re-runs and the cached result is replaced. The transform does not re-run on draw; the canvas just renders the already-transformed bitmap on every frame.

When the user changes the transform parameters in Settings, the currently displayed image re-processes immediately so the user can adjust the sliders and see the effect without restarting or re-importing. The bypass toggle takes the same path: when toggled off, the original image displays directly; when toggled back on, the cached transformed result displays again with no recomputation.

User-exposed parameters. Three numeric controls in Settings, ideally as sliders, with a fourth toggle for bypass:

- Blur radius. The spatial scale that defines "large continuous bright region." Larger values mean only very broad bright areas are affected; smaller values dim more localised bright patches. Default 5–10% of the smaller image dimension. Range roughly 5–200 pixels.
- Threshold. The regional luminance below which no dimming is applied, on a 0–1 scale. Protects midtones and shadows from being darkened. Default around 0.5; range 0.0–0.9.
- Maximum attenuation. The multiplier applied to the brightest large regions, on a 0–1 scale. A value of 0.5 halves the brightest large regions; a value of 1.0 disables the effect entirely. Default 0.5; range 0.2–1.0.
- Bypass toggle. When enabled, displays the original imagery without the transformation. Useful for direct comparison and for cases where the user wants to see the unaltered image briefly. Music generation is unaffected by the bypass setting since it never used the transformed data.

Settings persistence. The four controls persist across sessions and apply to all subsequently imported images. When a score is loaded, its background image is processed using the user's current settings, regardless of which settings were active when the score's image was originally imported. The settings are user-level preferences, not per-score; a user with photophobia or accessibility needs configures them once and they apply to every score the user opens, including scores authored by other users and shared into IndexedDB or via AI Handoff.

Implementation. The HTML Canvas 2D API supports all of this without needing WebGL or shaders. An offscreen canvas with `ctx.filter = 'blur(Npx)'` produces the base layer using hardware-accelerated Gaussian blur; this is well-supported across modern browsers. A per-pixel pass then reads luminance from the blurred canvas using Rec. 709 weights (0.2126 R + 0.7152 G + 0.0722 B), computes the attenuation factor per the curve described above, and writes attenuated RGB to the output canvas. The alpha channel passes through unchanged. The transform runs once at import; no per-frame cost.

Known limitation: halos. Gaussian blur does not respect edges, so very high-contrast boundaries can produce faint halos in the transformed image — a thin band of slight brightening or darkening around the boundary, where the blurred neighbourhood luminance disagrees most strongly with the local pixel's luminance. This is acceptable for the first implementation and is not visually disruptive in most images. If halos prove distracting on imagery the user actually composes with, the Gaussian blur can be replaced with an edge-preserving filter such as the Gastál–Oliveira domain transform, which runs in linear time with separable passes and is implementable in roughly fifty lines of JavaScript. The replacement is a drop-in for the blur step; nothing else in the pipeline changes.

Future additions. Other accessibility provisions worth keeping in mind for this section as they arise: a high-contrast theme variant for the inspector and editor, font-size scaling controls independent of OS-level zoom, text-to-speech integration hooks (the user already drives Apple Speak Selection paragraph-by-paragraph against GXW's UI text), and screen-reader-friendly status announcements for state changes that currently signal only visually (transport play state, dirty indicator, save events). None of these are in scope for v2.3; the perceptual-brightness-reduction feature is the only accessibility provision being introduced this revision.

---

---

## Section 27 — Tonal and Strudel Integration

A captured strategic direction for the project's musical and pattern-engine foundations. Not in the v2.3 milestone window. Documented here as a definite goal with a phased implementation path so that v2.3 and v2.4 work avoids choices that would foreclose this direction, and so that early adopters and contributors can see where the project intends to grow.

### Direction

GXW commits to two long-term external dependencies that together establish the project's musical vocabulary and pattern-engine substrate: **Tonal** for music-theory operations — notes, scales, chords, intervals, keys, modes, progressions — and **Strudel** for pattern-based event generation — mini-notation, pattern transformation algebra, voice-led chord progressions. Both are MIT-licensed JavaScript libraries under active maintenance, both ship as modular npm packages so individual capabilities can be imported without pulling in unrelated subsystems, and both fit GXW's authoring substrate without imposing a new language: behaviour code remains JavaScript, with the libraries surfacing as imported APIs that the behaviour author calls into.

The integration positions GXW in a specific niche: image-and-geometry-based scoring, complementary to the pattern-based live coding that Strudel and Tidal already cover well. The framing is not GXW-as-Strudel-substitute but GXW-as-scene-source — a system that reads from photographs, drawings, and arranged spatial layouts to produce event streams, where Strudel reads from pattern strings to do the same. The niche is genuinely unoccupied today; nothing in the JavaScript live-coding ecosystem treats images or 2D geometry as compositional source material in the way GXW does. Aligning with Tonal and Strudel rather than reinventing them concentrates the project's design effort on this distinctive contribution.

That Strudel itself depends on Tonal (Strudel's `@strudel/tonal` package surfaces Tonal operations as pattern-aware methods like `.scale`, `.chord`, `.voicings`, `.scaleTranspose`, `.rootNotes`) means the two dependencies are coherent rather than overlapping: Tonal supplies the theory primitives, Strudel applies them across time as patterns, and GXW supplies them across space as scenes. The three layers compose without conflict.

### Two surfaces, two performance modes

The Strudel REPL and the GXW canvas-and-inspector are different user interfaces serving different ways of thinking about composition, and the integration deliberately preserves them as separate surfaces rather than unifying them into one screen. The REPL needs a code-editing focus that would have to hide scene geometry to remain coherent; the canvas needs a spatial focus that would have to hide pattern code to remain coherent. The two interfaces are optimised for different cognitive modes — temporal-sequential thinking in patterns, spatial-and-visual thinking in scenes — and a forced merger would compromise both.

Instead, the two systems become complementary tools a performer may use individually or together, with interoperability at the source-code and event-stream level rather than at the UI level. A performer giving a Strudel set could pause, switch to GXW for a scene-driven section that adds variety the REPL cannot produce, then switch back. Another performer might never touch Strudel directly but use Tonal-and-Strudel-derived helpers entirely from inside GXW behaviours. A third might run both windows side by side and route output from each into a shared MIDI destination, listening to each system's events as inputs to the other. The shared substrate (JavaScript), shared theory library (Tonal), and shared pattern vocabulary (Strudel mini-notation, transformation algebra) make the two systems interoperable at the data and code level while their user surfaces remain distinct, each optimised for its own working mode.

### Tonal as the music-theory foundation

Tonal becomes a hard dependency of GXW from the integration's first phase forward. Behaviour code can call Tonal directly, but the recommended interface is a thin GXW helper layer over Tonal exposing named-argument signatures designed for the per-event use case behaviours actually have. The helper layer's vocabulary supersedes and refines the helpers Section 9 currently sketches:

- `scaleMap(value, options)` — map a 0–1 input to a note in a scale, where `options` carries scale, root, octave, and range.
- `chordMap(index, options)` — pick an indexed chord tone (1, 3, 5, 7, 9, 11, 13) from a chord, with octave wrapping.
- `harmony(value, options)` — combined scale-and-chord-aware mapping where chord tones are weighted preferentially within a scale.
- `nearestInScale(pitch, scale)` — quantise a pitch to the nearest scale degree.
- `voiceLeadFrom(prevNote, newChord, options)` — pick the chord tone in the new chord closest to the previous note, the canonical voice-leading move.
- `progression(name)` — fetch a named chord progression and step through it.

These wrap Tonal primitives in argument shapes designed for the way behaviour code reads them, rather than in the pure-functional shape Tonal's underlying API exposes. Section 9's existing helpers are absorbed into this layer and gain Tonal's full vocabulary behind them — 90+ named scales (every mode, every common jazz scale including bebop, altered, harmonic-major modes, plus exotic scales), the full jazz chord parser (Cmaj7, Dm7b5, G7alt, Ab7(b9,#11), 13sus4, slash chords), key analysis with diatonic-chord families and secondary dominants, mode catalogues, progression handling with roman-numeral input — without changing their call sites. A score authored against the v2.3 helper layer continues to work after Phase 1 lands; a score authored after Phase 1 has access to substantially richer harmonic vocabulary inside the same call shapes.

Inspector implications. Tonal underneath the harmony framework also enables substantial inspector enhancements: validated autocomplete on scale and chord fields, derived display lines showing computed notes (e.g. "C lydian dominant: C D E F# G A Bb") next to each typed value, diatonic-chord pickers generated from `Key.majorKey` and `Key.minorKey`, roman-numeral input via `Progression.fromRomanNumerals` (the composer types `ii7` or `V7/vi` and the field resolves it against the current tonic), Detect-from-Notes convenience that infers harmony from recent firings, and warnings when a chord and scale are inconsistent. None of these require any GXW-side music-theory code; they are surfaces over Tonal calls. The inspector's harmony band redesign is naturally scheduled for the same release as the Tonal foundation.

Progression data. Tonal handles progression mechanics (transposition, roman-numeral conversion, key analysis) but does not ship a library of named jazz standards. "Use the chord progression from Angel Eyes" requires standards data that lives outside Tonal. The data path is to be settled when progression-aware features land; possibilities include curating a small starter set of public-domain or original progressions, accepting iReal-Pro export strings as an import format, or letting users define progressions inline in behaviour code. The mechanics work either way; the question is how the data arrives.

### Strudel as a pattern engine

Strudel becomes a long-term dependency at the second phase. Three independent use cases are anticipated, in implementation-difficulty order.

**Inward integration: GXW behaviours call Strudel as a library.** A behaviour that wants a compact rhythmic phrase, a voice-led chord progression, or any of Strudel's pattern transformations imports the relevant operators and uses them. Mini-notation strings carry rhythmic and melodic phrases inside behaviour code; `chord("<Am7 D7 GMaj7 CMaj7>").voicings('lefthand')` produces voice-led jazz chord events that the bridge function delivers as GXW musical events. The bridge translates Strudel's cycle-based pattern-event model into GXW's per-event firing model: behaviour code asks the bridge "given the pattern P and the current scene-time position T and a window W, what events fire in the interval [T, T+W]?" and the bridge returns them, ready to fire from inside the behaviour. This is the highest-value use case for everyday composition and the one Phase 2 below targets.

**Outward integration: GXW exposes scenes as Strudel-compatible patterns.** A Strudel user writes `gxw("scene-name").voicing()` and receives a pattern whose events come from GXW simulation rather than from mini-notation. Existing Strudel users gain access to GXW scenes as compositional material without leaving the Strudel REPL; the integration's audience expands beyond the GXW user base into the broader Strudel community. The technical lift is implementing Strudel's pattern protocol against the GXW scene-event model. Likely delivered as a separate npm package or Strudel plugin so that Strudel users can install it without installing all of GXW.

**Synthesis: GXW pattern operators for scene-derived events.** Pattern transformations (`every`, `slow`, `fast`, `superimpose`, `rev`, `chunk`) applied to event streams that originate in scene geometry rather than in mini-notation. A behaviour writes `curveEvents("sweep1").every(4, transpose(7)).voicing("lefthand")` and gets pattern-style transformations applied to events the curve produces. The design work specifying what pattern algebra means against scene-event sources has not been done; this phase is captured as aspirational.

### Magic variables in patterns

The deepest integration point — and the one that distinguishes GXW most clearly from a system that merely calls Strudel as a library — is making GXW context fields available as references *inside* mini-notation patterns. A pattern token prefixed with `# GXW Design Document

Version 2.3 — Updated April 2026
Status: Living document.

Naming: GXW is the web-based successor to GeoSonix. The W stands for Web. The project folder and repository live at /Users/chrisgr/ProgrammingProjects/GXW. An earlier Python desktop prototype, GXM, exists at /Users/chrisgr/ProgrammingProjects/GX2 and remains preserved as reference; GXW supersedes it as the active development path.

Revision v2.3 introduces an accessibility section (Section 26) and a first feature within it: perceptual brightness reduction for imported background images. The transformation is spatially aware — a base/detail decomposition that pulls down large continuously-bright regions while leaving small bright features and midtones untouched — so that broad bright areas of an imported image stop dominating the canvas while local contrast and detail throughout the image remain readable. The transformation affects only the displayed image; the underlying pixel data used by triggers and sprites for music generation passes through unchanged. Three parameters (blur radius, threshold, maximum attenuation) are exposed as user settings with a bypass toggle for direct comparison. See Section 26.

Revision v2.3 also locks down the full per-curve musical-timing model and the three-mode beat-points authoring system, both of which had been partially specified in earlier revisions. Each curve now carries its own time signature (beatsPerBar with beatInterval as the denominator) plus a beatOffset shifting the cursor's score-beat-zero position, in addition to the existing cycleDuration field. The score-level time signature is removed from the transport in this revision, with a future revision possibly reintroducing it as something curves can opt to inherit. Beat-points authoring acquires three modes — normal (the composer types the active-beats string), euclidean (the inspector generates the string from numeric parameters), and none (no beats fire) — with the active-beats string remaining the engine's source of truth across all modes. Pattern strings accept space and pipe characters as visual formatting that the engine strips before interpretation; pipes auto-insert at bar boundaries to give immediate visual confirmation of completed bars as the composer types. The strength string's cycling semantic is changed from the prior pointer-based model to a slot-modulo model — slot k reads strength[k mod len(strength)] regardless of whether the slot fires — which makes active-beats and strength cycle on the same slot-index master clock and admits clean reasoning about polyrhythmic drift between coprime-length strings. See Section 7 for the transport changes and Section 10 for the full beat-points and strength-string treatment.

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
- [Section 26 — Accessibility](#section-26--accessibility)
- [Section 27 — Tonal and Strudel Integration](#section-27--tonal-and-strudel-integration)

---

## Section 1 — Vision

GXW is a web app for composing music that emerges from 2D scenes. A scene is a substrate of curves and triggers placed at considered positions. Curves have intrinsic rhythmic structure and play their own beat points on internal cycles; curves with extended cursors also sweep through the scene, triggering any triggers they encounter — this is the GeoMaestro projector idea preserved as a property of every curve. Sprites are autonomous agents that wander the scene, reading its image-as-scalar-field and firing musical events based on their environment. All agents share one transport and one musical framework.

The composer works by editing a JavaScript sketch file describing the scene, its objects, and their behaviour. GXW watches the sketch and re-executes it whenever it changes. A canvas shows the scene and its animation. Sound is produced by the browser's Web Audio API, and optionally routed to external synthesisers via Web MIDI where supported.

Sketches are typically constructed and modified through conversation with Claude, which edits the sketch directly. The conversational authoring experience is a first-class concern of GXW rather than an external workflow.

---

## Section 2 — Conceptual Model

A GXW scene holds three kinds of first-class objects — curves, triggers, and sprites — plus an optional background image that acts as a scalar field and a transport that keeps global tempo and time.

Curves are geometric shapes (line, ellipse, piste, bezier, and other named forms) with intrinsic rhythmic structure. Each curve has a set of beat points distributed around its shape according to an algorithmic generator (primarily Euclidean) or a hand-authored pattern string. Each curve has a visible cursor that advances through its cycle over a settable number of beats. When the cursor reaches an active beat point, the curve's beat function fires. If the cursor has non-zero extent on either side of the curve direction, it sweeps through space as it advances, and any triggers in the swept region fire. Curves combine geometry, rhythm, and projection into one coherent compositional object.

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

Shape. A curve has a geometric form — line segment, ellipse, piste (polyline), bezier, or a more elaborate named type (helice, rose, spiral, and other shapes from the GeoMaestro catalogue). The shape defines the curve's spatial presence and the path along which the cursor advances. Shape types in implementation priority order: line segment, ellipse, piste, bezier, helice. A circle is an ellipse with equal width and height — the two are stored as one shape primitive so that a toolbar-created circle and a runtime-distorted ellipse share one geometry, and the inspector's W and H fields can be edited independently without the shape's type string flipping as a side effect of typing in a number.

Beat points. A curve's rhythm is defined by two independent strings — active-beats and strength — plus a beat-points mode controlling how active-beats is authored. The active-beats string uses "x" and "." to mark which slot positions fire; the strength string uses digits 0–9 to set the emphasis of each firing. Both strings cycle independently as the cursor advances through the cycle's slots, so each can be any length the composer chooses; when the two lengths do not share simple ratios with each other or with cycleDuration, the audible rhythm pattern evolves slot-to-slot as the strings drift, a generative property the composer can deliberately exploit. The mode field selects between three authoring routes — normal (compose the string by typing), euclidean (generate the string from numeric parameters), and none (no beats fire) — without changing what the engine sees: the active-beats string remains the engine's source of truth in every mode. Beat points render as tick marks along the curve at the cycle positions corresponding to the active beats, with active positions visually distinguishable from inactive ones. Active beat points pulse briefly when fired, with the pulse's brightness reflecting the firing's current strength. Strength-zero firings emit musical events at velocity 0 (semantically distinct from a rest, which emits no event); they do not produce audible sound on most synthesisers but they do count as firings. Section 10 is the full treatment.

Cursor. A curve has a visible cursor that advances through its cycle at a rate governed by the curve's cycleDuration field (see "Cycle length and per-cycle modulation" below). The cursor has two extent values, R (right of curve direction) and L (left of curve direction), set independently. When both are zero, the cursor is a single point on the curve — purely a progress indicator with no spatial presence, visible only to the composer watching playback. When either R or L is non-zero, the cursor becomes a line segment of that length perpendicular to the curve's direction, and as the cursor advances, the segment sweeps through space.

Extended cursors collide with triggers in the scene. This is the GeoMaestro projector capability preserved as a property of every curve. A line-segment curve with R=5 and L=5 sweeping from A to B over 4 beats is a classic projector. Setting both extents to zero turns the curve back into a pure rhythmic player with no spatial sweep. The extent is continuous property, not a mode switch — any curve can be a projector by setting extent, or stop being one by setting it back to zero.

Functions. A curve has two optional function slots:

- The beat function fires when the curve's cursor reaches an active beat point during internal cycle advancement. It does not fire on external collisions.
- The sweep function fires when the curve's extended cursor collides with a trigger in the scene (either a free-standing trigger or a beat-as-trigger on another curve). It does not fire on internal beat points.

Either or both slots may be undefined. A curve with only a beat function and a zero-extent cursor is a rhythmic player. A curve with only a sweep function is a projector that doesn't play its own beat points. A curve with both is a rhythmic projector that simultaneously plays its own rhythm and sweeps other objects. A curve with neither is pure visual scaffolding, drawn but silent.

Beats-as-triggers property. A curve has a "beats are triggers" property (default false). When true, the curve's active beat points become externally collidable — another curve's extended cursor sweeping across these positions will fire them, with context including which curve was hit and which beat point was struck. See Section 10 for how the strength string cycles under external collisions.

Cycle length and per-cycle modulation. A curve's cycle is divided into slots. cycleDuration (positive integer, default 4) gives the number of slots; beatInterval (string token, default "Qtr") gives each slot's musical duration. Together they determine how long the cursor takes to traverse one cycle of the curve in score time: cycleDuration × beatInterval expressed in quarter-notes at the score's current tempo. beatInterval is drawn from a fixed dropdown of musical note values spanning 384th-note up to four-whole-notes per slot (full list in Section 10), so different curves can quantize to different note values within the same score, producing polyrhythmic and polymetric textures. beatsPerBar (positive integer, default 4) is the numerator of the curve's time signature with beatInterval as the denominator — beatInterval Quarter with beatsPerBar 3 reads as 3/4 time, beatInterval 8th with beatsPerBar 6 reads as 6/8. beatsPerBar drives the inspector's visual structure of the active-beats and strength strings (see Section 10's pipe-character rule) and is reserved for future bar-aware features (per-bar chord changes, downbeat emphasis, bar-aligned canvas rendering); it does not affect cursor traversal timing. beatOffset (signed integer, default 0) shifts where the cursor sits at score-beat zero by that many slots, which is also where rewind sends the cursor — a beatOffset of 2 makes the curve's slot 0 fire two slots' worth of musical time after the score begins. Cycle time in seconds is derived at runtime from cycleDuration, beatInterval, and the score's BPM; never stored, so a tempo change rescales every curve's cycle time automatically without per-curve adjustment.

This collapses the GeoSonix triplet of cycleDuration, cursorSpeed, and cycleTime into one duration field, which removes the Time Lock checkbox that GeoSonix needed to disambiguate which of the three was the source of truth at any moment. The musical capability that GeoSonix's Cursor Speed field provided — temporal modulation of the cursor's traversal — is preserved through two other fields described below.

cycleSpeeds is a string of space-separated numeric multipliers (default "1") applied to the cycle's score-time duration cycle by cycle. With cycleSpeeds = "0.4 2 -1", the first cycle takes 0.4 × (cycleDuration × beatInterval) quarter-notes, the second takes 2 × the same, the third reverses direction at the same per-quarter-note rate (negative values reverse), and the list cycles when it runs out. Single-value lists like "1" or "0.5" produce uniform cycle pacing; multi-value lists produce per-cycle modulation including reverse motion. Fractional values are allowed. The multiplier scales the cycle's wall-clock duration, not its slot count: every slot is visited every cycle regardless of speed, so the rhythm pattern encoded in the active-beats and strength strings plays in full at any speed (a 0.5 multiplier compresses the same pattern into half the time; a -1 multiplier runs it backward in normal time). Each slot's effective musical duration during a cycle is therefore beatInterval × |speedMultiplier|, with the sign of speedMultiplier controlling cursor direction.

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

The transport is global, with state: BPM, current beat position, play/stop/pause/rewind, and optional tempo automation. Time signature is per-curve in v2.3 (see Section 10's beatsPerBar and beatInterval); the score-level transport does not carry a time signature in this revision. A future revision may reintroduce a score-level time signature that curves can opt to inherit through a per-curve flag, but the current model leaves time-signature decisions entirely with each curve, which directly enables polyrhythmic and polymetric textures across curves on the same canvas.

Curves convert their cycle time from slots to wall-clock seconds using cycleDuration × beatInterval × current BPM at evaluation time (see Section 4 and Section 10 for the per-curve fields). Tempo changes during a cycle affect pacing accordingly. Triggers' auto timers tick in beats, converted to wall-clock time via BPM. Sprites drive physics from the transport's beat clock — physics time step is expressed in beats; wall-clock mapping happens via tempo. Halving tempo doubles the time it takes a sprite to cover the same spatial trajectory; forces and field values don't depend on tempo, only pacing does.

Duration overrides: each curve's cycle time, each trigger's auto interval, and each sprite's auto interval can be specified in beats (default), absolute seconds (ignores tempo), or proportional units relative to some reference.

Per-object tempo override is available but deferred. Common case is one global tempo.

Determinism. The transport's job is to advance a beat counter; the simulation's evolution is exclusively a function of (initial scene state, elapsed beats), with no dependence on wall-clock timing during the run. Rewind resets every piece of dynamic state — sprite positions, cursor positions, behaviour-internal counters — to whatever the scene declares as initial state, so a piece played from beat zero through to beat N produces the identical sequence of events on every replay regardless of how fast the audio callback runs in wall time. This determinism property is the foundation for repeatable composition (the composer can rate a piece without it changing under them) and for offline rendering (the same simulation, run faster than realtime, produces sample-identical audio output). The simulation's master time unit is integer ticks at 960 ticks per quarter-note, chosen so every value in the beatInterval dropdown maps to an integer tick count.

Transport controls are exposed in a bar along the bottom of the main window: a rewind button and a play-pause toggle on the left, followed by an elapsed-time readout and a BPM field. The BPM default is defined in the sketch's setup() function (see Section 14); BPM is editable at runtime from the transport bar for live experimentation, and runtime changes do not write back to the sketch, so a sketch reload restores the value defined in setup().

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

Pre-loaded helpers available globally to all functions: scaleMap, rangeMap, chordMap, harmonyMap, listMap. Plus Math. The helpers will gain Tonal as their underlying engine in a phase documented in Section 27, expanding their vocabulary substantially without changing existing call sites.

---

## Section 10 — Beat Points and Strength Strings

A curve's rhythm and cursor timing are defined by a set of musical-timing fields plus two strings (active-beats and strength) authored under one of three modes. Every aspect of a curve's musical timing is per-curve; the score provides only the global tempo (BPM, see Section 7). This section is the full treatment; Section 4 summarizes.

### Per-curve musical-timing fields

These fields exist on every curve regardless of beat-points mode, and they carry across mode changes.

- **cycleDuration** (positive integer, default 4). The number of slots in one full cycle of the curve. The cursor advances through the cycle one slot at a time, taking cycleDuration slots to complete a cycle. cycleDuration is also the resolution at which the active-beats and strength strings are sampled by the engine cycling rule below.

- **beatInterval** (string token, default "Qtr"). The musical duration of one slot. Drawn from a fixed dropdown list, ordered roughly from shortest to longest with triplet and dotted variants interspersed: 384th, 128th, 64th, 32nd, 8th Tr, 16th, Qtr Tr, Dot 16th, 8th, Half Tr, Dot 8th, Qtr, Dot Qtr, Half, Dot Half, Whole, 2 x Wh, 4 x Wh. Triplet variants ("Tr") are two-thirds of the named duration; dotted variants ("Dot") are one-and-a-half times the named duration; "2 x Wh" and "4 x Wh" are two- and four-times whole-note durations for slow events. The token resolves at use time to a rational duration in quarter-notes through a fixed conversion table. Combined with cycleDuration, beatInterval determines the curve's cycle duration in score time: a curve with cycleDuration 32 and beatInterval "16th" has a cycle lasting 8 quarter-notes; the same cycleDuration with beatInterval "Whole" lasts 128 quarter-notes. beatInterval is per-curve, allowing different curves to quantize to different note values within the same score (one curve playing 16ths against another playing triplet 8ths produces a 16-against-12 polyrhythm).

- **beatsPerBar** (positive integer, default 4). The numerator of the curve's time signature, with beatInterval as the denominator. beatInterval Quarter with beatsPerBar 3 is 3/4 time; beatInterval 8th with beatsPerBar 6 is 6/8 time. Currently consumed by the inspector for visual structure of the active-beats and strength strings (see "Pipe characters" below) and reserved for future bar-aware features (per-bar chord changes, downbeat emphasis on the canvas, bar-level shared properties applied across a curve). beatsPerBar does not affect cursor traversal timing in the simulation.

- **beatOffset** (signed integer, default 0). The slot at which the cursor sits at score-beat zero, which is also where rewind sends it. With beatOffset 0, the cursor begins at slot 0 when the score is rewound. With beatOffset 2, the cursor effectively begins two slots earlier — slot 2 is what plays at score-beat zero, and slot 0 plays beatInterval × 2 quarter-notes later in score time. Negative values are allowed and have the inverse effect, advancing the curve into its first cycle before score-beat zero.

The curve's score-time cycle duration is therefore cycleDuration × beatInterval (in quarter-notes), modulated cycle-by-cycle by cycleSpeeds (see Section 4). Rewind resets the cursor to (-beatOffset) mod cycleDuration. A curve added mid-piece via a behaviour callback starts at its own slot 0 at the moment of spawning; beatOffset still applies as the offset from the spawn moment, but the spawned curve does not retroactively act as if it had been running since score-beat zero.

### Beat-points mode

A curve's `beatPointsMode` field selects how the active-beats string is authored. The mode never affects what the engine sees — the engine reads only the active-beats string itself. The mode controls authoring ergonomics in the inspector.

- **normal** (default). The composer types the active-beats string directly. The string is the source of truth.

- **euclidean**. The active-beats string is generated by the inspector from three numeric parameters: `activeBeatsCount` (the count of active beats to distribute), `beatShift` (a rotational offset that shifts the entire pattern around the cycle by N slots), and `repeats` (an internal repetition count: a Euclidean rhythm of length cycleDuration ÷ repeats with activeBeatsCount ÷ repeats actives is generated and then concatenated `repeats` times to fill cycleDuration slots). The generated string is exactly cycleDuration characters long and is stored as the curve's active-beats string for the engine to consume. The inspector renders the active-beats field read-only in this mode; only the numeric parameters drive the rhythm. Switching from euclidean to normal freezes the currently-generated string as the new source of truth, which the composer may then edit.

- **none**. No beats fire. The active-beats string is conceptually absent; the inspector stores a single "." so the engine validators stay satisfied. The diamond beat-point markers do not render on the curve. Useful for curves that exist purely as paths for cursor sweep against external triggers.

Mode switching is loss-tolerant. Going from euclidean to normal preserves the generated string. Going from normal to euclidean defaults the parameters to whatever produces the closest pattern, or to a neutral starting state — the inspector decides; the runtime is unaffected. Switching to none stashes the active-beats string for restoration if the user switches back to the previous mode within the session.

Read-only field behaviour. The activeBeats field is read-only when the mode is euclidean or none. Read-only here means the field accepts focus and allows text selection and copy-to-clipboard, but rejects all keystrokes that would mutate the content (typing, paste, cut, delete). The visual treatment matches the inspector's existing greying-when-inapplicable pattern: the green frame is replaced by a more muted styling so the field reads as not-currently-editable. Hover or focus reveals a small inline hint near the field along the lines of "Read-only in Euclidean mode — change the mode to type a custom pattern." The hint disappears when focus moves away. The mode dropdown is the documented escape hatch: switching to normal mode preserves the currently-displayed string as the new editable starting content. The strength field is editable as normal in euclidean mode, since only activeBeats is generated; in none mode both strings are conceptually empty and both fields are read-only with placeholder text indicating no pattern.

### The active-beats string

The string accepts four character classes: `x` (active position), `.` (rest position), space (display-only formatting), and `|` (display-only bar separator, auto-inserted by the inspector). The first two are meaningful to the engine; the latter two are stripped before any engine-level interpretation.

The user types only `x`, `.`, and optionally space. Any non-`.` non-space character typed in normal mode is canonicalized to `x` on commit, so uppercase X, capital letters, digits, and other characters all become `x`. The JSON only ever stores lowercase `x`, `.`, space, and pipe. Pipe characters are inserted by the inspector, never typed. Position 0 of the stripped string must be `x` or `.`; the inspector rejects any commit that would violate this, and the inspector also rejects any commit where the stripped string is empty.

Spaces and pipes are formatting characters preserved in the JSON exactly as the inspector renders them, so that re-loading a score reproduces the same visual structure the user typed. Engine cycling operates on the stripped string (spaces and pipes removed) and uses its length for the modulo operation. Consecutive spaces typed by the user collapse to a single space on commit, so that two users typing visually-identical patterns end up with byte-identical JSON.

### Pipe characters in displayed strings

A pipe character (`|`) appears in the displayed string at every position k × beatsPerBar where the count of typed beat characters (after stripping spaces and pipes) is at least k × beatsPerBar. Pipes are inserted and removed by the inspector as the user types; the user does not type pipes, and the user cannot prevent them from appearing.

A pipe at the end of a string confirms that a bar has been completed; a pipe between characters confirms a bar boundary in the middle. Pipes provide immediate feedback as the user types:

```
beatsPerBar = 3:
User types "x"          →  display "x"
User types "xx"         →  display "xx"
User types "xxx"        →  display "xxx|"     (bar completed; pipe appears)
User types "xxxx"       →  display "xxx|x"
User types "xxxxxx"     →  display "xxx|xxx|" (second bar completed)
User types "xxxxxxx"    →  display "xxx|xxx|x"
```

Deletion produces the inverse: a pipe disappears as soon as the bar it was confirming becomes incomplete. In Euclidean mode, the generated string fills exactly cycleDuration slots, so pipes appear at every k × beatsPerBar position where k × beatsPerBar ≤ cycleDuration. With cycleDuration 15 and beatsPerBar 4, pipes appear at positions 4, 8, 12 — the final segment of three slots is partial and the position-16 pipe is suppressed because there is no character at position 16 to be confirmed.

Pipes are display-only. The engine strips them along with spaces before applying the cycling rule.

When the user changes beatsPerBar with content already typed in activeBeats or strength, the inspector recomputes pipe positions for both strings on commit of the beatsPerBar field. The mechanic is: strip existing pipes from each displayed string, apply the typed-character-count rule above using the new beatsPerBar, re-insert pipes at the new positions, write the result back to the curve. The engine sees no change since pipes are stripped before cycling, but the displayed and stored JSON representations change. In a multi-select where curves with different content all change beatsPerBar together, each curve's re-pipe pass runs against that curve's own typed-character count, so the curves may end up looking very different after the change even though they were edited together — the difference reflects their different content and is correct.

### The strength string

The strength string accepts digits 0–9, spaces, and pipes. Position 0 of the stripped string must be a digit; the inspector rejects commits that would violate this, and rejects commits where the stripped string is empty. Non-digit non-space characters are rejected outright (no canonicalization, since digits don't have an obvious mapping for arbitrary letters). Spaces and pipes follow the same rules as in active-beats: stored verbatim in JSON with collapse, stripped by the engine, pipes auto-inserted at bar boundaries determined by beatsPerBar and the count of typed digits.

A strength digit applies to a slot only when that slot fires. Strength 0 means "fires silently" — a musical event is emitted at velocity 0, semantically distinct from a `.` rest in active-beats (which is no event at all). On most synthesisers a velocity-0 note is inaudible, but the firing still counts: it advances any beat-counted state in the curve's beat function, it triggers visual pulse rendering (which may be near-invisible at velocity 0), and instruments that respond to velocity-0 events as note-offs receive them.

### Engine cycling rule

For each slot k in 0 .. cycleDuration − 1 of the cycle:

1. Let A be the active-beats string with spaces and pipes stripped. Let S be the strength string with spaces and pipes stripped.
2. The slot fires iff `A[k mod A.length] == 'x'`.
3. When the slot fires, its velocity is the digit at `S[k mod S.length]`.

Both strings cycle independently at their own lengths against the same slot-index master clock. When A.length and S.length are coprime or otherwise non-aligned with each other or with cycleDuration, the audible compound pattern's period extends to lcm(cycleDuration, lcm(A.length, S.length)) before truly repeating — an evolving rhythm derived from short typed strings, which is a genuine compositional tool.

Note that this slot-modulo cycling rule is a deliberate change from the pre-v2.3 spec, which described a pointer-based model where the strength string advanced only on active firings. The slot-modulo model unifies the cycling semantics of the two strings (both indexed by slot k), simplifies the simulation engine (no per-curve pointer state to track and reset), and admits clean reasoning about polyrhythmic drift between coprime-length strings without dependence on which slots happen to be active in the current cycle.

The validators guarantee A.length ≥ 1 and S.length ≥ 1 after stripping, so the modulo is always well-defined. Empty stripped strings cannot be committed.

cycleSpeeds (a separate field; see Section 4) advances per cycleDuration iteration, not per compound period. A curve with cycleDuration 16 and cycleSpeeds "0.4 2 -1" runs the first 16 slots at the 0.4 multiplier regardless of where the active-beats and strength strings happen to be in their independent cycles, then the next 16 slots at the 2 multiplier, and so on.

### Score-curve independence and rewind

Curves play independently of any global score-level structure. The score provides global tempo (BPM) only; the score does not have its own time signature in v2.3. Each curve's cycle starts at score-beat zero (offset by beatOffset slots) and advances at its own rate from there. Curves drift freely against each other and against any notional score bar lines.

Rewind resets all dynamic state to the scene's declared initial state (Section 7). Cursor positions return to (-beatOffset) mod cycleDuration. Sprite positions return to whatever positions the scene declares. Behaviour-internal counters reset to their initial values. Played from beat zero through to beat N, the score always produces the identical sequence of musical events because the simulation's evolution is exclusively a function of (initial state, elapsed beats).

### "Beats are triggers" and external collision

When a curve's `beatsAreTriggers` property is true, its active beat points become collidable as triggers by other curves' extended cursors. Section 4 discusses the property in the context of the curve's collision role; Section 8 describes the one collision rule. The slot-modulo cycling rule above applies identically whether a beat is fired by the internal cursor advancing through the cycle or by an external cursor sweeping the position: in both cases, the slot is the slot, and `S[k mod S.length]` gives the velocity. There is no separate external pointer (the prior pointer-based model had one); a single slot-indexed read is sufficient under the unified rule.

Only active positions are externally collidable. Inactive positions (`.`) produce no firing internal or external, and render no diamond marker on the curve. The active-beats string fully determines where beat points visibly exist on the curve and where external cursors can collide with them.

### Validation summary

The inspector commits are guarded by these validation rules. A commit attempt that would violate any of them is rejected, with the field's value reverting to its previous state and a hint shown to the user.

- cycleDuration: positive integer
- beatInterval: token from the fixed dropdown list
- beatsPerBar: positive integer
- beatOffset: signed integer
- beatPointsMode: one of "normal", "euclidean", "none"
- activeBeats (after stripping spaces and pipes): length ≥ 1; position 0 is `x` or `.`; all characters in {`x`, `.`}
- strength (after stripping spaces and pipes): length ≥ 1; position 0 is a digit; all characters digits 0–9

---

## Section 10.5 — Unified Bound-Trigger Model (Proposed)

A captured proposal for evolving the trigger and beat-point model in a future revision. The current "beats are triggers" property described in Sections 4 and 10 makes a curve's active beat points externally collidable but leaves them rendered as tick marks and conceptually distinct from triggers. This proposal goes further: visualise and treat curve beat points as triggers themselves — geometrically bound to their parent curve and inheriting their behaviour from the curve, but otherwise the same kind of object as standalone triggers. The unification removes a redundant concept, gives beat points a more visible and consistent visual identity, and unlocks compositional capabilities the current model does not offer. The proposal supersedes the "beats are triggers" property: in the new model, beat points are always triggers, and a separate visibility setting controls only whether they are exposed to other curves' cursors.

Visual rendering. Each active beat point on a curve renders as a diamond — a small four-pointed glyph rotated so two opposite points lie on the curve and the other two extend perpendicular to it. The diamond reads simultaneously as "this is a trigger" (matching the standalone trigger glyph at first glance) and "this is bound to its curve" (the orientation declares which curve owns it without further ornament). Inactive positions in the active-beats string render no glyph; strength-zero positions, which already do not fire, also render no glyph for consistency with their silent semantics. Edits to the active-beats string cause diamonds to appear and disappear in place, the same way tick marks behave today.

Inheritance model. Every property of a bound trigger lives on the parent curve, not on the individual diamond. The bound-trigger function (the slot that fires when any cursor sweeps the bound trigger), the visual styling, the visibility setting described below, and any other declarative properties are all curve-level. The individual diamonds have no separately editable state; they are visual manifestations of the curve's beat pattern, with positions derived from the curve's parameterisation. This dodges the multi-select-across-many-beats problem in the property inspector: editing "this curve's bound-trigger function" is one edit on the curve, not one edit per diamond, and the alternative of multi-selecting all the bound triggers on a curve would be awkward when other unrelated objects sit between them on the canvas. It also avoids the orphaning problem that per-beat property overrides would cause whenever the active-beats string is rewritten. Per-beat differentiation — accenting every fourth beat, for instance — is achieved by the bound-trigger function reading its beat-index argument from context and varying its behaviour accordingly. The function is shared; the data feeding it is per-beat. The strength string is one such per-beat data channel today; richer per-beat data is discussed under "Future direction" below.

External visibility. A curve has a visibility property controlling whether its bound triggers are exposed to other curves' cursors. The default is bound-only: bound triggers respond only to their parent curve's cursor, matching the typical case of a curve playing its own rhythm. When externally visible, the bound triggers become collidable by any cursor in the scene, including the parent's, and the existing one-and-only collision rule (extended cursor hits trigger) handles cross-curve sweep without modification. When an external cursor sweeps an externally-visible bound trigger, the parent curve's bound-trigger function fires — not the visiting curve's sweep function. The bound trigger remains the source of truth for what happens when it is hit, regardless of who hit it, matching how standalone triggers already behave. The strength-pointer dual described in Section 10 (one pointer for internal cycles, a separate pointer for external collisions) carries forward into this model unchanged. Inspector label wording is to be settled when the inspector exposes the field; "Visible to other curves" and "Externally triggerable" are candidates.

Function precedence with sweep functions. When a cursor with a defined sweep function hits a trigger that also has a defined function (whether a standalone trigger's collision function or a curve's bound-trigger function), two conceptual models compete. Cursor-as-actor treats the cursor as the player and the trigger as a position-only target. Trigger-as-actor treats the trigger as the locus of musical content and the cursor as the playhead. Compositions may legitimately want either. The rule is whichever-has-a-function wins when only one is defined: if only the trigger has a function, the trigger fires; if only the cursor's curve has a sweep function, the cursor's sweep function fires. When both are defined, both fire in defined order: the trigger's function fires first, then the cursor's sweep function. Each runs with its normal context object as documented in Section 9; neither knows about the other. Two musical events per collision is the expected outcome and is treated as a feature — the trigger's function might emit a note while the cursor's sweep function emits a controller change, logs the hit, animates a secondary effect, or fires its own note. A composer who wants the cursor's sweep function alone to control the collision response defines only that function and leaves the trigger's function undefined; a composer who wants the trigger to fire identically regardless of which cursor hits it defines only the trigger's function. The data shape declares the conceptual model: defined-ness is the switch, both-defined means both run, and there is no third hidden mode where the runtime chooses between the two. If the trigger's function and the cursor's sweep function need to coordinate (for instance, suppressing the cursor's emission when the trigger has already handled the hit), they do so through shared context state the composer reads and writes, not through a precedence rule the runtime enforces.

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

Helper functions in message-function bodies consult these parameters. `scaleMap(value, { scale: ctx.scale, root: ctx.root })` maps a 0-1 input value into a note within the currently effective scale. `chordMap(index, { chord: ctx.chord })` returns the indexed chord tone. These helpers read from the context (which carries the current effective harmony for the firing object) rather than from score-level globals, so per-object overrides are automatically respected. The harmony-framework vocabulary, including the named scales and chords accepted by these fields, will broaden substantially when Tonal becomes the underlying theory engine; see Section 27.

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

The transport bar at the bottom contains, from left to right: a rewind button, a play-pause toggle button, an elapsed-time readout in minutes, seconds, and hundredths, and a BPM field editable via up-down stepper arrows. Time signature is per-curve in v2.3 (Section 10) and does not appear on the transport bar. A vertical grey divider separates these controls from the right half of the bar, which is reserved for error and status output from sketch execution.

The canvas is a live viewer. It displays the scene: background image, vector field visualisation (optional), curves rendered as their geometric shapes with tick marks at beat points and animated cursors (extended cursors render as perpendicular lines showing their sweep region), triggers rendered as filled dots sized by their collision radius, sprites rendered as filled circles coloured from the pixel underneath with white ring outline, and optional trails fading behind sprites.

Canvas toolbar and direct manipulation. A toolbar strip across the top of the canvas pane holds object-creation tools. Each tool has three states: idle, armed (one-shot — single placement, then back to idle), and locked (repeat placements until the user disarms). Single-clicking a tool button arms it; double-clicking locks it; clicking the active tool again disarms at any state; the Escape key disarms from any state. While armed or locked the cursor over the canvas is a crosshair, and clicks place a new object at the click position. Mouse-down on a tool button briefly flashes green so the click feels acknowledged in real time, and the armed/locked classes carry that green forward into the persistent state. The current toolbar exposes a single tool, Add Sprite; Add Trigger and the curve-shape tools follow.

Selection model. With no tool armed, the canvas behaves as a selection surface. Clicking an object selects it (replacing any previous selection); shift-clicking toggles the object's membership in the selection; clicking empty space clears everything. Dragging from empty space draws a marquee — a translucent grey rectangle that follows the mouse — and on release every object the marquee touches joins the selection (or replaces it when shift is not held). Dragging from a selected sprite moves all selected sprites together; dragging from an unselected sprite first replaces the selection with just that sprite, then moves it. Selection is multi-kind: sprites, triggers, and curves can all be selected together, with selection markers as yellow dotted squares around sprites and triggers, and yellow dotted bounding-box rectangles around curves. Hit-testing tries sprites first, then triggers, then curves so the visually-topmost object wins ties. Drag-to-move is sprite-only at this milestone; triggers and curves can be selected and deleted but not moved through the canvas yet.

Edit pipeline. Canvas operations — Add Sprite, drag-to-move sprites, Delete to remove objects of any kind — commit by parsing scene.json, mutating the parsed data, stringifying back, updating the bundle in place, refreshing the editor's Properties JSON view, then re-running the scene. Re-running auto-saves first, so each canvas edit also persists through the normal save pipeline. The Delete and Backspace keys remove all currently-selected objects; the listener checks the focus target so typing in the JSON tab still does the obvious thing. Selection is filtered against array lengths after each scene reload so a move-style edit (which preserves indexes) keeps the user's selection through the consequent re-render, while a delete or score switch prunes stale entries.

Property inspector. The form-based property inspector ships in v1 form, occupying the Properties tab as the primary editing surface for object properties. It renders six bands sized by their constraint rows (identity; geometry and visual; message functions; auto message interval; beat points; cycle parameters) with selection-driven greying — fields that don't apply to the current selection stay in their fixed positions but lose their green frame and brighten only when active, so the form's layout never reflows when the selection changes. The inspector is blank when nothing is selected, matching GeoSonix's empty-selection convention.

Reflow rule. Each band has a fixed vertical height that does not change for any reason — not for selection changes, not for mode changes, not for any other state. Bands occupy fixed vertical positions in the inspector and never move. Within a band, fields may appear, disappear, or swap based on selection or mode, provided the band's overall height stays constant. For example, the beat-points band's Euclidean parameter row shows when the mode is euclidean and hides when the mode is normal or none, but the band reserves the same vertical space in either case so that bands below it (cycle parameters, etc.) never shift position. This stability is an accessibility concern: the user, particularly under accessibility zoom, can rely on each band sitting in a consistent location and can build muscle memory for where to look for a given field. The cost is some always-reserved space that may be empty under certain modes, which is acceptable.

Vertical fit. The inspector targets fitting bands 1 through 6 (identity, geometry/visual, message functions, auto interval, beat points, cycle parameters) without vertical scrolling in a normally-sized browser window. The bands below that point — the deferred harmony and MIDI-routing area, including Object MIDI, Object Harmony, and Score Harmony when those land — may require vertical scrolling to access; this is acceptable because they are edited less frequently than the per-object bands above. If the user resizes the browser window smaller than typical, scrolling may also be required to reach the lower per-object bands, which is also acceptable but expected to be rare. The natural inspector pane width grows as needed to fit the constraint rows of the per-object bands; v2.3 targets approximately 700 pixels wide as the natural width, set by Band 5's Curve Beat Points timing row and Band 6's cycle-parameters row.

v1 is partially data-bound: Band 1 (identity) reads and writes real object data, including JS-identifier validation on the Name field with hard-error and soft-conflict squiggly underlines; multi-select greying and tri-state varies indicators on the Mute and Hide checkboxes work across all kinds. Bands 5 (beat points) and 6 (cycle parameters) are next. Bands 2 (geometry), 3 (message functions), and 4 (auto interval) remain layout-only with placeholder values. Function-slot dropdowns sourced from behaviours.js, Create button scaffolding for stub functions, and harmony-override fields are all later-milestone work tracked in Section 25 question 1. The raw scene.json view that the inspector replaces moves to a Properties JSON tab, kept available as a fallback until the inspector covers every editable field.

AI authoring pane. A conversational pane is available for chatting with Claude. Requests like "add two more triggers near the top right" or "make the sprite wander faster" cause Claude to edit the sketch. The pane is toggleable and can be hidden when not in use. This is described further in Section 14.

No REPL in the initial release. No live-coding during playback initially (edit-and-rerun loop only). A future milestone may expose per-line and per-function evaluation of sketch code into a live workspace, matching the GeoSonix execution model; this is an open question flagged in Section 25.

Keyboard shortcuts: Spacebar toggles play-pause. R rewinds. Cmd-S saves the active tab. Cmd-Shift-S saves all tabs. Cmd-O opens a score. Cmd-N creates a new score.

A version history panel (toggleable visibility) shows the bundle's git history as a scrollable list of versions: milestones prominent, time-based markers next, auto-commits available via a "show all versions" toggle. Each entry has a human-readable timestamp and description. Click to view or restore.

Accessibility. Limited vision is a first-class concern in the UI. Large bold fonts throughout, a dark theme, and visible grey dividers segmenting every window region. No use of colour alone to convey information. Browser ARIA attributes and screen reader compatibility are preserved. Browser zoom composes cleanly with any OS-level zoom. Imported background images pass through a perceptual brightness reduction transform before display so that broad bright regions do not dominate the canvas while local contrast and detail are preserved; only the displayed image is affected, the pixel data used for music generation passes through unchanged. The transform's parameters and bypass toggle live in Settings. See Section 26 for the full description.

---

## Section 14 — Authoring Workflow

A score's data and behaviour are split across two files in the bundle: scene.json (declarative data) and behaviours.js (named JavaScript functions). The two files are tied together by name reference: scene.json's function-slot fields hold strings that name functions defined in behaviours.js, and the scene loader resolves them at run time.

scene.json contains piece-level parameters (bpm, time signature, harmony framework, output target, image name, per-score scales) plus three arrays — curves, triggers, sprites — each entry of which is a flat object with the declarative properties for one object (geometry, rhythm strings, position, function-slot names, harmony overrides). No JavaScript runs from scene.json; it's pure data that any tool can read or write.

behaviours.js contains named JavaScript functions referenced from scene.json. Top-level function declarations and top-level const/let bindings to function expressions and arrows are exposed by name; the file is executed once on every scene load to build a function map. The split lets a property inspector, the canvas toolbar, or an AI assistant edit scene.json directly without parsing or rewriting any code, while the JavaScript editor keeps full freedom over behaviours.js.

Example scene.json:

```json
{
  "bpm": 120,
  "tonic": "D",
  "scaleName": "D minor",
  "imageName": "background.jpg",
  "triggerScale": 1,
  "spriteScale": 1,
  "curves": [
    {
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 10, "h": 10 },
      "cycleDuration": 4,
      "beatInterval": "Qtr",
      "beatsPerBar": 4,
      "beatOffset": 0,
      "cycleSpeeds": "1",
      "stopAtCycle": -1,
      "beatPointsMode": "normal",
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

Possible extension: change-summary artefact. Captured as an idea for the implementation phase, not part of the current v2.3 specification. The handoff folder could include a CHANGES.md file written by the AI side and treated as observation-only by GXW on Fetch — flagged in handoff.json alongside the snapshots so that any apparent edits to it are silently ignored. The file's purpose is to give the composer a brief description of what the AI added, modified, or removed since the handoff, what reasoning shaped those choices, and what alternatives were considered but set aside. The bootstrap-and-tweak workflow benefits particularly: when the composer fetches new behaviour code, the change summary explains the AI's thinking before the composer reads any code, which lowers the cognitive cost of refining the result. Display would initially be outside GXW (the AI's conversation transcript itself, or any text editor opened on the file); a dedicated panel inside GXW surfacing the most recent change summary alongside the score is a possible later refinement. Whether this carries enough weight to specify is a judgment call to be settled when the AI Handoff feature is implemented.

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

25. Unified bound-trigger model. Section 10.5 captures a proposed evolution that visualises and treats curve beat points as triggers bound to their parent curve, rendered as diamonds rotated so two opposite vertices lie on the curve, with shared inheritance from the curve, an external-visibility setting controlling exposure to other curves' cursors, and a whichever-has-a-function-wins-when-only-one-is-defined rule (with both-fire-in-defined-order when both are defined) for resolving cursor sweep functions against trigger functions. Open issues within the proposal: the inspector wording for the visibility setting, and the pattern-grammar design for the phrase-pasting future direction (encoding per-beat pitch and payload alongside the existing strength data so a melodic phrase can be pasted onto a curve as bound triggers). The proposal sits in a post-v2.3 milestone window; the v2.3 property-inspector work does not need to anticipate it.

26. Trigger Sync to Beat semantics, ownership, and inspector placement. The curve-inspector's Band 6 has carried a placeholder Trigger Sync to Beat combo since the inspector first shipped, with no specified semantics and no data binding. The intended meaning is quantization: a non-Off setting from the eighteen beat-interval tokens defers a triggered firing from the moment of physical collision to the next boundary of the chosen grid in score time, while Off fires at collision. The grid is the score's tempo grid, independent of any curve's beatInterval setting. Three open questions remain. First, ownership: per-trigger (the property lives on the trigger; one trigger fires on its own grid no matter who hits it; auto-fired events defer to the same grid; different curves hitting the same trigger get the same quantization), per-curve (the property lives on the curve; one curve produces quantized firings on its own grid no matter which trigger it sweeps; auto-fired triggers don't participate; different curves hitting the same trigger get different quantization), or both with a precedence rule. The per-trigger view fits the natural reading that quantization is a property of the firing event and the firing event lives on the trigger; it also extends cleanly to auto-fired triggers. The per-curve view fits the reading that the cursor's motion owns the timing of the collision-detection event; it also extends to a curve's own internal beat firings landing on a separate grid from its slot grid (though slot firings already land on slot boundaries by definition, so this case is mostly degenerate). Historical GeoSonix behaviour and which view best serves real composition both inform the choice. Second, semantics edge cases: what happens when multiple collisions occur within one quantization interval (collapse to one firing? all fire on the boundary?); how Off interacts with auto-firing; whether the deferred firing carries the original collision context (which curve, which sweep position) or recomputes context at the firing moment. Third, inspector placement: Band 6 of the curve view continues to hold the placeholder combo through v2.3 regardless of where ownership lands, because adding a trigger-specific band or row for one field would cost more than is justified at this point. If ownership turns out to be per-trigger, the placeholder will eventually move to the trigger-property inspector when broader trigger-property work happens; if per-curve, the placeholder is already in the right place and just needs data binding. The data-model field, validator, and engine consumption (in the Simulation module) are all deferred until ownership is settled and real binding lands.

---

## Section 26 — Accessibility

Limited vision is a first-class design concern for GXW, not an afterthought. Every UI decision is checked against whether it remains usable when accessibility zoom is active and when bright regions cause physical discomfort. This section collects accessibility provisions that are substantial enough to warrant their own design treatment; smaller provisions — large bold fonts, dark theme, visible grey dividers, no colour-alone signalling, ARIA attributes, muted scrollbars — live in Section 13 alongside the rest of the UI specification.

Perceptual brightness reduction for imported images. Imported background images on the canvas pass through a non-linear brightness transformation before display. The goal is to reduce eye strain from large continuously-bright regions while preserving local contrast and detail throughout the image. A simple global brightness or gamma reduction would be insufficient: it darkens dim regions and midtones equally, making the image as a whole hard to read, while still leaving large bright areas relatively dominant in proportion to the rest. The required behaviour is spatially aware — small bright features (a highlight, a specular dot, a thin bright line) sitting in an otherwise dark region must retain their brightness, while large continuously-bright regions (a bright sky, a white wall, a broad light area) must be dimmed substantially. Dimmer regions and midtones are untouched or nearly so.

Approach: base-detail decomposition. A blurred copy of the image serves as an estimate of regional luminance, the base layer. For each pixel of the original image, the regional luminance from the blurred image is read and used to compute an attenuation factor; that factor is multiplied into the original pixel's RGB values to produce the displayed pixel. Because the factor is derived from the blurred neighbourhood but applied to the unblurred pixel, local contrast and fine detail are fully preserved — the dimming responds to broad spatial trends, not to per-pixel intensity. Broad bright regions get pulled down; bright pixels embedded in dark regions stay bright because their neighbourhood is dark.

Attenuation curve. The factor is 1.0 (no attenuation) below a configurable threshold of regional luminance, then rolls off smoothly above the threshold using a smoothstep or similar easing function so the transition does not produce visible banding. At maximum regional luminance the factor reaches the configured maximum-attenuation floor (a value below 1.0; for example 0.5 means the brightest large regions are halved). The smooth roll-off makes the transition between protected and dimmed luminance ranges visually continuous; a hard step would introduce visible contour lines tracking the threshold's iso-luminance curves through the image.

Music generation is unaffected. The transformation runs in the rendering layer only. The pixel-sampling array used by triggers and sprites for image-driven music generation reads from the original, untransformed image data. This is a hard requirement: the visual representation of the image is an accessibility concern, but the image's role as scalar field driving the composition must remain faithful to the source. Two image snapshots are maintained side by side at import time — the original for sampling, the transformed for display — and the canvas renderer always draws the transformed snapshot while `_sampleImageAt` and equivalent paths always read from the original.

When the transform runs. Once at the moment of import, with the result cached. "Import" here covers the full set of paths through which an image arrives in the bundle: user-initiated image import via the file menu or drag-drop, score load from IndexedDB or the AI Handoff folder, and any other event that mutates the bundle's image bytes. Whenever the bundle's image bytes change, the transform re-runs and the cached result is replaced. The transform does not re-run on draw; the canvas just renders the already-transformed bitmap on every frame.

When the user changes the transform parameters in Settings, the currently displayed image re-processes immediately so the user can adjust the sliders and see the effect without restarting or re-importing. The bypass toggle takes the same path: when toggled off, the original image displays directly; when toggled back on, the cached transformed result displays again with no recomputation.

User-exposed parameters. Three numeric controls in Settings, ideally as sliders, with a fourth toggle for bypass:

- Blur radius. The spatial scale that defines "large continuous bright region." Larger values mean only very broad bright areas are affected; smaller values dim more localised bright patches. Default 5–10% of the smaller image dimension. Range roughly 5–200 pixels.
- Threshold. The regional luminance below which no dimming is applied, on a 0–1 scale. Protects midtones and shadows from being darkened. Default around 0.5; range 0.0–0.9.
- Maximum attenuation. The multiplier applied to the brightest large regions, on a 0–1 scale. A value of 0.5 halves the brightest large regions; a value of 1.0 disables the effect entirely. Default 0.5; range 0.2–1.0.
- Bypass toggle. When enabled, displays the original imagery without the transformation. Useful for direct comparison and for cases where the user wants to see the unaltered image briefly. Music generation is unaffected by the bypass setting since it never used the transformed data.

Settings persistence. The four controls persist across sessions and apply to all subsequently imported images. When a score is loaded, its background image is processed using the user's current settings, regardless of which settings were active when the score's image was originally imported. The settings are user-level preferences, not per-score; a user with photophobia or accessibility needs configures them once and they apply to every score the user opens, including scores authored by other users and shared into IndexedDB or via AI Handoff.

Implementation. The HTML Canvas 2D API supports all of this without needing WebGL or shaders. An offscreen canvas with `ctx.filter = 'blur(Npx)'` produces the base layer using hardware-accelerated Gaussian blur; this is well-supported across modern browsers. A per-pixel pass then reads luminance from the blurred canvas using Rec. 709 weights (0.2126 R + 0.7152 G + 0.0722 B), computes the attenuation factor per the curve described above, and writes attenuated RGB to the output canvas. The alpha channel passes through unchanged. The transform runs once at import; no per-frame cost.

Known limitation: halos. Gaussian blur does not respect edges, so very high-contrast boundaries can produce faint halos in the transformed image — a thin band of slight brightening or darkening around the boundary, where the blurred neighbourhood luminance disagrees most strongly with the local pixel's luminance. This is acceptable for the first implementation and is not visually disruptive in most images. If halos prove distracting on imagery the user actually composes with, the Gaussian blur can be replaced with an edge-preserving filter such as the Gastál–Oliveira domain transform, which runs in linear time with separable passes and is implementable in roughly fifty lines of JavaScript. The replacement is a drop-in for the blur step; nothing else in the pipeline changes.

Future additions. Other accessibility provisions worth keeping in mind for this section as they arise: a high-contrast theme variant for the inspector and editor, font-size scaling controls independent of OS-level zoom, text-to-speech integration hooks (the user already drives Apple Speak Selection paragraph-by-paragraph against GXW's UI text), and screen-reader-friendly status announcements for state changes that currently signal only visually (transport play state, dirty indicator, save events). None of these are in scope for v2.3; the perceptual-brightness-reduction feature is the only accessibility provision being introduced this revision.

---

 is read as a context-variable reference rather than a literal: `$lum` resolves to the firing object's current luminance, `$r` to the red channel under its position, `$x` and `$y` to position, `$vx` and `$vy` to sprite velocity, `$strength` to the current strength digit, `$scale` and `$chord` and `$tonic` to the inherited harmony context, and so on for the full set of context fields documented in Section 9. The pattern is a template the scene fills in.

Concretely:

```js
// Eight events per cycle, with note pitch determined by the firing object's
// current luminance, in the scale set by the firing object's harmony context.
note("$lum*8").scale("$scale")
```

```js
// A chord progression voiced with smooth voice-leading, where the chord
// is whatever the firing object's harmony context says is active right now.
chord("$chord").voicings('lefthand')
```

```js
// Note pitch follows luminance, gain follows red channel, played reversed,
// with every fourth cycle doubled in speed. The pattern's structure is
// Strudel's; the data feeding the structure is GXW's.
note("$lum*8").gain("$r").every(4, fast(2)).rev()
```

The pattern's structure (cycle length, transformations, conditional operators) remains Strudel's; the values feeding the structure come from GXW. Strudel's full algebra continues to apply on top.

Two evaluation timings cover the two natural use cases. `$var` (single dollar) evaluates at event time — every event in a pattern can pick up a different value if the context changed between events. `$var` (double dollar) evaluates at pattern-query time — all events in a single bridge query share the value sampled at the moment of the query. The first is the natural choice for slowly-changing context (cursor position on a long curve, sprite trajectory through an image); the second is the natural choice for context that should be sampled "as of this firing" and held steady through the burst of events the firing produces. Both are exposed; the syntax distinction is small enough that composers can pick per use case without thinking hard about it.

Tempo inheritance accompanies the magic-variable extension. A Strudel pattern attached to a curve, trigger, or sprite inherits its tempo from that object's own temporal motion rather than from a global Cycles-Per-Second setting. For a curve, "fraction of cycle completed" maps onto pattern cycle position. For a trigger, the pattern advances one event per firing (effectively a step sequencer). For a sprite, the pattern's cycle position derives from elapsed scene-time or path length travelled. A single pattern definition `note("c e g b")` attached to two different curves moving at different speeds plays at two different rates, with the rates determined by the curves themselves rather than by a global clock. This gives composers something Strudel does not natively offer: heterogeneous tempos within one piece, where multiple patterns play simultaneously at unrelated rates because they are driven by independent geometric motions, and rhythmic alignments emerge or collapse as the geometry causes the rates to synchronise or drift.

Determinism preservation. The simulation is deterministic per Section 7 — sprite positions, cursor positions, behaviour-internal counters all reset on rewind and the simulation's evolution is exclusively a function of (initial state, elapsed beats). Magic variables in patterns inherit this property: every input the pattern reads is itself reproducible, so the pattern's events are reproducible. The bridge implementation must avoid introducing its own state — any caching of pattern queries between simulation ticks must invalidate or reseed correctly on rewind — but the determinism property carries through cleanly when the bridge is correct. Strudel's apparently-non-deterministic operators (`degradeBy`, `irand`, `rand`) are pseudorandom with seedable sources; the bridge seeds them against the simulation's beat counter so rewinding reproduces identical events.

Unified context model. The magic-variable mechanism uses the same context-field names and the same lookup semantics as Section 9's behaviour-function context objects. If `lum` in a behaviour body means `ctx.lum` for the firing object, then `$lum` in a mini-notation pattern means the same thing, evaluated against the same context. There is one notion of "the context this code is running in," and both behaviour code and the patterns inside the behaviour read from it. The unified model avoids the failure mode of two parallel context systems that subtly disagree.

### Packaging and dependency boundaries

The Tonal–Strudel–superdough integration involves three orthogonal decisions that the npm packaging structure permits to be made independently. Tonal is its own published library with no Strudel dependency. Strudel's pattern-engine packages (`@strudel/core`, `@strudel/mini`, `@strudel/tonal`, `@strudel/transpiler`) depend on each other but not on superdough. superdough is its own published package with no dependency on Strudel; it is the engine that `@strudel/webaudio` happens to wrap, but it can be used directly without that wrapping. From Strudel's own discussion forum, capturing the intent behind the package split: *you only need core and webaudio to generate music; add mini and transpiler if you want concise user code, and add tonal if you want to use scales and chords.*

In principle, GXW could adopt any combination: Tonal alone, Tonal plus the pattern engine, Tonal plus superdough, all three together, or even none of them. In practice, the recommended path commits to all three but in two stages. Phase 1 adds Tonal and superdough together, since neither depends on the Strudel pattern engine and both deliver immediate independent value: Tonal as the music-theory foundation feeding GXW's harmony helpers, superdough as the audio engine replacing the placeholder voice bank Section 19 originally specified. Phase 2 adds the Strudel pattern engine (`@strudel/core`, `@strudel/mini`, `@strudel/tonal`) on top, with the bridge functions described above translating between Strudel's pattern-event model and GXW's per-event firing model. The pattern engine can route audio through superdough either via `@strudel/webaudio`'s wrapping or by having behaviour code call superdough directly while Strudel events flow through GXW's existing event pipeline; both work and the choice is per-behaviour.

Adopting superdough early, in Phase 1, has a benefit beyond the technical one of giving GXW a richer sound palette: it aligns GXW with Strudel users at the timbral level immediately. The same drum machines, instruments, and effects are available regardless of which surface a composer is working in, and a performer who switches between a Strudel REPL set and a GXW set in the same performance encounters no sudden timbral discontinuity. This community-and-audience benefit arrives independently of the longer-running pattern-engine work in Phase 2 and beyond.

### Implementation phases

The integration is a multi-release effort. Each phase delivers user value independently of the next, so the rollout can pause between phases without leaving partial work in user-visible state.

**Phase 1: Tonal and superdough as foundation libraries.** Tonal is added as a dependency. The helper functions documented above are implemented as wrappers over Tonal primitives and pre-loaded as globals available to all behaviour functions, replacing the v2.3 placeholder helpers. Inspector enhancements that depend on Tonal — autocomplete, derived display, diatonic pickers, roman-numeral entry — land in this phase or a closely-following one. superdough is added as the audio engine in the same phase, replacing the placeholder voice bank from Section 19; behaviours produce sound through superdough's parameter object, with the GXW musical-event format wrapping it directly. The two libraries have no overlap and no dependency on each other or on Strudel's pattern engine, so adopting them together is straightforward and the work parallelises cleanly. This phase has high immediate value: behaviour code becomes substantially shorter for any music-theory-aware task, the inspector becomes substantially more accurate and helpful for harmony fields, and the available sound palette becomes substantially richer than what GXW would specify on its own. Target: post-v2.3, sequenced after the property inspector and AI Handoff land.

**Phase 2: Strudel mini-notation parser and bridge functions.** Strudel's `@strudel/mini` and `@strudel/tonal` packages are added as dependencies. Bridge helpers expose Strudel patterns to behaviour code via `nextEventFrom(pattern)`, `eventsInWindow(pattern, time, window)`, and similar functions. Behaviour authors can write mini-notation strings and have them produce events. The Tonal-driven Strudel operators (`scale`, `chord`, `voicings`, `rootNotes`, `scaleTranspose`) become available inside behaviour code. Patterns at this phase use Strudel's global cycle clock; tempo inheritance comes later.

**Phase 3: Magic variables, pre-processor implementation.** The `$var` and `$var` syntax is implemented as a pre-processor that runs before the mini-notation string is handed to Strudel's parser. The pre-processor substitutes magic-variable references with placeholder tokens, the bridge resolves placeholders against the firing object's context as it pulls events, and the result is GXW-aware patterns. The pre-processor is a maintainable starting point that proves the idea before deeper integration. The set of supported variables grows incrementally; image and position fields come first, motion fields next, harmony fields next.

**Phase 4: Tempo inheritance.** The bridge function gains an attachment-aware mode where the pattern's cycle position is derived from the parent object's temporal state rather than from a global clock. Per-curve, per-trigger, and per-sprite pattern clocks become independent, enabling heterogeneous tempos. This phase requires careful design of the pattern-clock semantics for each object type; the design work is documented in this section's open questions below.

**Phase 5: Outward integration — GXW as a Strudel pattern source.** Strudel's pattern protocol is implemented against GXW scenes, so that Strudel users can write `gxw("scene-name")` and receive a pattern fed by GXW simulation. This expands the integration's audience to the existing Strudel community without requiring them to leave Strudel. A separate npm package or Strudel plugin is the likely delivery shape; users who want only the outward integration would not have to install all of GXW.

**Phase 6: GXW-specific pattern operators.** Pattern transformations applied to scene-derived event streams — `curveEvents("sweep1").every(4, transpose(7)).voicing("lefthand")` and similar. This phase requires design work specifying what pattern algebra means against non-mini-notation event sources, and which subset of Strudel's operators carries over coherently. Captured aspirationally; depends on the earlier phases having proven the design.

**Phase 7 and beyond: ongoing.** Upstream contributions to Strudel's mini-notation parser to absorb the magic-variable extension as a native feature, replacing the pre-processor; expansion of the Tonal helper layer with style-aware improvisation primitives drawing on the music-theoretic ambition documented in the project's longer-term plans (jazz-line generation that follows progression and respects voice-leading rules); integration with Strudel's audio engine for users who want GXW behaviours to drive Strudel synthesis rather than GXW's own audio output.

Phases 1 and 2 are the highest-value commitments. They establish the foundation that every subsequent phase rests on, and each independently makes behaviour code dramatically more capable for routine music-theoretic tasks. Phases 3 and 4 are the distinctive contribution and the phases that make GXW interesting to the Strudel community as more than just another consumer of Strudel libraries. Phases 5 and beyond are aspirational and depend on the earlier phases having proven the design.

### Community and audience

The Strudel community is the largest active JavaScript-based live-coding community and the natural early-adopter audience for a system in this space. Aligning with Tonal and Strudel makes the syntax of GXW behaviour code, the music-theory primitives, and the pattern vocabulary all instantly familiar to that community. The cost of trying GXW for an existing Strudel user is small: no new language, no new theory model, no new pattern grammar — only a new compositional source. The reverse cost — a GXW composer learning Strudel for performance work outside GXW — is also small, because the same vocabulary applies in both surfaces.

Performance scenarios the integration enables:

- A live coder gives a primarily Strudel-based set, opens GXW for a section where image-driven composition adds variety the REPL cannot produce, then returns to Strudel.
- A composer arranges a GXW score visually using the canvas and writes pattern-aware behaviour code using Strudel mini-notation and Tonal helpers, performing entirely from inside GXW.
- A duo performs together with one performer in Strudel and one in GXW, both routing to a shared MIDI destination and listening to each other's events as inputs.
- A studio composer arranges material in GXW, exports the simulation's event stream as a pattern, and continues developing it in Strudel.

The integration treats these scenarios as equally valid and serves all of them through the same library substrate. None require a new product surface; they emerge from making GXW interoperable with the existing live-coding ecosystem.

### Open questions

- **Cycle alignment.** When a pattern is attached to a GXW object, does the pattern's notion of cycle time align with the score's beat clock, or with the object's own temporal motion? The answer affects how cycle-cycling pattern operators (`every`, `slow`, `fast`, the angle-bracket alternatives in mini-notation) behave. The current direction is "object's own motion" for per-event behaviours and "score-aligned" as an explicit opt-in for curve-attached patterns, but both conventions need worked examples before commitment.

- **Magic-variable syntax.** `$var` and `$var` are the working syntax. Alternatives like `{var}` and `{!var}`, `<var>`, or other markers are possible. The choice interacts with mini-notation's existing grammar — `[]` is used for sub-divisions, `<>` for cyclic alternation, `{}` for polymeter, `,` for stack chords. `# GXW Design Document

Version 2.3 — Updated April 2026
Status: Living document.

Naming: GXW is the web-based successor to GeoSonix. The W stands for Web. The project folder and repository live at /Users/chrisgr/ProgrammingProjects/GXW. An earlier Python desktop prototype, GXM, exists at /Users/chrisgr/ProgrammingProjects/GX2 and remains preserved as reference; GXW supersedes it as the active development path.

Revision v2.3 introduces an accessibility section (Section 26) and a first feature within it: perceptual brightness reduction for imported background images. The transformation is spatially aware — a base/detail decomposition that pulls down large continuously-bright regions while leaving small bright features and midtones untouched — so that broad bright areas of an imported image stop dominating the canvas while local contrast and detail throughout the image remain readable. The transformation affects only the displayed image; the underlying pixel data used by triggers and sprites for music generation passes through unchanged. Three parameters (blur radius, threshold, maximum attenuation) are exposed as user settings with a bypass toggle for direct comparison. See Section 26.

Revision v2.3 also locks down the full per-curve musical-timing model and the three-mode beat-points authoring system, both of which had been partially specified in earlier revisions. Each curve now carries its own time signature (beatsPerBar with beatInterval as the denominator) plus a beatOffset shifting the cursor's score-beat-zero position, in addition to the existing cycleDuration field. The score-level time signature is removed from the transport in this revision, with a future revision possibly reintroducing it as something curves can opt to inherit. Beat-points authoring acquires three modes — normal (the composer types the active-beats string), euclidean (the inspector generates the string from numeric parameters), and none (no beats fire) — with the active-beats string remaining the engine's source of truth across all modes. Pattern strings accept space and pipe characters as visual formatting that the engine strips before interpretation; pipes auto-insert at bar boundaries to give immediate visual confirmation of completed bars as the composer types. The strength string's cycling semantic is changed from the prior pointer-based model to a slot-modulo model — slot k reads strength[k mod len(strength)] regardless of whether the slot fires — which makes active-beats and strength cycle on the same slot-index master clock and admits clean reasoning about polyrhythmic drift between coprime-length strings. See Section 7 for the transport changes and Section 10 for the full beat-points and strength-string treatment.

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
- [Section 26 — Accessibility](#section-26--accessibility)
- [Section 27 — Tonal and Strudel Integration](#section-27--tonal-and-strudel-integration)

---

## Section 1 — Vision

GXW is a web app for composing music that emerges from 2D scenes. A scene is a substrate of curves and triggers placed at considered positions. Curves have intrinsic rhythmic structure and play their own beat points on internal cycles; curves with extended cursors also sweep through the scene, triggering any triggers they encounter — this is the GeoMaestro projector idea preserved as a property of every curve. Sprites are autonomous agents that wander the scene, reading its image-as-scalar-field and firing musical events based on their environment. All agents share one transport and one musical framework.

The composer works by editing a JavaScript sketch file describing the scene, its objects, and their behaviour. GXW watches the sketch and re-executes it whenever it changes. A canvas shows the scene and its animation. Sound is produced by the browser's Web Audio API, and optionally routed to external synthesisers via Web MIDI where supported.

Sketches are typically constructed and modified through conversation with Claude, which edits the sketch directly. The conversational authoring experience is a first-class concern of GXW rather than an external workflow.

---

## Section 2 — Conceptual Model

A GXW scene holds three kinds of first-class objects — curves, triggers, and sprites — plus an optional background image that acts as a scalar field and a transport that keeps global tempo and time.

Curves are geometric shapes (line, ellipse, piste, bezier, and other named forms) with intrinsic rhythmic structure. Each curve has a set of beat points distributed around its shape according to an algorithmic generator (primarily Euclidean) or a hand-authored pattern string. Each curve has a visible cursor that advances through its cycle over a settable number of beats. When the cursor reaches an active beat point, the curve's beat function fires. If the cursor has non-zero extent on either side of the curve direction, it sweeps through space as it advances, and any triggers in the swept region fire. Curves combine geometry, rhythm, and projection into one coherent compositional object.

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

Shape. A curve has a geometric form — line segment, ellipse, piste (polyline), bezier, or a more elaborate named type (helice, rose, spiral, and other shapes from the GeoMaestro catalogue). The shape defines the curve's spatial presence and the path along which the cursor advances. Shape types in implementation priority order: line segment, ellipse, piste, bezier, helice. A circle is an ellipse with equal width and height — the two are stored as one shape primitive so that a toolbar-created circle and a runtime-distorted ellipse share one geometry, and the inspector's W and H fields can be edited independently without the shape's type string flipping as a side effect of typing in a number.

Beat points. A curve's rhythm is defined by two independent strings — active-beats and strength — plus a beat-points mode controlling how active-beats is authored. The active-beats string uses "x" and "." to mark which slot positions fire; the strength string uses digits 0–9 to set the emphasis of each firing. Both strings cycle independently as the cursor advances through the cycle's slots, so each can be any length the composer chooses; when the two lengths do not share simple ratios with each other or with cycleDuration, the audible rhythm pattern evolves slot-to-slot as the strings drift, a generative property the composer can deliberately exploit. The mode field selects between three authoring routes — normal (compose the string by typing), euclidean (generate the string from numeric parameters), and none (no beats fire) — without changing what the engine sees: the active-beats string remains the engine's source of truth in every mode. Beat points render as tick marks along the curve at the cycle positions corresponding to the active beats, with active positions visually distinguishable from inactive ones. Active beat points pulse briefly when fired, with the pulse's brightness reflecting the firing's current strength. Strength-zero firings emit musical events at velocity 0 (semantically distinct from a rest, which emits no event); they do not produce audible sound on most synthesisers but they do count as firings. Section 10 is the full treatment.

Cursor. A curve has a visible cursor that advances through its cycle at a rate governed by the curve's cycleDuration field (see "Cycle length and per-cycle modulation" below). The cursor has two extent values, R (right of curve direction) and L (left of curve direction), set independently. When both are zero, the cursor is a single point on the curve — purely a progress indicator with no spatial presence, visible only to the composer watching playback. When either R or L is non-zero, the cursor becomes a line segment of that length perpendicular to the curve's direction, and as the cursor advances, the segment sweeps through space.

Extended cursors collide with triggers in the scene. This is the GeoMaestro projector capability preserved as a property of every curve. A line-segment curve with R=5 and L=5 sweeping from A to B over 4 beats is a classic projector. Setting both extents to zero turns the curve back into a pure rhythmic player with no spatial sweep. The extent is continuous property, not a mode switch — any curve can be a projector by setting extent, or stop being one by setting it back to zero.

Functions. A curve has two optional function slots:

- The beat function fires when the curve's cursor reaches an active beat point during internal cycle advancement. It does not fire on external collisions.
- The sweep function fires when the curve's extended cursor collides with a trigger in the scene (either a free-standing trigger or a beat-as-trigger on another curve). It does not fire on internal beat points.

Either or both slots may be undefined. A curve with only a beat function and a zero-extent cursor is a rhythmic player. A curve with only a sweep function is a projector that doesn't play its own beat points. A curve with both is a rhythmic projector that simultaneously plays its own rhythm and sweeps other objects. A curve with neither is pure visual scaffolding, drawn but silent.

Beats-as-triggers property. A curve has a "beats are triggers" property (default false). When true, the curve's active beat points become externally collidable — another curve's extended cursor sweeping across these positions will fire them, with context including which curve was hit and which beat point was struck. See Section 10 for how the strength string cycles under external collisions.

Cycle length and per-cycle modulation. A curve's cycle is divided into slots. cycleDuration (positive integer, default 4) gives the number of slots; beatInterval (string token, default "Qtr") gives each slot's musical duration. Together they determine how long the cursor takes to traverse one cycle of the curve in score time: cycleDuration × beatInterval expressed in quarter-notes at the score's current tempo. beatInterval is drawn from a fixed dropdown of musical note values spanning 384th-note up to four-whole-notes per slot (full list in Section 10), so different curves can quantize to different note values within the same score, producing polyrhythmic and polymetric textures. beatsPerBar (positive integer, default 4) is the numerator of the curve's time signature with beatInterval as the denominator — beatInterval Quarter with beatsPerBar 3 reads as 3/4 time, beatInterval 8th with beatsPerBar 6 reads as 6/8. beatsPerBar drives the inspector's visual structure of the active-beats and strength strings (see Section 10's pipe-character rule) and is reserved for future bar-aware features (per-bar chord changes, downbeat emphasis, bar-aligned canvas rendering); it does not affect cursor traversal timing. beatOffset (signed integer, default 0) shifts where the cursor sits at score-beat zero by that many slots, which is also where rewind sends the cursor — a beatOffset of 2 makes the curve's slot 0 fire two slots' worth of musical time after the score begins. Cycle time in seconds is derived at runtime from cycleDuration, beatInterval, and the score's BPM; never stored, so a tempo change rescales every curve's cycle time automatically without per-curve adjustment.

This collapses the GeoSonix triplet of cycleDuration, cursorSpeed, and cycleTime into one duration field, which removes the Time Lock checkbox that GeoSonix needed to disambiguate which of the three was the source of truth at any moment. The musical capability that GeoSonix's Cursor Speed field provided — temporal modulation of the cursor's traversal — is preserved through two other fields described below.

cycleSpeeds is a string of space-separated numeric multipliers (default "1") applied to the cycle's score-time duration cycle by cycle. With cycleSpeeds = "0.4 2 -1", the first cycle takes 0.4 × (cycleDuration × beatInterval) quarter-notes, the second takes 2 × the same, the third reverses direction at the same per-quarter-note rate (negative values reverse), and the list cycles when it runs out. Single-value lists like "1" or "0.5" produce uniform cycle pacing; multi-value lists produce per-cycle modulation including reverse motion. Fractional values are allowed. The multiplier scales the cycle's wall-clock duration, not its slot count: every slot is visited every cycle regardless of speed, so the rhythm pattern encoded in the active-beats and strength strings plays in full at any speed (a 0.5 multiplier compresses the same pattern into half the time; a -1 multiplier runs it backward in normal time). Each slot's effective musical duration during a cycle is therefore beatInterval × |speedMultiplier|, with the sign of speedMultiplier controlling cursor direction.

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

The transport is global, with state: BPM, current beat position, play/stop/pause/rewind, and optional tempo automation. Time signature is per-curve in v2.3 (see Section 10's beatsPerBar and beatInterval); the score-level transport does not carry a time signature in this revision. A future revision may reintroduce a score-level time signature that curves can opt to inherit through a per-curve flag, but the current model leaves time-signature decisions entirely with each curve, which directly enables polyrhythmic and polymetric textures across curves on the same canvas.

Curves convert their cycle time from slots to wall-clock seconds using cycleDuration × beatInterval × current BPM at evaluation time (see Section 4 and Section 10 for the per-curve fields). Tempo changes during a cycle affect pacing accordingly. Triggers' auto timers tick in beats, converted to wall-clock time via BPM. Sprites drive physics from the transport's beat clock — physics time step is expressed in beats; wall-clock mapping happens via tempo. Halving tempo doubles the time it takes a sprite to cover the same spatial trajectory; forces and field values don't depend on tempo, only pacing does.

Duration overrides: each curve's cycle time, each trigger's auto interval, and each sprite's auto interval can be specified in beats (default), absolute seconds (ignores tempo), or proportional units relative to some reference.

Per-object tempo override is available but deferred. Common case is one global tempo.

Determinism. The transport's job is to advance a beat counter; the simulation's evolution is exclusively a function of (initial scene state, elapsed beats), with no dependence on wall-clock timing during the run. Rewind resets every piece of dynamic state — sprite positions, cursor positions, behaviour-internal counters — to whatever the scene declares as initial state, so a piece played from beat zero through to beat N produces the identical sequence of events on every replay regardless of how fast the audio callback runs in wall time. This determinism property is the foundation for repeatable composition (the composer can rate a piece without it changing under them) and for offline rendering (the same simulation, run faster than realtime, produces sample-identical audio output). The simulation's master time unit is integer ticks at 960 ticks per quarter-note, chosen so every value in the beatInterval dropdown maps to an integer tick count.

Transport controls are exposed in a bar along the bottom of the main window: a rewind button and a play-pause toggle on the left, followed by an elapsed-time readout and a BPM field. The BPM default is defined in the sketch's setup() function (see Section 14); BPM is editable at runtime from the transport bar for live experimentation, and runtime changes do not write back to the sketch, so a sketch reload restores the value defined in setup().

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

Pre-loaded helpers available globally to all functions: scaleMap, rangeMap, chordMap, harmonyMap, listMap. Plus Math. The helpers will gain Tonal as their underlying engine in a phase documented in Section 27, expanding their vocabulary substantially without changing existing call sites.

---

## Section 10 — Beat Points and Strength Strings

A curve's rhythm and cursor timing are defined by a set of musical-timing fields plus two strings (active-beats and strength) authored under one of three modes. Every aspect of a curve's musical timing is per-curve; the score provides only the global tempo (BPM, see Section 7). This section is the full treatment; Section 4 summarizes.

### Per-curve musical-timing fields

These fields exist on every curve regardless of beat-points mode, and they carry across mode changes.

- **cycleDuration** (positive integer, default 4). The number of slots in one full cycle of the curve. The cursor advances through the cycle one slot at a time, taking cycleDuration slots to complete a cycle. cycleDuration is also the resolution at which the active-beats and strength strings are sampled by the engine cycling rule below.

- **beatInterval** (string token, default "Qtr"). The musical duration of one slot. Drawn from a fixed dropdown list, ordered roughly from shortest to longest with triplet and dotted variants interspersed: 384th, 128th, 64th, 32nd, 8th Tr, 16th, Qtr Tr, Dot 16th, 8th, Half Tr, Dot 8th, Qtr, Dot Qtr, Half, Dot Half, Whole, 2 x Wh, 4 x Wh. Triplet variants ("Tr") are two-thirds of the named duration; dotted variants ("Dot") are one-and-a-half times the named duration; "2 x Wh" and "4 x Wh" are two- and four-times whole-note durations for slow events. The token resolves at use time to a rational duration in quarter-notes through a fixed conversion table. Combined with cycleDuration, beatInterval determines the curve's cycle duration in score time: a curve with cycleDuration 32 and beatInterval "16th" has a cycle lasting 8 quarter-notes; the same cycleDuration with beatInterval "Whole" lasts 128 quarter-notes. beatInterval is per-curve, allowing different curves to quantize to different note values within the same score (one curve playing 16ths against another playing triplet 8ths produces a 16-against-12 polyrhythm).

- **beatsPerBar** (positive integer, default 4). The numerator of the curve's time signature, with beatInterval as the denominator. beatInterval Quarter with beatsPerBar 3 is 3/4 time; beatInterval 8th with beatsPerBar 6 is 6/8 time. Currently consumed by the inspector for visual structure of the active-beats and strength strings (see "Pipe characters" below) and reserved for future bar-aware features (per-bar chord changes, downbeat emphasis on the canvas, bar-level shared properties applied across a curve). beatsPerBar does not affect cursor traversal timing in the simulation.

- **beatOffset** (signed integer, default 0). The slot at which the cursor sits at score-beat zero, which is also where rewind sends it. With beatOffset 0, the cursor begins at slot 0 when the score is rewound. With beatOffset 2, the cursor effectively begins two slots earlier — slot 2 is what plays at score-beat zero, and slot 0 plays beatInterval × 2 quarter-notes later in score time. Negative values are allowed and have the inverse effect, advancing the curve into its first cycle before score-beat zero.

The curve's score-time cycle duration is therefore cycleDuration × beatInterval (in quarter-notes), modulated cycle-by-cycle by cycleSpeeds (see Section 4). Rewind resets the cursor to (-beatOffset) mod cycleDuration. A curve added mid-piece via a behaviour callback starts at its own slot 0 at the moment of spawning; beatOffset still applies as the offset from the spawn moment, but the spawned curve does not retroactively act as if it had been running since score-beat zero.

### Beat-points mode

A curve's `beatPointsMode` field selects how the active-beats string is authored. The mode never affects what the engine sees — the engine reads only the active-beats string itself. The mode controls authoring ergonomics in the inspector.

- **normal** (default). The composer types the active-beats string directly. The string is the source of truth.

- **euclidean**. The active-beats string is generated by the inspector from three numeric parameters: `activeBeatsCount` (the count of active beats to distribute), `beatShift` (a rotational offset that shifts the entire pattern around the cycle by N slots), and `repeats` (an internal repetition count: a Euclidean rhythm of length cycleDuration ÷ repeats with activeBeatsCount ÷ repeats actives is generated and then concatenated `repeats` times to fill cycleDuration slots). The generated string is exactly cycleDuration characters long and is stored as the curve's active-beats string for the engine to consume. The inspector renders the active-beats field read-only in this mode; only the numeric parameters drive the rhythm. Switching from euclidean to normal freezes the currently-generated string as the new source of truth, which the composer may then edit.

- **none**. No beats fire. The active-beats string is conceptually absent; the inspector stores a single "." so the engine validators stay satisfied. The diamond beat-point markers do not render on the curve. Useful for curves that exist purely as paths for cursor sweep against external triggers.

Mode switching is loss-tolerant. Going from euclidean to normal preserves the generated string. Going from normal to euclidean defaults the parameters to whatever produces the closest pattern, or to a neutral starting state — the inspector decides; the runtime is unaffected. Switching to none stashes the active-beats string for restoration if the user switches back to the previous mode within the session.

Read-only field behaviour. The activeBeats field is read-only when the mode is euclidean or none. Read-only here means the field accepts focus and allows text selection and copy-to-clipboard, but rejects all keystrokes that would mutate the content (typing, paste, cut, delete). The visual treatment matches the inspector's existing greying-when-inapplicable pattern: the green frame is replaced by a more muted styling so the field reads as not-currently-editable. Hover or focus reveals a small inline hint near the field along the lines of "Read-only in Euclidean mode — change the mode to type a custom pattern." The hint disappears when focus moves away. The mode dropdown is the documented escape hatch: switching to normal mode preserves the currently-displayed string as the new editable starting content. The strength field is editable as normal in euclidean mode, since only activeBeats is generated; in none mode both strings are conceptually empty and both fields are read-only with placeholder text indicating no pattern.

### The active-beats string

The string accepts four character classes: `x` (active position), `.` (rest position), space (display-only formatting), and `|` (display-only bar separator, auto-inserted by the inspector). The first two are meaningful to the engine; the latter two are stripped before any engine-level interpretation.

The user types only `x`, `.`, and optionally space. Any non-`.` non-space character typed in normal mode is canonicalized to `x` on commit, so uppercase X, capital letters, digits, and other characters all become `x`. The JSON only ever stores lowercase `x`, `.`, space, and pipe. Pipe characters are inserted by the inspector, never typed. Position 0 of the stripped string must be `x` or `.`; the inspector rejects any commit that would violate this, and the inspector also rejects any commit where the stripped string is empty.

Spaces and pipes are formatting characters preserved in the JSON exactly as the inspector renders them, so that re-loading a score reproduces the same visual structure the user typed. Engine cycling operates on the stripped string (spaces and pipes removed) and uses its length for the modulo operation. Consecutive spaces typed by the user collapse to a single space on commit, so that two users typing visually-identical patterns end up with byte-identical JSON.

### Pipe characters in displayed strings

A pipe character (`|`) appears in the displayed string at every position k × beatsPerBar where the count of typed beat characters (after stripping spaces and pipes) is at least k × beatsPerBar. Pipes are inserted and removed by the inspector as the user types; the user does not type pipes, and the user cannot prevent them from appearing.

A pipe at the end of a string confirms that a bar has been completed; a pipe between characters confirms a bar boundary in the middle. Pipes provide immediate feedback as the user types:

```
beatsPerBar = 3:
User types "x"          →  display "x"
User types "xx"         →  display "xx"
User types "xxx"        →  display "xxx|"     (bar completed; pipe appears)
User types "xxxx"       →  display "xxx|x"
User types "xxxxxx"     →  display "xxx|xxx|" (second bar completed)
User types "xxxxxxx"    →  display "xxx|xxx|x"
```

Deletion produces the inverse: a pipe disappears as soon as the bar it was confirming becomes incomplete. In Euclidean mode, the generated string fills exactly cycleDuration slots, so pipes appear at every k × beatsPerBar position where k × beatsPerBar ≤ cycleDuration. With cycleDuration 15 and beatsPerBar 4, pipes appear at positions 4, 8, 12 — the final segment of three slots is partial and the position-16 pipe is suppressed because there is no character at position 16 to be confirmed.

Pipes are display-only. The engine strips them along with spaces before applying the cycling rule.

When the user changes beatsPerBar with content already typed in activeBeats or strength, the inspector recomputes pipe positions for both strings on commit of the beatsPerBar field. The mechanic is: strip existing pipes from each displayed string, apply the typed-character-count rule above using the new beatsPerBar, re-insert pipes at the new positions, write the result back to the curve. The engine sees no change since pipes are stripped before cycling, but the displayed and stored JSON representations change. In a multi-select where curves with different content all change beatsPerBar together, each curve's re-pipe pass runs against that curve's own typed-character count, so the curves may end up looking very different after the change even though they were edited together — the difference reflects their different content and is correct.

### The strength string

The strength string accepts digits 0–9, spaces, and pipes. Position 0 of the stripped string must be a digit; the inspector rejects commits that would violate this, and rejects commits where the stripped string is empty. Non-digit non-space characters are rejected outright (no canonicalization, since digits don't have an obvious mapping for arbitrary letters). Spaces and pipes follow the same rules as in active-beats: stored verbatim in JSON with collapse, stripped by the engine, pipes auto-inserted at bar boundaries determined by beatsPerBar and the count of typed digits.

A strength digit applies to a slot only when that slot fires. Strength 0 means "fires silently" — a musical event is emitted at velocity 0, semantically distinct from a `.` rest in active-beats (which is no event at all). On most synthesisers a velocity-0 note is inaudible, but the firing still counts: it advances any beat-counted state in the curve's beat function, it triggers visual pulse rendering (which may be near-invisible at velocity 0), and instruments that respond to velocity-0 events as note-offs receive them.

### Engine cycling rule

For each slot k in 0 .. cycleDuration − 1 of the cycle:

1. Let A be the active-beats string with spaces and pipes stripped. Let S be the strength string with spaces and pipes stripped.
2. The slot fires iff `A[k mod A.length] == 'x'`.
3. When the slot fires, its velocity is the digit at `S[k mod S.length]`.

Both strings cycle independently at their own lengths against the same slot-index master clock. When A.length and S.length are coprime or otherwise non-aligned with each other or with cycleDuration, the audible compound pattern's period extends to lcm(cycleDuration, lcm(A.length, S.length)) before truly repeating — an evolving rhythm derived from short typed strings, which is a genuine compositional tool.

Note that this slot-modulo cycling rule is a deliberate change from the pre-v2.3 spec, which described a pointer-based model where the strength string advanced only on active firings. The slot-modulo model unifies the cycling semantics of the two strings (both indexed by slot k), simplifies the simulation engine (no per-curve pointer state to track and reset), and admits clean reasoning about polyrhythmic drift between coprime-length strings without dependence on which slots happen to be active in the current cycle.

The validators guarantee A.length ≥ 1 and S.length ≥ 1 after stripping, so the modulo is always well-defined. Empty stripped strings cannot be committed.

cycleSpeeds (a separate field; see Section 4) advances per cycleDuration iteration, not per compound period. A curve with cycleDuration 16 and cycleSpeeds "0.4 2 -1" runs the first 16 slots at the 0.4 multiplier regardless of where the active-beats and strength strings happen to be in their independent cycles, then the next 16 slots at the 2 multiplier, and so on.

### Score-curve independence and rewind

Curves play independently of any global score-level structure. The score provides global tempo (BPM) only; the score does not have its own time signature in v2.3. Each curve's cycle starts at score-beat zero (offset by beatOffset slots) and advances at its own rate from there. Curves drift freely against each other and against any notional score bar lines.

Rewind resets all dynamic state to the scene's declared initial state (Section 7). Cursor positions return to (-beatOffset) mod cycleDuration. Sprite positions return to whatever positions the scene declares. Behaviour-internal counters reset to their initial values. Played from beat zero through to beat N, the score always produces the identical sequence of musical events because the simulation's evolution is exclusively a function of (initial state, elapsed beats).

### "Beats are triggers" and external collision

When a curve's `beatsAreTriggers` property is true, its active beat points become collidable as triggers by other curves' extended cursors. Section 4 discusses the property in the context of the curve's collision role; Section 8 describes the one collision rule. The slot-modulo cycling rule above applies identically whether a beat is fired by the internal cursor advancing through the cycle or by an external cursor sweeping the position: in both cases, the slot is the slot, and `S[k mod S.length]` gives the velocity. There is no separate external pointer (the prior pointer-based model had one); a single slot-indexed read is sufficient under the unified rule.

Only active positions are externally collidable. Inactive positions (`.`) produce no firing internal or external, and render no diamond marker on the curve. The active-beats string fully determines where beat points visibly exist on the curve and where external cursors can collide with them.

### Validation summary

The inspector commits are guarded by these validation rules. A commit attempt that would violate any of them is rejected, with the field's value reverting to its previous state and a hint shown to the user.

- cycleDuration: positive integer
- beatInterval: token from the fixed dropdown list
- beatsPerBar: positive integer
- beatOffset: signed integer
- beatPointsMode: one of "normal", "euclidean", "none"
- activeBeats (after stripping spaces and pipes): length ≥ 1; position 0 is `x` or `.`; all characters in {`x`, `.`}
- strength (after stripping spaces and pipes): length ≥ 1; position 0 is a digit; all characters digits 0–9

---

## Section 10.5 — Unified Bound-Trigger Model (Proposed)

A captured proposal for evolving the trigger and beat-point model in a future revision. The current "beats are triggers" property described in Sections 4 and 10 makes a curve's active beat points externally collidable but leaves them rendered as tick marks and conceptually distinct from triggers. This proposal goes further: visualise and treat curve beat points as triggers themselves — geometrically bound to their parent curve and inheriting their behaviour from the curve, but otherwise the same kind of object as standalone triggers. The unification removes a redundant concept, gives beat points a more visible and consistent visual identity, and unlocks compositional capabilities the current model does not offer. The proposal supersedes the "beats are triggers" property: in the new model, beat points are always triggers, and a separate visibility setting controls only whether they are exposed to other curves' cursors.

Visual rendering. Each active beat point on a curve renders as a diamond — a small four-pointed glyph rotated so two opposite points lie on the curve and the other two extend perpendicular to it. The diamond reads simultaneously as "this is a trigger" (matching the standalone trigger glyph at first glance) and "this is bound to its curve" (the orientation declares which curve owns it without further ornament). Inactive positions in the active-beats string render no glyph; strength-zero positions, which already do not fire, also render no glyph for consistency with their silent semantics. Edits to the active-beats string cause diamonds to appear and disappear in place, the same way tick marks behave today.

Inheritance model. Every property of a bound trigger lives on the parent curve, not on the individual diamond. The bound-trigger function (the slot that fires when any cursor sweeps the bound trigger), the visual styling, the visibility setting described below, and any other declarative properties are all curve-level. The individual diamonds have no separately editable state; they are visual manifestations of the curve's beat pattern, with positions derived from the curve's parameterisation. This dodges the multi-select-across-many-beats problem in the property inspector: editing "this curve's bound-trigger function" is one edit on the curve, not one edit per diamond, and the alternative of multi-selecting all the bound triggers on a curve would be awkward when other unrelated objects sit between them on the canvas. It also avoids the orphaning problem that per-beat property overrides would cause whenever the active-beats string is rewritten. Per-beat differentiation — accenting every fourth beat, for instance — is achieved by the bound-trigger function reading its beat-index argument from context and varying its behaviour accordingly. The function is shared; the data feeding it is per-beat. The strength string is one such per-beat data channel today; richer per-beat data is discussed under "Future direction" below.

External visibility. A curve has a visibility property controlling whether its bound triggers are exposed to other curves' cursors. The default is bound-only: bound triggers respond only to their parent curve's cursor, matching the typical case of a curve playing its own rhythm. When externally visible, the bound triggers become collidable by any cursor in the scene, including the parent's, and the existing one-and-only collision rule (extended cursor hits trigger) handles cross-curve sweep without modification. When an external cursor sweeps an externally-visible bound trigger, the parent curve's bound-trigger function fires — not the visiting curve's sweep function. The bound trigger remains the source of truth for what happens when it is hit, regardless of who hit it, matching how standalone triggers already behave. The strength-pointer dual described in Section 10 (one pointer for internal cycles, a separate pointer for external collisions) carries forward into this model unchanged. Inspector label wording is to be settled when the inspector exposes the field; "Visible to other curves" and "Externally triggerable" are candidates.

Function precedence with sweep functions. When a cursor with a defined sweep function hits a trigger that also has a defined function (whether a standalone trigger's collision function or a curve's bound-trigger function), two conceptual models compete. Cursor-as-actor treats the cursor as the player and the trigger as a position-only target. Trigger-as-actor treats the trigger as the locus of musical content and the cursor as the playhead. Compositions may legitimately want either. The rule is whichever-has-a-function wins when only one is defined: if only the trigger has a function, the trigger fires; if only the cursor's curve has a sweep function, the cursor's sweep function fires. When both are defined, both fire in defined order: the trigger's function fires first, then the cursor's sweep function. Each runs with its normal context object as documented in Section 9; neither knows about the other. Two musical events per collision is the expected outcome and is treated as a feature — the trigger's function might emit a note while the cursor's sweep function emits a controller change, logs the hit, animates a secondary effect, or fires its own note. A composer who wants the cursor's sweep function alone to control the collision response defines only that function and leaves the trigger's function undefined; a composer who wants the trigger to fire identically regardless of which cursor hits it defines only the trigger's function. The data shape declares the conceptual model: defined-ness is the switch, both-defined means both run, and there is no third hidden mode where the runtime chooses between the two. If the trigger's function and the cursor's sweep function need to coordinate (for instance, suppressing the cursor's emission when the trigger has already handled the hit), they do so through shared context state the composer reads and writes, not through a precedence rule the runtime enforces.

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

Helper functions in message-function bodies consult these parameters. `scaleMap(value, { scale: ctx.scale, root: ctx.root })` maps a 0-1 input value into a note within the currently effective scale. `chordMap(index, { chord: ctx.chord })` returns the indexed chord tone. These helpers read from the context (which carries the current effective harmony for the firing object) rather than from score-level globals, so per-object overrides are automatically respected. The harmony-framework vocabulary, including the named scales and chords accepted by these fields, will broaden substantially when Tonal becomes the underlying theory engine; see Section 27.

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

The transport bar at the bottom contains, from left to right: a rewind button, a play-pause toggle button, an elapsed-time readout in minutes, seconds, and hundredths, and a BPM field editable via up-down stepper arrows. Time signature is per-curve in v2.3 (Section 10) and does not appear on the transport bar. A vertical grey divider separates these controls from the right half of the bar, which is reserved for error and status output from sketch execution.

The canvas is a live viewer. It displays the scene: background image, vector field visualisation (optional), curves rendered as their geometric shapes with tick marks at beat points and animated cursors (extended cursors render as perpendicular lines showing their sweep region), triggers rendered as filled dots sized by their collision radius, sprites rendered as filled circles coloured from the pixel underneath with white ring outline, and optional trails fading behind sprites.

Canvas toolbar and direct manipulation. A toolbar strip across the top of the canvas pane holds object-creation tools. Each tool has three states: idle, armed (one-shot — single placement, then back to idle), and locked (repeat placements until the user disarms). Single-clicking a tool button arms it; double-clicking locks it; clicking the active tool again disarms at any state; the Escape key disarms from any state. While armed or locked the cursor over the canvas is a crosshair, and clicks place a new object at the click position. Mouse-down on a tool button briefly flashes green so the click feels acknowledged in real time, and the armed/locked classes carry that green forward into the persistent state. The current toolbar exposes a single tool, Add Sprite; Add Trigger and the curve-shape tools follow.

Selection model. With no tool armed, the canvas behaves as a selection surface. Clicking an object selects it (replacing any previous selection); shift-clicking toggles the object's membership in the selection; clicking empty space clears everything. Dragging from empty space draws a marquee — a translucent grey rectangle that follows the mouse — and on release every object the marquee touches joins the selection (or replaces it when shift is not held). Dragging from a selected sprite moves all selected sprites together; dragging from an unselected sprite first replaces the selection with just that sprite, then moves it. Selection is multi-kind: sprites, triggers, and curves can all be selected together, with selection markers as yellow dotted squares around sprites and triggers, and yellow dotted bounding-box rectangles around curves. Hit-testing tries sprites first, then triggers, then curves so the visually-topmost object wins ties. Drag-to-move is sprite-only at this milestone; triggers and curves can be selected and deleted but not moved through the canvas yet.

Edit pipeline. Canvas operations — Add Sprite, drag-to-move sprites, Delete to remove objects of any kind — commit by parsing scene.json, mutating the parsed data, stringifying back, updating the bundle in place, refreshing the editor's Properties JSON view, then re-running the scene. Re-running auto-saves first, so each canvas edit also persists through the normal save pipeline. The Delete and Backspace keys remove all currently-selected objects; the listener checks the focus target so typing in the JSON tab still does the obvious thing. Selection is filtered against array lengths after each scene reload so a move-style edit (which preserves indexes) keeps the user's selection through the consequent re-render, while a delete or score switch prunes stale entries.

Property inspector. The form-based property inspector ships in v1 form, occupying the Properties tab as the primary editing surface for object properties. It renders six bands sized by their constraint rows (identity; geometry and visual; message functions; auto message interval; beat points; cycle parameters) with selection-driven greying — fields that don't apply to the current selection stay in their fixed positions but lose their green frame and brighten only when active, so the form's layout never reflows when the selection changes. The inspector is blank when nothing is selected, matching GeoSonix's empty-selection convention.

Reflow rule. Each band has a fixed vertical height that does not change for any reason — not for selection changes, not for mode changes, not for any other state. Bands occupy fixed vertical positions in the inspector and never move. Within a band, fields may appear, disappear, or swap based on selection or mode, provided the band's overall height stays constant. For example, the beat-points band's Euclidean parameter row shows when the mode is euclidean and hides when the mode is normal or none, but the band reserves the same vertical space in either case so that bands below it (cycle parameters, etc.) never shift position. This stability is an accessibility concern: the user, particularly under accessibility zoom, can rely on each band sitting in a consistent location and can build muscle memory for where to look for a given field. The cost is some always-reserved space that may be empty under certain modes, which is acceptable.

Vertical fit. The inspector targets fitting bands 1 through 6 (identity, geometry/visual, message functions, auto interval, beat points, cycle parameters) without vertical scrolling in a normally-sized browser window. The bands below that point — the deferred harmony and MIDI-routing area, including Object MIDI, Object Harmony, and Score Harmony when those land — may require vertical scrolling to access; this is acceptable because they are edited less frequently than the per-object bands above. If the user resizes the browser window smaller than typical, scrolling may also be required to reach the lower per-object bands, which is also acceptable but expected to be rare. The natural inspector pane width grows as needed to fit the constraint rows of the per-object bands; v2.3 targets approximately 700 pixels wide as the natural width, set by Band 5's Curve Beat Points timing row and Band 6's cycle-parameters row.

v1 is partially data-bound: Band 1 (identity) reads and writes real object data, including JS-identifier validation on the Name field with hard-error and soft-conflict squiggly underlines; multi-select greying and tri-state varies indicators on the Mute and Hide checkboxes work across all kinds. Bands 5 (beat points) and 6 (cycle parameters) are next. Bands 2 (geometry), 3 (message functions), and 4 (auto interval) remain layout-only with placeholder values. Function-slot dropdowns sourced from behaviours.js, Create button scaffolding for stub functions, and harmony-override fields are all later-milestone work tracked in Section 25 question 1. The raw scene.json view that the inspector replaces moves to a Properties JSON tab, kept available as a fallback until the inspector covers every editable field.

AI authoring pane. A conversational pane is available for chatting with Claude. Requests like "add two more triggers near the top right" or "make the sprite wander faster" cause Claude to edit the sketch. The pane is toggleable and can be hidden when not in use. This is described further in Section 14.

No REPL in the initial release. No live-coding during playback initially (edit-and-rerun loop only). A future milestone may expose per-line and per-function evaluation of sketch code into a live workspace, matching the GeoSonix execution model; this is an open question flagged in Section 25.

Keyboard shortcuts: Spacebar toggles play-pause. R rewinds. Cmd-S saves the active tab. Cmd-Shift-S saves all tabs. Cmd-O opens a score. Cmd-N creates a new score.

A version history panel (toggleable visibility) shows the bundle's git history as a scrollable list of versions: milestones prominent, time-based markers next, auto-commits available via a "show all versions" toggle. Each entry has a human-readable timestamp and description. Click to view or restore.

Accessibility. Limited vision is a first-class concern in the UI. Large bold fonts throughout, a dark theme, and visible grey dividers segmenting every window region. No use of colour alone to convey information. Browser ARIA attributes and screen reader compatibility are preserved. Browser zoom composes cleanly with any OS-level zoom. Imported background images pass through a perceptual brightness reduction transform before display so that broad bright regions do not dominate the canvas while local contrast and detail are preserved; only the displayed image is affected, the pixel data used for music generation passes through unchanged. The transform's parameters and bypass toggle live in Settings. See Section 26 for the full description.

---

## Section 14 — Authoring Workflow

A score's data and behaviour are split across two files in the bundle: scene.json (declarative data) and behaviours.js (named JavaScript functions). The two files are tied together by name reference: scene.json's function-slot fields hold strings that name functions defined in behaviours.js, and the scene loader resolves them at run time.

scene.json contains piece-level parameters (bpm, time signature, harmony framework, output target, image name, per-score scales) plus three arrays — curves, triggers, sprites — each entry of which is a flat object with the declarative properties for one object (geometry, rhythm strings, position, function-slot names, harmony overrides). No JavaScript runs from scene.json; it's pure data that any tool can read or write.

behaviours.js contains named JavaScript functions referenced from scene.json. Top-level function declarations and top-level const/let bindings to function expressions and arrows are exposed by name; the file is executed once on every scene load to build a function map. The split lets a property inspector, the canvas toolbar, or an AI assistant edit scene.json directly without parsing or rewriting any code, while the JavaScript editor keeps full freedom over behaviours.js.

Example scene.json:

```json
{
  "bpm": 120,
  "tonic": "D",
  "scaleName": "D minor",
  "imageName": "background.jpg",
  "triggerScale": 1,
  "spriteScale": 1,
  "curves": [
    {
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 10, "h": 10 },
      "cycleDuration": 4,
      "beatInterval": "Qtr",
      "beatsPerBar": 4,
      "beatOffset": 0,
      "cycleSpeeds": "1",
      "stopAtCycle": -1,
      "beatPointsMode": "normal",
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

Possible extension: change-summary artefact. Captured as an idea for the implementation phase, not part of the current v2.3 specification. The handoff folder could include a CHANGES.md file written by the AI side and treated as observation-only by GXW on Fetch — flagged in handoff.json alongside the snapshots so that any apparent edits to it are silently ignored. The file's purpose is to give the composer a brief description of what the AI added, modified, or removed since the handoff, what reasoning shaped those choices, and what alternatives were considered but set aside. The bootstrap-and-tweak workflow benefits particularly: when the composer fetches new behaviour code, the change summary explains the AI's thinking before the composer reads any code, which lowers the cognitive cost of refining the result. Display would initially be outside GXW (the AI's conversation transcript itself, or any text editor opened on the file); a dedicated panel inside GXW surfacing the most recent change summary alongside the score is a possible later refinement. Whether this carries enough weight to specify is a judgment call to be settled when the AI Handoff feature is implemented.

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

25. Unified bound-trigger model. Section 10.5 captures a proposed evolution that visualises and treats curve beat points as triggers bound to their parent curve, rendered as diamonds rotated so two opposite vertices lie on the curve, with shared inheritance from the curve, an external-visibility setting controlling exposure to other curves' cursors, and a whichever-has-a-function-wins-when-only-one-is-defined rule (with both-fire-in-defined-order when both are defined) for resolving cursor sweep functions against trigger functions. Open issues within the proposal: the inspector wording for the visibility setting, and the pattern-grammar design for the phrase-pasting future direction (encoding per-beat pitch and payload alongside the existing strength data so a melodic phrase can be pasted onto a curve as bound triggers). The proposal sits in a post-v2.3 milestone window; the v2.3 property-inspector work does not need to anticipate it.

26. Trigger Sync to Beat semantics, ownership, and inspector placement. The curve-inspector's Band 6 has carried a placeholder Trigger Sync to Beat combo since the inspector first shipped, with no specified semantics and no data binding. The intended meaning is quantization: a non-Off setting from the eighteen beat-interval tokens defers a triggered firing from the moment of physical collision to the next boundary of the chosen grid in score time, while Off fires at collision. The grid is the score's tempo grid, independent of any curve's beatInterval setting. Three open questions remain. First, ownership: per-trigger (the property lives on the trigger; one trigger fires on its own grid no matter who hits it; auto-fired events defer to the same grid; different curves hitting the same trigger get the same quantization), per-curve (the property lives on the curve; one curve produces quantized firings on its own grid no matter which trigger it sweeps; auto-fired triggers don't participate; different curves hitting the same trigger get different quantization), or both with a precedence rule. The per-trigger view fits the natural reading that quantization is a property of the firing event and the firing event lives on the trigger; it also extends cleanly to auto-fired triggers. The per-curve view fits the reading that the cursor's motion owns the timing of the collision-detection event; it also extends to a curve's own internal beat firings landing on a separate grid from its slot grid (though slot firings already land on slot boundaries by definition, so this case is mostly degenerate). Historical GeoSonix behaviour and which view best serves real composition both inform the choice. Second, semantics edge cases: what happens when multiple collisions occur within one quantization interval (collapse to one firing? all fire on the boundary?); how Off interacts with auto-firing; whether the deferred firing carries the original collision context (which curve, which sweep position) or recomputes context at the firing moment. Third, inspector placement: Band 6 of the curve view continues to hold the placeholder combo through v2.3 regardless of where ownership lands, because adding a trigger-specific band or row for one field would cost more than is justified at this point. If ownership turns out to be per-trigger, the placeholder will eventually move to the trigger-property inspector when broader trigger-property work happens; if per-curve, the placeholder is already in the right place and just needs data binding. The data-model field, validator, and engine consumption (in the Simulation module) are all deferred until ownership is settled and real binding lands.

---

## Section 26 — Accessibility

Limited vision is a first-class design concern for GXW, not an afterthought. Every UI decision is checked against whether it remains usable when accessibility zoom is active and when bright regions cause physical discomfort. This section collects accessibility provisions that are substantial enough to warrant their own design treatment; smaller provisions — large bold fonts, dark theme, visible grey dividers, no colour-alone signalling, ARIA attributes, muted scrollbars — live in Section 13 alongside the rest of the UI specification.

Perceptual brightness reduction for imported images. Imported background images on the canvas pass through a non-linear brightness transformation before display. The goal is to reduce eye strain from large continuously-bright regions while preserving local contrast and detail throughout the image. A simple global brightness or gamma reduction would be insufficient: it darkens dim regions and midtones equally, making the image as a whole hard to read, while still leaving large bright areas relatively dominant in proportion to the rest. The required behaviour is spatially aware — small bright features (a highlight, a specular dot, a thin bright line) sitting in an otherwise dark region must retain their brightness, while large continuously-bright regions (a bright sky, a white wall, a broad light area) must be dimmed substantially. Dimmer regions and midtones are untouched or nearly so.

Approach: base-detail decomposition. A blurred copy of the image serves as an estimate of regional luminance, the base layer. For each pixel of the original image, the regional luminance from the blurred image is read and used to compute an attenuation factor; that factor is multiplied into the original pixel's RGB values to produce the displayed pixel. Because the factor is derived from the blurred neighbourhood but applied to the unblurred pixel, local contrast and fine detail are fully preserved — the dimming responds to broad spatial trends, not to per-pixel intensity. Broad bright regions get pulled down; bright pixels embedded in dark regions stay bright because their neighbourhood is dark.

Attenuation curve. The factor is 1.0 (no attenuation) below a configurable threshold of regional luminance, then rolls off smoothly above the threshold using a smoothstep or similar easing function so the transition does not produce visible banding. At maximum regional luminance the factor reaches the configured maximum-attenuation floor (a value below 1.0; for example 0.5 means the brightest large regions are halved). The smooth roll-off makes the transition between protected and dimmed luminance ranges visually continuous; a hard step would introduce visible contour lines tracking the threshold's iso-luminance curves through the image.

Music generation is unaffected. The transformation runs in the rendering layer only. The pixel-sampling array used by triggers and sprites for image-driven music generation reads from the original, untransformed image data. This is a hard requirement: the visual representation of the image is an accessibility concern, but the image's role as scalar field driving the composition must remain faithful to the source. Two image snapshots are maintained side by side at import time — the original for sampling, the transformed for display — and the canvas renderer always draws the transformed snapshot while `_sampleImageAt` and equivalent paths always read from the original.

When the transform runs. Once at the moment of import, with the result cached. "Import" here covers the full set of paths through which an image arrives in the bundle: user-initiated image import via the file menu or drag-drop, score load from IndexedDB or the AI Handoff folder, and any other event that mutates the bundle's image bytes. Whenever the bundle's image bytes change, the transform re-runs and the cached result is replaced. The transform does not re-run on draw; the canvas just renders the already-transformed bitmap on every frame.

When the user changes the transform parameters in Settings, the currently displayed image re-processes immediately so the user can adjust the sliders and see the effect without restarting or re-importing. The bypass toggle takes the same path: when toggled off, the original image displays directly; when toggled back on, the cached transformed result displays again with no recomputation.

User-exposed parameters. Three numeric controls in Settings, ideally as sliders, with a fourth toggle for bypass:

- Blur radius. The spatial scale that defines "large continuous bright region." Larger values mean only very broad bright areas are affected; smaller values dim more localised bright patches. Default 5–10% of the smaller image dimension. Range roughly 5–200 pixels.
- Threshold. The regional luminance below which no dimming is applied, on a 0–1 scale. Protects midtones and shadows from being darkened. Default around 0.5; range 0.0–0.9.
- Maximum attenuation. The multiplier applied to the brightest large regions, on a 0–1 scale. A value of 0.5 halves the brightest large regions; a value of 1.0 disables the effect entirely. Default 0.5; range 0.2–1.0.
- Bypass toggle. When enabled, displays the original imagery without the transformation. Useful for direct comparison and for cases where the user wants to see the unaltered image briefly. Music generation is unaffected by the bypass setting since it never used the transformed data.

Settings persistence. The four controls persist across sessions and apply to all subsequently imported images. When a score is loaded, its background image is processed using the user's current settings, regardless of which settings were active when the score's image was originally imported. The settings are user-level preferences, not per-score; a user with photophobia or accessibility needs configures them once and they apply to every score the user opens, including scores authored by other users and shared into IndexedDB or via AI Handoff.

Implementation. The HTML Canvas 2D API supports all of this without needing WebGL or shaders. An offscreen canvas with `ctx.filter = 'blur(Npx)'` produces the base layer using hardware-accelerated Gaussian blur; this is well-supported across modern browsers. A per-pixel pass then reads luminance from the blurred canvas using Rec. 709 weights (0.2126 R + 0.7152 G + 0.0722 B), computes the attenuation factor per the curve described above, and writes attenuated RGB to the output canvas. The alpha channel passes through unchanged. The transform runs once at import; no per-frame cost.

Known limitation: halos. Gaussian blur does not respect edges, so very high-contrast boundaries can produce faint halos in the transformed image — a thin band of slight brightening or darkening around the boundary, where the blurred neighbourhood luminance disagrees most strongly with the local pixel's luminance. This is acceptable for the first implementation and is not visually disruptive in most images. If halos prove distracting on imagery the user actually composes with, the Gaussian blur can be replaced with an edge-preserving filter such as the Gastál–Oliveira domain transform, which runs in linear time with separable passes and is implementable in roughly fifty lines of JavaScript. The replacement is a drop-in for the blur step; nothing else in the pipeline changes.

Future additions. Other accessibility provisions worth keeping in mind for this section as they arise: a high-contrast theme variant for the inspector and editor, font-size scaling controls independent of OS-level zoom, text-to-speech integration hooks (the user already drives Apple Speak Selection paragraph-by-paragraph against GXW's UI text), and screen-reader-friendly status announcements for state changes that currently signal only visually (transport play state, dirty indicator, save events). None of these are in scope for v2.3; the perceptual-brightness-reduction feature is the only accessibility provision being introduced this revision.

---

 is currently unused in mini-notation and seems available, but the Strudel maintainers should be consulted before any upstream contribution proposes the syntax.

- **Upstream contribution versus maintained fork.** The pre-processor approach in Phase 3 sidesteps modifying Strudel's parser, but accumulates technical debt as the magic-variable surface grows. Phase 7 anticipates either upstream contributions (the right long-term move, slow process) or a maintained fork (workable, ongoing maintenance commitment). The choice will likely be made based on engagement with the Strudel maintainers during Phase 3.

- **Performance and caching.** Tonal's API is string-based, which has a parsing cost on every call. For real-time scores with many events per second, the helper layer should cache heavy results (a chord's note set, a scale's degrees function) at scene load or chord change, not on every event. The caching design is straightforward but needs to be specified before Phase 1's implementation, particularly the invalidation rule when the harmony context changes mid-cycle.

- **API documentation and AI authoring.** API.md (the reference document Claude pre-loads when authoring behaviours, see Section 14) needs substantial expansion to cover the Tonal helpers, the Strudel pattern API, and the magic-variable syntax. Without this, Claude-bootstrapped behaviours will fall back to plain JavaScript and miss the integration's value. The expansion is a one-time effort but a non-trivial one — probably hundreds of lines of curated examples and precise type signatures.

- **Phrase-pasting on curves.** Section 10.5 (Unified Bound-Trigger Model) imagines pasting MIDI phrases onto curves as bound triggers. This integration suggests an alternative or complementary path: pasting Strudel mini-notation onto curves as the curve's source of beat content, with the curve's cursor driving the pattern's cycle. The two paths are not mutually exclusive but their interaction needs design when phrase-pasting becomes a concrete milestone.

- **Progression data sourcing.** Tonal handles progression mechanics; named jazz standards as data are not in Tonal's scope. Whether GXW curates a small starter set, accepts iReal-Pro export strings as an import format, lets users define progressions inline in behaviour code, or some combination, is unsettled. Pertinent for Phase 1 only inasmuch as the helper layer's `progression(name)` signature should be designed flexibly enough to accommodate whichever data path wins.

### Status

Captured for staged implementation across multiple post-v2.3 releases. The strategic direction is committed; the specific phase boundaries and timelines are not. The v2.3 work in progress (property inspector, AI Handoff, accessibility) does not depend on any of this and can complete independently. v2.4 is the natural release window for Phase 1 (Tonal foundation), with subsequent phases taking releases of their own as the design and implementation work is completed. This section will evolve as phases are designed in detail and as engagement with the Tonal and Strudel communities proceeds.

---

*End of design document version 2.3*
