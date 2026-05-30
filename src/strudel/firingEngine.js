/**
 * Pattern firing engine — Tier 2 Phase 3.
 *
 * Drives audio output for continuous-firing sources (curves
 * and sprites) by scheduling their per-source cycle wraps
 * into one of two output paths, selected by the audioOutput
 * preference at runtime: MIDI events sent through
 * MIDISender, or superdough audio events sent through the
 * runtime's play() wrapper. Only one output is active at a
 * time — the preference toggle is exclusive, so a user
 * playing through MIDI and switching to Superdough panics
 * the MIDI sender and clears all pending events on every
 * source before resuming under the new output. The engine
 * remains output-agnostic in its core scheduling logic;
 * the routing decision is one branch at the commit walker.
 *
 * Sits between three existing modules:
 *
 *   - StrudelRuntime: provides the loaded-status gate, the
 *     shared AudioContext (for audioContext.currentTime as
 *     the master scheduling clock), and the play(value,
 *     audioTime) wrapper for audio output if reactivated.
 *   - MIDISender: receives (value, audioTime, duration) for
 *     each event and dispatches noteOn/noteOff via Web MIDI.
 *   - Simulation: provides per-source cycleCount and
 *     cycleProgress via getCurveCycleState and
 *     getSpriteCycleState.
 *   - Transport: provides master BPM and isPlaying.
 *
 * One-cycle-ahead scheduling. Each tick the engine ensures
 * events for BOTH the current cycle and the next cycle are
 * populated and queued. Pre-populating the next cycle is
 * the only way to fire the position-zero downbeat at its
 * true audio time: detection of a cycle wrap necessarily
 * happens slightly after the wrap (the simulation overshoots
 * by 1-2 fixed steps then the render loop reads it 0-16ms
 * later), so a populate-on-wrap approach would always have
 * the new cycle's first event arrive with detection lag.
 * By populating cycle N+1's events with their true future
 * audioTimes during cycle N, Web MIDI schedules each
 * position-zero event accurately at the cycle boundary,
 * eliminating the wrap-induced stutter that an earlier
 * design exhibited.
 *
 * The state-tracking shape per source:
 *
 *   - populatedCycles: Map<cycleIndex, cycleAudioStart>.
 *     Records which cycles have had events generated and
 *     queued, along with the audio time each cycle started
 *     (or will start). New entries are added by populate;
 *     old entries (cycleIndex < currentCycle) get pruned
 *     each tick to bound memory.
 *   - pendingEvents: Array<{audioTime, value, duration,
 *     cycleIndex}>. Events awaiting commit. The cycleIndex
 *     tag lets pattern edits drop only events from cycles
 *     past the edit point while preserving the current
 *     cycle's events for Version B clean-takeover behaviour.
 *   - patternDirty: boolean. Set by _reconcileSource when
 *     cyclePattern text changes; cleared by the tick after
 *     it has filtered future-cycle events and dropped
 *     future-cycle entries from populatedCycles. The next
 *     populate (for current cycle if not already populated
 *     and for cycle+1) then uses the new pattern.
 *
 * Pause handling. When the transport is not playing, the
 * tick clears all per-source state (pendingEvents,
 * populatedCycles, patternDirty). Resume re-detects the
 * current cycle, bootstraps cycle N from cycleProgress, and
 * pre-populates cycle N+1. The cost is losing the rest of
 * the in-flight cycle's events on pause; acceptable since
 * pause-mid-cycle resume cleanly is more important than
 * preserving the exact remaining beats.
 *
 * Edit handling (Version B clean cycle-boundary takeover).
 * When setScene observes a changed cyclePattern text on an
 * existing source, the compiled Pattern is replaced and
 * patternDirty is set; pendingEvents and populatedCycles
 * are NOT touched here. The next tick filters pendingEvents
 * to keep only events with cycleIndex <= currentCycle
 * (preserving the current cycle's old-pattern events for
 * the rest of the cycle), drops cycles past currentCycle
 * from populatedCycles (so the new pattern repopulates them
 * fresh), and clears patternDirty. The result: the current
 * cycle finishes out on the old pattern with no silence
 * gap, then the new pattern takes effect cleanly at the
 * next cycle boundary on its own pre-scheduled events. A
 * mid-cycle takeover was tried earlier and reverted because
 * the blended audio (old beats before edit, new beats after)
 * sounded messier than the clean boundary transition.
 *
 * Late-refresh dispatch (Phase 3 substrate). Pending events
 * stay in the queue until they are within the active
 * late-refresh window of their audio time, rather than
 * being dispatched up to a full commit-window in advance.
 * The window is mode-dependent: 30ms for MIDI (Web MIDI
 * fires events at dispatch time, so a wider window would
 * only delay firing) and 100ms for superdough (Web Audio
 * schedules events sample-accurately at their audioTime,
 * so a wider window buys tighter audible timing rather
 * than later firing). At dispatch time, the commit walker
 * passes a per-tick snapshot of simulation state and a
 * firing-context pointer (set via withFiringContext from
 * firingContext.js, a try-finally helper that cannot
 * strand the pointer if queryArc throws) into a re-query
 * of the pattern for a tiny range around the event's
 * fractional position. Pass 1 (at population time)
 * established the event's structure (audioTime, duration,
 * channel, note number, and any static-signal value
 * fields); Pass 2 here refreshes any value fields that
 * read dynamic signals through the firing-context
 * pointer. If Pass 2 returns exactly one Hap, its value
 * replaces the population-time value; anything else (no
 * Hap, multiple Haps, queryArc throw) falls back to the
 * Pass 1 value, keeping the schedule deterministic
 * relative to cycle-start state. In Phase 3
 * no dynamic signals exist yet so Pass 2 is functionally a
 * no-op for every pattern — but the path runs unconditionally
 * so any substrate regression is debuggable independently
 * of the Phase 4 signal definitions that will land on top
 * of it.
 *
 * Continue-on-edit semantics for cross-cycle modifiers
 * (alternation, every, iter) are preserved across edits.
 * The simulation's per-source cycleCount keeps advancing
 * regardless of pattern changes, and the firing engine
 * queries the new pattern at the next cycle's index via
 * queryArc(C+1, C+2). An alternation pattern <a b c d>
 * edited at cycle 7 picks up at cycle 8 of the new pattern.
 *
 * Scope. Curves and sprites only. Triggers are excluded
 * because their natural firing model is one-shot (a
 * collision flourish, not a continuous loop), which lives
 * in Tier 5 with its own primitive.
 */

// @ts-check

import { parsePatternToPositions } from "./patternParse.js";
import { withFiringContext } from "./firingContext.js";
import { getBeatIntervalEntry, DEFAULT_BEAT_INTERVAL } from "../beatIntervals.js";

/** @typedef {import("./runtime.js").StrudelRuntime} StrudelRuntime */
/** @typedef {import("./midiSender.js").MIDISender} MIDISender */
/** @typedef {import("../simulation.js").Simulation} Simulation */
/** @typedef {import("../transport.js").Transport} Transport */
/** @typedef {import("../scene.js").Scene} Scene */

/**
 * Late-refresh window in seconds for MIDI output. Pending
 * events with audio times further in the future than
 * audioNow plus this value stay queued; events within the
 * window get a Pass 2 refresh (queryArc with the firing-
 * context pointer active) and dispatch to Web MIDI on this
 * tick. Section 27's one-cycle-ahead-scheduling-and-dynamic-
 * signal-late-refresh subsection picked roughly 20ms as the
 * design starting value; 30ms here gives the window
 * comfortably more room than the typical 16ms inter-frame
 * interval so a single dropped frame does not push an event
 * past the dispatch window before the next tick reaches it.
 * The cost of widening the window is that Pass 2 reads
 * simulation state up to 30ms before the event's audio
 * time, which is well below the audible threshold for the
 * dynamic signals planned for Phase 4.
 *
 * MIDI keeps this window narrow because Web MIDI fires
 * events at dispatch time, not at the audioTime argument:
 * dispatching late means firing late. A larger window
 * would not buy MIDI any precision, it would just hold
 * events in the queue longer.
 *
 * The pre-Phase-3 name for this constant was DEFAULT_-
 * COMMIT_WINDOW_SECONDS and the value was 0.1; the rename
 * marks the architectural shift from "commit now if within
 * audio lookahead" to "hold until late-refresh window then
 * dispatch with refreshed values".
 */
const DEFAULT_LATE_REFRESH_WINDOW_SECONDS = 0.03;

/**
 * Late-refresh window in seconds for superdough output.
 * Wider than the MIDI window because superdough's
 * scheduling semantics are fundamentally different: it
 * accepts an absolute audio-context timestamp and lets
 * the Web Audio API schedule the event sample-accurately
 * at that time, regardless of when the dispatch call
 * happens. Dispatching a superdough event 100ms before
 * its audioTime is not late — the audio engine schedules
 * it for exactly its audioTime and plays it precisely
 * there. Dispatching a superdough event AT its audioTime
 * with no lookahead, on the other hand, gives the audio
 * engine zero scheduling headroom and forces the event
 * to compete with whatever jitter is in the JavaScript
 * scheduler at that instant, which is the audible
 * imprecision the composer remembered from the earlier
 * superdough run.
 *
 * 100ms here gives superdough generous scheduling
 * headroom: each event leaves the firing engine well
 * before its audioTime and gets queued in the Web Audio
 * scheduler, which fires it at audio-rate precision
 * (sample-accurate within the audio buffer block). The
 * Pass 2 dynamic-signal substrate now reads snapshot
 * state up to 100ms before the event fires, but that
 * staleness is still well below the audible threshold
 * for any signal that varies at musical rates (the
 * sprite-position and curve-cursor signals planned for
 * Phase 4 change at on the order of 10-100Hz, and a
 * 100ms lookahead is one to two periods of that range,
 * which is the typical lookahead any DAW automation
 * lane operates with).
 */
const DEFAULT_LATE_REFRESH_WINDOW_SECONDS_SUPERDOUGH = 0.1;

