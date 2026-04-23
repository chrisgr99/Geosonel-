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
    ]);

    document.body.appendChild(dropdown);
    wireDropdown(fileItem, dropdown);
}
