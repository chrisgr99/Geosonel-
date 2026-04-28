/**
 * Image transform module — accessibility brightness reduction.
 *
 * Spec: DESIGN.md Section 26.
 *
 * One pure async function. Takes an ImageBitmap plus a
 * parameter object, returns a new ImageBitmap with bright
 * regions attenuated. The transform is spatially aware: a
 * blurred copy of the image serves as an estimate of the
 * regional luminance at each pixel, and that regional value
 * (not the pixel's own value) drives how much the pixel is
 * dimmed. Small bright features in dark surroundings keep
 * their brightness; large continuously-bright regions are
 * pulled down. Local contrast and fine detail are preserved
 * because the multiplier comes from the blurred neighbourhood
 * but is applied to the unblurred pixel.
 *
 * The function is pure and stateless. It reads no
 * preferences and no globals — callers pass parameters
 * explicitly. This keeps the door open for future per-score
 * override paths to slot in at a higher layer without
 * touching this module.
 *
 * Luminance is computed with the Rec. 709 weights applied
 * directly to gamma-encoded sRGB values rather than to
 * linear-light values. This is a simplification: strict
 * Rec. 709 luminance assumes the input has been linearised
 * first. The simpler form saves a per-pixel pow() and keeps
 * the inner loop tight; the resulting non-linearity is
 * absorbed by the user-tunable threshold parameter, since
 * accessibility dimming is adjusted to taste rather than to
 * a colorimetric standard.
 *
 * Music generation is unaffected. The canvas's
 * pixel-sampling array is built from the source bitmap and
 * never reads from the transformed result; this module
 * exists purely to produce the visual representation. See
 * canvas.js setImage for the dual-snapshot wiring.
 */

// @ts-check

/**
 * @typedef {Object} BrightnessReductionOptions
 * @property {number} blurRadius      Pixel scale of the regional luminance estimate. Larger values mean only very broad bright regions are dimmed.
 * @property {number} threshold       Regional luminance below which no dimming is applied. 0–1 scale.
 * @property {number} maxAttenuation  Multiplier applied at maximum regional luminance. 0.5 halves the brightest large regions; 1.0 disables the effect entirely.
 */

/**
 * Apply spatially-aware brightness reduction to an image
 * bitmap. Returns a new bitmap with bright regions
 * attenuated by an amount that depends on the regional
 * luminance around each pixel.
 *
 * Throws on empty inputs or on canvas-context failures so
 * the caller can decide whether to fall back to displaying
 * the original.
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

    // Canvas A holds the original pixels and will receive the
    // attenuated output. Canvas B is used only to produce a
    // blurred copy whose ImageData we read once and then
    // discard along with the canvas itself.
    const canvasA = document.createElement("canvas");
    canvasA.width = width;
    canvasA.height = height;
    const ctxA = canvasA.getContext("2d");
    if (ctxA === null) {
        throw new Error("imageTransform: 2D context unavailable for original");
    }
    ctxA.drawImage(bitmap, 0, 0);
    const orig = ctxA.getImageData(0, 0, width, height);

    const canvasB = document.createElement("canvas");
    canvasB.width = width;
    canvasB.height = height;
    const ctxB = canvasB.getContext("2d");
    if (ctxB === null) {
        throw new Error("imageTransform: 2D context unavailable for blur");
    }
    // ctx.filter applies to subsequent draws; setting it
    // before drawImage produces a blurred copy entirely on
    // the GPU on browsers that hardware-accelerate filters,
    // which is most modern browsers most of the time.
    ctxB.filter = `blur(${opts.blurRadius}px)`;
    ctxB.drawImage(bitmap, 0, 0);
    const blurred = ctxB.getImageData(0, 0, width, height);

    // Per-pixel pass. orig.data is mutated in place; we
    // putImageData it back into canvasA at the end and
    // produce the result bitmap from there.
    const origData = orig.data;
    const blurredData = blurred.data;
    const threshold = opts.threshold;
    const maxAtten = opts.maxAttenuation;

    // The threshold parameter is capped at 0.9 by the user
    // schema, so 1 - threshold is at least 0.1. The local
    // guard here is defensive in case a future caller passes
    // a value outside the schema's range.
    const denom = Math.max(1e-6, 1 - threshold);
    // Pre-computed so the inner loop has one fewer multiply.
    const attenRange = 1 - maxAtten;

    const len = origData.length;
    for (let i = 0; i < len; i += 4) {
        // Loose Rec. 709 luminance from the blurred
        // neighbourhood, applied directly to sRGB values.
        // The weights sum to 1.0 and inputs are 0–255, so
        // the result lands in [0, 1].
        const lum =
            (0.2126 * blurredData[i] +
             0.7152 * blurredData[i + 1] +
             0.0722 * blurredData[i + 2]) / 255;

        // Below threshold: factor is 1, no change. Skip the
        // arithmetic and the writes — most pixels in a
        // typical image are below threshold so this is a
        // worthwhile early-out.
        if (lum <= threshold) continue;

        // Smoothstep curve from threshold up to 1.0.
        // t in [0, 1], s = 3t² − 2t³, factor lands at 1.0
        // when lum equals threshold and at maxAtten when lum
        // equals 1.0, with a smooth Hermite roll-off between.
        let t = (lum - threshold) / denom;
        if (t > 1) t = 1;
        const s = t * t * (3 - 2 * t);
        const factor = 1 - s * attenRange;

        // Uint8ClampedArray handles the multiply-and-clamp
        // implicitly: out-of-range values are clamped to
        // 0–255 on assignment, so we don't need explicit
        // bounds checks. Alpha (i + 3) passes through
        // untouched.
        origData[i]     = origData[i]     * factor;
        origData[i + 1] = origData[i + 1] * factor;
        origData[i + 2] = origData[i + 2] * factor;
    }

    ctxA.putImageData(orig, 0, 0);
    return await createImageBitmap(canvasA);
}
