/**
 * Score management UI.
 *
 * Actions invoked by the File menu: New, Open, Save As, Rename,
 * Delete, Export, Import, Back Up All, Restore.
 *
 * An Open dialog is implemented here as a modal overlay listing
 * the stored scores. All other actions use window.prompt or
 * window.confirm for their input — acceptable for this
 * milestone; can be replaced with styled dialogs later.
 *
 * Each action operates against a ScoreSession object (defined
 * in main.js) that owns the currently-open bundle and knows how
 * to swap it out. The actions call back through the session to
 * switch scores.
 */

// @ts-check

import {
    Bundle,
    createNewScore,
    createUntitledScore,
    loadScoreByPath,
    listAvailableScores,
    deleteScoreByPath,
} from "./bundle.js";
import {
    saveScoreRecord,
    loadScoreRecord,
    loadAllScoreRecords,
    loadBackupRecord,
    renameScoreRecord,
    setCurrentScorePath,
    composeScorePathFromName,
    joinScorePath,
    dirname,
    scoreNameFromPath,
    getDefaultSaveDirectory,
    setLastUsedDirectory,
} from "./storage.js";
import { promptDialog, confirmDialog, confirmDiscardDialog } from "./dialog.js";
import { forgetScore, renameInRecentScores } from "./recentFiles.js";

/** @typedef {import("./messages.js").MessageArea} MessageArea */
/** @typedef {import("./editor.js").TabbedEditor} TabbedEditor */

/**
 * @typedef {Object} ScoreSession
 * @property {Bundle} bundle
 * @property {(bundle: Bundle) => Promise<void>} switchToBundle
 * @property {() => void} refreshScoreNameDisplay
 */

/**
 * @typedef {Object} ScoreActionsContext
 * @property {ScoreSession} session
 * @property {MessageArea} messages
 * @property {TabbedEditor} editor
 */

// --- Native dialog detection ---
//
// The Electron build exposes window.gxwDialog (set in
// electron-preload.js) carrying wrappers around
// dialog.showSaveDialog and dialog.showOpenDialog. The web
// build doesn't, so actionSaveAs and actionOpenScore fall
// back to their in-app modals when the wrappers are absent.
// Checking each function's presence at call time keeps the
// actions portable across both builds without splitting
// them into separate exports.

/**
 * @returns {boolean}
 */
function nativeSaveDialogAvailable() {
    const gxwDialog = /** @type {any} */ (window).gxwDialog;
    return (
        gxwDialog !== undefined &&
        gxwDialog !== null &&
        typeof gxwDialog.showSaveDialog === "function"
    );
}

/**
 * @param {{title?: string, defaultPath?: string}} options
 * @returns {Promise<{canceled: boolean, filePath: string | null}>}
 */
async function showNativeSaveDialog(options) {
    const gxwDialog = /** @type {any} */ (window).gxwDialog;
    return await gxwDialog.showSaveDialog(options);
}

/**
 * @returns {boolean}
 */
function nativeOpenDialogAvailable() {
    const gxwDialog = /** @type {any} */ (window).gxwDialog;
    return (
        gxwDialog !== undefined &&
        gxwDialog !== null &&
        typeof gxwDialog.showOpenDialog === "function"
    );
}

/**
 * @param {{title?: string, defaultPath?: string}} options
 * @returns {Promise<{canceled: boolean, filePath: string | null}>}
 */
async function showNativeOpenDialog(options) {
    const gxwDialog = /** @type {any} */ (window).gxwDialog;
    return await gxwDialog.showOpenDialog(options);
}

// --- Unsaved-changes gate ---

/**
 * Before any action that switches away from the current bundle
 * (New Score, Open Score, Duplicate Score, Import Score,
 * Reload from Disk), check whether the current bundle has
 * unsaved changes; if so, present the three-button Save /
 * Don't Save / Cancel dialog and act on the user's decision.
 *
 * Returns true when the caller should proceed with the
 * switch-away action, false when the caller should abort. On
 * Save, the bundle is saved before returning true. On Don't
 * Save, the dirty state is intentionally left in place; the
 * caller's subsequent switchToBundle replaces the in-memory
 * bundle so the unsaved edits are dropped naturally without
 * needing to write anything to disk.
 *
 * Delete Score deliberately does not call this guard — the
 * user is explicitly discarding the score, and the action's
 * own confirmation prompt already covers the data-loss
 * conversation.
 *
 * @param {ScoreActionsContext} ctx
 * @returns {Promise<boolean>}
 */
async function confirmDiscardChanges(ctx) {
    if (!ctx.session.bundle.dirty) return true;
    const decision = await confirmDiscardDialog({
        scoreName: ctx.session.bundle.name,
    });
    if (decision === "cancel") return false;
    if (decision === "save") {
        if (ctx.session.bundle.path === null) {
            // Untitled bundle: bring up Save As so the user
            // can give it a path. Cancelling the Save panel
            // counts as cancelling the overall switch-away
            // gesture, so we return false and the caller
            // aborts. We detect cancellation by checking
            // whether the bundle acquired a path; a
            // successful Save As sets one via switchToBundle.
            await actionSaveAs(ctx);
            if (ctx.session.bundle.path === null) return false;
        } else {
            await ctx.editor.save();
        }
    }
    return true;
}

