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
 *   Four opponent-axis primaries. Each is one of OKLab's a / b
 *   axes PERCENTILE-STRETCHED across the image to [0, 1] at
 *   load (imageStretch.js) — so the image's whole colour spread
 *   fills the range — read CONTINUOUSLY, NOT half-wave
 *   rectified. The value is "how far toward this colour", with
 *   neutral grey at 0.5. Opposite directions are the two ends
 *   of one axis, so opposite pairs are exact inverses
 *   (pxG = 1 − pxR, pxB = 1 − pxY):
 *     pxR    redness    (greenest pixel→0, grey→0.5, reddest→1)
 *     pxG    greenness  (1 − pxR)
 *     pxY    yellowness (the b axis, likewise)
 *     pxB    blueness   (1 − pxY)
 *
 *   Four hue intermediates, the symmetric mean of the two
 *   adjacent primaries (also inverse pairs, pxCy = 1 − pxOr,
 *   pxPu = 1 − pxLi), all in [0, 1]:
 *     pxOr   orange = (red + yellow)/2
 *     pxLi   lime   = (green + yellow)/2
 *     pxCy   cyan   (1 − pxOr)
 *     pxPu   purple (1 − pxLi)
 *
 *   The continuous (un-rectified) mapping is deliberate: a
 *   half-wave-clamped channel sits dead at zero across a whole
 *   colour region — discontinuous and unpredictable as a
 *   control input. Every channel here varies smoothly over the
 *   image instead, always within [0, 1].
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
 * range. All ten signals here are already in [0, 1]: the
 * normalisation happens ONCE at image load, where each of
 * OKLab's L, a, b, and C axes is percentile-stretched across
 * the whole image to fill [0, 1] (src/strudel/imageStretch.js).
 * imageSignalsFromOKLCh then reads the stretched a as redness,
 * b as yellowness, C as colourfulness, derives greenness /
 * blueness as their inverses, and the hue diagonals as means
 * of adjacent primaries — no per-read divide or magic
 * normaliser, just clamp01 against floating-point drift. A
 * single authored colour (this.color.*) has no image to
 * percentile against, so colorSignalsFromHex maps its raw
 * OKLab axes to the same [0, 1] inputs with a fixed magnitude
 * scale before calling in (see src/simulation.js).
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
 * product, projection, hue-distance all give different
 * curves), and picking the formula for the composer is
 * exactly what the standard library is for. The chosen
 * formula here is the symmetric MEAN of the two adjacent
 * primaries (orange = (redness + yellowness)/2, and so on),
 * which keeps every intermediate continuously in [0, 1],
 * makes the opposite pairs exact inverses (cyan = 1 −
 * orange, purple = 1 − lime), and is trivial to reason
 * about. Once defineSignal lands and strudel algebra on
 * dynamic signals is verified, the intermediates may migrate
 * from the standard library to a curated recipe collection.
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
import { installDebugTap } from "./debugTap.js";

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

/**
 * @typedef {Object} ImageSignalValues
 * @property {number} pxLt @property {number} pxChr
 * @property {number} pxR @property {number} pxG
 * @property {number} pxY @property {number} pxB
 * @property {number} pxOr @property {number} pxLi
 * @property {number} pxCy @property {number} pxPu
 */

/**
 * Derive all ten image-colour signal values from one OKLCh
 * sample. This is the single source of truth for the
 * projection-and-normalisation math: the pattern-signal
 * read functions below call it, and the simulation's onTick
 * context calls it directly with a sample taken at the
 * sprite's live sub-step position (see simulation.js). Both
 * surfaces therefore produce identical numbers for the same
 * pixel, which is the whole point of sharing one function —
 * a composer's pxR in a pattern and ctx.pxR in an onTick
 * read the same colour the same way.
 *
 * A null or undefined sample (no firing context, no image,
 * or a position outside the canvas region) yields zero for
 * every signal, matching the documented no-data default.
 *
 * @param {{L: number, C: number, a: number, b: number} | null | undefined} o
 * @returns {ImageSignalValues}
 */
