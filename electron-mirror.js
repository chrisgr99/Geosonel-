// Composition mirror for AI integration.
//
// Section 15 of DESIGN.md. The composition mirror is the
// mechanism by which an AI assistant — typically Claude
// Desktop with a filesystem MCP server pointed at the
// mirror folder — observes and edits the score the user is
// currently working on. The mirror folder lives at
// ~/Library/Application Support/GeoSonel/Active/ on macOS
// (via app.getPath('userData'), so the location is
// platform-appropriate on other systems too), holds a live
// copy of the open score's content plus observation-only
// artifacts describing canvas state and the round-trip
// protocol.
//
// Phase 1A commit 1 (this commit). Foundational pieces
// only: the module owns the folder's lifecycle (creation
// on enable, clearing on disable, cleanup of leftover .tmp
// files at startup), tracks the isLive flag in
// active-score.json (true while GeoSonel is running, false
// on quit), and exposes setEnabled / getStatus through
// IPC. No content pushing happens yet — scene.json,
// behaviours.js, image, and the observation-only
// artifacts land in later Phase 1A commits.
//
// Feature is opt-in. The user toggles it in Settings → AI
// Integration. Default off so existing users do not get a
// surprise folder created in their Application Support
// directory after a version bump.
//
// Distinct from the deprecated src/diskMirror.js, which is
// the renderer-side File System Access API mirror from the
// v2.1 era. That module is kept in place for users still
// relying on its Settings → Storage panel, but the future
// direction (Section 15) is this Electron-main-process
// mirror at a stable canonical path, which is what gets
// extended in subsequent Phase 1A commits.

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const ACTIVE_FOLDER_NAME = 'Active';
const ACTIVE_SCORE_FILENAME = 'active-score.json';
const SCENE_FILENAME = 'scene.json';
const BEHAVIOURS_FILENAME = 'behaviours.js';
const RUNTIME_STATE_FILENAME = 'runtime-state.json';
const PROTOCOL_VERSION = 1;
const SETTING_KEY = 'mirrorEnabled';
const TMP_SUFFIX = '.tmp';

// Module-level state. `enabled` mirrors the persisted
// setting and is the canonical in-process answer for "is
// the mirror currently running"; the public getStatus()
// returns this. `folderPathCache` lazily resolves the
// folder path on first use since app.getPath('userData')
// is not available before app.whenReady.
// `lastPushedImageName` tracks the on-disk filename of the
// most recently pushed image so that when the score's
// image is replaced with one carrying a different filename
// (different score open, or the user imported a new image
// with a new name) we can unlink the stale file on the
// next push and the mirror folder doesn't accumulate
// orphaned images.
let enabled = false;
let folderPathCache = null;
let lastPushedImageName = null;

// Settings.json IO. The settings file lives in
// app.getPath('userData') and is shared with the other
// settings consumers in electron-main.js. We do not import
// from electron-main.js to reuse its readSettings /
// writeSettings without creating a circular dependency, so
// the mirror carries its own thin readers and writers
// against the same file. Cost is minimal — only one key
// (mirrorEnabled) is read or written through here.

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

async function readMirrorEnabledSetting() {
    try {
        const text = await fsp.readFile(getSettingsPath(), 'utf8');
        const settings = JSON.parse(text);
        return settings[SETTING_KEY] === true;
    } catch (err) {
        if (err.code === 'ENOENT') return false;
        // Malformed settings.json should not crash the
        // mirror initialization; treat as disabled rather
        // than throwing.
        console.warn(
            `GXW: could not read mirrorEnabled setting: ${err.message}. ` +
            `Mirror will stay disabled for this session.`,
        );
        return false;
    }
}

async function writeMirrorEnabledSetting(value) {
    let settings;
    try {
        const text = await fsp.readFile(getSettingsPath(), 'utf8');
        settings = JSON.parse(text);
    } catch (err) {
        if (err.code === 'ENOENT') {
            settings = {};
        } else {
            throw err;
        }
    }
    settings[SETTING_KEY] = value;
    await fsp.mkdir(path.dirname(getSettingsPath()), { recursive: true });
    await fsp.writeFile(
        getSettingsPath(),
        JSON.stringify(settings, null, 2),
        'utf8',
    );
}

function getMirrorFolderPath() {
    if (folderPathCache === null) {
        folderPathCache = path.join(
            app.getPath('userData'),
            ACTIVE_FOLDER_NAME,
        );
    }
    return folderPathCache;
}

