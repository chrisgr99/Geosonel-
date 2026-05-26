// Electron main process entry point.
//
// Creates the BrowserWindow that hosts GeoSonel's renderer (index.html),
// sets the app identity (name and dock icon), and hosts the IPC handlers
// that back disk-based score persistence (Stage 2 of the migration).
//
// "GeoSonel" is the user-facing name; "GXW" is the internal code name used
// throughout the source tree. All user-visible strings here use GeoSonel.
//
// Storage layout on disk:
//   <Scores folder>/                  default: ~/Documents/GeoSonel Scores
//     <Score name>.gxs/               macOS package; Stage 6 will add Info.plist
//                                     UTI declarations so Finder folds each .gxs
//                                     folder into a single document icon and
//                                     binds double-click back to GeoSonel.
//                                     Until then, .gxs folders show in Finder as
//                                     folders with the suffix visible.
//       scene.json
//       behaviors.js
//       <image file>                  optional, named per the score's imageName
//       .gxw-meta.json                hidden, carries imageName and any other
//                                     per-score metadata that doesn't fit in
//                                     scene.json
//
// App settings (chosen Scores folder location, current open score, etc.) live
// in <userData>/settings.json, so the Scores folder can be moved or relinked
// without losing app-level state.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { installMenu, updateMenuState } = require('./electron-menu.js');
const mirror = require('./electron-mirror.js');

// --- Native MIDI loader ---
//
// @julusian/midi is a maintained fork of node-midi that uses
// Node-API (N-API) for its native binding. N-API is ABI-
// stable across V8 / Node / Electron versions, so the
// prebuilt binaries shipped with the package work across
// reasonable upgrade ranges without an electron-rebuild
// step. The upstream `midi` package uses NAN, which doesn't
// compile against modern V8's external-pointer-tag API.
//
// Loading is wrapped in try/catch in case the prebuilt
// binary doesn't match the current platform or ABI. Failure
// is non-fatal: the app launches normally, the virtual
// MIDI port is unavailable, and the renderer's MIDISender
// reports the unavailability to the user.
let midi = null;
try {
  midi = require('@julusian/midi');
} catch (err) {
  console.warn(
    `GXW: @julusian/midi could not be loaded (${err.message}). ` +
    `Virtual MIDI port will be unavailable. Try removing ` +
    `node_modules and package-lock.json, then 'npm install' again.`,
  );
}

// Set the app name early so it appears in the menu bar, the About dialog,
// and the Force Quit listing instead of the default "Electron".
app.setName('GeoSonel');

let mainWindow;

// --- Virtual MIDI port ---
//
// GeoSonel publishes a CoreMIDI virtual source named "GeoSonel"
// via node-midi. Any DAW (Logic Pro, Bitwig Studio, etc.) sees
// this port in its MIDI input list and can route from it like
// any hardware MIDI source, removing the need for the user to
// set up an IAC Driver bus or any third-party virtual MIDI
// driver. This replaces the Web MIDI output-port enumeration
// model on Electron: the renderer doesn't pick a port; it
// sends to the virtual port we publish.
//
// Lifecycle. The port opens in app.whenReady (or stays null
// if node-midi failed to load), receives sends from the
// renderer via the gxw:midi-send IPC channel, and closes on
// app will-quit. The renderer's MIDISender queries
// gxw:midi-get-status at init time so it knows whether to
// emit the "ready" event to the toolbar indicator.
//
// Timing. The renderer passes a delayMs argument computed as
// (midiTime - performance.now()) where midiTime is the same
// performance.now()-domain timestamp Web MIDI's scheduled
// output.send accepts. Main schedules the actual MIDI write
// via setTimeout if delayMs > 0.5, dispatching immediately
// otherwise. setTimeout-based scheduling on Node has 1-4ms
// jitter typically, a precision regression from CoreMIDI's
// sub-millisecond hardware-level scheduling that Web MIDI
// gives us on the browser path. For typical musical material
// the difference is below the audible threshold; for very
// tight rhythms it may be noticeable, in which case a future
// commit could replace setTimeout with a native scheduled-
// send path via a small custom binding to CoreMIDI's
// MIDIPacket + MIDISend with timestamps.
//
// Platform note. macOS and Linux support virtual MIDI ports
// natively (CoreMIDI, ALSA). Windows does not — RtMidi can't
// create virtual ports on Windows. Windows users would need a
// third-party driver like loopMIDI. GeoSonel is macOS-first
// so this is not currently a constraint.
const MIDI_PORT_NAME = 'GeoSonel';
/** @type {any} */
let midiOutput = null;
let midiPortOpen = false;

function openMidiVirtualPort() {
  if (midi === null) return;
  try {
    midiOutput = new midi.Output();
    midiOutput.openVirtualPort(MIDI_PORT_NAME);
    midiPortOpen = true;
    console.log(`GXW: opened virtual MIDI port "${MIDI_PORT_NAME}".`);
  } catch (err) {
    midiOutput = null;
    midiPortOpen = false;
    console.warn(
      `GXW: could not open virtual MIDI port: ${err.message}. ` +
      `MIDI sending will be unavailable.`,
    );
  }
}

function closeMidiVirtualPort() {
  if (midiOutput === null) return;
  try {
    midiOutput.closePort();
  } catch (err) {
    console.warn(`GXW: error closing MIDI port: ${err.message}`);
  }
  midiOutput = null;
  midiPortOpen = false;
}

function sendMidiMessage(bytes) {
  if (midiOutput === null) return;
  try {
    midiOutput.sendMessage(bytes);
  } catch (err) {
    console.warn(`GXW: MIDI send failed: ${err.message}`);
  }
}

// Tracks whether the renderer has confirmed that the current close
// gesture should proceed. Set to true after the renderer sends
// 'gxw:close-decision' with 'proceed' (either no unsaved changes, or
// the user picked Save or Don't Save). When the next 'close' event
// fires, the handler sees the flag and allows the close to proceed
// without another interception cycle.
let closeConfirmed = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'GeoSonel',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Intercept the close gesture when the renderer has reported unsaved
  // changes. The actual dirty signal is the documentEdited state, which
  // mirrors the bundle's dirty flag via the gxw:set-document-edited IPC
  // handler below. If the document is edited and we haven't already
  // received a proceed decision, prevent the close and ask the renderer
  // to show the three-button "Save changes?" dialog. The renderer's
  // gxw:close-decision message brings us back to either close (proceed)
  // or stay (cancel).
  mainWindow.on('close', (event) => {
    if (closeConfirmed) return;
    if (!mainWindow.isDocumentEdited()) return;
    event.preventDefault();
    mainWindow.webContents.send('gxw:close-requested');
  });
}

