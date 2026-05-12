/**
 * Simulation module.
 *
 * Advances scene state forward in time. Owns the per-source
 * runtime state (cursor t for curves, position and velocity
 * for sprites, cycle phase and counter for all three kinds)
 * so authored data on Curve, Trigger, and Sprite instances
 * stays clean. Currently scoped to cursor advancement, sprite
 * physics, and per-source cycle phase tracking; pattern
 * firing and beat events are deferred to later milestones.
 *
 * Architecture:
 *   - Fixed-step simulation at SIM_DT seconds per step
 *     (1/240 s, ~4.17 ms). Determinism per DESIGN.md §7
 *     requires the step size to be constant; rewind and
 *     replay must reproduce identical state on every run.
 *   - tick() is the single entry point. Reads the
 *     transport's elapsedSeconds, computes how much time
 *     has passed since the last tick, and runs as many
 *     fixed steps as fit. The Canvas calls this from its
 *     render loop.
 *   - Going backward in time (elapsedSeconds < previous)
 *     is interpreted as a rewind: every source's runtime
 *     state resets and the accumulator clears. Rewind
 *     detection happens implicitly through the same entry
 *     point as normal advancement, no separate event
 *     needed.
 *   - Per-source runtime state lives in three id-keyed
 *     Maps (curves, triggers, sprites). setScene reconciles
 *     by id: matching ids preserve runtime state so
 *     playback continues across scene edits; new ids start
 *     at authored values; removed ids drop. For sprites,
 *     scene edits that change authored x/y/vx/vy (drags,
 *     inspector edits, hand JSON edits) are detected by
 *     comparing against the per-state record of last-seen
 *     authored values, and the matching runtime fields
 *     snap to the new authored value on detection.
 *
 * Master clock and cycle phase. Section 27's master clock
 * model: every source has a wall-clock cycle period derived
 * from the transport's BPM and the source's beatsPerCycle
 * field, where cycleDuration in seconds is beatsPerCycle * 60
 * / BPM. Each source's cycle phase advances at rate
 * 1/cycleDuration per second, wrapping at 1.0 to start the
 * next cycle. Cycle phase advances unconditionally,
 * regardless of canCycle — canCycle gates pattern firing in
 * a later stage, not phase tracking now.
 *
 * Per-cycle home snap. When a source's cycle phase wraps,
 * the source returns to its home position. For curves the
 * cursor t snaps back to 0 — the visual evidence the cycle
 * has started over. For sprites the live x, y, vx, vy snap
 * back to the authored values, the same fields _rewind()
 * uses, so a moving sprite returns to its starting position
 * and resumes its initial motion at every cycle boundary —
 * the trajectory loops in lockstep with the cycle. Triggers
 * don't currently move (no velocity in the schema) so the
 * snap is a no-op on position, but the cycle counter still
 * advances so future pattern firing has the timing.
 *
 * stopAtCycle (curves only). Curves carry a stopAtCycle
 * field giving the cycle count at which the cursor halts;
 * -1 means play forever. Sprites and triggers don't have a
 * stopAtCycle at this milestone, so they cycle indefinitely
 * until rewound.
 *
 * Sprite physics. Each step every sprite's runtime position
 * advances by vx*dt and vy*dt. Velocity is clamped to the
 * sprite's authored maxSpeed at the start of each step.
 * Walls at x = ±canvasW/2 and y = ±canvasH/2 bounce sprites
 * whose full bounding circle was inside the canvas at step
 * start — the inside-only rule. A sprite outside the canvas
 * drifts freely; once entirely inside, walls act as
 * barriers. This matches the soft-canvas semantics
 * documented in scene.js: the canvas is a play-area hint,
 * not a hard constraint, and a sprite that starts outside
 * (or is moved outside by a drag) can re-enter freely
 * without being trapped or teleported. Physics doesn't read
 * BPM — motion is in canvas units per real-time second
 * regardless of musical tempo.
 *
 * Pre-section-27 cycleSpeeds. The per-curve cycleSpeeds
 * field (whitespace-separated multipliers cycling through
 * themselves for forward/reverse/freeze cursor motion) was
 * the pre-section-27 mechanism for cycle-rate manipulation.
 * Section 27 replaces it with mini-notation modifiers
 * (.fast, .slow, .rev) at the pattern layer, so the field
 * is gone from the schema and the simulation runs all
 * cursors at multiplier 1 — uniform forward pacing only.
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
 * Debug flag for cycle-wrap logging. When true, every cycle
 * wrap on every source emits a console.log line carrying
 * the source kind, id, name, and new cycle counter. Useful
 * for verifying the master-clock timing during development.
 * Default off so the console stays clean for the composer
 * during normal use.
 */
