## Section 8 — Collision Model

GXW has exactly one collision rule, applying to exactly one participant pair.

The collider. An extended cursor — a curve's cursor with non-zero R or L extent — is the only thing that initiates collisions. Cursors with zero extent are pure progress indicators and do not collide.

The collidee. A trigger is the only thing that can be collided with. Curves with the "beats are triggers" property true also expose their active beat points as collidees for this purpose, firing using the curve's Hit Beat function context augmented with external-collision information.

The rule. When a curve's extended cursor sweeps through a trigger's collision radius during a physics step, a collision event fires. Continuous collision detection within each step ensures a fast-moving cursor cannot skip past a small trigger between frames.

Functions fired on collision. Both the trigger's Collision function and the curve's Hit Trigger function fire, in that order, if both are defined. If only one is defined, only it fires. The composer chooses per object which function to define, which enables several compositional patterns:

- Define only the trigger's Collision function: the trigger controls its own firing regardless of which curve hit it. Each trigger sounds the same way no matter how it was struck. The classical trigger-as-sound-emitter pattern.
- Define only the curve's Hit Trigger function: triggers are pure data (position plus payload); the curve decides how to interpret each hit. This is the GeoMaestro distortion-function pattern — centralised firing logic reading trigger data as context. A single function with distance-based pitch and angle-based pan, applied uniformly to every trigger the curve sweeps.
- Define both: two things fire per collision. Useful when one function emits a note and the other logs, animates, or triggers a secondary effect.
- Define neither: silent hit. Rarely useful except as a placeholder during authoring.

What does not collide. Sprites do not collide — not with triggers, not with curves, not with other sprites. If a sprite wants to fire a trigger by proximity, its Motion Update or Auto function reads scene state and does so explicitly. Curves do not collide with other curves (except via the beats-as-triggers mechanism, which makes beat points collidable as triggers, not the curve itself). Triggers do not collide with other triggers.

This one-rule model replaces the five firing types of GeoSonix (cursor-auto, curve-auto, curve-beat, trigger-auto, trigger-collision) with an architecture where firing situations map one-to-one onto named function slots on the relevant object. Beat points fire on internal curve cycles via the curve's Hit Beat function. Triggers fire on auto timers via their Auto function or on cursor-sweep collisions via their Collision function (or the colliding curve's Hit Trigger function). Sprites fire on auto timers via their Auto function or by side effects from inside their Motion Update function. Each firing situation has its own named function slot, so no source-switching logic inside functions is needed.
