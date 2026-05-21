/**
 * Simulation module.
 *
 * Advances scene state forward in time. Owns the per-source
 * runtime state (cursor t for curves, position offset and
 * velocity for curves, position and velocity for sprites,
 * cycle phase and counter for all three kinds) so authored
 * data on Curve, Trigger, and Sprite instances stays clean.
 * Currently scoped to cursor advancement, sprite physics,
 * curve physics, and per-source cycle phase tracking;
 * pattern firing and beat events are deferred to later
 * milestones.
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
 * from the transport's BPM, the source's beatsPerCycle
 * field (the count of `beatInterval` units that make up one
 * cycle), and the source's beatInterval field (the unit
 * each count refers to). cycleDuration in seconds is
 * beatsPerCycle × beatIntervalQuarters × 60 / BPM, where
 * beatIntervalQuarters is the interval's duration expressed
 * in quarter notes (looked up via getBeatIntervalEntry).
 * With beatInterval defaulting to "Qtr" the formula reduces
 * to beatsPerCycle × 60 / BPM, preserving the pre-v2.3
 * implicit assumption. Each source's cycle phase advances
 * at rate 1/cycleDuration per second, wrapping at 1.0 to
 * start the next cycle. Cycle phase advances
 * unconditionally, regardless of canCycle — canCycle gates
 * pattern firing in a later stage, not phase tracking now.
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
 * Curve physics. Each step every curve's runtime position
 * offset (dx, dy) advances by vx*dt and vy*dt; the Canvas
 * applies the offset at draw time so the curve's authored
 * geometry on disk stays clean. Walls at x = ±canvasW/2 and
 * y = ±canvasH/2 bounce curves whose authored bbox was
 * fully inside the canvas at step start — the same inside-
 * only rule sprites use. The bbox-vs-edge test and the
 * curve-geometry-vs-edge test produce identical results for
 * line, ellipse, and piste shapes against axis-aligned
 * canvas edges, since each axis-aligned bbox edge sits at
 * the curve's extreme x or y coordinate. Future curved
 * shape types (beziers, splines) where control points stick
 * out past the actual curve will need a per-shape geometric
 * test, but the bbox branch keeps working for the existing
 * types. The authored bbox is cached on the curve's runtime
 * state and refreshed by setScene reconciliation when the
 * authored shape signature changes, so the physics step
 * pays only a single read per tick rather than recomputing
 * the bbox from the shape sub-object. On cycle wrap the
 * runtime offset returns to zero and live velocity resets
 * to authored, paralleling the sprite per-cycle home snap.
 *
 * Drag and resize gesture handoff. Drag gestures take
 * different paths depending on whether the dragged
 * object is at its home position. For a curve, "home"
 * means the runtime offset is zero (no physics motion
 * since the last rewind or cycle wrap); for a sprite,
 * it means the runtime x, y still equals the authored
 * x, y.
 *
 * Drag at home: the drag mutates the authored shape
 * (curve) or authored x, y (sprite) directly, and the
 * mouseup commit emits a translateSelection edit.
 * State-at-Start in the inspector updates and a
 * subsequent rewind returns the object to this new
 * home. The drag is a permanent move.
 *
 * Drag away from home: the drag mutates only the
 * runtime state via setCurveRuntimeOffset (curve) or
 * setSpriteRuntimePositionOnly (sprite). No mouseup
 * commit fires. The authored shape, the recorded auth
 * fields, and the inspector's State-at-Start row all
 * stay untouched, so the next rewind returns the
 * object to its unchanged home. The drag is a session-
 * only nudge that the rewind undoes. To permanently
 * move a moving object the user rewinds it first, then
 * drags from the now-at-home position.
 *
 * Resize (curves, any offset state): a curve resize
 * gesture calls bakeCurveOffsetIntoAuthored at gesture
 * start to fold the offset into the authored shape
 * (shape coordinates translate by (dx, dy); the
 * recorded shape signature and bbox cache refresh; dx
 * and dy zero) without changing the visible position.
 * The resize then mutates the now-at-home shape and
 * emits a scaleSelection edit on mouseup. The fold
 * prevents a setScene reconciliation from zeroing the
 * offset and visibly snapping the curve backwards.
 * State-at-Start updates after a resize regardless of
 * the starting offset, mirroring the drag-at-home
 * permanent-move semantics.
 *
 * Live velocity stays untouched across all gesture
 * paths so the object's motion continues uninterrupted.
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

import { getBeatIntervalEntry, DEFAULT_BEAT_INTERVAL } from "./beatIntervals.js";

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
 * Debug flag for curve-bounce logging. When true, every
 * canvas-wall bounce on a moving curve emits a console.log
 * line carrying the curve id, the axis that bounced, and
 * the post-bounce velocity. Mirrors LOG_CYCLE_WRAPS in
 * shape and default; flip the flag at the top of this
 * module to verify curve physics during development.
 */
