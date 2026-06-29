// @ts-check
/**
 * Shared constants and pure helpers for the Canvas module.
 *
 * Extracted verbatim from canvas.js as part of the prototype-mixin
 * split (IN_FLIGHT 2026-06-02). Holds the 43 module-level constants
 * and the 13 pure module-level helper functions that canvas.js core
 * and its method bundles (canvasViewport.js, canvasRender.js,
 * canvasSampling.js) import by name. Every constant and helper is a
 * named export. These helpers depend on nothing outside this file, so
 * canvasShared.js itself has no imports.
 */

export const DEFAULT_HALF_WIDTH = 16;   // \u00b116 units horizontally at zoom 1
export const DEFAULT_HALF_HEIGHT = 12;  // \u00b112 units vertically at zoom 1

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 20;
export const MENU_ZOOM_FACTOR = 1.2;    // one menu click / keyboard step
export const WHEEL_ZOOM_FACTOR = 1.08;  // per wheel notch

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
export const AUTO_ZOOM_MARGIN_PX = 4;

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
export const BG_COLOUR = "#2a2a2a";
export const MINOR_GRID_COLOUR = "#484848";
export const MAJOR_GRID_COLOUR = "#5c5c5c";
export const AXIS_COLOUR = "#7c7c7c";

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
export const CANVAS_OUTSIDE_COLOUR = "#181818";
export const CANVAS_BORDER_COLOUR = "#b8b8b8";
export const CANVAS_BORDER_WIDTH_PX = 3;

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
export const CURVE_COLOUR = "#7dd68a";
export const CURSOR_COLOUR = "#ff8c00";
export const OBJECT_BOUNDARY_COLOUR = "#7db8d6";
// Bright magenta used to highlight the object(s) the
// editor cursor logically owns when sitting inside a
// labelled pattern block in script.js or inside a
// top-level function declaration whose name is bound to
// any object's hasCollidedFunction / beenTriggeredFunction /
// onTickFunction slot. Pure #ff00ff reads slightly cold;
// nudging the red channel up to 0x44 keeps the warmth of
// a CRT-era magenta while staying unmistakable against
// the soft-blue object boundary and soft-green curve
// defaults. Applied as a stroke override at draw time;
// the object's stored color field is unchanged.
export const CURSOR_TARGET_COLOUR = "#ff44ff";
export const NO_IMAGE_FILL_COLOUR = "#404040";

// Firing-event flash colour and timing. When the firing
// engine dispatches an audio event for a curve or sprite
// (or, in future, a trigger via beenTriggered), the corresponding
// canvas object turns bright red as a visual confirmation
// of the event firing. The flash replaces both the
// interior fill (normally an image-sampled colour) and
// the outline stroke (normally the object's stored colour
// or the trigger-boundary blue for curve markers) so the
// object reads as a solid red shape — a stronger visual
// hit than the earlier outline-only flash, which got lost
// against high-contrast image backgrounds.
//
// Two distinct flash semantics live behind this colour:
//
//   - Curve beat-point diamonds: persistent-until-superseded.
//     The most recently fired diamond on a given curve
//     stays red until the next diamond on that curve
//     fires, at which point the new diamond becomes red
//     and the previous one reverts. At most one diamond
//     per curve is red at any moment, and it chases the
//     cursor as it sweeps. No time-based fade; the visual
//     replacement happens at the moment of the next
//     firing event. State lives in
//     _curveFlashAbsoluteFractional as a per-curve
//     absoluteFractional value.
//
//   - Sprite outlines and trigger diamonds: short-fade
//     flash. The object turns red on each fire, then
//     naturally reverts after FIRING_FLASH_DURATION_MS
//     via the render path's elapsed-time check. State
//     lives in _spriteFlashTimestamp and
//     _triggerFlashTimestamp as per-object
//     performance.now() timestamps. Rapid successive
//     fires within the window extend the on-state
//     (last-write-wins on the timestamp) rather than
//     producing on/off stutter.
export const FIRING_FLASH_COLOUR = "#ff0000";
export const FIRING_FLASH_DURATION_MS = 150;

// Tolerance for matching a stored absoluteFractional
// against a marker position when deciding which curve
// diamond is currently yellow. The stored value comes
// from the firing engine at populate time and the marker
// position comes from parsePatternToPositions; both
// derive from the same strudel queryArc output and
// arithmetic, so the values match to floating-point
// precision in practice. The epsilon is a defensive
// guard against any rounding-error drift, kept tight
// enough that two distinct beats can never collide (the
// smallest gap between two beats in a 256-beat pattern
// at patternRepeats=4 is 1/1024 ≈ 0.001, comfortably
// above this).
export const FIRING_FLASH_MATCH_EPS = 1e-6;

