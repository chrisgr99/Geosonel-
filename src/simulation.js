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
 * curves and triggers behave as before: a curve's cursor t
 * snaps back to 0 (the visual evidence the cycle has started
 * over), and a trigger, having no velocity, only advances its
 * counter. Sprites are now governed by their cycleSpeeds list
 * instead (see "cycleSpeeds (sprites)" below): each wrap
 * relaunches the velocity scaled by the cycle's entry and
 * leaves position continuous, snapping x, y back to the
 * authored home only when a zero-terminated list wraps to the
 * start of a new loop repeat. The counter still advances on
 * every wrap so future pattern firing has the timing.
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
 * cycleSpeeds (curves only). Each curve carries a whitespace-
 * separated list of numeric per-cycle speed multipliers in
 * the authored cycleSpeeds field (integers or decimals
 * accepted; e.g. "1 0.5 -2"). The simulation walks the loop
 * body in order, wrapping the index back to 0 after the last
 * body entry. A positive value N compresses that cycle's
 * wall-clock duration to baseCycleDuration / N with the
 * cursor advancing from t=0 to t=1; a negative N also
 * compresses by |N| but reverses the cursor (t goes from 1
 * to 0). A trailing zero is a loop terminator, matching the
 * sprite reading: it is not a cycle of its own, the entries
 * before it are the loop body, and on wrapping past the body
 * the list restarts from entry 0 with the cursor reset to
 * the start of that entry — t=0 for a positive first entry,
 * t=1 (the far end) for a negative first entry, mirroring how
 * a negative-leading list launches from a rewind. So a zero
 * loops the body forever rather than halting; stopAtCycle is
 * the way to actually stop a curve. Because a curve's cursor
 * already returns to its direction-home at every cycle
 * boundary, the loop restart's reset is usually
 * indistinguishable from an ordinary boundary — the audible
 * change a zero makes is that the body loops instead of the
 * curve freezing. parseCycleSpeeds drops any entries after
 * the first zero, and cycleSpeedsLoopLength gives the body
 * length the index wraps over. The simulation's per-curve
 * speedList is cached on the runtime state at construction
 * and re-parsed by the setScene reconciliation when the
 * authored cycleSpeeds string changes. speedIndex isn't
 * tracked directly — it derives from cycleCount modulo the
 * loop-body length, so a paste / duplicate / fresh-add mid-
 * play that snaps cycleCount to the score grid lands at the
 * correct speed entry automatically.
 *
 * Direction reversal across the boundary between two adjacent
 * cycles preserves the cursor's position rather than snapping
 * it home: a positive cycle followed by a negative one leaves
 * the cursor at t=1 (where the positive cycle ended, and
 * equivalently the home for the incoming negative cycle), and
 * the cursor starts moving back toward t=0. Same-direction
 * adjacent cycles snap to the direction's home at the
 * boundary (t=0 for positive, t=1 for negative), the standard
 * cycle-restart behaviour preserved from pre-cycleSpeeds.
 *
 * cycleSpeeds (sprites). Sprites carry the same authored
 * cycleSpeeds list as curves, but interpret it differently.
 * The list is read as a repeating loop, one entry per cycle,
 * each entry a multiplier on the sprite's authored velocity
 * (a negative entry reverses both vx and vy). The cycle CLOCK
 * is untouched — only the launch velocity scales — so the
 * sprite travels farther or in reverse within a same-length
 * cycle. Position is CONTINUOUS across cycles by default:
 * each cycle resumes from wherever the previous one left the
 * sprite, so "1 2" drifts out and speeds up, and "1 -1" runs
 * out then back for a smooth round trip, neither resetting
 * position. Velocity is continuous too: a cycle boundary
 * scales the current velocity by the ratio of the new entry
 * to the previous one, so wall bounces carry across
 * boundaries and a plain "1" keeps its heading instead of
 * snapping back to the authored direction each cycle. Only a
 * home teleport (below) or a rewind re-derives velocity
 * directly from authored.
 *
 * A trailing zero changes that. A zero must be the last entry
 * (parseCycleSpeeds drops anything after it, and the inspector
 * greys it), and it is not a cycle of its own: it marks the
 * loop's end. The non-zero entries before the zero are the
 * loop body, and on wrapping back to the first entry the
 * sprite teleports to its authored home position. So "1 0"
 * runs out for one cycle then snaps home every cycle (the
 * pre-cycleSpeeds spring behaviour), and "1 2 0" runs out and
 * speeds up, then snaps home and repeats. maxSpeed remains a
 * hard ceiling via the per-step velocity clamp. The per-sprite
 * speedList is cached at construction and re-parsed by setScene
 * when the authored string changes.
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
 * Parse a cycleSpeeds string into an array of numbers.
 * Permissive runtime parser: any malformed input falls back
 * to [1] (the default single-positive-speed list) so a hand-
 * edited scene.json with a typo doesn't silently stall the
 * source. Entries after the first zero are dropped because a
 * zero is a loop terminator (it resets the source and
 * restarts the list), making anything past it unreachable.
 *
 * Speeds can be any finite real number. Positive values
 * advance the cursor forward at that multiplier (so 2 is
 * double speed, 0.5 is half speed); negatives reverse with
 * the same magnitude rule; an exact zero terminates the
 * loop. The inspector's validateCycleSpeeds at the edit edge enforces
 * a slightly stricter syntactic check (rejects exponential
 * notation for legibility), so values reaching this parser
 * through a user-driven commit are already clean; the
 * permissive fallback here only catches hand-edited or
 * AI-edited scene.json that bypasses the inspector.
 *
 * @param {any} str
 * @returns {number[]}
 */
