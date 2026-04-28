/**
 * Image transform module — accessibility brightness reduction.
 *
 * Spec: DESIGN.md Section 26.
 *
 * One pure async function. Takes an ImageBitmap plus a
 * parameter object, returns a new ImageBitmap with bright
 * regions attenuated. The transform is spatially aware: an
 * edge-aware blur of the image's luminance serves as the
 * regional luminance estimate at each pixel, and that
 * regional value drives how much the original pixel is
 * dimmed. Small bright features keep their brightness when
 * surrounded by darker context; large continuously-bright
 * regions get pulled down. Local contrast is preserved
 * because the multiplier comes from the blurred neighbourhood
 * but is applied to the unblurred pixel.
 *
 * Edge-aware blur. The blur respects luminance edges so a
 * dark figure standing in front of a bright background does
 * not bleed darkness into the bright background's regional
 * estimate (and vice versa). The previous implementation
 * used a plain Gaussian via ctx.filter = "blur(Npx)", which
 * does not respect edges and produced two visible artefacts:
 * faint halos around high-contrast boundaries, and uneven
 * dimming of bright regions depending on how close they sat
 * to dark figures. Bright background pixels right next to a
 * dark figure had their regional luminance estimate pulled
 * down by the figure within the blur kernel's reach,
 * receiving less dimming than bright pixels far from any
 * figure — visible as a non-uniform dimming across what
 * should have been one continuous bright region. Section 26
 * named this exact case as the trigger for upgrading to an
 * edge-respecting filter.
 *
 * Algorithm: Gastál–Oliveira domain transform recursive
 * filter, three iterations. The domain transform reshapes
 * 1-D coordinates along each row (and analogously each
 * column) so that pixels separated by a luminance edge
 * become far apart in the transformed domain; a normalised
 * recursive filter in that domain decays its influence with
 * transformed distance and so does not bridge the edge.
 * Three iterations with progressively smaller spatial scales
 * approximate a Gaussian-shaped impulse response within
 * smooth regions far better than a single pass would.
 * Reference: Gastál & Oliveira (2011), "Domain Transform
 * for Edge-Aware Image and Video Processing", SIGGRAPH 2011,
 * Eqs. 11, 14, 21.
 *
 * Music generation is unaffected. The canvas's pixel-sampling
 * array is built from the source bitmap and never reads from
 * the transformed result; this module exists purely to
 * produce the visual representation. See canvas.js setImage
 * for the dual-snapshot wiring.
 */

// @ts-check

// Range/edge sensitivity for the domain transform, in 0–1
// luminance terms (the paper's normalised convention).
// Smaller values give stronger edge respect. Tuned for
// photographic imagery with high-contrast figure-against-
// background composition: at 0.2 a luminance gap of roughly
// 50 units (out of 255) clearly registers as an edge that
// the filter will not bridge, while gentle gradients within
// smooth regions are preserved as smoothable. Raising this
// would make the blur behave more like the old Gaussian
// (less edge respect); lowering it would block even modest
// gradients, making the regional estimate too local to be
// useful as a regional estimate.
const SIGMA_R_NORMALISED = 0.2;

// Number of recursive-filter iterations applied. Three is
// the paper's standard recommendation: it produces a much
// closer approximation to true Gaussian smoothing in the
// transformed domain than a single pass would, while the
// per-iteration cost is small enough that three is no
// concern for our import-time use.
const NUM_ITERATIONS = 3;

/**
 * @typedef {Object} BrightnessReductionOptions
 * @property {number} blurRadius      Spatial scale (sigma_s) for the edge-aware blur, in pixels. Larger values mean only very broad bright regions are dimmed.
 * @property {number} threshold       Regional luminance below which no dimming is applied. 0–1 scale.
 * @property {number} maxAttenuation  Multiplier applied at maximum regional luminance. 0.5 halves the brightest large regions; 1.0 disables the effect entirely.
 */

