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
// This module owns the main-process side of the mirror:
// folder lifecycle (creation on enable, clearing on
// disable, cleanup of leftover .tmp files at startup);
// content pushes from the renderer (scene.json,
// behaviours.js, image); active-score.json maintenance
// with protocol metadata and the transport snapshot;
// runtime-state.json capture at at-rest moments; copying
// the static AI grounding docs (AGENTS.md, sceneSchema.md)
// on enable; and the fs.watch infrastructure that detects
// external writes from an AI participating in the round-
// trip protocol. Atomic temp-and-rename writes plus a
// self-write mute mechanism keep self-originating events
// out of the watch pipeline.
//
// Phase 1A (write side: bundle → mirror) is complete.
// Phase 1B (round-trip: mirror → bundle) is partially in
// place: the watcher detects events, but the apply
// pipeline that turns those events into bundle updates
// lands in later Phase 1B commits.
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
// extended in subsequent commits.

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const ACTIVE_FOLDER_NAME = 'Active';
const ACTIVE_SCORE_FILENAME = 'active-score.json';
const SCENE_FILENAME = 'scene.json';
const BEHAVIOURS_FILENAME = 'behaviours.js';
const RUNTIME_STATE_FILENAME = 'runtime-state.json';
const AGENTS_FILENAME = 'AGENTS.md';
const SCENE_SCHEMA_FILENAME = 'sceneSchema.md';
const MIRROR_DOCS_DIR = 'mirror-docs';
const LAST_APPLY_RESULT_FILENAME = 'last-apply-result.json';
const PROTOCOL_VERSION = 1;
const SETTING_KEY = 'mirrorEnabled';
const TMP_SUFFIX = '.tmp';
const MUTE_TTL_MS = 5000;
// Empirically, fs.watch on macOS fires two events per
// atomic temp-and-rename: typically a rename event
// followed by a second rename or change event for the
// same destination filename. Both must be suppressed for
// a self-write to be invisible to the round-trip pipeline,
// so each writeAtomic registers a mute with this initial
// count. If a future macOS revision delivers a different
// number of events per rename, the consequence is bounded:
// fewer events leak as false positives (handled by the
// apply pipeline's re-validation in Phase 1B commit 2),
// more events leave count-residue that the TTL evicts.
const EVENTS_PER_RENAME = 2;
// Sentinel filename and orphan timeout for AI batch
// coordination (Phase 1B commit 4). When an AI is about
// to make a score-related change, it writes this file
// as its first action; the watcher then suppresses the
// quiescence-based batching timer and lets events
// accumulate without ceiling. When the AI is done
// (writes complete, or AI decided no writes were needed),
// it removes the sentinel and the watcher fires
// processBatch immediately, ensuring multi-file batches
// land as one coalesced apply regardless of how slow the
// AI's tool-call cadence is. ORPHAN_TIMEOUT_MS guards
// against an AI that died mid-batch: 90 seconds of
// inactivity (no new round-trip events arriving while
// the sentinel is active) treats the sentinel as
// abandoned — the watcher removes the file itself and
// processBatch fires with whatever accumulated. The
// validation pipeline in mirrorPush.applyBatch catches
// any broken or partial content.
const PENDING_SENTINEL_FILENAME = '.pending';
const ORPHAN_TIMEOUT_MS = 90000;

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
// `watcher` holds the fs.watch instance when the mirror is
// enabled, null otherwise. `selfWriteMutes` is the Map
// used by the round-trip watcher to ignore events from
// the bundle's own writes; see the watcher infrastructure
// section below.
let enabled = false;
let folderPathCache = null;
let lastPushedImageName = null;
let watcher = null;
const selfWriteMutes = new Map();
// Batch accumulator state (Phase 1B commit 2). pendingBatch
// holds the set of filenames seen while .pending is active.
// processBatch dispatches the assembled batch to the renderer
// over IPC when the AI removes the sentinel (or the orphan
// timer fires as a safety net). mainWindow is the
// BrowserWindow reference electron-main.js hands us via
// setMainWindow; processBatch uses it to dispatch.
const pendingBatch = new Set();
let mainWindow = null;
// Sentinel state. .pending is required for all AI writes
// (see AGENTS.md): the AI creates the file before writing
// any round-trip files and removes it after the batch is
// complete. sentinelActive mirrors the file's presence in
// the in-process state. Round-trip events that arrive
// while sentinelActive is false are orphans (late writes
// from a cancelled batch, or an AI not following the
// protocol) and get dropped after a log line goes to the
// renderer. The orphan timer fires after 90 seconds of
// inactivity while the sentinel is active and acts as a
// safety net against an AI that never removes its
// sentinel, typically because its process died mid-batch.
//
// batchInProgress is the latch that tracks whether the
// renderer has already been notified that a batch is in
// flight (via gxw:mirror-batch-started). It flips true on
// sentinel arrival and back to false when processBatch
// fires batch-ready (signalling batch completion to the
// renderer) or when cancelBatch clears state. Prevents
// double-firing batch-started events.
let sentinelActive = false;
let orphanTimer = null;
let batchInProgress = false;

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

