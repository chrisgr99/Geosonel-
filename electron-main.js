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
//       script.js
//       <image file>                  optional, named per the score's imageName
//       .gxw-meta.json                hidden, carries imageName and any other
//                                     per-score metadata that doesn't fit in
//                                     scene.json
//
// App settings (chosen Scores folder location, current open score, etc.) live
// in <userData>/settings.json, so the Scores folder can be moved or relinked
// without losing app-level state.

const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { installMenu, updateMenuState } = require('./electron-menu.js');
const {
  registerScoreIpc,
  migrateScoresFolderToGxsExtension,
  watchForChanges,
} = require('./electron-storage.js');
const mirror = require('./electron-mirror.js');

// --- Crash safety net + diagnostics ---
//
// Node aborts the process on an unhandled promise rejection (and on an
// uncaught exception), which in Electron means the whole app vanishes.
// Several main-process subsystems run async work fire-and-forget (the
// composition-mirror watcher/reconcile, periodic mirror writes), and a
// transient I/O fault in any of them must NOT take the editor down and
// lose the user's unsaved work. These handlers turn such a fault into a
// logged, survivable event instead of a silent quit, and append the
// stack to <userData>/crash.log so an intermittent fault is diagnosable
// after the fact.
//
// This is deliberately permissive: an uncaught exception can leave some
// state inconsistent, but for a single-user creative tool, staying up
// with one failed operation beats terminating mid-session. Genuinely
// fatal startup problems still surface through their own code paths.
function logMainProcessFault(kind, err) {
  const stack = (err && err.stack) ? err.stack
    : (err && err.message) ? err.message : String(err);
  const line = `[${new Date().toISOString()}] ${kind}: ${stack}\n`;
  // Console first, always.
  console.error(`GXW main-process ${kind} (non-fatal):`, err);
  // Best-effort file log; never let the logger itself throw.
  try {
    const logPath = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logPath, line);
  } catch (_e) {
    // userData may be unavailable very early; the console line stands.
  }
}
process.on('unhandledRejection', (reason) => {
  logMainProcessFault('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logMainProcessFault('uncaughtException', err);
});

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

// Tracks whether we've sent gxw:close-requested and are waiting for the
// renderer's gxw:close-decision — i.e. the "Save changes?" dialog is up. A
// second Cmd-Q during this window means "quit anyway" (see the
// before-input-event handler in createWindow). Cleared when the decision
// arrives or when a fresh close is forced.
let awaitingCloseDecision = false;

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

  // Log a renderer-process crash to crash.log so an intermittent
  // "the app vanished" report can be pinned to the renderer (vs a
  // main-process fault, which goes through the process.on handlers
  // above). reason !== 'clean-exit' means an actual crash/kill/OOM.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logMainProcessFault(
      'render-process-gone',
      new Error(`reason=${details.reason} exitCode=${details.exitCode}`),
    );
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
    awaitingCloseDecision = true;
    mainWindow.webContents.send('gxw:close-requested');
  });

  // Press-again-to-force-quit. The first Cmd-Q on a dirty document brings up
  // the "Save changes?" dialog (via the close interceptor above) and leaves
  // us awaiting the renderer's decision. Pressing Cmd-Q a SECOND time while
  // that dialog is up means "quit anyway" — discard the changes and exit.
  // This gives a fast keyboard-only force-quit for test iteration without a
  // separate shortcut. (Cmd-Shift-Q can't serve this purpose: macOS reserves
  // it for Log Out, so the app never sees it.)
  //
  // before-input-event fires even for menu-accelerator keys, and calling
  // preventDefault suppresses the default Quit accelerator — so on the second
  // press we take over: set closeConfirmed so the close isn't re-intercepted,
  // then app.quit() (which still runs will-quit, closing the MIDI port). On
  // the FIRST press awaitingCloseDecision is false, so we do nothing and let
  // the normal Quit → dialog flow run. Keyed off input.code (layout-agnostic).
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown'
      && input.code === 'KeyQ'
      && input.meta && !input.shift && !input.control && !input.alt
      && awaitingCloseDecision) {
      event.preventDefault();
      awaitingCloseDecision = false;
      closeConfirmed = true;
      app.quit();
    }
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
// The scores, settings and image gallery moved to electron-storage.js so DreamRack's main process
// can register the same channels against the same files — see that file's header. What is left in
// here is the window, the menu, MIDI and the mirror.


function registerStorageHandlers() {
  // The scores, settings and image gallery — nineteen channels, registered from the module both
  // main processes share. See electron-storage.js. Everything below this line is GXW's own window:
  // the clipboard, dialogs, the menu, MIDI and the mirror, none of which a host should register.
  registerScoreIpc(ipcMain);
  // The other build may be writing the same files. See watchForChanges.
  watchForChanges((kind) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('gxw:disk-changed', kind); } catch (_e) { /* window going away */ }
    }
  });

  // handler's slice idiom.
  ipcMain.handle('gxw:clipboard-read-image', async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const buffer = image.toPNG();
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    return { bytes: ab, mimeType: 'image/png' };
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

  // Open a single FILE (openFile mode, with filters) and read its
  // text in the main process. Lets the renderer import an arbitrary
  // text file — e.g. an iReal Pro .html export — from the NATIVE
  // menu, which a web <input type=file> can't do: a menu click
  // reaches the renderer via IPC, not a user gesture, so the browser
  // blocks the file picker. Returns { canceled, name, content } with
  // the file's UTF-8 text, or { canceled: true }.
  ipcMain.handle('gxw:open-text-file', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = options ?? {};
    const dialogOpts = {
      title: typeof opts.title === 'string' ? opts.title : 'Open File',
      properties: ['openFile'],
    };
    if (Array.isArray(opts.filters)) dialogOpts.filters = opts.filters;
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
      return { canceled: true };
    }
    const filePath = result.filePaths[0];
    const content = await fsp.readFile(filePath, 'utf8');
    return { canceled: false, name: path.basename(filePath), content };
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
    awaitingCloseDecision = false;
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

  // Receive the user's current text-cursor location in the Script
  // editor (enclosing callback, expression under the caret, selected
  // text, line/column range) and write it as focus.json. This is the
  // deictic "this" pointer for an AI working through the mirror — the
  // user places the caret on the code they mean and refers to it. The
  // renderer fires this debounced on selection changes.
  ipcMain.handle('gxw:mirror-push-focus', async (_event, payload) => {
    await mirror.pushFocus(payload);
  });

  // Receive a rolling buffer of recently-fired musical events
  // (emitted note/sound plus the firing context's colour signals and
  // velocity) and write it as event-trace.json. Polled from the
  // renderer while the transport plays so an AI reading the mirror can
  // see the actual signal values a score produces and reason about
  // scaling.
  ipcMain.handle('gxw:mirror-push-event-trace', async (_event, payload) => {
    await mirror.pushEventTrace(payload);
  });

  // Receive the set of objects currently selected on the canvas (IDs,
  // kinds, names, indices) and write it as selection.json. This is the
  // deictic "this object" pointer for an AI editing through the mirror,
  // the canvas counterpart of focus.json's text cursor. Pushed
  // debounced on every selection change.
  ipcMain.handle('gxw:mirror-push-selection', async (_event, payload) => {
    await mirror.pushSelection(payload);
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
