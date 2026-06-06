## Section 5 — Triggers

A trigger is a static musical position in the scene. Triggers have a position but no velocity (they do not move under physics) and no cursor (they cannot self-fire under the cursor-as-collider model). Like all source kinds, a trigger can carry a cyclePattern and the standard callback slots.

Fields. A trigger has a position (x, y) in canvas coordinates, a size that sets the rendered radius of the trigger's disc, a color, and a mute boolean. Position, size, color, and mute are inspector-editable. The note and payload fields exist in the schema but are not surfaced in the inspector and are scheduled for removal.

Cycle pattern. A trigger's cyclePattern is its musical content, written in Strudel mini-notation (see section 27). The design intent is that the pattern plays for one cycle when the trigger is hit by another source's cursor. One-shot firing on collision is not yet implemented; once it lands, the runtime will expose a helper function callable from the user's beenHit code so the user can opt the trigger into firing its pattern.

Behaviour slots. A trigger has three meaningful behaviour slots:

- cyclePattern: a Strudel mini-notation string. Fires as a one-shot when the trigger is hit (design intent; firing helper pending).
- beenHit: a JavaScript function that runs when another source's cursor strikes this trigger.
- onTick: a JavaScript function that runs every simulation step.

hasHit does not apply to triggers since they have no cursor. The beatsPerCycle field is greyed in the inspector for trigger-only selections, since triggers cannot self-fire and their cycle counter is internal-only.
