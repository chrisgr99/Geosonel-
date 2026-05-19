/**
 * Image normalization.
 *
 * One pure function. Takes input image bytes plus a mime
 * type, returns the same image as a 1000×1000 JPEG-encoded
 * ArrayBuffer at quality 0.70.
 *
 * The point of normalization. Pattern signals (pxLt, the
 * OKLCh family, anything that samples image pixels at
 * canvas-derived coordinates) need a uniform image
 * geometry across all scores so the index math is the
 * same regardless of what the user dropped onto the
 * canvas. A 4032×3024 phone photo and a 512×512 icon
 * both need to behave like a 1000×1000 image once they
 * enter the bundle, or signal sampling code branches on
 * source dimensions everywhere.
 *
 * The stretch. Aspect ratio is not preserved — the
 * source is rescaled directly into the 1000×1000 target
 * box. This is intentional: the image is a varying
 * signal source for music generation, not a faithful
 * visual representation. The canvas itself displays the
 * image into the per-score canvasW × canvasH region
 * (default 32×24, a ~4:3 box), which inversely re-
 * stretches roughly back toward typical source aspect
 * ratios — most user images land somewhere between 3:2
 * and 16:9 — so the double-stretch round trip is
 * visually close to identity for common inputs. Sources
 * with extreme aspect ratios distort visibly on canvas,
 * which is the right trade for the simplicity of having
 * one fixed geometry throughout the signal path.
 *
 * JPEG quality 0.70. The cache and the bundle both store
 * the normalized result, which means every reload of a
 * score's image goes through the same JPEG encoder for
 * the same source — deterministic re-decode, so signal
 * sampling produces stable values across reloads. The
 * 0.70 quality level is the visual-fidelity-vs-disk-
 * footprint pivot: photos land at 100–300 KB rather than
 * 1–3 MB as PNG, illustration content sees mild ringing
 * at sharp edges but stays readable, and alpha is baked
 * against a black background (JPEG has no alpha channel,
 * and a background-image use case has no need for one).
 */

// @ts-check

const NORMALIZED_SIZE = 1000;
const JPEG_QUALITY = 0.70;

/**
 * Normalize an image to the canonical 1000×1000 JPEG@70
 * format used throughout GXW. Stretches the source to fill
 * the target box without aspect-ratio preservation.
 *
 * @param {ArrayBuffer} bytes
 * @param {string} mimeType
 * @returns {Promise<{bytes: ArrayBuffer, mimeType: string}>}
 */
export async function normalizeForCanvas(bytes, mimeType) {
    const blob = new Blob([bytes], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = NORMALIZED_SIZE;
        canvas.height = NORMALIZED_SIZE;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("Cannot acquire 2D canvas context for image normalization.");
        }
        // Black background fill in case the source has
        // alpha; JPEG has no alpha channel, so transparent
        // pixels would otherwise composite against
        // browser-default white. Black matches the canvas
        // backdrop the user sees most of the time, so the
        // composited result blends in rather than
        // surprising the user with a white ghost.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, NORMALIZED_SIZE, NORMALIZED_SIZE);
        ctx.drawImage(bitmap, 0, 0, NORMALIZED_SIZE, NORMALIZED_SIZE);
        const outBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                (b) => {
                    if (b === null) {
                        reject(new Error("Canvas toBlob returned null."));
                    } else {
                        resolve(b);
                    }
                },
                "image/jpeg",
                JPEG_QUALITY,
            );
        });
        const outBytes = await outBlob.arrayBuffer();
        return { bytes: outBytes, mimeType: "image/jpeg" };
    } finally {
        bitmap.close();
    }
}
