# GXW Design Document

Version 1.0 — Updated April 2026
Status: Living document.

Naming: GXW is the web-based successor to GeoSonix. The W stands for Web. The project folder and repository live at /Users/chrisgr/ProgrammingProjects/GXW. An earlier Python desktop prototype, GXM, exists at /Users/chrisgr/ProgrammingProjects/GX2 and remains preserved as reference; GXW supersedes it as the active development path.

---

## Table of Contents

- [Section 1 — Vision](#section-1--vision)
- [Section 2 — Conceptual Model](#section-2--conceptual-model)
- [Section 3 — Scene Structure](#section-3--scene-structure)
- [Section 4 — Projectors](#section-4--projectors)
- [Section 5 — Movers](#section-5--movers)
- [Section 6 — Events](#section-6--events)
- [Section 7 — Transport and Tempo](#section-7--transport-and-tempo)
- [Section 8 — BeatPatterns](#section-8--beatpatterns)
- [Section 9 — The Context Object](#section-9--the-context-object)
- [Section 10 — Message Functions](#section-10--message-functions)
- [Section 11 — Distortion Functions](#section-11--distortion-functions)
- [Section 12 — Phrases and the Compositor](#section-12--phrases-and-the-compositor)
- [Section 13 — User Interface](#section-13--user-interface)
- [Section 14 — Authoring Workflow](#section-14--authoring-workflow)
- [Section 15 — Score Bundle](#section-15--score-bundle)
- [Section 16 — Version Management via Git](#section-16--version-management-via-git)
- [Section 17 — Auto-Reload](#section-17--auto-reload)
- [Section 18 — Audio and MIDI Output](#section-18--audio-and-midi-output)
- [Section 19 — Implementation](#section-19--implementation)
- [Section 20 — Canvas Coordinate System](#section-20--canvas-coordinate-system)
- [Section 21 — Mover Physics Details](#section-21--mover-physics-details)
- [Section 22 — Module Overview](#section-22--module-overview)
- [Section 23 — GeoMaestro and GeoSonix Reference](#section-23--geomaestro-and-geosonix-reference)
- [Section 24 — Open Questions](#section-24--open-questions)

---

## Section 1 — Vision

GXW is a web app for composing music that emerges from 2D scenes. Static projectors sweep across authored events to produce phrases; dynamic movers flow through force fields over images to generate note streams. All agents share one transport and one musical framework.

The composer works by editing a JavaScript sketch file describing the scene, its agents, and their behaviour. GXW watches the sketch and re-executes it whenever it changes. A canvas shows the scene and its animation. Sound is produced by the browser's Web Audio API, and optionally routed to external synthesisers via Web MIDI where supported.

Sketches are typically constructed and modified through conversation with Claude, which edits the sketch directly. The conversational authoring experience is a first-class concern of GXW rather than an external workflow.

---

## Section 2 — Conceptual Model

A GXW scene is a timeless 2D substrate holding events, an image, and optional vector and scalar field sources. The scene is inhabited by two kinds of agents.

A projector is a parametric agent. It has an authored geometric shape (line segment, circle, piste, or a more elaborate type like Helice or Batteur) and a distortion profile. When it evaluates, an implicit sweep point traverses its shape over a configured sweep duration; each event in the scene is projected onto the shape. The projector's distortion profile determines how each encounter becomes a musical parameter. The result is a phrase in beats. A projector itself does not move — only the evaluation point moves along its fixed geometry.

A mover is a dynamic agent. It has initial conditions (position, velocity, internal parameters). At each time step it integrates forces from the scene's vector field, samples scalar values from the image at its current position, and decides whether to fire a musical event based on a BeatPattern scheduled against the transport. When it fires, a message function translates its current spatial context into musical parameters. The mover's position evolves over time.

Both agent kinds share the transport: one global tempo, one time signature, one beat position. Projectors convert their sweep duration from beats to wall-clock seconds via tempo. Movers drive their physics integration from the transport's beat-incremented clock. Everything is rhythmically locked by default.

Phrases produced by projectors and movers flow into the Compositor, a higher-level arrangement tool deferred to later implementation.

---

## Section 3 — Scene Structure

A scene's data model:

- An optional image, resampled to 1000x1000. The image is a scalar field: at any 2D position it provides r, g, b, luminance, hue, saturation. Consulted by movers (via physics and message functions) and projectors (via distortion functions that read pixel values).

- A collection of events, each with (x, y) coordinates and symbolic musical payload. Shared by all projectors in the scene. No per-projector filtering. Movers do not consult events.

- A vector field built from one or more field sources (attractors, repulsors, uniform flows, pixel-gradient flows) that combine to produce a force vector at any position. Consulted by movers during integration. Projectors may optionally consult it for bent sweep paths (advanced feature).

- Optional named regions — 2D areas with boolean membership and optional scalar data.

- A collection of projectors.

- A collection of movers.

The canvas is always live — it displays whatever state the model currently holds. There is no separate edit and run mode at the canvas level; editing happens by modifying the sketch, and the canvas reflects the result after the sketch re-executes.

---

## Section 4 — Projectors

A projector has a shape, a sweep duration in beats, a distortion profile, a channel assignment, and optional per-projector parameters.

Shape is the geometric form that defines traversal: line segment, circle, piste (polyline), or a more elaborate named type (Helice, Batteur, Rose, EarWalk, Radar, and others drawn from GeoMaestro's catalogue).

Sweep duration is expressed in beats. A projector with sweep duration 4 traverses its shape in 4 beats of transport time. The sweep point advances along the shape at a uniform rate by default; some projector types implement non-uniform traversal.

Distortion profile is a set of named distortion functions mapping geometric features of each event-to-shape encounter (distance, angle, side, projection ratio) into musical parameters (pitch offset, velocity, duration, pan, time offset). Distortion functions are discussed in [Section 11](#section-11--distortion-functions).

Channel assignment determines which audio or MIDI channel the projector's output goes to, allowing multiple projectors in one scene to produce independently-routable streams.

Per-projector overrides: a projector can specify its own distortion profile overriding the scene default, its own channel, its own sweep-rate modulation driven by a BeatPattern (see [Section 8](#section-8--beatpatterns)), and its own repetition count.

Projector shapes in implementation priority order: line segment, circle, piste, Helice, Batteur.

---

## Section 5 — Movers

A mover has initial conditions: starting position, starting velocity, mass, maxSpeed (user-settable velocity ceiling), and absoluteMaxSpeed (hard system ceiling of 200 canvas units per second).

Motion modes:

- Free mode responds fully to the vector field, bounces off canvas boundaries, obeys velocity ceilings.
- Line mode moves along an implicit line segment, reversing at endpoints. No visible line drawn.
- Circle mode orbits an implicit circle at constant angular velocity. No visible circle drawn.

Per physics step:
1. Sample vector field at current position.
2. Integrate position and velocity.
3. Apply velocity ceiling.
4. Resolve collisions with canvas boundaries (continuous collision detection).
5. Sample image colour at final position.
6. Check beat firing against BeatPattern and transport.
7. If a new beat has emphasis nonzero, fire the message function.
8. Update visual trail.

Firing is scheduled by BeatPattern plus transport, not by collision. The BeatPattern decides when to fire; the message function decides what to play, using the mover's current spatial context.

A mover with BeatPattern = none uses a free-running firing function instead — a user-defined predicate evaluated each physics step, producing non-rhythmic image-driven event streams.

Soft UI convention: six movers in the default palette, based on empirical experience from GeoSonix that parameter management past six becomes overwhelming. Not a data-model limit.

---

## Section 6 — Events

An event has a position and a payload. Payload types:

- A note specification (pitch, velocity, duration as nodur).
- A controller value (CC number and value).
- A parameter set (key-value pairs consulted by distortion functions).
- A phrase (pre-rendered sequence inserted wholesale when encountered).
- A function (user-defined callback returning a phrase when called).

Events have no time. Time arises when a projector encounters them. Event duration fields use nodur notation ("q" for quarter, "e." for dotted eighth) — proportional to a beat, not absolute seconds.

Events are shared scene-wide. If a user needs one projector to read only some events, they use a separate scene. An escape hatch is available through distortion functions that can emit silence based on event metadata, but this is a fallback not a primary mechanism.

Movers do not consult events. Projectors read events. Movers read fields. Disjoint consumption.

---

## Section 7 — Transport and Tempo

The transport is global, with state: BPM, time signature, current beat position, play/stop/pause/rewind, and optional tempo automation.

Projectors convert sweep duration in beats into wall-clock seconds using the current BPM at evaluation time. Tempo changes during a sweep affect pacing accordingly.

Movers drive physics from the transport's beat clock. Physics time step is expressed in beats; wall-clock mapping happens via tempo. Halving tempo doubles the time it takes a mover to cover the same spatial trajectory; forces and field values don't depend on tempo, only pacing does.

BeatPatterns cycle against the transport's beat position (see [Section 8](#section-8--beatpatterns)).

Duration overrides: each projector and each event can specify duration in beats (default), absolute seconds (ignores tempo), or proportional units relative to the projector's sweep duration.

Per-agent tempo override is available but deferred. Common case is one global tempo.

Transport controls are exposed in a bar along the bottom of the main window: a rewind button and a play-pause toggle on the left, followed by an elapsed-time readout, a BPM field, and a read-only time signature display. BPM and time signature defaults are defined in the sketch's setup() function (see [Section 14](#section-14--authoring-workflow)). BPM is editable at runtime from the transport bar for live experimentation; runtime changes do not write back to the sketch, so a sketch reload restores the value defined in setup(). Time signature is read-only in the UI, since changing it at runtime has non-trivial musical implications best reserved for sketch edits.

The transport clock is driven by the browser's AudioContext.currentTime, which provides sub-millisecond timing accuracy independent of animation frame timing.

---

## Section 8 — BeatPatterns

A BeatPattern has:
- A name.
- A bar length.
- An emphasis string (digits 0-9 at each sub-beat position; 0 = silence; higher = greater accent). Slash-separated groups for readability: `/9614/9224` for a two-bar pattern with accents on beats 1 and 3 each bar.
- An optional swing value.

BeatPatterns shorter than a mover's phrase length cycle automatically. A one-bar pattern fills a four-bar phrase by repeating.

BeatPatterns are shared resources. Multiple movers can reference the same named BeatPattern; editing the pattern updates all referencing movers.

Cross-paradigm use: a projector can consume a BeatPattern to modulate its sweep rate non-linearly (pause on emphasis 0, accelerate through high-emphasis beats). Optional; default sweep is linear.

---

## Section 9 — The Context Object

When a mover's BeatPattern fires a beat, its message function is called with a ctx object:

Mover state:
- r, g, b, lum, hue, sat — colour values at position (0.0-1.0).
- x, y — position (0-100 canvas units).
- vx, vy — velocity.
- v — scalar speed.
- beat — emphasis digit (0-9).
- beatNumber — position within BeatPattern cycle.
- phrasePosition — fractional position through current phrase.
- triggerCount — fires since last rewind.

Score state:
- scale — scale name.
- root — root note (MIDI).
- chord — chord name.
- bpm — current BPM.
- timeSignature — tuple.
- channel, port.

Example:

```javascript
function myMessage(ctx) {
    const note = scaleMap(ctx.r, { scale: ctx.scale, root: ctx.root });
    const velocity = rangeMap(ctx.lum, 20, 127);
    const duration = rangeMap(ctx.b, 200, 800);
    return { note, velocity, duration };
}
```

The mapping library (scaleMap, rangeMap, chordMap, harmonyMap, listMap) is available globally to sketch code. The Math object is available as usual.

Distortion function context is structurally analogous but carries geometric fields rather than spatial fields. See [Section 11](#section-11--distortion-functions).

---

## Section 10 — Message Functions

Message functions are named JavaScript functions defined in the sketch. Each mover holds a reference to a named function. Multiple movers can share one; editing it updates all references.

A message function takes a context object and returns an object with musical parameters: note, velocity, duration. Optional extended fields include channel and port.

Pre-loaded helpers available globally:
- scaleMap, rangeMap, chordMap, harmonyMap, listMap.
- Math.

---

## Section 11 — Distortion Functions

Distortion functions are the projector-side equivalent of message functions. They map geometric features of an event-to-shape encounter into musical parameters.

GeoMaestro organised distortion functions into named arrays: Volume, Pit, Dur, Pan, Time, and Mer (merging additional events into output). GXW inherits this. A projector's distortion profile is a set of function references — one per array.

Context fields for a distortion function:
- ev — the encountered event.
- d — distance from shape to event.
- a — angle of projection.
- s — side (+1 or -1).
- p — projection ratio (0-1 along shape).
- r, g, b, lum, hue, sat — scalar values at event position.
- ctx — broader context (scale, root, channel, transport).

Example:

```javascript
function distancePitch(ctx) {
    return ctx.ev.pitch - Math.floor(ctx.d / 2);
}
```

Distortion functions live in the same sketch file as message functions. A distortion slot can hold either a named function reference or an inline expression.

---

## Section 12 — Phrases and the Compositor

Both projectors and movers emit Phrases — time-indexed event streams in beats.

A Phrase has:
- A sequence of events, each with time offset in beats, musical parameters, optional metadata.
- An overall duration in beats.
- An optional name.

The Compositor accepts phrases from any source (rendered projector output, recorded mover output, imported MIDI files) and arranges them on a beat-indexed timeline via a box-graph model inherited from GeoMaestro. Echo boxes, iterative boxes, synth boxes, mix boxes, effect boxes.

The Compositor is deferred. Initial releases produce phrases but arrange them trivially.

---

## Section 13 — User Interface

GXW's main window is divided into four regions. A top menu bar. A canvas pane on the left, showing the live scene. A tabbed code editor on the right, showing one tab per JavaScript file in the score bundle. A transport bar along the bottom. Three-pixel grey dividers separate every region so the window structure stays visually clear.

The canvas pane occupies roughly half the window width by default and can be resized by dragging its right edge. A menu option can pop the canvas out into a separate floating browser window for composers who prefer a Processing-style two-window layout.

The tabbed editor shows every .js file in the current bundle as a tab. Tabs are left-aligned. The editor uses CodeMirror 6 with a dark theme, warm off-white text on a near-black background. A grey divider runs along the bottom of the tab bar and breaks under the currently selected tab so that tab visually connects to the editor content below it.

Tab labels show a dot prefix when the tab has unsaved changes. Save and Save All actions live in the File menu alongside New Score, Open Score, Save Score As, New Module, and Delete Current Module. Recent scores are tracked and reopenable from an Open Recent submenu, and the last opened score reopens automatically on launch.

The transport bar at the bottom contains, from left to right: a rewind button, a play-pause toggle button, an elapsed-time readout in minutes, seconds, and hundredths, a BPM field editable via up-down stepper arrows, and a read-only time signature display. A vertical grey divider separates these controls from the right half of the bar, which is reserved for error and status output from sketch execution.

The canvas is a live viewer. It displays the scene: background image, vector field visualisation (optional), events as glyphs, projectors as their shapes with animated sweep points, movers as filled circles coloured from the pixel underneath with white ring outline, beat trails as fading dots. The user does not interact with the canvas to modify the scene. All editing happens in the sketch — either in GXW's editor pane or via the AI authoring pane. Whenever a sketch file changes, GXW re-executes it and the canvas updates.

AI authoring pane. A conversational pane is available for chatting with Claude. Requests like "add two more events near the top right" or "make the mover move faster" cause Claude to edit the sketch. The pane is toggleable and can be hidden when not in use. This is described further in [Section 14](#section-14--authoring-workflow).

No REPL. No live-coding during playback initially (edit-and-rerun loop only).

Keyboard shortcuts: Spacebar toggles play-pause. R rewinds. Cmd-S saves the active tab. Cmd-Shift-S saves all tabs. Cmd-O opens a score. Cmd-N creates a new score.

A version history panel (toggleable visibility) shows the bundle's git history as a scrollable list of versions: milestones prominent, time-based markers next, auto-commits available via a "show all versions" toggle. Each entry has a human-readable timestamp and description. Click to view or restore.

Accessibility. Limited vision is a first-class concern in the UI. Large bold fonts throughout, a dark theme, and visible grey dividers segmenting every window region. No use of colour alone to convey information. Browser ARIA attributes and screen reader compatibility are preserved. Browser zoom composes cleanly with any OS-level zoom.

---

## Section 14 — Authoring Workflow

A sketch is a single JavaScript file, sketch.js, in the score bundle. Its structure:

```javascript
// Global settings defined in setup()
function setup() {
    bpm(120);
    timeSignature(4, 4);
    image("background.jpg");
    scale("D minor");
}

// Named BeatPatterns
beatPattern("groove1", "/9614/9224");

// Message functions
function blueNote(ctx) {
    const note = scaleMap(ctx.r, { scale: ctx.scale, root: ctx.root });
    const velocity = rangeMap(ctx.lum, 20, 127);
    return { note, velocity, duration: 400 };
}

// Distortion functions
function distancePitch(ctx) {
    return ctx.ev.pitch - Math.floor(ctx.d / 2);
}

// Scene construction
const scene = new Scene();
scene.addEvent(45, 60, { note: "C4" });
scene.addEvent(55, 65, { note: "E4" });
scene.addMover(20, 50, { mode: "free", beat: "groove1", msg: blueNote });
scene.addProjector(new Line(10, 10, 90, 90), {
    sweep: 4,
    distortion: { Pit: distancePitch }
});
```

Construction is through plain JavaScript. No special DSL. The GXW runtime exposes classes and functions that the sketch calls.

AI-assisted authoring is integrated. A conversation pane within GXW talks to Claude via the Anthropic API. The user converses in natural language; Claude edits the sketch directly. GXW auto-reloads. The user hears the result.

Claude's knowledge of GXW's API is supplied through an API.md reference document that the integration pre-loads into the conversation context.

---

## Section 15 — Score Bundle

A GXW score is a bundle — a collection of related files — containing:

```
MyScore/
    sketch.js            # the code defining the score
    image.png            # background image (1000x1000 PNG)
    resources/           # user support files (helper modules, data tables)
    .git/                # version history (see Section 16)
```

Bundles are stored in the browser's persistent storage (IndexedDB) by default, with export and import functions to move bundles between machines or share them. On browsers that support the File System Access API, bundles can alternatively be stored as real folders on the user's disk for direct external access.

The last opened score path is stored in application settings and reopened on launch.

The bundle is deliberately lean. No score.json: global settings live in the sketch's setup() function, not in a separate data file. No audio assets beyond the background image: GXW synthesises sound internally via Web Audio and optionally sends MIDI. No conversation history as bundle state — conversation history lives with the user session, not with the score.

The resources folder holds user-managed support files. The sketch can import from it using standard ES module imports. Custom harmony definitions, data tables, helper modules, alternate tunings — anything the sketch calls on beyond the core GXW API. Every .js file in the bundle, whether sketch.js at the top level or a module inside resources/, appears as its own tab in the editor.

---

## Section 16 — Version Management via Git

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

## Section 17 — Auto-Reload

When the active sketch is saved in the editor, GXW re-executes it after a short debounce (a few hundred milliseconds) to absorb multiple rapid writes.

Transport state is preserved across reload where possible. If the transport is playing when the sketch reloads, it keeps playing. Function definition changes take effect on next call. Scene construction changes apply as diffs: new objects appear, deleted objects disappear, existing objects update their properties.

Module caches for files in resources/ are invalidated on reload, so changes to imported support modules are picked up too.

Auto-reload requires no user action. This behaviour is proven to work from GeoSonix, which had the same mechanism for JavaScript sketches.

Errors during reload do not block loading. Errors in scene construction cause the affected objects to be skipped, and the scene loads without them. Errors in function definitions cause affected functions to be skipped; movers or projectors referencing them will fail when they fire. Errors are reported in the status area at the bottom of the editor window.

When bundles are stored in the File System Access API and modified externally, GXW polls for changes at a low frequency (every second or two) since browsers do not expose a filesystem notification API.

---

## Section 18 — Audio and MIDI Output

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

## Section 19 — Implementation

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

## Section 20 — Canvas Coordinate System

Canvas coordinates are 0.0 to 100.0 in both X and Y. Y=0 is at the bottom left, Y=100 at the top (mathematical convention, matches GeoSonix).

Conversion from canvas to screen: screenX = (canvasX / 100) * width, screenY = (1 - canvasY / 100) * height.

Conversion from canvas to normalised image coordinates: normX = canvasX / 100, normY = canvasY / 100. Image Y=0 is top-left in standard image coordinates; whether to flip Y for image sampling is an implementation detail — sampling uses canvas Y directly by default.

Mover diameter: 10 canvas units by default, radius 5. Bouncing at 5 units from any wall.

Event visual size: 2-3 canvas units for hit target, glyph shape indicates payload type.

Projector shapes use canvas units directly.

---

## Section 21 — Mover Physics Details

Coordinate space 0.0 to 100.0 in both X and Y, Y=0 bottom left.

Mover diameter user-settable, default 10. Radius = diameter / 2.

Velocity ceiling two-level:
- maxSpeed: user-settable per mover, default 50, range 1 to 200 canvas units/second.
- absoluteMaxSpeed: hard system ceiling of 200, not user-settable, enforced every step.

Applied by scaling the velocity vector to preserve direction.

At absoluteMaxSpeed=200 and dt=1/60, max travel per step is 3.3 units. Mover diameter 10 units. Tunnelling requires 10+ units per step = 600 units/second, impossible with ceiling at 200.

Collision detection: continuous within each time step. Calculates exact time when mover perimeter reaches each wall, moves to that point, reflects velocity, continues for remaining time. Up to 10 bounces per step resolved. Final position clamp as safety net.

Reflection: angle of incidence equals angle of reflection. Speed preserved exactly. Corner hits reflect both components.

Physics step order:
1. Sample vector field.
2. Integrate velocity and position.
3. Apply velocity ceiling.
4. Resolve collisions.
5. Sample image colour.
6. Check beat firing.

Physics may run in a Web Worker so that audio-rate scheduling on the main thread is not starved. Final architecture of the physics-worker split is to be determined during implementation.

---

## Section 22 — Module Overview

JavaScript modules in dependency order:

1. Image — 1000x1000 pixel array, colour sampling, file loading, resampling.
2. Field — vector force at any position, combining sources and optional image-gradient contribution.
3. Event — position and symbolic payload.
4. Mover — integrates field, samples image, maintains beat clock, fires events, stores trail.
5. Projector — parametric shape, evaluates against scene events through distortion profile, produces phrase.
6. DistortionFunction — named function mapping projection geometry to musical parameters.
7. BeatPattern — named emphasis string cycling over a bar length.
8. MessageFunction — named function translating mover context to musical parameters.
9. Scene — holds events, image, fields, regions, projectors, movers.
10. Transport — global clock, tempo, beat position, play state, AudioContext integration.
11. Phrase — time-indexed event sequence emitted by projectors and movers.
12. Audio — Web Audio synthesis, voice management, output routing.
13. MIDI — Web MIDI wrapper, scheduling, port management.
14. Simulation — physics loop and evaluation driver, fixed time step, integrates movers, advances projector sweeps, fires functions at beat events.
15. SketchRunner — parses sketch.js, executes it in an isolated scope with the GXW API exposed, handles reload and error capture.
16. Bundle — loads, creates, saves, duplicates, and lists JavaScript files within score bundles in IndexedDB or on disk.
17. VersionControl — isomorphic-git wrappers, commit on reload, milestone tags, time-based tags, history queries.
18. UI — top menu bar, canvas pane, tabbed JavaScript editor, bottom transport bar, AI authoring pane, deferred history panel.
19. AIAuthoring — conversation pane, Anthropic API integration, sketch edit application.
20. Compositor — deferred.

---

## Section 23 — GeoMaestro and GeoSonix Reference

GXW succeeds two earlier programs:

GeoMaestro (Stéphane Rollandin, 2000-2004, KeyKit-based) is archived at the GX2 repository at design/GeoMaestro/doc/. Entry points: READ_ME_FIRST.txt, eGM0.html, CHANGES.txt for design evolution, paper1.html and paper2.html for conceptual introduction.

GeoSonix (Chris Graham, ~2012, IanniX fork) was a predecessor app by the same author. GX2's design folder contains screenshots for reference. GeoSonix also used JavaScript as its sketch language; GXW's JavaScript choice is partly continuity with that lineage.

Carried forward from GeoMaestro: timeless scenes with events at spatial positions, projectors as geometric agents emitting phrases, distortion functions as the expressive heart, named projector catalogue, event payloads including functions, Compositor concept, open-ended user scripting.

Carried forward from GeoSonix: moving objects over images, pixel colour influencing musical parameters, MessageFunction model, mapping function library, beat emphasis 0-9 system, named shared resources, score as reusable framework, auto-reload of external sketch files, resources folder for support files, JavaScript as sketch language.

Added in GXW: unified projector and mover architecture, shared transport, BeatPattern as cross-paradigm resource, image as shared scalar field, bundle with git versioning, integrated AI authoring, web deployment.

---

## Section 24 — Open Questions

1. Vector field normalisation algorithm.

2. Free-running beat firing function authoring API.

3. Full projector shape catalogue beyond the initial five.

4. Distortion function library scope.

5. Projector BeatPattern-driven sweep modulation in initial implementation or later.

6. Per-agent tempo overrides.

7. External transport sync (Ableton Link, MIDI clock).

8. Multi-scene scores and how scenes relate in the Compositor.

9. Compositor design in detail.

10. Default internal synthesis voice bank scope and quality.

11. Web Worker boundary for physics and simulation.

12. Anthropic API authentication model — direct in browser, lightweight proxy, or user-supplied API key.

13. Video instead of static images.

14. MIDI input for score parameter control.

15. OSC output via WebSocket bridge.

16. Default helper functions in the mapping library beyond the initial set.

17. Bundle sharing mechanism — URL-based, export file, hosted gallery.

---

*End of design document version 1.0*
