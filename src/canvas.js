/**
 * Canvas module.
 *
 * Owns the HTML canvas element where the scene is drawn, plus
 * the coordinate transform between canvas units (origin-centred
 * Cartesian, equal metric, Y up) and device pixels.
 *
 * Drawn elements: the reference grid, the optional background
 * image, and the scene's curves, triggers, and sprites. Curves
 * render as their geometric shape with diamond markers at
 * each beat slot — active beats ("x") drawn as miniature
 * triggers (image-filled, blue-bordered, rotated so two
 * opposite vertices lie along the curve's tangent), inactive
 * beats (".") drawn as small hollow green diamonds at the
 * same orientation. The Unified Bound-Trigger Model in
 * DESIGN.md §10.5 treats active beat points as triggers
 * bound to the curve, so they share the trigger's visual
 * treatment here. The cursor (a perpendicular segment when
 * the cursor extent is non-zero, a small dot otherwise)
 * draws at cycle parameter 0 — it will animate around the
 * curve once the simulation loop arrives in a later
 * milestone.
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

import { applyBrightnessReduction } from "./imageTransform.js";
import { getPreference, subscribePreference } from "./preferences.js";

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
// up on GeoSonix's accent colour. Inactive beat-point markers
// reuse the same brighter green so they read as a curve
// detail rather than as content. Active beat points use the
// trigger's blue boundary colour instead, since under the
// Bound-Trigger Model (DESIGN.md §10.5) they ARE triggers
// bound to the curve. Cursors are warm amber to stand out
// from everything else.
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
// Used for inactive beat-point diamonds ("." entries in
// activeBeats). Active beats borrow OBJECT_BOUNDARY_COLOUR
// since they render as triggers per the Bound-Trigger Model.
const BEAT_INACTIVE_COLOUR = "#b8e8c0";
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

// Colours for selection markers and the marquee drag
// rectangle. Marquees around selected objects are yellow
// dotted squares per GeoSonix's convention; the marquee drag
// rectangle (the one the user is dragging out across empty
// canvas space) is a translucent grey region.
const SELECTION_MARKER_COLOUR = "#ffd24a";
const MARQUEE_DRAG_FILL = "rgba(220, 220, 220, 0.18)";
const MARQUEE_DRAG_STROKE = "rgba(220, 220, 220, 0.5)";

// Pixel distance the mouse must travel from mousedown before
// a pending gesture transitions into a drag or marquee. Below
// this, mousedown+mouseup is treated as a click.
const DRAG_THRESHOLD_PX = 4;

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
         * The as-decoded source bitmap, or null when the
         * bundle has no image. This is the unmodified imagery
         * from the bundle and serves two roles: it is the
         * input to _buildPixelSamplingArray (so triggers and
         * sprites read music-generation samples from this
         * bitmap, never from the transformed display bitmap),
         * and it is the input to applyBrightnessReduction
         * whenever the displayed bitmap needs to be
         * re-derived after a settings change.
         * @type {ImageBitmap | HTMLImageElement | null}
         */
        this._imageBitmapOriginal = null;

        /**
         * The bitmap currently rendered by _drawImage, or
         * null when the bundle has no image. Equal to
         * _imageBitmapOriginal when the brightness-reduction
         * bypass preference is on or when the transform
         * fails; otherwise it is the result of running
         * applyBrightnessReduction on the original. The
         * trigger and sprite sampling path never reads this
         * bitmap — it reads _imagePixels, built from the
         * original — so the visual transform can be tuned
         * freely without affecting the music.
         * @type {ImageBitmap | HTMLImageElement | null}
         */
        this._imageBitmap = null;

        /**
         * Sequence number incremented on each call to
         * _recomputeDisplayBitmap. Used to detect superseded
         * in-flight transforms when the user adjusts a
         * settings slider faster than the transform completes:
         * a transform whose captured seq no longer matches
         * the current value discards its result rather than
         * stomping a newer one.
         * @type {number}
         */
        this._transformSeq = 0;

        /**
         * A 1000×1000 ImageData snapshot of the current image,
         * used for fast pixel sampling under triggers and
         * sprites. Built once when the image loads (always
         * from the unmodified original bitmap, never from the
         * transformed display bitmap), then read at draw
         * time. Null when no image is loaded.
         * @type {ImageData | null}
         */
        this._imagePixels = null;

        /**
         * The scene to render on top of the grid, or null if
         * no sketch has been run yet.
         * @type {import("./scene.js").Scene | null}
         */
        this._scene = null;

        /**
         * Active toolbar tool, or null if no creation tool is
         * armed. When non-null the cursor is shown as a
         * crosshair and a click on the canvas places a new
         * object rather than performing selection.
         * @type {string | null}
         */
        this._activeTool = null;
        this._activeToolLocked = false;
        /** @type {import("./toolbar.js").Toolbar | null} */
        this._toolbar = null;
        /** @type {((edit: any) => void) | null} */
        this._editCallback = null;

        /**
         * Selection state, keyed by object kind. Each set
         * holds indexes into the scene's matching array
         * (sprites, triggers, curves). The sets are filtered
         * to valid indexes whenever the scene is reloaded;
         * a setScene where the new scene has the same array
         * lengths preserves selection through move-style
         * edits, while a delete or full reload prunes stale
         * entries naturally.
         * @type {{sprites: Set<number>, triggers: Set<number>, curves: Set<number>}}
         */
        this._selection = {
            sprites: new Set(),
            triggers: new Set(),
            curves: new Set(),
        };

        /**
         * Active mouse gesture, or null when nothing is in
         * progress. Distinguishing kinds: "pending" (mousedown
         * happened, waiting to see if it's a click or a drag),
         * "drag" (moving objects), "marquee" (drawing a
         * rubber-band rectangle to select).
         * @type {any}
         */
        this._gesture = null;

        // Redraws are coalesced through requestAnimationFrame so
        // multiple triggers in the same frame (resize + zoom, say)
        // produce a single draw.
        this._drawScheduled = false;

        // Re-derive the displayed bitmap whenever any of the
        // brightness-reduction preferences changes. The bypass
        // toggle and the three numeric tuners all run through
        // the same path; _recomputeDisplayBitmap inspects the
        // current preference values and decides what to do.
        // No-op when there is no image loaded.
        for (const key of [
            "imageDimBlurRadius",
            "imageDimThreshold",
            "imageDimMaxAttenuation",
            "imageDimBypass",
        ]) {
            subscribePreference(key, () => this._recomputeDisplayBitmap());
        }

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
        this.canvasEl.addEventListener("mousedown", (e) => this._onMouseDown(e));

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
     * grid. Triggers a redraw. Selection is filtered to indexes
     * that are still valid in the new scene; this lets a
     * move-sprites edit (which preserves indexes) keep the
     * user's selection across the consequent re-render, while
     * a delete or full reload (which doesn't) prunes stale
     * entries naturally.
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        if (scene === null) {
            this._selection = {
                sprites: new Set(),
                triggers: new Set(),
                curves: new Set(),
            };
        } else {
            this._selection = {
                sprites: filterIndexSet(this._selection.sprites, scene.sprites.length),
                triggers: filterIndexSet(this._selection.triggers, scene.triggers.length),
                curves: filterIndexSet(this._selection.curves, scene.curves.length),
            };
        }
        this._gesture = null;
        this.scheduleDraw();
    }

    /**
     * Set or clear the background image. Pass null to clear.
     * The bytes are decoded here and cached as an ImageBitmap
     * (or HTMLImageElement fallback) so future draws don't need
     * to decode again. A 1000×1000 pixel-sampling snapshot is
     * built from the decoded original for trigger and sprite
     * fills, and the displayed bitmap is then computed from
     * the original via the brightness-reduction transform —
     * or set equal to the original when the bypass preference
     * is on, see DESIGN.md Section 26.
     * @param {{ bytes: ArrayBuffer, mimeType: string } | null} image
     */
    async setImage(image) {
        if (image === null) {
            this._imageBitmapOriginal = null;
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
            let original;
            if (typeof createImageBitmap === "function") {
                original = await createImageBitmap(blob);
            } else {
                original = await imageFromBlob(blob);
            }
            this._imageBitmapOriginal = original;
            // The pixel-sampling array is built from the
            // unmodified original. This is the music-generation
            // hard boundary: triggers and sprites must read
            // source pixel values, not transformed ones, so the
            // accessibility-driven brightness reduction stays
            // purely a display concern.
            this._imagePixels = this._buildPixelSamplingArray(original);
            // Compute the displayed bitmap. _recomputeDisplayBitmap
            // looks at the bypass preference and either uses
            // the original directly or runs the transform with
            // current settings. It calls scheduleDraw on its
            // own, so we don't repeat that here.
            await this._recomputeDisplayBitmap();
        } catch (err) {
            console.error("GXW: failed to decode image:", err);
            this._imageBitmapOriginal = null;
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

    /** @param {number} pixelX */
    fromPixelX(pixelX) {
        return (pixelX - this.cssWidth / 2) / this.pixelsPerUnit;
    }

    /** @param {number} pixelY */
    fromPixelY(pixelY) {
        return -(pixelY - this.cssHeight / 2) / this.pixelsPerUnit;
    }

    // --- Toolbar / edit wiring ---

    /**
     * Attach a toolbar so the canvas can disarm it after
     * single-shot placements.
     * @param {import("./toolbar.js").Toolbar} toolbar
     */
    setToolbar(toolbar) {
        this._toolbar = toolbar;
    }

    /**
     * Subscribe to scene-edit and selection-change events.
     * The callback receives a structured object with a kind
     * field. See _onMouseUp for the event shapes.
     * @param {(edit: any) => void} cb
     */
    setEditCallback(cb) {
        this._editCallback = cb;
    }

    /**
     * Update which tool, if any, is armed. Drives the cursor
     * style and the click behaviour. Pass null to enter
     * selection mode.
     * @param {string | null} toolName
     * @param {boolean} locked
     */
    setActiveTool(toolName, locked) {
        this._activeTool = toolName;
        this._activeToolLocked = locked;
        this.canvasEl.style.cursor = toolName === null ? "default" : "crosshair";
    }

    /**
     * Replace the current selection. Any kind not provided
     * is left untouched; pass an empty array to clear that
     * kind. Used by external host code to apply a selection
     * decided elsewhere; internal gesture handling updates
     * the sets directly.
     *
     * Emits selectionChanged through the edit callback so
     * downstream listeners (the property inspector, in
     * particular) see external selection clears the same way
     * they see internal mouse-driven changes.
     * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} sel
     */
    setSelection(sel) {
        if (sel.sprites !== undefined) this._selection.sprites = new Set(sel.sprites);
        if (sel.triggers !== undefined) this._selection.triggers = new Set(sel.triggers);
        if (sel.curves !== undefined) this._selection.curves = new Set(sel.curves);
        this.scheduleDraw();
        this._emitSelectionChanged();
    }

    /**
     * Snapshot of the current selection as plain arrays. Used
     * by external host code (e.g. the Delete key handler) to
     * read the selection without coupling to the internal Set
     * representation. The returned arrays are independent
     * copies; mutating them does not affect the canvas.
     * @returns {{sprites: number[], triggers: number[], curves: number[]}}
     */
    getSelection() {
        return {
            sprites: Array.from(this._selection.sprites),
            triggers: Array.from(this._selection.triggers),
            curves: Array.from(this._selection.curves),
        };
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
        // overlay, scene elements on top as content. Selection
        // markers and the marquee rectangle sit on top so they
        // remain visible against any underlying colour.
        this._drawImage();
        this._drawGrid();
        this._drawScene();
        this._drawSelectionMarkers();
        this._drawMarqueeRect();

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
            this._drawCurveBeatPoints(curve);
            this._drawCurveCursor(curve);
        }
    }

    _strokeCurveShape(curve) {
        const ctx = this.ctx;
        ctx.strokeStyle = CURVE_COLOUR;
        ctx.lineWidth = curve.curveThickness;
        ctx.beginPath();
        const s = curve.shape;
        if (s.type === "line") {
            ctx.moveTo(this.toPixelX(s.x1), this.toPixelY(s.y1));
            ctx.lineTo(this.toPixelX(s.x2), this.toPixelY(s.y2));
        } else if (s.type === "ellipse") {
            const cx = this.toPixelX(s.cx);
            const cy = this.toPixelY(s.cy);
            const rx = (s.w / 2) * this.pixelsPerUnit;
            const ry = (s.h / 2) * this.pixelsPerUnit;
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
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

    _drawCurveBeatPoints(curve) {
        const ctx = this.ctx;

        // Beat slots render as diamonds rotated so two opposite
        // vertices lie along the curve's tangent at each
        // sample point. Active beats ("x") render as miniature
        // triggers — filled with the image pixel under the
        // beat position, stroked in the trigger boundary
        // colour — because the Unified Bound-Trigger Model
        // (DESIGN.md §10.5) treats them as triggers bound to
        // the curve. Inactive beats (".") render as smaller
        // hollow diamonds in the inactive-beat green so the
        // full rhythm pattern is readable on the curve
        // without inactive positions competing visually with
        // the active ones.
        //
        // Sizes are constant in CSS pixels so beat points
        // stay legible at every zoom level. The active-beats
        // string cycles modulo its length under the new model:
        // it can be any length the composer chooses, and
        // indexes wrap so a string shorter than cycleDuration
        // repeats and one longer truncates per cycle.
        const activeHalfPx = 6;
        const inactiveHalfPx = 3;

        const ab = curve.activeBeats;
        const len = curve.cycleDuration;
        if (ab.length === 0 || len === 0) return;
        for (let i = 0; i < len; i++) {
            const ch = ab[i % ab.length];
            if (ch !== "x" && ch !== ".") continue;
            const t = i / len;
            const sample = sampleCurve(curve.shape, t);
            if (sample === null) continue;
            const px = this.toPixelX(sample.x);
            const py = this.toPixelY(sample.y);
            const axes = pixelTangentAndPerp(sample.tx, sample.ty);
            const r = ch === "x" ? activeHalfPx : inactiveHalfPx;

            ctx.beginPath();
            ctx.moveTo(px + axes.tx * r, py + axes.ty * r);
            ctx.lineTo(px + axes.px * r, py + axes.py * r);
            ctx.lineTo(px - axes.tx * r, py - axes.ty * r);
            ctx.lineTo(px - axes.px * r, py - axes.py * r);
            ctx.closePath();

            if (ch === "x") {
                ctx.fillStyle = this._sampleImageAt(sample.x, sample.y);
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = OBJECT_BOUNDARY_COLOUR;
                ctx.stroke();
            } else {
                ctx.lineWidth = 1;
                ctx.strokeStyle = BEAT_INACTIVE_COLOUR;
                ctx.stroke();
            }
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
        ctx.lineWidth = curve.cursorThickness;
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
            ctx.strokeStyle = t.color;
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
            ctx.strokeStyle = s.color;
            ctx.stroke();
        }
    }

    // --- Selection rendering ---

    _drawSelectionMarkers() {
        if (this._scene === null) return;
        const sel = this._selection;
        if (sel.sprites.size === 0 && sel.triggers.size === 0 && sel.curves.size === 0) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = SELECTION_MARKER_COLOUR;
        ctx.setLineDash([3, 3]);

        // Sprites — yellow dotted square slightly larger than
        // the sprite's displayed disc.
        ctx.lineWidth = 1;
        const spriteScale = this._scene.spriteScale;
        for (const i of sel.sprites) {
            if (i >= this._scene.sprites.length) continue;
            const s = this._scene.sprites[i];
            const cx = this.toPixelX(s.x);
            const cy = this.toPixelY(s.y);
            const visualR = Math.max(4, (s.displayDiameter / 2) * spriteScale * this.pixelsPerUnit);
            const half = visualR + 4;
            ctx.strokeRect(
                Math.round(cx - half) + 0.5,
                Math.round(cy - half) + 0.5,
                Math.round(half * 2),
                Math.round(half * 2)
            );
        }

        // Triggers — yellow dotted square slightly larger than
        // the diamond's diagonal half-length.
        const triggerScale = this._scene.triggerScale;
        for (const i of sel.triggers) {
            if (i >= this._scene.triggers.length) continue;
            const t = this._scene.triggers[i];
            const cx = this.toPixelX(t.x);
            const cy = this.toPixelY(t.y);
            const visualR = Math.max(3, t.size * triggerScale * this.pixelsPerUnit);
            const half = visualR + 4;
            ctx.strokeRect(
                Math.round(cx - half) + 0.5,
                Math.round(cy - half) + 0.5,
                Math.round(half * 2),
                Math.round(half * 2)
            );
        }

        // Curves — yellow dotted rectangle around the curve's
        // bounding box, sized just large enough to enclose the
        // full geometry. Matches GeoSonix's convention of
        // rectangular selection markers for curves; a marquee
        // that hugs the geometry would be more informative
        // about shape but is harder to recognise as a selection
        // marker, and looks busy when several curves are
        // selected.
        ctx.lineWidth = 1;
        for (const i of sel.curves) {
            if (i >= this._scene.curves.length) continue;
            const bbox = curveBoundingBox(this._scene.curves[i].shape);
            if (bbox === null) continue;
            const px1 = this.toPixelX(bbox.x1);
            const px2 = this.toPixelX(bbox.x2);
            // Canvas Y is up; pixel Y is down. The rectangle's
            // top in pixel space corresponds to bbox.y2 (max y
            // in canvas units).
            const py1 = this.toPixelY(bbox.y2);
            const py2 = this.toPixelY(bbox.y1);
            const padding = 4;
            ctx.strokeRect(
                Math.round(px1 - padding) + 0.5,
                Math.round(py1 - padding) + 0.5,
                Math.round(px2 - px1 + padding * 2),
                Math.round(py2 - py1 + padding * 2)
            );
        }

        ctx.restore();
    }

    _drawMarqueeRect() {
        if (this._gesture === null || this._gesture.kind !== "marquee") return;
        const ctx = this.ctx;
        const g = this._gesture;
        const x1 = Math.min(g.startX, g.currentX);
        const x2 = Math.max(g.startX, g.currentX);
        const y1 = Math.min(g.startY, g.currentY);
        const y2 = Math.max(g.startY, g.currentY);
        // Convert to pixel space. Note canvas Y is up so
        // higher-y corresponds to smaller pixel-y; the rect's
        // top in pixel space is toPixelY(y2).
        const px1 = this.toPixelX(x1);
        const px2 = this.toPixelX(x2);
        const py1 = this.toPixelY(y2);
        const py2 = this.toPixelY(y1);
        ctx.save();
        ctx.fillStyle = MARQUEE_DRAG_FILL;
        ctx.strokeStyle = MARQUEE_DRAG_STROKE;
        ctx.lineWidth = 1;
        ctx.fillRect(px1, py1, px2 - px1, py2 - py1);
        ctx.strokeRect(
            Math.round(px1) + 0.5,
            Math.round(py1) + 0.5,
            Math.round(px2 - px1),
            Math.round(py2 - py1)
        );
        ctx.restore();
    }

    // --- Mouse events ---

    /**
     * Translate a MouseEvent into both pixel and canvas
     * coordinates relative to this canvas's element.
     * @param {MouseEvent} e
     */
    _eventToCanvas(e) {
        const rect = this.canvasEl.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        return {
            px, py,
            x: this.fromPixelX(px),
            y: this.fromPixelY(py),
        };
    }

    /**
     * Find the topmost sprite under a canvas position, or
     * null if no sprite is hit. Iterates back-to-front so the
     * visually-topmost sprite (drawn last) wins ties.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {number | null}
     */
    _hitTestSprite(canvasX, canvasY) {
        if (this._scene === null) return null;
        const scale = this._scene.spriteScale;
        const ppu = this.pixelsPerUnit;
        if (ppu === 0) return null;
        for (let i = this._scene.sprites.length - 1; i >= 0; i--) {
            const s = this._scene.sprites[i];
            const dx = canvasX - s.x;
            const dy = canvasY - s.y;
            const dist = Math.hypot(dx, dy);
            const visualR = (s.displayDiameter / 2) * scale;
            // Add a small pixel-space buffer so small sprites
            // are still selectable without pixel-perfect aim.
            const hitR = visualR + 4 / ppu;
            if (dist <= hitR) return i;
        }
        return null;
    }

    /**
     * Find the topmost trigger under a canvas position, or
     * null if none. Triggers are point objects displayed as
     * diamonds; hit-tests as a circle inscribed by the
     * diamond's diagonal half-length plus a small pixel
     * buffer.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {number | null}
     */
    _hitTestTrigger(canvasX, canvasY) {
        if (this._scene === null) return null;
        const scale = this._scene.triggerScale;
        const ppu = this.pixelsPerUnit;
        if (ppu === 0) return null;
        for (let i = this._scene.triggers.length - 1; i >= 0; i--) {
            const t = this._scene.triggers[i];
            const dx = canvasX - t.x;
            const dy = canvasY - t.y;
            const dist = Math.hypot(dx, dy);
            const visualR = t.size * scale;
            const hitR = visualR + 4 / ppu;
            if (dist <= hitR) return i;
        }
        return null;
    }

    /**
     * Find the topmost curve under a canvas position, or
     * null if none. The curve's geometry is sampled at a
     * grid of points and the minimum pixel distance from the
     * click is compared against a small threshold; this
     * works uniformly across line, circle, and piste shapes
     * without per-shape closed-form distance code.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {number | null}
     */
    _hitTestCurve(canvasX, canvasY) {
        if (this._scene === null) return null;
        const ppu = this.pixelsPerUnit;
        if (ppu === 0) return null;
        const HIT_THRESHOLD_PX = 8;
        const SAMPLES = 64;
        for (let i = this._scene.curves.length - 1; i >= 0; i--) {
            const curve = this._scene.curves[i];
            for (let s = 0; s <= SAMPLES; s++) {
                const t = s / SAMPLES;
                const sample = sampleCurve(curve.shape, t);
                if (sample === null) continue;
                const dxPx = (canvasX - sample.x) * ppu;
                const dyPx = (canvasY - sample.y) * ppu;
                if (Math.hypot(dxPx, dyPx) <= HIT_THRESHOLD_PX) return i;
            }
        }
        return null;
    }

    /**
     * Hit test against all three object kinds. Returns the
     * topmost object as { kind, index }, or null. Drawing
     * order is curves (bottom), triggers, sprites (top); we
     * test in reverse so the visually-topmost object wins
     * ties.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {{kind: "sprite"|"trigger"|"curve", index: number} | null}
     */
    _hitTestObject(canvasX, canvasY) {
        const sIdx = this._hitTestSprite(canvasX, canvasY);
        if (sIdx !== null) return { kind: "sprite", index: sIdx };
        const tIdx = this._hitTestTrigger(canvasX, canvasY);
        if (tIdx !== null) return { kind: "trigger", index: tIdx };
        const cIdx = this._hitTestCurve(canvasX, canvasY);
        if (cIdx !== null) return { kind: "curve", index: cIdx };
        return null;
    }

    /**
     * Get the selection set for a given object kind.
     * @param {"sprite"|"trigger"|"curve"} kind
     * @returns {Set<number>}
     */
    _setForKind(kind) {
        if (kind === "sprite") return this._selection.sprites;
        if (kind === "trigger") return this._selection.triggers;
        return this._selection.curves;
    }

    /**
     * Test whether a hit object is currently selected.
     * @param {{kind: "sprite"|"trigger"|"curve", index: number}} hit
     * @returns {boolean}
     */
    _isInSelection(hit) {
        return this._setForKind(hit.kind).has(hit.index);
    }

    /**
     * Toggle a hit object's membership in the selection.
     * @param {{kind: "sprite"|"trigger"|"curve", index: number}} hit
     */
    _toggleInSelection(hit) {
        const set = this._setForKind(hit.kind);
        if (set.has(hit.index)) set.delete(hit.index);
        else set.add(hit.index);
    }

    /**
     * Replace the entire selection with just the given hit
     * object.
     * @param {{kind: "sprite"|"trigger"|"curve", index: number}} hit
     */
    _selectOnly(hit) {
        this._selection = {
            sprites: hit.kind === "sprite" ? new Set([hit.index]) : new Set(),
            triggers: hit.kind === "trigger" ? new Set([hit.index]) : new Set(),
            curves: hit.kind === "curve" ? new Set([hit.index]) : new Set(),
        };
    }

    /**
     * Fire a selectionChanged event with the current selection
     * snapshot. No-op when no edit callback is connected.
     */
    _emitSelectionChanged() {
        if (this._editCallback === null) return;
        this._editCallback({
            kind: "selectionChanged",
            sprites: Array.from(this._selection.sprites),
            triggers: Array.from(this._selection.triggers),
            curves: Array.from(this._selection.curves),
        });
    }

    /** @param {MouseEvent} e */
    _onMouseDown(e) {
        if (e.button !== 0) return;
        const pos = this._eventToCanvas(e);

        // Tool-armed mode: clicks place a new object instead of
        // performing selection.
        if (this._activeTool !== null) {
            e.preventDefault();
            if (this._editCallback !== null) {
                if (this._activeTool === "sprite") {
                    this._editCallback({
                        kind: "addSprite",
                        x: pos.x,
                        y: pos.y,
                    });
                }
            }
            if (this._toolbar !== null) {
                this._toolbar.afterPlacement();
            }
            return;
        }

        const hit = this._hitTestObject(pos.x, pos.y);
        const wasSelected = hit !== null && this._isInSelection(hit);

        this._gesture = {
            kind: "pending",
            startPx: pos.px,
            startPy: pos.py,
            startX: pos.x,
            startY: pos.y,
            hit,
            wasSelected,
            shiftKey: e.shiftKey,
        };

        const onMove = (/** @type {MouseEvent} */ moveE) => this._onMouseMove(moveE);
        const onUp = (/** @type {MouseEvent} */ upE) => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            this._onMouseUp(upE);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    /** @param {MouseEvent} e */
    _onMouseMove(e) {
        if (this._gesture === null) return;
        const pos = this._eventToCanvas(e);
        const g = this._gesture;

        if (g.kind === "pending") {
            const dpx = pos.px - g.startPx;
            const dpy = pos.py - g.startPy;
            if ((dpx * dpx + dpy * dpy) < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;

            // Threshold crossed. The gesture transitions into
            // a drag (only when the hit object is a sprite —
            // sprites are the only kind with a move pipeline
            // wired up at this milestone) or a marquee (for
            // empty space, triggers, and curves). Starting a
            // marquee on a trigger or curve is unusual but
            // not harmful: the rectangle anchors at the
            // mousedown position and proceeds normally.
            if (g.hit !== null && g.hit.kind === "sprite") {
                let dragSet;
                if (g.wasSelected) {
                    // Drag the existing sprite selection
                    // unchanged. Triggers and curves in the
                    // selection remain selected but don't
                    // move (no edit pipeline yet).
                    dragSet = new Set(this._selection.sprites);
                } else {
                    // Replace selection with this one sprite,
                    // then drag it.
                    dragSet = new Set([g.hit.index]);
                    this._selection = {
                        sprites: new Set(dragSet),
                        triggers: new Set(),
                        curves: new Set(),
                    };
                    this._emitSelectionChanged();
                }
                /** @type {Map<number, {x: number, y: number}>} */
                const initialPositions = new Map();
                if (this._scene !== null) {
                    for (const idx of dragSet) {
                        if (idx < this._scene.sprites.length) {
                            const s = this._scene.sprites[idx];
                            initialPositions.set(idx, { x: s.x, y: s.y });
                        }
                    }
                }
                this._gesture = {
                    kind: "drag",
                    startX: g.startX,
                    startY: g.startY,
                    dragSet,
                    initialPositions,
                };
            } else {
                this._gesture = {
                    kind: "marquee",
                    startX: g.startX,
                    startY: g.startY,
                    currentX: pos.x,
                    currentY: pos.y,
                    shiftKey: g.shiftKey,
                };
            }
            this.scheduleDraw();
            return;
        }

        if (g.kind === "drag") {
            const dx = pos.x - g.startX;
            const dy = pos.y - g.startY;
            if (this._scene !== null) {
                for (const [idx, init] of g.initialPositions) {
                    if (idx < this._scene.sprites.length) {
                        this._scene.sprites[idx].x = init.x + dx;
                        this._scene.sprites[idx].y = init.y + dy;
                    }
                }
            }
            this.scheduleDraw();
            return;
        }

        if (g.kind === "marquee") {
            g.currentX = pos.x;
            g.currentY = pos.y;
            this.scheduleDraw();
            return;
        }
    }

    /** @param {MouseEvent} e */
    _onMouseUp(e) {
        if (this._gesture === null) return;
        const g = this._gesture;
        this._gesture = null;

        if (g.kind === "pending") {
            // Mousedown + mouseup with no movement past the
            // threshold — treat as a click on whatever was hit
            // (or on empty space).
            if (g.hit !== null) {
                if (g.shiftKey) {
                    this._toggleInSelection(g.hit);
                } else {
                    this._selectOnly(g.hit);
                }
            } else if (!g.shiftKey) {
                // Plain click on empty space clears everything.
                // Shift+click on empty space leaves selection alone.
                this._selection = {
                    sprites: new Set(),
                    triggers: new Set(),
                    curves: new Set(),
                };
            }
            this.scheduleDraw();
            this._emitSelectionChanged();
            return;
        }

        if (g.kind === "drag") {
            if (this._editCallback !== null && this._scene !== null) {
                /** @type {Map<number, {x: number, y: number}>} */
                const positions = new Map();
                for (const idx of g.dragSet) {
                    if (idx < this._scene.sprites.length) {
                        const s = this._scene.sprites[idx];
                        positions.set(idx, { x: s.x, y: s.y });
                    }
                }
                this._editCallback({ kind: "moveSprites", positions });
            }
            return;
        }

        if (g.kind === "marquee") {
            const x1 = Math.min(g.startX, g.currentX);
            const x2 = Math.max(g.startX, g.currentX);
            const y1 = Math.min(g.startY, g.currentY);
            const y2 = Math.max(g.startY, g.currentY);
            /** @type {Set<number>} */
            const enclosedSprites = new Set();
            /** @type {Set<number>} */
            const enclosedTriggers = new Set();
            /** @type {Set<number>} */
            const enclosedCurves = new Set();
            if (this._scene !== null) {
                // Sprites and triggers: centre inside rect.
                for (let i = 0; i < this._scene.sprites.length; i++) {
                    const s = this._scene.sprites[i];
                    if (s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2) {
                        enclosedSprites.add(i);
                    }
                }
                for (let i = 0; i < this._scene.triggers.length; i++) {
                    const t = this._scene.triggers[i];
                    if (t.x >= x1 && t.x <= x2 && t.y >= y1 && t.y <= y2) {
                        enclosedTriggers.add(i);
                    }
                }
                // Curves: any sample point inside rect, so a
                // marquee that touches any portion of the
                // curve grabs it. More forgiving than
                // requiring the whole curve to be enclosed,
                // which would make selection of long curves
                // awkward.
                const SAMPLES = 32;
                for (let i = 0; i < this._scene.curves.length; i++) {
                    const curve = this._scene.curves[i];
                    let touched = false;
                    for (let s = 0; s <= SAMPLES; s++) {
                        const t = s / SAMPLES;
                        const sample = sampleCurve(curve.shape, t);
                        if (sample === null) continue;
                        if (sample.x >= x1 && sample.x <= x2 && sample.y >= y1 && sample.y <= y2) {
                            touched = true;
                            break;
                        }
                    }
                    if (touched) enclosedCurves.add(i);
                }
            }
            if (g.shiftKey) {
                // Add to existing selection.
                for (const i of enclosedSprites) this._selection.sprites.add(i);
                for (const i of enclosedTriggers) this._selection.triggers.add(i);
                for (const i of enclosedCurves) this._selection.curves.add(i);
            } else {
                this._selection = {
                    sprites: enclosedSprites,
                    triggers: enclosedTriggers,
                    curves: enclosedCurves,
                };
            }
            this.scheduleDraw();
            this._emitSelectionChanged();
            return;
        }
    }

    /**
     * Recompute the displayed bitmap from the current source
     * bitmap and the current brightness-reduction preference
     * values. Called from setImage after a new image is
     * decoded and from preference subscribers when the user
     * adjusts a setting in the dialog.
     *
     * When the bypass preference is on, sets _imageBitmap
     * directly to the original. Otherwise runs
     * applyBrightnessReduction with the current blurRadius,
     * threshold, and maxAttenuation values, and sets
     * _imageBitmap to the result.
     *
     * Concurrent calls are guarded by _transformSeq: each
     * call captures the current seq at its start, and on
     * completion only writes its result if the seq still
     * matches. This makes it safe to call rapidly from a
     * slider's input event without an out-of-order
     * completion of an earlier transform stomping the result
     * of a later one. The seq counter is bumped on every
     * call, including bypass-only changes, so an in-flight
     * transform that finishes after the user has flipped
     * bypass to on also discards its result.
     *
     * Errors from the transform are logged and the displayed
     * bitmap falls back to the original — the user sees the
     * unmodified image rather than nothing.
     *
     * @returns {Promise<void>}
     */
    async _recomputeDisplayBitmap() {
        const original = this._imageBitmapOriginal;
        const seq = ++this._transformSeq;
        if (original === null) {
            this._imageBitmap = null;
            this.scheduleDraw();
            return;
        }
        if (getPreference("imageDimBypass")) {
            this._imageBitmap = original;
            this.scheduleDraw();
            return;
        }
        try {
            const result = await applyBrightnessReduction(original, {
                blurRadius: getPreference("imageDimBlurRadius"),
                threshold: getPreference("imageDimThreshold"),
                maxAttenuation: getPreference("imageDimMaxAttenuation"),
            });
            // A newer call has superseded us; discard our result.
            if (seq !== this._transformSeq) return;
            this._imageBitmap = result;
            this.scheduleDraw();
        } catch (err) {
            console.error("GXW: brightness-reduction transform failed; showing original:", err);
            if (seq !== this._transformSeq) return;
            this._imageBitmap = original;
            this.scheduleDraw();
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
        case "ellipse": {
            const a = 2 * Math.PI * t;
            const rx = shape.w / 2;
            const ry = shape.h / 2;
            const x = shape.cx + rx * Math.cos(a);
            const y = shape.cy + ry * Math.sin(a);
            // Tangent vector for an ellipse parameterised as
            // (rx cos a, ry sin a) is (-rx sin a, ry cos a).
            // The downstream consumers (cursor perpendicular,
            // beat-point diamond axes) normalise the tangent
            // before use, so the magnitude varying with a is
            // not a concern — the direction is what matters
            // and is correct for any rx, ry.
            return { x, y, tx: -rx * Math.sin(a), ty: ry * Math.cos(a) };
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
 * Given a canvas-space tangent (tx, ty), return the unit-
 * length tangent and right-perpendicular vectors in pixel
 * space. Used by the beat-point diamond renderer, which
 * needs both axes to place the four vertices around the
 * sample point: two along the tangent (which makes the
 * "two opposite vertices lie on the curve" condition hold,
 * exactly for straight segments and to a close visual
 * approximation for curved ones), two along the perpendicular.
 *
 * Mapping canvas to pixel space flips Y, so the tangent
 * (tx, ty) becomes (tx, -ty) in pixel space. The right
 * perpendicular of (tx, -ty) in pixel space (Y down) is
 * (-(-ty), tx) = (ty, tx), matching the existing
 * pixelPerpendicularUnit convention.
 *
 * @param {number} tx
 * @param {number} ty
 * @returns {{tx: number, ty: number, px: number, py: number}}
 */
function pixelTangentAndPerp(tx, ty) {
    const len = Math.hypot(tx, ty);
    if (len === 0) return { tx: 0, ty: 0, px: 0, py: 0 };
    return {
        tx: tx / len,
        ty: -ty / len,
        px: ty / len,
        py: tx / len,
    };
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
 * Compute the axis-aligned bounding box of a curve shape in
 * canvas units, or null when the shape is degenerate or not
 * yet implemented (bezier, helice). Used for selection-marker
 * rendering: the box is drawn just large enough to enclose
 * the full geometry.
 *
 * @param {import("./scene.js").CurveShape} shape
 * @returns {{x1: number, y1: number, x2: number, y2: number} | null}
 */
function curveBoundingBox(shape) {
    if (shape.type === "line") {
        return {
            x1: Math.min(shape.x1, shape.x2),
            y1: Math.min(shape.y1, shape.y2),
            x2: Math.max(shape.x1, shape.x2),
            y2: Math.max(shape.y1, shape.y2),
        };
    }
    if (shape.type === "ellipse") {
        return {
            x1: shape.cx - shape.w / 2,
            y1: shape.cy - shape.h / 2,
            x2: shape.cx + shape.w / 2,
            y2: shape.cy + shape.h / 2,
        };
    }
    if (shape.type === "piste") {
        const pts = shape.points;
        if (pts.length === 0) return null;
        let minX = pts[0][0], maxX = pts[0][0];
        let minY = pts[0][1], maxY = pts[0][1];
        for (let i = 1; i < pts.length; i++) {
            if (pts[i][0] < minX) minX = pts[i][0];
            if (pts[i][0] > maxX) maxX = pts[i][0];
            if (pts[i][1] < minY) minY = pts[i][1];
            if (pts[i][1] > maxY) maxY = pts[i][1];
        }
        return { x1: minX, y1: minY, x2: maxX, y2: maxY };
    }
    return null;
}

/**
 * Filter a set of array indexes to those still in range.
 * Used by setScene to prune selection entries that point
 * past the end of a scene's arrays after a reload.
 * @param {Set<number>} set
 * @param {number} max
 * @returns {Set<number>}
 */
function filterIndexSet(set, max) {
    const result = new Set();
    for (const i of set) {
        if (i < max) result.add(i);
    }
    return result;
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
