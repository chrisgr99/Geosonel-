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
const PROTOCOL_VERSION = 1;
const SETTING_KEY = 'mirrorEnabled';
const TMP_SUFFIX = '.tmp';

// Module-level state. `enabled` mirrors the persisted
// setting and is the canonical in-process answer for "is
// the mirror currently running"; the public getStatus()
// returns this. `folderPathCache` lazily resolves the
// folder path on first use since app.getPath('userData')
// is not available before app.whenReady.
let enabled = false;
let folderPathCache = null;

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

// Minimal active-score.json stub for Phase 1A commit 1.
// Carries only protocolVersion and isLive — the full
// schema (transport, files lists, lastApplyResult, score
// metadata) lands in commit 5 once content pushing and
// snapshot capture are in place. Until then, an AI reading
// the folder can at least verify the protocol version and
// whether GeoSonel is currently running, which is enough
// to gate "is it safe to edit" decisions.
async function writeActiveScoreStub(isLive) {
    const stub = {
        protocolVersion: PROTOCOL_VERSION,
        isLive,
    };
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
    const stub = {
        protocolVersion: PROTOCOL_VERSION,
        isLive,
    };
    const target = path.join(getMirrorFolderPath(), ACTIVE_SCORE_FILENAME);
    try {
        fs.writeFileSync(target, JSON.stringify(stub, null, 2), 'utf8');
    } catch (err) {
        console.warn(`GXW: could not write isLive=false on quit: ${err.message}`);
    }
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

module.exports = { initMirror, setEnabled, getStatus, shutdown };
