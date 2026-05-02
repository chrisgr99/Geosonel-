## Section 2 — Conceptual Model

A GXW scene holds three kinds of first-class objects — curves, triggers, and sprites — plus an optional background image that acts as a scalar field and a transport that keeps global tempo and time.

Curves are geometric shapes (line, ellipse, piste, bezier, and other named forms) with intrinsic rhythmic structure. Each curve has a set of beat points distributed around its shape according to an algorithmic generator (primarily Euclidean) or a hand-authored pattern string. Each curve has a visible cursor that advances through its cycle over a settable number of beats. When the cursor reaches an active beat point, the curve's Hit Beat function fires. If the cursor has non-zero extent on either side of the curve direction, it sweeps through space as it advances, and any triggers in the swept region fire the curve's Hit Trigger function. Curves combine geometry, rhythm, and projection into one coherent compositional object.

Triggers are static positions in the scene with optional payload. They do not move. They fire when a curve's extended cursor sweeps over them, or on an optional auto-timer. Triggers are the free-standing musical atoms of the scene — positions the composer places with compositional intent.

Sprites are autonomous agents that move through the scene under their own logic. Each sprite has a Motion Update function called every physics step, in which it reads its environment (image colour under its position, vector field forces, transport state) and returns an acceleration vector that the simulation adds to its velocity before integrating position. Sprites do not collide with anything; they fire musical events through an Auto function on a beat-aligned timer or by side effects inside their Motion Update logic. The sprite is the autonomous-creature-in-a-field idea from GeoSonix, made first-class.

The transport is global: tempo, time signature, beat position, play state. All objects reference it. Curves advance their cycles from transport time. Triggers tick their auto timers from transport time. Sprites integrate physics against transport time. One shared clock keeps everything rhythmically locked by default.

Three object types, each with a clear compositional role. Two collision participants (the curve's extended cursor as collider, the trigger as collidee), one direction of interaction. Three function-slot budgets per object type, each slot named for what it reacts to. The mental model fits in a paragraph.
