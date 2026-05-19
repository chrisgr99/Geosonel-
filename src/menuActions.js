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
    actionOpenScoreByPath,
    actionDuplicateScore,
    actionSaveAs,
    actionRevert,
    actionRevertToBackup,
    actionReloadFromDisk,
    actionRenameScore,
    actionDeleteScore,
} from "./scoreActions.js";
import { openAboutDialog } from "./aboutDialog.js";
import { openSettingsDialog } from "./settingsDialog.js";
import {
    getRecentScores,
    clearRecentScores,
} from "./recentFiles.js";
import {
    listBackups,
    scoreNameFromPath,
} from "./storage.js";
import { relativeDateLabel } from "./relativeDate.js";

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
 * @property {Array<{path: string, name: string}>} [recentScores]
 * @property {Array<{slotNumber: number, label: string}>} [backups]
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

    gxwMenu.onAction((message) => {
        // Messages arrive as { action, payload } objects.
        // Payload is null for static items, an object
        // identifying the chosen entry for dynamic-submenu
        // clicks (Open Recent, Revert to).
        const action = typeof message === "object" && message !== null
            ? message.action
            : message;
        const payload = typeof message === "object" && message !== null
            ? message.payload
            : null;
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
            case "remove-image":
                ctx.imageImporter.removeCurrentImage();
                break;
            case "reload-from-disk":
                void actionReloadFromDisk(actionCtx);
                break;

            // --- File: Open Recent / Revert to ---
            case "open-recent":
                if (payload !== null && typeof payload.path === "string") {
                    void actionOpenScoreByPath(actionCtx, payload.path);
                }
                break;
            case "clear-recent":
                clearRecentScores();
                break;
            case "revert-to-backup":
                if (payload !== null &&
                    typeof payload.slotNumber === "number" &&
                    typeof payload.label === "string") {
                    void actionRevertToBackup(
                        actionCtx,
                        payload.slotNumber,
                        payload.label,
                    );
                }
                break;

            // --- Edit ---
            //
            // Undo and Redo dispatch through TabbedEditor's
            // focus-aware tryUndoInFocus / tryRedoInFocus,
            // which detect whether focus is in CodeMirror,
            // a plain text input, or somewhere else and
            // route accordingly. When the editor reports it
            // didn't handle the gesture (return false), the
            // canvas undo stack takes over via performUndo /
            // performRedo. This is what makes Cmd-Z do the
            // right thing under native menu accelerators:
            // CodeMirror's own undo still runs when the user
            // is typing code, INPUT undo runs in text
            // fields, and canvas undo runs everywhere else.
            // Duplicate stays as a straight performDuplicate;
            // it's always a canvas-level gesture and has no
            // text-context analogue.
            case "undo":
                if (!ctx.editor.tryUndoInFocus()) ctx.performUndo();
                break;
            case "redo":
                if (!ctx.editor.tryRedoInFocus()) ctx.performRedo();
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

/**
 * Push the current recent-scores list to the native menu's
 * Open Recent submenu. Filters out the currently-active
 * bundle (clicking it would be a no-op anyway and showing
 * it just wastes a slot, matching the in-page menu's
 * behaviour). The display name shown in each menu row is
 * derived from the path via scoreNameFromPath, so renames
 * of the underlying folder reflect automatically when the
 * folder still lives at the recorded path.
 *
 * No-op on the web build.
 *
 * @param {string | null} currentBundlePath
 */
export function pushRecentScoresToMenu(currentBundlePath) {
    if (gxwMenu === null) return;
    const recents = getRecentScores()
        .filter((e) => e.path !== currentBundlePath)
        .map((e) => ({ path: e.path, name: scoreNameFromPath(e.path) }));
    pushMenuState({ recentScores: recents });
}

/**
 * Push the current bundle's backup slot list to the native
 * menu's Revert to submenu. Reads the slots from disk via
 * storage.listBackups, renders each slot's mtime as a
 * relative-date label, and pushes the result. The native
 * menu's parent Revert to entry is disabled when the list
 * is empty (untitled bundle, no save yet on a saved
 * bundle, or simply no backups rotated in), so the
 * submenu opens only when there's at least one slot.
 *
 * Untitled bundles (path === null) push an empty list,
 * which lands as Revert to disabled in the menu. No-op on
 * the web build (storage's listBackups is a no-op there
 * anyway, but we short-circuit on gxwMenu absence so the
 * IPC isn't sent).
 *
 * @param {string | null} bundlePath
 * @returns {Promise<void>}
 */
export async function pushBackupsToMenu(bundlePath) {
    if (gxwMenu === null) return;
    if (bundlePath === null) {
        pushMenuState({ backups: [] });
        return;
    }
    try {
        const slots = await listBackups(bundlePath);
        const labelled = slots.map((slot) => ({
            slotNumber: slot.slotNumber,
            label: relativeDateLabel(slot.mtimeMs),
        }));
        pushMenuState({ backups: labelled });
    } catch (err) {
        console.error("GXW: pushBackupsToMenu failed:", err);
        pushMenuState({ backups: [] });
    }
}