// --- Simple actions ---

/**
 * New Score: create a fresh in-memory Untitled bundle and
 * switch to it. The bundle isn't written to disk until the
 * user runs Save (which routes through Save As for untitled
 * bundles) or Save As directly. Logic-style: the user starts
 * editing immediately and decides on the filename and
 * location at first save.
 *
 * The dirty-state gate fires before creating the new bundle
 * so any unsaved edits in the current score get the Save /
 * Don't Save / Cancel treatment. The new untitled bundle
 * itself is born clean (dirty=false).
 *
 * @param {ScoreActionsContext} ctx
 */
export async function actionNewScore(ctx) {
    if (!(await confirmDiscardChanges(ctx))) return;
    const bundle = createUntitledScore();
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write("New untitled score.");
}

/**
 * Open Score: present a dialog letting the user pick a
 * score to switch to.
 *
 * Electron build: routes through dialog.showOpenDialog so
 * the user gets the standard macOS Open panel. Without UTI
 * declarations (stage 6) the panel runs in openDirectory
 * mode so .gxs folders read as folders the user navigates
 * to and picks. The default location is
 * settings.lastUsedDirectory when set, falling back to the
 * configured Scores folder. After a successful open,
 * lastUsedDirectory updates to the chosen score's parent
 * directory so the next Open or Save defaults to the same
 * neighbourhood. The chosen path's .gxs suffix is verified
 * before loading; non-.gxs picks surface as an error in
 * the message area.
 *
 * The Open-as-Duplicate workflow (forking from an arbitrary
 * score on disk) isn't surfaced through the native panel —
 * macOS's Open dialog has nowhere to put a second action
 * button. Users who want to fork an opened score can run
 * Duplicate Score after opening normally; a future
 * Templates feature will cover the load-from-arbitrary-
 * location-as-new-score case more directly.
 *
 * Web build: keeps the in-app modal with its Open and Open
 * as Duplicate buttons. The native Open panel isn't
 * reachable from the sandboxed renderer; the modal is the
 * legacy fallback and still supports both forms.
 *
 * @param {ScoreActionsContext} ctx
 */
export async function actionOpenScore(ctx) {
    if (nativeOpenDialogAvailable()) {
        await actionOpenScoreNative(ctx);
    } else {
        await actionOpenScoreInApp(ctx);
    }
}

/**
 * Native Open panel path. Used on Electron.
 * @param {ScoreActionsContext} ctx
 */
async function actionOpenScoreNative(ctx) {
    const defaultDir = await getDefaultSaveDirectory();
    const result = await showNativeOpenDialog({
        title: "Open Score",
        defaultPath: defaultDir !== "" ? defaultDir : undefined,
    });
    if (result.canceled || result.filePath === null) return;

    const chosenPath = result.filePath;
    if (!chosenPath.endsWith(".gxs")) {
        ctx.messages.write(
            `That folder isn\u2019t a GeoSonel score (missing .gxs suffix): "${chosenPath}".`,
            "error",
        );
        return;
    }
    if (chosenPath === ctx.session.bundle.path) return;
    if (!(await confirmDiscardChanges(ctx))) return;

    const bundle = await loadScoreByPath(chosenPath);
    if (bundle === null) {
        ctx.messages.write(
            `Could not open score at "${chosenPath}".`,
            "error",
        );
        return;
    }
    await setCurrentScorePath(chosenPath);
    await setLastUsedDirectory(dirname(chosenPath));
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Switched to score "${bundle.name}".`);
}

/**
 * In-app score-list modal path. Used on the web build where
 * the native Open panel isn't available. Preserves the
 * existing two-button (Open / Open as Duplicate) flow
 * verbatim from before Stage 3 commit 3b.
 * @param {ScoreActionsContext} ctx
 */
async function actionOpenScoreInApp(ctx) {
    const result = await openScoreDialog();
    if (result === null) return;
    if (result.action === "open") {
        if (result.path === ctx.session.bundle.path) return;
        if (!(await confirmDiscardChanges(ctx))) return;
        const bundle = await loadScoreByPath(result.path);
        if (bundle === null) {
            ctx.messages.write(`Score "${result.name}" could not be found.`, "error");
            return;
        }
        await setCurrentScorePath(result.path);
        await ctx.session.switchToBundle(bundle);
        ctx.messages.write(`Switched to score "${result.name}".`);
    } else {
        if (!(await confirmDiscardChanges(ctx))) return;
        await actionOpenAsDuplicate(ctx, result.path);
    }
}

/**
 * Open a score by path directly, without going through the
 * Open Score dialog. Used by the File menu's Open Recent
 * submenu: a click on a recent entry loads that score and
 * switches to it. Goes through the same dirty-state
 * confirmation gate as actionOpenScore so unsaved edits
 * aren't silently dropped. If the score at the path no
 * longer exists (typical after the user deleted it through
 * some other path while it was still in the recent list),
 * the entry is removed from the recent list and an error
 * is surfaced.
 *
 * @param {ScoreActionsContext} ctx
 * @param {string} path
 */
export async function actionOpenScoreByPath(ctx, path) {
    if (path === ctx.session.bundle.path) return;
    if (!(await confirmDiscardChanges(ctx))) return;
    const bundle = await loadScoreByPath(path);
    if (bundle === null) {
        forgetScore(path);
        ctx.messages.write(
            `Score at "${path}" could not be found and was removed from Open Recent.`,
            "error"
        );
        return;
    }
    await setCurrentScorePath(path);
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Switched to score "${bundle.name}".`);
}