// Remove a leftover .pending sentinel from a previous
// session. If the app died with an AI batch mid-flight
// the .pending file would survive to the next startup;
// without cleanup, the watcher would immediately enter
// sentinel mode on start (the file already exists),
// which is wrong because no AI from this session put
// it there. Cleaning at startup gives every fresh
// session a known-good no-sentinel state. Best-effort:
// ENOENT is normal, other failures log a warning.
async function cleanLeftoverSentinel() {
    await removeSentinelFile();
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
            observationOnly: [
                ACTIVE_SCORE_FILENAME,
                RUNTIME_STATE_FILENAME,
                LAST_APPLY_RESULT_FILENAME,
                AGENTS_FILENAME,
                SCENE_SCHEMA_FILENAME,
            ],
        },
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

// Copy the static AI-grounding documents (AGENTS.md and
// sceneSchema.md) from the repo's mirror-docs/ folder into
// the mirror folder. These files are reference material for
// any AI reading the mirror — AGENTS.md is the protocol
// orientation, sceneSchema.md is the scene.json schema
// reference. They are read-only from the AI's side and only
// (re-)written when the mirror is enabled, so contents stay
// stable across content pushes.
//
// Sources live at <__dirname>/mirror-docs/<name>. In dev
// mode __dirname resolves to the repo root; in a packaged
// app it resolves to the bundled location of
// electron-mirror.js. The build configuration must include
// mirror-docs/ in the package alongside electron-mirror.js
// for the packaged-app case; without it the reads fall
// through to the catch and the static docs are absent from
// the mirror folder, which leaves any AI reading the mirror
// without reference material but does not break the rest of
// the protocol.
//
// Failures are best-effort: log a warning and continue.
async function writeStaticDocs() {
    const folder = getMirrorFolderPath();
    const docs = [AGENTS_FILENAME, SCENE_SCHEMA_FILENAME];
    for (const name of docs) {
        const sourcePath = path.join(__dirname, MIRROR_DOCS_DIR, name);
        const targetPath = path.join(folder, name);
        try {
            const content = await fsp.readFile(sourcePath, 'utf8');
            await writeAtomic(targetPath, content, null);
        } catch (err) {
            console.warn(
                `GXW: could not write static doc ${name}: ${err.message}. ` +
                `AI reading the mirror will be missing this reference.`,
            );
        }
    }
}

// Watcher infrastructure (Phase 1B). fs.watch on the
// mirror folder detects external writes — typically AI-
// edited scene.json or behaviours.js arriving via a
// filesystem MCP server — so the bundle can apply them
// back into its in-memory state. The watcher is started
// when the mirror is enabled and torn down on disable or
// app quit. Score-switch lifecycle is a later Phase 1B
// commit.
//
// Event filtering happens in two layers. *.tmp events are
// dropped entirely since those are intermediate states
// from the bundle's own atomic-write staging. Non-.tmp
// events are checked against the self-write mute Map:
// writeAtomic registers an expected event count on the
// destination filename before its rename (see
// EVENTS_PER_RENAME for why the count is not 1), the
// handler consumes one count per matching event, and a
// TTL evicts stale entries if an event count is
// over-registered (e.g., a rename that failed, or a
// macOS variant that delivers fewer events than expected).
// Count-based muting rather than time-window muting means
// a genuine AI write landing soon after a self-write does
// not get accidentally suppressed.
//
// MUTE_TTL_MS is set generously (5 seconds) as defensive
// headroom against FSEvents stalls under heavy system load.
// In normal conditions events arrive within tens of
// milliseconds and consume their mutes almost immediately.
// The TTL only matters as a safety net for residual
// uncounted slots; legitimate AI writes within the window
// are not blocked because the mute is already consumed by
// then.
//
// For this commit (Phase 1B commit 1) events that pass
// the filters are just logged. Phase 1B commit 2 will
// connect a quiescence-based batcher and the validation
// pipeline; the console.log call inside handleWatcherEvent
// is the hook point for that integration.

