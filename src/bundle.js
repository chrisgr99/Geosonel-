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
 * Maximum number of slots in the per-score pinned image
 * section. The Stage 5 pinned section is a 2-row by 3-
 * column grid; this constant is the single source of
 * truth for the cap and is exported for use by
 * canvasInspector.js and electron-main.js so the number
 * doesn't drift between layers.
 */
export const PINNED_SLOTS_COUNT = 6;

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
         * Per-score pinned image slots. Stage 5 of the
         * Canvas inspector work introduces this fixed-
         * length array as the per-score pinned section
         * model: each entry is either a content hash (a
         * key into pinnedBytes for the slot's image bytes)
         * or null for an empty slot. Populated by
         * pinCurrentImage and cleared by unpinSlot;
         * round-trips through toRecord / fromRecord and
         * the .gxw-meta.json sidecar so pinned slots
         * survive score saves, and shared scores carry
         * their pins with them.
         * @type {Array<string | null>}
         */
        this.pinnedSlots = new Array(PINNED_SLOTS_COUNT).fill(null);

        /**
         * Image bytes for every hash referenced in
         * pinnedSlots. Stored as a Map keyed by the same
         * content hash that pinnedSlots holds, with the
         * normalised 1000×1000 JPEG@70 bytes as values.
         * Bundle invariant: every non-null entry in
         * pinnedSlots has a matching entry in
         * pinnedBytes, and pinnedBytes contains no orphan
         * keys (unpinSlot garbage-collects when the last
         * slot referencing a hash is cleared). On disk
         * the bytes live in the .gxs bundle's pinned/
         * subfolder as <hash>.jpg files; the storage
         * layer reads and writes them outside the
         * top-level files map so the pinned/ subfolder
         * stays a first-class storage concept rather
         * than a name-prefix convention.
         * @type {Map<string, ArrayBuffer>}
         */
        this.pinnedBytes = new Map();

        /**
         * Per-score display brightness for the canvas
         * image, 0 to 100. Applied as a multiplicative
         * globalAlpha at draw time on the rendered
         * display bitmap inside canvas.js's _drawImage,
         * so triggers, sprites, curves, and any image-
         * derived signals (pxLt, OKLCh, anything that
         * samples image pixels) all read from the
         * unmodified original bitmap — the dim is purely
         * a visual concession for editing over busy image
         * content. Default 100 (no change); 0 fades the
         * image fully toward the canvas-region
         * background colour. Travels with the score
         * through toRecord / fromRecord. See DESIGN.md
         * Section 13.5 and Section 26.
         * @type {number}
         */
        this.displayBrightness = 100;

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
         * Subscribers fired on every content mutation of the
         * bundle's `files` array — every updateContent on a
         * text file, every setBinaryFile, every successful
         * removeFile. Distinct from _dirtyListeners, which
         * fires only on the dirty boolean's transitions; this
         * fires on every mutation, even successive ones that
         * never cross the false-to-true edge (a save clears
         * dirty; the next keystroke makes it true again,
         * which is one dirty transition but two content
         * changes). Used by the composition mirror's push
         * pipeline (src/mirrorPush.js) to wake up on each
         * edit so its debounced push captures every change,
         * not just the first edit after a save.
         *
         * Pinned-slot and displayBrightness mutations do
         * NOT fire content-change because they live in the
         * .gxw-meta.json sidecar rather than scene.json or
         * behaviours.js, and the mirror does not surface
         * the sidecar to AI tools. If a future need to
         * surface them arises, the relevant mutators can
         * be extended to emit then.
         * @type {Set<() => void>}
         */
        this._contentChangeListeners = new Set();

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
     * Subscribe to content-change events. The callback fires
     * on every mutation of a file in the bundle’s files
     * array — a text-file updateContent, a binary-file
     * setBinaryFile, or a successful removeFile. Fires
     * independently of the dirty boolean: a save clears
     * dirty but does not fire content-change; the next
     * keystroke fires both. Returns an unsubscribe function.
     *
     * Used by the composition mirror's push pipeline
     * (src/mirrorPush.js) so its debounced push wakes up on
     * every edit rather than only on dirty transitions.
     *
     * @param {() => void} cb
     * @returns {() => void}
     */
    subscribeContentChange(cb) {
        this._contentChangeListeners.add(cb);
        return () => this._contentChangeListeners.delete(cb);
    }

    /**
     * Fire all content-change listeners. Called from
     * updateContent, setBinaryFile, and removeFile (when
     * removal actually happened). Errors from individual
     * subscribers are logged but do not interrupt other
     * subscribers; the bundle's data model has already been
     * mutated by the time we get here, so a thrown
     * listener can't roll that back anyway.
     */
    _emitContentChange() {
        for (const cb of this._contentChangeListeners) {
            try {
                cb();
            } catch (err) {
                console.error("GXW: bundle content-change listener threw.", err);
            }
        }
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
        this._emitContentChange();
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
        this._emitContentChange();
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
        if (this.files.length !== before) {
            this.markDirty();
            this._emitContentChange();
        }
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

    // --- Pinned image operations (Stage 5) ---

    /**
     * Find the slot index holding a particular content
     * hash, or null when the hash isn't pinned. Used by
     * the score-open active-frame logic (matching the
     * bundle's imageContentHash against pinned slots so
     * the green frame lights the right slot) and by
     * dropHashOnPinnedSlot to decide between the splice-
     * reorder and replace-target cases.
     * @param {string} hash
     * @returns {number | null}
     */
    findPinnedSlotForHash(hash) {
        for (let i = 0; i < PINNED_SLOTS_COUNT; i++) {
            if (this.pinnedSlots[i] === hash) return i;
        }
        return null;
    }

    /**
     * Whether a given content hash currently occupies any
     * pinned slot. Thin wrapper around findPinnedSlotForHash
     * for callers that only need the boolean.
     * @param {string} hash
     * @returns {boolean}
     */
    isImagePinned(hash) {
        return this.findPinnedSlotForHash(hash) !== null;
    }

    /**
     * Drop an image onto a specific pinned slot. The Stage
     * 5 second-commit pinning gesture: the user drags a
     * shared thumbnail down into a specific slot in the
     * pinned section, and this method does whatever the
     * drop should mean given the current pinned state.
     *
     * Two cases:
     *
     * Hash is NOT currently in any pinned slot. The drop
     * is a fresh pin. Whatever was at targetSlotIdx (image
     * or null) is replaced; if the displaced image was the
     * last reference to its hash anywhere in pinnedSlots,
     * its bytes are garbage-collected from pinnedBytes.
     * The dragged image's bytes are added to pinnedBytes
     * if they aren't already keyed there.
     *
     * Hash IS currently in another pinned slot. The drop
     * is a reorder: splice the hash out of its current
     * slot and insert it at targetSlotIdx, with other
     * slots between source and target shifting to fill
     * the gap. The pinned slot count stays at
     * PINNED_SLOTS_COUNT (one removed, one inserted),
     * the target's previous occupant shifts toward the
     * source position rather than being replaced, and
     * pinnedBytes is unchanged (the same hash still
     * occupies the array).
     *
     * No-op cases (out-of-range target, dropping a hash
     * onto its own current slot) return without dirtying
     * the bundle.
     *
     * @param {string} hash       Content hash of the image being dropped.
     * @param {ArrayBuffer} bytes Image bytes (typically the normalised
     *   1000×1000 JPEG@70 — must match what generated the
     *   hash; the caller from main.js loads from the
     *   gallery cache to get exactly these bytes).
     * @param {number} targetSlotIdx 0-indexed pinned slot the drop landed on.
     * @returns {boolean} True iff the operation actually mutated state
     *   (false for the out-of-range and drop-on-own-slot
     *   no-op cases). Callers can use this to skip the
     *   save and the user-visible message on a no-op
     *   without re-checking the no-op conditions
     *   themselves.
     */
    dropHashOnPinnedSlot(hash, bytes, targetSlotIdx) {
        if (targetSlotIdx < 0 || targetSlotIdx >= PINNED_SLOTS_COUNT) return false;
        const currentIdx = this.pinnedSlots.indexOf(hash);
        if (currentIdx === targetSlotIdx) return false;
        if (currentIdx >= 0) {
            // Reorder: splice out, then splice in. The
            // single splice-then-splice pair preserves
            // the array length (one removed, one
            // inserted), so we don't need to truncate or
            // pad afterwards. pinnedBytes is unchanged
            // because the hash hasn't gained or lost a
            // reference — it just moved positions.
            this.pinnedSlots.splice(currentIdx, 1);
            this.pinnedSlots.splice(targetSlotIdx, 0, hash);
        } else {
            // Fresh pin: replace whatever was at the
            // target slot. Capture the displaced hash
            // first so we can decide whether to GC its
            // bytes after the swap; the bundle invariant
            // is that pinnedBytes contains no orphan
            // keys, so a slot losing its last reference
            // means its bytes need to drop out of the
            // map too.
            const displacedHash = this.pinnedSlots[targetSlotIdx];
            this.pinnedSlots[targetSlotIdx] = hash;
            if (!this.pinnedBytes.has(hash)) {
                this.pinnedBytes.set(hash, bytes);
            }
            if (displacedHash !== null
                && !this.pinnedSlots.includes(displacedHash)) {
                this.pinnedBytes.delete(displacedHash);
            }
        }
        this.markDirty();
        return true;
    }

    // --- Display brightness (Stage 6) ---

    /**
     * Set the per-score display brightness. Clamps the
     * input to 0–100 and marks the bundle dirty on any
     * actual change. Same-value pushes (typical for a
     * slider holding still at one position, or for the
     * value already in effect at score open) trigger no
     * dirty flag and no subscriber fan-out.
     *
     * The visual effect lives in canvas.js's _drawImage,
     * which reads this value via the canvas's own
     * setDisplayBrightness mirror; the bundle field is
     * the persistent source of truth that the canvas
     * mirror is synced against at score open and on
     * every user adjustment.
     *
     * @param {number} value  0–100; outside that range is clamped.
     */
    setDisplayBrightness(value) {
        const n = typeof value === "number" && Number.isFinite(value)
            ? value
            : 100;
        const clamped = n < 0 ? 0 : (n > 100 ? 100 : n);
        if (clamped === this.displayBrightness) return;
        this.displayBrightness = clamped;
        this.markDirty();
    }

    /**
     * Unpin the image at the given slot index. Clears the
     * slot, then garbage-collects the slot's bytes from
     * pinnedBytes when no other slot still references the
     * same hash. No-op for an already-empty slot or an
     * out-of-range index. Marks the bundle dirty on
     * actual change. Used by the Stage 5 second commit's
     * drag-off-edge interaction; surfaced here in the
     * first commit so the storage round-trip can be
     * exercised end-to-end.
     *
     * @param {number} slotIndex
     */
    unpinSlot(slotIndex) {
        if (slotIndex < 0 || slotIndex >= PINNED_SLOTS_COUNT) return;
        const hash = this.pinnedSlots[slotIndex];
        if (hash === null) return;
        this.pinnedSlots[slotIndex] = null;
        const stillReferenced = this.pinnedSlots.some((h) => h === hash);
        if (!stillReferenced) {
            this.pinnedBytes.delete(hash);
        }
        this.markDirty();
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
        // Pinned files travel alongside the regular files
        // map but in their own keyed-by-hash object so the
        // storage layer can place them in the pinned/
        // subfolder rather than at the top level of the
        // .gxs bundle.
        /** @type {Object<string, ArrayBuffer>} */
        const pinnedFiles = {};
        for (const [hash, bytes] of this.pinnedBytes) {
            pinnedFiles[hash] = bytes;
        }
        return {
            name: this.name,
            files,
            imageName: this.imageName,
            imageContentHash: this.imageContentHash,
            pinnedSlots: this.pinnedSlots.slice(),
            pinnedFiles,
            displayBrightness: this.displayBrightness,
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
        // Pinned slots and pinned bytes. Older records
        // predate these fields and load as the empty
        // defaults — six null slots, empty bytes map.
        // Both are normalised here so downstream consumers
        // (canvasInspector render, electron-main writes)
        // see the same shape regardless of source.
        if (Array.isArray(record.pinnedSlots)) {
            for (let i = 0; i < PINNED_SLOTS_COUNT; i++) {
                const v = record.pinnedSlots[i];
                bundle.pinnedSlots[i] = typeof v === "string" ? v : null;
            }
        }
        if (record.pinnedFiles !== null
            && record.pinnedFiles !== undefined
            && typeof record.pinnedFiles === "object") {
            for (const hash of Object.keys(record.pinnedFiles)) {
                const bytes = record.pinnedFiles[hash];
                if (bytes instanceof ArrayBuffer) {
                    bundle.pinnedBytes.set(hash, bytes);
                }
            }
        }
        // displayBrightness (Stage 6). Older records
        // predate this field and load with the default
        // 100 (no change), which keeps existing scores
        // looking identical to their pre-Stage-6 state
        // until the user explicitly adjusts the slider.
        // The value is clamped on load so an out-of-range
        // value persisted by some future external tool
        // can't push the bundle into an invalid state.
        if (typeof record.displayBrightness === "number"
            && Number.isFinite(record.displayBrightness)) {
            const v = record.displayBrightness;
            bundle.displayBrightness = v < 0 ? 0 : (v > 100 ? 100 : v);
        } else {
            bundle.displayBrightness = 100;
        }
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
  "engine": "superdough",

  "curves": [
    {
      "id": "CRV1",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 12, "h": 12 },
      "cursorR": 2,
      "cursorL": 0,
      "cyclePattern": "sound(\\"bd sn bd sn\\")",
      "cycleSpeeds": "1 -2"
    },
    {
      "id": "CRV2",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 20, "h": 20 },
      "cursorR": 2,
      "cursorL": 0,
      "cyclePattern": "note(\\"c4  e4 d4 f4  e4  g4  f4 a4\\")",
      "cycleSpeeds": "1 -1"
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

  "idCounters": { "sprite": 2, "trigger": 5, "curve": 3 }
}
`,
        "application/json"
    );

    bundle.addTextFile(
        "behaviors.js",
        `$CRV1: sound("bd sn bd sn");

$CRV2: note("c4  e4 d4 f4  e4  g4  f4 a4");
`,
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
