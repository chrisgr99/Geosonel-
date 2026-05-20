/**
 * Bundle module.
 *
 * A Bundle is the internal data structure for a score. The
 * user-facing term is "score"; code still says "bundle" because
 * that's what the data structure is (a collection of files).
 *
 * A bundle carries:
 *   - A name (also its IndexedDB key).
 *   - A list of files, each either text (JavaScript sources the
 *     composer edits) or binary (imported images).
 *   - An imageName pointing to which binary file, if any, is the
 *     current background image. Null means no image, which is a
 *     first-class valid state.
 *
 * Persistence flows through src/storage.js. Bundles can round-
 * trip through its ScoreRecord format.
 */

// @ts-check

import {
    saveScoreRecord,
    loadScoreRecord,
    deleteScoreRecord,
    listScores,
    composeScorePathFromName,
} from "./storage.js";
import { getPreference } from "./preferences.js";

/**
 * @typedef {Object} TextFile
 * @property {"text"} kind
 * @property {string} name
 * @property {string} mimeType
 * @property {string} content
 */

/**
 * @typedef {Object} BinaryFile
 * @property {"binary"} kind
 * @property {string} name
 * @property {string} mimeType
 * @property {ArrayBuffer} content
 */

/** @typedef {TextFile | BinaryFile} BundleFile */

export class Bundle {
    /**
     * @param {string} name
     * @param {string | null} [path]  Absolute folder path on disk (or
     *   `<name>.gxs` on the IDB backend) where this bundle lives. Null
     *   for an in-memory bundle that hasn't been saved yet — the
     *   commit-3 Untitled flow. Bundle.save() requires a non-null path;
     *   callers in the Untitled state route through Save As to set one.
     */
    constructor(name, path = null) {
        /** @type {string} */
        this.name = name;

        /**
         * Storage path identifying where this bundle lives. Distinct
         * from `name` (the display string): the path is the unique
         * key used by storage.js and the IPC layer, while the name
         * appears in the title bar, menus, and messages. They're kept
         * in sync by construction: scoreNameFromPath(this.path)
         * equals this.name for any saved bundle.
         * @type {string | null}
         */
        this.path = path;

        /** @type {BundleFile[]} */
        this.files = [];

        /**
         * Name of the file currently acting as the background
         * image, or null if the score has no image. Null is a
         * valid end state — not all scores use images.
         * @type {string | null}
         */
        this.imageName = null;

        /**
         * SHA-256 hex digest of the current image's
         * normalized bytes, or null when the bundle has no
         * image. Added in Stage 4 of the Canvas inspector
         * work as the stable identity that links a score's
         * background to a gallery entry. Computed once at
         * import time by imageImporter and round-tripped
         * through storage; see src/imageHash.js for the
         * compute path and DESIGN.md Section 13.5 for the
         * design rationale. Older scores predate this
         * field and load with null; the score-open hook
         * in main.js fills it on demand when syncing the
         * gallery, without forcing a save — the migrated
         * value is recomputed each open until the next
         * natural save persists it.
         * @type {string | null}
         */
        this.imageContentHash = null;

        /**
         * Has this bundle been mutated since its last save?
         * The canonical dirty signal for the score; subscribers
         * (title bar, saved indicator, close-with-unsaved-changes
         * dialog) read this via subscribeDirtyChange. Mutation
         * methods on this class set it to true automatically;
         * save() clears it. A freshly-loaded or freshly-saved
         * bundle is by definition not dirty.
         * @type {boolean}
         */
        this.dirty = false;

        /**
         * Subscribers fired whenever dirty transitions.
         * @type {Set<(dirty: boolean) => void>}
         */
        this._dirtyListeners = new Set();

        /**
         * Per-text-file content snapshots at last save (or
         * initial load). Drives isFileDirty(): compares the
         * current in-memory content of a text file against the
         * snapshot to decide whether that specific file carries
         * unsaved edits. Populated by fromRecord() and save()
         * so it always reflects the bundle's last-disk state.
         * The editor's per-tab dot indicators consume this; the
         * canonical bundle-wide dirty flag remains the existing
         * `dirty` boolean.
         * @type {Map<string, string>}
         */
        this._lastSavedFiles = new Map();
    }

    // --- Dirty state ---