/**
 * Debug flag for Pass 2 logging. When true, each Pass 2
 * refresh dispatch logs a one-line console message naming
 * the source, cycle index, fractional position, and the
 * refreshed value's note field (the most useful field for
 * eyeballing whether the pattern is firing what was
 * expected). Defaults to true through Phase 3 so the
 * substrate is visibly exercised; expected to flip to
 * false when Phase 4's first dynamic signal lands and
 * audible verification of the substrate becomes the
 * primary test. Useful to flip back on temporarily when
 * diagnosing any future Pass 2 regression. Unconditional
 * console.warn on the queryArc-throw fallback path is
 * unaffected by this flag so a genuinely broken pattern
 * still surfaces.
 */
const LOG_PASS2 = true;

/**
 * Debug flag for per-object voice injection. When true,
 * applyVoiceInjection logs a one-line message each time it
 * fills an s or bank field on an outgoing event, naming the
 * resulting sound/bank so it is visible whether the chosen
 * voice reaches superdough in the expected shape. Mirrors
 * LOG_PASS2's role for the dynamic-signal substrate. Default
 * true while the per-object voice work is being verified;
 * flip to false once the lazy-load fix is confirmed audibly
 * so normal playback is not noisy.
 */
const LOG_VOICE = true;

/**
 * Per-instrument amplitude-envelope table for the
 * superdough output path, keyed by the resolved sound
 * name (the value's `s` field after per-object voice
 * injection). Each entry carries decay, sustain, and
 * release; attack is intentionally omitted (left at
 * superdough's default, effectively immediate) because
 * the sampled instruments' own recorded onset already
 * provides the strike, so an imposed attack would only
 * soften it.
 *
 * Why this exists. Superdough is fire-and-forget: it has
 * no note-off, so a sampled voice plays for the duration
 * the firing engine passes and then runs whatever tail
 * the recording carries. The dough-samples piano in
 * particular has several seconds of pedal-down ring baked
 * into the audio, so without an imposed envelope a
 * sequence of piano notes piles overlapping tails into an
 * indistinct slur. A high sustain LEVEL (the note holds
 * at strength for its gated length) plus a short release
 * TIME (the note damps when its gated time ends) gives
 * the "hold full for the note's intended length, then
 * damp" articulation a real instrument's damper or a MIDI
 * note-off provides. Sustain is a level in [0, 1], not a
 * time; decay and release are absolute seconds on the Web
 * Audio clock and so do not scale with tempo, while the
 * note's hold length is the firing engine's tempo-aware
 * gated duration — the two come from different places, so
 * tempo-correct note lengths and tempo-independent
 * damping fall out naturally.
 *
 * Every pitched-sample entry is seeded with the same
 * values the composer confirmed by ear for piano (decay
 * 0.1, sustain 0.9, release 0.15); per-instrument tuning
 * comes later. The four built-in oscillators and the four
 * noise sources are deliberately absent: they are raw
 * synth voices whose own shape the composer has not asked
 * to alter, and a sound with no entry here gets no
 * imposed envelope and behaves exactly as before. Keyed
 * by the same names as inspector.js's PITCHED_SOUND_-
 * OPTIONS sample entries; kept in sync by hand.
 *
 * A future articulation commit will tie the release onset
 * to the note's articulated end (staccato vs legato) via
 * the gated duration the firing engine passes, without
 * changing this fixed per-instrument shape.
 */
const VOICE_ENVELOPES = {
    piano: { decay: 0.1, sustain: 0.9, release: 0.15 },
    steinway: { decay: 0.1, sustain: 0.9, release: 0.15 },
    vibraphone: { decay: 0.1, sustain: 0.9, release: 0.15 },
    marimba: { decay: 0.1, sustain: 0.9, release: 0.15 },
    kalimba: { decay: 0.1, sustain: 0.9, release: 0.15 },
    harp: { decay: 0.1, sustain: 0.9, release: 0.15 },
    sax: { decay: 0.1, sustain: 0.9, release: 0.15 },
};

/**
 * Per-source firing state. Keyed by source id in the
 * PatternFiringEngine's _sources map.
 *
 * @typedef {Object} SourceFiringState
 * @property {string} id
 * @property {"curve" | "sprite"} kind
 * @property {string} cyclePatternText  Raw cyclePattern source string; compared
 *                                       on each setScene to decide whether to
 *                                       set patternDirty.
 * @property {number} patternRepeats  Last-seen patternRepeats value for this
 *                                     source (curve-only field; sprites store
 *                                     1). Compared on each setScene as part
 *                                     of the timing-quartet (with beatsPerCycle,
 *                                     beatInterval, and cycleSpeeds); a change
 *                                     to any of the four sets timingDirty,
 *                                     which the next tick handles by dropping
 *                                     the entire pending queue — not just
 *                                     future cycles — so the next bootstrap
 *                                     re-derives event audioTimes against
 *                                     simulation's current cycleProgress and
 *                                     the new cycleDuration. See timingDirty.
 * @property {any} beatsPerCycle  Last-seen beatsPerCycle value (raw from
 *                                 source; may be missing or non-numeric in
 *                                 hand-edited scenes, in which case the
 *                                 tick() gate skips this source). Tracked
 *                                 here so the reconciliation can detect a
 *                                 change and set timingDirty; the actual
 *                                 cycleDuration arithmetic happens in tick().
 * @property {any} beatInterval  Last-seen beatInterval token (e.g. "Qtr",
 *                                "8th", "Dot 16th"; raw from source). Same
 *                                role as beatsPerCycle for the timing-change
 *                                detection.
 * @property {string} cycleSpeeds  Last-seen cycleSpeeds string (curve-only;
 *                                  sprites store "1"). Compared on each
 *                                  setScene as the fourth timing-quartet
 *                                  field; a change sets timingDirty so the
 *                                  next tick re-derives event audioTimes
 *                                  against the new speed list. The per-cycle
 *                                  speed itself is consulted at firing time
 *                                  via simulation.getCurveSpeedAt; this raw
 *                                  string exists here only for change
 *                                  detection.
 * @property {any} compiled  Compiled strudel Pattern object (carries queryArc),
 *                            or null when the text was empty or failed to parse.
 * @property {Map<number, number>} populatedCycles  Map from cycleIndex to the
 *                                                   audio time that cycle
 *                                                   started (or will start).
 *                                                   Drives the populate
 *                                                   one-ahead logic and the
 *                                                   pattern-edit cleanup.
 * @property {boolean} patternDirty  Set by _reconcileSource when cyclePattern
 *                                    text changes; cleared by the next tick
 *                                    after it has filtered future-cycle events
 *                                    and dropped future-cycle entries from
 *                                    populatedCycles. Preserves current-cycle
 *                                    events for the musical clean-boundary
 *                                    takeover — the current cycle finishes
 *                                    out on the old pattern, the new pattern
 *                                    takes effect at the next cycle wrap.
 * @property {boolean} timingDirty  Set by _reconcileSource when any
 *                                   cycleDuration-affecting field changes
 *                                   (beatsPerCycle, beatInterval,
 *                                   patternRepeats, cycleSpeeds). Distinct
 *                                   from patternDirty because timing changes
 *                                   need the CURRENT cycle's events dropped
 *                                   too: they were laid out at the old
 *                                   timing's audioTimes, but the simulation
 *                                   cursor advances at the new timing from
 *                                   the moment of edit, so keeping the old
 *                                   events would let audio drift past the
 *                                   visual cursor for the rest of the cycle.
 *                                   Cleared by the next tick after dropping
 *                                   the entire pendingEvents queue and
 *                                   clearing populatedCycles; the bootstrap
 *                                   then re-derives a virtual startC from
 *                                   simulation's current cycleProgress and
 *                                   the new cycleDuration, producing event
 *                                   audioTimes consistent with where the
 *                                   simulation will actually wrap.
 * @property {Array<{audioTime: number, value: any, duration: number, cycleIndex: number, fractional: number}>} pendingEvents
 *                            Events awaiting commit, tagged with the cycle
 *                            they belong to so pattern edits can preserve
 *                            current-cycle events while dropping future ones.
 *                            The fractional field stores the event's begin
 *                            position within its cycle, in [0, 1); Pass 2
 *                            uses it to construct the queryArc range
 *                            (cycleIndex + fractional, cycleIndex + fractional
 *                             + epsilon) for the late-refresh re-query without
 *                            having to recover that position from audioTime
 *                            arithmetic (which would drift slightly under
 *                            floating-point round-trip). Sorted by audioTime
 *                            ascending.
 */

