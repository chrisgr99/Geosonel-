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
 * advances by vx*dt and vy*dt. The force-driven impulse
 * layer is relaxed toward the base launch velocity each step
 * by the score's drag rate (score.kinematics.drag); there is
 * no hard speed ceiling. Damping is suspended on any step where the
 * onTick callback applied essentially no force, so a force-
 * only sprite coasts on its current heading through a true
 * force-free region (a black patch, or a flat region with no
 * colour contrast). A minimum-speed floor catches the weak-
 * but-nonzero case the coast misses: a dim region drives a
 * small force that would otherwise damp the sprite to a near-
 * stop crawl, so the floor holds the force-driven motion up
 * and the sprite cruises out instead of getting hung up.
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
 * speeds up, then snaps home and repeats. The force-driven
 * impulse is relaxed each step by the score's drag rate; there
 * is no hard speed ceiling. The per-sprite speedList is cached
 * at construction and re-parsed by setScene when the authored
 * string changes.
 */

// @ts-check

import { getBeatIntervalEntry, DEFAULT_BEAT_INTERVAL } from "./beatIntervals.js";
import { imageSignalsFromOKLCh } from "./strudel/signals.js";
import { DEFAULT_KINEMATICS } from "./scene.js";
import { computeOffset } from "./seed/seedOffset.js";
import { deriveCurveBeatPoints } from "./beatPoints.js";
import { buildNoteSpec, buildSoundSpec } from "./emitters.js";
import { setCallbackContext, clearCallbackContext } from "./callbackContext.js";
import { sampleCurve } from "./curveGeometry.js";

/**
 * Simulation step in seconds. Determinism requires this to
 * be a constant; the value is chosen for sub-perceptual
 * timing precision (~4 ms) at low CPU cost (~4 steps per
 * frame at 60 fps).
 */
const SIM_DT = 1 / 240;

/**
 * onTick control rate (§3.6). onTick fires at a fixed 60 Hz in
 * SIMULATION time — once every ONTICK_DT seconds of sim clock, not
 * every fine step — so a non-trivial onTick body runs at the proven
 * Processing/p5 draw() cadence instead of flooding at the 240 Hz
 * fine-step rate. The fine steps integrate the force onTick sets
 * between its calls (control-rate-modulating-a-finer-rate); applyForce
 * uses ONTICK_DT so the per-call impulse equals what a continuous push
 * would deliver over the control period. 60 divides 240 evenly, so
 * onTick lands on every 4th fine step. Counted in sim time (not
 * painted frames) to stay deterministic and repeatable.
 */
const ONTICK_DT = 1 / 60;

/**
 * Look-ahead scheduler window (§3.6). The simulation steps this far
 * AHEAD of the audio playhead, so every callback that fires can stamp
 * its note with the exact upcoming audio time of the step that
 * produced it (via transport.audioTimeForElapsed) and schedule it
 * there — instead of all of a frame's notes landing at "now + a fixed
 * offset". 45 ms comfortably exceeds one render frame (~33 ms at 30
 * fps), so a stalled frame never strands audio that is already
 * scheduled. The cost is that asynchronous input lands up to a window
 * late, which is immaterial for input that isn't clock-aligned.
 */
const LOOKAHEAD_WINDOW = 0.045;

/**
 * Cap on how far the sim will catch up in a single tick. After a long
 * stall (a backgrounded tab where the render loop didn't fire), the
 * elapsed jump could otherwise queue thousands of fixed steps and
 * freeze the frame. Beyond this, the sim snaps forward past the gap —
 * a post-stall discontinuity is preferable to a hang, and a stall is
 * non-deterministic regardless.
 */
const MAX_CATCHUP_SECONDS = 0.5;

/**
 * Shape the ten raw image-colour signals into the firing context's
 * `col` namespace (lt = lightness, chr = chroma; r/g/y/b/or/li/cy/pu
 * the hues). Grouped under `col` so the hue keys never collide with a
 * position read like this.y. Shared by every callback's context.
 * @param {{pxLt:number,pxChr:number,pxR:number,pxG:number,pxY:number,pxB:number,pxOr:number,pxLi:number,pxCy:number,pxPu:number}} px
 */
function colFromSignals(px) {
    return {
        lt: px.pxLt, chr: px.pxChr,
        r: px.pxR, g: px.pxG, y: px.pxY, b: px.pxB,
        or: px.pxOr, li: px.pxLi, cy: px.pxCy, pu: px.pxPu,
    };
}

/**
 * Force-magnitude threshold below which a sub-step's onTick is
 * treated as having applied no force (a dead zone). When the net
 * force a sprite's callback applies in a sub-step is at or below
 * this, _stepSprites suspends impulse damping for that sub-step so
 * the sprite coasts on its current velocity instead of dragging to
 * a halt in a force-free region (a black patch, or a flat region
 * with no colour contrast to steer by). Small enough that any
 * region producing a meaningful steering force pushes well above
 * it, so only genuine dead zones coast; it guards against floating-
 * point fuzz rather than acting as a tunable speed floor.
 */
const FORCE_EPSILON = 1e-6;

/**
 * Minimum sim-time interval, in seconds, between procedural
 * audio fires (ctx.playNote / ctx.playSound) from a single
 * sprite's callbacks. A safety throttle against a callback
 * that fires every sub-step (~240 Hz) flooding the output:
 * the second and later fires within this window are dropped.
 * Set to a 64th note at 120 BPM (a quarter note is 0.5 s, so
 * a 64th is 0.5 / 16 = 0.03125 s) — already very fast, a
 * starting value to tune by ear. Gated on _simTime (the
 * deterministic sim clock) and reset on rewind / home-teleport
 * alongside the per-sprite RNG, so a replay throttles
 * identically. Shared across playNote and playSound: the cap
 * is on a sprite's total audio messages, not per kind.
 */
const MIN_AUDIO_FIRE_INTERVAL = 0.03125;

