/**
 * Image gallery abstraction.
 *
 * Recent-image gallery state owner. Two backends share the
 * same public API and the renderer calls into this module
 * without caring which one is active:
 *
 *   - Electron backend: routes through window.gxwGallery
 *     (set up in electron-preload.js) which IPCs to the
 *     main process. Gallery metadata lives in settings.json
 *     under Application Support; full-resolution image
 *     copies live in a dedicated imageCache folder also
 *     under Application Support. Default cap 40 entries,
 *     configurable up to 200 via the Settings dialog (Stage
 *     5 wires the UI for that).
 *
 *   - Web backend: routes through IndexedDB directly,
 *     using the gallery object store added at DB_VERSION 3
 *     in storage.js. Each entry record carries both the
 *     metadata and the full-resolution image Blob inline.
 *     Cap is hardcoded at 12 entries — the small fixed
 *     value matches the web build's general "good enough
 *     for casual use, get the desktop app for serious
 *     work" stance, and keeps the IndexedDB footprint
 *     bounded.
 *
 * Backend selection happens once at module load by checking
 * for window.gxwGallery. The public API surface is
 * identical either way.
 *
 * Stable-position model. The gallery is ordered by
 * addedAt ascending — oldest entries at the front,
 * newest appended at the end. addedAt is immutable
 * after entry creation: gallery.add's match-and-promote
 * logic returns the matching entry's id without touching
 * its addedAt, and gallery.touch is a no-op for ordering.
 * The result is a curated-library feel where positions
 * stay stable across normal use (clicking thumbnails,
 * opening scores, importing duplicates), and only
 * explicit removes or eviction at cap can shift slots.
 * Eviction (when at cap) currently removes the oldest
 * entry by addedAt; the Stage 5 right-click Remove from
 * history surface will let users curate manually, and
 * the eviction policy can be revisited then.
 *
 * The Stage 2 scope is infrastructure only — no UI yet.
 * Stages 3 through 5 wire the gallery into the Canvas
 * inspector tab and into the existing image-import paths.
 * Testable in this stage by calling these functions from
 * the renderer console with sample data.
 */

// @ts-check

import { GALLERY_STORE } from "./storage.js";

const DB_NAME = "gxw";
const DB_VERSION = 3;

// Web-build cap. Fixed and not user-configurable; a small
// number keeps IndexedDB usage bounded and matches the
// design decision that the web build offers a curated
// taste of the desktop's full gallery rather than feature
// parity.
const WEB_MAX_COUNT = 12;

// Electron-build defaults. These match what gets persisted
// in settings.json under the imageGallery.maxCount field
// on first use; user can change the cap via the Settings
// dialog up to ELECTRON_MAX_COUNT_CEILING.
const ELECTRON_DEFAULT_MAX_COUNT = 40;
const ELECTRON_MAX_COUNT_CEILING = 200;
const ELECTRON_MAX_COUNT_FLOOR = 5;

/**
 * @typedef {Object} GalleryEntry
 * @property {string} id              Generated, "img_" prefix plus hex.
 * @property {string} sourcePath      Original source path (file system
 *   path under Electron, may be empty for pasted/in-memory sources).
 * @property {string} thumbnailBase64 96×96 PNG payload, no data-URL prefix.
 * @property {number} addedAt         Epoch milliseconds; recency key.
 * @property {string | null} contentHash  SHA-256 hex of the normalized
 *   image bytes, or null on entries that predate Stage 4. Used by
 *   gallery.add for content-addressable match-and-promote and by
 *   gallery.findByContentHash for direct lookup.
 */

/**
 * @typedef {Object} GalleryAddInput
 * @property {string} sourcePath      Identity for match-and-promote
 *   (legacy fallback; new code paths supply contentHash instead).
 * @property {ArrayBuffer} normalizedBytes  1000×1000 JPEG@70 bytes.
 * @property {string} thumbnailBase64 96×96 PNG payload.
 * @property {string} [contentHash]   SHA-256 hex of the normalized
 *   bytes; takes precedence over sourcePath in match-and-promote and
 *   gets stored on new entries.
 */

// --- Backend detection ---

const electronBackend =
    typeof window !== "undefined" &&
    typeof (/** @type {any} */ (window).gxwGallery) === "object" &&
    (/** @type {any} */ (window).gxwGallery) !== null
        ? /** @type {any} */ (window).gxwGallery
        : null;

const isElectron = electronBackend !== null;

// --- Public API ---

