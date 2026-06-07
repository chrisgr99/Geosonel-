/**
 * Run menu.
 *
 * Currently contains a single command, Run Scene, which
 * executes the current sketch's setup() against a fresh Scene
 * and hands the result to the canvas. Cmd-Enter is the
 * keyboard shortcut.
 *
 * Later milestones will add Run Selection for live editing
 * during playback, plus Start / Stop / Restart for transport
 * control.
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";

/**
 * @typedef {Object} RunMenuContext
 * @property {() => void} runScene
 * @property {() => void} [runSetup]  Run the Script tab's SETUP section
 *   (construction code) against the current scene, then reload. Optional so
 *   older callers that pass only runScene still work.
 */

/**
 * @param {RunMenuContext} ctx
 */
export function installRunMenu(ctx) {
    const runItem = findMenuItem("Run");
    if (runItem === null) {
        console.error("GXW: Run menu item not found.");
        return;
    }

    /** @type {Array<{label: string, shortcut?: string, action: () => void}>} */
    const items = [
        {
            label: "Run Scene",
            shortcut: "\u2318\u23CE",
            action: () => ctx.runScene(),
        },
    ];
    if (typeof ctx.runSetup === "function") {
        // Run Setup executes the SETUP construction code, then reloads \u2014 a
        // superset of Run Scene when setup() builds the scene. Cmd-Shift-Enter.
        items.push({
            label: "Run Setup",
            shortcut: "\u2318\u21E7\u23CE",
            action: () => ctx.runSetup(),
        });
    }

    const dropdown = buildDropdown(items);

    document.body.appendChild(dropdown);
    wireDropdown(runItem, dropdown);

    // Global keyboard shortcuts. Cmd-Enter runs the scene; Cmd-Shift-Enter runs
    // setup. Both work while focus is in the CodeMirror editor, the primary
    // expected location.
    window.addEventListener("keydown", (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey && typeof ctx.runSetup === "function") {
                ctx.runSetup();
            } else {
                ctx.runScene();
            }
        }
    });
}
