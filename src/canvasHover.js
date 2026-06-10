// @ts-check

import { getPreference } from "./preferences.js";
import {
  HOVER_DEBOUNCE_MS,
  TOOLTIP_DELAY_MS,
} from "./canvasShared.js";

export const hoverMethods = {

    // --- Hover tracking ---

    /**
     * Register the callback that receives hover-target changes for the
     * property inspector's hover-preview. Called once by main.js.
     * @param {((selection: {sprites: number[], triggers: number[], curves: number[]} | null) => void) | null} fn
     */
    setHoverObjectHandler(fn) {
        this._hoverObjectCallback = fn;
    },

    /**
     * Register the callback fired on every pointer move over empty canvas,
     * used by the inspector to postpone its hover-preview fade-out while
     * the cursor is still moving. Called once by main.js.
     * @param {(() => void) | null} fn
     */
    setHoverMotionHandler(fn) {
        this._hoverMotionCallback = fn;
    },

    /**
     * Brighten an object as a preview WITHOUT selecting it, driven by the
     * inspector's Object ID picker (hovering an id row). Pass {kind, id} to
     * highlight, or null to clear. Independent of the pointer hover, so the
     * outline shows even though the cursor is off the canvas (in the menu).
     * @param {{kind: "sprite"|"trigger"|"curve", id: string} | null} target
     */
    setPreviewHighlight(target) {
        const cur = this._previewHighlight;
        const same = (target === null && cur === null)
            || (target !== null && cur !== null
                && target.kind === cur.kind && target.id === cur.id);
        if (same) return;
        this._previewHighlight = target;
        this.scheduleDraw();
    },

    /**
     * Push the current committed hover target (_hover) to the inspector
     * hover-preview callback, as an index-based selection ({sprites,
     * triggers, curves}) or null when nothing is hovered. Deduped by a
     * "kind:id" key so repeated same-target moves and repeated empty
     * moves don't re-fire (and don't rebuild the inspector). Called only
     * from the points where the COMMITTED hover actually changes — never
     * the brief inter-object null while a new target debounces, so the
     * inspector doesn't flash the real selection between adjacent objects.
     */
    _emitHoverObject() {
        const h = this._hover;
        const key = h === null ? null : `${h.kind}:${h.id}`;
        if (key === this._lastHoverEmitKey) return;
        this._lastHoverEmitKey = key;
        if (this._hoverObjectCallback === null) return;
        let sel = null;
        if (h !== null && this._scene !== null) {
            const arr = h.kind === "sprite" ? this._scene.sprites
                : h.kind === "trigger" ? this._scene.triggers
                    : this._scene.curves;
            const idx = arr.findIndex((o) => o.id === h.id);
            if (idx >= 0) {
                sel = { sprites: [], triggers: [], curves: [] };
                if (h.kind === "sprite") sel.sprites = [idx];
                else if (h.kind === "trigger") sel.triggers = [idx];
                else sel.curves = [idx];
            }
        }
        this._hoverObjectCallback(sel);
    },

    /**
     * Test whether a scene object is currently the
     * brightened hover target. Called from the per-kind
     * draw methods to decide whether to bump the stroke
     * colour and line width for the object's outline.
     * id-based rather than index-based so a scene edit
     * that reshuffles indices doesn't paint the wrong
     * object as hovered between the edit and the next
     * mousemove that would refresh the hover state.
     * @param {"sprite"|"trigger"|"curve"} kind
     * @param {any} obj
     * @returns {boolean}
     */
    _isHovered(kind, obj) {
        if (obj === null || typeof obj !== "object") return false;
        // Inspector Object ID picker preview-highlight, independent of the
        // pointer hover (the cursor is in the menu, off the canvas).
        if (this._previewHighlight !== null
            && this._previewHighlight.kind === kind
            && obj.id === this._previewHighlight.id) {
            return true;
        }
        if (this._hover === null) return false;
        if (this._hover.kind !== kind) return false;
        return obj.id === this._hover.id;
    },

    /**
     * Clear any current and pending hover state, cancelling
     * the debounce timer if one is running. Called when the
     * pointer leaves the canvas, when a gesture starts (so a
     * drag doesn't carry a brightened object), when a tool
     * is armed (hovering for selection makes no sense while
     * a click would place a new object), and when the scene
     * reloads (object ids may have changed). The redraw is
     * scheduled unconditionally when there was anything to
     * clear so the brightened outline visibly drops on the
     * next frame.
     */
    _clearHover() {
        const hadHover = this._hover !== null;
        const hadHandle = this._hoverHandle !== null;
        this._hover = null;
        this._hoverPending = null;
        this._hoverHandle = null;
        if (this._hoverDebounceTimer !== null) {
            clearTimeout(this._hoverDebounceTimer);
            this._hoverDebounceTimer = null;
        }
        // Restore the OS cursor to its base state when
        // clearing a handle hover. Skip when a tool is
        // armed: setActiveTool owns the cursor in that mode
        // (crosshair) and our "default" here would stomp it.
        if (hadHandle && this._activeTool === null) {
            this.canvasEl.style.cursor = "default";
        }
        if (hadHover || hadHandle) this.scheduleDraw();
        // The identification tooltip clears alongside the
        // hover-brighten and handle-hover state: every
        // external caller of _clearHover (mouseleave,
        // scene reload, gesture start, tool arm) is also a
        // context where the tooltip should not remain
        // visible. The in-function call inside
        // _onCanvasHoverMove's no-hit branch was replaced
        // with an inline hover-only clear so the tooltip's
        // independent hit-test (which covers more targets
        // than the object hover-brighten path) isn't
        // stomped by this method.
        this._hideTooltipAndCancel();
        this._emitHoverObject();
    },

    /**
     * Handle a mousemove event on the canvas element for
     * the hover-brighten feature. Runs the hit-test at the
     * current pointer position and updates the debounced
     * hover state, with three branches:
     *
     *   - Pointer is over no object: clear any current
     *     bright target immediately (no debounce on exit)
     *     and cancel any pending debounce.
     *   - Pointer is over the same object that is already
     *     the bright target or pending candidate: no-op.
     *   - Pointer is over a different object: clear the
     *     current bright target immediately, set the new
     *     object as the pending candidate, and (re)start
     *     the debounce timer. When the timer fires it
     *     promotes the pending candidate to the actual
     *     hover target and triggers a redraw.
     *
     * Gated on the canvas being in selection mode: while a
     * tool is armed (crosshair cursor, click places an
     * object) hover-brighten would compete with the
     * placement gesture, and while a drag/marquee gesture
     * is in flight the brightened outline would confuse the
     * drag preview. Both gates fall through to clearing any
     * existing hover so the brightened state can't persist
     * across a mode change.
     *
     * @param {MouseEvent} e
     */
    _onCanvasHoverMove(e) {
        // Line-segment tool: while drawing a polyline, pointer motion
        // between clicks drives the rubber-band preview from the last
        // placed vertex to the cursor. Update the preview endpoint and
        // redraw; no hover state applies mid-draw.
        if (this._gesture !== null && this._gesture.kind === "drawPolyline") {
            const pos = this._eventToCanvas(e);
            this._gesture.previewX = pos.x;
            this._gesture.previewY = pos.y;
            this.scheduleDraw();
            return;
        }
        if (this._activeTool !== null || this._gesture !== null) {
            this._clearHover();
            return;
        }
        if (this._scene === null) {
            this._hideTooltipAndCancel();
            return;
        }

        const pos = this._eventToCanvas(e);

        // Handle hit-test first: handles sit on top of
        // everything and take precedence over the object
        // underneath. When a handle is under the pointer,
        // the handle grows (via _hoverHandle reflected in
        // _drawResizeHandles) and the OS cursor shifts to
        // the appropriate resize variant, while any object
        // hover-brighten state is cleared so the user reads
        // "this handle is grabbable" rather than "this
        // object is hoverable + this handle is grabbable".
        const handleId = this._hitTestHandle(pos.px, pos.py);
        if (handleId !== null) {
            // Clear any object-hover state, since a hovered
            // handle wins. _clearHover() also resets the
            // cursor and the _hoverHandle, so we re-set
            // both after.
            if (this._hover !== null || this._hoverPending !== null || this._hoverDebounceTimer !== null) {
                this._hover = null;
                this._hoverPending = null;
                if (this._hoverDebounceTimer !== null) {
                    clearTimeout(this._hoverDebounceTimer);
                    this._hoverDebounceTimer = null;
                }
            }
            this._emitHoverObject();
            // Identification tooltip hides under a hovered
            // handle: the handle's role is gesture-grab,
            // and a tooltip identifying the object beneath
            // would compete with that read.
            this._hideTooltipAndCancel();
            if (this._hoverHandle !== handleId) {
                this._hoverHandle = handleId;
                this.canvasEl.style.cursor = this._cursorForHandle(handleId);
                this.scheduleDraw();
            }
            return;
        }

        // No handle under pointer. If a handle was hovered
        // a moment ago, drop the handle-hover state and
        // restore the default cursor before falling through
        // to the object hover-brighten path.
        if (this._hoverHandle !== null) {
            this._hoverHandle = null;
            this.canvasEl.style.cursor = "default";
            this.scheduleDraw();
        }

        // Identification tooltip. Independent of the
        // hover-brighten path below since it covers more
        // targets — curve cursors and beat-point markers
        // get a tooltip but no brighten, top-level objects
        // get both. Runs before the object hit-test so the
        // no-hit branch can finish its own inline cleanup
        // without touching the tooltip state.
        this._updateTooltipForPosition(pos, e.clientX, e.clientY);

        const hit = this._hitTestObject(pos.x, pos.y);

        if (hit === null) {
            // Pointer over empty canvas as far as the
            // hover-brighten hit-test is concerned. The
            // identification tooltip's hit-test has
            // already decided independently above whether
            // to keep itself visible (e.g. for a hovered
            // curve cursor or beat marker on a curve that
            // _hitTestObject's curve-geometry check
            // missed). Inline hover-only cleanup here
            // rather than _clearHover, which would also
            // hide the tooltip.
            const hadHover = this._hover !== null;
            this._hover = null;
            this._hoverPending = null;
            if (this._hoverDebounceTimer !== null) {
                clearTimeout(this._hoverDebounceTimer);
                this._hoverDebounceTimer = null;
            }
            if (hadHover) this.scheduleDraw();
            this._emitHoverObject();
            // Pointer is moving over empty canvas — tell the inspector so
            // it postpones any pending hover-preview fade-out until the
            // cursor goes idle.
            if (this._hoverMotionCallback !== null) this._hoverMotionCallback();
            return;
        }

        // Resolve the hit's index to its id so the hover
        // tracking is stable across scene edits.
        let obj;
        if (hit.kind === "sprite") obj = this._scene.sprites[hit.index];
        else if (hit.kind === "trigger") obj = this._scene.triggers[hit.index];
        else obj = this._scene.curves[hit.index];
        if (obj === undefined || typeof obj.id !== "string") return;
        const hitId = obj.id;

        // Same object as current brightened target: nothing
        // to do. The brightened render is already correct.
        if (this._hover !== null &&
            this._hover.kind === hit.kind &&
            this._hover.id === hitId) {
            return;
        }

        // Same object as the pending candidate: let the
        // existing debounce timer continue counting down.
        // Resetting the timer here would keep deliberate
        // hovering on one spot from ever firing if the
        // pointer wobbled within the object's hit area.
        if (this._hoverPending !== null &&
            this._hoverPending.kind === hit.kind &&
            this._hoverPending.id === hitId) {
            return;
        }

        // Different object than what we were tracking.
        // Drop the current bright target immediately (no
        // "old object stays bright while new one debounces"
        // — the user asked for nothing to be brightened
        // while the pointer is moving), then start a new
        // debounce for the new candidate.
        const hadHover = this._hover !== null;
        this._hover = null;
        this._hoverPending = { kind: hit.kind, id: hitId };
        if (this._hoverDebounceTimer !== null) {
            clearTimeout(this._hoverDebounceTimer);
        }
        this._hoverDebounceTimer = setTimeout(() => {
            this._hoverDebounceTimer = null;
            // Guard against the canvas state having moved
            // on between the timer being set and it firing:
            // a gesture may have started, a tool may have
            // been armed, the scene may have been reloaded.
            // _hoverPending being non-null indicates the
            // intent to brighten is still current; null
            // means something cleared it (one of the
            // gates above, or a mouseleave) and we should
            // not promote.
            if (this._hoverPending === null) return;
            this._hover = this._hoverPending;
            this._hoverPending = null;
            this.scheduleDraw();
            this._emitHoverObject();
        }, HOVER_DEBOUNCE_MS);
        if (hadHover) this.scheduleDraw();
    },

    // --- Identification tooltip ---

    /**
     * Refresh the identification tooltip's pending and
     * shown state against the current pointer position.
     * Runs a tooltip-specific hit-test that covers more
     * targets than the object hover-brighten path: top-
     * level sprites, triggers, and curves, plus each
     * curve's visible cursor and its beat-point markers.
     * Targets resolve to a stable key (kind + id) so the
     * state machine mirrors the hover-brighten pattern:
     * same target — follow the pointer if shown, no-op
     * if pending; different target — start a fresh
     * debounce; no target — hide and cancel any pending.
     *
     * Position updates while the tooltip is shown so the
     * tooltip follows the pointer. New-target transitions
     * remember the latest pointer position so the
     * eventual show paints below-right of where the
     * pointer was when the debounce expired.
     *
     * @param {{px: number, py: number, x: number, y: number}} pos
     * @param {number} clientX
     * @param {number} clientY
     */
    _updateTooltipForPosition(pos, clientX, clientY) {
        // Gated on the user's identification-tooltip
        // preference. Off — immediately hide whatever may
        // currently be showing and skip the hit-test. The
        // constructor also subscribes to this preference so
        // a flip from on to off mid-session collapses any
        // active tooltip without waiting for the next
        // pointer move; this guard exists for the steady-
        // state case where the preference starts the
        // session off.
        if (!getPreference("enableCanvasObjectTooltips")) {
            this._hideTooltipAndCancel();
            return;
        }
        const hit = this._hitTestForTooltip(pos.x, pos.y, pos.px, pos.py);
        if (hit === null) {
            this._hideTooltipAndCancel();
            return;
        }
        const key = hit.kind + ":" + hit.id;
        if (this._tooltipShownKey === key) {
            // Same target shown — follow the cursor on
            // every move.
            this._showTooltip(this._tooltipText(hit), clientX, clientY);
            return;
        }
        if (this._tooltipPendingKey === key) {
            // Same pending candidate — let the timer
            // continue. Update the saved position so the
            // eventual show lands at the latest pointer.
            this._tooltipPendingClientX = clientX;
            this._tooltipPendingClientY = clientY;
            return;
        }
        // New target. Hide any current tooltip and
        // restart the debounce against the new key.
        if (this._tooltipEl !== null) {
            this._tooltipEl.style.display = "none";
        }
        this._tooltipShownKey = null;
        this._tooltipPendingKey = key;
        this._tooltipPendingHit = hit;
        this._tooltipPendingClientX = clientX;
        this._tooltipPendingClientY = clientY;
        if (this._tooltipTimer !== null) clearTimeout(this._tooltipTimer);
        this._tooltipTimer = setTimeout(() => {
            this._tooltipTimer = null;
            // Guard against state having moved on between
            // schedule and fire (gesture started, tool
            // armed, scene reloaded, etc).
            if (this._tooltipPendingKey === null) return;
            if (this._tooltipPendingHit === null) return;
            const text = this._tooltipText(this._tooltipPendingHit);
            if (text === null) return;
            this._showTooltip(
                text,
                this._tooltipPendingClientX,
                this._tooltipPendingClientY,
            );
            this._tooltipShownKey = this._tooltipPendingKey;
            this._tooltipPendingKey = null;
            this._tooltipPendingHit = null;
        }, TOOLTIP_DELAY_MS);
    },

    /**
     * Build the tooltip text for an identification hit.
     * Top-level objects render as "Kind ID" matching the
     * inspector's title-bar convention. Child elements
     * (cursor of a curve, beat marker on a curve) render
     * as "... of Curve ID" since they are not first-class
     * schema objects with their own id — the id is the
     * parent curve's. The diamond marker is called
     * "Trigger/Beat Point" because the same visual
     * element serves dual roles: it can be hit by an
     * external cursor (acting as a trigger) or played by
     * the curve's own cursor (acting as a beat point).
     *
     * @param {{kind: string, id: string} | null} hit
     * @returns {string | null}
     */
    _tooltipText(hit) {
        if (hit === null) return null;
        switch (hit.kind) {
            case "spriteBody":  return `Sprite ${hit.id}`;
            case "triggerBody": return `Trigger ${hit.id}`;
            case "curveBody":   return `Curve ${hit.id}`;
            case "curveCursor": return `Cursor of\nCurve ${hit.id}`;
            case "curveMarker": return `Trigger/Beat Point of\nCurve ${hit.id}`;
            default: return null;
        }
    },

    /**
     * Lazily create the tooltip DOM element on first use.
     * Appended to document.body with fixed positioning so
     * it can paint over the entire viewport regardless of
     * canvas-pane clipping. pointer-events: none (in CSS)
     * keeps it from interfering with the pointer's hit-
     * tests on objects beneath it.
     */
    _ensureTooltipEl() {
        if (this._tooltipEl !== null) return;
        const el = document.createElement("div");
        el.className = "canvas-tooltip";
        el.style.display = "none";
        document.body.appendChild(el);
        this._tooltipEl = el;
    },

    /**
     * Show the tooltip at a client-space position
     * (typically the pointer's clientX/Y, offset slightly
     * down and right so it doesn't sit directly under the
     * cursor). Idempotent and safe to call repeatedly
     * with the same or new text.
     *
     * @param {string | null} text
     * @param {number | null} clientX
     * @param {number | null} clientY
     */
    _showTooltip(text, clientX, clientY) {
        if (text === null) return;
        if (clientX === null || clientY === null) return;
        this._ensureTooltipEl();
        if (this._tooltipEl === null) return;
        this._tooltipEl.textContent = text;
        this._tooltipEl.style.left = `${clientX + 14}px`;
        this._tooltipEl.style.top = `${clientY + 18}px`;
        this._tooltipEl.style.display = "block";
    },

    /**
     * Hide the tooltip and cancel any pending debounce.
     * Called by _clearHover (catching every external
     * "stop hovering" path: mouseleave, scene reload,
     * gesture start, tool arm) and by
     * _onCanvasHoverMove's handle-hit branch and scene-
     * null gate. Safe to call when no tooltip is showing.
     */
    _hideTooltipAndCancel() {
        if (this._tooltipTimer !== null) {
            clearTimeout(this._tooltipTimer);
            this._tooltipTimer = null;
        }
        this._tooltipShownKey = null;
        this._tooltipPendingKey = null;
        this._tooltipPendingHit = null;
        this._tooltipPendingClientX = null;
        this._tooltipPendingClientY = null;
        if (this._tooltipEl !== null) {
            this._tooltipEl.style.display = "none";
        }
    },
};