// Replace the default Electron dock icon with the GeoSonel icon if it exists.
// The PNG is generated by scripts/build-icon.sh from assets/icon.svg.
function applyDockIcon() {
  if (process.platform !== 'darwin') return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    app.dock.setIcon(iconPath);
  }
}

// --- Storage paths and settings ---

const SETTINGS_FILENAME = 'settings.json';
const SCORE_META_FILENAME = '.gxw-meta.json';
const PINNED_DIRNAME = 'pinned';

// Image gallery storage (Stage 2 of Canvas inspector tab work).
//
// Metadata (entries, maxCount) lives in settings.json under the
// imageGallery key. Full-resolution copies live as <id>.jpg files
// in <userData>/imageCache/. The cache folder is created lazily
// on the first add. See DESIGN.md Section 13.5 and src/gallery.js
// for the design.
const IMAGE_CACHE_DIRNAME = 'imageCache';
const GALLERY_SETTINGS_KEY = 'imageGallery';
const GALLERY_DEFAULT_MAX_COUNT = 40;
const GALLERY_MAX_COUNT_CEILING = 200;
const GALLERY_MAX_COUNT_FLOOR = 5;

// Score folders on disk carry a .gxs extension so they read as
// macOS packages — Stage 6 packaging will bind .gxs to GeoSonel
// via Info.plist UTI declarations and Finder will then fold each
// .gxs folder into a single document icon. The renderer continues
// to refer to scores by extensionless display name; the helpers
// below translate between the renderer's name and the on-disk
// folder name. Keeping the translation isolated here (rather than
// teaching the renderer about .gxs) is the explicit shape for
// Stage 3 commit 1: every score-folder path computed in this file
// goes through scoreFolderName, and every name parsed back out of
// a directory listing goes through scoreNameFromFolderName.
const SCORE_FOLDER_EXTENSION = '.gxs';

function scoreFolderName(name) {
  return name + SCORE_FOLDER_EXTENSION;
}

function scoreNameFromFolderName(folderName) {
  if (!folderName.endsWith(SCORE_FOLDER_EXTENSION)) return null;
  return folderName.slice(0, -SCORE_FOLDER_EXTENSION.length);
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME);
}

async function readSettings() {
  try {
    const text = await fsp.readFile(getSettingsPath(), 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeSettings(settings) {
  await fsp.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fsp.writeFile(
    getSettingsPath(),
    JSON.stringify(settings, null, 2),
    'utf8'
  );
}

async function getScoresFolder() {
  const settings = await readSettings();
  if (typeof settings.scoresFolder === 'string' && settings.scoresFolder.length > 0) {
    return settings.scoresFolder;
  }
  return path.join(app.getPath('home'), 'Documents', 'GeoSonel Scores');
}

async function ensureScoresFolder() {
  const folder = await getScoresFolder();
  await fsp.mkdir(folder, { recursive: true });
  return folder;
}

// --- Image gallery storage helpers ---

function getImageCacheFolder() {
  return path.join(app.getPath('userData'), IMAGE_CACHE_DIRNAME);
}

async function ensureImageCacheFolder() {
  const folder = getImageCacheFolder();
  await fsp.mkdir(folder, { recursive: true });
  return folder;
}

function galleryCachePathFor(id) {
  return path.join(getImageCacheFolder(), id + '.jpg');
}

// Read the imageGallery key from settings.json, returning a
// normalised {entries, maxCount} object. Missing or malformed
// state degrades to defaults rather than throwing, so a fresh
// install lands in a usable state without the renderer needing
// to special-case it.
async function readGalleryState() {
  const settings = await readSettings();
  const raw = settings[GALLERY_SETTINGS_KEY];
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    return { entries: [], maxCount: GALLERY_DEFAULT_MAX_COUNT };
  }
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  let maxCount = typeof raw.maxCount === 'number'
    ? Math.floor(raw.maxCount)
    : GALLERY_DEFAULT_MAX_COUNT;
  if (maxCount < GALLERY_MAX_COUNT_FLOOR) maxCount = GALLERY_MAX_COUNT_FLOOR;
  if (maxCount > GALLERY_MAX_COUNT_CEILING) maxCount = GALLERY_MAX_COUNT_CEILING;
  return { entries, maxCount };
}

async function writeGalleryState(state) {
  const settings = await readSettings();
  settings[GALLERY_SETTINGS_KEY] = state;
  await writeSettings(settings);
}

// Sort entries for display: newest first. Stage 5
// recency-bump model. touch() and add()-on-match both
// stamp addedAt to Date.now() so the most recently
// touched or imported entry naturally sits at the head
// of this sort.
//
// Pre-Stage-5 history. Stages 3 through 4 sorted
// ascending (oldest first) under the stable-position
// model where addedAt was immutable after creation;
// Stage 5 flips to descending alongside reinstating
// touch's bump-addedAt behaviour. The function name
// reads naturally now — "by recency" meaning newest
// first — where pre-Stage-5 it was misleading.
function sortedByRecency(entries) {
  return [...entries].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

// Sort entries oldest-first for eviction purposes. The
// head of this sort is the least-recently-used entry,
// the natural eviction target under the recency-bump
// model. Display calls go through sortedByRecency
// (descending) instead; the two are intentionally
// inverse. Stage 5 third commit revisits eviction
// policy after drag-and-drop makes array order and
// addedAt diverge; for now "least recently touched"
// matches user expectations cleanly.
function sortedOldestFirst(entries) {
  return [...entries].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
}

// 12-hex-char id with the "img_" prefix; matches the renderer-
// side scheme in src/gallery.js so ids round-trip cleanly
// regardless of which backend generated them.
function generateGalleryId() {
  const bytes = require('node:crypto').randomBytes(6);
  return 'img_' + bytes.toString('hex');
}

// Best-effort cache-file deletion. ENOENT is silently ignored
// because the file may already be gone (manual user cleanup,
// crashed write, repeated remove call); other errors are logged
// but not propagated, since failing to unlink a cache file
// should never block a state update.
async function tryUnlinkGalleryCacheFile(id) {
  try {
    await fsp.unlink(galleryCachePathFor(id));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`GXW: failed to unlink gallery cache file for ${id}:`, err);
    }
  }
}

// --- MIME type inference ---

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
]);

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.json': return 'application/json';
    case '.js':   return 'application/javascript';
    case '.txt':  return 'text/plain';
    case '.html': return 'text/html';
    case '.css':  return 'text/css';
    case '.md':   return 'text/markdown';
    case '.png':  return 'image/png';
    case '.jpg':  return 'image/jpeg';
    case '.jpeg': return 'image/jpeg';
    case '.gif':  return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg':  return 'image/svg+xml';
    default:      return 'application/octet-stream';
  }
}

