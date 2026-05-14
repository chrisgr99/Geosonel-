/**
 * Dynamic-signal definitions (Tier 2 Phase 4).
 *
 * Each signal in this module is a strudel Pattern whose
 * queryArc reads the firing-context pointer (set by the
 * firing engine's commit walker before Pass 2 refresh)
 * and returns a value sampled from the current per-tick
 * snapshot of scene state. Composers compose these
 * signals into mini-notation patterns through the chained
 * operator API exactly the same way they would compose
 * strudel's built-in signals (sine, perlin, and friends):
 *
 *   note("c4 e4 g4 c5").gain(pxLt.range(0.2, 1.0))
 *
 * fires four notes per cycle, each with gain modulated by
 * the OKLCh lightness at the firing source's canvas
 * position at near-audio-time. As a sprite moves over
 * varying lightness regions, the gain modulates with it.
 *
 * Names are short (two to four characters after the px
 * prefix) so they fit comfortably inside a pattern
 * expression without crowding out the musical content.
 * The px prefix reads as "pixel" and groups the six image-
 * colour signals together at autocomplete time. The first
 * letter after px is uppercase, the rest lowercase, so
 * the signal names are visually consistent regardless of
 * length: pxLt, pxChr, pxR, pxG, pxB, pxY.
 *
 * For Phase 4's first commit only pxLt lands; the rest of
 * the OKLCh-derived signal set (pxChr, pxR, pxG, pxB, pxY)
 * follows in close succession since each is a trivial
 * wrapper once the precomputed OKLCh buffer in canvas.js
 * and the firing-context-pointer plumbing are in place.
 *
 * Strudel's signal(fn) factory takes a function of cycle
 * time and produces a Pattern that emits one Hap per query
 * with value = fn(midpoint). For our dynamic signals the
 * fn ignores the time argument and instead reads the
 * firing context. This is exactly the pattern strudel's
 * own time-varying signals use; the only difference is
 * the function's data source.
 *
 * Registration is deferred until the strudel runtime
 * finishes loading. installImageSignals reads
 * window.signal (installed by initStrudel) and constructs
 * the Pattern objects, then installs them as window
 * globals so cycle-function bodies can reference them as
 * bare names. main.js calls installImageSignals on the
 * runtime's "loaded" status transition, before the
 * pattern-reparse paths fire, so patterns referencing
 * pxLt parse correctly once the engine is up.
 */

// @ts-check

import { getFiringContext } from "./firingContext.js";

/**
 * The compiled Pattern for pxLt (OKLCh perceptual
 * lightness), populated by installImageSignals. Module-
 * level so a single Pattern instance is shared across all
 * references; null before registration so an early access
 * path can detect the "engine not loaded yet" state.
 * @type {any | null}
 */
let pxLtPattern = null;

/**
 * Read the pxLt value for the currently-firing source from
 * the active firing context. Returns 0 when no context is
 * active (the typical reason: a queryArc call outside the
 * firing engine's Pass 2 dispatcher, such as marker-
 * position parsing at scene load), when the firing source
 * has no current position in the snapshot (briefly possible
 * during scene reload), or when no image is loaded
 * (imageOKLCh is null). Zero is the chosen no-data default
 * because it maps cleanly through .range(lo, hi) to the
 * low end of the destination range, which is a sensible
 * musical default (quiet, low pitch, or neutral value
 * depending on the operator the composer reaches for).
 *
 * @returns {number}
 */
function readPxLt() {
    const ctx = getFiringContext();
    if (ctx === null) return 0;
    const entry = ctx.snapshot.sources.get(ctx.sourceId);
    if (entry === undefined) return 0;
    if (entry.imageOKLCh === null || entry.imageOKLCh === undefined) return 0;
    return entry.imageOKLCh.L;
}

/**
 * Install the dynamic image-colour signals as window
 * globals so cycle-function patterns can reference them
 * as bare names. Called from main.js after the strudel
 * runtime transitions to "loaded" status — strudel's
 * signal factory and other Pattern-building globals are
 * installed by initStrudel and are not available until
 * loaded.
 *
 * No-op (after a one-time console.warn) when the signal
 * factory cannot be found on window — typically an older
 * strudel version that doesn't expose it as a global, or
 * a future @strudel/web layout that hides it behind a
 * different name. The engine's other startup paths
 * surface their own diagnostics; we just warn and leave
 * the signals unbound. Patterns using pxLt would then
 * fail to parse with a clear ReferenceError rather than
 * silently emitting 0 forever.
 */
export function installImageSignals() {
    /** @type {any} */
    const signalFn = /** @type {any} */ (window).signal;
    if (typeof signalFn !== "function") {
        console.warn(
            "[signals] window.signal not found after engine load; " +
            "image-colour signals will be unavailable. Patterns " +
            "referencing pxLt will fail to parse.",
        );
        return;
    }
    // signal(fn) returns a Pattern. fn takes a time argument
    // (cycle position) and returns a value; for our dynamic
    // signal the time argument is unused since the value
    // depends on the firing context, not on cycle position.
    pxLtPattern = signalFn((_t) => readPxLt());
    /** @type {any} */ (window).pxLt = pxLtPattern;
    console.log("[signals] pxLt installed");
}
