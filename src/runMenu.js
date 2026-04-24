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

    const dropdown = buildDropdown([
        {
            label: "Run Scene",
            shortcut: "\u2318\u23CE",
            action: () => ctx.runScene(),
        },
    ]);

    document.body.appendChild(dropdown);
    wireDropdown(runItem, dropdown);

    // Global keyboard shortcut: Cmd-Enter runs the scene. This
    // works even while focus is in the CodeMirror editor, which
    // is the primary expected location.
    window.addEventListener("keydown", (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key === "Enter") {
            e.preventDefault();
            ctx.runScene();
        }
    });
}