    /**
     * Subscribe to dirty-state transitions. The callback fires
     * on every false→true or true→false change. Returns an
     * unsubscribe function.
     * @param {(dirty: boolean) => void} cb
     * @returns {() => void}
     */
    subscribeDirtyChange(cb) {
        this._dirtyListeners.add(cb);
        return () => this._dirtyListeners.delete(cb);
    }

    /**
     * Mark the bundle dirty. Called automatically by every
     * data-mutating method below; external callers usually
     * don't need to call this directly.
     */
    markDirty() {
        this._setDirty(true);
    }

    /**
     * Mark the bundle clean. Called by save() after a
     * successful write; external callers can use this when
     * they've persisted the bundle out-of-band and want the
     * UI to reflect it.
     */
    markClean() {
        this._setDirty(false);
    }

    /**
     * @param {boolean} value
     */
    _setDirty(value) {
        if (this.dirty === value) return;
        this.dirty = value;
        for (const cb of this._dirtyListeners) {
            try {
                cb(value);
            } catch (err) {
                console.error("GXW: bundle dirty listener threw.", err);
            }
        }
    }

    /**
     * Refresh the per-text-file last-saved snapshot from the
     * current in-memory text-file content. Called whenever
     * the bundle's disk state becomes the in-memory state,
     * which is after fromRecord and after save. Binary files
     * are not snapshotted; per-tab dirty detection only cares
     * about the text tabs (Properties JSON and Code).
     */
    _captureSavedSnapshot() {
        this._lastSavedFiles.clear();
        for (const f of this.files) {
            if (f.kind === "text") {
                this._lastSavedFiles.set(f.name, f.content);
            }
        }
    }

    /**
     * Per-file dirty state for a text file: true when its
     * in-memory content differs from the last-saved snapshot.
     * Returns false when the file is unknown to the bundle.
     * A text file present in the bundle but absent from the
     * snapshot (added since the last save) is reported dirty.
     * The editor's per-tab dot indicators read this; the
     * bundle-wide `dirty` flag remains the canonical signal
     * for everything else.
     * @param {string} name
     * @returns {boolean}
     */
    isFileDirty(name) {
        const file = this.getFile(name);
        if (file === null) return false;
        const saved = this._lastSavedFiles.get(name);
        if (saved === undefined) return true;
        return file.content !== saved;
    }

    // --- Text file operations ---

    /**
     * Add a text file to the bundle.
     * @param {string} name
     * @param {string} content
     * @param {string} [mimeType]
     */
    addTextFile(name, content, mimeType = "text/javascript") {
        this.files.push({ kind: "text", name, mimeType, content });
    }

    /**
     * Editor-facing: text files only.
     * @returns {TextFile[]}
     */
    get textFiles() {
        return /** @type {TextFile[]} */ (
            this.files.filter((f) => f.kind === "text")
        );
    }

    /**
     * Look up a text file by name. Returns null if not found or
     * if the file is binary.
     * @param {string} name
     * @returns {TextFile | null}
     */
    getFile(name) {
        const f = this.files.find((f) => f.name === name && f.kind === "text");
        return f === undefined ? null : /** @type {TextFile} */ (f);
    }

    /**
     * Update a text file's content and mark the bundle dirty.
     * The save model is explicit: typing or programmatic edits
     * mutate in-memory state and set the dirty flag, but nothing
     * persists to disk until save() is called.
     * @param {string} name
     * @param {string} content
     */
    updateContent(name, content) {
        const file = this.getFile(name);
        if (file === null) return;
        file.content = content;
        this.markDirty();
    }

    // --- Binary file operations (image importer-facing) ---

    /**
     * Add or replace a binary file in the bundle and mark dirty.
     * @param {string} name
     * @param {ArrayBuffer} content
     * @param {string} mimeType
     */
    setBinaryFile(name, content, mimeType) {
        const existingIndex = this.files.findIndex((f) => f.name === name);
        /** @type {BinaryFile} */
        const file = { kind: "binary", name, mimeType, content };
        if (existingIndex >= 0) {
            this.files[existingIndex] = file;
        } else {
            this.files.push(file);
        }
        this.markDirty();
    }

    /**
     * @param {string} name
     * @returns {BinaryFile | null}
     */
    getBinaryFile(name) {
        const f = this.files.find((f) => f.name === name && f.kind === "binary");
        return f === undefined ? null : /** @type {BinaryFile} */ (f);
    }

