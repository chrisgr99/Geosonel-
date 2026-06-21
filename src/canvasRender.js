// @ts-check
import {
  AXIS_COLOUR, BG_COLOUR, CANVAS_BORDER_COLOUR, CANVAS_BORDER_WIDTH_PX, CANVAS_OUTSIDE_COLOUR, CURSOR_COLOUR, CURSOR_TARGET_COLOUR, CURVE_COLOUR, FIRING_FLASH_COLOUR, FIRING_FLASH_DURATION_MS, FIRING_FLASH_MATCH_EPS, HANDLE_FILL_COLOUR, HANDLE_HOVER_SIZE_PX, HANDLE_SIZE_PX, HANDLE_STROKE_COLOUR, HOVER_LIGHTEN_RATIO, HOVER_LINE_WIDTH_BONUS, MAJOR_GRID_COLOUR, MARQUEE_DRAG_FILL, MARQUEE_DRAG_STROKE, MINOR_GRID_COLOUR, OBJECT_BOUNDARY_COLOUR, POLYLINE_CLOSE_SNAP_PX, SELECTION_MARKER_COLOUR, SPRITE_DEFAULT_HEADING, SPRITE_FILL_ALPHA, SPRITE_HEADING_DEFAULT_TURN, SPRITE_HEADING_TELEPORT_LIMIT, SPRITE_HEADING_VEC_EPS, buildSpriteTeardropPath, curveBoundingBox, imageFromBlob, lightenColor, pixelPerpendicularUnit, pixelTangentAndPerp,
} from "./canvasShared.js";
import { applyBrightnessReduction } from "./imageTransform.js";
import { getPreference } from "./preferences.js";
import { deriveCurveBeatPoints } from "./beatPoints.js";
import { buildOKLChBuffer } from "./strudel/oklch.js";
import { computeStretchParams, applyStretch } from "./strudel/imageStretch.js";
import { sampleCurve, splineToPolyline } from "./curveGeometry.js";

/**
 * Beat-point diamond sizing (§3.1a). An ACTIVE beat draws at the
 * default trigger size (0.35 canvas units, the schema default for
 * a trigger's `size`) times the score's triggerScale, so it reads
 * exactly like a normal trigger and scales with zoom the same way.
 * An INACTIVE beat (rest) draws at this fraction of the active
 * radius — visibly smaller, marking the grid without competing
 * with the accents.
 */
const BEAT_POINT_ACTIVE_UNITS = 0.35;
const BEAT_POINT_INACTIVE_RATIO = 0.5;

/**
 * Rendering method bundle for the Canvas module (prototype-mixin
 * split, IN_FLIGHT 2026-06-02). Object.assign'd onto Canvas.prototype
 * by canvas.js, so `this` is the Canvas instance; all state lives on
 * `this` via the `_` convention. Methods are verbatim copies of the
 * former Canvas class methods.
 */
