/**
 * Simulation module.
 *
 * Advances scene state forward in time. Owns the per-curve
 * runtime state (current cycle parameter, completed cycle
 * count, halt flag) so authored data on Curve instances
 * stays clean. Currently scoped to cursor advancement; sprite
 * physics, beat firing, and pattern-driven event generation
 * are deferred to later milestones.
 *
 * Architecture:
 *   - Fixed-step simulation at SIM_DT seconds per step
 *     (1/240 s, ~4.17 ms). Determinism is required by
 *     DESIGN.md §7: rewinding and replaying must reproduce
 *     identical state at every point. A fixed step makes
 *     that property hold regardless of frame-rate variance.
 *   - tick() is the single entry point. It reads the
 *     transport's elapsedSeconds, computes how much time
 *     has passed since the last tick, and runs as many
 *     fixed steps as fit. The Canvas calls this from its
 *     render loop.
 *   - Going backward in time (elapsedSeconds < previous)
 *     is interpreted as a rewind: every curve's runtime
 *     state resets to t = 0, cycle count zero, and the
 *     accumulator clears. This means rewind detection
 *     happens implicitly through the same entry point as
 *     normal advancement, no separate event needed.
 *   - Per-curve runtime state lives in a Map keyed by
 *     curve id. setScene reconciles by id: matching ids
 *     preserve runtime state so playback continues across
 *     scene edits; new ids start at t = 0; removed ids
 *     drop. This is the same id-based pattern the
 *     inspector uses for the None-mode stash.
 *
 * The Simulation is passive: no internal timer, no
 * requestAnimationFrame loop, no listeners on transport.
 * The Canvas owns the play loop; the Simulation is queried
 * on demand. Cursor advancement happens during tick(); the
 * Canvas reads each curve's current t via getCurveCursorT
 * at draw time.
 *
 * cycleSpeeds and stopAtCycle are honoured. Per DESIGN.md
 * §4, cycleSpeeds is a list of per-cycle multipliers cycling
 * through itself: positive values run forward, negative
 * values reverse, zero stands still for one normal-cycle's
 * duration. The list index advances one per completed cycle.
 * stopAtCycle halts the cursor in place after N cycles
 * complete; -1 means play forever. beatOffset is currently
 * inert; it stays in the data model and the JSON round-trip,
 * but the simulation does not consult it. Its meaning will
 * be revisited as part of the Strudel migration in v2.5+ per
 * DESIGN.md §27's phasing.
 */

// @ts-check

/**
 * Simulation step in seconds. Determinism requires this to
 * be a constant; the value is chosen for sub-perceptual
 * timing precision (~4 ms) at low CPU cost (~4 steps per
 * frame at 60 fps).
 */
const SIM_DT = 1 / 240;

/**
 * Per-curve runtime state. Holds the cursor's current
 * position along the curve and the bookkeeping the
 * simulation needs to drive cycleSpeeds advancement and
 * stopAtCycle halting. Lives in the Simulation's
 * id-keyed map; never serialised, never seen by the
 * inspector.
 */
class CurveRuntimeState {
    constructor() {
        /**
         * Cursor position along the curve, in [0, 1). t = 0
         * is the curve's start (first endpoint for line and
         * piste, theta = 0 / 3 o'clock for ellipse); t = 1
         * wraps back to t = 0. The wrap is purely a coordinate-
         * system artifact and does not count as a cycle
         * boundary; cycleProgress (below) tracks cycle
         * boundaries independently.
         * @type {number}
         */
        this.t = 0;
        /**
         * Magnitude-only accumulator of the current cycle's
         * progress, in [0, 1). Advances by |tDelta| per
         * step (or by beatsPerStep/cycleDuration when the
         * multiplier is zero, so a frozen cycle still ends
         * after one cycleDuration of time). When the
         * accumulator reaches 1, the cycle completes,
         * cycleCount increments, and the accumulator carries
         * the small overshoot into the next cycle so timing
         * stays accurate across boundaries.
         *
         * Tracking cycle progress separately from t is what
         * lets a curve with cycleSpeeds "-1" or "1 -1" work
         * correctly. If we used t wrapping to detect cycle
         * boundaries, a cursor starting at t = 0 with a
         * negative multiplier would wrap on the first step
         * and incorrectly count that as a completed cycle
         * — the cursor would flicker near the boundary
         * instead of traversing the full curve in reverse.
         * @type {number}
         */
        this.cycleProgress = 0;
        /**
         * Number of cycles completed since rewind. Indexes
         * cycleSpeeds modulo the list length, so the
         * multiplier in effect for the current cycle is
         * cycleSpeeds[cycleCount mod list-length].
         * @type {number}
         */
        this.cycleCount = 0;
        /**
         * When true the cursor is halted in place because
         * stopAtCycle was reached. Subsequent ticks skip
         * this curve entirely until the next rewind clears
         * the flag.
         * @type {boolean}
         */
        this.halted = false;
    }
}