async function ensureMirrorFolder() {
    await fsp.mkdir(getMirrorFolderPath(), { recursive: true });
}

// Clear the mirror folder's contents without removing the
// folder itself. Used when the mirror is disabled mid-
// session (the user toggles off in Settings); later
// commits will also call this on score-switch. Idempotent
// — a non-existent folder is treated as already cleared.
async function clearMirrorFolder() {
    const folder = getMirrorFolderPath();
    try {
        const entries = await fsp.readdir(folder, { withFileTypes: true });
        for (const entry of entries) {
            const p = path.join(folder, entry.name);
            await fsp.rm(p, { recursive: true, force: true });
        }
    } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
    }
}

// Remove any *.tmp files left in the mirror folder from a
// previous interrupted write. Run at startup as part of
// initMirror so the temp-and-rename atomic-write pattern
// in later commits starts from a clean state. Subfolders
// are not yet a concern in Phase 1A (the active folder is
// flat), but tolerating them defensively means later
// commits do not have to revisit this helper.
async function cleanLeftoverTmpFiles() {
    const folder = getMirrorFolderPath();
    try {
        const entries = await fsp.readdir(folder, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (!entry.name.endsWith(TMP_SUFFIX)) continue;
            await fsp.unlink(path.join(folder, entry.name));
        }
    } catch (err) {
        if (err.code === 'ENOENT') return;
        // Do not let cleanup failure block initialization.
        console.warn(`GXW: leftover .tmp cleanup failed: ${err.message}`);
    }
}

// Build an active-score.json stub with the full schema
// shape but null / empty defaults for any field that has
// no value yet. Used by writeActiveScoreStub on startup
// and enable, and by writeActiveScoreStubSync on quit, so
// an AI reading the folder before the first content push
// (or after the app has quit) sees the same shape it will
// see after content lands — just with placeholder values
// rather than real ones. Keeping the shape stable means
// the AI doesn't have to special-case the pre-push state.
function makeStubSnapshot(isLive) {
    return {
        protocolVersion: PROTOCOL_VERSION,
        isLive,
        score: null,
        sync: null,
        transport: null,
        files: {
            roundTrip: [],
            observationOnly: [ACTIVE_SCORE_FILENAME],
        },
        lastApplyResult: null,
    };
}

// active-score.json stub writer. Phase 1A commit 1 wrote
// a minimal {protocolVersion, isLive} object here; commit
// 4 expands it to the full schema shape (via
// makeStubSnapshot) so the file's structure is stable
// across the app's lifecycle. An AI reading the folder
// before the first content push sees the same field names
// it will see afterwards, just populated with null / empty
// placeholders instead of real values.
async function writeActiveScoreStub(isLive) {
    const stub = makeStubSnapshot(isLive);
    const target = path.join(getMirrorFolderPath(), ACTIVE_SCORE_FILENAME);
    await fsp.writeFile(target, JSON.stringify(stub, null, 2), 'utf8');
}

// Synchronous variant for the will-quit hook, which cannot
// await async work cleanly. Writes the same stub via
// fs.writeFileSync so the isLive=false transition lands
// before the process exits. The folder is guaranteed to
// exist at this point because shutdown is only called when
// the mirror is enabled, and enabling always ensures the
// folder up front.
function writeActiveScoreStubSync(isLive) {
    const stub = makeStubSnapshot(isLive);
    const target = path.join(getMirrorFolderPath(), ACTIVE_SCORE_FILENAME);
    try {
        fs.writeFileSync(target, JSON.stringify(stub, null, 2), 'utf8');
    } catch (err) {
        console.warn(`GXW: could not write isLive=false on quit: ${err.message}`);
    }
}

// Atomic write helper. Writes the new content to a
// <name>.tmp file first and then renames atomically into
// place. On POSIX systems (macOS, Linux) the rename is
// atomic from a reader's perspective: any process or AI
// tool watching the target path sees either the old
// content or the new content but never a torn write in
// progress. fs.watch in Phase 1B will filter out events
// for *.tmp files so a renderer push does not look like
// an AI write to the round-trip pipeline. The Buffer
// argument is used for binary writes; pass null for text.
async function writeAtomic(targetPath, textContent, binaryContent) {
    const tmpPath = targetPath + TMP_SUFFIX;
    if (binaryContent !== null && binaryContent !== undefined) {
        await fsp.writeFile(tmpPath, binaryContent);
    } else {
        await fsp.writeFile(tmpPath, textContent ?? '', 'utf8');
    }
    await fsp.rename(tmpPath, targetPath);
}

