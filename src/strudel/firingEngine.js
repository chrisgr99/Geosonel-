/**
 * Pattern firing engine — Tier 2 Phase 2.
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

/** @typedef {import("./runtime.js").StrudelRuntime} StrudelRuntime */
/** @typedef {import("./midiSender.js").MIDISender} MIDISender */
/** @typedef {import("../simulation.js").Simulation} Simulation */
/** @typedef {import("../transport.js").Transport} Transport */
/** @typedef {import("../scene.js").Scene} Scene */

/**
 * Audio commit window in seconds. Events whose absolute
 * audio time falls within currentTime + this many seconds
 * get scheduled to superdough on the tick that observes
 * them; later events stay on the per-source pending list
 * until a later tick reaches them. Matches Web Audio's
 * recommended forward scheduling window of ~100ms and
 * what strudel's own cyclist uses; section 27's audio-
 * commit-window decision picked 100ms as the starting
 * value.
 */
const DEFAULT_COMMIT_WINDOW_SECONDS = 0.1;

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
 * @property {Array<{audioTime: number, value: any, duration: number, cycleIndex: number}>} pendingEvents
 *                            Events awaiting commit, tagged with the cycle
 *                            they belong to so pattern edits can preserve
 *                            current-cycle events while dropping future ones.
 *                            Sorted by audioTime ascending.
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

        /** @type {Map<string, SourceFiringState>} */
        this._sources = new Map();

        /**
         * Audio commit window in seconds. Exposed as a public
         * property so callers can adjust without recompiling
         * the engine; the default is conservative and matches
         * section 27's starting value. Set this larger to
         * tolerate slower simulation tick rates at the cost
         * of less responsive pause behaviour; set smaller for
         * tighter pause response at the cost of needing more
         * frequent ticks.
         */
        this.commitWindowSeconds = DEFAULT_COMMIT_WINDOW_SECONDS;

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

        const horizon = audioNow + this.commitWindowSeconds;

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

            // Commit pending events whose audio time is
            // within the commit window. Events older than
            // the past-slack window get dropped silently:
            // those are genuinely stale (typically a resume
            // from pause where the simulation's cycleProgress
            // is well past the event's fractional position).
            // Events slightly in the past pass straight
            // through to Web MIDI, which sends them
            // immediately per spec; no forward clamp needed
            // since Web MIDI does not reject past timestamps
            // the way superdough does.
            /** @type {Array<{audioTime: number, value: any, duration: number, cycleIndex: number}>} */
            const remaining = [];
            for (const ev of state.pendingEvents) {
                if (ev.audioTime <= horizon && ev.audioTime >= audioNow - 0.2) {
                    this._midiSender.send(ev.value, ev.audioTime, ev.duration);
                } else if (ev.audioTime > horizon) {
                    remaining.push(ev);
                }
                // ev.audioTime older than audioNow - 0.2 falls
                // through (no push, no commit) — dropped.
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
