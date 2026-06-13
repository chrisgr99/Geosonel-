# GeosonixV2 (GX2) User Manual

GeosonixV2 — abbreviated **GX2** throughout this manual — is an app for composing
music that emerges from 2D scenes. You place geometric objects on a canvas, often
over an image, and they make music as the piece plays: cursors sweep along curves and
fire their beat points, objects collide, and short scripts turn what happens on the
canvas into notes sent to the built-in synthesis engine or to external instruments
over MIDI.

## About this manual

The manual is written to be read in order the first time and used as a reference
afterward. The early sections get you making sound quickly; the middle sections build
musical depth one idea at a time; the later sections are the authoring and reference
material you reach for once you know your way around.

- **New to GX2?** Read sections 1–4, then work through the tutorials in section 2.
  That is enough to build and play a simple scene.
- **Building real pieces?** Sections 5–11 cover the objects and the musical mechanics
  in depth.
- **Writing scripts / going deep?** Sections 12–15 are the authoring layer.
- **Looking something up?** Section 16 is the reference (shortcuts, the scripting API,
  and every inspector field), kept in step with the code.

Each section lives in its own file so it can be opened, edited, and read on its own;
they can be merged into a single PDF or web page later. The abbreviation **GX2** is
used for the application name in most places after this introduction.

## Table of contents

1. [Introduction](section-01-introduction.md) — what GX2 is, what you can make, and its lineage.
2. [Getting Started](section-02-getting-started.md) — install/open, and a set of short tutorials that build your first scene step by step.
3. [Core Concepts](section-03-core-concepts.md) — the mental model and vocabulary: canvas, objects, cursors, beat points, cycles, colour, callbacks.
4. [The Interface](section-04-the-interface.md) — the window layout, the canvas and its coordinate grid, the inspector and Script tabs, the transport bar, and the toolbar.
5. [Curves](section-05-curves.md) — paths with sweeping cursors and beat points; the most structured object.
6. [Triggers](section-06-triggers.md) — fixed points that respond when a cursor crosses them.
7. [Sprites](section-07-sprites.md) — bodies that move under physics over the image beneath them.
8. [Beat Points & Rhythm](section-08-beat-points-and-rhythm.md) — placing beats; Normal, Euclidean, and Strudel-pattern modes; ratchets and beat strength.
9. [Cycles, Tempo & Transport](section-09-cycles-tempo-and-transport.md) — master tempo, per-object cycles, speeds, and play/pause/rewind.
10. [The Background Image & Colour](section-10-background-image-and-colour.md) — loading an image and how its colour and brightness drive sound.
11. [Motion & Collisions](section-11-motion-and-collisions.md) — sprite motion, bouncing off the canvas edges, and what makes objects fire each other.
12. [Scripting & the Sound API](section-12-scripting-and-sound-api.md) — writing callbacks, the playNote/playSound API, the `this` context, and polyphony.
13. [Sound Output](section-13-sound-output.md) — the built-in audio engine versus MIDI, voices and sound banks, and the virtual MIDI port.
13a. [Harmony](section-13a-harmony.md) — importing iReal Pro charts, the chord-chart view, and following a progression from a script. _(feature in progress; final number TBD)_
14. [Creation, Mutation & Audition](section-14-creation-mutation-and-audition.md) — seed-driven variation and the audition workflow.
15. [Saving & Score Files](section-15-saving-and-score-files.md) — score bundles, saving, loading, and sessions.
16. [Reference](section-16-reference.md) — keyboard shortcuts, the scripting API, and the field reference (generated from and checked against the code).
17. [Troubleshooting & FAQ](section-17-troubleshooting-and-faq.md) — common problems and answers.
18. [Example Scores](section-18-example-scores.md) — a few annotated scores that double as worked tutorials.
