/**
 * IndexedDB persistence layer for GXW scores.
 *
 * The word "score" is the user-facing term; in code we still
 * call the data structure a Bundle because that's what it is
 * internally (a collection of files). A score is keyed by its
 * name, which is both its identifier in IndexedDB and its
 * label in the UI.
 *
 * Two object stores live in the GXW database:
 *   - scores: one record per score, keyed by name. The record
 *     carries the score's files and its imageName. Contains
 *     arbitrary binary content (images) as ArrayBuffer.
 *   - settings: small key-value store for app state like
 *     "which score is currently open?".
 *
 * IndexedDB's raw API is callback-based and verbose. This
 * module wraps it in promises so the calling code reads as
 * plain async/await.
 *
 * Persistent storage: on first load we ask the browser to
 * mark our origin's storage as persistent so the browser
 * doesn't evict the user's scores to free disk space. Granting
 * this is at the browser's discretion; on Safari and some
 * Chrome profiles it always succeeds, elsewhere it may require
 * bookmarking or frequent use.
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

/**
 * Ask the browser to persist our IndexedDB data against
 * eviction. No-op if the API is unavailable.
 * @returns {Promise<boolean>} Whether persistence was granted.
 */
export async function requestPersistentStorage() {
    if (!navigator.storage || typeof navigator.storage.persist !== "function") {
        return false;
    }
    try {
        return await navigator.storage.persist();
    } catch {
        return false;
    }
}

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
 * Save a score record under its name. Overwrites if a record
 * with that name already exists.
 * @param {ScoreRecord} record
 * @returns {Promise<void>}
 */
export async function saveScoreRecord(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readwrite");
        const store = tx.objectStore(SCORES_STORE);
        store.put(record);
        tx.oncomplete = () => {
            db.close();
            if (suppressedNames.has(record.name)) {
                suppressedNames.delete(record.name);
            } else {
                emitAfterSave(record);
            }
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Load a score record by name. Returns null if not found.
 * @param {string} name
 * @returns {Promise<ScoreRecord | null>}
 */
export async function loadScoreRecord(name) {
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
 * Delete a score record by name.
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function deleteScoreRecord(name) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SCORES_STORE, "readwrite");
        tx.objectStore(SCORES_STORE).delete(name);
        tx.oncomplete = () => {
            db.close();
            emitAfterDelete(name);
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * List all score names currently stored, with their last-
 * updated timestamps. Sorted most-recently-updated first.
 * @returns {Promise<Array<{name: string, updatedAt: number}>>}
 */
export async function listScores() {
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

/**
 * Load every score record. Used by the "Back Up All Scores"
 * action. Records are returned in no particular order.
 * @returns {Promise<ScoreRecord[]>}
 */
export async function loadAllScoreRecords() {
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

// --- Settings ---

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function getSetting(key) {
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
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE, "readwrite");
        tx.objectStore(SETTINGS_STORE).put(value, key);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
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
// The disk-mirror module subscribes to these so it can
// transparently push every IndexedDB save out to disk and
// delete folders when scores are deleted, without each calling
// site (score actions, editor save, etc.) having to remember
// to do it. Subscribers receive the operation arguments after
// the IndexedDB transaction completes successfully.

/** @typedef {(record: ScoreRecord) => void | Promise<void>} AfterSaveSubscriber */
/** @typedef {(name: string) => void | Promise<void>} AfterDeleteSubscriber */

/** @type {Set<AfterSaveSubscriber>} */
const afterSaveSubscribers = new Set();
/** @type {Set<AfterDeleteSubscriber>} */
const afterDeleteSubscribers = new Set();

/**
 * Subscribe to score-save events. Returns an unsubscribe
 * function. The callback fires after a successful IndexedDB
 * transaction; subscribers can read but should not mutate the
 * record.
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
// Used by the disk mirror to break the feedback loop: when an
// external change is detected on disk, we pull the new bundle
// and write it to IndexedDB so the two stay in sync. Without
// suppression, that write would trigger a push back to disk
// (which is what we just read from). The mirror calls
// `suppressNextSaveEmit(name)` immediately before writing so
// the very next save for that name doesn't fire its hook.

/** @type {Set<string>} */
const suppressedNames = new Set();

/**
 * Suppress the next save event for a particular score name.
 * The flag is consumed on the first save event matching that
 * name; subsequent saves emit normally.
 * @param {string} name
 */
export function suppressNextSaveEmit(name) {
    suppressedNames.add(name);
}
