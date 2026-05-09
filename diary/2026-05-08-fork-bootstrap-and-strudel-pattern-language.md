# 2026-05-08 — Fork bootstrap and strudel-as-pattern-language design

## Summary

First working day on the new GXW project. Forked the previous GXW
codebase into two independent repositories: the existing repo, which
was pursuing the strudel-master-clock direction, was renamed to GXSTR,
and a fresh GXW project began from the same foundation commit to
pursue a different direction. The bulk of the day went into the
design discussion that produced section 27 of DESIGN.md, which
captures the new architectural intent: GXW absorbs strudel's
pattern-language layer and audio output but keeps its own simulation
as the master clock. No code was written. Section 27 plus this diary
entry plus a small DESIGN.md table-of-contents update are the
artefacts of the day.

## Why a fork rather than a pivot

The previous GXW codebase had run two extended attempts to reconcile
strudel's master cycle with GXW's free-running, physics-driven event
model. The mismatch turned out to be architectural rather than a
tuning problem. Strudel's cyclist wants to be the source of truth for
all timing of everything plugged into it. GXW's simulation runs on
its own clock, with each curve cycling at its own rate, sprites
moving under physics, and triggers firing whenever a sprite happens
into one. Trying to keep strudel's master cycle aligned with GXW's
per-object timing meant undoing the part of strudel that makes it
useful as a scheduler. Trying to let strudel drive meant collapsing
GXW's free-running model into something that did not fit its
visual-and-physics-driven character.

The strudel-master-clock direction is still worth pursuing on its own
terms. The fork preserves that work in GXSTR and frees the new GXW
project to take a different path without tying its progress to a
direction the codebase has been resisting. The two projects share git
history up through bf4f6c9, the pre-fork foundation commit, but are
now independent repositories with no shared remote and no expectation
of merging. References in this project's git history to GXW before
the rename refer to the same codebase that is now in GXSTR.

The fork itself was structural: rename the existing local checkout to
GXSTR, push it as a new remote, clone GXW fresh from the foundation
commit. Both projects keep AGPL-3.0 and the LICENSE file. The
section-27 slot in DESIGN.md was emptied during the cleanup commit so
the new project could fill it with the new direction's intent rather
than carrying forward the earlier section's content.

## The architectural insight

The design discussion turned on noticing that strudel is really three
separable layers stacked together. The mini-notation parser plus
modifier algebra is the language layer. The Pattern abstraction is a
pure data structure, a function from a time range to a list of Haps.
The cyclist plus superdough audio engine is the runtime layer. The
strudel package bundles them together, but they are cleanly
separable. The cyclist is what was creating the clock conflict; the
language layer and the Pattern abstraction were doing nothing wrong.

Once that separation is visible, the new shape suggests itself. GXW
absorbs the language layer and the Pattern abstraction in full, uses
superdough as a black-box audio renderer, and replaces the cyclist
with its own simulation-driven scheduling. The Pattern type does not
know or care whether strudel's cyclist is driving it or GXW is. The
Pattern.queryArc method takes a cycle range and returns events;
whoever calls it does not need to be the cyclist. Mini-notation
strings, the modifier algebra, and superdough audio output all become
first-class GXW concepts. The cyclist initialises for audio context
setup and sample bank loading and then sits idle for the lifetime of
the app.

The phrasing that emerged and stuck is GXW owns the WHEN, strudel
owns the WHAT. The temporal structure of the music is determined by
GXW's simulation. The musical content of each firing is expressed in
strudel's vocabulary. That layering captures the integration cleanly
in one sentence and survives further interrogation.

## Pattern evaluation and the two-pass technique

The pattern-evaluation primitive is a function that takes a parsed
Pattern, a cycle range, a wall-clock window, and a firing source
identifier, and produces scheduled superdough events. When GXW's
simulation produces a firing event for source X at simulation time
T_cycle, the layer looks up the source's parsed Pattern (cached at
edit-commit time and re-parsed when the user commits a pattern edit),
calls Pattern.queryArc(n, n+1) where n is the source's per-source
cycle counter, and receives a list of Haps. For each Hap, GXW
computes a wall-clock event time from T_cycle plus the Hap's
fractional cycle position times the cycle period. Each event is
scheduled via superdough with its computed time and value.

