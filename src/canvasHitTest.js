// @ts-check

import { sampleCurve } from "./curveGeometry.js";
import {
  HANDLE_HIT_PADDING_PX,
  HANDLE_HOVER_SIZE_PX,
  TOOLTIP_CURSOR_HIT_PX,
  TOOLTIP_MARKER_HIT_PX,
  distanceToSegment,
  pixelPerpendicularUnit,
} from "./canvasShared.js";

export const hitTestMethods = {

    // --- Selection rendering ---

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
    },

    /**
     * Find the ACTIVE beat point (audible tick) nearest a pixel point, within the
     * tick hit radius, as { id, index } — id is the curve, index is the slot into
     * its cached positions (the same index the firing engine stamps). Null when no
     * tick is close enough. Drives the Ctrl-click "rewind to this beat" seek.
     * @param {number} pixelX
     * @param {number} pixelY
     * @returns {{ id: string, index: number } | null}
     */
    _beatPointAt(pixelX, pixelY) {
        if (this._scene === null) return null;
        let best = null;
        let bestD = TOOLTIP_MARKER_HIT_PX;
        for (let i = this._scene.curves.length - 1; i >= 0; i--) {
            const c = this._scene.curves[i];
            if (typeof c.id !== "string") continue;
            const positions = this._curveMarkerPositions.get(c.id);
            if (positions === undefined) continue;
            const offset = this._curveOffset(c.id);
            for (let k = 0; k < positions.length; k++) {
                const sample = sampleCurve(c.shape, positions[k]);
                if (sample === null) continue;
                const mx = this.toPixelX(sample.x + offset.dx);
                const my = this.toPixelY(sample.y + offset.dy);
                const d = Math.hypot(pixelX - mx, pixelY - my);
                if (d <= bestD) { bestD = d; best = { id: c.id, index: k }; }
            }
        }
        return best;
    },

    /**
     * Public hit-test from viewport (client) coordinates.
     * Converts the client point to canvas space using the
     * same _eventToCanvas conversion the mousedown handler
     * uses, then returns the topmost object under it as
     * { kind, index } or null. Used by main.js's canvas
     * right-click handler to decide which object the
     * context menu targets.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{kind: "sprite"|"trigger"|"curve", index: number} | null}
     */
    objectAtClientPoint(clientX, clientY) {
        const pos = this._eventToCanvas(
            /** @type {MouseEvent} */ ({ clientX, clientY }),
        );
        return this._hitTestObject(pos.x, pos.y);
    },

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
    },

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
    },

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
        // ±8 px per side (a 16 px-wide grab band). Distance is measured
        // to the LINE SEGMENTS between consecutive samples, not to the
        // nearest sample POINT — so the catch band is a uniform 8 px
        // along the whole curve regardless of its on-screen size.
        // (Point-sampling made large curves hard and inconsistent to
        // grab: between two widely-spaced samples a click could sit
        // exactly on the line yet be >threshold from the nearest
        // sample.) Shared by click-to-select, drag, and hover, which all
        // route through _hitTestObject.
        const HIT_THRESHOLD_PX = 8;
        const SAMPLES = 64;
        const px = canvasX * ppu;
        const py = canvasY * ppu;
        for (let i = this._scene.curves.length - 1; i >= 0; i--) {
            const curve = this._scene.curves[i];
            // Shift each sample by the curve's runtime (dx, dy) offset so
            // the click hits the curve where the user sees it. Curves
            // with no offset get (0, 0) from _curveOffset.
            const offset = this._curveOffset(curve.id);
            let prev = null;
            for (let s = 0; s <= SAMPLES; s++) {
                const t = s / SAMPLES;
                const sample = sampleCurve(curve.shape, t);
                if (sample === null) { prev = null; continue; }
                const cx = (sample.x + offset.dx) * ppu;
                const cy = (sample.y + offset.dy) * ppu;
                if (prev === null) {
                    // First valid sample (or after a gap): catch a click
                    // right on the point, covering the single-sample case.
                    if (Math.hypot(px - cx, py - cy) <= HIT_THRESHOLD_PX) return i;
                } else if (distanceToSegment(px, py, prev.x, prev.y, cx, cy) <= HIT_THRESHOLD_PX) {
                    return i;
                }
                prev = { x: cx, y: cy };
            }
        }
        return null;
    },

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
        if (this._selectableKinds.sprite !== false) {
            const sIdx = this._hitTestSprite(canvasX, canvasY);
            if (sIdx !== null) return { kind: "sprite", index: sIdx };
        }
        if (this._selectableKinds.trigger !== false) {
            const tIdx = this._hitTestTrigger(canvasX, canvasY);
            if (tIdx !== null) return { kind: "trigger", index: tIdx };
        }
        if (this._selectableKinds.curve !== false) {
            const cIdx = this._hitTestCurve(canvasX, canvasY);
            if (cIdx !== null) return { kind: "curve", index: cIdx };
        }
        return null;
    },

    /**
     * Hit-test the pointer position against the selection
     * box's resize zones. Returns the handle id under the
     * pointer, or null.
     *
     * Only the four CORNER handles (tl/tr/br/bl) are drawn,
     * each a square hit zone of HANDLE_HOVER_SIZE_PX plus a
     * pad. The four SIDES (t/b/l/r) have no drawn handle —
     * instead the whole edge line is a grab band of the same
     * ±half-width, so dragging anywhere along a side does the
     * 1-D resize the old edge-midpoint handle did. Removing
     * the midpoint handles keeps them from covering beat
     * points. Corners are tested first so they win in their
     * square; the rest of each edge is the side band.
     * @param {number} px
     * @param {number} py
     * @returns {string | null}
     */
    _hitTestHandle(px, py) {
        const bbox = this._getSelectionBbox();
        if (bbox === null) return null;
        const left = this.toPixelX(bbox.x1);
        const right = this.toPixelX(bbox.x2);
        // Canvas Y is up, pixel Y is down: bbox.y2 (top) maps to the
        // smaller pixel Y.
        const top = this.toPixelY(bbox.y2);
        const bottom = this.toPixelY(bbox.y1);
        const halfHit = HANDLE_HOVER_SIZE_PX / 2 + HANDLE_HIT_PADDING_PX;

        // Corners first — they take priority over the side bands.
        const corners = {
            tl: { px: left, py: top },
            tr: { px: right, py: top },
            br: { px: right, py: bottom },
            bl: { px: left, py: bottom },
        };
        for (const id of Object.keys(corners)) {
            const a = corners[id];
            if (Math.abs(px - a.px) <= halfHit && Math.abs(py - a.py) <= halfHit) {
                return id;
            }
        }

        // Side bands — a ±halfHit strip along each edge, between the
        // corners. The parallel coordinate must lie within the box's
        // span so the band doesn't extend past a corner.
        const minX = Math.min(left, right);
        const maxX = Math.max(left, right);
        const minY = Math.min(top, bottom);
        const maxY = Math.max(top, bottom);
        const withinX = px >= minX && px <= maxX;
        const withinY = py >= minY && py <= maxY;
        if (withinX && Math.abs(py - top) <= halfHit) return "t";
        if (withinX && Math.abs(py - bottom) <= halfHit) return "b";
        if (withinY && Math.abs(px - left) <= halfHit) return "l";
        if (withinY && Math.abs(px - right) <= halfHit) return "r";
        return null;
    },

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
     * uses for curves: non-zero extent and state "active").
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
        // uses (non-zero extent and state "active") so
        // unrendered cursors don't produce hover hits.
        const ppu = this.pixelsPerUnit;
        for (let i = this._scene.curves.length - 1; i >= 0; i--) {
            const c = this._scene.curves[i];
            if (typeof c.id !== "string") continue;
            if (c.cursorR === 0 && c.cursorL === 0) continue;
            if (c.state !== "active") continue;
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
    },
};
