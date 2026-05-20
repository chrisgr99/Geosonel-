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
 * Stage 5 layout. Top to bottom: top row with Load
 * Image, Remove Image, Pin, W [field], H [field]; a
 * horizontal separator; the per-score pinned section as
 * a 2-row by 3-column grid of 6 fixed slots; a section
 * divider; the shared recent-image gallery as a 3-column
 * grid of however many entries the gallery currently
 * holds, scrolling vertically when it overflows the
 * pane.
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
 * only from images they actually use). The Pin button
 * on the top row pins the current background via the
 * onPinClick callback; main.js dispatches via
 * bundle.pinCurrentImage and translates the outcome
 * into a messages-area note.
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
 * Stage 1's. Existing for shared section:
 * onSetBackgroundFromGallery, setActiveGalleryId,
 * refreshGallery. New for Stage 5: onPinClick,
 * onSetBackgroundFromPinnedSlot, setPinnedSnapshot,
 * setPinButtonState. The remeasureGalleryWidth hook lets
 * main.js re-trigger the Starting State row measurement
 * after events that might shift the inspector's natural
 * width (tab switches into Canvas, scene reloads that
 * rebuild the Properties tab).
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

        /**
         * Pin button visual state. main.js updates this
         * whenever the bundle changes in a way that
         * affects pinnability (image set or removed,
         * pinned slot filled or cleared, current image
         * hash recomputed). The disabledReason becomes
         * the button's tooltip when the button is
         * disabled. The button always fires onPinClick
         * when clicked regardless of state; main.js
         * dispatches via bundle.pinCurrentImage and
         * surfaces the authoritative outcome in the
         * messages area.
         * @type {{ enabled: boolean, disabledReason: string }}
         */
        this._pinButtonState = {
            enabled: false,
            disabledReason: "No current background to pin",
        };

        /** @type {HTMLDivElement | null} */
        this._pinnedGridEl = null;
        /** @type {HTMLButtonElement | null} */
        this._pinButtonEl = null;

        /** @type {Array<() => void>} */
        this._pinClickListeners = [];

        /** @type {Array<(intent: { slotIndex: number, hash: string }) => void>} */
        this._setBackgroundFromPinnedListeners = [];

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
     * Register a callback for Pin button clicks. The
     * callback fires on every click regardless of the
     * button's visual enabled state; main.js dispatches
     * via bundle.pinCurrentImage and translates the
     * outcome (ok or one of the disabled reasons) into
     * the messages area.
     * @param {() => void} cb
     */
    onPinClick(cb) {
        this._pinClickListeners.push(cb);
    }

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
     * Update the Pin button's visual enabled / disabled
     * state. The button always fires onPinClick when
     * clicked regardless of visual state; this update
     * controls the .disabled class and the tooltip text.
     * @param {{ enabled: boolean, disabledReason?: string }} state
     */
    setPinButtonState(state) {
        this._pinButtonState = {
            enabled: !!state.enabled,
            disabledReason: state.disabledReason ?? "",
        };
        this._applyPinButtonState();
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

    // --- Internals ---

    _render() {
        this.container.innerHTML = "";
        this._canvasWField = null;
        this._canvasHField = null;
        this._panelEl = null;
        this._sharedGridEl = null;
        this._pinnedGridEl = null;
        this._pinButtonEl = null;

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
        // Clear, Pin, W [field], H [field]. The caption
        // anchors the image-related controls; the
        // tightened button labels (Load was "Load
        // Image", Clear was "Remove Image") plus the
        // reduced button padding in the .canvas-insp-
        // button rule keep total row width close to the
        // inspector floor so the row reads as one
        // horizontal strip rather than wrapping.
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

        // Pin button (Stage 5). Always clickable; the
        // visual disabled state is driven by
        // setPinButtonState and surfaces via a CSS
        // .disabled class plus a tooltip explaining why.
        // The click handler always fires onPinClick;
        // main.js dispatches via bundle.pinCurrentImage
        // and translates the outcome into the messages
        // area regardless of visual state, so a click on
        // a disabled-looking button still tells the user
        // why nothing happened.
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "canvas-insp-button";
        pinBtn.textContent = "Pin";
        pinBtn.addEventListener("click", () => {
            for (const cb of this._pinClickListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: canvas-inspector pin-click listener threw.", err);
                }
            }
        });
        this._pinButtonEl = pinBtn;
        this._applyPinButtonState();
        topRow.appendChild(pinBtn);

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

        // Horizontal separator below the top row.
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
            slot.className = "canvas-insp-thumb";
            if (entry.id === this._activeGalleryId) {
                slot.classList.add("active");
            }
            const img = document.createElement("img");
            // Decorative; the user's mental model is the
            // image itself, not an alt-text description.
            img.alt = "";
            img.draggable = false;
            img.src = "data:image/png;base64," + entry.thumbnailBase64;
            slot.appendChild(img);
            const entryId = entry.id;
            slot.addEventListener("click", () => {
                this._emitSetBackground(entryId);
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
                slot.addEventListener("click", () => {
                    this._emitSetBackgroundFromPinnedSlot(slotIndex, hash);
                });
            }
            grid.appendChild(slot);
        }
    }

    /**
     * Apply the Pin button's current visual state. Toggles
     * the .disabled class and updates the tooltip text.
     * The button stays click-handled in both states; the
     * disabled visual is purely a hint.
     */
    _applyPinButtonState() {
        const btn = this._pinButtonEl;
        if (btn === null) return;
        if (this._pinButtonState.enabled) {
            btn.classList.remove("disabled");
            btn.title = "Pin the current background image into the per-score pinned section.";
        } else {
            btn.classList.add("disabled");
            btn.title = this._pinButtonState.disabledReason || "Pin is not available right now.";
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
