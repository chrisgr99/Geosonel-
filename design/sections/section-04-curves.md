## Section 4 — Curves

A curve is the most structured object in GXW. It bundles geometry, a cyclePattern, an optional cursor, and up to four behaviour slots.

Shape. A curve has a geometric form: line segment, ellipse, or bezier. The shape defines the curve's spatial presence and the path along which the cursor advances. A circle is an ellipse with equal width and height; the two are stored as one shape primitive so that the inspector's W and H fields can be edited independently without flipping the shape's type as a side effect.

Cycle pattern. The curve's musical content is expressed as a cyclePattern written in Strudel mini-notation (see Section 10 for the full pattern language). The pattern's events render as diamond markers along the curve at their fractional positions within the cycle, with the positions re-queried from the parsed pattern at each cycle wrap. For deterministic patterns the marker positions are stable cycle to cycle; for stochastic patterns (using degradeBy, choose, scramble, or rand/irand signals) the positions shift on each wrap and the markers visibly animate. When the curve has a cursor, the cursor sweeps along the curve over the cycle period and fires the pattern events at their marker positions as it passes. When the curve has no cursor, the markers remain visible and can act as collision targets for other sources' cursors.

Cursor. A curve has an optional visible cursor that advances through its cycle at a rate governed by the curve's beatsPerCycle field (labelled "Beats/Cycle" in the inspector). The cursor has two extent values, cursorL and cursorR (left and right of curve direction, set independently). The cursor is visible and active iff at least one of cursorL or cursorR is non-zero and mute is unchecked; otherwise the curve has no cursor and acts as a passive geometry plus marker container. Toolbar-created new curves arrive with cursorR and cursorL both set to 1 by default, so a freshly-placed curve has an audible firing surface and a visible cursor band from the moment it lands. The schema default for both fields is 0, so hand-edited scene.json entries omitting the fields behave as no-cursor curves.

Extended cursors act as colliders. When a curve has a non-zero cursor extent, the cursor is a line segment of that extent perpendicular to the curve's direction. As the cursor advances, the segment sweeps through space and can collide with other objects: triggers in the scene, other curves' cyclePattern markers, and sprites. Collision fires the curve's hasHit callback and the other object's beenHit callback in tandem.

Cycle length. beatsPerCycle (number, default 4) gives the curve's cycle length in master beats. Combined with the score's master BPM, this determines the curve's wall-clock cycle period. Within-cycle event density is expressed by mini-notation modifiers in the cyclePattern itself (.fast, .slow, subdivisions), so a single cycle-length field is enough to specify cycle timing.

Starting velocity. A curve has vx and vy schema fields (default 0) that give the curve's initial velocity. When non-zero, the curve's geometry translates by (vx, vy) per simulation tick and bounces off the canvas edges following the same inside-only reflection rule that governs sprite motion (see Section 22). For the current shape types (line, ellipse, piste) with axis-aligned canvas edges, the curve's bounding-box edge coincides with the curve's extreme x or y coordinate, so the bounding-box test reaches the same moment as a per-shape geometric test. Curve velocity is a forward-looking schema field; the bounce mechanics land alongside the curve-bounce implementation milestone (see TODO.md).

Stop at cycle. The stopAtCycle field (default -1) halts the cursor after a specified number of cycles, with -1 meaning play forever. Setting it to 3 means three cycles then stop, useful for finite-length compositional gestures.

Behaviour slots. A curve has up to four behaviour slots:

- cyclePattern: a Strudel mini-notation string defining the curve's musical content. Fires events when the cursor sweeps through the cycle.
- hasHit: a JavaScript function that runs when the curve's cursor strikes another object.
- beenHit: a JavaScript function that runs when this curve is struck by another's cursor.
- onTick: a JavaScript function that runs every simulation step.

Any slot can be left empty.
