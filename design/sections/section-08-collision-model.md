## Section 8 — Collision Model

GXW's collision model is the cursor-as-collider rule: a source's cursor sweeps through space and collides with other objects in the scene. The cursor is the only thing that initiates collisions, and collisions test the cursor line segment against the centerpoint of the target.

The collider. Any curve or sprite with a non-zero cursor extent (cursorL or cursorR) is a collider. A cursor with both extents zero is a pure progress indicator and does not collide. Triggers have no cursor of their own and therefore cannot initiate collisions.

The collidee. The following can be collided with: triggers (at their centerpoint), sprites (at their centerpoint), and a curve's cyclePattern markers (at their fractional positions along the curve). Nothing else acts as a collidee: not curve geometries themselves, and not the cursors of other sources.

The geometry. Collision is tested as the cursor's line segment against the target's centerpoint, with continuous collision detection inside each physics step so a fast-moving cursor cannot skip past a small target between frames. The trigger's size field and the sprite's displayDiameter are visual radii only and do not affect collision detection.

Self-firing is not a collision. When a curve's cursor sweeps over a marker that is part of its own cyclePattern, the event fires as part of the cycle but the collision callbacks (hasHit and beenHit) do not fire. The callbacks are reserved for inter-source contact: a cursor hitting an external trigger, sprite, or marker on a different curve.

Callbacks fired on collision. Inter-source contact fires the target's beenHit and the collider's hasHit; both callbacks are optional and either can be defined independently. When both are authored, the target's beenHit fires first and the collider's hasHit fires second. The typical pattern is to author only beenHit on the target, since the target most often knows what should happen when it is hit.

Pattern firing on collision is opt-in. The trigger's cyclePattern is not auto-fired by the runtime when the trigger is hit; if the user wants the pattern to play, they invoke a runtime helper from inside the trigger's beenHit. This keeps beenHit open for other authored behaviours that do not involve the pattern. The helper itself is planned implementation work not yet wired up.

Proximity alone does not collide. Two sprites near each other do not collide unless one of them sweeps a cursor through the other's centerpoint. Triggers cannot initiate collisions at all because they have no cursor.