/**
 * Return the gallery's current entries (metadata only, no
 * image bytes) plus the active max-count. Entries are
 * sorted by addedAt ascending — oldest first, newest last.
 * @returns {Promise<{entries: GalleryEntry[], maxCount: number}>}
 */
export async function list() {
    if (isElectron) {
        return await electronBackend.list();
    }
    return await listWeb();
}

/**
 * Add an image to the gallery, or promote an existing
 * entry when the input's sourcePath matches one. The
 * normalizedBytes argument is what gets stored as the
 * full-resolution copy and what loadImage will later
 * return; callers are expected to have already passed
 * the bytes through imageNormalize.normalizeForCanvas
 * before reaching this method. The thumbnailBase64 is
 * separately generated via thumbnailGen.generateThumbnail.
 *
 * Returns the entry's id (which may be a newly-generated
 * one or the id of a promoted existing entry) plus the
 * full entries list after the operation.
 * @param {GalleryAddInput} input
 * @returns {Promise<{id: string, entries: GalleryEntry[]}>}
 */
export async function add(input) {
    if (isElectron) {
        return await electronBackend.add(input);
    }
    return await addWeb(input);
}

/**
 * Remove an entry by id. Deletes both the metadata record
 * and the full-resolution image copy. Returns the entries
 * list after removal. Unknown ids are a no-op.
 * @param {string} id
 * @returns {Promise<{entries: GalleryEntry[]}>}
 */
export async function remove(id) {
    if (isElectron) {
        return await electronBackend.remove(id);
    }
    return await removeWeb(id);
}

/**
 * Change the gallery's max-count cap (Electron only).
 * Reducing the cap triggers immediate eviction of entries
 * beyond the new cap, oldest-first. On the web build the
 * cap is fixed at WEB_MAX_COUNT and this method is a no-
 * op that returns the current state unchanged.
 * @param {number} n
 * @returns {Promise<{entries: GalleryEntry[], maxCount: number}>}
 */
export async function setMaxCount(n) {
    if (isElectron) {
        return await electronBackend.setMaxCount(n);
    }
    // Web cap is fixed; return current state.
    return await listWeb();
}

/**
 * No-op for ordering as of the stable-position model.
 * Kept in the API for forward compatibility — future
 * features that track per-entry usage (last-used
 * indicators, LRU-based eviction policy) may repurpose
 * this hook to update a separate lastUsedAt field
 * without affecting display order. Returns the current
 * entries list unchanged.
 *
 * History. Originally added in Stage 3 to bump an
 * entry's addedAt and promote it to slot 1 on click.
 * The Stage 4 follow-up redesign settled on stable
 * positions — a clicked or score-opened entry stays at
 * its existing slot rather than shuffling to the top.
 * touch's bump-addedAt behaviour was retired then; the
 * method itself remained for callers that may want the
 * hook back later.
 * @param {string} id
 * @returns {Promise<{entries: GalleryEntry[]}>}
 */
export async function touch(id) {
    if (isElectron) {
        return await electronBackend.touch(id);
    }
    return await touchWeb(id);
}

/**
 * Look up an entry by its content hash. Returns the
 * matching entry or null when no entry has that hash.
 * Added in Stage 4 of the Canvas inspector work as the
 * direct path for score-open recency: given the bundle's
 * imageContentHash, the open hook calls findByContentHash
 * first and either touches the existing entry or falls
 * back to gallery.add when no match is found. This avoids
 * computing a thumbnail in the common case (the entry
 * already exists from a prior import).
 * @param {string} contentHash
 * @returns {Promise<GalleryEntry | null>}
 */
export async function findByContentHash(contentHash) {
    if (isElectron) {
        return await electronBackend.findByContentHash(contentHash);
    }
    return await findByContentHashWeb(contentHash);
}

/**
 * Load the full-resolution image bytes for a gallery entry.
 * Returns {bytes, mimeType} suitable for handing to
 * canvas.setImage. Throws if the entry doesn't exist or
 * the cache copy can't be read.
 * @param {string} id
 * @returns {Promise<{bytes: ArrayBuffer, mimeType: string}>}
 */
export async function loadImage(id) {
    if (isElectron) {
        return await electronBackend.loadImage(id);
    }
    return await loadImageWeb(id);
}

// --- Web (IndexedDB) backend ---
//
// Opens its own connections via the shared "gxw" database
// at DB_VERSION 3. The gallery store was created in
// storage.js's upgrade handler at the same version; this
// module assumes it exists and doesn't try to create it
// itself. Each operation opens a transaction, runs, and
// closes the connection — matching the pattern in
// storage.js's IDB helpers so we don't end up with two
// modules holding long-lived connections to the same DB.

