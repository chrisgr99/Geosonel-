/**
 * Disk mirror. EXPERIMENTAL / DEPRECATED at v2.2.
 *
 * STATUS: This module shipped as a v2.1-era attempt to make
 * scores accessible to AI assistants (notably Claude Desktop
 * via filesystem MCP) by mirroring IndexedDB out to a real
 * folder on disk and polling for external edits. In practice
 * the experience proved too fragile to rely on — browser
 * permissions lapse on every reload and produce a reconnect
 * modal, the File System Access API can't expose absolute
 * paths to the assistant, browser module caches mask
 * external edits until a hard reload, and the round-trip
 * tends to corrupt formatting in edge cases. The future
 * direction is an embedded Anthropic API key in GXW that
 * lets Claude operate on score state through the same
 * in-memory pipeline the canvas toolbar and inspector use,
 * eliminating the disk hop entirely.
 *
 * The code is preserved unchanged for now: it works for the
 * cases it works for, the Settings → Storage panel still
 * exposes Choose Folder / Pause / Disconnect / Push All so
 * users who want it can opt in, and removing it cleanly is
 * easy when we're sure we won't revive it. Do not extend or
 * build new features on top of this module.
 *
 * --- Original module description follows ---
 *
 * Mirrors every score in IndexedDB out to a folder on disk
 * chosen by the user, and watches the active score's files
 * for external changes (typically from an AI assistant editing
 * via Claude Desktop's filesystem MCP). When changes are
 * detected, the bundle is reloaded automatically.
 *
 * Folder layout:
 *
 *   <chosen folder>/
 *     README.md                  written once on first connect
 *     <score name 1>/
 *       scene.json
 *       behaviours.js
 *       <image file, if any>
 *     <score name 2>/
 *       ...
 *
 * Score names are sanitised for filesystem-safety when used as
 * folder names; the canonical name in IndexedDB is preserved
 * unchanged. Score-folder names use replace-illegal-chars
 * sanitisation.
 *
 * Auto-update model:
 *
 *   Polling once per second (skipped while the document is
 *   hidden) checks the modification time of scene.json and
 *   behaviours.js for the currently-watched score. When a
 *   change is detected, a 500ms settle timer starts; further
 *   changes during settle reset the timer. When settle fires,
 *   the bundle is read from disk in one operation and a single
 *   onExternalChange callback is invoked. This naturally
 *   absorbs the multi-file write bursts AI assistants typically
 *   produce.
 *
 * Permission model:
 *
 *   The folder handle persists across page reloads in IndexedDB,
 *   but the browser's permission grant on it can lapse. When
 *   that happens, GXW must surface this clearly rather than
 *   silently failing to push or poll. The mirror tracks the
 *   permission state explicitly and includes a needsReconnect
 *   flag in its status; the main app subscribes and shows a
 *   modal dialog with a Reconnect button when this flag flips
 *   on. Re-granting requires a user gesture (browsers don't let
 *   requestPermission run from a background poll), so the
 *   button click itself is what triggers the prompt.
 *
 * Browser support: requires the File System Access API
 * (Chrome / Edge / other Chromium browsers). Safari and Firefox
 * are not supported in this milestone.
 */

// @ts-check

import {
    getSetting,
    setSetting,
    saveScoreRecord,
    suppressNextSaveEmit,
} from "./storage.js";
import { Bundle } from "./bundle.js";

const HANDLE_KEY = "diskMirror.folderHandle";
const ENABLED_KEY = "diskMirror.enabled";

const POLL_INTERVAL_MS = 1000;
const SETTLE_MS = 500;

const README_FILENAME = "README.md";
const SCENE_FILENAME = "scene.json";
const BEHAVIOURS_FILENAME = "behaviours.js";
const ACTIVE_SCORE_FILENAME = "_active.txt";

const README_BODY =
`# GXW Working Storage

This folder is a mirror of scores from GXW, a generative-music
score editor.

## File layout

  - _active.txt              name of the score currently open in GXW
  - README.md                this file
  - <score name>/            one folder per score, containing:
      - scene.json           declarative score data (objects,
                             transport, harmony, display scales)
      - behaviours.js        named JavaScript functions referenced
                             by scene.json
      - <image file>         optional background image

## For AI assistants

To make changes to the score the user is currently viewing in
GXW:

  1. Read _active.txt to find the active score's name.
  2. Edit the relevant files in that score's folder.
  3. GXW will reload the score within ~1.5 seconds.

When adding a new behaviour to a score: write behaviours.js
first (defining the function), then scene.json (referencing
it). When removing a behaviour: write scene.json first
(removing the reference), then behaviours.js (removing the
function definition). Following this order avoids a momentary
inconsistency where scene.json references a function that
doesn't yet exist (or no longer exists).

## Format versions

App version: 0.1
Data format: 2.1 (see DESIGN.md v2.1 in the GXW source)
`;

