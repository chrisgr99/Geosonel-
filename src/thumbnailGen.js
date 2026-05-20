/**
 * Thumbnail generation.
 *
 * One pure function. Takes input image bytes plus a mime
 * type, returns a base64-encoded PNG string suitable for
 * embedding inline in settings.json (Electron) or an
 * IndexedDB record (web) as a gallery entry's preview.
 *
 * Sizing per DESIGN.md Section 13.5: 360×240 (3:2,
 * wider than tall). The 3:2 aspect matches the typical
 * canvas aspect ratio (the default 32×24 = 4:3 is close;
 * many custom canvases land near 3:2 or 16:9 which 3:2
 * splits between) and the typical landscape imported
 * image.
 *
 * Hard-stretch fill, no letterboxing. The source bitmap
 * is drawn at full 360×240 with whatever distortion that
 * involves, never letterboxed inside the frame. This
 * matches what the rest of GeoSonel already does with
 * images — imageNormalize.js hard-stretches every
 * imported image into a 1000×1000 JPEG before storage
 * because the image is a signal source rather than a
 * faithful representation, and the canvas paints those
 * square bytes stretched again to canvasW × canvasH on
 * display. The thumbnail follows the same rule so it
 * shows the user a faithful preview of what the canvas
 * will actually render. Design principle: GeoSonel does
 * not letterbox images anywhere — not in thumbnails,
 * not on the canvas. Aspect distortion is the expected
 * and documented behaviour throughout the image
 * pipeline.
 *
 * PNG encoding rather than JPEG. Thumbnails at 360×240
 * are small enough (typically 15–40 KB as PNG) that the
 * JPEG compression win wouldn't materially shrink storage
 * for a gallery capped at 48 entries (under 2 MB total),
 * and PNG handles fine detail at this size without the
 * blocking artifacts JPEG would introduce at the lower
 * quality settings storage size would demand.
 *
 * The returned string is the base64 payload only — no
 * `data:image/png;base64,` prefix. Callers that want a
 * data URL for direct use as an <img src> attribute can
 * prepend the prefix themselves; callers that want to
 * embed in JSON storage avoid the prefix overhead.
 */

// @ts-check

const THUMBNAIL_W = 360;
const THUMBNAIL_H = 240;

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
        canvas.width = THUMBNAIL_W;
        canvas.height = THUMBNAIL_H;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("Cannot acquire 2D canvas context for thumbnail generation.");
        }
        // Hard-stretch the source to fill the entire
        // 360×240 frame, distorting aspect as needed.
        // See module docstring for the rationale (matches
        // imageNormalize.js's stretch-to-fill, gives a
        // faithful preview of what the canvas will paint,
        // honours the design rule that GeoSonel never
        // letterboxes images).
        ctx.drawImage(bitmap, 0, 0, THUMBNAIL_W, THUMBNAIL_H);

        const dataUrl = canvas.toDataURL("image/png");
        // Strip the "data:image/png;base64," prefix so the
        // returned string is the payload only.
        const commaIdx = dataUrl.indexOf(",");
        return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    } finally {
        bitmap.close();
    }
}