/**
 * Open the GXW database. Reads only — the upgrade handler
 * in storage.js owns schema creation, including the
 * gallery store. We open at the same DB_VERSION here so
 * the IDB API doesn't try to upgrade unnecessarily.
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        // If for any reason we're the first to open the DB
        // and storage.js hasn't run yet, the upgrade
        // handler here also creates the gallery store as a
        // defensive backstop. Schema-creation idempotency
        // (the same `if (!db.objectStoreNames.contains)`
        // check both modules use) means a duplicate path
        // is harmless.
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(GALLERY_STORE)) {
                db.createObjectStore(GALLERY_STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Read all gallery records, strip image Blobs, sort by
 * addedAt ascending (oldest first).
 * @returns {Promise<{entries: GalleryEntry[], maxCount: number}>}
 */
async function listWeb() {
    const db = await openDb();
    /** @type {any[]} */
    const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readonly");
        const req = tx.objectStore(GALLERY_STORE).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
    });
    db.close();
    const entries = records
        .map(toEntry)
        .sort((a, b) => a.addedAt - b.addedAt);
    return { entries, maxCount: WEB_MAX_COUNT };
}

/**
 * Add or promote an entry in the web backend.
 * @param {GalleryAddInput} input
 * @returns {Promise<{id: string, entries: GalleryEntry[]}>}
 */
async function addWeb(input) {
    const db = await openDb();
    try {
        const contentHash = typeof input.contentHash === "string" && input.contentHash !== ""
            ? input.contentHash
            : null;

        // Match-by-hash-or-sourcePath: when an entry
        // already exists (by content hash, falling back to
        // sourcePath for legacy entries that predate the
        // hash), return its id without mutating addedAt. The
        // stable-position model treats addedAt as immutable
        // after creation, so re-importing the same image is
        // a no-op for slot ordering. We do backfill
        // contentHash on existing entries that lack one,
        // since that's a metadata correction rather than a
        // sort-affecting change.
        let existing = null;
        if (contentHash !== null) {
            existing = await findByContentHashInternalWeb(db, contentHash);
        }
        if (existing === null && input.sourcePath !== "") {
            existing = await findBySourcePath(db, input.sourcePath);
        }
        if (existing !== null) {
            if (contentHash !== null && existing.contentHash !== contentHash) {
                existing.contentHash = contentHash;
                await putRecord(db, existing);
            }
            const entries = await listAllSorted(db);
            return { id: existing.id, entries };
        }

        // New entry. Encode the bytes as a Blob for IDB
        // storage; Blob is the natural shape IDB
        // serialises efficiently and what loadImageWeb
        // will pull back out.
        const newRecord = {
            id: generateGalleryId(),
            sourcePath: input.sourcePath,
            thumbnailBase64: input.thumbnailBase64,
            addedAt: Date.now(),
            contentHash,
            imageBlob: new Blob(
                [input.normalizedBytes],
                { type: "image/jpeg" },
            ),
        };

        // Eviction if at cap. Sort ascending so the
        // oldest entries are at the front; remove from
        // there until we have room for the new entry.
        // Note: evicting oldest contradicts the stable-
        // position intent for entries that have been in
        // the gallery a long time. Settled as a Stage 5
        // design question — the Remove from history
        // right-click surface and the max-count Setting
        // will rework this together.
        const all = await listAllSorted(db);
        if (all.length >= WEB_MAX_COUNT) {
            const overage = all.length - WEB_MAX_COUNT + 1;
            // all is sorted oldest-first, so the head is
            // the eviction candidates.
            const toEvict = all.slice(0, overage);
            for (const e of toEvict) {
                await deleteRecord(db, e.id);
            }
        }
        await putRecord(db, newRecord);
        const entries = await listAllSorted(db);
        return { id: newRecord.id, entries };
    } finally {
        db.close();
    }
}

/**
 * Remove an entry from the web backend.
 * @param {string} id
 * @returns {Promise<{entries: GalleryEntry[]}>}
 */
async function removeWeb(id) {
    const db = await openDb();
    try {
        await deleteRecord(db, id);
        const entries = await listAllSorted(db);
        return { entries };
    } finally {
        db.close();
    }
}

/**
 * No-op stub matching the touch() public API. Reads the
 * current entries and returns them unchanged. See the
 * touch() docblock for why this is intentional.
 * @param {string} id
 * @returns {Promise<{entries: GalleryEntry[]}>}
 */
async function touchWeb(id) {
    const db = await openDb();
    try {
        // id parameter is accepted for forward
        // compatibility but unused in the no-op model.
        void id;
        const entries = await listAllSorted(db);
        return { entries };
    } finally {
        db.close();
    }
}

