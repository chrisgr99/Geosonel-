/**
 * Firing-context pointer for the dynamic-signal substrate
 * (Tier 2 Phase 3).
 *
 * When the firing engine's commit walker is about to
 * dispatch a pattern event, it sets a module-level context
 * pointer with the firing source identity, the event's
 * audioTime, and a frozen snapshot of simulation state
 * captured at the top of this tick. Dynamic-signal Pattern
 * implementations (landing in Phase 4 and beyond) consult
 * this pointer inside their queryArc bodies to learn which
 * source's state they should read and where to read it
 * from. Without an active context, dynamic signals fall
 * back to a safe default appropriate for the signal kind.
 *
 * The withFiringContext helper enforces try-finally
 * discipline so an exception during queryArc cannot strand
 * the pointer and contaminate subsequent events. The
 * save-and-restore (rather than save-and-clear) handles
 * the unlikely case of nested withFiringContext calls
 * gracefully; top-level callers see the simpler set-and-
 * clear pattern because the previous value is null.
 *
 * No signal definitions exist yet in Phase 3; the substrate
 * exists in advance of consumers so Phase 4's first signals
 * can land as small isolated additions on top of an
 * already-exercised infrastructure.
 */

// @ts-check

/**
 * @typedef {Object} FiringSnapshotEntry
 * @property {"curve" | "sprite"} kind
 * @property {number} cycleCount
 * @property {number} cycleProgress
 * @property {number} [t]   Curve cursor parameter in [0, 1), if kind is "curve".
 * @property {number} [x]   Sprite x position in canvas units, if kind is "sprite".
 * @property {number} [y]   Sprite y position in canvas units, if kind is "sprite".
 * @property {number} [vx]  Sprite x velocity, if kind is "sprite".
 * @property {number} [vy]  Sprite y velocity, if kind is "sprite".
 *
 * @typedef {Object} FiringSnapshot
 * @property {number} audioNow                          AudioContext.currentTime
 *                                                       when this snapshot was
 *                                                       captured.
 * @property {Map<string, FiringSnapshotEntry>} sources Per-source state copies,
 *                                                       keyed by source id.
 *
 * @typedef {Object} FiringContext
 * @property {string} sourceId
 * @property {"curve" | "sprite"} kind
 * @property {number} audioTime         The event's intended audioContext time.
 * @property {FiringSnapshot} snapshot  Frozen simulation state at tick top.
 */

/** @type {FiringContext | null} */
let _activeContext = null;

/**
 * Read the active firing context. Returns null when no
 * Pass 2 evaluation is in progress, in which case dynamic
 * signal definitions should fall back to a safe default.
 * Called by dynamic-signal Pattern implementations from
 * inside their queryArc bodies.
 *
 * @returns {FiringContext | null}
 */
export function getFiringContext() {
    return _activeContext;
}

/**
 * Run fn with the given firing context active, restoring
 * the previous context (typically null) in a finally block
 * so an exception during fn does not strand the pointer
 * and contaminate subsequent events. The save-and-restore
 * shape supports nested calls; top-level callers see the
 * simpler set-and-clear pattern because prev is null.
 *
 * @template T
 * @param {FiringContext} ctx
 * @param {() => T} fn
 * @returns {T}
 */
export function withFiringContext(ctx, fn) {
    const prev = _activeContext;
    _activeContext = ctx;
    try {
        return fn();
    } finally {
        _activeContext = prev;
    }
}
