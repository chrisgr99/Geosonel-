# GXW Planning

This document tracks open decisions for GXW, the web-based successor
to GeoSonix. The technology direction has been set: JavaScript in
the browser, no build step, CodeMirror 6 editor, Web Audio for
output. Remaining decisions are about execution details and order
of work.

## Scope of the initial slice

The first milestone is a static web page with the four-region
layout: menu at top, canvas left, tabbed editor right, transport
bar bottom. Rendered in HTML and CSS with dummy content in each
region. No engine yet. No Web Audio. No bundles. Just the skeleton
that proves the layout works in a browser and gives us something
to iterate on visually.

## Decisions made

- Language: JavaScript (ES2022+) with JSDoc type annotations.
- Build: no build step; plain ES modules served directly.
- Editor: CodeMirror 6.
- Local dev: VS Code Live Server extension or similar lightweight
  static server with live reload.
- Source location: /Users/chrisgr/ProgrammingProjects/GXW, a new
  folder sibling to the preserved Python prototype at GX2.
- Naming: GXW (W for Web). No reference to GeoMaestro in the name.

## Decisions still to make

1. Bundle and storage model.
   - IndexedDB, File System Access API, or in-memory only for first
     pass.
   - Suggestion: start with in-memory only. Add IndexedDB
     persistence as a second milestone. File System Access support
     as an optional third layer for users on Chrome or Edge who
     want bundles as real folders.

2. Audio and MIDI story.
   - Confirm Web Audio as the default output path.
   - Defer Web MIDI to a later milestone.
   - Design the Transport object so it can drive either cleanly.

3. AI authoring integration.
   - In the first few milestones this is out of scope.
   - When it arrives, decide between direct browser calls to the
     Anthropic API versus routing through a small auth proxy.
   - API key handling — environment variable for solo use, or
     user-supplied key stored in browser storage for shared use.

4. Philosophical defaults to re-examine.
   - Auto-reload now triggers on editor save rather than file
     system change, since in-browser bundles have no external file
     watcher.
   - Sharing is a first-class concern and should influence the
     bundle format early.
   - Accessibility testing is easier in browser than native, so
     iterate more aggressively.

5. Milestone plan.
   - Milestone 1: static layout skeleton with four regions and
     grey dividers, no logic.
   - Milestone 2: functional editor with tabs, in-memory bundles.
   - Milestone 3: transport bar wired to an actual Transport
     object using AudioContext.currentTime.
   - Milestone 4: canvas rendering with coordinate system.
   - Milestone 5: sketch runner — scripts can define a scene.
   - Milestone 6: Web Audio output producing sound from movers
     and projectors.
   - Milestone 7: IndexedDB persistence for bundles.
   - Milestone 8: git versioning via isomorphic-git.
   - Milestone 9: AI authoring pane.
   - Further milestones as they come into focus.

## Suggested first next-turn topic

Setting up the GXW repository and producing Milestone 1 — the
static layout skeleton.

## Safety net

The Python desktop version remains as a reference implementation
at /Users/chrisgr/ProgrammingProjects/GX2. If the web workflow
proves unsatisfying, it can be returned to. No need to delete or
abandon it.

## What carries over regardless

- The entire conceptual model: projectors, movers, events,
  BeatPatterns, distortion functions, message functions, Context
  object, authoring workflow, bundle structure.
- UI decisions: four-region layout, bottom transport, tabbed editor
  with dividers, dark theme, accessibility-first.
- GeoMaestro and GeoSonix lineage.
- Specific layout tradeoffs from the desktop implementation.

## What is different in the web version

- JavaScript sketch language instead of Python.
- Web Audio as the default output instead of MIDI-only.
- IndexedDB or File System Access bundles instead of folders on
  disk.
- isomorphic-git instead of GitPython.
- Integrated AI authoring pane instead of external Claude Desktop
  with filesystem MCP.
- Browser-based accessibility instead of Qt accessibility.

## What is gained

- Zero-friction distribution and trial.
- Built-in audio without MIDI routing setup.
- AI authoring without filesystem-server configuration.
- Automatic updates.
- Cross-platform without additional effort.
- Stronger accessibility primitives.
- Natural path to sharing and collaboration features.