function parseCycleSpeeds(str) {
    if (typeof str !== "string") return [1];
    const trimmed = str.trim();
    if (trimmed === "") return [1];
    const tokens = trimmed.split(/\s+/);
    /** @type {number[]} */
    const result = [];
    for (const tok of tokens) {
        if (!/^-?(\d+\.?\d*|\.\d+)$/.test(tok)) return [1];
        const n = Number(tok);
        if (!Number.isFinite(n)) return [1];
        result.push(n);
        if (n === 0) break;
    }
    if (result.length === 0) return [1];
    return result;
}

/**
 * Loop-body length of a cycleSpeeds list: the number of
 * entries before the first zero, or the full length when
 * there is no zero. A zero is a loop terminator (the source
 * resets — a sprite teleports home, a curve's cursor returns
 * to the start — and the list restarts from entry 0), so the
 * entries that actually play and repeat are those before it.
 * parseCycleSpeeds guarantees any zero is the last element,
 * so this is simply the index of that zero. Returns 0 for an
 * empty list or a leading zero (no body to play); callers
 * treat 0 as the degenerate parked-at-start case.
 *
 * @param {number[]} speedList
 * @returns {number}
 */
function cycleSpeedsLoopLength(speedList) {
    if (!Array.isArray(speedList) || speedList.length === 0) return 0;
    const zeroIdx = speedList.indexOf(0);
    return zeroIdx === -1 ? speedList.length : zeroIdx;
}

/**
 * Closed-form computation of a source's cycle phase at a
 * given global time. Given the global elapsed time T, the
 * source's base cycleDuration D (in seconds, before any
 * cycleSpeeds factor), and its parsed speedList, returns the
 * cycle index, fractional progress within that cycle, the
 * direction-adjusted cursor parameter t, and a halted flag.
 *
 * Algorithm. Walk through speedList accumulating each cycle's
 * wall-clock duration D / |speed| until the running total
 * passes T; the cycle landed in is the current cycle, the
 * leftover time divided by that cycle's duration is
 * cycleProgress, and the sign of the current cycle's speed
 * determines t (positive: t = progress; negative: t =
 * 1 - progress). The sign only affects the final cursor
 * orientation — time accumulation uses |speed| throughout,
 * since a negative-speed cycle takes the same wall-clock
 * duration as its positive twin (the cursor just traverses
 * the curve in the opposite direction).
 *
 * Since speedList repeats, summing one full rotation worth of
 * durations and dividing T by it lets the walk skip whole
 * rotations in O(1) before walking the remainder through
 * speedList once in O(L). Total cost per call is O(L)
 * regardless of how long the session has been running.
 *
 * A trailing zero is a loop terminator, not a halt: only the
 * entries before it (the loop body, length given by
 * cycleSpeedsLoopLength) are walked, and the body repeats
 * forever. The body contains no zero, so the rotation is
 * always finite and the rotation-skip shortcut applies for
 * every list. halted is therefore always false in the
 * returned shape; the field is retained for call-site
 * compatibility (the stopAtCycle halt is handled in
 * _stepCurve, not here). A leading zero (empty body) parks
 * the source at the start.
 *
 * Triggers and sprites carry no cycleSpeeds field; the caller
 * passes [1], which reduces this function to cycleCount =
 * floor(T / D), cycleProgress = (T / D) - cycleCount, t =
 * cycleProgress.
 *
 * Used by _stepCurve / _stepTrigger / _stepSprites for the
 * per-step timing-edit snap, and by forceTimingSnapAll which
 * the firing engine calls so simulation state is consistent
 * with the new cycleDuration before the bootstrap reads
 * cycleState for audio anchoring. Replaces an earlier
 * accumulator-based snap that used base cycleDuration in
 * places where effective cycleDuration was needed; that
 * older snap miscomputed phases for any source with
 * cycleSpeeds != "1" and caused cross-source desync on every
 * BPM or per-source timing edit mid-playback.
 *
 * @param {number} T  Global elapsed time in seconds (typically _simTime).
 * @param {number} D  Base cycleDuration in seconds.
 * @param {number[]} speedList  Array of cycle speeds; non-empty.
 * @returns {{cycleCount: number, cycleProgress: number, t: number, halted: boolean}}
 */