// Best-effort unlink for stale files (a previous image
// whose filename differs from the current image's). ENOENT
// is silently ignored — the file may already be gone from
// an interrupted previous push, or never existed. Other
// errors log a warning but do not throw because a stale
// file lingering in the mirror folder is a cosmetic issue,
// not a correctness one.
async function tryUnlink(targetPath) {
    try {
        await fsp.unlink(targetPath);
    } catch (err) {
        if (err.code === 'ENOENT') return;
        console.warn(`GXW: could not unlink stale mirror file ${targetPath}: ${err.message}`);
    }
}

/**
 * Receive a score-state payload from the renderer and
 * write it into the mirror folder using atomic temp-and-
 * rename writes. Phase 1A commit 2.
 *
 * Payload shape:
 *   {
 *     sceneJsonText: string,
 *     behavioursJsText: string,
 *     image: { name: string, bytes: ArrayBuffer, mimeType: string } | null,
 *     score: { displayName: string, path: string | null, dirty: boolean },
 *     transport: { state: string, elapsedSeconds: number, beat: number | null, bpm: number | null } | null
 *   }
 *
 * Writes scene.json and behaviours.js unconditionally
 * (empty string is a valid content state). Writes the
 * image to <image.name> when present; when the new image's
 * name differs from the previously pushed image's name,
 * the previous file is unlinked first so the folder does
 * not accumulate orphans across score switches or image
 * replacements. Finally updates active-score.json with
 * protocolVersion, isLive=true, the score identity block,
 * and the sync.lastSyncAt timestamp.
 *
 * No-op when the mirror is disabled. The renderer should
 * not be calling pushScore in that state, but defending
 * here keeps a stray race (Settings toggled off while a
 * push was already in flight) from creating files in a
 * folder we have just cleared.
 *
 * Errors are caught at the IPC handler in electron-main.js
 * so a write failure surfaces as a rejected IPC promise
 * the renderer can report via the message area.
 *
 * @param {{sceneJsonText?: string, behavioursJsText?: string, image?: {name: string, bytes: ArrayBuffer, mimeType: string} | null, score?: {displayName?: string, path?: string | null, dirty?: boolean}, transport?: {state?: string, elapsedSeconds?: number, beat?: number | null, bpm?: number | null} | null} | null} payload
 */
