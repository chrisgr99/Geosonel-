/**
 * Canvas inspector module.
 *
 * Renders the Canvas inspector tab — the right-pane
 * sibling of the Properties inspector that exposes scene-
 * level canvas state regardless of canvas selection. Per
 * DESIGN.md Section 13.5 the tab is selection-independent:
 * it shows the background image controls, the canvas
 * dimensions, the per-score pinned image section, the
 * shared recent-image gallery, and (Stage 6) the image-
 * transformation sliders.
 *
 * Stage 5 layout. Top to bottom: top row with the
 * "Image:" section caption, Load and Clear buttons,
 * and the canvas W and H numeric fields; a horizontal
 * separator; the per-score pinned section as a 2-row by
 * 3-column grid of 6 fixed slots; a section divider;
 * the shared recent-image gallery as a 3-column grid of
 * however many entries the gallery currently holds,
 * scrolling vertically when it overflows the pane.
 *
 * Gallery width. Both grids size their thumbnails by
 * dividing a fixed parent width (the CSS variable
 * --canvas-insp-gallery-width) into three columns with
 * a small inter-column gutter. The variable is set at
 * mount time by measuring the Properties inspector's
 * Starting State row (marked with the
 * .insp-row-starting-state class) — the natural pane
 * floor that main.js's body-divider already commits to —
 * so the gallery aligns with the inspector's widest
 * field. A fallback constant covers the brief window
 * before the measurement can run.
 *
 * Pinned section. Each slot is either populated
 * (rendered from a JPEG data URL passed in the snapshot)
 * or empty (placeholder with a dim background). Clicking
 * a populated slot emits onSetBackgroundFromPinnedSlot
 * with { slotIndex, hash }; main.js handles the
 * orchestration (set as current background, then add-
 * or-promote in the shared gallery so the recipient of
 * a shared score builds up their own shared gallery
 * only from images they actually use).
 *
 * Pinning gesture. The Stage 5 second-commit redesign
 * replaces the original Pin button with drag mechanics
 * that span both gallery sections. Three drag intents:
 *
 *   - Drag a shared thumb onto a pinned slot — pins
 *     (fresh pin or splice-reorder, depending on whether
 *     the dragged image is already pinned elsewhere).
 *   - Drag a pinned thumb onto another pinned slot —
 *     reorders pinned slots (splice).
 *   - Drag any thumb outside the canvas inspector pane —
 *     removes from shared (shared thumb dragged) or
 *     unpins (pinned thumb dragged), with a vanish
 *     animation on release.
 *
 * The drag mechanics live in this module and emit
 * onDropOnPinnedSlot({ source, targetSlotIndex }) or
 * onDragOff({ source }) on release, where source is a
 * discriminated union of { kind: "shared", entryId } or
 * { kind: "pinned", hash, sourceSlotIndex }. main.js
 * dispatches via bundle.dropHashOnPinnedSlot,
 * bundle.unpinSlot, or gallery.remove as appropriate.
 *
 * Shared section. Recency-bump (Stage 5): new imports
 * prepend, clicks promote to front. Click on a shared
 * slot emits onSetBackgroundFromGallery with { id };
 * main.js handles the orchestration (set as current
 * background, gallery.touch to bump addedAt). The green
 * active-frame on the shared section is driven by
 * setActiveGalleryId; on the pinned section it's
 * encoded in the snapshot entries' active flag.
 *
 * Wiring contract. setCanvasSize and onSceneEdit mirror
 * Stage 1's. Shared section: onSetBackgroundFromGallery,
 * setActiveGalleryId, refreshGallery. Pinned section:
 * onSetBackgroundFromPinnedSlot, setPinnedSnapshot.
 * Drag-spanning callbacks: onDropOnPinnedSlot, onDragOff.
 * The remeasureGalleryWidth hook lets main.js re-trigger
 * the Starting State row measurement after events that
 * might shift the inspector's natural width (tab switches
 * into Canvas, scene reloads that rebuild the Properties
 * tab).
 */

// @ts-check

import { list as galleryList } from "./gallery.js";
import { PINNED_SLOTS_COUNT } from "./bundle.js";

const CANVAS_DIMENSION_MIN = 1;
const CANVAS_DIMENSION_MAX = 200;
const CANVAS_DIMENSION_DEFAULT_W = 32;
const CANVAS_DIMENSION_DEFAULT_H = 24;

// Fallback width for the gallery when the Starting State
// row hasn't been measured yet (e.g. the Canvas tab
// activates before the Properties inspector has rendered).
// The CSS variable starts at this value; once
// _measureGalleryWidth runs, the variable picks up the
// real width. The fallback is close to the typical
// measured value so the transition from fallback to
// measured doesn't visibly shift the grid.
const GALLERY_WIDTH_FALLBACK = 420;

// Fallback thumb size, matching the gallery-width
// fallback arithmetically: (420 - 2 * 6) / 3 = 136.
// The thumb-size CSS variable starts here; once
// _measureGalleryWidth runs, it picks up the real
// value derived from the measured gallery width.
const THUMB_SIZE_FALLBACK = 136;

// Click-versus-drag motion threshold in CSS pixels.
// A pointerdown followed by a pointerup with less than
// this much cumulative motion in either axis is treated
// as a click (synthesises onSetBackgroundFromGallery on
// shared thumbs). Crossing the threshold transitions
// into drag mode and the click intent is dropped. Same
// value canvas.js uses for its own click-versus-drag
// discrimination, so the two surfaces feel identical
// under fast clicks.
const DRAG_THRESHOLD_PX = 4;