export class PatternFiringEngine {
    /**
     * @param {StrudelRuntime} runtime
     * @param {MIDISender} midiSender
     * @param {Simulation} simulation
     * @param {Transport} transport
     */
    constructor(runtime, midiSender, simulation, transport) {
        this._runtime = runtime;
        this._midiSender = midiSender;
        this._simulation = simulation;
        this._transport = transport;

        /** @type {Scene | null} */
        this._scene = null;

        /**
         * Canvas reference, set via setCanvas after
         * construction. Used by _captureSnapshot to read
         * image OKLCh data and to compute curve cursor
         * canvas positions. Null until setCanvas is
         * called; functions that depend on it gate on
         * null and fall back to sensible defaults (image
         * signals to null imageOKLCh, curves skipped from
         * the snapshot because their canvas-space firing
         * position cannot be derived without geometry).
         * Sprites work without a canvas attached because
         * the simulation already exposes their canvas
         * position directly; only the imageOKLCh field
         * on the snapshot entry comes back null.
         * @type {import("../canvas.js").Canvas | null}
         */
        this._canvas = null;

        /**
         * Audio output routing mode. "midi" (the default)
         * sends events through this._midiSender.send;
         * "superdough" sends them through this._runtime.play.
         * Set by main.js from the audioOutput preference on
         * startup and on every preference change. The mode
         * is read fresh at every late-refresh dispatch in
         * tick(), so a change takes effect on the next tick
         * without any per-source reset — the setOutputMode
         * setter itself handles the cleanup (MIDI panic on
         * any switch that involved MIDI; per-source
         * pendingEvents and populatedCycles cleared on
         * every switch so the next tick re-bootstraps under
         * the new output cleanly, mirroring the BPM-change
         * and rewind paths).
         * @type {"midi" | "superdough"}
         */
        this._outputMode = "midi";

        /** @type {Map<string, SourceFiringState>} */
        this._sources = new Map();

        /**
         * Play Selected mode flag. When false (default), the
         * firing engine fires every unmuted source's pattern
         * normally; when true, only sources whose id is in
         * _playSelectedIds fire. The complementary set
         * (unmuted but not in the selection) get their
         * pending events dropped and skip population each
         * tick, parallel to the mute gate. Toggled by main.js
         * in response to the Play Selected toolbar button.
         * @type {boolean}
         */
        this._playSelectedMode = false;

        /**
         * Source ids permitted to fire while Play Selected
         * mode is on. Updated by main.js on every canvas
         * selection change so the gate tracks the active
         * selection in real time. Ignored when
         * _playSelectedMode is false. The set is intentionally
         * an id set rather than the raw canvas-selection-
         * index shape so the firing engine doesn't have to
         * resolve indices against the scene each tick.
         * @type {Set<string>}
         */
        this._playSelectedIds = new Set();

        /**
         * Last-seen transport elapsedSeconds. Compared on
         * each tick to detect rewind — a backward jump
         * in transport time, the same signal simulation.js
         * uses internally to reset per-source cycleCount
         * and cycleProgress. Without this detection here,
         * firingEngine would keep its pre-rewind
         * populatedCycles entries and pendingEvents while
         * the simulation restarted from cycle 0, and the
         * MIDI sender's already-scheduled noteOns from the
         * pre-rewind session would fire alongside the new
         * play session's events. Detection triggers a full
         * per-source state clear plus a MIDI panic, so the
         * next tick bootstraps cleanly from cycle 0 with
         * nothing residual on the wire. Initialised to 0
         * so the first tick (when elapsedSeconds is also
         * 0) doesn't false-positive.
         * @type {number}
         */
        this._lastElapsedSeconds = 0;

        /**
         * Last-seen transport BPM. Compared on each tick to
         * detect a master-tempo change. Unlike per-source
         * timing fields (beatsPerCycle, beatInterval,
         * patternRepeats, cycleSpeeds), BPM lives on the
         * transport and does not go through _reconcileSource,
         * so a BPM edit reaches no source's timingDirty flag
         * and the existing per-source timing-dirty path
         * leaves stale old-BPM audioTimes in pendingEvents
         * alongside the new-BPM events the bootstrap is
         * about to lay down. The late-refresh dispatch then
         * fires both sets, producing the audible desync
         * between the visual cursor and the heard notes
         * (most dramatically on large BPM jumps, e.g. 40 to
         * 120). When a change is detected at the top of
         * tick(), every source's pendingEvents and
         * populatedCycles are cleared so the bootstrap below
         * re-derives audioTimes against the new cycleDuration.
         * The companion simulation.forceTimingSnapAll call
         * (below the detection block) ensures simulation has
         * snapped to the new grid before the bootstrap reads
         * cycleState; without it, a no-step tick would let
         * the bootstrap compute audioTimes against stale
         * cycleCount and cycleProgress. Initialised to null
         * so the first tick has nothing to compare against
         * and does not false-trigger; preserved across pause
         * so a BPM edit while paused naturally fires the
         * detection on the first post-resume tick.
         * @type {number | null}
         */
        this._lastBpm = null;

        /**
         * Late-refresh window in seconds for the MIDI
         * output path. Public property so callers can
         * adjust without recompiling the engine. See
         * DEFAULT_LATE_REFRESH_WINDOW_SECONDS at module
         * top for the rationale. Set larger to tolerate
         * dropped frames at the cost of slightly staler
         * dynamic-signal reads at Pass 2 time; set
         * smaller for tighter Pass 2 freshness at the
         * cost of needing tick to run reliably between
         * event audioTimes. Read only when _outputMode
         * is "midi".
         */
        this.lateRefreshWindowSeconds = DEFAULT_LATE_REFRESH_WINDOW_SECONDS;

        /**
         * Late-refresh window in seconds for the
         * superdough output path. Public property so
         * callers can adjust without recompiling the
         * engine. See
         * DEFAULT_LATE_REFRESH_WINDOW_SECONDS_SUPERDOUGH
         * at module top for the rationale. Wider than
         * the MIDI value because superdough schedules
         * events sample-accurately at their audioTime
         * regardless of when the dispatch call happens,
         * so a larger lookahead translates directly into
         * tighter audible timing rather than later firing.
         * Read only when _outputMode is "superdough".
         */
        this.lateRefreshWindowSecondsSuperdough =
            DEFAULT_LATE_REFRESH_WINDOW_SECONDS_SUPERDOUGH;

        /**
         * Firing-event subscriber, or null. Called once per
         * successful dispatch (MIDI or superdough) with a
         * payload describing the event just fired:
         *
         *   { sourceId, kind, absoluteFractional, audioTime }
         *
         * The canvas wires through main.js to drive the
         * yellow-flash visual feedback on beat-point
         * diamonds (curves) and outlined edges (sprites);
         * see Canvas.markFiredCurveBeat /
         * Canvas.markFiredSprite. The absoluteFractional
         * field is the GXW-cycle position in [0, 1) of the
         * event within the cycle, computed at populate time
         * as (repeatIndex + strudelFractional) / repeats so
         * patternRepeats > 1 produces a unique value per
         * diamond on the curve. For sprites the field is
         * the same shape (still in [0, 1) within the GXW
         * cycle) but the canvas does not use it; the sprite
         * flash is a short timestamped fade keyed by
         * sourceId alone.
         *
         * Exceptions thrown by the subscriber are caught
         * and logged so a buggy visual subscriber can never
         * destabilise the firing engine itself; the audio
         * dispatch already completed before the subscriber
         * ran, so an unhandled throw would only have
         * dropped the visual update for this event without
         * affecting subsequent ones.
         *
         * @type {((event: {sourceId: string, kind: "curve" | "sprite", absoluteFractional: number, audioTime: number}) => void) | null}
         */
        this._onFiring = null;

        // Subscribe to transport play-state changes so we
        // can panic the MIDI sender immediately when the
        // user pauses. The pause-path inside tick() also
        // panics, but the canvas's render loop stops
        // calling tick() when isPlaying flips to false, so
        // the tick path alone doesn't guarantee panic
        // fires. The listener does. The play transition
        // doesn't need any action here — the next tick
        // will bootstrap the current and next cycle
        // through the normal populate path.
        this._transport.on("play", () => {
            if (!this._transport.isPlaying) {
                for (const state of this._sources.values()) {
                    state.pendingEvents = [];
                    state.populatedCycles.clear();
                    state.patternDirty = false;
                    state.timingDirty = false;
                }
                this._midiSender.panic();
            }
        });

        // When the strudel engine finishes loading, ensure
        // any per-object superdough voices in the current
        // scene have their sample maps / soundfonts requested.
        // setScene also runs this scan, but a score usually
        // loads (and setScene runs) before the user clicks
        // Load Engine, so this covers the common ordering
        // where the scene's voices were known before
        // window.samples existed. onStatusChange fires
        // immediately with the current status on subscribe;
        // at construction that is "idle", which no-ops.
        this._runtime.onStatusChange((status) => {
            if (status === "loaded") this._ensureVoiceSamplesForScene();
        });
    }

    /**
     * Set the audio output routing mode. Called by main.js
     * from the audioOutput preference on startup and on
     * every change of that preference. Two modes:
     *
     *   - "midi": every event dispatches through
     *     this._midiSender.send. The Web MIDI sender
     *     translates the strudel hap value (typically a
     *     {note: ...} from a note() or n() pattern) into
     *     a noteOn/noteOff pair on the configured MIDI
     *     port.
     *
     *   - "superdough": every event dispatches through
     *     this._runtime.play. Superdough is strudel's
     *     built-in Web Audio engine; it handles sample
     *     playback ({s: "bd"} from sound() or s()
     *     patterns) and synthesised tones ({note: ...}
     *     fed to its default oscillator) on the shared
     *     AudioContext.
     *
     * Mode switch cleanup. Every switch (regardless of
     * direction) clears every source's pendingEvents and
     * populatedCycles so the next tick re-bootstraps
     * cleanly under the new output. A switch away from
     * MIDI also panics the MIDI sender so any noteOns
     * already dispatched but whose noteOffs were still
     * queued in the sender's scheduler get silenced
     * immediately rather than ringing indefinitely. A
     * switch to MIDI doesn't need a superdough panic
     * because superdough events are fire-and-forget at
     * dispatch time with no separate noteOff scheduling.
     * The cleanup shape mirrors the existing BPM-change
     * and rewind paths in tick().
     *
     * Unknown mode strings are ignored (silent no-op) so a
     * stale or hand-edited localStorage value can't leave
     * the engine in an undefined state.
     *
     * @param {string} mode
     */
    setOutputMode(mode) {
        if (mode !== "midi" && mode !== "superdough") return;
        if (mode === this._outputMode) return;
        const wasMidi = this._outputMode === "midi";
        this._outputMode = mode;
        for (const state of this._sources.values()) {
            state.pendingEvents = [];
            state.populatedCycles.clear();
            state.patternDirty = false;
            state.timingDirty = false;
        }
        if (wasMidi) {
            this._midiSender.panic();
        }
    }

    /**
     * Toggle the Play Selected mode gate. When true, only
     * sources whose id is in the play-selected set fire
     * patterns; when false (default), every unmuted source
     * fires normally. Wired to the Play Selected toolbar
     * button via main.js's toolbar.onPlaySelectedToggle
     * subscriber.
     *
     * Flipping off doesn't need any extra work here: the
     * tick loop's bootstrap path repopulates the previously-
     * gated sources naturally from their current cycle state
     * once the gate no longer fires. Flipping on also needs
     * no extra work: the tick loop's gate path clears
     * pending events and populatedCycles for any source
     * not in the selection set, which matches the existing
     * mute-on behaviour exactly. Any already-playing notes
     * on now-gated sources finish out their natural duration
     * through MIDISender's noteOff scheduler rather than
     * being interrupted with a panic; that mirrors mute
     * mid-play behaviour and keeps musical transitions
     * smooth.
     *
     * @param {boolean} active
     */
    setPlaySelectedMode(active) {
        this._playSelectedMode = active === true;
    }

