## Section 24 — GeoMaestro, GeoSonix, and GXSTR Reference

GXW succeeds two earlier programs and forked off a sibling exploration that informed the current architectural shape.

GeoMaestro (Stéphane Rollandin, 2000-2004, KeyKit-based) is archived at /Users/chrisgr/ProgrammingProjects/GeoMaestro/doc/. Entry points: READ_ME_FIRST.txt, eGM0.html, CHANGES.txt for design evolution, paper1.html and paper2.html for conceptual introduction.

GeoSonix (Chris Graham, ~2012, Qt/IanniX-derived desktop app) was a predecessor by the same author. Source is not preserved, but the compiled app and ~33 sample score files in /Users/chrisgr/Documents/Geosonix Scores provide extensive reference. GeoSonix used JavaScript as its sketch language; GXW's JavaScript choice is partly continuity with that lineage.

GXSTR (Chris Graham, 2026, JavaScript browser-based) was an earlier GXW codebase that explored integrating Strudel as both pattern engine and audio engine, with Strudel's bundled cyclist scheduler driving timing. Source preserved at /Users/chrisgr/ProgrammingProjects/GXSTR. Two extended attempts to reconcile that scheduler with GXW's free-running, physics-driven event model surfaced an architectural mismatch: Strudel's master cycle wants to be the source of truth for everything plugged into it, while GXW's clock is the simulation with each source running at its own rate. GXSTR forked off as a sibling project; current GXW absorbs Strudel's pattern-language layer and audio output without taking on its scheduler, leaving the simulation as the master clock. See Section 10 (Pattern Language) and Section 12 (Pattern Engine) for the resulting layered architecture.

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

Carried forward from GXSTR:
- Strudel as the pattern-language layer (mini-notation, Pattern type, modifier algebra).
- Superdough as an audio engine option alongside Web MIDI.
- Static signals (sine, saw, square, tri, perlin) as cycle-position functions.
- Browser-based stack with no build step, ES modules served directly.
- Module structure and most non-Strudel-touching code (canvas rendering, simulation, scene model).

Diverged from GXSTR:
- Strudel's cyclist scheduler is not used; the simulation is the master clock.
- Per-source cycle counters drive each source's pattern independently rather than a single master cycle.
- Two-pass evaluation with firing-context pointer for dynamic signals.
- Direct math from fractional cycle position to wall-clock event time, bypassing Strudel's slow/fast/compress timing modifiers.
- One-cycle-ahead scheduling with late-refresh dispatch via Web MIDI for the standard output path.

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

GXSTR (sibling fork, 2026) is an earlier GXW codebase, now forked off as a sibling project preserved at /Users/chrisgr/ProgrammingProjects/GXSTR. GXSTR integrated Strudel as both pattern engine and audio engine, with Strudel's bundled cyclist scheduler driving timing. Two extended attempts to reconcile that integration with GXW's free-running, physics-driven, cursor-and-trigger-fired event model surfaced an architectural mismatch: Strudel's master cycle wants to be the source of truth for everything plugged into it, while GXW's clock is the simulation, with each curve running its own cycle at its own rate and triggers firing whenever a sprite happens into one. Trying to keep Strudel's master cycle synchronised with GXW's per-object timing meant undoing the part of Strudel that makes it useful as a scheduler; trying to let Strudel drive meant collapsing GXW's free-running model into a master-cycle model that did not fit its visual-and-physics-driven character.

The current GXW absorbs Strudel's pattern-language layer (mini-notation parser, Pattern type, modifier algebra) and audio output (superdough, Web MIDI), but replaces the cyclist with simulation-driven scheduling. Section 10 documents the language layer absorbed; Section 12 documents the runtime layer GXW provides in place of the cyclist. GXSTR informed the architectural shape without contributing surviving code to the current GXW.
