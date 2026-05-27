# GeoSonel

Image-driven generative music in the browser and on the desktop.

GeoSonel is a music-composition environment built around a simple idea: cursors travel along geometric paths, sampling the pixel colors they pass over, and those samples become signals that drive musical events. Notes, rhythms, velocities, durations, and any other modulatable parameter can be bound to what the cursor sees as it moves. The result is generative music shaped by image content and by the trajectory of the paths drawn over it.

The pattern language is [Strudel](https://strudel.cc), a JavaScript pattern system in the TidalCycles tradition. The harmonic vocabulary comes from [Tonal.js](https://github.com/tonaljs/tonal). The composer's authoring surface is a JavaScript file called `behaviors.js` where each path is bound to a cycle pattern, with image signals composed in through a small helper library. Output goes to the Web Audio API for in-browser synthesis and to the Web MIDI API for external instruments.

## A note on audio output

At present, GeoSonel only produces sound through Web MIDI, routed to an external synthesizer or DAW. The in-browser superdough audio path is not yet enabled, so if you try the live site without MIDI hardware or a software synth on your system you will not hear anything. Web MIDI works in Chrome, Edge, and Firefox. Enabling superdough for in-browser playback is on the roadmap.

## The idea

A scene consists of paths drawn on the canvas, cursors moving along those paths at user-configured speeds, and an image loaded as the canvas backdrop. As each cursor moves over the image, the pixel under it at the firing time becomes a value in a set of named signals: `pxLt` (lightness), `pxChr` (chroma), `pxR` and `pxG` and `pxB` (RGB channels), and similar dimensions in OKLab color space. These signals are first-class Strudel signal patterns, so they compose with strudel's pattern operators and with a GeoSonel helper library that adds range-limited remapping, scale-snapping, chord-snapping, and modulation of any parameter through a signal.

The composer writes one Strudel pattern line per voice in `behaviors.js`. The pattern declares when events fire (the struct), where pitches come from (a literal value, a signal, or a scale-snapped signal), and how each parameter is modulated. Change the image, move the path, adjust the cursor's speed, and the music changes with them. Edit, reload, and re-run cycles take seconds.

## Lineage

GeoSonel descends from GeoSonix, a 2012 IanniX-derived desktop application by the same author, and carries forward design ideas from [GeoMaestro](http://www.zogotounga.net/comp/SLN.html) by Stéphane Rollandin (early 2000s). The W in the internal codename GXW stands for Web, marking the move from a desktop-only environment to a browser-based one. The Electron desktop build packages the same web app with disk-based persistence and native file dialogs.

## Status

Early development by a single author. Scores can be authored, played, and routed to MIDI today, and the Strudel integration currently drives external instruments via Web MIDI. In-browser audio playback through superdough is planned and will land soon. The conceptual model is captured in `design/DESIGN.md`, which is the authoritative reference for the design and is updated as implementation evolves. Many features described in the design are shipped; some are in flight, and some are deferred to future work.

If you're arriving from a search for Strudel, algorithmic music, image sonification, or related areas, you're welcome to read, fork, or follow along. The project has no community infrastructure yet (issues, discussions, contributions) because it remains a solo effort, but that may change as the design stabilizes.

## Getting started

The browser version runs as plain HTML, CSS, and JavaScript modules with no build step. Any static file server works; one easy option with Node.js installed is to run `npx serve .` from the repository root, then open the printed URL in a modern browser. Use Chrome, Edge, or Firefox for Web MIDI support.

For the Electron desktop build, `npm install` from the repository root pulls Electron and the native MIDI dependency, then `npm start` launches the app. The Electron build stores scores as folders on disk (one folder per score, containing `scene.json`, `behaviors.js`, and an optional image) and writes settings to the platform's standard application-support directory.

The default score that loads on first launch demonstrates the basic objects: paths with cursors, an image as backdrop, a small set of signals driving notes. Open the Code tab in the app to read its `behaviors.js` and start experimenting.

## A taste of authoring

A minimal Strudel pattern in `behaviors.js`, bound to the path tagged `$CRV1`:

```javascript
$CRV1: note(
  mapClip(pxLt, 0.4, 0.6, 60, 72).struct("1 ~ 1 [1 1]")
)
```

The path's cursor produces a stream of `pxLt` (lightness) values as it moves over the image. `mapClip` clamps that stream to the [0.4, 0.6] input band and linearly remaps it onto MIDI notes 60-72 (C4 to C5). The `.struct("1 ~ 1 [1 1]")` mini-notation overlays a rhythmic structure: four events per cycle with a rest at slot two and a doubled fourth slot. Each event samples the signal at its firing moment, so the melody follows what's under the cursor at that beat.

More elaborate voices add velocity, duration, and harmony fields through a composer helper library, with score-level constants for key, base note, octaves, and chord progression reused across voices. The helper library is documented in `design/sections/section-30-composer-helper-library.md` and is iterating toward a unified declarative entry point that consumes a single options-object describing the whole musical phrase.

## Documentation

The full design document is at `design/DESIGN.md`, organized into thirty sections covering the conceptual model, scene structure, paths and triggers, the Strudel pattern integration, harmony, audio and MIDI output, the Electron migration, and the composer helper library. The document is the source of truth and is kept in step with the implementation as it lands.

## Stack

Modern JavaScript (ES2022+) with JSDoc type hints. [CodeMirror 6](https://codemirror.net) for the in-app editor. HTML Canvas 2D for scene rendering. Web Audio API for in-browser synthesis. Web MIDI API for external output (Chrome, Edge, Firefox). [Strudel](https://strudel.cc) for the pattern language. [Tonal.js](https://github.com/tonaljs/tonal) for scale and chord vocabulary. [Electron](https://www.electronjs.org) for the desktop build. Scores stored as folders on disk in the Electron build, as IndexedDB records in the browser build. No framework, no build step for the browser version: modules load directly.

## License

GNU Affero General Public License version 3 or later. See `LICENSE` for the full text. The AGPL ensures that if you modify GeoSonel and offer it as a network service, the modified source remains available to users of that service.
