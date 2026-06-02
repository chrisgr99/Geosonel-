// @ts-check
import {
  AUTO_ZOOM_MARGIN_PX, DEFAULT_HALF_HEIGHT, DEFAULT_HALF_WIDTH,
  MAX_ZOOM, MENU_ZOOM_FACTOR, MIN_ZOOM, WHEEL_ZOOM_FACTOR,
} from "./canvasShared.js";

export const viewportMethods = {

    zoomIn() {
        // Manual zoom is gated off while Auto Zoom holds
        // the canvas at a fitted size; the View menu greys
        // the corresponding entry out for the same reason.
        if (this._autoZoom) return;
        this._setZoom(this.zoom * MENU_ZOOM_FACTOR);
    },
    zoomOut() {
        if (this._autoZoom) return;
        this._setZoom(this.zoom / MENU_ZOOM_FACTOR);
    },
    resetZoom() {
        if (this._autoZoom) return;
        this._setZoom(1);
    },
    /**
     * Read the Auto Zoom flag. Used by viewMenu.js to drive
     * the checked state of the Auto Zoom menu item and the
     * disabled state of the Zoom In / Zoom Out / Reset Zoom
     * items.
     * @returns {boolean}
     */
    getAutoZoom() {
        return this._autoZoom;
    },
    /**
     * Enable or disable Auto Zoom. When transitioning from
     * off to on, the current pane size and canvas dimensions
     * are read and the zoom is set so the fence fills the
     * pane with AUTO_ZOOM_MARGIN_PX of slack on each side.
     * When transitioning from on to off, the current zoom
     * value is left as-is -- the user keeps the zoomed-to-fit
     * view they were already looking at, and the manual
     * controls become responsive again from there. Calls
     * with the value already in effect are no-ops.
     * @param {boolean} on
     */
    setAutoZoom(on) {
        const next = Boolean(on);
        if (this._autoZoom === next) return;
        this._autoZoom = next;
        if (next) {
            this._applyAutoZoom();
        }
    },
    /** @param {number} canvasX */
    toPixelX(canvasX) {
        return this.cssWidth / 2 + canvasX * this.pixelsPerUnit;
    },
    /** @param {number} canvasY */
    toPixelY(canvasY) {
        return this.cssHeight / 2 - canvasY * this.pixelsPerUnit;
    },
    /** @param {number} pixelX */
    fromPixelX(pixelX) {
        return (pixelX - this.cssWidth / 2) / this.pixelsPerUnit;
    },
    /** @param {number} pixelY */
    fromPixelY(pixelY) {
        return -(pixelY - this.cssHeight / 2) / this.pixelsPerUnit;
    },
    _setZoom(z) {
        const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
        if (clamped === this.zoom) return;
        this.zoom = clamped;
        this._recomputeTransform();
        this.scheduleDraw();
    },
    _onWheel(/** @type {WheelEvent} */ e) {
        // preventDefault unconditionally so a Cmd-wheel
        // never page-zooms the browser, regardless of
        // whether Auto Zoom is consuming the event or the
        // manual zoom is about to act on it.
        e.preventDefault();
        if (this._autoZoom) return;
        // Trackpad pinches and mouse wheels both arrive as wheel
        // events. A negative deltaY means zoom in (scroll up).
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
        this._setZoom(this.zoom * factor);
    },
    _onResize() {
        const rect = this.container.getBoundingClientRect();
        this.cssWidth = rect.width;
        this.cssHeight = rect.height;

        // Skip when the container has collapsed to zero -- can
        // happen during focus-mode toggles or transient layout
        // states.
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

        // Resize the backing store to match CSS size x dpr so
        // the drawing stays crisp on retina displays.
        this.canvasEl.width = Math.round(this.cssWidth * this.dpr);
        this.canvasEl.height = Math.round(this.cssHeight * this.dpr);

        this._recomputeTransform();
        // Re-fit when Auto Zoom is active: a divider drag,
        // a window resize, or a Focus Canvas toggle has
        // just changed the pane size, and the fitted zoom
        // needs to track. _applyAutoZoom calls _setZoom
        // which itself calls _recomputeTransform and
        // scheduleDraw, so the redraw at the bottom of this
        // method is harmless (coalesced by
        // scheduleDraw's drawScheduled flag).
        if (this._autoZoom) {
            this._applyAutoZoom();
        }
        this.scheduleDraw();
    },
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
    },
    /**
     * Compute and apply the zoom value that fits the canvas
     * (the scene's canvasW x canvasH playable region) inside
     * the current pane size, with AUTO_ZOOM_MARGIN_PX of
     * slack on each side. Called whenever Auto Zoom has just
     * been enabled, the pane has just resized, or the
     * scene's canvasW / canvasH have just changed.
     *
     * Derivation: at any zoom the canvas's pixels-per-unit
     * is zoom * basePpu, where basePpu is the value at
     * zoom 1 that makes the legacy +/-16 / +/-12 region fit the
     * pane (i.e. 1 / max(2 * DEFAULT_HALF_WIDTH / cssWidth,
     * 2 * DEFAULT_HALF_HEIGHT / cssHeight)). To fit a region
     * of size canvasW x canvasH with margin m on each side,
     * the binding axis sets
     *   ppuTarget = min((cssWidth - 2m) / canvasW,
     *                   (cssHeight - 2m) / canvasH)
     * and the auto-zoom value is ppuTarget / basePpu.
     * _setZoom clamps to MIN_ZOOM / MAX_ZOOM so extreme
     * canvas-to-pane ratios still produce a valid zoom.
     *
     * Skips silently when the pane has collapsed to zero or
     * the scene's canvas dimensions are non-positive, so a
     * transient state during a Focus Canvas toggle or an
     * incomplete scene edit doesn't crash on a divide-by-
     * zero or write nonsense into this.zoom.
     */
    _applyAutoZoom() {
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
        const canvasW = this._getCanvasW();
        const canvasH = this._getCanvasH();
        if (canvasW <= 0 || canvasH <= 0) return;
        const m = AUTO_ZOOM_MARGIN_PX;
        const availW = this.cssWidth - 2 * m;
        const availH = this.cssHeight - 2 * m;
        if (availW <= 0 || availH <= 0) return;
        const ppuTarget = Math.min(availW / canvasW, availH / canvasH);
        const baseUnitsPerPixel = Math.max(
            (2 * DEFAULT_HALF_WIDTH) / this.cssWidth,
            (2 * DEFAULT_HALF_HEIGHT) / this.cssHeight,
        );
        const basePpu = 1 / baseUnitsPerPixel;
        if (!Number.isFinite(basePpu) || basePpu <= 0) return;
        const autoZoomValue = ppuTarget / basePpu;
        if (!Number.isFinite(autoZoomValue) || autoZoomValue <= 0) return;
        // _setZoom handles clamping to MIN_ZOOM / MAX_ZOOM,
        // recomputing the transform, and scheduling a draw.
        // _setZoom bypasses the _autoZoom gate (which only
        // guards the user-facing zoom methods), so calling
        // it from here while _autoZoom is true is correct.
        this._setZoom(autoZoomValue);
    },
    /**
     * Return the scene's canvas width in canvas units, or
     * the legacy default (32) when no scene is loaded. The
     * default matches the pre-canvas-size hardcoded image
     * region so a freshly-mounted Canvas with no scene yet
     * renders the same playable rectangle that older
     * versions drew.
     * @returns {number}
     */
    _getCanvasW() {
        if (this._scene !== null && typeof this._scene.canvasW === "number" && this._scene.canvasW > 0) {
            return this._scene.canvasW;
        }
        return 32;
    },
    /**
     * Return the scene's canvas height in canvas units, or
     * the legacy default (24) when no scene is loaded.
     * @returns {number}
     */
    _getCanvasH() {
        if (this._scene !== null && typeof this._scene.canvasH === "number" && this._scene.canvasH > 0) {
            return this._scene.canvasH;
        }
        return 24;
    },
};