function isTextMime(mimeType) {
  if (TEXT_MIME_EXACT.has(mimeType)) return true;
  for (const prefix of TEXT_MIME_PREFIXES) {
    if (mimeType.startsWith(prefix)) return true;
  }
  return false;
}

// --- Score record IO ---
//
// A score record (matching the ScoreRecord type in src/storage.js) has:
//   { name, files: { [path]: { mimeType, content } }, imageName, updatedAt }
// Text file content is a string; binary content is an ArrayBuffer that
// crosses IPC via Electron's structured-clone serialisation.

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

// Read a score record from an arbitrary folder. Used by
// readScoreRecord (for live scores) and loadBackupRecord (for
// backup slot folders). The record's `name` field is set
// from the second argument so backup records carry the
// original score name rather than the slot folder's numeric
// name. The mtime returned in updatedAt is the source
// folder's own mtime, which for backup slots reflects the
// time the rotation copied that slot's contents into place.
async function readRecordFromFolder(folder, name) {
  let stat;
  try {
    stat = await fsp.stat(folder);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (!stat.isDirectory()) return null;

  // Read the metadata sidecar, if present.
  let imageName = null;
  let imageContentHash = null;
  let pinnedSlots = [];
  let displayBrightness = 100;
  try {
    const metaText = await fsp.readFile(
      path.join(folder, SCORE_META_FILENAME),
      'utf8'
    );
    const meta = JSON.parse(metaText);
    if (typeof meta.imageName === 'string' || meta.imageName === null) {
      imageName = meta.imageName;
    }
    // Stage 4 extension: the sidecar also carries the
    // SHA-256 hex of the current image's normalized bytes
    // when set. Older sidecars predate this field and the
    // value stays null — the score-open hook on the
    // renderer side recomputes on demand.
    if (typeof meta.imageContentHash === 'string') {
      imageContentHash = meta.imageContentHash;
    }
    // Stage 5 extension: per-score pinned slots. Each
    // entry is either a content hash (key into the
    // pinned/ subfolder) or null for an empty slot.
    // Older sidecars predate this field and pinnedSlots
    // stays an empty array, which fromRecord on the
    // renderer side normalises to PINNED_SLOTS_COUNT
    // null entries.
    if (Array.isArray(meta.pinnedSlots)) {
      pinnedSlots = meta.pinnedSlots.map((v) =>
        typeof v === 'string' ? v : null
      );
    }
    // Stage 6 extension: per-score display brightness
    // for the canvas image, 0–100. Older sidecars
    // predate this field and the value stays at the
    // default 100 (no change). Clamped here so a value
    // edited externally to be out of range can't push
    // the renderer into an invalid state.
    if (typeof meta.displayBrightness === 'number'
        && Number.isFinite(meta.displayBrightness)) {
      const v = meta.displayBrightness;
      displayBrightness = v < 0 ? 0 : (v > 100 ? 100 : v);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('GXW: failed to read score metadata for', name, err);
    }
  }

  // Read every file in the folder except the metadata sidecar
  // and the .backups subfolder.
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === SCORE_META_FILENAME) continue;
    if (entry.name === '.DS_Store') continue;

    const filePath = path.join(folder, entry.name);
    const buffer = await fsp.readFile(filePath);
    const mimeType = getMimeType(entry.name);

    if (isTextMime(mimeType)) {
      files[entry.name] = { mimeType, content: buffer.toString('utf8') };
    } else {
      // Send as ArrayBuffer; Electron's IPC handles the structured clone.
      const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
      files[entry.name] = { mimeType, content: ab };
    }
  }

  // Pinned subfolder (Stage 5 of Canvas inspector work).
  // Read each file in pinned/ and key it in pinnedFiles
  // by file stem, which is the SHA-256 content hash the
  // bundle's pinnedSlots references. The subfolder is
  // optional — older scores have none and pinnedFiles
  // stays an empty object.
  const pinnedFiles = {};
  const pinnedFolder = path.join(folder, PINNED_DIRNAME);
  if (await pathExists(pinnedFolder)) {
    const pinnedEntries = await fsp.readdir(pinnedFolder, { withFileTypes: true });
    for (const e of pinnedEntries) {
      if (!e.isFile()) continue;
      if (e.name === '.DS_Store') continue;
      const dot = e.name.lastIndexOf('.');
      const stem = dot === -1 ? e.name : e.name.slice(0, dot);
      const buffer = await fsp.readFile(path.join(pinnedFolder, e.name));
      const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
      pinnedFiles[stem] = ab;
    }
  }

  return {
    name,
    files,
    imageName,
    imageContentHash,
    pinnedSlots,
    pinnedFiles,
    displayBrightness,
    updatedAt: stat.mtimeMs,
  };
}

async function readScoreRecord(scorePath) {
  return await readRecordFromFolder(scorePath, scoreNameFromPath(scorePath));
}

function scoreNameFromPath(scorePath) {
  const base = path.basename(scorePath);
  return scoreNameFromFolderName(base) ?? base;
}

