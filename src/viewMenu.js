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
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";

/** @typedef {import("./canvas.js").Canvas} Canvas */

/**
 * @typedef {Object} ViewMenuContext
 * @property {Canvas} canvas
 * @property {() => void} toggleFocusCanvas
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
        },
        {
            label: "Zoom Out",
            shortcut: "\u2318\u2212",
            action: () => ctx.canvas.zoomOut(),
        },
        {
            label: "Reset Zoom",
            shortcut: "\u23300",
            action: () => ctx.canvas.resetZoom(),
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

        // Zoom shortcuts \u2014 Cmd-+, Cmd--, Cmd-0. Cmd-+ arrives
        // with key="+" (shift held) or key="=" on keyboards where
        // + requires shift. Accept both.
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