/**
 * Duplicate Score: prompt for a new name, clone the current
 * bundle under that name, switch to the clone. The dirty-
 * state check applies because switching to the clone drops
 * the in-memory unsaved edits on the original; the user
 * gets the chance to save the original first via the Save
 * option in the discard prompt.
 * @param {ScoreActionsContext} ctx
 */
export async function actionDuplicateScore(ctx) {
    if (!(await confirmDiscardChanges(ctx))) return;
    const oldName = ctx.session.bundle.name;
    const newName = await promptForUniqueName(
        `Duplicate "${oldName}" as:`,
        `${oldName} copy`,
        ctx.messages
    );
    if (newName === null) return;
    await duplicateScoreAs(ctx, ctx.session.bundle.toRecord(), newName);
}

/**
 * Save As: write the current in-memory bundle's state to a
 * user-chosen destination, switching the editing target to
 * the new bundle. The original score on disk stays in its
 * last-saved state (the dirty in-memory edits land in the
 * new bundle, not the old one). Distinct from Duplicate
 * Score, which forks from the on-disk state rather than
 * from memory.
 *
 * Electron build: routes through dialog.showSaveDialog so
 * the user gets the standard macOS Save panel. The panel's
 * default directory is settings.lastUsedDirectory (or the
 * configured Scores folder when unset); the default
 * filename is the current name with a " copy" suffix and
 * the .gxs extension. The Save panel's own overwrite
 * confirmation handles collision; the user can navigate
 * anywhere on disk. After a successful save,
 * lastUsedDirectory is updated to the chosen file's parent
 * so the next Save As defaults to the same neighbourhood.
 *
 * Save-as-into-self (the user picks a path identical to the
 * current bundle's) collapses to a plain save-in-place via
 * editor.save(), so the bundle's identity doesn't churn and
 * no spurious switchToBundle fires. macOS's overwrite
 * confirm has already done its job at that point.
 *
 * Web build: keeps the in-app prompt-plus-confirm-overwrite
 * loop. The native Save panel isn't reachable from the
 * sandboxed renderer; the prompt loop is the legacy
 * fallback.
 *
 * @param {ScoreActionsContext} ctx
 */
export async function actionSaveAs(ctx) {
    if (nativeSaveDialogAvailable()) {
        await actionSaveAsNative(ctx);
    } else {
        await actionSaveAsInApp(ctx);
    }
}

/**
 * Native Save panel path. Used on Electron.
 * @param {ScoreActionsContext} ctx
 */
