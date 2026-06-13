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

import { mapToHarmonyCore, MAP_TO_HARMONY_DEFAULTS } from "./harmonyMap.js";

/** @type {any} */
let current = null;

/**
 * Ambient "current harmony" for the bare `mapToHarmony` global, mirroring the
 * ambient `current` firing context. The engine sets it right before a
 * callback fires (the chord sounding at that beat, plus the song key) and
 * clears it after. `mapToHarmony` reads it so a bare `mapToHarmony(value)` maps
 * to a tone of the chord under the playhead. null when no harmony is loaded or
 * playback has ended (loop off) — `mapToHarmony` then degrades to a linear map.
 * @type {{ chord: any, key: any } | null}
 */
let currentHarmony = null;

/**
 * Bind the ambient harmony for the bare `mapToHarmony` global. Called by the
 * engine immediately before invoking a callback, alongside
 * {@link setCallbackContext}.
 * @param {{ chord: any, key: any } | null} harmony
 */
export function setCallbackHarmony(harmony) {
    currentHarmony = harmony;
}

/** Clear the ambient harmony after a callback returns (or throws). */
export function clearCallbackHarmony() {
    currentHarmony = null;
}

/**
 * Bare mapToHarmony — map a value to a MIDI note of the CURRENT chord (the
 * chord sounding under the playhead at the moment the callback fires).
 *
 *   mapToHarmony(value, lowValue?, highValue?, rangeLow?, rangeHigh?)
 *
 * Defaults: lowValue=0, highValue=1, rangeLow=40, rangeHigh=70 (MIDI). The
 * chord's tones are laid out ascending across [rangeLow, rangeHigh] and the
 * value (clamped to [lowValue, highValue]) indexes into them — chord-tone
 * INDEXING, like GeoSonix. With no current chord (no imported harmony, or
 * playback ended with loop off) it degrades to a LINEAR map of the value
 * across [rangeLow, rangeHigh]. Returns a MIDI note number; returns 60
 * (middle C) as a last resort when called outside any callback.
 * @param {number} value
 * @param {number} [lowValue]
 * @param {number} [highValue]
 * @param {number} [rangeLow]
 * @param {number} [rangeHigh]
 * @returns {number}
 */
export function mapToHarmony(
    value,
    lowValue = MAP_TO_HARMONY_DEFAULTS.lowValue,
    highValue = MAP_TO_HARMONY_DEFAULTS.highValue,
    rangeLow = MAP_TO_HARMONY_DEFAULTS.rangeLow,
    rangeHigh = MAP_TO_HARMONY_DEFAULTS.rangeHigh,
) {
    const v = (typeof value === "number" && Number.isFinite(value)) ? value : 0;
    const chord = currentHarmony ? currentHarmony.chord : null;
    const key = currentHarmony ? currentHarmony.key : null;
    return mapToHarmonyCore(chord, key, v, lowValue, highValue, rangeLow, rangeHigh);
}

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

/**
 * Bare agc — forwards to the firing object's agc (automatic gain
 * control, design/agc.md), present on every context that carries a
 * `col`. The whole-image range is object-independent, so the bare form
 * needs no path to resolve — only the value comes from the ambient
 * context, exactly like bare playNote. Outside a callback, or in a
 * context kind without the method, returns undefined (a safe no-op).
 * @param {...any} args  (channel, lo?, hi?)
 * @returns {number | undefined}
 */
export function agc(...args) {
    if (current !== null && typeof current.agc === "function") {
        return current.agc(...args);
    }
    return undefined;
}
