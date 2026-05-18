/**
 * Persistence layer for GXW scores.
 *
 * Two backends share the same public API:
 *   - Disk backend (Electron build): scores live as folders on disk,
 *     accessed via window.gxwStorage which the preload script exposes.
 *     Set up in electron-main.js and electron-preload.js.
 *   - IndexedDB backend (web build, no preload): scores live in the
 *     browser's IndexedDB, accessed via the IDB API directly. This is
 *     the original implementation.
 *
 * Backend selection happens once at module load by checking for
 * window.gxwStorage. The public API surface is identical either way.
 *
 * The word "score" is the user-facing term; in code we still call the
 * data structure a Bundle because that's what it is internally (a
 * collection of files).
 *
 * Score identity is a path string. On the disk backend a path is the
 * absolute filesystem path to the score's folder, ending in .gxs. On
 * the IDB backend a path is just `<name>.gxs` (no directory prefix,
 * since there's no filesystem). Both shapes carry the .gxs suffix so
 * scoreNameFromPath can extract the display name uniformly. The IDB
 * store still keys by display name internally; the path-to-name
 * translation happens inside the IDB-specific functions below.
 *
 * Two stores live in each backend:
 *   - scores: one record per score. The record carries the score's
 *     files and its imageName. Files contain arbitrary binary content
 *     (images) as ArrayBuffer, or text as string. The record's `name`
 *     field is the display name (no extension); the on-disk folder
 *     name is `<name>.gxs`.
 *   - settings: small key-value store for app state like "which score
 *     is currently open?". The current-score pointer is
 *     currentScorePath (full path on disk, or `<name>.gxs` on IDB).
 *     Older installs had currentScoreName (just a name); this is
 *     migrated to currentScorePath on first launch by
 *     migrateCurrentScoreSettingToPath.
 *
 * The afterSaveScore / afterDeleteScore subscription mechanism was
 * originally used by a now-removed disk-mirror module to push IDB
 * writes out to disk. With the disk backend it's redundant (writes ARE
 * to disk), but the hooks remain available for any non-mirror
 * subscribers that may have layered on. suppressNextSaveEmit is a
 * no-op under the disk backend but still functional under IDB.
 */

// @ts-check

import { getPreference } from "./preferences.js";

const DB_NAME = "gxw";
const DB_VERSION = 2;
const SCORES_STORE = "scores";
const SETTINGS_STORE = "settings";

const CURRENT_SCORE_PATH_KEY = "currentScorePath";
const LEGACY_CURRENT_SCORE_NAME_KEY = "currentScoreName";
const LAST_USED_DIRECTORY_KEY = "lastUsedDirectory";

const SCORE_FOLDER_EXTENSION = ".gxs";

/**
 * @typedef {Object} BundleFileRecord
 * @property {string} mimeType
 * @property {string | ArrayBuffer} content
 */

/**
 * @typedef {Object} ScoreRecord
 * @property {string} name                   Display name (no extension).
 * @property {Object<string, BundleFileRecord>} files
 * @property {string | null} imageName
 * @property {number} updatedAt              Epoch milliseconds of last save.
 */

/**
 * @typedef {Object} ScoreListEntry
 * @property {string} path        Unique identifier (absolute path on disk;
 *   `<name>.gxs` on IDB).
 * @property {string} name        Display name (no extension).
 * @property {number} updatedAt   Epoch milliseconds of last save.
 */

// --- Backend detection ---

const diskBackend =
    typeof window !== "undefined" &&
    typeof (/** @type {any} */ (window).gxwStorage) === "object" &&
    (/** @type {any} */ (window).gxwStorage) !== null
        ? /** @type {any} */ (window).gxwStorage
        : null;

const isDisk = diskBackend !== null;

// --- Path helpers ---
//
// Tiny string utilities for splitting and composing paths in the
// renderer. The renderer can't use Node's path module (sandboxed) so
// we make do with substring operations. Forward and backward slashes
// are both recognised as separators so the helpers behave correctly
// regardless of which platform the disk paths came from. On the IDB
// backend paths happen to be short (just `<name>.gxs` with no
// separator); the helpers fall through to the right thing.

/**
 * Extract the last path component. Returns the input unchanged when
 * no separator is present (e.g. an IDB path).
 * @param {string} p
 * @returns {string}
 */
export function basename(p) {
    const fwd = p.lastIndexOf("/");
    const bwd = p.lastIndexOf("\\");
    const idx = Math.max(fwd, bwd);
    return idx === -1 ? p : p.slice(idx + 1);
}

