/**
 * Canvas inspector module.
 *
 * Renders the Canvas inspector tab — the right-pane
 * sibling of the Properties inspector that exposes scene-
 * level canvas state regardless of canvas selection. Per
 * DESIGN.md Section 13.5 the tab is selection-independent:
 * it shows the background image controls, the canvas
 * dimensions, the image-transformation sliders (later
 * stages), and the recent-image gallery (Stage 3 onward).
 *
 * Stage 1 scope. Three pieces land here in the first
 * commit: the disabled placeholders for the Load Image
 * and Remove Image buttons (real wiring lands in Stage 4),
 * the Canvas W and Canvas H numeric fields migrated from
 * the canvas toolbar, and a horizontal separator below
 * the top row anticipating the gallery that Stage 3
 * lands on. The W/H fields are a verbatim port of the
 * toolbar's contenteditable implementation: scroll-wheel
 * scrubbing in 1.0-unit increments, Enter to commit,
 * Escape to revert, blur silently reverts on bad value,
 * Enter on a bad value squiggles red and keeps focus.
 *
 * Stage 3 scope. The recent-image gallery renders below
 * the separator as a four-column grid of GALLERY_SLOT_COUNT
 * fixed slots. Populated slots come from gallery.list and
 * carry the entry's 96×96 thumbnail as a base64-decoded
 * inline image; empty slots render as a dim placeholder so
 * the grid's footprint is visible before any entries land.
 * Clicking a populated slot emits an intent through the
 * onSetBackgroundFromGallery channel; main.js handles the
 * orchestration (load bytes, swap the bundle's image,
 * apply to canvas, promote the entry via gallery.touch,
 * save the bundle, set the active id back through
 * setActiveGalleryId). The slot whose entry id matches
 * the active id carries a green active-frame using the
 * same accent the Properties tab uses for editable fields.
 *
 * Wiring contract. setCanvasSize(w, h) is called by
 * main.js after every scene reload so the fields track
 * the scene's current canvasW / canvasH values without
 * disturbing a focused field. onSceneEdit(cb) lets
 * main.js subscribe to W/H commits as { kind: "setCanvasW"
 * | "setCanvasH", value: number } edits — the same shape
 * the toolbar's onSceneEdit used to emit — so main.js's
 * applySceneEdit dispatch table doesn't need to change.
 * onSetBackgroundFromGallery(cb) is the Stage 3 addition:
 * receives { id } when a thumbnail is clicked, and the
 * subscriber is expected to call setActiveGalleryId(id)
 * after committing the change so the active-frame moves.
 * refreshGallery() re-reads gallery.list and re-renders
 * the grid; called by main.js after the bundle's image
 * changes so a new entry from Stage 4's import pipeline
 * shows up immediately.
 */

// @ts-check

import { list as galleryList } from "./gallery.js";

const CANVAS_DIMENSION_MIN = 1;
const CANVAS_DIMENSION_MAX = 200;
const CANVAS_DIMENSION_DEFAULT_W = 32;
const CANVAS_DIMENSION_DEFAULT_H = 24;

// Twenty fixed slots in the gallery grid — four columns by
// five rows. The slot count is independent of how many
// entries the backing gallery currently holds: fewer entries
// means trailing slots render as empty placeholders, more
// entries means the tail is hidden until older entries get
// evicted or the gallery is paginated in a later stage.
// Five rows at the default inspector width was the Section
// 13.5 target; the slot count follows from four columns ×
// five visible rows.
const GALLERY_SLOT_COUNT = 20;

export class CanvasInspector {
    /**
     * @param {HTMLElement} container  Element to mount the inspector in.
     */
    constructor(container) {
        this.container = container;

        // Canvas-size state. Mirrors the scene's canvasW
        // and canvasH whenever main.js calls setCanvasSize
        // after a scene reload. Defaults match the
        // toolbar's previous behaviour so a freshly-
        // mounted inspector with no scene yet displays the
        // same numbers older versions implicitly used.
        this._canvasW = CANVAS_DIMENSION_DEFAULT_W;
        this._canvasH = CANVAS_DIMENSION_DEFAULT_H;

        /** @type {HTMLDivElement | null} */
        this._canvasWField = null;
        /** @type {HTMLDivElement | null} */
        this._canvasHField = null;

        /** @type {Array<(edit: any) => void>} */
        this._sceneEditListeners = [];

        // --- Gallery state (Stage 3) ---

        /**
         * Cached entries from the most recent gallery.list
         * call, sorted most-recent-first. The grid renders
         * the first GALLERY_SLOT_COUNT of these as
         * populated slots; any beyond that are hidden
         * (eviction in the gallery layer keeps the cap
         * bounded). Empty array until the first
         * _loadGallery resolves.
         * @type {Array<{id: string, sourcePath: string, thumbnailBase64: string, addedAt: number}>}
         */
        this._galleryEntries = [];

        /**
         * Id of the entry whose thumbnail should carry the
         * green active-frame, or null when no entry is
         * active. Set by main.js via setActiveGalleryId
         * after a successful background-image swap.
         * @type {string | null}
         */
        this._activeGalleryId = null;

        /**
         * Reference to the gallery grid container, used by
         * _renderGalleryGrid to repopulate without
         * re-running the full _render. Null until _render
         * runs and gone again on the next _render (the
         * container's contents are rebuilt as a whole each
         * time).
         * @type {HTMLDivElement | null}
         */
        this._galleryGridEl = null;

        /** @type {Array<(intent: {id: string}) => void>} */
        this._setBackgroundListeners = [];

        /** @type {Array<() => void>} */
        this._loadImageListeners = [];

        /** @type {Array<() => void>} */
        this._removeImageListeners = [];

        this._render();
        // Kick off the initial gallery load. _render has
        // already painted GALLERY_SLOT_COUNT empty slots so
        // there's something visible until the async list
        // resolves; _renderGalleryGrid then re-fills with
        // the entries it returns. Errors are logged and
        // leave the grid as empty placeholders — a degraded
        // but readable state.
        void this._loadGallery();
    }

