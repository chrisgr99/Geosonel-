## Section 6 — Sprites

A sprite is an autonomous agent that moves through the scene under its own logic. Like all source kinds, a sprite has a position and up to four behaviour slots (cyclePattern, hasHit, beenHit, onTick). Unlike triggers and curves, a sprite has its own velocity field and integrates motion under physics each simulation step.

Geometry. A sprite has a position (x, y), a velocity (vx, vy), a visible disc with a configurable displayDiameter, and an optional perpendicular cursor. The disc combined with the score's spriteScale defines the bounding circle the simulation uses for canvas-wall collision under the inside-only rule (section 22). For object-to-object collision, the sprite's centerpoint is what other cursors test against; the disc is purely visual plus wall-bounce body.

Cursor. A sprite has cursorL and cursorR extent fields that define a line segment perpendicular to the sprite's last direction of motion, with the two extents measured left and right of that direction. The cursor is visible and active iff at least one extent is non-zero and mute is unchecked. When active, the cursor sweeps through space as the sprite moves and collides with other sources' centerpoints.

Motion. Sprites move freely under physics integration; they are not path-constrained, and sweep-along-a-path behaviour belongs to a curve with an extended cursor rather than to a sprite. The maxSpeed field caps integrated velocity. Each sprite has authored x, y, vx, vy, displayDiameter, and maxSpeed fields that define its starting state; live position and velocity are maintained in a separate runtime state the canvas reads for rendering. See section 22 for the integration step and the inside-only wall rule.

Cycle. A sprite's cyclePattern advances on master BPM × beatsPerCycle wall-clock time, the same as a curve's. When beatsPerCycle is greater than zero, the sprite's position resets to its authored starting state at the end of each cycle. Because the simulation is deterministic, an image-driven wandering sprite retraces the same path each cycle, turning the wander into a repeatable musical figure. When beatsPerCycle is zero, the sprite never resets and is free to wander indefinitely.

Behaviour slots. A sprite has up to four behaviour slots:

- cyclePattern: a Strudel mini-notation string defining the sprite's musical content. Fires events at their fractional positions as the cycle advances in time.
- hasHit: a JavaScript function that runs when the sprite's cursor strikes another object.
- beenHit: a JavaScript function that runs when another source's cursor strikes this sprite.
- onTick: a JavaScript function that runs every simulation step. The typical use is to read the local image colour at the sprite's position and influence acceleration, giving the sprite an image-derived force field of its own.

Multiple sprites can share an onTick function reference, so a single function authored once shapes the trajectories of every sprite that points to it.

Soft UI convention: six sprites in the default palette, based on experience from GeoSonix that parameter management past six becomes overwhelming. Not a data-model limit.
