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
 * collection of files). A score is keyed by its name.
 *
 * Two stores live in each backend:
 *   - scores: one record per score, keyed by name. The record carries
 *     the score's files and its imageName. Files contain arbitrary
 *     binary content (images) as ArrayBuffer, or text as string.
 *   - settings: small key-value store for app state like "which score
 *     is currently open?".
 *
 * The afterSaveScore / afterDeleteScore subscription mechanism was
 * originally used by a now-removed disk-mirror module to push IDB
 * writes out to disk. With the disk backend it's redundant (writes ARE
 * to disk), but the hooks remain available for any non-mirror
 * subscribers that may have layered on. suppressNextSaveEmit is a
 * no-op under the disk backend but still functional under IDB.
 */

// @ts-check

const DB_NAME = "gxw";
const DB_VERSION = 2;
const SCORES_STORE = "scores";
const SETTINGS_STORE = "settings";

const CURRENT_SCORE_KEY = "currentScoreName";

/**
 * @typedef {Object} BundleFileRecord
 * @property {string} mimeType
 * @property {string | ArrayBuffer} content
 */

/**
 * @typedef {Object} ScoreRecord
 * @property {string} name                   Unique display name and key.
 * @property {Object<string, BundleFileRecord>} files
 * @property {string | null} imageName
 * @property {number} updatedAt              Epoch milliseconds of last save.
 */

// --- Backend detection ---

const diskBackend =
    typeof window !== "undefined" &&
    typeof (/** @type {any} */ (window).gxwStorage) === "object" &&
    (/** @type {any} */ (window).gxwStorage) !== null
        ? /** @type {any} */ (window).gxwStorage
        : null;

const isDisk = diskBackend !== null;

// --- Public API: persistent storage hint ---

/**
 * Ask the browser to persist IndexedDB data against eviction. Under the
 * disk backend this is a no-op because the disk is already durable; we
 * return true so callers don't need to special-case the result.
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

// --- IDB internals (used only when the disk backend is absent) ---

/**
 * Open the GXW database, creating or upgrading its object stores as needed.
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

/** @param {ScoreRecord} record */
async function saveScoreRecordIdb(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readwrite");
        const store = tx.objectStore(SCORES_STORE);
        store.put(record);
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
 * @param {string} name
 * @returns {Promise<ScoreRecord | null>}
 */
async function loadScoreRecordIdb(name) {
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

/** @param {string} name */
async function deleteScoreRecordIdb(name) {
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

/** @returns {Promise<Array<{name: string, updatedAt: number}>>} */
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
// Each public function in the API picks its implementation once at module
// load time, then delegates. The hook plumbing (afterSave, afterDelete,
// suppression) sits at the public layer and fires uniformly regardless of
// which backend handled the underlying write.

const impl = isDisk
    ? {
        save: (/** @type {ScoreRecord} */ record) => diskBackend.saveScoreRecord(record),
        load: (/** @type {string} */ name) => diskBackend.loadScoreRecord(name),
        del:  (/** @type {string} */ name) => diskBackend.deleteScoreRecord(name),
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

// --- Public API ---

/**
 * Save a score record under its name. Overwrites if a record with that
 * name already exists.
 * @param {ScoreRecord} record
 * @returns {Promise<void>}
 */
export async function saveScoreRecord(record) {
    await impl.save(record);
    if (suppressedNames.has(record.name)) {
        suppressedNames.delete(record.name);
    } else {
        emitAfterSave(record);
    }
}

/**
 * Load a score record by name. Returns null if not found.
 * @param {string} name
 * @returns {Promise<ScoreRecord | null>}
 */
export async function loadScoreRecord(name) {
    return await impl.load(name);
}

/**
 * Delete a score record by name.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function deleteScoreRecord(name) {
    await impl.del(name);
    emitAfterDelete(name);
}

/**
 * List all score names currently stored, with their last-updated
 * timestamps. Sorted most-recently-updated first.
 * @returns {Promise<Array<{name: string, updatedAt: number}>>}
 */
export async function listScores() {
    return await impl.list();
}

/**
 * Load every score record. Used by the "Back Up All Scores" action.
 * Records are returned in no particular order.
 * @returns {Promise<ScoreRecord[]>}
 */
export async function loadAllScoreRecords() {
    return await impl.loadAll();
}

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
export async function getCurrentScoreName() {
    const v = await getSetting(CURRENT_SCORE_KEY);
    return typeof v === "string" ? v : null;
}

/** @param {string} name */
export async function setCurrentScoreName(name) {
    await setSetting(CURRENT_SCORE_KEY, name);
}

// --- Save / delete event hooks ---
//
// Renderer-local subscriptions. Fire after the underlying backend
// completes the operation, so subscribers see committed state.

/** @typedef {(record: ScoreRecord) => void | Promise<void>} AfterSaveSubscriber */
/** @typedef {(name: string) => void | Promise<void>} AfterDeleteSubscriber */

/** @type {Set<AfterSaveSubscriber>} */
const afterSaveSubscribers = new Set();
/** @type {Set<AfterDeleteSubscriber>} */
const afterDeleteSubscribers = new Set();

/**
 * Subscribe to score-save events. Returns an unsubscribe function.
 * @param {AfterSaveSubscriber} cb
 * @returns {() => void}
 */
export function subscribeAfterSaveScore(cb) {
    afterSaveSubscribers.add(cb);
    return () => afterSaveSubscribers.delete(cb);
}

/**
 * Subscribe to score-delete events. Returns an unsubscribe function.
 * @param {AfterDeleteSubscriber} cb
 * @returns {() => void}
 */
export function subscribeAfterDeleteScore(cb) {
    afterDeleteSubscribers.add(cb);
    return () => afterDeleteSubscribers.delete(cb);
}

/** @param {ScoreRecord} record */
function emitAfterSave(record) {
    for (const cb of afterSaveSubscribers) {
        try {
            void cb(record);
        } catch (err) {
            console.error("GXW: afterSaveScore subscriber threw.", err);
        }
    }
}

/** @param {string} name */
function emitAfterDelete(name) {
    for (const cb of afterDeleteSubscribers) {
        try {
            void cb(name);
        } catch (err) {
            console.error("GXW: afterDeleteScore subscriber threw.", err);
        }
    }
}

// --- Suppression: skip emitting save events for a given name ---
//
// Legacy hook from the IDB+disk-mirror era. The disk backend doesn't
// need it because there's no feedback loop, but the API stays available
// in case any other caller still uses it.

/** @type {Set<string>} */
const suppressedNames = new Set();

/**
 * Suppress the next save event for a particular score name. The flag is
 * consumed on the first save event matching that name; subsequent saves
 * emit normally.
 * @param {string} name
 */
export function suppressNextSaveEmit(name) {
    suppressedNames.add(name);
}