function computeCyclePhaseFromGlobalTime(T, D, speedList) {
    if (!Number.isFinite(T) || T < 0) {
        return { cycleCount: 0, cycleProgress: 0, t: 0, halted: false };
    }
    if (!(D > 0) || !Array.isArray(speedList) || speedList.length === 0) {
        return { cycleCount: 0, cycleProgress: 0, t: 0, halted: false };
    }
    const loopLen = cycleSpeedsLoopLength(speedList);
    if (loopLen <= 0) {
        return { cycleCount: 0, cycleProgress: 0, t: 0, halted: false };
    }
    // Sum of one full loop through the body. The body has no
    // zero (the zero, if any, is a loop terminator excluded by
    // loopLen), so the rotation is always finite and the
    // rotation-skip shortcut applies for any list.
    let sumPerRotation = 0;
    for (let i = 0; i < loopLen; i++) {
        sumPerRotation += D / Math.abs(speedList[i]);
    }
    let remainingTime;
    let baseCycleCount;
    if (sumPerRotation <= 0) {
        remainingTime = T;
        baseCycleCount = 0;
    } else {
        const fullRotations = Math.floor(T / sumPerRotation);
        remainingTime = T - fullRotations * sumPerRotation;
        baseCycleCount = fullRotations * loopLen;
    }
    for (let i = 0; i < loopLen; i++) {
        const speed = speedList[i];
        const cycleDuration = D / Math.abs(speed);
        if (remainingTime < cycleDuration) {
            const cycleProgress = remainingTime / cycleDuration;
            const t = speed < 0 ? 1 - cycleProgress : cycleProgress;
            return {
                cycleCount: baseCycleCount + i,
                cycleProgress,
                t,
                halted: false,
            };
        }
        remainingTime -= cycleDuration;
    }
    // Defensive: should be unreachable since remainingTime was
    // reduced modulo sumPerRotation. Fall back to start of the
    // next loop.
    return {
        cycleCount: baseCycleCount + loopLen,
        cycleProgress: 0,
        t: 0,
        halted: false,
    };
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
        // Last cycleDuration seen by _stepCurve. Compared
        // against the cycleDuration computed from the
        // current authored fields on each step; a difference
        // means the user edited beatsPerCycle, beatInterval,
        // or master BPM since the previous step, and the
        // simulation snaps this curve's cycleCount, cycle-
        // Progress, and t to values derived directly from
        // transport.elapsedSeconds / new cycleDuration
        // (rather than continuing the accumulator across
        // the D change, which would leave the curve in a
        // phase relative to score t=0 that no longer matches
        // any other curve's phase). The snap produces a
        // visible cursor jump on the timing edit —
        // accepted as the cost of preserving cross-curve
        // rhythmic alignment, since the alternative is
        // requiring a rewind after every timing edit to
        // resync. Initialised to 0; the first step on a
        // fresh state treats _lastCycleDuration === 0 as
        // "no previous value" rather than "previous was 0",
        // so play from rewind doesn't false-trigger a snap.
        //
        // This compares against BASE cycleDuration (before
        // any cycleSpeeds speed factor) so cycleSpeeds-driven
        // per-cycle effective-duration variation doesn't
        // false-trigger the snap on every cycle wrap. The
        // BASE duration is what _stepCurve receives as its
        // cycleDuration parameter; the speed factor is
        // applied inside _stepCurve and never makes it into
        // this comparison.
        /** @type {number} */
        this._lastCycleDuration = 0;

        // Per-cycle speed multiplier list parsed from the
        // authored cycleSpeeds string. The runtime parser
        // (parseCycleSpeeds) drops entries after a first
        // zero since they are unreachable, and falls back
        // to [1] on any malformed input. A trailing zero is
        // a loop terminator (reset the cursor to the start,
        // restart the list), not a halt. Walked by _stepCurve
        // via speedList[cycleCount % cycleSpeedsLoopLength]
        // each step — speedIndex isn't a separate field
        // because it derives directly from cycleCount, so a
        // paste / duplicate / fresh-add mid-play that snaps
        // cycleCount to the score grid lands at the correct
        // speed entry without any extra bookkeeping.
        /** @type {number[]} */
        this.speedList = parseCycleSpeeds(curve.cycleSpeeds);

        // Last-seen authored cycleSpeeds string. The set-
        // Scene reconciliation compares the current Curve's
        // authored cycleSpeeds against this; on change, the
        // speedList is re-parsed in place. cycleCount stays
        // put (the new list takes effect against the current
        // cycle position via the modulo), which means an
        // edit that introduces a new direction or halt may
        // take visible effect immediately or at the next
        // wrap depending on whether the change touches the
        // current cycle's entry or a later one.
        /** @type {string} */
        this._lastCycleSpeedsString =
            typeof curve.cycleSpeeds === "string" ? curve.cycleSpeeds : "1";
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
        /**
         * Last cycleDuration seen by _stepTrigger. See
         * CurveRuntimeState._lastCycleDuration for the
         * full reasoning; the trigger version is identical
         * minus the cursor (triggers have no t).
         * @type {number}
         */
        this._lastCycleDuration = 0;
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
        /**
         * Last cycleDuration seen by _stepSprites. See
         * CurveRuntimeState._lastCycleDuration for the
         * full reasoning; the sprite version is identical
         * minus the cursor (sprites have no t).
         * @type {number}
         */
        this._lastCycleDuration = 0;

        // Per-cycle speed multiplier list parsed from the
        // authored cycleSpeeds string. Read as a repeating
        // loop, one entry per cycle, each a multiplier on the
        // authored velocity (negative reverses direction).
        // Position is continuous across cycles; a trailing
        // zero is not a cycle but a loop terminator that snaps
        // the sprite home on each repeat (see _spriteCycleSpeed).
        // parseCycleSpeeds keeps the list up to and including
        // the first zero, dropping anything after, and falls
        // back to [1] on malformed input.
        /** @type {number[]} */
        this.speedList = parseCycleSpeeds(sprite.cycleSpeeds);
        // Last-seen authored cycleSpeeds string. setScene
        // re-parses speedList in place when this changes.
        /** @type {string} */
        this._lastCycleSpeedsString =
            typeof sprite.cycleSpeeds === "string" ? sprite.cycleSpeeds : "1";
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
         * Simulation time advanced through so far, in
         * seconds since the most recent rewind. Increments
         * by SIM_DT after each fixed substep in tick(); the
         * value during a substep call is the time at the
         * START of that substep (the moment the simulation
         * is transitioning from). Used by the timing-edit
         * snap in _stepCurve / _stepTrigger / _stepSprites
         * to derive grid-aligned cycleCount and cycle-
         * Progress values from a precise reference frame:
         * transport.elapsedSeconds (and the _lastElapsed
         * mirror) is the START-OF-TICK transport time, which
         * can be up to one frame's delta ahead of the actual
         * substep moment when a tick processes multiple
         * substeps. Using _simTime instead aligns the
         * snapped curve's cycleProgress with the
         * accumulator-based cycleProgress of unedited
         * curves, since both end up referencing the same
         * substep-precise sim time, preserving cross-curve
         * rhythmic alignment to within the SIM_DT step
         * granularity (~4 ms) rather than the per-frame
         * granularity (~16 ms) of _lastElapsed.
         * @type {number}
         */
        this._simTime = 0;
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
        // Master BPM read once for the new-state grid-snap
        // path below. A freshly-created state (duplicate,
        // paste, or fresh-add mid-play) needs its cycle
        // phase aligned to the score-global grid for the
        // source's cycleDuration so it plays in sync with
        // any other source already running at that rate.
        // Without this snap, the new state would start at
        // cycleProgress=0 / cycleCount=0 — the constructor
        // defaults, which correspond to score t=0, not to
        // the actual current sim moment — and its beats
        // would land off-grid until the next rewind. See
        // _snapNewStateToGrid for the formula.
        const bpm = this._transport.bpm;
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
                const newState = new CurveRuntimeState(c);
                this._snapNewStateToGrid(
                    newState,
                    cycleDurationSeconds(bpm, c.beatsPerCycle, c.beatInterval),
                    true,
                );
                this._curveState.set(c.id, newState);
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
            // cycleSpeeds reconciliation. When the authored
            // string changes, re-parse the speedList in
            // place. cycleCount stays put (the new list takes
            // effect against the current cycle index via the
            // modulo-loop-body read in _stepCurve), so an edit
            // that touches the current cycle's entry takes
            // effect immediately on the next step while edits
            // to other entries take effect at the next wrap
            // that lands on them. state.halted is not touched
            // here: a zero in cycleSpeeds is a loop terminator
            // rather than a halt, so editing the list never
            // needs to clear a halt — only stopAtCycle halts a
            // curve, and only a rewind clears that.
            const newCycleSpeedsStr =
                typeof c.cycleSpeeds === "string" ? c.cycleSpeeds : "1";
            if (newCycleSpeedsStr !== existing._lastCycleSpeedsString) {
                existing._lastCycleSpeedsString = newCycleSpeedsStr;
                existing.speedList = parseCycleSpeeds(newCycleSpeedsStr);
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
                const newState = new TriggerRuntimeState();
                this._snapNewStateToGrid(
                    newState,
                    cycleDurationSeconds(bpm, t.beatsPerCycle, t.beatInterval),
                    false,
                );
                this._triggerState.set(t.id, newState);
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
                const newState = new SpriteRuntimeState(s);
                this._snapNewStateToGrid(
                    newState,
                    cycleDurationSeconds(bpm, s.beatsPerCycle, s.beatInterval),
                    false,
                );
                // Scale the launch velocity by the speed entry
                // for the snapped cycle. The constructor put
                // position at the authored home and left vx/vy
                // at raw authored, so this applies the
                // multiplier exactly once; any teleport for the
                // snapped cycle is moot since the position is
                // already home.
                const { speed } = this._spriteCycleSpeed(newState, newState.cycleCount);
                newState.vx = newState._authVx * speed;
                newState.vy = newState._authVy * speed;
                this._spriteState.set(s.id, newState);
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
            // cycleSpeeds reconciliation. Re-parse the
            // speedList in place when the authored string
            // changes; cycleCount stays put so the new list
            // takes effect against the current cycle index on
            // the next wrap. The per-axis velocity snaps above
            // set the raw authored vx/vy; the current cycle's
            // multiplier re-applies at the next cycle wrap or
            // rewind, mirroring the curve's "edit lands now,
            // speed re-derives at the boundary" behaviour.
            const newCycleSpeedsStr =
                typeof s.cycleSpeeds === "string" ? s.cycleSpeeds : "1";
            if (newCycleSpeedsStr !== existing._lastCycleSpeedsString) {
                existing._lastCycleSpeedsString = newCycleSpeedsStr;
                existing.speedList = parseCycleSpeeds(newCycleSpeedsStr);
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
            this._simTime = 0;
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
            this._simTime += SIM_DT;
            this._accumulator -= SIM_DT;
        }
    }

    /**
     * Force the per-source timing-edit snap to run for every
     * curve, trigger, and sprite whose cached _lastCycleDuration
     * differs from what the current authored fields and master
     * BPM imply. Called by the firing engine at the top of its
     * own tick so the bootstrap below reads a fully snapped
     * cycleState even on a tick where the simulation's per-step
     * accumulator hasn't reached SIM_DT yet (no _step has run
     * this frame). Without this, a no-step tick after a BPM
     * change or per-source timing edit would leave the firing
     * engine bootstrapping audio anchors against the previous
     * tick's cycleCount and cycleProgress — stale values
     * relative to the new cycleDuration — producing audioTimes
     * that don't lie on the new score grid. Those stale
     * pendingEvents then persist into subsequent ticks
     * alongside the eventually-correct ones from the snap-tick
     * bootstrap, and the resulting double-grid audio survives
     * until the next rewind.
     *
     * The snap logic mirrors what _stepCurve, _stepTrigger,
     * and _stepSprites do at the top of each step (closed-form
     * computeCyclePhaseFromGlobalTime against _simTime), without
     * the subsequent dt advancement. Idempotent: sources whose
     * _lastCycleDuration already matches the current
     * cycleDuration are skipped, and sources at rewind defaults
     * (_lastCycleDuration === 0) are also skipped since their
     * cycleCount = 0 / cycleProgress = 0 is correct for any
     * cycleDuration at simTime = 0. Already-halted curves are
     * left alone — a halted curve doesn't need re-anchoring
     * since it isn't advancing.
     *
     * Catches both the BPM-edit and per-source-timing-edit
     * cases. The firing engine's BPM-change detection block
     * complements this by clearing every source's
     * pendingEvents and populatedCycles on a BPM change; the
     * per-source timingDirty path in the firing engine's tick
     * does the same per-source clear for per-source field
     * edits. forceTimingSnapAll handles the simulation side;
     * the firing engine handles the dispatch side.
     */
    forceTimingSnapAll() {
        if (this._scene === null) return;
        const bpm = this._transport.bpm;
        const simTime = this._simTime;
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string") continue;
            const state = this._curveState.get(curve.id);
            if (state === undefined) continue;
            if (state.halted) continue;
            const cd = cycleDurationSeconds(bpm, curve.beatsPerCycle, curve.beatInterval);
            if (cd <= 0) continue;
            if (state._lastCycleDuration <= 0) continue;
            if (state._lastCycleDuration === cd) continue;
            const phase = computeCyclePhaseFromGlobalTime(simTime, cd, state.speedList);
            state.cycleCount = phase.cycleCount;
            state.cycleProgress = phase.cycleProgress;
            state.t = phase.t;
            if (phase.halted) state.halted = true;
            state._lastCycleDuration = cd;
        }
        for (const trigger of this._scene.triggers) {
            if (typeof trigger.id !== "string") continue;
            const state = this._triggerState.get(trigger.id);
            if (state === undefined) continue;
            const cd = cycleDurationSeconds(bpm, trigger.beatsPerCycle, trigger.beatInterval);
            if (cd <= 0) continue;
            if (state._lastCycleDuration <= 0) continue;
            if (state._lastCycleDuration === cd) continue;
            const phase = computeCyclePhaseFromGlobalTime(simTime, cd, [1]);
            state.cycleCount = phase.cycleCount;
            state.cycleProgress = phase.cycleProgress;
            state._lastCycleDuration = cd;
        }
        for (const sprite of this._scene.sprites) {
            if (typeof sprite.id !== "string") continue;
            const state = this._spriteState.get(sprite.id);
            if (state === undefined) continue;
            const cd = cycleDurationSeconds(bpm, sprite.beatsPerCycle, sprite.beatInterval);
            if (cd <= 0) continue;
            if (state._lastCycleDuration <= 0) continue;
            if (state._lastCycleDuration === cd) continue;
            const phase = computeCyclePhaseFromGlobalTime(simTime, cd, [1]);
            state.cycleCount = phase.cycleCount;
            state.cycleProgress = phase.cycleProgress;
            state._lastCycleDuration = cd;
        }
    }

    /**
     * Snap a freshly-created per-source runtime state to
     * its grid-aligned cycle position for the score's
     * current sim time. Called from setScene's three
     * new-state-creation paths (curve, trigger, sprite)
     * so a duplicate, paste, or fresh-add mid-play starts
     * in sync with any other source running at the same
     * cycleDuration, rather than at the constructor's
     * default cycleProgress=0 / cycleCount=0 (which
     * corresponds to score t=0, not the actual current
     * sim moment).
     *
     * The formula mirrors the timing-edit snap in
     * _stepCurve / _stepTrigger / _stepSprites: cycleCount
     * = floor(simTime / D), cycleProgress = fractional
     * part, treating the new source as if it had been
     * playing at this cycleDuration since the most recent
     * rewind. The cursor t snaps to match cycleProgress
     * for curves (the setCursor flag), since curves are
     * the only kind that have a visible cursor along a
     * path. Triggers have no cursor; sprites have a
     * position that they move under physics, but a
     * freshly-created sprite starts at its authored x, y
     * via the constructor and the grid-snap doesn't
     * disturb that — cycle phase advances independently
     * of physics state.
     *
     * `_lastCycleDuration` is also set on the new state so
     * the next _step (and subsequent steps until a timing
     * edit) doesn't false-trigger the timing-edit snap.
     * The check there only fires when _lastCycleDuration
     * differs from the step's cycleDuration; setting it
     * here marks the new state as "already aligned for
     * this D".
     *
     * Guards: a non-positive cycleDuration (missing or
     * zero BPM, missing or zero beatsPerCycle) leaves the
     * state at its constructor defaults — nothing to align
     * to since the source can't cycle. A non-finite or
     * negative simTime (impossible under normal operation,
     * but defensive) also leaves the state alone.
     *
     * @param {CurveRuntimeState | TriggerRuntimeState | SpriteRuntimeState} state
     * @param {number} cycleDuration  Wall-clock seconds per cycle.
     * @param {boolean} setCursor  If true, also set state.t = cycleProgress.
     */
    _snapNewStateToGrid(state, cycleDuration, setCursor) {
        if (!(cycleDuration > 0)) return;
        const simTime = this._simTime;
        if (!Number.isFinite(simTime) || simTime < 0) return;
        const raw = simTime / cycleDuration;
        const newCount = Math.floor(raw);
        state.cycleCount = newCount;
        state.cycleProgress = raw - newCount;
        if (setCursor && "t" in state) {
            // Direction-aware t for curves with cycleSpeeds.
            // The snapped cycleCount selects a speed entry
            // via modulo; a negative speed inverts t to
            // 1 - cycleProgress so the freshly-created
            // curve lands on the reverse-direction grid
            // alongside any other negative-speed curves
            // already running. Empty or missing speedList
            // falls back to the positive default.
            /** @type {any} */
            const curveState = state;
            const speedList = curveState.speedList;
            const loopLen = cycleSpeedsLoopLength(speedList);
            if (loopLen > 0) {
                const speed = speedList[newCount % loopLen];
                curveState.t = speed < 0
                    ? 1 - state.cycleProgress
                    : state.cycleProgress;
            } else {
                curveState.t = state.cycleProgress;
            }
        }
        state._lastCycleDuration = cycleDuration;
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
            // Clearing _lastCycleDuration so the first step
            // after the rewind treats this curve as fresh
            // and doesn't snap on the first observed
            // cycleDuration (which would be a no-op anyway
            // since elapsed=0 gives newCycleProgress=0 and
            // newCycleCount=0, matching the rewind state,
            // but skipping the formula entirely is cleaner).
            state._lastCycleDuration = 0;
            // cycleSpeeds direction-aware initial cursor.
            // A speedList starting with a negative entry
            // places the cursor at t=1 on play so the
            // reverse traversal visibly starts from the
            // right end; positive-leading lists keep t=0
            // (the standard home). A leading zero (no loop
            // body) is degenerate: _stepCurve parks the
            // curve at the start without advancing, and
            // state.halted stays false.
            if (state.speedList.length > 0 && state.speedList[0] < 0) {
                state.t = 1;
            }
        }
        for (const state of this._triggerState.values()) {
            state.cycleProgress = 0;
            state.cycleCount = 0;
            state._lastCycleDuration = 0;
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
            state.cycleProgress = 0;
            state.cycleCount = 0;
            state._lastCycleDuration = 0;
            // Launch cycle 0 at the authored velocity scaled
            // by the first speed entry. Rewind always restores
            // the home position (a full reset), so no teleport
            // flag is needed here; only the velocity multiplier
            // applies. A leading-zero list parks the sprite at
            // home with zero launch velocity.
            const { speed } = this._spriteCycleSpeed(state, 0);
            state.vx = state._authVx * speed;
            state.vy = state._authVy * speed;
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
     * Cycle pacing is governed by the curve's authored
     * cycleSpeeds list, parsed into state.speedList at
     * construction and re-parsed by setScene when the
     * authored string changes. The current cycle's speed
     * is speedList[cycleCount mod loopLen], where loopLen is
     * the loop-body length (cycleSpeedsLoopLength): positive N
     * compresses the cycle to baseCycleDuration / N wall-clock
     * seconds with the cursor advancing forward (t from 0
     * toward 1), negative N also compresses by |N| but
     * reverses the cursor (t from 1 toward 0). A trailing zero
     * is a loop terminator, not a halt: the index wraps over
     * the body and never lands on it, so the body repeats
     * forever and the cursor resets to the start at each loop
     * restart. A leading zero (no body) parks the curve at the
     * start. stopAtCycle remains the way to actually stop a
     * curve.
     *
     * Cursor: state.t is derived from state.cycleProgress
     * and the current cycle's direction. For positive
     * speeds t = cycleProgress; for negative speeds
     * t = 1 - cycleProgress. cycleProgress is a magnitude-
     * only accumulator in [0, 1) advancing by
     * dt / effectiveDuration each step regardless of
     * direction. The direction-aware derivation of t means
     * a same-direction cycle wrap naturally lands t at the
     * direction's home (0 for positive, 1 for negative)
     * because cycleProgress is small immediately after a
     * wrap; a direction-reversal at a cycle boundary
     * leaves the cursor near the boundary position
     * (outgoing positive ended near t=1, incoming negative
     * starts at t = 1 - small ≈ 1) and the cursor begins
     * moving in the new direction. No explicit snap
     * branching needed: the same formula produces both
     * behaviours.
     *
     * Cycle progress: cycleProgress accumulates absolute
     * progress through the current cycle. When it crosses
     * 1, the cycle completes, the count advances, the
     * small overshoot carries into the next cycle so
     * timing stays accurate across boundaries, and the
     * physics state (dx, dy, vx, vy) snaps back to authored
     * for the per-cycle home return that parallels sprite
     * behaviour. When cycleCount reaches stopAtCycle the curve
     * halts; a cycleSpeeds zero never halts, it just restarts
     * the loop body.
     *
     * @param {any} curve
     * @param {CurveRuntimeState} state
     * @param {number} cycleDuration  Base wall-clock seconds per cycle (before cycleSpeeds factor).
     * @param {number} dt  Elapsed seconds in this step.
     */
    _stepCurve(curve, state, cycleDuration, dt) {
        if (cycleDuration <= 0) return;
        const speedList = state.speedList;
        if (speedList.length === 0) return;
        // Timing-edit snap. When the authored cycleDuration
        // has changed since the previous step (because BPM,
        // beatsPerCycle, beatInterval, patternRepeats, or
        // cycleSpeeds changed), re-derive cycleCount and
        // cycleProgress from the global simTime via the
        // closed-form walk through speedList. The closed-form
        // correctly accounts for per-cycle speed variation —
        // each cycle's wall-clock duration is D / |speed|, so
        // accumulating durations through speedList until the
        // total passes simTime yields the cycle the curve
        // would currently be in if it had been playing at
        // the new cycleDuration since simTime = 0. Halts on
        // zero-speed entries and direction-adjusts t for
        // negative-speed cycles, both handled inside the
        // helper. Replaces an earlier accumulator-based snap
        // that used base cycleDuration where effective
        // cycleDuration was needed; that older snap
        // miscomputed phases for any curve with cycleSpeeds
        // != "1" and caused cross-source desync on every BPM
        // or per-source timing edit mid-playback.
        if (state._lastCycleDuration > 0
            && state._lastCycleDuration !== cycleDuration) {
            const phase = computeCyclePhaseFromGlobalTime(
                this._simTime, cycleDuration, speedList,
            );
            state.cycleCount = phase.cycleCount;
            state.cycleProgress = phase.cycleProgress;
            state.t = phase.t;
            if (phase.halted) {
                state.halted = true;
                state._lastCycleDuration = cycleDuration;
                return;
            }
        }
        state._lastCycleDuration = cycleDuration;
        // Resolve the current cycle's speed at the (possibly
        // snapped) cycleCount, wrapping over the loop body (the
        // entries before any zero). A zero is a loop terminator,
        // not a halt: the index never lands on it because
        // loopLen excludes it, so the body repeats forever and
        // the cursor returns to the start at each loop restart
        // (handled by the direction-aware t derivation below).
        // A leading zero (no body) parks the curve at the start.
        // effectiveDuration is computed after the snap so a
        // snap-triggered cycleCount change picks up the new
        // cycle's effective rate for this step's cycleProgress
        // accumulation.
        const loopLen = cycleSpeedsLoopLength(speedList);
        if (loopLen <= 0) return;
        const currentSpeed = speedList[state.cycleCount % loopLen];
        const speedMagnitude = Math.abs(currentSpeed);
        const effectiveDuration = cycleDuration / speedMagnitude;
        // Magnitude-only progress accumulator. cycleSpeeds
        // direction shows up in the t derivation below,
        // not here; cycleProgress always advances toward 1
        // regardless of cursor direction.
        state.cycleProgress += dt / effectiveDuration;
        // Physics. Independent of cycleSpeeds direction —
        // the curve's velocity continues uninterrupted
        // through wraps and reversals; only the cursor's
        // direction along the geometry changes.
        this._stepCurvePhysics(curve, state, dt);
        const stopAt = (typeof curve.stopAtCycle === "number") ? curve.stopAtCycle : -1;
        // Detect cycle completion. Multiple wraps in one
        // step are possible at very large |speed|; the
        // loop handles that. Each wrap snaps physics home
        // and re-checks for halt on the incoming cycle's
        // speed. The cursor t is derived from the post-
        // wrap speed below the loop, so the loop body
        // doesn't update t.
        while (state.cycleProgress >= 1) {
            state.cycleProgress -= 1;
            state.cycleCount++;
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
        // Direction-aware t. cycleProgress is in [0, 1)
        // after the wrap loop; the current cycle's speed
        // (which may differ from the speed before the
        // first wrap above) determines whether t maps
        // directly (positive) or inverts (negative). After
        // a same-direction wrap this lands t near the new
        // cycle's home because cycleProgress is small;
        // after an opposite-direction wrap this leaves t
        // near the boundary (1 - small ≈ 1 for incoming
        // negative; small ≈ 0 for incoming positive),
        // which is the direction-reversal-preserves-position
        // behaviour.
        const finalSpeed = speedList[state.cycleCount % loopLen];
        state.t = finalSpeed < 0
            ? 1 - state.cycleProgress
            : state.cycleProgress;
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
        // Timing-edit snap. Mirrors _stepCurve's snap with
        // the cursor and direction branches removed since
        // triggers have no t and no cycleSpeeds; passing [1]
        // as the speedList reduces the closed-form walk to a
        // single division. See _stepCurve for the full
        // reasoning, including why _simTime is used rather
        // than _lastElapsed.
        if (state._lastCycleDuration > 0
            && state._lastCycleDuration !== cycleDuration) {
            const phase = computeCyclePhaseFromGlobalTime(
                this._simTime, cycleDuration, [1],
            );
            state.cycleCount = phase.cycleCount;
            state.cycleProgress = phase.cycleProgress;
        }
        state._lastCycleDuration = cycleDuration;
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
     * Look up the speed for a curve at a given cycle index,
     * drawn from the curve's parsed speedList via cycleIndex
     * modulo the loop-body length. Returns null when no
     * runtime state exists for this id (briefly possible
     * during a scene reload before setScene runs). A positive
     * return means forward direction at that speed magnitude,
     * negative means reverse. A trailing zero is a loop
     * terminator, not a speed, so it is excluded from the wrap
     * and never returned for a well-formed list; 0 comes back
     * only for the degenerate leading-zero list (no body to
     * play), which the firing engine's zero-gate parks. The
     * firing engine uses this for effective-duration
     * calculation (baseCycleDuration / Math.abs(speed)) and
     * for the one-cycle-ahead pre-population (cycle C+1's
     * speed may differ from cycle C's under a multi-entry
     * cycleSpeeds list).
     *
     * cycleIndex may be any integer; the modulo handles
     * wrapping naturally, and a positive-modulo correction
     * keeps the lookup safe against negative cycleIndex
     * arguments (defensive — not expected under normal
     * operation since cycleCount never goes negative).
     *
     * Returns 1 (the default forward-at-unit-speed) for a
     * curve whose speedList is empty after parse, which
     * shouldn't happen since parseCycleSpeeds returns [1]
     * on any unparseable input, but defensive against
     * future schema changes.
     *
     * @param {string} curveId
     * @param {number} cycleIndex
     * @returns {number | null}
     */
    getCurveSpeedAt(curveId, cycleIndex) {
        const state = this._curveState.get(curveId);
        if (state === undefined) return null;
        const list = state.speedList;
        if (!Array.isArray(list) || list.length === 0) return 1;
        // Wrap over the loop body (entries before any zero) so a
        // zero is never returned as a current speed — it is a
        // loop terminator, not a halt. A leading zero (no body)
        // has no speed to play, so 0 is returned and the firing
        // engine's zero-gate parks the degenerate curve.
        const len = cycleSpeedsLoopLength(list);
        if (len <= 0) return 0;
        const idx = ((cycleIndex % len) + len) % len;
        return list[idx];
    }

    /**
     * Look up whether a curve is currently halted — the
     * state.halted flag set by _stepCurve when cycleCount
     * reaches stopAtCycle. A zero in cycleSpeeds is a loop
     * terminator, not a halt, so it no longer sets this flag;
     * stopAtCycle is the only thing that halts a curve, and
     * only a rewind clears it. Returns false when no runtime
     * state exists for this id (briefly possible during a
     * scene reload).
     *
     * @param {string} curveId
     * @returns {boolean}
     */
    isCurveHalted(curveId) {
        const state = this._curveState.get(curveId);
        if (state === undefined) return false;
        return state.halted === true;
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
     * Per-cycle launch parameters for a sprite: the velocity
     * multiplier for the cycle and whether the sprite should
     * teleport home entering it.
     *
     * The speed list is read as a repeating loop, one entry
     * per cycle, each a multiplier on the authored velocity
     * (negative reverses direction). A trailing zero — which
     * parseCycleSpeeds guarantees is the last entry, dropping
     * anything after it — is NOT a cycle of its own. It marks
     * the loop's end: the non-zero entries before it are the
     * loop body, and on wrapping back to the first entry the
     * sprite teleports to its authored home position. So a
     * zero-terminated list cycles its body forever, snapping
     * home at each repeat, while a list with no zero cycles
     * its body forever with continuous position (each cycle
     * resumes from wherever the previous left the sprite).
     *
     * loopLen is the count of entries before any zero (or the
     * full length when there is none). The cycle's entry is
     * list[cycleCount mod loopLen]; teleport is requested only
     * for a zero-terminated list at the start of each loop
     * repeat (index 0 with cycleCount > 0), never on the very
     * first cycle.
     *
     * A leading zero (no non-zero entries) is degenerate — the
     * inspector validation should reject it — and is handled
     * defensively here as a parked-at-home sprite (speed 0,
     * teleport true). An empty list returns speed 1 with no
     * teleport.
     *
     * @param {SpriteRuntimeState} state
     * @param {number} cycleCount
     * @returns {{speed: number, teleport: boolean}}
     */
    _spriteCycleSpeed(state, cycleCount) {
        const list = state.speedList;
        if (!Array.isArray(list) || list.length === 0) {
            return { speed: 1, teleport: false };
        }
        const loopLen = cycleSpeedsLoopLength(list);
        const hasZero = loopLen < list.length;
        if (loopLen <= 0) {
            // Leading zero: nothing to play, park at home.
            return { speed: 0, teleport: true };
        }
        const idx = ((cycleCount % loopLen) + loopLen) % loopLen;
        const speed = list[idx];
        const teleport = hasZero && idx === 0 && cycleCount > 0;
        return { speed, teleport };
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
     *   5. On cycle wrap, increment the counter and update
     *      the velocity for the new cycle. A normal (non-
     *      teleport) wrap scales the CURRENT velocity by the
     *      ratio of the new cycle's cycleSpeeds entry to the
     *      previous cycle's, so accumulated wall bounces are
     *      preserved and position stays continuous (a same-
     *      speed list like "1" just keeps going). A zero-
     *      terminated list, when it wraps to the start of a
     *      new loop repeat, instead teleports x/y back to
     *      authored home and relaunches from authored
     *      velocity × the entry.
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
            // Timing-edit snap. Mirrors _stepCurve's snap
            // with the cursor and direction branches removed
            // since sprites have no t and no cycleSpeeds.
            // Physics state (x/y/vx/vy) is intentionally
            // left alone here: a timing edit is about cycle
            // phase, not about position; resetting physics
            // on every timing change would be more
            // disruptive than the cursor jump on curves, and
            // the next regular cycle wrap snaps physics
            // home anyway under the per-cycle home-return
            // semantics. Passing [1] as speedList reduces
            // the closed-form walk to a single division.
            if (state._lastCycleDuration > 0
                && state._lastCycleDuration !== cd) {
                const phase = computeCyclePhaseFromGlobalTime(
                    this._simTime, cd, [1],
                );
                state.cycleCount = phase.cycleCount;
                state.cycleProgress = phase.cycleProgress;
            }
            state._lastCycleDuration = cd;
            state.cycleProgress += dt / cd;
            // 5. On wrap, snap the sprite home and advance
            //    the counter. Multiple wraps in one step are
            //    possible at very short cycle durations; the
            //    loop handles that.
            while (state.cycleProgress >= 1) {
                state.cycleProgress -= 1;
                const prevSpeed = this._spriteCycleSpeed(
                    state, state.cycleCount,
                ).speed;
                state.cycleCount++;
                const { speed, teleport } = this._spriteCycleSpeed(
                    state, state.cycleCount,
                );
                if (teleport) {
                    // Loop restart on a zero-terminated list:
                    // snap home and relaunch in the authored
                    // direction at this cycle's speed, the same
                    // fresh launch a rewind performs.
                    state.x = state._authX;
                    state.y = state._authY;
                    state.vx = state._authVx * speed;
                    state.vy = state._authVy * speed;
                } else {
                    // Continuous wrap: scale the CURRENT
                    // velocity by the ratio of this cycle's
                    // speed to the previous cycle's. This
                    // preserves any wall bounces accumulated
                    // during the cycle (a plain re-derive from
                    // authored would undo them and lurch the
                    // sprite back toward its authored heading
                    // every cycle). A same-speed list ("1")
                    // gives ratio 1 and just keeps going; a
                    // sign change ("1 -1") flips direction; a
                    // magnitude change ("1 2") rescales speed.
                    // The product of ratios telescopes so the
                    // magnitude stays |authored| × this cycle's
                    // speed. maxSpeed is enforced by the step-1
                    // clamp on the next step.
                    const ratio = prevSpeed !== 0 ? speed / prevSpeed : 0;
                    state.vx *= ratio;
                    state.vy *= ratio;
                }
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
