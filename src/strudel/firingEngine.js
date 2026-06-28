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
import { BASS_SOUND_NAMES } from "./bassSamples.js";
import { flushNoteTaps, clearNoteTaps } from "./debugTap.js";

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
 * Default total duration in seconds for a procedural
 * playNote call that omits the duration argument. The
 * duration is the whole window the note occupies, envelope
 * tail included; a short default keeps an unspecified note
 * from ringing long. Tunable by feel; a procedural note is
 * not beat-quantized, so this is wall-clock seconds rather
 * than a musical division.
 */
const DEFAULT_PLAYNOTE_DURATION_SECONDS = 0.25;

/**
 * Forward scheduling lookahead in seconds for an immediate
 * procedural fire (fireImmediateNote / fireImmediateSound).
 * The dispatch time is currentTime plus this, never exactly
 * currentTime. superdough lets Web Audio schedule an event
 * sample-accurately at its timestamp, but a timestamp at or
 * behind currentTime gives the audio engine no headroom: the
 * event competes with whatever JS-scheduler jitter exists at
 * that instant and the occasional note is dropped (the
 * symptom of a missed note at random). The pattern path never
 * hits this because its event times sit ahead on the cycle
 * grid; the play() wrapper's past-time clamp also pins a late
 * time to currentTime, which is the same headroom-less case.
 * 30ms comfortably clears a dropped frame and a typical Web
 * Audio output buffer while staying well below the perceptual
 * threshold for a non-quantized procedural note, so a motion-
 * or collision-triggered note still reads as prompt. Bump it
 * if drops persist on a given machine.
 */
const IMMEDIATE_FIRE_LOOKAHEAD_SECONDS = 0.03;

/**
 * Same-pitch coincidence-suppression window (seconds). When two notes
 * of the SAME pitch are scheduled within this window of each other,
 * only the first sounds; the second is dropped. Two identical pitches
 * firing together sum constructively (pure amplitude doubling, +6 dB) —
 * the worst case for clipping — and on MIDI a second note-on for a note
 * number already sounding on the channel cuts the first. This happens
 * when two objects share a callback and land on the same quantized
 * note, and when a single beat-point crossing fires twice at a cycle
 * boundary. The window is well under any real note spacing (a 32nd at
 * 240 BPM is ~31 ms), so it never suppresses a genuine fast repeat —
 * only near-simultaneous duplicates.
 */