/**
 * Extract everything before the last path component. Returns the
 * empty string when no separator is present.
 * @param {string} p
 * @returns {string}
 */
export function dirname(p) {
    const fwd = p.lastIndexOf("/");
    const bwd = p.lastIndexOf("\\");
    const idx = Math.max(fwd, bwd);
    return idx === -1 ? "" : p.slice(0, idx);
}

/**
 * Compute the on-disk folder name for a display name. Always
 * appends the .gxs extension. Pure string operation; no I/O.
 * @param {string} name
 * @returns {string}
 */
export function scoreFolderName(name) {
    return name + SCORE_FOLDER_EXTENSION;
}

/**
 * Extract a display name from a folder name. Returns null when the
 * folder doesn't end in .gxs.
 * @param {string} folderName
 * @returns {string | null}
 */
export function scoreNameFromFolderName(folderName) {
    if (!folderName.endsWith(SCORE_FOLDER_EXTENSION)) return null;
    return folderName.slice(0, -SCORE_FOLDER_EXTENSION.length);
}

/**
 * Extract a display name from a path. Strips the .gxs extension
 * when present; returns the basename as-is otherwise. Robust
 * against both disk paths and IDB-style bare names.
 * @param {string} path
 * @returns {string}
 */
export function scoreNameFromPath(path) {
    const base = basename(path);
    const stripped = scoreNameFromFolderName(base);
    return stripped === null ? base : stripped;
}

/**
 * Compose a path from a directory and a display name. The .gxs
 * extension is applied automatically. An empty directory string
 * means "no directory prefix" — typical for the IDB backend
 * where paths are just `<name>.gxs`.
 * @param {string} dir
 * @param {string} name
 * @returns {string}
 */
export function joinScorePath(dir, name) {
    const leaf = scoreFolderName(name);
    if (dir === "") return leaf;
    const trailing = dir.endsWith("/") || dir.endsWith("\\");
    return trailing ? dir + leaf : dir + "/" + leaf;
}

// --- Scores folder location ---

/**
 * Return the absolute path to the configured Scores folder. On
 * the disk backend this comes from the gxw:get-scores-folder
 * IPC. On IDB there is no folder, so an empty string is
 * returned and composeScorePathFromName degenerates to
 * `scoreFolderName(name)`.
 * @returns {Promise<string>}
 */
export async function getScoresFolderPath() {
    if (!isDisk) return "";
    if (typeof diskBackend.getScoresFolder !== "function") return "";
    try {
        const folder = await diskBackend.getScoresFolder();
        return typeof folder === "string" ? folder : "";
    } catch (err) {
        console.warn("GXW: could not resolve Scores folder.", err);
        return "";
    }
}

/**
 * Compose a path for a score with the given display name,
 * defaulting to the configured Scores folder under the current
 * backend. Used by createNewScore and by the on-startup
 * migrations to resolve old name-only state into the new path
 * shape.
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function composeScorePathFromName(name) {
    const dir = await getScoresFolderPath();
    return joinScorePath(dir, name);
}

// --- IDB internals (used only when the disk backend is absent) ---

/**
 * Open the GXW database, creating or upgrading its object
 * stores as needed.
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SCORES_STORE)) {
                db.createObjectStore(SCORES_STORE, { keyPath: "name" });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * @param {string} path
 * @param {ScoreRecord} record
 */
