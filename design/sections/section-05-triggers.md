## Section 5 — Triggers

A trigger is a static musical position in the scene. It has:

- A position in canvas coordinates.
- A size, which serves as the collision radius for cursor-sweep detection.
- Optional payload — a note specification, controller value, parameter set, pre-rendered phrase, or callback function. Used by the firing function as this.note, this.cc, etc.
- Up to two optional function slots:
  - A Collision function fires when a curve's extended cursor sweeps over the trigger. Context includes the curve that hit it and the hit geometry.
  - An Auto function fires on the trigger's own timer at an interval set in the trigger's properties.

Both functions are optional. A trigger can be pure data — position and payload with no functions — in which case nothing fires when the trigger is hit. This is specifically useful when the composer wants the colliding curve's Hit Trigger function to do all the musical work, reading the trigger's payload as context. See Section 8 for the collision resolution rule that makes this pattern work.

Triggers do not move. They do not observe the scene. They do not carry per-step logic. They sit at their position and fire when hit or when their auto timer ticks.