/**
 * Apply spatially-aware brightness reduction to an image
 * bitmap. Returns a new bitmap with bright regions attenuated
 * by an amount that depends on the (edge-aware) regional
 * luminance around each pixel.
 *
 * Throws on empty inputs or canvas-context failures so the
 * caller can decide whether to fall back to displaying the
 * original.
 *
 * @param {ImageBitmap | HTMLImageElement} bitmap
 * @param {BrightnessReductionOptions} opts
 * @returns {Promise<ImageBitmap>}
 */
export async function applyBrightnessReduction(bitmap, opts) {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width === 0 || height === 0) {
        throw new Error("imageTransform: empty bitmap");
    }

    // Single canvas; we draw the source, read pixels, mutate
    // the buffer in place, write back, and return the result
    // as an ImageBitmap.
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("imageTransform: 2D context unavailable");
    }
    ctx.drawImage(bitmap, 0, 0);
    const orig = ctx.getImageData(0, 0, width, height);
    const origData = orig.data;

    // Compute per-pixel luminance (single-channel) from the
    // source RGB. Loose Rec. 709 weights applied directly to
    // gamma-encoded sRGB values, same as the previous
    // Gaussian-based version. Threshold tuning absorbs the
    // small non-linearity of skipping the linearisation step,
    // and the saved per-pixel pow() keeps the inner loops
    // tight.
    const lum = computeLuminance(origData);

    // Edge-aware blur of the luminance produces the regional
    // luminance estimate. Returns a Float32Array same length
    // as lum with values in roughly the same 0–255 range.
    const regional = edgeAwareBlur(lum, width, height, opts.blurRadius);

    // Per-pixel attenuation pass. Reads the regional
    // luminance at each pixel, computes a smoothstep-shaped
    // factor between threshold and 1.0, multiplies it into
    // the original pixel's RGB. Alpha untouched.
    const threshold = opts.threshold;
    const maxAtten = opts.maxAttenuation;
    const denom = Math.max(1e-6, 1 - threshold);
    const attenRange = 1 - maxAtten;

    const len = origData.length;
    for (let i = 0, p = 0; i < len; i += 4, p++) {
        const lumValue = regional[p] / 255;
        if (lumValue <= threshold) continue;
        let t = (lumValue - threshold) / denom;
        if (t > 1) t = 1;
        const s = t * t * (3 - 2 * t);
        const factor = 1 - s * attenRange;
        // Uint8ClampedArray clamps the multiply-and-write so
        // out-of-range values are not a concern.
        origData[i]     = origData[i]     * factor;
        origData[i + 1] = origData[i + 1] * factor;
        origData[i + 2] = origData[i + 2] * factor;
    }

    ctx.putImageData(orig, 0, 0);
    return await createImageBitmap(canvas);
}

/**
 * Compute per-pixel luminance using the loose Rec. 709
 * weights applied directly to gamma-encoded sRGB values.
 * Returns a Float32Array of length width*height with values
 * in the 0–255 range.
 *
 * @param {Uint8ClampedArray} data
 * @returns {Float32Array}
 */
