/**
 * Native menu action dispatcher (Stage 5 commit 5a).
 *
 * The Electron build's native macOS menu bar (built in
 * electron-menu.js in the main process) sends menu clicks
 * to the renderer as gxw:menu-action IPC events. This
 * module receives those events through the preload-exposed
 * window.gxwMenu.onAction listener and dispatches each
 * action name to the same handler function the in-page
 * menu uses today, so both menu surfaces stay in sync
 * during the migration window.
 *
 * State that drives the native menu's disabled / checked
 * flags (bundle dirty, bundle isUntitled, autoZoom) also
 * flows through here — pushMenuState packages a partial
 * state patch and calls window.gxwMenu.pushState, which
 * triggers a menu rebuild in the main process. Callers
 * subscribe to the relevant events (bundle dirty changes,
 * score switches, autoZoom toggles) and call pushMenuState
 * with the new value.
 *
 * The in-page menu's keyboard listeners still own the
 * shortcuts during sub-commit 5a — the native menu items
 * are click-only here. Sub-commit 5c adds accelerators to
 * the native menu and retires the in-page menu's listeners.
 */

// @ts-check

import {
    actionNewScore,
    actionOpenScore,
    actionDuplicateScore,
    actionSaveAs,
    actionRevert,
    actionReloadFromDisk,
    actionRenameScore,
    actionDeleteScore,
} from "./scoreActions.js";
import { openAboutDialog } from "./aboutDialog.js";
import { openSettingsDialog } from "./settingsDialog.js";

/** @typedef {import("./scoreActions.js").ScoreSession} ScoreSession */
/** @typedef {import("./messages.js").MessageArea} MessageArea */
/** @typedef {import("./editor.js").TabbedEditor} TabbedEditor */
/** @typedef {import("./imageImporter.js").ImageImporter} ImageImporter */
/** @typedef {import("./canvas.js").Canvas} Canvas */

/**
 * @typedef {Object} MenuActionsContext
 * @property {ScoreSession} session
 * @property {MessageArea} messages
 * @property {TabbedEditor} editor
 * @property {ImageImporter} imageImporter
 * @property {Canvas} canvas
 * @property {import("./diskMirror.js").DiskMirror} diskMirror
 * @property {() => void} performUndo
 * @property {() => void} performRedo
 * @property {() => void} performDuplicate
 * @property {() => void} runScene
 * @property {() => void} toggleFocusCanvas
 * @property {() => void} toggleAutoZoom
 */

/**
 * @typedef {Object} MenuState
 * @property {boolean} [dirty]
 * @property {boolean} [isUntitled]
 * @property {boolean} [autoZoom]
 */

/**
 * Cached reference to the preload-exposed window.gxwMenu
 * bridge. Captured at install time so calls don't re-look
 * it up on every action. null when running under the web
 * build (no Electron preload).
 * @type {{onAction: (cb: (action: string) => void) => () => void, pushState: (state: MenuState) => Promise<void>} | null}
 */
let gxwMenu = null;

/**
 * Install the menu-action listener and capture the gxwMenu
 * reference. Idempotent; the web build (no window.gxwMenu)
 * falls through silently. Returns true when the native menu
 * bridge is available (Electron build), false otherwise;
 * callers can use the return value to skip pushMenuState
 * calls that would otherwise be no-ops.
 *
 * @param {MenuActionsContext} ctx
 * @returns {boolean}
 */
export function installMenuActions(ctx) {
    const w = /** @type {any} */ (window);
    if (w.gxwMenu === undefined || w.gxwMenu === null) {
        // Web build: no native menu bridge. The in-page menu
        // is the only menu surface.
        return false;
    }
    gxwMenu = w.gxwMenu;

    const actionCtx = {
        session: ctx.session,
        messages: ctx.messages,
        editor: ctx.editor,
    };

    gxwMenu.onAction((action) => {
        switch (action) {
            // --- File ---
            case "save":
                // Untitled bundles can't save in place; route
                // through Save As so the user gets the Save
                // panel. Matches the Cmd-S handler in main.js
                // for consistency between the keyboard and
                // menu surfaces.
                if (ctx.session.bundle.path === null) {
                    void actionSaveAs(actionCtx);
                } else {
                    void ctx.editor.save();
                }
                break;
            case "save-as":
                void actionSaveAs(actionCtx);
                break;
            case "revert":
                void actionRevert(actionCtx);
                break;
            case "new-score":
                void actionNewScore(actionCtx);
                break;
            case "open-score":
                void actionOpenScore(actionCtx);
                break;
            case "duplicate-score":
                void actionDuplicateScore(actionCtx);
                break;
            case "rename-score":
                void actionRenameScore(actionCtx);
                break;
            case "delete-score":
                void actionDeleteScore(actionCtx);
                break;
            case "import-image":
                void ctx.imageImporter.importViaFilePicker();
                break;
            case "import-image-from-url":
                void ctx.imageImporter.importFromUrlPrompt();
                break;
            case "remove-image":
                ctx.imageImporter.removeCurrentImage();
                break;
            case "reload-from-disk":
                void actionReloadFromDisk(actionCtx);
                break;

            // --- Edit ---
            //
            // Undo, Redo, and Duplicate dispatch to the
            // canvas-level handlers. These are click-only in
            // sub-commit 5a (no native menu accelerator), so
            // they fire only when the user picks the menu
            // item explicitly — focus has been on the menu,
            // not on a text editor, so the canvas action is
            // unambiguously what the user wants. Sub-commit
            // 5c adds accelerators and switches to focus-
            // aware dispatch so Cmd-Z in CodeMirror still
            // does CodeMirror's undo.
            case "undo":
                ctx.performUndo();
                break;
            case "redo":
                ctx.performRedo();
                break;
            case "duplicate-canvas-edit":
                ctx.performDuplicate();
                break;

            // --- View ---
            case "zoom-in":
                ctx.canvas.zoomIn();
                break;
            case "zoom-out":
                ctx.canvas.zoomOut();
                break;
            case "reset-zoom":
                ctx.canvas.resetZoom();
                break;
            case "toggle-auto-zoom":
                ctx.toggleAutoZoom();
                break;
            case "toggle-focus-canvas":
                ctx.toggleFocusCanvas();
                break;

            // --- Run ---
            case "run-scene":
                ctx.runScene();
                break;

            // --- Application menu ---
            case "show-about":
                openAboutDialog();
                break;
            case "show-settings":
                openSettingsDialog({
                    diskMirror: ctx.diskMirror,
                    messages: ctx.messages,
                });
                break;

            default:
                console.warn("GXW: unknown menu action:", action);
        }
    });

    return true;
}

/**
 * Push a partial state patch to the main process so the
 * native menu's disabled / checked flags refresh. Safe to
 * call on the web build; it's a no-op there since
 * installMenuActions returned false without capturing
 * gxwMenu.
 *
 * @param {MenuState} state
 */
export function pushMenuState(state) {
    if (gxwMenu === null) return;
    void gxwMenu.pushState(state);
}
