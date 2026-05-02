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
