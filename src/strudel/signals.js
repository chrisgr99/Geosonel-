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
 * position at near-audio-time. As the source moves over
 * varying lightness regions, the gain modulates with it.
 *
 * The standard image-colour set is ten signals.
 *
 *   Scalars derived directly from OKLCh:
 *     pxLt   perceptual lightness (the L of OKLCh), [0, 1]
 *     pxChr  perceptual chroma / saturation, the hypot of
 *            (a, b), normalised to [0, 1]
 *
 *   Four opponent-axis primaries, projecting onto OKLab's
 *   (a, b) axes and clamped to the named-positive direction
 *   (each is zero in the opposite-direction half of its
 *   axis, positive in its named half, normalised to [0, 1]):
 *     pxR    redness  (max(0, +a))
 *     pxG    greenness (max(0, -a))
 *     pxY    yellowness (max(0, +b))
 *     pxB    blueness  (max(0, -b))
 *
 *   Four hue intermediates, projecting onto the 45-degree-
 *   rotated diagonals between adjacent primaries and clamped
 *   to the named direction:
 *     pxOr   orange (between pxR and pxY)
 *     pxLi   lime   (between pxG and pxY)
 *     pxCy   cyan   (between pxG and pxB)
 *     pxPu   purple (between pxR and pxB)
 *
 * Naming convention. The px prefix reads as "pixel" and
 * groups the signals together at autocomplete time. After
 * the prefix, single-letter shorts mark the four
 * orthogonal opponent-axis primaries (pxR, pxG, pxY, pxB);
 * two-letter shorts mark the scalars (pxLt, pxChr) and the
 * hue intermediates (pxOr, pxLi, pxCy, pxPu). The first
 * letter after px is uppercase, the rest lowercase, so the
 * signal names read as consistent token shapes regardless
 * of their length. The letter-count distinction is
 * intentional: it tells the reader at a glance whether a
 * name is one of the four orthogonal primaries or
 * something else.
 *
 * Normalisation. Strudel signal conventions land in either
 * [0, 1] (saw, square) or [-1, 1] (sine, perlin) so that
 * .range(lo, hi) maps cleanly to a composer-chosen output
 * range. OKLab's a and b axes have natural sRGB magnitudes
 * up to roughly 0.3, so the primaries and intermediates
 * are divided by a uniform PRIMARY_NORMALIZER of 0.3 and
 * clamped to [0, 1]. The constant is documented at its
 * definition; the choice is "a generous upper bound on
 * OKLab axis magnitudes for sRGB colours, picked uniform
 * across the primaries and intermediates so a single magic
 * number documents the entire scheme." pxLt is not
 * normalised: OKLab's L is already in [0, 1] by definition.
 *
 * No-data default. Every signal returns 0 when no firing
 * context is active (the typical reason: a queryArc call
 * outside the firing engine's Pass 2 dispatcher, such as
 * marker-position parsing at scene load), when the firing
 * source has no current position in the snapshot (briefly
 * possible during scene reload), or when no image is
 * loaded (imageOKLCh is null). Zero maps cleanly through
 * .range(lo, hi) to the low end of the destination range,
 * which is a sensible musical default (quiet, low pitch,
 * or neutral value depending on the operator the composer
 * reaches for) and the only no-data choice that does not
 * require composers to read the documentation to
 * understand the fallback.
 *
 * Hue intermediates in the standard set, not deferred to
 * composer combination. The case for deferring them was:
 * orange is just pxR.add(pxY) and similar for the others,
 * so the composer can build them through strudel's
 * algebraic operators on Pattern objects. Two concerns
 * pushed against that path. First, strudel's .add, .mul,
 * etc. on dynamic signal() Patterns are not yet verified
 * to compose cleanly (a follow-up commit can check).
 * Second, orange does not have one right formula (min,
 * product, 45-degree projection, hue-distance, vector
 * projection all give different curves), and picking the
 * formula for the composer is exactly what the standard
 * library is for. The chosen formula here is the 45-degree
 * projection (orthogonal in OKLab between the adjacent
 * primaries), which is geometrically symmetric across the
 * four intermediates and easy to reason about. Once
 * defineSignal lands and strudel algebra on dynamic
 * signals is verified, the intermediates may migrate from
 * the standard library to a curated recipe collection.
 *
 * Strudel's signal(fn) factory takes a function of cycle
 * time and produces a Pattern that emits one Hap per query
 * with value = fn(midpoint). For our dynamic signals the
 * fn ignores the time argument and instead reads the
 * firing context. This is exactly the shape strudel's own
 * time-varying signals use; the only difference is the
 * function's data source (the firing snapshot vs cycle
 * position).
 *
 * Registration is deferred until the strudel runtime
 * finishes loading. installImageSignals reads window.signal
 * (installed by initStrudel) and constructs the Pattern
 * objects, then installs them as window globals so
 * cycle-function bodies can reference them as bare names.
 * main.js calls installImageSignals on the runtime's
 * "loaded" status transition, before the pattern-reparse
 * paths fire, so patterns referencing any of the ten
 * signals parse correctly once the engine is up.
 */

