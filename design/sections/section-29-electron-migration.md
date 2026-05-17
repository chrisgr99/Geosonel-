## Section 29 — Electron Migration

GXW is currently a web application served as static files. The medium-term plan is to migrate it to a native macOS application via Electron, primarily to give scores reliable persistence on disk. The reason persistence demands this move is that GXW scores are artefacts rather than performances: a composer constructs a score over many sessions, refines it across weeks or months, and returns to it the way they would return to a Logic Pro project file. The browser-based persistence model is fundamentally fragile for this use case — IndexedDB can be cleared by profile resets, browser updates, or manual site-data clearing, and the File System Access API's permission model produces intrusive reconnect prompts that proved unworkable in the earlier disk-mirror experiment. Electron eliminates both problems by giving GXW direct disk access through Node.js APIs.

The migration is staged. Each stage delivers usable improvement and is committable independently, so the codebase stays runnable throughout. The total work to reach a polished native app with disk persistence is roughly four to six focused sessions. Stage six (distribution to other users) is deferred until there is a real distribution path, since code signing and packaging are real ongoing overhead.

A parallel web version remains possible. Keeping the storage layer behind a thin abstraction lets both a disk-backed Electron build and an IndexedDB-backed web build coexist, with each storage backend implementing the same interface that bundle.js depends on. Whether to maintain both versions in parallel is a question to settle separately when the migration progresses far enough to face the choice; for now the migration treats Electron as the primary target.

### Stage 1 — Bare-minimum Electron wrapper

Wrap the existing app in Electron with no functional changes. Add electron as a dev dependency, write a small main-process entry point that creates a BrowserWindow loading index.html, configure security (context isolation on, node integration off, a preload script for IPC), and launch with `electron .`. The existing static-server workflow goes away — Electron loads the files directly via the file:// protocol. Everything else stays the same: Strudel loads from esm.sh, Web MIDI works, IndexedDB persists across runs.

The risk is finding something that quietly assumed a browser context, but Electron is Chromium and such cases are rare. Roughly half a session of work, and the result is a real Mac app whose window behaves like every other Mac app's window. Persistence is unchanged — that comes in Stage 2 — but the dependency on Chrome the browser is gone, along with the permission-prompt issues and the separate static server.

### Stage 2 — Disk-based persistence

Move score storage from IndexedDB to a real Scores folder on disk. The bundle data model is unchanged — each score is a folder with scene.json, behaviours.js, and optional image — but the storage layer reads and writes through Node.js fs calls instead of IndexedDB transactions. Implementation is replacing storage.js with a disk-backed equivalent, plumbed through Electron's IPC so the renderer asks the main process to read and write files.

Existing scores in IndexedDB migrate on first launch via a one-time dialog: the user picks where the Scores folder should live and confirms importing the existing scores into it. The bundle.js abstraction insulates the rest of the app from the change; the storage interface stays the same shape, only the implementation behind it shifts. One to two sessions of work, with the main complexity in getting the migration story right and handling edge cases like interrupted writes or path encoding for non-ASCII score names.

### Stage 3 — Native file dialogs and Recent Files

Wire the File menu through to Electron's native dialogs. New, Open, and Save call `dialog.showOpenDialog` and related, replacing the modal-overlay Open Score dialog with the real macOS file picker. The recent files list lives either as a small JSON in app config or is computed by scanning the Scores folder directly, and renders as a Recent Files submenu under File. Optionally, the app registers opened files with macOS so they appear in the Apple menu's Recent Documents.

One session of work. After this stage, GXW handles open, save, and recent-files the way a Mac user expects, with no in-app modal overlays for file operations.

### Stage 4 — Auto-reload and disk-mirror cleanup

Remove the deprecated disk-mirror module (src/diskMirror.js) and its associated Settings UI. Persistence is already disk-backed by Stage 2, so the mirror has no remaining purpose. The auto-reload-from-external-changes feature (Section 18) re-implements on top of Node's fs.watch — or a polling fallback for platforms where fs.watch is unreliable — without any permission-lapse problems.

The AI-edits-via-disk workflow that the original disk mirror was built to support becomes practical again, since the permission flakiness disappears. Whether to surface it as a feature is a separate decision; the underlying capability exists for free once the file-watching is wired up. One session of work, and the codebase has shed several modules that existed purely to work around browser-context limitations.

### Stage 5 — Native menus

Replace the HTML-based dropdown menus with Electron's native Menu.buildFromTemplate. The menus appear in the macOS menu bar at the top of the screen, with command-key shortcuts handled natively, dynamic enable/disable for context-dependent items, and checkable items for things like Auto Zoom and Focus Canvas. The existing menuUtil.js machinery is replaced for the main menu bar but may be retained for any in-window dropdowns that survive.

More cosmetic than functional — the current HTML menus work — but it noticeably improves the native-app feel and interacts better with macOS accessibility features such as VoiceOver and the Speak Selection workflow. One session of work.

### Stage 6 — Distribution (deferred)

Distributing GXW as a downloadable app for other users requires packaging into a signed .dmg or .pkg via electron-builder or electron-forge, an Apple Developer account (approximately $100 per year) for code signing and notarisation, and an auto-updater such as electron-updater for delivering fixes to installed users. This is real ongoing work and is deferred until there is a real distribution path. For personal use the migration stops at Stage 5: launching the app with `electron .` from the repository, or an unsigned local build, is enough.

### After the migration

After Stages 1 through 5, GXW is a native macOS application with disk-based score storage in a user-chosen Scores folder. Scores are accessible through Finder, immune to browser data clearing, openable by other tools (a text editor on scene.json, an image viewer on the image), and survive browser-related accidents entirely. The File menu uses native macOS dialogs and offers Recent Files both inside the app and optionally in the Apple menu's Recent Documents. External edits to score files (from an AI assistant or another editor) reload into GXW automatically. The codebase has shed the disk-mirror module and any other workarounds for browser-context limitations.

The plan delivers what the deprecated disk-mirror attempted, by a route that does not depend on the File System Access API and its permission-lapse problems. The total work is bounded — four to six sessions for the core migration, with distribution deferred until the time is right.
