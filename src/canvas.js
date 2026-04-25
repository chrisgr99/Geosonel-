/**
 * Canvas module.
 *
 * Owns the HTML canvas element where the scene is drawn, plus
 * the coordinate transform between canvas units (origin-centred
 * Cartesian, equal metric, Y up) and device pixels.
 *
 * Drawn elements: the reference grid, the optional background
 * image, and the scene's curves, triggers, and sprites. Curves
 * render as their geometric shape with tick marks at active
 * beat positions and a cursor (a perpendicular segment when
 * the cursor extent is non-zero, a small dot otherwise) at
 * cycle parameter 0 — the cursor will animate around the
 * curve once the simulation loop arrives in a later milestone.
 *
 * Coordinate model (see DESIGN.md sections 20 and 21):
 *   - Origin (0, 0) is at the centre of the visible canvas area.
 *   - Positive X is right, positive Y is up. Y flips when we
 *     convert to pixel coordinates.
 *   - Equal metric: one unit in X equals one unit in Y in
 *     displayed distance. Circles stay circular.
 *   - At zoom 1, the viewport always shows at least \u00b116 units
 *     horizontally and \u00b112 units vertically (a 32 \u00d7 24 region
 *     with 4:3 aspect). On panes with a different aspect ratio,
 *     the visible region is extended along the longer axis
 *     rather than letterboxed.
 *   - Zoom is centred on the origin; panning is not supported.
 *
 * Retina displays are handled by scaling the canvas backing
 * store by window.devicePixelRatio and keeping the CSS size at
 * the logical pane size. Drawing happens in CSS pixels via a
 * context transform.\n */

// @ts-check

const DEFAULT_HALF_WIDTH = 16;   // \u00b116 units horizontally at zoom 1
const DEFAULT_HALF_HEIGHT = 12;  // \u00b112 units vertically at zoom 1

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;
const MENU_ZOOM_FACTOR = 1.2;    // one menu click / keyboard step
const WHEEL_ZOOM_FACTOR = 1.08;  // per wheel notch

// Colour palette for the grid. Chosen to sit quietly on the
// near-black background so the grid reads as reference rather
// than as content.
const BG_COLOUR = "#2a2a2a";
const MINOR_GRID_COLOUR = "#3a3a3a";
const MAJOR_GRID_COLOUR = "#4a4a4a";
const AXIS_COLOUR = "#606060";

// Colours for scene elements. Curves are soft green, picking
// up on GeoSonix's accent colour. Beat tick marks are a
// brighter green so they pop visually against the curve.
// Cursors are warm amber to stand out from everything else.
//
// Triggers and sprites both fill their interior with the
// background image's pixel colour at the object's centre
// point (matching GeoSonix's behaviour where these objects
// took on the colour of the field underneath them). When no
// image is loaded, both fall back to a placeholder dark gray
// that's slightly lighter than the canvas background so the
// objects remain visible during testing.
//
// Both also carry a light-blue boundary so they stay
// distinguishable from the surrounding image — a diamond
// for triggers, a circle for sprites. Motion is the visual
// cue that distinguishes a moving sprite from a static
// trigger once the simulation loop runs.
const CURVE_COLOUR = "#7dd68a";
const BEAT_TICK_COLOUR = "#b8e8c0";
const CURSOR_COLOUR = "#ffb060";
const OBJECT_BOUNDARY_COLOUR = "#7db8d6";
const NO_IMAGE_FILL_COLOUR = "#404040";

// Resolution of the pixel-sampling array built from the
// background image. Matches GeoSonix's 1000×1000 sampling
// grid — at this size, two adjacent units of canvas space
// resolve to roughly 30 sample pixels in the default ±16/±12
// viewing region, which is plenty for trigger/sprite fills
// while keeping memory bounded to ~4 MB regardless of the
// source image's true resolution.
const PIXEL_SAMPLE_SIZE = 1000;