    /**
     * Remove a file from the bundle and mark dirty. If the
     * removed file was the current image, imageName is cleared.
     * @param {string} name
     */
    removeFile(name) {
        const before = this.files.length;
        this.files = this.files.filter((f) => f.name !== name);
        if (this.imageName === name) this.imageName = null;
        if (this.files.length !== before) this.markDirty();
    }

    /**
     * Replace the bundle's current image with fresh bytes.
     * Removes any prior image file, then adds the new one and
     * marks it as current. The contentHash argument is the
     * SHA-256 hex of the normalized bytes computed by the
     * caller (typically imageImporter via src/imageHash.js);
     * pass null when the caller has no hash to supply, and
     * the imageContentHash field is cleared so a downstream
     * gallery-sync pass can recompute on demand.
     * @param {string} name
     * @param {ArrayBuffer} content
     * @param {string} mimeType
     * @param {string | null} [contentHash]
     */
    replaceImage(name, content, mimeType, contentHash = null) {
        if (this.imageName !== null && this.imageName !== name) {
            this.removeFile(this.imageName);
        }
        this.setBinaryFile(name, content, mimeType);
        this.imageName = name;
        // Track the hash alongside the imageName. A null
        // value here forces gallery-sync to recompute next
        // open; we don't recompute internally because the
        // bundle stays a pure data structure (no
        // dependency on Web Crypto from here).
        this.imageContentHash = contentHash;
    }

    /**
     * Remove the current image from the bundle.
     */
    removeImage() {
        if (this.imageName !== null) {
            this.removeFile(this.imageName);
        }
        // Clear the hash too. removeFile clears imageName
        // via its own logic, but the hash is an independent
        // field that needs explicit clearing.
        this.imageContentHash = null;
    }

    /**
     * @returns {BinaryFile | null}
     */
    getCurrentImage() {
        if (this.imageName === null) return null;
        return this.getBinaryFile(this.imageName);
    }

    // --- Persistence ---

    /**
     * Serialise to a record suitable for IndexedDB storage.
     * @returns {import("./storage.js").ScoreRecord}
     */
    toRecord() {
        /** @type {Object<string, import("./storage.js").BundleFileRecord>} */
        const files = {};
        for (const f of this.files) {
            files[f.name] = { mimeType: f.mimeType, content: f.content };
        }
        return {
            name: this.name,
            files,
            imageName: this.imageName,
            imageContentHash: this.imageContentHash,
            updatedAt: Date.now(),
        };
    }

    /**
     * Rehydrate a Bundle from a stored record. The result is
     * marked clean regardless of which file kinds were loaded,
     * because a bundle just read from disk is by definition in
     * sync with disk.
     * @param {import("./storage.js").ScoreRecord} record
     * @param {string} path   Storage path the record was loaded from.
     *   Becomes the bundle's identity for subsequent saves.
     * @returns {Bundle}
     */
    static fromRecord(record, path) {
        const bundle = new Bundle(record.name, path);
        for (const name of Object.keys(record.files)) {
            const entry = record.files[name];
            if (typeof entry.content === "string") {
                bundle.addTextFile(name, entry.content, entry.mimeType);
            } else {
                bundle.setBinaryFile(name, entry.content, entry.mimeType);
            }
        }
        bundle.imageName = record.imageName;
        // Older records predate imageContentHash and load
        // with undefined here; coerce to null so the field's
        // type stays string | null at runtime. The score-
        // open hook in main.js handles the migration by
        // recomputing on demand.
        bundle.imageContentHash = typeof record.imageContentHash === "string"
            ? record.imageContentHash
            : null;
        bundle._captureSavedSnapshot();
        bundle.markClean();
        return bundle;
    }

    /**
     * Persist this bundle to its current path and clear the dirty
     * flag. Throws when the bundle has no path — the Untitled
     * flow's first save must go through Save As, which sets a path
     * before calling save(). Disk mirroring (when configured) is
     * triggered transparently via the afterSave event hook in
     * storage.js; this method doesn't need to know anything about
     * it.
     *
     * The dirty flag is cleared after the underlying write
     * resolves, so a save() that throws leaves the bundle in its
     * previous dirty state and subscribers still see the unsaved-
     * changes signal.
     */
    async save() {
        if (this.path === null) {
            throw new Error(
                "Bundle.save called on an untitled bundle; use Save As to set a path first."
            );
        }
        await saveScoreRecord(this.path, this.toRecord());
        this._captureSavedSnapshot();
        this.markClean();
    }
}

