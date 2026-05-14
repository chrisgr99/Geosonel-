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
 * each event position derived from the curve's cyclePattern
 * (per section 28's marker layout interpretation: the parsed
 * Pattern is queried for one cycle's events, each event's
 * fractional begin position is mapped onto the curve's
 * geometry, and a small image-filled, blue-bordered diamond
 * is drawn there rotated so two opposite vertices lie along
 * the curve's tangent). The cursor (a perpendicular segment
 * when the cursor extent is non-zero, a small dot otherwise)
 * draws at the position the Simulation reports for that
 * curve. During playback the canvas runs a render loop driven
 * by transport's play event so the cursor advances
 * continuously; while paused, the cursor stays put. See
 * simulation.js for the cursor advancement model.
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
import { parsePatternToPositions } from "./strudel/patternParse.js";
import { buildOKLChBuffer } from "./strudel/oklch.js";

const DEFAULT_HALF_WIDTH = 16;   // \u00b116 units horizontally at zoom 1
const DEFAULT_HALF_HEIGHT = 12;  // \u00b112 units vertically at zoom 1

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;
const MENU_ZOOM_FACTOR = 1.2;    // one menu click / keyboard step
const WHEEL_ZOOM_FACTOR = 1.08;  // per wheel notch

// Colour palette for the grid. Sits quietly on the near-
// black background so the grid reads as reference rather
// than as content, but each tone is calibrated to be
// visible at the viewport sizes and zoom levels users
// actually compose at — the previous values (#3a/#4a/#60)
// were perceptually safe but slipped below the threshold
// where the eye registers structure on a busy canvas, so
// every tier is bumped one perceptual step. Minor lines
// stay subtle so a dense grid doesn't dominate; the major
// 5-unit grid carries enough contrast to anchor distance
// readings without competing with content; the axis line
// stays the brightest of the three so the origin is the
// strongest reference.
const BG_COLOUR = "#2a2a2a";
const MINOR_GRID_COLOUR = "#484848";
const MAJOR_GRID_COLOUR = "#5c5c5c";
const AXIS_COLOUR = "#7c7c7c";

// Canvas-region styling. The canvas rectangle is the
// playable area defined by scene.canvasW × scene.canvasH
// centred on the origin; sprites bounce off its walls and
// the image (when one is loaded) stretches to fill it. The
// area outside the canvas reads as a darker grey so the
// canvas boundary stands out even at zoom levels where the
// canvas is much smaller than the viewport.
//
// The border colour is deliberately brighter than the
// splitter lines elsewhere in the UI. At #777 the contrast
// against the canvas inside (#2a2a2a) was visible but soft
// — fine when an image was loaded, but easy to lose track
// of on an empty canvas where #2a2a2a fills the whole
// region. #b8b8b8 sits at roughly the same perceived
// brightness as the curve colour (#7dd68a, NTSC-luma
// ~179) while staying in pure greyscale, so the canvas
// boundary anchors the eye without competing with content
// for attention.
const CANVAS_OUTSIDE_COLOUR = "#181818";
const CANVAS_BORDER_COLOUR = "#b8b8b8";
const CANVAS_BORDER_WIDTH_PX = 3;

