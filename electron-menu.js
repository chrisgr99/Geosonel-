// Native menu construction for the macOS menu bar.
//
// Stage 5 of the Electron migration. The menu lives in the
// main process; menu clicks dispatch to the renderer via
// the gxw:menu-action IPC channel as { action, payload }
// objects, where a small dispatcher (src/menuActions.js)
// routes each action name to the matching handler
// function. The renderer-side handlers are the same
// actionXxx functions src/scoreActions.js exposes, so menu
// clicks and (web-only) in-page menu clicks converge on
// the same code path.
//
// Keyboard accelerators on every custom item carry the
// standard Mac shortcuts (Cmd-S, Cmd-Z, Cmd-N, etc.); Cut,
// Copy, Paste, Delete, Select All, Minimize, Zoom, Bring
// All to Front, Hide, Quit, Reload, Force Reload, and
// Toggle Developer Tools use Electron's built-in roles so
// they get their standard accelerators and behaviour
// without any IPC plumbing. The native menu is the only
// menu surface on Electron; main.js skips the in-page
// menu installers when running under Electron and hides
// the in-page menubar nav via the body.electron-mode CSS
// rule.
//
// Disabled and checked states (Revert to Saved when clean,
// Reload from Disk when Untitled, Auto Zoom checkmark, zoom
// items when Auto Zoom is on) come from the renderer via
// the gxw:menu-state IPC. Open Recent and Revert to are
// dynamic submenus rebuilt from the menuState's recent-
// scores list and backup-slots list on every state push.
// Whenever the renderer pushes a new state, the menu is
// rebuilt and reapplied.

const { app, Menu } = require('electron');

// Mutable state pushed from the renderer via gxw:menu-state.
// Drives disabled/checked flags and the Open Recent / Revert
// to submenu contents. The initial values assume a clean
// Untitled bundle with Auto Zoom off and empty recent /
// backup lists — the renderer pushes the real state on
// startup so the first user-visible menu is built with
// current values.
const menuState = {
  dirty: false,
  isUntitled: true,
  autoZoom: false,
  /** @type {Array<{path: string, name: string}>} */
  recentScores: [],
  /** @type {Array<{slotNumber: number, label: string}>} */
  backups: [],
};

let currentWindow = null;

// Menu actions dispatch through the gxw:menu-action IPC
// channel as { action, payload } objects. Most static items
// only need the action name and pass payload=null; dynamic
// submenu items (Open Recent, Revert to) carry per-item
// payloads identifying which score or backup slot was
// clicked.
function send(action, payload = null) {
  if (currentWindow === null || currentWindow.isDestroyed()) return;
  currentWindow.webContents.send('gxw:menu-action', { action, payload });
}