async function writeScoreRecord(scorePath, record) {
  // The renderer is the source of truth for where the score
  // lives, so the path is used verbatim rather than being
  // recomputed from record.name + the configured Scores
  // folder. ensureScoresFolder is still called to make sure
  // the parent directory exists for the common case where
  // the score is being saved into the configured Scores
  // folder for the first time; for paths outside it (the
  // commit-3 anywhere-save case), the user picked the
  // directory via Save panel and it already exists.
  await ensureScoresFolder();
  await fsp.mkdir(scorePath, { recursive: true });
  const scoreFolder = scorePath;

  // Track which files should remain in the folder after this save.
  const keepFiles = new Set(Object.keys(record.files));
  keepFiles.add(SCORE_META_FILENAME);

  // Write the metadata sidecar. pinnedSlots travels here
  // alongside imageName and imageContentHash so the per-
  // score pinned section survives saves and shared
  // scores carry their pins. Missing or invalid entries
  // normalise to null so the on-disk array always has the
  // hash-or-null shape the renderer expects.
  // displayBrightness joined the sidecar in Stage 6;
  // absent or non-numeric values normalise to the
  // default 100 so older renderers reading a freshly-
  // written sidecar still see a well-formed value.
  const meta = {
    imageName: record.imageName ?? null,
    imageContentHash: record.imageContentHash ?? null,
    pinnedSlots: Array.isArray(record.pinnedSlots)
      ? record.pinnedSlots.map((v) => (typeof v === 'string' ? v : null))
      : [],
    displayBrightness: typeof record.displayBrightness === 'number'
        && Number.isFinite(record.displayBrightness)
      ? Math.max(0, Math.min(100, record.displayBrightness))
      : 100,
  };
  await fsp.writeFile(
    path.join(scoreFolder, SCORE_META_FILENAME),
    JSON.stringify(meta, null, 2),
    'utf8'
  );

  // Delete top-level files that are no longer in the record (e.g. an
  // image that was removed). Don't touch the metadata sidecar or .DS_Store.
  // The !entry.isFile() check naturally skips subdirectories like
  // .backups/ and pinned/, which have their own cleanup paths.
  const existing = await fsp.readdir(scoreFolder, { withFileTypes: true });
  for (const entry of existing) {
    if (!entry.isFile()) continue;
    if (keepFiles.has(entry.name)) continue;
    if (entry.name === '.DS_Store') continue;
    await fsp.unlink(path.join(scoreFolder, entry.name));
  }

  // Write each file from the record.
  for (const [filename, file] of Object.entries(record.files)) {
    const filePath = path.join(scoreFolder, filename);
    if (typeof file.content === 'string') {
      await fsp.writeFile(filePath, file.content, 'utf8');
    } else {
      // ArrayBuffer arriving from the renderer.
      const buffer = Buffer.from(file.content);
      await fsp.writeFile(filePath, buffer);
    }
  }

  // Pinned subfolder (Stage 5 of Canvas inspector work).
  // record.pinnedFiles is a hash-keyed object of
  // ArrayBuffer; each entry writes to pinned/<hash>.jpg.
  // Files in pinned/ that aren't in the record are
  // removed so the subfolder stays in sync with the
  // bundle's pinnedBytes map. When the record has no
  // pinned files and the subfolder doesn't yet exist we
  // skip everything — a no-pinned-images score never
  // creates the subfolder. When the record has no
  // pinned files but the subfolder exists from an
  // earlier save with pins, we walk the subfolder and
  // unlink stale entries (rmdir of the now-empty
  // subfolder is left to a future commit; an empty
  // pinned/ folder is harmless).
  const pinnedFolder = path.join(scoreFolder, PINNED_DIRNAME);
  const recordPinned = record.pinnedFiles ?? {};
  const recordPinnedHashes = new Set(Object.keys(recordPinned));
  const pinnedFolderExists = await pathExists(pinnedFolder);
  if (recordPinnedHashes.size > 0 || pinnedFolderExists) {
    if (recordPinnedHashes.size > 0) {
      await fsp.mkdir(pinnedFolder, { recursive: true });
    }
    if (pinnedFolderExists) {
      const pinnedEntries = await fsp.readdir(pinnedFolder, { withFileTypes: true });
      for (const e of pinnedEntries) {
        if (!e.isFile()) continue;
        if (e.name === '.DS_Store') continue;
        const dot = e.name.lastIndexOf('.');
        const stem = dot === -1 ? e.name : e.name.slice(0, dot);
        if (!recordPinnedHashes.has(stem)) {
          await fsp.unlink(path.join(pinnedFolder, e.name));
        }
      }
    }
    for (const [hash, bytes] of Object.entries(recordPinned)) {
      const buffer = Buffer.from(bytes);
      await fsp.writeFile(
        path.join(pinnedFolder, hash + '.jpg'),
        buffer,
      );
    }
  }
}

async function deleteScoreRecord(scorePath) {
  await fsp.rm(scorePath, { recursive: true, force: true });
}

// Rename a score on disk by renaming its folder in place. The
// folder rename is one syscall and atomic on the same volume,
// which means the .backups subfolder follows the score to its
// new location with no extra plumbing — contrast the older
// path of save-under-new-name plus delete-old-name, which lost
// the .backups history.
//
// The renderer's promptForUniqueName already guarantees the
// destination doesn't exist, so a collision here would mean
// the caller bypassed that guard or two callers raced. Throw
// rather than silently overwriting; the in-app message area
// surfaces the error to the user.
async function renameScoreRecord(oldPath, newPath) {
  if (oldPath === newPath) return;
  if (!await pathExists(oldPath)) {
    // Nothing to rename on disk — e.g. a brand-new bundle
    // that hasn't been saved yet. The renderer's follow-up
    // save under the new path will create the folder.
    return;
  }
  if (await pathExists(newPath)) {
    throw new Error(
      `Cannot rename to "${newPath}": a score with that name already exists.`
    );
  }
  // Make sure the destination's parent directory exists
  // before the rename. For commit-2 paths this is always the
  // configured Scores folder (already ensured elsewhere),
  // but the explicit mkdir keeps the IPC robust for the
  // commit-3 anywhere-save case where the parent could be
  // any directory.
  await fsp.mkdir(path.dirname(newPath), { recursive: true });
  await fsp.rename(oldPath, newPath);
}

