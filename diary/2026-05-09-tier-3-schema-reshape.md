# Tier 3 Stage 1, schema reshape

New session this afternoon to land Stage 1 of the Tier 3
inspector integration. The previous session left section 27
fully resolved on its design questions, Tier 1's StrudelRuntime
in place and committed, and a clean tier plan for what comes
next.

The original tier order had Tier 2 (the pattern evaluation
primitive) before Tier 3 (the inspector). Today's call is to
swap them: get the inspector reshaped to its new four-band
layout first, then circle back for Tier 2 to consume the new
schema surface. This makes sense in practice. The inspector is
what exposes the new fields to the user, and it is easier to
design the runtime against a stable schema than to design both
together. Tier 2 inherits a settled vocabulary instead of
inventing one of its own.

Stage 1 is schema-only. sceneSchema.js gets the obsolete
beat-points-era fields removed (autoBeatInterval, activeBeats,
strength, beatPointsMode, beatsPerBar, beatOffset, cycleSpeeds,
hitBeat, hitTrigger, motionUpdate, the Euclidean parameters of
activeBeatsCount, beatShift, repeats, plus a handful of related
fields that no longer fit: beatInterval, beatsAreTriggers, the
legacy cycleDuration, and the auto / autoInterval pair on
triggers and sprites which collapses into the new cycle slot,
and the trigger collision functionRef which reshapes into the
new hasHit / beenHit slots).

The new fields land as a shared CALLBACK_SLOT_FIELDS constant
spread into each of CURVE_FIELDS, TRIGGER_FIELDS, and
SPRITE_FIELDS. All three kinds get the same ten-field block
covering the cycle slot (canCycle, cyclePattern,
cyclePatternLocation, beatsPerCycle), the hasHit slot (canHit,
hasHitFunction), the beenHit slot (canBeHit, beenHitFunction),
and the onTick slot (canTick, onTickFunction). This puts the
same vocabulary on every source kind, which is the intent of
the section 27 design and prepares the ground for a uniform
inspector Band 3 in Stage 2. The shape echoes the existing
HARMONY_OVERRIDE_FIELDS pattern.

The cyclePattern field is typed as string with a dual meaning,
either an inline mini-notation pattern when cyclePatternLocation
is Here or a function name in the Code tab when Code Tab. The
single-field design follows the state file's explicit field
list and keeps the data model compact. The loader's function
ref resolution will need a small follow-up to handle the Code
Tab case, but that does not have to land in this commit because
cyclePattern is not typed functionRef.

No UI churn in this commit. inspector.js and sceneEditor.js
will reference removed fields after this lands, which is
expected. Stage 2 rebuilds Band 3 against the new schema and
removes the existing Bands 3 through 6 as part of the same
sweep. Stage 1 is just clearing the ground.