// @ts-check

import { getFiringContext } from "./firingContext.js";

/**
 * Uniform normaliser applied to OKLab a and b projections
 * (the four primaries and the four hue intermediates) so
 * their values land in roughly [0, 1] for compatibility
 * with strudel's signal conventions and clean .range()
 * mapping. The clamp01 step at every read caps the rare
 * case (pure blue's -b reaches about 0.312 in sRGB,
 * slightly above the normaliser) at 1.0.
 *
 * Reference sRGB extremes for orientation:
 *   pure red    (#ff0000):   +a is about 0.226
 *   pure green  (#00ff00):   -a is about 0.234
 *   pure yellow (#ffff00):   +b is about 0.198
 *   pure blue   (#0000ff):   -b is about 0.312
 *   diagonal extremes:           about 0.25
 *
 * 0.3 lands the typical extreme near 1.0 across all four
 * primary directions; pure blue clamps to exactly 1.0; the
 * other primaries reach roughly 0.65 to 0.78 at their pure
 * forms. The asymmetry is small enough that composers
 * adjust their .range() endpoints by ear in practice, which
 * is the natural workflow anyway.
 *
 * Not used by pxLt: OKLab's L is already in [0, 1] by
 * definition.
 */
const PRIMARY_NORMALIZER = 0.3;

/**
 * Reciprocal of sqrt(2), used by the four hue
 * intermediates to project (a, b) onto a unit-magnitude
 * 45-degree-rotated direction. Computed once at module
 * load rather than inline so each per-event projection is
 * one multiply rather than a divide.
 */
const INV_SQRT2 = 1 / Math.sqrt(2);

/**
 * Clamp v to [0, 1]. Inlined-style helper used by every
 * non-pxLt signal in the hot path of Pass 2 refresh.
 *
 * @param {number} v
 * @returns {number}
 */
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Look up the OKLCh entry for the currently-firing source
 * in the active firing context's snapshot, or return null
 * when any of the three no-data paths applies (no context,
 * no source entry, no image loaded so imageOKLCh is null).
 * Centralised so every per-signal read function shares the
 * same lookup and null-handling rather than repeating five
 * lines of guard ten times.
 *
 * @returns {{L: number, C: number, a: number, b: number} | null}
 */
function readImageOKLCh() {
    const ctx = getFiringContext();
    if (ctx === null) return null;
    const entry = ctx.snapshot.sources.get(ctx.sourceId);
    if (entry === undefined) return null;
    if (entry.imageOKLCh === null || entry.imageOKLCh === undefined) return null;
    return entry.imageOKLCh;
}

/** Perceptual lightness (OKLCh L), in [0, 1] naturally. */
function readPxLt() {
    const o = readImageOKLCh();
    return o === null ? 0 : o.L;
}

/** Perceptual chroma (OKLCh C, hypot of a and b), normalised. */
function readPxChr() {
    const o = readImageOKLCh();
    return o === null ? 0 : clamp01(o.C / PRIMARY_NORMALIZER);
}

/** Redness: positive +a clamped to the red half-axis. */
function readPxR() {
    const o = readImageOKLCh();
    if (o === null || o.a <= 0) return 0;
    return clamp01(o.a / PRIMARY_NORMALIZER);
}

/** Greenness: positive -a clamped to the green half-axis. */
function readPxG() {
    const o = readImageOKLCh();
    if (o === null || o.a >= 0) return 0;
    return clamp01(-o.a / PRIMARY_NORMALIZER);
}

