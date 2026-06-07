// @ts-check

import { sampleCurve } from "./curveGeometry.js";

export const collisionMethods = {

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
     * extent and state "active" (passive removes the cursor and
     * disabled is fully inert, so neither is a collider — the
     * same gate the cursor draw uses). Its cursor is a line
     * segment in canvas
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
            // Disabled curves are out of collisions as a target;
            // their markers do not enter the test. Passive curves
            // stay valid targets (their markers remain).
            if (curve.state === "disabled") continue;
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
            if (curve.state !== "active" || curve.hide) continue;
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
            if (s.state !== "active") continue;
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
                // Disabled triggers are out of collisions as a
                // target.
                if (trig.state === "disabled") continue;
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
                // Flash a struck trigger when its beenTriggered ran, via
                // the markFiredTrigger hook wired for this path.
                if (res !== null && typeof res === "object" && res.beenTriggeredFired) {
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
            // the curve's canBeTriggered / beenTriggeredFunction fields.
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
                if (res !== null && typeof res === "object" && res.beenTriggeredFired) {
                    this.markFiredCurveBeat(m.curveId, m.t);
                }
            }
            next.set(col.id, {
                seg: { ax: col.ax, ay: col.ay, bx: col.bx, by: col.by },
                sides,
            });
        }
        this._collisionPrev = next;
    },
};
