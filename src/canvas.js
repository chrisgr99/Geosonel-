/**
 * Canvas module.
 *
 * Owns the HTML canvas element where the scene is drawn, plus
 * the coordinate transform between canvas units (origin-centred
 * Cartesian, equal metric, Y up) and device pixels.
 *
 * At this milestone the only thing drawn is the reference grid.
 * Future milestones add background image rendering, event
 * glyphs, projector shapes with sweep points, mover dots with
 * trails, and optional vector-field visualisation.
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

        this._drawGrid();

        ctx.restore();
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
