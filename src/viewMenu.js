/**
 * View menu.
 *
 * Populates the View dropdown with zoom and focus-mode actions.
 * Installs the global keyboard shortcuts for those same actions
 * so they work regardless of whether the menu is open.
 *
 * Shortcut intercepts are suppressed while focus is in a text
 * input or the CodeMirror editor so zoom shortcuts don't
 * swallow legitimate text-editor input.
 *
 * Auto Zoom is a checkable menu item with no keyboard shortcut.
 * When on, the canvas continuously fits the playable region
 * inside the pane (see Canvas._applyAutoZoom for the math), and
 * the manual zoom items are greyed out — their action callbacks
 * are still wired to canvas.zoomIn / zoomOut / resetZoom, which
 * internally no-op while Auto Zoom is active, but the menu
 * makes the disabled state visible so users don't wonder why
 * clicks aren't doing anything. The keyboard shortcuts for the
 * same items go through the same Canvas methods, so they
 * inherit the same gating without a separate check here.
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";

/** @typedef {import("./canvas.js").Canvas} Canvas */

/**
 * @typedef {Object} ViewMenuContext
 * @property {Canvas} canvas
 * @property {() => void} toggleFocusCanvas
 * @property {() => void} toggleAutoZoom
 */

/**
 * Install the View dropdown and its keyboard shortcuts.
 * @param {ViewMenuContext} ctx
 */
export function installViewMenu(ctx) {
    const viewItem = findMenuItem("View");
    if (viewItem === null) {
        console.error("GXW: View menu item not found.");
        return;
    }

    const dropdown = buildDropdown([
        {
            label: "Zoom In",
            shortcut: "\u2318+",
            action: () => ctx.canvas.zoomIn(),
            disabled: () => ctx.canvas.getAutoZoom(),
        },
        {
            label: "Zoom Out",
            shortcut: "\u2318\u2212",
            action: () => ctx.canvas.zoomOut(),
            disabled: () => ctx.canvas.getAutoZoom(),
        },
        {
            label: "Reset Zoom",
            shortcut: "\u23300",
            action: () => ctx.canvas.resetZoom(),
            disabled: () => ctx.canvas.getAutoZoom(),
        },
        {
            // Checkable Auto Zoom. No shortcut by design;
            // the user toggles it from the menu when they
            // want to switch the canvas between manual and
            // auto-fit modes, and the choice persists across
            // reloads via the localStorage round-trip in
            // main.js's toggleAutoZoom closure.
            label: "Auto Zoom",
            action: () => ctx.toggleAutoZoom(),
            checked: () => ctx.canvas.getAutoZoom(),
        },
        { separator: true },
        {
            label: "Focus Canvas",
            shortcut: "\u21e7\u2318F",
            action: () => ctx.toggleFocusCanvas(),
        },
    ]);

    document.body.appendChild(dropdown);
    wireDropdown(viewItem, dropdown);

    // Global keyboard shortcuts. These work independently of the
    // dropdown being open, matching how a real menu bar behaves.
    window.addEventListener("keydown", (e) => {
        if (isTypingTarget(e.target)) return;
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;

        // Cmd-Shift-F: Focus Canvas toggle.
        if (e.shiftKey && e.key.toLowerCase() === "f") {
            e.preventDefault();
            ctx.toggleFocusCanvas();
            return;
        }

        // Zoom shortcuts — Cmd-+, Cmd--, Cmd-0. Cmd-+ arrives
        // with key="+" (shift held) or key="=" on keyboards where
        // + requires shift. Accept both. preventDefault fires
        // unconditionally so the browser's built-in page zoom
        // doesn't fight us when Auto Zoom is on and the
        // Canvas's manual zoom methods are no-ops; the user's
        // intent was clearly "zoom the GXW canvas", and quietly
        // letting the browser zoom the whole page instead would
        // be surprising.
        if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            ctx.canvas.zoomIn();
            return;
        }
        if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            ctx.canvas.zoomOut();
            return;
        }
        if (e.key === "0") {
            e.preventDefault();
            ctx.canvas.resetZoom();
            return;
        }
    });
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if (target.closest(".cm-editor") !== null) return true;
    return false;
}