async function actionSaveAsNative(ctx) {
    const oldName = ctx.session.bundle.name;
    const oldPath = ctx.session.bundle.path;

    const defaultDir = await getDefaultSaveDirectory();
    // Drop the " copy" suffix for untitled bundles — they
    // haven't been saved anywhere yet, so the default name
    // is just the bundle's display name. Saved bundles use
    // "<name> copy" so a Save As against a real file lands
    // on a distinct name by default.
    const defaultName = oldPath === null ? oldName : `${oldName} copy`;
    const defaultPath = defaultDir !== ""
        ? joinScorePath(defaultDir, defaultName)
        : undefined;

    const result = await showNativeSaveDialog({
        title: `Save \u201c${oldName}\u201d As\u2026`,
        defaultPath,
    });
    if (result.canceled || result.filePath === null) return;

    let chosenPath = result.filePath;
    if (!chosenPath.endsWith(".gxs")) chosenPath = chosenPath + ".gxs";

    if (chosenPath === oldPath) {
        // The user picked the current bundle's path in the
        // Save panel; macOS's overwrite confirm already ran
        // and the gesture is effectively save-in-place. Route
        // through editor.save() so the bundle's identity
        // doesn't churn through a needless switchToBundle.
        // Only reachable when oldPath is non-null, since
        // chosenPath comes from the Save panel and is never
        // null.
        await ctx.editor.save();
        return;
    }

    const finalName = scoreNameFromPath(chosenPath);
    const record = ctx.session.bundle.toRecord();
    record.name = finalName;
    record.updatedAt = Date.now();
    await saveScoreRecord(chosenPath, record);

    const bundle = await loadScoreByPath(chosenPath);
    if (bundle === null) {
        ctx.messages.write(`Failed to save as "${finalName}".`, "error");
        return;
    }
    await setCurrentScorePath(chosenPath);
    await setLastUsedDirectory(dirname(chosenPath));
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Saved as "${finalName}".`);
}

/**
 * In-app prompt-plus-confirm-overwrite path. Used on the
 * web build where the native Save panel isn't available.
 * Preserves the existing prompt loop verbatim from before
 * Stage 3 commit 3a.
 * @param {ScoreActionsContext} ctx
 */
async function actionSaveAsInApp(ctx) {
    const oldName = ctx.session.bundle.name;
    const oldPath = ctx.session.bundle.path;
    const existing = new Set(
        (await listAvailableScores()).map((s) => s.name)
    );

    // Drop the " copy" suffix for untitled bundles, matching
    // the native Save panel's default-name logic.
    let value = oldPath === null ? oldName : `${oldName} copy`;
    let errorMessage = "";
    /** @type {string | null} */
    let finalName = null;
    while (finalName === null) {
        const raw = await promptDialog({
            title: `Save "${oldName}" as:`,
            defaultValue: value,
            okLabel: "Save",
            errorMessage,
        });
        if (raw === null) return;
        const name = raw.trim();
        if (name === "") {
            value = raw;
            errorMessage = "Name cannot be empty.";
            continue;
        }
        if (name === oldName && oldPath !== null) {
            // Save-in-place: matches native macOS Save
            // panel behaviour when the user types the
            // current filename. Goes through the standard
            // editor.save() path so the onSaved toast and
            // dirty-state transition fire normally.
            // Skipped for untitled bundles (oldPath===null)
            // because there is no in-place to save to;
            // typing the name just commits the bundle to
            // disk under that name for the first time.
            await ctx.editor.save();
            return;
        }
        if (existing.has(name)) {
            const replace = await confirmDialog({
                title: `A score named "${name}" already exists. Replace it?`,
                confirmLabel: "Replace",
            });
            if (!replace) {
                value = name;
                errorMessage = "";
                continue;
            }
        }
        finalName = name;
    }

    // Write the in-memory bundle's state under the new name
    // via saveScoreRecord (Bundle.save would persist under
    // the bundle's current path, not the new one). Then
    // load the freshly-written record back as a clean
    // bundle and switch the editor over.
    const newPath = await composeScorePathFromName(finalName);
    const record = ctx.session.bundle.toRecord();
    record.name = finalName;
    record.updatedAt = Date.now();
    await saveScoreRecord(newPath, record);

    const bundle = await loadScoreByPath(newPath);
    if (bundle === null) {
        ctx.messages.write(`Failed to save as "${finalName}".`, "error");
        return;
    }
    await setCurrentScorePath(newPath);
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Saved as "${finalName}".`);
}

/**
 * Revert to Saved: reload the active score from disk,
 * discarding any in-memory dirty edits. Two-button Mac-
 * standard confirmation following the Pages/TextEdit
 * pattern: title "Revert to the last saved version of
 * <name>?", description "Any unsaved changes will be
 * lost.", buttons Cancel and Revert with Revert as the
 * primary Return-bound action. The File menu item is greyed
 * out when the bundle is clean (the dirty-state getter
 * feeds the dropdown's disabled state at open time), so
 * this action is only invoked when there's actually
 * unsaved work to discard.
 *
 * @param {ScoreActionsContext} ctx
 */