function muteNextEvent(filename) {
    const existing = selfWriteMutes.get(filename);
    if (existing !== undefined) {
        existing.count += EVENTS_PER_RENAME;
        clearTimeout(existing.timeoutId);
        existing.timeoutId = setTimeout(() => {
            selfWriteMutes.delete(filename);
        }, MUTE_TTL_MS);
    } else {
        const timeoutId = setTimeout(() => {
            selfWriteMutes.delete(filename);
        }, MUTE_TTL_MS);
        selfWriteMutes.set(filename, { count: EVENTS_PER_RENAME, timeoutId });
    }
}

function consumeMute(filename) {
    const entry = selfWriteMutes.get(filename);
    if (entry === undefined) return false;
    entry.count -= 1;
    if (entry.count <= 0) {
        clearTimeout(entry.timeoutId);
        selfWriteMutes.delete(filename);
    }
    return true;
}

function clearAllMutes() {
    for (const entry of selfWriteMutes.values()) {
        clearTimeout(entry.timeoutId);
    }
    selfWriteMutes.clear();
}

// Whether a filename is one of the round-trip files the
// apply pipeline acts on. Round-trip files are scene.json,
// behaviours.js, and the current image (whose filename
// matches lastPushedImageName). Observation-only files
// (active-score.json, runtime-state.json, AGENTS.md,
// sceneSchema.md) and any AI-created files with names we
// don't recognise return false and the watcher ignores them
// — the design treats observation-only as write-from-bundle
// and any AI edits to them as discardable.
//
// Image filename matching is strict on lastPushedImageName:
// if an AI writes an image under a different filename the
// event is ignored rather than treated as a replacement.
// The AI is expected to overwrite the existing image
// filename; broadening to recognise arbitrary new image
// names is a later-phase consideration once the basic
// round-trip is in real use.
function isRoundTripFile(filename) {
    if (filename === SCENE_FILENAME) return true;
    if (filename === BEHAVIOURS_FILENAME) return true;
    if (lastPushedImageName !== null && filename === lastPushedImageName) return true;
    return false;
}

// Minimal mime-type inference for the batch payload's
// image entry. Covers the image formats GeoSonel imports
// today (png, jpg, jpeg, gif, webp, svg). Anything else
// falls through to application/octet-stream and the
// renderer's apply path treats it as opaque bytes. The
// inference duplicates what electron-main.js's getMimeType
// does for the same extensions; kept local here so the
// mirror module doesn't reach into electron-main.js's
// internals for a one-call helper.
function inferImageMimeType(filename) {
    const dot = filename.lastIndexOf('.');
    const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
    switch (ext) {
        case '.png':  return 'image/png';
        case '.jpg':  return 'image/jpeg';
        case '.jpeg': return 'image/jpeg';
        case '.gif':  return 'image/gif';
        case '.webp': return 'image/webp';
        case '.svg':  return 'image/svg+xml';
        default:      return 'application/octet-stream';
    }
}

