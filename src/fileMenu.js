/**
 * File menu.
 *
 * Populates the File dropdown with score-management and disk-
 * interop actions. Uses the shared menuUtil module.
 *
 * The menu's structure differs between the Electron build and
 * the web build. In the Electron build the user's scores live
 * as files on disk natively, so the data-portability actions
 * (Export, Import, Back Up All Scores, Restore from Backup)
 * are omitted — the user can just copy folders. In the web
 * build those four actions remain, since IndexedDB scores
 * can't otherwise leave the browser. The Open Recent submenu
 * appears in both builds.
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";
import { confirmDiscardDialog } from "./dialog.js";
import { getRecentScores, clearRecentScores } from "./recentFiles.js";
import {
    actionNewScore,
    actionOpenScore,
    actionOpenScoreByName,
    actionDuplicateScore,
    actionSaveAs,
    actionRevert,
    actionRenameScore,
    actionDeleteScore,
    actionExportScore,
    actionImportScore,
    actionBackUpAllScores,
    actionRestoreFromBackup,
} from "./scoreActions.js";

/** @typedef {import("./scoreActions.js").ScoreSession} ScoreSession */
/** @typedef {import("./messages.js").MessageArea} MessageArea */
/** @typedef {import("./imageImporter.js").ImageImporter} ImageImporter */
/** @typedef {import("./editor.js").TabbedEditor} TabbedEditor */
/** @typedef {import("./menuUtil.js").DropdownEntry} DropdownEntry */

/**
 * @typedef {Object} FileMenuContext
 * @property {ScoreSession} session
 * @property {MessageArea} messages
 * @property {ImageImporter} imageImporter
 * @property {import("./diskMirror.js").DiskMirror} diskMirror
 * @property {TabbedEditor} editor
 * @property {boolean} isElectron  True when running under the Electron
 *   wrapper; selects between the desktop menu shape (no data-portability
 *   actions) and the web menu shape (Export/Import/Back Up/Restore present).
 */

/**
 * @param {FileMenuContext} ctx
 */
export function installFileMenu(ctx) {
    const fileItem = findMenuItem("File");
    if (fileItem === null) {
        console.error("GXW: File menu item not found.");
        return;
    }

    const actionCtx = { session: ctx.session, messages: ctx.messages, editor: ctx.editor };

    /** @type {DropdownEntry[]} */
    const entries = [
        {
            label: "Save",
            shortcut: "\u2318S",
            action: () => { void ctx.editor.save(); },
        },
        {
            label: "Save As\u2026",
            shortcut: "\u21e7\u2318S",
            action: () => actionSaveAs(actionCtx),
        },
        {
            label: "Revert to Saved",
            disabled: () => !ctx.session.bundle.dirty,
            action: () => actionRevert(actionCtx),
        },
        { separator: true },
        {
            label: "New\u2026",
            action: () => actionNewScore(actionCtx),
        },
        {
            label: "Open\u2026",
            action: () => actionOpenScore(actionCtx),
        },
        {
            label: "Open Recent",
            buildSubmenu: () => buildRecentSubmenu(ctx, actionCtx),
        },
        {
            label: "Duplicate\u2026",
            action: () => actionDuplicateScore(actionCtx),
        },
        {
            label: "Rename\u2026",
            action: () => actionRenameScore(actionCtx),
        },
        {
            label: "Delete\u2026",
            action: () => actionDeleteScore(actionCtx),
        },
        { separator: true },
        {
            label: "Import Image\u2026",
            action: () => ctx.imageImporter.importViaFilePicker(),
        },
        {
            label: "Import Image from URL\u2026",
            action: () => ctx.imageImporter.importFromUrlPrompt(),
        },
        {
            label: "Remove Image",
            action: () => ctx.imageImporter.removeCurrentImage(),
        },
    ];

    // The data-portability cluster (Export, Import, Back Up
    // All Scores, Restore from Backup) is web-only. In
    // Electron, scores already live on disk as folders, so
    // these in-app file-handling escape hatches add nothing
    // the filesystem doesn't already provide; cluttering the
    // menu with them in the desktop build would only confuse
    // the user about which path is canonical.
    if (!ctx.isElectron) {
        entries.push({ separator: true });
        entries.push({
            label: "Export\u2026",
            action: () => actionExportScore(actionCtx),
        });
        entries.push({
            label: "Import\u2026",
            action: () => actionImportScore(actionCtx),
        });
        entries.push({
            label: "Back Up All Scores\u2026",
            action: () => actionBackUpAllScores(actionCtx),
        });
        entries.push({
            label: "Restore from Backup\u2026",
            action: () => actionRestoreFromBackup(actionCtx),
        });
    }

    entries.push({ separator: true });
    entries.push({
        label: "Reload from Disk",
        action: () => actionReloadFromDisk(ctx),
    });

    const dropdown = buildDropdown(entries);

    document.body.appendChild(dropdown);
    wireDropdown(fileItem, dropdown);
}

