/**
 * Pattern firing engine — Tier 2 Phase 3.
 *
 * Drives audio output for continuous-firing sources (curves
 * and sprites) by scheduling their per-source cycle wraps
 * into MIDI events sent through MIDISender. The engine
 * stays output-agnostic; flipping back to superdough audio
 * is a one-line change at the commit walker.
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
 * stay in the queue until they are within
 * lateRefreshWindowSeconds of their audio time, rather than
 * being dispatched up to a full commit-window in advance.
 * At dispatch time, the commit walker passes a per-tick
 * snapshot of simulation state and a firing-context pointer
 * (set via withFiringContext from firingContext.js, a
 * try-finally helper that cannot strand the pointer if
 * queryArc throws) into a re-query of the pattern for a
 * tiny range around the event's fractional position. Pass
 * 1 (at population time) established the event's structure
 * (audioTime, duration, channel, note number, and any
 * static-signal value fields); Pass 2 here refreshes any
 * value fields that read dynamic signals through the
 * firing-context pointer. If Pass 2 returns exactly one
 * Hap, its value replaces the population-time value;
 * anything else (no Hap, multiple Haps, queryArc throw)
 * falls back to the Pass 1 value, keeping the schedule
 * deterministic relative to cycle-start state. In Phase 3
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

/** @typedef {import("./runtime.js").StrudelRuntime} StrudelRuntime */
/** @typedef {import("./midiSender.js").MIDISender} MIDISender */
/** @typedef {import("../simulation.js").Simulation} Simulation */
/** @typedef {import("../transport.js").Transport} Transport */
/** @typedef {import("../scene.js").Scene} Scene */

/**
 * Late-refresh window in seconds. Pending events with
 * audio times further in the future than audioNow plus
 * this value stay queued; events within the window get a
 * Pass 2 refresh (queryArc with the firing-context pointer
 * active) and dispatch to Web MIDI on this tick. Section
 * 27's one-cycle-ahead-scheduling-and-dynamic-signal-late-
 * refresh subsection picked roughly 20ms as the design
 * starting value; 30ms here gives the window comfortably
 * more room than the typical 16ms inter-frame interval so
 * a single dropped frame does not push an event past the
 * dispatch window before the next tick reaches it. The
 * cost of widening the window is that Pass 2 reads
 * simulation state up to 30ms before the event's audio
 * time, which is well below the audible threshold for the
 * dynamic signals planned for Phase 4.
 *
 * The pre-Phase-3 name for this constant was DEFAULT_-
 * COMMIT_WINDOW_SECONDS and the value was 0.1; the rename
 * marks the architectural shift from "commit now if within
 * audio lookahead" to "hold until late-refresh window then
 * dispatch with refreshed values".
 */