function handleWatcherEvent(eventType, filename) {
    // fs.watch can deliver a null filename on some
    // platforms (Linux inotify when the underlying event
    // lacks a name). On macOS this should not happen, but
    // the defensive check is cheap.
    if (filename === null) return;

    // Intermediate atomic-write staging files. The .tmp
    // file is short-lived and never the final write
    // target, so there is nothing to apply.
    if (filename.endsWith(TMP_SUFFIX)) return;

    // Sentinel events route to the dedicated handler that
    // decides between arrival (file appeared) and removal
    // (file disappeared). Sentinel files are protocol-
    // level coordination, neither round-trip nor
    // observation-only, so we don't run them through the
    // self-write mute or round-trip filter — the mirror
    // never writes the sentinel itself, only AI processes
    // and the orphan-timer cleanup do.
    if (filename === PENDING_SENTINEL_FILENAME) {
        handleSentinelEvent();
        return;
    }

    // Self-originating writes registered by writeAtomic.
    // The mute consumes one expected event per
    // registration.
    if (consumeMute(filename)) return;

    // Filter to round-trip files. Observation-only files
    // and unrecognised AI-created files are ignored
    // outright — the apply pipeline only acts on the
    // round-trip surface (scene.json, behaviours.js,
    // current image).
    if (!isRoundTripFile(filename)) return;

    // .pending is required for all AI writes (see
    // AGENTS.md). A round-trip event without an active
    // sentinel is an orphan, either a late write from a
    // batch the user cancelled or an AI not following
    // protocol. Drop it and notify the renderer's message
    // area so the user has a forensic log line.
    if (!sentinelActive) {
        notifyOrphanWrite(filename);
        return;
    }

    pendingBatch.add(filename);
    resetOrphanTimer();
}

// Handle a watcher event for the sentinel file. Checks
// whether .pending currently exists on disk to
// distinguish a creation from a deletion (fs.watch's
// 'rename' eventType fires for both on macOS), then
// routes to arrival or removal accordingly. A redundant
// arrival event (file already known to be there)
// just resets the orphan timer, which is the correct
// idempotent behaviour. A redundant removal event
// (sentinelActive already false) is silently dropped.
//
// Synchronous existence check (fs.existsSync rather than
// fsp.access) so sentinelActive is set before
// handleWatcherEvent returns. With an async check, a
// scene.json event arriving during the await could see
// sentinelActive still false and get dropped as an
// orphan. The cost is one stat call against the mirror
// folder, cheap and main-process local.
function handleSentinelEvent() {
    const folder = getMirrorFolderPath();
    const sentinelPath = path.join(folder, PENDING_SENTINEL_FILENAME);
    const exists = fs.existsSync(sentinelPath);
    if (exists) {
        handleSentinelArrival();
    } else if (sentinelActive) {
        void handleSentinelRemoval();
    }
}

// Enter sentinel mode. Starts the orphan timer so an AI
// that dies mid-batch doesn't hold the mirror
// indefinitely. Idempotent: calling this while
// sentinelActive is already true just resets the orphan
// timer, which is the right behaviour for a redundant
// event — the AI is still alive and writing.
function handleSentinelArrival() {
    sentinelActive = true;

    // Notify the renderer that a batch is starting so the
    // confirm-to-apply dialog appears in its Thinking
    // state. The dialog stays in that state through the
    // AI's work (could be many seconds) and transitions
    // to Ready when processBatch fires batch-ready after
    // the AI removes the sentinel.
    if (!batchInProgress) {
        notifyBatchStarted();
    }

    resetOrphanTimer();
}

// Exit sentinel mode and fire processBatch immediately
// to ship whatever accumulated. The orphan timer is
// cancelled. If pendingBatch is empty (the AI wrote
// .pending and removed it without writing any round-
// trip files — e.g., it decided no change was needed)
// processBatch is a no-op and the renderer never sees
// a batch-ready event, which is the correct behaviour:
// there was nothing to apply.
async function handleSentinelRemoval() {
    sentinelActive = false;

    if (orphanTimer !== null) {
        clearTimeout(orphanTimer);
        orphanTimer = null;
    }

    await processBatch();
}

// Reset the orphan timer. Called on sentinel arrival
// (start timer) and on each round-trip event while the
// sentinel is active (push the timer back). The
// semantics are "90 seconds of inactivity" — a busy AI
// can hold the sentinel arbitrarily long as long as it
// keeps making writes, while a dead AI triggers the
// timeout after 90s of silence. On timeout: clear
// sentinel state, remove the .pending file (best
// effort), and process whatever accumulated as a normal
// completion. The validation pipeline in
// mirrorPush.applyBatch catches broken or partial
// content via the existing rejection-and-rollback path.
function resetOrphanTimer() {
    if (orphanTimer !== null) clearTimeout(orphanTimer);
    orphanTimer = setTimeout(async () => {
        orphanTimer = null;
        sentinelActive = false;
        await removeSentinelFile();
        await processBatch();
    }, ORPHAN_TIMEOUT_MS);
}