const LOG_CURVE_BOUNCES = false;

/**
 * Compute the wall-clock cycle duration in seconds for a
 * source with the given beatsPerCycle and beatInterval,
 * under the master BPM. Returns 0 (a sentinel for "no
 * valid cycle") when bpm or beatsPerCycle is missing or
 * non-positive; the caller treats 0 as a skip and the
 * source's cycle phase doesn't advance that step.
 *
 * The beatInterval is resolved via getBeatIntervalEntry; an
 * unrecognised or missing token falls back to "Qtr"
 * (quarterNotes = 1), so a hand-edited scene.json with a
 * typo'd or absent beatInterval still plays at the count's
 * face-value duration in quarter notes rather than
 * silently halting cycle advancement.
 *
 * @param {number | null} bpm
 * @param {any} beatsPerCycle
 * @param {any} [beatInterval]
 * @returns {number}
 */
function cycleDurationSeconds(bpm, beatsPerCycle, beatInterval) {
    if (bpm === null || typeof bpm !== "number" || bpm <= 0) return 0;
    if (typeof beatsPerCycle !== "number" || beatsPerCycle <= 0) return 0;
    const token = (typeof beatInterval === "string" && beatInterval !== "")
        ? beatInterval
        : DEFAULT_BEAT_INTERVAL;
    const entry = getBeatIntervalEntry(token);
    const quarters = entry !== null ? entry.quarterNotes : 1;
    return (beatsPerCycle * quarters * 60) / bpm;
}

/**
 * Per-curve runtime state. Holds the cursor's position
 * along the curve, the cycle-tracking bookkeeping, and the
 * per-tick physics state (position offset from the
 * authored geometry and live velocity, plus authored
 * snapshots for snap-home and edit-detection). The cached
 * bbox of the authored shape is held here so the physics
 * step doesn't recompute it on every tick.
 *
 * The position model parallels sprites with a small twist:
 * sprites carry a single (x, y) point that's both authored
 * and live, while curves carry a whole shape sub-object
 * authored once and a (dx, dy) offset that the simulation
 * advances. The Canvas applies the offset at draw time, so
 * the authored shape on disk stays clean and curve geometry
 * edits land cleanly through the same translateShape path
 * sprites use for x/y edits.
 *
 * Lives in the Simulation's id-keyed map; never serialised,
 * never seen by the inspector.
 */
