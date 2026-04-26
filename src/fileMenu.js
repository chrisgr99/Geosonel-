/**
 * File menu.
 *
 * Populates the File dropdown with score-management and disk-
 * interop actions. Uses the shared menuUtil module.
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";
import {
    actionNewScore,
    actionOpenScore,
    actionDuplicateScore,
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

/**
 * @typedef {Object} FileMenuContext
 * @property {ScoreSession} session
 * @property {MessageArea} messages
 * @property {ImageImporter} imageImporter
 * @property {import("./diskMirror.js").DiskMirror} diskMirror
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

    const actionCtx = { session: ctx.session, messages: ctx.messages };

    const dropdown = buildDropdown([
        {
            label: "New Score\u2026",
            action: () => actionNewScore(actionCtx),
        },
        {
            label: "Open Score\u2026",
            action: () => actionOpenScore(actionCtx),
        },
        {
            label: "Duplicate Score\u2026",
            action: () => actionDuplicateScore(actionCtx),
        },
        {
            label: "Rename Score\u2026",
            action: () => actionRenameScore(actionCtx),
        },
        {
            label: "Delete Score\u2026",
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
        { separator: true },
        {
            label: "Export Score\u2026",
            action: () => actionExportScore(actionCtx),
        },
        {
            label: "Import Score\u2026",
            action: () => actionImportScore(actionCtx),
        },
        {
            label: "Back Up All Scores\u2026",
            action: () => actionBackUpAllScores(actionCtx),
        },
        {
            label: "Restore Scores from Backup\u2026",
            action: () => actionRestoreFromBackup(actionCtx),
        },
        { separator: true },
        {
            label: "Reload Score from Disk",
            action: () => actionReloadFromDisk(ctx),
        },
    ]);

    document.body.appendChild(dropdown);
    wireDropdown(fileItem, dropdown);
}

/**
 * Manually pull the current score's files from disk and load
 * them into the editor. The polling watcher already does this
 * automatically when external changes are detected, but this
 * action gives the user explicit control — useful when the
 * watcher missed something or when the user knows the AI
 * just finished editing and doesn't want to wait the polling
 * interval.
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
