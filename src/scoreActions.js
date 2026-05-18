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
    loadScoreByName,
    listAvailableScores,
    deleteScoreByName,
} from "./bundle.js";
import {
    saveScoreRecord,
    loadScoreRecord,
    loadAllScoreRecords,
    setCurrentScoreName,
} from "./storage.js";
import { promptDialog, confirmDiscardDialog } from "./dialog.js";

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
        await ctx.editor.save();
    }
    return true;
}

// --- Simple actions ---

/**
 * New Score: prompt for a name, create an empty score under
 * that name, switch to it.
 * @param {ScoreActionsContext} ctx
 */
export async function actionNewScore(ctx) {
    if (!(await confirmDiscardChanges(ctx))) return;
    const name = await promptForUniqueName("New score name:", "", ctx.messages);
    if (name === null) return;
    const bundle = await createNewScore(name);
    await setCurrentScoreName(name);
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Created score "${name}".`);
}

/**
 * Open Score: show a dialog listing stored scores. The user
 * picks one and commits with either Open (switch to it in
 * place) or Open as Duplicate (clone it and switch to the
 * clone, leaving the original untouched). Open as Duplicate
 * covers the "use any score as a template" workflow without
 * a separate templates concept.
 * @param {ScoreActionsContext} ctx
 */
export async function actionOpenScore(ctx) {
    const result = await openScoreDialog();
    if (result === null) return;
    if (result.action === "open") {
        if (result.name === ctx.session.bundle.name) return;
        if (!(await confirmDiscardChanges(ctx))) return;
        const bundle = await loadScoreByName(result.name);
        if (bundle === null) {
            ctx.messages.write(`Score "${result.name}" could not be found.`, "error");
            return;
        }
        await setCurrentScoreName(result.name);
        await ctx.session.switchToBundle(bundle);
        ctx.messages.write(`Switched to score "${result.name}".`);
    } else {
        if (!(await confirmDiscardChanges(ctx))) return;
        await actionOpenAsDuplicate(ctx, result.name);
    }
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
 * Duplicate an arbitrary stored score (not necessarily the
 * current one) into a new score and switch to it. Used by the
 * Open Score dialog's "Open as Duplicate" button.
 * @param {ScoreActionsContext} ctx
 * @param {string} sourceName
 */
export async function actionOpenAsDuplicate(ctx, sourceName) {
    const sourceRecord = await loadScoreRecord(sourceName);
    if (sourceRecord === null) {
        ctx.messages.write(`Score "${sourceName}" could not be found.`, "error");
        return;
    }
    const newName = await promptForUniqueName(
        `Duplicate "${sourceName}" as:`,
        `${sourceName} copy`,
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
    const record = {
        ...sourceRecord,
        name: newName,
        updatedAt: Date.now(),
    };
    await saveScoreRecord(record);

    const bundle = await loadScoreByName(newName);
    if (bundle === null) {
        ctx.messages.write(`Failed to create duplicate "${newName}".`, "error");
        return;
    }
    await setCurrentScoreName(newName);
    await ctx.session.switchToBundle(bundle);
    ctx.messages.write(`Duplicated as "${newName}".`);
}

/**
 * Rename Score: prompt for a new name for the current score.
 * @param {ScoreActionsContext} ctx
 */
export async function actionRenameScore(ctx) {
    const oldName = ctx.session.bundle.name;
    const newName = await promptForUniqueName(
        `Rename "${oldName}" to:`,
        oldName,
        ctx.messages,
        /* allowCurrent */ oldName
    );
    if (newName === null || newName === oldName) return;

    // Save under the new name, then delete the old. Going
    // through Bundle.save() keeps the dirty flag
    // synchronised: in-memory edits (if any) land on disk
    // under the new name and dirty clears cleanly.
    ctx.session.bundle.name = newName;
    await ctx.session.bundle.save();
    await deleteScoreByName(oldName);
    await setCurrentScoreName(newName);
    ctx.session.refreshScoreNameDisplay();
    ctx.messages.write(`Renamed "${oldName}" to "${newName}".`);
}

/**
 * Delete Score: confirm, then delete the current score and
 * switch to another one (or create a default if none left).
 * @param {ScoreActionsContext} ctx
 */
export async function actionDeleteScore(ctx) {
    const name = ctx.session.bundle.name;
    const ok = window.confirm(
        `Delete score "${name}" permanently? This cannot be undone.`
    );
    if (!ok) return;

    await deleteScoreByName(name);
    ctx.messages.write(`Deleted score "${name}".`);

    // Switch to another score if any exist; otherwise create a
    // fresh default so the user always has something open.
    const remaining = await listAvailableScores();
    let next;
    if (remaining.length > 0) {
        next = await loadScoreByName(remaining[0].name);
    }
    if (!next) {
        next = await createNewScore("Untitled");
    }
    await setCurrentScoreName(next.name);
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
    await saveScoreRecord(record);

    const bundle = await loadScoreByName(finalName);
    if (bundle === null) {
        ctx.messages.write(`Failed to import "${finalName}".`, "error");
        return;
    }
    await setCurrentScoreName(finalName);
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
        await saveScoreRecord(record);
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
 * @typedef {{ action: "open" | "duplicate", name: string } | null} OpenDialogResult
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
        let selectedName = null;
        /** @type {HTMLElement | null} */
        let selectedEl = null;

        const selectRow = (/** @type {HTMLElement} */ el, /** @type {string} */ name) => {
            if (selectedEl !== null) selectedEl.classList.remove("selected");
            selectedEl = el;
            selectedName = name;
            el.classList.add("selected");
            openBtn.disabled = false;
            duplicateBtn.disabled = false;
        };

        const commit = (/** @type {"open" | "duplicate"} */ action) => {
            if (selectedName === null) return;
            const name = selectedName;
            cleanup();
            resolve({ action, name });
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

                item.addEventListener("click", () => selectRow(item, s.name));
                item.addEventListener("dblclick", () => {
                    selectRow(item, s.name);
                    commit("open");
                });
                item.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        selectRow(item, s.name);
                        commit("open");
                    } else if (e.key === " ") {
                        e.preventDefault();
                        selectRow(item, s.name);
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
 * allowCurrent matches) unique.
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
