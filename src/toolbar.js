/**
 * Toolbar.
 *
 * Horizontal strip of object-creation tools across the top of
 * the canvas pane. Each tool has three states: idle, armed
 * (one-shot — single placement, then back to idle), and locked
 * (repeat placements until the user disarms). The user enters
 * armed state with a single click on a tool button and locked
 * state with a double-click. The Escape key or clicking the
 * tool button again exits either state.
 *
 * Phase 1 ships with a single tool: Add Sprite. The toolbar is
 * built to grow — add Trigger, then the curve-shape tools, by
 * extending the TOOL_DEFS array.
 *
 * The toolbar communicates outward via a single onChange
 * callback that fires whenever the active tool or its lock
 * state changes. A consumer (the Canvas) uses this to update
 * the cursor and the click behaviour. After the canvas places
 * an object on a single click while the tool was armed (not
 * locked), it calls afterPlacement() to put the toolbar back
 * to idle.
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
        // The outline circle is stroked in the same blue used
        // for sprite boundaries on the canvas (#7db8d6 from
        // canvas.js's OBJECT_BOUNDARY_COLOUR), so the icon
        // visually identifies this as the Add Sprite tool. The
        // centre dot follows currentColor so it shifts tone
        // with button state (idle/hover/armed/locked). Sized
        // to fill most of the 32×32 button with a small
        // breathing margin.
        svg:
            `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">` +
            `<circle cx="12" cy="12" r="10" stroke="#7db8d6" stroke-width="2" fill="none"/>` +
            `<circle cx="12" cy="12" r="3" fill="currentColor"/>` +
            `</svg>`,
    },
];

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
        for (const def of TOOL_DEFS) {
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
            this.container.appendChild(btn);
        }
        this._refreshButtons();
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
