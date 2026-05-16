## Section 12 — Pattern Engine

The Pattern Engine evaluates Strudel patterns and dispatches their events to GXW's audio output. Pattern Language (Section 10) describes the language composers author in; this section describes how GXW reads that language and produces sound. The engine sits between the simulation (which decides when cycles begin and end) and the audio output (which sounds the events at their scheduled times).

### Layer separation: language and scheduler

The Strudel library packages three separable layers: the mini-notation parser plus modifier algebra (the language layer), the Pattern abstraction itself (a pure data thing — a function from a time range to a list of Haps), and the cyclist plus superdough audio engine (the runtime layer). GXW absorbs the first two layers fully and replaces the cyclist with its own simulation-driven scheduling. Mini-notation strings, the Pattern type, and modifier algebra are first-class GXW concepts. Superdough provides audio rendering. The Strudel cyclist is initialised for audio-context setup and sample-bank loading and then sits idle for the lifetime of the app.

The architectural split is sharp. GXW owns the WHEN — when each source's cycle starts and ends, when its cursor crosses an active beat point, when a sprite collides with a trigger. Strudel owns the WHAT — which sounds play, in what subdivisions, with what modulations. Trying to make Strudel's master cycle drive GXW's free-running per-source clocks proved unworkable in the earlier GXSTR codebase (see Section 24); the current shape preserves both halves cleanly.

### Pattern evaluation flow

When GXW's simulation produces a firing event for source X at simulation time T_cycle, the engine looks up the source's parsed Pattern (cached at edit-commit time, re-parsed on user edit), calls `pattern.queryArc(n, n+1)` where n is the source's current per-source cycle counter, and receives a list of Haps. Each Hap carries a fractional position in [0, 1) within the cycle and a value object describing what plays. The engine computes a wall-clock event time T_event = T_cycle + e_t × cycle_duration, where cycle_duration is the source's wall-clock cycle period derived from master BPM and the source's beatsPerCycle (see Section 7). The per-source cycle counter increments, so n+1 becomes n on the next firing — this lets cross-cycle modifiers like alternation advance correctly.