export async function actionRevert(ctx) {
    if (!ctx.session.bundle.dirty) return;
    const name = ctx.session.bundle.name;
    const path = ctx.session.bundle.path;
    if (path === null) {
        ctx.messages.write(
            `Cannot revert "${name}" — the score has not been saved yet.`,
            "error"
        );
        return;
    }
    const ok = await confirmDialog({
        title: `Revert to the last saved version of \u201c${name}\u201d?`,
        description: "Any unsaved changes will be lost.",
        confirmLabel: "Revert",
    });
    if (!ok) return;
    const bundle = await loadScoreByPath(path);
    if (bundle === null) {
        ctx.messages.write(`Could not reload "${name}" from disk.`, "error");
        return;
    }
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Reverted "${name}" to last saved version.`);
}

/**
 * Revert to a specific numbered backup slot. Desktop-only;
 * web callers should never invoke this (the File menu's
 * Revert to submenu is gated on the Electron build).
 *
 * The revert behaves as a save: the current pre-revert state
 * is rotated into a new slot 1 by the normal save path, and
 * the chosen backup's content becomes the new score on disk.
 * Net effect across many reverts is that no state is ever
 * lost — each revert preserves the previous in-memory state
 * as a fresh backup. The user-visible confirm wording is
 * the same shape as actionRevert ("Revert to <when>?") so
 * the two reverts read consistently.
 *
 * @param {ScoreActionsContext} ctx
 * @param {number} slotNumber
 * @param {string} label   Human-readable label (e.g. "5 minutes ago")
 *   used in the confirm-dialog title so the user sees which
 *   backup they're about to commit to.
 */
export async function actionRevertToBackup(ctx, slotNumber, label) {
    const name = ctx.session.bundle.name;
    const path = ctx.session.bundle.path;
    if (path === null) {
        ctx.messages.write(
            `Cannot revert "${name}" — the score has not been saved yet.`,
            "error"
        );
        return;
    }
    const ok = await confirmDialog({
        title: `Revert \u201c${name}\u201d to ${label}?`,
        description:
            "Any unsaved changes will be lost, and the score\u2019s current state on disk will be moved into the most recent backup slot.",
        confirmLabel: "Revert",
    });
    if (!ok) return;
    const record = await loadBackupRecord(path, slotNumber);
    if (record === null) {
        ctx.messages.write(
            `Could not load backup slot ${slotNumber} for "${name}".`,
            "error"
        );
        return;
    }
    // saveScoreRecord triggers the normal backup-rotation
    // path before writing, so the current on-disk state goes
    // into slot 1 and existing slots shift up by one before
    // the backup's content is written. The record's name is
    // already the original score name (loadBackupRecord sets
    // it that way), but defensively make sure here too.
    record.name = name;
    record.updatedAt = Date.now();
    await saveScoreRecord(path, record);
    const bundle = await loadScoreByPath(path);
    if (bundle === null) {
        ctx.messages.write(`Could not reload "${name}" after revert.`, "error");
        return;
    }
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Reverted "${name}" to ${label}.`);
}

/**
 * Duplicate an arbitrary stored score (not necessarily the
 * current one) into a new score and switch to it. Used by the
 * Open Score dialog's "Open as Duplicate" button.
 * @param {ScoreActionsContext} ctx
 * @param {string} sourcePath
 */
export async function actionOpenAsDuplicate(ctx, sourcePath) {
    const sourceRecord = await loadScoreRecord(sourcePath);
    if (sourceRecord === null) {
        ctx.messages.write(
            `Score at "${sourcePath}" could not be found.`,
            "error"
        );
        return;
    }
    const newName = await promptForUniqueName(
        `Duplicate "${sourceRecord.name}" as:`,
        `${sourceRecord.name} copy`,
        ctx.messages
    );
    if (newName === null) return;
    await duplicateScoreAs(ctx, sourceRecord, newName);
}

/**
 * Shared helper: given a source record and a new name, save
 * the record under the new name and switch to it.
 * @param {ScoreActionsContext} ctx
 * @param {import("./storage.js").ScoreRecord} sourceRecord
 * @param {string} newName
 */