/**
 * Produce the contents of a freshly-created score. The score
 * holds two text files: scene.json (declarative data, edited
 * via the Properties tab and a future property panel) and
 * behaviors.js (named function definitions, edited via the
 * Behaviors tab). The scene loader stitches them together
 * at run time. See DESIGN.md v2.4 for the data and behaviour
 * split, and §9 for the slot-naming convention used in the
 * template below.
 *
 * @param {string} name
 * @returns {Bundle}
 */
export function makeEmptyBundle(name) {
    const bundle = new Bundle(name);

    // Per-score display scales are baked into scene.json at
    // creation time, seeded from the user's defaultTriggerScale
    // and defaultSpriteScale preferences. Once stored in the
    // score they stay put — changing the preference later
    // doesn't reach back into existing scores. spriteScale is
    // part of the music (it changes how sprites bounce off
    // canvas walls); triggerScale is purely visual but still
    // travels with the score so visual layout is consistent
    // across users. Both can be edited later via the Properties
    // tab if the composer wants to fine-tune.
    const triggerScale = getPreference("defaultTriggerScale");
    const spriteScale = getPreference("defaultSpriteScale");

    bundle.addTextFile(
        "scene.json",
        `{
  "bpm": 120,
  "tonic": "C",
  "scaleName": "C major",
  "triggerScale": ${triggerScale},
  "spriteScale": ${spriteScale},

  "curves": [
    {
      "id": "CRV1",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 12, "h": 12 },
      "cursorR": 2,
      "cursorL": 0
    }
  ],

  "triggers": [
    { "id": "TRG1", "x":  9, "y":  0, "note": 60 },
    { "id": "TRG2", "x": -9, "y":  0, "note": 64 },
    { "id": "TRG3", "x":  0, "y":  9, "note": 67 },
    { "id": "TRG4", "x":  0, "y": -9, "note": 72 }
  ],

  "sprites": [
    { "id": "SPR1", "x": 0, "y": 0, "vx": 1, "vy": 0 }
  ],

  "idCounters": { "sprite": 2, "trigger": 5, "curve": 2 }
}
`,
        "application/json"
    );

    bundle.addTextFile(
        "behaviors.js",
        "",
    );

    return bundle;
}

/**
 * Load a score from storage by path.
 * @param {string} path
 * @returns {Promise<Bundle | null>}
 */
export async function loadScoreByPath(path) {
    const record = await loadScoreRecord(path);
    if (record === null) return null;
    return Bundle.fromRecord(record, path);
}

/**
 * Create a new empty score under the given name in the configured
 * default location, save it, and return the bundle. The path is
 * composed from the configured Scores folder (disk backend) or as
 * `<name>.gxs` (IDB backend).
 * @param {string} name
 * @returns {Promise<Bundle>}
 */
export async function createNewScore(name) {
    const path = await composeScorePathFromName(name);
    const bundle = makeEmptyBundle(name);
    bundle.path = path;
    await bundle.save();
    return bundle;
}

/**
 * Create a fresh untitled score in memory. No disk write, no
 * path; the bundle exists only in the renderer until the user
 * runs Save As. Used by the Logic-style New flow: actionNewScore
 * drops the user straight into a pristine scratchpad and the
 * first Cmd-S routes through Save As to commit it to disk.
 *
 * The bundle is born clean (dirty=false), matching Logic and
 * Pages — a brand-new empty document doesn't yet carry unsaved
 * work, and closing it without any edits should be silent. The
 * dirty flag flips on the first user edit through the same
 * mutators every saved bundle uses.
 *
 * @returns {Bundle}
 */
export function createUntitledScore() {
    return makeEmptyBundle("Untitled");
}

/**
 * List every score's storage path, display name, and updated
 * timestamp, most recent first. Thin pass-through for callers
 * that don't want to import from storage.js directly.
 * @returns {Promise<Array<import("./storage.js").ScoreListEntry>>}
 */
export async function listAvailableScores() {
    return await listScores();
}

/**
 * Delete a score by path. Removes from storage; the afterDelete
 * event hook in storage.js triggers the on-disk folder removal
 * transparently when a disk mirror is connected. The caller is
 * responsible for any user confirmation prompt.
 * @param {string} path
 */
export async function deleteScoreByPath(path) {
    await deleteScoreRecord(path);
}
