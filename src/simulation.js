/**
 * Simulation module.
 *
 * Advances scene state forward in time. Owns the per-curve
 * runtime state (current cycle parameter, completed cycle
 * count, halt flag) and the per-sprite runtime state
 * (position, velocity) so authored data on Curve and Sprite
 * instances stays clean. Currently scoped to cursor
 * advancement and sprite physics; beat firing and pattern-
 * driven event generation are deferred to later milestones.
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
 *     state resets to t = 0, cycle count zero, and every
 *     sprite's runtime state resets to its authored
 *     position and velocity. The accumulator clears.
 *     Rewind detection happens implicitly through the
 *     same entry point as normal advancement, no separate
 *     event needed.
 *   - Per-curve and per-sprite runtime state live in Maps
 *     keyed by id. setScene reconciles by id: matching
 *     ids preserve runtime state so playback continues
 *     across scene edits; new ids start at authored
 *     values; removed ids drop. For sprites, scene edits
 *     that change authored x/y/vx/vy (drags, inspector
 *     edits, hand JSON edits) are detected by comparing
 *     against the per-state record of last-seen authored
 *     values, and the matching runtime fields snap to
 *     the new authored value on detection.
 *
 * The Simulation is passive: no internal timer, no
 * requestAnimationFrame loop, no listeners on transport.
 * The Canvas owns the play loop; the Simulation is queried
 * on demand. Cursor advancement and sprite integration
 * happen during tick(); the Canvas reads each curve's
 * current t via getCurveCursorT and each sprite's current
 * x/y/vx/vy via getSpriteRuntime at draw time.
 *
 * Sprite physics. Each step, every sprite's runtime
 * position advances by vx*dt and vy*dt. Velocity is
 * clamped to the sprite's authored maxSpeed at the start
 * of each step. Walls at x = ±canvasW/2 and y = ±canvasH/2
 * bounce sprites whose full bounding circle was inside the
 * canvas at step start — the inside-only rule. A sprite
 * outside the canvas drifts freely; once entirely inside,
 * walls act as barriers. This matches the soft-canvas
 * semantics documented in scene.js: the canvas is a play-
 * area hint, not a hard constraint, and a sprite that
 * starts outside (or is moved outside by a drag) can
 * re-enter freely without being trapped or teleported.
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

/**
 * Per-sprite runtime state. Holds the live position and
 * velocity that the simulation advances each step, plus a
 * record of the last-seen authored values so setScene can
 * detect external edits (drag, inspector, hand JSON) and
 * snap runtime to the new authored values when they
 * differ. Lives in the Simulation's id-keyed map; never
 * serialised, never seen by the inspector.
 */
class SpriteRuntimeState {
    /**
     * @param {any} sprite
     */
    constructor(sprite) {
        // Live runtime values, advanced by the simulation
        // and reset by rewind. The Canvas reads these at
        // draw time and for hit-testing, so they're the
        // visible position regardless of whether the
        // simulation is currently advancing. On creation
        // they take their initial values from the sprite's
        // authored x/y/vx/vy — same effect as a rewind to
        // the just-loaded scene.
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
        // edit doesn't reset velocity and vice versa.
        this._authX = this.x;
        this._authY = this.y;
        this._authVx = this.vx;
        this._authVy = this.vy;
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
     * Update the scene reference. Reconciles per-curve and
     * per-sprite runtime state by id: existing ids preserve
     * their state so playback continues across edits, new
     * ids start at authored values, removed ids drop.
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
     * position (t = 0, cycle 0, progress 0, not halted)
     * and every sprite's runtime state back to its
     * authored position and velocity. The map keys stay
     * registered; only their contained state resets.
     * Called on detected rewind from tick().
     */
    _rewind() {
        for (const state of this._curveState.values()) {
            state.t = 0;
            state.cycleProgress = 0;
            state.cycleCount = 0;
            state.halted = false;
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
        if (bpm !== null && bpm > 0) {
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
        // Sprite physics doesn't depend on bpm — sprites
        // move in canvas units per real second regardless
        // of musical tempo — so it runs even when the bpm
        // guard above skips the cursor work.
        this._stepSprites(dt);
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

    /**
     * Look up a sprite's current runtime state. Returns
     * null when no state exists for this id, which can
     * happen briefly during a scene reload before setScene
     * has run with the new scene, or for ids the simulation
     * has never seen. The Canvas calls this at draw time
     * for sprite render positions, and for hit-testing
     * against the visual sprite (so a click on a moving
     * sprite catches it where the user sees it, not where
     * its authored position lives in scene.json).
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
     * sync with the cursor while a sprite is being moved
     * — the drag mutates the Scene's authored x/y for
     * the visual round-trip; this method propagates that
     * mutation into the simulation's runtime so the
     * Canvas (which reads runtime at draw time) shows the
     * dragged position.
     *
     * Velocity is intentionally NOT copied. A drag is a
     * positional edit; the sprite's velocity should
     * continue uninterrupted across the drag so playback
     * doesn't visually "hitch" when the user grabs and
     * releases. setScene's reconciliation handles the
     * full edit settlement, including any velocity
     * change, after the JSON commit cycle completes.
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
     * Each sprite's velocity is clamped to its authored
     * maxSpeed at the top of the step, then position
     * integrates by vx*dt and vy*dt, then walls are
     * resolved under the inside-only rule (a sprite that
     * wasn't fully inside the canvas at step start drifts
     * freely; one that was inside bounces off any wall its
     * post-integration position would have crossed).
     *
     * The bounce model is perfectly elastic — velocity
     * flips with no energy loss — and treats the X and Y
     * axes independently, so a sprite hitting a corner
     * bounces in both axes simultaneously. The inside
     * check uses the sprite's full bounding circle
     * (radius = displayDiameter/2 × scene.spriteScale)
     * so a sprite touching a wall from inside,
     * edge-to-wall, still counts as inside and bounces on
     * the next outward step.
     *
     * Sprite physics doesn't read bpm — motion is in
     * canvas units per real-time second — so this runs
     * even when the cursor-advancement path is skipped
     * for a missing or zero bpm.
     *
     * @param {number} dt  Elapsed seconds in this step (always SIM_DT).
     */
    _stepSprites(dt) {
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
            // Velocity ceiling. Authored maxSpeed is the
            // expected source; defensive against missing
            // or non-positive values from hand-edited
            // JSON.
            const maxSpeed = (typeof sprite.maxSpeed === "number" && sprite.maxSpeed > 0)
                ? sprite.maxSpeed
                : Infinity;
            const speed = Math.hypot(state.vx, state.vy);
            if (speed > maxSpeed && speed > 0) {
                const factor = maxSpeed / speed;
                state.vx *= factor;
                state.vy *= factor;
            }
            // Integrate.
            const oldX = state.x;
            const oldY = state.y;
            let newX = oldX + state.vx * dt;
            let newY = oldY + state.vy * dt;
            // Wall bouncing under the inside-only rule. A
            // sprite is "inside" iff its full bounding
            // circle sits within the canvas at step
            // start; only such sprites can bounce.
            // Sprites partially or wholly outside drift
            // freely — they may re-enter the canvas
            // through any wall, which protects against
            // the case where the user shrinks the canvas
            // around a sprite or drags one outside, and
            // matches the soft-canvas semantics that
            // curves also follow.
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
