/**
 * Toolbar.
 *
 * Horizontal strip of canvas-related controls across the top
 * of the canvas pane. Two clusters: object-creation tools on
 * the left, and a right-side cluster with an image-import
 * button plus the canvas size (W and H) numeric fields.
 *
 * Left cluster (tool buttons). Each tool has three states:
 * idle, armed (one-shot — single placement, then back to
 * idle), and locked (repeat placements until the user
 * disarms). The user enters armed state with a single click
 * on a tool button and locked state with a double-click. The
 * Escape key or clicking the tool button again exits either
 * state. The toolbar ships three creation tools: Add Sprite
 * (click-to-place), Add Trigger (click-to-place), and Add
 * Curve (drag-to-define an ellipse bounding box, Shift
 * during drag constrains to a circle). Each tool's icon
 * carries a small plus mark at the lower right to signal
 * create mode, mirroring the GeoSonix toolbar convention.
 * The cluster is built to grow by extending the TOOL_DEFS
 * array.
 *
 * Right cluster. The image-import button surfaces the same
 * file-picker flow as the File menu's Import Image command
 * but right next to where the user is composing — it's the
 * shortest path from "I want to add a background image" to a
 * native picker. The Canvas controls expose the per-scene
 * canvas size (W and H, integers in 1..200) as numeric
 * fields editable both by typing and by scroll-wheel
 * scrubbing. Edits propagate through the toolbar's
 * scene-edit callback to main.js's applySceneEdit pipeline,
 * the same path inspector and canvas edits travel.
 *
 * The toolbar communicates outward via three callbacks:
 *   - onChange fires whenever the active tool or its lock
 *     state changes; the Canvas uses this to update its
 *     cursor and click behaviour, and afterPlacement() is
 *     called by the canvas to put the toolbar back to idle
 *     after a single-shot placement.
 *   - onImageImportClick fires when the user clicks the
 *     image-import button.
 *   - onSceneEdit fires when a canvas-size field commits a
 *     change; the edit object carries a kind tag and the
 *     new value, mirroring the shape canvas and inspector
 *     edits use.
 */

// @ts-check

/**
 * @typedef {Object} ToolDef
 * @property {string} name              Internal name (e.g. "sprite").
 * @property {string} label             Visible label / aria-label.
 * @property {string} tooltip           Hover tooltip text.
 * @property {string} svg               Inline SVG markup for the icon.
 */

/** @type {ToolDef[]} */
const TOOL_DEFS = [
    {
        name: "sprite",
        label: "Add Sprite",
        tooltip: "Add Sprite. Click to place one. Double-click to add multiple. Esc to exit.",
        // Hollow blue circle (the sprite's on-canvas boundary
        // colour) with a filled centre dot in currentColor so
        // the dot shifts tone with button state (idle / hover
        // / armed / locked). A small plus mark in currentColor
        // sits at the lower right corner as the create-mode
        // signal shared with the trigger and curve tools.
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<circle cx="12" cy="12" r="9" stroke="#7db8d6" stroke-width="2" fill="none"/>` +
            `<circle cx="12" cy="12" r="2.5" fill="currentColor"/>` +
            `<path d="M 16.5 20 L 21.5 20 M 19 17.5 L 19 22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
            `</svg>`,
    },
    {
        name: "trigger",
        label: "Add Trigger",
        tooltip: "Add Trigger. Click to place one. Double-click to add multiple. Esc to exit.",
        // Hollow blue diamond matching the trigger's on-canvas
        // shape and boundary colour, with the same lower-right
        // plus mark as the sprite tool. Diamond vertices at
        // (12, 3), (21, 12), (12, 21), (3, 12) keep the icon
        // visually balanced against the sprite tool's circle
        // at comparable size, so the two read as siblings in
        // the create cluster.
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<path d="M 12 3 L 21 12 L 12 21 L 3 12 Z" stroke="#7db8d6" stroke-width="2" fill="none" stroke-linejoin="round"/>` +
            `<path d="M 16.5 20 L 21.5 20 M 19 17.5 L 19 22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
            `</svg>`,
    },
    {
        name: "curve",
        label: "Add Curve",
        tooltip: "Add Curve. Drag to define an ellipse; hold Shift for a circle. Double-click the tool to add multiple. Esc to exit.",
        // Hollow green ellipse picking up CURVE_COLOUR
        // (#7dd68a) from canvas.js so the icon visually
        // identifies the curve tool against the blue sprite
        // and trigger tools. Slightly wider than tall (rx=9,
        // ry=6) so the shape reads unambiguously as an
        // ellipse rather than a circle. Same lower-right plus
        // mark as the other create tools.
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<ellipse cx="12" cy="12" rx="9" ry="6" stroke="#7dd68a" stroke-width="2" fill="none"/>` +
            `<path d="M 16.5 20 L 21.5 20 M 19 17.5 L 19 22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
            `</svg>`,
    },
];