const SAME_PITCH_SUPPRESS_WINDOW_SECONDS = 0.01;

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
const LOG_VOICE = false;

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
    // CC0 multisampled basses: the same gentle sampled-instrument shape (high
    // sustain so the recorded note isn't truncated, short release), generated
    // from the names set so it stays in sync with bassSamples.js.
    ...Object.fromEntries(
        [...BASS_SOUND_NAMES].map((n) => [n, { decay: 0.1, sustain: 0.9, release: 0.15 }]),
    ),
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

        /**
         * Last scheduled audio-context fire time per pitch, for
         * same-pitch coincidence suppression (see
         * SAME_PITCH_SUPPRESS_WINDOW_SECONDS and fireImmediateNote).
         * Key is the pitch as a string (MIDI number or note name);
         * value is the most recent scheduled fireTime. Cleared on scene
         * swap and output-mode change so stale future times from a
         * previous run can't wrongly suppress after a rewind/reload.
         * @type {Map<string, number>}
         */
        this._recentPitchFireTimes = new Map();

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
         * One extra source id that may fire under Play Selected
         * mode because the pointer is currently hovering it, in
         * addition to _playSelectedIds. Set by main.js from the
         * canvas hover handler (the committed hover target's id,
         * or null when nothing is hovered) so that, while the
         * toggle is on, hovering an object auditions it on top of
         * the selected set. Transient: cleared (null) the moment
         * the pointer leaves the object. Ignored when
         * _playSelectedMode is false.
         * @type {string | null}
         */
        this._playSelectedHoverId = null;

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

        /**
         * Seam tail-suppression boundary, in master-clock beats
         * from the current reset, or null for no repeating seam.
         * Stored by setSeamBoundary but not yet read by any fire
         * path (see the TODO on setSeamBoundary — the tail-clip is
         * pending re-implementation on the procedural fire path).
         * main.js sets it via setSeamBoundary on each looping
         * audition pass (and clears it on a one-shot / stop); the
         * future arrangement layer will set it per segment. Keyed
         * off boundary TIME, not Loop specifically, so the guard
         * is reusable.
         * @type {number | null}
         */
        this._seamBoundaryBeats = null;

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
        this._recentPitchFireTimes.clear();
        if (wasMidi) {
            this._midiSender.panic();
        }
    }

    /**
     * Decide whether to suppress THIS note as a same-pitch coincidence.
     * Returns true when a note of the same pitch was already scheduled
     * within SAME_PITCH_SUPPRESS_WINDOW_SECONDS of this one's fire time;
     * in that case the caller drops the audio. Otherwise records this
     * pitch's fire time as the new anchor and returns false. A burst of
     * same-pitch notes inside one window collapses to the first (the
     * anchor isn't advanced by a suppressed note), while a genuine
     * later repeat (outside the window) is allowed and re-anchors.
     * @param {number | string} note  The pitch (MIDI number or name).
     * @param {number} fireTime  The scheduled audio-context time.
     * @returns {boolean}
     */
    _suppressDuplicatePitch(note, fireTime) {
        const key = String(note);
        const last = this._recentPitchFireTimes.get(key);
        if (last !== undefined
            && Math.abs(fireTime - last) < SAME_PITCH_SUPPRESS_WINDOW_SECONDS) {
            return true;
        }
        this._recentPitchFireTimes.set(key, fireTime);
        return false;
    }

    /**
     * Set the seam tail-suppression boundary. Pass the repeating
     * seam's position in master-clock beats from the current reset
     * (the audition Loop length now; a segment's stored beat-length
     * later) to arm the guard, or null/0 to disarm it (one-shot
     * pass, terminal segment, or stopped) so tails ring out
     * naturally. While armed, tick() suppresses any note whose tail
     * would overrun the boundary into the next pass.
     * @param {number | null} beats
     */
    setSeamBoundary(beats) {
        // TODO: the seam tail-clip is not currently applied to the
        // procedural fire path — setSeamBoundary stores the boundary
        // but nothing reads it yet (re-implement on fireImmediateNote
        // when the audition seam-clip is rebuilt).
        this._seamBoundaryBeats =
            (typeof beats === "number" && Number.isFinite(beats) && beats > 0)
                ? beats
                : null;
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
     * Set (or clear, with null) the single hovered source id that
     * may also fire while Play Selected mode is on. Called by
     * main.js whenever the canvas's committed hover target changes,
     * so hovering an object auditions it in addition to the
     * selected set; passing null on hover-leave drops it back out.
     * No audible effect while the mode is off.
     *
     * @param {string | null} id
     */
    setPlaySelectedHoverId(id) {
        this._playSelectedHoverId = typeof id === "string" ? id : null;
    }

    /**
     * Whether a source may sound under the current Play Selected
     * ("solo") state. True for every source when the mode is off;
     * when on, true only for sources in the selected set (plus the
     * single hovered source, if any, so hovering auditions an object
     * on top of the selection). Used to
     * gate the procedural audio sink (callback playNote / playSound)
     * so soloing silences non-selected objects while they keep
     * simulating — the GeoSonixV2 firing path is callbacks, not the
     * legacy pattern path this mode originally gated.
     * @param {string} sourceId
     * @returns {boolean}
     */
    playSelectedAllows(sourceId) {
        if (!this._playSelectedMode) return true;
        return this._playSelectedIds.has(sourceId)
            || sourceId === this._playSelectedHoverId;
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
     * Fire a single pitched note immediately, dispatched a few
     * milliseconds ahead of the current audio time (see
     * IMMEDIATE_FIRE_LOOKAHEAD_SECONDS) through whichever output
     * mode is active. This is the procedural-note primitive behind the
     * onTick context's ctx.playNote (Section 30); a later
     * collision-callback path will reuse it. Unlike a
     * cyclePattern's events it is NOT beat-quantized — it sounds
     * the moment the callback fires — and it routes into the
     * same output layer the patterns use, so a callback note
     * sounds identical to that object's pattern notes.
     *
     * The spec carries the playNote arguments: sound (the
     * superdough instrument name, ignored on MIDI), note (a
     * MIDI number or note name), amplitude (0..1 gain), duration
     * (the total note window in seconds), and articulation (the
     * gate — how long the note holds before damping begins).
     *
     * Duration / articulation model. The duration is the whole
     * window the note occupies. The gate is the articulation,
     * defaulting to the full duration. On the superdough path
     * the gate is the held length passed to play() and the
     * release tail fills the remainder (duration minus gate),
     * so the note sums back to the total duration; with no
     * articulation the gate is the full duration and the
     * instrument table's short release damps it, matching an
     * ordinary pattern note. On the MIDI path the note-off
     * fires at the gate and the external synth supplies its own
     * release tail, so the beyond-gate portion isn't shaped
     * here. Channel defaults to 1 (no channel argument yet).
     *
     * No-ops when the engine isn't loaded, the audio context is
     * missing, the spec is malformed, or the note field is
     * neither a finite number nor a non-empty string.
     *
     * @param {string} sourceId  Id of the object whose callback fired.
     * @param {any} spec  { sound?, note, amplitude?, duration?, articulation? }.
     */
    fireImmediateNote(sourceId, spec) {
        if (spec === null || typeof spec !== "object") return;
        if (this._runtime.status !== "loaded") return;
        const audioCtx = this._runtime.audioContext;
        if (audioCtx === null) return;
        // Schedule at the note's exact stamped audio time when the
        // look-ahead scheduler supplied one (§3.6) — the sim ran ahead
        // of the playhead, so this is a precise upcoming time — clamped
        // to currentTime so a sim that fell behind never schedules in
        // the past. With no stamp, fall back to a small fixed forward
        // lookahead so superdough has scheduling headroom.
        const fireTime = (typeof spec.audioTime === "number" && Number.isFinite(spec.audioTime))
            ? Math.max(spec.audioTime, audioCtx.currentTime)
            : audioCtx.currentTime + IMMEDIATE_FIRE_LOOKAHEAD_SECONDS;

        // Pitch: a finite number is a MIDI note, a non-empty
        // string is a note name; both output paths understand
        // either. Anything else has nothing to play.
        const rawNote = spec.note;
        /** @type {number | string} */
        let noteField;
        if (typeof rawNote === "number" && Number.isFinite(rawNote)) {
            noteField = rawNote;
        } else if (typeof rawNote === "string" && rawNote.length > 0) {
            noteField = rawNote;
        } else {
            return;
        }

        const duration = (typeof spec.duration === "number"
            && Number.isFinite(spec.duration) && spec.duration > 0)
            ? spec.duration
            : DEFAULT_PLAYNOTE_DURATION_SECONDS;
        const hasArticulation = typeof spec.articulation === "number"
            && Number.isFinite(spec.articulation) && spec.articulation > 0;
        let gate = hasArticulation ? spec.articulation : duration;
        if (gate > duration) gate = duration;
        const release = duration - gate;

        /** @type {any} */
        const value = { note: noteField };
        if (typeof spec.amplitude === "number" && Number.isFinite(spec.amplitude)) {
            value.gain = spec.amplitude;
        }
        const sound = (typeof spec.sound === "string" && spec.sound.length > 0)
            ? spec.sound
            : null;
        if (sound !== null) value.s = sound;
        // Per-note stereo pan (§3.3), superdough only. Passed through
        // as the value's pan field; MIDI has no per-note pan so it is
        // ignored on that path. Carried for both the explicit
        // positional/options pan and left unset otherwise.
        if (typeof spec.pan === "number" && Number.isFinite(spec.pan)) {
            value.pan = spec.pan;
        }

        // Same-pitch coincidence suppression. If a note of this pitch
        // is already scheduled within the window, drop THIS one's audio
        // — two identical pitches together sum constructively and clip
        // (and on MIDI the second note-on steals the first). The visual
        // beat-point flash below still fires, so the beat is still shown
        // even though its duplicate audio was suppressed.
        const suppressed = this._suppressDuplicatePitch(noteField, fireTime);

        if (!suppressed && this._outputMode === "superdough") {
            // An early gate (articulation shorter than the
            // duration) sets the release tail explicitly so it
            // spans the remainder; a full-duration gate leaves
            // release unset so applyVoiceEnvelope fills the
            // instrument table's short default, reproducing the
            // ordinary pattern-note damp.
            if (hasArticulation && release > 0) {
                value.release = release;
            }
            const source = this._findSourceById(sourceId);
            const globalVoice = this._scene !== null ? this._scene.voiceSuperdough : null;
            const injected = applyVoiceInjection(value, source, globalVoice);
            // Lazy-load the resolved instrument's sample map
            // (e.g. the VCSL map a marimba needs) the same way
            // the pattern path and the inspector dropdown do.
            // Without this an explicit sound arg that isn't a
            // startup-loaded instrument stays silent until
            // something else triggers the load. Idempotent and
            // fire-and-forget: the per-name audio still lazy-
            // loads, so the very first hit on a fresh instrument
            // can be silent while the map fetches, then sounds.
            // Reads the post-injection s/bank so an omitted sound
            // arg that falls through to the object or global
            // voice is covered too.
            if (typeof this._runtime.ensureSamplesForVoice === "function") {
                this._runtime.ensureSamplesForVoice(injected.s, injected.bank);
            }
            const voiced = applyVoiceEnvelope(injected);
            this._runtime.play(voiced, fireTime, gate);
        } else if (!suppressed) {
            // MIDI: send() sets the note-off at audioTime +
            // duration * (value.clip ?? 1). This procedural value
            // carries no clip field, so passing the gate as the
            // duration puts the note-off exactly at now + gate
            // (the articulation point); the synth's own release
            // plays the tail.
            this._midiSender.send(value, fireTime, gate);
        }

        // Drive the same firing-event flash the pattern path
        // uses, so a procedural note flashes its source red
        // (the sprite outline, via Canvas.markFiredSprite) just
        // like a pattern event does. Emitted after dispatch so a
        // subscriber throw can't strand a half-fired note; the
        // try/catch isolates a buggy visual subscriber. The
        // procedural fire isn't tied to a beat-point position,
        // so absoluteFractional is 0 — the sprite flash is a
        // timestamped fade keyed by sourceId and ignores it.
        this._emitFiring(sourceId);
    }

    /**
     * Fire a single sample immediately through the superdough
     * output, dispatched a few milliseconds ahead of the current
     * audio time (see IMMEDIATE_FIRE_LOOKAHEAD_SECONDS). The
     * procedural-sample primitive behind the onTick context's
     * ctx.playSound (Section 30).
     *
     * Silent under MIDI by design: a raw drum sample carries no
     * MIDI note, so there is nothing to send. Percussion through
     * MIDI is played with playNote and a percussion note number
     * instead.
     *
     * The spec carries the playSound arguments: bank (the
     * drum-machine kit name, e.g. "RolandTR909"; omit for the
     * default dirt-samples kit), sample (the sample name, e.g.
     * "bd"), and amplitude (0..1 gain). The bank resolves a raw
     * sample name against the kit at superdough lookup time,
     * mirroring strudel's .bank() semantics; a pre-banked name
     * already carrying an underscore is left alone. The bank's
     * sample map is requested through the runtime so its audio
     * lazy-loads — the first hit on a freshly-named bank can be
     * silent while the map fetches, then sounds from then on.
     *
     * One-shot: no duration argument, so superdough plays the
     * sample's natural length. Drum samples damp on their own,
     * so no synthetic envelope is applied (unlike the pitched
     * note path).
     *
     * No-ops when not in superdough mode, the engine isn't
     * loaded, the audio context is missing, the spec is
     * malformed, or no sample name is given.
     *
     * @param {string} sourceId  Id of the object whose callback fired.
     * @param {any} spec  { bank?, sample, amplitude? }.
     */
    fireImmediateSound(sourceId, spec) {
        if (spec === null || typeof spec !== "object") return;
        if (this._outputMode !== "superdough") return;
        if (this._runtime.status !== "loaded") return;
        const audioCtx = this._runtime.audioContext;
        if (audioCtx === null) return;
        // Look-ahead audio time when stamped (clamped to now), else the
        // small fixed forward lookahead. See fireImmediateNote.
        const fireTime = (typeof spec.audioTime === "number" && Number.isFinite(spec.audioTime))
            ? Math.max(spec.audioTime, audioCtx.currentTime)
            : audioCtx.currentTime + IMMEDIATE_FIRE_LOOKAHEAD_SECONDS;

        const sample = (typeof spec.sample === "string" && spec.sample.length > 0)
            ? spec.sample
            : null;
        if (sample === null) return;
        const bank = (typeof spec.bank === "string" && spec.bank.length > 0)
            ? spec.bank
            : null;

        /** @type {any} */
        const value = { s: sample };
        if (typeof spec.amplitude === "number" && Number.isFinite(spec.amplitude)) {
            value.gain = spec.amplitude;
        }
        if (bank !== null && !sample.includes("_")) value.bank = bank;

        if (typeof this._runtime.ensureSamplesForVoice === "function") {
            this._runtime.ensureSamplesForVoice(
                sample, bank === null ? undefined : bank);
        }

        this._runtime.play(value, fireTime);

        // Flash the source red, same as the note path and the
        // pattern path. See fireImmediateNote for the rationale
        // on emitting after dispatch and on absoluteFractional.
        this._emitFiring(sourceId);
    }

    /**
     * Fire a raw strudel Hap value immediately, dispatched a few
     * milliseconds ahead of the current audio time, through the
     * SAME voice + output path the pattern uses. The primitive
     * behind a curve beenTriggered's ctx.playMarker: it sounds a struck
     * marker's own pattern event (the value the cyclePattern
     * assigned at that beat position) so it plays exactly as the
     * curve would have fired it.
     *
     * The value is the native superdough Hap value — {s:"bd"},
     * {note:60}, {note:"c4", s:"piano", gain:0.7}, etc. It carries
     * its own type, so a drum value plays the drum and a pitched
     * value plays the note with no branching here. On the
     * superdough path the value runs through applyVoiceInjection
     * (filling the source's per-object / global voice into a
     * missing s or bank, just like the pattern dispatch) and
     * applyVoiceEnvelope before play(); on the MIDI path it goes
     * straight to midiSender.send (a drum value with no note is
     * silent there, matching the pattern path).
     *
     * amplitude, when a finite number, overrides the value's gain
     * (the typical use is mapping a collision's hitSpeed to
     * loudness). durationSeconds bounds the note window; it
     * defaults to the immediate-fire default and is passed to the
     * output as the play / note-off length.
     *
     * The incoming value is shallow-copied before any field is
     * set, so the cached marker value the canvas reuses is never
     * mutated. No-ops when the engine isn't loaded, the audio
     * context is missing, or the value isn't a usable object.
     *
     * @param {string} sourceId  Id of the curve whose marker was struck.
     * @param {any} value  The struck marker's strudel Hap value.
     * @param {number} [durationSeconds]
     * @param {number} [amplitude]
     */
    /**
     * Play a short metronome click — a brief blip used as an audible
     * cue during the audition: a fainter one on every beat, a louder
     * one (the default volume) on each loop restart. Synthesised
     * directly on the audio context (a ~1 kHz tone with a fast decay)
     * so it needs no loaded sample and is independent of the score's
     * voices and the output mode. No-op when the audio runtime isn't
     * loaded. Scheduled a hair ahead (the immediate-fire lookahead) so
     * the envelope start isn't clipped by the current audio time.
     * @param {number} [volume]  Peak gain of the click (default 0.25).
     */
    playClick(volume = 0.25) {
        if (this._runtime.status !== "loaded") return;
        const ctx = this._runtime.audioContext;
        if (ctx === null) return;
        const peak = (typeof volume === "number" && volume > 0) ? volume : 0.25;
        const t = ctx.currentTime + IMMEDIATE_FIRE_LOOKAHEAD_SECONDS;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1000, t);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(peak, t + 0.001);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        osc.connect(env);
        env.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.05);
    }

    fireImmediateValue(sourceId, value, durationSeconds, amplitude) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return;
        if (this._runtime.status !== "loaded") return;
        const audioCtx = this._runtime.audioContext;
        if (audioCtx === null) return;
        const fireTime = audioCtx.currentTime + IMMEDIATE_FIRE_LOOKAHEAD_SECONDS;
        const duration = (typeof durationSeconds === "number"
            && Number.isFinite(durationSeconds) && durationSeconds > 0)
            ? durationSeconds
            : DEFAULT_PLAYNOTE_DURATION_SECONDS;

        // Shallow-copy so an amplitude override (and the voice
        // injection below) never mutates the canvas's cached
        // marker value.
        /** @type {any} */
        const out = { ...value };
        if (typeof amplitude === "number" && Number.isFinite(amplitude)) {
            out.gain = amplitude;
        }

        if (this._outputMode === "superdough") {
            const source = this._findSourceById(sourceId);
            const globalVoice = this._scene !== null ? this._scene.voiceSuperdough : null;
            const injected = applyVoiceInjection(out, source, globalVoice);
            if (typeof this._runtime.ensureSamplesForVoice === "function") {
                this._runtime.ensureSamplesForVoice(injected.s, injected.bank);
            }
            const voiced = applyVoiceEnvelope(injected);
            this._runtime.play(voiced, fireTime, duration);
        } else {
            this._midiSender.send(out, fireTime, duration);
        }

        // Flash the source, same as the note / sound / pattern
        // paths. See fireImmediateNote for the rationale.
        this._emitFiring(sourceId);
    }

    /**
     * Emit the firing-event signal for a procedural fire so
     * the canvas flashes the source. Mirrors the inline
     * _onFiring emission on the pattern-dispatch path, with a
     * resolved kind so a curve or trigger calling playNote in
     * a future collision-callback path flashes correctly too;
     * defaults to "sprite" since onTick (the only live call
     * site today) is sprite-only. absoluteFractional is 0 —
     * a procedural fire has no beat-point position, and the
     * sprite flash ignores the field anyway. No-op when no
     * subscriber is attached; a subscriber throw is caught and
     * logged so it can't destabilise the audio path that
     * already completed.
     *
     * @param {string} sourceId
     */
    _emitFiring(sourceId) {
        if (this._onFiring === null) return;
        const source = this._findSourceById(sourceId);
        /** @type {"curve" | "sprite"} */
        let kind = "sprite";
        if (source !== null && this._scene !== null) {
            if (Array.isArray(this._scene.curves)
                && this._scene.curves.includes(source)) {
                kind = "curve";
            }
        }
        try {
            this._onFiring({
                sourceId,
                kind,
                absoluteFractional: 0,
                audioTime: 0,
            });
        } catch (err) {
            console.warn(
                "[firing] onFiring subscriber threw for procedural fire " +
                sourceId + ":",
                err,
            );
        }
    }

    /**
     * Find a live scene source (curve, sprite, or trigger) by
     * id. Used by fireImmediateNote's superdough path to resolve
     * the per-object voice for injection. Returns null when no
     * scene is loaded or the id isn't present.
     *
     * @param {string} id
     * @returns {any}
     */
    _findSourceById(id) {
        if (this._scene === null) return null;
        const arrays = [this._scene.curves, this._scene.sprites, this._scene.triggers];
        for (const arr of arrays) {
            if (!Array.isArray(arr)) continue;
            for (const obj of arr) {
                if (obj !== null && typeof obj === "object" && obj.id === id) {
                    return obj;
                }
            }
        }
        return null;
    }

    /**
     * Install a freshly-loaded Scene. Keeps _scene (for the
     * immediate-fire path's _findSourceById) and preloads the
     * scene's per-object voice samples so callback notes have
     * their instruments ready. Legacy cyclePattern auto-firing
     * is disabled (§3.6), so no pattern sources are registered
     * and the old pattern never plays on its own.
     *
     * Pass null to clear the scene reference — used when no
     * scene is loaded (transient between scene reloads).
     *
     * @param {Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        // Drop same-pitch suppression anchors: a scene swap resets the
        // run, so stale future fire times must not carry over.
        this._recentPitchFireTimes.clear();
        if (scene === null) return;
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
        // Score-wide global voice first: a global Note Voice
        // or Sound Bank applies to every object inheriting
        // the "Global" sentinel, so its sample map / soundfont
        // needs loading even when no per-object voice names it.
        const global = this._scene.voiceSuperdough;
        if (global !== null && typeof global === "object" && !Array.isArray(global)) {
            this._runtime.ensureSamplesForVoice(global.sound, global.bank);
        }
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
            // Paused: reset same-pitch dedup and panic the MIDI
            // sender so any notes that already had noteOns
            // dispatched (and have pending noteOffs queued in the
            // midiSender's own scheduler) get silenced immediately
            // rather than ringing indefinitely.
            this._recentPitchFireTimes.clear();
            this._midiSender.panic();
            return;
        }

        // Rewind detection. simulation.js detects a backward
        // jump in transport.elapsedSeconds and resets each
        // source's cycle state to 0. firingEngine needs the
        // same signal: the MIDI sender's already-scheduled
        // noteOns from the pre-rewind session would otherwise
        // fire alongside the new play session's events,
        // producing extra notes layered on top of the
        // post-rewind playback. Panic the MIDI sender on a
        // backward jump so the new session starts clean. The
        // lastSeen value is updated unconditionally below so a
        // single backward jump triggers detection exactly once.
        const elapsedNow = this._transport.elapsedSeconds;
        if (typeof elapsedNow === "number"
            && Number.isFinite(elapsedNow)
            && elapsedNow < this._lastElapsedSeconds) {
            this._midiSender.panic();
        }
        this._lastElapsedSeconds =
            (typeof elapsedNow === "number" && Number.isFinite(elapsedNow))
                ? elapsedNow
                : this._lastElapsedSeconds;
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
 * Read the clip-aware duration of a strudel Hap, in cycle
 * units, or NaN when the hap carries no usable duration
 * field. This is the field the .clip() / .legato() pattern
 * operators modify: strudel's clip writes the articulated
 * length into hap.duration (and hap.endClipped) while
 * deliberately leaving the whole timespan at the full grid
 * length so visualisations can still show the underlying
 * structure. Strudel's own scheduler uses hap.duration for
 * note length (it schedules stop at whole.begin +
 * hap.duration), so reading it here is what makes clip
 * audible in GXW: without it, the duration computed from
 * the whole span is always the unclipped grid length and
 * clip has no effect.
 *
 * Returned in cycle units (a fraction of a cycle), the same
 * units as (whole.end - whole.begin), so the caller scales
 * it to wall-clock by the same segmentDuration factor. NaN
 * when the field is absent or non-finite, so the caller
 * falls back to the whole-span computation for haps that
 * carry no explicit duration (the default, unclipped case
 * for any pattern without clip).
 *
 * @param {any} hap
 * @returns {number}
 */