/**
 * @typedef {"granted" | "prompt" | "denied" | "no-handle" | "unknown"} PermissionState
 */

/**
 * @typedef {Object} DiskMirrorStatus
 * @property {boolean} hasFolder        A folder has been chosen.
 * @property {string | null} folderName Display name of the folder, or null.
 * @property {boolean} enabled          The user has mirroring switched on.
 * @property {PermissionState} permission Current permission grant state.
 * @property {boolean} ready            True iff hasFolder && enabled && permission === "granted".
 * @property {boolean} needsReconnect   True iff hasFolder && enabled && permission !== "granted". UI should prompt.
 */

/**
 * @typedef {(bundle: Bundle) => void | Promise<void>} ExternalChangeCallback
 */

export class DiskMirror {
    constructor() {
        /** @type {FileSystemDirectoryHandle | null} */
        this._handle = null;
        /** @type {boolean} */
        this._enabled = false;
        /** @type {PermissionState} */
        this._permissionState = "no-handle";

        // --- Watch state ---
        /** @type {string | null} */
        this._watchedName = null;
        /** @type {ExternalChangeCallback | null} */
        this._onExternalChange = null;
        /** @type {Map<string, number>} */
        this._lastMtimes = new Map();
        /** @type {ReturnType<typeof setInterval> | null} */
        this._pollTimer = null;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._settleTimer = null;
        this._initialBaselineSet = false;

        // --- Status subscribers ---
        /** @type {Set<(status: DiskMirrorStatus) => void>} */
        this._statusSubscribers = new Set();
    }

    /**
     * Restore folder handle and enabled flag from IndexedDB,
     * then query the current permission state. Called once at
     * startup. Does NOT request permission \u2014 that needs a user
     * gesture and is handled separately by
     * requestPermissionFromGesture(), typically driven by the
     * reconnect modal.
     * @returns {Promise<DiskMirrorStatus>}
     */
    async restore() {
        try {
            const raw = await getSetting(HANDLE_KEY);
            if (raw && typeof raw === "object" && "kind" in raw) {
                this._handle = /** @type {FileSystemDirectoryHandle} */ (raw);
            }
        } catch (err) {
            console.warn("GXW: could not restore disk-mirror folder handle.", err);
        }
        try {
            const enabled = await getSetting(ENABLED_KEY);
            this._enabled = enabled === true;
        } catch {
            this._enabled = false;
        }
        // Query permission so the initial status is accurate
        // and the main app can show the reconnect dialog right
        // away if the grant has lapsed since the last session.
        if (this._handle !== null) {
            this._permissionState = await this._queryPermission();
        } else {
            this._permissionState = "no-handle";
        }
        this._notifyStatus();
        return this.getStatus();
    }

    /**
     * Show the system folder picker. On success, store the
     * chosen handle, write a README, enable mirroring, and
     * notify status subscribers. The picker grants permission
     * as part of the flow, so permission state becomes
     * "granted" without a separate request.
     * @param {string} [suggestedName]
     * @returns {Promise<DiskMirrorStatus>}
     */
    async chooseFolder(suggestedName = "GXW Working Storage") {
        if (typeof window.showDirectoryPicker !== "function") {
            throw new Error(
                "Disk mirroring requires a browser with the File System Access API " +
                "(Chrome or Edge)."
            );
        }
        // @ts-ignore \u2014 the picker options are non-standard in TS DOM lib.
        const handle = await window.showDirectoryPicker({
            id: "gxw-scores",
            mode: "readwrite",
            suggestedName,
        });
        this._handle = handle;
        await setSetting(HANDLE_KEY, handle);
        this._enabled = true;
        await setSetting(ENABLED_KEY, true);
        this._permissionState = "granted";
        try {
            await this._ensureReadme();
        } catch (err) {
            // README write failures don't block the connect.
            console.warn("GXW: README write failed.", err);
        }
        this._updatePollingState();
        this._notifyStatus();
        return this.getStatus();
    }

    /**
     * Forget the chosen folder. Files on disk are left in
     * place; only GXW's reference to them is cleared.
     */
    async disconnect() {
        this._handle = null;
        this._enabled = false;
        this._permissionState = "no-handle";
        await setSetting(HANDLE_KEY, null);
        await setSetting(ENABLED_KEY, false);
        this._stopPolling();
        this._watchedName = null;
        this._lastMtimes.clear();
        this._notifyStatus();
    }

