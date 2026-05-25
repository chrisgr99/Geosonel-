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
    return null;
}