class CurveRuntimeState {
    /**
     * @param {any} curve
     */
    constructor(curve) {
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
        // Live position offset from the authored geometry,
        // in canvas units. Advances each step by vx*dt and
        // vy*dt. Resets to zero on rewind and on cycle wrap.
        // The Canvas reads these at draw time and translates
        // the curve's drawing context by (dx, -dy) before
        // rendering geometry, cursor, and markers.
        /** @type {number} */
        this.dx = 0;
        /** @type {number} */
        this.dy = 0;
        // Live velocity, advanced through wall bounces.
        // Initialises from authored vx/vy on construction
        // and on cycle wrap so the per-cycle trajectory
        // loops in lockstep with the cycle, parallelling
        // sprite behaviour.
        /** @type {number} */
        this.vx = numberOrZero(curve.vx);
        /** @type {number} */
        this.vy = numberOrZero(curve.vy);
        // Authored snapshots. setScene's reconciliation
        // compares the current Curve's authored vx and vy
        // against these and snaps the matching runtime
        // field when they differ, so a velocity edit while
        // playback runs lands on the moving curve. The same
        // values are the snap-home target for cycle wrap.
        /** @type {number} */
        this._authVx = this.vx;
        /** @type {number} */
        this._authVy = this.vy;
        // Cached signature and bbox of the authored shape.
        // shapeSignature is a stable JSON-ish string used to
        // detect authored-geometry edits in setScene
        // reconciliation; on a mismatch the runtime offset
        // snaps to zero (the curve restarts from its new
        // authored position) and the cached bbox refreshes.
        // _shapeBbox holds the authored axis-aligned bbox
        // for the physics step; null when the shape is
        // degenerate or not implemented, in which case the
        // curve drifts freely without bouncing.
        /** @type {string} */
        this._authShapeSig = shapeSignature(curve.shape);
        /** @type {{x1: number, y1: number, x2: number, y2: number} | null} */
        this._shapeBbox = shapeBbox(curve.shape);
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
        // Curves: reconcile by id. Existing state preserved
        // unless an authored shape or velocity field changed
        // since last seen, in which case the runtime offset
        // snaps to zero (the curve restarts from its new
        // authored position) and/or vx/vy snap to the new
        // authored values. Mirrors the per-axis snap-on-edit
        // path used for sprites; the difference is the
        // authored-shape comparison goes through a stable
        // signature string rather than per-field equality,
        // because curve geometry is a nested sub-object
        // whose shape varies by type.
        /** @type {Set<string>} */
        const seenCurveIds = new Set();
        for (const c of scene.curves) {
            if (typeof c.id !== "string") continue;
            seenCurveIds.add(c.id);
            const existing = this._curveState.get(c.id);
            if (existing === undefined) {
                this._curveState.set(c.id, new CurveRuntimeState(c));
                continue;
            }
            const newSig = shapeSignature(c.shape);
            if (newSig !== existing._authShapeSig) {
                existing.dx = 0;
                existing.dy = 0;
                existing._authShapeSig = newSig;
                existing._shapeBbox = shapeBbox(c.shape);
            }
            const authVx = numberOrZero(c.vx);
            const authVy = numberOrZero(c.vy);
            if (authVx !== existing._authVx) {
                existing.vx = authVx;
                existing._authVx = authVx;
            }
            if (authVy !== existing._authVy) {
                existing.vy = authVy;
                existing._authVy = authVy;
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
            state.dx = 0;
            state.dy = 0;
            state.vx = state._authVx;
            state.vy = state._authVy;
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
            const cd = cycleDurationSeconds(bpm, curve.beatsPerCycle, curve.beatInterval);
            this._stepCurve(curve, state, cd, dt);
        }
        for (const trigger of this._scene.triggers) {
            if (typeof trigger.id !== "string") continue;
            const state = this._triggerState.get(trigger.id);
            if (state === undefined) continue;
            const cd = cycleDurationSeconds(bpm, trigger.beatsPerCycle, trigger.beatInterval);
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
        // Physics. Translates the curve's runtime offset by
        // (vx*dt, vy*dt) and reflects velocity on contact
        // with canvas edges under the same inside-only rule
        // _stepSprites uses. A curve with vx=vy=0 falls
        // through immediately; the cost is one branch per
        // static curve per step.
        this._stepCurvePhysics(curve, state, dt);
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
            // Snap the physics state home: runtime offset
            // returns to zero and velocity resets to
            // authored. The curve's trajectory loops in
            // lockstep with its cycle, paralleling sprite
            // behaviour.
            state.dx = 0;
            state.dy = 0;
            state.vx = state._authVx;
            state.vy = state._authVy;
            logCycleWrap("curve", curve, state.cycleCount);
            if (stopAt >= 0 && state.cycleCount >= stopAt) {
                state.halted = true;
                return;
            }
        }
    }

    /**
     * Advance one curve's physics by dt seconds.
     *
     * The curve's runtime offset (state.dx, state.dy)
     * advances by velocity times dt, with reflection on
     * contact with the four canvas edges under the inside-
     * only rule. The shifted authored bbox is the collider:
     * if the bbox was fully inside the canvas at step start
     * and the post-integration bbox would cross a wall, the
     * offset is corrected so the bbox edge sits exactly at
     * the canvas edge and the corresponding velocity
     * component reflects. A bbox that started outside the
     * canvas (or wholly past it) drifts freely.
     *
     * The bbox test and the curve-geometry test produce
     * identical results for the current shape types (line,
     * ellipse, piste) against axis-aligned canvas edges —
     * each axis-aligned bbox edge sits at the curve's
     * extreme x or y coordinate, so the wall reaches the
     * bbox edge and the curve's farthest point
     * simultaneously. Future curved shape types (beziers,
     * splines) where control points can stick out past the
     * actual curve will need a per-shape geometric test;
     * the architecture for that is a small per-shape
     * dispatch on top of the bbox approach, but the bbox
     * branch keeps working for the existing types.
     *
     * Static curves (vx = vy = 0) fall through immediately:
     * the offset doesn't change, no wall test runs.
     *
     * @param {any} curve
     * @param {CurveRuntimeState} state
     * @param {number} dt  Elapsed seconds in this step.
     */
    _stepCurvePhysics(curve, state, dt) {
        if (state.vx === 0 && state.vy === 0) return;
        if (this._scene === null) return;
        const bbox = state._shapeBbox;
        if (bbox === null) {
            // Degenerate or unsupported shape — still drift
            // by velocity so the inspector edit isn't a
            // silent no-op, but skip the wall test.
            state.dx += state.vx * dt;
            state.dy += state.vy * dt;
            return;
        }
        const halfW = numberOrZero(this._scene.canvasW) / 2;
        const halfH = numberOrZero(this._scene.canvasH) / 2;
        const oldDx = state.dx;
        const oldDy = state.dy;
        let newDx = oldDx + state.vx * dt;
        let newDy = oldDy + state.vy * dt;
        if (halfW > 0 && halfH > 0) {
            const oldLeft = bbox.x1 + oldDx;
            const oldRight = bbox.x2 + oldDx;
            const oldTop = bbox.y1 + oldDy;
            const oldBottom = bbox.y2 + oldDy;
            const wasInside =
                oldLeft >= -halfW &&
                oldRight <= halfW &&
                oldTop >= -halfH &&
                oldBottom <= halfH;
            if (wasInside) {
                const newLeft = bbox.x1 + newDx;
                const newRight = bbox.x2 + newDx;
                const newTop = bbox.y1 + newDy;
                const newBottom = bbox.y2 + newDy;
                if (newRight > halfW) {
                    newDx = halfW - bbox.x2;
                    state.vx = -state.vx;
                    logCurveBounce(curve, "x", state);
                } else if (newLeft < -halfW) {
                    newDx = -halfW - bbox.x1;
                    state.vx = -state.vx;
                    logCurveBounce(curve, "x", state);
                }
                if (newBottom > halfH) {
                    newDy = halfH - bbox.y2;
                    state.vy = -state.vy;
                    logCurveBounce(curve, "y", state);
                } else if (newTop < -halfH) {
                    newDy = -halfH - bbox.y1;
                    state.vy = -state.vy;
                    logCurveBounce(curve, "y", state);
                }
            }
        }
        state.dx = newDx;
        state.dy = newDy;
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
     * Look up a curve's runtime position offset relative to
     * its authored geometry. Returns { dx, dy } in canvas
     * units, or null when no state exists for this id
     * (briefly possible during a scene reload before
     * setScene runs). Used by the Canvas at draw time to
     * translate the curve's drawing context, and by hit
     * testing to compensate for the live position during
     * playback.
     *
     * The returned object is a fresh literal, so mutating
     * it does not affect simulation state.
     *
     * @param {string} curveId
     * @returns {{dx: number, dy: number} | null}
     */
    getCurveRuntimeOffset(curveId) {
        const state = this._curveState.get(curveId);
        if (state === undefined) return null;
        return { dx: state.dx, dy: state.dy };
    }

    /**
     * Fold a curve's runtime (dx, dy) offset into its
     * authored shape: translate the authored shape
     * coordinates by the current offset, refresh the
     * recorded shape signature and bbox cache, and zero
     * the runtime offset. The visible position is
     * unchanged (authored + offset before equals
     * authored + 0 after), but the offset is no longer
     * carried as a runtime concept.
     *
     * Called by the Canvas at the start of a curve
     * resize gesture. Without this fold, the gesture's
     * mouseup commit would emit a scaleSelection edit
     * whose follow-up setScene reconciliation would
     * detect the authored shape changed and zero the
     * offset, producing a visible backwards jump as the
     * curve snapped to its (scale-applied) authored
     * position. Folding here aligns authored and visible
     * positions so reconciliation finds no offset to
     * clear; the resize handles' anchor (already in
     * visible canvas space from _getSelectionBbox) stays
     * aligned with the authored shape after the fold.
     *
     * Drag gestures take a different path: a drag on a
     * curve with non-zero offset uses
     * setCurveRuntimeOffset to mutate the runtime offset
     * alone, leaving the authored shape and the
     * inspector's State-at-Start row untouched. The bake
     * is reserved for resize because "resize the runtime
     * offset" has no coherent meaning the way
     * "translate the runtime offset" does for a drag.
     *
     * The curve's shape sub-object is mutated in place
     * via translateShapeCoords; this method does not
     * return a new object. Callers that snapshot the
     * shape (e.g. snapshotShapeForResize in canvas.js)
     * must do so after this call, not before.
     *
     * Live velocity (vx, vy) is intentionally left alone.
     * A resize is a geometric edit; the curve's velocity
     * continues uninterrupted across the gesture so
     * playback doesn't visually "hitch" when the user
     * grabs and releases. Mirrors the velocity-preserved
     * semantics of snapSpriteRuntimeToAuthored.
     *
     * No-op when the simulation has no runtime state for
     * this curve id (briefly possible during a scene
     * reload), when the offset is already zero, or when
     * the shape sub-object is missing.
     *
     * @param {any} curve  The curve object; shape mutated in place.
     */
    bakeCurveOffsetIntoAuthored(curve) {
        if (curve === null || typeof curve !== "object") return;
        if (typeof curve.id !== "string") return;
        const state = this._curveState.get(curve.id);
        if (state === undefined) return;
        if (state.dx === 0 && state.dy === 0) return;
        if (curve.shape === null || typeof curve.shape !== "object") return;
        translateShapeCoords(curve.shape, state.dx, state.dy);
        state._authShapeSig = shapeSignature(curve.shape);
        state._shapeBbox = shapeBbox(curve.shape);
        state.dx = 0;
        state.dy = 0;
    }

    /**
     * Directly set a curve's runtime offset (dx, dy)
     * without touching the authored shape, the recorded
     * shape signature / bbox cache, or velocity. Used by
     * the Canvas's drag pipeline when the user drags a
     * curve that is currently away from its home position
     * (non-zero offset at drag start): the drag becomes a
     * session-only nudge that visibly moves the curve to
     * the dropped position while leaving the authored
     * shape — and the inspector's State-at-Start row —
     * untouched. The next rewind resets the offset to
     * zero and returns the curve to its unchanged home.
     *
     * No-op when no runtime state exists for this id
     * (briefly possible during a scene reload). The
     * caller is expected to pass finite numbers; non-
     * finite values are not screened here because the
     * drag pipeline that calls this method derives the
     * offset from cursor positions and an initial-offset
     * snapshot, both of which are finite by construction.
     *
     * @param {string} curveId
     * @param {number} dx
     * @param {number} dy
     */
    setCurveRuntimeOffset(curveId, dx, dy) {
        const state = this._curveState.get(curveId);
        if (state === undefined) return;
        state.dx = dx;
        state.dy = dy;
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
     * Directly set a sprite's runtime position (x, y)
     * without touching the authored x, y, the recorded
     * _authX / _authY, or velocity. Counterpart to
     * snapSpriteRuntimeToAuthored for the drag pipeline's
     * away-from-home branch: when the user drags a sprite
     * that is currently away from its authored position
     * (state.x / y differs from sprite.x / y because the
     * sprite has been moving under physics), the drag
     * adjusts the runtime position only. The authored
     * x, y stay where they were and the next rewind
     * returns the sprite to its inspector-shown home.
     *
     * No-op when no runtime state exists for this id.
     * The caller is expected to pass finite numbers; see
     * setCurveRuntimeOffset for the same rationale.
     *
     * @param {string} spriteId
     * @param {number} x
     * @param {number} y
     */
    setSpriteRuntimePositionOnly(spriteId, x, y) {
        const state = this._spriteState.get(spriteId);
        if (state === undefined) return;
        state.x = x;
        state.y = y;
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
            const cd = cycleDurationSeconds(bpm, sprite.beatsPerCycle, sprite.beatInterval);
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
 * Stable string signature of a curve shape sub-object,
 * used by setScene's reconciliation path to detect
 * authored-geometry edits. JSON.stringify is exact and
 * order-sensitive, which matches the scene-format
 * conventions (key order is preserved through the
 * parse-mutate-stringify round trip), so two shapes that
 * stringify to the same text are geometrically identical
 * for our purposes. Returns the empty string for non-
 * object input (defensive against hand-edited JSON).
 *
 * @param {any} shape
 * @returns {string}
 */
function shapeSignature(shape) {
    if (shape === null || typeof shape !== "object") return "";
    try {
        return JSON.stringify(shape);
    } catch {
        return "";
    }
}

/**
 * Compute the axis-aligned bounding box of a curve shape,
 * or null if the shape is degenerate or not implemented.
 * Used by _stepCurvePhysics to test curve geometry against
 * canvas edges; cached on the curve's runtime state and
 * refreshed by setScene reconciliation whenever the
 * authored shape signature changes.
 *
 * Mirrors the equivalent helper in sceneEditor.js (and the
 * inspector module's computeShapeBbox); kept as a separate
 * copy here so the simulation doesn't import sceneEditor.
 * The three copies are intentionally small and stable; any
 * future drift between them would be a bug worth catching.
 *
 * @param {any} shape
 * @returns {{x1: number, y1: number, x2: number, y2: number} | null}
 */
function shapeBbox(shape) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return null;
    if (shape.type === "line") {
        const x1 = typeof shape.x1 === "number" ? shape.x1 : 0;
        const y1 = typeof shape.y1 === "number" ? shape.y1 : 0;
        const x2 = typeof shape.x2 === "number" ? shape.x2 : 0;
        const y2 = typeof shape.y2 === "number" ? shape.y2 : 0;
        return {
            x1: Math.min(x1, x2),
            y1: Math.min(y1, y2),
            x2: Math.max(x1, x2),
            y2: Math.max(y1, y2),
        };
    }
    if (shape.type === "ellipse") {
        const cx = typeof shape.cx === "number" ? shape.cx : 0;
        const cy = typeof shape.cy === "number" ? shape.cy : 0;
        const w = typeof shape.w === "number" ? shape.w : 0;
        const h = typeof shape.h === "number" ? shape.h : 0;
        return {
            x1: cx - w / 2,
            y1: cy - h / 2,
            x2: cx + w / 2,
            y2: cy + h / 2,
        };
    }
    if (shape.type === "piste") {
        const pts = shape.points;
        if (!Array.isArray(pts) || pts.length === 0) return null;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (!Array.isArray(p) || p.length < 2) continue;
            const px = typeof p[0] === "number" ? p[0] : 0;
            const py = typeof p[1] === "number" ? p[1] : 0;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        }
        if (!Number.isFinite(minX)) return null;
        return { x1: minX, y1: minY, x2: maxX, y2: maxY };
    }
    return null;
}

/**
 * Translate a curve's shape coordinates in place by
 * (dx, dy) canvas units. Per shape type:
 *   - line: x1, y1, x2, y2 shift by (dx, dy)
 *   - ellipse: cx, cy shift by (dx, dy); w, h unchanged
 *   - piste: every point shifts by (dx, dy)
 * Unknown or degenerate shape types are silent no-ops, so
 * a curve in a not-yet-implemented shape category stays
 * inert under the bake rather than producing partial
 * coordinate mutation.
 *
 * Mirrors sceneEditor.translateShape's per-type behaviour
 * but without the roundCoord pass. The drag/resize commit
 * that follows will write rounded values to scene.json
 * via translateSelection / scaleSelection; this in-place
 * mutation is the runtime-side fold from
 * bakeCurveOffsetIntoAuthored, where exact preservation
 * of the visible position matters more than canonical
 * rounding.
 *
 * @param {any} shape  Mutated in place.
 * @param {number} dx
 * @param {number} dy
 */
function translateShapeCoords(shape, dx, dy) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return;
    if (shape.type === "line") {
        if (typeof shape.x1 === "number") shape.x1 += dx;
        if (typeof shape.y1 === "number") shape.y1 += dy;
        if (typeof shape.x2 === "number") shape.x2 += dx;
        if (typeof shape.y2 === "number") shape.y2 += dy;
    } else if (shape.type === "ellipse") {
        if (typeof shape.cx === "number") shape.cx += dx;
        if (typeof shape.cy === "number") shape.cy += dy;
    } else if (shape.type === "piste") {
        if (!Array.isArray(shape.points)) return;
        for (const p of shape.points) {
            if (Array.isArray(p) && p.length >= 2) {
                if (typeof p[0] === "number") p[0] += dx;
                if (typeof p[1] === "number") p[1] += dy;
            }
        }
    }
}

/**
 * Emit a console.log line for a curve bounce. Only logs
 * when LOG_CURVE_BOUNCES is true; off by default so the
 * console stays clean during normal use. Useful for
 * verifying curve physics correctness without rendering
 * changes: flip the flag, give a curve a non-zero velocity
 * in the inspector, hit play, and watch for bounce events
 * in the console.
 *
 * @param {any} curve
 * @param {"x" | "y"} axis  Which wall the bounce reflected.
 * @param {CurveRuntimeState} state  Post-bounce state.
 */
function logCurveBounce(curve, axis, state) {
    if (!LOG_CURVE_BOUNCES) return;
    const id = (curve !== null && typeof curve === "object" && typeof curve.id === "string") ? curve.id : "?";
    console.log(`[curve-bounce] ${id} ${axis}-wall vx=${state.vx.toFixed(3)} vy=${state.vy.toFixed(3)} dx=${state.dx.toFixed(3)} dy=${state.dy.toFixed(3)}`);
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
