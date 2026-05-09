# Section 27 — Strudel as Pattern Language

Status: design intent for upcoming work. Captures the architectural decisions reached during the 2026-05-08 design session that established the new GXW project's direction. Not yet implemented; subsequent commits will land the integration in tiers.

## Background and motivation

The earlier GXW codebase, now forked off as the GXSTR sibling project, integrated strudel as both pattern engine and audio engine, with strudel's bundled cyclist scheduler driving timing. Two extended attempts to reconcile that integration with GXW's free-running, physics-driven, cursor-and-trigger-fired event model surfaced a real architectural mismatch. Strudel's master cycle fundamentally wants to be the source of truth for everything plugged into it. GXW's clock is the simulation, with each curve running its own cycle at its own rate, sprites moving under physics, and triggers firing whenever a sprite happens into one. Trying to keep strudel's master cycle synchronised with GXW's per-object timing meant undoing the part of strudel that makes it useful as a scheduler; trying to let strudel drive meant collapsing GXW's free-running model into a master-cycle model that didn't fit its visual-and-physics-driven character. The two clocks were always going to chafe.

The shape described here is the alternative. GXW absorbs strudel's pattern-language layer and audio output without taking on its scheduler. GXW's simulation continues to be the master clock. Mini-notation strings, the Pattern abstraction, and modifier algebra all become first-class GXW concepts; superdough provides the audio rendering; the strudel cyclist is initialised for audio-context setup and sample-bank loading and then sits idle for the lifetime of the app.

## The architectural split

GXW owns the WHEN. Strudel owns the WHAT. That phrasing captures the layering precisely. The WHEN is the temporal structure: when a curve's cycle starts and ends, when its cursor crosses an active beat point, when a sprite collides with a trigger, when a free sprite's cycle wraps around. All of that is GXW's existing simulation, unchanged. The WHAT is the musical content of each firing: which sounds play, in what subdivisions, with what modulations. Mini-notation expresses that compactly, modifiers transform it, signals make it responsive to scene state.

The strudel library is really three separable layers stacked together: the mini-notation parser plus modifier algebra (the language layer), the Pattern abstraction itself (a pure data thing — a function from a time range to a list of Haps), and the cyclist plus superdough audio engine (the runtime layer). The library bundles them as a package, but they're cleanly separable. GXW absorbs the first two layers fully, replaces the cyclist with its own simulation-driven scheduling, and uses superdough as a black-box audio renderer driven by GXW's own scheduling rules. The Pattern type doesn't know or care that strudel's cyclist isn't running. queryArc is just a function — give it a cycle range, get back events. Whether a master clock is calling that function once per audio frame or GXW is calling it once when a curve's beat fires, the Pattern doesn't care.

## Pattern evaluation flow

When GXW's simulation produces a firing event for source X at simulation time T_cycle, the pattern-evaluation layer looks up the source's parsed Pattern (cached at edit-commit time and re-parsed when the user commits a pattern edit), calls pattern.queryArc(n, n+1) where n is the source's current per-source cycle counter, and receives a list of Haps. For each Hap, GXW computes a wall-clock event time T_event = T_cycle + e_t × cycle_duration, where e_t is the Hap's fractional position within [0, 1) and cycle_duration is the source's current wall-clock cycle period derived from master BPM and the source's cycleBeats. A callback is scheduled at T_event minus the audio scheduler's lookahead (Web Audio's recommended ~100ms forward window). The source's cycle counter increments, so n+1 becomes n on the next firing — this lets cross-cycle modifiers like alternation advance correctly.

Each callback, when it fires just before the audio's actual play time, sets a module-level firing-context pointer to (source X, T_event), re-queries the pattern with a tiny window around e_t for just this event, receives a Hap whose dynamic-signal values reflect simulation state at near-play time, calls superdough.play(T_event, hap.value) to render the audio, and clears the firing-context pointer.

The two-pass evaluation is the key technique. Pass 1, at cycle start, determines event TIMES from the pattern's structure. Pass 2, at near-play time, determines event VALUES with the firing context active. Static signals like sine return identical values in both passes since they depend only on cycle position. Dynamic signals like spriteV, spriteX, imageColor return different values in pass 2 because simulation state has advanced and the firing context lets them read current state. The per-event re-query cost is small — each is a tiny pattern evaluation against a sub-cycle window — and pays for accuracy: dynamic signals reflect simulation state at the event's actual play time, not at cycle-start time. For a wandering sprite firing image-color events at multiple positions in a cycle, each event reads the pixel under the sprite at the moment that event plays, give or take the audio lookahead window of about 100ms.

