/**
 * Toolbar.
 *
 * Horizontal strip of canvas-related controls across the top
 * of the canvas pane. Following the top-row elimination, the
 * toolbar is the only chrome strip in the app (above the
 * canvas / editor split) and hosts every persistent control:
 * the Focus Canvas toggle at the far left, then the object-
 * creation tool buttons (sprite, trigger, curve), the Play
 * Selected toggle, the selection-filter toggles (sprite,
 * trigger, curve), the transport cluster (rewind, play,
 * musical position readout, BPM input), and the Audition
 * toggle. Item ordering is fixed by the IN_FLIGHT spec; see
 * that file for the rationale.
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
 * The Canvas W and H fields that used to live in this strip have
 * migrated to the Canvas inspector tab per DESIGN.md Section
 * 13.5; the toolbar's controls are left-aligned (no trailing
 * spacer or MIDI indicator).
 *
 * Subscriptions exposed:
 *   - onChange: active tool name (or null for idle) plus
 *     locked flag, fired whenever the tool state changes.
 *     The canvas uses this to update its cursor and click
 *     behaviour; afterPlacement() is called by the canvas
 *     after a single-shot placement so the toolbar reverts
 *     to idle.
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
        tooltip: "Add Sprite",
        // The sprite's actual on-canvas teardrop shape (in the
        // sprite boundary blue): a circle with two tangent lines —
        // contacts 45 degrees off the heading on each side — meeting
        // at a 90-degree nose ahead, nose pointing up and to the
        // right here (the top and right tangents meet at the apex).
        // Stroke a touch thicker than the other tools so it reads
        // like the sprite on the canvas; no centre dot. The plus mark
        // in the lower-right is the shared create-mode signal.
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<path d="M 11 6 L 17 6 L 17 12 A 6 6 0 1 1 11 6 Z" stroke="#7db8d6" stroke-width="2.5" fill="none"/>` +
            `<path d="M 16.5 20 L 21.5 20 M 19 17.5 L 19 22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
            `</svg>`,
    },
    {
        name: "trigger",
        label: "Add Trigger",
        tooltip: "Add Trigger",
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
        tooltip: "Add Ellipse",
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
    {
        name: "lineSegment",
        label: "Add Line-Segment Curve",
        tooltip: "Click per straight segment / double-click to stop",
        // Open zigzag polyline in CURVE_COLOUR (#7dd68a) — the
        // segmented-line shape distinguishes it from the smooth
        // ellipse/spline curve tools while staying in the green
        // curve family. Same lower-right plus mark as the other
        // create tools (clear of the upper-left zigzag).
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<polyline points="3,15 8,6 13,13 18,5" stroke="#7dd68a" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>` +
            `<path d="M 16.5 20 L 21.5 20 M 19 17.5 L 19 22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
            `</svg>`,
    },
    {
        name: "spline",
        label: "Add Spline Curve",
        tooltip: "Click per spline segment / double-click to stop",
        // Smooth wave in CURVE_COLOUR (#7dd68a) — distinguishes the
        // smooth spline from the angular line-segment tool while
        // staying in the green curve family. Same lower-right plus mark.
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<path d="M 3 16 C 6 6 10 6 12 12 C 14 18 18 8 21 7" stroke="#7dd68a" stroke-width="2" fill="none" stroke-linecap="round"/>` +
            `<path d="M 16.5 20 L 21.5 20 M 19 17.5 L 19 22.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` +
            `</svg>`,
    },
];

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

// Allow-select filter icons. Each shows two overlapping
// glyphs of the relevant kind inside a yellow dotted
// selection-marquee rectangle, so the button reads as
// "selecting this kind of thing". Sprites/triggers use the
// sprite-blue stroke; curves use the curve-green stroke.
const SELECT_FILTER_SPRITE_ICON_SVG =
    `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
    `<rect x="1.5" y="3.5" width="21" height="17" rx="1" fill="none" stroke="#ffd24a" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
    `<path d="M 7 13 L 10 13 L 10 16 A 3 3 0 1 1 7 13 Z" fill="none" stroke="#7db8d6" stroke-width="1.3"/>` +
    `<path d="M 13 9 L 16 9 L 16 12 A 3 3 0 1 1 13 9 Z" fill="none" stroke="#7db8d6" stroke-width="1.3"/>` +
    `</svg>`;

const SELECT_FILTER_TRIGGER_ICON_SVG =
    `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
    `<rect x="1.5" y="3.5" width="21" height="17" rx="1" fill="none" stroke="#ffd24a" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
    `<path d="M 8.5 8.5 L 12 12 L 8.5 15.5 L 5 12 Z" fill="none" stroke="#7db8d6" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M 15 8.5 L 18.5 12 L 15 15.5 L 11.5 12 Z" fill="none" stroke="#7db8d6" stroke-width="1.3" stroke-linejoin="round"/>` +
    `</svg>`;

const SELECT_FILTER_CURVE_ICON_SVG =
    `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
    `<rect x="1.5" y="3.5" width="21" height="17" rx="1" fill="none" stroke="#ffd24a" stroke-width="1.2" stroke-dasharray="2 1.6"/>` +
    `<path d="M 3.5 14 L 6.5 9 L 9.5 14 L 12.5 9" fill="none" stroke="#7dd68a" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M 10 16 L 13 11 L 16 16 L 19 11" fill="none" stroke="#7dd68a" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>` +
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

        // Audition toggle (seed-variation audition workflow).
        // Sits to the right of the transport cluster; clicking it
        // shows/hides the floating audition bar over the canvas
        // (which carries the Vary/Again controls, the beats field,
        // and the seed readout — those moved out of the main
        // toolbar). Emits to _auditionToggleListeners; main.js
        // owns the bar and calls setAuditionActive back so the
        // toggle reflects the bar's visibility.
        /** @type {Array<() => void>} */
        this._auditionToggleListeners = [];
        /** @type {HTMLButtonElement | null} */
        this._auditionToggleButton = null;

        // Selection filter toggles (the allow-select per-kind
        // buttons). Each is pressed/enabled by default, meaning
        // that kind is selectable; releasing one makes selection
        // ignore that kind in click, marquee, and Select All.
        // Session-only; main.js calls resetSelectionFilters on
        // score switch. Emits (kind, enabled) to listeners.
        this._selectFilter = { sprite: true, trigger: true, curve: true };
        /** @type {Map<string, HTMLButtonElement>} */
        this._selectFilterButtons = new Map();
        /** @type {Array<(kind: string, enabled: boolean) => void>} */
        this._selectFilterListeners = [];

        // Custom tooltip. Native `title` tooltips are unreliable in
        // Electron/Chromium — they're dismissed by DOM mutations and
        // renderer activity, and the background mirror timers keep the
        // page busy enough that the native "rest ~1s" condition rarely
        // completes, so they mostly never appear. This JS-driven tooltip
        // uses our own hover timer and is immune to all that. The
        // element lives on <body> so it isn't clipped by the toolbar.
        this._tooltipEl = document.createElement("div");
        this._tooltipEl.className = "toolbar-tooltip";
        document.body.appendChild(this._tooltipEl);
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._tooltipTimer = null;

        this._render();
    }

    /**
     * Wire a custom hover tooltip onto a button: after a short hover
     * the tooltip shows below the button; it hides on leave or press.
     * Replaces the native `title` (which is left unset so there's no
     * competing — and flaky — native tooltip). The text is read live
     * from dataset at show time, so a caller can update it by setting
     * btn.dataset.tooltip.
     * @param {HTMLElement} btn
     * @param {string} text
     */
    _attachTooltip(btn, text) {
        btn.dataset.tooltip = text;
        btn.addEventListener("mouseenter", () => {
            if (this._tooltipTimer !== null) clearTimeout(this._tooltipTimer);
            this._tooltipTimer = setTimeout(() => this._showTooltip(btn), 450);
        });
        btn.addEventListener("mouseleave", () => this._hideTooltip());
        btn.addEventListener("mousedown", () => this._hideTooltip());
    }

    /** @param {HTMLElement} btn */
    _showTooltip(btn) {
        this._tooltipTimer = null;
        const text = btn.dataset.tooltip;
        if (!text) return;
        const el = this._tooltipEl;
        el.textContent = text;
        // offsetWidth is measurable while hidden (visibility, not display).
        const r = btn.getBoundingClientRect();
        const tw = el.offsetWidth;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(r.bottom + 6)}px`;
        el.classList.add("visible");
    }

    _hideTooltip() {
        if (this._tooltipTimer !== null) {
            clearTimeout(this._tooltipTimer);
            this._tooltipTimer = null;
        }
        this._tooltipEl.classList.remove("visible");
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

    /**
     * Subscribe to selection-filter toggle changes. The
     * callback receives (kind, enabled): the object kind
     * ("sprite"|"trigger"|"curve") whose allow-select button
     * was just flipped, and the new enabled flag (true when
     * the kind is now selectable, false when it is now being
     * ignored by selection). main.js wires this to
     * canvas.setKindSelectable so the canvas filter follows
     * the toolbar.
     * @param {(kind: string, enabled: boolean) => void} cb
     */
    onSelectionFilterToggle(cb) {
        this._selectFilterListeners.push(cb);
    }

    /**
     * Emit a selection-filter toggle to all subscribers.
     * @param {string} kind
     * @param {boolean} enabled
     */
    _emitSelectionFilter(kind, enabled) {
        for (const cb of this._selectFilterListeners) {
            try { cb(kind, enabled); } catch (err) {
                console.error("GXW: selection-filter listener threw.", err);
            }
        }
    }

    /**
     * Reset all three selection-filter toggles to enabled
     * (pressed) and refresh their visuals. Does NOT emit —
     * main.js resets the canvas filter separately in
     * switchToBundle. Called on score switch so a new score
     * always starts with every kind selectable.
     */
    resetSelectionFilters() {
        for (const kind of ["sprite", "trigger", "curve"]) {
            this._selectFilter[kind] = true;
            const btn = this._selectFilterButtons.get(kind);
            if (btn) {
                btn.classList.add("select-filter-enabled");
                btn.setAttribute("aria-pressed", "true");
            }
        }
    }

    /**
     * Subscribe to Audition toggle clicks. main.js wires this to
     * show/hide the floating audition bar and call setAuditionActive
     * back with the new visibility.
     * @param {() => void} cb
     */
    onAuditionToggle(cb) {
        this._auditionToggleListeners.push(cb);
    }

    /**
     * Reflect the audition bar's visibility on the toggle button
     * (pressed when the bar is showing). Called by main.js after
     * each toggle and once at startup.
     * @param {boolean} active
     */
    setAuditionActive(active) {
        if (this._auditionToggleButton === null) return;
        this._auditionToggleButton.classList.toggle("toolbar-text-button-active", active);
        this._auditionToggleButton.setAttribute("aria-pressed", active ? "true" : "false");
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
     * Disarm any currently-active tool, dropping the
     * toolbar back to idle. Symmetric with
     * setActive(null, false) but reads as the explicit
     * intent at the call site. Used by aiBatchDialog's
     * Phase 1B commit 4b.2 lock path: when the AI batch
     * dialog appears, any armed or locked tool is dropped
     * to idle so the canvas doesn't carry stale tool state
     * through the locked period — even though the canvas
     * itself is also blocked at the CSS layer, the JS
     * tool-state needs the same reset so the cursor and
     * any pending tool-specific listeners clear.
     */
    disarmAll() {
        this.setActive(null, false);
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
        this._focusCanvasButton.dataset.tooltip = `${label} (\u21e7\u2318F)`;
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
        this._selectFilterButtons.clear();
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

        // Spacer, then Play Selected — sits between the object-
        // creation tools and the selection filters. Flipping it
        // changes what plays, not what's on the canvas.
        this.container.appendChild(this._buildGroupSeparator());
        this.container.appendChild(this._buildPlaySelectedButton());

        // Spacer, then the allow-select filter toggles. Each is
        // pressed (enabled) by default = its kind is selectable;
        // release one to make selection ignore that kind.
        this.container.appendChild(this._buildGroupSeparator());
        this.container.appendChild(this._buildSelectFilterButton(
            "sprite",
            "Allow Selecting Sprites",
            "Allow Selecting Sprites",
            SELECT_FILTER_SPRITE_ICON_SVG,
        ));
        this.container.appendChild(this._buildSelectFilterButton(
            "trigger",
            "Allow Selecting Triggers",
            "Allow Selecting Triggers",
            SELECT_FILTER_TRIGGER_ICON_SVG,
        ));
        this.container.appendChild(this._buildSelectFilterButton(
            "curve",
            "Allow Selecting Curves",
            "Allow Selecting Curves",
            SELECT_FILTER_CURVE_ICON_SVG,
        ));

        // Spacer between the selection filters and the transport.
        this.container.appendChild(this._buildGroupSeparator());

        // Transport cluster (rewind, play, musical-position readout,
        // BPM input). Same element IDs as before so TransportBarView's
        // getElementById lookups continue to find them.
        this.container.appendChild(this._buildTransportCluster());

        // Group separator before the audition toggle.
        this.container.appendChild(this._buildGroupSeparator());

        // Audition toggle: shows/hides the floating audition bar over
        // the canvas (Vary/Again, the beats field, the seed readout).
        this.container.appendChild(this._buildAuditionToggle());

        this._refreshButtons();
    }

    /**
     * Build the Audition toggle: a text button that shows/hides
     * the floating audition bar. Emits to _auditionToggleListeners
     * on click; main.js flips the bar and calls setAuditionActive
     * back so the button reflects the bar's state. A plain text
     * label ("Audition") rather than an icon, for accessibility.
     * @returns {HTMLButtonElement}
     */
    _buildAuditionToggle() {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolbar-text-button";
        btn.setAttribute("aria-label", "Audition");
        btn.setAttribute("aria-pressed", "false");
        this._attachTooltip(btn, "Audition. Show or hide the floating audition bar over the canvas, where you advance the seed (Vary), replay the current seed (Again), and set the audition length in beats.");
        btn.textContent = "Audition";
        btn.addEventListener("click", () => {
            for (const cb of this._auditionToggleListeners) {
                try { cb(); } catch (err) {
                    console.error("GXW: toolbar audition-toggle listener threw.", err);
                }
            }
        });
        this._auditionToggleButton = btn;
        return btn;
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
        this._attachTooltip(btn, def.tooltip);
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
        this._attachTooltip(btn, "Focus Canvas (\u21e7\u2318F)");
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
        this._attachTooltip(btn, "Play only selected objects");
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
     * Build one allow-select filter button for a given object
     * kind. Pressed (enabled, the default) means that kind is
     * selectable; releasing it makes selection ignore the
     * kind in click hit-test, marquee drag-select, and Select
     * All. The button owns its own boolean state in
     * this._selectFilter; clicking flips it, updates the
     * pressed visual (the .select-filter-enabled class +
     * aria-pressed), and emits (kind, enabled) so main.js can
     * push the value into the canvas filter.
     * @param {"sprite"|"trigger"|"curve"} kind
     * @param {string} label
     * @param {string} tooltip
     * @param {string} iconSvg
     * @returns {HTMLButtonElement}
     */
    _buildSelectFilterButton(kind, label, tooltip, iconSvg) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toolbar-tool toolbar-select-filter";
        btn.setAttribute("aria-label", label);
        const enabled = this._selectFilter[kind] !== false;
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
        if (enabled) btn.classList.add("select-filter-enabled");
        btn.innerHTML = iconSvg;
        this._attachTooltip(btn, tooltip);
        btn.addEventListener("click", () => {
            const next = !this._selectFilter[kind];
            this._selectFilter[kind] = next;
            btn.classList.toggle("select-filter-enabled", next);
            btn.setAttribute("aria-pressed", next ? "true" : "false");
            this._emitSelectionFilter(kind, next);
        });
        this._selectFilterButtons.set(kind, btn);
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

        // Time-signature group, to the RIGHT of the BPM field: a
        // numerator dropdown (3 or 4) followed by static "/4". The
        // denominator is always 4 (quarter-note beats); no label.
        // Keeps the id "time-signature-input" so TransportBarView
        // binds it the same way.
        const tsGroup = document.createElement("div");
        tsGroup.className = "field-group";
        tsGroup.id = "time-signature-group";

        const tsSelect = document.createElement("select");
        tsSelect.id = "time-signature-input";
        tsSelect.className = "field-input";
        for (const n of ["3", "4"]) {
            const opt = document.createElement("option");
            opt.value = n;
            opt.textContent = n;
            tsSelect.appendChild(opt);
        }
        tsSelect.value = "4";
        tsGroup.appendChild(tsSelect);

        const tsDenom = document.createElement("span");
        tsDenom.className = "time-signature-denominator";
        tsDenom.textContent = "/4";
        tsGroup.appendChild(tsDenom);

        cluster.appendChild(tsGroup);

        return cluster;
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