function buildTemplate() {
  const { dirty, isUntitled, autoZoom, recentScores, backups } = menuState;

  // Open Recent submenu items. macOS convention: list of
  // recent entries, separator, Clear Menu (always present,
  // disabled when empty). The renderer pre-filters the
  // currently-open score from the list so we don't have to
  // check it here.
  /** @type {any[]} */
  const openRecentItems = [];
  for (const entry of recentScores) {
    openRecentItems.push({
      label: entry.name,
      click: () => send('open-recent', { path: entry.path }),
    });
  }
  if (openRecentItems.length > 0) {
    openRecentItems.push({ type: 'separator' });
  }
  openRecentItems.push({
    label: 'Clear Menu',
    enabled: recentScores.length > 0,
    click: () => send('clear-recent'),
  });

  // Revert to submenu items. Backups are pre-rendered by the
  // renderer with their relative-date labels so the main
  // process doesn't need its own clock-formatting logic. The
  // parent Revert to menu entry is disabled when the list
  // is empty (untitled bundle, no save yet, or simply no
  // backups rotated in), so this submenu is only reachable
  // when there's at least one slot to revert to.
  /** @type {any[]} */
  const revertToItems = backups.map((slot) => ({
    label: slot.label,
    click: () => send('revert-to-backup', {
      slotNumber: slot.slotNumber,
      label: slot.label,
    }),
  }));

  return [
    // Application menu — the leftmost menu on macOS,
    // labelled with the app name. Carries About, Settings,
    // the Services submenu, the standard Hide/Hide
    // Others/Show All cluster, and Quit. Quit uses the
    // 'quit' role so Cmd-Q drives Electron's normal
    // shutdown path (which then runs the renderer's close-
    // intercept handler if the bundle is dirty). About and
    // Settings dispatch to the renderer; everything else is
    // a built-in role.
    {
      label: app.name,
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => send('show-about'),
        },
        { type: 'separator' },
        {
          label: 'Settings\u2026',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('show-settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },

    // File menu. Mirrors the in-page File menu's Electron-
    // build entries; the data-portability cluster (Export,
    // Import, Back Up, Restore) stays web-only and isn't
    // present here. Open Recent and Revert to are dynamic
    // submenus rebuilt from menuState.recentScores and
    // menuState.backups on every state push.
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save'),
        },
        {
          label: 'Save As\u2026',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => send('save-as'),
        },
        {
          label: 'Revert to Saved',
          enabled: dirty,
          click: () => send('revert'),
        },
        {
          label: 'Revert to',
          enabled: backups.length > 0,
          submenu: revertToItems,
        },
        { type: 'separator' },
        {
          label: 'New\u2026',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('new-score'),
        },
        {
          label: 'Open\u2026',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('open-score'),
        },
        {
          label: 'Open Recent',
          submenu: openRecentItems,
        },
        {
          label: 'Duplicate\u2026',
          click: () => send('duplicate-score'),
        },
        {
          label: 'Rename\u2026',
          click: () => send('rename-score'),
        },
        {
          label: 'Delete\u2026',
          click: () => send('delete-score'),
        },
        { type: 'separator' },
        {
          label: 'Reload from Disk',
          // Greyed out for Untitled bundles since there's
          // no on-disk version to pull. Becomes available
          // the moment the user runs Save As and the
          // bundle acquires a real path.
          enabled: !isUntitled,
          click: () => send('reload-from-disk'),
        },
      ],
    },

    // Edit menu. Undo, Redo, and Duplicate are custom
    // (click-only in 5a; they have canvas-specific
    // behaviour that needs focus-aware dispatch from the
    // renderer when accelerators land in 5c). Cut, Copy,
    // Paste, Paste and Match Style, Delete, and Select
    // All use Electron's built-in roles so they get the
    // standard text-editing accelerators and behaviour
    // (works automatically in INPUT, TEXTAREA,
    // contenteditable, and CodeMirror) without any IPC.
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => send('undo'),
        },
        {
          label: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => send('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Duplicate',
          accelerator: 'CmdOrCtrl+D',
          click: () => send('duplicate-canvas-edit'),
        },
      ],
    },

    // View menu. Zoom In, Zoom Out, Reset Zoom are greyed
    // out while Auto Zoom is on, matching the in-page menu.
    // Auto Zoom is a checkbox item; the renderer pushes the
    // current state through gxw:menu-state on every toggle.
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          enabled: !autoZoom,
          click: () => send('zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          enabled: !autoZoom,
          click: () => send('zoom-out'),
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          enabled: !autoZoom,
          click: () => send('reset-zoom'),
        },
        {
          label: 'Auto Zoom',
          type: 'checkbox',
          checked: autoZoom,
          click: () => send('toggle-auto-zoom'),
        },
        { type: 'separator' },
        {
          label: 'Focus Canvas',
          accelerator: 'Shift+CmdOrCtrl+F',
          click: () => send('toggle-focus-canvas'),
        },
        { type: 'separator' },
        // Reload / Force Reload / Toggle Developer Tools.
        // Placed at the bottom of the View menu since they're
        // recovery and debugging affordances used much less
        // often than the zoom and focus items above. All
        // three use Electron's built-in roles, so accelerators
        // (Cmd-R, Cmd-Shift-R, Option-Cmd-I) come for free and
        // no IPC plumbing is needed.
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },

    // Run menu. Currently a single item; future stages
    // grow this with Start, Stop, Restart, and Run
    // Selection.
    {
      label: 'Run',
      submenu: [
        {
          label: 'Run Scene',
          accelerator: 'CmdOrCtrl+Return',
          click: () => send('run-scene'),
        },
      ],
    },

    // Window menu — standard items via Electron's roles
    // so Minimize, Zoom, and Bring All to Front behave
    // exactly as they do in any macOS app.
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
}

function rebuildMenu() {
  const menu = Menu.buildFromTemplate(buildTemplate());
  Menu.setApplicationMenu(menu);
}

/**
 * Install the native menu and bind it to the given browser
 * window. The window reference is used by the menu's click
 * handlers to dispatch action IPC to the right renderer.
 * Called from app.whenReady after the window is created.
 * @param {Electron.BrowserWindow} win
 */
function installMenu(win) {
  currentWindow = win;
  rebuildMenu();
}

/**
 * Update one or more fields of the menu state and rebuild
 * the menu. Called from the gxw:menu-state IPC handler in
 * electron-main.js whenever the renderer reports a state
 * change. Partial updates are supported — fields not in
 * the patch keep their previous values.
 * @param {{dirty?: boolean, isUntitled?: boolean, autoZoom?: boolean, recentScores?: Array<{path: string, name: string}>, backups?: Array<{slotNumber: number, label: string}>}} state
 */
function updateMenuState(state) {
  if (typeof state.dirty === 'boolean') menuState.dirty = state.dirty;
  if (typeof state.isUntitled === 'boolean') menuState.isUntitled = state.isUntitled;
  if (typeof state.autoZoom === 'boolean') menuState.autoZoom = state.autoZoom;
  if (Array.isArray(state.recentScores)) menuState.recentScores = state.recentScores;
  if (Array.isArray(state.backups)) menuState.backups = state.backups;
  rebuildMenu();
}

module.exports = { installMenu, updateMenuState };
