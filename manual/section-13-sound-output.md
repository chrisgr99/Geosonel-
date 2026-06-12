# Section 13 — Sound Output

_Status: outline._

Where the notes actually go: the built-in audio engine or external instruments over
MIDI.

## In this section

- **Two output paths** — the built-in synthesis engine (superdough) and Web MIDI; how to
  choose, and that they coexist.
- **Voices and sound banks** — picking an instrument for pitched notes and a bank/sample
  for sound hits; per-object voice selection.
- **The MIDI path** — the virtual MIDI port GX2 exposes, choosing an output, channels,
  and how note velocity and duration are sent.
- **Getting sound on first launch** — the user-gesture requirement and the Load Engine
  control.
- **Levels and clipping** — keeping simultaneous voices under the ceiling; the same-pitch
  de-duplication.
- **Panning** — placing a note in the stereo field (built-in engine).