const DEFAULT_LATE_REFRESH_WINDOW_SECONDS = 0.03;

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
 * Per-source firing state. Keyed by source id in the
 * PatternFiringEngine's _sources map.
 *
 * @typedef {Object} SourceFiringState
 * @property {string} id
 * @property {"curve" | "sprite"} kind
 * @property {string} cyclePatternText  Raw cyclePattern source string; compared
 *                                       on each setScene to decide whether to
 *                                       set patternDirty.
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
 *                                    populatedCycles.
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
         * Late-refresh window in seconds. Public property so
         * callers can adjust without recompiling the engine.
         * See DEFAULT_LATE_REFRESH_WINDOW_SECONDS at module
         * top for the rationale. Set larger to tolerate
         * dropped frames at the cost of slightly staler
         * dynamic-signal reads at Pass 2 time; set smaller
         * for tighter Pass 2 freshness at the cost of needing
         * tick to run reliably between event audioTimes.
         */
        this.lateRefreshWindowSeconds = DEFAULT_LATE_REFRESH_WINDOW_SECONDS;

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
                }
                this._midiSender.panic();
            }
        });
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
    }

    /**
     * Internal: reconcile one source against the cache.
     * Adds an entry if missing; flags the entry as
     * patternDirty when its cyclePattern text changes so
     * the next tick can filter future-cycle events from
     * pendingEvents and drop future cycles from
     * populatedCycles, preparing the source for the new
     * pattern's events to be populated at the next tick.
     * The current cycle's already-queued events stay in
     * pendingEvents for Version B clean-takeover behaviour.
     *
     * @param {string} id
     * @param {"curve" | "sprite"} kind
     * @param {any} source
     */
    _reconcileSource(id, kind, source) {
        const cyclePatternText = typeof source.cyclePattern === "string"
            ? source.cyclePattern
            : "";
        const existing = this._sources.get(id);
        if (existing !== undefined) {
            if (existing.cyclePatternText !== cyclePatternText) {
                existing.cyclePatternText = cyclePatternText;
                existing.compiled = this._compile(cyclePatternText);
                // patternDirty: next tick handles the cleanup
                // (drop future-cycle events, drop future
                // cycles from populatedCycles). Current-cycle
                // events stay queued for the rest of the
                // cycle so the user hears the old pattern
                // finish out before the new pattern takes
                // effect on the next cycle boundary.
                existing.patternDirty = true;
            }
            existing.kind = kind;
            return;
        }
        this._sources.set(id, {
            id,
            kind,
            cyclePatternText,
            compiled: this._compile(cyclePatternText),
            populatedCycles: new Map(),
            patternDirty: false,
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
            }
            this._midiSender.panic();
            return;
        }

        const ctx = this._runtime.audioContext;
        if (ctx === null) return;
        const audioNow = ctx.currentTime;

        const bpm = this._transport.bpm;
        if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return;

        const lateRefreshHorizon = audioNow + this.lateRefreshWindowSeconds;
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
            const cycleDuration = (beatsPerCycle * 60) / bpm;

            const cycleState = state.kind === "curve"
                ? this._simulation.getCurveCycleState(source.id)
                : this._simulation.getSpriteCycleState(source.id);
            if (cycleState === null) continue;

            const C = cycleState.cycleCount;

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
            if (!state.populatedCycles.has(C)) {
                const cycleAudioStart =
                    audioNow - cycleState.cycleProgress * cycleDuration;
                state.populatedCycles.set(C, cycleAudioStart);
                this._populatePending(state, C, cycleAudioStart, cycleDuration);
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
            if (!state.populatedCycles.has(C + 1)) {
                const startC = state.populatedCycles.get(C);
                if (typeof startC === "number") {
                    const cycleAudioStartNext = startC + cycleDuration;
                    state.populatedCycles.set(C + 1, cycleAudioStartNext);
                    this._populatePending(
                        state,
                        C + 1,
                        cycleAudioStartNext,
                        cycleDuration,
                    );
                }
            }

            // Late-refresh dispatch (Phase 3 substrate).
            // Pending events whose audio time is further
            // than lateRefreshWindowSeconds in the future
            // stay pending; events within the window get a
            // Pass 2 refresh of any dynamic-signal-dependent
            // value fields (the firing-context pointer is
            // active during the re-query so signal
            // implementations can read snapshot state) and
            // dispatch to Web MIDI immediately afterward.
            // Events older than the past-slack window get
            // dropped silently — those are genuinely stale,
            // typically a resume from pause where the
            // simulation's cycleProgress is well past the
            // event's fractional position. Events slightly
            // in the past dispatch through Web MIDI's
            // send-now semantics with no forward clamp
            // needed; Web MIDI does not reject past
            // timestamps the way superdough does.
            /** @type {Array<{audioTime: number, value: any, duration: number, cycleIndex: number, fractional: number}>} */
            const remaining = [];
            for (const ev of state.pendingEvents) {
                if (ev.audioTime > lateRefreshHorizon) {
                    remaining.push(ev);
                } else if (ev.audioTime < audioNow - 0.2) {
                    // stale — drop without dispatch.
                } else {
                    const refreshedValue = this._pass2RefreshValue(state, ev, snapshot);
                    this._midiSender.send(refreshedValue, ev.audioTime, ev.duration);
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
     * @param {SourceFiringState} state
     * @param {number} cycleIndex
     * @param {number} cycleAudioStart
     * @param {number} cycleDuration
     */
    _populatePending(state, cycleIndex, cycleAudioStart, cycleDuration) {
        let haps;
        try {
            haps = state.compiled.queryArc(cycleIndex, cycleIndex + 1);
        } catch (err) {
            console.warn(`[firing] queryArc failed for ${state.id}:`, err);
            return;
        }
        if (!Array.isArray(haps)) return;

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
            const audioTime = cycleAudioStart + fractional * cycleDuration;
            const duration = Math.max(0, (fractionalEnd - fractional) * cycleDuration);
            state.pendingEvents.push({
                audioTime,
                value: hap.value,
                duration,
                cycleIndex,
                fractional,
            });
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
        /** @type {import("./firingContext.js").FiringContext} */
        const ctx = {
            sourceId: state.id,
            kind: state.kind,
            audioTime: ev.audioTime,
            snapshot,
        };
        let haps;
        try {
            haps = withFiringContext(ctx, () => state.compiled.queryArc(begin, end));
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