async function pushScore(payload) {
    if (!enabled) return;
    if (payload === null || typeof payload !== 'object') return;

    const folder = getMirrorFolderPath();
    // The folder is created at enable time, but if it has
    // been removed externally since (the user deleted it
    // through Finder, the disk filled and recovered, etc.)
    // recreate it here so the push does not throw. Cheap
    // when the folder already exists.
    await fsp.mkdir(folder, { recursive: true });

    // Write scene.json and behaviours.js atomically. Both
    // are written every push, even when only one changed,
    // because deciding what "changed" requires reading the
    // previous on-disk content and the savings are not
    // worth the complexity for kilobyte-scale text files.
    await writeAtomic(
        path.join(folder, SCENE_FILENAME),
        typeof payload.sceneJsonText === 'string' ? payload.sceneJsonText : '',
        null,
    );
    await writeAtomic(
        path.join(folder, BEHAVIOURS_FILENAME),
        typeof payload.behavioursJsText === 'string' ? payload.behavioursJsText : '',
        null,
    );

    // Image handling. The bundle's image filename is
    // arbitrary (whatever the user imported under), so we
    // both write the new file and unlink any stale image
    // from a previous push whose name differs.
    let newImageName = null;
    if (payload.image !== null && payload.image !== undefined &&
        typeof payload.image.name === 'string' &&
        payload.image.name.length > 0 &&
        payload.image.bytes instanceof ArrayBuffer) {
        const buffer = Buffer.from(payload.image.bytes);
        await writeAtomic(
            path.join(folder, payload.image.name),
            null,
            buffer,
        );
        newImageName = payload.image.name;
    }
    if (lastPushedImageName !== null && lastPushedImageName !== newImageName) {
        await tryUnlink(path.join(folder, lastPushedImageName));
    }
    lastPushedImageName = newImageName;

    // Update active-score.json with the latest score
    // identity, sync timestamp, transport snapshot, files
    // lists, and lastApplyResult placeholder. Commit 4
    // expanded this from a stub-shaped {protocolVersion,
    // isLive, score, sync} into the full schema; the
    // transport block reflects the renderer's view at push
    // time (state, elapsedSeconds, beat, bpm); the files
    // block declares which files in the folder are round-
    // trip versus observation-only so the AI knows which
    // it can write to; lastApplyResult ships as null until
    // Phase 1B's validation pipeline lands and starts
    // populating it with apply outcomes. The file is
    // written via writeAtomic so an AI watcher in a future
    // round-trip iteration cannot read a torn mid-write
    // JSON.
    const score = payload.score ?? {};
    const roundTripFiles = [SCENE_FILENAME, BEHAVIOURS_FILENAME];
    if (newImageName !== null) roundTripFiles.push(newImageName);
    const snapshot = {
        protocolVersion: PROTOCOL_VERSION,
        isLive: true,
        score: {
            displayName: typeof score.displayName === 'string' ? score.displayName : '',
            path: typeof score.path === 'string' ? score.path : null,
            dirty: score.dirty === true,
        },
        sync: {
            lastSyncAt: new Date().toISOString(),
        },
        transport: payload.transport ?? null,
        files: {
            roundTrip: roundTripFiles,
            observationOnly: [ACTIVE_SCORE_FILENAME, RUNTIME_STATE_FILENAME],
        },
        lastApplyResult: null,
    };
    await writeAtomic(
        path.join(folder, ACTIVE_SCORE_FILENAME),
        JSON.stringify(snapshot, null, 2),
        null,
    );
}

/**
 * Receive a runtime-state payload from the renderer's
 * MirrorPush pipeline and write it as runtime-state.json
 * in the mirror folder. Phase 1A commit 3.
 *
 * Runtime state captures simulation-side state that
 * scene.json cannot express: current sprite positions and
 * velocities (which diverge from authored values after the
 * transport plays and then pauses under physics), current
 * cursor positions along each curve, the transport time and
 * beat at the moment of capture. The file is written via
 * atomic temp-and-rename so an AI reading it never sees a
 * torn JSON. Single file overwritten on each push — no time
 * series, the AI reasons over one moment of runtime state
 * at a time.
 *
 * Captures happen at-rest only (transport stopped or paused).
 * The renderer gates by checking transport.isPlaying before
 * calling pushRuntimeState, so a captured payload here is
 * always one of those two states. Active playback is
 * deliberately not surfaced — capturing every frame of a
 * running simulation would flood the file and produce more
 * data than an AI can usefully reason about while audio is
 * firing. The post-Phase-1B note-event log is the planned
 * surface for playback observability when it lands.
 *
 * runtime-state.json schema:
 *
 *   {
 *     protocolVersion: 1,
 *     capturedAt: "ISO 8601 string",
 *     transport: {
 *       state: "stopped" | "paused",
 *       elapsedSeconds: number,
 *       elapsedBeats: number | null,    // null when bpm is null
 *       musicalPosition: {bars, beats, ticks} | null,
 *       bpm: number | null
 *     },
 *     sprites: [
 *       {
 *         id: string,
 *         position: {x: number, y: number},
 *         velocity: {vx: number, vy: number},
 *         cycle: {count: number, progress: number}
 *       }
 *     ],
 *     curves: [
 *       {
 *         id: string,
 *         offset: {dx: number, dy: number},
 *         halted: boolean,
 *         cycle: {count: number, progress: number},
 *         cursor: {t: number, x: number, y: number} | null
 *       }
 *     ]
 *   }
 *
 * Triggers are intentionally omitted from the schema since
 * they don't move (no velocity in the scene model) and
 * scene.json fully describes their state. The cursor field
 * on curves is null when the shape couldn't be sampled —
 * typically a degenerate piste (fewer than two points) or a
 * not-yet-implemented shape type (bezier, helice).
 *
 * The full schema also needs to be documented in AGENTS.md
 * once that lands in commit 6, since it differs from
 * scene.json's schema and an AI reading the mirror folder
 * needs both descriptions.
 *
 * No-op when the mirror is disabled (defensive against a
 * stray race where Settings toggled off while a push was
 * already in flight). Errors propagate up through the IPC
 * so the renderer can surface them via the message area.
 *
 * @param {object | null} payload
 */