export class CanvasInspector {
    /**
     * @param {HTMLElement} container  Element to mount the inspector in.
     */
    constructor(container) {
        this.container = container;

        // Canvas-size state. Mirrors the scene's canvasW
        // and canvasH whenever main.js calls setCanvasSize
        // after a scene reload. Defaults match the
        // toolbar's previous numbers so a freshly mounted
        // inspector with no scene yet displays the same
        // defaults older versions implicitly used.
        this._canvasW = CANVAS_DIMENSION_DEFAULT_W;
        this._canvasH = CANVAS_DIMENSION_DEFAULT_H;

        /** @type {HTMLDivElement | null} */
        this._canvasWField = null;
        /** @type {HTMLDivElement | null} */
        this._canvasHField = null;

        /** @type {Array<(edit: any) => void>} */
        this._sceneEditListeners = [];

        // --- Shared gallery state ---

        /**
         * Cached entries from the most recent gallery.list
         * call, ordered newest first under the Stage 5
         * recency-bump display sort. The shared grid
         * renders one slot per entry; there are no fixed
         * placeholder slots in the shared section after
         * Stage 5 (the positional memory that motivated
         * placeholders has moved to the pinned section
         * above).
         * @type {Array<{id: string, sourcePath: string, thumbnailBase64: string, addedAt: number}>}
         */
        this._galleryEntries = [];

        /**
         * Id of the shared entry that should carry the
         * green active-frame, or null when no shared
         * entry is the current background. Set by main.js
         * via setActiveGalleryId after a background swap.
         * @type {string | null}
         */
        this._activeGalleryId = null;

        /** @type {HTMLDivElement | null} */
        this._sharedGridEl = null;

        /** @type {HTMLDivElement | null} */
        this._panelEl = null;

        /** @type {Array<(intent: {id: string}) => void>} */
        this._setBackgroundListeners = [];

        /** @type {Array<() => void>} */
        this._loadImageListeners = [];

        /** @type {Array<() => void>} */
        this._removeImageListeners = [];

        // --- Pinned section state (Stage 5) ---

        /**
         * Snapshot of the bundle's pinned section. Each
         * entry is either null (empty slot) or
         * { hash, dataUrl, active? } where dataUrl is a
         * JPEG data URL the browser scales for display
         * and active flags the slot whose image is the
         * current background (drives the green active-
         * frame). main.js builds this from
         * bundle.pinnedSlots, bundle.pinnedBytes, and
         * bundle.imageContentHash, then pushes via
         * setPinnedSnapshot whenever any of those change.
         * Defaults to PINNED_SLOTS_COUNT nulls so initial
         * render shows the empty grid.
         * @type {Array<{ hash: string, dataUrl: string, active?: boolean } | null>}
         */
        this._pinnedSnapshot = new Array(PINNED_SLOTS_COUNT).fill(null);

        /** @type {HTMLDivElement | null} */
        this._pinnedGridEl = null;

        /** @type {Array<(intent: { slotIndex: number, hash: string }) => void>} */
        this._setBackgroundFromPinnedListeners = [];

        /** @type {Array<(intent: { source: DragSource, targetSlotIndex: number }) => void>} */
        this._dropOnPinnedSlotListeners = [];

        /** @type {Array<(intent: { source: DragSource }) => void>} */
        this._dragOffListeners = [];

        /**
         * Active drag state, or null when no drag is in
         * progress. Set on pointerdown on any draggable
         * thumbnail (shared entry or populated pinned
         * slot); transitions to dragging=true once motion
         * crosses DRAG_THRESHOLD_PX; cleared on pointerup,
         * pointercancel, or at the end of the vanish
         * animation when an off-pane drop is processed.
         *
         * source identifies what's being dragged —
         * { kind: "shared", entryId } when dragging from
         * the shared gallery, { kind: "pinned", hash,
         * sourceSlotIndex } when dragging from a pinned
         * slot. The drop semantics in _onDocumentPointerUp
         * branch on source.kind plus the drop target
         * (pinned slot, off-pane, or elsewhere) to pick
         * the right emit.
         *
         * previewSrc is the full <img>-ready URL (data:
         * URI) the drag preview displays. The preview
         * field carries the floating element (added to
         * document.body during drag, removed on cleanup
         * or at the end of the vanish animation).
         *
         * currentTarget is the pinned-slot element under
         * the cursor, or null when not over a pinned
         * slot — drives the .drop-target class and the
         * targetSlotIndex value on drop. offPane is true
         * when the cursor is outside the canvas
         * inspector pane's bounding rect; an off-pane
         * drop after threshold means "remove" or "unpin"
         * depending on source.kind, and gets the vanish
         * animation.
         *
         * @typedef {{ kind: "shared", entryId: string }
         *   | { kind: "pinned", hash: string, sourceSlotIndex: number }} DragSource
         *
         * @type {null | {
         *   source: DragSource,
         *   previewSrc: string,
         *   startX: number,
         *   startY: number,
         *   pointerId: number,
         *   dragging: boolean,
         *   preview: HTMLDivElement | null,
         *   currentTarget: HTMLElement | null,
         *   offPane: boolean,
         *   onMove: (e: PointerEvent) => void,
         *   onUp: (e: PointerEvent) => void,
         * }}
         */
        this._dragState = null;

        // --- Brightness slider state (Stage 6) ---

        /**
         * Reference to the rendered brightness slider
         * input. Held so setDisplayBrightness can write
         * its value programmatically (typically on score
         * open, to sync against the bundle's stored
         * value). Null before _render mounts the slider.
         * @type {HTMLInputElement | null}
         */
        this._brightnessSlider = null;

        /**
         * Callbacks registered via
         * onDisplayBrightnessChange. Fire on every input
         * event from the slider, passing the new integer
         * value in 0..100. main.js routes the value to
         * both the bundle (for persistence) and the
         * canvas (for immediate visual update).
         * @type {Array<(value: number) => void>}
         */
        this._displayBrightnessListeners = [];

        this._render();
        // Kick off the initial gallery load. _render has
        // already painted the empty-state shared grid
        // and the empty pinned slots; the shared grid
        // refills with entries once gallery.list resolves.
        void this._loadGallery();
    }

    // --- Canvas-size API ---

    /**
     * @param {(edit: any) => void} cb
     */
    onSceneEdit(cb) {
        this._sceneEditListeners.push(cb);
    }

