/**
 * Baked image signal stretching (design/agc.md).
 *
 * The colour signals are normalised ONCE when an image loads, not at read
 * time: a per-pixel stretched buffer is computed from the raw OKLCh buffer, and
 * the ten this.col.* signals derive from it via imageSignalsFromOKLCh. A script
 * then reads this.col.r (already 0..1, continuous) with no per-call gain.
 *
 * Each of the four channels — L (lightness), a and b (the OKLab opponent axes),
 * and C (chroma) — is stretched INDEPENDENTLY by a 5th–95th percentile band
 * across the image, so the whole image's range of that property fills [0, 1]:
 *
 *   chan' = clamp((chan − lo) / (hi − lo), 0, 1)
 *
 * where [lo, hi] is the 5th/95th percentile of that channel over a deterministic
 * subsample (outliers beyond the band saturate to 0 or 1). signals.js then reads
 * a' as REDNESS (0 greenest … 0.5 grey … 1 reddest), b' as YELLOWNESS, C' as
 * COLOURFULNESS, and derives greenness/blueness as the inverses and the hue
 * diagonals (orange/cyan, lime/purple) as means of adjacent primaries — all
 * continuous in [0, 1], never half-wave-rectified.
 *
 * Grey degrades cleanly: an axis whose percentile band is narrower than a
 * flatness epsilon is treated as having no signal — a/b map to 0.5 (neutral, no
 * hue bias), C maps to 0 (no colour), L to 0.5 — rather than amplifying noise
 * into fake hue. The a/b/C flatness epsilon is a small OKLab-chroma threshold so
 * a near-grey image stays neutral; L uses a tiny epsilon since lightness always
 * carries range.
 *
 * Deterministic (a pure function of the buffer and the module constants — no
 * Date, no Math.random), so every rerun produces the identical buffer and the
 * colour→note mapping is frozen before the first note. Intentionally free of
 * canvas / CDN / DOM dependencies so it unit-tests under `node --test`
 * (test/imageStretch.test.mjs). The canvas wires it in on setImage
 * (src/canvasRender.js).
 */

// @ts-check

/** Subsample budget: at most this many pixels feed the percentiles. */
const STRETCH_MAX_SAMPLES = 10000;

/** Percentile cuts (5th / 95th), shared convention with agc/design. */
const AGC_LOW_PCT = 0.05;
const AGC_HIGH_PCT = 0.95;

/**
 * Flatness epsilon for the LIGHTNESS band. A subsample whose [Llo, Lhi] is
 * narrower than this is treated as flat (a uniform-lightness image): applyStretch
 * maps every L to 0.5 rather than dividing by a near-zero span.
 */
const STRETCH_FLAT_EPSILON = 1e-6;

/**
 * Flatness epsilon for the CHROMATIC bands (a, b, C), in OKLab chroma units. An
 * axis whose 5–95 percentile band is narrower than this carries no real colour
 * (a grey / near-grey image), so it is neutralised rather than stretched — which
 * would amplify sensor/quantisation noise into vivid fake hue. 0.02 is a small
 * fraction of a vivid sRGB chroma (~0.1–0.3), so a genuinely colourful axis is
 * always stretched while a near-grey one stays put.
 */
const CHROMA_FLAT_EPSILON = 0.02;

/**
 * Compute the trimmed [min, max] of an array of values: sort ascending and take
 * the 5th and 95th percentile by index so a few outlier pixels cannot blow the
 * result out. Deterministic. An empty / non-array input yields null.
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
 * @property {number} Llo @property {number} Lhi   lightness band (→ pxLt)
 * @property {number} aLo @property {number} aHi   a / redness band (→ pxR)
 * @property {number} bLo @property {number} bHi   b / yellowness band (→ pxY)
 * @property {number} cLo @property {number} cHi   chroma band (→ pxChr)
 */

/** A percentile band {lo, hi} from sampled values, or a sensible default. */
function bandOf(values, dlo, dhi) {
    const r = agcPercentileRange(values);
    return r !== null ? { lo: r.min, hi: r.max } : { lo: dlo, hi: dhi };
}

