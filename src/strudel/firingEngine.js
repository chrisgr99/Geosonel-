/**
 * Pattern firing engine — Tier 2 Phase 1.
 *
 * Drives audio output for continuous-firing sources (curves
 * and sprites) by mapping their per-source cycle wraps into
 * scheduled superdough events on the shared AudioContext.
 *
 * Sits between three existing modules:
 *
 *   - StrudelRuntime: provides the loaded-status gate, the
 *     shared AudioContext, and the play(value, audioTime)
 *     wrapper around superdough that handles the offset-
 *     from-now calling convention.
 *   - Simulation: provides per-source cycleCount and
 *     cycleProgress via getCurveCycleState and
 *     getSpriteCycleState. The simulation already advances
 *     these fields uniformly for curves and sprites; the
 *     firing engine just reads.
 *   - Transport: provides master BPM (used with the source's
 *     beatsPerCycle to derive cycle duration) and isPlaying
 *     (gates firing during pause).
 *
 * Section 27's continuous-firing path. Each tick:
 *
 *   1. Walk every curve and sprite source with a compiled
 *      pattern.
 *   2. Read the simulation's current cycleCount and
 *      cycleProgress for that source.
 *   3. If the cycleCount has changed since this engine last
 *      saw the source (or is being seen for the first time),
 *      treat it as a new cycle: call pattern.queryArc(n, n+1)
 *      where n is the new cycleCount, convert each Hap's
 *      fractional position into an absolute audio time
 *      against an audio cycle start derived from
 *      currentTime - cycleProgress * cycleDuration, and add
 *      the events to a per-source pending list.
 *   4. Walk the pending list and commit any events whose
 *      audio time falls within the audio commit window (the
 *      Web Audio recommended ~100ms forward scheduling
 *      horizon). Committed events get scheduled via the
 *      runtime's play() wrapper and removed from the
 *      pending list.
 *
 * Pause handling. When the transport is not playing, the
 * tick resets every source's lastFiredCycle to null and
 * clears pending events, then returns. On resume the engine
 * re-detects the current cycle and re-queries the pattern
 * against the resumed audio clock. The cycleProgress filter
 * on detection (only include events whose fractional
 * position is greater than or equal to cycleProgress at
 * detection time) means the engine only fires events that
 * haven't already gone past in the cycle, so a mid-cycle
 * resume picks up cleanly from wherever the cycle was when
 * paused. The cost is losing the rest of the in-flight
 * cycle's events on pause, which is acceptable Phase 1
 * behaviour; the next wrap recovers.
 *
 * Edit handling. When setScene observes a changed
 * cyclePattern text on an existing source, the compiled
 * Pattern is replaced and pending events are cleared, but
 * lastFiredCycle is preserved. The new pattern therefore
 * takes effect on the next cycle wrap, not mid-cycle.
 * Already-committed events (those superdough has accepted)
 * play through to completion. The user hears the rest of
 * the old pattern's current cycle play out, then the new
 * pattern starts cleanly on the next downbeat. A mid-cycle
 * takeover was tried briefly and reverted because the
 * blended audio (old beats from before the edit plus new
 * beats from after) sounded messier than the clean cycle-
 * boundary transition.
 *
 * Continue-on-edit semantics for cross-cycle modifiers
 * (alternation, every, iter) are preserved across edits.
 * The simulation's per-source cycleCount keeps advancing
 * regardless of pattern changes, and the firing engine
 * queries the new pattern at (cycleCount, cycleCount + 1)
 * on the next wrap. An alternation pattern `<a b c d>`
 * edited at cycle 7 picks up at cycle 8 of the new pattern
 * (which is `cycle 8 modulo new pattern length` for cyclic
 * patterns), not at cycle 0.
 *
 * Scope. Curves and sprites only. Triggers are excluded
 * because their natural firing model is one-shot (a
 * collision flourish, not a continuous loop), which lives
 * in Tier 5 with its own primitive. The simulation still
 * advances trigger cycle counters; the firing engine just
 * doesn't read them.
 */

// @ts-check

import { parsePatternToPositions } from "./patternParse.js";

