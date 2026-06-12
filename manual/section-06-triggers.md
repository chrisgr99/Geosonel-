# Section 6 — Triggers

_Status: outline._

Triggers are fixed points on the canvas that respond when a cursor crosses them — the
simplest object, used for hit-driven events and rhythms.

## In this section

- **What a trigger is** — a static point collider with a position, a visual size, and a
  colour; no cursor of its own.
- **Creating and placing** — adding a trigger and positioning it.
- **Being hit** — how a passing cursor fires the trigger's beenTriggered callback.
- **Trigger sync to beat** — aligning a trigger's response to the beat grid.
- **Appearance** — size and colour, and that the size is a visual radius, not a collision
  radius.
- **What a trigger can do** — its callbacks at a glance; written in section 12.
