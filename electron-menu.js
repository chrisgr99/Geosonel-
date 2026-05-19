// Native menu construction for the macOS menu bar.
//
// Stage 5 of the Electron migration. The menu lives in the
// main process; menu clicks dispatch to the renderer via
// the gxw:menu-action IPC channel, where a small dispatcher
// (src/menuActions.js) routes each action name to the same
// handler functions the in-page menu uses today.
//
// During Stage 5 commit 5a the in-page menu bar remains
// visible alongside the native menu. The native menu adds
// click items only — no keyboard accelerators yet — because
// the in-page menu's window-level keyboard listeners still
// own the shortcuts, and binding accelerators here would
// cause double-firing when the user pressed e.g. Cmd-S. Sub-
// commit 5c retires the in-page menu and its listeners, and
// adds accelerators here at the same time.
//
// Disabled and checked states (Revert to Saved when clean,
// Reload from Disk when Untitled, Auto Zoom checkmark, zoom
// items when Auto Zoom is on) come from the renderer via the
// gxw:menu-state IPC. Whenever the renderer pushes a new
// state, the menu is rebuilt and reapplied.
//
// Dynamic submenus (Open Recent, Revert to) are deferred to
// sub-commit 5b; for now they're absent from the native
// menu, and users still reach those features through the
// in-page menu.

const { app, Menu } = require('electron');

// Mutable state pushed from the renderer via gxw:menu-state.
// Drives disabled/checked flags across the menu. The
// initial values assume a clean Untitled bundle with Auto
// Zoom off — the renderer pushes the real state on startup
// so the first user-visible menu is built with current
// values.
const menuState = {
  dirty: false,
  isUntitled: true,
  autoZoom: false,
};

let currentWindow = null;

function send(action) {
  if (currentWindow === null || currentWindow.isDestroyed()) return;
  currentWindow.webContents.send('gxw:menu-action', action);
}

function buildTemplate() {
  const { dirty, isUntitled, autoZoom } = menuState;

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
    // submenus deferred to sub-commit 5b. All items click-
    // only in 5a; accelerators land in 5c.
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          click: () => send('save'),
        },
        {
          label: 'Save As\u2026',
          click: () => send('save-as'),
        },
        {
          label: 'Revert to Saved',
          enabled: dirty,
          click: () => send('revert'),
        },
        { type: 'separator' },
        {
          label: 'New\u2026',
          click: () => send('new-score'),
        },
        {
          label: 'Open\u2026',
          click: () => send('open-score'),
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
          label: 'Import Image\u2026',
          click: () => send('import-image'),
        },
        {
          label: 'Import Image from URL\u2026',
          click: () => send('import-image-from-url'),
        },
        {
          label: 'Remove Image',
          click: () => send('remove-image'),
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
          click: () => send('undo'),
        },
        {
          label: 'Redo',
          click: () => send('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Duplicate',
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
          enabled: !autoZoom,
          click: () => send('zoom-in'),
        },
        {
          label: 'Zoom Out',
          enabled: !autoZoom,
          click: () => send('zoom-out'),
        },
        {
          label: 'Reset Zoom',
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
          click: () => send('toggle-focus-canvas'),
        },
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
 * @param {{dirty?: boolean, isUntitled?: boolean, autoZoom?: boolean}} state
 */
function updateMenuState(state) {
  if (typeof state.dirty === 'boolean') menuState.dirty = state.dirty;
  if (typeof state.isUntitled === 'boolean') menuState.isUntitled = state.isUntitled;
  if (typeof state.autoZoom === 'boolean') menuState.autoZoom = state.autoZoom;
  rebuildMenu();
}

module.exports = { installMenu, updateMenuState };