// The motion feel knobs — drag (damping), jitter (anti-trap
// agitation), and coast (minimum coast speed) — are score-wide
// and set from script.js via the `score.kinematics` object;
// their defaults live in DEFAULT_KINEMATICS (scene.js) and
// _stepSprites reads them per sub-step from this._scene.kinematics.
// They moved here from module constants so a score carries its own
// feel and a shared score plays the same on every machine.

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
        // Seed-variation start-state offset for this curve under
        // the current global seed (seed-variation experiment).
        // Position offset (dx, dy) becomes the curve's per-cycle
        // home for the runtime offset — the curve body is
        // translated by it, shape preserved — and velocity offset
        // (vx, vy) is added to the authored launch velocity. All
        // zero by default (seed 0 or variability 0), so the curve
        // sits at its authored home exactly as today. Recomputed
        // by Simulation._recomputeSeedOffsets and consumed by
        // _rewind and the per-cycle home snap in _stepCurve.
        /** @type {number} */
        this._seedDx = 0;
        /** @type {number} */
        this._seedDy = 0;
        /** @type {number} */
        this._seedVx = 0;
        /** @type {number} */
        this._seedVy = 0;
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

        // --- Active-beat firing (§3.1b) ---
        //
        // The curve's ACTIVE beat points, derived from its Band-5
        // Beat Points fields by deriveCurveBeatPoints and refreshed
        // in setScene / refreshBeatPoints. _beatFractions are the
        // cycle-fraction positions (the same f the diamonds draw
        // at); _beatStrengths the aligned 0-9 accents. onActiveBeat
        // fires as the cursor crosses each, in cursor-travel order.
        /** @type {number[]} */
        this._beatFractions = [];
        /** @type {number[]} */
        this._beatStrengths = [];
        // Per-cycle firing cursor. _beatOrder is the active beats
        // sorted by the progress at which THIS cycle's cursor
        // reaches them (g = f for a forward cycle, 1 - f for a
        // reversed one), rebuilt whenever the cycle or its
        // direction changes; _beatNextIdx is the next entry to
        // fire; _beatOrderSign / _lastBeatCycle record what the
        // current order was built for. Null order forces a rebuild
        // (also used to reset after a beat-points edit).
        /** @type {Array<{g: number, f: number, strength: number, index: number}> | null} */
        this._beatOrder = null;
        /** @type {number} */
        this._beatOrderSign = 0;
        /** @type {number} */
        this._lastBeatCycle = -1;
        /** @type {number} */
        this._beatNextIdx = 0;
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
        // Base velocity layer: the cycleSpeeds-owned launch
        // velocity (authored times the cycle's speed entry),
        // modified by wall bounces. vx/vy above are the
        // EFFECTIVE velocity actually integrated and rendered;
        // the impulse layer (the running sum of onTick forces)
        // is the implicit difference vx - baseVx. Keeping base
        // explicit lets a cycle-speed change scale only the
        // launch component while the impulse rides through a
        // boundary untouched, and lets damping relax the
        // impulse while leaving base pristine for the boundary
        // ratio math. Initialised equal to vx/vy; the
        // per-cycle speed multiplier is applied by rewind and
        // by setScene's launch paths.
        /** @type {number} */
        this.baseVx = this.vx;
        /** @type {number} */
        this.baseVy = this.vy;
        // Per-axis wall-reflection signs, plus or minus one,
        // starting at plus one. The engine flips the sign on
        // each wall bounce on that axis, and resets both to
        // plus one on a rewind or a home-teleport. Exposed
        // read-only on the onTick context as flipX / flipY for
        // a callback to multiply into a pixel-derived force
        // when it wants the field to reverse after a bounce
        // (the anti-trap opt-in); the engine never applies
        // them to forces itself.
        /** @type {number} */
        this.flipX = 1;
        /** @type {number} */
        this.flipY = 1;
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
        // Seed-variation start-state offset for this sprite under
        // the current global seed (seed-variation experiment).
        // Added to the authored home position and launch velocity
        // on rewind and on a per-cycle home-teleport. All zero by
        // default (seed 0 or variability 0), so the sprite starts
        // at its authored home exactly as today. Recomputed by
        // Simulation._recomputeSeedOffsets.
        /** @type {number} */
        this._seedDx = 0;
        /** @type {number} */
        this._seedDy = 0;
        /** @type {number} */
        this._seedVx = 0;
        /** @type {number} */
        this._seedVy = 0;
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

        // Deterministic per-sprite RNG for the anti-trap
        // agitation. _rngSeed is derived from the id (stable
        // across runs); _rngState advances each sub-step the
        // agitation fires and is reset to _rngSeed on rewind and
        // home-teleport, so a score rewound from the start replays
        // the identical jitter.
        /** @type {number} */
        this._rngSeed = hashStringToUint32(
            typeof sprite.id === "string" ? sprite.id : "");
        /** @type {number} */
        this._rngState = this._rngSeed;

        // Throttle clock for procedural audio fired from this
        // sprite's callbacks (ctx.playNote / ctx.playSound). Holds
        // the _simTime of the last fire; a fresh fire is dropped
        // unless at least MIN_AUDIO_FIRE_INTERVAL seconds of sim
        // time have passed since it. -Infinity lets the first fire
        // through. Reset to -Infinity on rewind and home-teleport
        // (the same points _rngState resets) so a replay fires
        // identically.
        /** @type {number} */
        this._lastAudioFireTime = -Infinity;

        /**
         * Net force magnitude from this sprite's most recent onTick
         * call. onTick runs at 60 Hz but the fine steps integrate at
         * 240 Hz, so the intermediate steps (between onTick calls)
         * reuse this stored magnitude for the dead-zone / coast
         * decision rather than recomputing a force that wasn't applied
         * this step. Updated each time onTick runs; persists between.
         * @type {number}
         */
        this._lastOnTickForceMag = 0;
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
         * Global variation seed (seed-variation experiment). 0
         * means no offset, so a normal rewind / play at seed 0 is
         * byte-for-byte today's behaviour. setSeed stores a new
         * value and recomputes each object's per-seed start-state
         * offset (scaled by that object's variability dial); the
         * offsets are applied by _rewind, which the toolbar's Vary
         * button triggers via transport.rewind(). Transient
         * creation-mode state; not persisted to the scene.
         * @type {number}
         */
        this._seed = 0;
        /**
         * Audition boundary (seed-variation audition workflow).
         * When non-null, it is a master-clock beat count measured
         * from the most recent reset (elapsed 0); once the
         * transport's elapsed beats reach it, tick() disarms it and
         * calls _auditionBoundaryHandler exactly once, then returns
         * for the frame. Null means no armed boundary — ordinary
         * Play just runs. main.js arms it from the audition bar's
         * Mutate / Loop buttons and decides what the boundary does:
         * Mutate pauses (a clean finite one-shot — the firing
         * engine's pause listener flushes + MIDI-panics); Loop
         * re-applies the current seed, rewinds, and re-arms, so the
         * same chunk repeats.
         * @type {number | null}
         */
        this._auditionBoundaryBeats = null;
        /** @type {(() => void) | null} */
        this._auditionBoundaryHandler = null;
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
        /**
         * Sim-time accumulator for the 60 Hz onTick control rate.
         * Advanced by each fine step's dt; when it reaches ONTICK_DT
         * the sprites' onTick callbacks run and it subtracts ONTICK_DT.
         * Cleared on rewind so onTick timing restarts at t=0.
         * @type {number}
         */
        this._onTickAccumulator = 0;
        /**
         * Canvas reference, set via setCanvas after
         * construction. Used only to sample the image's
         * OKLCh buffer beneath a sprite for the onTick
         * context's px colour reads, mirroring how the
         * firing engine samples for its snapshot. Null until
         * set; the colour reads fall back to zero (the no-
         * image default) when absent, so the simulation still
         * runs headless.
         * @type {import("./canvas.js").Canvas | null}
         */
        this._canvas = null;
        /**
         * Optional logger for surfacing onTick runtime errors
         * to the message area. Signature (text, level) mirrors
         * MessageArea.write. Null until set via
         * setMessageLogger; errors always reach the console
         * regardless.
         * @type {((text: string, level: string) => void) | null}
         */
        this._messageLogger = null;
        /**
         * Ids of sprites whose onTick threw and is therefore
         * disabled for the rest of the session. onTick runs
         * every sub-step, so a throwing callback is caught and
         * its id parked here to avoid calling it again and
         * flooding the console / message area. Cleared on
         * every setScene, so a script.js reload or any
         * scene re-run re-enables the callback for another
         * attempt.
         * @type {Set<string>}
         */
        this._onTickDisabled = new Set();
        /**
         * Keys of collision callback slots that threw and are
         * therefore disabled for the rest of the session. A key
         * is `${slot}:${objectId}`, e.g. "beenTriggered:TRG3" or
         * "hasCollided:SPR1", so an object's beenTriggered and hasCollided are
         * disabled independently. Mirrors _onTickDisabled: a
         * throwing collision callback is caught, parked here so
         * it isn't called again, and the error logged once.
         * Cleared on every setScene, so a script.js reload
         * or any scene re-run re-enables the slot.
         * @type {Set<string>}
         */
        this._collisionDisabled = new Set();
        /**
         * Ids of curves whose onActiveBeat threw and is therefore
         * disabled for the rest of the session, keyed
         * "onActiveBeat:${curveId}". Mirrors _onTickDisabled /
         * _collisionDisabled: a throwing onActiveBeat is caught,
         * parked here so the cursor's next beat crossings don't
         * re-call it and flood the log, and cleared on every
         * setScene so a script reload re-enables it.
         * @type {Set<string>}
         */
        this._activeBeatDisabled = new Set();
        /**
         * Audio sink for procedural notes and sounds fired from a
         * sprite's onTick (and, later, collision) callbacks via
         * the context's playNote / playSound. Called with
         * (sourceId, spec) where spec is a plain object tagged
         * { type: "note" | "sound" | "value", ... }; the wiring in
         * main.js routes a note spec to the firing engine's
         * fireImmediateNote, a sound spec to fireImmediateSound,
         * and a value spec (a raw strudel Hap value, used by a
         * curve beenTriggered's ctx.playMarker) to fireImmediateValue.
         * Null until setAudioSink runs, so the context methods
         * no-op and the simulation still runs headless. The
         * simulation holds no audio knowledge beyond forwarding
         * the spec.
         * @type {((sourceId: string, spec: any) => void) | null}
         */
        this._audioSink = null;
    }

    /**
     * Attach the canvas so the onTick context can sample the
     * image's OKLCh buffer beneath a sprite for its px colour
     * reads. Mirrors firingEngine.setCanvas; called once from
     * main.js at startup. The simulation runs without it (px
     * reads return zero), so the wiring is optional.
     * @param {import("./canvas.js").Canvas | null} canvas
     */
    setCanvas(canvas) {
        this._canvas = canvas;
    }

    /**
     * Set a logger for surfacing onTick runtime errors to the
     * message area, alongside the console. Signature (text,
     * level) mirrors MessageArea.write. Called once from
     * main.js; optional.
     * @param {((text: string, level: string) => void) | null} logger
     */
    setMessageLogger(logger) {
        this._messageLogger = typeof logger === "function" ? logger : null;
    }

    /**
     * Set the audio sink the onTick context's playNote /
     * playSound forward to. Signature (sourceId, spec); main.js
     * wires it to the firing engine's immediate-fire methods.
     * Called once at startup; optional — the context's audio-
     * firing methods no-op when it's null.
     * @param {((sourceId: string, spec: any) => void) | null} sink
     */
    setAudioSink(sink) {
        this._audioSink = typeof sink === "function" ? sink : null;
    }

    /**
     * Dispatch a collision detected canvas-side. Fires the
     * target's beenTriggered first, then the collider's hasCollided,
     * each only when that object enables the matching slot
     * (canBeTriggered / canCollide) and names a function that resolves
     * in the scene's functionMap. Either callback is optional
     * and independent.
     *
     * Called from the canvas's per-frame collision detection,
     * NOT from the deterministic sim step, so collision timing
     * is not replay-identical. That is acceptable because a
     * callback firing is a pure side effect: it makes sound
     * and reads state but never mutates simulation motion, so
     * the deterministic retrace of position and velocity is
     * preserved regardless of whether or exactly when a
     * collision callback runs.
     *
     * State is NOT re-checked here: the gating happens upstream
     * when the collider and target lists are built (in
     * canvasCollision). Passive removes a source's cursor, so a
     * passive object is excluded as a COLLIDER but stays a
     * valid TARGET (its beenTriggered still runs). Disabled is
     * excluded as BOTH collider and target. By the time a pair
     * reaches this dispatch, it is already a legal
     * collider/target pair, so this method faithfully runs the
     * callbacks without re-gating on state.
     *
     * @param {{colliderId: string, colliderKind: "curve" | "sprite",
     *          targetId: string, targetKind: "curve" | "trigger" | "sprite",
     *          hitSpeed: number, markerValue?: any}} event
     * @returns {{beenTriggeredFired: boolean, hasCollidedFired: boolean}}  Whether each
     *     callback actually ran (gate passed + function resolved). The canvas
     *     uses beenTriggeredFired to flash a struck trigger.
     */
    dispatchCollision(event) {
        if (this._scene === null) return { beenTriggeredFired: false, hasCollidedFired: false };
        if (event === null || typeof event !== "object") {
            return { beenTriggeredFired: false, hasCollidedFired: false };
        }
        const hitSpeed = (typeof event.hitSpeed === "number"
            && Number.isFinite(event.hitSpeed)) ? event.hitSpeed : 0;
        // The struck marker's strudel value, present only for a
        // curve-marker hit; undefined for a trigger (or any
        // future sprite) target. Passed to the beenTriggered side
        // only, where self is the marker-owning curve, so
        // ctx.hitValue / ctx.playMarker read and sound through
        // that curve's own voice rather than the collider's.
        const markerValue = event.markerValue;
        // Target's beenTriggered first, then the collider's hasCollided —
        // the firing order the collision model specifies.
        const beenTriggeredFired = this._runCollisionCallback(
            "beenTriggered", event.targetId, event.targetKind,
            event.colliderId, event.colliderKind, hitSpeed, markerValue);
        const hasCollidedFired = this._runCollisionCallback(
            "hasCollided", event.colliderId, event.colliderKind,
            event.targetId, event.targetKind, hitSpeed, undefined);
        return { beenTriggeredFired, hasCollidedFired };
    }

    /**
     * Run one collision callback slot on one object, if it is
     * enabled and resolves, building the fresh context the
     * callback reads and writes through.
     *
     * slot is "beenTriggered" or "hasCollided". The gate boolean and the
     * function-name field differ by slot: beenTriggered is gated by
     * canBeTriggered and named by beenTriggeredFunction; hasCollided is
     * gated by canCollide and named by hasCollidedFunction. selfId/
     * selfKind identify the object whose callback runs; otherId/
     * otherKind identify the object on the other side of the
     * collision (the collider for beenTriggered, the target for
     * hasCollided). Both ends see the same hitSpeed.
     *
     * The context exposes reads — own id and kind, the other
     * object's id and kind, the transport (beat, time, bpm),
     * and hitSpeed — the two emitters playNote / playSound,
     * which forward to the same audio sink the patterns and
     * onTick use, keyed by the firing object's id so the sound
     * carries this object's voice — and, on the beenTriggered side of
     * a curve-marker hit, the struck marker's strudel value as
     * the read hitValue (a copy, or null off the marker path)
     * plus playMarker(amplitude?, duration?), which sounds that
     * marker's own pattern event through this curve's voice (the
     * same path the pattern uses). No rate limiting is applied
     * on the collision path (collisions are edge-triggered).
     *
     * A throw is caught, this object's slot is disabled for the
     * rest of the session (keyed `${slot}:${selfId}`), and the
     * first error is logged once to the console and the message
     * area, mirroring onTick.
     *
     * @param@param {"beenTriggered" | "hasCollided"} slot
     * @param {string} selfId
     * @param {string} selfKind
     * @param {string} otherId
     * @param {string} otherKind
     * @param {number} hitSpeed
     * @param {any} [markerValue]  The struck marker's strudel value on a
     *     curve-marker beenTriggered; undefined otherwise. Surfaced as ctx.hitValue
     *     and replayed by ctx.playMarker.
     * @returns {boolean}  True if the callback function was invoked
     *     (gate enabled, name resolved, not session-disabled), else false.
     */
    _runCollisionCallback(slot, selfId, selfKind, otherId, otherKind, hitSpeed, markerValue) {
        if (this._scene === null) return false;
        if (typeof selfId !== "string" || selfId === "") return false;
        const obj = this._findSceneObject(selfId);
        if (obj === null) return false;
        const gateField = slot === "beenTriggered" ? "canBeTriggered" : "canCollide";
        const fnField = slot === "beenTriggered" ? "beenTriggeredFunction" : "hasCollidedFunction";
        if (obj[gateField] !== true) return false;
        const name = obj[fnField];
        if (typeof name !== "string" || name === "") return false;
        const fn = this._scene.functionMap[name];
        if (typeof fn !== "function") return false;
        const disableKey = slot + ":" + selfId;
        if (this._collisionDisabled.has(disableKey)) return false;

        const self = this;
        const simTime = this._simTime;
        const bpm = this._transport.bpm;
        const bpmNum = (typeof bpm === "number" && Number.isFinite(bpm)) ? bpm : 0;
        const beat = bpmNum > 0 ? (simTime * bpmNum) / 60 : 0;

        // A collision has no beat accent, so velocity defaults to
        // full (1.0); this.hitSpeed is the impact strength the author
        // maps to velocity when they want it (e.g. clamped to 0..1).
        const vel = 1;
        // Colour beneath this object at the moment of the hit — the
        // collider's cursor for a curve/sprite, or the struck diamond's
        // position for a trigger — so this.col reads the pixel where
        // the event happened.
        const px = this._sampleColorUnderObject(obj, selfKind);
        const ctx = {
            id: selfId,
            kind: selfKind,
            // The other party in the collision: the struck diamond, or
            // on the struck side the cursor that hit it.
            otherId,
            otherKind,
            hitSpeed,
            vel,
            velocity: vel,
            col: colFromSignals(px),
            beat,
            time: simTime,
            bpm: bpmNum,
            /**
             * Fire a pitched note from this object's note voice
             * (§3.3). playNote(note, vel?, dur?, pan?) or
             * ("instrument", note, ...) or ({...}); velocity defaults
             * to this.vel. No collision-path rate limiting.
             * @param {...any} args
             */
            playNote(...args) {
                if (self._audioSink === null) return;
                const s = buildNoteSpec(args, vel);
                self._audioSink(selfId, {
                    type: "note",
                    sound: s.sound,
                    note: s.note,
                    amplitude: s.velocity,
                    duration: s.duration,
                    pan: s.pan,
                    audioTime: self._transport.audioTimeForElapsed(simTime),
                });
            },
            /**
             * Fire a sample from this object's sound bank (§3.3).
             * playSound(sample, vel?) or ("bank", sample, vel?) or
             * ({...}). Superdough-only.
             * @param {...any} args
             */
            playSound(...args) {
                if (self._audioSink === null) return;
                const s = buildSoundSpec(args, vel);
                self._audioSink(selfId, {
                    type: "sound",
                    bank: s.bank,
                    sample: s.sample,
                    amplitude: s.velocity,
                    audioTime: self._transport.audioTimeForElapsed(simTime),
                });
            },
        };

        setCallbackContext(ctx);
        try {
            fn.call(ctx);
        } catch (err) {
            this._collisionDisabled.add(disableKey);
            const detail = (err instanceof Error && typeof err.message === "string")
                ? err.message
                : String(err);
            const line = `${slot} disabled for ${selfId}: ${detail}`;
            console.error("[collision] " + line, err);
            if (this._messageLogger !== null) {
                try {
                    this._messageLogger(line, "error");
                } catch (_loggerErr) {
                    // A logger fault must never destabilise the
                    // simulation; the console line above stands.
                }
            }
        } finally {
            clearCallbackContext();
        }
        return true;
    }

    /**
     * Derive a curve's ACTIVE beat points from its Beat Points
     * fields and store them on its runtime state, resetting the
     * per-cycle firing order so the next step rebuilds. Called per
     * curve in setScene and in refreshBeatPoints. Strudel patterns
     * resolve to nothing until the engine loads (deriveCurveBeat-
     * Points returns empty), which refreshBeatPoints then fills in.
     * @param {any} curve
     * @param {CurveRuntimeState} state
     */
    _applyCurveBeatPoints(curve, state) {
        const bp = deriveCurveBeatPoints(curve);
        state._beatFractions = bp.positions;
        state._beatStrengths = bp.strengths;
        state._beatOrder = null;
    }

    /**
     * Re-derive every curve's beat points. Wired from main.js when
     * the Strudel runtime transitions to "loaded", so a curve in
     * strudel Beat-Points mode whose pattern couldn't parse at
     * scene load (no engine yet) picks up its beats without a
     * re-run — the firing analogue of canvas.refreshMarkers.
     */
    refreshBeatPoints() {
        if (this._scene === null) return;
        for (const c of this._scene.curves) {
            if (typeof c.id !== "string") continue;
            const state = this._curveState.get(c.id);
            if (state !== undefined) this._applyCurveBeatPoints(c, state);
        }
    }

    /**
     * Detect the curve cursor crossing its own ACTIVE beat points
     * this step and fire onActiveBeat for each. Phase-based: a beat
     * at cycle-fraction f is reached when the cursor's cycle
     * progress passes g (g = f forward, 1 - f reversed), so beats
     * fire in cursor-travel order and at the same instant the
     * diamond would be swept. A per-cycle index walks the sorted
     * order; on a single cycle wrap any beats still pending in the
     * finishing cycle are flushed before the next cycle's order is
     * built, so an end-of-cycle beat is never dropped. Gated on the
     * curve being active with canActiveBeat + a resolvable
     * onActiveBeatFunction; a throw disables the curve's slot for
     * the session.
     * @param {any} curve
     * @param {CurveRuntimeState} state
     */
    _detectActiveBeatCrossings(curve, state) {
        const fractions = state._beatFractions;
        if (fractions.length === 0) return;
        if (this._scene === null) return;
        if (curve.state !== "active") return;
        if (curve.canActiveBeat !== true) return;
        const fnName = curve.onActiveBeatFunction;
        if (typeof fnName !== "string" || fnName === "") return;
        const fn = this._scene.functionMap[fnName];
        if (typeof fn !== "function") return;
        const disableKey = "onActiveBeat:" + curve.id;
        if (this._activeBeatDisabled.has(disableKey)) return;

        const loopLen = cycleSpeedsLoopLength(state.speedList);
        const sign = (loopLen > 0 && state.speedList[state.cycleCount % loopLen] < 0) ? -1 : 1;
        const total = fractions.length;

        const buildOrder = (s) => fractions
            .map((f, i) => ({
                g: s < 0 ? 1 - f : f,
                f,
                strength: state._beatStrengths[i],
                index: i,
            }))
            .sort((a, b) => a.g - b.g);

        // Progress below this counts as "at the cycle start", where
        // the downbeat (g = 0) should fire; above it, a fresh build
        // is a mid-cycle (re)arm — a live edit during playback or a
        // newly grid-snapped curve — and must NOT replay the beats
        // already behind the cursor.
        const START_EPS = 0.02;

        if (state._beatOrder === null
            || state.cycleCount < state._lastBeatCycle
            || state.cycleCount > state._lastBeatCycle + 1) {
            // First run, rewind, snap, or a multi-cycle jump: build
            // fresh for the current cycle with no flush (intermediate
            // cycles' beats are not reconstructed — only possible at
            // an unreachably fast tempo).
            state._beatOrder = buildOrder(sign);
            state._beatOrderSign = sign;
            state._lastBeatCycle = state.cycleCount;
            if (state.cycleProgress <= START_EPS) {
                // At the cycle start: arm at 0 so the downbeat fires.
                state._beatNextIdx = 0;
            } else {
                // Mid-cycle arm: skip beats already passed so they
                // don't all replay at once.
                let idx = 0;
                while (idx < state._beatOrder.length
                    && state._beatOrder[idx].g < state.cycleProgress) idx++;
                state._beatNextIdx = idx;
            }
        } else if (state.cycleCount === state._lastBeatCycle + 1) {
            // Single wrap: flush the finishing cycle's pending beats
            // (all reached by progress 1), then build the new cycle.
            while (state._beatNextIdx < state._beatOrder.length) {
                const b = state._beatOrder[state._beatNextIdx++];
                this._runOnActiveBeat(curve, state, fn, disableKey, b.index, total, b.strength, b.f);
            }
            state._beatOrder = buildOrder(sign);
            state._beatOrderSign = sign;
            state._lastBeatCycle = state.cycleCount;
            state._beatNextIdx = 0;
        } else if (sign !== state._beatOrderSign) {
            // Same cycle but direction flipped (a cycleSpeeds edit
            // mid-cycle): rebuild for the new direction, keeping
            // already-fired beats from refiring by carrying the
            // count of beats whose g is below the current progress.
            state._beatOrder = buildOrder(sign);
            state._beatOrderSign = sign;
            let idx = 0;
            while (idx < state._beatOrder.length
                && state._beatOrder[idx].g <= state.cycleProgress) idx++;
            state._beatNextIdx = idx;
        }

        const order = state._beatOrder;
        const prog = state.cycleProgress;
        while (state._beatNextIdx < order.length && order[state._beatNextIdx].g <= prog) {
            const b = order[state._beatNextIdx++];
            this._runOnActiveBeat(curve, state, fn, disableKey, b.index, total, b.strength, b.f);
        }
    }

    /**
     * Run one curve's onActiveBeat callback for a crossed beat. The
     * context carries the beat's accent (strength 0-9, the natural
     * map to note velocity), its index and the total beat count,
     * the transport reads, and the playNote / playSound emitters
     * (same immediate-fire path as the collision and onTick
     * callbacks). A strength-0 beat still runs the callback — it is
     * a real beat at zero velocity, distinct from a rest, which
     * never reaches here. The full handle context (prev, random,
     * the per-firing additions) lands in §3.2; this is the lean
     * ctx. Also flashes the fired diamond yellow.
     * @param {any} curve
     * @param {(ctx: any) => void} fn
     * @param {string} disableKey
     * @param {number} beatIndex
     * @param {number} beatCount
     * @param {number} strength
     * @param {number} fraction  The beat's cycle-fraction (for the flash).
     */
    _runOnActiveBeat(curve, state, fn, disableKey, beatIndex, beatCount, strength, fraction) {
        const self = this;
        const selfId = curve.id;
        const simTime = this._simTime;
        const bpm = this._transport.bpm;
        const bpmNum = (typeof bpm === "number" && Number.isFinite(bpm)) ? bpm : 0;
        const beat = bpmNum > 0 ? (simTime * bpmNum) / 60 : 0;
        // The beat accent, normalized 0..1, is the default velocity:
        // playNote(note) plays at the beat's strength. Exposed on the
        // context as both `vel` and `velocity`.
        const vel = strength / 9;

        // Colour beneath the BEAT POINT — the pixel under the cursor as
        // it crosses this beat, NOT the curve centre — so the author
        // can map the colour behind each beat to its note (e.g. pitch
        // from this.col.r). The beat point sits on the curve at
        // parameter `fraction`, shifted by the curve's runtime offset
        // (state.dx/dy) exactly as the diamond draws. Same ten signals
        // as the onTick reads, via the same sampler; all zero with no
        // canvas/image.
        const sample = sampleCurve(curve.shape, fraction);
        const oklch = (sample !== null
            && this._canvas !== null
            && typeof this._canvas.sampleImageOKLCh === "function")
            ? this._canvas.sampleImageOKLCh(sample.x + state.dx, sample.y + state.dy)
            : null;
        const px = imageSignalsFromOKLCh(oklch);

        // The firing context is bound as the callback's `this`
        // (§3.2): reads are `this.vel` / `this.velocity` / `this.col.*`,
        // and the action functions are callable bare (playNote /
        // playSound) because the same object is set as the ambient
        // callback context below. playNote plays from the curve's note
        // voice; playSound from its sound bank. Velocity defaults to vel.
        const ctx = {
            id: selfId,
            kind: "curve",
            beatIndex,
            beatCount,
            vel,
            velocity: vel,
            // The ten image-colour signals beneath the beat point.
            col: colFromSignals(px),
            beat,
            time: simTime,
            bpm: bpmNum,
            /** @param {...any} args  playNote(note, vel?, dur?, pan?) or ("instrument", note, ...) or ({...}). */
            playNote(...args) {
                if (self._audioSink === null) return;
                const s = buildNoteSpec(args, vel);
                self._audioSink(selfId, {
                    type: "note",
                    sound: s.sound,
                    note: s.note,
                    amplitude: s.velocity,
                    duration: s.duration,
                    pan: s.pan,
                    audioTime: self._transport.audioTimeForElapsed(simTime),
                });
            },
            /** @param {...any} args  playSound(sample, vel?) or ("bank", sample, vel?) or ({...}). */
            playSound(...args) {
                if (self._audioSink === null) return;
                const s = buildSoundSpec(args, vel);
                self._audioSink(selfId, {
                    type: "sound",
                    bank: s.bank,
                    sample: s.sample,
                    amplitude: s.velocity,
                    audioTime: self._transport.audioTimeForElapsed(simTime),
                });
            },
        };

        setCallbackContext(ctx);
        try {
            fn.call(ctx);
        } catch (err) {
            this._activeBeatDisabled.add(disableKey);
            const detail = (err instanceof Error && typeof err.message === "string")
                ? err.message
                : String(err);
            const line = `onActiveBeat disabled for ${selfId}: ${detail}`;
            console.error("[onActiveBeat] " + line, err);
            if (this._messageLogger !== null) {
                try {
                    this._messageLogger(line, "error");
                } catch (_loggerErr) {
                    // A logger fault must never destabilise the sim.
                }
            }
        } finally {
            clearCallbackContext();
        }

        // Flash the fired beat's diamond yellow. The canvas matches
        // by the beat's cycle-fraction (the same f the diamond drew
        // at), so a strength-0 (small) beat flashes too.
        if (this._canvas !== null && typeof this._canvas.markFiredCurveBeat === "function") {
            this._canvas.markFiredCurveBeat(selfId, fraction);
        }
    }

    /**
     * Find a live scene object (curve, trigger, or sprite) by
     * id, scanning all three arrays. Returns null when no
     * scene is loaded or the id isn't present. Used by the
     * collision dispatch to read the firing object's gate and
     * function-name fields. Kept separate from the firing
     * engine's own _findSourceById since the simulation owns
     * the scene reference here.
     *
     * @param {string} id
     * @returns {any}
     */
    _findSceneObject(id) {
        if (this._scene === null) return null;
        const arrays = [
            this._scene.curves,
            this._scene.triggers,
            this._scene.sprites,
        ];
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
     * Sample the ten image-colour signals beneath an object's relevant
     * point: a curve's CURSOR (the curve sampled at its current
     * parameter t, shifted by the runtime offset), a sprite's centre,
     * or a trigger's position. Used by the collision callbacks so
     * this.col reads the pixel under the object at the moment of the
     * hit. Returns all-zero signals when there is no canvas or image,
     * or the kind/state is unknown.
     * @param {any} obj
     * @param {string} kind
     */
    _sampleColorUnderObject(obj, kind) {
        let x = 0;
        let y = 0;
        let ok = false;
        if (kind === "curve") {
            const st = this._curveState.get(obj.id);
            const sample = sampleCurve(obj.shape, st !== undefined ? st.t : 0);
            if (sample !== null) {
                x = sample.x + (st !== undefined ? st.dx : 0);
                y = sample.y + (st !== undefined ? st.dy : 0);
                ok = true;
            }
        } else if (kind === "sprite") {
            const st = this._spriteState.get(obj.id);
            if (st !== undefined) { x = st.x; y = st.y; ok = true; }
        } else if (kind === "trigger") {
            x = numberOrZero(obj.x);
            y = numberOrZero(obj.y);
            ok = true;
        }
        const oklch = (ok && this._canvas !== null
            && typeof this._canvas.sampleImageOKLCh === "function")
            ? this._canvas.sampleImageOKLCh(x, y)
            : null;
        return imageSignalsFromOKLCh(oklch);
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
        // A scene re-run (script.js reload, inspector or
        // canvas edit) re-enables any onTick or collision
        // callback that a throw disabled earlier this session.
        this._onTickDisabled.clear();
        this._collisionDisabled.clear();
        this._activeBeatDisabled.clear();
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
                this._applyCurveBeatPoints(c, newState);
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
            // Re-derive beat points: a Beat Points edit (mode,
            // active beats, strength, strudel pattern) changes which
            // positions fire. _applyCurveBeatPoints resets the
            // firing order so the next step rebuilds cleanly.
            this._applyCurveBeatPoints(c, existing);
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
                newState.baseVx = newState._authVx * speed;
                newState.baseVy = newState._authVy * speed;
                newState.vx = newState.baseVx;
                newState.vy = newState.baseVy;
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
                existing.baseVx = authVx;
                existing.vx = authVx;
                existing._authVx = authVx;
            }
            if (authVy !== existing._authVy) {
                existing.baseVy = authVy;
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

        // Seed-variation: refresh each object's per-seed offset
        // against the freshly reconciled scene so the current seed
        // keeps applying across reloads (fresh runtime states
        // start with zero offset). Zero seed / zero variability
        // leaves every offset at zero, so this is a no-op for the
        // default path.
        this._recomputeSeedOffsets();
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
            this._onTickAccumulator = 0;
            // Fall through so any positive elapsed time after
            // a rewind-and-resume still advances normally.
        }
        // Audition boundary. When armed, fire once the elapsed
        // beats (measured from the reset at elapsed 0) reach the
        // target. Checked every playing tick, before the substep
        // early-return, so a low-BPM frame with no substep still
        // fires on time. elapsedBeats is null when the piece has no
        // BPM, in which case there is no beat clock to audition
        // against and the boundary never fires. The handler may
        // reset the transport + sim clock (Loop re-seeds and
        // rewinds; Mutate pauses), so RETURN immediately after it
        // rather than computing a delta against the now-stale
        // `elapsed` read at the top of this tick — the next frame
        // starts cleanly from the new state.
        if (this._auditionBoundaryBeats !== null && this._transport.isPlaying) {
            const beats = this._transport.elapsedBeats;
            if (beats !== null && beats >= this._auditionBoundaryBeats) {
                this._auditionBoundaryBeats = null;
                if (typeof this._auditionBoundaryHandler === "function") {
                    this._auditionBoundaryHandler();
                }
                return;
            }
        }
        this._lastElapsed = elapsed;
        // Only the look-ahead scheduler advances the clock; a paused
        // transport freezes the sim where it is (already a window
        // ahead of the playhead, ready to resume in step).
        if (!this._transport.isPlaying) return;
        // Step AHEAD of the playhead by LOOKAHEAD_WINDOW so each fired
        // note's stamped audio time lies in the future. _simTime tracks
        // (elapsed + window); the sub-window leftover carries naturally
        // because _simTime persists across ticks. After a long stall,
        // snap forward rather than queue a freeze-inducing run of steps.
        const target = elapsed + LOOKAHEAD_WINDOW;
        if (target - this._simTime > MAX_CATCHUP_SECONDS) {
            this._simTime = target - MAX_CATCHUP_SECONDS;
            this._accumulator = 0;
        }
        while (this._simTime + SIM_DT <= target) {
            this._step(SIM_DT);
            this._simTime += SIM_DT;
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
            // Disabled is frozen: leave its phase untouched.
            if (curve.state === "disabled") continue;
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
            // Disabled is frozen: leave its phase untouched.
            if (trigger.state === "disabled") continue;
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
            // Disabled is frozen: do not recompute its cycle
            // phase on a tempo change. Passive is unaffected.
            if (sprite.state === "disabled") continue;
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
     * The current global variation seed.
     * @returns {number}
     */
    getSeed() {
        return this._seed;
    }

    /**
     * Set the global variation seed and recompute every object's
     * per-seed start-state offset. Storing the seed alone changes
     * nothing audible; the offsets are applied on the next
     * rewind. The toolbar's Vary button calls this then
     * transport.rewind(), which triggers _rewind here (applying
     * the offsets) and the firing engine's audio flush (a
     * backward jump in elapsed time). Seed 0 clears all offsets,
     * returning the scene to its authored start state.
     * @param {number} seed
     */
    setSeed(seed) {
        this._seed = Number.isFinite(seed) ? Math.trunc(seed) : 0;
        this._recomputeSeedOffsets();
    }

    /**
     * Apply a new seed and immediately re-seed every object to
     * its seeded start state, then put the simulation clock in
     * the exact post-rewind state. Used by the toolbar's Vary
     * button so the variation takes effect deterministically —
     * including from a cold start at elapsed 0, where a plain
     * transport.rewind() produces no backward jump for tick() to
     * detect. The caller still calls transport.rewind() too, so
     * the transport position resets and the firing engine flushes
     * its pending audio on the backward jump; this method aligns
     * the simulation's own bookkeeping (_lastElapsed / _simTime /
     * accumulator) with that reset so the next tick advances the
     * new chunk cleanly from its seeded home.
     * @param {number} seed
     */
    applySeedAndReset(seed) {
        this.setSeed(seed);
        this._rewind();
        this._lastElapsed = 0;
        this._simTime = 0;
        this._accumulator = 0;
        this._onTickAccumulator = 0;
    }

    /**
     * Register the callback fired when an armed audition boundary
     * is reached. main.js wires this to act on the current mode:
     * Mutate pauses the transport (which the firing engine's pause
     * listener flushes + MIDI-panics, ending the candidate
     * cleanly); Loop re-applies the current seed, rewinds, and
     * re-arms so the chunk repeats. Called once at setup.
     * @param {() => void} fn
     */
    setAuditionBoundaryHandler(fn) {
        this._auditionBoundaryHandler = fn;
    }

    /**
     * Arm a boundary at `beats` master-clock beats from the current
     * reset (elapsed 0). The audition bar's Mutate / Loop buttons
     * call this right after applySeedAndReset + rewind, so the
     * candidate plays exactly this many beats before the boundary
     * fires. A non-positive or non-finite value disarms.
     * @param {number} beats
     */
    armAuditionBoundary(beats) {
        this._auditionBoundaryBeats = (Number.isFinite(beats) && beats > 0) ? beats : null;
    }

    /**
     * Disarm any pending audition boundary. Called on a manual
     * pause so a subsequent ordinary Play runs continuously rather
     * than being cut short by a stale armed boundary.
     */
    disarmAuditionBoundary() {
        this._auditionBoundaryBeats = null;
    }

    /**
     * Recompute each curve's and sprite's per-seed start-state
     * offset from the current seed and the object's variability,
     * storing it on the runtime state for _rewind and the
     * per-cycle home snaps to apply. Triggers carry no runtime
     * position state, so their offset is computed inline in
     * _rewind instead. A locked object (variability 0) or seed 0
     * yields a zero offset, leaving today's behaviour intact.
     * Called by setSeed and at the end of setScene so the offsets
     * track both seed changes and scene reloads.
     */
    _recomputeSeedOffsets() {
        if (this._scene === null) return;
        const cw = numberOrZero(this._scene.canvasW) || 32;
        const ch = numberOrZero(this._scene.canvasH) || 24;
        for (const curve of this._scene.curves) {
            const state = this._curveState.get(curve.id);
            if (state === undefined) continue;
            const off = computeOffset(this._seed, curve.id, numberOrZero(curve.variability), cw, ch);
            state._seedDx = off.dx;
            state._seedDy = off.dy;
            state._seedVx = off.dvx;
            state._seedVy = off.dvy;
        }
        for (const sprite of this._scene.sprites) {
            const state = this._spriteState.get(sprite.id);
            if (state === undefined) continue;
            const off = computeOffset(this._seed, sprite.id, numberOrZero(sprite.variability), cw, ch);
            state._seedDx = off.dx;
            state._seedDy = off.dy;
            state._seedVx = off.dvx;
            state._seedVy = off.dvy;
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
            // Seed-variation: the runtime offset starts at the
            // seeded position offset (zero when seed 0 / locked),
            // translating the whole curve body; the launch
            // velocity adds the seeded velocity offset. Both are
            // zero by default, so this is the plain authored home.
            state.dx = state._seedDx;
            state.dy = state._seedDy;
            state.vx = state._authVx + state._seedVx;
            state.vy = state._authVy + state._seedVy;
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
        // Seed-variation: triggers carry no runtime position
        // state — their collision point is read straight off the
        // trigger object's x / y — so the seeded position offset
        // is applied to the live object here, against a pristine
        // home captured on first rewind (and recaptured whenever
        // the scene reloads with fresh Trigger objects). Triggers
        // never snap or move on their own, so this persists for
        // the whole chunk and is fully reproducible (always home
        // plus the seeded offset). Velocity is N/A for triggers.
        if (this._scene !== null) {
            const cw = numberOrZero(this._scene.canvasW) || 32;
            const ch = numberOrZero(this._scene.canvasH) || 24;
            for (const trigger of this._scene.triggers) {
                if (typeof trigger.id !== "string") continue;
                /** @type {any} */
                const t = trigger;
                if (t._seedHomeX === undefined) {
                    t._seedHomeX = t.x;
                    t._seedHomeY = t.y;
                }
                const off = computeOffset(this._seed, t.id, numberOrZero(t.variability), cw, ch);
                t.x = t._seedHomeX + off.dx;
                t.y = t._seedHomeY + off.dy;
            }
        }
        // Sprite rewind copies the per-state record of
        // last-seen authored values back into the live
        // runtime fields. The _auth fields stay where they
        // are — they track the authored values, which the
        // rewind doesn't change — so a subsequent setScene
        // that doesn't see new authored values won't snap
        // again.
        for (const state of this._spriteState.values()) {
            // Seed-variation: start from the authored home plus
            // the seeded position offset (both zero by default).
            state.x = state._authX + state._seedDx;
            state.y = state._authY + state._seedDy;
            state.cycleProgress = 0;
            state.cycleCount = 0;
            state._lastCycleDuration = 0;
            // Launch cycle 0 at the authored velocity scaled
            // by the first speed entry, plus the seeded velocity
            // offset. Rewind always restores the home position (a
            // full reset), so no teleport flag is needed here;
            // only the velocity multiplier applies. A leading-zero
            // list parks the sprite at home with zero launch
            // velocity (the seeded velocity offset still adds).
            const { speed } = this._spriteCycleSpeed(state, 0);
            state.baseVx = state._authVx * speed + state._seedVx;
            state.baseVy = state._authVy * speed + state._seedVy;
            state.vx = state.baseVx;
            state.vy = state.baseVy;
            state.flipX = 1;
            state.flipY = 1;
            state._rngState = state._rngSeed;
            state._lastAudioFireTime = -Infinity;
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
            // Disabled is frozen: no cursor sweep or cycle
            // advance. Passive still advances normally (it just
            // has no cursor and does not self-fire).
            if (curve.state === "disabled") continue;
            const state = this._curveState.get(curve.id);
            if (state === undefined) continue;
            if (state.halted) continue;
            const cd = cycleDurationSeconds(bpm, curve.beatsPerCycle, curve.beatInterval);
            this._stepCurve(curve, state, cd, dt);
        }
        for (const trigger of this._scene.triggers) {
            if (typeof trigger.id !== "string") continue;
            // Disabled is frozen: a disabled trigger does not
            // advance its cycle (it cannot fire anyway).
            if (trigger.state === "disabled") continue;
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
            // Per-cycle home snap. The home is the authored
            // position plus the seeded offset (both zero by
            // default), so a seeded curve returns to its seeded
            // home each cycle rather than drifting back to the
            // authored one — keeping the variation stable across
            // cycle wraps for the whole chunk.
            state.dx = state._seedDx;
            state.dy = state._seedDy;
            state.vx = state._authVx + state._seedVx;
            state.vy = state._authVy + state._seedVy;
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

        // Fire onActiveBeat for any of this curve's own active
        // beats the cursor crossed this step (§3.1b).
        this._detectActiveBeatCrossings(curve, state);
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
     * Run one sprite's onTick callback for this sub-step, if
     * it is enabled and resolves, building the fresh context
     * object the callback reads and writes through.
     *
     * Gating: the sprite must have canTick true, must not be
     * disabled (a disabled sprite is inert and frozen; a
     * passive sprite still runs onTick), must name a function
     * that resolves in the scene's
     * functionMap, and must not be in the session-disable set
     * (parked there by a previous throw). Any miss is a silent
     * no-op.
     *
     * The context exposes reads — identity, the kinematics as
     * the effective velocity, the two flip signs, the
     * transport, and the ten px colour values sampled beneath
     * the sprite via the shared derivation so they match the
     * pattern signals — and one write, applyForce, which
     * converts a literal force into an impulse-velocity change
     * of force / mass times dt added to the effective
     * velocity. Multiple applyForce calls in a step accumulate;
     * the engine never transforms the force (the composer
     * multiplies flipX / flipY in themselves for the anti-trap
     * reversal). mass is the sprite's authored field, default
     * one, floored at one tenth.
     *
     * A throw is caught, the sprite's onTick is disabled for
     * the rest of the session, and the first error is logged
     * once to the console and (when a logger is attached) the
     * message area, rather than flooding either at the sub-
     * step rate.
     *
     * @param {any} sprite
     * @param {SpriteRuntimeState} state
     * @param {number} dt  Fixed sub-step seconds (SIM_DT).
     * @param {number | null} bpm
     * @returns {number}  Magnitude of the net force the callback
     *     applied this tick, or 0 when no callback ran or none
     *     was applied. _stepSprites uses this to detect a dead
     *     zone and suspend damping so the sprite coasts through.
     */
    _runSpriteOnTick(sprite, state, dt, bpm) {
        if (sprite.canTick !== true) return 0;
        if (sprite.state === "disabled") return 0;
        if (this._scene === null) return 0;
        const name = sprite.onTickFunction;
        if (typeof name !== "string" || name === "") return 0;
        const fn = this._scene.functionMap[name];
        if (typeof fn !== "function") return 0;
        if (this._onTickDisabled.has(sprite.id)) return 0;

        // mass: dimensionless, default one, floored at 0.1 so a
        // near-zero mass can't divide a force into an unbounded
        // velocity change (shared with the agitation via spriteMass).
        const mass = spriteMass(sprite);

        // Sample the image colour beneath the sprite at its
        // current position and derive the ten px reads with the
        // SAME function the pattern signals use, so a pattern's
        // pxR and an onTick's ctx.pxR agree. No canvas or no
        // image -> null -> all reads zero.
        const oklch = (this._canvas !== null
            && typeof this._canvas.sampleImageOKLCh === "function")
            ? this._canvas.sampleImageOKLCh(state.x, state.y)
            : null;
        const px = imageSignalsFromOKLCh(oklch);

        const simTime = this._simTime;
        const self = this;
        const bpmNum = (typeof bpm === "number" && Number.isFinite(bpm)) ? bpm : 0;
        const beat = bpmNum > 0 ? (simTime * bpmNum) / 60 : 0;

        // Net force the callback applies this tick, accumulated by
        // applyForce. Returned as a magnitude so _stepSprites can
        // tell a dead zone (no push) from a region that pushes:
        // damping is suspended when this is ~zero so the sprite
        // coasts through on its current heading instead of stalling.
        let netFx = 0;
        let netFy = 0;

        // onTick has no beat accent, so the default velocity is full
        // (1.0); the colour reads are the natural source the author
        // maps to velocity instead (e.g. playNote(60, this.r)).
        const vel = 1;
        const ctx = {
            id: sprite.id,
            kind: "sprite",
            x: state.x,
            y: state.y,
            vx: state.vx,
            vy: state.vy,
            speed: Math.hypot(state.vx, state.vy),
            flipX: state.flipX,
            flipY: state.flipY,
            vel,
            velocity: vel,
            beat,
            time: simTime,
            bpm: bpmNum,
            cyclePhase: state.cycleProgress,
            cycleCount: state.cycleCount,
            // The ten image-colour signals beneath the sprite. Read as
            // this.col.r, this.col.y, this.col.lt, etc.
            col: colFromSignals(px),
            /**
             * Apply a literal force this sub-step. The engine
             * divides by the sprite's mass and integrates over
             * the fixed step into the effective velocity (the
             * impulse layer, implicitly vx - baseVx); it never
             * changes the force's direction. +Y is up, matching
             * the canvas coordinate system. Multiple calls in
             * one onTick accumulate. Non-finite components are
             * ignored so a NaN can't poison the velocity.
             * @param {number} fx
             * @param {number} fy
             */
            applyForce(fx, fy) {
                if (typeof fx === "number" && Number.isFinite(fx)) {
                    state.vx += (fx / mass) * dt;
                    netFx += fx;
                }
                if (typeof fy === "number" && Number.isFinite(fy)) {
                    state.vy += (fy / mass) * dt;
                    netFy += fy;
                }
            },
            /**
             * Fire a pitched note from the sprite's note voice
             * (§3.3). playNote(note, vel?, dur?, pan?) or
             * ("instrument", note, ...) or ({...}); velocity
             * defaults to this.vel. Per-sprite rate-limited to one
             * fire per MIN_AUDIO_FIRE_INTERVAL of sim time (shared
             * with playSound) so an ungated onTick can't flood.
             * @param {...any} args
             */
            playNote(...args) {
                if (self._audioSink === null) return;
                if (simTime - state._lastAudioFireTime < MIN_AUDIO_FIRE_INTERVAL) return;
                state._lastAudioFireTime = simTime;
                const s = buildNoteSpec(args, vel);
                self._audioSink(sprite.id, {
                    type: "note",
                    sound: s.sound,
                    note: s.note,
                    amplitude: s.velocity,
                    duration: s.duration,
                    pan: s.pan,
                    audioTime: self._transport.audioTimeForElapsed(simTime),
                });
            },
            /**
             * Fire a sample from the sprite's sound bank (§3.3).
             * playSound(sample, vel?) or ("bank", sample, vel?) or
             * ({...}). Superdough-only. Shares playNote's rate limit.
             * @param {...any} args
             */
            playSound(...args) {
                if (self._audioSink === null) return;
                if (simTime - state._lastAudioFireTime < MIN_AUDIO_FIRE_INTERVAL) return;
                state._lastAudioFireTime = simTime;
                const s = buildSoundSpec(args, vel);
                self._audioSink(sprite.id, {
                    type: "sound",
                    bank: s.bank,
                    sample: s.sample,
                    amplitude: s.velocity,
                    audioTime: self._transport.audioTimeForElapsed(simTime),
                });
            },
        };

        setCallbackContext(ctx);
        try {
            fn.call(ctx);
        } catch (err) {
            this._onTickDisabled.add(sprite.id);
            const detail = (err instanceof Error && typeof err.message === "string")
                ? err.message
                : String(err);
            const line = `onTick disabled for ${sprite.id}: ${detail}`;
            console.error("[onTick] " + line, err);
            if (this._messageLogger !== null) {
                try {
                    this._messageLogger(line, "error");
                } catch (_loggerErr) {
                    // A logger fault must never destabilise the
                    // simulation; the console line above stands.
                }
            }
        } finally {
            clearCallbackContext();
        }
        // Magnitude of the net force applied this tick. Zero when
        // no force was applied (or the callback threw before
        // applying one), which _stepSprites reads as a dead zone
        // and responds to by suspending damping for this sub-step.
        return Math.hypot(netFx, netFy);
    }

    /**
     * Advance every sprite's runtime state by dt seconds.
     * Order per sprite:
     *
     *   1. Impulse damping: relax the force-driven part of
     *      the velocity (vx - baseVx) toward zero at the
     *      score's drag rate (score.kinematics.drag), leaving
     *      the base launch layer undamped. Suspended on any
     *      sub-step where the callback applied essentially no
     *      force, so the sprite coasts through a dead zone on
     *      its current heading. A minimum-speed floor then
     *      holds the force-driven impulse at the score's coast
     *      speed (score.kinematics.coast) so a weak region
     *      can't damp it to a crawl. Replaces the former
     *      maxSpeed ceiling; with drag 0 the impulse coasts
     *      always. A tiny deterministic anti-trap agitation
     *      (score.kinematics.jitter) is also injected in the
     *      force-active case to shake a sprite out of a colour
     *      well it would otherwise orbit.
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
        // Score-wide motion feel, read once per sub-step from the
        // scene's kinematics (set by the composer in script.js
        // via score.kinematics; falls back to the defaults if a
        // scene lacks the field). Each is a guarded non-negative
        // number: drag is the impulse-damping rate, jitter the
        // anti-trap agitation magnitude, coast the minimum coast
        // speed floor.
        const kin = (this._scene.kinematics !== null
            && typeof this._scene.kinematics === "object")
            ? this._scene.kinematics
            : DEFAULT_KINEMATICS;
        const drag = kinNum(kin.drag, DEFAULT_KINEMATICS.drag);
        const jitter = kinNum(kin.jitter, DEFAULT_KINEMATICS.jitter);
        const coast = kinNum(kin.coast, DEFAULT_KINEMATICS.coast);
        // onTick control-rate gate: advance the 60 Hz accumulator by
        // this fine step's dt and decide whether onTick runs this
        // step. With SIM_DT = 1/240 and ONTICK_DT = 1/60, this is true
        // on every 4th step; the other three integrate physics under
        // the force the last onTick set. A while-subtract keeps it
        // correct if dt ever exceeds ONTICK_DT.
        this._onTickAccumulator += dt;
        let runOnTick = false;
        if (this._onTickAccumulator >= ONTICK_DT) {
            this._onTickAccumulator -= ONTICK_DT;
            runOnTick = true;
        }
        for (const sprite of this._scene.sprites) {
            if (typeof sprite.id !== "string") continue;
            // Disabled is frozen: skip physics AND onTick. A
            // passive sprite is NOT skipped — it still moves and
            // still runs onTick; it just has no cursor.
            if (sprite.state === "disabled") continue;
            const state = this._spriteState.get(sprite.id);
            if (state === undefined) continue;
            // 0. onTick: run the sprite's per-tick callback at the
            //    60 Hz control rate (runOnTick), BEFORE physics, so a
            //    force it applies is integrated this same step. It is
            //    passed ONTICK_DT (not the fine-step dt) so applyForce
            //    delivers the control-period impulse; the result is
            //    stored on the state and REUSED for the dead-zone
            //    decision on the intervening fine steps, where the
            //    force persists but onTick does not re-run. Gated
            //    inside the helper by canTick, not-disabled, a
            //    resolved function name, and the session-disable set.
            if (runOnTick) {
                state._lastOnTickForceMag =
                    this._runSpriteOnTick(sprite, state, ONTICK_DT, bpm);
            }
            const forceMag = state._lastOnTickForceMag;
            // 1. Impulse damping (drag). Relax the force-driven
            //    impulse layer (vx - baseVx) toward zero at the
            //    score's drag rate, leaving the cycleSpeeds base
            //    launch velocity undamped. drag is a rate in
            //    1/sec; 0 disables it (the sprite then coasts
            //    indefinitely under a sustained force, since there
            //    is no hard speed cap). Terminal impulse speed
            //    under a steady force F is about F/(mass*drag).
            //
            //    Dead-zone coast: damping is SUSPENDED on any
            //    sub-step where the callback applied essentially
            //    no force (forceMag <= FORCE_EPSILON). With no
            //    push there is nothing to settle toward, so a
            //    force-only sprite would otherwise drag to a halt
            //    in a force-free patch (a black region, or a flat
            //    region with no colour contrast to steer by) and
            //    never leave. Suspending damping there lets it
            //    coast on its current velocity — same heading,
            //    same speed it carried in — until it reaches a
            //    region that pushes again. The trigger is the
            //    ABSENCE OF FORCE, not low speed, so a faint
            //    region that legitimately pushes the sprite slow
            //    still damps normally and keeps its low speed.
            if (drag > 0 && forceMag > FORCE_EPSILON) {
                const decay = Math.exp(-drag * dt);
                state.vx = state.baseVx + (state.vx - state.baseVx) * decay;
                state.vy = state.baseVy + (state.vy - state.baseVy) * decay;
                // Anti-trap agitation. A tiny deterministic random
                // force injected only here, in the force-active /
                // damping-on case where colour wells form, to nudge
                // the sprite off a local attractor it would otherwise
                // orbit. Damping bounds it to a small fidget. Two RNG
                // draws give the x and y components, each in
                // [-jitter, jitter]; applied as a force (over mass,
                // over dt) like applyForce, so no position jump. The
                // per-sprite state advances only on the steps this
                // fires — a deterministic condition — so replay
                // reproduces it exactly.
                if (jitter > 0) {
                    const m = spriteMass(sprite);
                    let draw = rngNext(state._rngState);
                    const ax = (draw.value * 2 - 1) * jitter;
                    draw = rngNext(draw.state);
                    const ay = (draw.value * 2 - 1) * jitter;
                    state._rngState = draw.state;
                    state.vx += (ax / m) * dt;
                    state.vy += (ay / m) * dt;
                }
            }
            // 1b. Minimum coast speed. A force-only sprite settles
            //     at a speed set by the local force, so a weak (dark
            //     or low-contrast) region drives the force-driven
            //     impulse to a near-zero crawl it can sit in for a
            //     long time. Hold the IMPULSE layer's speed at or
            //     above the score coast speed, heading preserved, so
            //     the sprite always cruises out of a weak region.
            //     Acting on the impulse (not the total velocity)
            //     leaves a plain authored-velocity sprite untouched —
            //     its motion isn't force-driven, its impulse is ~zero,
            //     so the floor is a no-op there. For a force-only
            //     sprite (base zero) the impulse IS the whole
            //     velocity, so this is its travel-speed floor. The
            //     dead-zone coast above already carries a sprite
            //     through a true zero-force patch at full speed; this
            //     catches the weak-but-nonzero case the coast misses.
            //     No-op above the floor and when the impulse is zero
            //     (no heading).
            const ix = state.vx - state.baseVx;
            const iy = state.vy - state.baseVy;
            const ispd = Math.hypot(ix, iy);
            if (ispd > 0 && ispd < coast) {
                const lift = coast / ispd;
                state.vx = state.baseVx + ix * lift;
                state.vy = state.baseVy + iy * lift;
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
                    state.baseVx = -state.baseVx;
                    state.flipX = -state.flipX;
                } else if (newX - r < -halfW) {
                    newX = -halfW + r;
                    state.vx = -state.vx;
                    state.baseVx = -state.baseVx;
                    state.flipX = -state.flipX;
                }
                if (newY + r > halfH) {
                    newY = halfH - r;
                    state.vy = -state.vy;
                    state.baseVy = -state.baseVy;
                    state.flipY = -state.flipY;
                } else if (newY - r < -halfH) {
                    newY = -halfH + r;
                    state.vy = -state.vy;
                    state.baseVy = -state.baseVy;
                    state.flipY = -state.flipY;
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
                    // a fresh launch identical to a rewind's.
                    // Home position (authored plus the seeded
                    // offset, both zero by default), base
                    // re-derived from authored times this cycle's
                    // speed plus the seeded velocity offset, the
                    // impulse layer zeroed (vx/vy set equal to
                    // base), and the flip signs reset.
                    state.x = state._authX + state._seedDx;
                    state.y = state._authY + state._seedDy;
                    state.baseVx = state._authVx * speed + state._seedVx;
                    state.baseVy = state._authVy * speed + state._seedVy;
                    state.vx = state.baseVx;
                    state.vy = state.baseVy;
                    state.flipX = 1;
                    state.flipY = 1;
                    state._rngState = state._rngSeed;
                    state._lastAudioFireTime = -Infinity;
                } else {
                    // Continuous wrap: scale only the BASE
                    // layer by the ratio of this cycle's speed
                    // to the previous cycle's, leaving the
                    // impulse layer (the implicit vx - baseVx)
                    // untouched so a force field's accumulated
                    // effect rides through the boundary. The
                    // effective velocity moves by the base
                    // delta: new vx = old vx + baseVx*(ratio-1),
                    // computed BEFORE baseVx is itself rescaled.
                    // With no impulse (vx == baseVx) this
                    // reduces to the old vx *= ratio. A same-
                    // speed list ("1") gives ratio 1 and changes
                    // nothing; "1 -1" flips direction; "1 2"
                    // rescales speed. The product of ratios
                    // telescopes over a loop so base magnitude
                    // stays |authored| times this cycle's speed.
                    // The impulse is relaxed each step by
                    // damping, not by the wrap; base stays
                    // pristine.
                    const ratio = prevSpeed !== 0 ? speed / prevSpeed : 0;
                    state.vx += state.baseVx * (ratio - 1);
                    state.vy += state.baseVy * (ratio - 1);
                    state.baseVx *= ratio;
                    state.baseVy *= ratio;
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
 * Effective inertial mass of a sprite: the authored value,
 * defaulting to 1 and floored at 0.1 so a near-zero mass can't
 * divide a force into an unbounded velocity change. Single source
 * of truth shared by the onTick force application and the anti-trap
 * agitation.
 * @param {any} sprite
 * @returns {number}
 */
function spriteMass(sprite) {
    const m = (typeof sprite.mass === "number" && Number.isFinite(sprite.mass))
        ? sprite.mass
        : 1;
    return m < 0.1 ? 0.1 : m;
}

/**
 * Coerce a score-wide kinematics knob to a usable value: the value
 * itself when it is a finite number >= 0, else the fallback default.
 * The loader already sanitises scene.kinematics, so this is a
 * defensive read for scenes built without the loader (e.g. tests).
 * @param {any} v
 * @param {number} fallback
 * @returns {number}
 */
function kinNum(v, fallback) {
    return (typeof v === "number" && Number.isFinite(v) && v >= 0) ? v : fallback;
}

/**
 * FNV-1a 32-bit hash of a string to an unsigned 32-bit integer.
 * Used to derive a stable per-sprite RNG seed from the sprite id,
 * so the anti-trap agitation produces the same sequence for a given
 * sprite on every run and every replay.
 * @param {string} str
 * @returns {number}
 */
function hashStringToUint32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * One step of a mulberry32 PRNG. Pure: takes the current 32-bit
 * state and returns the next float in [0, 1) together with the next
 * state, so the caller threads state explicitly (the per-sprite
 * state lives on SpriteRuntimeState and is reset on rewind /
 * home-teleport). Deterministic, which is what keeps the agitation
 * reproducible across replays.
 * @param {number} state
 * @returns {{value: number, state: number}}
 */
function rngNext(state) {
    let a = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return { value, state: a >>> 0 };
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