    /**
     * Update the set of source ids permitted to fire while
     * Play Selected mode is on. Called by main.js on every
     * canvas selection change with the object ids resolved
     * from the new selection. Has no audible effect while
     * Play Selected mode is off; the set is still kept up
     * to date so flipping the mode on takes effect with the
     * current selection without an extra setup call.
     *
     * @param {Set<string>} ids
     */
    setPlaySelectedIds(ids) {
        this._playSelectedIds = ids instanceof Set ? ids : new Set();
    }

    /**
     * Attach the canvas so the firing engine can query
     * canvas-managed scene state at snapshot-capture time:
     * the image-OKLCh pixel-lookup buffer and the curve
     * cursor's canvas-space position derived from its
     * parameter t. Called from main.js once at startup,
     * right after canvas.setFiringEngine(firingEngine)
     * wires the engine into the canvas's render-loop
     * tick. Calling order between the two setters does
     * not matter — both are static one-time wirings.
     *
     * The firing engine continues to function without a
     * canvas reference: image-colour signals on sprites
     * read null imageOKLCh and fall back to their
     * documented no-image defaults; curves are skipped
     * from the snapshot entirely (no canvas-space
     * position available). Attaching the canvas just
     * enables the image-pixel and curve-geometry reads
     * that Phase 4 signals need.
     *
     * @param {import("../canvas.js").Canvas} canvas
     */
    setCanvas(canvas) {
        this._canvas = canvas;
    }

    /**
     * Subscribe to firing events. Replaces any prior
     * subscriber. Called from main.js once at startup to
     * route the engine's per-dispatch signal into the
     * canvas's yellow-flash visual feedback path. See the
     * _onFiring field doc for the event payload shape and
     * the exception-handling contract.
     *
     * @param {((event: {sourceId: string, kind: "curve" | "sprite", absoluteFractional: number, audioTime: number}) => void) | null} cb
     */
    onFiring(cb) {
        this._onFiring = typeof cb === "function" ? cb : null;
    }