async function duplicateScoreAs(ctx, sourceRecord, newName) {
    const newPath = await composeScorePathFromName(newName);
    const record = {
        ...sourceRecord,
        name: newName,
        updatedAt: Date.now(),
    };
    await saveScoreRecord(newPath, record);

    const bundle = await loadScoreByPath(newPath);
    if (bundle === null) {
        ctx.messages.write(`Failed to create duplicate "${newName}".`, "error");
        return;
    }
    await setCurrentScorePath(newPath);
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Duplicated as "${newName}".`);
}

/**
 * Rename Score: prompt for a new name for the current score.
 *
 * Under the Electron build the underlying folder is renamed
 * in place, which carries the .backups subfolder to the new
 * name; under the web build the score record is copied to
 * the new name and the old is deleted (no backups exist on
 * web). The in-memory bundle's edits, if any, are saved
 * under the new name after the rename, so an unsaved-state
 * rename produces a backup slot capturing the pre-rename
 * on-disk state and the new save lands cleanly. A rename
 * with no unsaved edits skips the save so no spurious
 * backup slot is created.
 *
 * Same-directory rename: the new path is the old path's
 * parent plus the new leaf with .gxs applied. Anywhere-save
 * in commit 3 will introduce a separate move flow if that's
 * ever needed; rename here only ever changes the leaf.
 *
 * @param {ScoreActionsContext} ctx
 */
export async function actionRenameScore(ctx) {
    const oldName = ctx.session.bundle.name;
    const oldPath = ctx.session.bundle.path;
    if (oldPath === null) {
        ctx.messages.write(
            `Cannot rename "${oldName}" — the score has not been saved yet.`,
            "error"
        );
        return;
    }
    const newName = await promptForUniqueName(
        `Rename "${oldName}" to:`,
        oldName,
        ctx.messages,
        /* allowCurrent */ oldName
    );
    if (newName === null || newName === oldName) return;

    const newPath = joinScorePath(dirname(oldPath), newName);

    try {
        await renameScoreRecord(oldPath, newPath);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.messages.write(
            `Could not rename "${oldName}" to "${newName}": ${msg}`,
            "error"
        );
        return;
    }

    ctx.session.bundle.name = newName;
    ctx.session.bundle.path = newPath;
    if (ctx.session.bundle.dirty) {
        // Persist any unsaved in-memory edits under the new
        // path. The save's normal backup-rotation captures
        // the just-renamed pre-edit state in slot 1.
        await ctx.session.bundle.save();
    }
    await setCurrentScorePath(newPath);
    ctx.session.refreshScoreNameDisplay();
    // Keep the Open Recent submenu's entry pointing at the
    // renamed score (without disturbing its position in the
    // list) so the menu doesn't end up with a stale entry
    // for the deleted oldPath plus no entry for the newPath
    // until something opens it next.
    renameInRecentScores(oldPath, newPath);
    ctx.messages.write(`Renamed "${oldName}" to "${newName}".`);
}

/**
 * Delete Score: confirm, then delete the current score and
 * switch to another one (or create a default if none left).
 * @param {ScoreActionsContext} ctx
 */
export async function actionDeleteScore(ctx) {
    const name = ctx.session.bundle.name;
    const path = ctx.session.bundle.path;
    if (path === null) {
        ctx.messages.write(
            `Cannot delete "${name}" — the score has not been saved yet.`,
            "error"
        );
        return;
    }
    const ok = window.confirm(
        `Delete score "${name}" permanently? This cannot be undone.`
    );
    if (!ok) return;

    await deleteScoreByPath(path);
    // Remove from the Open Recent submenu as well so the
    // menu doesn't keep a pointer at a score the user just
    // explicitly threw away.
    forgetScore(path);
    ctx.messages.write(`Deleted score "${name}".`);

    // Switch to another score if any exist; otherwise create a
    // fresh in-memory Untitled so the user always has something
    // open. Matching the new Logic-style New flow: the fallback
    // bundle isn't written to disk — the user just deleted a
    // score, they don't want another file appearing
    // automatically.
    const remaining = await listAvailableScores();
    let next;
    if (remaining.length > 0) {
        next = await loadScoreByPath(remaining[0].path);
    }
    if (!next) {
        next = createUntitledScore();
    }
    if (next.path !== null) {
        await setCurrentScorePath(next.path);
    }
    await ctx.session.switchToBundle(next);
}

// --- Export / Import / Backup / Restore ---

const EXPORT_FORMAT_VERSION = 1;

/**
 * Export the current score as a downloadable JSON file.
 * @param {ScoreActionsContext} ctx
 */
export async function actionExportScore(ctx) {
    const record = ctx.session.bundle.toRecord();
    const payload = {
        format: "gxw-score",
        version: EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        score: recordToJson(record),
    };
    const filename = `${sanitiseFilename(record.name)}.gxw-score.json`;
    downloadJson(payload, filename);
    ctx.messages.write(`Exported "${record.name}" to ${filename}.`);
}

/**
 * Import a previously-exported single-score JSON file.
 * @param {ScoreActionsContext} ctx
 */
export async function actionImportScore(ctx) {
    if (!(await confirmDiscardChanges(ctx))) return;
    const file = await chooseJsonFile();
    if (file === null) return;
    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch (err) {
        ctx.messages.write(`Could not parse "${file.name}" as JSON.`, "error");
        return;
    }
    if (payload.format !== "gxw-score" || !payload.score) {
        ctx.messages.write(
            `"${file.name}" is not a GXW score export.`,
            "error"
        );
        return;
    }
    const record = jsonToRecord(payload.score);
    const finalName = await resolveImportedName(record.name);
    if (finalName === null) {
        ctx.messages.write(`Import of "${record.name}" cancelled.`);
        return;
    }
    record.name = finalName;
    record.updatedAt = Date.now();
    const newPath = await composeScorePathFromName(finalName);
    await saveScoreRecord(newPath, record);

    const bundle = await loadScoreByPath(newPath);
    if (bundle === null) {
        ctx.messages.write(`Failed to import "${finalName}".`, "error");
        return;
    }
    await setCurrentScorePath(newPath);
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Imported "${finalName}".`);
}

/**
 * Back Up All Scores: download a JSON file containing every
 * score in IndexedDB.
 * @param {ScoreActionsContext} ctx
 */
export async function actionBackUpAllScores(ctx) {
    // Flush any pending changes to the current bundle first so
    // it's in the backup in its latest state.
    await ctx.session.bundle.save();

    const records = await loadAllScoreRecords();
    const payload = {
        format: "gxw-backup",
        version: EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        scores: records.map(recordToJson),
    };
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `gxw-backup-${dateStamp}.json`;
    downloadJson(payload, filename);
    ctx.messages.write(
        `Backed up ${records.length} score${records.length === 1 ? "" : "s"} to ${filename}.`
    );
}

/**
 * Restore Scores from Backup: read a backup JSON and merge
 * into IndexedDB. Prompts per collision.
 * @param {ScoreActionsContext} ctx
 */