The unavoidable residual is the audio lookahead itself. Web Audio needs roughly 100ms of forward scheduling to avoid glitches, so dynamic signals are sampled 100ms before audio output rather than at the exact instant of audio output. For a wandering sprite that's a small fraction of a beat's worth of motion, far smaller than the per-cycle sampling delay would be. It's a Web Audio fact, not a strudel fact, and the two-pass architecture pushes it to its theoretical floor.

## Curated modifier vocabulary

GXW imports the full @strudel/web library and uses the parser, Pattern type, and modifier algebra as-is. The Pattern abstraction is general enough that modifiers compose normally; queryArc returns coherent results regardless of which modifiers a user composes into a pattern. What GXW promises and documents is a curated subset of modifiers known to behave intuitively under the per-source-cycle clock model. Other modifiers remain accessible for users who reach for them, and the inspector surfaces a soft warning when a modifier is used outside its promised context.

The within-cycle modifiers all work cleanly and are promoted as core vocabulary. Subdivision `[a b]`, repetition `a*4`, parallel `a,b`, weighted slots `a@2 b`, rest `~`, the `.fast(N)` modifier (which divides cycle time so more events fit), `.rev` (within-cycle reverse), `.struct(...)`, `.jux(fn)`, `.layer(...)`, and all the sound-selection and parameter setters — `.s`, `.n`, `.note`, `.gain`, `.pan`, `.lpf`, and friends. These produce events whose times and values are determined entirely within one cycle, so they need no continuous master-clock context to behave as the user expects.

Cross-cycle modifiers work fine when the firing source is continuous. A curve whose cursor loops forever has its cycle counter advance naturally on each wrap, so alternation `<a b c>` rotates through values across firings, `.every(4, fn)` applies a transformation every fourth firing, and `.iter(N)` rotates subdivisions across cycles. These are part of the promoted vocabulary for continuous sources.

Cross-cycle modifiers are problematic when the firing source is one-shot. A trigger collision or a sprite-hit-trigger event fires sporadically with no inherent next cycle. Under `.slow(N)`, only one Nth of the events fire per firing because the pattern is stretched across multiple cycles that the one-shot never sees. `.late(N)` and `.early(N)` shift events into adjacent cycles where the one-shot doesn't query, so events silently disappear. The inspector flags these patterns with a soft validation warning (yellow squiggle, matching the existing soft-error pattern for things like duplicate names) when the source's firing model is one-shot, but doesn't hard-reject them. A user who understands the implications can commit a warned pattern; the parse and evaluation are correct, just the typical intent doesn't match the result.

The decision is to use the full library and curate at the documentation and inspector-warning layer rather than fork strudel and ship a custom subset. The parser is substantial code, modifier definitions are intertwined with Pattern internals, and pulling out a curated subset cleanly is harder than it sounds. We'd be taking on a maintenance burden for no gain, and we'd lose the benefit of strudel as a known quantity that other people understand and have documentation for. Curation at the surface is the right shape.

## Static and dynamic signals

Strudel's built-in signals (sine, saw, square, tri, perlin) are pure mathematical functions of cycle position. They work identically under GXW's clock as under strudel's master cycle: queryArc samples them at each event's fractional position, and the value depends only on that position, not on wall-clock time. No modification needed; they integrate as-is.

Dynamic signals — spriteV, spriteX, imageLightness, imageColor, currentScale, and the rest — are GXW's contribution to the signal vocabulary. They aren't extensions to strudel; they're new Patterns whose query function happens to read external state during the call. Strudel's Pattern type is general enough to express them naturally — a Pattern is just a function from a time range to a list of Haps, and nothing about that function needs to be pure. Anything that implements the queryArc shape composes with mini-notation and modifiers identically to a built-in signal because it looks identical to the rest of the system.

The mechanism for dynamic state lookup is the firing-context pointer described above. When GXW fires a source's pattern at simulation time T, it sets a module-level pointer to (source X, T) inside a try-finally block (so any exception during query doesn't strand the pointer), calls queryArc, and clears the pointer. Within the queryArc call, dynamic signals consult the pointer to learn which source to read state from, then read it from the live simulation. The Pattern composition machinery doesn't know or care that the value came from simulation state versus a sine function. Two-pass evaluation ensures dynamic signals are evaluated at near-play time, not at cycle-start time, so a wandering sprite's fast position changes within a cycle reach the audio output correctly.

