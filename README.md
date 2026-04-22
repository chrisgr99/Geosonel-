# GXW

GXW is a web app for composing music that emerges from 2D scenes.
Static projectors sweep across authored events to produce phrases;
dynamic movers flow through force fields over images to generate
note streams. All agents share one transport and one musical
framework.

The W stands for Web. GXW is the web-based successor to GeoSonix,
a 2012 IanniX-derived desktop app by the same author, and carries
forward design ideas from GeoMaestro (Stéphane Rollandin, 2000s).

## Status

Early development. The design is captured in design/DESIGN.md.
The open planning decisions and milestone plan are in
design/PLANNING.md.

A previous Python desktop prototype called GXM lives at
/Users/chrisgr/ProgrammingProjects/GX2 and is preserved as
reference. Active development has moved to this web version.

## Getting started

No build step. Source files are plain HTML, CSS, and JavaScript
modules.

Local development uses any static file server. The simplest choice
is Python's built-in http.server:

```
cd /Users/chrisgr/ProgrammingProjects/GXW
python3 -m http.server 8000
```

Then open http://localhost:8000 in a modern browser.

## Stack

- Modern JavaScript (ES2022+) with JSDoc type hints.
- CodeMirror 6 for the sketch editor.
- HTML Canvas 2D for scene rendering.
- Web Audio API for synthesis and timing.
- Web MIDI API for optional external output (Chrome, Edge, Firefox).
- IndexedDB for bundle storage.
- isomorphic-git for version control inside bundles.

No framework. No build step. Modules load directly in the browser.