export class Canvas {
    /**
     * @param {HTMLElement} container  The element the canvas mounts into.
     */
    constructor(container) {
        this.container = container;

        this.canvasEl = document.createElement("canvas");
        this.canvasEl.style.display = "block";
        this.canvasEl.style.width = "100%";
        this.canvasEl.style.height = "100%";
        this.container.appendChild(this.canvasEl);

        const ctx = this.canvasEl.getContext("2d");
        if (ctx === null) {
            throw new Error("GXW: 2D canvas context unavailable.");
        }
        /** @type {CanvasRenderingContext2D} */
        this.ctx = ctx;

        this.zoom = 1;
        this.dpr = window.devicePixelRatio || 1;

        // Derived during _recomputeTransform(). Set to sane
        // defaults so code that runs before the first resize
        // doesn't crash on undefined.
        this.cssWidth = 0;
        this.cssHeight = 0;
        this.pixelsPerUnit = 10;
        this.halfWidthUnits = DEFAULT_HALF_WIDTH;
        this.halfHeightUnits = DEFAULT_HALF_HEIGHT;

        /**
         * The decoded image bitmap ready for drawImage, or null
         * when the bundle has no image.
         * @type {ImageBitmap | HTMLImageElement | null}
         */
        this._imageBitmap = null;

        /**
         * A 1000×1000 ImageData snapshot of the current image,
         * used for fast pixel sampling under triggers and
         * sprites. Built once when the image loads, then read
         * at draw time. Null when no image is loaded.
         * @type {ImageData | null}
         */
        this._imagePixels = null;

        /**
         * The scene to render on top of the grid, or null if
         * no sketch has been run yet.
         * @type {import("./scene.js").Scene | null}
         */
        this._scene = null;

        // Redraws are coalesced through requestAnimationFrame so
        // multiple triggers in the same frame (resize + zoom, say)
        // produce a single draw.
        this._drawScheduled = false;

        // Watch the container for size changes. ResizeObserver
        // catches pane drags, window resize, and focus-mode
        // toggling \u2014 all with one API.
        this._resizeObserver = new ResizeObserver(() => this._onResize());
        this._resizeObserver.observe(this.container);

        // Scroll wheel over the canvas zooms. Prevent default so
        // the browser doesn't scroll the page along with it.
        this.canvasEl.addEventListener("wheel", (e) => this._onWheel(e), {
            passive: false,
        });

        this._onResize();
    }

    // --- Public API ---

    zoomIn() {
        this._setZoom(this.zoom * MENU_ZOOM_FACTOR);
    }

    zoomOut() {
        this._setZoom(this.zoom / MENU_ZOOM_FACTOR);
    }

    resetZoom() {
        this._setZoom(1);
    }

    /**
     * Set the scene to render, or pass null to render just the
     * grid. Triggers a redraw.
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        this.scheduleDraw();
    }

    /**
     * Set or clear the background image. Pass null to clear.
     * The bytes are decoded here and cached as an ImageBitmap
     * (or HTMLImageElement fallback) so future draws don't need
     * to decode again. A 1000×1000 pixel-sampling snapshot is
     * also built so trigger and sprite fills can read the
     * underlying image colour cheaply at draw time.
     * @param {{ bytes: ArrayBuffer, mimeType: string } | null} image
     */
    async setImage(image) {
        if (image === null) {
            this._imageBitmap = null;
            this._imagePixels = null;
            this.scheduleDraw();
            return;
        }
        const blob = new Blob([image.bytes], { type: image.mimeType });
        try {
            // createImageBitmap is the modern fast path; falls
            // back to an HTMLImageElement via object URL if
            // unavailable (ancient browsers).
            if (typeof createImageBitmap === "function") {
                this._imageBitmap = await createImageBitmap(blob);
            } else {
                this._imageBitmap = await imageFromBlob(blob);
            }
            this._imagePixels = this._buildPixelSamplingArray(this._imageBitmap);
            this.scheduleDraw();
        } catch (err) {
            console.error("GXW: failed to decode image:", err);
            this._imageBitmap = null;
            this._imagePixels = null;
            this.scheduleDraw();
        }
    }

    /**
     * Force a full redraw on the next animation frame.
     */
    scheduleDraw() {
        if (this._drawScheduled) return;
        this._drawScheduled = true;
        requestAnimationFrame(() => {
            this._drawScheduled = false;
            this._draw();
        });
    }

    // --- Coordinate conversion ---

    /** @param {number} canvasX */
    toPixelX(canvasX) {
        return this.cssWidth / 2 + canvasX * this.pixelsPerUnit;
    }

    /** @param {number} canvasY */
    toPixelY(canvasY) {
        return this.cssHeight / 2 - canvasY * this.pixelsPerUnit;
    }

    // --- Internals ---