    /**
     * Reconcile the firing engine's compiled-pattern cache
     * against a freshly-loaded Scene. Existing sources whose
     * cyclePattern text is unchanged keep their lastFiredCycle
     * and continue playing across the reload; sources whose
     * cyclePattern text changed get their pattern recompiled
     * and pending events cleared (the new pattern takes
     * effect on the next cycle wrap); sources newly added to
     * the scene start with lastFiredCycle null so the firing
     * engine treats their first observed cycle as a new
     * cycle to populate; sources removed from the scene
     * drop from the cache entirely.
     *
     * Pass null to clear all firing state — used when no
     * scene is loaded (transient between scene reloads).
     *
     * @param {Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        if (scene === null) {
            this._sources.clear();
            return;
        }
        /** @type {Set<string>} */
        const seenIds = new Set();
        for (const curve of scene.curves) {
            if (typeof curve.id !== "string") continue;
            seenIds.add(curve.id);
            this._reconcileSource(curve.id, "curve", curve);
        }
        for (const sprite of scene.sprites) {
            if (typeof sprite.id !== "string") continue;
            seenIds.add(sprite.id);
            this._reconcileSource(sprite.id, "sprite", sprite);
        }
        for (const id of [...this._sources.keys()]) {
            if (!seenIds.has(id)) this._sources.delete(id);
        }
        this._ensureVoiceSamplesForScene();
    }

    /**
     * Scan the current scene's curves and sprites for
     * per-object superdough voices and ask the runtime to
     * lazy-load whatever sample map or soundfont each voice
     * needs. Cheap and idempotent: the runtime tracks which
     * resources it has already requested, so re-scanning on
     * every setScene (and again when the engine finishes
     * loading) costs a Set lookup per voiced object. No-op
     * when no scene is loaded. Triggers are intentionally
     * skipped to match the firing engine's scope — they
     * carry the voice schema slot but have no firing path
     * yet, so loading their samples now would be premature;
     * this scan extends to them naturally when that path
     * lands.
     */
    _ensureVoiceSamplesForScene() {
        if (this._scene === null) return;
        const sources = [...this._scene.curves, ...this._scene.sprites];
        for (const obj of sources) {
            if (obj === null || typeof obj !== "object") continue;
            const voice = obj.voice;
            if (voice === null || typeof voice !== "object") continue;
            const sd = voice.superdough;
            if (sd === null || typeof sd !== "object") continue;
            this._runtime.ensureSamplesForVoice(sd.sound, sd.bank);
        }
    }

    /**
     * Internal: reconcile one source against the cache.
     * Adds an entry if missing; sets one or both of the
     * dirty flags when authored fields change so the next
     * tick can apply the right kind of cleanup before the
     * populate path runs.
     *
     * Two dirty flags are tracked separately because they
     * mean different things audibly:
     *
     *   - patternDirty (set on cyclePatternText change):
     *     drop FUTURE-cycle events only. The current cycle
     *     finishes on the old pattern; the new pattern
     *     takes effect at the next cycle wrap. This is the
     *     musical clean-boundary takeover — mid-cycle
     *     pattern swaps sound jarring, so the engine
     *     deliberately defers them.
     *
     *   - timingDirty (set on beatsPerCycle / beatInterval
     *     / patternRepeats change): drop EVERYTHING. The
     *     current cycle's queued events were laid out at
     *     the old cycleDuration / segmentDuration, but the
     *     simulation cursor switches to the new timing the
     *     moment the edit lands and advances at the new
     *     rate for the rest of the cycle. Keeping the old
     *     events would let the audio drift past the visual
     *     cursor (events fire when the cursor was supposed
     *     to reach them under old timing, not when the
     *     cursor actually reaches them under new timing).
     *     Dropping everything lets the next bootstrap
     *     re-derive startC from simulation's current
     *     cycleProgress and the new cycleDuration, which
     *     gives a virtual cycle anchor consistent with
     *     simulation's hybrid wrap timing (the wrap
     *     happens at T_edit + (1 - P_edit) * D_new because
     *     simulation's cycleProgress accumulates dt /
     *     cycleDuration step-by-step, so progress accrued
     *     before the edit stays at old rate and progress
     *     after the edit advances at new rate).
     *
     * @param {string} id
     * @param {"curve" | "sprite"} kind
     * @param {any} source
     */
    _reconcileSource(id, kind, source) {
        const cyclePatternText = typeof source.cyclePattern === "string"
            ? source.cyclePattern
            : "";
        // Mirror the defensive clamp used in tick(): missing,
        // non-numeric, zero, negative, or non-integer values
        // normalise to a positive integer >= 1 so comparison
        // is stable across hand-edited scenes and the
        // runtime read.
        const patternRepeats = (typeof source.patternRepeats === "number"
            && Number.isFinite(source.patternRepeats))
            ? Math.max(1, Math.round(source.patternRepeats))
            : 1;
        // beatsPerCycle, beatInterval, and cycleSpeeds
        // stored as raw values for comparison stability;
        // tick() handles validation and the cycleDuration
        // formula, and Pass 1 / Pass 2 consult per-cycle
        // speed via simulation.getCurveSpeedAt. Strict-
        // equality on the raw values catches every change
        // through the inspector or hand-edited scenes.
        const beatsPerCycle = source.beatsPerCycle;
        const beatInterval = source.beatInterval;
        const cycleSpeeds = typeof source.cycleSpeeds === "string"
            ? source.cycleSpeeds
            : "1";
        const existing = this._sources.get(id);
        if (existing !== undefined) {
            const textChanged = existing.cyclePatternText !== cyclePatternText;
            const repeatsChanged = existing.patternRepeats !== patternRepeats;
            const beatsPerCycleChanged = existing.beatsPerCycle !== beatsPerCycle;
            const beatIntervalChanged = existing.beatInterval !== beatInterval;
            const cycleSpeedsChanged = existing.cycleSpeeds !== cycleSpeeds;
            const timingChanged =
                repeatsChanged ||
                beatsPerCycleChanged ||
                beatIntervalChanged ||
                cycleSpeedsChanged;
            if (textChanged) {
                existing.cyclePatternText = cyclePatternText;
                existing.compiled = this._compile(cyclePatternText);
                // patternDirty: next tick drops future-cycle
                // events and future cycles from
                // populatedCycles, preserving the current
                // cycle's events for the musical clean-
                // boundary takeover.
                existing.patternDirty = true;
            }
            if (timingChanged) {
                if (repeatsChanged) existing.patternRepeats = patternRepeats;
                if (beatsPerCycleChanged) existing.beatsPerCycle = beatsPerCycle;
                if (beatIntervalChanged) existing.beatInterval = beatInterval;
                if (cycleSpeedsChanged) existing.cycleSpeeds = cycleSpeeds;
                // timingDirty: next tick drops EVERYTHING
                // (current cycle included) so the bootstrap
                // re-derives a virtual startC matching
                // simulation's hybrid wrap timing under
                // the new cycleDuration (and the new per-
                // cycle effective duration when cycleSpeeds
                // was what changed).
                existing.timingDirty = true;
            }
            existing.kind = kind;
            return;
        }
        this._sources.set(id, {
            id,
            kind,
            cyclePatternText,
            patternRepeats,
            beatsPerCycle,
            beatInterval,
            cycleSpeeds,
            compiled: this._compile(cyclePatternText),
            populatedCycles: new Map(),
            patternDirty: false,
            timingDirty: false,
            pendingEvents: [],
        });
    }

    /**
     * Walk every cached source and attempt to recompile
     * its cyclePattern for any source whose compiled
     * Pattern is currently null but whose cyclePattern
     * text is non-empty. Used by main.js on the strudel
     * runtime's "loaded" status transition so a score
     * whose patterns couldn't be parsed at scene load
     * (because the engine hadn't been clicked yet) picks
     * up its compiled patterns when the engine becomes
     * available. Parallels canvas.refreshMarkers.
     *
     * Pending events and populatedCycles are cleared for
     * any source that recompiles, so the next tick
     * re-bootstraps from the current simulation state.
     */
    recompileMissingPatterns() {
        for (const state of this._sources.values()) {
            if (state.compiled !== null) continue;
            if (state.cyclePatternText.trim() === "") continue;
            state.compiled = this._compile(state.cyclePatternText);
            state.pendingEvents = [];
            state.populatedCycles.clear();
        }
    }

    /**
     * Internal: compile a cyclePattern expression string
     * into a strudel Pattern object. Returns null for empty
     * strings, parse failures, and any path that would
     * otherwise produce a non-Pattern value. Errors are
     * silent here because the same expressions are already
     * parsed for marker rendering on every setScene and
     * surface diagnostics through that path; doubling them
     * up would be noisy.
     *
     * @param {string} text
     * @returns {any}
     */
    _compile(text) {
        if (typeof text !== "string" || text.trim() === "") return null;
        const result = parsePatternToPositions(text);
        if (!result.ok) return null;
        return result.pattern ?? null;
    }

    /**
     * Advance the firing engine by one tick. Called from
     * the canvas's render loop right after the simulation's
     * tick so each draw frame's audio commitments reflect
     * the same simulation state the canvas will paint.
     *
     * Gates: the runtime must be loaded (no engine, no
     * audio), the scene must be present, and the transport
     * must be playing. The paused path also resets per-
     * source firing state so resume re-detects with the
     * resumed audio clock.
     */
    tick() {
        if (this._runtime.status !== "loaded") return;
        if (this._scene === null) return;

        if (!this._transport.isPlaying) {
            // Paused. Clear all per-source firing state
            // so resume re-bootstraps from the resumed
            // simulation state. The cost is losing the
            // rest of the in-flight cycle's events on
            // pause, which is acceptable: pause-mid-cycle
            // resume cleanly is more important than
            // preserving the exact remaining beats.
            // Also panic the MIDI sender so any notes that
            // already had noteOns dispatched (and have
            // pending noteOffs queued in the midiSender's
            // own scheduler) get silenced immediately
            // rather than ringing indefinitely.
            for (const state of this._sources.values()) {
                state.pendingEvents = [];
                state.populatedCycles.clear();
                state.patternDirty = false;
                state.timingDirty = false;
            }
            this._midiSender.panic();
            return;
        }

        // Rewind detection. simulation.js detects a
        // backward jump in transport.elapsedSeconds and
        // resets each source's cycleCount and cycleProgress
        // to 0. firingEngine needs the same signal: without
        // a matching reset, populatedCycles entries and
        // pendingEvents from before the rewind would
        // persist, and the MIDI sender's already-scheduled
        // noteOns from the pre-rewind session would fire
        // alongside the new play session's events,
        // producing extra notes layered on top of the
        // post-rewind playback. Clear all per-source state
        // and panic the MIDI sender so the next tick
        // bootstraps cleanly from cycle 0. The lastSeen
        // value is updated unconditionally below so a
        // single backward jump triggers detection exactly
        // once.
        const elapsedNow = this._transport.elapsedSeconds;
        if (typeof elapsedNow === "number"
            && Number.isFinite(elapsedNow)
            && elapsedNow < this._lastElapsedSeconds) {
            for (const state of this._sources.values()) {
                state.pendingEvents = [];
                state.populatedCycles.clear();
                state.patternDirty = false;
                state.timingDirty = false;
            }
            this._midiSender.panic();
        }
        this._lastElapsedSeconds =
            (typeof elapsedNow === "number" && Number.isFinite(elapsedNow))
                ? elapsedNow
                : this._lastElapsedSeconds;

        const ctx = this._runtime.audioContext;
        if (ctx === null) return;
        const audioNow = ctx.currentTime;

        const bpm = this._transport.bpm;
        if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return;

        // BPM-change detection. The transport's master tempo
        // lives outside _reconcileSource (which only tracks
        // per-source timing fields), so a BPM edit otherwise
        // reaches no source's timingDirty flag and stale
        // events with old-BPM audioTimes remain in
        // pendingEvents alongside the new-BPM events the
        // bootstrap below is about to lay down. Clear every
        // source's pendingEvents and populatedCycles here so
        // the bootstrap re-derives event audioTimes against
        // the new cycleDuration. Match the per-source
        // timingDirty semantics: drop EVERYTHING (current
        // cycle's events included), since the new
        // cycleDuration shifts even the in-flight cycle's
        // intended audioTimes and keeping them would let the
        // audio drift past the visual cursor. _lastBpm = null
        // on the first tick after construction skips the
        // clear so play does not false-trigger.
        if (this._lastBpm !== null && this._lastBpm !== bpm) {
            for (const state of this._sources.values()) {
                state.pendingEvents = [];
                state.populatedCycles.clear();
            }
        }
        this._lastBpm = bpm;

        // Force simulation's timing-edit snap on every tick.
        // Idempotent for sources whose cycleDuration hasn't
        // changed since the last step. Catches two cases
        // that would otherwise leave the bootstrap below
        // reading stale cycleCount and cycleProgress: a BPM
        // edit where simulation's per-step snap hasn't fired
        // yet (no _step ran because accumulator < SIM_DT),
        // and per-source timing edits (beatsPerCycle,
        // beatInterval, patternRepeats, cycleSpeeds) where
        // the same no-step case applies. Without this, a
        // single tick of stale cycleState produces bootstrap
        // audioTimes anchored at the wrong place, and those
        // stale entries persist in pendingEvents alongside
        // the eventually-correct ones from the next tick's
        // snap-tick bootstrap, producing the audible desync
        // that survives until the next rewind.
        this._simulation.forceTimingSnapAll();

        // Active late-refresh window depends on the
        // current output mode. MIDI uses a narrow 30ms
        // window because Web MIDI fires events at
        // dispatch time and a larger lookahead would only
        // delay firing; superdough uses a wider 100ms
        // window because Web Audio schedules events
        // sample-accurately at their audioTime regardless
        // of when the dispatch call happens, so a larger
        // lookahead buys tighter audible timing rather
        // than later firing. See the two
        // DEFAULT_LATE_REFRESH_WINDOW_SECONDS* constants
        // at module top for the rationale on each value.
        const activeWindow = this._outputMode === "superdough"
            ? this.lateRefreshWindowSecondsSuperdough
            : this.lateRefreshWindowSeconds;
        const lateRefreshHorizon = audioNow + activeWindow;
        const snapshot = this._captureSnapshot(audioNow);

        for (const state of this._sources.values()) {
            const source = this._lookupSource(state);
            if (source === null) continue;
            // Mute gate. A muted source consumes no firings —
            // pending events are dropped and population is
            // skipped. Unmuting on the fly re-bootstraps on
            // the next tick from whatever cycle the
            // simulation is currently in, so unmute lands
            // cleanly on the next cycle boundary.
            if (source.mute === true) {
                state.pendingEvents = [];
                state.populatedCycles.clear();
                continue;
            }

            // Play Selected gate. When the mode is active,
            // only sources whose id is in _playSelectedIds
            // fire. Non-selected sources behave like muted
            // ones for the duration of the mode: pending
            // events drop, populatedCycles clears, and the
            // bootstrap path skips. Flipping the mode off
            // (via setPlaySelectedMode(false)) or selecting
            // a previously-gated source re-bootstraps it on
            // the next tick from its current cycle state.
            if (this._playSelectedMode && !this._playSelectedIds.has(state.id)) {
                state.pendingEvents = [];
                state.populatedCycles.clear();
                continue;
            }
            if (state.compiled === null) continue;

            const beatsPerCycle = typeof source.beatsPerCycle === "number"
                ? source.beatsPerCycle
                : 0;
            if (beatsPerCycle <= 0) continue;
            // Match simulation.js's cycleDurationSeconds:
            // resolve beatInterval to a quarter-note multiplier
            // so the audio clock and the cursor clock stay in
            // lockstep across any interval setting. An
            // unrecognised or missing token falls back to
            // "Qtr" (quarterNotes = 1), preserving the
            // pre-beatInterval formula for legacy/hand-edited
            // scenes that omit the field.
            const beatIntervalToken =
                (typeof source.beatInterval === "string" && source.beatInterval !== "")
                    ? source.beatInterval
                    : DEFAULT_BEAT_INTERVAL;
            const beatIntervalEntry = getBeatIntervalEntry(beatIntervalToken);
            const beatIntervalQuarters =
                beatIntervalEntry !== null ? beatIntervalEntry.quarterNotes : 1;
            const cycleDuration =
                (beatsPerCycle * beatIntervalQuarters * 60) / bpm;

            // patternRepeats: curve-only field controlling
            // how many copies of the strudel cycle's events
            // get laid out across one GXW cycle. Sprites
            // don't carry the field; missing or non-numeric
            // values fall back to 1. Defensive clamp to
            // integer >= 1 against hand-edited or AI-edited
            // scenes that might store a zero, negative, or
            // non-integer value. Pass into _populatePending
            // so the populate loop can multiply events
            // accordingly; cycleDuration itself is
            // unaffected (patternRepeats compresses N copies
            // of the pattern into the same wall-clock cycle
            // rather than extending it).
            const patternRepeats = (typeof source.patternRepeats === "number"
                && Number.isFinite(source.patternRepeats))
                ? Math.max(1, Math.round(source.patternRepeats))
                : 1;

            const cycleState = state.kind === "curve"
                ? this._simulation.getCurveCycleState(source.id)
                : this._simulation.getSpriteCycleState(source.id);
            if (cycleState === null) continue;

            const C = cycleState.cycleCount;

            // cycleSpeeds lookup. Curves carry per-cycle
            // speed via simulation.getCurveSpeedAt;
            // sprites use a fixed positive-unity speed. A
            // zero speed at the current cycle means the
            // curve halts on this cycle — drop pending
            // events and skip population, mirroring the
            // muted-source path. A zero speed at C+1
            // means we shouldn't pre-populate C+1 but the
            // current cycle still fires; nextHalts tracks
            // that case separately. Sprites never halt
            // here since cycleSpeeds is curve-only.
            let speedC = 1;
            let speedNext = 1;
            let nextHalts = false;
            if (state.kind === "curve") {
                const sC = this._simulation.getCurveSpeedAt(source.id, C);
                if (sC === 0) {
                    state.pendingEvents = [];
                    state.populatedCycles.clear();
                    continue;
                }
                if (typeof sC === "number" && sC !== 0) speedC = sC;
                const sN = this._simulation.getCurveSpeedAt(source.id, C + 1);
                if (sN === 0) {
                    nextHalts = true;
                } else if (typeof sN === "number") {
                    speedNext = sN;
                }
            }
            const effectiveDurationCurrent = cycleDuration / Math.abs(speedC);
            const effectiveDurationNext = cycleDuration / Math.abs(speedNext);
            const isReverseCurrent = speedC < 0;
            const isReverseNext = speedNext < 0;

            // Timing-edit cleanup. _reconcileSource set
            // timingDirty when beatsPerCycle, beatInterval,
            // or patternRepeats changed — any of the three
            // fields that affect cycleDuration or within-
            // cycle event spacing. Unlike patternDirty
            // (which preserves the current cycle's events
            // for a musical clean-boundary takeover), a
            // timing change requires dropping the CURRENT
            // cycle's events too: they were laid out at
            // the old timing's audioTimes, but the
            // simulation cursor advances at the new timing
            // from the moment of edit, so keeping them
            // would let the audio drift past the visual
            // cursor for the rest of the cycle. Drop
            // everything; let the bootstrap below
            // re-derive a virtual startC from
            // simulation's current cycleProgress and the
            // new cycleDuration. The re-derived anchor
            // matches simulation's hybrid wrap timing
            // (progress accrued before the edit at the
            // old rate, plus progress after at the new
            // rate), so both the current cycle's
            // re-populated remainder and the pre-populated
            // C+1 audioStart line up with where the cursor
            // will actually be.
            if (state.timingDirty) {
                state.pendingEvents = [];
                state.populatedCycles.clear();
                state.timingDirty = false;
            }

            // Pattern-edit cleanup. _reconcileSource set
            // patternDirty when the cyclePattern text
            // changed; the next tick (this one, if the
            // change happened in the last frame) drops
            // future-cycle events and future cycles from
            // populatedCycles so the populate calls below
            // generate fresh events from the new pattern.
            // Current-cycle events stay queued for the rest
            // of the cycle; Version B clean-takeover.
            if (state.patternDirty) {
                state.pendingEvents = state.pendingEvents.filter(
                    (e) => e.cycleIndex <= C,
                );
                for (const c of state.populatedCycles.keys()) {
                    if (c > C) state.populatedCycles.delete(c);
                }
                state.patternDirty = false;
            }

            // Prune old cycles from populatedCycles. Any
            // cycle index strictly less than the current
            // is firmly in the past; its events have either
            // been committed or dropped by the past-slack
            // guard in the commit walker. Pruning bounds
            // memory over long sessions; populatedCycles
            // would otherwise accumulate one entry per
            // cycle indefinitely.
            for (const c of state.populatedCycles.keys()) {
                if (c < C) state.populatedCycles.delete(c);
            }

            // Bootstrap the current cycle if not already
            // populated. This is the path the first detection
            // after Play takes, and also any tick after a
            // pattern edit dropped the current cycle (which
            // shouldn't happen since the filter above keeps
            // current-cycle events, but the populatedCycles
            // entry for C might still be missing after the
            // edit path — actually no, the filter above
            // drops only cycles > C, so C stays in the map.
            // The bootstrap path is specifically for fresh
            // start / resume from pause).
            //
            // cycleAudioStart uses the current cycle's
            // effective duration (base / |speedC|) so the
            // virtual cycle anchor matches where the cursor
            // will actually wrap, even when cycleSpeeds
            // compresses or expands wall-clock duration.
            if (!state.populatedCycles.has(C)) {
                const cycleAudioStart =
                    audioNow - cycleState.cycleProgress * effectiveDurationCurrent;
                state.populatedCycles.set(C, cycleAudioStart);
                this._populatePending(
                    state,
                    C,
                    cycleAudioStart,
                    effectiveDurationCurrent,
                    patternRepeats,
                    isReverseCurrent,
                );
            }

            // Pre-populate the next cycle if not yet done.
            // This is the timing fix: by scheduling cycle
            // C+1's events one cycle in advance, their
            // audioTimes (especially the position-zero
            // downbeat at cycleAudioStart_{C+1}) are in the
            // future when Web MIDI receives them, so they
            // fire at their exact intended times. Without
            // pre-population, the position-zero event of
            // each new cycle would be slightly in the past
            // at wrap-detection time and fire late (about
            // 25ms of detection lag), producing an audible
            // stutter at every cycle boundary.
            //
            // C+1's start time uses the CURRENT cycle's
            // effective duration (the current cycle
            // determines when the next begins); C+1's own
            // event layout uses its own effective duration
            // (cycle C+1's speed may differ from C's under
            // a multi-entry cycleSpeeds list). Skipped
            // entirely when nextHalts is true: a zero at
            // C+1 means the curve halts after the current
            // cycle, so there are no C+1 events to schedule.
            if (!state.populatedCycles.has(C + 1) && !nextHalts) {
                const startC = state.populatedCycles.get(C);
                if (typeof startC === "number") {
                    const cycleAudioStartNext = startC + effectiveDurationCurrent;
                    state.populatedCycles.set(C + 1, cycleAudioStartNext);
                    this._populatePending(
                        state,
                        C + 1,
                        cycleAudioStartNext,
                        effectiveDurationNext,
                        patternRepeats,
                        isReverseNext,
                    );
                }
            }

            // Late-refresh dispatch (Phase 3 substrate).
            // Pending events whose audio time is further
            // than the active late-refresh window in the
            // future stay pending; events within the window
            // get a Pass 2 refresh of any dynamic-signal-
            // dependent value fields (the firing-context
            // pointer is active during the re-query so
            // signal implementations can read snapshot
            // state) and dispatch immediately afterward.
            // The active window is 30ms for MIDI and 100ms
            // for superdough, reflecting the two output
            // paths' different scheduling semantics: MIDI
            // fires events at dispatch time so a larger
            // window would only delay firing, while
            // superdough schedules events sample-accurately
            // at their audioTime so a larger window buys
            // tighter audible timing. Events older than the
            // past-slack window get dropped silently —
            // those are genuinely stale, typically a resume
            // from pause where the simulation's cycleProgress
            // is well past the event's fractional position.
            // Events slightly in the past still dispatch:
            // MIDI fires them immediately via Web MIDI's
            // send-now semantics; superdough fires them at
            // "now" via the runtime.play wrapper's past-time
            // clamp (without which superdough would silently
            // drop past-timed events).
            /** @type {Array<{audioTime: number, value: any, duration: number, cycleIndex: number, fractional: number}>} */
            const remaining = [];
            for (const ev of state.pendingEvents) {
                if (ev.audioTime > lateRefreshHorizon) {
                    remaining.push(ev);
                } else if (ev.audioTime < audioNow - 0.2) {
                    // stale — drop without dispatch.
                } else {
                    const refreshedValue = this._pass2RefreshValue(state, ev, snapshot);
                    if (this._outputMode === "superdough") {
                        // Superdough path. Apply per-object
                        // voice soft-injection first so
                        // events from note() / n() patterns
                        // pick up the source's pitched-sound
                        // override (via the s field) and
                        // events from sound() patterns with
                        // raw drum names pick up the
                        // bank override. Explicit pattern
                        // values always win because the
                        // injection only fills missing
                        // fields; see applyVoiceInjection's
                        // docstring at the bottom of this
                        // file for the precise rules.
                        // Injection is a no-op when the
                        // source carries no voice.superdough
                        // subblock, returning the original
                        // value unchanged so events without
                        // an override keep their reference
                        // identity. Fire through the
                        // runtime's play wrapper, which
                        // gates internally on the runtime
                        // being loaded and the audio context
                        // being present; events arriving
                        // before the engine has finished
                        // init are silently dropped rather
                        // than queued. Duration is the
                        // strudel hap's part length in
                        // wall-clock seconds, which
                        // superdough uses to bound sample
                        // playback length.
                        const injectedValue = applyVoiceInjection(refreshedValue, source);
                        const voicedValue = applyVoiceEnvelope(injectedValue);
                        this._runtime.play(voicedValue, ev.audioTime, ev.duration);
                    } else {
                        this._midiSender.send(refreshedValue, ev.audioTime, ev.duration);
                    }
                    // Emit the firing-event signal for the
                    // canvas's yellow-flash visual feedback.
                    // Runs after the audio dispatch so a
                    // subscriber throw cannot leave the audio
                    // half-fired; the per-call try/catch
                    // isolates subscriber faults to the visual
                    // path. No-op when no subscriber is
                    // attached, which is the default state
                    // before main.js wires the canvas in.
                    if (this._onFiring !== null) {
                        try {
                            this._onFiring({
                                sourceId: state.id,
                                kind: state.kind,
                                absoluteFractional: ev.absoluteFractional,
                                audioTime: ev.audioTime,
                            });
                        } catch (err) {
                            console.warn(
                                "[firing] onFiring subscriber threw for " +
                                state.id + " cycle " + ev.cycleIndex + ":",
                                err,
                            );
                        }
                    }
                }
            }
            state.pendingEvents = remaining;
        }

        // Drive the midiSender's noteOff scheduler. Each
        // pending noteOff whose audio time has arrived
        // gets dispatched immediately. We call this after
        // the per-source commit loops so any noteOns
        // committed this tick that fall due immediately
        // (rare but possible for very short slot durations
        // or large negative-clip values) get their noteOff
        // fired in the same tick.
        this._midiSender.tick(audioNow);
    }

    /**
     * Internal: query the pattern for the given cycle index
     * and append events to pendingEvents with audioTimes
     * derived from the given cycleAudioStart. Used by tick()
     * for both the current cycle bootstrap and the one-
     * cycle-ahead pre-population.
     *
     * Events are appended (not replaced) so a tick that
     * populates both C and C+1 in one pass produces a unified
     * pendingEvents list sorted by audioTime. Existing
     * events from earlier populates (including the current
     * cycle's remaining events after a pattern edit) survive
     * the append.
     *
     * Cross-cycle modifiers (alternation, every, iter)
     * advance correctly because queryArc gets called with
     * the sequential cycle index. Stochastic patterns
     * (degradeBy, choose, rand, irand) are seeded by
     * strudel's internal hash over cycle counter and tag,
     * so the events for cycle N are deterministic.
     *
     * patternRepeats > 1 lays out N copies of the strudel
     * cycle's events across the GXW cycle. Each repeat
     * occupies effectiveDuration/N of wall-clock time and
     * plays the same events. The stored `fractional` on each
     * event is the strudel-cycle position (not the GXW-cycle
     * position), so Pass 2 queryArc lands on the correct
     * event within the strudel pattern; only the audioTime
     * differs between repeats. Default 1 reproduces the
     * pre-patternRepeats one-pass-through-the-pattern
     * behaviour exactly.
     *
     * cycleSpeeds (curves) shows up here in two ways. The
     * effectiveDuration parameter is baseCycleDuration /
     * |speed|, so a speed of 2 compresses the cycle's
     * events into half the wall-clock time with no pattern
     * modification needed. The isReverse parameter, true
     * when speed is negative, applies strudel's .rev()
     * operator to the compiled pattern before queryArc:
     * .rev() rewrites event positions within the cycle so
     * a hap originally at fractional f with duration d ends
     * up at (1 - f - d, 1 - f), which is exactly when the
     * reverse-moving cursor reaches that marker's span on
     * the curve. The fractional stored on each event is the
     * REVERSED-pattern position, which Pass 2 also queries
     * against the .rev()'d pattern so the same hap is
     * retrieved at refresh time.
     *
     * @param {SourceFiringState} state
     * @param {number} cycleIndex
     * @param {number} cycleAudioStart
     * @param {number} effectiveDuration  Wall-clock seconds for this cycle
     *                                     (baseCycleDuration / |speed|).
     * @param {number} patternRepeats
     * @param {boolean} isReverse  True if this cycle's cycleSpeeds entry is
     *                              negative; applies .rev() to the pattern.
     */
    _populatePending(state, cycleIndex, cycleAudioStart, effectiveDuration, patternRepeats, isReverse) {
        let haps;
        try {
            const queryPattern = isReverse ? state.compiled.rev() : state.compiled;
            haps = queryPattern.queryArc(cycleIndex, cycleIndex + 1);
        } catch (err) {
            console.warn(`[firing] queryArc failed for ${state.id}:`, err);
            return;
        }
        if (!Array.isArray(haps)) return;

        // Segment duration: each of the patternRepeats copies
        // occupies effectiveDuration/N of wall-clock time
        // within the GXW cycle. Event duration also scales
        // with the segment so a quarter-note within the
        // strudel cycle stays proportionally a quarter of
        // one repeat segment in wall-clock terms.
        const repeats = Math.max(1, Math.round(patternRepeats || 1));
        const segmentDuration = effectiveDuration / repeats;

        for (const hap of haps) {
            const begin = hapBegin(hap);
            const end = hapEnd(hap);
            if (!Number.isFinite(begin) || !Number.isFinite(end)) continue;
            // queryArc returns Haps with positions in the
            // queried range [cycleIndex, cycleIndex + 1).
            // Subtract cycleIndex to get fractional position
            // within this cycle, in [0, 1).
            const fractional = begin - cycleIndex;
            const fractionalEnd = end - cycleIndex;
            if (fractional < 0 || fractional >= 1) continue;
            const duration = Math.max(0, (fractionalEnd - fractional) * segmentDuration);
            // Lay out one event per repeat. The stored
            // fractional stays at the strudel-cycle position
            // so Pass 2's queryArc(cycleIndex + fractional,
            // ...) lands on the same hap regardless of which
            // copy is firing; only audioTime varies between
            // repeats. cycleIndex also stays the same: the
            // strudel cycle counter advances once per GXW
            // cycle (not once per repeat), so cross-cycle
            // operators keep their natural cadence.
            for (let i = 0; i < repeats; i++) {
                const audioTime = cycleAudioStart + (i + fractional) * segmentDuration;
                state.pendingEvents.push({
                    audioTime,
                    value: hap.value,
                    duration,
                    cycleIndex,
                    fractional,
                    // GXW-cycle position in [0, 1). For
                    // patternRepeats=1 this equals
                    // fractional; for N > 1 each repeat
                    // copy gets a distinct value so the
                    // canvas's firing-event subscriber can
                    // pick out the specific beat-point
                    // diamond that fired (each diamond's
                    // own position in _curveMarkerPositions
                    // is laid out as (i + p) / N). Carried
                    // on the event rather than recomputed
                    // at dispatch because dispatch sees only
                    // the event, not the populate-time
                    // i and repeats.
                    absoluteFractional: (i + fractional) / repeats,
                });
            }
        }
        // Keep pendingEvents sorted by audioTime so the
        // commit walker sees events in time order. With
        // multi-cycle populates and pattern-edit filters
        // the natural ordering would otherwise mix cycles.
        state.pendingEvents.sort((a, b) => a.audioTime - b.audioTime);
    }

    /**
     * Internal: look up the live source object (curve or
     * sprite) for a firing state. Returns null if the
     * source has been removed from the scene since the
     * setScene call that registered it — possible during
     * the brief window between scene mutation and the
     * setScene reconciliation that drops the dropped id
     * from the cache. The tick caller skips silently in
     * that case.
     *
     * @param {SourceFiringState} state
     * @returns {any}
     */
    _lookupSource(state) {
        if (this._scene === null) return null;
        const arr = state.kind === "curve" ? this._scene.curves : this._scene.sprites;
        for (const obj of arr) {
            if (obj !== null && typeof obj === "object" && obj.id === state.id) {
                return obj;
            }
        }
        return null;
    }

    /**
     * Capture a per-tick snapshot of simulation state for
     * the dynamic-signal substrate (Phase 3). Dynamic-
     * signal definitions landing in Phase 4 read from this
     * snapshot via the firing-context pointer during Pass 2
     * refresh, so the value they emit reflects simulation
     * state at near-audio-time rather than at population
     * time. Capturing once per tick (rather than per event)
     * gives every Pass 2 within a single tick a consistent
     * view; with tick running right after simulation.tick
     * in the canvas's render loop, the snapshot is also
     * free of any live mutation that could race with reads.
     *
     * The snapshot copies primitive values (numbers) out of
     * the simulation's runtime state into a fresh per-entry
     * object. References to mutable structures (like the
     * live SpriteRuntimeState that getSpriteRuntime
     * returns) are NOT held; the read-only contract of the
     * snapshot is enforced by composition rather than by
     * Object.freeze, which would impose a per-tick cost for
     * no extra safety here.
     *
     * Sources with no current simulation state (briefly
     * possible during scene reload) are omitted from the
     * sources Map; signals consulting the snapshot for a
     * missing source should fall back to a safe default.
     *
     * Phase 3 captured only the fields the substrate needed
     * for testability without any signals defined; Phase 4
     * extended this to compute each source's canvas-space
     * firing position (sprite position direct from runtime,
     * curve cursor position derived from t plus geometry via
     * canvas.getCurveCursorCanvasPosition) and sample the
     * image's precomputed OKLCh buffer at that position via
     * canvas.sampleImageOKLCh. The imageOKLCh field is the
     * substrate that pxLt and its OKLCh siblings read at
     * Pass 2 refresh time. The sampling is per-source and
     * per-tick rather than per-event, so multiple events
     * from the same source within one tick see the same
     * OKLCh value, which is the consistent-frozen-view
     * property the snapshot abstraction is meant to give.
     *
     * @param {number} audioNow
     * @returns {import("./firingContext.js").FiringSnapshot}
     */
    _captureSnapshot(audioNow) {
        /** @type {Map<string, import("./firingContext.js").FiringSnapshotEntry>} */
        const sources = new Map();
        for (const state of this._sources.values()) {
            if (state.kind === "curve") {
                const cycleState = this._simulation.getCurveCycleState(state.id);
                if (cycleState === null) continue;
                // Curves need canvas-space xy derived from
                // their cursor t plus geometry. Skip the
                // entry when no canvas is attached or the
                // curve has no resolvable position; image-
                // colour signals on this source then fall
                // back to their no-context default rather
                // than reading from a missing entry.
                const cursorPos = this._canvas === null
                    ? null
                    : this._canvas.getCurveCursorCanvasPosition(state.id);
                if (cursorPos === null) continue;
                const imageOKLCh = this._canvas === null
                    ? null
                    : this._canvas.sampleImageOKLCh(cursorPos.x, cursorPos.y);
                sources.set(state.id, {
                    kind: "curve",
                    cycleCount: cycleState.cycleCount,
                    cycleProgress: cycleState.cycleProgress,
                    t: this._simulation.getCurveCursorT(state.id),
                    x: cursorPos.x,
                    y: cursorPos.y,
                    imageOKLCh,
                });
            } else {
                const cycleState = this._simulation.getSpriteCycleState(state.id);
                const runtime = this._simulation.getSpriteRuntime(state.id);
                if (cycleState === null || runtime === null) continue;
                const imageOKLCh = this._canvas === null
                    ? null
                    : this._canvas.sampleImageOKLCh(runtime.x, runtime.y);
                sources.set(state.id, {
                    kind: "sprite",
                    cycleCount: cycleState.cycleCount,
                    cycleProgress: cycleState.cycleProgress,
                    x: runtime.x,
                    y: runtime.y,
                    vx: runtime.vx,
                    vy: runtime.vy,
                    imageOKLCh,
                });
            }
        }
        return { audioNow, sources };
    }

    /**
     * Pass 2 of the two-pass evaluation. Re-query the
     * pattern for a tiny range around an event's fractional
     * position with the firing-context pointer active, and
     * return the value field to use for MIDI dispatch.
     * Pass 1 (at _populatePending time) established the
     * event's structure (audioTime, duration, cycleIndex,
     * channel, note number, static-signal value fields);
     * this Pass 2 refreshes any value fields that read
     * dynamic signals through the firing-context pointer.
     *
     * Fallback shape per section 27's resolved-design-task
     * #2 ("Pass 2 edge cases"): trust Pass 1's structure
     * absolutely. If Pass 2 returns exactly one Hap, use
     * its value; if Pass 2 returns zero Haps, more than one
     * Hap, or throws, fall back to the Pass 1 value already
     * on the event. This keeps the schedule deterministic
     * relative to cycle-start state and isolates dynamic-
     * signal influence to value fields, which is the
     * intended behaviour.
     *
     * The withFiringContext helper enforces try-finally
     * around the queryArc call so a throw cannot strand the
     * pointer; the local try/catch here catches the throw
     * after the pointer has already been cleared by
     * withFiringContext's finally block.
     *
     * Phase 3 has no dynamic signal definitions, so for
     * every existing pattern Pass 2 returns the same value
     * as Pass 1 and the dispatch is functionally identical
     * to the pre-Phase-3 commit path. Running the query
     * anyway exercises the substrate continuously; any
     * regression in queryArc semantics, firing-context
     * mechanics, or snapshot construction surfaces here
     * rather than waiting for Phase 4's first signal to
     * make it audible.
     *
     * @param {SourceFiringState} state
     * @param {{audioTime: number, value: any, duration: number, cycleIndex: number, fractional: number}} ev
     * @param {import("./firingContext.js").FiringSnapshot} snapshot
     * @returns {any}
     */
    _pass2RefreshValue(state, ev, snapshot) {
        if (state.compiled === null) return ev.value;
        const begin = ev.cycleIndex + ev.fractional;
        const PASS2_EPSILON = 1e-6;
        const end = begin + PASS2_EPSILON;
        // Reverse-direction cycles use the .rev()'d pattern
        // for the re-query so the same hap Pass 1 saw is
        // retrieved. The stored fractional is already the
        // reversed-pattern position; querying the .rev()'d
        // pattern at the same range lands on it. Curve-only;
        // sprites never reverse.
        let isReverse = false;
        if (state.kind === "curve") {
            const speed = this._simulation.getCurveSpeedAt(state.id, ev.cycleIndex);
            if (typeof speed === "number" && speed < 0) {
                isReverse = true;
            }
        }
        /** @type {import("./firingContext.js").FiringContext} */
        const ctx = {
            sourceId: state.id,
            kind: state.kind,
            audioTime: ev.audioTime,
            snapshot,
        };
        let haps;
        try {
            const queryPattern = isReverse ? state.compiled.rev() : state.compiled;
            haps = withFiringContext(ctx, () => queryPattern.queryArc(begin, end));
        } catch (err) {
            console.warn(
                "[pass2] queryArc threw for " + state.id +
                " cycle " + ev.cycleIndex +
                " frac " + ev.fractional.toFixed(4) +
                "; falling back to Pass 1 value.",
                err,
            );
            return ev.value;
        }
        if (!Array.isArray(haps) || haps.length !== 1) {
            if (LOG_PASS2) {
                const n = Array.isArray(haps) ? String(haps.length) : "non-array";
                console.log(
                    "[pass2] " + state.id +
                    " cycle " + ev.cycleIndex +
                    " frac " + ev.fractional.toFixed(4) +
                    ": " + n + " haps from re-query, " +
                    "falling back to Pass 1 value.",
                );
            }
            return ev.value;
        }
        const refreshed = haps[0].value;
        if (LOG_PASS2) {
            const noteStr = (refreshed !== null && typeof refreshed === "object" && typeof refreshed.note === "string")
                ? refreshed.note
                : "(no note)";
            console.log(
                "[pass2] " + state.id +
                " cycle " + ev.cycleIndex +
                " frac " + ev.fractional.toFixed(4) +
                " -> " + noteStr,
            );
        }
        return refreshed;
    }
}

