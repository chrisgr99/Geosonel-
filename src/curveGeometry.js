/**
 * Curve geometry sampling.
 *
 * Pure functions for evaluating a curve's shape at a given
 * cursor parameter t in [0, 1]. Returns the world-space
 * (canvas-unit) position and tangent at that point. Used by
 * the canvas at draw time to position the visible cursor,
 * and by the composition mirror (src/mirrorPush.js) to write
 * runtime cursor positions into runtime-state.json so an AI
 * reading the mirror folder can correlate cursor positions
 * with scene.json curve geometry.
 *
 * Sampling is per-shape-type and matches the parameterisation
 * the simulation uses to drive t:
 *
 *   - line: linear interpolation from (x1, y1) at t=0 to
 *     (x2, y2) at t=1. Tangent is the straight-line
 *     direction (x2-x1, y2-y1), unnormalised.
 *
 *   - ellipse: (cx + rx*cos(2*pi*t), cy + ry*sin(2*pi*t))
 *     with t=0 at the 3 o'clock position. Tangent is
 *     (-rx*sin(a), ry*cos(a)) — direction is correct for
 *     any rx, ry; callers that need a unit vector should
 *     normalise.
 *
 *   - piste: arc-length parameterisation across the polyline
 *     segments. t=0 at the first point, t=1 at the last (or
 *     back to the first when closed=true). Tangent is the
 *     containing segment's direction vector.
 *
 *   - other shape types (bezier, helice when added): not yet
 *     implemented; returns null. Callers treat null as a
 *     degenerate sample (no cursor to render, no position to
 *     report).
 *
 * Callers that need world position with the simulation's
 * runtime offset should add (dx, dy) from
 * simulation.getCurveRuntimeOffset(curveId) to the returned
 * x, y. The sample itself does not consult the simulation:
 * it is a pure function of shape and t so it stays
 * deterministic and reusable across renderer modules.
 */

// @ts-check

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
export function sampleCurve(shape, t) {
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
        case "spline":
            return sampleSpline(shape, t);
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
export function samplePiste(shape, t) {
    return samplePointsByArcLength(shape.points, !!shape.closed, t);
}

/**
 * Walk a polyline (array of [x, y] points) by arc length and return the
 * position and segment tangent at fraction t in [0, 1]. Shared by the
 * piste sampler (its authored points) and the spline sampler (a densely
 * interpolated polyline). `closed` adds a final wrap segment back to the
 * first point.
 *
 * @param {Array<[number, number]>} pts
 * @param {boolean} closed
 * @param {number} t
 * @returns {{x: number, y: number, tx: number, ty: number} | null}
 */
export function samplePointsByArcLength(pts, closed, t) {
    if (!Array.isArray(pts) || pts.length < 2) return null;

    /** @type {Array<{x0: number, y0: number, dx: number, dy: number, length: number}>} */
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0];
        const dy = pts[i + 1][1] - pts[i][1];
        segments.push({ x0: pts[i][0], y0: pts[i][1], dx, dy, length: Math.hypot(dx, dy) });
    }
    if (closed) {
        const last = pts.length - 1;
        const dx = pts[0][0] - pts[last][0];
        const dy = pts[0][1] - pts[last][1];
        segments.push({ x0: pts[last][0], y0: pts[last][1], dx, dy, length: Math.hypot(dx, dy) });
    }

    let total = 0;
    for (const s of segments) total += s.length;
    if (total === 0) return null;

    let target = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (target <= s.length || i === segments.length - 1) {
            const localT = s.length === 0 ? 0 : target / s.length;
            return { x: s.x0 + s.dx * localT, y: s.y0 + s.dy * localT, tx: s.dx, ty: s.dy };
        }
        target -= s.length;
    }
    return null;
}

/** Sub-samples per spline segment when flattening to a polyline. */
const SPLINE_SAMPLES_PER_SEGMENT = 16;

