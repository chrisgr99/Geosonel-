# Section 8 — Beat Points & Rhythm

_Status: outline._

Beat points are the positions where a cursor fires. This section covers how to place
them and the three ways to generate them.

## In this section

- **What beat points are** — the marks a cursor crosses to fire onActiveBeat; how they
  ride along a curve.
- **Beat strength** — the per-beat accent (0–9) and how it maps to velocity.
- **The three modes:**
  - **Normal** — hand-placed beats with an `x . `-style pattern field; looping behaviour.
  - **Euclidean** — evenly distributed active beats from a count.
  - **Strudel pattern** — a Strudel mini-notation string parsed statically into beat
    positions (this is the one place GX2 uses Strudel notation; it generates positions,
    it does not play the pattern).
- **Ratchets** — a digit 1–9 in a slot meaning that many evenly-spaced hits within the
  slot.
- **Beat interval, beats per bar, repeats, and shift** — shaping how the pattern lays out
  around the curve.
- **The firing flash** — the visual feedback as beats fire.