const LOG_CYCLE_WRAPS = false;

/**
 * Compute the wall-clock cycle duration in seconds for a
 * source with the given beatsPerCycle, under the master
 * BPM. Returns 0 (a sentinel for "no valid cycle") when
 * either input is missing or non-positive; the caller
 * treats 0 as a skip and the source's cycle phase doesn't
 * advance that step.
 *
 * @param {number | null} bpm
 * @param {any} beatsPerCycle
 * @returns {number}
 */
function cycleDurationSeconds(bpm, beatsPerCycle) {
    if (bpm === null || typeof bpm !== "number" || bpm <= 0) return 0;
    if (typeof beatsPerCycle !== "number" || beatsPerCycle <= 0) return 0;
    return (beatsPerCycle * 60) / bpm;
}

/**
 * Per-curve runtime state. Holds the cursor's position
 * along the curve plus the cycle-tracking bookkeeping.
 * Lives in the Simulation's id-keyed map; never serialised,
 * never seen by the inspector.
 */
class CurveRuntimeState {
    constructor() {
        /**
         * Cursor position along the curve, in [0, 1). t = 0
         * is the curve's home position (first endpoint for
         * line and piste, theta = 0 / 3 o'clock for ellipse).
         * Snaps back to 0 on cycle wrap, providing the
         * visible per-cycle home return.
         * @type {number}
         */
        this.t = 0;
        /**
         * Magnitude-only accumulator of the current cycle's
         * progress, in [0, 1). Advances by dt/cycleDuration
         * per step. When the accumulator reaches 1, the cycle
         * completes, cycleCount increments, the small
         * overshoot carries into the next cycle so timing
         * stays accurate across boundaries, and t snaps to 0
         * for the visual home return.
         *
         * Tracking cycle progress separately from t is what
         * lets the t-snap-to-home behaviour avoid compounding
         * timing error: t snaps to 0 each cycle for visual
         * crispness while cycleProgress preserves the
         * overshoot that would otherwise be lost.
         * @type {number}
         */
        this.cycleProgress = 0;
        /**
         * Number of cycles completed since rewind. Curves
         * additionally compare this against stopAtCycle:
         * when cycleCount reaches stopAtCycle, halted is set
         * and the cursor stops advancing.
         * @type {number}
         */
        this.cycleCount = 0;
        /**
         * When true, the cursor is halted because
         * stopAtCycle was reached. Subsequent ticks skip
         * this curve entirely until the next rewind clears
         * the flag.
         * @type {boolean}
         */
        this.halted = false;
    }
}

/**
 * Per-trigger runtime state. Triggers don't currently move
 * (no velocity field in the schema), so the runtime state
 * holds only the cycle-tracking fields. The trigger's
 * displayed position remains the authored x, y. Lives in
 * the Simulation's id-keyed map; never serialised, never
 * seen by the inspector.
 */
class TriggerRuntimeState {
    constructor() {
        /** @type {number} */
        this.cycleProgress = 0;
        /** @type {number} */
        this.cycleCount = 0;
    }
}

/**
 * Per-sprite runtime state. Holds the live position and
 * velocity that the simulation advances each step, the
 * record of last-seen authored values for setScene's
 * snap-on-edit detection, and the cycle-tracking
 * bookkeeping. The authored-value record also serves as the
 * snap-home target for per-cycle resets. Lives in the
 * Simulation's id-keyed map; never serialised, never seen
 * by the inspector.
 */