export async function actionRestoreFromBackup(ctx) {
    const file = await chooseJsonFile();
    if (file === null) return;
    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch (err) {
        ctx.messages.write(`Could not parse "${file.name}" as JSON.`, "error");
        return;
    }
    if (payload.format !== "gxw-backup" || !Array.isArray(payload.scores)) {
        ctx.messages.write(
            `"${file.name}" is not a GXW backup file.`,
            "error"
        );
        return;
    }

    const existing = new Set(
        (await listAvailableScores()).map((s) => s.name)
    );
    let imported = 0;
    let skipped = 0;

    for (const scoreJson of payload.scores) {
        const record = jsonToRecord(scoreJson);
        let finalName = record.name;
        if (existing.has(finalName)) {
            const choice = await promptDialog({
                title: `A score named "${finalName}" already exists.`,
                description: "Type a new name to rename, leave the field as-is to overwrite, or cancel to skip.",
                defaultValue: finalName,
            });
            if (choice === null) {
                skipped++;
                continue;
            }
            finalName = choice.trim();
            if (finalName === "") {
                skipped++;
                continue;
            }
        }
        record.name = finalName;
        record.updatedAt = Date.now();
        const restorePath = await composeScorePathFromName(finalName);
        await saveScoreRecord(restorePath, record);
        existing.add(finalName);
        imported++;
    }

    ctx.messages.write(
        `Restored ${imported} score${imported === 1 ? "" : "s"}` +
        (skipped > 0 ? ` (${skipped} skipped).` : ".")
    );
}

// --- Open Score dialog ---

/**
 * @typedef {{ action: "open" | "duplicate", path: string, name: string } | null} OpenDialogResult
 */

/**
 * Show a modal dialog listing the stored scores. The user
 * picks a score (single-click to select, double-click to
 * Open) and then commits via one of the bottom buttons:
 * Open, Open as Duplicate, or Cancel.
 * @returns {Promise<OpenDialogResult>}
 */
async function openScoreDialog() {
    const scores = await listAvailableScores();

    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";

        const dialog = document.createElement("div");
        dialog.className = "modal-dialog";

        const title = document.createElement("h2");
        title.className = "modal-title";
        title.textContent = "Open Score";
        dialog.appendChild(title);

        /** @type {string | null} */
        let selectedPath = null;
        /** @type {string | null} */
        let selectedName = null;
        /** @type {HTMLElement | null} */
        let selectedEl = null;

        const selectRow = (
            /** @type {HTMLElement} */ el,
            /** @type {string} */ path,
            /** @type {string} */ name,
        ) => {
            if (selectedEl !== null) selectedEl.classList.remove("selected");
            selectedEl = el;
            selectedPath = path;
            selectedName = name;
            el.classList.add("selected");
            openBtn.disabled = false;
            duplicateBtn.disabled = false;
        };

        const commit = (/** @type {"open" | "duplicate"} */ action) => {
            if (selectedPath === null || selectedName === null) return;
            const path = selectedPath;
            const name = selectedName;
            cleanup();
            resolve({ action, path, name });
        };

        if (scores.length === 0) {
            const empty = document.createElement("div");
            empty.className = "modal-empty";
            empty.textContent = "No saved scores.";
            dialog.appendChild(empty);
        } else {
            const list = document.createElement("div");
            list.className = "modal-list";
            for (const s of scores) {
                const item = document.createElement("div");
                item.className = "modal-list-item";
                item.setAttribute("role", "button");
                item.setAttribute("tabindex", "0");

                const nameEl = document.createElement("div");
                nameEl.className = "modal-list-name";
                nameEl.textContent = s.name;
                item.appendChild(nameEl);

                const dateEl = document.createElement("div");
                dateEl.className = "modal-list-date";
                dateEl.textContent = formatDate(s.updatedAt);
                item.appendChild(dateEl);

                item.addEventListener("click", () => selectRow(item, s.path, s.name));
                item.addEventListener("dblclick", () => {
                    selectRow(item, s.path, s.name);
                    commit("open");
                });
                item.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        selectRow(item, s.path, s.name);
                        commit("open");
                    } else if (e.key === " ") {
                        e.preventDefault();
                        selectRow(item, s.path, s.name);
                    }
                });
                list.appendChild(item);
            }
            dialog.appendChild(list);
        }

        const buttons = document.createElement("div");
        buttons.className = "modal-buttons";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "modal-button";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => {
            cleanup();
            resolve(null);
        });

        const duplicateBtn = document.createElement("button");
        duplicateBtn.className = "modal-button";
        duplicateBtn.textContent = "Open as Duplicate";
        duplicateBtn.disabled = true;
        duplicateBtn.addEventListener("click", () => commit("duplicate"));

        const openBtn = document.createElement("button");
        openBtn.className = "modal-button modal-button-primary";
        openBtn.textContent = "Open";
        openBtn.disabled = true;
        openBtn.addEventListener("click", () => commit("open"));

        buttons.appendChild(cancelBtn);
        buttons.appendChild(duplicateBtn);
        buttons.appendChild(openBtn);
        dialog.appendChild(buttons);

        const onKey = (/** @type {KeyboardEvent} */ e) => {
            if (e.key === "Escape") {
                cleanup();
                resolve(null);
            }
        };
        const onOverlayClick = (/** @type {MouseEvent} */ e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(null);
            }
        };

        const cleanup = () => {
            document.removeEventListener("keydown", onKey);
            overlay.removeEventListener("click", onOverlayClick);
            overlay.remove();
        };

        document.addEventListener("keydown", onKey);
        overlay.addEventListener("click", onOverlayClick);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    });
}