    /**
     * Subscribe to scene-edit emissions from the W and H
     * fields. The callback receives an edit object shaped
     * like the inspector's edits — { kind: "setCanvasW" |
     * "setCanvasH", value: number }. main.js routes these
     * through applySceneEdit so they share the dirty-state,
     * auto-save, and re-run mechanics with inspector and
     * canvas edits, on the same code path the toolbar used
     * before the migration.
     * @param {(edit: any) => void} cb
     */
    onSceneEdit(cb) {
        this._sceneEditListeners.push(cb);
    }

    /**
     * Update the displayed canvas-size values. Called by
     * main.js after each scene reload so the fields track
     * whatever scene.json declares (or the migration
     * default of 32 × 24 for scenes that predate the
     * canvas-size feature). Doesn't touch a focused field
     * — if the user is mid-edit on W or H, an unrelated
     * scene reload shouldn't overwrite their typed value
     * before they get a chance to commit. The internal
     * mirror values are updated unconditionally so the
     * diff check at commit time still reflects the latest
     * scene state.
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

    // --- Gallery public API (Stage 3) ---

    /**
     * Subscribe to background-set intents emitted by
     * gallery thumbnail clicks. The callback receives
     * { id } where id is the clicked entry's id. The
     * subscriber owns the orchestration (load bytes,
     * mutate bundle, apply to canvas, promote via
     * gallery.touch, save) and is expected to call
     * setActiveGalleryId(id) on success so the
     * green active-frame moves to the clicked slot.
     * Multiple listeners are supported, matching the
     * onSceneEdit pattern, though only one is wired in
     * practice.
     * @param {(intent: {id: string}) => void} cb
     */
    onSetBackgroundFromGallery(cb) {
        this._setBackgroundListeners.push(cb);
    }

    /**
     * Set or clear the gallery id whose thumbnail should
     * carry the green active-frame. Pass null to clear.
     * The grid re-renders so the frame moves to the
     * matching slot (or disappears, when null). Called
     * by main.js after a successful background-image
     * swap; the Stage 4 Open Score recency hook will
     * also call this.
     * @param {string | null} id
     */
    setActiveGalleryId(id) {
        if (this._activeGalleryId === id) return;
        this._activeGalleryId = id;
        this._renderGalleryGrid();
    }

    /**
     * Re-read the gallery and re-render the grid. Called
     * by main.js after operations that change the entry
     * list (Stage 3: after a click promotes an entry;
     * Stage 4+: after import paths add entries, after
     * right-click Remove from history). Cheap to call:
     * gallery.list is a single IPC round-trip or IDB read.
     * Errors are logged and the grid stays at its prior
     * state.
     * @returns {Promise<void>}
     */
    async refreshGallery() {
        await this._loadGallery();
    }

    /**
     * Subscribe to Load Image button clicks. main.js wires
     * this to imageImporter.importViaFilePicker(), which
     * opens the OS file picker. Stage 4 addition; before
     * Stage 4 the button was a disabled placeholder.
     * @param {() => void} cb
     */
    onLoadImageClick(cb) {
        this._loadImageListeners.push(cb);
    }

    /**
     * Subscribe to Remove Image button clicks. main.js
     * wires this to imageImporter.removeCurrentImage() and
     * clears the active gallery id after the await. Stage 4
     * addition; before Stage 4 the button was a disabled
     * placeholder.
     * @param {() => void} cb
     */
    onRemoveImageClick(cb) {
        this._removeImageListeners.push(cb);
    }

    // --- Internals ---