class SpriteRuntimeState {
    /**
     * @param {any} sprite
     */
    constructor(sprite) {
        // Live runtime values, advanced by the simulation
        // and reset by rewind or per-cycle home snap. The
        // Canvas reads these at draw time and for hit-
        // testing, so they're the visible position regardless
        // of whether the simulation is currently advancing.
        this.x = numberOrZero(sprite.x);
        this.y = numberOrZero(sprite.y);
        this.vx = numberOrZero(sprite.vx);
        this.vy = numberOrZero(sprite.vy);
        // Authored values as last observed during scene
        // reconciliation. setScene compares the current
        // Sprite's authored fields against these to detect
        // edits that happened outside the simulation
        // (drags, inspector tweaks, hand JSON edits) and
        // snaps the matching runtime fields to the new
        // authored value when they differ. Position and
        // velocity are tracked independently so a position
        // edit doesn't reset velocity and vice versa. These
        // also serve as the snap-home target: when a cycle
        // wraps, the live runtime fields restore from these
        // values so the sprite returns to its starting
        // position with its initial motion intact.
        this._authX = this.x;
        this._authY = this.y;
        this._authVx = this.vx;
        this._authVy = this.vy;
        // Cycle tracking. Sprites have no cursor, so the
        // cycle phase drives only the per-cycle home snap
        // here; in a later stage the wrap also fires the
        // cycle-pattern callback.
        /** @type {number} */
        this.cycleProgress = 0;
        /** @type {number} */
        this.cycleCount = 0;
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
        /** @type {Map<string, TriggerRuntimeState>} */
        this._triggerState = new Map();
        /** @type {Map<string, SpriteRuntimeState>} */
        this._spriteState = new Map();
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
     * Update the scene reference. Reconciles per-source
     * runtime state by id across curves, triggers, and
     * sprites. Existing ids preserve their state so
     * playback continues across scene edits, new ids start
     * at authored values, removed ids drop.
     *
     * For sprites, an id that's already in the map gets its
     * runtime fields compared against the new Sprite's
     * authored fields and snapped to the new authored value
     * on any per-field difference. This is what makes drags
     * and inspector edits visible during playback: the edit
     * mutates JSON-authored, the new Scene carries the new
     * authored value, and reconciliation here drags the
     * runtime to match. Position and velocity are compared
     * independently so a velocity-only edit doesn't snap
     * position back to authored mid-flight, and vice versa.
     *
     * Called from main.js after each scene reload, alongside
     * canvas.setScene.
     *
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        if (scene === null) {
            this._curveState.clear();
            this._triggerState.clear();
            this._spriteState.clear();
            return;
        }
        // Curves: reconcile by id. Existing state preserved.
        /** @type {Set<string>} */
        const seenCurveIds = new Set();
        for (const c of scene.curves) {
            if (typeof c.id !== "string") continue;
            seenCurveIds.add(c.id);
            if (!this._curveState.has(c.id)) {
                this._curveState.set(c.id, new CurveRuntimeState());
            }
        }
        for (const id of [...this._curveState.keys()]) {
            if (!seenCurveIds.has(id)) this._curveState.delete(id);
        }
        // Triggers: reconcile by id. Cycle state preserved
        // across edits so a counter mid-piece doesn't reset
        // when the user adds another trigger.
        /** @type {Set<string>} */
        const seenTriggerIds = new Set();
        for (const t of scene.triggers) {
            if (typeof t.id !== "string") continue;
            seenTriggerIds.add(t.id);
            if (!this._triggerState.has(t.id)) {
                this._triggerState.set(t.id, new TriggerRuntimeState());
            }
        }
        for (const id of [...this._triggerState.keys()]) {
            if (!seenTriggerIds.has(id)) this._triggerState.delete(id);
        }
        // Sprites: reconcile by id. Existing state preserved
        // unless an authored field changed since last seen,
        // in which case the matching runtime field snaps.
        /** @type {Set<string>} */
        const seenSpriteIds = new Set();
        for (const s of scene.sprites) {
            if (typeof s.id !== "string") continue;
            seenSpriteIds.add(s.id);
            const existing = this._spriteState.get(s.id);
            if (existing === undefined) {
                this._spriteState.set(s.id, new SpriteRuntimeState(s));
                continue;
            }
            const authX = numberOrZero(s.x);
            const authY = numberOrZero(s.y);
            const authVx = numberOrZero(s.vx);
            const authVy = numberOrZero(s.vy);
            // Position-axis snap. Compared per axis so a
            // single-axis edit doesn't disturb the other
            // axis's runtime, and the X/Y comparisons stay
            // independent of any future per-axis edits.
            if (authX !== existing._authX) {
                existing.x = authX;
                existing._authX = authX;
            }
            if (authY !== existing._authY) {
                existing.y = authY;
                existing._authY = authY;
            }
            if (authVx !== existing._authVx) {
                existing.vx = authVx;
                existing._authVx = authVx;
            }
            if (authVy !== existing._authVy) {
                existing.vy = authVy;
                existing._authVy = authVy;
            }
        }
        for (const id of [...this._spriteState.keys()]) {
            if (!seenSpriteIds.has(id)) this._spriteState.delete(id);
        }
    }

