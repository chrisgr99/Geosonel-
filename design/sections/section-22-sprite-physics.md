## Section 22 — Sprite Physics Details

Canvas units are origin-centred with equal metric along both axes (see Section 21).

Sprite visual rendering diameter user-settable, default 1.5 canvas units. This is purely a display setting (see Section 6); sprites are points geometrically and have no spatial extent. The only collision sprites participate in is canvas-boundary reflection, which works against the sprite's point position.

Velocity ceiling:
- absoluteMaxSpeed: hard system ceiling of 64 canvas units/sec, enforced every step.

Applied by scaling the velocity vector to preserve direction.

At absoluteMaxSpeed=64 and dt=1/60, max travel per step is ~1.07 units. Since sprites are points (they don't collide with triggers or curves or each other), the only collision detection is against the implicit canvas-boundary box, which is straightforward even at high speeds.

Bounding region: since the canvas has no inherent boundary, sprites are contained by an implicit bounding box matching the default viewable region (±16 by ±12 units) against which they collide and reflect. A scene or sprite may configure a larger or smaller box, or disable bounding entirely (letting sprites fly off indefinitely). Default bounding is on.

Boundary collision detection: continuous within each time step. Calculates exact time when sprite reaches each wall, moves to that point, reflects velocity, continues for remaining time. Up to 10 bounces per step resolved. Final position clamp as safety net.

Reflection: angle of incidence equals angle of reflection. Speed preserved exactly. Corner hits reflect both components.

Physics step order:
1. onTick is called if defined, applying any forces (to this sprite or to others) and firing any notes. A force applied here is divided by the sprite's mass and added to its impulse-velocity layer.
2. Form the effective velocity as the sum of the base-velocity layer (owned by cycleSpeeds) and the impulse-velocity layer.
3. Integrate position from the effective velocity over the step.
4. Apply the velocity ceiling to the effective motion (terminal speed), holding the impulse layer from winding up past the cap.
5. Resolve boundary collisions, reflecting both velocity layers on the bounced axis and flipping that axis's flipX or flipY reflection sign (see below).
6. Sample image colour at the final position, for the next step's onTick context.
7. Check auto-timer firing against transport.

Because onTick runs first, the forces it applies are what that same step integrates and moves on, and the image colour each callback reads was sampled at the end of the previous step. onTick runs once per fixed simulation sub-step (SIM_DT in Section 23), so the time slice in step one is that fixed sub-step and a sustained force integrates identically from one run to the next regardless of frame rate. onTick is wired for sprites at this milestone; curves and triggers gain it later.

Two-layer velocity, mass, and the flip signs. A sprite's runtime velocity is two vectors that sum to the motion integrated each step. The base layer is the authored velocity as transformed by cycleSpeeds: scaled by the per-cycle multiplier, and at a cycle boundary either rescaled by the ratio of the new multiplier to the old (the continuous case) or re-derived from the authored velocity times the new multiplier (the home-teleport a zero-terminated list produces). The impulse layer is the running sum of onTick forces, each divided by the sprite's mass. Keeping them separate is what lets a cycle-speed change scale only the launch motion while a force field's accumulated effect rides through a boundary untouched; the base layer must stay exactly authored-times-multiplier for the boundary ratio math to mean anything, so neither the cap nor the impulse accumulation ever writes into it.

mass (default one) converts force to a change in impulse velocity: the change equals the force divided by the mass, integrated over the step, so a heavier sprite responds less to the same force. At the default mass of one the conversion is the identity, and a score that ignores mass sees a direct velocity change as though there were no mass at all. mass is also the property that makes future inter-object forces — attraction, repulsion, gravity — meaningful, since it determines how much each interacting body moves under an equal and opposite force. mass is dimensionless and relative — there is no physical unit, only a ratio with one as the reference object — and the inspector enforces a small positive floor (one tenth) so a near-zero mass cannot divide a force into an unbounded acceleration. maxSpeed already bounds the resulting speed, so the floor exists only to forbid divide-by-zero and absurdly hair-trigger response, not for numerical stability.

A rewind and a home-teleport both re-derive the base layer from the authored velocity and zero the impulse layer, so a fresh launch starts clean on both. A continuous cycle boundary scales the base layer and leaves the impulse layer alone.

Wall bounces interact with onTick forces through a pair of exposed signs rather than any hidden transform of the force. The engine never alters a force passed to applyForce — applyForce is always literal, so a directional force like gravity stays pointed where the callback aimed it. To support image-derived force fields, which otherwise pin a sprite to whatever wall they push it into, each sprite carries two read-only per-axis signs, flipX and flipY, each plus or minus one and starting at plus one. The engine flips the relevant sign each time the sprite reflects off a wall on that axis; the sign is untouched by any velocity change that isn't a wall bounce, and resets to plus one on a rewind or a home-teleport. A callback that wants the anti-trap behaviour multiplies the matching sign into its force — a pixel-derived push times flipX on the x axis — so the field reverses on that axis after each bounce and always works the sprite away from the wall it just struck; a callback that wants a force to hold its direction simply omits the sign. The choice lives in the force expression, the one place that knows whether reversal is wanted. The name reads in the present tense deliberately: multiplying by flipX is the act of flipping, not a record that a flip occurred. Independently of the signs, the bounce itself reflects both velocity layers' components on the struck axis, so the sprite's current momentum reverses in the ordinary physical way whether or not any force opts into flipX or flipY.

Curve cursor motion is not physics-integrated. Cursors advance along their curve's geometry at the rate set by the curve's beatsPerCycle field (see Section 4 for the schema and Section 7 for the timing model). Continuous-collision detection applies to cursor-vs-target interactions: the cursor's sweep segment from its previous position to its current position is tested for intersection against trigger centerpoints, sprite centerpoints, and against marker centerpoints on other curves.

Curve velocity is physics-integrated. Curves carry vx and vy fields (see Section 4) that translate the curve's geometry through space on each simulation tick, with the same inside-only canvas-boundary reflection that governs sprite motion. The boundary collision uses per-shape geometric tests where the curve geometry is non-axis-aligned, but for the current shape types (line, ellipse, piste) with axis-aligned canvas edges the bounding-box edge coincides with the curve's extreme x or y coordinate, so the bbox-vs-edge test reaches the same moment as a per-shape geometric test. For future curved shape types (beziers, splines) the bounding box can become loose around the geometry when control points stick out; those types will need a per-shape test rather than reusing the bbox. Curve velocity is a forward-looking schema field; the bounce mechanics land alongside the curve-bounce implementation milestone (see TODO.md).

Physics may run in a Web Worker so that audio-rate scheduling on the main thread is not starved. Final architecture of the physics-worker split is to be determined during implementation.
