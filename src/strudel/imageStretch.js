/**
 * Baked image signal stretching (design/agc.md).
 *
 * Instead of computing a gain at agc() call time, the colour signals
 * are stretched ONCE when an image loads: a per-pixel stretched OKLCh
 * buffer is computed from the raw buffer, and the ten this.col.*
 * signals derive from it via the same imageSignalsFromOKLCh path. A
 * script then reads this.col.r (already ~0..1) with no per-call gain.
 *
 * Two stretches, both deterministic (a pure function of the buffer and
 * the module constants below — no Date, no Math.random — so every
 * rerun produces the identical buffer and the colour→note mapping is
 * frozen before the first note):
 *
 *  - L (lightness): linear percentile. The 5th–95th percentile
 *    [Llo, Lhi] of the subsample maps to [0, 1]; this always yields a
 *    lightness range, even on a grey image.
 *  - a, b (the OKLab opponent axes): independent, symmetric,
 *    gain-CAPPED. gainA = min(GAIN_CAP, N / p95(|a|)); a' = a·gainA,
 *    likewise for b. Scaling about 0 keeps the axis balanced (no
 *    whole-image hue shift); independent a/b gains deform the (a, b)
 *    cloud, which spreads hue as well as boosting chroma. GAIN_CAP is
 *    the chroma weighting: a colourful image has p95(|a|) ≈ N so the
 *    gain is ≈ 1 (no over-stretch); a near-grey image has tiny
 *    p95(|a|) which would call for a huge gain — the cap holds it down
 *    so grey stays grey rather than amplifying chroma noise.
 *
 * chroma C' falls out of hypot(a', b') automatically; there is no
 * separate C stretch. a' and b' are deliberately NOT clamped here:
 * the signal layer (imageSignalsFromOKLCh) already clamps to ±N when
 * forming pxR.., so leaving the raw stretched value keeps chroma and
 * the diagonal hue intermediates mutually consistent.
 *
 * This module is intentionally free of canvas / CDN / DOM
 * dependencies so it unit-tests under `node --test`
 * (test/imageStretch.test.mjs). The canvas wires it in on setImage
 * (src/canvasRender.js); agc() is demoted to thin sugar over the
 * already-stretched 0..1 signal (src/simulation.js).
 */

// @ts-check

/**
 * Primary normaliser for the OKLab a/b projections, mirrored from
 * src/strudel/signals.js (PRIMARY_NORMALIZER). The stretch targets the
 * a/b p95 at this value so a fully-stretched colourful axis lands the
 * signal layer's pxR.. near 1.0 — the two constants MUST agree, so the
 * dependency is documented here rather than re-derived. If signals.js
 * changes PRIMARY_NORMALIZER, change this to match (kept as a separate
 * literal because signals.js is not importable in the pure node --test
 * context — it pulls in firingContext/debugTap which touch window).
 */
const PRIMARY_NORMALIZER = 0.3;

/**
 * Per-axis chroma-weighting cap on the a/b stretch gain. A colourful
 * axis (p95(|a|) ≈ N) gets gain ≈ 1; a near-grey axis would call for a
 * huge gain that this cap holds down, so grey stays grey instead of
 * the stretch manufacturing hue out of low-chroma noise. 4.0 lets a
 * moderately muted image (p95 down to N/4 ≈ 0.075) reach the full
 * range while still capping a near-flat axis. You cannot manufacture
 * colour range from an image that has none; lightness still carries
 * range regardless.
 */
const GAIN_CAP = 4.0;

/** Subsample budget: at most this many pixels feed the percentiles. */
const STRETCH_MAX_SAMPLES = 10000;

/** Percentile cuts (5th / 95th), shared convention with agc/design. */
const AGC_LOW_PCT = 0.05;
const AGC_HIGH_PCT = 0.95;

/**
 * Flatness epsilon for the L span. A subsample whose [Llo, Lhi] is
 * narrower than this is treated as flat (a uniform-lightness image):
 * applyStretch maps every L to 0.5 rather than dividing by a near-zero
 * span.
 */
const STRETCH_FLAT_EPSILON = 1e-6;

/**
 * Compute the trimmed [min, max] of an array of values: sort ascending
 * and take the 5th and 95th percentile by index so a few outlier
 * pixels cannot blow the result out. Deterministic (a pure function of
 * the values). An empty / non-array input yields null.
 *
 * Moved here from simulation.js: the percentile is now used by the
 * image bake, not by the runtime agc() call.
 *
 * @param {number[]} values
 * @returns {{min: number, max: number} | null}
 */
export function agcPercentileRange(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const loIdx = Math.min(n - 1, Math.max(0, Math.floor(AGC_LOW_PCT * (n - 1))));
    const hiIdx = Math.min(n - 1, Math.max(0, Math.ceil(AGC_HIGH_PCT * (n - 1))));
    return { min: sorted[loIdx], max: sorted[hiIdx] };
}

/**
 * @typedef {Object} StretchParams
 * @property {number} Llo   5th-percentile lightness (maps to 0).
 * @property {number} Lhi   95th-percentile lightness (maps to 1).
 * @property {number} gainA Multiplier applied to the OKLab a axis.
 * @property {number} gainB Multiplier applied to the OKLab b axis.
 */

