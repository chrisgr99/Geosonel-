# Section 3 — Core Concepts

_Status: outline._

The mental model and vocabulary the rest of the manual relies on. Read once; refer back
when a term is unfamiliar.

## In this section

- **The scene** — a canvas holding objects, optionally over a background image.
- **The three objects** — curves (paths with cursors), triggers (fixed points), sprites
  (moving bodies). One-line each; details in their own sections.
- **Cursors** — the sweeping line that makes an object a sound source and a collider.
- **Beat points** — the positions along a curve where events fire.
- **Cycles and tempo** — each object runs its own cycle against one shared master clock.
- **The image as signal** — colour and brightness under a point become numbers a score
  can use.
- **Callbacks** — the short scripts that turn events into notes: onActiveBeat,
  hasCollided, beenTriggered, onTick.
- **Output** — notes go to the built-in engine or out over MIDI.
- **The vocabulary at a glance** — a small glossary table tying the terms together.