// Image-import icon. A picture-frame outline with a small
// sun (top-left) and a mountain-range silhouette (bottom)
// — the universal "image" convention. Stroked in the same
// blue as the sprite boundary so the right cluster reads
// as part of the same toolbar visual system. The frame
// shape is what makes this distinct from a generic-action
// icon: the user sees a frame and immediately reads
// "image".
const IMAGE_IMPORT_ICON_SVG =
    `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
    `<rect x="3" y="4" width="18" height="16" rx="1.5" stroke="#7db8d6" stroke-width="2" fill="none"/>` +
    `<circle cx="8" cy="9" r="1.5" fill="#7db8d6"/>` +
    `<path d="M4 18 L9 12 L13 15 L17 10 L20 14 L20 19 L4 19 Z" stroke="#7db8d6" stroke-width="1.5" fill="none" stroke-linejoin="round"/>` +
    `</svg>`;

// Play Selected icon. A small filled coral disc on the left
// (the "sound source") with three concentric arcs to its
// right in warm olive (the "radiating waves"), evoking the
// classic broadcasting / speaker-emitting-sound iconography
// from GXSTR's toolbar. The dot and arcs use explicit
// colours rather than currentColor so the icon retains its
// identifying palette regardless of button state (idle,
// hover, active); the surrounding button frame is what
// changes with state. Sized to match the other toolbar
// icons at viewBox 24x24 / rendered 28x28.
const PLAY_SELECTED_ICON_SVG =
    `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
    `<circle cx="6" cy="12" r="2.5" fill="#d66a55"/>` +
    `<path d="M 10 8.5 A 3.5 3.5 0 0 1 10 15.5" stroke="#c4a85a" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<path d="M 13 6 A 6 6 0 0 1 13 18" stroke="#c4a85a" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<path d="M 16 3.5 A 8.5 8.5 0 0 1 16 20.5" stroke="#c4a85a" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `</svg>`;

const CANVAS_DIMENSION_MIN = 1;
const CANVAS_DIMENSION_MAX = 200;
const CANVAS_DIMENSION_DEFAULT_W = 32;
const CANVAS_DIMENSION_DEFAULT_H = 24;

export class Toolbar {
    /**
     * @param {HTMLElement} container  Element to mount the toolbar in.
     */
    constructor(container) {
        this.container = container;
        /** @type {string | null} */
        this._activeTool = null;
        this._locked = false;
        /** @type {Array<(tool: string | null, locked: boolean) => void>} */
        this._listeners = [];
        /** @type {Map<string, HTMLButtonElement>} */
        this._buttons = new Map();

        // Canvas-size state. Mirrors the scene's canvasW and
        // canvasH whenever main.js calls setCanvasSize after
        // a scene reload; defaults match the legacy hardcoded
        // image region so a freshly-mounted toolbar with no
        // scene yet displays the same numbers older versions
        // implicitly used. The field references below are
        // populated by _render and updated in place by
        // setCanvasSize so the user's mid-edit (a focused
        // field) isn't disturbed by an unrelated scene
        // reload.
        this._canvasW = CANVAS_DIMENSION_DEFAULT_W;
        this._canvasH = CANVAS_DIMENSION_DEFAULT_H;
        /** @type {HTMLDivElement | null} */
        this._canvasWField = null;
        /** @type {HTMLDivElement | null} */
        this._canvasHField = null;

        /** @type {Array<() => void>} */
        this._imageImportListeners = [];
        /** @type {Array<(edit: any) => void>} */
        this._sceneEditListeners = [];

        // Play Selected toggle state. Independent of the
        // tool-button armed/locked state machine: this is a
        // boolean on/off that gates pattern firing in the
        // engine to currently-selected canvas objects only.
        // _playSelectedListeners receives the new active
        // flag on every toggle; main.js subscribes and pushes
        // the value into firingEngine.setPlaySelectedMode.
        // _playSelectedButton is the rendered button element,
        // captured at render time so setPlaySelectedActive
        // can update its visual state without a full re-
        // render of the toolbar.
        this._playSelectedActive = false;
        /** @type {Array<(active: boolean) => void>} */
        this._playSelectedListeners = [];
        /** @type {HTMLButtonElement | null} */
        this._playSelectedButton = null;

        this._render();
    }

    /**
     * Subscribe to tool-state changes. The callback receives
     * the new active tool name (or null for idle) and a
     * locked flag. Returns nothing; subscriptions live for
     * the toolbar's lifetime.
     * @param {(tool: string | null, locked: boolean) => void} cb
     */
    onChange(cb) {
        this._listeners.push(cb);
    }

    /**
     * Subscribe to image-import button clicks. main.js wires
     * this to imageImporter.importViaFilePicker() so the
     * button surfaces the native file picker without the
     * toolbar having to depend on the importer module.
     * @param {() => void} cb
     */
    onImageImportClick(cb) {
        this._imageImportListeners.push(cb);
    }

    /**
     * Subscribe to scene-edit emissions from the toolbar's
     * canvas-size fields. The callback receives an edit
     * object shaped like the inspector's edits — currently
     * { kind: "setCanvasW" | "setCanvasH", value: number }.
     * main.js routes these through applySceneEdit so they
     * share the dirty-state, auto-save, and re-run mechanics
     * with inspector and canvas edits.
     * @param {(edit: any) => void} cb
     */
    onSceneEdit(cb) {
        this._sceneEditListeners.push(cb);
    }

    /**
     * Subscribe to Play Selected toggle changes. The
     * callback receives the new active flag (true when the
     * toggle just turned on, false when it just turned off).
     * main.js wires this to firingEngine.setPlaySelectedMode
     * so the engine's firing gate reflects the toolbar
     * state. The current active flag is also pushed in the
     * canvas selection-change handler via
     * firingEngine.setPlaySelectedIds, so flipping the
     * toggle on always takes effect with the current
     * selection without an extra setup call.
     * @param {(active: boolean) => void} cb
     */
    onPlaySelectedToggle(cb) {
        this._playSelectedListeners.push(cb);
    }

    /** @returns {{tool: string | null, locked: boolean}} */
    getState() {
        return { tool: this._activeTool, locked: this._locked };
    }

    /**
     * Programmatically set the active tool and lock state.
     * Used by external callers (Esc key handler, etc.) and
     * internally for state transitions.
     * @param {string | null} tool
     * @param {boolean} locked
     */
    setActive(tool, locked) {
        if (this._activeTool === tool && this._locked === locked) return;
        this._activeTool = tool;
        this._locked = locked;
        this._refreshButtons();
        for (const cb of this._listeners) {
            try { cb(tool, locked); } catch (err) {
                console.error("GXW: toolbar listener threw.", err);
            }
        }
    }

    /**
     * Programmatically set the Play Selected toggle's active
     * flag. Updates the button's visual state (active class
     * on / off) and emits to subscribers iff the flag
     * actually changed. Used internally by the button's
     * click handler; external callers can also use it to
     * force the toggle into a particular state (e.g. on
     * scene reload where the previous toggle state should
     * persist).
     * @param {boolean} active
     */
    setPlaySelectedActive(active) {
        const next = active === true;
        if (this._playSelectedActive === next) return;
        this._playSelectedActive = next;
        if (this._playSelectedButton !== null) {
            this._playSelectedButton.classList.toggle(
                "toolbar-toggle-button-active",
                next,
            );
            this._playSelectedButton.setAttribute(
                "aria-pressed",
                next ? "true" : "false",
            );
        }
        for (const cb of this._playSelectedListeners) {
            try { cb(next); } catch (err) {
                console.error("GXW: play-selected listener threw.", err);
            }
        }
    }

    /**
     * Update the displayed canvas-size values. Called by
     * main.js after each scene reload so the fields track
     * whatever scene.json declares (or the migration default
     * of 32 × 24 for scenes that predate the canvas-size
     * feature). Doesn't touch a focused field — if the user
     * is mid-edit on W or H, an unrelated scene reload
     * shouldn't overwrite their typed value before they get
     * a chance to commit. The internal mirror values are
     * updated unconditionally so the diff check at commit
     * time still reflects the latest scene state.
     * @param {number} w
     * @param {number} h
     */
    setCanvasSize(w, h) {
        this._canvasW = w;
        this._canvasH = h;
        if (this._canvasWField !== null && document.activeElement !== this._canvasWField) {
            this._canvasWField.textContent = String(w);
        }
        if (this._canvasHField !== null && document.activeElement !== this._canvasHField) {
            this._canvasHField.textContent = String(h);
        }
    }

    /**
     * Called by the consumer (canvas) after a placement
     * happens while the toolbar was armed. If the tool was
     * armed (not locked), revert to idle. If it was locked,
     * stay armed.
     */
    afterPlacement() {
        if (this._activeTool !== null && !this._locked) {
            this.setActive(null, false);
        }
    }

    // --- Internals ---

    _render() {
        this.container.innerHTML = "";
        this._buttons.clear();
        this._canvasWField = null;
        this._canvasHField = null;
        this._playSelectedButton = null;

        // Left cluster: object-creation tools.
        for (const def of TOOL_DEFS) {
            this.container.appendChild(this._buildToolButton(def));
        }

        // Group separator. A fixed-width empty span between
        // the object-creation tools and the Play Selected
        // toggle so the two read as distinct groups without
        // a heavy visible divider. Sized to leave a clear
        // gap that the eye registers as "these are separate
        // controls" without taking up so much room that the
        // toolbar feels sparse on narrow windows.
        const groupSep = document.createElement("div");
        groupSep.className = "toolbar-group-separator";
        this.container.appendChild(groupSep);

        // Play Selected toggle. Sits with the playback-
        // related controls on the left rather than with the
        // canvas-creation tools, so the user reads it as a
        // "what plays" control rather than a "what gets
        // added to the canvas" control. Visual state and
        // click behaviour are owned by _buildPlaySelectedButton.
        this.container.appendChild(this._buildPlaySelectedButton());

        // Spacer pushes the right cluster to the right edge of
        // the toolbar. Implemented as a flex-grow filler in
        // the CSS; the element itself just has to exist
        // between the two clusters.
        const spacer = document.createElement("div");
        spacer.className = "toolbar-spacer";
        this.container.appendChild(spacer);

        // Right cluster: image import button + canvas size.
        this.container.appendChild(this._buildRightCluster());

        this._refreshButtons();
    }

    /**
     * Build one tool button for the left cluster. Wires the
     * single-click / double-click toggling behaviour
     * (single-click arms or disarms; double-click locks or
     * disarms).
     * @param {ToolDef} def
     */
    _buildToolButton(def) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolbar-tool";
        btn.setAttribute("aria-label", def.label);
        btn.title = def.tooltip;
        btn.innerHTML = def.svg;

        // Single click: arm (or disarm if already armed).
        // Double click: lock. The browser fires both click
        // and dblclick for a double-click, so we use a
        // small timeout to disambiguate: a click is held
        // pending for a short window, and if a dblclick
        // arrives it cancels the click and locks instead.
        /** @type {ReturnType<typeof setTimeout> | null} */
        let pendingClick = null;

        btn.addEventListener("click", () => {
            if (pendingClick !== null) clearTimeout(pendingClick);
            pendingClick = setTimeout(() => {
                pendingClick = null;
                // If this tool is currently active in any
                // state — armed (one-shot) or locked
                // (repeating) — a click on its button
                // disarms it. Without this, single-clicking
                // a locked tool would leave it armed for
                // one more placement, surprising the user
                // who expected the click to release it.
                if (this._activeTool === def.name) {
                    this.setActive(null, false);
                } else {
                    this.setActive(def.name, false);
                }
            }, 220);
        });

        btn.addEventListener("dblclick", () => {
            if (pendingClick !== null) {
                clearTimeout(pendingClick);
                pendingClick = null;
            }
            // Toggle lock
            if (this._activeTool === def.name && this._locked) {
                this.setActive(null, false);
            } else {
                this.setActive(def.name, true);
            }
        });

        this._buttons.set(def.name, btn);
        return btn;
    }

    /**
     * Build the Play Selected toggle button. A standalone
     * button placed between the object-creation tools and
     * the flex spacer, separated from the tools by a
     * .toolbar-group-separator so the eye reads them as
     * distinct groups. Toggle behaviour (boolean on / off)
     * rather than the tool buttons' armed-or-locked state
     * machine: a single click flips the active flag, which
     * the click handler relays through setPlaySelectedActive
     * so visual state and subscribers stay in sync.
     * aria-pressed reflects the boolean state for screen
     * readers and Voice Control.
     * @returns {HTMLButtonElement}
     */
    _buildPlaySelectedButton() {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolbar-toggle-button";
        btn.setAttribute("aria-label", "Play Selected");
        btn.setAttribute("aria-pressed", "false");
        btn.title = "Play Selected. When on, only currently-selected objects fire patterns. Click to toggle.";
        btn.innerHTML = PLAY_SELECTED_ICON_SVG;
        btn.addEventListener("click", () => {
            this.setPlaySelectedActive(!this._playSelectedActive);
        });
        this._playSelectedButton = btn;
        if (this._playSelectedActive) {
            btn.classList.add("toolbar-toggle-button-active");
            btn.setAttribute("aria-pressed", "true");
        }
        return btn;
    }

    /**
     * Build the right-side cluster: image-import button
     * followed by the Canvas: W H controls. Returned as a
     * single container element so the caller can append it
     * to the toolbar in one step and the CSS gap between the
     * two sub-elements stays scoped to this cluster.
     * @returns {HTMLDivElement}
     */
    _buildRightCluster() {
        const cluster = document.createElement("div");
        cluster.className = "toolbar-right-cluster";

        // Image-import action button. Distinct visually from
        // the tool buttons (no armed/locked states) but
        // shares the same square footprint so the toolbar
        // reads as a row of consistent controls.
        const imgBtn = document.createElement("button");
        imgBtn.type = "button";
        imgBtn.className = "toolbar-action-button";
        imgBtn.setAttribute("aria-label", "Import Image");
        imgBtn.title = "Import Image. Opens a file picker for PNG, JPEG, or WEBP.";
        imgBtn.innerHTML = IMAGE_IMPORT_ICON_SVG;
        imgBtn.addEventListener("click", () => {
            for (const cb of this._imageImportListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: image-import listener threw.", err);
                }
            }
        });
        cluster.appendChild(imgBtn);

        // Canvas size controls. Layout: "Canvas:" label,
        // then W field, then H field, with a small gap
        // between the two fields but no separator character
        // between them — the user reads the two numbers as
        // a width-and-height pair, and the Canvas: label
        // anchors the meaning.
        const canvasControls = document.createElement("div");
        canvasControls.className = "toolbar-canvas-controls";

        const label = document.createElement("span");
        label.className = "toolbar-canvas-label";
        label.textContent = "Canvas:";
        canvasControls.appendChild(label);

        this._canvasWField = this._buildCanvasField("w");
        canvasControls.appendChild(this._canvasWField);
        this._canvasHField = this._buildCanvasField("h");
        canvasControls.appendChild(this._canvasHField);

        cluster.appendChild(canvasControls);

        return cluster;
    }

    /**
     * Build one canvas-dimension numeric field. Editable by
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
        field.setAttribute("aria-label", axis === "w" ? "Canvas width" : "Canvas height");
        field.title = axis === "w"
            ? "Canvas width in canvas units. Scroll to scrub, type to set, Enter to commit."
            : "Canvas height in canvas units. Scroll to scrub, type to set, Enter to commit.";
        field.textContent = String(axis === "w" ? this._canvasW : this._canvasH);

        // Scroll-wheel scrubbing. 1.0-unit increments are
        // coarser than the inspector's 0.3 (canvas size has
        // a much wider range and integer-only values; small
        // fractional steps would feel sluggish and would
        // need rounding anyway). Wheel events on a field
        // that currently has keyboard focus pass through to
        // the browser so the user's text-cursor scrolling
        // works as expected; on an unfocused field, wheel
        // scrubs the value and emits an edit per notch.
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
                    // Silently revert: an abandoned bad value
                    // shouldn't carry forward.
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
            // Clear an error squiggle on any other keystroke
            // so the user sees their corrections in step
            // with their typing.
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
     * scene-edit listener. The edit shape mirrors inspector
     * edits: { kind, value }. main.js dispatches on kind to
     * the matching sceneEditor mutator.
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
                console.error("GXW: toolbar scene-edit listener threw.", err);
            }
        }
    }

    _refreshButtons() {
        for (const [name, btn] of this._buttons) {
            btn.classList.remove("toolbar-tool-armed", "toolbar-tool-locked");
            if (this._activeTool === name) {
                if (this._locked) {
                    btn.classList.add("toolbar-tool-locked");
                } else {
                    btn.classList.add("toolbar-tool-armed");
                }
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