function hapDuration(hap) {
    if (hap === null || typeof hap !== "object") return NaN;
    if ("duration" in hap) {
        const d = Number(hap.duration);
        if (Number.isFinite(d)) return d;
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
 * Soft-inject the superdough voice fields into an outgoing
 * Hap value, resolving each field (sound, bank) through the
 * three-level fallback chain: explicit pattern value (left
 * untouched, always wins) > per-object voice > score-wide
 * global voice > nothing. Two injection paths, both gated
 * on the field being absent in the source value so explicit
 * pattern values always win:
 *
 *   - Pitched sound: when the value has no `s` field, fill
 *     value.s with the effective sound — the per-object
 *     voice.superdough.sound if it is a non-empty string,
 *     else the global voice's sound if that is a non-empty
 *     string, else nothing. The per-object "Global"
 *     sentinel is stored as an empty/absent sound, so an
 *     object left on Global falls through to the global
 *     value here. Targets events from note() and n()
 *     patterns, which produce values like {note: "c4"} or
 *     {n: 0} without an s field. Once filled, superdough
 *     renders the note through the named sample/synth
 *     (e.g. "piano" for the Salamander Grand, "sawtooth"
 *     for the built-in oscillator).
 *
 *   - Unpitched bank: when the value's `s` field is a raw
 *     drum name without an underscore, set value.bank to
 *     the effective bank (per-object bank if non-empty,
 *     else global bank if non-empty, else nothing).
 *     Targets events from sound() patterns like
 *     sound("bd sn") whose s field is a raw drum name; the
 *     bank field then makes superdough resolve "bd" to
 *     "RolandTR909_bd" (etc.) at sample lookup time. An s
 *     field that already contains an underscore
 *     ("RolandTR808_bd") is treated as a pre-banked name
 *     and left alone, matching strudel's own .bank()
 *     operator semantics. The bank is applied only to an
 *     event that carried its own s and no note field — a
 *     genuine sound() drum event. An event whose s was
 *     injected from the note voice (a note() event with no
 *     own s) or that carries a note field is melodic, and
 *     banking it would make superdough look up a
 *     nonexistent "{bank}_{instrument}" sample and fall
 *     silent, so the bank is skipped there.
 *
 * Resolution detail. The per-object and global voice
 * blocks are read independently per field: an object can
 * set its own sound while inheriting the global bank, or
 * vice versa, because each field falls through to the
 * global value on its own. The global block is the
 * scene-level scene.voiceSuperdough ({ sound, bank } with
 * empty-string meaning the global "Default" sentinel = no
 * injection), passed in by the caller from this._scene.
 *
 * Returns the value unchanged (by reference) when no
 * injection applies, so events without any effective
 * override keep their reference identity. Returns a
 * shallow-copied new object only when at least one field
 * is injected, so the original value Hap from strudel's
 * queryArc is never mutated.
 *
 * Called from the superdough dispatch branch in tick().
 * Not called on the MIDI path because MIDI events use
 * value.note / value.midichan and not value.s or
 * value.bank; the per-object MIDI voice fields will land
 * as a separate path in a later commit.
 *
 * @param {any} value   The strudel Hap value about to dispatch.
 * @param {any} source  The per-object scene source (Curve, Trigger, or Sprite).
 * @param {any} global  The scene-level voiceSuperdough fallback ({sound?, bank?} or null).
 * @returns {any}
 */
function applyVoiceInjection(value, source, global) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

    // Per-object voice.superdough block, if present. The
    // source may carry no voice at all (the common case for
    // an untouched object), in which case the per-object
    // values are simply absent and resolution falls through
    // to the global.
    let perObject = null;
    if (source !== null && typeof source === "object") {
        const voice = source.voice;
        if (voice !== null && typeof voice === "object" && !Array.isArray(voice)) {
            const sd = voice.superdough;
            if (sd !== null && typeof sd === "object" && !Array.isArray(sd)) {
                perObject = sd;
            }
        }
    }
    // Scene-level global voice block, if present and well-
    // shaped. An absent or malformed global reads as no
    // global override (both fields empty).
    const globalBlock =
        (global !== null && typeof global === "object" && !Array.isArray(global))
            ? global
            : null;

    // Resolve each field per-object-first, then global.
    // Empty strings and non-strings count as "unset" at
    // each level so the per-object "Global" sentinel
    // (empty string) and the global "Default" sentinel
    // (empty string) both fall through correctly.
    const pickString = (a, b) => {
        if (typeof a === "string" && a.length > 0) return a;
        if (typeof b === "string" && b.length > 0) return b;
        return null;
    };
    const effectiveSound = pickString(
        perObject === null ? undefined : perObject.sound,
        globalBlock === null ? undefined : globalBlock.sound,
    );
    const effectiveBank = pickString(
        perObject === null ? undefined : perObject.bank,
        globalBlock === null ? undefined : globalBlock.bank,
    );

    let out = value;
    let copied = false;

    if (effectiveSound !== null && !("s" in out)) {
        out = { ...out, s: effectiveSound };
        copied = true;
    }

    if (effectiveBank !== null
        && "s" in value && !("note" in value)
        && typeof out.s === "string" && !out.s.includes("_")) {
        if (!copied) { out = { ...out }; copied = true; }
        out.bank = effectiveBank;
    }

    if (LOG_VOICE && copied) {
        const sStr = typeof out.s === "string" ? out.s : "(none)";
        const bankStr = typeof out.bank === "string" ? out.bank : "(none)";
        console.log(
            "[voice] " + (source !== null && typeof source.id === "string" ? source.id : "?") +
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