The two-pass evaluation is what makes dynamic signals work cleanly.
Pass 1 happens at cycle start: query the pattern over [n, n+1) to
determine event TIMES from the pattern's structure. Pass 2 happens at
near-play time, just before each event's actual play moment: set a
firing-context pointer to (source X, T_event) inside a try-finally,
re-query the pattern with a tiny window around just this event,
receive a Hap whose dynamic-signal values reflect simulation state at
near-play time, call superdough, clear the pointer.

The mechanism for dynamic state lookup is the firing-context pointer.
Dynamic signals like spriteV, spriteX, imageColor are Patterns whose
queryArc function happens to read external state during the call.
Strudel's Pattern type is general enough to express them naturally; a
Pattern is just a function from a time range to a list of Haps and
nothing about that function needs to be pure. When a dynamic signal's
query function runs, it consults the firing-context pointer to learn
which source to read state from, then reads from the live simulation.
The Pattern composition machinery does not know or care that the
value came from simulation state versus a sine function.

The unavoidable residual is the audio scheduler's lookahead. Web
Audio needs roughly a hundred milliseconds of forward scheduling to
avoid glitches, so dynamic signals are sampled about that far in
advance of audio output rather than at the exact instant of audio
output. For a wandering sprite that is a small fraction of a beat's
worth of motion, far smaller than the per-cycle sampling delay would
be without the two-pass approach. The lookahead is a Web Audio fact,
not a strudel fact, and the two-pass architecture pushes the residual
to its theoretical floor.

## Modifier vocabulary: curate at the surface, not in the library

A real question in the design discussion was whether to import the
full @strudel/web library or fork strudel and ship a curated subset.
The full-library path won. Three reasons. The parser is substantial
code that does not benefit from being reimplemented. Modifier
definitions are intertwined with Pattern internals, and pulling out a
clean subset is harder than it sounds. And shipping a custom subset
gives up the benefit of strudel as a known quantity that other people
have documentation and tutorials for.

Instead, GXW imports the full library and curates at the
documentation and inspector layer. The promised vocabulary is
within-cycle modifiers (subdivision, repetition, parallel, weighted
slots, rest, .fast, .rev, .struct, .jux, .layer, and the
sound-selection and parameter setters), plus cross-cycle modifiers
when the firing source is continuous (alternation, .every, .iter for
curves whose cursors loop forever).

Cross-cycle modifiers behave problematically when the firing source
is one-shot. Under .slow(N) only one Nth of the events fire because
the pattern is stretched across cycles the one-shot never sees.
Under .late(N) and .early(N), events shift into adjacent cycles where
the one-shot does not query and silently disappear. The inspector
flags these patterns with a soft validation warning when the source's
firing model is one-shot, matching the existing yellow-squiggle
pattern for things like duplicate names. Hard rejection is reserved
for parse failures. A user who understands the implications can
commit a warned pattern; the parse and evaluation are correct, just
the typical intent does not match the result.

## Tempo split

Tempo separates into two concepts cleanly. Master BPM and per-source
cycleBeats together determine the wall-clock period of each source's
cycle. The mini-notation pattern determines the within-cycle event
density. Either can change without affecting the other. At master
120 BPM, a curve with cycleBeats=4 has a 2-second cycle period.
Pattern bd*4 fires four events at the natural 120 BPM rate. Pattern
bd*8 fires eight events at a 240 BPM rate within an unchanged cycle.
A BPM change rescales every active cycle's wall-clock duration on
the next cycle wrap. A pattern edit changes what plays within an
unchanged duration. No global re-scheduling.

This is the way a composer naturally thinks about rhythm density and
master tempo: as independent dimensions. The split falls out of
keeping GXW's existing cycleBeats and cycleDuration semantics intact
and letting the pattern carry the within-cycle structure on top.

## Inspector integration