export const renderMethods = {

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
            this._imageOKLChStretched = null;
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
            // Bake the per-pixel signal stretch (design/agc.md). The
            // stretch params (an independent 5–95 percentile band per
            // L/a/b/C axis) are computed once from the raw buffer, then
            // applied to produce the stretched buffer the sampler reads.
            // Keeping BOTH buffers: raw for any true-colour need,
            // stretched for the pre-stretched this.col.* signals. Null
            // whenever the raw buffer is null.
            this._imageOKLChStretched = this._imageOKLCh === null
                ? null
                : applyStretch(
                    this._imageOKLCh,
                    computeStretchParams(this._imageOKLCh),
                );
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
            this._imageOKLChStretched = null;
            this.scheduleDraw();
        }
    },

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
    },

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

        // Emit per-curve active-beat state to the Code-tab
        // highlighter after the simulation tick so each
        // curve's cursor parameter is current for this frame.
        // Paints nothing on the canvas; forwards the cursor
        // fraction and patternRepeats per playing curve to the
        // editor, which outlines the matching source token.
        this._emitActiveBeats();

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
        this._drawPolylineGesture();

        ctx.restore();

        // Collision detection runs after the scene is drawn so
        // sprite headings (set in _drawSprites) are current for
        // this frame's cursor geometry. It paints nothing; it
        // reads cursor and target positions and fires collision
        // callbacks as a side effect.
        this._detectCollisions();
    },

    _drawScene() {
        if (this._scene === null) return;
        this._refreshStrudelMarkersForLiveCycle();
        this._drawCurves();
        this._drawTriggers();
        this._drawSprites();
    },

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
            // Disabled curves render desaturated to gray (the
            // whole object), matching disabled triggers and
            // sprites; greying is reserved for disabled. A
            // passive curve keeps full colour and only loses
            // its cursor (gated in _drawCurveCursor). The cursor
            // does not draw for a disabled curve anyway, so the
            // filter only greys the shape and its markers.
            const curveDisabled = curve.state === "disabled";
            if (curveDisabled) {
                ctx.save();
                ctx.filter = "grayscale(100%)";
            }
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
            if (curveDisabled) {
                ctx.restore();
            }
        }
    },

    _strokeCurveShape(curve) {
        const ctx = this.ctx;
        const hovered = this._isHovered("curve", curve);
        // Per-object stroke colour, with a defensive
        // fallback to the global CURVE_COLOUR for any
        // in-memory curve that arrives here without the
        // color field populated. Scene loads through the
        // Curve constructor get the schema default, and
        // scenes parsed from older JSON pick up the same
        // default at load time, so the fallback only fires
        // for hand-constructed Curve objects (tests, future
        // programmatic APIs) that bypass the constructor's
        // default.
        let strokeColor = typeof curve.color === "string" && curve.color.length > 0
            ? curve.color
            : CURVE_COLOUR;
        // Cursor-target override: when the editor cursor
        // logically owns this curve, swap in the magenta
        // highlight before the hover lerp so a hovered +
        // cursor-target curve still reads as cursor-target
        // (lightened magenta) rather than lightened green.
        if (this._cursorTargetIds.has(curve.id)) {
            strokeColor = CURSOR_TARGET_COLOUR;
        }
        ctx.strokeStyle = hovered
            ? lightenColor(strokeColor, HOVER_LIGHTEN_RATIO)
            : strokeColor;
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
        } else if (s.type === "spline") {
            // Smooth curve: flatten the control points to a dense
            // Catmull-Rom polyline and stroke that (periodic when closed).
            const pts = splineToPolyline(s.points, !!s.closed);
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
    },

    _drawCurveMarkers(curve) {
        const active = this._curveMarkerPositions.get(curve.id);
        const inactive = this._curveInactiveBeatPositions.get(curve.id);
        const hasActive = active !== undefined && active.length > 0;
        const hasInactive = inactive !== undefined && inactive.length > 0;
        if (!hasActive && !hasInactive) return;

        const ctx = this.ctx;
        ctx.lineWidth = 1.5;

        // Beat-point diamonds are sized RELATIVE to a trigger and
        // scale with zoom like one. The size reflects whether the
        // beat will SOUND, not just whether it fires: a LARGE
        // diamond (a default trigger's radius, 0.35 units × the
        // score's triggerScale) is a beat with strength > 0 — it
        // will be heard; a SMALL diamond (0.7× that) is a silent
        // position — a strength-0 beat (fires onActiveBeat but at
        // zero velocity, so inaudible) OR a rest/dot (no beat at
        // all). The 0.7 is applied to the floored large radius so
        // the difference holds even at far zoom-out. Small
        // diamonds are a visual aid for reading the pattern on the
        // curve; they have no effect on firing. Orientation
        // follows the curve tangent, as before.
        const scale = this._scene === null ? 1 : this._scene.triggerScale;
        const largeR = Math.max(3, BEAT_POINT_ACTIVE_UNITS * scale * this.pixelsPerUnit);
        const smallR = largeR * BEAT_POINT_INACTIVE_RATIO;
        const strengths = this._curveBeatStrengths.get(curve.id);

        // Firing-event flash. The persistent-until-superseded
        // semantics for curves mean at most one marker on this
        // curve carries the yellow stroke at any time; the value
        // lives in _curveFlashAbsoluteFractional and equals the
        // GXW-cycle position of the most recently fired beat.
        // Per-marker match drives the stroke override, with
        // FIRING_FLASH_MATCH_EPS guarding rounding drift. Only
        // beats fire (active positions), so only they can flash —
        // including a small strength-0 beat.
        const flashAbsFrac = this._curveFlashAbsoluteFractional.get(curve.id);

        // Rests/dots (always small) first so audible (large)
        // diamonds paint on top where they happen to overlap.
        if (hasInactive) {
            for (const t of inactive) {
                this._paintBeatDiamond(curve, t, smallR, false);
            }
        }
        if (hasActive) {
            for (let i = 0; i < active.length; i++) {
                const t = active[i];
                const s = strengths !== undefined ? strengths[i] : 0;
                const r = s > 0 ? largeR : smallR;
                const isFlashing = flashAbsFrac !== undefined &&
                    Math.abs(t - flashAbsFrac) < FIRING_FLASH_MATCH_EPS;
                this._paintBeatDiamond(curve, t, r, isFlashing);
            }
        }
    },

    /**
     * Paint one beat-point diamond at curve parameter `t` with
     * vertex radius `r` (pixels). Image-filled with the trigger
     * boundary stroke, or solid firing-flash colour when
     * `flashing`. No-op when the curve sample is undefined.
     * @param {any} curve
     * @param {number} t
     * @param {number} r
     * @param {boolean} flashing
     */
    _paintBeatDiamond(curve, t, r, flashing) {
        const sample = sampleCurve(curve.shape, t);
        if (sample === null) return;
        const ctx = this.ctx;
        const px = this.toPixelX(sample.x);
        const py = this.toPixelY(sample.y);
        const axes = pixelTangentAndPerp(sample.tx, sample.ty);

        ctx.beginPath();
        ctx.moveTo(px + axes.tx * r, py + axes.ty * r);
        ctx.lineTo(px + axes.px * r, py + axes.py * r);
        ctx.lineTo(px - axes.tx * r, py - axes.ty * r);
        ctx.lineTo(px - axes.px * r, py - axes.py * r);
        ctx.closePath();

        ctx.fillStyle = flashing ? FIRING_FLASH_COLOUR : this._sampleImageAt(sample.x, sample.y);
        ctx.fill();
        ctx.strokeStyle = flashing ? FIRING_FLASH_COLOUR : OBJECT_BOUNDARY_COLOUR;
        ctx.stroke();
    },

    /**
     * Refresh the cached beat-point diamond positions for every
     * curve in the current scene. Walks the scene's curves and
     * derives each curve's beat points from its Band-5 Beat
     * Points fields (beatPointsMode + the activeBeats / strength
     * strings, or the Strudel beatPattern) via
     * deriveCurveBeatPoints, storing the cycle-fraction positions
     * in _curveMarkerPositions and the aligned strengths in
     * _curveBeatStrengths, both keyed by curve id. Curves with
     * mode "none", an empty pattern, or a Strudel pattern that
     * cannot parse yet (engine not loaded) produce no positions
     * and are absent from the maps — absent entries render no
     * diamonds. _curveMarkerValues stays empty (beat points
     * carry strength, not a Strudel value); the collision
     * detector reads a struck beat point's value as null.
     *
     * This REPLACES the old cyclePattern-driven marker source —
     * cyclePattern is a dead Strudel-era firing path (§3.6); its
     * remaining references are swept in the §10 cleanup slice.
     *
     * Cheap to call: derivation is a short string walk (and a
     * one-cycle parse for Strudel mode), run only on setScene and
     * on Strudel-runtime status transitions, not per frame.
     */
    _refreshCurveMarkerPositions() {
        this._curveMarkerPositions.clear();
        this._curveMarkerValues.clear();
        this._curveBeatStrengths.clear();
        this._curveInactiveBeatPositions.clear();
        // Drop the per-cycle derivation guard so a Strudel curve re-derives
        // against its live cycle on the next draw (a mid-playback reload may
        // land on a cycle other than 0).
        this._curveMarkerCycle.clear();
        if (this._scene === null) return;
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string" || curve.id.length === 0) continue;
            const { positions, strengths, inactivePositions } = deriveCurveBeatPoints(curve);
            if (positions.length > 0) {
                this._curveMarkerPositions.set(curve.id, positions);
                this._curveBeatStrengths.set(curve.id, strengths);
            }
            if (inactivePositions.length > 0) {
                this._curveInactiveBeatPositions.set(curve.id, inactivePositions);
            }
        }
    },

    /**
     * Advance each Strudel curve's marker cache to the cycle it is currently
     * playing, so the on-curve diamonds blink in lockstep with what the firing
     * path plays (degrade drops/keeps, alternation, slow). Slice 0 samples
     * Strudel cycle cycleCount × Repeats — identical to the firing derivation
     * (deterministic queryArc), so the diamonds and the audio agree. Runs once
     * per cycle per curve (guarded by _curveMarkerCycle), not per frame; a no-op
     * before the simulation is wired and for non-Strudel curves.
     */
    _refreshStrudelMarkersForLiveCycle() {
        if (this._scene === null || this._simulation === null) return;
        for (const curve of this._scene.curves) {
            if (typeof curve.id !== "string" || curve.id.length === 0) continue;
            if (curve.beatPointsMode !== "strudel") continue;
            const cyc = this._simulation.getCurveCycleState(curve.id);
            if (cyc === null) continue;
            if (this._curveMarkerCycle.get(curve.id) === cyc.cycleCount) continue;
            const r = Number(curve.repeats);
            const reps = (Number.isFinite(r) && r >= 1) ? Math.floor(r) : 1;
            const { positions, strengths, inactivePositions } =
                deriveCurveBeatPoints(curve, cyc.cycleCount * reps);
            if (positions.length > 0) {
                this._curveMarkerPositions.set(curve.id, positions);
                this._curveBeatStrengths.set(curve.id, strengths);
            } else {
                this._curveMarkerPositions.delete(curve.id);
                this._curveBeatStrengths.delete(curve.id);
            }
            if (inactivePositions.length > 0) {
                this._curveInactiveBeatPositions.set(curve.id, inactivePositions);
            } else {
                this._curveInactiveBeatPositions.delete(curve.id);
            }
            this._curveMarkerCycle.set(curve.id, cyc.cycleCount);
        }
    },

    _drawCurveCursor(curve) {
        // Cursor-as-collider gate: a curve has a visible
        // cursor only when it has a non-zero extent AND its
        // state is "active". A passive or disabled curve has no
        // cursor on the canvas. Per section 27's
        // cursor-as-collider model, cursor presence is what
        // makes the curve a collider and an audio source; the
        // visual gate matches the operational one.
        //
        // The legacy `hide` field (curve-only, deprecated
        // in favour of the universal `state` — see
        // sceneSchema.js) is honoured alongside `state` so
        // existing scores that used hide as an ad-hoc cursor
        // hide keep their behaviour. New work should use
        // `state` ("passive").
        if (curve.cursorR === 0 && curve.cursorL === 0) return;
        if (curve.state !== "active" || curve.hide) return;

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
    },

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
            // Disabled triggers render desaturated to gray via
            // a canvas-level grayscale filter applied for the
            // duration of this trigger's draw. The filter
            // desaturates both the image-sampled fill and
            // the boundary stroke (including the hover-
            // lightened variant), keeping lightness contrast
            // against the canvas background while removing
            // colour as the disabled-state signal. Greying is
            // reserved for disabled; active triggers render
            // normally (triggers have no passive state).
            const isDisabled = t.state === "disabled";
            if (isDisabled) {
                ctx.save();
                ctx.filter = "grayscale(100%)";
            }
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
            // Firing-event flash check, computed up front so
            // it can override both the interior fill and the
            // boundary stroke. When the trigger is currently
            // flashing (beenTriggered just fired), the entire
            // diamond paints solid red — fill plus stroke
            // — for FIRING_FLASH_DURATION_MS, then reverts
            // naturally on the next frame past the window.
            const triggerFlashAt = this._triggerFlashTimestamp.get(t.id);
            const triggerFlashing = triggerFlashAt !== undefined &&
                (performance.now() - triggerFlashAt) < FIRING_FLASH_DURATION_MS;
            ctx.fillStyle = triggerFlashing
                ? FIRING_FLASH_COLOUR
                : this._sampleImageAt(t.x, t.y);
            ctx.fill();
            // Hover-brighten: bump the stroke colour toward
            // white and add a bit of line width. The fill
            // (image-sampled colour) is left alone so the
            // object's identifying image-pixel colour stays
            // readable underneath.
            const hovered = this._isHovered("trigger", t);
            // Cursor-target override: when the editor
            // cursor logically owns this trigger, swap in
            // the magenta highlight before the hover lerp
            // so a hovered + cursor-target trigger reads
            // as lightened magenta rather than lightened
            // boundary blue.
            //
            // Firing-event flash takes top precedence so the
            // red boundary matches the red fill above for
            // the flash window's duration, then the normal
            // cursor-target/stored-colour precedence
            // reasserts.
            const baseColor = triggerFlashing
                ? FIRING_FLASH_COLOUR
                : (this._cursorTargetIds.has(t.id)
                    ? CURSOR_TARGET_COLOUR
                    : t.color);
            ctx.strokeStyle = hovered
                ? lightenColor(baseColor, HOVER_LIGHTEN_RATIO)
                : baseColor;
            ctx.lineWidth = hovered
                ? 1.5 + HOVER_LINE_WIDTH_BONUS
                : 1.5;
            ctx.stroke();
            if (isDisabled) ctx.restore();
        }
    },

    _drawSprites() {
        if (this._scene === null) return;
        const ctx = this.ctx;
        // Per-frame elapsed seconds for the heading low-pass,
        // computed once here and threaded into
        // _spriteHeadingPixelAngle for every sprite this frame.
        // Clamped to [0, 0.1] so a long gap (e.g. a backgrounded
        // tab) can't produce a runaway smoothing step; the first
        // frame reads 0, which snaps the heading (no smoothing).
        const headingNow = performance.now();
        const headingDt = (this._lastHeadingFrameTime !== null)
            ? Math.min(0.1, Math.max(0, (headingNow - this._lastHeadingFrameTime) / 1000))
            : 0;
        this._lastHeadingFrameTime = headingNow;
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
            // Pixel-space heading angle the nose points along.
            // Faces the authored starting velocity at rest,
            // the live motion direction during playback, and
            // holds the last heading through a momentary stop;
            // defaults to left when there is no source. The
            // method also advances the per-sprite heading and
            // previous-position history each frame.
            const phi = this._spriteHeadingPixelAngle(s, pos, headingDt);
            // Disabled sprites render desaturated to gray via
            // a canvas-level grayscale filter applied for the
            // duration of this sprite's draw. The filter
            // desaturates both the image-sampled fill and
            // the boundary stroke (including the hover-
            // lightened variant), keeping lightness contrast
            // against the canvas background while removing
            // colour as the disabled-state signal. Greying is
            // reserved for disabled; a passive sprite keeps its
            // full colour and only loses its cursor (below).
            const isDisabled = s.state === "disabled";
            if (isDisabled) {
                ctx.save();
                ctx.filter = "grayscale(100%)";
            }
            // Directional teardrop body: a circle of radius r
            // forms the rounded back, two tangent lines
            // converge to a nose at a 90-degree apex pointing
            // along phi. The fill takes the colour of the
            // image pixel under the centre; the boundary keeps
            // the sprite legible against any background.
            buildSpriteTeardropPath(ctx, cx, cy, r, phi);
            // Firing-event flash check, computed up front so
            // it can override both the interior fill and the
            // boundary stroke. When the sprite is currently
            // flashing (a pattern event just fired), the
            // whole body paints solid red — fill plus stroke
            // — for FIRING_FLASH_DURATION_MS, then reverts
            // naturally on the next frame past the window.
            const spriteFlashAt = this._spriteFlashTimestamp.get(s.id);
            const spriteFlashing = spriteFlashAt !== undefined &&
                (performance.now() - spriteFlashAt) < FIRING_FLASH_DURATION_MS;
            // Fill. The sampled-colour fill paints at
            // SPRITE_FILL_ALPHA (the fill's alpha multiplier,
            // currently full opacity); the flash fill always
            // paints solid at full alpha so the firing hit
            // stays a strong signal. globalAlpha is restored
            // before the stroke so the outline is always
            // fully opaque.
            const prevAlpha = ctx.globalAlpha;
            ctx.fillStyle = spriteFlashing
                ? FIRING_FLASH_COLOUR
                : this._sampleImageAt(pos.x, pos.y);
            ctx.globalAlpha = spriteFlashing
                ? prevAlpha
                : prevAlpha * SPRITE_FILL_ALPHA;
            ctx.fill();
            ctx.globalAlpha = prevAlpha;
            // Hover-brighten: stroke uses a lightened colour
            // and a wider line width when this sprite is the
            // current hover target. Fill stays unchanged so
            // the image-pixel colour identifying the sprite
            // reads through the brightened ring.
            const hovered = this._isHovered("sprite", s);
            // Cursor-target override: when the editor
            // cursor logically owns this sprite, swap in
            // the magenta highlight before the hover lerp
            // so a hovered + cursor-target sprite reads
            // as lightened magenta rather than lightened
            // boundary blue.
            //
            // Firing-event flash takes top precedence so the
            // red boundary matches the red fill above for
            // the flash window's duration, then the normal
            // cursor-target/stored-colour precedence
            // reasserts.
            const baseColor = spriteFlashing
                ? FIRING_FLASH_COLOUR
                : (this._cursorTargetIds.has(s.id)
                    ? CURSOR_TARGET_COLOUR
                    : s.color);
            ctx.strokeStyle = hovered
                ? lightenColor(baseColor, HOVER_LIGHTEN_RATIO)
                : baseColor;
            ctx.lineWidth = hovered
                ? 1.5 + HOVER_LINE_WIDTH_BONUS
                : 1.5;
            ctx.stroke();
            if (isDisabled) ctx.restore();

            // Cursor line. A perpendicular segment through the
            // sprite's centre, extending cursorR to its right
            // and cursorL to its left of the heading, in the
            // curve-cursor colour at cursorThickness. Hidden
            // when both extents are zero or the sprite is not
            // active (a passive or disabled sprite has no firing
            // surface, matching a passive curve's hidden cursor).
            // Drawn after the body
            // so it reads on top, and deliberately NOT part of
            // the firing flash — only the body flashes red while
            // the cursor keeps its colour. R/L go through the
            // shared pixelPerpendicularUnit, which expects a
            // canvas-space tangent; phi is pixel-space, so the
            // canvas-space heading is recovered by flipping Y
            // (cos phi, -sin phi). This makes the right-of-motion
            // sense match the curve cursor exactly.
            if (s.state === "active" && (s.cursorR !== 0 || s.cursorL !== 0)) {
                const perp = pixelPerpendicularUnit(Math.cos(phi), -Math.sin(phi));
                const ppu = this.pixelsPerUnit;
                const xRight = cx + perp.x * s.cursorR * ppu;
                const yRight = cy + perp.y * s.cursorR * ppu;
                const xLeft = cx - perp.x * s.cursorL * ppu;
                const yLeft = cy - perp.y * s.cursorL * ppu;
                ctx.strokeStyle = CURSOR_COLOUR;
                ctx.lineWidth = s.cursorThickness;
                ctx.beginPath();
                ctx.moveTo(xLeft, yLeft);
                ctx.lineTo(xRight, yRight);
                ctx.stroke();
            }
        }
    },

    /**
     * Compute the pixel-space angle (radians) the sprite's
     * nose should point along this frame, and advance the
     * per-sprite smoothed heading vector and previous-position
     * history.
     *
     * The pointing direction is a persistent property of the
     * sprite, not the instantaneous motion direction. While
     * the transport is stopped (editor at rest) the sprite
     * faces its authored starting velocity (sprite.vx,
     * sprite.vy) so editing the velocity in the inspector
     * rotates a resting sprite immediately; a zero starting
     * velocity faces left. While playing, the frame-to-frame
     * displacement is low-passed into a stored heading vector
     * AS A VECTOR (distance-weighted), and the nose faces that
     * vector's angle: a small or backward step is a short
     * vector that barely turns the nose, sustained travel
     * dominates, and back-and-forth jitter cancels so the
     * heading holds. The time constant is
     * score.kinematics.turnDamping in seconds (0 tracks the
     * instantaneous displacement). A displacement above
     * SPRITE_HEADING_TELEPORT_LIMIT is a cycle-reset teleport
     * and is ignored; a smoothed vector shorter than
     * SPRITE_HEADING_VEC_EPS holds the last heading. A sprite
     * with no heading source yet points left
     * (SPRITE_DEFAULT_HEADING).
     *
     * Headings are stored in canvas space (Y up, +x = 0,
     * counter-clockwise positive) keyed by sprite id, then
     * converted to a pixel-space angle on return by flipping
     * the forward vector's Y component (pixel Y is down).
     *
     * @param {any} sprite
     * @param {{x: number, y: number}} pos  Current canvas-space position.
     * @param {number} headingDt  Seconds since the previous frame, for
     *   the heading low-pass. 0 (first frame) snaps without smoothing.
     * @returns {number}  Pixel-space heading angle in radians.
     */
    _spriteHeadingPixelAngle(sprite, pos, headingDt) {
        const id = typeof sprite.id === "string" ? sprite.id : null;
        const playing = this._transport !== null && this._transport.isPlaying;
        const vx = typeof sprite.vx === "number" ? sprite.vx : 0;
        const vy = typeof sprite.vy === "number" ? sprite.vy : 0;

        // The pointing direction is read from the sprite's
        // persistent smoothed heading vector, low-passed below.
        // Seed theta from the last stored heading; the branches
        // refine it.
        /** @type {number | undefined} */
        let theta = id !== null ? this._spriteHeading.get(id) : undefined;

        if (!playing) {
            // At rest in the editor: face the authored starting
            // velocity so editing it rotates the sprite live;
            // default left when it is zero. Seed the smoothed
            // vector along that direction so resuming playback
            // begins from the authored heading and adapts.
            theta = (vx !== 0 || vy !== 0)
                ? Math.atan2(vy, vx)
                : SPRITE_DEFAULT_HEADING;
            if (id !== null) {
                this._spriteHeadingVec.set(id, {
                    hx: Math.cos(theta),
                    hy: Math.sin(theta),
                });
            }
        } else if (id !== null) {
            // Playing: low-pass the frame-to-frame displacement
            // into the stored heading vector, then take the
            // heading from its angle.
            if (theta === undefined) {
                theta = (vx !== 0 || vy !== 0)
                    ? Math.atan2(vy, vx)
                    : SPRITE_DEFAULT_HEADING;
            }
            const prev = this._spritePrevPos.get(id);
            if (prev !== undefined) {
                const dx = pos.x - prev.x;
                const dy = pos.y - prev.y;
                const dist = Math.hypot(dx, dy);
                // Ignore cycle-reset teleports: a jump beyond the
                // limit is not travel, so it neither feeds the
                // vector nor moves the heading.
                if (dist < SPRITE_HEADING_TELEPORT_LIMIT) {
                    const kin = this._scene !== null ? this._scene.kinematics : null;
                    const tau = (kin !== null && typeof kin === "object"
                        && typeof kin.turnDamping === "number" && kin.turnDamping >= 0)
                        ? kin.turnDamping
                        : SPRITE_HEADING_DEFAULT_TURN;
                    const prevVec = this._spriteHeadingVec.get(id);
                    let hx;
                    let hy;
                    if (prevVec === undefined || tau <= 0 || headingDt <= 0) {
                        // No prior vector, smoothing off, or no
                        // time elapsed: take the displacement
                        // directly (instant heading).
                        hx = dx;
                        hy = dy;
                    } else {
                        const alpha = 1 - Math.exp(-headingDt / tau);
                        hx = prevVec.hx + (dx - prevVec.hx) * alpha;
                        hy = prevVec.hy + (dy - prevVec.hy) * alpha;
                    }
                    this._spriteHeadingVec.set(id, { hx, hy });
                    // Take the heading from the smoothed vector
                    // only while it is long enough to define a
                    // direction; below that (a stalled sprite, or
                    // one whose back-and-forth motion has
                    // cancelled) hold the last heading.
                    if (Math.hypot(hx, hy) > SPRITE_HEADING_VEC_EPS) {
                        theta = Math.atan2(hy, hx);
                    }
                }
            }
        }

        if (theta === undefined) theta = SPRITE_DEFAULT_HEADING;

        if (id !== null) {
            this._spriteHeading.set(id, theta);
            this._spritePrevPos.set(id, { x: pos.x, y: pos.y });
        }

        // Convert the canvas-space heading (Y up) to a pixel-
        // space angle (Y down) by flipping the forward unit
        // vector's Y component.
        return Math.atan2(-Math.sin(theta), Math.cos(theta));
    },

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
    },

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
    },

    /**
     * Render the four CORNER resize handles around the
     * current selection's bounding box. Drawn after
     * _drawSelectionMarkers so the handles sit on top of
     * the yellow dotted selection rectangles. The handle
     * currently under the pointer (this._hoverHandle)
     * renders at HANDLE_HOVER_SIZE_PX instead of
     * HANDLE_SIZE_PX so the pointer's gesture-actionable
     * target reads clearly. The four edge-midpoint handles
     * are deliberately NOT drawn — dragging anywhere along a
     * side does the 1-D resize instead (see _hitTestHandle),
     * which keeps a handle square from covering beat points.
     * No-op when the selection is empty (no bbox) or a
     * marquee gesture is in progress (we don't draw handles
     * on top of the rubber-band rectangle).
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
            // Corners only; the side midpoints (t/b/l/r) are not drawn.
            if (id !== "tl" && id !== "tr" && id !== "br" && id !== "bl") continue;
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
    },

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
    },

    /**
     * Render the in-progress line-segment (polyline) draw. Paints the
     * already-placed segments as a solid curve-green polyline with a
     * small dot at each placed vertex, plus a dashed rubber-band segment
     * from the last vertex to the current pointer so the next click's
     * segment is previewed live. Nothing commits until the double-click;
     * the eventual curve is a single piste through these vertices.
     */
    _drawPolylineGesture() {
        if (this._gesture === null || this._gesture.kind !== "drawPolyline") return;
        const g = this._gesture;
        const pts = g.points;
        if (!Array.isArray(pts) || pts.length === 0) return;
        const hasPreview = typeof g.previewX === "number" && typeof g.previewY === "number";

        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = CURVE_COLOUR;
        ctx.fillStyle = CURVE_COLOUR;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        // Closing affordance: with at least three vertices, a pointer
        // within the snap radius of the START point means a click would
        // CLOSE the curve. Preview the closed shape and ring the start.
        const sx = this.toPixelX(pts[0][0]);
        const sy = this.toPixelY(pts[0][1]);
        let closing = false;
        if (hasPreview && pts.length >= 3) {
            const ppx = this.toPixelX(g.previewX);
            const ppy = this.toPixelY(g.previewY);
            closing = Math.hypot(ppx - sx, ppy - sy) < POLYLINE_CLOSE_SNAP_PX;
        }

        if (g.shapeType === "spline") {
            // Smooth live curve. Closing → the periodic closed loop
            // through the placed points; otherwise the open curve through
            // the points plus the cursor (so it bends toward the click).
            const dense = closing
                ? splineToPolyline(pts, true)
                : splineToPolyline(hasPreview ? [...pts, [g.previewX, g.previewY]] : pts);
            if (dense.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(this.toPixelX(dense[0][0]), this.toPixelY(dense[0][1]));
                for (let i = 1; i < dense.length; i++) {
                    ctx.lineTo(this.toPixelX(dense[i][0]), this.toPixelY(dense[i][1]));
                }
                ctx.stroke();
            }
        } else {
            // Straight committed segments.
            if (pts.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(this.toPixelX(pts[0][0]), this.toPixelY(pts[0][1]));
                for (let i = 1; i < pts.length; i++) {
                    ctx.lineTo(this.toPixelX(pts[i][0]), this.toPixelY(pts[i][1]));
                }
                ctx.stroke();
            }
            // Closing → solid segment back to the start; otherwise the
            // dashed rubber-band to the cursor.
            if (closing) {
                const last = pts[pts.length - 1];
                ctx.beginPath();
                ctx.moveTo(this.toPixelX(last[0]), this.toPixelY(last[1]));
                ctx.lineTo(sx, sy);
                ctx.stroke();
            } else if (hasPreview) {
                const last = pts[pts.length - 1];
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(this.toPixelX(last[0]), this.toPixelY(last[1]));
                ctx.lineTo(this.toPixelX(g.previewX), this.toPixelY(g.previewY));
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // Dots at the placed control points (both modes).
        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(this.toPixelX(p[0]), this.toPixelY(p[1]), 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        // Ring the start point when a click there would close the curve.
        if (closing) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sx, sy, 6, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    },

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
    },

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
    },

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
    },

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
    },

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
    },
};