// Colours for scene elements. Curves are soft green, picking
// up on GeoSonix's accent colour. Pattern-event marker
// diamonds along a curve use the trigger's blue boundary
// colour since they share the trigger's visual treatment
// per section 28's marker layout interpretation (each
// marker is a miniature trigger bound to the curve at the
// pattern event's fractional position). Cursors are warm
// amber to stand out from everything else.
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
         * A 1000×1000 OKLCh buffer (four channels per pixel:
         * L, C, a, b stored as Float32) precomputed from
         * _imagePixels at image-load time. Used by the firing
         * engine's snapshot capture to read image-colour
         * values at firing-source positions without redoing
         * the sRGB-to-OKLCh conversion per event. Built
         * whenever _imagePixels is built; null when no image
         * is loaded or the build failed. Float32 storage
         * (16 MB for a 1000×1000 image) trades 4× the memory
         * of the source ImageData for full precision in the
         * OKLCh space, which is a fine deal for an image-
         * load cost paid once.
         * @type {Float32Array | null}
         */
        this._imageOKLCh = null;

        /**
         * The scene to render on top of the grid, or null if
         * no sketch has been run yet.
         * @type {import("./scene.js").Scene | null}
         */
        this._scene = null;

        /**
         * Cached pattern-event marker positions per curve,
         * keyed by curve id. Each value is the array of
         * fractional cycle positions (in [0, 1)) produced by
         * parsePatternToPositions for that curve's
         * cyclePattern at the time of the last refresh. The
         * canvas re-derives marker positions from this map
         * on every draw rather than re-parsing every frame,
         * which keeps draw cost flat regardless of pattern
         * complexity and keeps stochastic patterns visually
         * stable within a cycle (the positions only change
         * when the cache is refreshed). Refreshed on every
         * setScene call (so Cmd-Enter promote and any other
         * scene-reloading edit pick up the new positions)
         * and on strudel-runtime status change to "loaded"
         * (so a score whose patterns couldn't be parsed at
         * scene load — because the engine hadn't been
         * loaded yet — picks up its markers when the
         * engine becomes available). Curves whose patterns
         * are empty, fail to parse, or whose curve was
         * dropped from the scene are absent from the map;
         * absent entries render no markers.
         * @type {Map<string, number[]>}
         */
        this._curveMarkerPositions = new Map();

        /**
         * Transport reference. Used to subscribe to the
         * play and rewind events so the canvas can run a
         * continuous render loop during playback and
         * trigger a static redraw on rewind. Null until
         * setTransport is called from main.js.
         * @type {import("./transport.js").Transport | null}
         */
        this._transport = null;

        /**
         * Simulation reference. Queried at draw time for
         * current cursor positions per curve, and ticked
         * from the render loop to advance state. Null until
         * setSimulation is called from main.js. The cursor
         * render gracefully falls back to t = 0 when null,
         * so the canvas stays usable for static layout work
         * before main.js wires the simulation in.
         * @type {import("./simulation.js").Simulation | null}
         */
        this._simulation = null;

        /**
         * Pattern firing engine reference. Ticked from the
         * render loop right after the simulation tick so
         * audio output stays aligned to the simulation
         * state the canvas is about to paint. Null until
         * setFiringEngine is called from main.js; the
         * canvas remains fully usable without it (no
         * audio output, all visuals work).
         * @type {import("./strudel/firingEngine.js").PatternFiringEngine | null}
         */
        this._firingEngine = null;

        /**
         * requestAnimationFrame handle for the continuous
         * render loop that runs during playback. Non-null
         * only while playing. The loop schedules a draw on
         * every frame so the cursor advances visibly with
         * the music. cancelAnimationFrame uses this handle
         * on pause to tear the loop down.
         * @type {number | null}
         */
        this._playLoopId = null;

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
        this.canvasEl.addEventListener("dblclick", (e) => this._onDoubleClick(e));

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
        this._refreshCurveMarkerPositions();
        this.scheduleDraw();
    }

    /**
     * Re-parse every curve's cyclePattern and refresh the
     * cached marker positions. Public entry point used by
     * main.js when the strudel runtime transitions to
     * "loaded" so a score whose patterns couldn't be parsed
     * at scene load (no engine yet) picks up its markers
     * without requiring the user to re-run the scene.
     * Schedules a draw on the next frame so the new
     * markers become visible.
     */
    refreshMarkers() {
        this._refreshCurveMarkerPositions();
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
            this._imageOKLCh = null;
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
            // Also build the OKLCh buffer in parallel from
            // the unmodified original. The buffer is
            // consumed by the firing engine's snapshot
            // capture for dynamic image-colour signals
            // (Phase 4). Builds only when _imagePixels
            // succeeded; null when the source path failed
            // (typically a cross-origin taint that prevents
            // getImageData on the offscreen canvas).
            this._imageOKLCh = this._imagePixels === null
                ? null
                : buildOKLChBuffer(this._imagePixels);
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
            this._imageOKLCh = null;
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
     * Attach the transport so the canvas can run a
     * continuous render loop during playback and react to
     * rewinds while paused. Subscribes to the transport's
     * play and rewind events on attachment. Currently
     * called once at startup from main.js; not re-entrant.
     * @param {import("./transport.js").Transport} transport
     */
    setTransport(transport) {
        this._transport = transport;
        transport.on("play", () => this._onTransportPlayStateChange());
        transport.on("rewind", () => this._onTransportRewind());
    }

    /**
     * Attach the simulation so the canvas can advance state
     * before each draw and query current cursor positions.
     * Currently called once at startup from main.js after
     * the simulation is constructed.
     * @param {import("./simulation.js").Simulation} simulation
     */
    setSimulation(simulation) {
        this._simulation = simulation;
    }

    /**
     * Attach the pattern firing engine so the canvas can
     * tick it after the simulation each frame. The firing
     * engine reads simulation cycle state and commits
     * pattern events to the audio engine; ticking it from
     * the same loop as the simulation keeps the cycle-state
     * read consistent with what the canvas is about to
     * paint. Currently called once at startup from main.js
     * after the firing engine is constructed.
     * @param {import("./strudel/firingEngine.js").PatternFiringEngine} firingEngine
     */
    setFiringEngine(firingEngine) {
        this._firingEngine = firingEngine;
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
     * selection mode. If a create-ellipse gesture is in
     * progress when the tool disarms (typically via Esc),
     * the gesture is cancelled so the eventual mouseup
     * doesn't commit an ellipse the user has already
     * abandoned.
     * @param {string | null} toolName
     * @param {boolean} locked
     */
    setActiveTool(toolName, locked) {
        this._activeTool = toolName;
        this._activeToolLocked = locked;
        this.canvasEl.style.cursor = toolName === null ? "default" : "crosshair";
        if (toolName === null &&
            this._gesture !== null &&
            this._gesture.kind === "createEllipse") {
            this._gesture = null;
            this.scheduleDraw();
        }
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

    /**
     * React to a transport play/pause state change. Starts
     * the continuous render loop on play, tears it down on
     * pause. Idempotent in either direction so a redundant
     * event is safe.
     */
    _onTransportPlayStateChange() {
        if (this._transport === null) return;
        if (this._transport.isPlaying) {
            this._startPlayLoop();
        } else {
            this._stopPlayLoop();
        }
    }

    /**
     * React to a transport rewind. The simulation
     * auto-detects rewind via tick() observing
     * elapsedSeconds going backward, so all that's needed
     * here is a redraw to show the cursor at the reset
     * position. During playback the play loop already
     * redraws each frame so this is a coalesced no-op via
     * scheduleDraw; while paused it triggers the only
     * redraw that will happen.
     */
    _onTransportRewind() {
        this.scheduleDraw();
    }

    /**
     * Start the continuous render loop. Self-rescheduling
     * via requestAnimationFrame: each frame schedules a
     * draw and queues the next frame. The loop stops only
     * when _stopPlayLoop cancels the outstanding handle.
     * Idempotent: calling start while already running is a
     * no-op.
     */
    _startPlayLoop() {
        if (this._playLoopId !== null) return;
        const loop = () => {
            this._playLoopId = requestAnimationFrame(loop);
            this.scheduleDraw();
        };
        this._playLoopId = requestAnimationFrame(loop);
    }

    /**
     * Stop the continuous render loop. Cancels the pending
     * frame and clears the handle. Idempotent: calling stop
     * while not running is a no-op.
     */
    _stopPlayLoop() {
        if (this._playLoopId === null) return;
        cancelAnimationFrame(this._playLoopId);
        this._playLoopId = null;
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

        // Advance the simulation to the transport's current
        // time before drawing. tick() is idempotent within a
        // single elapsedSeconds value (the no-advance case
        // when paused costs only the time check), and
        // detects rewind internally by noticing
        // elapsedSeconds going backward. Drawing then reads
        // whatever state the sim is in via getCurveCursorT.
        if (this._simulation !== null) {
            this._simulation.tick();
        }

        // Tick the pattern firing engine after the
        // simulation so its read of cycle state reflects
        // any wraps that just happened. The firing engine
        // gates internally on transport.isPlaying and on
        // runtime status, so calls during pause or before
        // the engine has loaded are cheap no-ops.
        if (this._firingEngine !== null) {
            this._firingEngine.tick();
        }

        ctx.save();

        // Map the backing store's pixel space to CSS pixel space
        // for crisp high-dpi rendering. After this scale, all
        // drawing calls use CSS pixel coordinates.
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        ctx.fillStyle = CANVAS_OUTSIDE_COLOUR;
        ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        // Draw order: canvas-region fill (the playable area's
        // base colour), image as substrate, canvas border
        // outlining the playable area, grid as reference
        // overlay, scene elements on top as content.
        // Selection markers and the marquee rectangle sit on
        // top so they remain visible against any underlying
        // colour. The canvas border draws after the image so
        // it stays visible regardless of the image's edge
        // colour; the grid draws after the border so the
        // axis line doesn't break visually where it crosses
        // the border.
        this._fillCanvasRegion();
        this._drawImage();
        this._strokeCanvasBorder();
        this._drawGrid();
        this._drawScene();
        this._drawSelectionMarkers();
        this._drawMarqueeRect();
        this._drawCreateEllipseGesture();

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
            this._drawCurveMarkers(curve);
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

    _drawCurveMarkers(curve) {
        const positions = this._curveMarkerPositions.get(curve.id);
        if (positions === undefined || positions.length === 0) return;

        const ctx = this.ctx;

        // Markers render as miniature triggers per section
        // 28's marker layout interpretation: image-filled
        // with the trigger boundary colour, rotated so two
        // opposite vertices lie along the curve's tangent
        // at the sample point. Marker size is constant in
        // CSS pixels rather than scaled with zoom so the
        // markers stay legible at every zoom level without
        // disappearing when zoomed out or overwhelming the
        // curve when zoomed in. 5 px half-size sits a touch
        // above the typical trigger pixel radius at default
        // zoom, so a marker reads visually as a slightly
        // chunkier trigger — enough to register as a beat
        // position without competing with the curve itself.
        const halfPx = 5;

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = OBJECT_BOUNDARY_COLOUR;

        for (const t of positions) {
            const sample = sampleCurve(curve.shape, t);
            if (sample === null) continue;
            const px = this.toPixelX(sample.x);
            const py = this.toPixelY(sample.y);
            const axes = pixelTangentAndPerp(sample.tx, sample.ty);

            ctx.beginPath();
            ctx.moveTo(px + axes.tx * halfPx, py + axes.ty * halfPx);
            ctx.lineTo(px + axes.px * halfPx, py + axes.py * halfPx);
            ctx.lineTo(px - axes.tx * halfPx, py - axes.ty * halfPx);
            ctx.lineTo(px - axes.px * halfPx, py - axes.py * halfPx);
            ctx.closePath();

            ctx.fillStyle = this._sampleImageAt(sample.x, sample.y);
            ctx.fill();
            ctx.stroke();
        }
    }

    /**
     * Refresh the cached pattern-event marker positions for
     * every curve in the current scene. Walks the scene's
     * curves, parses each curve's cyclePattern via
     * parsePatternToPositions, and stores the resulting
     * positions in _curveMarkerPositions keyed by curve id.
     * Curves whose cyclePattern is empty, fails to parse
     * (e.g. strudel engine not loaded yet), or otherwise
     * produces no positions are absent from the map after
     * the refresh — absent entries render no markers, so
     * the visual outcome is a curve with no diamonds. The
     * map is cleared on every refresh so a curve that was
     * removed from the scene since the last refresh loses
     * its entry naturally.
     *
     * Cheap to call: parsing is fast (small patterns) and
     * runs only on setScene and on strudel-runtime status
     * transitions, not on every render-loop frame.
     */
    _refreshCurveMarkerPositions() {
        this._curveMarkerPositions.clear();
        if (this._scene === null) return;
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string" || curve.id.length === 0) continue;
            if (typeof curve.cyclePattern !== "string" || curve.cyclePattern.length === 0) continue;
            const result = parsePatternToPositions(curve.cyclePattern);
            if (!result.ok || result.positions.length === 0) continue;
            this._curveMarkerPositions.set(curve.id, result.positions);
        }
    }

    _drawCurveCursor(curve) {
        // Cursor-as-collider gate: a curve has a visible
        // cursor only when it has a non-zero extent AND is
        // not muted. Both extents zero, or mute checked,
        // means no cursor on the canvas. Per section 27's
        // cursor-as-collider model, cursor presence is what
        // makes the curve a collider and an audio source;
        // the visual gate matches the operational one.
        if (curve.cursorR === 0 && curve.cursorL === 0) return;
        if (curve.mute) return;

        const ctx = this.ctx;
        // Cursor parameter t comes from the simulation's
        // per-curve runtime state when wired; falls back to
        // 0 (start position) before setSimulation is called
        // or when the curve has no runtime state (transient
        // during scene reload). The visual default in either
        // fallback case is the cursor at the curve's start,
        // which is the right thing to show.
        const t = this._simulation === null
            ? 0
            : this._simulation.getCurveCursorT(curve.id);
        const sample = sampleCurve(curve.shape, t);
        if (sample === null) return;
        const px = this.toPixelX(sample.x);
        const py = this.toPixelY(sample.y);

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
            // Read the live runtime position from the
            // simulation when available so a moving sprite
            // renders where it actually is, not where its
            // authored x/y in scene.json points. During
            // pause or before the simulation has built
            // runtime state for a freshly-added sprite,
            // the helper falls back to authored values.
            const pos = this._spritePosition(s);
            const cx = this.toPixelX(pos.x);
            const cy = this.toPixelY(pos.y);
            const r = Math.max(4, (s.displayDiameter / 2) * scale * this.pixelsPerUnit);
            // Filled disc with a light-blue boundary — the fill
            // takes the colour of the image pixel under the
            // centre, the boundary keeps the sprite visible
            // against any background.
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = this._sampleImageAt(pos.x, pos.y);
            ctx.fill();
            ctx.strokeStyle = s.color;
            ctx.stroke();
        }
    }

    /**
     * Return the position at which a sprite should render
     * and hit-test. Reads the simulation's runtime state
     * when available (so a sprite moving under sprite
     * physics, or one whose drag has already snapped
     * runtime via the simulation's snapSpriteRuntimeToAuthored
     * hook, renders at its visible position) and falls
     * back to the sprite's authored x/y when the simulation
     * hasn't yet built runtime state for this id (briefly,
     * during a scene reload where setScene hasn't run yet).
     * @param {any} sprite
     * @returns {{x: number, y: number}}
     */
    _spritePosition(sprite) {
        if (this._simulation !== null && typeof sprite.id === "string") {
            const rt = this._simulation.getSpriteRuntime(sprite.id);
            if (rt !== null) return { x: rt.x, y: rt.y };
        }
        return { x: sprite.x, y: sprite.y };
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
            const pos = this._spritePosition(s);
            const cx = this.toPixelX(pos.x);
            const cy = this.toPixelY(pos.y);
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

    /**
     * Render the in-progress ellipse-creation gesture. Draws
     * the bounding box as a yellow dotted rectangle (matching
     * the selection-marker convention so the user reads it
     * as "about to become a curve") and the inscribed
     * ellipse in solid curve-green so the eventual geometry
     * is visible live as the corner is dragged. Shift-held
     * collapses the bounding box to a square in the same
     * pre-commit logic the mouseup handler uses, so the
     * preview matches what gets committed.
     */
    _drawCreateEllipseGesture() {
        if (this._gesture === null || this._gesture.kind !== "createEllipse") return;
        const g = this._gesture;

        // Apply the Shift-constrain-to-square modifier so the
        // preview tracks what the mouseup commit will produce.
        let x1 = g.startX;
        let y1 = g.startY;
        let x2 = g.currentX;
        let y2 = g.currentY;
        if (g.shiftKey) {
            const adx = Math.abs(x2 - x1);
            const ady = Math.abs(y2 - y1);
            const size = Math.max(adx, ady);
            const sx = x2 >= x1 ? 1 : -1;
            const sy = y2 >= y1 ? 1 : -1;
            x2 = x1 + sx * size;
            y2 = y1 + sy * size;
        }

        const lo_x = Math.min(x1, x2);
        const hi_x = Math.max(x1, x2);
        const lo_y = Math.min(y1, y2);
        const hi_y = Math.max(y1, y2);

        // Pixel-space rectangle. Canvas Y is up, pixel Y is
        // down, so the rect's top in pixel space corresponds
        // to hi_y in canvas units.
        const pxL = this.toPixelX(lo_x);
        const pxR = this.toPixelX(hi_x);
        const pyT = this.toPixelY(hi_y);
        const pyB = this.toPixelY(lo_y);

        const ctx = this.ctx;
        ctx.save();

        // Yellow dotted bounding box, same style as selection
        // markers around already-selected objects.
        ctx.strokeStyle = SELECTION_MARKER_COLOUR;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(
            Math.round(pxL) + 0.5,
            Math.round(pyT) + 0.5,
            Math.round(pxR - pxL),
            Math.round(pyB - pyT),
        );

        // Live ellipse inscribed in the bounding box, in
        // curve-green so the eventual on-canvas shape is
        // visible as the user drags.
        ctx.setLineDash([]);
        ctx.strokeStyle = CURVE_COLOUR;
        ctx.lineWidth = 1.5;
        const cx = (pxL + pxR) / 2;
        const cy = (pyT + pyB) / 2;
        const rx = (pxR - pxL) / 2;
        const ry = (pyB - pyT) / 2;
        if (rx > 0 && ry > 0) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

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
            // Hit-test against the visible position so a
            // click on a moving sprite catches it where
            // the user sees it, not where its authored
            // position lives in scene.json.
            const pos = this._spritePosition(s);
            const dx = canvasX - pos.x;
            const dy = canvasY - pos.y;
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
        // performing selection. Sprite and trigger tools are
        // click-to-place (the edit fires on mousedown and the
        // tool reverts immediately via afterPlacement). The
        // curve tool is drag-to-define-ellipse: mousedown
        // starts a createEllipse gesture, mouseup commits it.
        if (this._activeTool !== null) {
            e.preventDefault();
            if (this._activeTool === "sprite" || this._activeTool === "trigger") {
                if (this._editCallback !== null) {
                    this._editCallback({
                        kind: this._activeTool === "sprite" ? "addSprite" : "addTrigger",
                        x: pos.x,
                        y: pos.y,
                    });
                }
                if (this._toolbar !== null) {
                    this._toolbar.afterPlacement();
                }
                return;
            }
            if (this._activeTool === "curve") {
                this._gesture = {
                    kind: "createEllipse",
                    startX: pos.x,
                    startY: pos.y,
                    currentX: pos.x,
                    currentY: pos.y,
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
                this.scheduleDraw();
                return;
            }
            // Unknown tool name — ignore the click but still
            // disarm via afterPlacement so the toolbar can
            // recover. Defensive only; the toolbar's TOOL_DEFS
            // and the canvas's tool-name branches are kept in
            // sync at the source.
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

            // Threshold crossed. The gesture transitions
            // into a drag (any object hit — sprites,
            // triggers, and curves all share the unified
            // translateSelection pipeline) or a marquee
            // (click on empty space). Hit-on-already-
            // selected drags the entire current selection
            // across all three kinds together; hit-on-
            // unselected replaces the selection with that
            // one object and drags it.
            if (g.hit !== null) {
                /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
                let dragSelection;
                if (g.wasSelected) {
                    dragSelection = {
                        sprites: Array.from(this._selection.sprites),
                        triggers: Array.from(this._selection.triggers),
                        curves: Array.from(this._selection.curves),
                    };
                } else {
                    dragSelection = {
                        sprites: g.hit.kind === "sprite" ? [g.hit.index] : [],
                        triggers: g.hit.kind === "trigger" ? [g.hit.index] : [],
                        curves: g.hit.kind === "curve" ? [g.hit.index] : [],
                    };
                    this._selection = {
                        sprites: new Set(dragSelection.sprites),
                        triggers: new Set(dragSelection.triggers),
                        curves: new Set(dragSelection.curves),
                    };
                    this._emitSelectionChanged();
                }
                /** @type {Map<number, {x: number, y: number}>} */
                const initialSpritePositions = new Map();
                /** @type {Map<number, {x: number, y: number}>} */
                const initialTriggerPositions = new Map();
                /** @type {Map<number, any>} */
                const initialCurveShapes = new Map();
                if (this._scene !== null) {
                    for (const idx of dragSelection.sprites) {
                        if (idx < this._scene.sprites.length) {
                            const s = this._scene.sprites[idx];
                            initialSpritePositions.set(idx, { x: s.x, y: s.y });
                        }
                    }
                    for (const idx of dragSelection.triggers) {
                        if (idx < this._scene.triggers.length) {
                            const t = this._scene.triggers[idx];
                            initialTriggerPositions.set(idx, { x: t.x, y: t.y });
                        }
                    }
                    for (const idx of dragSelection.curves) {
                        if (idx < this._scene.curves.length) {
                            const c = this._scene.curves[idx];
                            initialCurveShapes.set(idx, snapshotShapeCoords(c.shape));
                        }
                    }
                }
                this._gesture = {
                    kind: "drag",
                    startX: g.startX,
                    startY: g.startY,
                    dragSelection,
                    initialSpritePositions,
                    initialTriggerPositions,
                    initialCurveShapes,
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
                for (const [idx, init] of g.initialSpritePositions) {
                    if (idx < this._scene.sprites.length) {
                        this._scene.sprites[idx].x = init.x + dx;
                        this._scene.sprites[idx].y = init.y + dy;
                        // Push the new authored position into
                        // the simulation's runtime so the
                        // visual feedback (which reads runtime
                        // at draw time) tracks the cursor. The
                        // sim hook updates only position, not
                        // velocity, so a sprite mid-flight
                        // doesn't have its velocity disturbed
                        // by the drag.
                        if (this._simulation !== null) {
                            this._simulation.snapSpriteRuntimeToAuthored(
                                this._scene.sprites[idx],
                            );
                        }
                    }
                }
                for (const [idx, init] of g.initialTriggerPositions) {
                    if (idx < this._scene.triggers.length) {
                        this._scene.triggers[idx].x = init.x + dx;
                        this._scene.triggers[idx].y = init.y + dy;
                    }
                }
                for (const [idx, initShape] of g.initialCurveShapes) {
                    if (idx < this._scene.curves.length) {
                        applyShapeCoordsTranslation(
                            this._scene.curves[idx].shape,
                            initShape,
                            dx,
                            dy,
                        );
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

        if (g.kind === "createEllipse") {
            g.currentX = pos.x;
            g.currentY = pos.y;
            // Re-read the shift state on every move so the
            // user can toggle the constrain-to-circle modifier
            // mid-drag and see the preview snap accordingly.
            g.shiftKey = e.shiftKey;
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
                // Cumulative delta from drag start to the
                // mouseup position. Live-drag has already
                // mutated runtime objects in place for
                // visual feedback; the persisted edit
                // re-applies the same delta to scene.json
                // through translateSelection, which is
                // idempotent with the live mutations
                // because runScene reloads the scene from
                // the freshly-written JSON anyway.
                const pos = this._eventToCanvas(e);
                const dx = pos.x - g.startX;
                const dy = pos.y - g.startY;
                this._editCallback({
                    kind: "translateSelection",
                    selection: g.dragSelection,
                    dx,
                    dy,
                });
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
                // Sprites use their visible position so a
                // marquee drawn around a moving sprite catches
                // it where the user sees it.
                for (let i = 0; i < this._scene.sprites.length; i++) {
                    const s = this._scene.sprites[i];
                    const pos = this._spritePosition(s);
                    if (pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2) {
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
        if (g.kind === "createEllipse") {
            // Recompute the ellipse bounding box from the
            // gesture's start and current points, applying
            // the Shift-constrain-to-square modifier if held
            // at mouseup. (Move events also track shiftKey,
            // but the final commit reads the mouseup state so
            // an end-of-drag modifier release matches the
            // visible preview.)
            let x1 = g.startX;
            let y1 = g.startY;
            let x2 = g.currentX;
            let y2 = g.currentY;
            const shiftAtUp = e.shiftKey || g.shiftKey;
            if (shiftAtUp) {
                const adx = Math.abs(x2 - x1);
                const ady = Math.abs(y2 - y1);
                const size = Math.max(adx, ady);
                const sx = x2 >= x1 ? 1 : -1;
                const sy = y2 >= y1 ? 1 : -1;
                x2 = x1 + sx * size;
                y2 = y1 + sy * size;
            }
            // Below-threshold drags (essentially a click with
            // no measurable motion) abort without committing
            // and without disarming the tool, so the user can
            // try again from the same armed state. Above-
            // threshold drags commit a new curve and call
            // afterPlacement to revert the tool when not
            // locked.
            const dPx = Math.hypot(
                (x2 - x1) * this.pixelsPerUnit,
                (y2 - y1) * this.pixelsPerUnit,
            );
            if (dPx < DRAG_THRESHOLD_PX) {
                this.scheduleDraw();
                return;
            }
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);
            if (this._editCallback !== null) {
                this._editCallback({
                    kind: "addCurve",
                    shape: { type: "ellipse", cx, cy, w, h },
                });
            }
            if (this._toolbar !== null) {
                this._toolbar.afterPlacement();
            }
            this.scheduleDraw();
            return;
        }
    }

    /**
     * Double-click on a canvas object emits an
     * openObjectInCode edit so external host code can
     * switch to the Code tab and scroll to the object's
     * source. Double-click on empty canvas background
     * emits a toggleTransport edit so external host code
     * can play/pause the transport. Single clicks that
     * precede the dblclick event have already flowed
     * through the normal mousedown / mouseup gesture
     * state machine, so any object on the background gets
     * selected (or deselected) on the singles; the
     * dblclick's job is just to emit the navigation or
     * transport intent.
     *
     * Ignored when a creation tool is armed (under a tool
     * the natural reading of two quick clicks is "place
     * two objects", not "navigate to source or toggle
     * transport"), or when no edit callback is wired.
     *
     * @param {MouseEvent} e
     */
    _onDoubleClick(e) {
        if (e.button !== 0) return;
        if (this._activeTool !== null) return;
        if (this._editCallback === null) return;
        const pos = this._eventToCanvas(e);
        if (this._scene !== null) {
            const hit = this._hitTestObject(pos.x, pos.y);
            if (hit !== null) {
                let obj;
                if (hit.kind === "sprite") obj = this._scene.sprites[hit.index];
                else if (hit.kind === "trigger") obj = this._scene.triggers[hit.index];
                else obj = this._scene.curves[hit.index];
                if (obj === undefined || typeof obj.id !== "string") return;
                this._editCallback({
                    kind: "openObjectInCode",
                    objectId: obj.id,
                });
                return;
            }
        }
        // Double-click landed on empty background — toggle
        // the transport play state. Convenient for testing
        // patterns: start playback with two quick clicks on
        // an empty area of the canvas, stop the same way.
        this._editCallback({ kind: "toggleTransport" });
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
     * CSS rgb() string. The image fills the scene's canvas
     * region (canvasW × canvasH centred on the origin), so
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
        //   u: x in [-halfW, halfW] → [0, 1] left-to-right
        //   v: y in [halfH, -halfH] → [0, 1] top-to-bottom
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
    }

    /**
     * Sample the precomputed OKLCh values at canvas position
     * (x, y). Returns a {L, C, a, b} object, or null when the
     * position is outside the canvas region or no image is
     * loaded. Used by the firing engine's snapshot capture
     * for dynamic image-colour signals (Phase 4) such as
     * pxLt.
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
        if (this._imageOKLCh === null) return null;
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
            L: this._imageOKLCh[idx],
            C: this._imageOKLCh[idx + 1],
            a: this._imageOKLCh[idx + 2],
            b: this._imageOKLCh[idx + 3],
        };
    }

    /**
     * Return the canvas-space (x, y) position of a curve's
     * cursor at its current simulation t. Returns null when
     * the scene isn't loaded, the curve isn't in the scene,
     * the simulation hasn't built runtime state yet, or the
     * curve's geometry is degenerate (sampleCurve returns
     * null for the t). Used by the firing engine's snapshot
     * capture so dynamic image-colour signals can read the
     * image pixel under a curve's cursor at its current
     * sweep position.
     *
     * Sprites already expose canvas position via the
     * simulation's getSpriteRuntime, so the firing engine
     * reads sprite positions directly; this method completes
     * the symmetry for curves, whose runtime state holds
     * only the parametric cursor t. Canvas-space xy for a
     * curve is derived from t plus the curve's shape via the
     * sampleCurve helper that is module-private to this
     * file.
     *
     * @param {string} curveId
     * @returns {{x: number, y: number} | null}
     */
    getCurveCursorCanvasPosition(curveId) {
        if (this._scene === null) return null;
        if (this._simulation === null) return null;
        let foundCurve = null;
        for (const curve of this._scene.curves) {
            if (curve !== null && typeof curve === "object" && curve.id === curveId) {
                foundCurve = curve;
                break;
            }
        }
        if (foundCurve === null) return null;
        const t = this._simulation.getCurveCursorT(curveId);
        const sample = sampleCurve(foundCurve.shape, t);
        if (sample === null) return null;
        return { x: sample.x, y: sample.y };
    }

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
    }

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
    }

    /**
     * Fill the canvas region (the rectangle
     * canvasW × canvasH centred on the origin) with the
     * canvas-inside colour. Drawn before the image so an
     * empty canvas (no image loaded) reads as a slightly-
     * lighter rectangle against the dark surround. Drawn
     * after the surround fill so we don't have to compute
     * the four-rectangle frame around the canvas — just
     * paint the whole pane dark, then paint the canvas
     * region back to its lighter tone.
     */
    _fillCanvasRegion() {
        const ctx = this.ctx;
        const halfW = this._getCanvasW() / 2;
        const halfH = this._getCanvasH() / 2;
        const left = this.toPixelX(-halfW);
        const right = this.toPixelX(halfW);
        const top = this.toPixelY(halfH);
        const bottom = this.toPixelY(-halfH);
        ctx.fillStyle = BG_COLOUR;
        ctx.fillRect(left, top, right - left, bottom - top);
    }

    /**
     * Stroke a border around the canvas region in the same
     * grey and thickness as the splitter lines elsewhere in
     * the UI. The stroke is centred on the canvas-region
     * boundary, so half the line width sits inside the
     * canvas and half outside; the rectangle's stroked area
     * therefore frames the canvas precisely. Drawn after the
     * image so the border isn't covered by image pixels at
     * the canvas edges.
     */
    _strokeCanvasBorder() {
        const ctx = this.ctx;
        const halfW = this._getCanvasW() / 2;
        const halfH = this._getCanvasH() / 2;
        const left = this.toPixelX(-halfW);
        const right = this.toPixelX(halfW);
        const top = this.toPixelY(halfH);
        const bottom = this.toPixelY(-halfH);
        ctx.strokeStyle = CANVAS_BORDER_COLOUR;
        ctx.lineWidth = CANVAS_BORDER_WIDTH_PX;
        ctx.strokeRect(left, top, right - left, bottom - top);
    }

    _drawImage() {
        if (this._imageBitmap === null) return;
        const ctx = this.ctx;
        // The image stretches to fill the scene's canvas
        // region (canvasW × canvasH centred on the origin),
        // regardless of the canvas pane's aspect ratio or the
        // source image's true aspect ratio. Mismatched
        // aspects distort. This keeps the image-pixel-to-
        // canvas-position mapping (used by trigger and sprite
        // fills via _sampleImageAt) trivially axis-aligned.
        const halfW = this._getCanvasW() / 2;
        const halfH = this._getCanvasH() / 2;
        const left = this.toPixelX(-halfW);
        const right = this.toPixelX(halfW);
        const top = this.toPixelY(halfH);
        const bottom = this.toPixelY(-halfH);
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
 * Capture a deep-enough copy of a curve shape's coordinate
 * fields, used at drag start so the live-drag loop can
 * translate the shape from its original position each
 * frame by the cumulative cursor delta. Per shape type:
 *   - line: { x1, y1, x2, y2 }
 *   - ellipse: { cx, cy }     (w/h aren't translated)
 *   - piste: { points: [[x, y], ...] }    (deep copy)
 *   - other shape types or a degenerate shape: null;
 *     applyShapeCoordsTranslation silently skips these so
 *     a curve in a not-yet-implemented shape category
 *     stays selectable but doesn't move during the drag.
 *     The authoritative drag-end edit still goes through
 *     and sceneEditor.translateSelection follows the same
 *     skip behaviour.
 *
 * Coordinate fields are read with defensive defaults so a
 * partially-formed runtime shape doesn't crash the
 * snapshot.
 *
 * @param {any} shape
 * @returns {any}
 */
function snapshotShapeCoords(shape) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return null;
    if (shape.type === "line") {
        return {
            type: "line",
            x1: typeof shape.x1 === "number" ? shape.x1 : 0,
            y1: typeof shape.y1 === "number" ? shape.y1 : 0,
            x2: typeof shape.x2 === "number" ? shape.x2 : 0,
            y2: typeof shape.y2 === "number" ? shape.y2 : 0,
        };
    }
    if (shape.type === "ellipse") {
        return {
            type: "ellipse",
            cx: typeof shape.cx === "number" ? shape.cx : 0,
            cy: typeof shape.cy === "number" ? shape.cy : 0,
        };
    }
    if (shape.type === "piste") {
        if (!Array.isArray(shape.points)) return null;
        return {
            type: "piste",
            points: shape.points.map((p) =>
                Array.isArray(p) && p.length >= 2
                    ? [
                        typeof p[0] === "number" ? p[0] : 0,
                        typeof p[1] === "number" ? p[1] : 0,
                    ]
                    : [0, 0]
            ),
        };
    }
    return null;
}

/**
 * Translate a runtime curve shape by (dx, dy) in canvas
 * units, using the captured initial coordinates as the
 * base so the cumulative delta from drag start applies
 * cleanly without floating-point drift across many small
 * mouse-move events. Mirrors the per-type behaviour in
 * sceneEditor.translateShape but without the roundCoord
 * step — this is visual feedback only; the authoritative
 * mutation goes through the translateSelection edit on
 * drag end.
 *
 * If the snapshot is null (degenerate or unsupported
 * shape type at drag start) or the shape's type changed
 * between drag start and now (e.g. an external reload
 * mid-drag), translation is silently skipped. The
 * drag-end edit fires regardless and operates on whatever
 * is currently in scene.json.
 *
 * @param {any} shape  The runtime shape to mutate.
 * @param {any} initialCoords  The drag-start snapshot.
 * @param {number} dx
 * @param {number} dy
 */
function applyShapeCoordsTranslation(shape, initialCoords, dx, dy) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return;
    if (initialCoords === null) return;
    if (initialCoords.type !== shape.type) return;
    if (shape.type === "line") {
        shape.x1 = initialCoords.x1 + dx;
        shape.y1 = initialCoords.y1 + dy;
        shape.x2 = initialCoords.x2 + dx;
        shape.y2 = initialCoords.y2 + dy;
    } else if (shape.type === "ellipse") {
        shape.cx = initialCoords.cx + dx;
        shape.cy = initialCoords.cy + dy;
    } else if (shape.type === "piste") {
        if (!Array.isArray(shape.points)) return;
        const pts = initialCoords.points;
        const n = Math.min(shape.points.length, pts.length);
        for (let i = 0; i < n; i++) {
            const p = shape.points[i];
            if (Array.isArray(p) && p.length >= 2) {
                p[0] = pts[i][0] + dx;
                p[1] = pts[i][1] + dy;
            }
        }
    }
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