    _setZoom(z) {
        const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
        if (clamped === this.zoom) return;
        this.zoom = clamped;
        this._recomputeTransform();
        this.scheduleDraw();
    }

    _onWheel(/** @type {WheelEvent} */ e) {
        e.preventDefault();
        // Trackpad pinches and mouse wheels both arrive as wheel
        // events. A negative deltaY means zoom in (scroll up).
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
        this._setZoom(this.zoom * factor);
    }

    _onResize() {
        const rect = this.container.getBoundingClientRect();
        this.cssWidth = rect.width;
        this.cssHeight = rect.height;

        // Skip when the container has collapsed to zero \u2014 can
        // happen during focus-mode toggles or transient layout
        // states.
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

        // Resize the backing store to match CSS size \u00d7 dpr so
        // the drawing stays crisp on retina displays.
        this.canvasEl.width = Math.round(this.cssWidth * this.dpr);
        this.canvasEl.height = Math.round(this.cssHeight * this.dpr);

        this._recomputeTransform();
        this.scheduleDraw();
    }

    _recomputeTransform() {
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

        // pixelsPerUnit must be the same in both axes (equal
        // metric). Choose the value that makes the default
        // viewable region fit: whichever axis is the tighter
        // constraint wins.
        const unitsPerPixelX = (2 * DEFAULT_HALF_WIDTH) / this.cssWidth;
        const unitsPerPixelY = (2 * DEFAULT_HALF_HEIGHT) / this.cssHeight;
        const unitsPerPixel = Math.max(unitsPerPixelX, unitsPerPixelY) / this.zoom;

        this.pixelsPerUnit = 1 / unitsPerPixel;
        this.halfWidthUnits = (this.cssWidth / 2) / this.pixelsPerUnit;
        this.halfHeightUnits = (this.cssHeight / 2) / this.pixelsPerUnit;
    }

    _draw() {
        const ctx = this.ctx;

        ctx.save();

        // Map the backing store's pixel space to CSS pixel space
        // for crisp high-dpi rendering. After this scale, all
        // drawing calls use CSS pixel coordinates.
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        ctx.fillStyle = BG_COLOUR;
        ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        // Draw order: image as substrate, grid as reference
        // overlay, scene elements on top as content. This way
        // the composer can always see where agents are relative
        // to the grid, while the image sits behind providing
        // its scalar-field role.
        this._drawImage();
        this._drawGrid();
        this._drawScene();

        ctx.restore();
    }

    _drawScene() {
        if (this._scene === null) return;
        this._drawCurves();
        this._drawTriggers();
        this._drawSprites();
    }

    _drawCurves() {
        if (this._scene === null) return;
        for (const curve of this._scene.curves) {
            this._strokeCurveShape(curve);
            this._drawCurveBeatTicks(curve);
            this._drawCurveCursor(curve);
        }
    }