export class Simulation {
    /**
     * @param {import("./transport.js").Transport} transport
     */
    constructor(transport) {
        this._transport = transport;
        /** @type {import("./scene.js").Scene | null} */
        this._scene = null;
        /** @type {Map<string, CurveRuntimeState>} */
        this._curveState = new Map();
        /**
         * Last elapsedSeconds value passed to tick. Used to
         * compute the delta for the next tick and to detect
         * rewind (when the new value is less than this).
         * @type {number}
         */
        this._lastElapsed = 0;
        /**
         * Sub-step accumulator. Holds time that has elapsed
         * since the last fixed step but isn't yet enough to
         * advance another step. Cleared on rewind.
         * @type {number}
         */
        this._accumulator = 0;
    }

    /**
     * Update the scene reference. Reconciles per-curve
     * runtime state by id: existing ids preserve their
     * state so playback continues across edits, new ids
     * start at t = 0, removed ids drop. Called from main.js
     * after each scene reload, alongside canvas.setScene.
     *
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        if (scene === null) {
            this._curveState.clear();
            return;
        }
        /** @type {Set<string>} */
        const seenIds = new Set();
        for (const c of scene.curves) {
            if (typeof c.id !== "string") continue;
            seenIds.add(c.id);
            if (!this._curveState.has(c.id)) {
                this._curveState.set(c.id, new CurveRuntimeState());
            }
        }
        for (const id of [...this._curveState.keys()]) {
            if (!seenIds.has(id)) this._curveState.delete(id);
        }
    }

    /**
     * Advance the simulation to the transport's current
     * elapsedSeconds. Runs as many fixed-dt steps as fit in
     * the elapsed-since-last-tick interval, with leftover
     * sub-step time held in the accumulator for the next
     * tick. Going backward in time is interpreted as a
     * rewind: every curve's runtime state resets and the
     * accumulator clears.
     *
     * Called from the Canvas's render loop. Idempotent
     * within a single elapsedSeconds value, so a second
     * tick at the same instant is a no-op.
     */
    tick() {
        const elapsed = this._transport.elapsedSeconds;
        if (elapsed < this._lastElapsed) {
            this._rewind();
            this._lastElapsed = 0;
            this._accumulator = 0;
            // Fall through so any positive elapsed time after
            // a rewind-and-resume still advances normally.
        }
        const delta = elapsed - this._lastElapsed;
        this._lastElapsed = elapsed;
        if (delta <= 0) return;
        this._accumulator += delta;
        while (this._accumulator >= SIM_DT) {
            this._step(SIM_DT);
            this._accumulator -= SIM_DT;
        }
    }

    /**
     * Reset every curve's runtime state to its rewind
     * position (t = 0, cycle 0, progress 0, not halted).
     * The map keys stay registered; only their contained
     * state resets. Called on detected rewind from tick().
     */
    _rewind() {
        for (const state of this._curveState.values()) {
            state.t = 0;
            state.cycleProgress = 0;
            state.cycleCount = 0;
            state.halted = false;
        }
    }

    /**
     * One fixed-step simulation tick. Walks every curve in
     * the scene that has an associated runtime state and
     * advances its cycle parameter by the score-beats that
     * elapse during dt seconds, scaled by the curve's
     * cycleSpeeds entry for the current cycle. Curves
     * already halted by stopAtCycle are skipped.
     *
     * @param {number} dt  Elapsed seconds in this step (always SIM_DT).
     */
    _step(dt) {
        if (this._scene === null) return;
        const bpm = this._transport.bpm;
        if (bpm === null || bpm <= 0) return;
        const beatsPerSecond = bpm / 60;
        const beatsPerStep = beatsPerSecond * dt;
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string") continue;
            const state = this._curveState.get(curve.id);
            if (state === undefined) continue;
            if (state.halted) continue;
            this._stepCurve(curve, state, beatsPerStep);
        }
    }

    /**
     * Advance one curve's runtime state by beatsPerStep
     * score beats. The current cycleSpeeds multiplier and
     * cycleDuration determine how fast t advances; cycle
     * completion is detected by cycleProgress reaching 1
     * (a magnitude-only accumulator independent of t's
     * wrap behaviour).
     *
     * Position update: state.t advances by tDelta and
     * wraps at the [0, 1) boundary so the cursor stays
     * within the curve's parameter range. The wrap is
     * purely cosmetic; it does not signal cycle
     * completion.
     *
     * Progress update: cycleProgress accumulates absolute
     * progress through the current cycle. For non-zero
     * multipliers this is |tDelta|; for the special
     * zero-multiplier case (cursor frozen for one cycle's
     * normal duration) it is beatsPerStep/cycleDuration so
     * the cycle still ends in cycleDuration of time. When
     * cycleProgress crosses 1, the cycle completes, the
     * count advances, and the small overshoot carries into
     * the next cycle to keep timing accurate.
     *
     * Note that the multiplier sampled at the start of the
     * step is used for the entire step, even if cycle
     * completion within the step would have switched to
     * the next cycleSpeeds entry. At SIM_DT the resulting
     * timing error at the boundary is sub-millisecond and
     * not perceptible. A future refinement could split the
     * step at boundaries if needed.
     *
     * @param {any} curve
     * @param {CurveRuntimeState} state
     * @param {number} beatsPerStep
     */
    _stepCurve(curve, state, beatsPerStep) {
        const cycleDuration = curve.cycleDuration;
        if (typeof cycleDuration !== "number" || cycleDuration <= 0) return;
        const multiplier = parseCycleSpeeds(curve.cycleSpeeds, state.cycleCount);
        // Signed fraction of one natural cycle traversed in
        // this step. Drives state.t.
        const tDelta = (beatsPerStep / cycleDuration) * multiplier;
        // Update displayed position with wrap. The wrap is
        // a coordinate-system convenience; it has no
        // semantic meaning for cycle counting.
        let newT = state.t + tDelta;
        while (newT >= 1) newT -= 1;
        while (newT < 0) newT += 1;
        state.t = newT;
        // Advance cycle progress. Always non-negative,
        // always increases. Magnitude scales with
        // |multiplier| so faster cycles end sooner; the
        // multiplier-zero special case substitutes
        // beatsPerStep/cycleDuration so a frozen cursor
        // still completes a cycle on schedule.
        const progressDelta = multiplier === 0
            ? beatsPerStep / cycleDuration
            : Math.abs(tDelta);
        state.cycleProgress += progressDelta;
        // Detect cycle completion. Multiple completions in
        // one step are possible at very high multipliers or
        // very short cycleDurations; the loop handles that.
        const stopAt = (typeof curve.stopAtCycle === "number") ? curve.stopAtCycle : -1;
        while (state.cycleProgress >= 1) {
            state.cycleProgress -= 1;
            state.cycleCount++;
            // Snap state.t to the cycle's end boundary so
            // discrete-step overshoot doesn't accumulate
            // visually across cycles. A forward cycle ends
            // at t = 0 (the wrap point of t = 1); a backward
            // cycle ends at t = 1 (the wrap point of t = 0).
            // Freeze cycles (multiplier 0) have no
            // direction, so the cursor stays at whatever
            // boundary the most recent non-zero cycle left
            // it at — which on a closed curve like an
            // ellipse is visually identical regardless, and
            // on an open curve correctly stops the freeze
            // at the natural endpoint of the prior motion.
            if (multiplier > 0) {
                state.t = 0;
            } else if (multiplier < 0) {
                state.t = 1;
            }
            if (stopAt >= 0 && state.cycleCount >= stopAt) {
                state.halted = true;
                return;
            }
        }
    }

    /**
     * Look up a curve's current cursor parameter t in
     * [0, 1). Returns 0 for curves that have no runtime
     * state, which can happen briefly during a scene reload
     * before setScene has been called with the new scene.
     * The Canvas calls this at draw time to position the
     * cursor along each curve's geometry.
     *
     * @param {string} curveId
     * @returns {number}
     */
    getCurveCursorT(curveId) {
        const state = this._curveState.get(curveId);
        if (state === undefined) return 0;
        return state.t;
    }
}

/**
 * Parse a cycleSpeeds string and return the multiplier that
 * applies to the given cycle count. The list cycles through
 * itself, so cycleCount mod list-length picks the entry. An
 * empty string, an unparseable token, or a non-finite number
 * falls back to 1 (uniform pacing). The validator gates
 * inspector input, so well-formed strings are the common
 * case; the defensive defaults here only matter for
 * hand-edited JSON that bypasses the validator.
 *
 * @param {any} speedsStr
 * @param {number} cycleCount
 * @returns {number}
 */
function parseCycleSpeeds(speedsStr, cycleCount) {
    if (typeof speedsStr !== "string") return 1;
    const trimmed = speedsStr.trim();
    if (trimmed === "") return 1;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) return 1;
    // Positive modulo so cycleCount can be any non-negative
    // integer and still index the list correctly. Defensive
    // against any future code path that might pass a negative
    // count (currently can't happen).
    const idx = ((cycleCount % tokens.length) + tokens.length) % tokens.length;
    const n = Number(tokens[idx]);
    if (!Number.isFinite(n)) return 1;
    return n;
}