// Remove the .pending sentinel file from disk. Used by
// the orphan timeout path and by cleanLeftoverSentinel.
// ENOENT is silently ignored — the sentinel may already
// be gone (raced removal, never created in the first
// place). Other errors log a warning but do not throw,
// since failing to remove the sentinel is a state-
// leakage issue rather than a correctness one.
async function removeSentinelFile() {
    const folder = getMirrorFolderPath();
    const sentinelPath = path.join(folder, PENDING_SENTINEL_FILENAME);
    try {
        await fsp.unlink(sentinelPath);
    } catch (err) {
        if (err.code === 'ENOENT') return;
        console.warn(`GXW: failed to remove sentinel: ${err.message}`);
    }
}

// Notify the renderer that an AI batch has started.
// Fired on sentinel arrival or on the first round-trip
// event of a no-sentinel batch. The renderer responds
// by showing the confirm-to-apply dialog in its Thinking
// state. batchInProgress latches the notification so
// subsequent events in the same batch don't re-fire it.
// Reset to false when processBatch fires batch-ready or
// when cancelBatch clears state.
function notifyBatchStarted() {
    batchInProgress = true;
    if (mainWindow === null) return;
    try {
        mainWindow.webContents.send('gxw:mirror-batch-started');
    } catch (err) {
        console.warn(`GXW: failed to dispatch batch-started: ${err.message}`);
    }
}

// Notify the renderer that an AI write arrived without
// an active .pending sentinel. The renderer surfaces a
// log line in the message area so the user has forensic
// visibility into late writes from cancelled batches
// (or AIs not following protocol). No state changes
// here: orphan writes are dropped entirely and don't
// participate in any batch.
function notifyOrphanWrite(filename) {
    if (mainWindow === null) return;
    try {
        mainWindow.webContents.send('gxw:mirror-orphan-write', { filename });
    } catch (err) {
        console.warn(`GXW: failed to dispatch orphan-write: ${err.message}`);
    }
}

// Read each file in the pending batch from disk, package
// the entries as {filename, kind, content [, mimeType]},
// and dispatch to the renderer via webContents.send. The
// renderer's MirrorPush.applyBatch validates and applies.
// Reads happen serially rather than in parallel — the
// batch is small (at most three files in Phase 1) and
// keeping the I/O ordered makes any failure log lines
// line up with the file they refer to.
//
// Files that disappeared between event delivery and the
// read (e.g., AI deleted right after writing) log a
// warning and drop out of the batch. The remaining entries
// still ship; the renderer applies what's there. This is
// consistent with the design's failure model: the bundle
// stays at its previous content if a batch can't be
// applied cleanly, and a subsequent push will overwrite
// the mirror back to the bundle's view.
//
// Dispatch is best-effort: a missing mainWindow (AI write
// arrived before electron-main.js wired one up, or the
// window has been destroyed) logs and drops. webContents
// sends arriving before the renderer's onBatchReady
// listener is registered are simply not observed by the
// renderer; the next user edit's push corrects any
// disagreement.
async function processBatch() {
    const filenames = Array.from(pendingBatch);
    pendingBatch.clear();
    batchInProgress = false;

    const folder = getMirrorFolderPath();
    const entries = [];
    for (const filename of filenames) {
        const filepath = path.join(folder, filename);
        const isText = filename === SCENE_FILENAME || filename === BEHAVIOURS_FILENAME;
        try {
            if (isText) {
                const content = await fsp.readFile(filepath, 'utf8');
                entries.push({ filename, kind: 'text', content });
            } else {
                const buffer = await fsp.readFile(filepath);
                const ab = buffer.buffer.slice(
                    buffer.byteOffset,
                    buffer.byteOffset + buffer.byteLength,
                );
                entries.push({
                    filename,
                    kind: 'binary',
                    content: ab,
                    mimeType: inferImageMimeType(filename),
                });
            }
        } catch (err) {
            console.warn(
                `GXW: could not read mirror file ${filename} for batch: ${err.message}`,
            );
        }
    }

    // Always dispatch batch-ready, even when the batch is
    // empty (e.g., AI wrote .pending and removed it
    // without writing any round-trip files, or the orphan
    // timer fired with nothing accumulated). The empty
    // batch tells the renderer to dismiss the dialog that
    // appeared on batch-started — without this dispatch
    // the dialog would stick around with no batch to
    // accept or reject. The renderer's applyBatch handles
    // empty arrays by transitioning straight back to idle.
    if (mainWindow === null) {
        if (entries.length > 0) {
            console.warn(
                `GXW: mirror batch ready but no main window to dispatch to; dropping ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`,
            );
        }
        return;
    }
    try {
        mainWindow.webContents.send('gxw:mirror-batch-ready', entries);
    } catch (err) {
        console.warn(`GXW: failed to dispatch mirror batch: ${err.message}`);
    }
}

