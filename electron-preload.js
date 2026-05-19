// Electron preload script.
//
// Runs in a privileged context before the renderer starts loading. Exposes
// a `window.gxwStorage` object to the renderer via contextBridge, with
// thin wrappers around the IPC handlers registered in electron-main.js.
//
// The renderer's src/storage.js checks for `window.gxwStorage` at module
// load and routes through it when present (Electron build), falling back
// to IndexedDB otherwise (web build).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gxwStorage', {
  listScores: () => ipcRenderer.invoke('gxw:list-scores'),
  loadScoreRecord: (scorePath) => ipcRenderer.invoke('gxw:load-score-record', scorePath),
  saveScoreRecord: (scorePath, record) => ipcRenderer.invoke('gxw:save-score-record', scorePath, record),
  deleteScoreRecord: (scorePath) => ipcRenderer.invoke('gxw:delete-score-record', scorePath),
  renameScoreRecord: (oldPath, newPath) =>
    ipcRenderer.invoke('gxw:rename-score-record', oldPath, newPath),
  loadAllScoreRecords: () => ipcRenderer.invoke('gxw:load-all-score-records'),
  getSetting: (key) => ipcRenderer.invoke('gxw:get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('gxw:set-setting', key, value),
  getScoresFolder: () => ipcRenderer.invoke('gxw:get-scores-folder'),
  // Numbered backups (Stage 2.5 Phase 3 commit 2).
  rotateBackupsBeforeSave: (scorePath, maxCount) =>
    ipcRenderer.invoke('gxw:rotate-backups-before-save', scorePath, maxCount),
  listBackups: (scorePath) =>
    ipcRenderer.invoke('gxw:list-backups', scorePath),
  loadBackupRecord: (scorePath, slotNumber) =>
    ipcRenderer.invoke('gxw:load-backup-record', scorePath, slotNumber),
});

// Window-level IPC for the explicit-save model (Stage 2.5 Phase 1).
//
// setDocumentEdited drives the dot in the close-button circle that
// macOS shows on a BrowserWindow with unsaved changes. The renderer
// calls it from the bundle's dirty-change subscription so the dot
// tracks the bundle's state.
//
// The close-request flow is the three-button "Save changes?" dialog's
// plumbing: when the user tries to close the window with a dirty
// bundle, the main process intercepts the close event and sends
// gxw:close-requested to the renderer. The renderer shows the in-app
// dialog, takes the user's decision, optionally saves, and sends
// gxw:close-decision back to main with 'proceed' or 'cancel'. Main
// then either calls window.close() (which won't re-intercept because
// the close-confirmed flag is set) or does nothing (cancel).
contextBridge.exposeInMainWorld('gxwWindow', {
  setDocumentEdited: (edited) =>
    ipcRenderer.invoke('gxw:set-document-edited', edited),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('gxw:close-requested', listener);
    return () => ipcRenderer.removeListener('gxw:close-requested', listener);
  },
  sendCloseDecision: (decision) =>
    ipcRenderer.send('gxw:close-decision', decision),
});

// Native dialog IPC (Stage 3 commit 3a, extended in 3b).
//
// showSaveDialog presents the macOS Save panel for Save As.
// showOpenDialog presents the macOS Open panel for Open
// Score, running in openDirectory mode so the user navigates
// to and picks a .gxs folder. Both return { canceled,
// filePath } where filePath is the absolute path the user
// chose, or null when the dialog was cancelled.
contextBridge.exposeInMainWorld('gxwDialog', {
  showSaveDialog: (options) =>
    ipcRenderer.invoke('gxw:show-save-dialog', options),
  showOpenDialog: (options) =>
    ipcRenderer.invoke('gxw:show-open-dialog', options),
});

// Native menu IPC (Stage 5 commit 5a).
//
// onAction registers a listener for menu-action dispatch
// from the main process. The native menu's click handlers
// call webContents.send('gxw:menu-action', actionName), and
// the renderer's dispatcher (src/menuActions.js) routes
// each action name to the same handler the in-page menu
// uses. pushState reports state changes back to the main
// process so the menu's disabled / checked flags refresh.
contextBridge.exposeInMainWorld('gxwMenu', {
  onAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('gxw:menu-action', listener);
    return () => ipcRenderer.removeListener('gxw:menu-action', listener);
  },
  pushState: (state) =>
    ipcRenderer.invoke('gxw:menu-state', state),
});

// Virtual MIDI port IPC. GeoSonel publishes a CoreMIDI
// virtual source named "GeoSonel" from the main process
// via node-midi; the renderer's MIDISender uses this
// bridge to query the port's status at init time and to
// dispatch outgoing MIDI bytes during playback.
//
// getStatus: returns { ready, portName }. The renderer
// emits a "ready" event to the toolbar indicator when
// ready is true so the indicator's label reads
// "MIDI: <portName>".
//
// send: takes a MIDI byte array (status, data1, data2)
// and a delayMs value (renderer's computed midiTime minus
// performance.now()). Main schedules the actual MIDI
// write via setTimeout for positive delays and dispatches
// immediately otherwise. The MIDISender fire-and-forgets
// the returned Promise so the per-event budget isn't held
// up by the IPC round trip.
contextBridge.exposeInMainWorld('gxwMidi', {
  getStatus: () => ipcRenderer.invoke('gxw:midi-get-status'),
  send: (bytes, delayMs) =>
    ipcRenderer.invoke('gxw:midi-send', bytes, delayMs),
});
