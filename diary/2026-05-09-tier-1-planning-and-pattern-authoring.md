# 2026-05-09 — Tier 1 implementation and inspector layout design

## Summary

Second working day on GXW. Resolved items 2 through 6 of the
section 27 pre-implementation design tasks, landed Tier 1 of the
implementation, and worked through the property inspector's
band layout for the strudel integration. The day produced four
commits: items 2 through 6 resolved as one consolidated commit,
the strudel separability spike committed (its result was
verified the morning before), the Tier 1 implementation
including a Load Engine button in the transport bar, and a
section 27 follow-up capturing the design refinements that
landed during conversation. The inspector layout work concludes
with another section 27 update capturing the band structure
and the beatsPerCycle simplification.

## Items 2 through 6 of the pre-implementation design tasks

The morning began with the spike from the previous day's work
running successfully (parser, Pattern abstraction, and superdough
audio output all worked when driven manually with no cyclist),
and walked through items 2 through 6 with proposals on the table
and either ratified or adjusted. Item 2 (Pass 2 edge cases)
settled on trusting Pass 1's structure absolutely and using
Pass 2 only to refresh value fields. Item 3 (cancellation at
edit boundary) settled provisionally on always-cancel rather
than the originally-proposed hybrid, with the note that the
right answer needs real-world testing. Item 4 (cycle counter
persistence across edits) settled provisionally on
continue-on-edit, with an explicit reset gesture available.
Item 5 (wall-clock vs simulation time) settled on a hybrid
driven by the simulation tick: queryArc at cycle start to
produce the event list, then per-tick commits in a small
forward audio window. The framing was tightened after noticing
that per-source cycle durations can vary widely and pre-
scheduling whole cycles to Web Audio breaks responsive
simulation-pause behaviour. Item 6 (strudel global-state setup)
settled on a proactive defensive init in Tier 1's StrudelRuntime
stub.

## The cycles-based detour and revert

The afternoon's planning began with a discussion of unit
conversion at the strudel boundary, since GXW's transport uses
BPM and strudel's internals use cycles per second. The natural
question was whether to keep BPM and convert at the boundary,
or pivot to GXSTR's cycles-based transport model that already
aligns with strudel's units. The initial direction was to
pivot, on the grounds that GXSTR had already worked through
the design and we could adopt a known-good shape rather than
designing from scratch.

Reading GXSTR's section 7 and section 27 was instructive. GXSTR
drops BPM entirely, holds globalCPS as the transport state, and
uses per-sprite cycleDuration as a ratio against the global
rate. Below 1.0 cycleDuration values use pattern.compress(0,
cycleDuration), packing the pattern into the first fractional
portion of the global cycle and resting for the remainder. The
.compress branch turned out to be the wrong design for our use
case. The musical interpretation of cycleDuration of 0.5 in
most musicians' mental models is twice as fast, repeating
without silence, not occupies the first half and is silent for
the rest. GXSTR's design was carefully thought through but
encoded a non-obvious choice that almost certainly should have
been .fast under the hood instead of .compress. This came out
only because the surface description prompted a question.

That led to the more important design clarification. GXW's
per-source cycle duration should mean exactly the wall-clock
window in which the source's pattern plays one full pass. The
pattern stretches or compresses to fit, never with rests, never
truncated. The source effectively runs its own local clock at
a rate forced by fitting the pattern into the duration. There
is no .compress, no .fast, no .slow strudel modifier in the
runtime path: GXW's runtime computes event times directly as
cycleStartTime plus e_t multiplied by the source's wall-clock
cycle duration. The math is one line and the strudel modifier
surface is not involved at all. As a side benefit, GXSTR's
setcps reachability headache simply does not apply because
GXW never drives strudel's scheduler.

After the clarification, the conversation revisited whether
the transport should be in cycles or BPM. The answer was BPM,
on the grounds that musicians find BPM intuitive. Section 27's
Tempo and Scaling subsection already described this model and
needed no change. The transport bar stays unchanged.

## Tier 1 implementation