    /**
     * Toggle the enabled flag without changing the folder
     * choice. Lets the user pause mirroring temporarily without
     * losing their folder.
     * @param {boolean} enabled
     */
    async setEnabled(enabled) {
        this._enabled = enabled;
        await setSetting(ENABLED_KEY, enabled);
        this._updatePollingState();
        this._notifyStatus();
    }

    /**
     * Re-request permission on the stored folder handle. This
     * is the entry point for the reconnect modal's button \u2014
     * MUST be called from inside a user-gesture event handler
     * (a click) so the browser allows requestPermission to
     * surface its prompt. Updates permission state and polling
     * accordingly.
     * @returns {Promise<DiskMirrorStatus>}
     */
    async requestPermissionFromGesture() {
        if (this._handle === null) {
            return this.getStatus();
        }
        try {
            // @ts-ignore \u2014 requestPermission options non-standard.
            const result = await this._handle.requestPermission({ mode: "readwrite" });
            this._permissionState = /** @type {PermissionState} */ (result);
        } catch (err) {
            console.warn("GXW: permission request failed.", err);
            this._permissionState = "denied";
        }
        if (this._permissionState === "granted") {
            // Make sure README is current after the gap.
            try { await this._ensureReadme(); } catch {}
        }
        this._updatePollingState();
        this._notifyStatus();
        return this.getStatus();
    }

    /** @returns {DiskMirrorStatus} */
    getStatus() {
        const hasFolder = this._handle !== null;
        const ready = hasFolder && this._enabled && this._permissionState === "granted";
        const needsReconnect = hasFolder && this._enabled && this._permissionState !== "granted";
        return {
            hasFolder,
            folderName: this._handle?.name ?? null,
            enabled: this._enabled,
            permission: this._permissionState,
            ready,
            needsReconnect,
        };
    }

    /**
     * Subscribe to status changes. Returns an unsubscribe
     * function.
     * @param {(status: DiskMirrorStatus) => void} cb
     * @returns {() => void}
     */
    subscribeStatus(cb) {
        this._statusSubscribers.add(cb);
        return () => this._statusSubscribers.delete(cb);
    }

    /**
     * Push a bundle's contents to disk under its sanitised
     * folder name. No-op when mirroring isn't ready.
     * @param {Bundle} bundle
     */
    async pushBundle(bundle) {
        if (!this._isReady()) return;
        try {
            const folder = await this._getOrCreateScoreFolder(bundle.name);
            await this._writeTextFile(folder, SCENE_FILENAME, bundle.getFile(SCENE_FILENAME)?.content ?? "");
            await this._writeTextFile(folder, BEHAVIOURS_FILENAME, bundle.getFile(BEHAVIOURS_FILENAME)?.content ?? "");
            if (bundle.imageName !== null) {
                const img = bundle.getBinaryFile(bundle.imageName);
                if (img !== null) {
                    await this._writeBinaryFile(folder, bundle.imageName, img.content);
                }
            }
        } catch (err) {
            this._handleOpError(`push score "${bundle.name}"`, err);
        }
    }

    /**
     * Push a record (the IndexedDB form of a bundle) to disk.
     * Used by the storage save-event subscriber.
     * @param {import("./storage.js").ScoreRecord} record
     */
    async pushRecord(record) {
        if (!this._isReady()) return;
        try {
            const folder = await this._getOrCreateScoreFolder(record.name);
            const sceneFile = record.files[SCENE_FILENAME];
            const behavioursFile = record.files[BEHAVIOURS_FILENAME];
            if (sceneFile !== undefined && typeof sceneFile.content === "string") {
                await this._writeTextFile(folder, SCENE_FILENAME, sceneFile.content);
            }
            if (behavioursFile !== undefined && typeof behavioursFile.content === "string") {
                await this._writeTextFile(folder, BEHAVIOURS_FILENAME, behavioursFile.content);
            }
            if (record.imageName !== null) {
                const img = record.files[record.imageName];
                if (img !== undefined && img.content instanceof ArrayBuffer) {
                    await this._writeBinaryFile(folder, record.imageName, img.content);
                }
            }
        } catch (err) {
            this._handleOpError(`push score "${record.name}"`, err);
        }
    }