// Resolution of the pixel-sampling array built from the
// background image. Matches GeoSonix's 1000×1000 sampling
// grid — at this size, two adjacent units of canvas space
// resolve to roughly 30 sample pixels in the default ±16/±12
// viewing region, which is plenty for trigger/sprite fills
// while keeping memory bounded to ~4 MB regardless of the
// source image's true resolution.
export const PIXEL_SAMPLE_SIZE = 1000;

// Colours for selection markers and the marquee drag
// rectangle. Marquees around selected objects are yellow
// dotted squares per GeoSonix's convention; the marquee drag
// rectangle (the one the user is dragging out across empty
// canvas space) is a translucent grey region.
export const SELECTION_MARKER_COLOUR = "#ffd24a";
export const MARQUEE_DRAG_FILL = "rgba(220, 220, 220, 0.18)";
export const MARQUEE_DRAG_STROKE = "rgba(220, 220, 220, 0.5)";

// Pixel distance the mouse must travel from mousedown before
// a pending gesture transitions into a drag or marquee. Below
// this, mousedown+mouseup is treated as a click.
export const DRAG_THRESHOLD_PX = 4;

// Snap radius (pixels) for closing a polyline/spline draw: while drawing
// a multi-point curve, a click within this distance of the start point
// closes the curve instead of adding a vertex. Shared by the close
// detection (canvasInput) and the closing preview (canvasRender) so the
// "ring the start point" affordance appears exactly when a click closes.
export const POLYLINE_CLOSE_SNAP_PX = 12;

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
export const HOVER_DEBOUNCE_MS = 150;
export const HOVER_LIGHTEN_RATIO = 0.4;
export const HOVER_LINE_WIDTH_BONUS = 1.5;

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
export const HANDLE_SIZE_PX = 8;
export const HANDLE_HOVER_SIZE_PX = 12;
export const HANDLE_HIT_PADDING_PX = 2;
export const HANDLE_FILL_COLOUR = "#ffd24a";
export const HANDLE_STROKE_COLOUR = "#1a1a1a";

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
export const TOOLTIP_DELAY_MS = 450;
export const TOOLTIP_CURSOR_HIT_PX = 6;
export const TOOLTIP_MARKER_HIT_PX = 7;

// Sprite directional-body rendering. The sprite is drawn as
// a teardrop: a circle of radius r forms the rounded back
// and two tangent lines converge to a nose at a fixed
// 90-degree apex, r*sqrt(2) from the centre, so the nose
// points along the sprite's heading. The fill (the image
// colour sampled at the centre) and the outline (the
// sprite's colour) both paint at full opacity.
// SPRITE_FILL_ALPHA is the fill's alpha multiplier, kept as
// a tunable knob: lowering it would let whatever sits
// beneath the sprite (a trigger it is about to reach, say)
// show faintly through the body.
export const SPRITE_FILL_ALPHA = 1.0;

