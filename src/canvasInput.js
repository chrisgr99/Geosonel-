// @ts-check

import { sampleCurve } from "./curveGeometry.js";
import {
  DRAG_THRESHOLD_PX,
  POLYLINE_CLOSE_SNAP_PX,
  applyShapeCoordsScale,
  applyShapeCoordsTranslation,
  snapshotShapeCoords,
  snapshotShapeForResize,
} from "./canvasShared.js";

export const inputMethods = {

    /** @param {MouseEvent} e */
    _onMouseDown(e) {
        // Cmd-click a beat point → reposition the transport playhead to when that
        // beat last fired ("rewind to here"). Acts only when the click lands on a
        // tick; otherwise falls through to normal handling. (Command, not Control —
        // Control-click stays the macOS context menu.)
        if (e.metaKey && this._beatSeekSink !== null) {
            const cpos = this._eventToCanvas(e);
            const hit = this._beatPointAt(cpos.px, cpos.py);
            if (hit !== null) {
                e.preventDefault();
                this._clearHover();
                this._beatSeekSink(hit.id, hit.index);
                return;
            }
        }
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
            if (this._activeTool === "lineSegment" || this._activeTool === "spline") {
                // Multi-click path tool, shared by the line-segment
                // (piste, straight) and spline (smooth Catmull-Rom)
                // tools — same interaction, different committed shape
                // type. The first click starts a drawPolyline gesture;
                // each later click appends a vertex. The tool stays
                // armed throughout — the rubber-band preview to the
                // cursor is tracked in the canvas hover-move handler,
                // and a double-click commits the whole thing as one
                // curve (_onDoubleClick). Each mousedown of the
                // finishing double-click appends a point, so the
                // trailing duplicate is dropped on commit.
                const shapeType = this._activeTool === "spline" ? "spline" : "piste";
                if (this._gesture !== null && this._gesture.kind === "drawPolyline") {
                    // Click within the snap radius of the START point
                    // (with enough vertices to enclose) CLOSES the curve
                    // — drops the seam exactly on the start point — rather
                    // than adding a vertex. The wrap is a smooth seam for
                    // splines, a straight segment for line segments.
                    const g = this._gesture;
                    if (g.points.length >= 3) {
                        const p0 = g.points[0];
                        const dpx = (pos.x - p0[0]) * this.pixelsPerUnit;
                        const dpy = (pos.y - p0[1]) * this.pixelsPerUnit;
                        if (Math.hypot(dpx, dpy) < POLYLINE_CLOSE_SNAP_PX) {
                            this._commitPolyline(true);
                            return;
                        }
                    }
                    g.points.push([pos.x, pos.y]);
                } else {
                    this._gesture = {
                        kind: "drawPolyline",
                        shapeType,
                        points: [[pos.x, pos.y]],
                        previewX: pos.x,
                        previewY: pos.y,
                    };
                }
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
    },

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
    },

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
                // Selecting an object breaks any background-click
                // run, so the next empty click starts fresh.
                this._bgClearArmed = false;
            } else if (!g.shiftKey) {
                // Persistent selection: a plain click on empty space
                // does NOT clear on its own. The first such click only
                // ARMS the clear (so an accidental background click
                // keeps the selection); the second consecutive
                // background click clears it. This covers both a fast
                // double-click and two slower clicks.
                if (this._bgClearArmed) {
                    this._selection = {
                        sprites: new Set(),
                        triggers: new Set(),
                        curves: new Set(),
                    };
                    this._bgClearArmed = false;
                } else {
                    this._bgClearArmed = true;
                }
            } else {
                // Shift+click on empty space leaves the selection
                // alone; it isn't part of a clear run.
                this._bgClearArmed = false;
            }
            this.scheduleDraw();
            this._emitSelectionChanged();
            return;
        }

        if (g.kind === "drag") {
            // A drag (translate or marquee) is a deliberate gesture,
            // not part of a background-click clear run.
            this._bgClearArmed = false;
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
            // A marquee (drag-select) is a deliberate gesture, not part
            // of a background-click clear run.
            this._bgClearArmed = false;
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
                if (this._selectableKinds.sprite !== false) {
                    for (let i = 0; i < this._scene.sprites.length; i++) {
                        const s = this._scene.sprites[i];
                        const pos = this._spritePosition(s);
                        if (pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2) {
                            enclosedSprites.add(i);
                        }
                    }
                }
                if (this._selectableKinds.trigger !== false) {
                    for (let i = 0; i < this._scene.triggers.length; i++) {
                        const t = this._scene.triggers[i];
                        if (t.x >= x1 && t.x <= x2 && t.y >= y1 && t.y <= y2) {
                            enclosedTriggers.add(i);
                        }
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
                if (this._selectableKinds.curve !== false) {
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
            this._bgClearArmed = false;
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
            this._bgClearArmed = false;
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
    },

    /**
     * Commit the in-progress drawPolyline gesture as one curve, then
     * revert to selection. closed=true makes a CLOSED curve — a smooth
     * periodic seam for splines, a straight wrap segment for line
     * segments — joining the last vertex back to the start. Open commits
     * need at least two vertices; closed needs three to enclose. The
     * gesture is always cleared, even when the minimum isn't met.
     * @param {boolean} closed
     */
    _commitPolyline(closed) {
        if (this._gesture === null || this._gesture.kind !== "drawPolyline") return;
        const points = this._gesture.points;
        const shapeType = this._gesture.shapeType === "spline" ? "spline" : "piste";
        const minPts = closed ? 3 : 2;
        if (points.length >= minPts && this._editCallback !== null) {
            this._editCallback({
                kind: "addCurve",
                shape: {
                    type: shapeType,
                    points: points.map((p) => [p[0], p[1]]),
                    closed,
                },
            });
        }
        this._gesture = null;
        if (this._toolbar !== null) this._toolbar.afterPlacement();
        this.scheduleDraw();
    },

    /**
     * Double-click on a canvas object emits an
     * openObjectInCode edit so external host code can
     * switch to the Script tab and scroll to the object's
     * source. Double-click on empty canvas background does
     * nothing here — clearing the selection on two
     * background clicks is handled by the per-click "armed"
     * logic in _onMouseUp, of which a double-click is just
     * the fast case. (The former double-click-to-toggle-
     * transport behaviour was removed.) Single clicks that
     * precede the dblclick event have already flowed
     * through the normal mousedown / mouseup gesture state
     * machine, so the selection has already updated; the
     * dblclick's job is just to emit the navigation intent.
     *
     * Ignored when a creation tool is armed (under a tool
     * the natural reading of two quick clicks is "place
     * two objects", not "navigate to source"), or when no
     * edit callback is wired.
     *
     * @param {MouseEvent} e
     */
    _onDoubleClick(e) {
        if (e.button !== 0) return;
        // Line-segment tool: a double-click finishes the polyline. The
        // double-click's two mousedowns each appended the final vertex,
        // so drop the trailing duplicate; commit the whole thing as ONE
        // piste curve if at least two vertices remain, otherwise cancel
        // (a single point is not a curve). Then revert to selection.
        if ((this._activeTool === "lineSegment" || this._activeTool === "spline") &&
            this._gesture !== null &&
            this._gesture.kind === "drawPolyline") {
            e.preventDefault();
            // Drop the duplicate vertex the double-click's two mousedowns
            // appended, then commit as an OPEN curve.
            if (this._gesture.points.length > 1) this._gesture.points.pop();
            this._commitPolyline(false);
            return;
        }
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
        // Double-click on empty background no longer toggles the
        // transport. Two background clicks now clear the selection
        // (handled by the per-click "armed" logic in _onMouseUp); a
        // double-click is just the fast case of that, so there is
        // nothing to do here.
    },
};
