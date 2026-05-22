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
 * When a curve carries non-zero velocity, the Simulation
 * reports a runtime (dx, dy) offset that this module
 * composes on top of the authored geometry by translating
 * the drawing context before painting that curve
 * (geometry, markers, and cursor all shift together). The
 * authored shape on disk stays untouched; the visible
 * curve drifts and bounces with the simulation's physics.
 * The offset is in canvas units, so the pixel-space
 * translation is (dx * pixelsPerUnit, -dy * pixelsPerUnit)
 * to honour the canvas-Y-up / pixel-Y-down flip.
 * Hit-testing for click, hover, and marquee-select reads
 * curve geometry through the runtime offset so a curve
 * that has drifted from its authored position is still
 * grabbable where the user sees it; selection markers and
 * resize handles likewise sit at the visible bounding box.
 * Drag gestures split based on whether the dragged
 * object is at its home position. A curve at home (zero
 * runtime offset) or a sprite at home (runtime x, y
 * equals authored x, y) is moved by mutating the
 * authored shape / x, y and emitting a
 * translateSelection edit on mouseup, a permanent move
 * that updates State-at-Start in the inspector. An
 * object away from home is moved by adjusting only its
 * runtime state via setCurveRuntimeOffset (curves) or
 * setSpriteRuntimePositionOnly (sprites); no scene edit
 * fires, the inspector's State-at-Start row stays
 * untouched, and the next rewind returns the object to
 * its unchanged home. To permanently move a moving
 * object the user rewinds it first, then drags from the
 * now-at-home position.
 *
 * Resize gestures on curves always fold the runtime
 * offset into the authored shape at gesture start (see
 * bakeCurveOffsetIntoAuthored in simulation.js) and then
 * edit the now-at-home shape, regardless of the offset
 * state. The fold keeps the visible position unchanged
 * across the gesture so the resize handles' anchor and
 * the resulting scale align with what the user sees.
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

// Margin, in CSS pixels, between the canvas fence and the
// pane edge when Auto Zoom is active. The canvas border is
// drawn as a stroke centred on the fence's logical edge,
// CANVAS_BORDER_WIDTH_PX pixels wide, so the outer edge of
// the border sits 1.5 px outside the logical edge. With a
// 4 px margin between logical edge and pane edge, the
// visible gap between the drawn border and the pane edge is
// about 2.5 px — enough that the fence reads as a distinct
// rectangle rather than blending into the pane boundary,
// which is the whole point of running Auto Zoom one step
// shy of an exact pixel-perfect fit.
const AUTO_ZOOM_MARGIN_PX = 4;

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

// Hover-brighten parameters. When the mouse pointer rests on
// a canvas object (sprite, trigger, or curve) for longer than
// HOVER_DEBOUNCE_MS, the object's outline brightens (its
// stroke colour lerps toward white by HOVER_LIGHTEN_RATIO and
// its line width gains HOVER_LINE_WIDTH_BONUS pixels) to
// signal the object is hoverable. The debounce makes
// pass-through moves quiet: rapidly flicking the pointer
// across the canvas does not cause every object in its path
// to flash brighter — only deliberate hovering does. The
// debounce restarts on every change of hit target, so moving
// from one object to another briefly shows neither as
// brightened until the pointer settles on the second.
const HOVER_DEBOUNCE_MS = 150;
const HOVER_LIGHTEN_RATIO = 0.4;
const HOVER_LINE_WIDTH_BONUS = 1.5;

// Resize-handle parameters. Eight small yellow squares
// drawn on the selection's bounding box — four corners
// (tl, tr, bl, br) plus four edge midpoints (t, b, l, r)
// — let the user resize the selection by dragging. The
// handle hovered by the pointer grows slightly larger to
// signal it is drag-actionable; the cursor also shifts to
// the appropriate resize variant (nwse-resize, nesw-
// resize, ns-resize, ew-resize) so the gesture intent is
// unambiguous before the mousedown.
//
// HANDLE_HIT_PADDING_PX widens the hit rectangle slightly
// past the rendered handle so the gesture stays
// forgiving even at the idle (smaller) size — the user
// doesn't have to pixel-aim to grab a handle. The
// rendered colour matches SELECTION_MARKER_COLOUR so the
// handles read as siblings of the dotted selection
// marquee.
const HANDLE_SIZE_PX = 8;
const HANDLE_HOVER_SIZE_PX = 12;
const HANDLE_HIT_PADDING_PX = 2;
const HANDLE_FILL_COLOUR = "#ffd24a";
const HANDLE_STROKE_COLOUR = "#1a1a1a";

