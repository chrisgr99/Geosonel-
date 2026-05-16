# GXW Design Document

Version 2.5 — May 2026

Status: Living document — sections split into individual files in `sections/`.

Naming: GXW (working title).

GXW is a web app for composing music that emerges from 2D scenes. A scene is a substrate of curves, triggers, and sprites placed at considered positions on a canvas. The user authors a Strudel pattern for each object that participates in the music; the object's events fire as its own cursor sweeps through the canvas, or when another object's cursor crosses it. Curves carry their cursors along their drawn geometry; sprites carry theirs perpendicular to motion; triggers stay still as point colliders that respond when a cursor lands on them. Per-object JavaScript callbacks (hasHit, beenHit, onTick) cover hit detection and per-tick behaviour. Scene state — image colour, sprite position, sprite motion — feeds into patterns through dynamic signals so the music tracks what happens on the canvas.

## Table of Contents

- [Section 1 — Vision](sections/section-01-vision.md)
- [Section 2 — Conceptual Model](sections/section-02-conceptual-model.md)
- [Section 3 — Scene Structure](sections/section-03-scene-structure.md)
- [Section 4 — Curves](sections/section-04-curves.md)
- [Section 5 — Triggers](sections/section-05-triggers.md)
- [Section 6 — Sprites](sections/section-06-sprites.md)
- [Section 7 — Transport and Tempo](sections/section-07-transport-and-tempo.md)
- [Section 8 — Collision Model](sections/section-08-collision-model.md)
- [Section 9 — Behaviour Slots and behaviors.js](sections/section-09-function-slots.md)
- [Section 10 — Pattern Language](sections/section-10-pattern-language.md)
- [Section 11 — Harmony Framework](sections/section-11-harmony.md)
- [Section 12 — Pattern Engine](sections/section-12-pattern-engine.md)
- [Section 13 — User Interface](sections/section-13-user-interface.md)
- [Section 13.5 — Canvas](sections/section-13-5-canvas.md)
- [Section 14 — Authoring Workflow](sections/section-14-authoring-workflow.md)
- [Section 15 — AI Handoff](sections/section-15-ai-handoff.md)
- [Section 16 — Score Bundle](sections/section-16-score-bundle.md)
- [Section 17 — Version Management via Git](sections/section-17-version-management.md)
- [Section 18 — Auto-Reload](sections/section-18-auto-reload.md)
- [Section 19 — Audio and MIDI Output](sections/section-19-audio-and-midi.md)
- [Section 20 — Implementation](sections/section-20-implementation.md)
- [Section 21 — Canvas Coordinate System](sections/section-21-canvas-coordinates.md)
- [Section 22 — Sprite Physics Details](sections/section-22-sprite-physics.md)
- [Section 23 — Module Overview](sections/section-23-modules.md)
- [Section 24 — GeoMaestro, GeoSonix, and GXSTR Reference](sections/section-24-geomaestro-and-geosonix.md)
- [Section 25 — Open Questions](sections/section-25-open-questions.md)
- [Section 26 — Accessibility](sections/section-26-accessibility.md)
- [Section 27 — Strudel as Pattern Language](sections/section-27-strudel-pattern-language.md)
- [Section 28 — Pattern Authoring and the Cursor Model](sections/section-28-pattern-authoring-and-cursor-model.md)