/**
 * Flatten a centripetal Catmull-Rom spline through the given CONTROL
 * points into a dense polyline (used for both arc-length cursor
 * traversal and rendering). The curve passes through every control
 * point; tangents are auto-derived from neighbours (no handles). The
 * terminal points are duplicated as phantoms so the ends have a natural
 * tangent. Centripetal parameterisation (alpha = 0.5) avoids the cusps
 * and self-intersections uniform Catmull-Rom produces on unevenly
 * spaced points. Fewer than 3 points pass through unchanged (2 = a
 * straight segment).
 *
 * @param {Array<[number, number]>} ctrl
 * @returns {Array<[number, number]>}
 */
export function splineToPolyline(ctrl, closed = false) {
    if (!Array.isArray(ctrl) || ctrl.length < 2) {
        return Array.isArray(ctrl) ? ctrl.map((p) => [p[0], p[1]]) : [];
    }
    if (ctrl.length === 2) {
        return [[ctrl[0][0], ctrl[0][1]], [ctrl[1][0], ctrl[1][1]]];
    }
    const n = ctrl.length;
    // A closed spline is PERIODIC: the neighbour control points wrap
    // around, and a final segment runs from the last point back to the
    // first, so the loop joins smoothly with no corner at the seam.
    const useClosed = closed && n >= 3;
    /** @type {Array<[number, number]>} */
    const out = [];
    const segCount = useClosed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
        const i1 = i;
        const i2 = (i + 1) % n;
        const p1 = ctrl[i1];
        const p2 = ctrl[i2];
        const p0 = useClosed ? ctrl[(i1 - 1 + n) % n] : (ctrl[i1 - 1] ?? ctrl[i1]);
        const p3 = useClosed ? ctrl[(i2 + 1) % n] : (ctrl[i2 + 1] ?? ctrl[i2]);
        const seg = catmullRomCentripetal(p0, p1, p2, p3, SPLINE_SAMPLES_PER_SEGMENT);
        // Skip the shared joint (seg[0] == p1 == previous seg's last)
        // for every segment after the first to avoid duplicate points.
        for (let k = i === 0 ? 0 : 1; k < seg.length; k++) out.push(seg[k]);
    }
    return out;
}

/**
 * Evaluate one centripetal Catmull-Rom segment (the p1→p2 span, with
 * p0/p3 as the neighbouring control points) at `samples`+1 evenly
 * spaced parameter values, via the Barry-Goldman pyramid with
 * divide-by-zero guards (coincident points collapse cleanly).
 * @returns {Array<[number, number]>}
 */
function catmullRomCentripetal(p0, p1, p2, p3, samples) {
    const knot = (ti, a, b) => ti + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
    const t0 = 0;
    const t1 = knot(t0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    if (t2 - t1 <= 1e-9) return [[p1[0], p1[1]], [p2[0], p2[1]]];
    /** @type {Array<[number, number]>} */
    const pts = [];
    for (let s = 0; s <= samples; s++) {
        const t = t1 + (t2 - t1) * (s / samples);
        const lerp = (a, b, ta, tb) => {
            const denom = tb - ta;
            const w = denom === 0 ? 0 : (t - ta) / denom;
            return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
        };
        const A1 = lerp(p0, p1, t0, t1);
        const A2 = lerp(p1, p2, t1, t2);
        const A3 = lerp(p2, p3, t2, t3);
        const B1 = lerp(A1, A2, t0, t2);
        const B2 = lerp(A2, A3, t1, t3);
        const C = lerp(B1, B2, t1, t2);
        pts.push([C[0], C[1]]);
    }
    return pts;
}

/**
 * Sample a spline curve by arc length: flatten its control points to a
 * dense Catmull-Rom polyline, then walk that by arc length.
 *
 * @param {import("./scene.js").ShapeSpline} shape
 * @param {number} t
 * @returns {{x: number, y: number, tx: number, ty: number} | null}
 */
export function sampleSpline(shape, t) {
    // The closed wrap (smooth seam) is baked into the dense polyline, so
    // walk it as an open path.
    return samplePointsByArcLength(splineToPolyline(shape.points, !!shape.closed), false, t);
}
