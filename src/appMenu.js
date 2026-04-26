/**
 * GXW (app) menu.
 *
 * Sits as the leftmost top-level menu, following the macOS
 * convention where the leftmost menu carries the app's name
 * and holds About and Preferences. Holds:
 *
 *   - About GXW\u2026     opens the About dialog
 *   - Settings\u2026       opens the Settings dialog (\u2318,)
 *
 * The keyboard shortcut for Settings (Cmd-Comma) is installed
 * as a global key listener so it works regardless of menu
 * focus, matching how a real macOS menu bar behaves.
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";
import { openAboutDialog } from "./aboutDialog.js";
import { openSettingsDialog } from "./settingsDialog.js";
import { APP_NAME } from "./version.js";

/**
 * @typedef {Object} AppMenuContext
 * @property {import("./diskMirror.js").DiskMirror} diskMirror
 * @property {import("./messages.js").MessageArea} messages
 */

/**
 * @param {AppMenuContext} ctx
 */
export function installAppMenu(ctx) {
    const appItem = findMenuItem(APP_NAME);
    if (appItem === null) {
        console.error(`GXW: ${APP_NAME} menu item not found.`);
        return;
    }

    const settingsCtx = { diskMirror: ctx.diskMirror, messages: ctx.messages };

    const dropdown = buildDropdown([
        {
            label: `About ${APP_NAME}\u2026`,
            action: () => openAboutDialog(),
        },
        { separator: true },
        {
            label: "Settings\u2026",
            shortcut: "\u2318,",
            action: () => openSettingsDialog(settingsCtx),
        },
    ]);

    document.body.appendChild(dropdown);
    wireDropdown(appItem, dropdown);

    // Global Cmd-Comma. Suppressed while focus is in a text
    // input or the CodeMirror editor so it doesn't intercept
    // legitimate punctuation typing.
    window.addEventListener("keydown", (e) => {
        if (isTypingTarget(e.target)) return;
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        if (e.key === ",") {
            e.preventDefault();
            openSettingsDialog(settingsCtx);
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