/**
 * Compute the per-image stretch parameters from a raw OKLCh buffer
 * (Float32Array, 4 channels/pixel: L, C, a, b, row-major — exactly
 * what buildOKLChBuffer produces).
 *
 * Deterministic: a fixed stride (derived from the buffer length, so at
 * most STRETCH_MAX_SAMPLES pixels) subsamples the buffer; no clock, no
 * randomness, so the same buffer always yields the same params.
 *
 *  - L: agcPercentileRange of the sampled L values → [Llo, Lhi].
 *  - a, b: pa = p95(|a|), pb = p95(|b|) over the subsample;
 *    gain = min(GAIN_CAP, N / p). A degenerate axis (p ≈ 0, i.e. the
 *    axis is entirely flat at zero) yields gain = GAIN_CAP — the same
 *    value a near-grey-but-nonzero axis approaches — so a flat axis
 *    behaves continuously with an almost-flat one and never produces a
 *    NaN/Inf gain. Since a flat axis has a ≡ 0, any finite gain leaves
 *    a' = 0, so the choice of GAIN_CAP vs 1 is immaterial to the
 *    output; GAIN_CAP is chosen for that continuity.
 *
 * An empty / non-array buffer yields identity-ish params (Llo 0, Lhi 1,
 * gains 1) so a missing image degrades cleanly rather than throwing.
 *
 * @param {ArrayLike<number> | null | undefined} oklchBuffer
 * @returns {StretchParams}
 */
export function computeStretchParams(oklchBuffer) {
    const len = (oklchBuffer && typeof oklchBuffer.length === "number")
        ? oklchBuffer.length
        : 0;
    const pixelCount = Math.floor(len / 4);
    if (!(pixelCount > 0)) {
        return { Llo: 0, Lhi: 1, gainA: 1, gainB: 1 };
    }
    // Deterministic fixed stride: every `stride`-th pixel, so at most
    // ~STRETCH_MAX_SAMPLES samples regardless of image size.
    const stride = Math.max(1, Math.ceil(pixelCount / STRETCH_MAX_SAMPLES));
    /** @type {number[]} */
    const lVals = [];
    /** @type {number[]} */
    const absA = [];
    /** @type {number[]} */
    const absB = [];
    for (let p = 0; p < pixelCount; p += stride) {
        const idx = p * 4;
        const L = oklchBuffer[idx];
        const a = oklchBuffer[idx + 2];
        const b = oklchBuffer[idx + 3];
        if (!Number.isFinite(L)) continue;
        lVals.push(L);
        if (Number.isFinite(a)) absA.push(Math.abs(a));
        if (Number.isFinite(b)) absB.push(Math.abs(b));
    }
    const lRange = agcPercentileRange(lVals);
    const Llo = lRange !== null ? lRange.min : 0;
    const Lhi = lRange !== null ? lRange.max : 1;
    return {
        Llo,
        Lhi,
        gainA: gainFromAbs(absA),
        gainB: gainFromAbs(absB),
    };
}

/**
 * Gain for one chromatic axis from its sampled |value| array: the p95
 * is the axis's representative chroma magnitude, and the gain stretches
 * that toward N, capped at GAIN_CAP. A flat axis (p95 ≈ 0, or no usable
 * samples) returns GAIN_CAP — see computeStretchParams for why that is
 * the safe, continuous, NaN-free choice.
 * @param {number[]} absVals
 * @returns {number}
 */
function gainFromAbs(absVals) {
    const range = agcPercentileRange(absVals);
    if (range === null) return GAIN_CAP;
    const p95 = range.max;
    if (!(p95 > STRETCH_FLAT_EPSILON)) return GAIN_CAP;
    return Math.min(GAIN_CAP, PRIMARY_NORMALIZER / p95);
}

/**
 * Apply stretch params to a raw OKLCh buffer, returning a NEW
 * Float32Array of the same length and layout (L, C, a, b per pixel):
 *
 *   L' = clamp((L − Llo) / (Lhi − Llo), 0, 1)   (Lhi ≈ Llo → 0.5)
 *   a' = a · gainA
 *   b' = b · gainB
 *   C' = hypot(a', b')
 *
 * a' and b' are NOT clamped (the signal layer clamps to ±N when it
 * forms pxR.., so the raw stretched value keeps chroma and the
 * diagonals consistent). Pure: depends only on the input buffer and
 * the params, so identical inputs give an identical output.
 *
 * @param {Float32Array} oklchBuffer  Raw L,C,a,b buffer.
 * @param {StretchParams} params
 * @returns {Float32Array}  New stretched L,C,a,b buffer.
 */
export function applyStretch(oklchBuffer, params) {
    const out = new Float32Array(oklchBuffer.length);
    const { Llo, gainA, gainB } = params;
    const Lspan = params.Lhi - Llo;
    const lFlat = !(Lspan > STRETCH_FLAT_EPSILON);
    const pixelCount = Math.floor(oklchBuffer.length / 4);
    for (let p = 0; p < pixelCount; p++) {
        const idx = p * 4;
        const L = oklchBuffer[idx];
        const a = oklchBuffer[idx + 2];
        const b = oklchBuffer[idx + 3];
        let Lp;
        if (lFlat) {
            Lp = 0.5;
        } else {
            Lp = (L - Llo) / Lspan;
            if (Lp < 0) Lp = 0;
            else if (Lp > 1) Lp = 1;
        }
        const ap = a * gainA;
        const bp = b * gainB;
        out[idx] = Lp;
        out[idx + 1] = Math.hypot(ap, bp);
        out[idx + 2] = ap;
        out[idx + 3] = bp;
    }
    return out;
}

// Exposed for tests / documentation of the chroma-weighting cap.
export const _STRETCH_CONSTANTS = {
    PRIMARY_NORMALIZER,
    GAIN_CAP,
    STRETCH_MAX_SAMPLES,
    AGC_LOW_PCT,
    AGC_HIGH_PCT,
};
