// @ts-check

/**
 * Per-note debug tap `p()` for the Code tab.
 *
 * `p(pattern, label?)` wraps any pattern-valued sub-expression
 * (a signal, a sub-pattern) and returns an equivalent pattern
 * whose output values are unchanged — the surrounding pattern
 * behaves identically — while side-effect-logging the value it
 * produced for each note to the in-app message area (which Chris
 * reads, not the browser console). Used like:
 *
 *   n(p(mapClip(pxLt, 0.08, 0.6, 0, 7), "pitch"))
 *     .scale("C4:major pentatonic")
 *     .gain(p(pxChr.range(0.4, 1.0), "gain"))
 *
 * ONE line per note, not one line per tap. Several p() feeding
 * the same note print together on that note's single line, each
 * value preceded by its label, e.g. `pitch=0.420 gain=0.710`.
 * This is achieved by buffering: each p() records {label, value}
 * into a per-note buffer, and the firing engine flushes the
 * buffer as one line right after it dispatches each note (in the
 * Pass-2 path of FiringEngine.tick), then clears it. This
 * deliberately couples the tap to the engine — a standalone
 * wrapper could only print per query, scattered — which is
 * acceptable for a GXW-only debug tool.
 *
 * In-context only. p records nothing during the firing engine's
 * no-context Pass 1 (where every dynamic signal reads 0): the
 * recorder checks the active firing context and skips when there
 * is none. So the always-zero pass never logs, and a tap on a
 * pattern that did not feed a given note never appears on that
 * note's line.
 *
 * Rate-capped for accessibility: even at one line per note a
 * fast pattern can outrun Speak Selection, so the flush drops
 * any line that arrives within the cap interval rather than
 * queueing it (see MAX_TAP_LINES_PER_SECOND).
 */

import { getFiringContext } from "./firingContext.js";

/**
 * Hard cap on debug-tap lines emitted to the message area, in
 * lines per second. Overflow is DROPPED, not queued, so a fast
 * pattern cannot flood the message area or outrun Speak
 * Selection. The single knob to tune the tap's verbosity.
 */
const MAX_TAP_LINES_PER_SECOND = 4;

/** Minimum wall-clock gap between emitted lines, in ms. */
const MIN_EMIT_INTERVAL_MS = 1000 / MAX_TAP_LINES_PER_SECOND;

/**
 * Per-note buffer of {label, value} pairs recorded by p() while
 * the current note is being generated. Filled during the
 * engine's Pass-2 re-query (firing context active) and drained
 * by flushNoteTaps after the note dispatches.
 * @type {Array<{label: string, value: any}>}
 */
let _buffer = [];

/** Timestamp (performance.now) of the last emitted line, for the rate cap. */
let _lastEmitMs = -Infinity;

/**
 * Record one tapped value for the note currently being
 * generated. No-op unless a firing context is active, so the
 * no-context Pass 1 never logs. Defensive: never throws into the
 * pattern-query hot path.
 * @param {string} label
 * @param {any} value
 */
export function recordTap(label, value) {
    try {
        if (getFiringContext() === null) return;
        _buffer.push({ label, value });
    } catch (_err) {
        // Never let a debug tap disturb audio generation.
    }
}

/**
 * Drop the current note's buffered taps WITHOUT emitting a line.
 * Used by the firing engine when it suppresses a note (e.g. the
 * seam tail-suppression guard) so the suppressed note neither logs
 * nor leaks its taps onto the next note's flushed line.
 */
export function clearNoteTaps() {
    _buffer = [];
}

/**
 * Format one tapped value compactly for reading aloud: numbers
 * to ~3 decimals, control objects to `key=val key=val`, strings
 * as-is, everything else via String().
 * @param {any} value
 * @returns {string}
 */
function formatValue(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value.toFixed(3) : String(value);
    }
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object") {
        const parts = [];
        for (const k of Object.keys(value)) {
            const v = value[k];
            parts.push(k + "=" + (typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : String(v)));
        }
        return "{" + parts.join(" ") + "}";
    }
    return String(value);
}

/**
 * Flush the current note's buffered taps as one line to the
 * message area, then clear the buffer for the next note. Called
 * by the firing engine right after it dispatches each note.
 *
 * The buffer is always cleared (so each note's line carries only
 * its own taps), but the WRITE is rate-capped: a line arriving
 * within MIN_EMIT_INTERVAL_MS of the previous one is dropped.
 * Writes via window.gxwMessages (the in-app message area),
 * falling back to console.log when it is absent. Never throws.
 */
export function flushNoteTaps() {
    try {
        if (_buffer.length === 0) return;
        const line = _buffer.map((t) => t.label + "=" + formatValue(t.value)).join(" ");
        _buffer = [];

        const now = (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        if (now - _lastEmitMs < MIN_EMIT_INTERVAL_MS) {
            // Overflow: drop this line rather than queue it.
            return;
        }
        _lastEmitMs = now;

        /** @type {any} */
        const win = typeof window !== "undefined" ? window : undefined;
        if (win && win.gxwMessages && typeof win.gxwMessages.write === "function") {
            win.gxwMessages.write(line, "info");
        } else {
            console.log("[p] " + line);
        }
    } catch (_err) {
        _buffer = [];
    }
}

/**
 * The debug tap itself. Returns a pass-through pattern that
 * records each output value under `label` and returns it
 * unchanged. Preserves the wrapped pattern's structure via
 * fmap (the same value-mapping hook Strudel's own .log() uses).
 * A bare (non-pattern) value is reified first when possible so
 * the tap still fires per note in context; failing that it is
 * recorded once and returned as-is.
 *
 * @param {any} arg          A strudel Pattern, or a bare value.
 * @param {string} [label]   Label printed before the value.
 * @returns {any}
 */
export function p(arg, label = "tap") {
    if (arg !== null && arg !== undefined && typeof arg.fmap === "function") {
        return arg.fmap((/** @type {any} */ v) => {
            recordTap(label, v);
            return v;
        });
    }
    /** @type {any} */
    const win = typeof window !== "undefined" ? window : undefined;
    if (win && typeof win.reify === "function") {
        const pat = win.reify(arg);
        if (pat !== null && pat !== undefined && typeof pat.fmap === "function") {
            return pat.fmap((/** @type {any} */ v) => {
                recordTap(label, v);
                return v;
            });
        }
    }
    // Last resort: a bare value with no reify available. Record
    // now (may be out of context, in which case recordTap skips)
    // and return unchanged so the surrounding code still works.
    recordTap(label, arg);
    return arg;
}

/**
 * Install p() as a bare global so Code-tab patterns can use it
 * with no import, alongside the image signals and mapClip. Name
 * check: if `p` is already taken on window (an existing Strudel
 * global), install under `tap` instead so we never shadow it.
 * Returns the name that shipped, and logs it so it is
 * discoverable.
 * @returns {string}
 */
export function installDebugTap() {
    /** @type {any} */
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) return "p";
    const name = (typeof win.p === "undefined") ? "p" : "tap";
    win[name] = p;
    console.log(`[debugTap] per-note debug tap installed as ${name}()` +
        (name === "tap" ? " (p was already taken on window)" : ""));
    return name;
}
