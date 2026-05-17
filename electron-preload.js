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
  loadScoreRecord: (name) => ipcRenderer.invoke('gxw:load-score-record', name),
  saveScoreRecord: (record) => ipcRenderer.invoke('gxw:save-score-record', record),
  deleteScoreRecord: (name) => ipcRenderer.invoke('gxw:delete-score-record', name),
  loadAllScoreRecords: () => ipcRenderer.invoke('gxw:load-all-score-records'),
  getSetting: (key) => ipcRenderer.invoke('gxw:get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('gxw:set-setting', key, value),
  getScoresFolder: () => ipcRenderer.invoke('gxw:get-scores-folder'),
});