    /**
     * Pull a score from disk, returning a fresh Bundle. Returns
     * null on any failure (missing folder, permission lapse,
     * read error).
     * @param {string} name
     * @returns {Promise<Bundle | null>}
     */
    async pullBundle(name) {
        if (!this._isReady()) return null;
        try {
            const folderName = sanitizeFolderName(name);
            const folder = await this._handle.getDirectoryHandle(folderName, { create: false });
            const bundle = new Bundle(name);
            for await (const [entryName, entry] of folder.entries()) {
                if (entry.kind !== "file") continue;
                if (entryName === SCENE_FILENAME || entryName === BEHAVIOURS_FILENAME) {
                    const file = await entry.getFile();
                    const text = await file.text();
                    const mime = entryName === SCENE_FILENAME ? "application/json" : "text/javascript";
                    bundle.addTextFile(entryName, text, mime);
                } else {
                    const file = await entry.getFile();
                    const buffer = await file.arrayBuffer();
                    bundle.setBinaryFile(entryName, buffer, file.type || "application/octet-stream");
                }
            }
            for (const f of bundle.files) {
                if (f.kind === "binary") bundle.imageName = f.name;
            }
            if (bundle.getFile(SCENE_FILENAME) === null) return null;
            if (bundle.getFile(BEHAVIOURS_FILENAME) === null) return null;
            return bundle;
        } catch (err) {
            this._handleOpError(`read score "${name}"`, err);
            return null;
        }
    }

    /**
     * Delete a score's folder on disk. Idempotent; missing
     * folders are silently ignored.
     * @param {string} name
     */
    async deleteScore(name) {
        if (!this._isReady()) return;
        const folderName = sanitizeFolderName(name);
        try {
            await this._handle.removeEntry(folderName, { recursive: true });
        } catch (err) {
            // NotFoundError is expected when the folder never
            // existed; anything else is worth handling.
            if (err && /** @type {any} */ (err).name === "NotFoundError") return;
            this._handleOpError(`delete folder for "${name}"`, err);
        }
    }

    /**
     * List score folder names currently on disk.
     * @returns {Promise<string[]>}
     */
    async listScores() {
        if (this._handle === null) return [];
        const names = [];
        try {
            for await (const [entryName, entry] of this._handle.entries()) {
                if (entry.kind === "directory") names.push(entryName);
            }
        } catch (err) {
            this._handleOpError("list disk scores", err);
        }
        return names;
    }

    /**
     * Watch a score's files for external changes. Pass null to
     * stop watching.
     * @param {string | null} name
     * @param {ExternalChangeCallback | null} onChange
     */
    watch(name, onChange) {
        this._stopPolling();
        this._watchedName = name;
        this._onExternalChange = onChange;
        this._lastMtimes.clear();
        this._initialBaselineSet = false;
        this._updatePollingState();
    }

    /**
     * Write the name of the currently-active score into a
     * marker file at the root of the working-storage folder.
     * AI assistants reading the folder use this file to learn
     * which score the user has open without having to be told.
     * No-op when the mirror isn't ready; safe to call any
     * number of times.
     * @param {string} name
     */
    async setActiveScore(name) {
        if (!this._isReady()) return;
        try {
            await this._writeTextFile(this._handle, ACTIVE_SCORE_FILENAME, name + "\n");
        } catch (err) {
            this._handleOpError("write active-score marker", err);
        }
    }

    /**
     * Refresh the README at the root of the working-storage
     * folder so its content matches the current app version.
     * No-op when the mirror isn't ready.
     */
    async refreshReadme() {
        if (!this._isReady()) return;
        try {
            await this._ensureReadme();
        } catch (err) {
            this._handleOpError("refresh README", err);
        }
    }

    // --- Internals ---

    _isReady() {
        return this._handle !== null
            && this._enabled
            && this._permissionState === "granted";
    }

    _updatePollingState() {
        const shouldPoll = this._isReady() && this._watchedName !== null;
        const isPolling = this._pollTimer !== null;
        if (shouldPoll && !isPolling) this._startPolling();
        else if (!shouldPoll && isPolling) this._stopPolling();
    }

    /**
     * Recognise a permission-related I/O failure. The FSA
     * surfaces these as NotAllowedError and sometimes
     * SecurityError; both mean we've lost the right to read or
     * write the folder and the user must re-grant.
     * @param {unknown} err
     * @returns {boolean}
     */
    _isPermissionError(err) {
        if (!err || typeof err !== "object") return false;
        const name = /** @type {any} */ (err).name;
        return name === "NotAllowedError" || name === "SecurityError";
    }

