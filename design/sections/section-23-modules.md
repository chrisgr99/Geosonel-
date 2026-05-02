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