    /**
     * Advance the simulation to the transport's current
     * elapsedSeconds. Runs as many fixed-dt steps as fit in
     * the elapsed-since-last-tick interval, with leftover
     * sub-step time held in the accumulator for the next
     * tick. Going backward in time is interpreted as a
     * rewind: every source's runtime state resets and the
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
     * Reset every source's runtime state to its rewind
     * position. Curves: t = 0, cycle progress and count 0,
     * halted false. Triggers: cycle progress and count 0
     * (no position to reset). Sprites: live x/y/vx/vy snap
     * back to the authored values, cycle progress and count
     * reset to 0. The map keys stay registered; only their
     * contained state resets. Called on detected rewind
     * from tick().
     *
     * The per-cycle home snap (in _stepCurve, _stepTrigger,
     * and _stepSprites) reuses the same restoration logic
     * but applies it per source on each cycle wrap rather
     * than across the whole scene at once.
     */
    _rewind() {
        for (const state of this._curveState.values()) {
            state.t = 0;
            state.cycleProgress = 0;
            state.cycleCount = 0;
            state.halted = false;
        }
        for (const state of this._triggerState.values()) {
            state.cycleProgress = 0;
            state.cycleCount = 0;
        }
        // Sprite rewind copies the per-state record of
        // last-seen authored values back into the live
        // runtime fields. The _auth fields stay where they
        // are — they track the authored values, which the
        // rewind doesn't change — so a subsequent setScene
        // that doesn't see new authored values won't snap
        // again.
        for (const state of this._spriteState.values()) {
            state.x = state._authX;
            state.y = state._authY;
            state.vx = state._authVx;
            state.vy = state._authVy;
            state.cycleProgress = 0;
            state.cycleCount = 0;
        }
    }