    /**
     * Centralised handler for I/O errors from disk operations.
     * If the error looks like a permission failure, mark
     * permission state as "prompt" so the main app's status
     * subscriber will surface the reconnect modal. Other
     * errors are just logged.
     * @param {string} context
     * @param {unknown} err
     */
    _handleOpError(context, err) {
        if (this._isPermissionError(err)) {
            // Treat as "prompt" rather than "denied" since the
            // user can usually re-grant via the modal. If the
            // re-grant attempt itself fails, that codepath
            // upgrades to "denied".
            if (this._permissionState !== "prompt" && this._permissionState !== "denied") {
                this._permissionState = "prompt";
                this._stopPolling();
                this._notifyStatus();
            }
            console.warn(`GXW: could not ${context} (permission lapsed).`);
        } else {
            console.error(`GXW: could not ${context}.`, err);
        }
    }

    async _getOrCreateScoreFolder(scoreName) {
        const folderName = sanitizeFolderName(scoreName);
        return await this._handle.getDirectoryHandle(folderName, { create: true });
    }

    async _writeTextFile(folder, fileName, content) {
        const fileHandle = await folder.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    }

    async _writeBinaryFile(folder, fileName, bytes) {
        const fileHandle = await folder.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();
    }

    async _ensureReadme() {
        if (this._handle === null) return;
        await this._writeTextFile(this._handle, README_FILENAME, README_BODY);
    }

    /** @returns {Promise<PermissionState>} */
    async _queryPermission() {
        if (this._handle === null) return "no-handle";
        try {
            // @ts-ignore \u2014 queryPermission options non-standard.
            const state = await this._handle.queryPermission({ mode: "readwrite" });
            return /** @type {PermissionState} */ (state);
        } catch {
            return "denied";
        }
    }

    _notifyStatus() {
        const status = this.getStatus();
        for (const cb of this._statusSubscribers) {
            try { cb(status); } catch (err) {
                console.error("GXW: disk-mirror status subscriber threw.", err);
            }
        }
    }

    _startPolling() {
        if (this._pollTimer !== null) return;
        this._pollTimer = setInterval(() => {
            if (document.hidden) return;
            void this._pollOnce();
        }, POLL_INTERVAL_MS);
    }

    _stopPolling() {
        if (this._pollTimer !== null) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        if (this._settleTimer !== null) {
            clearTimeout(this._settleTimer);
            this._settleTimer = null;
        }
    }

    async _pollOnce() {
        if (!this._isReady() || this._watchedName === null) return;
        const name = this._watchedName;
        const folderName = sanitizeFolderName(name);

        let folder;
        try {
            folder = await this._handle.getDirectoryHandle(folderName, { create: false });
        } catch (err) {
            if (err && /** @type {any} */ (err).name === "NotFoundError") return;
            this._handleOpError(`poll folder for "${name}"`, err);
            return;
        }

        let changed = false;
        for (const fileName of [SCENE_FILENAME, BEHAVIOURS_FILENAME]) {
            try {
                const handle = await folder.getFileHandle(fileName, { create: false });
                const file = await handle.getFile();
                const key = `${folderName}/${fileName}`;
                const prev = this._lastMtimes.get(key);
                this._lastMtimes.set(key, file.lastModified);
                if (prev !== undefined && prev !== file.lastModified) {
                    changed = true;
                }
            } catch (err) {
                if (err && /** @type {any} */ (err).name === "NotFoundError") continue;
                this._handleOpError(`poll ${fileName} for "${name}"`, err);
                return;
            }
        }

        if (!this._initialBaselineSet) {
            this._initialBaselineSet = true;
            return;
        }

        if (changed) this._scheduleSettle(name);
    }

    /** @param {string} name */
    _scheduleSettle(name) {
        if (this._settleTimer !== null) {
            clearTimeout(this._settleTimer);
        }
        this._settleTimer = setTimeout(() => {
            this._settleTimer = null;
            void this._fireExternalChange(name);
        }, SETTLE_MS);
    }

    /** @param {string} name */
    async _fireExternalChange(name) {
        if (this._watchedName !== name) return;
        const bundle = await this.pullBundle(name);
        if (bundle === null) return;
        suppressNextSaveEmit(name);
        await saveScoreRecord(bundle.toRecord());
        if (this._onExternalChange !== null) {
            try {
                await this._onExternalChange(bundle);
            } catch (err) {
                console.error("GXW: disk-mirror onExternalChange threw.", err);
            }
        }
    }
}

/**
 * Map a score name to a filesystem-safe folder name.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFolderName(name) {
    const cleaned = name.replace(/[\/\\:*?"<>|]/g, "_").trim();
    return cleaned === "" ? "_" : cleaned;
}
