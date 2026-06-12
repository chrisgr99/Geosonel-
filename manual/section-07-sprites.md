# Section 7 — Sprites

_Status: outline._

Sprites are bodies that move under physics across the canvas, reading the image beneath
them — the way to get autonomous, image-driven motion and sound.

## In this section

- **What a sprite is** — a point body with a position and velocity; the displayed circle
  is a visual size only.
- **Creating and placing** — adding a sprite and setting its starting position and
  velocity.
- **Motion** — how a sprite moves each step; the score-wide motion feel knobs (drag,
  jitter, coast, turn smoothing); the soft-canvas edges it bounces off. Full detail in
  section 11.
- **Steering by the image** — applying force in onTick from the colour underneath so the
  sprite is pushed by what it sees; the flip-sign trick for working away from walls.
- **The cursor** — giving a sprite a cursor so it becomes a collider as it travels.
- **Mass** — how heavy a sprite is for force response.
- **What a sprite can do** — its callbacks at a glance; written in section 12.