async function pushRuntimeState(payload) {
    if (!enabled) return;
    if (payload === null || typeof payload !== 'object') return;

    const folder = getMirrorFolderPath();
    await fsp.mkdir(folder, { recursive: true });

    const snapshot = {
        protocolVersion: PROTOCOL_VERSION,
        capturedAt: new Date().toISOString(),
        transport: payload.transport ?? null,
        sprites: Array.isArray(payload.sprites) ? payload.sprites : [],
        curves: Array.isArray(payload.curves) ? payload.curves : [],
    };

    await writeAtomic(
        path.join(folder, RUNTIME_STATE_FILENAME),
        JSON.stringify(snapshot, null, 2),
        null,
    );
}

// --- Public API ---

/**
 * Initialise the mirror at app startup. Reads the enabled
 * flag from settings.json; if enabled, ensures the folder
 * exists, cleans any leftover .tmp files from a previous
 * interrupted write, and writes the active-score.json stub
 * with isLive=true. Called once from app.whenReady in
 * electron-main.js after the IPC handlers are registered.
 *
 * Safe to call when disabled — does nothing in that case.
 * The folder is not created when disabled, so an opt-out
 * user has no surprise folder in their Application
 * Support directory.
 */
async function initMirror() {
    enabled = await readMirrorEnabledSetting();
    if (!enabled) return;
    try {
        await ensureMirrorFolder();
        await cleanLeftoverTmpFiles();
        await writeActiveScoreStub(true);
    } catch (err) {
        console.warn(
            `GXW: mirror initialization failed (${err.message}). ` +
            `Mirror will stay disabled for this session.`,
        );
        enabled = false;
    }
}

/**
 * Enable or disable the mirror. Persists the new setting
 * and performs the corresponding lifecycle: enabling
 * ensures the folder, cleans leftover .tmp files, and
 * writes the isLive=true stub; disabling writes
 * isLive=false then clears the folder so the user's
 * Application Support directory is not left holding a
 * stale Active/ tree.
 *
 * Idempotent — setEnabled(current state) is a no-op aside
 * from re-writing the setting.
 *
 * @param {boolean} value
 */
async function setEnabled(value) {
    const target = Boolean(value);
    await writeMirrorEnabledSetting(target);
    if (target === enabled) return;
    enabled = target;
    if (enabled) {
        try {
            await ensureMirrorFolder();
            await cleanLeftoverTmpFiles();
            await writeActiveScoreStub(true);
        } catch (err) {
            console.warn(
                `GXW: enabling mirror failed: ${err.message}. ` +
                `Reverting to disabled.`,
            );
            enabled = false;
            await writeMirrorEnabledSetting(false);
        }
    } else {
        // Disable: best-effort isLive=false write so an AI
        // observing the folder briefly between toggle-off
        // and folder-clear sees the right state, then
        // clear the folder. The clear path tolerates the
        // file already being gone.
        try {
            await writeActiveScoreStub(false);
        } catch {
            // Ignore — the clear below will remove the
            // file anyway. The write is just a defensive
            // courtesy for any AI watching during the gap.
        }
        try {
            await clearMirrorFolder();
        } catch (err) {
            console.warn(
                `GXW: clearing mirror folder on disable failed: ${err.message}`,
            );
        }
        // Reset the image-name memory so the next enable +
        // first push doesn't try to unlink a file that
        // belongs to a previous session.
        lastPushedImageName = null;
    }
}

/**
 * Return the mirror's current public-facing state. Used
 * by the renderer's Settings dialog to show the canonical
 * folder path and the current enabled state.
 *
 * @returns {{enabled: boolean, folderPath: string}}
 */
function getStatus() {
    return {
        enabled,
        folderPath: getMirrorFolderPath(),
    };
}

/**
 * Shut down the mirror at app quit. When enabled, writes
 * isLive=false to active-score.json synchronously so the
 * transition lands before the process exits. Called from
 * the will-quit hook in electron-main.js alongside the
 * MIDI port cleanup. No-op when disabled.
 */
function shutdown() {
    if (!enabled) return;
    writeActiveScoreStubSync(false);
}

module.exports = { initMirror, setEnabled, getStatus, shutdown, pushScore, pushRuntimeState };