async function listScoreFolders() {
  const scoresFolder = await ensureScoresFolder();
  const entries = await fsp.readdir(scoresFolder, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const name = scoreNameFromFolderName(entry.name);
    if (name === null) continue;
    const folderPath = path.join(scoresFolder, entry.name);
    const stat = await fsp.stat(folderPath);
    results.push({ path: folderPath, name, updatedAt: stat.mtimeMs });
  }
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results;
}

async function loadAllScoreRecords() {
  const list = await listScoreFolders();
  const records = [];
  for (const item of list) {
    const record = await readScoreRecord(item.path);
    if (record !== null) records.push(record);
  }
  return records;
}

// --- Numbered backups ---
//
// Stage 2.5 Phase 3 commit 2. Every save of a score under the
// Electron build copies the pre-save state into a numbered
// slot inside <scoreFolder>/.backups/ before the new content
// is written. Slot 1 is always the most recent backup; the
// rotation shifts each existing slot down by one (1→2,
// 2→3, ...) before the copy, and any slot that would
// exceed maxCount after shifting is deleted instead. Slots
// can have gaps if the user manually deleted one in Finder;
// the rotation tolerates them rather than compacting,
// matching the gap-tolerance design decision in IN_FLIGHT.
//
// The renderer's storage.js calls rotateBackupsBeforeSave
// inside saveScoreRecord just before the write, passing the
// user's numBackupsToKeep preference. A first save (score
// folder doesn't yet exist) is a no-op because there's
// nothing to back up.

const BACKUPS_DIRNAME = '.backups';

async function rotateBackupsBeforeSave(scorePath, maxCount) {
  if (typeof maxCount !== 'number' || maxCount <= 0) return;

  const scoreFolder = scorePath;

  // First save: nothing on disk yet, nothing to back up.
  if (!await pathExists(scoreFolder)) return;

  const backupsFolder = path.join(scoreFolder, BACKUPS_DIRNAME);
  await fsp.mkdir(backupsFolder, { recursive: true });

  // Read existing numbered slot folders. Anything that's not
  // a directory or whose name doesn't parse to a positive
  // integer is ignored (defence against stray files or
  // manual user-added folders).
  const entries = await fsp.readdir(backupsFolder, { withFileTypes: true });
  const existingSlots = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const n = parseInt(e.name, 10);
    if (!Number.isFinite(n) || String(n) !== e.name || n < 1) continue;
    existingSlots.push(n);
  }
  // Walk from highest slot number down to lowest so renames
  // don't collide.
  existingSlots.sort((a, b) => b - a);
  for (const n of existingSlots) {
    const newN = n + 1;
    const oldPath = path.join(backupsFolder, String(n));
    if (newN > maxCount) {
      // This slot would fall off the end after shifting; drop
      // it instead of renaming.
      await fsp.rm(oldPath, { recursive: true, force: true });
    } else {
      const newPath = path.join(backupsFolder, String(newN));
      await fsp.rename(oldPath, newPath);
    }
  }

  // Copy the score's current files (everything in scoreFolder
  // except the .backups subfolder itself and .DS_Store) into
  // a fresh slot 1.
  const slot1 = path.join(backupsFolder, '1');
  await fsp.mkdir(slot1, { recursive: true });
  const scoreEntries = await fsp.readdir(scoreFolder, { withFileTypes: true });
  for (const e of scoreEntries) {
    if (!e.isFile()) continue;
    if (e.name === '.DS_Store') continue;
    await fsp.copyFile(
      path.join(scoreFolder, e.name),
      path.join(slot1, e.name)
    );
  }
}

async function listBackups(scorePath) {
  const backupsFolder = path.join(scorePath, BACKUPS_DIRNAME);

  if (!await pathExists(backupsFolder)) return [];

  const entries = await fsp.readdir(backupsFolder, { withFileTypes: true });
  const slots = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const n = parseInt(e.name, 10);
    if (!Number.isFinite(n) || String(n) !== e.name || n < 1) continue;
    const stat = await fsp.stat(path.join(backupsFolder, e.name));
    slots.push({ slotNumber: n, mtimeMs: stat.mtimeMs });
  }
  // Slot 1 is the most recent backup; sort ascending so the
  // submenu naturally lists newest first.
  slots.sort((a, b) => a.slotNumber - b.slotNumber);
  return slots;
}

async function loadBackupRecord(scorePath, slotNumber) {
  const slotFolder = path.join(
    scorePath,
    BACKUPS_DIRNAME,
    String(slotNumber)
  );
  // Pass the score's display name (the path's stem) so the
  // record's `name` field round-trips as the live score
  // name. When the renderer reverts to this backup it saves
  // under the original path, which is what the user expects.
  const scoreName = scoreNameFromPath(scorePath);
  return await readRecordFromFolder(slotFolder, scoreName);
}

// --- One-time migration: rename pre-.gxs score folders ---
//
// Before Stage 3 every score lived as a plain folder under the
// Scores folder; commit 1 of Stage 3 introduces the .gxs suffix.
// Existing installs need their score folders renamed so the
// post-commit disk backend, which only recognises .gxs folders,
// can see them. This migration runs on every app launch and
// renames each non-hidden, non-.gxs folder under the Scores folder
// to have a .gxs suffix — but only if the folder contains a
// scene.json file (so it actually is a score). Plain folders the
// user keeps in the Scores folder for other purposes (archives,
// notes, anything else) are left alone, distinguished by the
// absence of scene.json.
//
// Safe to run on every launch: idempotent because folders that
// already end in .gxs are skipped. A folder whose .gxs counterpart
// already exists is logged and skipped rather than overwritten, so
// a conflicting state has to be resolved by the user rather than
// being papered over.
async function migrateScoresFolderToGxsExtension() {
  let folder;
  try {
    folder = await getScoresFolder();
    if (!await pathExists(folder)) return;
  } catch (err) {
    console.warn('GXW: .gxs migration skipped, could not resolve Scores folder:', err);
    return;
  }

  let entries;
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true });
  } catch (err) {
    console.warn('GXW: .gxs migration skipped, could not read Scores folder:', err);
    return;
  }

  let renamed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name.endsWith(SCORE_FOLDER_EXTENSION)) continue;

    // Score heuristic: contains a scene.json file. Folders
    // without scene.json are unrelated content the user has
    // chosen to keep here and stay untouched.
    const sceneJsonPath = path.join(folder, entry.name, 'scene.json');
    if (!await pathExists(sceneJsonPath)) continue;

    const newFolderName = entry.name + SCORE_FOLDER_EXTENSION;
    const newPath = path.join(folder, newFolderName);
    if (await pathExists(newPath)) {
      console.warn(
        `GXW: .gxs migration skipping "${entry.name}" — "${newFolderName}" already exists.`
      );
      continue;
    }

    try {
      await fsp.rename(path.join(folder, entry.name), newPath);
      renamed++;
    } catch (err) {
      console.warn(`GXW: .gxs migration failed for "${entry.name}":`, err);
    }
  }

  if (renamed > 0) {
    console.log(`GXW: migrated ${renamed} score folder(s) to .gxs extension.`);
  }
}

