# 2026-05-09 — Tier 3 Stage 3: master clock and per-cycle home snap

Stage 3 lands the master-clock formula in the simulation
and gives every source kind a per-cycle home return.
Cursors run again — they had been stuck since Stage 1
silently broke the cursor advance path by stripping
curve.cycleDuration and curve.cycleSpeeds from the
schema while the simulation still read them.

Master clock. The wall-clock cycle duration in seconds is
beatsPerCycle * 60 / BPM. Each source computes its own
cycle duration from its own beatsPerCycle and the
transport's master BPM, so different sources can run at
different cycle rates simultaneously. The new
cycleDurationSeconds helper is the single place this
formula lives; everywhere else just calls it.

Cycle phase. Per-source state holds cycleProgress (a
0-to-1 accumulator) and cycleCount. Phase advances
unconditionally — regardless of canCycle — at rate
dt/cycleDuration each tick. When cycleProgress crosses 1,
the cycle completes, the count increments, and the small
overshoot carries into the next cycle so wall-clock
timing stays accurate across boundaries.

Per-cycle home snap. On cycle wrap, every source returns
to its home position. Curves: cursor t snaps back to 0,
the curve's home parameter (first endpoint for line and
piste, theta = 0 / 3 o'clock for ellipse). Sprites:
live x, y, vx, vy snap back to the authored values, the
same fields _rewind() resets, so a moving sprite returns
to its starting position with its initial motion intact
and traces the same trajectory once per cycle. Triggers:
no position to snap (the schema has no velocity field
for triggers), but the cycle counter still advances so
the timing is in place for future pattern firing.

State plumbing. New TriggerRuntimeState class with
cycleProgress and cycleCount. SpriteRuntimeState gains
the same two fields alongside the existing position,
velocity, and authored-tracking fields. CurveRuntimeState
keeps t, cycleProgress, cycleCount, halted; nothing
removed from it but the logic that used the now-stripped
cycleSpeeds is gone. The Simulation gains a
_triggerState Map; setScene reconciles it by id alongside
the curve and sprite maps; _rewind resets it alongside
the others.

Stop-at-cycle. Curves still carry stopAtCycle and the
simulation respects it: when cycleCount reaches
stopAtCycle, halted is set and the cursor stops
advancing. Sprites and triggers don't carry stopAtCycle
at this milestone, so they cycle indefinitely until
rewound.

cycleSpeeds removal. The pre-section-27 cycleSpeeds field
was the per-cycle multiplier mechanism (forward, reverse,
freeze) for cursor motion. Section 27 replaces this with
mini-notation modifiers (.fast, .slow, .rev) at the
pattern layer, so cycleSpeeds is gone from the schema
and the simulation runs all cursors at multiplier 1 —
forward, uniform pacing. The parseCycleSpeeds helper
that mapped a multiplier-string-and-cycle-count to a
multiplier value is removed; nothing else used it.

Debug logging. A LOG_CYCLE_WRAPS const at the top of
simulation.js gates a console.log line on every cycle
wrap, carrying the source kind, id, name, and new
counter. Default off so the console stays clean for the
composer; flip to true while diagnosing per-source
timing.

What this does NOT do. Pattern firing is not wired —
canCycle gates nothing yet, the cyclePattern field
isn't read by the simulation, and behaviors.js
functions named in the slot fields aren't called. Those
are later stages. The hasHit, beenHit, and onTick slots
are likewise inert; their cycle counters advance but no
collision detection or per-tick callback is dispatched.
The Code Location radio in the inspector's Band 4 stub
remains inactive. validateFunctionName for the function-
name fields is still deferred.

Verification path. Open a score with cycling sources and
press Run Scene. Curves' cursors should now visibly trace
their geometry and snap back to home each cycle. Sprites
with non-zero velocity should bounce around the canvas
during their cycle and snap back to their starting
position when the cycle completes. Adjusting beatsPerCycle
in the inspector should change the wall-clock cycle
duration on the next reload. Adjusting BPM in the
toolbar likewise rescales every active cycle's wall-clock
duration on the next reload. With LOG_CYCLE_WRAPS flipped
on, the console gets one line per wrap.

Files. simulation.js fully rewritten; the doc header,
the runtime-state classes, _rewind, _step, _stepCurve,
and _stepSprites all changed. New _stepTrigger method
and TriggerRuntimeState class. Helpers cycleDurationSeconds
and logCycleWrap added; parseCycleSpeeds removed. No
changes to scene.js, sceneSchema.js, or any of the
inspector/main/sceneEditor surfaces from Stages 1 / 2A /
2B.