/**
 * Compute the per-image stretch params from a raw OKLCh buffer (Float32Array,
 * 4 channels/pixel: L, C, a, b, row-major — what buildOKLChBuffer produces).
 * A deterministic fixed stride subsamples to at most STRETCH_MAX_SAMPLES pixels.
 * An empty / non-array buffer yields identity-ish OKLab-magnitude defaults so a
 * missing image degrades cleanly rather than throwing.
 *
 * @param {ArrayLike<number> | null | undefined} oklchBuffer
 * @returns {StretchParams}
 */
export function computeStretchParams(oklchBuffer) {
    const len = (oklchBuffer && typeof oklchBuffer.length === "number")
        ? oklchBuffer.length : 0;
    const pixelCount = Math.floor(len / 4);
    if (!(pixelCount > 0)) {
        // Typical OKLab magnitudes: L in [0,1], a/b in ~[-0.3,0.3], C in [0,0.3].
        return { Llo: 0, Lhi: 1, aLo: -0.3, aHi: 0.3, bLo: -0.3, bHi: 0.3, cLo: 0, cHi: 0.3 };
    }
    const stride = Math.max(1, Math.ceil(pixelCount / STRETCH_MAX_SAMPLES));
    /** @type {number[]} */ const lVals = [];
    /** @type {number[]} */ const cVals = [];
    /** @type {number[]} */ const aVals = [];
    /** @type {number[]} */ const bVals = [];
    for (let p = 0; p < pixelCount; p += stride) {
        const idx = p * 4;
        const L = oklchBuffer[idx];
        const C = oklchBuffer[idx + 1];
        const a = oklchBuffer[idx + 2];
        const b = oklchBuffer[idx + 3];
        if (Number.isFinite(L)) lVals.push(L);
        if (Number.isFinite(C)) cVals.push(C);
        if (Number.isFinite(a)) aVals.push(a);
        if (Number.isFinite(b)) bVals.push(b);
    }
    const L = bandOf(lVals, 0, 1);
    const a = bandOf(aVals, -0.3, 0.3);
    const b = bandOf(bVals, -0.3, 0.3);
    const c = bandOf(cVals, 0, 0.3);
    return {
        Llo: L.lo, Lhi: L.hi,
        aLo: a.lo, aHi: a.hi,
        bLo: b.lo, bHi: b.hi,
        cLo: c.lo, cHi: c.hi,
    };
}

/**
 * Stretch one value by a percentile band to [0, 1]. A band narrower than `eps`
 * (a flat axis) returns `flat` instead of dividing by ~0.
 * @param {number} v
 * @param {number} lo @param {number} hi
 * @param {number} eps @param {number} flat
 * @returns {number}
 */
function stretchBand(v, lo, hi, eps, flat) {
    const span = hi - lo;
    if (!(span > eps)) return flat;
    const t = (v - lo) / span;
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Apply stretch params to a raw OKLCh buffer, returning a NEW Float32Array of
 * the same length and layout (L', C', a', b' per pixel), each channel
 * percentile-stretched to [0, 1] (a flat axis → neutral). signals.js reads a' as
 * redness, b' as yellowness, C' as colourfulness, L' as lightness.
 *
 * @param {Float32Array} oklchBuffer  Raw L,C,a,b buffer.
 * @param {StretchParams} params
 * @returns {Float32Array}  New stretched L',C',a',b' buffer, all in [0, 1].
 */
export function applyStretch(oklchBuffer, params) {
    const out = new Float32Array(oklchBuffer.length);
    const pixelCount = Math.floor(oklchBuffer.length / 4);
    for (let p = 0; p < pixelCount; p++) {
        const idx = p * 4;
        out[idx] = stretchBand(oklchBuffer[idx], params.Llo, params.Lhi, STRETCH_FLAT_EPSILON, 0.5);
        out[idx + 1] = stretchBand(oklchBuffer[idx + 1], params.cLo, params.cHi, CHROMA_FLAT_EPSILON, 0);
        out[idx + 2] = stretchBand(oklchBuffer[idx + 2], params.aLo, params.aHi, CHROMA_FLAT_EPSILON, 0.5);
        out[idx + 3] = stretchBand(oklchBuffer[idx + 3], params.bLo, params.bHi, CHROMA_FLAT_EPSILON, 0.5);
    }
    return out;
}

// Exposed for tests / documentation.
export const _STRETCH_CONSTANTS = {
    STRETCH_MAX_SAMPLES,
    AGC_LOW_PCT,
    AGC_HIGH_PCT,
    STRETCH_FLAT_EPSILON,
    CHROMA_FLAT_EPSILON,
};