/**
 * Build the Open Recent submenu's entry list. Reads the
 * recent-scores list from localStorage on every open so
 * changes since the last open (a new score loaded, a deleted
 * score forgotten, the user clearing the list) are reflected
 * immediately. The currently-open score is filtered out so
 * the menu means "other scores you might want to switch to"
 * rather than the literal last-N list; clicking the score
 * already open would be a no-op anyway and showing it just
 * wastes a slot. A Clear Menu entry sits at the bottom,
 * separated by a divider, to empty the list.
 *
 * @param {FileMenuContext} ctx
 * @param {import("./scoreActions.js").ScoreActionsContext} actionCtx
 * @returns {DropdownEntry[]}
 */
function buildRecentSubmenu(ctx, actionCtx) {
    const current = ctx.session.bundle.name;
    const recents = getRecentScores().filter((e) => e.name !== current);
    /** @type {DropdownEntry[]} */
    const entries = recents.map((entry) => ({
        label: entry.name,
        action: () => { void actionOpenScoreByName(actionCtx, entry.name); },
    }));
    if (entries.length > 0) {
        entries.push({ separator: true });
    }
    entries.push({
        label: "Clear Menu",
        // Greyed out when there's nothing to clear, matching
        // TextEdit's Open Recent behaviour when the list is
        // empty. The user still sees the entry's footprint
        // so the submenu doesn't visibly collapse, but the
        // muted state signals there's no action to take.
        disabled: () => getRecentScores().length === 0,
        action: () => { clearRecentScores(); },
    });
    return entries;
}

/**
 * Manually pull the current score's files from disk and load
 * them into the editor. The polling watcher already does this
 * automatically when external changes are detected, but this
 * action gives the user explicit control — useful when the
 * watcher missed something or when the user knows the AI
 * just finished editing and doesn't want to wait the polling
 * interval. Gated by the unsaved-changes prompt because the
 * disk content replaces the in-memory bundle wholesale; the
 * user is offered Save / Don't Save / Cancel before any
 * unsaved edits are dropped.
 * @param {FileMenuContext} ctx
 */
async function actionReloadFromDisk(ctx) {
    const status = ctx.diskMirror.getStatus();
    if (!status.hasFolder) {
        ctx.messages.write(
            "Disk mirroring isn't configured. Open Settings to choose a folder.",
            "error"
        );
        return;
    }
    if (!status.enabled) {
        ctx.messages.write(
            "Disk mirroring is paused. Resume it in Settings to reload from disk.",
            "error"
        );
        return;
    }
    if (ctx.session.bundle.dirty) {
        const decision = await confirmDiscardDialog({
            scoreName: ctx.session.bundle.name,
        });
        if (decision === "cancel") return;
        if (decision === "save") {
            await ctx.editor.save();
        }
    }
    const name = ctx.session.bundle.name;
    const bundle = await ctx.diskMirror.pullBundle(name);
    if (bundle === null) {
        ctx.messages.write(
            `No score named "${name}" found on disk, or its files couldn't be read.`,
            "error"
        );
        return;
    }
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Reloaded "${name}" from disk.`);
}
