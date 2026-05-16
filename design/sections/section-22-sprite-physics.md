## Section 22 — Sprite Physics Details

Canvas units are origin-centred with equal metric along both axes (see Section 21).

Sprite visual rendering diameter user-settable, default 1.5 canvas units. This is purely a display setting (see Section 6); sprites are points geometrically and have no spatial extent. The only collision sprites participate in is canvas-boundary reflection, which works against the sprite's point position.

Velocity ceiling, two-level:
- maxSpeed: user-settable per sprite, default 16 canvas units/sec, range 1 to 64.
- absoluteMaxSpeed: hard system ceiling of 64 canvas units/sec, enforced every step.

Applied by scaling the velocity vector to preserve direction.

At absoluteMaxSpeed=64 and dt=1/60, max travel per step is ~1.07 units. Since sprites are points (they don't collide with triggers or curves or each other), the only collision detection is against the implicit canvas-boundary box, which is straightforward even at high speeds.

Bounding region: since the canvas has no inherent boundary, sprites are contained by an implicit bounding box matching the default viewable region (±16 by ±12 units) against which they collide and reflect. A scene or sprite may configure a larger or smaller box, or disable bounding entirely (letting sprites fly off indefinitely). Default bounding is on.

Boundary collision detection: continuous within each time step. Calculates exact time when sprite reaches each wall, moves to that point, reflects velocity, continues for remaining time. Up to 10 bounces per step resolved. Final position clamp as safety net.

Reflection: angle of incidence equals angle of reflection. Speed preserved exactly. Corner hits reflect both components.

Physics step order:
1. Sprite step function is called (if defined).
2. Sample vector field at current position.
3. Integrate velocity and position.
4. Apply velocity ceiling.
5. Resolve boundary collisions.
6. Sample image colour at final position (for next frame's context).
7. Check auto-timer firing against transport.

Curve cursor motion is not physics-integrated. Cursors advance along their curve's geometry at the rate set by the curve's beatsPerCycle field (see Section 4 for the schema and Section 7 for the timing model). Continuous-collision detection applies to cursor-vs-target interactions: the cursor's sweep segment from its previous position to its current position is tested for intersection against trigger centerpoints, sprite centerpoints, and against marker centerpoints on other curves.

Curve velocity is physics-integrated. Curves carry vx and vy fields (see Section 4) that translate the curve's geometry through space on each simulation tick, with the same inside-only canvas-boundary reflection that governs sprite motion. The boundary collision uses per-shape geometric tests where the curve geometry is non-axis-aligned, but for the current shape types (line, ellipse, piste) with axis-aligned canvas edges the bounding-box edge coincides with the curve's extreme x or y coordinate, so the bbox-vs-edge test reaches the same moment as a per-shape geometric test. For future curved shape types (beziers, splines) the bounding box can become loose around the geometry when control points stick out; those types will need a per-shape test rather than reusing the bbox. Curve velocity is a forward-looking schema field; the bounce mechanics land alongside the curve-bounce implementation milestone (see TODO.md).

Physics may run in a Web Worker so that audio-rate scheduling on the main thread is not starved. Final architecture of the physics-worker split is to be determined during implementation.