/**
 * Read the begin field from a strudel Hap. Mirrors the
 * helper in patternParse.js: whole.begin preferred, part.begin
 * as fallback, NaN when neither is present.
 *
 * @param {any} hap
 * @returns {number}
 */
function hapBegin(hap) {
    if (hap === null || typeof hap !== "object") return NaN;
    if (hap.whole && typeof hap.whole === "object" && "begin" in hap.whole) {
        return Number(hap.whole.begin);
    }
    if (hap.part && typeof hap.part === "object" && "begin" in hap.part) {
        return Number(hap.part.begin);
    }
    return NaN;
}

/**
 * Read the end field from a strudel Hap. Mirrors hapBegin
 * with the matching whole.end / part.end fields. Used to
 * compute per-event duration in wall-clock seconds for
 * superdough, which the spike confirmed accepts a duration
 * argument and uses it to bound sample playback length.
 *
 * @param {any} hap
 * @returns {number}
 */
function hapEnd(hap) {
    if (hap === null || typeof hap !== "object") return NaN;
    if (hap.whole && typeof hap.whole === "object" && "end" in hap.whole) {
        return Number(hap.whole.end);
    }
    if (hap.part && typeof hap.part === "object" && "end" in hap.part) {
        return Number(hap.part.end);
    }
    return NaN;
}