The pattern integration adds a fourth option to the existing
beat-points-mode dropdown in band 5 of the inspector, alongside
Normal, Euclidean, and None. When a source's mode is Strudel, the
activeBeats and strength fields are replaced by a single
mini-notation pattern field. The Cycle Parameters in band 6
(cycleBeats, cycleDuration, stopAtCycle) stay in play unchanged
because they govern the wall-clock period, which strudel mode still
depends on. Other inspector bands are unaffected; strudel mode is
purely a richer alternative for the rhythm definition.

The pattern field will use the same contenteditable widget pattern as
other text fields, with parsing-as-you-type so syntax errors surface
immediately, and validation at commit time producing hard or soft
errors as described above.

## Continuous and one-shot firing

The same pattern-evaluation primitive serves both firing models. The
difference is at the call site. Continuous firing applies to sources
whose cycles repeat naturally; GXW calls the primitive with
sequential cycle counters on each cycle wrap and the per-source
counter advances cross-cycle modifiers properly. One-shot firing
applies to events that do not naturally repeat (trigger collisions,
sprite-hit-trigger events). For these, GXW calls the primitive once
with cycle counter zero and a user-chosen flourish duration that
maps the pattern's cycle range onto a wall-clock window. The
flourish duration is a per-source field defaulting to one beat at
master BPM. Both invocation patterns flow through the same machinery.

## Visualisation options considered, none chosen

The existing beat-point glyphs on curves assume evenly-spaced active
beats and do not extend cleanly to arbitrary mini-notation. Two
options are on the table. Static glyphs at edit time would query the
pattern for one cycle when the user commits an edit and place visual
markers at the resulting fractional positions; clean for
deterministic patterns, breaks down for stochastic ones. After-the-
fact breadcrumbs would drop a fading marker at each event's actual
played position, leaving a visible trail; works for any pattern but
does not pre-show where the next firing will be. A hybrid of static
glyphs for deterministic patterns and breadcrumbs for stochastic ones
is plausible. Resolution deferred until the rest of the integration
is implemented and the visual surface gets focused attention.

## Project bookkeeping

The diary practice itself was set up today. Daily files in a folder
called diary at the repo root, peer to design and src, capture
richer-than-git progress notes. The format follows
strudel-repl-fork's local-notes/diary/ as a prose-narrative example
rather than a dashboard. Tracked in git for cross-machine
persistence and historical depth. The handoff template
(~/Documents/gxw-handoff.md) describes the practice; the state file
(~/Documents/gxw-session-state.md) is the dashboard; this diary is
the narrative. State file no longer keeps a per-commit activity log;
recent git commits cover that role.

## Open questions left for tomorrow

Tonal integration. Strudel ships @strudel/tonal, providing harmony
operators (scale, voicing, transpose). Whether GXW imports it is
open. Image-driven patterns are a natural fit for harmony-aware
modifiers but the dependency surface grows. Defer until a real use
case demands it.

Per-source flourish duration default. One beat at master BPM is a
starting guess. Might want to be a per-pattern setting, or different
defaults per source kind. Real use will tell us.

Edit-time pattern preview. The user types a pattern and probably
wants to hear it before the next firing. A preview affordance is a
one-shot invocation of the same primitive, triggered by a button or
keyboard shortcut. Inherits the user-gesture-for-AudioContext
requirement so a first preview can also be the engine-load gesture.

The DESIGN.md project-description paragraph still uses pre-section-27
vocabulary because the cleanup commit only touched the table of
contents and the lead paragraph that named section 27 as
authoritative. Some of that vocabulary is now apt again under the
new direction, but a fresh rewrite informed by section 27 is on the
list, separate from the original cleanup intent.

A pass through sections 1 to 26 with the section 27 framing in mind,
identifying which parts now fit naturally and which need revision.

Whether to keep the original GXW project's TODO.md or restart it.
The current TODO.md was authored under the master-cycle direction;
some entries may transfer, some may not.

## What is next

Tier 1 of the implementation plan when code work begins: import map
for @strudel/web and tonal, LICENSE update if needed, basic
StrudelRuntime stub that initialises the audio context and loads
sample banks but does not yet drive output. After Tier 1, the
pattern evaluation primitive in Tier 2 with static signals working
end-to-end. Section 27's final subsection has the full six-tier
order; the state file recaps it for at-a-glance reference.

Whether to start Tier 1 in the next session or do another design
pass first is a Chris call.