export function imageSignalsFromOKLCh(o) {
    if (o === null || o === undefined) {
        return {
            pxLt: 0, pxChr: 0, pxR: 0, pxG: 0, pxY: 0,
            pxB: 0, pxOr: 0, pxLi: 0, pxCy: 0, pxPu: 0,
        };
    }
    // o.L / o.C / o.a / o.b arrive ALREADY percentile-stretched to [0, 1] at
    // image load (src/strudel/imageStretch.js), each axis banded across the
    // image so the full 0..1 range is used for any image: o.a is REDNESS
    // (0 greenest … 0.5 grey … 1 reddest), o.b is YELLOWNESS, o.C is
    // COLOURFULNESS, o.L lightness. A primary IS its stretched axis; a hue
    // diagonal is the symmetric mean of its two adjacent primaries; opposite
    // directions are exact inverses. Everything lands in [0, 1] by construction —
    // continuous, never half-wave-clamped to a dead zero (a near-grey image just
    // holds every hue channel near 0.5).
    const r = clamp01(o.a);
    const y = clamp01(o.b);
    const or = clamp01((r + y) / 2);          // orange = red + yellow
    const li = clamp01(((1 - r) + y) / 2);    // lime = green + yellow
    return {
        pxLt: clamp01(o.L),
        pxChr: clamp01(o.C),
        pxR: r, pxG: 1 - r,
        pxY: y, pxB: 1 - y,
        pxOr: or, pxCy: 1 - or,
        pxLi: li, pxPu: 1 - li,
    };
}

// The ten pattern-signal read functions delegate to the
// shared derivation so they can never drift from the onTick
// context's reads. Each recomputes the full set and picks
// its field; the extra arithmetic is a handful of multiplies
// per Pass 2 query, negligible beside queryArc itself.

/** Perceptual lightness (OKLCh L), in [0, 1] naturally. */
function readPxLt() { return imageSignalsFromOKLCh(readImageOKLCh()).pxLt; }

/** Perceptual chroma (OKLCh C, hypot of a and b), normalised. */
function readPxChr() { return imageSignalsFromOKLCh(readImageOKLCh()).pxChr; }

/** Redness: stretched a axis, continuous (grey 0.5, reddest 1). */
function readPxR() { return imageSignalsFromOKLCh(readImageOKLCh()).pxR; }

/** Greenness: inverse of redness (1 − pxR). */
function readPxG() { return imageSignalsFromOKLCh(readImageOKLCh()).pxG; }

/** Yellowness: stretched b axis, continuous (grey 0.5, yellowest 1). */
function readPxY() { return imageSignalsFromOKLCh(readImageOKLCh()).pxY; }

/** Blueness: inverse of yellowness (1 − pxY). */
function readPxB() { return imageSignalsFromOKLCh(readImageOKLCh()).pxB; }

/** Orange: mean of redness and yellowness, in [0, 1]. */
function readPxOr() { return imageSignalsFromOKLCh(readImageOKLCh()).pxOr; }

/** Lime: mean of greenness and yellowness, in [0, 1]. */
function readPxLi() { return imageSignalsFromOKLCh(readImageOKLCh()).pxLi; }

/** Cyan: inverse of orange (1 − pxOr). */
function readPxCy() { return imageSignalsFromOKLCh(readImageOKLCh()).pxCy; }