## Tempo and scaling

The tempo model separates two concepts cleanly. Master BPM and per-source cycleBeats together determine the WALL-CLOCK PERIOD of each source's cycle. The mini-notation pattern determines the WITHIN-CYCLE EVENT DENSITY. Either can change without affecting the other.

At master 120 BPM, a curve with cycleBeats=4 has a cycle period of 2 seconds. With pattern `bd*4`, four events spread evenly across that 2-second window — events fire at the natural 120 BPM rate. With pattern `bd*8`, eight events in the same 2-second window — events fire at a 240 BPM rate within an unchanged cycle. With pattern `bd*2`, two events at 60 BPM rate. The user authors rhythm density and master tempo independently, the way a composer thinks about them.

A BPM change rescales every active cycle's wall-clock duration on the next cycle wrap, the same way the existing simulation already rescales cursor advance rates. A pattern edit changes what plays within the unchanged duration. No global re-scheduling, no glitches at the boundary, just per-cycle adaptation that flows through the existing simulation tick loop.

## Inspector integration

The strudel pattern integration adds a fourth option to the existing beat-points-mode dropdown in Band 5 (the rhythm-defining row of the inspector). The current options are Normal, Euclidean, and None. The fourth is Strudel.

When a source's beat-points mode is Strudel, the activeBeats and strength fields are replaced by a single mini-notation pattern field. The pattern is validated to parse on every commit, with hard rejection only for parse failures and soft warnings for modifier usage that's known not to fit the source's firing model. The Cycle Parameters row in Band 6 (cycleBeats, cycleDuration, stopAtCycle) stays in play unchanged — those govern the cycle's wall-clock period, which strudel mode still depends on.

Other inspector bands are unaffected. Band 1 (identity), Band 2 (geometry and visual), Band 3 (message functions), and Band 4 (auto-message-interval) work the same way regardless of beat-points mode. Strudel mode is purely a richer alternative for the rhythm definition; it doesn't displace any other inspector machinery.

The pattern field uses the same contenteditable widget pattern as other text fields in the inspector, with parsing-as-you-type so syntax errors surface immediately. Validation runs at commit time and produces hard or soft errors depending on whether the parse fails outright or whether the parse succeeds but the modifier vocabulary doesn't fit the source's firing model.

## Continuous and one-shot firing

The same pattern-evaluation primitive serves both continuous and one-shot firing patterns, with different invocation behaviour at the call site.

Continuous firing applies to sources whose cycles repeat naturally. A curve whose cursor loops the curve, a free sprite with a cycle binding, anything where the simulation produces a regular sequence of cycle starts. For these, GXW calls the pattern primitive with sequential cycle counters (0, 1, 2, ...) on each cycle wrap, and the per-source cycle counter naturally advances cross-cycle modifiers like alternation.

One-shot firing applies to events that don't naturally repeat. A trigger collision, a sprite-hit-trigger event, anything where the user wants a flourish of music to play once at a moment in time. For these, GXW calls the primitive once with cycle counter zero and a user-chosen flourish duration mapping the pattern's [0, 1) cycle range onto a wall-clock window. The flourish duration is a per-source field defaulting to one beat at the master BPM, with override available per-source.

Both invocation patterns flow through the same queryArc-then-schedule-events machinery. The difference is just how often the primitive is called and what cycle counter is supplied. A trigger collision firing one-shot might still use rich within-cycle mini-notation (subdivisions, parallel layers, parameter modulation) — the pattern just doesn't get cross-cycle modifier behaviour.

## Visualisation

The existing beat-point glyphs on curves assume evenly-spaced active beats and don't extend cleanly to arbitrary mini-notation patterns. Two options for strudel mode visualisation are under consideration; neither is chosen yet.

Static glyphs at edit time would query the pattern for one cycle when the user commits a pattern edit and place visual markers on the curve at the resulting fractional positions. Works cleanly for deterministic patterns; breaks down for stochastic ones (like patterns using degradeBy or randomly-sampled choice operators) where each cycle's events differ.

After-the-fact breadcrumbs would drop a fading marker at each event's actual played position when the audio plays, leaving a visible trail of recent events. Works for any pattern. Doesn't pre-show where the next firing will be, but for a music tool where the user is composing in real time and listening, the retrospective view is often the more useful one anyway.