    _strokeCurveShape(curve) {
        const ctx = this.ctx;
        ctx.strokeStyle = CURVE_COLOUR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const s = curve.shape;
        if (s.type === "line") {
            ctx.moveTo(this.toPixelX(s.x1), this.toPixelY(s.y1));
            ctx.lineTo(this.toPixelX(s.x2), this.toPixelY(s.y2));
        } else if (s.type === "circle") {
            const cx = this.toPixelX(s.cx);
            const cy = this.toPixelY(s.cy);
            const r = s.r * this.pixelsPerUnit;
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
        } else if (s.type === "piste") {
            const pts = s.points;
            if (pts.length >= 2) {
                for (let i = 0; i < pts.length; i++) {
                    const px = this.toPixelX(pts[i][0]);
                    const py = this.toPixelY(pts[i][1]);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                if (s.closed) ctx.closePath();
            }
        }
        // Other shape types (bezier, helice, etc.) are
        // documented in DESIGN.md §4 but not yet implemented.
        ctx.stroke();
    }

    _drawCurveBeatTicks(curve) {
        const ctx = this.ctx;
        ctx.strokeStyle = BEAT_TICK_COLOUR;

        // Tick marks are drawn at every beat slot. Active beats
        // ("x") are visually prominent — longer and thicker —
        // while inactive beats (".") get a short, thin mark so
        // the rhythm structure is visible without dominating
        // the curve. Lengths are constant in CSS pixels so
        // ticks remain legible at every zoom level.
        const activeHalfPx = 5;
        const activeWidth = 2;
        const inactiveHalfPx = 2.5;
        const inactiveWidth = 1;

        const ab = curve.activeBeats;
        const len = curve.beatsPerCycle;
        for (let i = 0; i < len && i < ab.length; i++) {
            const ch = ab[i];
            if (ch !== "x" && ch !== ".") continue;
            const t = i / len;
            const sample = sampleCurve(curve.shape, t);
            if (sample === null) continue;
            const px = this.toPixelX(sample.x);
            const py = this.toPixelY(sample.y);
            const perp = pixelPerpendicularUnit(sample.tx, sample.ty);
            const halfPx = ch === "x" ? activeHalfPx : inactiveHalfPx;
            ctx.lineWidth = ch === "x" ? activeWidth : inactiveWidth;
            ctx.beginPath();
            ctx.moveTo(px - perp.x * halfPx, py - perp.y * halfPx);
            ctx.lineTo(px + perp.x * halfPx, py + perp.y * halfPx);
            ctx.stroke();
        }
    }

    _drawCurveCursor(curve) {
        // The cursor is drawn at parameter 0 statically. Once
        // the simulation loop runs, the same routine will
        // sample at the live cycle position.
        const ctx = this.ctx;
        const sample = sampleCurve(curve.shape, 0);
        if (sample === null) return;
        const px = this.toPixelX(sample.x);
        const py = this.toPixelY(sample.y);

        if (curve.cursorR === 0 && curve.cursorL === 0) {
            // Point cursor: a small filled marker.
            ctx.fillStyle = CURSOR_COLOUR;
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        // Extended cursor: a perpendicular segment of length
        // cursorL on the left and cursorR on the right.
        const perp = pixelPerpendicularUnit(sample.tx, sample.ty);
        const ppu = this.pixelsPerUnit;
        const xRight = px + perp.x * curve.cursorR * ppu;
        const yRight = py + perp.y * curve.cursorR * ppu;
        const xLeft = px - perp.x * curve.cursorL * ppu;
        const yLeft = py - perp.y * curve.cursorL * ppu;

        ctx.strokeStyle = CURSOR_COLOUR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xLeft, yLeft);
        ctx.lineTo(xRight, yRight);
        ctx.stroke();

        // A small filled dot at the curve point so the cursor's
        // anchor on the curve itself is unambiguous.
        ctx.fillStyle = CURSOR_COLOUR;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawTriggers() {
        if (this._scene === null) return;
        const ctx = this.ctx;
        ctx.lineWidth = 1.5;
        // Trigger size in canvas units, multiplied by the
        // score's per-score triggerScale. The scale travels
        // with the score so the visual layout is consistent
        // across users.
        const scale = this._scene.triggerScale;
        for (const t of this._scene.triggers) {
            const cx = this.toPixelX(t.x);
            const cy = this.toPixelY(t.y);
            const r = Math.max(3, t.size * scale * this.pixelsPerUnit);
            // Diamond: a square rotated 45° around (cx, cy)
            // with vertices at distance r from the centre.
            // Going top → right → bottom → left in pixel space
            // (Y down), so "top" is cy - r.
            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx + r, cy);
            ctx.lineTo(cx, cy + r);
            ctx.lineTo(cx - r, cy);
            ctx.closePath();
            ctx.fillStyle = this._sampleImageAt(t.x, t.y);
            ctx.fill();
            ctx.strokeStyle = OBJECT_BOUNDARY_COLOUR;
            ctx.stroke();
        }
    }

    _drawSprites() {
        if (this._scene === null) return;
        const ctx = this.ctx;
        ctx.lineWidth = 1.5;
        // Sprite display radius in canvas units, multiplied by
        // the score's per-score spriteScale. The scale is part
        // of the music — it determines how sprites bounce off
        // the canvas walls — so it travels with the score and
        // is read here from scene data, not from preferences.
        const scale = this._scene.spriteScale;
        for (const s of this._scene.sprites) {
            const cx = this.toPixelX(s.x);
            const cy = this.toPixelY(s.y);
            const r = Math.max(4, (s.displayDiameter / 2) * scale * this.pixelsPerUnit);
            // Filled disc with a light-blue boundary — the fill
            // takes the colour of the image pixel under the
            // centre, the boundary keeps the sprite visible
            // against any background.
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = this._sampleImageAt(s.x, s.y);
            ctx.fill();
            ctx.strokeStyle = OBJECT_BOUNDARY_COLOUR;
            ctx.stroke();
        }
    }

    /**
     * Build the 1000×1000 ImageData snapshot used for trigger
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
    }

    /**
     * Return the image colour at canvas position (x, y) as a
     * CSS rgb() string. The image fills the default ±16 by
     * ±12 viewing region (DESIGN.md §20), so positions outside
     * that region (or any time no image is loaded) fall back
     * to the no-image placeholder colour.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {string}
     */
    _sampleImageAt(canvasX, canvasY) {
        if (this._imagePixels === null) return NO_IMAGE_FILL_COLOUR;

        // Map canvas coordinates to (u, v) in [0, 1]:
        //   u: x in [-16, 16] → [0, 1] left-to-right
        //   v: y in [12, -12] → [0, 1] top-to-bottom (flipped
        //      because image rows go top-down while canvas Y
        //      goes bottom-up)
        const u = (canvasX + DEFAULT_HALF_WIDTH) / (2 * DEFAULT_HALF_WIDTH);
        const v = (DEFAULT_HALF_HEIGHT - canvasY) / (2 * DEFAULT_HALF_HEIGHT);
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return NO_IMAGE_FILL_COLOUR;

        const w = this._imagePixels.width;
        const h = this._imagePixels.height;
        const px = Math.min(w - 1, Math.floor(u * w));
        const py = Math.min(h - 1, Math.floor(v * h));
        const idx = (py * w + px) * 4;
        const data = this._imagePixels.data;
        return `rgb(${data[idx]}, ${data[idx + 1]}, ${data[idx + 2]})`;
    }

    _drawImage() {
        if (this._imageBitmap === null) return;
        const ctx = this.ctx;
        // The image always fills the default ±16 by ±12 region
        // regardless of the canvas pane's aspect ratio. Any
        // source aspect ratio is stretched. This matches the
        // GeoSonix behaviour documented in DESIGN.md Section 20.
        const left = this.toPixelX(-16);
        const right = this.toPixelX(16);
        const top = this.toPixelY(12);
        const bottom = this.toPixelY(-12);
        ctx.drawImage(
            this._imageBitmap,
            left, top,
            right - left,
            bottom - top
        );
    }

    _drawGrid() {
        const ctx = this.ctx;

        // How wide apart are 1-unit minor grid lines in pixels?
        // If too close together the grid becomes visual noise,
        // so we skip minor lines below a threshold and show only
        // 5-unit major lines in that case.
        const minorPxSpacing = this.pixelsPerUnit;
        const showMinor = minorPxSpacing >= 6;

        const minX = Math.ceil(-this.halfWidthUnits);
        const maxX = Math.floor(this.halfWidthUnits);
        const minY = Math.ceil(-this.halfHeightUnits);
        const maxY = Math.floor(this.halfHeightUnits);

        // Minor grid (every 1 unit, skipping axes and multiples
        // of 5 so they can be drawn separately at a brighter
        // tone).
        if (showMinor) {
            ctx.strokeStyle = MINOR_GRID_COLOUR;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let u = minX; u <= maxX; u++) {
                if (u === 0 || u % 5 === 0) continue;
                const px = Math.round(this.toPixelX(u)) + 0.5;
                ctx.moveTo(px, 0);
                ctx.lineTo(px, this.cssHeight);
            }
            for (let u = minY; u <= maxY; u++) {
                if (u === 0 || u % 5 === 0) continue;
                const py = Math.round(this.toPixelY(u)) + 0.5;
                ctx.moveTo(0, py);
                ctx.lineTo(this.cssWidth, py);
            }
            ctx.stroke();
        }

        // Major grid (every 5 units, excluding the axes which
        // are drawn brightest).
        ctx.strokeStyle = MAJOR_GRID_COLOUR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let u = minX; u <= maxX; u++) {
            if (u === 0 || u % 5 !== 0) continue;
            const px = Math.round(this.toPixelX(u)) + 0.5;
            ctx.moveTo(px, 0);
            ctx.lineTo(px, this.cssHeight);
        }
        for (let u = minY; u <= maxY; u++) {
            if (u === 0 || u % 5 !== 0) continue;
            const py = Math.round(this.toPixelY(u)) + 0.5;
            ctx.moveTo(0, py);
            ctx.lineTo(this.cssWidth, py);
        }
        ctx.stroke();

