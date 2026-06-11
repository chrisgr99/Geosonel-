// @ts-check

/**
 * Ambient callback context for bare-call emitters (GeoSonixV2 §3.2).
 *
 * A procedural callback runs with its object handle bound as `this`
 * (so reads are `this.vel`, `this.r`, `this.x`), and the ACTION
 * functions — playNote, playSound, applyForce — are callable BARE,
 * with no prefix and no context argument, exactly as in GeoSonix.
 *
 * A bare `playNote(60)` has to reach the object that is firing. The
 * engine sets the "current" firing context right before it invokes a
 * callback and clears it right after; the bare emitters here forward
 * to that current context's matching method. It is a single, tightly
 * scoped ambient pointer around each synchronous callback call (the
 * standard dynamic-context pattern, like p5.js global mode), not a
 * pile of per-property globals.
 *
 * The same functions are injected into every script.js callback's
 * scope by the scene loader (executeScript), so they resolve as bare
 * names; they are stable singletons that route dynamically through
 * `current`.
 */

/** @type {any} */
let current = null;

/**
 * Bind the firing context that bare emitter calls route to. Called by
 * the engine immediately before invoking a callback (with the same
 * object that is bound as the callback's `this`).
 * @param {any} ctx
 */
export function setCallbackContext(ctx) {
    current = ctx;
}

/** Clear the firing context after a callback returns (or throws). */
export function clearCallbackContext() {
    current = null;
}

/** @returns {any} The current firing context, or null. */
export function getCallbackContext() {
    return current;
}

/**
 * Bare playNote — forwards to the firing object's playNote. No-op
 * when called outside a callback (no current context) or by a
 * context kind without the method.
 * @param {...any} args
 */
export function playNote(...args) {
    if (current !== null && typeof current.playNote === "function") {
        return current.playNote(...args);
    }
    return undefined;
}

/**
 * Bare playSound — forwards to the firing object's playSound.
 * @param {...any} args
 */
export function playSound(...args) {
    if (current !== null && typeof current.playSound === "function") {
        return current.playSound(...args);
    }
    return undefined;
}

/**
 * Bare applyForce — forwards to the firing object's applyForce
 * (meaningful for sprites; a no-op where the context has no such
 * method, e.g. a curve's onActiveBeat).
 * @param {...any} args
 */
export function applyForce(...args) {
    if (current !== null && typeof current.applyForce === "function") {
        return current.applyForce(...args);
    }
    return undefined;
}

/**
 * Bare onBeatInterval — forwards to the firing object's onBeatInterval
 * (present only on onTick contexts). Returns false outside an onTick
 * callback or in a context kind without the method, so the gate is a
 * safe no-op anywhere it doesn't apply.
 * @param {...any} args
 * @returns {boolean}
 */
export function onBeatInterval(...args) {
    if (current !== null && typeof current.onBeatInterval === "function") {
        return current.onBeatInterval(...args);
    }
    return false;
}