// Drop the in-progress batch. Called from stopWatcher
// (mirror disable, app quit) so any accumulated events
// don't leak into a subsequent enable's batch state.
function clearPendingBatch() {
    pendingBatch.clear();
}

function startWatcher() {
    if (watcher !== null) return;
    const folder = getMirrorFolderPath();
    try {
        watcher = fs.watch(folder, { persistent: false }, handleWatcherEvent);
    } catch (err) {
        console.warn(
            `GXW: could not start mirror watcher: ${err.message}. ` +
            `AI edits to round-trip files will not be detected this session.`,
        );
        watcher = null;
    }
}

function stopWatcher() {
    if (watcher === null) return;
    try {
        watcher.close();
    } catch (err) {
        console.warn(`GXW: error closing mirror watcher: ${err.message}`);
    }
    watcher = null;
    clearAllMutes();
    clearPendingBatch();
    clearSentinelState();
}

// Clear sentinel state and cancel the orphan timer.
// Called from stopWatcher so an outstanding sentinel
// doesn't carry over after teardown. The .pending file
// itself stays on disk if it existed — cleanLeftoverSentinel
// at the next startup or enable will handle it.
function clearSentinelState() {
    sentinelActive = false;
    batchInProgress = false;
    if (orphanTimer !== null) {
        clearTimeout(orphanTimer);
        orphanTimer = null;
    }
}