/** Yellowness: positive +b clamped to the yellow half-axis. */
function readPxY() {
    const o = readImageOKLCh();
    if (o === null || o.b <= 0) return 0;
    return clamp01(o.b / PRIMARY_NORMALIZER);
}

/** Blueness: positive -b clamped to the blue half-axis. */
function readPxB() {
    const o = readImageOKLCh();
    if (o === null || o.b >= 0) return 0;
    return clamp01(-o.b / PRIMARY_NORMALIZER);
}

/**
 * Orange: projection along the +45-degree direction in
 * OKLab (a, b), the diagonal between +a (redness) and +b
 * (yellowness), clamped to the named-positive half-plane.
 * (a + b) divided by sqrt(2) is the dot product of (a, b)
 * with the unit vector pointing at hue 45 degrees.
 */
function readPxOr() {
    const o = readImageOKLCh();
    if (o === null) return 0;
    const proj = (o.a + o.b) * INV_SQRT2;
    return proj <= 0 ? 0 : clamp01(proj / PRIMARY_NORMALIZER);
}

/**
 * Lime: projection along the +135-degree direction, the
 * diagonal between -a (greenness) and +b (yellowness),
 * clamped to the named-positive half-plane.
 */
function readPxLi() {
    const o = readImageOKLCh();
    if (o === null) return 0;
    const proj = (-o.a + o.b) * INV_SQRT2;
    return proj <= 0 ? 0 : clamp01(proj / PRIMARY_NORMALIZER);
}

/**
 * Cyan: projection along the -135-degree (225-degree)
 * direction, the diagonal between -a (greenness) and -b
 * (blueness), clamped to the named-positive half-plane.
 */
function readPxCy() {
    const o = readImageOKLCh();
    if (o === null) return 0;
    const proj = (-o.a - o.b) * INV_SQRT2;
    return proj <= 0 ? 0 : clamp01(proj / PRIMARY_NORMALIZER);
}

/**
 * Purple: projection along the -45-degree (315-degree)
 * direction, the diagonal between +a (redness) and -b
 * (blueness), clamped to the named-positive half-plane.
 */
function readPxPu() {
    const o = readImageOKLCh();
    if (o === null) return 0;
    const proj = (o.a - o.b) * INV_SQRT2;
    return proj <= 0 ? 0 : clamp01(proj / PRIMARY_NORMALIZER);
}

/**
 * The standard image-colour signal set, paired with their
 * read functions. The order here is the order section 27
 * documents them in (scalars, then primaries, then hue
 * intermediates), so the console log on install reads as
 * a documented inventory rather than a random list.
 *
 * Data-driven registration keeps installImageSignals to a
 * single loop rather than ten parallel install lines, and
 * makes adding a new signal (when defineSignal or
 * additional standard signals land) a one-row addition.
 */
const IMAGE_SIGNALS = [
    { name: "pxLt", read: readPxLt },
    { name: "pxChr", read: readPxChr },
    { name: "pxR", read: readPxR },
    { name: "pxG", read: readPxG },
    { name: "pxY", read: readPxY },
    { name: "pxB", read: readPxB },
    { name: "pxOr", read: readPxOr },
    { name: "pxLi", read: readPxLi },
    { name: "pxCy", read: readPxCy },
    { name: "pxPu", read: readPxPu },
];

/**
 * Install all dynamic image-colour signals as window
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
 * the signals unbound. Patterns referencing any of the
 * ten signals would then fail to parse with a clear
 * ReferenceError rather than silently emitting 0 forever.
 */
export function installImageSignals() {
    /** @type {any} */
    const win = window;
    /** @type {any} */
    const signalFn = win.signal;
    if (typeof signalFn !== "function") {
        console.warn(
            "[signals] window.signal not found after engine load; " +
            "image-colour signals will be unavailable. Patterns " +
            "referencing pxLt or its OKLCh siblings will fail to parse.",
        );
        return;
    }
    // signal(fn) returns a Pattern. fn takes a time argument
    // (cycle position) and returns a value; for our dynamic
    // signals the time argument is unused since the value
    // depends on the firing context (and thus on the
    // snapshot of simulation state captured at tick top),
    // not on cycle position.
    for (const { name, read } of IMAGE_SIGNALS) {
        win[name] = signalFn((_t) => read());
    }
    console.log(
        "[signals] image-colour signals installed: " +
        IMAGE_SIGNALS.map((s) => s.name).join(", "),
    );
}
