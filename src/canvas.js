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
import { sampleCurve } from "./curveGeometry.js";
import { viewportMethods } from "./canvasViewport.js";
import { renderMethods } from "./canvasRender.js";
import { samplingMethods } from "./canvasSampling.js";
import { hitTestMethods } from "./canvasHitTest.js";
import { selectionMethods } from "./canvasSelection.js";
import { hoverMethods } from "./canvasHover.js";

import {
  AUTO_ZOOM_MARGIN_PX, DEFAULT_HALF_HEIGHT, DEFAULT_HALF_WIDTH, DRAG_THRESHOLD_PX, FIRING_FLASH_DURATION_MS, FIRING_FLASH_MATCH_EPS, HANDLE_HIT_PADDING_PX, HANDLE_HOVER_SIZE_PX, HOVER_DEBOUNCE_MS, TOOLTIP_CURSOR_HIT_PX, TOOLTIP_DELAY_MS, TOOLTIP_MARKER_HIT_PX, applyShapeCoordsScale, applyShapeCoordsTranslation, curveBoundingBox, distanceToSegment, filterIndexSet, pixelPerpendicularUnit, snapshotShapeCoords, snapshotShapeForResize,
} from "./canvasShared.js";

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
         * Cached pattern-event marker VALUES per curve, keyed
         * by curve id and index-aligned with the same curve's
         * entry in _curveMarkerPositions. Each value is the
         * strudel Hap value the curve's cyclePattern assigns at
         * that beat position (e.g. {s:"bd"} or {note:60,
         * s:"piano"}) — the native superdough value object.
         * Populated alongside the positions in
         * _refreshCurveMarkerPositions so the two arrays share
         * indices: marker i on curve C is at positions[i] and
         * carries values[i]. Consumed by the collision detector
         * to hand a struck marker's value to the curve's beenHit
         * (ctx.hitValue / ctx.playMarker); the draw path ignores
         * it. Cleared and rebuilt on the same refreshes as the
         * positions map.
         * @type {Map<string, any[]>}
         */
        this._curveMarkerValues = new Map();

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
         * Sink for the Code-tab active-token highlight, or
         * null until main.js wires it via setActiveBeatSink.
         * Called from _emitActiveBeats once per _draw with a
         * Map<curveId, {t, repeats}> of every playing curve's
         * cursor parameter and patternRepeats, which the
         * editor forwards to the active-beat highlighter so it
         * can outline the currently-sounding token. Receives an
         * empty map when the transport isn't playing, so the
         * boxes clear on pause / stop.
         * @type {((map: Map<string, {t: number, repeats: number}>) => void) | null}
         */
        this._activeBeatSink = null;

        /**
         * Whether the active-beat sink was last sent an empty
         * map. Starts true (nothing playing yet). Lets
         * _emitActiveBeats send the clearing empty map exactly
         * once on the transition to not-playing rather than on
         * every non-playing redraw (hover, zoom, selection),
         * while still emitting a fresh map every frame during
         * playback.
         * @type {boolean}
         */
        this._activeBeatsCleared = true;

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
         * Most recent canvas-space position (x, y) captured
         * from a mousedown anywhere on the canvas element,
         * or null when no click has been observed yet (or
         * the position has been cleared explicitly). Used
         * by the Paste command in main.js as a position
         * hint: when non-null, a paste centres the
         * incoming objects at this point; when null, paste
         * falls back to a fixed offset from the originals.
         * The position is captured for every mousedown
         * regardless of what action follows (selection,
         * marquee, drag start, tool placement, double-
         * click), because any of those gestures
         * communicates the user's locus of attention. The
         * Paste path clears the position after consuming
         * it via clearLastClickPosition(), so a second
         * paste falls back to the offset model unless the
         * user clicks again first.
         * @type {{x: number, y: number} | null}
         */
        this._lastClickCanvasPos = null;

        /**
         * Set of object ids that should render with the
         * cursor-target magenta highlight. Driven by the
         * editor through setCursorTargetIds whenever the
         * cursor in behaviors.js moves in or out of a
         * labelled pattern block or a top-level function
         * declaration that binds to a slot. Empty when the
         * Code tab isn't active, when the cursor sits in
         * a non-binding region, or before the first
         * runScene has provided a scene to the editor.
         * @type {Set<string>}
         */
        this._cursorTargetIds = new Set();

        /**
         * Per-curve flash state for the firing-event visual
         * feedback. Keyed by curve id; value is the
         * absoluteFractional position in [0, 1) of the
         * currently-yellow beat-point diamond on that curve.
         * Persistent-until-superseded semantics: the next
         * firing event on the same curve replaces the
         * value (effectively chasing the cursor with
         * exactly one yellow diamond per curve at a time),
         * and the entry stays until either the next fire
         * arrives or the transport rewinds (which clears
         * every curve's entry). Distinct from the sprite
         * and trigger registries because curve flashes
         * have no time component — the yellow stays
         * regardless of how much wall-clock time has
         * passed since the last fire, including across a
         * Pause — so a timestamp would be misleading state.
         *
         * Driven by Canvas.markFiredCurveBeat from the
         * firing-engine subscriber wired in main.js. Read
         * by _drawCurveMarkers's match check against each
         * marker's stored position with
         * FIRING_FLASH_MATCH_EPS tolerance.
         *
         * @type {Map<string, number>}
         */
        this._curveFlashAbsoluteFractional = new Map();

        /**
         * Per-sprite flash state for the firing-event visual
         * feedback. Keyed by sprite id; value is the
         * performance.now() timestamp of the last firing
         * event on that sprite. Short-fade semantics: the
         * render path applies the yellow flash colour when
         * (now − timestamp) is less than
         * FIRING_FLASH_DURATION_MS, and the sprite reverts
         * to its normal stroke colour naturally on the next
         * frame past the window. Last-write-wins on rapid
         * successive fires so the flash extends rather than
         * stuttering.
         *
         * A setTimeout in markFiredSprite schedules one
         * follow-up scheduleDraw shortly after the flash
         * window so the post-flash state paints even when
         * the transport's render loop isn't actively
         * driving frames (typically post-pause cleanup
         * when the last firing event landed late in the
         * cycle and the transport stopped before the
         * window closed naturally).
         *
         * @type {Map<string, number>}
         */
        this._spriteFlashTimestamp = new Map();

        /**
         * Per-trigger flash state for the firing-event
         * visual feedback. Keyed by trigger id; value is
         * performance.now() of the last firing event,
         * identical shape to _spriteFlashTimestamp.
         * Driven by Canvas.markFiredTrigger, which is the
         * hook the future sprite-trigger collision firing
         * path will call when beenHit dispatches; no
         * driver exists yet, so the registry stays empty
         * in practice. The render branch in _drawTriggers
         * is wired so the visual lands the moment the
         * collision firing implementation arrives. Short-
         * fade semantics matching sprites.
         *
         * @type {Map<string, number>}
         */
        this._triggerFlashTimestamp = new Map();

        /**
         * Per-sprite heading history for the directional
         * teardrop body. _spriteHeading maps a sprite id to
         * its last heading angle in canvas space (Y up,
         * +x = 0, counter-clockwise positive);
         * _spritePrevPos maps a sprite id to its canvas-space
         * position on the previous frame, used to derive the
         * live motion direction during playback. See
         * _spriteHeadingPixelAngle for how the two combine
         * with the transport state to choose a heading.
         * @type {Map<string, number>}
         */
        this._spriteHeading = new Map();
        /** @type {Map<string, {x: number, y: number}>} */
        this._spritePrevPos = new Map();
        /**
         * Per-sprite smoothed heading vector in canvas space,
         * a distance-weighted exponential average of the
         * frame-to-frame displacement. Its angle is the nose's
         * pointing direction. Low-passing the VECTOR (not the
         * angle) is what lets a small or backward jitter step —
         * a short vector — barely move the heading while
         * sustained travel dominates it.
         * @type {Map<string, {hx: number, hy: number}>}
         */
        this._spriteHeadingVec = new Map();
        /**
         * Timestamp (performance.now ms) of the previous
         * sprite-draw frame, used to compute the per-frame
         * elapsed seconds the heading low-pass needs. null
         * until the first frame; that first frame reads a dt
         * of 0, which snaps the heading rather than smoothing.
         * @type {number | null}
         */
        this._lastHeadingFrameTime = null;

        /**
         * Per-collider collision-detection history for the
         * canvas-side crossing test, keyed by collider id.
         * Each entry holds the previous frame's cursor segment
         * endpoints (ax, ay, bx, by, canvas units) and a
         * per-target map of the previous frame's signed side of
         * that target relative to the cursor line. A sign flip
         * between frames is a crossing. Rebuilt each detection
         * pass from the active colliders, so a collider that
         * stops being one (muted, cursor zeroed, removed) drops
         * out naturally. Cleared on pause and rewind.
         * @type {Map<string, {seg: {ax: number, ay: number, bx: number, by: number}, sides: Map<string, number>}>}
         */
        this._collisionPrev = new Map();
        /**
         * Timestamp (performance.now ms) of the previous
         * collision-detection pass, for the per-frame dt the
         * contact-point hit-speed needs. null until the first
         * playing frame and reset on pause / rewind.
         * @type {number | null}
         */
        this._lastCollisionTime = null;

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

        // Identification-tooltip preference: when the user
        // flips it from on to off in Settings, collapse any
        // currently-shown tooltip and cancel any pending
        // debounce so the canvas immediately reflects the
        // new state. The next pointer move runs through
        // _updateTooltipForPosition, which honours the
        // preference and stays silent. Flips from off to
        // on don't need any action here — the next pointer
        // move will pick up the new state through the same
        // gate.
        subscribePreference("enableCanvasObjectTooltips", (enabled) => {
            if (!enabled) this._hideTooltipAndCancel();
        });

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
        // Capture the canvas-space position of every
        // mousedown for the Paste command's position hint.
        // Runs alongside _onMouseDown rather than inside
        // it so the capture doesn't depend on which
        // branch _onMouseDown takes; any mousedown
        // communicates locus of attention. See
        // _lastClickCanvasPos's doc for the consume-and-
        // clear contract main.js follows.
        this.canvasEl.addEventListener("mousedown", (e) => {
            const pos = this._eventToCanvas(e);
            this._lastClickCanvasPos = { x: pos.x, y: pos.y };
        });
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
     * Attach the sink that carries per-frame active-beat
     * state to the Code-tab active-token highlighter. main.js
     * wires this to editor.applyActiveBeats so the editor
     * boxes the currently-sounding token of each playing
     * curve's pattern. Called once at startup; the canvas is
     * fully usable without it (no boxes, all else works).
     * @param {(map: Map<string, {t: number, repeats: number}>) => void} fn
     */
    setActiveBeatSink(fn) {
        this._activeBeatSink = fn;
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
     * Return the most recent canvas-space mousedown
     * position, or null when no click has been observed
     * yet (or the position has been cleared via
     * clearLastClickPosition). Used by main.js's Paste
     * command as a position hint: when non-null, the
     * pasted objects are centred at this point; when
     * null, paste falls back to a fixed offset from the
     * originals.
     * @returns {{x: number, y: number} | null}
     */
    getLastClickPosition() {
        return this._lastClickCanvasPos;
    }

    /**
     * Clear the most recent mousedown position so a
     * subsequent getLastClickPosition() returns null.
     * main.js's Paste command calls this after consuming
     * the position so a second paste without an
     * intervening click falls back to the offset model.
     */
    clearLastClickPosition() {
        this._lastClickCanvasPos = null;
    }

    /**
     * Replace the set of object ids that render with the
     * cursor-target magenta highlight. Driven by the
     * editor on every behaviors.js cursor move and on
     * every tab change. A set-equality short-circuit
     * avoids redrawing when the new set matches the
     * current one — selectionSet events in CodeMirror fire
     * frequently during cursor motion and the typical
     * sequence is many fires inside the same labelled
     * block, all emitting the same id set.
     * @param {Set<string>} ids
     */
    setCursorTargetIds(ids) {
        if (ids.size === this._cursorTargetIds.size) {
            let same = true;
            for (const id of ids) {
                if (!this._cursorTargetIds.has(id)) {
                    same = false;
                    break;
                }
            }
            if (same) return;
        }
        this._cursorTargetIds = new Set(ids);
        this.scheduleDraw();
    }

    /**
     * Record that a curve fired an audio event at the
     * given GXW-cycle absoluteFractional position. Sets
     * the curve's flash registry entry, replacing any
     * prior value, and schedules a redraw so the new
     * yellow diamond paints. The previous yellow diamond
     * on the same curve reverts on the same frame via
     * the render-path match check; persistent-until-
     * superseded semantics with at most one yellow per
     * curve. Wired from main.js to the firing engine's
     * onFiring subscriber.
     *
     * @param {string} curveId
     * @param {number} absoluteFractional  GXW-cycle position in [0, 1).
     */
    markFiredCurveBeat(curveId, absoluteFractional) {
        this._curveFlashAbsoluteFractional.set(curveId, absoluteFractional);
        this.scheduleDraw();
    }

    /**
     * Record that a sprite fired an audio event. Sets the
     * sprite's flash timestamp to now and schedules a
     * redraw so the yellow outline paints on the next
     * frame. A follow-up scheduleDraw fires shortly after
     * the flash window so the post-flash revert paints
     * even when the transport's render loop isn't actively
     * driving frames (typically a sprite that fired right
     * before transport pause). Last-write-wins on the
     * timestamp so rapid successive fires extend the
     * yellow rather than flickering off-and-on. Wired
     * from main.js to the firing engine's onFiring
     * subscriber.
     *
     * @param {string} spriteId
     */
    markFiredSprite(spriteId) {
        this._spriteFlashTimestamp.set(spriteId, performance.now());
        this.scheduleDraw();
        setTimeout(() => this.scheduleDraw(), FIRING_FLASH_DURATION_MS + 16);
    }

    /**
     * Record that a trigger fired an audio event
     * (canonically, the trigger's beenHit callback ran).
     * Sets the trigger's flash timestamp to now and
     * schedules a redraw. Mirror of markFiredSprite for
     * the trigger render path. No driver exists yet —
     * sprite-trigger collision firing isn't implemented
     * — so this method is wired in anticipation; once
     * the collision firing lands and calls into it the
     * yellow flash on trigger diamonds works for free.
     *
     * @param {string} triggerId
     */
    markFiredTrigger(triggerId) {
        this._triggerFlashTimestamp.set(triggerId, performance.now());
        this.scheduleDraw();
        setTimeout(() => this.scheduleDraw(), FIRING_FLASH_DURATION_MS + 16);
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
        // Clear every firing-event flash registry so the
        // canvas doesn't carry a stale yellow diamond or
        // a stale sprite/trigger outline forward from
        // pre-rewind playback. The simulation has already
        // reset cycleCount and cycleProgress at this
        // point, so the next firing event after Play
        // resumes will be the new cycle's first beat
        // arriving fresh.
        this._curveFlashAbsoluteFractional.clear();
        this._spriteFlashTimestamp.clear();
        this._triggerFlashTimestamp.clear();
        this._collisionPrev.clear();
        this._lastCollisionTime = null;
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
        // One more draw after the loop tears down so
        // _emitActiveBeats runs once in the not-playing state
        // and clears the active-token boxes on pause / stop.
        this.scheduleDraw();
    }

    /**
     * Build and emit the per-curve active-beat map for the
     * Code-tab active-token highlighter. For each curve in the
     * scene that has a cyclePattern, reports the curve's
     * current cursor parameter t (in [0, 1)) and its
     * patternRepeats; the editor's highlighter computes the
     * pattern-local fraction (t * repeats mod 1) against its
     * own parse of the block and outlines the token whose
     * [begin, end) span contains it. Driven once per _draw,
     * right after the simulation tick.
     *
     * Emits only while the transport is playing. When not
     * playing (paused, stopped, or simulation/scene absent),
     * sends one empty map to clear the boxes and then stays
     * quiet until playback resumes — the _activeBeatsCleared
     * flag suppresses the redundant per-redraw empties that
     * hover, zoom, and selection redraws would otherwise
     * produce. The getCurveCursorT typeof guard keeps a sink
     * call from throwing if the simulation predates that
     * method.
     */
    _emitActiveBeats() {
        if (this._activeBeatSink === null) return;
        const playing = this._transport !== null && this._transport.isPlaying;
        if (!playing ||
            this._scene === null ||
            this._simulation === null ||
            typeof this._simulation.getCurveCursorT !== "function") {
            if (!this._activeBeatsCleared) {
                this._activeBeatSink(new Map());
                this._activeBeatsCleared = true;
            }
            return;
        }
        /** @type {Map<string, {t: number, repeats: number}>} */
        const map = new Map();
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string" || curve.id.length === 0) continue;
            if (typeof curve.cyclePattern !== "string" ||
                curve.cyclePattern.length === 0) continue;
            const t = this._simulation.getCurveCursorT(curve.id);
            if (typeof t !== "number" || !Number.isFinite(t)) continue;
            const repeats = (typeof curve.patternRepeats === "number" &&
                Number.isFinite(curve.patternRepeats) && curve.patternRepeats >= 1)
                ? curve.patternRepeats
                : 1;
            map.set(curve.id, { t, repeats });
        }
        this._activeBeatSink(map);
        this._activeBeatsCleared = false;
    }

    // --- Internals ---

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
     * Detect cursor/target collisions for this frame and fire
     * the collision callbacks through the simulation. Runs
     * canvas-side, once per render frame (NOT in the
     * deterministic sim step), because the cursor geometry it
     * needs — the sprite smoothed heading and the curve cursor
     * position with its runtime offset — is a render-frame
     * concept. Collision timing is therefore not replay-
     * identical; that is acceptable because firing a callback
     * is a pure side effect on the audio path and never touches
     * simulation motion, so the deterministic retrace of
     * position and velocity is unaffected.
     *
     * Collider = a curve or sprite with a non-zero cursor
     * extent that is not muted (a muted source hides its
     * cursor, so it is not a collider — the same gate the
     * cursor draw uses). Its cursor is a line segment in canvas
     * units, left end at -cursorL and right end at +cursorR of
     * the right-of-motion perpendicular. Target (this commit):
     * triggers, at their centerpoint; the trigger's size is
     * visual only and does not enter the test. Curve beat-point
     * markers are the second commit.
     *
     * Detection is a continuous crossing test: for each
     * collider/target pair, compare the signed side of the
     * target point relative to the cursor line against the
     * previous frame's. A sign flip, with the target's
     * perpendicular foot within the segment's extent, means the
     * cursor swept across the target this frame and fires once.
     * The stored sign re-arms on its own — it flips again only
     * when the cursor sweeps back — so a cursor resting on a
     * target does not re-fire.
     *
     * hitSpeed is the speed of the actual contact point on the
     * cursor: the foot's canvas position this frame versus the
     * same-parameter point on the previous frame's segment,
     * over the frame dt. A rotating cursor's ends move faster
     * than its middle, and this reads the speed where the hit
     * happened.
     *
     * Only runs while playing; pausing clears the per-collider
     * history so a resume re-seeds without a spurious crossing.
     * A cursor that jumps more than TELEPORT_LIMIT canvas units
     * in one frame (a cycle-reset teleport or rewind) is seeded
     * rather than read as a very fast hit.
     */
    _detectCollisions() {
        const playing = this._transport !== null && this._transport.isPlaying;
        if (!playing || this._simulation === null || this._scene === null) {
            if (this._collisionPrev.size > 0) this._collisionPrev.clear();
            this._lastCollisionTime = null;
            return;
        }
        const triggers = this._scene.triggers;
        const hasTriggers = Array.isArray(triggers) && triggers.length > 0;
        const now = performance.now();
        const dtRaw = this._lastCollisionTime !== null
            ? (now - this._lastCollisionTime) / 1000
            : 0;
        this._lastCollisionTime = now;
        // Curve beat-point markers are collision targets too,
        // alongside triggers. Precompute each marker's current
        // canvas position once per frame: the curve sample point
        // plus the curve's runtime offset, matching how markers
        // are drawn (under a context translate of the same
        // offset, so a moving curve's markers move with it). Each
        // marker is keyed `${curveId}#${index}` for the crossing
        // test; marker indices are stable between the refreshes
        // (_refreshCurveMarkerPositions, on setScene / strudel
        // status changes) that rebuild the position arrays, so a
        // changed marker set simply re-seeds the stored sign
        // rather than misfiring.
        /** @type {Array<{key: string, curveId: string, t: number, x: number, y: number, value: any}>} */
        const markerTargets = [];
        for (const curve of this._scene.curves) {
            if (curve === null || typeof curve.id !== "string") continue;
            const ts = this._curveMarkerPositions.get(curve.id);
            if (ts === undefined || ts.length === 0) continue;
            const vals = this._curveMarkerValues.get(curve.id);
            const off = this._simulation.getCurveRuntimeOffset(curve.id);
            const odx = off !== null ? off.dx : 0;
            const ody = off !== null ? off.dy : 0;
            for (let i = 0; i < ts.length; i++) {
                const sample = sampleCurve(curve.shape, ts[i]);
                if (sample === null) continue;
                markerTargets.push({
                    key: curve.id + "#" + i,
                    curveId: curve.id,
                    t: ts[i],
                    x: sample.x + odx,
                    y: sample.y + ody,
                    value: vals !== undefined ? vals[i] : null,
                });
            }
        }
        if (!hasTriggers && markerTargets.length === 0) {
            // No targets at all; drop stale collider history.
            if (this._collisionPrev.size > 0) this._collisionPrev.clear();
            return;
        }
        // Frame dt for the contact-point speed. Out-of-range
        // (first frame, or a long stall / backgrounded tab)
        // reads as 0, which suppresses firing for this frame
        // (the crossing still re-seeds the stored sign).
        const dt = (dtRaw > 1e-4 && dtRaw < 0.1) ? dtRaw : 0;
        // A one-frame cursor jump beyond this many canvas units
        // is a teleport (cycle reset / rewind), not travel.
        const TELEPORT_LIMIT = 6;

        // Build the active colliders: curves then sprites with a
        // non-zero cursor extent that are not muted, each as a
        // canvas-units segment (left end = -cursorL, right end =
        // +cursorR along the right-of-motion perpendicular).
        /** @type {Array<{id: string, kind: "curve" | "sprite", ax: number, ay: number, bx: number, by: number}>} */
        const colliders = [];
        for (const curve of this._scene.curves) {
            if (curve === null || typeof curve.id !== "string") continue;
            if (curve.cursorR === 0 && curve.cursorL === 0) continue;
            if (curve.mute || curve.hide) continue;
            const t = this._simulation.getCurveCursorT(curve.id);
            const sample = sampleCurve(curve.shape, t);
            if (sample === null) continue;
            const len = Math.hypot(sample.tx, sample.ty);
            if (len === 0) continue;
            const off = this._simulation.getCurveRuntimeOffset(curve.id);
            const cx = sample.x + (off !== null ? off.dx : 0);
            const cy = sample.y + (off !== null ? off.dy : 0);
            // Right-of-motion perpendicular in canvas units (Y up):
            // the right perpendicular of tangent (tx, ty) is
            // (ty, -tx), matching the curve cursor draw.
            const perpX = sample.ty / len;
            const perpY = -sample.tx / len;
            colliders.push({
                id: curve.id,
                kind: "curve",
                ax: cx - perpX * curve.cursorL,
                ay: cy - perpY * curve.cursorL,
                bx: cx + perpX * curve.cursorR,
                by: cy + perpY * curve.cursorR,
            });
        }
        for (const s of this._scene.sprites) {
            if (s === null || typeof s.id !== "string") continue;
            if (s.cursorR === 0 && s.cursorL === 0) continue;
            if (s.mute) continue;
            const theta = this._spriteHeading.get(s.id);
            if (typeof theta !== "number") continue;
            const pos = this._spritePosition(s);
            // Forward is (cos theta, sin theta) in canvas space;
            // the right-of-motion perpendicular is (sin, -cos),
            // matching the curve sense and the drawn sprite cursor.
            const perpX = Math.sin(theta);
            const perpY = -Math.cos(theta);
            colliders.push({
                id: s.id,
                kind: "sprite",
                ax: pos.x - perpX * s.cursorL,
                ay: pos.y - perpY * s.cursorL,
                bx: pos.x + perpX * s.cursorR,
                by: pos.y + perpY * s.cursorR,
            });
        }

        // Rebuild the per-collider history fresh each pass, so a
        // collider that stopped being one drops out.
        /** @type {Map<string, {seg: {ax: number, ay: number, bx: number, by: number}, sides: Map<string, number>}>} */
        const next = new Map();
        for (const col of colliders) {
            const prev = this._collisionPrev.get(col.id);
            const sides = new Map();
            const abx = col.bx - col.ax;
            const aby = col.by - col.ay;
            const len2 = abx * abx + aby * aby;
            // Teleport guard on the segment midpoint.
            let teleported = false;
            if (prev !== undefined) {
                const mx = (col.ax + col.bx) / 2;
                const my = (col.ay + col.by) / 2;
                const pmx = (prev.seg.ax + prev.seg.bx) / 2;
                const pmy = (prev.seg.ay + prev.seg.by) / 2;
                if (Math.hypot(mx - pmx, my - pmy) > TELEPORT_LIMIT) {
                    teleported = true;
                }
            }
            for (const trig of (hasTriggers ? triggers : [])) {
                if (trig === null || typeof trig.id !== "string") continue;
                const px = typeof trig.x === "number" ? trig.x : 0;
                const py = typeof trig.y === "number" ? trig.y : 0;
                // Signed side of the target relative to the cursor
                // line (z of (B-A) x (P-A)).
                const side = abx * (py - col.ay) - aby * (px - col.ax);
                const sign = side > 0 ? 1 : (side < 0 ? -1 : 0);
                sides.set(trig.id, sign);
                if (teleported || prev === undefined || dt === 0) continue;
                const prevSign = prev.sides.get(trig.id);
                if (prevSign === undefined || prevSign === 0 || sign === 0) continue;
                if (prevSign === sign) continue;
                if (len2 === 0) continue;
                // Foot of the target on this frame's segment, in
                // [0, 1] within the extent or it is off the ends.
                const u = ((px - col.ax) * abx + (py - col.ay) * aby) / len2;
                if (u < 0 || u > 1) continue;
                // Contact-point speed: foot this frame vs the same
                // parameter point on the previous frame's segment.
                const footX = col.ax + u * abx;
                const footY = col.ay + u * aby;
                const pFootX = prev.seg.ax + u * (prev.seg.bx - prev.seg.ax);
                const pFootY = prev.seg.ay + u * (prev.seg.by - prev.seg.ay);
                const hitSpeed = Math.hypot(footX - pFootX, footY - pFootY) / dt;
                const res = this._simulation.dispatchCollision({
                    colliderId: col.id,
                    colliderKind: col.kind,
                    targetId: trig.id,
                    targetKind: "trigger",
                    hitSpeed,
                });
                // Flash a struck trigger when its beenHit ran, via
                // the markFiredTrigger hook wired for this path.
                if (res !== null && typeof res === "object" && res.beenHitFired) {
                    this.markFiredTrigger(trig.id);
                }
            }
            // Curve beat-point markers as targets. The same
            // signed-side crossing test as triggers, with two
            // differences: the self-fire exclusion (a curve's
            // own cursor passing over its own markers fires
            // neither callback — only other colliders' cursors
            // hit a curve's markers), and a struck marker flashes
            // yellow via markFiredCurveBeat, the same hook the
            // pattern-firing path uses, keyed by the marker's t.
            // dispatchCollision resolves a "curve" target through
            // the curve's canBeHit / beenHitFunction fields.
            for (const m of markerTargets) {
                if (col.kind === "curve" && col.id === m.curveId) continue;
                const side = abx * (m.y - col.ay) - aby * (m.x - col.ax);
                const sign = side > 0 ? 1 : (side < 0 ? -1 : 0);
                sides.set(m.key, sign);
                if (teleported || prev === undefined || dt === 0) continue;
                const prevSign = prev.sides.get(m.key);
                if (prevSign === undefined || prevSign === 0 || sign === 0) continue;
                if (prevSign === sign) continue;
                if (len2 === 0) continue;
                const u = ((m.x - col.ax) * abx + (m.y - col.ay) * aby) / len2;
                if (u < 0 || u > 1) continue;
                const footX = col.ax + u * abx;
                const footY = col.ay + u * aby;
                const pFootX = prev.seg.ax + u * (prev.seg.bx - prev.seg.ax);
                const pFootY = prev.seg.ay + u * (prev.seg.by - prev.seg.ay);
                const hitSpeed = Math.hypot(footX - pFootX, footY - pFootY) / dt;
                const res = this._simulation.dispatchCollision({
                    colliderId: col.id,
                    colliderKind: col.kind,
                    targetId: m.curveId,
                    targetKind: "curve",
                    hitSpeed,
                    markerValue: m.value,
                });
                if (res !== null && typeof res === "object" && res.beenHitFired) {
                    this.markFiredCurveBeat(m.curveId, m.t);
                }
            }
            next.set(col.id, {
                seg: { ax: col.ax, ay: col.ay, bx: col.bx, by: col.by },
                sides,
            });
        }
        this._collisionPrev = next;
    }

}

// Prototype-mixin assembly (IN_FLIGHT 2026-06-02 canvas.js split). The
// viewport, render, and sampling method bundles are plain objects of
// method-shorthand functions; copying them onto Canvas.prototype after
// the class declaration makes them ordinary instance methods, with
// `this` bound to the Canvas instance. Safe because canvas.js uses no
// true-private fields and keeps all state on `this` via the `_`
// convention, so there are zero call-site changes.
Object.assign(
    Canvas.prototype,
    viewportMethods,
    renderMethods,
    samplingMethods,
    hitTestMethods,
    selectionMethods,
    hoverMethods,
);