        // Axes at X=0 and Y=0, brightest of the three tones so
        // the origin is visually anchored.
        ctx.strokeStyle = AXIS_COLOUR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const axisPx = Math.round(this.toPixelX(0)) + 0.5;
        ctx.moveTo(axisPx, 0);
        ctx.lineTo(axisPx, this.cssHeight);
        const axisPy = Math.round(this.toPixelY(0)) + 0.5;
        ctx.moveTo(0, axisPy);
        ctx.lineTo(this.cssWidth, axisPy);
        ctx.stroke();
    }
}

/**
 * Sample a curve shape at parameter t in [0, 1]. Returns the
 * canvas-space position {x, y} and the tangent direction
 * {tx, ty} (unnormalised, also in canvas space), or null when
 * the shape is degenerate or not yet implemented (bezier,
 * helice).
 *
 * @param {import("./scene.js").CurveShape} shape
 * @param {number} t
 * @returns {{x: number, y: number, tx: number, ty: number} | null}
 */
function sampleCurve(shape, t) {
    switch (shape.type) {
        case "line": {
            const x = shape.x1 + (shape.x2 - shape.x1) * t;
            const y = shape.y1 + (shape.y2 - shape.y1) * t;
            return {
                x, y,
                tx: shape.x2 - shape.x1,
                ty: shape.y2 - shape.y1,
            };
        }
        case "circle": {
            const a = 2 * Math.PI * t;
            const x = shape.cx + shape.r * Math.cos(a);
            const y = shape.cy + shape.r * Math.sin(a);
            return { x, y, tx: -Math.sin(a), ty: Math.cos(a) };
        }
        case "piste":
            return samplePiste(shape, t);
        default:
            return null;
    }
}