async function saveScoreRecordIdb(path, record) {
    const name = scoreNameFromPath(path);
    const stored = { ...record, name };
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readwrite");
        const store = tx.objectStore(SCORES_STORE);
        store.put(stored);
        tx.oncomplete = () => {
            db.close();
            resolve(undefined);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * @param {string} path
 * @returns {Promise<ScoreRecord | null>}
 */
async function loadScoreRecordIdb(path) {
    const name = scoreNameFromPath(path);
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readonly");
        const store = tx.objectStore(SCORES_STORE);
        const req = store.get(name);
        req.onsuccess = () => {
            db.close();
            resolve(req.result ?? null);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * @param {string} path
 */
async function deleteScoreRecordIdb(path) {
    const name = scoreNameFromPath(path);
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readwrite");
        tx.objectStore(SCORES_STORE).delete(name);
        tx.oncomplete = () => {
            db.close();
            resolve(undefined);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/** @returns {Promise<ScoreListEntry[]>} */
async function listScoresIdb() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readonly");
        const store = tx.objectStore(SCORES_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
            db.close();
            const records = /** @type {ScoreRecord[]} */ (req.result ?? []);
            const list = records.map((r) => ({
                path: scoreFolderName(r.name),
                name: r.name,
                updatedAt: r.updatedAt ?? 0,
            }));
            list.sort((a, b) => b.updatedAt - a.updatedAt);
            resolve(list);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/** @returns {Promise<ScoreRecord[]>} */
async function loadAllScoreRecordsIdb() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readonly");
        const req = tx.objectStore(SCORES_STORE).getAll();
        req.onsuccess = () => {
            db.close();
            resolve(/** @type {ScoreRecord[]} */ (req.result ?? []));
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function getSettingIdb(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE, "readonly");
        const req = tx.objectStore(SETTINGS_STORE).get(key);
        req.onsuccess = () => {
            db.close();
            resolve(req.result);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * @param {string} key
 * @param {unknown} value
 */
async function setSettingIdb(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE, "readwrite");
        tx.objectStore(SETTINGS_STORE).put(value, key);
        tx.oncomplete = () => {
            db.close();
            resolve(undefined);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

// --- Backend dispatch ---
//
// Each public function in the API picks its implementation once
// at module load time, then delegates. The hook plumbing
// (afterSave, afterDelete, suppression) sits at the public
// layer and fires uniformly regardless of which backend handled
// the underlying write.

const impl = isDisk
    ? {
        save: (/** @type {string} */ path, /** @type {ScoreRecord} */ record) =>
            diskBackend.saveScoreRecord(path, record),
        load: (/** @type {string} */ path) => diskBackend.loadScoreRecord(path),
        del:  (/** @type {string} */ path) => diskBackend.deleteScoreRecord(path),
        list: () => diskBackend.listScores(),
        loadAll: () => diskBackend.loadAllScoreRecords(),
        getSet: (/** @type {string} */ key) => diskBackend.getSetting(key),
        setSet: (/** @type {string} */ key, /** @type {unknown} */ value) =>
            diskBackend.setSetting(key, value),
    }
    : {
        save: saveScoreRecordIdb,
        load: loadScoreRecordIdb,
        del:  deleteScoreRecordIdb,
        list: listScoresIdb,
        loadAll: loadAllScoreRecordsIdb,
        getSet: getSettingIdb,
        setSet: setSettingIdb,
    };

// --- Public API: persistent storage hint ---

/**
 * Ask the browser to persist IndexedDB data against eviction.
 * Under the disk backend this is a no-op because the disk is
 * already durable; we return true so callers don't need to
 * special-case the result.
 * @returns {Promise<boolean>}
 */
export async function requestPersistentStorage() {
    if (isDisk) return true;
    if (!navigator.storage || typeof navigator.storage.persist !== "function") {
        return false;
    }
    try {
        return await navigator.storage.persist();
    } catch {
        return false;
    }
}

// --- Public API: score records ---

/**
 * Save a score record at the given path. The on-disk folder is
 * created if it doesn't exist; existing content is overwritten.
 * The record's `name` field is forced to scoreNameFromPath(path)
 * before the write so the on-disk metadata stays consistent with
 * the folder name regardless of what the caller assembled.
 *
 * On the disk backend, the pre-save state of this score (if
 * any) is rotated into a numbered backup slot before the new
 * content is written, with the maximum slot count drawn from
 * the numBackupsToKeep preference. Backup rotation is best-
 * effort: if it fails (disk full, permissions, missing IPC
 * method on older Electron builds), the main save still
 * proceeds and the failure is surfaced through the backup
 * error reporter when one has been installed.
 *
 * @param {string} path
 * @param {ScoreRecord} record
 * @returns {Promise<void>}
 */
export async function saveScoreRecord(path, record) {
    const normalisedRecord = { ...record, name: scoreNameFromPath(path) };
    if (isDisk &&
        typeof diskBackend.rotateBackupsBeforeSave === "function") {
        try {
            const maxCount = /** @type {number} */ (
                getPreference("numBackupsToKeep")
            );
            await diskBackend.rotateBackupsBeforeSave(path, maxCount);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("GXW: backup rotation failed.", err);
            if (backupErrorReporter !== null) {
                backupErrorReporter(
                    `Could not back up "${normalisedRecord.name}": ${msg}`
                );
            }
        }
    }
    await impl.save(path, normalisedRecord);
    if (suppressedPaths.has(path)) {
        suppressedPaths.delete(path);
    } else {
        emitAfterSave(path, normalisedRecord);
    }
}

/**
 * Load a score record by path. Returns null if not found.
 * @param {string} path
 * @returns {Promise<ScoreRecord | null>}
 */
export async function loadScoreRecord(path) {
    return await impl.load(path);
}

/**
 * Delete a score record by path.
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function deleteScoreRecord(path) {
    await impl.del(path);
    emitAfterDelete(path);
}

/**
 * Rename a stored score from oldPath to newPath. Under the disk
 * backend with the renameScoreRecord IPC available this is a
 * single atomic folder rename so the score's .backups
 * subfolder follows it to the new location. Otherwise (IDB
 * build, or an older Electron build without the IPC), falls
 * back to load-old plus save-as-new plus delete-old.
 *
 * The direct disk path does not fire afterSave or afterDelete
 * because no record was created or removed — only the folder
 * name changed. The fallback path goes through the public
 * saveScoreRecord and deleteScoreRecord so those events fire
 * naturally for any subscriber that needs them.
 *
 * @param {string} oldPath
 * @param {string} newPath
 * @returns {Promise<void>}
 */
export async function renameScoreRecord(oldPath, newPath) {
    if (oldPath === newPath) return;
    if (isDisk && typeof diskBackend.renameScoreRecord === "function") {
        await diskBackend.renameScoreRecord(oldPath, newPath);
        return;
    }
    const record = await loadScoreRecord(oldPath);
    if (record === null) return;
    record.updatedAt = Date.now();
    await saveScoreRecord(newPath, record);
    await deleteScoreRecord(oldPath);
}

/**
 * List all stored scores with their paths, display names, and
 * last-updated timestamps. Sorted most-recently-updated first.
 * On the disk backend this scans the configured Scores folder
 * for .gxs subfolders; on IDB it returns every record in the
 * scores store.
 * @returns {Promise<ScoreListEntry[]>}
 */
export async function listScores() {
    return await impl.list();
}

/**
 * Load every score record. Used by the "Back Up All Scores"
 * action. Records are returned in no particular order.
 * @returns {Promise<ScoreRecord[]>}
 */
export async function loadAllScoreRecords() {
    return await impl.loadAll();
}

// --- Public API: settings ---

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
    return await impl.getSet(key);
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
    await impl.setSet(key, value);
}

/** @returns {Promise<string | null>} */
export async function getCurrentScorePath() {
    const v = await getSetting(CURRENT_SCORE_PATH_KEY);
    return typeof v === "string" && v !== "" ? v : null;
}

/** @param {string} path */
export async function setCurrentScorePath(path) {
    await setSetting(CURRENT_SCORE_PATH_KEY, path);
}

// --- Last-used directory ---
//
// Tracks the directory the user last picked in a Save panel
// (or any future anywhere-save flow). The Save panel and
// Open panel default to this directory when present, falling
// back to the configured Scores folder when not. Persisted
// across launches via the standard settings store.

/**
 * @returns {Promise<string | null>}
 */
export async function getLastUsedDirectory() {
    const v = await getSetting(LAST_USED_DIRECTORY_KEY);
    return typeof v === "string" && v !== "" ? v : null;
}

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function setLastUsedDirectory(dir) {
    if (typeof dir !== "string" || dir === "") return;
    await setSetting(LAST_USED_DIRECTORY_KEY, dir);
}

/**
 * Resolve the directory that a Save or Open dialog should
 * default to. Returns lastUsedDirectory when set, otherwise
 * the configured Scores folder. On the IDB backend this can
 * return the empty string (no filesystem); callers should
 * handle that case (it's not a Save-panel target there
 * anyway).
 * @returns {Promise<string>}
 */
export async function getDefaultSaveDirectory() {
    const remembered = await getLastUsedDirectory();
    if (remembered !== null) return remembered;
    return await getScoresFolderPath();
}

// --- Migrations ---

/**
 * One-time migration: if the legacy currentScoreName setting
 * is present but currentScorePath isn't, resolve the name
 * against the current Scores folder and write the path.
 * Idempotent — once the path setting is in place, subsequent
 * calls are no-ops. The legacy key is left in place rather
 * than deleted; it's harmless and deleting it would require an
 * extra IPC for a tiny benefit.
 *
 * Call from main.js's startup before resolveInitialBundle
 * reads currentScorePath.
 *
 * @returns {Promise<void>}
 */
export async function migrateCurrentScoreSettingToPath() {
    const existingPath = await getSetting(CURRENT_SCORE_PATH_KEY);
    if (typeof existingPath === "string" && existingPath !== "") return;
    const legacyName = await getSetting(LEGACY_CURRENT_SCORE_NAME_KEY);
    if (typeof legacyName !== "string" || legacyName === "") return;
    const resolved = await composeScorePathFromName(legacyName);
    await setCurrentScorePath(resolved);
}

// --- Numbered backups (disk backend only) ---

/**
 * @typedef {Object} BackupSlot
 * @property {number} slotNumber  1-based slot index. Slot 1 is the most
 *   recent backup; higher numbers are older.
 * @property {number} mtimeMs     Wall-clock ms timestamp at which this
 *   slot's contents were captured. Used by the File menu's Revert to
 *   submenu to render relative-date labels ("5 minutes ago", etc.).
 */

/**
 * List the numbered backup slots for a score, sorted with slot
 * 1 (most recent) first. Returns an empty array on the web
 * build, where backups aren't a feature.
 * @param {string} path
 * @returns {Promise<BackupSlot[]>}
 */
export async function listBackups(path) {
    if (!isDisk) return [];
    if (typeof diskBackend.listBackups !== "function") return [];
    return await diskBackend.listBackups(path);
}

/**
 * Load a specific numbered backup slot's content as a
 * ScoreRecord. The returned record's name field is the
 * original score's display name (the path's stem), so the
 * caller can pass it through the normal saveScoreRecord path
 * to commit a revert. Returns null on the web build or when
 * the slot doesn't exist.
 * @param {string} path
 * @param {number} slotNumber
 * @returns {Promise<ScoreRecord | null>}
 */
export async function loadBackupRecord(path, slotNumber) {
    if (!isDisk) return null;
    if (typeof diskBackend.loadBackupRecord !== "function") return null;
    return await diskBackend.loadBackupRecord(path, slotNumber);
}

// --- Backup error reporter ---
//
// Renderer-side install point for surfacing backup-rotation
// failures in the messages area. main.js wires this to
// messages.write on startup so the user sees a notice when a
// save's backup step failed. Defaults to null so reports are
// dropped silently before main.js has wired the reporter.

/** @type {((message: string) => void) | null} */
let backupErrorReporter = null;

/**
 * Install a function to receive backup-rotation error
 * messages. Pass null to clear.
 * @param {((message: string) => void) | null} fn
 */
export function setBackupErrorReporter(fn) {
    backupErrorReporter = fn;
}

// --- Save / delete event hooks ---
//
// Renderer-local subscriptions. Fire after the underlying
// backend completes the operation, so subscribers see
// committed state.
//
// The save subscriber gets the path the record was saved at
// along with the record itself, so subscribers can identify
// the score by its canonical id without inferring from
// record.name. The delete subscriber gets the path that was
// deleted; subscribers extract the display name via
// scoreNameFromPath when they need one.

/** @typedef {(path: string, record: ScoreRecord) => void | Promise<void>} AfterSaveSubscriber */
/** @typedef {(path: string) => void | Promise<void>} AfterDeleteSubscriber */

/** @type {Set<AfterSaveSubscriber>} */
const afterSaveSubscribers = new Set();
/** @type {Set<AfterDeleteSubscriber>} */
const afterDeleteSubscribers = new Set();

/**
 * Subscribe to score-save events. Returns an unsubscribe
 * function.
 * @param {AfterSaveSubscriber} cb
 * @returns {() => void}
 */
export function subscribeAfterSaveScore(cb) {
    afterSaveSubscribers.add(cb);
    return () => afterSaveSubscribers.delete(cb);
}

/**
 * Subscribe to score-delete events. Returns an unsubscribe
 * function.
 * @param {AfterDeleteSubscriber} cb
 * @returns {() => void}
 */
export function subscribeAfterDeleteScore(cb) {
    afterDeleteSubscribers.add(cb);
    return () => afterDeleteSubscribers.delete(cb);
}

/**
 * @param {string} path
 * @param {ScoreRecord} record
 */
function emitAfterSave(path, record) {
    for (const cb of afterSaveSubscribers) {
        try {
            void cb(path, record);
        } catch (err) {
            console.error("GXW: afterSaveScore subscriber threw.", err);
        }
    }
}

/** @param {string} path */
function emitAfterDelete(path) {
    for (const cb of afterDeleteSubscribers) {
        try {
            void cb(path);
        } catch (err) {
            console.error("GXW: afterDeleteScore subscriber threw.", err);
        }
    }
}

// --- Suppression: skip emitting save events for a given path ---
//
// Legacy hook from the IDB+disk-mirror era. The disk backend
// doesn't need it because there's no feedback loop, but the
// API stays available in case any other caller still uses it.

/** @type {Set<string>} */
const suppressedPaths = new Set();

/**
 * Suppress the next save event for a particular path. The
 * flag is consumed on the first save event matching that
 * path; subsequent saves emit normally.
 * @param {string} path
 */
export function suppressNextSaveEmit(path) {
    suppressedPaths.add(path);
}
