// @ts-check
import { NO_IMAGE_FILL_COLOUR, PIXEL_SAMPLE_SIZE } from "./canvasShared.js";

export const samplingMethods = {

    /**
     * Build the 1000x1000 ImageData snapshot used for trigger
     * and sprite fill sampling. Returns null on failure (e.g.
     * canvas tainted by cross-origin image data) so the caller
     * can fall back to the no-image fill.
     * @param {ImageBitmap | HTMLImageElement} bitmap
     * @returns {ImageData | null}
     */
    _buildPixelSamplingArray(bitmap) {
        const off = document.createElement("canvas");
        off.width = PIXEL_SAMPLE_SIZE;
        off.height = PIXEL_SAMPLE_SIZE;
        const offCtx = off.getContext("2d");
        if (offCtx === null) return null;
        offCtx.drawImage(bitmap, 0, 0, PIXEL_SAMPLE_SIZE, PIXEL_SAMPLE_SIZE);
        try {
            return offCtx.getImageData(0, 0, PIXEL_SAMPLE_SIZE, PIXEL_SAMPLE_SIZE);
        } catch (err) {
            console.error("GXW: failed to sample image pixels:", err);
            return null;
        }
    },
    /**
     * Return the image colour at canvas position (x, y) as a
     * CSS rgb() string. The image fills the scene's canvas
     * region (canvasW x canvasH centred on the origin), so
     * positions outside that region (or any time no image is
     * loaded) fall back to the no-image placeholder colour.
     * Sampling tracks canvas size so a sprite or trigger
     * placed inside the canvas always reads from the image
     * pixel beneath it, regardless of how the user has sized
     * the playable area.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {string}
     */
    _sampleImageAt(canvasX, canvasY) {
        if (this._imagePixels === null) return NO_IMAGE_FILL_COLOUR;

        const halfW = this._getCanvasW() / 2;
        const halfH = this._getCanvasH() / 2;
        // Map canvas coordinates to (u, v) in [0, 1]:
        //   u: x in [-halfW, halfW] -> [0, 1] left-to-right
        //   v: y in [halfH, -halfH] -> [0, 1] top-to-bottom
        //      (flipped because image rows go top-down while
        //      canvas Y goes bottom-up)
        const u = (canvasX + halfW) / (2 * halfW);
        const v = (halfH - canvasY) / (2 * halfH);
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return NO_IMAGE_FILL_COLOUR;

        const w = this._imagePixels.width;
        const h = this._imagePixels.height;
        const px = Math.min(w - 1, Math.floor(u * w));
        const py = Math.min(h - 1, Math.floor(v * h));
        const idx = (py * w + px) * 4;
        const data = this._imagePixels.data;
        return `rgb(${data[idx]}, ${data[idx + 1]}, ${data[idx + 2]})`;
    },
    /**
     * Sample the precomputed STRETCHED OKLCh values at canvas
     * position (x, y). Returns a {L, C, a, b} object, or null
     * when the position is outside the canvas region or no
     * image is loaded. Used by the firing engine's snapshot
     * capture for dynamic image-colour signals such as pxLt
     * and by the simulation's onTick context for this.col.*.
     *
     * Reads from the STRETCHED buffer (_imageOKLChStretched,
     * design/agc.md) so the ten this.col.* signals are
     * pre-stretched — the L percentile and a/b gain-capped
     * scale are baked at image-load time, so agc() is now just
     * thin sugar mapping the already-0..1 signal to [lo, hi].
     * The raw buffer (_imageOKLCh) is retained on the canvas
     * for any future true-colour need; sample it through
     * sampleImageOKLChRaw if a consumer genuinely wants the
     * unstretched value.
     *
     * Mirrors _sampleImageAt's coordinate mapping (canvas
     * coords to image-buffer coords via the scene's
     * canvasW/canvasH region), but reads from the OKLCh
     * Float32 buffer rather than the RGB ImageData and
     * returns numeric values rather than a CSS rgb() string.
     * The duplication of the coordinate-mapping logic is
     * intentional: the RGB sampling path is in the canvas
     * draw hot loop and benefits from staying simple with
     * inlined string construction; the OKLCh sampling path
     * is in the firing-engine tick and returns structured
     * data. A shared helper would force a branch on output
     * format that neither caller wants.
     *
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {{L: number, C: number, a: number, b: number} | null}
     */
    sampleImageOKLCh(canvasX, canvasY) {
        return this._sampleOKLChBuffer(this._imageOKLChStretched, canvasX, canvasY);
    },
    /**
     * Sample the RAW (unstretched) OKLCh buffer at canvas
     * position (x, y). Same coordinate mapping and return shape
     * as sampleImageOKLCh, but reads the raw buffer so a
     * consumer that needs true-colour OKLCh (e.g. a future
     * object display-tint that converts back to sRGB) gets the
     * unstretched value rather than the signal-stretched one.
     * No current consumer; provided alongside the stretched
     * sampler so the raw path is reachable without reaching
     * into the canvas privates.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {{L: number, C: number, a: number, b: number} | null}
     */
    sampleImageOKLChRaw(canvasX, canvasY) {
        return this._sampleOKLChBuffer(this._imageOKLCh, canvasX, canvasY);
    },
    /**
     * Shared coordinate-mapping read for the OKLCh samplers
     * above. Maps canvas (x, y) into the given flat L,C,a,b
     * Float buffer and returns the four channels, or null when
     * the buffer is absent, no image is loaded, or the point is
     * outside the canvas region.
     * @param {ArrayLike<number> | null} buffer
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {{L: number, C: number, a: number, b: number} | null}
     */
    _sampleOKLChBuffer(buffer, canvasX, canvasY) {
        if (buffer === null) return null;
        if (this._imagePixels === null) return null;

        const halfW = this._getCanvasW() / 2;
        const halfH = this._getCanvasH() / 2;
        const u = (canvasX + halfW) / (2 * halfW);
        const v = (halfH - canvasY) / (2 * halfH);
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;

        const w = this._imagePixels.width;
        const h = this._imagePixels.height;
        const px = Math.min(w - 1, Math.floor(u * w));
        const py = Math.min(h - 1, Math.floor(v * h));
        const idx = (py * w + px) * 4;
        return {
            L: buffer[idx],
            C: buffer[idx + 1],
            a: buffer[idx + 2],
            b: buffer[idx + 3],
        };
    },
    /**
     * Expose the whole-image RAW (unstretched) OKLCh buffer (and its
     * dimensions) for code that needs to scan every pixel rather than
     * sample one point. The signal stretch is now baked at image load
     * (the per-pixel bake reads the raw buffer directly in
     * canvasRender.js, not through this accessor), so this is currently
     * unused by agc — it is retained as the public surface for any
     * future whole-image raw-OKLCh scan. Returns a
     * read-only-by-convention view: { data, width, height } where
     * `data` is the flat Float buffer (idx = (py*w + px)*4 → L, C, a, b),
     * or null when no image is loaded. Keeps the buffer's privates
     * (_imageOKLCh / _imagePixels) inside the canvas module so callers
     * never reach into them directly. The `data` reference is stable
     * for a given loaded image and changes when a new image is set, so
     * consumers can cache keyed on it.
     * @returns {{data: ArrayLike<number>, width: number, height: number} | null}
     */
    imageOKLChData() {
        if (this._imageOKLCh === null) return null;
        if (this._imagePixels === null) return null;
        return {
            data: this._imageOKLCh,
            width: this._imagePixels.width,
            height: this._imagePixels.height,
        };
    },
};