    /**
     * One fixed-step simulation tick. Walks every source in
     * the scene that has runtime state — curves first
     * (cursor advancement plus cycle phase), then triggers
     * (cycle phase only), then sprites (physics first, then
     * cycle phase). Each source's cycle duration is computed
     * from its own beatsPerCycle and the transport's BPM
     * via cycleDurationSeconds, so different sources can run
     * at different cycle rates simultaneously.
     *
     * @param {number} dt  Elapsed seconds in this step (always SIM_DT).
     */
    _step(dt) {
        if (this._scene === null) return;
        const bpm = this._transport.bpm;
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string") continue;
            const state = this._curveState.get(curve.id);
            if (state === undefined) continue;
            if (state.halted) continue;
            const cd = cycleDurationSeconds(bpm, curve.beatsPerCycle);
            this._stepCurve(curve, state, cd, dt);
        }
        for (const trigger of this._scene.triggers) {
            if (typeof trigger.id !== "string") continue;
            const state = this._triggerState.get(trigger.id);
            if (state === undefined) continue;
            const cd = cycleDurationSeconds(bpm, trigger.beatsPerCycle);
            this._stepTrigger(trigger, state, cd, dt);
        }
        // Sprite physics doesn't read BPM, but the cycle
        // phase does, so we pass it through. Physics first
        // means a sprite that wraps its cycle mid-step
        // snaps home from a position that includes this
        // step's motion, which matches the intended
        // semantics: the sprite moved during the cycle, and
        // at cycle's end it returns to its starting point.
        this._stepSprites(dt, bpm);
    }

    /**
     * Advance one curve's cursor and cycle phase by dt
     * seconds.
     *
     * Cursor: state.t advances by dt/cycleDuration each
     * step and wraps to [0, 1). On cycle completion, t
     * snaps to 0 explicitly — the visible home return at
     * each cycle boundary. The wrap-on-add above handles
     * mid-cycle wraparound when t exceeds 1; the explicit
     * snap inside the cycle-completion loop handles the
     * boundary case independently of floating-point drift.
     *
     * Cycle progress: cycleProgress accumulates absolute
     * progress through the current cycle. When it crosses
     * 1, the cycle completes, the count advances, and the
     * small overshoot carries into the next cycle so timing
     * stays accurate across boundaries — t loses the
     * overshoot to the snap-to-home, but cycleProgress
     * preserves it.
     *
     * @param {any} curve
     * @param {CurveRuntimeState} state
     * @param {number} cycleDuration  Wall-clock seconds per cycle.
     * @param {number} dt  Elapsed seconds in this step.
     */
    _stepCurve(curve, state, cycleDuration, dt) {
        if (cycleDuration <= 0) return;
        const tDelta = dt / cycleDuration;
        // Advance t with wrap. The wrap is a coordinate-
        // system convenience for the cursor display; the
        // semantically meaningful cycle wrap happens via
        // cycleProgress below.
        let newT = state.t + tDelta;
        while (newT >= 1) newT -= 1;
        state.t = newT;
        state.cycleProgress += tDelta;
        const stopAt = (typeof curve.stopAtCycle === "number") ? curve.stopAtCycle : -1;
        // Detect cycle completion. Multiple completions in
        // one step are possible at very short cycle
        // durations; the loop handles that.
        while (state.cycleProgress >= 1) {
            state.cycleProgress -= 1;
            state.cycleCount++;
            // Snap t to home. The accumulated overshoot
            // already lives in cycleProgress for timing
            // accuracy, so losing it from t here is fine —
            // the cursor visibly returns to the start of
            // the curve at every cycle boundary.
            state.t = 0;
            logCycleWrap("curve", curve, state.cycleCount);
            if (stopAt >= 0 && state.cycleCount >= stopAt) {
                state.halted = true;
                return;
            }
        }
    }

    /**
     * Advance one trigger's cycle phase by dt seconds.
     * Triggers don't move (no velocity in the schema), so
     * the only state that changes is cycle progress and
     * counter. On cycle wrap there's no position to snap
     * home — the trigger sits at its authored x, y
     * throughout. The counter is tracked so future pattern
     * firing has the timing.
     *
     * @param {any} trigger
     * @param {TriggerRuntimeState} state
     * @param {number} cycleDuration
     * @param {number} dt
     */
    _stepTrigger(trigger, state, cycleDuration, dt) {
        if (cycleDuration <= 0) return;
        state.cycleProgress += dt / cycleDuration;
        while (state.cycleProgress >= 1) {
            state.cycleProgress -= 1;
            state.cycleCount++;
            logCycleWrap("trigger", trigger, state.cycleCount);
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

    /**
     * Look up a curve's cycle-progress and cycle-counter
     * state. Returns null when no state exists for this id
     * (briefly possible during a scene reload before
     * setScene runs, or for ids the simulation has never
     * seen). Used by the pattern firing engine to detect
     * cycle wraps and compute audio start times for
     * pattern events.
     *
     * Returned shape: cycleCount is the number of completed
     * cycles since rewind; cycleProgress is in [0, 1) and
     * indicates how far into the current cycle the source
     * has advanced. The returned object is a fresh literal,
     * so mutating it does not affect simulation state.
     *
     * @param {string} curveId
     * @returns {{cycleCount: number, cycleProgress: number} | null}
     */
    getCurveCycleState(curveId) {
        const state = this._curveState.get(curveId);
        if (state === undefined) return null;
        return { cycleCount: state.cycleCount, cycleProgress: state.cycleProgress };
    }

    /**
     * Look up a sprite's cycle-progress and cycle-counter
     * state. Returns null when no state exists. Parallels
     * getCurveCycleState; used by the pattern firing
     * engine on the same continuous-firing path.
     *
     * Sprites also expose live position and velocity via
     * getSpriteRuntime; this method returns only the
     * cycle bookkeeping fields so the firing engine
     * doesn't have to know about the broader sprite
     * runtime shape.
     *
     * @param {string} spriteId
     * @returns {{cycleCount: number, cycleProgress: number} | null}
     */
    getSpriteCycleState(spriteId) {
        const state = this._spriteState.get(spriteId);
        if (state === undefined) return null;
        return { cycleCount: state.cycleCount, cycleProgress: state.cycleProgress };
    }

    /**
     * Look up a sprite's current runtime state. Returns
     * null when no state exists for this id (briefly
     * possible during a scene reload before setScene runs
     * with the new scene, or for ids the simulation has
     * never seen). The Canvas calls this at draw time for
     * sprite render positions and for hit-testing against
     * the visual sprite.
     *
     * The returned object is the live runtime state — the
     * same one the simulation mutates each step — so
     * callers should treat it as read-only. Mutating it
     * would silently drift from authored without going
     * through snapSpriteRuntimeToAuthored or setScene.
     *
     * @param {string} spriteId
     * @returns {SpriteRuntimeState | null}
     */
    getSpriteRuntime(spriteId) {
        const state = this._spriteState.get(spriteId);
        return state === undefined ? null : state;
    }

    /**
     * Copy the sprite's authored x/y into the matching
     * runtime fields and update the per-state record of
     * last-seen authored values to match. Used by the
     * canvas's drag pipeline to keep visual feedback in
     * sync with the cursor while a sprite is being moved —
     * the drag mutates the Scene's authored x/y for the
     * visual round-trip; this method propagates that
     * mutation into the simulation's runtime so the Canvas
     * (which reads runtime at draw time) shows the dragged
     * position.
     *
     * Velocity is intentionally NOT copied. A drag is a
     * positional edit; the sprite's velocity should
     * continue uninterrupted across the drag so playback
     * doesn't visually "hitch" when the user grabs and
     * releases. setScene's reconciliation handles the full
     * edit settlement, including any velocity change,
     * after the JSON commit cycle completes.
     *
     * No-op when the sprite has no runtime state — the
     * sprite was added in the same edit cycle and
     * reconciliation will create the state on the next
     * setScene with the just-mutated authored values.
     *
     * @param {any} sprite
     */
    snapSpriteRuntimeToAuthored(sprite) {
        if (sprite === null || typeof sprite !== "object") return;
        if (typeof sprite.id !== "string") return;
        const state = this._spriteState.get(sprite.id);
        if (state === undefined) return;
        const authX = numberOrZero(sprite.x);
        const authY = numberOrZero(sprite.y);
        state.x = authX;
        state.y = authY;
        state._authX = authX;
        state._authY = authY;
    }

    /**
     * Advance every sprite's runtime state by dt seconds.
     * Order per sprite:
     *
     *   1. Velocity ceiling: clamp vx, vy to authored
     *      maxSpeed.
     *   2. Position integration: x += vx*dt, y += vy*dt.
     *   3. Wall bounce under the inside-only rule (a sprite
     *      that wasn't fully inside the canvas at step
     *      start drifts freely; one that was inside bounces
     *      off any wall its post-integration position would
     *      have crossed). Bounce is perfectly elastic and
     *      treats X and Y axes independently.
     *   4. Cycle phase advancement at rate dt/cycleDuration.
     *   5. On cycle wrap, snap x/y/vx/vy back to authored
     *      values and increment the counter — the per-cycle
     *      home return that loops the sprite's trajectory
     *      with the cycle.
     *
     * The inside check uses the sprite's full bounding
     * circle (radius = displayDiameter/2 × scene.spriteScale)
     * so a sprite touching a wall from inside, edge-to-wall,
     * still counts as inside and bounces on the next outward
     * step.
     *
     * Sprite physics doesn't read BPM — motion is in canvas
     * units per real-time second regardless of musical
     * tempo. The cycle-phase step uses BPM plus the
     * sprite's beatsPerCycle to compute cycle duration via
     * cycleDurationSeconds; with cycleDuration 0 (missing
     * or zero BPM, missing or zero beatsPerCycle), the
     * cycle phase doesn't advance but the physics still
     * runs.
     *
     * @param {number} dt  Elapsed seconds in this step (always SIM_DT).
     * @param {number | null} bpm  Master tempo from the transport.
     */
    _stepSprites(dt, bpm) {
        if (this._scene === null) return;
        const halfW = numberOrZero(this._scene.canvasW) / 2;
        const halfH = numberOrZero(this._scene.canvasH) / 2;
        const spriteScale = (typeof this._scene.spriteScale === "number" && this._scene.spriteScale > 0)
            ? this._scene.spriteScale
            : 1;
        for (const sprite of this._scene.sprites) {
            if (typeof sprite.id !== "string") continue;
            const state = this._spriteState.get(sprite.id);
            if (state === undefined) continue;
            // 1. Velocity ceiling.
            const maxSpeed = (typeof sprite.maxSpeed === "number" && sprite.maxSpeed > 0)
                ? sprite.maxSpeed
                : Infinity;
            const speed = Math.hypot(state.vx, state.vy);
            if (speed > maxSpeed && speed > 0) {
                const factor = maxSpeed / speed;
                state.vx *= factor;
                state.vy *= factor;
            }
            // 2. Integrate.
            const oldX = state.x;
            const oldY = state.y;
            let newX = oldX + state.vx * dt;
            let newY = oldY + state.vy * dt;
            // 3. Wall bounce under the inside-only rule.
            const r = Math.max(0,
                (numberOrZero(sprite.displayDiameter) / 2) * spriteScale);
            const wasInside =
                (oldX + r <= halfW) &&
                (oldX - r >= -halfW) &&
                (oldY + r <= halfH) &&
                (oldY - r >= -halfH);
            if (wasInside && halfW > 0 && halfH > 0) {
                if (newX + r > halfW) {
                    newX = halfW - r;
                    state.vx = -state.vx;
                } else if (newX - r < -halfW) {
                    newX = -halfW + r;
                    state.vx = -state.vx;
                }
                if (newY + r > halfH) {
                    newY = halfH - r;
                    state.vy = -state.vy;
                } else if (newY - r < -halfH) {
                    newY = -halfH + r;
                    state.vy = -state.vy;
                }
            }
            state.x = newX;
            state.y = newY;
            // 4. Cycle phase. Skipped silently when cycle
            //    duration is 0 (missing/zero BPM, missing/zero
            //    beatsPerCycle) — physics still runs but the
            //    sprite never wraps.
            const cd = cycleDurationSeconds(bpm, sprite.beatsPerCycle);
            if (cd <= 0) continue;
            state.cycleProgress += dt / cd;
            // 5. On wrap, snap the sprite home and advance
            //    the counter. Multiple wraps in one step are
            //    possible at very short cycle durations; the
            //    loop handles that.
            while (state.cycleProgress >= 1) {
                state.cycleProgress -= 1;
                state.cycleCount++;
                state.x = state._authX;
                state.y = state._authY;
                state.vx = state._authVx;
                state.vy = state._authVy;
                logCycleWrap("sprite", sprite, state.cycleCount);
            }
        }
    }
}

/**
 * Coerce a value to a finite number, defaulting to 0 for
 * non-numeric or non-finite input. Used throughout the
 * simulation's defensive reads of authored fields, since
 * hand-edited scene.json may carry strings or missing
 * values that would otherwise propagate NaN through the
 * physics integration.
 * @param {any} v
 * @returns {number}
 */
function numberOrZero(v) {
    return (typeof v === "number" && Number.isFinite(v)) ? v : 0;
}

/**
 * Emit a console.log line for a cycle wrap on a source.
 * Only logs when LOG_CYCLE_WRAPS is true; the no-op path
 * costs almost nothing per cycle. Useful when developing
 * the master clock or diagnosing per-source timing issues
 * by flipping the flag at the top of this module.
 *
 * @param {"curve" | "trigger" | "sprite"} kind
 * @param {any} obj  The Curve / Trigger / Sprite.
 * @param {number} cycleCount  Counter value after this wrap.
 */
function logCycleWrap(kind, obj, cycleCount) {
    if (!LOG_CYCLE_WRAPS) return;
    const id = (obj !== null && typeof obj === "object" && typeof obj.id === "string") ? obj.id : "?";
    const name = (obj !== null && typeof obj === "object" && typeof obj.name === "string") ? obj.name : "";
    const nameSuffix = name === "" ? "" : ` "${name}"`;
    console.log(`[cycle] ${kind} ${id}${nameSuffix} cycle ${cycleCount}`);
}
