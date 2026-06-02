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
import { inputMethods } from "./canvasInput.js";
import { collisionMethods } from "./canvasCollision.js";

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
    inputMethods,
    collisionMethods,
);