    /**
     * @param {number} w
     * @param {number} h
     */
    setCanvasSize(w, h) {
        this._canvasW = w;
        this._canvasH = h;
        if (this._canvasWField !== null &&
            document.activeElement !== this._canvasWField) {
            this._canvasWField.textContent = String(w);
        }
        if (this._canvasHField !== null &&
            document.activeElement !== this._canvasHField) {
            this._canvasHField.textContent = String(h);
        }
    }

    // --- Top-row button callbacks ---

    /**
     * @param {() => void} cb
     */
    onLoadImageClick(cb) {
        this._loadImageListeners.push(cb);
    }

    /**
     * @param {() => void} cb
     */
    onRemoveImageClick(cb) {
        this._removeImageListeners.push(cb);
    }

    // --- Shared gallery API ---

    /**
     * @param {(intent: {id: string}) => void} cb
     */
    onSetBackgroundFromGallery(cb) {
        this._setBackgroundListeners.push(cb);
    }

    /**
     * Set the shared section's active-frame id. Pass null
     * to clear. Triggers a shared-grid re-render so the
     * frame moves to the matching slot (or disappears,
     * when null). The pinned section's active frame is
     * driven separately by the active flag on snapshot
     * entries (see setPinnedSnapshot).
     * @param {string | null} id
     */
    setActiveGalleryId(id) {
        if (this._activeGalleryId === id) return;
        this._activeGalleryId = id;
        this._renderSharedGrid();
    }

    /**
     * Re-read the gallery and re-render the shared grid.
     * Called by main.js after operations that change the
     * shared gallery's contents (imports, click-promotes,
     * removes).
     * @returns {Promise<void>}
     */
    async refreshGallery() {
        await this._loadGallery();
    }

    // --- Pinned section API (Stage 5) ---

    /**
     * Register a callback for clicks on populated pinned
     * slots. Receives { slotIndex, hash } where slotIndex
     * is the 0-indexed position and hash is the entry's
     * content hash (key into bundle.pinnedBytes).
     * @param {(intent: { slotIndex: number, hash: string }) => void} cb
     */
    onSetBackgroundFromPinnedSlot(cb) {
        this._setBackgroundFromPinnedListeners.push(cb);
    }

    /**
     * Register a callback for drops onto a pinned slot.
     * Receives { source, targetSlotIndex } where source
     * is a discriminated union:
     *   { kind: "shared", entryId }   — drag started
     *     from a shared gallery thumbnail; main.js loads
     *     bytes via gallery.loadImage and computes hash.
     *   { kind: "pinned", hash, sourceSlotIndex } — drag
     *     started from a populated pinned slot; main.js
     *     reads bytes from bundle.pinnedBytes directly.
     * Either way main.js eventually calls
     * bundle.dropHashOnPinnedSlot(hash, bytes, targetSlotIndex).
     * @param {(intent: { source: any, targetSlotIndex: number }) => void} cb
     */
    onDropOnPinnedSlot(cb) {
        this._dropOnPinnedSlotListeners.push(cb);
    }

    /**
     * Register a callback for drag-off-pane releases
     * (drag-to-remove). Receives { source } with the
     * same discriminated union shape as
     * onDropOnPinnedSlot. main.js dispatches based on
     * source.kind: gallery.remove(entryId) for shared,
     * bundle.unpinSlot(sourceSlotIndex) for pinned. The
     * vanish animation runs before the emit fires, so
     * by the time main.js sees the callback the preview
     * has already faded out.
     * @param {(intent: { source: any }) => void} cb
     */
    onDragOff(cb) {
        this._dragOffListeners.push(cb);
    }

    /**
     * Update the pinned section's render snapshot. main.js
     * builds the snapshot from bundle.pinnedSlots and
     * bundle.pinnedBytes (encoding the bytes as JPEG data
     * URLs for inline display) and calls this whenever
     * the bundle's pinned section changes — typically
     * after pin/unpin and on score open. Snapshot length
     * should match PINNED_SLOTS_COUNT; missing entries
     * are coerced to null.
     * @param {Array<{ hash: string, dataUrl: string, active?: boolean } | null>} snapshot
     */
    setPinnedSnapshot(snapshot) {
        for (let i = 0; i < PINNED_SLOTS_COUNT; i++) {
            const s = snapshot[i];
            this._pinnedSnapshot[i] = (s !== undefined && s !== null) ? s : null;
        }
        this._renderPinnedGrid();
    }

    /**
     * Re-measure the Starting State row and update the
     * CSS variable that sizes both gallery grids. Called
     * by main.js after events that might shift the
     * inspector's natural width — most importantly tab
     * activation, since the Canvas tab and the Properties
     * tab can be activated in either order on first
     * mount, and the initial measurement runs in a
     * microtask which may execute before the Properties
     * tab's DOM has fully settled.
     */
    remeasureGalleryWidth() {
        this._measureGalleryWidth();
    }

    // --- Brightness slider API (Stage 6) ---

    /**
     * Register a callback that fires on every input event
     * from the Brightness slider. The callback receives
     * the new integer value in 0..100. main.js routes the
     * value to both bundle.setDisplayBrightness (for
     * persistence) and canvas.setDisplayBrightness (for
     * immediate visual update).
     * @param {(value: number) => void} cb
     */
    onDisplayBrightnessChange(cb) {
        this._displayBrightnessListeners.push(cb);
    }

    /**
     * Set the slider's value programmatically. Called by
     * main.js on score open to sync the slider with the
     * newly-loaded bundle's displayBrightness. Clamps to
     * 0..100; no-op when the slider isn't mounted yet
     * (timing race) or already shows the target value.
     * Does not fire the input listeners — this is an
     * external sync, not a user adjustment.
     * @param {number} value 0..100; outside range is clamped.
     */
    setDisplayBrightness(value) {
        if (this._brightnessSlider === null) return;
        const n = typeof value === "number" && Number.isFinite(value)
            ? value
            : 100;
        const clamped = n < 0 ? 0 : (n > 100 ? 100 : n);
        const rounded = Math.round(clamped);
        const current = parseInt(this._brightnessSlider.value, 10);
        if (current === rounded) return;
        this._brightnessSlider.value = String(rounded);
    }

