// @ts-check

import {
  curveBoundingBox,
} from "./canvasShared.js";

export const selectionMethods = {

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
    },

    /** @param {"sprite"|"trigger"|"curve"} kind @returns {boolean} */
    isKindSelectable(kind) { return this._selectableKinds[kind] !== false; },
    /** @param {"sprite"|"trigger"|"curve"} kind @param {boolean} enabled */
    setKindSelectable(kind, enabled) { if (kind in this._selectableKinds) this._selectableKinds[kind] = !!enabled; },
    /** Reset all kinds to selectable (called on score switch). */
    resetSelectableKinds() { this._selectableKinds = { sprite: true, trigger: true, curve: true }; },

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
    },

    /**
     * Get the selection set for a given object kind.
     * @param {"sprite"|"trigger"|"curve"} kind
     * @returns {Set<number>}
     */
    _setForKind(kind) {
        if (kind === "sprite") return this._selection.sprites;
        if (kind === "trigger") return this._selection.triggers;
        return this._selection.curves;
    },

    /**
     * Test whether a hit object is currently selected.
     * @param {{kind: "sprite"|"trigger"|"curve", index: number}} hit
     * @returns {boolean}
     */
    _isInSelection(hit) {
        return this._setForKind(hit.kind).has(hit.index);
    },

    /**
     * Toggle a hit object's membership in the selection.
     * @param {{kind: "sprite"|"trigger"|"curve", index: number}} hit
     */
    _toggleInSelection(hit) {
        const set = this._setForKind(hit.kind);
        if (set.has(hit.index)) set.delete(hit.index);
        else set.add(hit.index);
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },
};