function computeLuminance(data) {
    const lum = new Float32Array(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return lum;
}

/**
 * Apply the Gastál–Oliveira domain transform recursive
 * filter to a single-channel luminance image. Produces a
 * smoothed luminance map that respects high-contrast edges:
 * smoothing flows freely within continuous regions of similar
 * brightness but does not bridge the boundary between, for
 * instance, a bright sky and a dark figure standing against
 * it.
 *
 * Three iterations with progressively smaller spatial scales
 * sigma_H_i = sigma_s * sqrt(3) * 2^(N-i) / sqrt(4^N - 1)
 * (paper Eq. 14) approximate a Gaussian-shaped impulse
 * response far better than a single pass would.
 *
 * The domain-transform increments along each direction
 * (dRow and dCol) are computed once from the source
 * luminance and reused across iterations; only the V array
 * (carry coefficients V[i] = a^d[i]) is recomputed per
 * iteration since the recursive-filter alpha changes with
 * each iteration's sigma_H_i.
 *
 * @param {Float32Array} lum     Source luminance, length width*height, values in 0–255.
 * @param {number} width
 * @param {number} height
 * @param {number} sigmaS        Spatial scale in pixels (the user's blur-radius pref).
 * @returns {Float32Array}       Smoothed luminance, same length as lum.
 */
function edgeAwareBlur(lum, width, height, sigmaS) {
    // sigma_r is specified in 0–1 luminance terms in the
    // paper's normalised convention; we work in 0–255 so
    // scale the constant up to match.
    const sigmaR = SIGMA_R_NORMALISED * 255;
    const ratio = sigmaS / sigmaR;
    const N = NUM_ITERATIONS;

    // Domain-transform increments along rows. dRow[i] is the
    // distance between pixel i-1 and pixel i within their
    // shared row, equal to 1 plus a luminance-gradient
    // contribution scaled by sigma_s/sigma_r. Pixels at the
    // start of a row (x=0) leave dRow at 0; the filter passes
    // start from x=1 and never read dRow at column 0.
    const dRow = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 1; x < width; x++) {
            const i = y * width + x;
            dRow[i] = 1 + ratio * Math.abs(lum[i] - lum[i - 1]);
        }
    }

    // Domain-transform increments along columns; same shape
    // but along the other axis, with the first row of dCol
    // left at 0.
    const dCol = new Float32Array(width * height);
    for (let y = 1; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            dCol[i] = 1 + ratio * Math.abs(lum[i] - lum[i - width]);
        }
    }

    // J holds the smoothed luminance, updated in place across
    // iterations. Starts as a copy of the source.
    const J = new Float32Array(lum);
    // V holds per-pixel carry coefficients V[i] = a^d[i] for
    // the current iteration's filter direction. Reused across
    // the row and column passes within each iteration, and
    // across iterations.
    const V = new Float32Array(width * height);

    for (let iter = 1; iter <= N; iter++) {
        const sigmaH = sigmaS * Math.sqrt(3) *
            Math.pow(2, N - iter) / Math.sqrt(Math.pow(4, N) - 1);
        const a = Math.exp(-Math.sqrt(2) / sigmaH);

        // --- Row direction ---
        // Precompute V[i] = a^dRow[i] once for both the
        // left-to-right and right-to-left passes.
        for (let i = 0; i < V.length; i++) V[i] = Math.pow(a, dRow[i]);

        for (let y = 0; y < height; y++) {
            const off = y * width;
            // Left-to-right: J[i] += V[i] * (J[i-1] - J[i]).
            // V[i] is the carry coefficient for the step from
            // column i-1 to column i in this row.
            for (let x = 1; x < width; x++) {
                const i = off + x;
                J[i] = J[i] + V[i] * (J[i - 1] - J[i]);
            }
            // Right-to-left: J[i] += V[i+1] * (J[i+1] - J[i]).
            // V[i+1] carries the step distance from column i
            // to column i+1, which is the same distance going
            // backward.
            for (let x = width - 2; x >= 0; x--) {
                const i = off + x;
                J[i] = J[i] + V[i + 1] * (J[i + 1] - J[i]);
            }
        }

        // --- Column direction ---
        // Same idea but with V from dCol; loops iterate by
        // column, stepping in width-sized increments.
        for (let i = 0; i < V.length; i++) V[i] = Math.pow(a, dCol[i]);

        for (let x = 0; x < width; x++) {
            // Top-to-bottom.
            for (let y = 1; y < height; y++) {
                const i = y * width + x;
                J[i] = J[i] + V[i] * (J[i - width] - J[i]);
            }
            // Bottom-to-top.
            for (let y = height - 2; y >= 0; y--) {
                const i = y * width + x;
                J[i] = J[i] + V[i + width] * (J[i + width] - J[i]);
            }
        }
    }

    return J;
}