// Heading tracking for the directional body. The nose points
// along a persistent, smoothed estimate of the sprite's
// direction of travel — NOT the instantaneous motion
// direction, which jitters frame to frame under the anti-trap
// agitation or a noisy force field. Each playing frame the
// frame-to-frame displacement is low-passed into a stored
// heading vector (see _spriteHeadingVec) AS A VECTOR, so it is
// weighted by distance travelled, and the nose faces that
// vector's angle. Distance weighting is the crux: a small or
// backward jitter step is a short vector that barely moves the
// accumulated heading, so the nose holds the sustained
// direction and ignores the wobble; pure back-and-forth motion
// cancels toward a zero-length vector and the heading is held.
// The low-pass time constant is score.kinematics.turnDamping
// (seconds); 0 disables it (the heading then tracks the
// instantaneous displacement). While the transport is stopped
// the nose faces the authored starting velocity so editing it
// rotates a resting sprite live. A displacement above
// SPRITE_HEADING_TELEPORT_LIMIT (canvas units) is a cycle-reset
// teleport, not travel, and is ignored. When the smoothed
// vector is shorter than SPRITE_HEADING_VEC_EPS its direction
// is undefined and the last heading is held. A sprite with no
// heading source yet points left.
export const SPRITE_HEADING_VEC_EPS = 1e-3;
export const SPRITE_HEADING_TELEPORT_LIMIT = 6;
export const SPRITE_DEFAULT_HEADING = Math.PI; // left (-x) in canvas space
// Fallback heading-smoothing time constant (seconds), used when
// a scene carries no kinematics.turnDamping (defensive; the
// loader and the Scene constructor both populate it from
// DEFAULT_KINEMATICS.turnDamping, so this mirrors that value).
export const SPRITE_HEADING_DEFAULT_TURN = 0.9;

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
export function pixelTangentAndPerp(tx, ty) {
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
export function pixelPerpendicularUnit(tx, ty) {
    const len = Math.hypot(tx, ty);
    if (len === 0) return { x: 0, y: 0 };
    return { x: ty / len, y: tx / len };
}

/**
 * Build the directional sprite teardrop as a closed path on
 * the given context, ready to fill and stroke. The body is a
 * circle of radius r centred at (cx, cy) in pixel space; two
 * straight sides tangent to that circle converge to a sharp
 * nose at a fixed 90-degree apex pointing along phi (a
 * pixel-space angle). The apex sits at distance r*sqrt(2)
 * from the centre and the two tangent contact points lie 45
 * degrees off the heading on either side, so the rounded
 * back spans the 270-degree arc between them. The path runs
 * the two nose lines (contact A -> apex -> contact B) and
 * closes with that back arc.
 *
 * Tangency: with the apex at r*sqrt(2) and the contacts at
 * +/-45 degrees, each nose line meets the circle at a right
 * angle to the radius, so the straight sides join the arc
 * smoothly (no kink) and the half-angle at the apex is 45
 * degrees, i.e. a 90-degree nose. Because the canvas uses an
 * equal metric (one unit in X equals one unit in Y in
 * pixels), the tangency and angles hold in pixel space too.
 *
 * Issues its own beginPath / closePath, so the caller fills
 * and strokes the current path directly after calling.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} phi  Pixel-space heading angle in radians.
 */
export function buildSpriteTeardropPath(ctx, cx, cy, r, phi) {
    const quarter = Math.PI / 4;
    // Tangent contact points sit 45 degrees off the heading
    // on each side; the apex is straight ahead along phi at
    // r*sqrt(2) from the centre.
    const angleA = phi + quarter;
    const angleB = phi - quarter;
    const taX = cx + r * Math.cos(angleA);
    const taY = cy + r * Math.sin(angleA);
    const tbX = cx + r * Math.cos(angleB);
    const tbY = cy + r * Math.sin(angleB);
    const apexX = cx + r * Math.SQRT2 * Math.cos(phi);
    const apexY = cy + r * Math.SQRT2 * Math.sin(phi);
    ctx.beginPath();
    ctx.moveTo(taX, taY);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(tbX, tbY);
    // Back arc: sweep from contact B the long way (270
    // degrees) around the rear of the circle to contact A,
    // skipping the 90-degree front arc the nose replaces.
    // anticlockwise = true takes the decreasing-angle
    // direction, which from B reaches A through the rear.
    ctx.arc(cx, cy, r, angleB, angleA, true);
    ctx.closePath();
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
export function distanceToSegment(px, py, x1, y1, x2, y2) {
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
export function curveBoundingBox(shape) {
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
    if (shape.type === "piste" || shape.type === "spline") {
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
export function filterIndexSet(set, max) {
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
export function snapshotShapeCoords(shape) {
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
    if (shape.type === "piste" || shape.type === "spline") {
        if (!Array.isArray(shape.points)) return null;
        return {
            type: shape.type,
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
export function applyShapeCoordsTranslation(shape, initialCoords, dx, dy) {
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
    } else if (shape.type === "piste" || shape.type === "spline") {
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
export function snapshotShapeForResize(shape) {
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
    if (shape.type === "piste" || shape.type === "spline") {
        if (!Array.isArray(shape.points)) return null;
        return {
            type: shape.type,
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
export function applyShapeCoordsScale(shape, initialCoords, ax, ay, sx, sy) {
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
    } else if (shape.type === "piste" || shape.type === "spline") {
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
export function lightenColor(hex, ratio) {
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
export function toHexByte(n) {
    const s = n.toString(16);
    return s.length < 2 ? "0" + s : s;
}

/**
 * Decode a Blob into an HTMLImageElement via an object URL.
 * Used as a fallback when createImageBitmap is not available.
 * @param {Blob} blob
 * @returns {Promise<HTMLImageElement>}
 */
export function imageFromBlob(blob) {
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
