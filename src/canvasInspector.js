/**
 * Canvas inspector module.
 *
 * Renders the Canvas inspector tab — the right-pane
 * sibling of the Properties inspector that exposes scene-
 * level canvas state regardless of canvas selection. Per
 * DESIGN.md Section 13.5 the tab is selection-independent:
 * it shows the background image controls, the canvas
 * dimensions, the image-transformation sliders (later
 * stages), and the recent-image gallery (later stages).
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
 * Wiring contract. setCanvasSize(w, h) is called by
 * main.js after every scene reload so the fields track
 * the scene's current canvasW / canvasH values without
 * disturbing a focused field. onSceneEdit(cb) lets
 * main.js subscribe to W/H commits as { kind: "setCanvasW"
 * | "setCanvasH", value: number } edits — the same shape
 * the toolbar's onSceneEdit used to emit — so main.js's
 * applySceneEdit dispatch table doesn't need to change.
 */

// @ts-check

const CANVAS_DIMENSION_MIN = 1;
const CANVAS_DIMENSION_MAX = 200;
const CANVAS_DIMENSION_DEFAULT_W = 32;
const CANVAS_DIMENSION_DEFAULT_H = 24;

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

        this._render();
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

    // --- Internals ---

    _render() {
        this.container.innerHTML = "";
        this._canvasWField = null;
        this._canvasHField = null;

        const panel = document.createElement("div");
        panel.className = "canvas-insp-panel";

        // Top row: Load Image, Remove Image, W field, H field.
        // The two buttons are disabled placeholders in Stage 1;
        // Stage 4 wires them to the file picker and the
        // background-clear path respectively.
        const topRow = document.createElement("div");
        topRow.className = "canvas-insp-top-row";

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "canvas-insp-button";
        loadBtn.textContent = "Load Image";
        loadBtn.disabled = true;
        loadBtn.title = "Load Image (coming in a later stage)";
        topRow.appendChild(loadBtn);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "canvas-insp-button";
        removeBtn.textContent = "Remove Image";
        removeBtn.disabled = true;
        removeBtn.title = "Remove Image (coming in a later stage)";
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