/**
 * Soft-inject the per-object superdough voice fields into
 * an outgoing Hap value. Two injection paths, both gated
 * on the field being absent in the source value so
 * explicit pattern values always win:
 *
 *   - Pitched sound: when the value has no `s` field and
 *     the source carries voice.superdough.sound, fill
 *     value.s with the sound. Targets events from note()
 *     and n() patterns, which produce values like
 *     {note: "c4"} or {n: 0} without an s field. Once
 *     filled, superdough renders the note through the
 *     named sample/synth (e.g. "piano" for the Salamander
 *     Grand, "gm_marimba" for the GM marimba patch,
 *     "sawtooth" for the built-in oscillator).
 *
 *   - Unpitched bank: when the value's `s` field is a
 *     raw drum name without an underscore and the source
 *     carries voice.superdough.bank, set value.bank to
 *     the bank. Targets events from sound() patterns like
 *     sound("bd sn") whose s field is a raw drum name;
 *     the bank field then makes superdough resolve
 *     "bd" to "RolandTR909_bd" (etc.) at sample lookup
 *     time. An s field that already contains an
 *     underscore ("RolandTR808_bd") is treated as a
 *     pre-banked name and left alone, matching strudel's
 *     own .bank() operator semantics.
 *
 * Returns the value unchanged (by reference) when no
 * injection applies, so events without an override keep
 * their reference identity. Returns a shallow-copied new
 * object only when at least one field is injected, so
 * the original value Hap from strudel's queryArc is
 * never mutated.
 *
 * Called from the superdough dispatch branch in tick().
 * Not called on the MIDI path because MIDI events use
 * value.note / value.midichan and not value.s or
 * value.bank; the per-object MIDI voice fields will land
 * as a separate path in a later commit.
 *
 * @param {any} value   The strudel Hap value about to dispatch.
 * @param {any} source  The per-object scene source (Curve, Trigger, or Sprite).
 * @returns {any}
 */
