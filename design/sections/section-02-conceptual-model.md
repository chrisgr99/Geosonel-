## Section 2 — Conceptual Model

A GXW scene holds three kinds of first-class object: curves, triggers, and sprites. The scene also has an optional background image that acts as a scalar field, and a master transport that keeps global tempo and play state.

Curves are geometric shapes (line, ellipse, and similar named forms) with optional cursors and a cycle pattern. The cycle pattern is written in Strudel mini-notation and produces events whose positions along the curve are marked with diamond glyphs. When the curve has a cursor (non-zero cursor extents and mute unchecked), the cursor sweeps along the curve over the cycle period and fires the pattern events at their marker positions as it passes.

Triggers are static positions in the scene that act as collision targets. They do not move and do not self-fire. They fire their beenHit callback when a cursor (from a curve or sprite) sweeps over them, with the colliding source's hasHit callback firing in tandem.

A curve's cyclePattern markers also act as collision targets, just like discrete triggers. When another cursor sweeps over a marker, the curve fires its beenHit and the colliding source fires its hasHit, with the marker's pattern data delivered as part of the event. These markers are part of the curve rather than separate trigger objects.

Sprites are autonomous agents that move through the scene under physics. Like curves, sprites can carry their own cycle pattern and optional cursor; with a cursor they become colliders against other objects. The sprite's onTick callback runs every simulation step and can read local image colour to compute acceleration, so each sprite effectively moves through an image-derived force field of its own.

The master transport carries the global tempo (master BPM) and play state. Each source has its own cycleBeats setting that, combined with master BPM, determines that source's wall-clock cycle period. Sources can therefore run at different cycle periods independently while sharing one clock.

The hasHit, beenHit, and onTick callbacks offer a parallel path for authoring sound events alongside the cyclePattern. Each is a short JavaScript function called by the runtime at a specific moment: hasHit when this source's cursor strikes another object, beenHit when this source is struck by another's cursor, and onTick once per simulation step. The function body has direct access to sound and MIDI generation and to the broader scene state, so the composer can produce music procedurally alongside or instead of using patterns.

Three object kinds with overlapping capabilities. The cursor is the unifying collision mechanism: any curve or sprite with a non-zero cursor extent is both a self-firer and a collider against other objects. Each object type can carry up to four behaviour slots: the cyclePattern for self-firing, plus hasHit, beenHit, and onTick callbacks that respond to collision and per-tick events.
