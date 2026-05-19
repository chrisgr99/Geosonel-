/**
 * Thumbnail generation.
 *
 * One pure function. Takes input image bytes plus a mime
 * type, returns a base64-encoded PNG string suitable for
 * embedding inline in settings.json (Electron) or an
 * IndexedDB record (web) as a gallery entry's preview.
 *
 * Sizing per DESIGN.md Section 13.5: 96×96 with letterbox
 * padding to preserve the source's aspect ratio. Unlike
 * the normalization step in imageNormalize.js (which
 * stretches to fill, since the image is a signal source
 * not a faithful representation), the thumbnail is purely
 * a visual recognition cue in the gallery grid, so the
 * aspect-ratio preservation matters here.
 *
 * PNG encoding rather than JPEG. Thumbnails at 96×96 are
 * small enough (typically 3–8 KB as PNG) that the JPEG
 * compression win wouldn't materially shrink storage, and
 * PNG handles the sharp letterbox padding edges cleanly
 * without ringing artifacts that JPEG would introduce at
 * the boundary between the image and the black bars.
 *
 * The returned string is the base64 payload only — no
 * `data:image/png;base64,` prefix. Callers that want a
 * data URL for direct use as an <img src> attribute can
 * prepend the prefix themselves; callers that want to
 * embed in JSON storage avoid the prefix overhead.
 */

// @ts-check

const THUMBNAIL_SIZE = 96;

/**
 * Generate a thumbnail from image bytes. Returns the
 * base64-encoded PNG payload (no data-URL prefix).
 *
 * @param {ArrayBuffer} bytes
 * @param {string} mimeType
 * @returns {Promise<string>}
 */
export async function generateThumbnail(bytes, mimeType) {
    const blob = new Blob([bytes], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = THUMBNAIL_SIZE;
        canvas.height = THUMBNAIL_SIZE;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("Cannot acquire 2D canvas context for thumbnail generation.");
        }
        // Black letterbox padding for any portion of the
        // 96×96 box not covered by the aspect-preserving
        // draw below.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);

        // Letterbox math. Compute the largest scaled
        // rectangle that fits inside the target box while
        // preserving the source's aspect ratio, centred.
        const sourceAspect = bitmap.width / bitmap.height;
        let drawW;
        let drawH;
        if (sourceAspect >= 1) {
            // Landscape or square: full width, height
            // letterboxed top and bottom.
            drawW = THUMBNAIL_SIZE;
            drawH = THUMBNAIL_SIZE / sourceAspect;
        } else {
            // Portrait: full height, width letterboxed
            // left and right.
            drawH = THUMBNAIL_SIZE;
            drawW = THUMBNAIL_SIZE * sourceAspect;
        }
        const drawX = (THUMBNAIL_SIZE - drawW) / 2;
        const drawY = (THUMBNAIL_SIZE - drawH) / 2;
        ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);

        const dataUrl = canvas.toDataURL("image/png");
        // Strip the "data:image/png;base64," prefix so the
        // returned string is the payload only.
        const commaIdx = dataUrl.indexOf(",");
        return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    } finally {
        bitmap.close();
    }
}