// Atomic write helper. Writes the new content to a
// <name>.tmp file first and then renames atomically into
// place. On POSIX systems (macOS, Linux) the rename is
// atomic from a reader's perspective: any process or AI
// tool watching the target path sees either the old
// content or the new content but never a torn write in
// progress. The watcher (when running) filters out events
// on *.tmp files entirely and uses the self-write mute
// mechanism registered just before the rename below to
// suppress the rename event on the destination filename,
// so a self-originating write never looks like an AI edit
// to the round-trip pipeline. The Buffer argument is used
// for binary writes; pass null for text.
async function writeAtomic(targetPath, textContent, binaryContent) {
    const tmpPath = targetPath + TMP_SUFFIX;
    if (binaryContent !== null && binaryContent !== undefined) {
        await fsp.writeFile(tmpPath, binaryContent);
    } else {
        await fsp.writeFile(tmpPath, textContent ?? '', 'utf8');
    }
    // Register the upcoming rename event as self-originating
    // so the watcher's event handler ignores it. Skipped when
    // no watcher is running (early startup before
    // startWatcher, or mirror disabled).
    if (watcher !== null) {
        muteNextEvent(path.basename(targetPath));
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
            observationOnly: [
                ACTIVE_SCORE_FILENAME,
                RUNTIME_STATE_FILENAME,
                LAST_APPLY_RESULT_FILENAME,
                AGENTS_FILENAME,
                SCENE_SCHEMA_FILENAME,
            ],
        },
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
 * The full schema is documented in AGENTS.md (a sibling
 * file in the mirror folder, landed in Phase 1A commit 5),
 * since it differs from scene.json's schema and an AI
 * reading the mirror folder needs both descriptions.
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

/**
 * Write last-apply-result.json with the outcome of the
 * renderer's most recent applyBatch call. Phase 1B commit
 * 3. Called via IPC from the renderer's mirrorPush.js
 * after every batch — success or rejection — so an AI
 * reading the mirror folder can find out whether its last
 * edit was accepted, and if not, why.
 *
 * Two payload shapes. Success:
 *
 *   {
 *     status: "success",
 *     timestamp: "ISO 8601 string",
 *     applied: ["scene.json", "behaviours.js"]
 *   }
 *
 * Rejection:
 *
 *   {
 *     status: "rejected",
 *     timestamp: "ISO 8601 string",
 *     filename: "scene.json",
 *     error: "Expected double-quoted property name in JSON at position 613"
 *   }
 *
 * The success applied list reflects what actually landed:
 * for a multi-file batch with one image and two text
 * files, all three filenames appear in mirror-surface
 * naming. The rejection filename is the first file that
 * failed validation; applyBatch short-circuits on the
 * first failure, so a rejection result describes one
 * specific problem rather than every problem.
 *
 * The file is written via writeAtomic so an AI watching
 * for changes never reads a torn mid-write JSON. The
 * watcher's round-trip filter excludes
 * last-apply-result.json by name, so the resulting events
 * are dropped at the filter rather than feeding back
 * through the apply pipeline — the self-write mute path
 * is in place too, but the filter would catch them
 * regardless.
 *
 * No-op when the mirror is disabled (defensive against a
 * stray race where Settings toggled off while a batch was
 * mid-apply). Errors propagate up through the IPC so
 * mirrorPush.js can log them, though rollback proceeds
 * regardless: surfacing the apply result is best-effort,
 * keeping the mirror folder consistent with the bundle is
 * mandatory.
 *
 * @param {object | null} payload
 */
async function writeApplyResult(payload) {
    if (!enabled) return;
    if (payload === null || typeof payload !== 'object') return;

    const folder = getMirrorFolderPath();
    await fsp.mkdir(folder, { recursive: true });
    await writeAtomic(
        path.join(folder, LAST_APPLY_RESULT_FILENAME),
        JSON.stringify(payload, null, 2),
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
        await cleanLeftoverSentinel();
        await writeStaticDocs();
        await writeActiveScoreStub(true);
        startWatcher();
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
            await cleanLeftoverSentinel();
            await writeStaticDocs();
            await writeActiveScoreStub(true);
            startWatcher();
        } catch (err) {
            console.warn(
                `GXW: enabling mirror failed: ${err.message}. ` +
                `Reverting to disabled.`,
            );
            enabled = false;
            await writeMirrorEnabledSetting(false);
        }
    } else {
        // Disable: stop the watcher first so any events
        // from the upcoming clearMirrorFolder do not flow
        // through the handler, then best-effort isLive=false
        // write so an AI observing the folder briefly
        // between toggle-off and folder-clear sees the
        // right state, then clear the folder. The clear
        // path tolerates the file already being gone.
        stopWatcher();
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
 * Hand the mirror a reference to the main BrowserWindow.
 * Used by processBatch to dispatch ready batches to the
 * renderer via webContents.send. Called once from
 * electron-main.js after createWindow runs.
 *
 * Null-tolerant: passing null clears the reference, used
 * during teardown when the window is being destroyed.
 *
 * @param {Electron.BrowserWindow | null} window
 */
function setMainWindow(window) {
    mainWindow = window;
}

/**
 * Cancel an in-flight batch on user request. Phase 1B
 * commit 4b. Called via IPC from the renderer when the
 * user clicks Cancel on the confirm-to-apply dialog
 * during the Thinking state (sentinel still active or
 * quiescence still pending).
 *
 * Clears all in-flight batch state on the main side:
 * sentinel active flag, accumulated pendingBatch,
 * quiescence and orphan timers, the batch-started
 * latch. Removes the .pending file from disk if
 * present so the AI's view aligns with the cancel.
 * The renderer is responsible for the rollback push
 * back to the bundle's state — cancelBatch only
 * clears the main-process side.
 *
 * No-op when the mirror is disabled. The watcher event
 * that would fire from the .pending unlink is harmless:
 * handleSentinelEvent sees sentinelActive=false (already
 * cleared here) and silently skips.
 */
async function cancelBatch() {
    if (!enabled) return;
    sentinelActive = false;
    batchInProgress = false;
    pendingBatch.clear();
    if (orphanTimer !== null) {
        clearTimeout(orphanTimer);
        orphanTimer = null;
    }
    await removeSentinelFile();
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
    stopWatcher();
    writeActiveScoreStubSync(false);
}

module.exports = { initMirror, setEnabled, getStatus, shutdown, pushScore, pushRuntimeState, setMainWindow, writeApplyResult, cancelBatch };
