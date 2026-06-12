# Section 11 — Motion & Collisions

_Status: outline._

How objects move and how they make each other fire — the two ways events happen besides
an object's own cursor sweeping its beats.

## In this section

- **Sprite motion** — position from velocity each step; the two-layer velocity (the
  launch motion plus accumulated force).
- **The motion feel knobs** — drag, jitter, coast, and turn smoothing, score-wide, and
  what each does to how a sprite moves.
- **Applying force** — pushing a sprite from a callback (typically from the image colour);
  mass and how it scales the response.
- **Canvas edges** — the soft play area; the inside-only rule for bouncing; reflection.
- **The flip-sign trick** — making an image-driven force work a sprite away from the wall
  it just hit.
- **Curve motion** — translating a whole curve and bouncing it off the edges.
- **Collisions between objects** — the cursor-as-collider rule: a cursor is the only thing
  that initiates a collision; what it can strike (triggers, other curves' beat points).
- **What fires on a hit** — the struck object's beenTriggered, then the collider's
  hasCollided; why self-contact is not a collision; the passive-curve-as-trigger idiom.