/** @typedef {import("./runtime.js").StrudelRuntime} StrudelRuntime */
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
 * PatternFiringEngine's _sources map. Each entry tracks the
 * compiled Pattern, the last cycle counter observed by the
 * firing engine, and the list of pending events for the
 * current cycle awaiting commit to superdough.
 *
 * @typedef {Object} SourceFiringState
 * @property {string} id
 * @property {"curve" | "sprite"} kind
 * @property {string} cyclePatternText  Raw cyclePattern source string; compared
 *                                       on each setScene to decide whether to
 *                                       recompile.
 * @property {any} compiled  Compiled strudel Pattern object (carries queryArc),
 *                            or null when the text was empty or failed to parse.
 * @property {number | null} lastFiredCycle  The cycleCount this engine has
 *                                            already populated pending events
 *                                            for, or null when no cycle has
 *                                            been observed yet (initial state
 *                                            or post-pause reset).
 * @property {Array<{audioTime: number, value: any, duration: number}>} pendingEvents  Events for
 *                                            the current cycle awaiting commit.
 *                                            Sorted by audioTime ascending.
 */

export class PatternFiringEngine {
    /**
     * @param {StrudelRuntime} runtime
     * @param {Simulation} simulation
     * @param {Transport} transport
     */
    constructor(runtime, simulation, transport) {
        this._runtime = runtime;
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
     * Adds an entry if missing; recompiles and clears
     * pending events if the cyclePattern text changed;
     * preserves lastFiredCycle either way so cross-cycle
     * modifiers continue across edits.
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
                // Clear pending events from the previous
                // pattern; lastFiredCycle stays so the new
                // pattern picks up at the next wrap with
                // continue-on-edit cross-cycle modifier
                // semantics. The user hears the rest of
                // the old pattern's current cycle play
                // out before the new pattern takes over
                // on the next downbeat.
                existing.pendingEvents = [];
            }
            existing.kind = kind;
            return;
        }
        this._sources.set(id, {
            id,
            kind,
            cyclePatternText,
            compiled: this._compile(cyclePatternText),
            lastFiredCycle: null,
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
     * available. Parallels canvas.refreshMarkers, which
     * does the same for marker rendering.
     *
     * Pending events are cleared for any source that
     * recompiles, so detection on the next tick re-runs
     * cleanly against the resumed audio clock.
     */
    recompileMissingPatterns() {
        for (const state of this._sources.values()) {
            if (state.compiled !== null) continue;
            if (state.cyclePatternText.trim() === "") continue;
            state.compiled = this._compile(state.cyclePatternText);
            state.pendingEvents = [];
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
            // Paused. Reset per-source firing state so that
            // on resume the firing engine re-detects the
            // current cycle, re-queries the pattern, and
            // recomputes audio times against the resumed
            // audio clock. The cycleProgress filter on
            // detection means only future events (relative
            // to the cycle's current position) are queued,
            // so a mid-cycle resume picks up where it left
            // off. The trade-off is that the rest of the
            // in-flight cycle's events are dropped on pause;
            // acceptable Phase 1 behaviour.
            for (const state of this._sources.values()) {
                state.lastFiredCycle = null;
                state.pendingEvents = [];
            }
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
            // pending events are dropped and detection is
            // skipped. Unmuting on the fly will re-detect on
            // the next tick (lastFiredCycle stays at its
            // previous value, which may differ from the
            // current cycleCount if a wrap happened while
            // muted, so the unmute lands on the same cycle
            // boundary as the first detection on play).
            if (source.mute === true) {
                state.pendingEvents = [];
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

            // New-cycle detection. The first time the engine
            // sees this source (lastFiredCycle null), or
            // whenever the simulation's cycleCount has changed
            // since the last tick (a wrap or rewind happened),
            // query the pattern for the new cycle and populate
            // pending events with absolute audio times.
            //
            // isCleanWrap distinguishes a contiguous N to N+1
            // advance from initial detection or a rewind. On a
            // clean wrap every event in the new cycle should
            // fire, including the one at fractional position
            // zero, so the cycle-progress filter inside
            // _populatePending must not drop it. On initial
            // detection (after Play or after a resume from
            // pause) the filter still applies so retroactive
            // events earlier in the cycle don't burst-fire.
            const previousLastFiredCycle = state.lastFiredCycle;
            if (previousLastFiredCycle !== cycleState.cycleCount) {
                state.lastFiredCycle = cycleState.cycleCount;
                const isCleanWrap = previousLastFiredCycle !== null &&
                    cycleState.cycleCount === previousLastFiredCycle + 1;
                this._populatePending(
                    state,
                    cycleState,
                    cycleDuration,
                    audioNow,
                    isCleanWrap,
                );
            }

            // Commit pending events whose audio time is
            // within the commit window. Events older than
            // a small slack get dropped silently — they were
            // missed (typical cause: a slow frame), and
            // scheduling them now would produce a burst at
            // the current audio time.
            /** @type {Array<{audioTime: number, value: any, duration: number}>} */
            const remaining = [];
            for (const ev of state.pendingEvents) {
                if (ev.audioTime <= horizon && ev.audioTime >= audioNow - 0.05) {
                    // Clamp into the future for safety. With
                    // a healthy frame rate the clamp is a
                    // no-op since audioTime >= audioNow by
                    // the time we reach this branch (any
                    // older events have been filtered out
                    // above).
                    const t = Math.max(audioNow, ev.audioTime);
                    this._runtime.play(ev.value, t, ev.duration);
                } else if (ev.audioTime > horizon) {
                    remaining.push(ev);
                }
                // ev.audioTime older than audioNow - 0.05 falls
                // through here (no push, no commit) — dropped.
            }
            state.pendingEvents = remaining;
        }
    }

    /**
     * Internal: query the pattern for the cycle the
     * simulation has just entered and populate pending
     * events. Uses queryArc(cycleCount, cycleCount + 1) so
     * cross-cycle modifiers (alternation, every, iter)
     * advance correctly across firings; sequential cycle
     * counters give sequential queries.
     *
     * Filters out events whose fractional position is less
     * than the cycle progress at detection time — but ONLY
     * when isCleanWrap is false. On a clean cycle wrap from
     * N to N+1, every event in the new cycle should fire,
     * including the one at fractional position zero. The
     * simulation's tick crosses the cycle boundary and
     * advances slightly past zero in the same step, so by
     * the time the firing engine reads cycleProgress it is
     * a small positive number rather than exactly zero. A
     * naive "fractional < cycleProgress" filter would drop
     * the position-zero event on every wrap because zero is
     * less than (say) 0.005 — silently swallowing the
     * downbeat of every cycle. The isCleanWrap path skips
     * the filter entirely; the still-in-the-future commit-
     * window walk handles the actual scheduling, including
     * clamping events slightly in the past up to audioNow
     * so they fire immediately rather than late.
     *
     * On non-clean-wrap detection (first detection after
     * Play, or after resume from pause, where the user may
     * have pressed Play mid-cycle on a previously paused
     * transport), the filter still applies so retroactive
     * events earlier in the cycle don't burst-fire.
     *
     * Stochastic patterns (degradeBy, choose, the rand and
     * irand signals) are seeded by strudel's internal RNG;
     * a fresh detection of the same cycleCount would give
     * the same Haps because strudel's hash is deterministic
     * over cycle counter and tag. So a resume that re-
     * detects the same cycle observes the same events.
     *
     * @param {SourceFiringState} state
     * @param {{cycleCount: number, cycleProgress: number}} cycleState
     * @param {number} cycleDuration
     * @param {number} audioNow
     * @param {boolean} isCleanWrap
     */
    _populatePending(state, cycleState, cycleDuration, audioNow, isCleanWrap) {
        const cycleIndex = cycleState.cycleCount;
        const cycleProgressAtDetection = cycleState.cycleProgress;
        // The cycle effectively started cycleProgress * cycleDuration
        // seconds ago in audio time. Events at fractional positions
        // beyond the current cycleProgress map to future audio times.
        const cycleAudioStart = audioNow - cycleProgressAtDetection * cycleDuration;
        let haps;
        try {
            haps = state.compiled.queryArc(cycleIndex, cycleIndex + 1);
        } catch (err) {
            console.warn(`[firing] queryArc failed for ${state.id}:`, err);
            state.pendingEvents = [];
            return;
        }
        if (!Array.isArray(haps)) {
            state.pendingEvents = [];
            return;
        }
        /** @type {Array<{audioTime: number, value: any, duration: number}>} */
        const pending = [];
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
            // Cycle-progress filter. Drops events that have
            // already passed at detection time, but only on
            // initial-detection paths (after Play, or after
            // resume from pause). On a clean N to N+1 wrap
            // every event in the new cycle fires, including
            // the one at fractional zero — see the
            // _populatePending docstring for why the
            // simulation's tiny positive cycleProgress at
            // wrap detection would otherwise swallow the
            // downbeat.
            if (!isCleanWrap && fractional < cycleProgressAtDetection) continue;
            const audioTime = cycleAudioStart + fractional * cycleDuration;
            const duration = Math.max(0, (fractionalEnd - fractional) * cycleDuration);
            pending.push({ audioTime, value: hap.value, duration });
        }
        // Sort ascending by audioTime so the commit-window
        // walk sees events in time order. queryArc usually
        // returns them in order already, but some modifier
        // compositions (parallel layers, jux) can return
        // multiple events with overlapping or non-monotonic
        // begins.
        pending.sort((a, b) => a.audioTime - b.audioTime);
        state.pendingEvents = pending;
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