Tier 1 of the implementation landed: import map for @strudel/web
in index.html, a new src/strudel/runtime.js with a StrudelRuntime
class, an audioContext getter and ensureAudioContext method on
Transport for context sharing, a Load Engine button at the
leftmost position of the transport bar wired to the runtime,
small wiring in main.js to instantiate the runtime, and CSS
styling for the four button states (orange idle, brown loading,
green loaded, red failed).

Two iterations during testing. The first was a duplicate-core
warning: the runtime imported @strudel/webaudio separately to
call setAudioContext, but with @strudel/web already loaded,
the umbrella plus a separate webaudio import pulled two copies
of @strudel/core. The fix was to use setAudioContext from the
umbrella's exports rather than the separate webaudio import,
which is exactly the lesson GXSTR's section 27 documented. The
second was the piano sample bank failing with a 404. The
github prefix in samples('github:felixroos/dough-samples/main/
piano.json') resolves by appending /strudel.json, treating
piano.json as a directory. The fix was a direct
raw.githubusercontent URL because the dough-samples repo has
individual instrument JSON files at the root rather than a
manifest.

After both fixes the engine loads cleanly with no warnings or
errors, the four button states render distinctly, the BPM-to-
window.cps subscription updates correctly when the BPM field
is edited, and the spike page continues to work unchanged.
The runtime is exposed on window.strudelRuntime for console
inspection during development.

## Inspector layout design

The evening turned to the property inspector. The aim was to
make GXW's per-source authoring surface match GXSTR's callback-
slot model, with adaptations for the inline-strudel-expression
mode the earlier design conversation had introduced.

Three structural decisions came out of the conversation.

First, every source carries four callback slots: cycle, hasHit,
beenHit, onTick. The slots replace the existing message-functions
band and auto-message-interval band entirely. The auto-message-
interval mechanism is eliminated; autonomous output comes from
the cycle slot. Each slot has a gate checkbox (Can Cycle, Can
Hit, Can Be Hit, Can Tick) so a composer can suspend a slot's
behaviour without clearing the binding.

Second, the inspector restructures into four bands instead of
six. Band 1 (Identity) and Band 2 (Geometry and visual) are
unchanged. Band 3 is the new callback-slots band, with five
rows: cycle slot first, then a row holding beatsPerCycle and
the Code Location radio, then hasHit, beenHit, onTick. Band 4
is the new code-editor band, holding a single CodeMirror
instance for the cycle pattern. The earlier separate cycle-
parameters band is gone; cycleDuration and stopAtCycle of v2.4
are not part of the new model.

Third, cycle duration is specified by a single beatsPerCycle
field (positive number, default four) measured in master beats,
where the master beat is implicitly a quarter note. The earlier
two-field idea of beatInterval times beatsPerCycle was
considered and dropped: a single field plus mini-notation
modifiers (.fast, .slow, .every) gives full expressive power,
and the inspector stays simpler. Cycle duration in seconds is
beatsPerCycle times sixty divided by master BPM. A composer
who wants finer time divisions inside the cycle uses mini-
notation; the inspector control is just the cycle length.

Smaller refinements that fell out of the discussion. The cycle
slot's function-name field in Band 3 row 1 is auto-populated
with the convention name and read-only when Code Location is
Here, editable when Code Location is Code Tab. Toggling Code
Location moves the code between the two locations as a single
source of truth, with a confirmation warning at the toggle if
the destination already has differing content. Renames of the
source automatically update slot references following the
convention; renaming the function in the Code tab away from the
convention detaches it and surfaces a soft warning. Validation
errors surface in both the inspector (short status indicator
plus message) and the console (full diagnostic with source and
slot identification), parallel to GXW's existing soft-error
patterns.

## Open items and next session

The next concrete step is Tier 2: the pattern evaluation
primitive that consumes a parsed Pattern, calls queryArc, and
commits scheduled events through superdough using the
simulation-tick-driven commit window. Static signals work end
to end at the end of Tier 2; dynamic signals come in Tier 4.

Section 27 has been updated to capture today's design
refinements. The state file orientation reflects Tier 1 having
landed and the inspector design being committed. The DESIGN.md
project-description paragraph rewrite informed by section 27
remains on the open list, as does the pass through sections 1
to 26 reconciling them with the section 27 framing.