// --- IPC handler registration ---

function registerStorageHandlers() {
  ipcMain.handle('gxw:list-scores', async () => {
    return await listScoreFolders();
  });

  ipcMain.handle('gxw:load-score-record', async (_event, scorePath) => {
    return await readScoreRecord(scorePath);
  });

  ipcMain.handle('gxw:save-score-record', async (_event, scorePath, record) => {
    await writeScoreRecord(scorePath, record);
  });

  ipcMain.handle('gxw:delete-score-record', async (_event, scorePath) => {
    await deleteScoreRecord(scorePath);
  });

  ipcMain.handle('gxw:rename-score-record', async (_event, oldPath, newPath) => {
    await renameScoreRecord(oldPath, newPath);
  });

  ipcMain.handle('gxw:load-all-score-records', async () => {
    return await loadAllScoreRecords();
  });

  ipcMain.handle('gxw:get-setting', async (_event, key) => {
    const settings = await readSettings();
    return settings[key];
  });

  ipcMain.handle('gxw:set-setting', async (_event, key, value) => {
    const settings = await readSettings();
    settings[key] = value;
    await writeSettings(settings);
  });

  ipcMain.handle('gxw:get-scores-folder', async () => {
    return await getScoresFolder();
  });

  // --- Numbered backups (Stage 2.5 Phase 3 commit 2) ---

  ipcMain.handle('gxw:rotate-backups-before-save', async (_event, scorePath, maxCount) => {
    await rotateBackupsBeforeSave(scorePath, maxCount);
  });

  ipcMain.handle('gxw:list-backups', async (_event, scorePath) => {
    return await listBackups(scorePath);
  });

  ipcMain.handle('gxw:load-backup-record', async (_event, scorePath, slotNumber) => {
    return await loadBackupRecord(scorePath, slotNumber);
  });

  // --- Image gallery (Stage 2 of Canvas inspector tab work) ---
  //
  // Renderer-side abstraction lives in src/gallery.js. Five
  // handlers cover the full surface: list, add, remove,
  // set-max-count, load-image. Match-and-promote on add lives
  // here so the cap and eviction policy are enforced at one
  // place (the main process owns settings.json and the cache
  // folder; the renderer just makes the calls).

  ipcMain.handle('gxw:gallery-list', async () => {
    const state = await readGalleryState();
    return {
      entries: sortedByRecency(state.entries),
      maxCount: state.maxCount,
    };
  });

  ipcMain.handle('gxw:gallery-add', async (_event, input) => {
    const state = await readGalleryState();
    const sourcePath = typeof input?.sourcePath === 'string'
      ? input.sourcePath
      : '';
    const thumbnailBase64 = typeof input?.thumbnailBase64 === 'string'
      ? input.thumbnailBase64
      : '';
    const contentHash = typeof input?.contentHash === 'string' && input.contentHash !== ''
      ? input.contentHash
      : null;

    // Match-by-hash-or-sourcePath: when an entry already
    // exists (by content hash, falling back to sourcePath
    // for legacy entries that predate the hash), promote
    // it to the front by setting its addedAt to now —
    // the Stage 5 recency-bump model. The contentHash
    // backfill on existing entries that lack one still
    // happens here as a metadata correction. Either
    // change writes back so the new addedAt persists.
    let existing = null;
    if (contentHash !== null) {
      existing = state.entries.find((e) => e.contentHash === contentHash);
      if (existing === undefined) existing = null;
    }
    if (existing === null && sourcePath !== '') {
      const m = state.entries.find((e) => e.sourcePath === sourcePath);
      existing = m === undefined ? null : m;
    }
    if (existing !== null) {
      existing.addedAt = Date.now();
      if (contentHash !== null && existing.contentHash !== contentHash) {
        existing.contentHash = contentHash;
      }
      await writeGalleryState({
        entries: state.entries,
        maxCount: state.maxCount,
      });
      return {
        id: existing.id,
        entries: sortedByRecency(state.entries),
      };
    }

    // New entry. Write the cache file before updating
    // settings.json so a failed write doesn't leave a
    // dangling metadata entry pointing at nothing.
    const id = generateGalleryId();
    await ensureImageCacheFolder();
    const buffer = Buffer.from(input.normalizedBytes);
    await fsp.writeFile(galleryCachePathFor(id), buffer);

    state.entries.push({
      id,
      sourcePath,
      thumbnailBase64,
      addedAt: Date.now(),
      contentHash,
    });

    // Eviction. If the gallery is now over cap, drop
    // the oldest entries by addedAt until it fits,
    // unlinking their cache files. sortedOldestFirst
    // puts the eviction candidates at the head; the
    // remaining tail is what's kept. Stage 5 third
    // commit revisits eviction policy after drag-and-
    // drop makes array order and addedAt diverge.
    if (state.entries.length > state.maxCount) {
      const sorted = sortedOldestFirst(state.entries);
      const overage = state.entries.length - state.maxCount;
      const evict = sorted.slice(0, overage);
      const keep = sorted.slice(overage);
      for (const e of evict) {
        await tryUnlinkGalleryCacheFile(e.id);
      }
      state.entries = keep;
    }

    await writeGalleryState({
      entries: state.entries,
      maxCount: state.maxCount,
    });
    return { id, entries: sortedByRecency(state.entries) };
  });

  ipcMain.handle('gxw:gallery-remove', async (_event, id) => {
    if (typeof id !== 'string' || id === '') {
      const state = await readGalleryState();
      return { entries: sortedByRecency(state.entries) };
    }
    const state = await readGalleryState();
    const remaining = state.entries.filter((e) => e.id !== id);
    await tryUnlinkGalleryCacheFile(id);
    await writeGalleryState({
      entries: remaining,
      maxCount: state.maxCount,
    });
    return { entries: sortedByRecency(remaining) };
  });

  ipcMain.handle('gxw:gallery-set-max-count', async (_event, n) => {
    let clamped = typeof n === 'number'
      ? Math.floor(n)
      : GALLERY_DEFAULT_MAX_COUNT;
    if (clamped < GALLERY_MAX_COUNT_FLOOR) clamped = GALLERY_MAX_COUNT_FLOOR;
    if (clamped > GALLERY_MAX_COUNT_CEILING) clamped = GALLERY_MAX_COUNT_CEILING;

    const state = await readGalleryState();
    let entries = state.entries;

    // Reducing the cap below the current entry count
    // triggers immediate eviction of the oldest entries
    // by addedAt down to the new cap. Uses oldest-first
    // sort to find the eviction targets; the kept tail
    // becomes the new entry list.
    if (entries.length > clamped) {
      const sorted = sortedOldestFirst(entries);
      const overage = entries.length - clamped;
      const evict = sorted.slice(0, overage);
      const keep = sorted.slice(overage);
      for (const e of evict) {
        await tryUnlinkGalleryCacheFile(e.id);
      }
      entries = keep;
    }

    await writeGalleryState({ entries, maxCount: clamped });
    return { entries: sortedByRecency(entries), maxCount: clamped };
  });

  // Bump the matching entry's addedAt to now so the
  // descending display sort floats it to the front
  // (Stage 5 recency-bump model). Unknown id is a
  // no-op — callers may pass a stale id during a race
  // between gallery refresh and click handler, and
  // silently ignoring is friendlier than throwing.
  ipcMain.handle('gxw:gallery-touch', async (_event, id) => {
    const state = await readGalleryState();
    if (typeof id === 'string' && id !== '') {
      const entry = state.entries.find((e) => e.id === id);
      if (entry !== undefined) {
        entry.addedAt = Date.now();
        await writeGalleryState({
          entries: state.entries,
          maxCount: state.maxCount,
        });
      }
    }
    return { entries: sortedByRecency(state.entries) };
  });

  // Look up an entry by content hash. Returns the matching
  // entry's full metadata (no image bytes) or null. Added in
  // Stage 4 of the Canvas inspector work; the score-open
  // hook uses this to decide between touch (entry exists) and
  // gallery-add (entry doesn't, needs creating with a freshly
  // generated thumbnail).
  ipcMain.handle('gxw:gallery-find-by-content-hash', async (_event, contentHash) => {
    if (typeof contentHash !== 'string' || contentHash === '') return null;
    const state = await readGalleryState();
    const match = state.entries.find((e) => e.contentHash === contentHash);
    return match === undefined ? null : match;
  });

  ipcMain.handle('gxw:gallery-load-image', async (_event, id) => {
    if (typeof id !== 'string' || id === '') {
      throw new Error('Gallery loadImage called with empty id.');
    }
    const buffer = await fsp.readFile(galleryCachePathFor(id));
    // Slice into a fresh ArrayBuffer so the renderer receives
    // bytes detached from Node's Buffer pool. The structured-
    // clone IPC will then ship the buffer cleanly across.
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    return { bytes: ab, mimeType: 'image/jpeg' };
  });

  // --- Native dialogs (Stage 3 commit 3a) ---
  //
  // Wrap Electron's dialog.showSaveDialog so the renderer
  // can present the macOS Save panel for Save As. The
  // renderer passes title and defaultPath; we attach the
  // .gxs file filter and return the user's choice as
  // { canceled, filePath }. The dialog's overwrite
  // confirmation runs at the OS level so the renderer
  // doesn't need its own Replace? prompt.
  ipcMain.handle('gxw:show-save-dialog', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = options ?? {};
    const dialogOpts = {
      title: typeof opts.title === 'string' ? opts.title : 'Save Score',
      filters: [{ name: 'GeoSonel Score', extensions: ['gxs'] }],
    };
    if (typeof opts.defaultPath === 'string') {
      dialogOpts.defaultPath = opts.defaultPath;
    }
    const result = win !== null
      ? await dialog.showSaveDialog(win, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (result.canceled || typeof result.filePath !== 'string') {
      return { canceled: true, filePath: null };
    }
    return { canceled: false, filePath: result.filePath };
  });

  // Wrap Electron's dialog.showOpenDialog so the renderer
  // can present the macOS Open panel for Open Score. The
  // dialog runs in openDirectory mode with
  // treatPackageAsDirectory set so .gxs folders read as
  // navigable, selectable folders rather than as packages.
  // Without that property macOS greys out .gxs folders when
  // any file filter is in play — the filter makes the OS
  // treat the extension as a registered document type and a
  // matching folder becomes a non-selectable bundle.
  // Filters are documented as openFile-only and aren't
  // included here for the same reason. The renderer
  // validates the chosen path's .gxs suffix before loading.
  // Returns the single picked path unwrapped from
  // showOpenDialog's filePaths array, in the same
  // { canceled, filePath } shape the Save handler uses.
  ipcMain.handle('gxw:show-open-dialog', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = options ?? {};
    const dialogOpts = {
      title: typeof opts.title === 'string' ? opts.title : 'Open Score',
      properties: ['openDirectory', 'treatPackageAsDirectory'],
    };
    if (typeof opts.defaultPath === 'string') {
      dialogOpts.defaultPath = opts.defaultPath;
    }
    const result = win !== null
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (
      result.canceled ||
      !Array.isArray(result.filePaths) ||
      result.filePaths.length === 0
    ) {
      return { canceled: true, filePath: null };
    }
    return { canceled: false, filePath: result.filePaths[0] };
  });

  // --- Native menu state push (Stage 5 commit 5a) ---
  //
  // The renderer is the source of truth for the state
  // values that drive the native menu's disabled / checked
  // flags (bundle dirty, bundle isUntitled, autoZoom). It
  // pushes a partial state patch through this handler
  // whenever any of those values changes; the menu is
  // rebuilt with the new state and reapplied.
  ipcMain.handle('gxw:menu-state', async (_event, state) => {
    updateMenuState(state ?? {});
  });

  // Window-level IPC for the explicit-save model.
  //
  // setDocumentEdited drives both the dot in the close-button circle
  // (a macOS BrowserWindow convention surfaced via the underlying
  // documentEdited property) and the close-event interceptor's
  // dirty check above. The renderer is the source of truth for
  // dirty state; this handler just forwards it.
  ipcMain.handle('gxw:set-document-edited', async (_event, edited) => {
    if (mainWindow !== undefined && mainWindow !== null) {
      mainWindow.setDocumentEdited(Boolean(edited));
    }
  });

  // Close-decision return path. The renderer sends this after the user
  // picks an option in the three-button "Save changes?" dialog. On
  // 'proceed', set the close-confirmed flag and call close() again; the
  // next 'close' event sees the flag and allows the close. On 'cancel',
  // do nothing — the original close was already prevented.
  ipcMain.on('gxw:close-decision', (_event, decision) => {
    if (decision === 'proceed' && mainWindow !== undefined && mainWindow !== null) {
      closeConfirmed = true;
      mainWindow.close();
    }
  });

  // --- Virtual MIDI port (Electron-only) ---
  //
  // Status query. The renderer's MIDISender calls this at
  // init time to decide whether to emit a "ready" event to
  // the toolbar indicator. Returns the port name when ready
  // so the indicator's label reads "MIDI: GeoSonel" rather
  // than a generic string.
  ipcMain.handle('gxw:midi-get-status', async () => {
    return {
      ready: midiPortOpen,
      portName: midiPortOpen ? MIDI_PORT_NAME : null,
    };
  });

  // Send a MIDI byte array. delayMs is the renderer's
  // computed (midiTime - performance.now()) value; main
  // uses setTimeout for positive delays and dispatches
  // synchronously otherwise. Invalid input is silently
  // dropped: bad bytes would cause node-midi to throw, and
  // the per-event budget can't afford the round-trip cost
  // of validating in detail. The output's own try/catch in
  // sendMidiMessage logs anything that does slip through.
  ipcMain.handle('gxw:midi-send', async (_event, bytes, delayMs) => {
    if (!Array.isArray(bytes)) return;
    if (typeof delayMs === 'number' && delayMs > 0.5) {
      setTimeout(() => sendMidiMessage(bytes), delayMs);
    } else {
      sendMidiMessage(bytes);
    }
  });

  // --- Composition mirror (Section 15, Phase 1A commit 1) ---
  //
  // Renderer toggles the feature on / off via setEnabled,
  // which writes the persisted setting and runs the
  // corresponding folder lifecycle in one step. getStatus
  // returns the enabled flag and the canonical folder
  // path so the Settings dialog can render the MCP setup
  // hint when the feature is on.

  ipcMain.handle('gxw:mirror-set-enabled', async (_event, value) => {
    await mirror.setEnabled(value);
    return mirror.getStatus();
  });

  ipcMain.handle('gxw:mirror-get-status', async () => {
    return mirror.getStatus();
  });

  // Phase 1A commit 2: receive a score-state payload from
  // the renderer's MirrorPush pipeline and write it into
  // the mirror folder using atomic temp-and-rename. The
  // handler awaits the push so a write failure surfaces
  // as a rejected IPC promise the renderer can report via
  // the message area; pushScore itself catches no errors,
  // so we let any thrown error propagate up the IPC.
  ipcMain.handle('gxw:mirror-push-score', async (_event, payload) => {
    await mirror.pushScore(payload);
  });

  // Phase 1A commit 3: receive a runtime-state payload
  // (sprite positions and velocities, curve cursor
  // positions, transport time and beat) and write it as
  // runtime-state.json. The renderer fires this on scene
  // reloads, on transport pause, and on rewind, all gated
  // on transport-not-playing so the file only updates at
  // rest. Like push-score, the await lets a write failure
  // surface to the renderer as a rejected IPC promise.
  ipcMain.handle('gxw:mirror-push-runtime-state', async (_event, payload) => {
    await mirror.pushRuntimeState(payload);
  });

  // Phase 1B commit 3: receive the outcome of the
  // renderer's most recent applyBatch call and write it
  // as last-apply-result.json. Called after every batch,
  // success or rejection, so an AI reading the mirror
  // folder can find out whether its last edit was
  // accepted, and if not, why. Payload validation lives
  // inside writeApplyResult; an await here lets a write
  // failure surface as a rejected IPC promise the
  // renderer can log.
  ipcMain.handle('gxw:mirror-write-apply-result', async (_event, payload) => {
    await mirror.writeApplyResult(payload);
  });

  // Phase 1B commit 4b: cancel an in-flight AI batch on
  // user request. Called from the renderer when the user
  // clicks Cancel on the confirm-to-apply dialog during
  // the Thinking state. Main-side teardown only — the
  // renderer is responsible for the rollback push.
  ipcMain.handle('gxw:mirror-cancel-batch', async () => {
    await mirror.cancelBatch();
  });
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  applyDockIcon();
  registerStorageHandlers();
  openMidiVirtualPort();
  await migrateScoresFolderToGxsExtension();
  await mirror.initMirror();
  createWindow();
  // Hand the mirror the BrowserWindow it dispatches
  // ready batches to (Phase 1B commit 2). initMirror
  // starts the watcher before this runs, so any
  // AI write that arrives in the gap between watcher
  // start and this assignment surfaces as a
  // dropped-batch warning in the main-process log
  // and is overwritten on the next user edit's
  // push. The gap is on the order of milliseconds in
  // practice.
  mirror.setMainWindow(mainWindow);
  installMenu(mainWindow);
});

// Close the virtual MIDI port cleanly on quit so we don't
// leave a dangling port registered in CoreMIDI's port list
// after the app exits. Without this, CoreMIDI eventually
// reaps the port when the process dies, but the gap between
// process exit and reap can briefly confuse a DAW that was
// connected to the port.
app.on('will-quit', () => {
  closeMidiVirtualPort();
  mirror.shutdown();
});

// On macOS, apps usually stay running when all windows are closed; the user
// explicitly quits via Cmd-Q or the dock menu. On other platforms, closing
// the last window quits the app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, clicking the dock icon when no windows are open should re-create
// the main window.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