function applyVoiceInjection(value, source) {
    if (source === null || typeof source !== "object") return value;
    const voice = source.voice;
    if (voice === null || typeof voice !== "object" || Array.isArray(voice)) return value;
    const superdough = voice.superdough;
    if (superdough === null || typeof superdough !== "object" || Array.isArray(superdough)) return value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

    let out = value;
    let copied = false;

    const sound = superdough.sound;
    if (typeof sound === "string" && sound.length > 0 && !("s" in out)) {
        out = { ...out, s: sound };
        copied = true;
    }

    const bank = superdough.bank;
    if (typeof bank === "string" && bank.length > 0
        && typeof out.s === "string" && !out.s.includes("_")) {
        if (!copied) { out = { ...out }; copied = true; }
        out.bank = bank;
    }

    if (LOG_VOICE && copied) {
        const sStr = typeof out.s === "string" ? out.s : "(none)";
        const bankStr = typeof out.bank === "string" ? out.bank : "(none)";
        console.log(
            "[voice] " + (typeof source.id === "string" ? source.id : "?") +
            " injected s=" + sStr + " bank=" + bankStr,
        );
    }

    return out;
}

/**
 * Apply the per-instrument amplitude envelope to an
 * outgoing superdough Hap value, keyed by the value's
 * resolved `s` field (the sound name after
 * applyVoiceInjection has filled any per-object voice
 * override). Fills decay, sustain, and release from the
 * VOICE_ENVELOPES entry for that sound, but only for
 * fields the pattern has not already set itself, so an
 * explicit `.release(0.4)` (or any envelope control) in
 * the pattern always wins over the table default. See
 * VOICE_ENVELOPES for why the envelope is needed and how
 * the values were chosen.
 *
 * Returns the value unchanged (by reference) when the
 * sound has no envelope entry — the built-in oscillators,
 * the noise sources, drum samples, and any unrecognised
 * name all pass through untouched. Returns a shallow-
 * copied new object only when at least one envelope field
 * is injected, so the value object from the injection
 * step (or from strudel's queryArc, when no injection
 * happened) is never mutated.
 *
 * Superdough-path only. The MIDI path does not call this:
 * a MIDI instrument damps through its own note-off, which
 * the MIDI sender already drives, so imposing an envelope
 * there would be both meaningless (MIDI carries no ADSR
 * in these events) and wrong (it would double the
 * instrument's own damping).
 *
 * @param {any} value  The strudel Hap value about to dispatch (post-injection).
 * @returns {any}
 */
function applyVoiceEnvelope(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const sound = value.s;
    if (typeof sound !== "string") return value;
    const env = /** @type {any} */ (VOICE_ENVELOPES)[sound];
    if (env === undefined) return value;

    let out = value;
    let copied = false;
    for (const field of ["attack", "decay", "sustain", "release"]) {
        if (!(field in env)) continue;
        if (field in out) continue;
        if (!copied) { out = { ...out }; copied = true; }
        out[field] = env[field];
    }
    return out;
}