// Identification tooltip parameters. Pointer that rests
// on a canvas object (sprite, trigger, curve, curve
// cursor, or curve beat-point marker) for longer than
// TOOLTIP_DELAY_MS produces an inline tooltip below-and-
// right of the pointer showing the object's kind and id.
// Hit thresholds for the small overlay targets (the
// perpendicular cursor segment and the beat-point
// diamonds) are kept tight so an adjacent hit on the
// larger underlying curve geometry doesn't preempt them.
// Top-level objects (sprites, triggers, curves) fall
// through to the existing _hitTestSprite /
// _hitTestTrigger / _hitTestCurve thresholds.
const TOOLTIP_DELAY_MS = 450;
const TOOLTIP_CURSOR_HIT_PX = 6;
const TOOLTIP_MARKER_HIT_PX = 7;

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

        /**
         * When true, the canvas continuously fits its zoom
         * to make the playable region (canvasW × canvasH,
         * centred on the origin) maximally fill the pane
         * with a small AUTO_ZOOM_MARGIN_PX gap between the
         * fence and the pane edge. Manual zoom controls
         * (zoomIn, zoomOut, resetZoom, wheel) become no-ops
         * while this is true, so the View menu greys them
         * out. The fit is re-applied whenever the pane
         * resizes (via _onResize) or the scene's canvasW /
         * canvasH change (via setScene). Set externally
         * through setAutoZoom; main.js persists the choice
         * to localStorage and restores it on the next page
         * load.
         * @type {boolean}
         */
        this._autoZoom = false;

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
         * Per-score display brightness, 0–100. Applied as
         * a multiplicative globalAlpha at draw time inside
         * _drawImage so the rendered image fades toward the
         * canvas-region background colour as the value
         * drops. The signal sampling path is not affected
         * — _imagePixels and _imageOKLCh are both built
         * from _imageBitmapOriginal, not the displayed
         * bitmap, and the alpha only touches the on-screen
         * draw call. The canvas owns a mirror of the
         * bundle's value so the draw loop has the value
         * synchronously; main.js syncs the mirror via
         * setDisplayBrightness on score open and on each
         * slider adjustment.
         * @type {number}
         */
        this._displayBrightness = 100;

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
         * Currently brightened hover target, or null. Tracks
         * the object id rather than its array index so scene
         * edits that reshuffle indices (delete, duplicate)
         * don't leave a stale reference pointing at the
         * wrong object. Set after the debounce timer fires;
         * cleared on pointer move off, on gesture start, on
         * tool arm, on scene reload, and on pointer leave.
         * @type {{kind: "sprite"|"trigger"|"curve", id: string} | null}
         */
        this._hover = null;

        /**
         * Candidate hover target that the debounce timer is
         * counting down for, or null. Same shape as _hover.
         * When the pointer rests on an object the candidate
         * is set immediately and the timer is started; when
         * the timer fires the candidate is promoted to
         * _hover and the redraw runs. The candidate stays
         * separate from _hover so a pass-through move (the
         * pointer enters and leaves an object within the
         * debounce window) never causes a visible brighten.
         * @type {{kind: "sprite"|"trigger"|"curve", id: string} | null}
         */
        this._hoverPending = null;

        /**
         * setTimeout handle for the active debounce, or null
         * when no debounce is pending. Cleared and reset on
         * every change of hit target so the debounce restarts
         * when the pointer moves between objects. Cleared
         * also when hover state is cleared for any other
         * reason (gesture start, tool arm, scene reload,
         * pointer leave) so a debounce that started just
         * before the clear doesn't promote a stale candidate.
         * @type {ReturnType<typeof setTimeout> | null}
         */
        this._hoverDebounceTimer = null;

        /**
         * Identifier of the resize handle currently under
         * the pointer, or null when no handle is hovered.
         * One of "tl", "t", "tr", "r", "br", "b", "bl", "l".
         * Updated from _onCanvasHoverMove before the object
         * hover-test runs so a hovered handle wins over a
         * hovered object beneath it. Drives the rendered
         * handle size (the hovered handle grows by
         * HANDLE_HOVER_SIZE_PX) and the OS cursor (resize
         * variant per handle position). Cleared by
         * _clearHover along with the object-hover state.
         * @type {string | null}
         */
        this._hoverHandle = null;

        /**
         * Identification tooltip's DOM element, created
         * lazily on first show. Lives as a child of
         * document.body with fixed positioning so it
         * floats above the entire viewport regardless of
         * canvas-pane clipping. pointer-events: none in
         * CSS keeps it out of the elementFromPoint hit-
         * tests that drive the canvas pointer handling.
         * @type {HTMLDivElement | null}
         */
        this._tooltipEl = null;

        /**
         * Key (kind + ":" + id) of the tooltip target
         * currently displayed, or null when no tooltip is
         * shown. Compared against the live hit-test
         * result to decide whether to follow the pointer
         * with the existing tooltip (same key) or start a
         * fresh debounce (different key).
         * @type {string | null}
         */
        this._tooltipShownKey = null;

        /**
         * Key of the tooltip target the debounce timer is
         * counting down for, or null when no debounce is
         * pending. Promoted to _tooltipShownKey when the
         * timer fires.
         * @type {string | null}
         */
        this._tooltipPendingKey = null;

        /**
         * The full hit result associated with
         * _tooltipPendingKey, kept so the eventual show
         * can resolve text without re-running the hit-
         * test.
         * @type {{kind: string, id: string} | null}
         */
        this._tooltipPendingHit = null;

        /**
         * Latest pointer client-X / client-Y observed
         * while the pending tooltip was being debounced.
         * The timer's fire callback reads these to
         * position the tooltip below-and-right of the
         * pointer's current location at show time, rather
         * than at the start of the debounce.
         * @type {number | null}
         */
        this._tooltipPendingClientX = null;
        /** @type {number | null} */
        this._tooltipPendingClientY = null;

        /**
         * setTimeout handle for the tooltip's debounce,
         * or null when no debounce is pending.
         * @type {ReturnType<typeof setTimeout> | null}
         */
        this._tooltipTimer = null;

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

        // Hover tracking. mousemove on the canvas element
        // (separate from the window-level mousemove that
        // _onMouseDown attaches for drag tracking) runs the
        // hit-test on every move and updates the debounced
        // hover state; mouseleave clears the hover
        // immediately so a pointer that exits the canvas
        // doesn't leave a brightened object stuck on.
        this.canvasEl.addEventListener("mousemove", (e) => this._onCanvasHoverMove(e));
        this.canvasEl.addEventListener("mouseleave", () => this._clearHover());

        this._onResize();
    }

    // --- Public API ---

    zoomIn() {
        // Manual zoom is gated off while Auto Zoom holds
        // the canvas at a fitted size; the View menu greys
        // the corresponding entry out for the same reason.
        if (this._autoZoom) return;
        this._setZoom(this.zoom * MENU_ZOOM_FACTOR);
    }

    zoomOut() {
        if (this._autoZoom) return;
        this._setZoom(this.zoom / MENU_ZOOM_FACTOR);
    }

    resetZoom() {
        if (this._autoZoom) return;
        this._setZoom(1);
    }

    /**
     * Read the Auto Zoom flag. Used by viewMenu.js to drive
     * the checked state of the Auto Zoom menu item and the
     * disabled state of the Zoom In / Zoom Out / Reset Zoom
     * items.
     * @returns {boolean}
     */
    getAutoZoom() {
        return this._autoZoom;
    }

    /**
     * Enable or disable Auto Zoom. When transitioning from
     * off to on, the current pane size and canvas dimensions
     * are read and the zoom is set so the fence fills the
     * pane with AUTO_ZOOM_MARGIN_PX of slack on each side.
     * When transitioning from on to off, the current zoom
     * value is left as-is — the user keeps the zoomed-to-fit
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
        // Clear hover state on scene reload. The next
        // mousemove will re-establish it against the new
        // scene; without this, a hover-debounce promotion
        // that completes after the scene change would paint
        // an id that may no longer correspond to a hoverable
        // object.
        this._clearHover();
        this._refreshCurveMarkerPositions();
        // Re-fit when Auto Zoom is active: the new scene
        // may have different canvasW / canvasH from the
        // previous one, in which case the fitted zoom needs
        // to track before the next draw paints the fence at
        // the wrong size. Cheap when canvas dimensions are
        // unchanged because _setZoom early-returns on no-
        // change.
        if (this._autoZoom) {
            this._applyAutoZoom();
        }
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

    /**
     * Set the per-score display brightness. Clamps the
     * value to 0–100 and schedules a redraw on any actual
     * change. The canvas's stored value is the source of
     * truth for the draw loop; the bundle's matching
     * field is the persistent source of truth. main.js
     * pushes both whenever the user moves the Brightness
     * slider and pushes the canvas value on score open
     * from the bundle's stored value.
     *
     * Cheap to call: no bitmap re-derivation, no
     * subscriber fan-out, just a field write plus a
     * coalesced draw. Same-value pushes early-return so
     * a slider that holds at one position doesn't churn
     * redundant draws.
     *
     * @param {number} value  0–100; outside that range is clamped.
     */
    setDisplayBrightness(value) {
        const n = typeof value === "number" && Number.isFinite(value)
            ? value
            : 100;
        const clamped = n < 0 ? 0 : (n > 100 ? 100 : n);
        if (clamped === this._displayBrightness) return;
        this._displayBrightness = clamped;
        this.scheduleDraw();
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
        // Clear any hover-brighten state when a tool arms:
        // the crosshair-cursor mode is for placing new
        // objects, not for hovering over existing ones, and
        // a brightened object underneath the crosshair would
        // be confusing visual noise.
        if (toolName !== null) {
            this._clearHover();
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

    /**
     * Compute and apply the zoom value that fits the canvas
     * (the scene's canvasW × canvasH playable region) inside
     * the current pane size, with AUTO_ZOOM_MARGIN_PX of
     * slack on each side. Called whenever Auto Zoom has just
     * been enabled, the pane has just resized, or the
     * scene's canvasW / canvasH have just changed.
     *
     * Derivation: at any zoom the canvas's pixels-per-unit
     * is zoom * basePpu, where basePpu is the value at
     * zoom 1 that makes the legacy ±16 / ±12 region fit the
     * pane (i.e. 1 / max(2 * DEFAULT_HALF_WIDTH / cssWidth,
     * 2 * DEFAULT_HALF_HEIGHT / cssHeight)). To fit a region
     * of size canvasW × canvasH with margin m on each side,
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
        this._drawResizeHandles();
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
        const ctx = this.ctx;
        for (const curve of this._scene.curves) {
            // Compose the curve's runtime (dx, dy) offset
            // from the Simulation on top of the authored
            // geometry by translating the drawing context
            // before painting. The offset is in canvas
            // units; pixel-space translation is
            // (dx * pixelsPerUnit, -dy * pixelsPerUnit)
            // because canvas Y is up and pixel Y is down.
            // The geometry, markers, and cursor all read
            // their positions through toPixelX/toPixelY,
            // so a single context translate shifts them in
            // lockstep. Curves with no offset (no velocity,
            // or simulation not yet wired) draw at their
            // authored position with no extra context state.
            const offset = this._simulation === null
                ? null
                : this._simulation.getCurveRuntimeOffset(curve.id);
            const hasOffset = offset !== null && (offset.dx !== 0 || offset.dy !== 0);
            if (hasOffset) {
                ctx.save();
                ctx.translate(
                    offset.dx * this.pixelsPerUnit,
                    -offset.dy * this.pixelsPerUnit,
                );
            }
            this._strokeCurveShape(curve);
            this._drawCurveMarkers(curve);
            this._drawCurveCursor(curve);
            if (hasOffset) {
                ctx.restore();
            }
        }
    }

    _strokeCurveShape(curve) {
        const ctx = this.ctx;
        const hovered = this._isHovered("curve", curve);
        ctx.strokeStyle = hovered
            ? lightenColor(CURVE_COLOUR, HOVER_LIGHTEN_RATIO)
            : CURVE_COLOUR;
        ctx.lineWidth = hovered
            ? curve.curveThickness + HOVER_LINE_WIDTH_BONUS
            : curve.curveThickness;
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
     * parsePatternToPositions, multiplies the resulting
     * positions by the curve's patternRepeats to lay out N
     * copies of the pattern around the curve (each repeat
     * occupies 1/N of the curve's parameter range), and
     * stores the result in _curveMarkerPositions keyed by
     * curve id. Curves whose cyclePattern is empty, fails to
     * parse (e.g. strudel engine not loaded yet), or
     * otherwise produces no positions are absent from the
     * map after the refresh — absent entries render no
     * markers, so the visual outcome is a curve with no
     * diamonds. The map is cleared on every refresh so a
     * curve that was removed from the scene since the last
     * refresh loses its entry naturally.
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
            // Lay out patternRepeats copies of the pattern
            // around the curve. Each repeat occupies 1/N of
            // the curve's parameter range; within a repeat,
            // pattern positions map proportionally. Default
            // 1 reproduces the pre-patternRepeats single-
            // pattern layout. Defensive Math.max + Math.round
            // against hand-edited or AI-edited scenes that
            // store a non-integer or zero/negative value.
            const repeats = Math.max(1, Math.round(
                typeof curve.patternRepeats === "number" ? curve.patternRepeats : 1,
            ));
            /** @type {number[]} */
            const positions = [];
            for (let i = 0; i < repeats; i++) {
                for (const p of result.positions) {
                    positions.push((i + p) / repeats);
                }
            }
            this._curveMarkerPositions.set(curve.id, positions);
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
            // Hover-brighten: bump the stroke colour toward
            // white and add a bit of line width. The fill
            // (image-sampled colour) is left alone so the
            // object's identifying image-pixel colour stays
            // readable underneath.
            const hovered = this._isHovered("trigger", t);
            ctx.strokeStyle = hovered
                ? lightenColor(t.color, HOVER_LIGHTEN_RATIO)
                : t.color;
            ctx.lineWidth = hovered
                ? 1.5 + HOVER_LINE_WIDTH_BONUS
                : 1.5;
            ctx.stroke();
        }
    }

    _drawSprites() {
        if (this._scene === null) return;
        const ctx = this.ctx;
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
            // Hover-brighten: stroke uses a lightened colour
            // and a wider line width when this sprite is the
            // current hover target. Fill stays unchanged so
            // the image-pixel colour identifying the sprite
            // reads through the brightened ring.
            const hovered = this._isHovered("sprite", s);
            ctx.strokeStyle = hovered
                ? lightenColor(s.color, HOVER_LIGHTEN_RATIO)
                : s.color;
            ctx.lineWidth = hovered
                ? 1.5 + HOVER_LINE_WIDTH_BONUS
                : 1.5;
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

    /**
     * Return the curve's runtime (dx, dy) offset from the
     * simulation, or (0, 0) when the simulation isn't wired
     * yet or has no runtime state for this curve id. Used
     * by curve rendering, hit-testing, marquee selection,
     * and the selection bbox so every code path that reads
     * curve geometry treats the visible position
     * (authored + offset) uniformly, without each call
     * site having to repeat the simulation null-check or
     * the runtime-state existence check.
     * @param {string} curveId
     * @returns {{dx: number, dy: number}}
     */
    _curveOffset(curveId) {
        if (this._simulation === null) return { dx: 0, dy: 0 };
        const o = this._simulation.getCurveRuntimeOffset(curveId);
        return o === null ? { dx: 0, dy: 0 } : o;
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
        // visible bounding box, sized just large enough to
        // enclose the full geometry at its current runtime
        // position. The bbox comes from curveBoundingBox on
        // the authored shape and the runtime (dx, dy) offset
        // is added on top, so a curve that has drifted from
        // its authored position carries its selection marker
        // along visually. Matches GeoSonix's convention of
        // rectangular selection markers for curves; a marquee
        // that hugs the geometry would be more informative
        // about shape but is harder to recognise as a selection
        // marker, and looks busy when several curves are
        // selected.
        ctx.lineWidth = 1;
        for (const i of sel.curves) {
            if (i >= this._scene.curves.length) continue;
            const c = this._scene.curves[i];
            const bbox = curveBoundingBox(c.shape);
            if (bbox === null) continue;
            const offset = this._curveOffset(c.id);
            const px1 = this.toPixelX(bbox.x1 + offset.dx);
            const px2 = this.toPixelX(bbox.x2 + offset.dx);
            // Canvas Y is up; pixel Y is down. The rectangle's
            // top in pixel space corresponds to bbox.y2 (max y
            // in canvas units).
            const py1 = this.toPixelY(bbox.y2 + offset.dy);
            const py2 = this.toPixelY(bbox.y1 + offset.dy);
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
     * Render the eight resize handles around the current
     * selection's bounding box. Drawn after
     * _drawSelectionMarkers so the handles sit on top of
     * the yellow dotted selection rectangles. The handle
     * currently under the pointer (this._hoverHandle)
     * renders at HANDLE_HOVER_SIZE_PX instead of
     * HANDLE_SIZE_PX so the pointer's gesture-actionable
     * target reads clearly. No-op when the selection is
     * empty (no bbox) or a marquee gesture is in progress
     * (we don't draw handles on top of the rubber-band
     * rectangle).
     */
    _drawResizeHandles() {
        if (this._gesture !== null && this._gesture.kind === "marquee") return;
        const bbox = this._getSelectionBbox();
        if (bbox === null) return;
        const ctx = this.ctx;
        const anchors = this._handleAnchors(bbox);
        ctx.save();
        ctx.fillStyle = HANDLE_FILL_COLOUR;
        ctx.strokeStyle = HANDLE_STROKE_COLOUR;
        ctx.lineWidth = 1;
        for (const id of Object.keys(anchors)) {
            const a = anchors[id];
            const size = id === this._hoverHandle
                ? HANDLE_HOVER_SIZE_PX
                : HANDLE_SIZE_PX;
            const half = size / 2;
            // Round to half-pixel grid so the 1px stroke
            // stays crisp at 1:1 dpr; at fractional dprs the
            // canvas transform handles the rest.
            const x = Math.round(a.px - half) + 0.5;
            const y = Math.round(a.py - half) + 0.5;
            ctx.fillRect(x, y, size, size);
            ctx.strokeRect(x, y, size, size);
        }
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
            // Sample the authored shape and shift each
            // sample by the curve's runtime (dx, dy) offset
            // so the click hits the curve where the user
            // sees it. Curves with no offset (no velocity,
            // or simulation not yet wired) get (0, 0) from
            // _curveOffset and behave exactly as before.
            const offset = this._curveOffset(curve.id);
            for (let s = 0; s <= SAMPLES; s++) {
                const t = s / SAMPLES;
                const sample = sampleCurve(curve.shape, t);
                if (sample === null) continue;
                const dxPx = (canvasX - (sample.x + offset.dx)) * ppu;
                const dyPx = (canvasY - (sample.y + offset.dy)) * ppu;
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

    // --- Resize handles ---

    /**
     * Compute the axis-aligned bounding box of the current
     * selection in canvas units, or null if the selection
     * is empty or no shapes resolve. Sprite and trigger
     * bboxes are the rectangles enclosing the rendered
     * disc / diamond at the current spriteScale /
     * triggerScale; curve bboxes come from
     * curveBoundingBox. Used by both the handle renderer
     * and the resize-gesture initialiser so the on-screen
     * handles and the gesture's anchor share one source of
     * truth.
     * @returns {{x1: number, y1: number, x2: number, y2: number} | null}
     */
    _getSelectionBbox() {
        if (this._scene === null) return null;
        const sel = this._selection;
        const total = sel.sprites.size + sel.triggers.size + sel.curves.size;
        if (total === 0) return null;
        // No handles for a selection that contains no
        // curves and exactly one sprite or trigger.
        // Sprites and triggers don't resize (size field is
        // unchanged by the gesture) and a single one has
        // nothing to reposition relative to — the anchor
        // and the object's centre would collapse to the
        // same point and dragging the corner would just
        // move the object by an arbitrary scaled offset.
        // Handles earn their place only when the selection
        // either contains resizable geometry (a curve) or
        // has multiple members whose relative positions
        // can shift inside a resized bbox.
        if (sel.curves.size === 0 && total === 1) return null;
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        const spriteScale = this._scene.spriteScale;
        const triggerScale = this._scene.triggerScale;
        for (const i of sel.sprites) {
            if (i >= this._scene.sprites.length) continue;
            const s = this._scene.sprites[i];
            const pos = this._spritePosition(s);
            const r = (s.displayDiameter / 2) * spriteScale;
            if (pos.x - r < minX) minX = pos.x - r;
            if (pos.y - r < minY) minY = pos.y - r;
            if (pos.x + r > maxX) maxX = pos.x + r;
            if (pos.y + r > maxY) maxY = pos.y + r;
        }
        for (const i of sel.triggers) {
            if (i >= this._scene.triggers.length) continue;
            const t = this._scene.triggers[i];
            const r = t.size * triggerScale;
            if (t.x - r < minX) minX = t.x - r;
            if (t.y - r < minY) minY = t.y - r;
            if (t.x + r > maxX) maxX = t.x + r;
            if (t.y + r > maxY) maxY = t.y + r;
        }
        for (const i of sel.curves) {
            if (i >= this._scene.curves.length) continue;
            const c = this._scene.curves[i];
            const bbox = curveBoundingBox(c.shape);
            if (bbox === null) continue;
            // Shift the authored bbox by the curve's runtime
            // (dx, dy) offset so the selection bbox — and
            // the resize handles that hang off it — sit at
            // the visible position.
            const offset = this._curveOffset(c.id);
            if (bbox.x1 + offset.dx < minX) minX = bbox.x1 + offset.dx;
            if (bbox.y1 + offset.dy < minY) minY = bbox.y1 + offset.dy;
            if (bbox.x2 + offset.dx > maxX) maxX = bbox.x2 + offset.dx;
            if (bbox.y2 + offset.dy > maxY) maxY = bbox.y2 + offset.dy;
        }
        if (!Number.isFinite(minX)) return null;
        return { x1: minX, y1: minY, x2: maxX, y2: maxY };
    }

    /**
     * Compute the pixel positions of the eight handle
     * anchor points around the given canvas-space bounding
     * box. Returns an object keyed by handle id with each
     * value {px, py} in pixel space. Canvas Y is up and
     * pixel Y is down, so "top" in handle ids (tl, t, tr)
     * corresponds to bbox.y2 (the max canvas Y, which maps
     * to the smallest pixel Y).
     * @param {{x1: number, y1: number, x2: number, y2: number}} bbox
     * @returns {Record<string, {px: number, py: number}>}
     */
    _handleAnchors(bbox) {
        const left = this.toPixelX(bbox.x1);
        const right = this.toPixelX(bbox.x2);
        const top = this.toPixelY(bbox.y2);
        const bottom = this.toPixelY(bbox.y1);
        const midX = (left + right) / 2;
        const midY = (top + bottom) / 2;
        return {
            tl: { px: left,  py: top    },
            t:  { px: midX,  py: top    },
            tr: { px: right, py: top    },
            r:  { px: right, py: midY   },
            br: { px: right, py: bottom },
            b:  { px: midX,  py: bottom },
            bl: { px: left,  py: bottom },
            l:  { px: left,  py: midY   },
        };
    }

    /**
     * Compute the anchor point in canvas units for a resize
     * gesture started on the given handle, against the
     * given selection bbox. The anchor is the point that
     * stays fixed during the resize: for a corner handle
     * it's the opposite corner; for an edge handle it's
     * the opposite edge's midpoint. Returned in canvas
     * coordinates so scaleSelectionAroundAnchor can use it
     * directly.
     * @param {string} handleId
     * @param {{x1: number, y1: number, x2: number, y2: number}} bbox
     * @returns {{ax: number, ay: number}}
     */
    _handleAnchor(handleId, bbox) {
        const midX = (bbox.x1 + bbox.x2) / 2;
        const midY = (bbox.y1 + bbox.y2) / 2;
        switch (handleId) {
            // Corner handles: anchor at the opposite corner.
            // bbox.y2 is the top (max canvas Y, since Y is
            // up), bbox.y1 is the bottom.
            case "tl": return { ax: bbox.x2, ay: bbox.y1 };
            case "tr": return { ax: bbox.x1, ay: bbox.y1 };
            case "bl": return { ax: bbox.x2, ay: bbox.y2 };
            case "br": return { ax: bbox.x1, ay: bbox.y2 };
            // Edge handles: anchor at the opposite edge
            // midpoint. The orthogonal axis is unchanged
            // (it just sits at the bbox midpoint there).
            case "t":  return { ax: midX,    ay: bbox.y1 };
            case "b":  return { ax: midX,    ay: bbox.y2 };
            case "l":  return { ax: bbox.x2, ay: midY   };
            case "r":  return { ax: bbox.x1, ay: midY   };
            default:   return { ax: midX,    ay: midY   };
        }
    }

    /**
     * Hit-test the pointer position against the resize
     * handles drawn on the current selection's bounding
     * box. Returns the handle id under the pointer, or
     * null. Hit area is a square centred on each handle's
     * anchor, sized to HANDLE_HOVER_SIZE_PX plus a small
     * pad so the test stays forgiving even at the idle
     * (smaller) handle size. Cheap: eight anchor lookups
     * plus eight axis-aligned bounds checks per call,
     * fine to run on every mousemove.
     * @param {number} px
     * @param {number} py
     * @returns {string | null}
     */
    _hitTestHandle(px, py) {
        const bbox = this._getSelectionBbox();
        if (bbox === null) return null;
        const anchors = this._handleAnchors(bbox);
        const halfHit = HANDLE_HOVER_SIZE_PX / 2 + HANDLE_HIT_PADDING_PX;
        for (const id of Object.keys(anchors)) {
            const a = anchors[id];
            if (Math.abs(px - a.px) <= halfHit && Math.abs(py - a.py) <= halfHit) {
                return id;
            }
        }
        return null;
    }

    /**
     * Translate a handle id into the corresponding CSS
     * cursor name. Corner handles use the diagonal-arrow
     * cursors (nwse-resize for the tl/br diagonal,
     * nesw-resize for tr/bl); edge handles use the
     * single-axis variants (ns-resize for t/b, ew-resize
     * for l/r). Defaults to "default" for unknown ids so a
     * caller mistake doesn't strand the cursor in an odd
     * state.
     * @param {string} handleId
     * @returns {string}
     */
    _cursorForHandle(handleId) {
        switch (handleId) {
            case "tl": case "br": return "nwse-resize";
            case "tr": case "bl": return "nesw-resize";
            case "t":  case "b":  return "ns-resize";
            case "l":  case "r":  return "ew-resize";
            default: return "default";
        }
    }

    // --- Hover tracking ---

    /**
     * Test whether a scene object is currently the
     * brightened hover target. Called from the per-kind
     * draw methods to decide whether to bump the stroke
     * colour and line width for the object's outline.
     * id-based rather than index-based so a scene edit
     * that reshuffles indices doesn't paint the wrong
     * object as hovered between the edit and the next
     * mousemove that would refresh the hover state.
     * @param {"sprite"|"trigger"|"curve"} kind
     * @param {any} obj
     * @returns {boolean}
     */
    _isHovered(kind, obj) {
        if (this._hover === null) return false;
        if (this._hover.kind !== kind) return false;
        if (obj === null || typeof obj !== "object") return false;
        return obj.id === this._hover.id;
    }

    /**
     * Clear any current and pending hover state, cancelling
     * the debounce timer if one is running. Called when the
     * pointer leaves the canvas, when a gesture starts (so a
     * drag doesn't carry a brightened object), when a tool
     * is armed (hovering for selection makes no sense while
     * a click would place a new object), and when the scene
     * reloads (object ids may have changed). The redraw is
     * scheduled unconditionally when there was anything to
     * clear so the brightened outline visibly drops on the
     * next frame.
     */
    _clearHover() {
        const hadHover = this._hover !== null;
        const hadHandle = this._hoverHandle !== null;
        this._hover = null;
        this._hoverPending = null;
        this._hoverHandle = null;
        if (this._hoverDebounceTimer !== null) {
            clearTimeout(this._hoverDebounceTimer);
            this._hoverDebounceTimer = null;
        }
        // Restore the OS cursor to its base state when
        // clearing a handle hover. Skip when a tool is
        // armed: setActiveTool owns the cursor in that mode
        // (crosshair) and our "default" here would stomp it.
        if (hadHandle && this._activeTool === null) {
            this.canvasEl.style.cursor = "default";
        }
        if (hadHover || hadHandle) this.scheduleDraw();
        // The identification tooltip clears alongside the
        // hover-brighten and handle-hover state: every
        // external caller of _clearHover (mouseleave,
        // scene reload, gesture start, tool arm) is also a
        // context where the tooltip should not remain
        // visible. The in-function call inside
        // _onCanvasHoverMove's no-hit branch was replaced
        // with an inline hover-only clear so the tooltip's
        // independent hit-test (which covers more targets
        // than the object hover-brighten path) isn't
        // stomped by this method.
        this._hideTooltipAndCancel();
    }

    /**
     * Handle a mousemove event on the canvas element for
     * the hover-brighten feature. Runs the hit-test at the
     * current pointer position and updates the debounced
     * hover state, with three branches:
     *
     *   - Pointer is over no object: clear any current
     *     bright target immediately (no debounce on exit)
     *     and cancel any pending debounce.
     *   - Pointer is over the same object that is already
     *     the bright target or pending candidate: no-op.
     *   - Pointer is over a different object: clear the
     *     current bright target immediately, set the new
     *     object as the pending candidate, and (re)start
     *     the debounce timer. When the timer fires it
     *     promotes the pending candidate to the actual
     *     hover target and triggers a redraw.
     *
     * Gated on the canvas being in selection mode: while a
     * tool is armed (crosshair cursor, click places an
     * object) hover-brighten would compete with the
     * placement gesture, and while a drag/marquee gesture
     * is in flight the brightened outline would confuse the
     * drag preview. Both gates fall through to clearing any
     * existing hover so the brightened state can't persist
     * across a mode change.
     *
     * @param {MouseEvent} e
     */
    _onCanvasHoverMove(e) {
        if (this._activeTool !== null || this._gesture !== null) {
            this._clearHover();
            return;
        }
        if (this._scene === null) {
            this._hideTooltipAndCancel();
            return;
        }

        const pos = this._eventToCanvas(e);

        // Handle hit-test first: handles sit on top of
        // everything and take precedence over the object
        // underneath. When a handle is under the pointer,
        // the handle grows (via _hoverHandle reflected in
        // _drawResizeHandles) and the OS cursor shifts to
        // the appropriate resize variant, while any object
        // hover-brighten state is cleared so the user reads
        // "this handle is grabbable" rather than "this
        // object is hoverable + this handle is grabbable".
        const handleId = this._hitTestHandle(pos.px, pos.py);
        if (handleId !== null) {
            // Clear any object-hover state, since a hovered
            // handle wins. _clearHover() also resets the
            // cursor and the _hoverHandle, so we re-set
            // both after.
            if (this._hover !== null || this._hoverPending !== null || this._hoverDebounceTimer !== null) {
                this._hover = null;
                this._hoverPending = null;
                if (this._hoverDebounceTimer !== null) {
                    clearTimeout(this._hoverDebounceTimer);
                    this._hoverDebounceTimer = null;
                }
            }
            // Identification tooltip hides under a hovered
            // handle: the handle's role is gesture-grab,
            // and a tooltip identifying the object beneath
            // would compete with that read.
            this._hideTooltipAndCancel();
            if (this._hoverHandle !== handleId) {
                this._hoverHandle = handleId;
                this.canvasEl.style.cursor = this._cursorForHandle(handleId);
                this.scheduleDraw();
            }
            return;
        }

        // No handle under pointer. If a handle was hovered
        // a moment ago, drop the handle-hover state and
        // restore the default cursor before falling through
        // to the object hover-brighten path.
        if (this._hoverHandle !== null) {
            this._hoverHandle = null;
            this.canvasEl.style.cursor = "default";
            this.scheduleDraw();
        }

        // Identification tooltip. Independent of the
        // hover-brighten path below since it covers more
        // targets — curve cursors and beat-point markers
        // get a tooltip but no brighten, top-level objects
        // get both. Runs before the object hit-test so the
        // no-hit branch can finish its own inline cleanup
        // without touching the tooltip state.
        this._updateTooltipForPosition(pos, e.clientX, e.clientY);

        const hit = this._hitTestObject(pos.x, pos.y);

        if (hit === null) {
            // Pointer over empty canvas as far as the
            // hover-brighten hit-test is concerned. The
            // identification tooltip's hit-test has
            // already decided independently above whether
            // to keep itself visible (e.g. for a hovered
            // curve cursor or beat marker on a curve that
            // _hitTestObject's curve-geometry check
            // missed). Inline hover-only cleanup here
            // rather than _clearHover, which would also
            // hide the tooltip.
            const hadHover = this._hover !== null;
            this._hover = null;
            this._hoverPending = null;
            if (this._hoverDebounceTimer !== null) {
                clearTimeout(this._hoverDebounceTimer);
                this._hoverDebounceTimer = null;
            }
            if (hadHover) this.scheduleDraw();
            return;
        }

        // Resolve the hit's index to its id so the hover
        // tracking is stable across scene edits.
        let obj;
        if (hit.kind === "sprite") obj = this._scene.sprites[hit.index];
        else if (hit.kind === "trigger") obj = this._scene.triggers[hit.index];
        else obj = this._scene.curves[hit.index];
        if (obj === undefined || typeof obj.id !== "string") return;
        const hitId = obj.id;

        // Same object as current brightened target: nothing
        // to do. The brightened render is already correct.
        if (this._hover !== null &&
            this._hover.kind === hit.kind &&
            this._hover.id === hitId) {
            return;
        }

        // Same object as the pending candidate: let the
        // existing debounce timer continue counting down.
        // Resetting the timer here would keep deliberate
        // hovering on one spot from ever firing if the
        // pointer wobbled within the object's hit area.
        if (this._hoverPending !== null &&
            this._hoverPending.kind === hit.kind &&
            this._hoverPending.id === hitId) {
            return;
        }

        // Different object than what we were tracking.
        // Drop the current bright target immediately (no
        // "old object stays bright while new one debounces"
        // — the user asked for nothing to be brightened
        // while the pointer is moving), then start a new
        // debounce for the new candidate.
        const hadHover = this._hover !== null;
        this._hover = null;
        this._hoverPending = { kind: hit.kind, id: hitId };
        if (this._hoverDebounceTimer !== null) {
            clearTimeout(this._hoverDebounceTimer);
        }
        this._hoverDebounceTimer = setTimeout(() => {
            this._hoverDebounceTimer = null;
            // Guard against the canvas state having moved
            // on between the timer being set and it firing:
            // a gesture may have started, a tool may have
            // been armed, the scene may have been reloaded.
            // _hoverPending being non-null indicates the
            // intent to brighten is still current; null
            // means something cleared it (one of the
            // gates above, or a mouseleave) and we should
            // not promote.
            if (this._hoverPending === null) return;
            this._hover = this._hoverPending;
            this._hoverPending = null;
            this.scheduleDraw();
        }, HOVER_DEBOUNCE_MS);
        if (hadHover) this.scheduleDraw();
    }

    // --- Identification tooltip ---

    /**
     * Refresh the identification tooltip's pending and
     * shown state against the current pointer position.
     * Runs a tooltip-specific hit-test that covers more
     * targets than the object hover-brighten path: top-
     * level sprites, triggers, and curves, plus each
     * curve's visible cursor and its beat-point markers.
     * Targets resolve to a stable key (kind + id) so the
     * state machine mirrors the hover-brighten pattern:
     * same target — follow the pointer if shown, no-op
     * if pending; different target — start a fresh
     * debounce; no target — hide and cancel any pending.
     *
     * Position updates while the tooltip is shown so the
     * tooltip follows the pointer. New-target transitions
     * remember the latest pointer position so the
     * eventual show paints below-right of where the
     * pointer was when the debounce expired.
     *
     * @param {{px: number, py: number, x: number, y: number}} pos
     * @param {number} clientX
     * @param {number} clientY
     */
    _updateTooltipForPosition(pos, clientX, clientY) {
        const hit = this._hitTestForTooltip(pos.x, pos.y, pos.px, pos.py);
        if (hit === null) {
            this._hideTooltipAndCancel();
            return;
        }
        const key = hit.kind + ":" + hit.id;
        if (this._tooltipShownKey === key) {
            // Same target shown — follow the cursor on
            // every move.
            this._showTooltip(this._tooltipText(hit), clientX, clientY);
            return;
        }
        if (this._tooltipPendingKey === key) {
            // Same pending candidate — let the timer
            // continue. Update the saved position so the
            // eventual show lands at the latest pointer.
            this._tooltipPendingClientX = clientX;
            this._tooltipPendingClientY = clientY;
            return;
        }
        // New target. Hide any current tooltip and
        // restart the debounce against the new key.
        if (this._tooltipEl !== null) {
            this._tooltipEl.style.display = "none";
        }
        this._tooltipShownKey = null;
        this._tooltipPendingKey = key;
        this._tooltipPendingHit = hit;
        this._tooltipPendingClientX = clientX;
        this._tooltipPendingClientY = clientY;
        if (this._tooltipTimer !== null) clearTimeout(this._tooltipTimer);
        this._tooltipTimer = setTimeout(() => {
            this._tooltipTimer = null;
            // Guard against state having moved on between
            // schedule and fire (gesture started, tool
            // armed, scene reloaded, etc).
            if (this._tooltipPendingKey === null) return;
            if (this._tooltipPendingHit === null) return;
            const text = this._tooltipText(this._tooltipPendingHit);
            if (text === null) return;
            this._showTooltip(
                text,
                this._tooltipPendingClientX,
                this._tooltipPendingClientY,
            );
            this._tooltipShownKey = this._tooltipPendingKey;
            this._tooltipPendingKey = null;
            this._tooltipPendingHit = null;
        }, TOOLTIP_DELAY_MS);
    }

    /**
     * Build the tooltip text for an identification hit.
     * Top-level objects render as "Kind ID" matching the
     * inspector's title-bar convention. Child elements
     * (cursor of a curve, beat marker on a curve) render
     * as "... of Curve ID" since they are not first-class
     * schema objects with their own id — the id is the
     * parent curve's. The diamond marker is called
     * "Trigger/Beat Point" because the same visual
     * element serves dual roles: it can be hit by an
     * external cursor (acting as a trigger) or played by
     * the curve's own cursor (acting as a beat point).
     *
     * @param {{kind: string, id: string} | null} hit
     * @returns {string | null}
     */
    _tooltipText(hit) {
        if (hit === null) return null;
        switch (hit.kind) {
            case "spriteBody":  return `Sprite ${hit.id}`;
            case "triggerBody": return `Trigger ${hit.id}`;
            case "curveBody":   return `Curve ${hit.id}`;
            case "curveCursor": return `Cursor of\nCurve ${hit.id}`;
            case "curveMarker": return `Trigger/Beat Point of\nCurve ${hit.id}`;
            default: return null;
        }
    }

    /**
     * Lazily create the tooltip DOM element on first use.
     * Appended to document.body with fixed positioning so
     * it can paint over the entire viewport regardless of
     * canvas-pane clipping. pointer-events: none (in CSS)
     * keeps it from interfering with the pointer's hit-
     * tests on objects beneath it.
     */
    _ensureTooltipEl() {
        if (this._tooltipEl !== null) return;
        const el = document.createElement("div");
        el.className = "canvas-tooltip";
        el.style.display = "none";
        document.body.appendChild(el);
        this._tooltipEl = el;
    }

    /**
     * Show the tooltip at a client-space position
     * (typically the pointer's clientX/Y, offset slightly
     * down and right so it doesn't sit directly under the
     * cursor). Idempotent and safe to call repeatedly
     * with the same or new text.
     *
     * @param {string | null} text
     * @param {number | null} clientX
     * @param {number | null} clientY
     */
    _showTooltip(text, clientX, clientY) {
        if (text === null) return;
        if (clientX === null || clientY === null) return;
        this._ensureTooltipEl();
        if (this._tooltipEl === null) return;
        this._tooltipEl.textContent = text;
        this._tooltipEl.style.left = `${clientX + 14}px`;
        this._tooltipEl.style.top = `${clientY + 18}px`;
        this._tooltipEl.style.display = "block";
    }

    /**
     * Hide the tooltip and cancel any pending debounce.
     * Called by _clearHover (catching every external
     * "stop hovering" path: mouseleave, scene reload,
     * gesture start, tool arm) and by
     * _onCanvasHoverMove's handle-hit branch and scene-
     * null gate. Safe to call when no tooltip is showing.
     */
    _hideTooltipAndCancel() {
        if (this._tooltipTimer !== null) {
            clearTimeout(this._tooltipTimer);
            this._tooltipTimer = null;
        }
        this._tooltipShownKey = null;
        this._tooltipPendingKey = null;
        this._tooltipPendingHit = null;
        this._tooltipPendingClientX = null;
        this._tooltipPendingClientY = null;
        if (this._tooltipEl !== null) {
            this._tooltipEl.style.display = "none";
        }
    }

    /**
     * Run the tooltip-specific hit-test at a canvas /
     * pixel position. Returns the topmost hit's kind and
     * id, or null if nothing is under the pointer. The
     * hit-test follows visual z-order: sprites (drawn
     * last, on top) beat triggers, which beat curve
     * cursors, which beat curve markers, which beat
     * curve geometry (drawn first, on bottom). Within
     * each kind iteration is back-to-front so the
     * visually-topmost object wins ties.
     *
     * Returned kinds:
     *   - "spriteBody"   — a top-level sprite
     *   - "triggerBody"  — a top-level trigger
     *   - "curveCursor"  — a curve's visible cursor
     *   - "curveMarker"  — a curve's pattern-event marker
     *   - "curveBody"    — a curve's geometry
     *
     * Curve cursors and markers don't carry their own
     * id; the returned id is the parent curve's. The
     * tooltip text builder phrases this as "Cursor of
     * Curve cv_x" or "Trigger/Beat Point of Curve cv_x".
     *
     * Sprite cursor visualisation is deferred at this
     * milestone, so sprites have no cursor element to
     * hit-test (covered by the same gate _drawCurveCursor
     * uses for curves: non-zero extent and not muted).
     *
     * @param {number} canvasX
     * @param {number} canvasY
     * @param {number} pixelX
     * @param {number} pixelY
     * @returns {{kind: string, id: string} | null}
     */
    _hitTestForTooltip(canvasX, canvasY, pixelX, pixelY) {
        if (this._scene === null) return null;

        // 1. Sprite body (topmost in z-order).
        const sIdx = this._hitTestSprite(canvasX, canvasY);
        if (sIdx !== null) {
            const s = this._scene.sprites[sIdx];
            if (s !== undefined && typeof s.id === "string") {
                return { kind: "spriteBody", id: s.id };
            }
        }

        // 2. Trigger body.
        const tIdx = this._hitTestTrigger(canvasX, canvasY);
        if (tIdx !== null) {
            const tr = this._scene.triggers[tIdx];
            if (tr !== undefined && typeof tr.id === "string") {
                return { kind: "triggerBody", id: tr.id };
            }
        }

        // 3. Curve cursors — the perpendicular segment
        // plus the small filled centre dot at the
        // curve's current sweep position. Gated by the
        // same cursor-as-collider checks _drawCurveCursor
        // uses (non-zero extent and not muted) so
        // unrendered cursors don't produce hover hits.
        const ppu = this.pixelsPerUnit;
        for (let i = this._scene.curves.length - 1; i >= 0; i--) {
            const c = this._scene.curves[i];
            if (typeof c.id !== "string") continue;
            if (c.cursorR === 0 && c.cursorL === 0) continue;
            if (c.mute) continue;
            const t = this._simulation === null
                ? 0
                : this._simulation.getCurveCursorT(c.id);
            const sample = sampleCurve(c.shape, t);
            if (sample === null) continue;
            const offset = this._curveOffset(c.id);
            const cpx = this.toPixelX(sample.x + offset.dx);
            const cpy = this.toPixelY(sample.y + offset.dy);
            if (Math.hypot(pixelX - cpx, pixelY - cpy) <= TOOLTIP_CURSOR_HIT_PX) {
                return { kind: "curveCursor", id: c.id };
            }
            const perp = pixelPerpendicularUnit(sample.tx, sample.ty);
            const xR = cpx + perp.x * c.cursorR * ppu;
            const yR = cpy + perp.y * c.cursorR * ppu;
            const xL = cpx - perp.x * c.cursorL * ppu;
            const yL = cpy - perp.y * c.cursorL * ppu;
            if (distanceToSegment(pixelX, pixelY, xL, yL, xR, yR) <= TOOLTIP_CURSOR_HIT_PX) {
                return { kind: "curveCursor", id: c.id };
            }
        }

        // 4. Curve beat markers. Tested as circular hit
        // areas around each cached marker position. The
        // visible markers are 5 px half-size diamonds,
        // so a slightly-larger 7 px radius gives a
        // forgiving target without overlapping much
        // with neighbours.
        for (let i = this._scene.curves.length - 1; i >= 0; i--) {
            const c = this._scene.curves[i];
            if (typeof c.id !== "string") continue;
            const positions = this._curveMarkerPositions.get(c.id);
            if (positions === undefined) continue;
            const offset = this._curveOffset(c.id);
            for (const t of positions) {
                const sample = sampleCurve(c.shape, t);
                if (sample === null) continue;
                const mx = this.toPixelX(sample.x + offset.dx);
                const my = this.toPixelY(sample.y + offset.dy);
                if (Math.hypot(pixelX - mx, pixelY - my) <= TOOLTIP_MARKER_HIT_PX) {
                    return { kind: "curveMarker", id: c.id };
                }
            }
        }

        // 5. Curve geometry (bottommost in z-order).
        const cIdx = this._hitTestCurve(canvasX, canvasY);
        if (cIdx !== null) {
            const c = this._scene.curves[cIdx];
            if (c !== undefined && typeof c.id === "string") {
                return { kind: "curveBody", id: c.id };
            }
        }

        return null;
    }

    /** @param {MouseEvent} e */
    _onMouseDown(e) {
        if (e.button !== 0) return;
        // Drop any hover-brighten state. A mousedown either
        // begins a drag/marquee (in which case the bright
        // state would conflict with the drag preview) or
        // commits a click that selects an object (in which
        // case the selection marker around the object
        // becomes the primary visual signal). Either way,
        // brightening on top of those other states is noise.
        this._clearHover();
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

        // Handle hit-test: if the mousedown lands on a
        // resize handle, start a resize gesture rather
        // than the normal selection / drag path. Handles
        // sit on top of everything in the selection mode,
        // so this check takes precedence over object hit-
        // testing below. The gesture captures the starting
        // bbox, the anchor (opposite handle in canvas
        // units), and per-object initial state for live
        // preview, then attaches window-level move/up
        // listeners just like the drag gesture does.
        const handleId = this._hitTestHandle(pos.px, pos.py);
        if (handleId !== null) {
            const startBbox = this._getSelectionBbox();
            if (startBbox !== null) {
                e.preventDefault();
                const anchor = this._handleAnchor(handleId, startBbox);
                /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
                const resizeSelection = {
                    sprites: Array.from(this._selection.sprites),
                    triggers: Array.from(this._selection.triggers),
                    curves: Array.from(this._selection.curves),
                };
                /** @type {Map<number, {x: number, y: number}>} */
                const initialSpritePositions = new Map();
                /** @type {Map<number, {x: number, y: number}>} */
                const initialTriggerPositions = new Map();
                /** @type {Map<number, any>} */
                const initialCurveShapes = new Map();
                if (this._scene !== null) {
                    for (const idx of resizeSelection.sprites) {
                        if (idx < this._scene.sprites.length) {
                            const s = this._scene.sprites[idx];
                            initialSpritePositions.set(idx, { x: s.x, y: s.y });
                        }
                    }
                    for (const idx of resizeSelection.triggers) {
                        if (idx < this._scene.triggers.length) {
                            const t = this._scene.triggers[idx];
                            initialTriggerPositions.set(idx, { x: t.x, y: t.y });
                        }
                    }
                    for (const idx of resizeSelection.curves) {
                        if (idx < this._scene.curves.length) {
                            const c = this._scene.curves[idx];
                            // Fold any runtime offset into
                            // the authored shape before
                            // snapshotting. _getSelectionBbox
                            // above returned the visible
                            // bbox so the anchor sits in
                            // visible canvas space; after
                            // the fold the authored shape
                            // equals the visible shape, the
                            // anchor still aligns, and the
                            // mouseup commit's scaleSelection
                            // doesn't trigger an offset-reset
                            // jump. See
                            // bakeCurveOffsetIntoAuthored in
                            // simulation.js.
                            if (this._simulation !== null) {
                                this._simulation.bakeCurveOffsetIntoAuthored(c);
                            }
                            initialCurveShapes.set(idx, snapshotShapeForResize(c.shape));
                        }
                    }
                }
                this._gesture = {
                    kind: "resize",
                    handleId,
                    startBbox,
                    anchor,
                    resizeSelection,
                    initialSpritePositions,
                    initialTriggerPositions,
                    initialCurveShapes,
                    shiftKey: e.shiftKey,
                    lastSx: 1,
                    lastSy: 1,
                };
                const onMove = (/** @type {MouseEvent} */ moveE) => this._onMouseMove(moveE);
                const onUp = (/** @type {MouseEvent} */ upE) => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    this._onMouseUp(upE);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
                return;
            }
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
                const initialSpriteRuntimePositions = new Map();
                /** @type {Map<number, {x: number, y: number}>} */
                const initialTriggerPositions = new Map();
                /** @type {Map<number, any>} */
                const initialCurveShapes = new Map();
                /** @type {Map<number, {dx: number, dy: number}>} */
                const initialCurveOffsets = new Map();
                if (this._scene !== null) {
                    for (const idx of dragSelection.sprites) {
                        if (idx < this._scene.sprites.length) {
                            const s = this._scene.sprites[idx];
                            // Sprite at home (runtime x, y
                            // equals authored x, y, meaning
                            // no physics has displaced the
                            // sprite since rewind / load)
                            // takes the authored-edit path:
                            // mutate sprite.x/y during drag,
                            // emit translateSelection on
                            // mouseup, permanently move.
                            // Sprite away from home (sim
                            // has run, state.x/y diverged
                            // from sprite.x/y) takes the
                            // runtime-edit path: mutate
                            // only the runtime position;
                            // the authored stays put so
                            // rewind returns the sprite to
                            // its unchanged home. Float
                            // equality is exact here
                            // because state.x is
                            // initialised from sprite.x and
                            // stays equal until physics
                            // steps or a previous drag
                            // explicitly diverged them.
                            const runtime = this._simulation === null
                                ? null
                                : this._simulation.getSpriteRuntime(s.id);
                            const atHome = runtime === null
                                || (runtime.x === s.x && runtime.y === s.y);
                            if (atHome) {
                                initialSpritePositions.set(idx, { x: s.x, y: s.y });
                            } else {
                                initialSpriteRuntimePositions.set(idx, {
                                    x: runtime.x,
                                    y: runtime.y,
                                });
                            }
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
                            // Curve at home (zero runtime
                            // offset) takes the shape-edit
                            // path: mutate curve.shape
                            // during drag, emit
                            // translateSelection on mouseup,
                            // permanently move. Curve away
                            // from home (non-zero offset
                            // because physics has displaced
                            // it) takes the offset-edit
                            // path: mutate only the runtime
                            // offset via
                            // setCurveRuntimeOffset; the
                            // authored shape stays put so
                            // rewind returns the curve to
                            // its unchanged home.
                            const offset = this._simulation === null
                                ? null
                                : this._simulation.getCurveRuntimeOffset(c.id);
                            const atHome = offset === null
                                || (offset.dx === 0 && offset.dy === 0);
                            if (atHome) {
                                initialCurveShapes.set(idx, snapshotShapeCoords(c.shape));
                            } else {
                                initialCurveOffsets.set(idx, {
                                    dx: offset.dx,
                                    dy: offset.dy,
                                });
                            }
                        }
                    }
                }
                this._gesture = {
                    kind: "drag",
                    startX: g.startX,
                    startY: g.startY,
                    dragSelection,
                    initialSpritePositions,
                    initialSpriteRuntimePositions,
                    initialTriggerPositions,
                    initialCurveShapes,
                    initialCurveOffsets,
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
                // Sprites in the authored-edit branch:
                // mutate sprite.x/y and sync the
                // simulation runtime so visual feedback
                // tracks the cursor.
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
                // Sprites in the runtime-edit branch:
                // mutate only the simulation's runtime
                // position so visual feedback tracks the
                // cursor while sprite.x/y (and therefore
                // the inspector's State-at-Start) stay
                // untouched. The next rewind returns the
                // sprite to its unchanged authored home.
                for (const [idx, init] of g.initialSpriteRuntimePositions) {
                    if (idx < this._scene.sprites.length && this._simulation !== null) {
                        this._simulation.setSpriteRuntimePositionOnly(
                            this._scene.sprites[idx].id,
                            init.x + dx,
                            init.y + dy,
                        );
                    }
                }
                for (const [idx, init] of g.initialTriggerPositions) {
                    if (idx < this._scene.triggers.length) {
                        this._scene.triggers[idx].x = init.x + dx;
                        this._scene.triggers[idx].y = init.y + dy;
                    }
                }
                // Curves in the shape-edit branch: mutate
                // the authored shape directly. The
                // mouseup commit will translate the same
                // delta into a translateSelection edit.
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
                // Curves in the offset-edit branch: mutate
                // only the runtime offset so visual
                // feedback tracks the cursor while the
                // authored shape (and therefore the
                // inspector's State-at-Start) stays
                // untouched. The next rewind returns the
                // curve to its unchanged authored home.
                for (const [idx, init] of g.initialCurveOffsets) {
                    if (idx < this._scene.curves.length && this._simulation !== null) {
                        this._simulation.setCurveRuntimeOffset(
                            this._scene.curves[idx].id,
                            init.dx + dx,
                            init.dy + dy,
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

        if (g.kind === "resize") {
            // Compute the new bbox from the gesture's anchor
            // (the opposite corner/edge in canvas units) and
            // the current pointer position. For corner
            // handles both axes scale; for edge handles only
            // the orthogonal-to-edge axis scales. Shift held
            // on a corner drag locks aspect ratio by taking
            // the larger absolute factor and applying it to
            // both axes (with each axis keeping its own
            // sign so a drag past the anchor still flips
            // cleanly).
            const startBbox = g.startBbox;
            const oldW = startBbox.x2 - startBbox.x1;
            const oldH = startBbox.y2 - startBbox.y1;
            const id = g.handleId;
            const isCornerHandle = (id === "tl" || id === "tr" || id === "bl" || id === "br");
            const affectsX = isCornerHandle || id === "l" || id === "r";
            const affectsY = isCornerHandle || id === "t" || id === "b";
            let sx = 1;
            let sy = 1;
            if (affectsX && oldW !== 0) {
                // The dragged x position becomes the new
                // far-x of the bbox in that axis; sx scales
                // around the anchor (which sits at the
                // opposite-x side of the original bbox).
                sx = (pos.x - g.anchor.ax) / ((id === "tl" || id === "bl" || id === "l") ? (startBbox.x1 - g.anchor.ax) : (startBbox.x2 - g.anchor.ax));
            }
            if (affectsY && oldH !== 0) {
                sy = (pos.y - g.anchor.ay) / ((id === "bl" || id === "br" || id === "b") ? (startBbox.y1 - g.anchor.ay) : (startBbox.y2 - g.anchor.ay));
            }
            // Shift constraint on corner drags: keep aspect
            // ratio by using the larger absolute factor for
            // both axes, with each axis keeping its sign.
            const shiftHeld = e.shiftKey || g.shiftKey;
            if (shiftHeld && isCornerHandle) {
                const m = Math.max(Math.abs(sx), Math.abs(sy));
                sx = m * (sx < 0 ? -1 : 1);
                sy = m * (sy < 0 ? -1 : 1);
            }
            // Guard against NaN / Infinity from a zero-width
            // or zero-height starting bbox.
            if (!Number.isFinite(sx)) sx = 1;
            if (!Number.isFinite(sy)) sy = 1;
            g.lastSx = sx;
            g.lastSy = sy;
            // Live preview: mutate runtime objects in place
            // by applying the scale around the anchor to
            // each captured initial position / shape, then
            // schedule a redraw. The authoritative edit
            // fires on mouseup; the runScene that follows
            // it reloads from the freshly-written JSON
            // anyway, so the live mutation is throw-away
            // visual feedback.
            if (this._scene !== null) {
                for (const [idx, init] of g.initialSpritePositions) {
                    if (idx < this._scene.sprites.length) {
                        const s = this._scene.sprites[idx];
                        s.x = g.anchor.ax + (init.x - g.anchor.ax) * sx;
                        s.y = g.anchor.ay + (init.y - g.anchor.ay) * sy;
                        if (this._simulation !== null) {
                            this._simulation.snapSpriteRuntimeToAuthored(s);
                        }
                    }
                }
                for (const [idx, init] of g.initialTriggerPositions) {
                    if (idx < this._scene.triggers.length) {
                        const t = this._scene.triggers[idx];
                        t.x = g.anchor.ax + (init.x - g.anchor.ax) * sx;
                        t.y = g.anchor.ay + (init.y - g.anchor.ay) * sy;
                    }
                }
                for (const [idx, initShape] of g.initialCurveShapes) {
                    if (idx < this._scene.curves.length) {
                        applyShapeCoordsScale(
                            this._scene.curves[idx].shape,
                            initShape,
                            g.anchor.ax,
                            g.anchor.ay,
                            sx,
                            sy,
                        );
                    }
                }
            }
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
                // Build the persisted-edit selection from
                // only those objects whose drag took the
                // authored-edit path (the per-object
                // initial-state maps for sprites,
                // triggers, and curves at home). Objects
                // in the runtime-edit branch (sprites and
                // curves that started the drag away from
                // their home position) had their session-
                // only mutation applied during the move
                // and need no scene edit on commit;
                // including them in translateSelection
                // would write their displacement into
                // scene.json and defeat the intent of
                // leaving State-at-Start untouched.
                const persistedSelection = {
                    sprites: Array.from(g.initialSpritePositions.keys()),
                    triggers: Array.from(g.initialTriggerPositions.keys()),
                    curves: Array.from(g.initialCurveShapes.keys()),
                };
                const hasPersisted = persistedSelection.sprites.length > 0
                    || persistedSelection.triggers.length > 0
                    || persistedSelection.curves.length > 0;
                if (hasPersisted) {
                    this._editCallback({
                        kind: "translateSelection",
                        selection: persistedSelection,
                        dx,
                        dy,
                    });
                }
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
                // awkward. Each sample is shifted by the
                // curve's runtime (dx, dy) offset so a
                // marquee drawn around a drifted curve
                // catches it at the visible position.
                const SAMPLES = 32;
                for (let i = 0; i < this._scene.curves.length; i++) {
                    const curve = this._scene.curves[i];
                    const offset = this._curveOffset(curve.id);
                    let touched = false;
                    for (let s = 0; s <= SAMPLES; s++) {
                        const t = s / SAMPLES;
                        const sample = sampleCurve(curve.shape, t);
                        if (sample === null) continue;
                        const sx = sample.x + offset.dx;
                        const sy = sample.y + offset.dy;
                        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
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
        if (g.kind === "resize") {
            if (this._editCallback !== null) {
                // Commit the resize as a scaleSelection
                // edit. ax/ay/sx/sy were tracked through the
                // live-preview path in _onMouseMove so the
                // committed transform exactly matches the
                // last on-screen state. main.js routes the
                // edit through sceneEditor.scaleSelection-
                // AroundAnchor and the consequent runScene
                // reloads from the freshly-written JSON,
                // replacing the live-mutated runtime state
                // with the authoritative geometry.
                this._editCallback({
                    kind: "scaleSelection",
                    selection: g.resizeSelection,
                    ax: g.anchor.ax,
                    ay: g.anchor.ay,
                    sx: g.lastSx,
                    sy: g.lastSy,
                });
            }
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
     * file, with the curve's runtime (dx, dy) offset added
     * on top so a curve drifting under non-zero velocity
     * reports its cursor at the visible position rather
     * than the authored one. This keeps the firing engine's
     * image-colour sampling aligned to where the user sees
     * the cursor on screen.
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
        const offset = this._simulation.getCurveRuntimeOffset(curveId);
        if (offset === null) return { x: sample.x, y: sample.y };
        return { x: sample.x + offset.dx, y: sample.y + offset.dy };
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
        // Apply the per-score display brightness as a
        // multiplicative globalAlpha. The fence's BG_COLOUR
        // has already been laid down by _fillCanvasRegion
        // before _drawImage runs, so an alpha < 1 fades the
        // image toward that background colour. The save /
        // restore of globalAlpha is multiplicative against
        // whatever the surrounding context state already
        // is; in the current draw order ctx.globalAlpha is
        // 1 going into _drawImage, but restoring the
        // previous value rather than hardcoding 1 keeps the
        // method safe under future changes to the surrounding
        // draw sequence. _displayBrightness lives in the
        // 0–100 user-facing range; dividing by 100 turns it
        // into the 0–1 alpha multiplier.
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * (this._displayBrightness / 100);
        ctx.drawImage(
            this._imageBitmap,
            left, top,
            right - left,
            bottom - top
        );
        ctx.globalAlpha = prevAlpha;
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
 * Distance from a point to a finite line segment in any
 * coordinate space. Used by the canvas's identification
 * tooltip hit-test against curve-cursor segments. Returns
 * the Euclidean distance; the helper does its own zero-
 * length-segment guard so callers don't need to.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
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
 * Snapshot a curve shape's full geometry at the start of a
 * resize gesture. Resize needs more than translation's
 * snapshot: ellipse w and h scale during resize (translation
 * left them alone), so they must be captured too. The
 * resize live-preview applies the captured snapshot through
 * applyShapeCoordsScale on every mouse move.
 *
 * Per shape type:
 *   - line: { x1, y1, x2, y2 }
 *   - ellipse: { cx, cy, w, h }
 *   - piste: { points: [[x, y], ...] }    (deep copy)
 *   - other: null
 *
 * @param {any} shape
 * @returns {any}
 */
function snapshotShapeForResize(shape) {
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
            w: typeof shape.w === "number" ? shape.w : 0,
            h: typeof shape.h === "number" ? shape.h : 0,
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
 * Apply an around-anchor scale to a runtime curve shape
 * using the captured resize-start snapshot. Mirrors
 * sceneEditor.scaleShapeAroundAnchor's per-type behaviour
 * but without the roundCoord step — this is visual
 * feedback only; the authoritative mutation goes through
 * the scaleSelection edit on mouseup. Negative scale
 * factors are allowed (the curve mirrors across the
 * anchor) for line/piste; ellipse w/h take Math.abs since
 * those fields are scalar magnitudes.
 *
 * Silently skipped if the snapshot is null or the shape's
 * type changed since gesture start.
 *
 * @param {any} shape
 * @param {any} initialCoords
 * @param {number} ax
 * @param {number} ay
 * @param {number} sx
 * @param {number} sy
 */
function applyShapeCoordsScale(shape, initialCoords, ax, ay, sx, sy) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return;
    if (initialCoords === null) return;
    if (initialCoords.type !== shape.type) return;
    if (shape.type === "line") {
        shape.x1 = ax + (initialCoords.x1 - ax) * sx;
        shape.y1 = ay + (initialCoords.y1 - ay) * sy;
        shape.x2 = ax + (initialCoords.x2 - ax) * sx;
        shape.y2 = ay + (initialCoords.y2 - ay) * sy;
    } else if (shape.type === "ellipse") {
        shape.cx = ax + (initialCoords.cx - ax) * sx;
        shape.cy = ay + (initialCoords.cy - ay) * sy;
        shape.w = initialCoords.w * Math.abs(sx);
        shape.h = initialCoords.h * Math.abs(sy);
    } else if (shape.type === "piste") {
        if (!Array.isArray(shape.points)) return;
        const pts = initialCoords.points;
        const n = Math.min(shape.points.length, pts.length);
        for (let i = 0; i < n; i++) {
            const p = shape.points[i];
            if (Array.isArray(p) && p.length >= 2) {
                p[0] = ax + (pts[i][0] - ax) * sx;
                p[1] = ay + (pts[i][1] - ay) * sy;
            }
        }
    }
}

/**
 * Lighten a CSS hex colour by lerping each channel toward
 * 255 by the given ratio. Used by the hover-brighten
 * render path to push a stroke colour toward white when
 * the corresponding object is the current hover target.
 *
 * Accepts `#RGB` and `#RRGGBB` forms. Anything else
 * (rgb()-string, named colour, malformed hex) is returned
 * unchanged so a caller that hands the helper an
 * unexpected colour shape gets a graceful no-brighten
 * fallback rather than a thrown error or an invalid CSS
 * colour. The ratio is clamped to [0, 1].
 *
 * @param {string} hex
 * @param {number} ratio  In [0, 1]; 0 returns the original, 1 returns white.
 * @returns {string}
 */
function lightenColor(hex, ratio) {
    if (typeof hex !== "string") return hex;
    if (hex.length === 0 || hex.charAt(0) !== "#") return hex;
    let r, g, b;
    if (hex.length === 4) {
        // #RGB shorthand: expand each nibble.
        r = parseInt(hex.charAt(1) + hex.charAt(1), 16);
        g = parseInt(hex.charAt(2) + hex.charAt(2), 16);
        b = parseInt(hex.charAt(3) + hex.charAt(3), 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    } else {
        return hex;
    }
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return hex;
    const t = ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio);
    const rl = Math.round(r + (255 - r) * t);
    const gl = Math.round(g + (255 - g) * t);
    const bl = Math.round(b + (255 - b) * t);
    return "#" + toHexByte(rl) + toHexByte(gl) + toHexByte(bl);
}

/**
 * Format a number in [0, 255] as a two-character hex byte.
 * Helper for lightenColor; pads single-digit values with a
 * leading zero so the output stays a fixed-width hex pair.
 * @param {number} n
 * @returns {string}
 */
function toHexByte(n) {
    const s = n.toString(16);
    return s.length < 2 ? "0" + s : s;
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
