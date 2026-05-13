/**
 * OKLCh perceptual colour space conversion.
 *
 * Per section 27's dynamic-signal vocabulary, image-colour
 * signals derive from OKLCh, a perceptually-uniform colour
 * space designed by Bjorn Ottosson (2020). Equal numerical
 * differences in L (lightness) and in the (a, b) opponent-
 * axis coordinates correspond to roughly equal perceived
 * colour differences, which is what makes OKLCh a better
 * mapping surface for musical responses to colour than raw
 * RGB or HSL.
 *
 * The conversion path is sRGB to linear sRGB (gamma decode)
 * to OKLab cone responses (LMS-shaped) to OKLab (the L, a,
 * b form). OKLCh is OKLab's polar form (L, C, h); we keep
 * both L, a, b and the derived C in the precomputed buffer.
 * The hue angle h is intentionally not stored: section 27
 * exposes the opponent-axis projections a and b (positive
 * for redness and yellowness, negative for greenness and
 * blueness) rather than an angular hue, to avoid the
 * wraparound discontinuity an angle has at the colour
 * boundary at 0/360 degrees.
 *
 * Coefficients are from Ottosson's reference implementation.
 * https://bottosson.github.io/posts/oklab/ documents the
 * derivation; the matrices below match that source exactly.
 *
 * Performance notes. For a 1000 by 1000 buffer (one million
 * pixels) the conversion runs once per image load. Each
 * pixel needs three Math.pow calls (sRGB decode) and three
 * Math.cbrt calls (OKLab cone response) plus matrix
 * arithmetic. Empirically about 300 to 500 ms total on a
 * mid-range Mac. Acceptable for an image-load cost; not
 * acceptable inside the per-event hot path, which is why
 * we precompute and store as a Float32Array for O(1)
 * sampling at firing time.
 */

// @ts-check

/**
 * @typedef {Object} OKLChValues
 * @property {number} L  Lightness, roughly in [0, 1].
 * @property {number} C  Chroma, magnitude of (a, b). Roughly [0, 0.4].
 * @property {number} a  Red-green opponent axis. Positive = red, negative = green. Roughly [-0.4, 0.4].
 * @property {number} b  Yellow-blue opponent axis. Positive = yellow, negative = blue. Roughly [-0.4, 0.4].
 */

/**
 * sRGB gamma decode. Inverts the standard sRGB transfer
 * curve to produce linear-light values. Input and output
 * are in [0, 1].
 *
 * @param {number} c
 * @returns {number}
 */
function srgbToLinear(c) {
    if (c <= 0.04045) return c / 12.92;
    return Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert one sRGB pixel (channels in [0, 1]) to OKLCh
 * values (L, C, a, b). The conversion is sRGB to linear
 * sRGB to OKLab to OKLCh; matrix arithmetic is inlined for
 * speed and to keep the per-pixel call compact at buffer
 * build time.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {OKLChValues}
 */
export function rgbToOKLCh(r, g, b) {
    const rLin = srgbToLinear(r);
    const gLin = srgbToLinear(g);
    const bLin = srgbToLinear(b);

    // Linear sRGB to OKLab cone responses. The variable
    // names l, m, s are Ottosson's choice; we keep them
    // here for parity with the reference implementation,
    // even though l shadows the L of OKLab. The cube-root
    // step below resolves the shadowing by producing
    // l_, m_, s_ which feed the final L computation.
    const l = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
    const m = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
    const s = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const aOkl = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const bOkl = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

    const C = Math.hypot(aOkl, bOkl);

    return { L, C, a: aOkl, b: bOkl };
}

/**
 * Build a precomputed OKLCh buffer from an ImageData. The
 * returned Float32Array stores four channels per pixel in
 * row-major order: L, C, a, b. Length is width times
 * height times four.
 *
 * Used by canvas.js at image-load time as a parallel
 * structure to _imagePixels. Per-event lookups under a
 * sprite or curve cursor become an O(1) array read,
 * keeping the firing-tick cost flat regardless of source
 * image resolution.
 *
 * @param {ImageData} imageData
 * @returns {Float32Array}
 */
export function buildOKLChBuffer(imageData) {
    const { width, height, data } = imageData;
    const out = new Float32Array(width * height * 4);
    const pixelCount = width * height;
    for (let i = 0; i < pixelCount; i++) {
        const off = i * 4;
        const r = data[off] / 255;
        const g = data[off + 1] / 255;
        const b = data[off + 2] / 255;
        const oklch = rgbToOKLCh(r, g, b);
        out[off] = oklch.L;
        out[off + 1] = oklch.C;
        out[off + 2] = oklch.a;
        out[off + 3] = oklch.b;
    }
    return out;
}