    _render() {
        this.container.innerHTML = "";
        this._canvasWField = null;
        this._canvasHField = null;
        this._galleryGridEl = null;

        const panel = document.createElement("div");
        panel.className = "canvas-insp-panel";

        // Top row: Load Image, Remove Image, W field, H field.
        // Both buttons went live in Stage 4; main.js's click
        // handlers route them to imageImporter for the
        // actual file-picker / removal flow. Click intents
        // are emitted via onLoadImageClick / onRemoveImageClick
        // so the inspector stays decoupled from the
        // importer's dependencies.
        const topRow = document.createElement("div");
        topRow.className = "canvas-insp-top-row";

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "canvas-insp-button";
        loadBtn.textContent = "Load Image";
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
        removeBtn.textContent = "Remove Image";
        removeBtn.title = "Remove the current background image from this score.";
        removeBtn.addEventListener("click", () => {
            for (const cb of this._removeImageListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: canvas-inspector remove-image listener threw.", err);
                }
            }
        });
        topRow.appendChild(removeBtn);

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

        // Horizontal separator anticipating the gallery
        // Stage 3 lands below it. Rendered now so the
        // top row's footprint is visually anchored
        // against the rest of the tab from Stage 1
        // onward.
        const sep = document.createElement("div");
        sep.className = "canvas-insp-separator";
        panel.appendChild(sep);

        // Gallery grid (Stage 3). The container is created
        // here so the empty placeholder slots paint in
        // their final position as soon as the inspector
        // mounts; the initial async _loadGallery from the
        // constructor refills the populated slots once
        // gallery.list resolves. Subsequent grid changes
        // (setActiveGalleryId, refreshGallery) just call
        // _renderGalleryGrid against the same element
        // without re-running _render.
        const galleryEl = document.createElement("div");
        galleryEl.className = "canvas-insp-gallery";
        this._galleryGridEl = galleryEl;
        panel.appendChild(galleryEl);
        this._renderGalleryGrid();

        this.container.appendChild(panel);
    }

    /**
     * Build one canvas-dimension numeric field. Verbatim
     * port of the toolbar's _buildCanvasField: editable by
     * typing (Enter to commit, Escape to revert, blur to
     * commit silently) and by scroll-wheel scrubbing in
     * 1.0-unit increments. Hard-blocks values outside
     * 1..200 — Enter on a bad value squiggles red and
     * keeps focus; blur on a bad value silently reverts.
     * Scroll-wheel scrubbing emits an edit on every notch
     * so the canvas redraws live with the new size; typed
     * commits emit on Enter or blur.
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

        // Scroll-wheel scrubbing. 1.0-unit increments are
        // coarser than the inspector's 0.3 (canvas size
        // has a much wider range and integer-only values;
        // small fractional steps would feel sluggish and
        // would need rounding anyway). Wheel events on a
        // field that currently has keyboard focus pass
        // through to the browser so the user's text-cursor
        // scrolling works as expected; on an unfocused
        // field, wheel scrubs the value and emits an edit
        // per notch.
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

        // Select all on focus so the user's first keystroke
        // replaces the existing value rather than inserting
        // into it. Mirrors the inspector's editable-field
        // convention.
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
                    // Silently revert: an abandoned bad
                    // value shouldn't carry forward.
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
            // Clear an error squiggle on any other
            // keystroke so the user sees their corrections
            // in step with their typing.
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
     * Emit a canvas-size edit to every registered
     * scene-edit listener. The edit shape mirrors
     * inspector edits: { kind, value }. main.js
     * dispatches on kind to the matching sceneEditor
     * mutator.
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

    // --- Gallery internals (Stage 3) ---

    /**
     * Read gallery.list and update the cached entries,
     * then re-render the grid. The cache lets
     * setActiveGalleryId re-render the grid synchronously
     * (no IPC round-trip on every active-frame change)
     * and lets a not-yet-mounted grid render correctly
     * the first time _render runs. Errors are logged
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
        this._renderGalleryGrid();
    }

    /**
     * Repopulate the gallery grid against the current
     * cached entries and active id. No-op when the grid
     * element hasn't been mounted yet (the constructor's
     * initial _loadGallery may finish before _render
     * runs; subsequent refreshes find the grid in place).
     */
    _renderGalleryGrid() {
        const grid = this._galleryGridEl;
        if (grid === null) return;
        grid.innerHTML = "";
        for (let i = 0; i < GALLERY_SLOT_COUNT; i++) {
            const slot = document.createElement("div");
            slot.className = "canvas-insp-thumb";
            const entry = this._galleryEntries[i];
            if (entry === undefined) {
                slot.classList.add("empty");
            } else {
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
            }
            grid.appendChild(slot);
        }
    }

    /**
     * Emit a background-set intent to every registered
     * listener. main.js does the orchestration; the
     * inspector just signals what was clicked.
     * @param {string} id
     */
    _emitSetBackground(id) {
        for (const cb of this._setBackgroundListeners) {
            try { cb({ id }); } catch (err) {
                console.error("GXW: canvas-inspector set-background listener threw.", err);
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