// --- Helpers ---

/**
 * Prompt for a score name that is non-empty and (unless
 * allowCurrent matches) unique. Uniqueness is checked against
 * the display names returned by listAvailableScores, which on
 * the disk backend means "within the configured Scores
 * folder".
 * @param {string} message
 * @param {string} defaultValue
 * @param {MessageArea} messages
 * @param {string} [allowCurrent]  If set, this name is allowed
 *   even though it exists (for rename).
 * @returns {Promise<string | null>}
 */
async function promptForUniqueName(message, defaultValue, messages, allowCurrent) {
    const existing = new Set(
        (await listAvailableScores()).map((s) => s.name)
    );
    let value = defaultValue;
    let errorMessage = "";
    while (true) {
        const raw = await promptDialog({
            title: message,
            defaultValue: value,
            errorMessage,
        });
        if (raw === null) return null;
        const name = raw.trim();
        if (name === "") {
            value = raw;
            errorMessage = "Name cannot be empty.";
            continue;
        }
        if (name === allowCurrent) return name;
        if (existing.has(name)) {
            value = name;
            errorMessage = `A score named "${name}" already exists.`;
            continue;
        }
        return name;
    }
}

/**
 * @param {string} proposedName
 * @returns {Promise<string | null>}
 */
async function resolveImportedName(proposedName) {
    const existing = new Set(
        (await listAvailableScores()).map((s) => s.name)
    );
    if (!existing.has(proposedName)) return proposedName;
    let value = proposedName;
    let errorMessage = "";
    while (true) {
        const raw = await promptDialog({
            title: `A score named "${proposedName}" already exists.`,
            description: "Enter a new name, leave unchanged to overwrite, or cancel.",
            defaultValue: value,
            errorMessage,
        });
        if (raw === null) return null;
        const name = raw.trim();
        if (name === "") return null;
        if (name === proposedName) return name;  // overwrite
        if (!existing.has(name)) return name;
        value = name;
        errorMessage = "That name also exists. Please choose another.";
    }
}

/**
 * Convert a ScoreRecord to a plain JSON-safe object. Binary
 * file contents (ArrayBuffers) are base64-encoded into
 * strings with a marker so the importer can reverse them.
 * @param {import("./storage.js").ScoreRecord} record
 * @returns {unknown}
 */
function recordToJson(record) {
    /** @type {Object<string, unknown>} */
    const files = {};
    for (const name of Object.keys(record.files)) {
        const entry = record.files[name];
        if (typeof entry.content === "string") {
            files[name] = {
                mimeType: entry.mimeType,
                encoding: "utf-8",
                content: entry.content,
            };
        } else {
            files[name] = {
                mimeType: entry.mimeType,
                encoding: "base64",
                content: arrayBufferToBase64(entry.content),
            };
        }
    }
    return {
        name: record.name,
        files,
        imageName: record.imageName,
        updatedAt: record.updatedAt,
    };
}

/**
 * @param {unknown} json
 * @returns {import("./storage.js").ScoreRecord}
 */
function jsonToRecord(json) {
    const obj = /** @type {any} */ (json);
    /** @type {Object<string, import("./storage.js").BundleFileRecord>} */
    const files = {};
    for (const name of Object.keys(obj.files ?? {})) {
        const f = obj.files[name];
        if (f.encoding === "base64") {
            files[name] = {
                mimeType: f.mimeType,
                content: base64ToArrayBuffer(f.content),
            };
        } else {
            files[name] = {
                mimeType: f.mimeType,
                content: String(f.content ?? ""),
            };
        }
    }
    return {
        name: String(obj.name ?? "Untitled"),
        files,
        imageName: obj.imageName ?? null,
        updatedAt: Number(obj.updatedAt ?? Date.now()),
    };
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

/**
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * @param {unknown} payload
 * @param {string} filename
 */
function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @returns {Promise<File | null>}
 */
function chooseJsonFile() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.addEventListener("change", () => {
            resolve(input.files?.[0] ?? null);
        });
        // If the dialog is cancelled, change doesn't fire; we
        // simply never resolve. That's fine — the user can
        // initiate again.
        input.click();
    });
}

/**
 * @param {string} name
 * @returns {string}
 */
function sanitiseFilename(name) {
    return name.replace(/[^a-z0-9\-_ ]/gi, "_").replace(/\s+/g, "-");
}

/**
 * @param {number} ts
 * @returns {string}
 */
function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString();
}