/**
 * Find an entry by content hash in the web backend.
 * Returns the entry shape (no inline imageBlob) or null
 * when no match. Public wrapper around the db-bound
 * helper below.
 * @param {string} contentHash
 * @returns {Promise<GalleryEntry | null>}
 */
async function findByContentHashWeb(contentHash) {
    const db = await openDb();
    try {
        const record = await findByContentHashInternalWeb(db, contentHash);
        if (record === null) return null;
        return toEntry(record);
    } finally {
        db.close();
    }
}

/**
 * Internal helper: find the first entry whose contentHash
 * equals the given hash. Returns the raw record (with
 * inline imageBlob) so callers inside an open transaction
 * can mutate and putRecord it back without a second read.
 * Returns null when no entry matches.
 * @param {IDBDatabase} db
 * @param {string} contentHash
 * @returns {Promise<any | null>}
 */
function findByContentHashInternalWeb(db, contentHash) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readonly");
        const req = tx.objectStore(GALLERY_STORE).getAll();
        req.onsuccess = () => {
            const records = /** @type {any[]} */ (req.result ?? []);
            for (const r of records) {
                if (typeof r.contentHash === "string" && r.contentHash === contentHash) {
                    resolve(r);
                    return;
                }
            }
            resolve(null);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Load full-resolution bytes for an entry from the web
 * backend.
 * @param {string} id
 * @returns {Promise<{bytes: ArrayBuffer, mimeType: string}>}
 */
async function loadImageWeb(id) {
    const db = await openDb();
    /** @type {any} */
    const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readonly");
        const req = tx.objectStore(GALLERY_STORE).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
    db.close();
    if (record === null) {
        throw new Error(`Gallery entry "${id}" not found.`);
    }
    const blob = record.imageBlob;
    if (!(blob instanceof Blob)) {
        throw new Error(`Gallery entry "${id}" has no image blob.`);
    }
    const bytes = await blob.arrayBuffer();
    return { bytes, mimeType: blob.type || "image/jpeg" };
}

/**
 * Internal helper: find the first entry whose sourcePath
 * equals the given path. Returns null if none.
 * @param {IDBDatabase} db
 * @param {string} sourcePath
 * @returns {Promise<any | null>}
 */
function findBySourcePath(db, sourcePath) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readonly");
        const req = tx.objectStore(GALLERY_STORE).getAll();
        req.onsuccess = () => {
            const records = /** @type {any[]} */ (req.result ?? []);
            for (const r of records) {
                if (r.sourcePath === sourcePath) {
                    resolve(r);
                    return;
                }
            }
            resolve(null);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * @param {IDBDatabase} db
 * @returns {Promise<GalleryEntry[]>}
 */
async function listAllSorted(db) {
    /** @type {any[]} */
    const records = await new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readonly");
        const req = tx.objectStore(GALLERY_STORE).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
    });
    return records
        .map(toEntry)
        .sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * @param {IDBDatabase} db
 * @param {any} record
 */
function putRecord(db, record) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readwrite");
        tx.objectStore(GALLERY_STORE).put(record);
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 */
function deleteRecord(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(GALLERY_STORE, "readwrite");
        tx.objectStore(GALLERY_STORE).delete(id);
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Strip the inline imageBlob from a stored record and
 * return the metadata-only entry shape.
 * @param {any} record
 * @returns {GalleryEntry}
 */
function toEntry(record) {
    return {
        id: record.id,
        sourcePath: record.sourcePath ?? "",
        thumbnailBase64: record.thumbnailBase64 ?? "",
        addedAt: typeof record.addedAt === "number" ? record.addedAt : 0,
        contentHash: typeof record.contentHash === "string" ? record.contentHash : null,
    };
}

/**
 * Generate a fresh gallery entry id. "img_" prefix matches
 * the SPR/TRG/CRV conventions; the suffix is 12 random
 * hex characters via crypto.getRandomValues, which is
 * plenty unique for a gallery capped at 200 entries.
 * @returns {string}
 */
function generateGalleryId() {
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    let hex = "";
    for (const b of buf) {
        hex += b.toString(16).padStart(2, "0");
    }
    return "img_" + hex;
}

// --- Re-exports for callers that need the constants ---

export {
    WEB_MAX_COUNT,
    ELECTRON_DEFAULT_MAX_COUNT,
    ELECTRON_MAX_COUNT_CEILING,
    ELECTRON_MAX_COUNT_FLOOR,
};
