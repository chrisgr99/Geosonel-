# Section 5 — Curves

_Status: outline._

Curves are paths on the canvas with an optional sweeping cursor and beat points — the
most structured object and the usual home of a melodic or rhythmic line.

## In this section

- **What a curve is** — a shape (line, ellipse, piste) that a cursor travels along.
- **Drawing and editing** — creating a curve from the toolbar; moving, resizing, and
  reshaping it on the canvas.
- **The cursor** — the cursorL / cursorR extents; when a curve has a live cursor versus
  acting as passive geometry; the cursor as both sound source and collider.
- **Beat points on a curve** — placing them and how the cursor fires them (full detail in
  section 8).
- **Cycle length and speed** — beats per cycle, and per-cycle speeds (faster, slower,
  reversed, halted); covered fully in section 9.
- **Stopping** — playing for a fixed number of cycles.
- **Curve motion** — giving a curve a velocity so its whole shape drifts and bounces.
- **What a curve can do** — its callbacks (onActiveBeat, hasCollided, beenTriggered,
  onTick) at a glance; written in section 12.