Two-pass evaluation handles the boundary between static structure and live state. Pass 1 happens at cycle start and establishes event structure: note number, audioTime, duration, channel, and any value fields that depend only on cycle position (Strudel's built-in signals like sine and saw, plus any static parameters in the pattern). Pass 2 happens just before each event's audioTime and refreshes the value fields that read dynamic signals (image colour, sprite kinematics — see Section 10). Pass 2 trusts Pass 1's structure absolutely: if the re-query returns no event in the small window around the event's fractional position, or returns multiple events, the schedule keeps Pass 1's event with Pass 1's values. This rule keeps the schedule deterministic relative to cycle-start state and isolates dynamic-signal influence to value fields.

The per-event re-query cost is small — each is a tiny pattern evaluation against a sub-cycle window — and pays for accuracy: dynamic signal values reflect simulation state at near-play time, not at cycle-start time. For a wandering sprite firing image-colour events at multiple positions in a cycle, each event reads the pixel under the sprite at the moment that event plays, give or take the audio output's lookahead window.

### One-cycle-ahead scheduling and late-refresh dispatch

Detection of a cycle wrap necessarily happens slightly after the wrap itself: the simulation's fixed-step tick overshoots the cycle boundary by a step or two, then the render loop reads the new state with up to one frame of additional latency. By the time the engine sees the wrap, the position-zero event's intended audioTime is already in the past. Scheduling it at that point either fires it audibly late or requires a forward-clamp that produces an audible offset.

The fix is to populate cycle N+1's events during cycle N. On the tick that detects a wrap into cycle C, the engine ensures both cycle C and cycle C+1 are in its populatedCycles map. The cycle C+1 entry was created on the previous cycle's pre-population pass, so its position-zero event has already been queued at its true future audioTime. When the simulation actually wraps to C+1, the event has already been sent to Web MIDI well in advance of its scheduled time; the audio output dispatches it exactly at the cycle boundary as intended. No detection lag, no clamp, no audible stutter.

The pre-population creates a tension with dynamic signals. A note whose audioTime is one or two seconds in the future was structured at population time, but its dynamic-signal values should reflect simulation state at the event's actual play time. The resolution is late-refresh dispatch. Instead of pre-sending each event's noteOn message to Web MIDI at population time, the engine retains the populated event in pendingEvents until a tight window (about twenty milliseconds) before its audioTime. At that window the engine activates the firing context for this event, re-queries the pattern for a sub-cycle range around the event's fractional position, takes the refreshed value, and dispatches the noteOn at that moment with Web MIDI's send-now semantics. Web MIDI's own scheduling latency is about one millisecond in practice, so the event lands at audioTime within audible threshold.

For events with no dynamic-signal-dependent value fields, Pass 2 is a no-op and the dispatch is functionally identical to a direct pre-schedule. The performance cost of late-refresh is one queryArc per event in flight, restricted to the moments just before each audio dispatch.

### Dynamic signals and the firing-context pointer

Dynamic signals are Patterns whose query function reads scene state during the call. Pattern Language (Section 10) describes the standard signal set — the OKLCh-derived image-colour signals, sprite kinematic signals, and the deferred harmony-context signals. The engine provides the firing-context pointer that lets those signals know which source to read state from.

When the engine fires a source's pattern at simulation time T, it sets a module-level firing-context pointer to (source X, T) inside a try-finally block, calls queryArc, and clears the pointer. Within the queryArc call, any dynamic signal in the pattern consults the pointer to learn which source's state to read, then reads it from the live simulation. The Pattern composition machinery does not know or care that the value came from simulation state versus a sine function — anything implementing the queryArc shape composes identically.

The try-finally protects against exceptions during query stranding the pointer. The pointer is module-level rather than per-evaluation because the dynamic signals are nested deep inside the modifier algebra and cannot easily receive context as a parameter; module-level state plus exception-safe clearing is the practical mechanism.

### Continuous and one-shot firing

The same pattern evaluation primitive serves both continuous and one-shot firing, with different invocation behaviour at the call site.

Continuous firing applies to sources whose cycles repeat naturally: a curve whose cursor loops the curve, a sprite with a non-zero beatsPerCycle. The engine calls the primitive with sequential cycle counters (0, 1, 2, ...) on each cycle wrap, and the per-source cycle counter naturally advances cross-cycle modifiers like alternation.

One-shot firing applies to events that do not naturally repeat: a trigger collision firing its own cyclePattern, a sprite-hit-trigger event playing a flourish. The engine calls the primitive once with cycle counter zero and a user-chosen flourish duration mapping the pattern's [0, 1) cycle range onto a wall-clock window. The flourish duration is a per-source field defaulting to one beat at the master BPM, with per-source override available.

Both invocation patterns flow through the same queryArc-then-schedule-events machinery. The difference is how often the primitive is called and what cycle counter is supplied. A trigger collision firing one-shot might still use rich within-cycle mini-notation (subdivisions, parallel layers, parameter modulation) — the pattern just does not get cross-cycle modifier behaviour, which is why Pattern Language (Section 10) flags cross-cycle modifiers on one-shot sources with a soft validation warning.

### Pattern edits and per-source state

When the user edits a pattern via Cmd-Enter promote on a labelled block in the Code tab (see Section 9 for the authoring path), the engine handles the takeover at the next cycle boundary rather than mid-cycle. The current cycle's events queued from the OLD pattern play through to the cycle boundary; the NEW pattern takes effect at the next wrap. No cancellation of pending events.

This shape was chosen over two alternatives that were tried in implementation. Mid-cycle takeover (clear pending events and re-detect against the new pattern within the same cycle) produced blended audio that sounded messier than waiting one cycle for a clean boundary transition. Take-effect-on-next-wrap with immediate clearing of pending events produced a silence gap from the edit through to the next wrap. The shipped resolution preserves the old pattern's already-queued events for the rest of the current cycle and lets the new pattern take effect at the next wrap via the normal detect-and-populate path. No silence gap and no audio messiness.

The pre-population interaction. If the user edits at fractional position 0.4 of cycle C, the events for cycle C+1 were populated from the OLD pattern at cycle C's start. The engine flags the source as patternDirty on edit; the next tick drops cycle C+1 from populatedCycles and from any pendingEvents derived from it, then re-populates cycle C+1 from the new pattern on the same tick. Cycle C's already-queued events still play out for the rest of the cycle; cycle C+1's new-pattern events queue up for the upcoming wrap.

Per-source cycle counter is preserved across pattern edits. If a curve's cycle counter is at 47 when the user edits the pattern, the counter continues at 48 on the next wrap rather than resetting to 0. Cross-cycle modifiers like alternation progress through whatever the new pattern does at cycle index 48, not at cycle 0. An explicit reset gesture (a small inspector control) covers the rare case where the composer wants to restart alternation deliberately.

### Cursor-sweep lockstep

A curve with a cursor and a cyclePattern produces a satisfying visual-audio coincidence: the cursor reaches each marker on the curve at exactly the moment that marker's audio event fires. The cause-and-effect reading the eye constructs (cursor causes firing) is illusory in the strict sense — the pattern is firing on its own one-cycle-ahead schedule and the cursor is independently traversing the geometry — but the two share one clock, so they remain in geometric agreement on every cycle. For line and ellipse shapes with arc-length-uniform parameterisation the lockstep is exact in screen coordinates; for piste shapes with non-uniform parameterisation the lockstep is exact in t-space.

Marker positions re-render at the start of each cycle by re-querying the curve's parsed cyclePattern. For deterministic patterns the positions are stable cycle to cycle and the re-render has no visible effect. For stochastic patterns (using degradeBy, choose, scramble, or rand/irand signals) the positions shift on each wrap; the diamond markers visibly animate, and the cursor's traversal remains in lockstep with whichever positions the current cycle produced. The visible animation of markers is a useful feedback signal for the composer authoring stochastic patterns.

### Initialization and the audio commit window

The engine's initialisation step sets up the audio context, loads sample banks where relevant for superdough usage, and initialises Strudel's expected global state (`window.cps` derived from master BPM, plus any other globals the curated modifier vocabulary may read). The Strudel cyclist itself is not started; the engine reaches into Strudel's initialisation code path for the audio-context setup without delegating scheduling to it. Some modifiers may behave incorrectly under the per-source clock model regardless of how globals are set, because their semantics assume Strudel's master cycle. Pattern Language (Section 10) documents the curated vocabulary that does behave correctly, and the inspector flags context-inappropriate uses with a soft warning.

The audio commit window — the rolling forward window the engine uses to decide which pending events to commit to Web MIDI on each tick — defaults to one hundred milliseconds. This matches Web Audio's recommended forward scheduling window and what Strudel's own cyclist uses. The exact size is exposed as a configurable value so it can be tuned to the simulation tick rate without code changes; smaller windows make simulation-pause behaviour more responsive at the cost of needing slightly faster ticks to keep events queued.

### Mute and solo

The engine respects mute and solo by skipping queryArc entirely when the source is silenced. Mute is a persisted per-source field that silences self-firing; an unmuted source whose cyclePattern fires via cursor sweep produces audio normally, a muted source's self-firing produces nothing. Solo Selected is a runtime-only state (carried over from the earlier GXSTR design) that silences every source not in the current selection. The mute interaction with external collisions is described in Section 8: mute silences self-firing only, so external cursors sweeping over a muted curve's markers still credit the colliding source's hasHit and the muted source's beenHit.
