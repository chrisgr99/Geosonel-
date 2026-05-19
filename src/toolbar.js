/**
 * Toolbar.
 *
 * Horizontal strip of canvas-related controls across the top
 * of the canvas pane. Following the top-row elimination, the
 * toolbar is the only chrome strip in the app (above the
 * canvas / editor split) and hosts every persistent control:
 * the Focus Canvas toggle at the far left, the three object-
 * creation tool buttons (sprite, trigger, curve), the image
 * import button, the Play Selected toggle, the transport
 * cluster (rewind, play, musical position readout, BPM
 * input), the canvas-size W and H fields, and the MIDI
 * indicator at the far right. Item ordering is fixed by
 * the IN_FLIGHT spec; see that file for the rationale.
 *
 * Tool buttons. Each tool has three states: idle, armed
 * (one-shot — single placement, then back to idle), and
 * locked (repeat placements until the user disarms). Single
 * click on a tool button arms it; double-click locks it.
 * The Escape key or clicking the tool button again exits
 * either state. The cluster currently ships three creation
 * tools: Add Sprite (click-to-place), Add Trigger (click-
 * to-place), and Add Curve (drag-to-define an ellipse
 * bounding box, Shift during drag constrains to a circle).
 * Each tool's icon carries a small plus mark at the lower
 * right to signal create mode, mirroring the GeoSonix
 * convention. The cluster is built to grow by extending the
 * TOOL_DEFS array.
 *
 * Focus Canvas, Play Selected, and the transport cluster
 * surface persistent state rather than transient tool modes.
 * The Focus Canvas button reflects body.focus-canvas; main.js
 * calls setFocusCanvasActive whenever the body class changes
 * so the button stays in sync regardless of which entry point
 * (button click, View menu item, Cmd-Shift-F) fired the
 * toggle. The Play Selected button owns its own boolean
 * state and emits onPlaySelectedToggle on every flip. The
 * transport cluster uses the same element IDs as before
 * (rewind-btn, play-btn, musical-position, bpm-input,
 * bpm-group) so TransportBarView's getElementById lookups
 * find them in their new toolbar locations without code
 * changes to that module.
 *
 * The Image Import button surfaces the same file-picker flow
 * as the File menu's Import Image command but right next to
 * where the user is composing — the shortest path from "I
 * want to add a background image" to a native picker. The
 * Canvas W and H fields expose per-scene canvas size
 * (integers in 1..200) as numeric fields editable both by
 * typing and by scroll-wheel scrubbing. Edits propagate
 * through the toolbar's scene-edit callback to main.js's
 * applySceneEdit pipeline, the same path inspector and
 * canvas edits travel. The MIDI indicator at the far right
 * is wired by main.js's wireMidiIndicator helper after the
 * toolbar is constructed; the helper finds the indicator
 * element by id, attaches the MIDISender event handlers, and
 * updates the label and the per-send flash class.
 *
 * Subscriptions exposed:
 *   - onChange: active tool name (or null for idle) plus
 *     locked flag, fired whenever the tool state changes.
 *     The canvas uses this to update its cursor and click
 *     behaviour; afterPlacement() is called by the canvas
 *     after a single-shot placement so the toolbar reverts
 *     to idle.
 *   - onImageImportClick: fires when the user clicks the
 *     Image Import button.
 *   - onSceneEdit: fires when a canvas-size field commits a
 *     change; the edit object carries a kind tag and the
 *     new value, mirroring the shape canvas and inspector
 *     edits use.
 *   - onPlaySelectedToggle: fires when the Play Selected
 *     button is toggled; receives the new active flag.
 *   - onFocusCanvasClick: fires when the Focus Canvas
 *     button is clicked. The button does not own focus-
 *     canvas state; main.js's toggleFocusCanvas closure
 *     toggles document.body.classList and calls back into
 *     setFocusCanvasActive to update the button's visual.
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
// blue as the sprite boundary so the cluster reads as part
// of the same toolbar visual system. The frame shape is
// what makes this distinct from a generic-action icon: the
// user sees a frame and immediately reads "image".
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

// Focus Canvas icon. A small rectangle with a filled left
// segment representing the editor pane; the fill fades out
// (via the .sidebar-toggle-btn.sidebar-collapsed CSS rule)
// when Focus Canvas is active. Same SVG that lived in
// index.html as the top-row sidebar-toggle-btn before the
// top-row elimination; preserved verbatim here so the
// existing .sidebar-toggle-btn / .sidebar-toggle-icon /
// .sidebar-toggle-fill CSS rules continue to apply without
// a rename.
const FOCUS_CANVAS_ICON_SVG =
    `<svg class="sidebar-toggle-icon" viewBox="0 0 20 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<rect x="1" y="2" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    `<rect class="sidebar-toggle-fill" x="1" y="2" width="6" height="12" rx="1.5" fill="currentColor"/>` +
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

        // Focus Canvas button. The toolbar renders the
        // button and emits click events; main.js owns the
        // body class toggle and calls setFocusCanvasActive
        // to keep the button's visual in sync. The button
        // does NOT own its own state — it reflects external
        // state, which is what the body.focus-canvas class
        // represents.
        /** @type {Array<() => void>} */
        this._focusCanvasClickListeners = [];
        /** @type {HTMLButtonElement | null} */
        this._focusCanvasButton = null;

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

    /**
     * Subscribe to Focus Canvas button clicks. main.js wires
     * this to its toggleFocusCanvas closure, which toggles
     * document.body's focus-canvas class, persists the new
     * state to localStorage, and calls setFocusCanvasActive
     * back into the toolbar so the button's visual updates.
     * @param {() => void} cb
     */
    onFocusCanvasClick(cb) {
        this._focusCanvasClickListeners.push(cb);
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
     * Push the current Focus Canvas state onto the button's
     * visuals (icon-fill fade plus aria-label and title
     * text). Called by main.js from its toggleFocusCanvas
     * closure after the body class flips so the button stays
     * in sync regardless of which entry point (button click,
     * View menu item, Cmd-Shift-F) fired the toggle.
     * Idempotent — calling with the current value is a no-op
     * beyond a class assignment.
     * @param {boolean} active
     */
    setFocusCanvasActive(active) {
        if (this._focusCanvasButton === null) return;
        this._focusCanvasButton.classList.toggle(
            "sidebar-collapsed",
            active === true,
        );
        const label = active ? "Exit Focus Canvas" : "Focus Canvas";
        this._focusCanvasButton.setAttribute("aria-label", label);
        this._focusCanvasButton.setAttribute("title", `${label} (\u21e7\u2318F)`);
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
        this._focusCanvasButton = null;

        // Position 1: Focus Canvas toggle at the far left.
        this.container.appendChild(this._buildFocusCanvasButton());

        // Group separator between the focus-canvas toggle
        // and the object-creation tool cluster. Reads as
        // "different kinds of controls" at a glance so the
        // toolbar doesn't feel like one undifferentiated
        // row of buttons.
        this.container.appendChild(this._buildGroupSeparator());

        // Positions 2-4: object-creation tools.
        for (const def of TOOL_DEFS) {
            this.container.appendChild(this._buildToolButton(def));
        }

        // Position 5: Image Import. Sits with the creation
        // tools because adding a background image is the
        // closest sibling activity to placing sprites,
        // triggers, and curves — you're "adding content to
        // the canvas" in all four cases.
        this.container.appendChild(this._buildImageImportButton());

        // Group separator between the creation-and-import
        // cluster and the playback controls.
        this.container.appendChild(this._buildGroupSeparator());

        // Position 6: Play Selected toggle. Sits with the
        // playback-related controls because flipping it
        // changes what plays, not what's on the canvas.
        this.container.appendChild(this._buildPlaySelectedButton());

        // Group separator between the Play Selected toggle
        // and the transport cluster. Play Selected is a
        // "what plays" gate; the transport is "is it playing
        // right now" — different enough activities that the
        // eye benefits from reading them as distinct groups.
        this.container.appendChild(this._buildGroupSeparator());

        // Positions 7-10: transport cluster (rewind, play,
        // musical-position readout, BPM input). Same element
        // IDs as the previous top-row transport-controls
        // section so TransportBarView's getElementById
        // lookups continue to find them without code changes
        // to that module.
        this.container.appendChild(this._buildTransportCluster());

        // Position 11: flex spacer. Pushes the canvas-size
        // controls and MIDI indicator to the right edge of
        // the toolbar.
        const spacer = document.createElement("div");
        spacer.className = "toolbar-spacer";
        this.container.appendChild(spacer);

        // Positions 12-13: Canvas W and H fields.
        this.container.appendChild(this._buildCanvasSizeControls());

        // Position 14: MIDI indicator at the far right.
        // wireMidiIndicator in main.js attaches the
        // MIDISender event handlers to this element after
        // the toolbar is constructed.
        this.container.appendChild(this._buildMidiIndicator());

        this._refreshButtons();
    }

    /**
     * Build a vertical group separator. Used between adjacent
     * button clusters on the toolbar so the eye reads them
     * as distinct groups rather than one continuous row.
     * @returns {HTMLDivElement}
     */
    _buildGroupSeparator() {
        const sep = document.createElement("div");
        sep.className = "toolbar-group-separator";
        return sep;
    }

    /**
     * Build one tool button for the creation cluster. Wires
     * the single-click / double-click toggling behaviour
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
     * Build the Focus Canvas toggle button at the far left
     * of the toolbar. The button does not own focus-canvas
     * state — main.js's toggleFocusCanvas closure owns the
     * body class and persists it; this button just emits
     * onFocusCanvasClick and reflects the current state via
     * the .sidebar-collapsed CSS class set by
     * setFocusCanvasActive.
     * @returns {HTMLButtonElement}
     */
    _buildFocusCanvasButton() {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "sidebar-toggle-btn";
        btn.className = "sidebar-toggle-btn";
        btn.setAttribute("aria-label", "Focus Canvas");
        btn.setAttribute("title", "Focus Canvas (\u21e7\u2318F)");
        btn.innerHTML = FOCUS_CANVAS_ICON_SVG;
        btn.addEventListener("click", () => {
            for (const cb of this._focusCanvasClickListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: focus-canvas listener threw.", err);
                }
            }
        });
        this._focusCanvasButton = btn;
        return btn;
    }

    /**
     * Build the Image Import button. Placed in the creation
     * cluster between the curve tool and the Play Selected
     * toggle. Distinct visually from the tool buttons (no
     * armed/locked states) but shares the same square
     * footprint so the toolbar reads as a row of consistent
     * controls.
     * @returns {HTMLButtonElement}
     */
    _buildImageImportButton() {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolbar-action-button";
        btn.setAttribute("aria-label", "Import Image");
        btn.title = "Import Image. Opens a file picker for PNG, JPEG, or WEBP.";
        btn.innerHTML = IMAGE_IMPORT_ICON_SVG;
        btn.addEventListener("click", () => {
            for (const cb of this._imageImportListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: image-import listener threw.", err);
                }
            }
        });
        return btn;
    }

    /**
     * Build the Play Selected toggle button. Sits between
     * the creation cluster and the transport cluster.
     * Toggle behaviour (boolean on / off) rather than the
     * tool buttons' armed-or-locked state machine: a single
     * click flips the active flag, which the click handler
     * relays through setPlaySelectedActive so visual state
     * and subscribers stay in sync. aria-pressed reflects
     * the boolean state for screen readers and Voice
     * Control.
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
     * Build the transport cluster: rewind button, play
     * button, musical-position readout, and BPM input.
     * Returned as a single container element so the four
     * pieces flow together with a tight inter-element gap.
     * Element IDs preserved from the previous top-row
     * transport-controls section (rewind-btn, play-btn,
     * musical-position, bpm-input, bpm-group) so
     * TransportBarView's getElementById lookups continue to
     * find them without code changes. Click handlers and
     * value commits are wired by TransportBarView, not by
     * the toolbar — the toolbar just creates the DOM.
     * @returns {HTMLDivElement}
     */
    _buildTransportCluster() {
        const cluster = document.createElement("div");
        cluster.className = "toolbar-transport-cluster";
        cluster.style.display = "flex";
        cluster.style.alignItems = "center";
        cluster.style.gap = "8px";
        cluster.style.flex = "0 0 auto";

        // Rewind. Glyph ⏮ (U+23EE).
        const rewindBtn = document.createElement("button");
        rewindBtn.type = "button";
        rewindBtn.className = "transport-btn";
        rewindBtn.id = "rewind-btn";
        rewindBtn.setAttribute("aria-label", "Rewind to start");
        rewindBtn.textContent = "\u23ee";
        cluster.appendChild(rewindBtn);

        // Play. Glyph ▶ (U+25B6); TransportBarView swaps to
        // ⏸ (U+23F8) while playing.
        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "transport-btn";
        playBtn.id = "play-btn";
        playBtn.setAttribute("aria-label", "Play");
        playBtn.textContent = "\u25b6";
        cluster.appendChild(playBtn);

        // Musical position readout (bars.beats.ticks).
        const musicalPosition = document.createElement("div");
        musicalPosition.className = "musical-position";
        musicalPosition.id = "musical-position";
        musicalPosition.textContent = "1.1.000";
        cluster.appendChild(musicalPosition);

        // BPM group: label + numeric input.
        const bpmGroup = document.createElement("div");
        bpmGroup.className = "field-group";
        bpmGroup.id = "bpm-group";

        const bpmLabel = document.createElement("label");
        bpmLabel.className = "field-label";
        bpmLabel.setAttribute("for", "bpm-input");
        bpmLabel.textContent = "BPM";
        bpmGroup.appendChild(bpmLabel);

        const bpmInput = document.createElement("input");
        bpmInput.type = "number";
        bpmInput.id = "bpm-input";
        bpmInput.className = "field-input";
        bpmInput.min = "1";
        bpmInput.max = "1000";
        bpmInput.step = "1";
        bpmInput.value = "120";
        bpmGroup.appendChild(bpmInput);

        cluster.appendChild(bpmGroup);

        return cluster;
    }

    /**
     * Build the canvas-size W and H controls. "Canvas:"
     * label, then W field, then H field, with a small gap
     * between the two fields but no separator character
     * between them — the user reads the two numbers as a
     * width-and-height pair, and the Canvas: label anchors
     * the meaning.
     * @returns {HTMLDivElement}
     */
    _buildCanvasSizeControls() {
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

        return canvasControls;
    }

    /**
     * Build the MIDI indicator element. Lives at the far
     * right of the toolbar; main.js's wireMidiIndicator
     * helper finds it by id and attaches MIDISender event
     * handlers (ready event for the port name, send event
     * for the per-note flash). Placeholder text "MIDI: —"
     * shows the indicator's footprint before init completes.
     * @returns {HTMLDivElement}
     */
    _buildMidiIndicator() {
        const el = document.createElement("div");
        el.className = "midi-indicator";
        el.id = "midi-indicator";
        el.setAttribute("aria-label", "MIDI output status");
        el.textContent = "MIDI: \u2014";
        return el;
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