    // --- Internals ---

    _render() {
        this.container.innerHTML = "";
        this._canvasWField = null;
        this._canvasHField = null;
        this._panelEl = null;
        this._sharedGridEl = null;
        this._pinnedGridEl = null;
        this._brightnessSlider = null;

        const panel = document.createElement("div");
        panel.className = "canvas-insp-panel";
        // Default the gallery-width and thumb-size CSS
        // variables to sensible fallbacks so the grids
        // paint sensibly before _measureGalleryWidth
        // runs. The fallbacks (420 px gallery, 136 px
        // thumb) match each other arithmetically:
        // 420 - 2 * 6 = 408, 408 / 3 = 136. _measureGalleryWidth
        // overwrites both based on the Properties tab's
        // Starting State row width.
        panel.style.setProperty(
            "--canvas-insp-gallery-width",
            GALLERY_WIDTH_FALLBACK + "px",
        );
        panel.style.setProperty(
            "--canvas-insp-thumb-size",
            THUMB_SIZE_FALLBACK + "px",
        );
        this._panelEl = panel;

        // Top row: "Image:" section caption, Load,
        // Clear, then a "Size:" sub-caption and the
        // canvasW and canvasH numeric fields. The two
        // captions sit at the same visual level so the
        // row reads as one strip with two labelled
        // groups (image controls, size fields). The Pin
        // button that lived here through Stage 5 first
        // commit is gone; pinning is now the drag-from-
        // shared-to-pinned gesture handled by the drag
        // mechanics below.
        const topRow = document.createElement("div");
        topRow.className = "canvas-insp-top-row";

        const imageCaption = document.createElement("span");
        imageCaption.className = "canvas-insp-section-caption";
        imageCaption.textContent = "Image:";
        topRow.appendChild(imageCaption);

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "canvas-insp-button";
        loadBtn.textContent = "Load";
        loadBtn.title = "Open a file picker to choose a new background image.";
        loadBtn.addEventListener("click", () => {
            for (const cb of this._loadImageListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: canvas-inspector load-image listener threw.", err);
                }
            }
        });
        topRow.appendChild(loadBtn);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "canvas-insp-button";
        removeBtn.textContent = "Clear";
        removeBtn.title = "Remove the current background image from this score.";
        removeBtn.addEventListener("click", () => {
            for (const cb of this._removeImageListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: canvas-inspector remove-image listener threw.", err);
                }
            }
        });
        topRow.appendChild(removeBtn);

        // "Size:" sub-caption labelling the W and H
        // fields. Same visual style as the "Image:"
        // caption that opens the row so both read at the
        // same hierarchical level. The extra
        // .canvas-insp-size-caption class adds a margin-
        // left so the caption visually starts a new group
        // rather than continuing the Image / Load / Clear
        // strip at the row's normal 8 px gap.
        const sizeCaption = document.createElement("span");
        sizeCaption.className =
            "canvas-insp-section-caption canvas-insp-size-caption";
        sizeCaption.textContent = "Size:";
        topRow.appendChild(sizeCaption);

        const wLabel = document.createElement("span");
        wLabel.className = "canvas-insp-axis-label";
        wLabel.textContent = "W";
        topRow.appendChild(wLabel);

        this._canvasWField = this._buildCanvasField("w");
        topRow.appendChild(this._canvasWField);

        const hLabel = document.createElement("span");
        hLabel.className = "canvas-insp-axis-label";
        hLabel.textContent = "H";
        topRow.appendChild(hLabel);

        this._canvasHField = this._buildCanvasField("h");
        topRow.appendChild(this._canvasHField);

        panel.appendChild(topRow);

        // Brightness slider row (Stage 6). Sits between
        // the top button row and the divider that
        // separates image controls from the pinned
        // section. The label reuses
        // .canvas-insp-section-caption so it reads at
        // the same visual level as "Image:" and "Size:"
        // above; the slider extends to the right edge of
        // the top row's natural width via the row's flex
        // layout. The slider drives the canvas's
        // displayBrightness via the registered listeners;
        // main.js routes the value to both bundle and
        // canvas. Per DESIGN.md Section 13.5 the control
        // is purely visual — image-derived signals
        // continue to read from the unmodified source
        // bitmap.
        const brightnessRow = document.createElement("div");
        brightnessRow.className = "canvas-insp-brightness-row";

        const brightnessLabel = document.createElement("span");
        brightnessLabel.className = "canvas-insp-section-caption";
        brightnessLabel.textContent = "Brightness";
        brightnessRow.appendChild(brightnessLabel);

        const brightnessSlider = document.createElement("input");
        brightnessSlider.type = "range";
        brightnessSlider.className = "canvas-insp-brightness-slider";
        brightnessSlider.min = "0";
        brightnessSlider.max = "100";
        brightnessSlider.step = "1";
        brightnessSlider.value = "100";
        brightnessSlider.setAttribute("aria-label", "Canvas image brightness");
        brightnessSlider.title = "Dim the displayed image to make overlays easier to read. Music-side signals continue to read from the original image regardless of this setting.";
        brightnessSlider.addEventListener("input", () => {
            const n = parseInt(brightnessSlider.value, 10);
            if (!Number.isFinite(n)) return;
            for (const cb of this._displayBrightnessListeners) {
                try { cb(n); } catch (err) {
                    console.error("GXW: canvas-inspector brightness listener threw.", err);
                }
            }
        });
        brightnessRow.appendChild(brightnessSlider);
        this._brightnessSlider = brightnessSlider;

        panel.appendChild(brightnessRow);

        // Horizontal separator below the brightness row,
        // before the pinned section.
        const topSep = document.createElement("div");
        topSep.className = "canvas-insp-separator";
        panel.appendChild(topSep);

        // Pinned section (Stage 5). Six fixed slots in a
        // 2-row by 3-column grid. Explicit placeholders
        // for empty slots so the grid's footprint is
        // visible even when the score has no pins yet,
        // which is the common case for a fresh score.
        const pinnedEl = document.createElement("div");
        pinnedEl.className = "canvas-insp-pinned";
        this._pinnedGridEl = pinnedEl;
        panel.appendChild(pinnedEl);
        this._renderPinnedGrid();

        // Divider between pinned and shared sections.
        // Visually heavier than the top separator (which
        // sits between control rows) so the section
        // boundary reads at a glance.
        const sectionDivider = document.createElement("div");
        sectionDivider.className = "canvas-insp-section-divider";
        panel.appendChild(sectionDivider);

        // Shared gallery section. 3-column grid sized by
        // the same CSS variable as the pinned section.
        // Vertical scrolling falls through to the
        // #canvas-inspector-area's overflow-y rule when
        // entries push the grid past the viewport.
        const sharedEl = document.createElement("div");
        sharedEl.className = "canvas-insp-gallery";
        this._sharedGridEl = sharedEl;
        panel.appendChild(sharedEl);
        this._renderSharedGrid();

        this.container.appendChild(panel);

        // Measure the Starting State row in the Properties
        // inspector and copy its offsetWidth into the
        // gallery-width CSS variable. Deferred to a
        // microtask so the Properties tab's DOM has
        // settled if it just rendered. Falls back silently
        // when the row isn't in the DOM yet — main.js's
        // tab-activation hook calls remeasureGalleryWidth
        // when the Canvas tab becomes active, which covers
        // the case where Properties wasn't rendered until
        // after the first measurement attempt.
        queueMicrotask(() => this._measureGalleryWidth());
    }

    /**
     * Find the Starting State row in the Properties
     * inspector and copy its offsetWidth into the CSS
     * variable that drives both grid widths. Silent
     * fallback when the row isn't in the DOM (timing
     * race) or measures zero (layout not flushed); the
     * fallback width set in _render covers those cases
     * until a later remeasure picks up the real value.
     */
    _measureGalleryWidth() {
        const panel = this._panelEl;
        if (panel === null) return;
        const row = document.querySelector(".insp-row-starting-state");
        if (!(row instanceof HTMLElement)) return;
        const w = row.offsetWidth;
        if (w > 0) {
            panel.style.setProperty(
                "--canvas-insp-gallery-width",
                w + "px",
            );
            // Fixed pixel thumb dimensions computed once
            // from the measured gallery width. The grids
            // use these as fixed column widths and the
            // thumb elements use them as fixed width and
            // height. Stage 4 established this pattern
            // (its fixed 72px columns) as the fix for a
            // visible body-divider drag lag: with flex
            // columns and aspect-ratio children the
            // browser re-lays out every thumbnail on
            // every drag frame, even when the gallery's
            // own width is fixed, because parent reflow
            // marks descendant layout dirty. Fixed pixel
            // dimensions skip the per-frame recomputation
            // entirely. The fallback in the CSS variable
            // (136 px) corresponds to a 420 px gallery
            // width minus 12 px of gap divided across
            // three columns.
            const gap = 6;
            const thumbSize = Math.floor((w - 2 * gap) / 3);
            if (thumbSize > 0) {
                panel.style.setProperty(
                    "--canvas-insp-thumb-size",
                    thumbSize + "px",
                );
            }
        }
    }

    /**
     * Build one canvas-dimension numeric field. Verbatim
     * port of the toolbar's _buildCanvasField: editable
     * by typing (Enter to commit, Escape to revert, blur
     * to commit silently) and by scroll-wheel scrubbing
     * in 1.0-unit increments. Hard-blocks values outside
     * 1..200 — Enter on a bad value squiggles red and
     * keeps focus; blur on a bad value silently reverts.
     *
     * @param {"w" | "h"} axis
     * @returns {HTMLDivElement}
     */
    _buildCanvasField(axis) {
        const field = document.createElement("div");
        field.className = "toolbar-canvas-field";
        field.setAttribute("contenteditable", "plaintext-only");
        field.setAttribute("spellcheck", "false");
        field.setAttribute("aria-label",
            axis === "w" ? "Canvas width" : "Canvas height");
        field.title = axis === "w"
            ? "Canvas width in canvas units. Scroll to scrub, type to set, Enter to commit."
            : "Canvas height in canvas units. Scroll to scrub, type to set, Enter to commit.";
        field.textContent = String(axis === "w" ? this._canvasW : this._canvasH);

        field.addEventListener("wheel", (e) => {
            if (document.activeElement === field) return;
            const current = parseInt(field.textContent ?? "", 10);
            if (!Number.isFinite(current)) return;
            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            const target = clamp(current + direction, CANVAS_DIMENSION_MIN, CANVAS_DIMENSION_MAX);
            if (target === current) return;
            field.textContent = String(target);
            if (axis === "w") this._canvasW = target;
            else this._canvasH = target;
            this._emitCanvasSizeEdit(axis, target);
        }, { passive: false });

        field.addEventListener("focus", () => {
            const sel = window.getSelection();
            if (sel === null) return;
            const range = document.createRange();
            range.selectNodeContents(field);
            sel.removeAllRanges();
            sel.addRange(range);
        });

        const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
            const text = (field.textContent ?? "").trim();
            const n = parseInt(text, 10);
            const stored = axis === "w" ? this._canvasW : this._canvasH;
            const valid =
                Number.isFinite(n) &&
                String(n) === text &&
                n >= CANVAS_DIMENSION_MIN &&
                n <= CANVAS_DIMENSION_MAX;
            if (!valid) {
                if (mode === "blur") {
                    field.textContent = String(stored);
                    field.classList.remove("error");
                    return;
                }
                field.classList.add("error");
                return;
            }
            field.classList.remove("error");
            if (n === stored) return;
            if (axis === "w") this._canvasW = n;
            else this._canvasH = n;
            field.textContent = String(n);
            this._emitCanvasSizeEdit(axis, n);
        };

        field.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                tryCommit("enter");
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                field.textContent = String(axis === "w" ? this._canvasW : this._canvasH);
                field.classList.remove("error");
                field.blur();
                return;
            }
            if (field.classList.contains("error")) {
                queueMicrotask(() => field.classList.remove("error"));
            }
        });
        field.addEventListener("blur", () => {
            tryCommit("blur");
        });

        return field;
    }

    /**
     * @param {"w" | "h"} axis
     * @param {number} value
     */
    _emitCanvasSizeEdit(axis, value) {
        const edit = {
            kind: axis === "w" ? "setCanvasW" : "setCanvasH",
            value,
        };
        for (const cb of this._sceneEditListeners) {
            try { cb(edit); } catch (err) {
                console.error("GXW: canvas-inspector scene-edit listener threw.", err);
            }
        }
    }

    /**
     * Read gallery.list and update the cached entries,
     * then re-render the shared grid. Errors are logged
     * and the cache stays at its prior value, so a
     * transient failure leaves the grid in its last
     * known state rather than collapsing to empty.
     * @returns {Promise<void>}
     */
    async _loadGallery() {
        try {
            const result = await galleryList();
            this._galleryEntries = result.entries;
        } catch (err) {
            console.error("GXW: failed to read image gallery:", err);
            return;
        }
        this._renderSharedGrid();
    }

    /**
     * Repopulate the shared gallery grid against the
     * current cached entries and active id. Renders an
     * empty-state message when the entry list is empty
     * so the section's purpose stays visible even before
     * any image has been imported. No-op when the grid
     * element isn't mounted yet.
     */
    _renderSharedGrid() {
        const grid = this._sharedGridEl;
        if (grid === null) return;
        grid.innerHTML = "";
        if (this._galleryEntries.length === 0) {
            const empty = document.createElement("div");
            empty.className = "canvas-insp-gallery-empty";
            empty.textContent = "Gallery is empty. Imported images will appear here.";
            grid.appendChild(empty);
            return;
        }
        for (const entry of this._galleryEntries) {
            const slot = document.createElement("div");
            slot.className = "canvas-insp-thumb canvas-insp-shared-slot";
            if (entry.id === this._activeGalleryId) {
                slot.classList.add("active");
            }
            const img = document.createElement("img");
            // Decorative; the user's mental model is the
            // image itself, not an alt-text description.
            img.alt = "";
            img.draggable = false;
            const previewSrc = "data:image/png;base64," + entry.thumbnailBase64;
            img.src = previewSrc;
            slot.appendChild(img);
            const entryId = entry.id;
            // Drag-spanning gesture: pointerdown starts a
            // state machine that either synthesises a
            // click on pointerup-below-threshold, emits
            // a drop on pointerup-over-pinned-slot, or
            // emits a drag-off on pointerup-outside-pane.
            // No separate click listener; the threshold
            // logic synthesises the click intent so we
            // don't get double-fires from click +
            // pointerup-below-threshold.
            slot.addEventListener("pointerdown", (e) => {
                if (e.button !== 0) return;
                this._onSharedPointerDown(e, entryId, previewSrc);
            });
            grid.appendChild(slot);
        }
    }

    /**
     * Repopulate the pinned grid against the current
     * snapshot. Always PINNED_SLOTS_COUNT fixed slots;
     * populated ones render the snapshot entry's dataUrl
     * as an inline image, empty ones render as a dim
     * placeholder. The active flag in the snapshot
     * drives the green active-frame. No-op when the
     * grid element isn't mounted yet.
     */
    _renderPinnedGrid() {
        const grid = this._pinnedGridEl;
        if (grid === null) return;
        grid.innerHTML = "";
        for (let i = 0; i < PINNED_SLOTS_COUNT; i++) {
            const slot = document.createElement("div");
            slot.className = "canvas-insp-thumb canvas-insp-pinned-slot";
            // Tag the slot's index on a data attribute so
            // the drag mechanics (which find slots via
            // document.elementFromPoint) can read the
            // index off the DOM rather than maintaining a
            // parallel array. Set on every slot — empty
            // and populated alike — so empty slots are
            // valid drop targets too.
            slot.dataset.slotIndex = String(i);
            const entry = this._pinnedSnapshot[i];
            if (entry === null) {
                slot.classList.add("empty");
            } else {
                if (entry.active === true) {
                    slot.classList.add("active");
                }
                const img = document.createElement("img");
                img.alt = "";
                img.draggable = false;
                img.src = entry.dataUrl;
                slot.appendChild(img);
                const slotIndex = i;
                const hash = entry.hash;
                const previewSrc = entry.dataUrl;
                // Pointerdown starts the drag state
                // machine. Below-threshold pointerup
                // synthesises a click (set-as-background
                // for this pinned slot); above-threshold
                // pointerup over another pinned slot
                // emits a reorder; above-threshold
                // pointerup outside the inspector pane
                // emits a drag-off (unpin). The click
                // handler used to be a plain click
                // listener; like the shared section, the
                // threshold logic now synthesises it to
                // avoid double-fires.
                slot.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0) return;
                    this._onPinnedPointerDown(e, slotIndex, hash, previewSrc);
                });
            }
            grid.appendChild(slot);
        }
    }

    /**
     * @param {string} id
     */
    _emitSetBackground(id) {
        for (const cb of this._setBackgroundListeners) {
            try { cb({ id }); } catch (err) {
                console.error("GXW: canvas-inspector set-background listener threw.", err);
            }
        }
    }

    /**
     * @param {number} slotIndex
     * @param {string} hash
     */
    _emitSetBackgroundFromPinnedSlot(slotIndex, hash) {
        for (const cb of this._setBackgroundFromPinnedListeners) {
            try { cb({ slotIndex, hash }); } catch (err) {
                console.error("GXW: canvas-inspector pinned-set-background listener threw.", err);
            }
        }
    }

    /**
     * @param {{ source: any, targetSlotIndex: number }} intent
     */
    _emitDropOnPinnedSlot(intent) {
        for (const cb of this._dropOnPinnedSlotListeners) {
            try { cb(intent); } catch (err) {
                console.error("GXW: canvas-inspector drop-on-pinned-slot listener threw.", err);
            }
        }
    }

    /**
     * @param {{ source: any }} intent
     */
    _emitDragOff(intent) {
        for (const cb of this._dragOffListeners) {
            try { cb(intent); } catch (err) {
                console.error("GXW: canvas-inspector drag-off listener threw.", err);
            }
        }
    }

    // --- Drag mechanics (Stage 5 second commit) ---

    /**
     * Start tracking a potential drag from a shared
     * thumbnail. Sets up document-level pointermove and
     * pointerup listeners; the drag is only committed
     * (preview shown, drop targets highlighted) once
     * motion crosses DRAG_THRESHOLD_PX. Below that
     * threshold pointerup synthesises a click intent
     * (set-as-background); above it, pointerup branches
     * on the cursor location (pinned slot, off-pane,
     * elsewhere) to pick the right emit.
     *
     * @param {PointerEvent} e
     * @param {string} entryId
     * @param {string} previewSrc Full <img>-ready src for the drag preview.
     */
    _onSharedPointerDown(e, entryId, previewSrc) {
        this._startDrag(e, { kind: "shared", entryId }, previewSrc);
    }

    /**
     * Start tracking a potential drag from a populated
     * pinned slot. Below-threshold pointerup synthesises
     * a click (set-as-background for this slot's image);
     * above-threshold pointerup over another pinned slot
     * emits a reorder; above-threshold pointerup outside
     * the inspector pane emits a drag-off (unpin).
     *
     * @param {PointerEvent} e
     * @param {number} slotIndex
     * @param {string} hash
     * @param {string} previewSrc Full <img>-ready src for the drag preview.
     */
    _onPinnedPointerDown(e, slotIndex, hash, previewSrc) {
        this._startDrag(
            e,
            { kind: "pinned", hash, sourceSlotIndex: slotIndex },
            previewSrc,
        );
    }

    /**
     * Shared drag-state initialisation. Captures the
     * source kind, the preview src, and the start
     * pointer position; attaches document-level
     * listeners; preventDefaults the source event so
     * the browser's native drag image and text-
     * selection behaviour stay out of the way.
     *
     * @param {PointerEvent} e
     * @param {any} source
     * @param {string} previewSrc
     */
    _startDrag(e, source, previewSrc) {
        // If another drag is already in progress (shouldn't
        // happen under normal pointer event sequencing, but
        // be defensive against odd race conditions) clear
        // it before starting a new one.
        if (this._dragState !== null) {
            this._cleanupDragState();
        }

        const onMove = (/** @type {PointerEvent} */ ev) => {
            this._onDocumentPointerMove(ev);
        };
        const onUp = (/** @type {PointerEvent} */ ev) => {
            this._onDocumentPointerUp(ev);
        };

        this._dragState = {
            source,
            previewSrc,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId,
            dragging: false,
            preview: null,
            currentTarget: null,
            offPane: false,
            onMove,
            onUp,
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);

        e.preventDefault();
    }

    /**
     * Pointer move during a tracked drag. Below threshold
     * we wait; once over threshold we transition into
     * drag mode (preview element added, body class set)
     * and update the preview position, drop-target
     * highlight, and off-pane state on every move.
     *
     * @param {PointerEvent} e
     */
    _onDocumentPointerMove(e) {
        const state = this._dragState;
        if (state === null) return;
        if (e.pointerId !== state.pointerId) return;

        if (!state.dragging) {
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
            // Threshold crossed — enter drag mode.
            state.dragging = true;
            state.preview = this._createDragPreview(state.previewSrc);
            document.body.appendChild(state.preview);
            document.body.classList.add("dragging-canvas-insp-thumb");
        }

        if (state.preview !== null) {
            state.preview.style.left = e.clientX + "px";
            state.preview.style.top = e.clientY + "px";
        }
        this._updateDropTarget(e.clientX, e.clientY);
    }

    /**
     * Pointer up during a tracked drag. Branches:
     *   - Below threshold → synthesise a click intent
     *     (set-as-background, scoped by source kind).
     *   - Above threshold over a pinned slot → emit
     *     onDropOnPinnedSlot with the source and target.
     *   - Above threshold outside the inspector pane →
     *     vanish-animate the preview, then emit
     *     onDragOff.
     *   - Above threshold elsewhere (over a shared slot,
     *     over the inspector chrome, etc.) → silent
     *     cancel.
     *
     * @param {PointerEvent} e
     */
    _onDocumentPointerUp(e) {
        const state = this._dragState;
        if (state === null) return;
        if (e.pointerId !== state.pointerId && e.type === "pointerup") {
            return;
        }

        const wasDragging = state.dragging;
        const dropTarget = state.currentTarget;
        const offPane = state.offPane;
        const source = state.source;

        if (!wasDragging) {
            // Click intent. Clean up immediately, then
            // emit set-as-background scoped by source.
            this._cleanupDragState();
            if (source.kind === "shared") {
                this._emitSetBackground(source.entryId);
            } else {
                this._emitSetBackgroundFromPinnedSlot(
                    source.sourceSlotIndex,
                    source.hash,
                );
            }
            return;
        }

        if (dropTarget !== null) {
            const raw = dropTarget.dataset.slotIndex;
            const slotIndex = raw === undefined ? -1 : parseInt(raw, 10);
            this._cleanupDragState();
            if (slotIndex >= 0 && slotIndex < PINNED_SLOTS_COUNT) {
                this._emitDropOnPinnedSlot({
                    source,
                    targetSlotIndex: slotIndex,
                });
            }
            return;
        }

        if (offPane) {
            // Vanish animation → emit drag-off when it
            // finishes. Document listeners detach
            // immediately so a follow-up pointer down
            // starts a fresh drag rather than colliding
            // with the in-progress vanish.
            this._vanishPreviewThenFinish(() => {
                this._emitDragOff({ source });
            });
            return;
        }

        // Above-threshold release somewhere that isn't a
        // pinned slot and isn't off-pane (e.g. over a
        // shared slot, over the inspector chrome). Silent
        // cancel.
        this._cleanupDragState();
    }

    /**
     * Find the pinned slot under the cursor and update
     * the .drop-target class so exactly one slot at a
     * time carries the highlight. Also tracks whether
     * the cursor is outside the inspector pane (off-pane)
     * for the drag-to-remove gesture. Uses
     * document.elementFromPoint; the drag preview is
     * styled pointer-events: none so it doesn't show up
     * in the hit test.
     *
     * @param {number} clientX
     * @param {number} clientY
     */
    _updateDropTarget(clientX, clientY) {
        const state = this._dragState;
        if (state === null) return;
        const el = document.elementFromPoint(clientX, clientY);
        /** @type {HTMLElement | null} */
        let pinnedSlot = null;
        /** @type {boolean} */
        let insidePane = false;
        if (el instanceof HTMLElement) {
            const slotEl = el.closest(".canvas-insp-pinned-slot");
            if (slotEl instanceof HTMLElement) {
                pinnedSlot = slotEl;
            }
            const paneEl = el.closest("#canvas-inspector-area");
            if (paneEl !== null) {
                insidePane = true;
            }
        }
        const offPane = !insidePane;

        // Off-pane suppresses the drop-target highlight
        // entirely — a pinned slot under the cursor would
        // be highlighted by the closest() check above, but
        // when the cursor is conceptually outside the
        // pane (over the canvas, over the editor, off the
        // window edge) we treat the gesture as a remove,
        // not a drop. In practice the elementFromPoint
        // will return null when off-window, so pinnedSlot
        // is already null in that case — this is
        // defensive against unusual paths.
        const effectiveTarget = offPane ? null : pinnedSlot;

        if (effectiveTarget !== state.currentTarget) {
            if (state.currentTarget !== null) {
                state.currentTarget.classList.remove("drop-target");
            }
            state.currentTarget = effectiveTarget;
            if (effectiveTarget !== null) {
                effectiveTarget.classList.add("drop-target");
            }
        }

        if (offPane !== state.offPane) {
            state.offPane = offPane;
            if (state.preview !== null) {
                state.preview.classList.toggle("will-remove", offPane);
            }
        }
    }

    /**
     * Build the floating drag-preview element. Positioned
     * by _onDocumentPointerMove via style.left and
     * style.top; CSS handles the rest (fixed positioning,
     * size, semi-transparency, pointer-events: none).
     *
     * @param {string} previewSrc Full <img>-ready src.
     * @returns {HTMLDivElement}
     */
    _createDragPreview(previewSrc) {
        const div = document.createElement("div");
        div.className = "canvas-insp-drag-preview";
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.src = previewSrc;
        div.appendChild(img);
        return div;
    }

    /**
     * Detach the document listeners immediately, then
     * trigger the vanish animation on the preview;
     * after the animation completes, finish cleanup
     * (remove preview, clear body class) and invoke the
     * callback (which fires the appropriate drag-off
     * emit). Splitting the cleanup this way lets a
     * follow-up pointerdown start a fresh drag without
     * waiting for the vanish to finish.
     *
     * @param {() => void} onFinish
     */
    _vanishPreviewThenFinish(onFinish) {
        const state = this._dragState;
        if (state === null) {
            onFinish();
            return;
        }
        // Detach listeners and clear any drop-target
        // highlight; the preview persists so the
        // animation can play.
        document.removeEventListener("pointermove", state.onMove);
        document.removeEventListener("pointerup", state.onUp);
        document.removeEventListener("pointercancel", state.onUp);
        if (state.currentTarget !== null) {
            state.currentTarget.classList.remove("drop-target");
            state.currentTarget = null;
        }
        const preview = state.preview;
        this._dragState = null;

        if (preview === null) {
            document.body.classList.remove("dragging-canvas-insp-thumb");
            onFinish();
            return;
        }
        // Trigger the CSS animation by adding the
        // .vanishing class; it runs forwards-fill so the
        // preview stays at the final state (opacity 0,
        // scale 1.4) until we remove it.
        preview.classList.add("vanishing");
        const VANISH_MS = 350;
        setTimeout(() => {
            preview.remove();
            document.body.classList.remove("dragging-canvas-insp-thumb");
            onFinish();
        }, VANISH_MS);
    }

    /**
     * Immediate cleanup: remove the drop-target
     * highlight, remove the drag preview, clear the
     * dragging body class, detach document listeners,
     * and null out _dragState. Safe to call from any
     * drag-state transition; idempotent when _dragState
     * is already null. Used by the non-vanish paths
     * (click intent, drop on pinned slot, silent cancel).
     * Off-pane drops use _vanishPreviewThenFinish
     * instead.
     */
    _cleanupDragState() {
        const state = this._dragState;
        if (state === null) return;
        document.removeEventListener("pointermove", state.onMove);
        document.removeEventListener("pointerup", state.onUp);
        document.removeEventListener("pointercancel", state.onUp);
        if (state.currentTarget !== null) {
            state.currentTarget.classList.remove("drop-target");
        }
        if (state.preview !== null) {
            state.preview.remove();
        }
        if (state.dragging) {
            document.body.classList.remove("dragging-canvas-insp-thumb");
        }
        this._dragState = null;
    }
}

/**
 * Clamp a number to [min, max].
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(n, min, max) {
    if (n < min) return min;
    if (n > max) return max;
    return n;
}
