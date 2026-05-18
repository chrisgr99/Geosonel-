/**
 * sRGB-to-OKLab conversion math.
 *
 * Standard sRGB-to-linear-sRGB-to-OKLab pipeline per Björn
 * Ottosson's OKLab paper (2020). The matrix coefficients
 * come from the reference implementation at
 * https://bottosson.github.io/posts/oklab/.
 *
 * Used by the canvas to build the precomputed per-pixel
 * OKLab buffer that the Phase 4 image-colour dynamic
 * signals (imageLightness, imageChroma, imageRedness/
 * imageGreenness, imageYellowness/imageBlueness) read from.
 * The conversion happens once per image-load; per-event
 * signal reads are O(1) lookups into the Float32 buffer.
 *
 * Output ranges. L is the perceptual lightness, normalised
 * roughly to [0, 1] (very saturated colours can push it
 * slightly outside that range, but typical photographic
 * imagery stays inside). a is the green-to-red opponent
 * axis: positive values are reddish, negative greenish,
 * typical magnitudes up to about 0.3. b is the blue-to-
 * yellow opponent axis with the same magnitude scale:
 * positive yellow, negative blue. Composers wanting
 * imageRedness use a directly; imageGreenness uses -a;
 * imageYellowness uses b; imageBlueness uses -b.
 * imageChroma is sqrt(a*a + b*b), derived on read rather
 * than stored.
 *
 * The buffer interleaves L, a, b as Float32 in row-major
 * order with stride 3. At the canvas's 1000×1000 sampling
 * resolution that's 12 MB; per-pixel cost is one cbrt
 * per channel plus the matrix math, dominated by the
 * three cbrt calls, totalling roughly a quarter-second to
 * build on a modern laptop. Run once per image-load.
 */

// @ts-check

/**
 * sRGB byte (0-255) to linear sRGB (0-1). The standard
 * piecewise gamma decode: a linear segment near zero,
 * then a 2.4-power curve above the 0.04045 threshold.
 *
 * @param {number} c
 * @returns {number}
 */
function srgbByteToLinear(c) {
    const u = c / 255;
    if (u <= 0.04045) return u / 12.92;
    return Math.pow((u + 0.055) / 1.055, 2.4);
}

/**
 * Linear sRGB to OKLab. Inputs 0-1, outputs L in roughly
 * [0, 1] and a, b in roughly [-0.4, 0.4]. The matrix is
 * a sequence of two linear maps with a cube-root non-
 * linearity between them, capturing the perceptual
 * uniformity of OKLab.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{L: number, a: number, b: number}}
 */
function linearRGBToOKLab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    };
}

/**
 * Convert a single sRGB byte triple to OKLab. Public
 * entry point that combines gamma-decode and the linear-
 * to-OKLab step. Used directly when a one-shot conversion
 * is needed; for bulk image conversion use
 * buildOKLabBufferFromImageData.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{L: number, a: number, b: number}}
 */
export function srgbByteToOKLab(r, g, b) {
    return linearRGBToOKLab(
        srgbByteToLinear(r),
        srgbByteToLinear(g),
        srgbByteToLinear(b),
    );
}

/**
 * Build an OKLab Float32 buffer from a full sRGB ImageData.
 * Output layout: stride 3 (L, a, b) per pixel, length
 * 3 × width × height. Pixel (px, py) lives at index
 * (py × width + px) × 3 in the buffer.
 *
 * Caller knows width and height separately for indexing;
 * this helper just produces the buffer.
 *
 * @param {ImageData} imageData
 * @returns {Float32Array}
 */
export function buildOKLabBufferFromImageData(imageData) {
    const { data } = imageData;
    const pixelCount = (data.length / 4) | 0;
    const out = new Float32Array(pixelCount * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        const lab = srgbByteToOKLab(data[i], data[i + 1], data[i + 2]);
        out[j] = lab.L;
        out[j + 1] = lab.a;
        out[j + 2] = lab.b;
    }
    return out;
}