/** Purple: inverse of lime (1 − pxLi). */
function readPxPu() { return imageSignalsFromOKLCh(readImageOKLCh()).pxPu; }

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
 * Clamp-then-linear-remap transform. Given a source signal
 * Pattern emitting a numeric value per hap, mapClip returns
 * a new Pattern whose value is the source clipped to
 * [inLo, inHi] and then linearly remapped to [outLo, outHi].
 * Values at or below inLo produce outLo; at or above inHi
 * produce outHi; in between, scale linearly.
 *
 * Composes with any Pattern emitting numeric hap values:
 * the px image-colour signals above, strudel's builtin
 * sine / saw / perlin, or any future GXW transform helper.
 * The typical use is to stretch the sub-range where an
 * image's tonality actually lives onto a musically useful
 * output range, with the clip ends preventing an unexpectedly
 * bright or dark pixel from blowing past the intended range.
 * For example:
 *
 *   note(mapClip(pxLt, 0.6, 0.8, 60, 72).struct("1 1 1 1"))
 *
 * fires four notes per cycle whose MIDI value is pxLt's
 * lightness sampled at firing time, remapped from the 0.6 -
 * 0.8 input band onto 60 - 72 (C4 to C5), clipping outside
 * the band. The `.struct(...)` call is strudel's idiom for
 * overlaying a rhythmic structure onto a continuous signal
 * Pattern — the mini-notation string sets when events fire,
 * the signal provides each event's value. Replace "1 1 1 1"
 * with any strudel rhythm pattern (e.g. `"1 ~ 1 1"` for a
 * rest on beat two, `"1 1*2 1 1"` for a doubled second beat)
 * to vary the rhythm independently of the pitch mapping.
 *
 * Implementation. Built as a strudel signal(fn) Pattern whose
 * fn re-queries the source Pattern at the requested time and
 * applies the clip-and-remap math in plain JS. The re-query
 * path rather than a Pattern-method chain (.fmap / .sub /
 * .mul / .range) keeps mapClip independent of which transform
 * operators the loaded strudel build happens to expose. The
 * downstream cost is that the new Pattern carries minimal
 * structure (one hap per query, value computed on the fly),
 * which is the right shape for the GXW signals it most
 * commonly wraps — those signals are themselves structure-
 * light signal(fn) patterns.
 *
 * Edge cases. inLo equal to inHi (degenerate input range)
 * returns the midpoint of outLo and outHi instead of dividing
 * by zero. A source queryArc that throws, returns no haps, or
 * emits a non-numeric value falls back to a sampled input of
 * 0, which after clipping and remapping produces outLo —
 * matching the no-data behaviour of the px signals themselves.
 *
 * @param {any} sig    Source strudel Pattern (numeric-valued).
 * @param {number} inLo
 * @param {number} inHi
 * @param {number} outLo
 * @param {number} outHi
 * @returns {any}  A new strudel Pattern.
 */
function mapClip(sig, inLo, inHi, outLo, outHi) {
    /** @type {any} */
    const win = window;
    /** @type {any} */
    const signalFn = win.signal;
    if (typeof signalFn !== "function") {
        console.warn(
            "[signals] mapClip called before strudel runtime is ready; " +
            "returning source pattern unchanged.",
        );
        return sig;
    }
    const inSpan = inHi - inLo;
    return signalFn((/** @type {number} */ t) => {
        // Re-query the source pattern around time t to get its
        // current value. epsilon is small enough not to span
        // multiple cycles for any reasonable signal, large
        // enough to avoid empty-range edge cases in strudel's
        // hap-matching logic.
        const epsilon = 1e-6;
        let v = 0;
        try {
            const haps = sig.queryArc(t, t + epsilon);
            if (Array.isArray(haps) && haps.length > 0) {
                const hv = haps[0].value;
                if (typeof hv === "number" && Number.isFinite(hv)) {
                    v = hv;
                }
            }
        } catch (err) {
            // Defensive: a source queryArc throw shouldn't
            // tear down the firing engine. v stays 0, which
            // after clipping and remapping produces outLo.
            v = 0;
        }
        if (inSpan === 0) {
            return (outLo + outHi) / 2;
        }
        const clipped = v < inLo ? inLo : v > inHi ? inHi : v;
        const normalized = (clipped - inLo) / inSpan;
        return outLo + normalized * (outHi - outLo);
    });
}

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
    // Install transform helpers alongside the signals. mapClip
    // is the first of a family of clamp / scale / remap
    // utilities (more will land as Chris ports the GeoSonix
    // toolkit). Patterns can reference these as bare names the
    // same way they reference pxLt and the other signals.
    win.mapClip = mapClip;
    console.log("[signals] mapClip transform helper installed");

    // Install the per-note debug tap p() (or tap() if p is
    // taken) as a bare global too, so Code-tab patterns can wrap
    // any sub-expression to watch its per-note value in the
    // message area. See src/strudel/debugTap.js.
    installDebugTap();
}