/**
 * Sample a piste (polyline) by arc length. Walks segments
 * until target distance is reached, then returns the position
 * and tangent of the containing segment.
 *
 * @param {import("./scene.js").ShapePiste} shape
 * @param {number} t
 * @returns {{x: number, y: number, tx: number, ty: number} | null}
 */
function samplePiste(shape, t) {
    const pts = shape.points;
    if (pts.length < 2) return null;

    /** @type {Array<{x0: number, y0: number, dx: number, dy: number, length: number}>} */
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0];
        const dy = pts[i + 1][1] - pts[i][1];
        segments.push({
            x0: pts[i][0],
            y0: pts[i][1],
            dx, dy,
            length: Math.hypot(dx, dy),
        });
    }
    if (shape.closed) {
        const last = pts.length - 1;
        const dx = pts[0][0] - pts[last][0];
        const dy = pts[0][1] - pts[last][1];
        segments.push({
            x0: pts[last][0],
            y0: pts[last][1],
            dx, dy,
            length: Math.hypot(dx, dy),
        });
    }

    let total = 0;
    for (const s of segments) total += s.length;
    if (total === 0) return null;

    let target = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (target <= s.length || i === segments.length - 1) {
            const localT = s.length === 0 ? 0 : target / s.length;
            return {
                x: s.x0 + s.dx * localT,
                y: s.y0 + s.dy * localT,
                tx: s.dx,
                ty: s.dy,
            };
        }
        target -= s.length;
    }
    return null; // unreachable, but keeps the type checker happy
}

/**
 * Given a canvas-space tangent (tx, ty), return a unit-length
 * perpendicular vector in pixel space, pointing right of the
 * direction of motion (DESIGN.md §4 convention).
 *
 * In canvas coordinates (Y up) the right perpendicular of
 * (tx, ty) is (ty, -tx). Mapping canvas to pixel space flips
 * Y, so the same vector in pixel space is (ty, tx).
 *
 * @param {number} tx
 * @param {number} ty
 * @returns {{x: number, y: number}}
 */
function pixelPerpendicularUnit(tx, ty) {
    const len = Math.hypot(tx, ty);
    if (len === 0) return { x: 0, y: 0 };
    return { x: ty / len, y: tx / len };
}

/**
 * Decode a Blob into an HTMLImageElement via an object URL.
 * Used as a fallback when createImageBitmap is not available.
 * @param {Blob} blob
 * @returns {Promise<HTMLImageElement>}
 */
function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("image decode failed"));
        };
        img.src = url;
    });
}