A hybrid is plausible — static glyphs at edit time for deterministic patterns, after-the-fact breadcrumbs for stochastic ones, with detection of which mode applies happening at parse time. Resolution deferred until the rest of the integration is implemented and the visual surface gets focused attention.

## Open questions and future considerations

Tonal integration. Strudel ships with @strudel/tonal, providing harmony operators (scale, voicing, transpose) that sit naturally alongside mini-notation. Whether GXW imports tonal is open. The argument for is that harmony-aware patterns are a natural fit for an image-driven music model. The argument against is that the dependency surface grows and tonal hasn't surfaced as a need in concrete use cases yet. Defer until a real use case demands it.

Per-source flourish duration default. The default of "one beat at master BPM" for one-shot patterns is a starting guess. It might want to be a per-pattern setting (specified in the scene data rather than per-source), or different defaults per source kind (triggers versus sprite-hit events versus auto-fire intervals). Real use will tell us which shape feels right.

Concurrent firings. Two sources firing patterns at the same simulation tick is fine in principle — each callback runs synchronously with its own firing-context-set / queryArc / clear / superdough.play sequence — but per-source cycle counter management when many sources fire concurrently has implications for cross-cycle modifier behaviour that haven't been thought through end-to-end. Likely fine in practice; worth confirming when the implementation lands.

Mute and solo. GXSTR has Solo Selected as a runtime-only state and per-source mute as a persisted state. Both should carry over to GXW's pattern integration; the pattern-evaluation layer respects mute and solo by skipping queryArc entirely when the source is silenced. Implementation is straightforward but worth calling out.

Edit-time pattern preview. The user types a pattern in the inspector field and probably wants to hear it before the next firing in the simulation. A "preview pattern" affordance — play this pattern once with a small flourish window, right now — is a natural extension. Implementation is a one-shot invocation of the same primitive, triggered by a button or keyboard shortcut on the field. Inherits the user-gesture-for-AudioContext requirement, so a first preview also serves as the engine-load gesture.

Recording and replay. If a session is recorded for later playback, the pattern evaluations need to be deterministic. Static patterns are deterministic; dynamic signals depend on simulation state which is itself deterministic given the same input timeline. So the architecture is naturally replay-friendly. Stochastic mini-notation modifiers (like degradeBy with no seed) would need a session-level random seed to be replay-deterministic, an existing strudel concern that GXW inherits.

Sample bank loading. GXSTR loads dirt-samples (drums) and dough-samples piano.json at engine init time. The same loading carries over to GXW's pattern integration, with the same Load Engine button pattern from GXSTR — the user clicks to satisfy the browser's audio-context gesture requirement and lazy-load samples — applying here.

Mini-notation autocomplete in the inspector. The inspector's pattern field could surface mini-notation completions (sample names from loaded banks, common modifier names, signal names) similar to the editor's CodeMirror completions in the Behaviours tab. Out of scope for the initial integration; a natural follow-up once the basic surface is working.

Strudel version sync. GXW pins to a specific @strudel/web version (matching whatever GXSTR currently uses, since the import path is shared). Strudel evolves; staying current on its releases is an ongoing maintenance concern, not a one-time decision. Worth tracking changes that affect the modifier vocabulary GXW promises.

## Implementation order

When implementation begins, a tiered approach mirroring GXSTR's phase plan is the natural shape.

Tier 1 lands the foundations: import map for @strudel/web and tonal, LICENSE update, basic StrudelRuntime stub that can initialise the audio context and load sample banks but doesn't yet drive any output.

Tier 2 lands the pattern evaluation primitive: a function that takes a parsed Pattern, a cycle range, a wall-clock window, and a firing source identifier, and produces scheduled superdough events with the firing-context pointer mechanics in place. Static signals work end-to-end; dynamic signals not yet wired.

Tier 3 lands the inspector integration: the fourth beat-points-mode option, the pattern field, parse validation, soft-warning validation for context-inappropriate modifiers. Continuous firing on curves works end-to-end with static signals.

Tier 4 lands dynamic signals: SignalRegistry, the firing-context pointer plumbing, and one or two end-to-end signals (spriteV is the natural first since the simulation already has the data).

Tier 5 lands one-shot firing: trigger collisions and sprite-hit events fire patterns through the same primitive, with the flourish-duration field added to the relevant inspector surfaces.

Tier 6 lands visualisation: pre-firing glyphs for deterministic patterns, after-the-fact breadcrumbs for the rest. Polish, edge cases, and the open questions above get addressed as they surface.
