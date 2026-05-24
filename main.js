/**
 * GXW main entry point.
 *
 * Wires up every component and owns the score session. The
 * current score's data and behaviour are kept in two files
 * inside the bundle \u2014 scene.json (declarative data) and
 * behaviors.js (named functions) \u2014 which the scene loader
 * stitches together on demand (Cmd-Enter or Run menu) to
 * produce a Scene that the canvas renders on top of the grid.
 *
 * The save model is explicit-only: typing or any other
 * mutation marks the bundle dirty; Cmd-S saves. Run Scene
 * executes from the in-memory bundle and never commits to
 * disk. The macOS window title bar shows the score name
 * with a " (Unsaved)" suffix while dirty and, on Electron,
 * the close-button circle gets the standard documentEdited
 * dot. A three-button Save / Don't Save / Cancel dialog
 * protects against closing the window with unsaved changes
 * in Electron; the web version falls back to the browser's
 * generic beforeunload warning.
 *
 * Disk mirroring (optional) writes every save out to a folder
 * the user picks via Settings, and watches the active score's
 * files for external changes. When a change is detected on
 * disk \u2014 typically from an AI assistant editing through
 * Claude Desktop's filesystem MCP \u2014 the bundle is reloaded
 * automatically within a second or two.
 *
 * Current milestone scope:
 *   - Scene data model (Scene, Curve, Trigger, Sprite).
 *   - Scene loader that builds a Scene from scene.json plus
 *     behaviors.js, with named function references resolved
 *     against the behavior file's top-level declarations.
 *   - Canvas rendering of scenes (static).
 *   - Editor with Properties (JSON) and Behaviors (JS) tabs,
 *     each with its own syntax highlighting and linter.
 *   - Disk mirroring for scores; auto-reload on external edits.
 *   - Explicit save (Cmd-S); no autosave timer.
 *   - Run Scene command (Cmd-Enter) executing from in-memory state.
 *   - First-load auto-run so the canvas shows something.
 */

// @ts-check

import {
    Bundle,
    loadScoreByPath,
    createNewScore,
    listAvailableScores,
} from "./src/bundle.js";
import {
    requestPersistentStorage,
    getCurrentScorePath,
    setCurrentScorePath,
    saveScoreRecord,
    renameScoreRecord,
    suppressNextSaveEmit,
    subscribeAfterSaveScore,
    subscribeAfterDeleteScore,
    setBackupErrorReporter,
    migrateCurrentScoreSettingToPath,
    composeScorePathFromName,
    scoreNameFromPath,
    joinScorePath,
    dirname,
} from "./src/storage.js";
import { TabbedEditor } from "./src/editor.js";
import { Transport } from "./src/transport.js";
import { Simulation } from "./src/simulation.js";
import { TransportBarView } from "./src/transportBar.js";
import { StrudelRuntime } from "./src/strudel/runtime.js";
import { MIDISender } from "./src/strudel/midiSender.js";
import { PatternFiringEngine } from "./src/strudel/firingEngine.js";
import { installImageSignals } from "./src/strudel/signals.js";
import { installDivider } from "./src/paneDivider.js";
import { Canvas } from "./src/canvas.js";
import { MessageArea } from "./src/messages.js";
import { ImageImporter } from "./src/imageImporter.js";
import {
    loadImage as galleryLoadImage,
    findByContentHash as galleryFindByContentHash,
    add as galleryAdd,
    touch as galleryTouch,
    remove as galleryRemove,
} from "./src/gallery.js";
import { computeContentHash } from "./src/imageHash.js";
import { generateThumbnail } from "./src/thumbnailGen.js";
import { installViewMenu } from "./src/viewMenu.js";
import { installFileMenu } from "./src/fileMenu.js";
import { installRunMenu } from "./src/runMenu.js";
import { installEditMenu } from "./src/editMenu.js";
import { installAppMenu } from "./src/appMenu.js";
import { installMenuActions, pushMenuState, pushRecentScoresToMenu, pushBackupsToMenu } from "./src/menuActions.js";
import { SceneLoader } from "./src/sceneLoader.js";
import { DiskMirror } from "./src/diskMirror.js";
import { openDialog, confirmDiscardDialog } from "./src/dialog.js";
import { Toolbar } from "./src/toolbar.js";
import { actionSaveAs } from "./src/scoreActions.js";
import { recordScoreOpen, migrateRecentScoresToPaths, subscribeToRecentScores } from "./src/recentFiles.js";
import {
    parsePatternToPositions,
    formatParseResultForConsole,
} from "./src/strudel/patternParse.js";
import {
    parseScene,
    stringifyScene,
    addSpriteAt,
    addTriggerAt,
    addCurveAt,
    duplicateSelection,
    removeObjects,
    fillMissingIds,
    fillEmptyNames,
    cleanLegacyShapeFields,
    cleanLegacySceneFields,
    fillMissingCanvasSize,
    stripObsoleteFields,
    migrateBehaviorsFilename,
    setMuteOnSelection,
    setHideOnCurves,
    setNameOnSelection,
    translateSelection,
    scaleCurveAxis,
    scaleSelectionAroundAnchor,
    setPositionAxisOnSelection,
    setSizeAxisOnSelection,
    setSpriteDisplayDiameterOnSelection,
    setVelocityAxisOnSelection,
    setTriggerSizeOnSelection,
    setCursorROnSelection,
    setCursorLOnSelection,
    setCurveThicknessOnCurves,
    setCursorThicknessOnCurves,
    setColorOnSelection,
    setCyclePatternOnSelection,
    setBeatsPerCycleOnSelection,
    setBeatIntervalOnSelection,
    setPatternRepeatsOnCurves,
    setCycleSpeedsOnCurves,
    setCanHitOnSelection,
    setHasHitFunctionOnSelection,
    setCanBeHitOnSelection,
    setBeenHitFunctionOnSelection,
    setCanTickOnSelection,
    setOnTickFunctionOnSelection,
    scaffoldCallbackSlotFunction,
    scaffoldPatternBlock,
    setCanvasW,
    setCanvasH,
    setSceneBpm,
} from "./src/sceneEditor.js";

main();

async function main() {
    // --- Emergency storage wipe (?clearstorage) ---
    //
    // When the URL contains the query parameter
    // ?clearstorage, delete IndexedDB for this origin
    // before any other work runs. Used as a last-resort
    // recovery when a persisted bundle contains content
    // that hangs the app on a code path the ?norun bypass
    // doesn't reach (typically the editor's initial mount
    // pulling the broken bundle into a CodeMirror view).
    // The deletion is destructive and irreversible: every
    // GXW score in this browser is removed. After the
    // delete completes a stub message replaces the
    // document body and the rest of main() returns,
    // leaving the user to reload without the parameter
    // (which creates a fresh empty bundle through the
    // normal resolveInitialBundle path).
    if (new URLSearchParams(window.location.search).has("clearstorage")) {
        const req = indexedDB.deleteDatabase("gxw");
        await new Promise((resolve) => {
            req.onsuccess = () => resolve(undefined);
            req.onerror = () => resolve(undefined);
            req.onblocked = () => resolve(undefined);
        });
        document.body.innerHTML =
            "<div style='padding:24px;font:16px/1.4 system-ui;color:#ddd'>" +
            "GXW storage cleared. All scores have been deleted from this browser. " +
            "Reload without the clearstorage query parameter to start fresh." +
            "</div>";
        return;
    }

    // --- Persistent storage request (best-effort, early) ---
    requestPersistentStorage().catch(() => {});

    // --- One-time migrations to path-based identity ---
    //
    // Old installs persisted currentScoreName plus a name-
    // based gxw.recentScores list. Resolve those into their
    // path-based equivalents before any code below reads
    // them. Idempotent after the first call.
    await migrateCurrentScoreSettingToPath();
    await migrateRecentScoresToPaths(composeScorePathFromName);

    // --- Persisted Focus Canvas state ---
    //
    // Apply the user's last Focus Canvas state to <body>
    // before any further UI runs. Setting the class
    // synchronously here means the editor pane and message
    // area never briefly paint visible on a reload where
    // the user had Focus Canvas active. The CSS rule for
    // body.focus-canvas overrides the editor pane's and
    // message area's flex-basis to zero, so the first paint
    // already shows the canvas filling the body. The same
    // toggle is wired to the toolbar's Focus Canvas button,
    // the View menu's Focus Canvas item, and Cmd-Shift-F.
    try {
        if (localStorage.getItem("gxw.layout.focusCanvas") === "true") {
            document.body.classList.add("focus-canvas");
        }
    } catch (e) {
        // localStorage may be unavailable (private-mode,
        // quota error). Fall back to default-visible.
    }

    // --- Initial bundle ---
    //
    // Emergency bypass: when the URL contains the query
    // parameter ?norun, we skip the persisted-bundle
    // lookup entirely and create a fresh empty bundle.
    // This is the strongest level of recovery, used when
    // the persisted bundle contains content that hangs
    // the app on any code path that touches it (parser,
    // editor render, scene loader, firing engine, marker
    // cache). With a fresh empty bundle in hand the rest
    // of startup proceeds normally but with nothing
    // dangerous to load. The persisted broken bundle
    // remains in IndexedDB untouched; once the app is
    // running in this safe mode, the File menu can be
    // used to switch back to the broken bundle for
    // hand-editing in the JSON tab once the cause is
    // understood, or to a different known-good bundle.
    const norunMode = new URLSearchParams(window.location.search).has("norun");
    const bundle = norunMode
        ? await createNewScore("Recovery")
        : await resolveInitialBundle();

    // Record the initial score in the Open Recent submenu's
    // backing list. Skipped in norunMode because the Recovery
    // bundle is a transient throwaway — logging it in the
    // recent list would push out a real entry and surface
    // "Recovery" the next time the user opens the submenu.
    if (!norunMode && bundle.path !== null) {
        recordScoreOpen(bundle.path);
    }

    // --- Canvas, message area ---
    const canvasAreaEl = document.getElementById("canvas-area");
    const messageAreaEl = document.getElementById("message-area");
    if (!(canvasAreaEl instanceof HTMLElement) ||
        !(messageAreaEl instanceof HTMLElement)) {
        console.error("GXW: canvas or message area element missing.");
        return;
    }
    const canvas = new Canvas(canvasAreaEl);
    const messages = new MessageArea(messageAreaEl);

    // Surface backup-rotation failures (Stage 2.5 Phase 3
    // commit 2) in the messages area. storage.js calls the
    // installed reporter when saveScoreRecord's pre-write
    // backup step fails; the rotation failure doesn't block
    // the main save (the user's primary intent), but the
    // user should know the backup wasn't taken.
    setBackupErrorReporter((msg) => { messages.write(msg, "error"); });

    // Make the canvas area focusable so Spacebar (a transport
    // toggle outside text contexts) works after clicking the
    // canvas. Plain <div> elements aren't focusable by default,
    // so without this the editor retains focus across canvas
    // clicks and Spacebar continues to type into the editor
    // (the text-context exception in the keyboard handler
    // matches CodeMirror focus). tabIndex -1 makes the element
    // focusable programmatically and via click without
    // inserting it into the Tab key cycle. The CSS rule in
    // main.css removes the focus ring so the canvas area
    // doesn't gain a visible outline when focused.
    canvasAreaEl.tabIndex = -1;
    canvasAreaEl.addEventListener("mousedown", () => {
        canvasAreaEl.focus();
    });

    if (bundle.getCurrentImage() !== null) {
        const img = bundle.getCurrentImage();
        if (img !== null) {
            await canvas.setImage({ bytes: img.content, mimeType: img.mimeType });
        }
    }

    // Sync the canvas's per-score display brightness with
    // the bundle's stored value before the first paint
    // (Stage 6). The bundle's value defaults to 100 (no
    // change) for older records and freshly-created
    // bundles, so this is typically a same-value no-op;
    // when the bundle carries a saved non-default value,
    // pushing here means the image paints at the right
    // brightness from frame zero rather than briefly
    // flashing at 100 and then dimming after the
    // inspector wiring block below runs. The inspector's
    // slider is synced separately further down, once
    // editor.canvasInspector exists.
    canvas.setDisplayBrightness(bundle.displayBrightness);

    // --- Electron detection ---
    //
    // The Electron build exposes window.gxwStorage (set in
    // electron-preload.js); the web build does not. The
    // detection feeds the title-bar wiring below: the web
    // build's title carries a "(Browser)" suffix so the
    // IndexedDB durability tradeoff comes up on every
    // glance at the title bar, while the Electron build's
    // title is the plain score name and the dirty signal
    // additionally appears as the standard macOS dot in the
    // close-button circle via setDocumentEdited.
    const isElectron =
        typeof (/** @type {any} */ (window).gxwStorage) === "object" &&
        (/** @type {any} */ (window).gxwStorage) !== null;

    // Tag the document body so CSS can hide the in-page
    // top row (which on Electron contains only the menubar,
    // since the native macOS menu bar takes over). The web
    // build never sets this class, so its menubar and the
    // divider beneath it remain visible and functional.
    if (isElectron) {
        document.body.classList.add("electron-mode");
    }

    // --- Title-bar wiring ---
    //
    // The window title is now the sole on-screen score-name
    // and dirty-state surface (the top row's in-page span
    // and saved indicator are gone). Composition: score
    // name, optional " (Unsaved)" suffix while dirty,
    // optional " (Browser)" suffix on the web build to
    // surface the IndexedDB durability tradeoff. On Electron
    // the macOS close-button dot via setDocumentEdited stays
    // as a bonus signal but is no longer the primary dirty
    // indicator — the in-title "(Unsaved)" carries that
    // load.
    const updateTitleBar = (/** @type {boolean} */ dirty) => {
        // Resolves session.bundle.name at call time, so the title
        // tracks the current score after any switchToBundle or
        // File menu rename. Only called from places that fire
        // after the session const further down is initialised —
        // never synchronously during the early body of main().
        const name = session.bundle.name;
        const dirtyMark = dirty ? " (Unsaved)" : "";
        const browserMark = isElectron ? "" : " (Browser)";
        document.title = `${name}${dirtyMark} \u2014 GeoSonel${browserMark}`;
        if (isElectron) {
            const gxwWindow = /** @type {any} */ (window).gxwWindow;
            if (gxwWindow !== undefined &&
                typeof gxwWindow.setDocumentEdited === "function") {
                void gxwWindow.setDocumentEdited(dirty);
            }
        }
    };
    // Initial title bar set inline: session isn't constructed
    // yet at this point in main(), so updateTitleBar (which
    // resolves session.bundle.name) can't run. The bundle is
    // freshly loaded from disk/IDB so dirty is false here.
    {
        const browserMark = isElectron ? "" : " (Browser)";
        document.title = `${bundle.name} \u2014 GeoSonel${browserMark}`;
    }

    // --- Editor ---
    const tabBarEl = document.querySelector(".tab-bar");
    const editorAreaEl = document.getElementById("editor-area");
    const inspectorAreaEl = document.getElementById("inspector-area");
    const canvasInspectorAreaEl = document.getElementById("canvas-inspector-area");
    if (!(tabBarEl instanceof HTMLElement) ||
        !(editorAreaEl instanceof HTMLElement) ||
        !(inspectorAreaEl instanceof HTMLElement) ||
        !(canvasInspectorAreaEl instanceof HTMLElement)) {
        console.error("GXW: editor mount points missing.");
        return;
    }
    /** @type {() => Promise<void>} */
    let runScene = async () => {};

    /** @type {(objectId: string, expressionBody: string) => Promise<void>} */
    let handlePromotePattern = async () => {};

    /** @type {(objectId: string) => Promise<void>} */
    let handleClearPattern = async () => {};

    /** @type {(objectId: string, blockingLine: number) => void} */
    let handleClearPatternBlocked = () => {};

    /**
     * Current Scene object, refreshed after each
     * successful runScene. Used by dispatchSelectedObjectIds
     * to resolve canvas selection indices (which are
     * positional into sprites/triggers/curves arrays) into
     * the object ids needed by the Stage A5 active-tag
     * highlight. Null before the first runScene completes,
     * and stays null when a runScene fails (parse error,
     * load error); the dispatcher handles the null case
     * by emitting an empty id set.
     *
     * @type {import("./src/scene.js").Scene | null}
     */
    let currentScene = null;

    const editor = new TabbedEditor(tabBarEl, editorAreaEl, inspectorAreaEl, canvasInspectorAreaEl, bundle, {
        onDirtyChange: (dirty) => {
            updateTitleBar(dirty);
            // Push to the native menu so Revert to Saved's
            // disabled-when-clean gate stays in sync with the
            // bundle state. No-op on the web build, since
            // pushMenuState short-circuits when window.gxwMenu
            // is absent.
            pushMenuState({ dirty });
        },
        onSaved: () => {
            // Title-bar transition from "(Unsaved)" → clean is
            // driven by onDirtyChange, which fires immediately
            // after a successful save. No additional just-
            // saved indicator survives the top-row removal;
            // the title-bar transition is the signal.
        },
        onRunScene: () => { runScene(); },
        onPromotePattern: (objectIds, expressionBody) => {
            void handlePromotePattern(objectIds, expressionBody);
        },
        onClearPattern: (objectId) => {
            void handleClearPattern(objectId);
        },
        onClearPatternBlocked: (objectId, blockingLine) => {
            handleClearPatternBlocked(objectId, blockingLine);
        },
    });

    // --- Transport and audio engine ---
    //
    // The StrudelRuntime is constructed here. It used to wait
    // for the user to click the Load Engine button in the
    // transport bar before its async init runs (the click was
    // the browser gesture the AudioContext needs to start),
    // but that's an awkward extra step on every page load. We
    // now trigger init on the FIRST user interaction of any
    // kind — a click anywhere, a keypress anywhere — which
    // also counts as the browser gesture and saves the user
    // from hunting down a specific button each time.
    //
    // The Load Engine button still exists in the transport bar
    // and still works; clicking it is just one of many
    // possible first interactions that trip the auto-trigger.
    // Once init starts (or is already running), the listeners
    // remove themselves via AbortController so they don't pile
    // up over the session.
    const transport = new Transport();
    const strudelRuntime = new StrudelRuntime(transport);
    // TransportBarView is constructed AFTER the toolbar
    // below; the toolbar builds the transport DOM elements
    // (rewind-btn, play-btn, musical-position, bpm-input,
    // bpm-group), and TransportBarView's getElementById
    // lookups must run after those elements exist. The
    // intermediate setup (strudel auto-load handlers,
    // MIDISender, simulation, firing engine, dividers,
    // imageImporter, diskMirror, sceneLoader, runScene
    // definition, session, reconcile) doesn't depend on
    // the transport view being bound, so deferring is
    // safe.
    /** @type {any} */ (window).strudelRuntime = strudelRuntime;

    {
        const abortController = new AbortController();
        const triggerEngineLoad = () => {
            abortController.abort();
            void strudelRuntime.init();
        };
        document.addEventListener("pointerdown", triggerEngineLoad, {
            signal: abortController.signal,
        });
        document.addEventListener("keydown", triggerEngineLoad, {
            signal: abortController.signal,
        });
    }

    // MIDI output adapter. Web MIDI initialisation is async
    // (requestMIDIAccess returns a promise); kicked off here
    // without await so the rest of app load proceeds. Sends
    // before init completes are no-ops gated by the sender's
    // internal ready flag. The transport bar indicator
    // subscribes via wireMidiIndicator and updates its label
    // on the ready event, flashing on each note send.
    const midiSender = new MIDISender(transport);
    void midiSender.init();
    // wireMidiIndicator(midiSender) is deferred until after
    // the canvas-toolbar is constructed below; the MIDI
    // indicator element lives inside the toolbar now, so it
    // doesn't exist in the DOM until Toolbar.render runs.

    // When the strudel engine finishes loading, re-parse
    // every curve's cyclePattern so marker diamonds appear
    // on the canvas for patterns that were present at scene
    // load but couldn't be parsed yet (parsePatternToPositions
    // requires window.note and friends, which initStrudel
    // installs). Without this hook the markers would only
    // appear after the next runScene call (Cmd-Enter or
    // similar). Once loaded, subsequent setScene calls
    // refresh markers naturally through their own code path.
    //
    // The firing engine gets the same treatment: its compiled
    // pattern cache will hold null entries for every source
    // whose cyclePattern was non-empty at scene load (parse
    // returned the engine-not-loaded error and we stored
    // null). recompileMissingPatterns walks the cache and
    // compiles those entries against the now-available
    // strudel globals.
    strudelRuntime.onStatusChange((status) => {
        if (status === "loaded") {
            // Install dynamic image-colour signals (Phase 4)
            // as window globals before refreshing markers
            // or recompiling patterns, so any pattern that
            // references pxLt or its OKLCh siblings parses
            // cleanly against the freshly-installed globals
            // rather than failing with a ReferenceError.
            installImageSignals();
            canvas.refreshMarkers();
            firingEngine.recompileMissingPatterns();
        }
    });

    // --- Simulation ---
    //
    // Advances scene state forward in time during playback.
    // The Simulation is passive: it has no internal timer and
    // does not subscribe to transport events. The Canvas owns
    // the play loop and ticks the simulation from its render
    // loop. setTransport on the Canvas wires the transport's
    // play and rewind events to the canvas's loop start/stop
    // and rewind redraw; setSimulation on the Canvas attaches
    // the simulation reference. Both are static one-time
    // wirings; nothing here changes them later.
    const simulation = new Simulation(transport);
    canvas.setTransport(transport);
    canvas.setSimulation(simulation);

    // --- Pattern firing engine (Tier 2 Phase 1) ---
    //
    // Drives audio output for continuous-firing sources
    // (curves and sprites). Reads simulation cycle state
    // each tick, detects per-source cycle wraps, queries
    // the cached strudel Pattern, and commits scheduled
    // events to superdough via the runtime's play wrapper.
    // Triggers are excluded from Phase 1 scope; their one-
    // shot firing model lands in Tier 5 with its own
    // primitive.
    //
    // The firing engine is passive: like the Simulation it
    // has no internal timer and no transport subscription.
    // The canvas ticks it from the same render-loop frame
    // that ticks the simulation, so the cycle-state read
    // is consistent with the visual frame being painted.
    // setScene is called from runScene after the
    // simulation's setScene so the firing engine's compiled
    // pattern cache reconciles to the freshly-loaded scene
    // on the same code path.
    const firingEngine = new PatternFiringEngine(strudelRuntime, midiSender, simulation, transport);
    canvas.setFiringEngine(firingEngine);
    firingEngine.setCanvas(canvas);

    // --- Dividers ---
    //
    // Two draggable dividers: the body divider sits between
    // the editor pane (housing the property inspector) and
    // the canvas pane, and the message-area divider sits
    // between the canvas area and the message area below.
    //
    // Body divider floor. The inspector has rows whose total
    // width is the natural minimum of the editor pane —
    // narrower than that would clip fields. We capture that
    // width here by reading editor-pane.offsetWidth while
    // the CSS still has it at flex: 0 0 max-content (the
    // initial paint state, which sizes the pane to its
    // widest content row). The measurement triggers a layout
    // pass synchronously, so the value reflects the
    // currently-rendered inspector. We use it as minPanePx
    // for installDivider; the divider then sets the pane's
    // style.flex either to a persisted user size or to the
    // floor, overriding the CSS default. To gain canvas room
    // entirely, use the toolbar's Focus Canvas button, View
    // → Focus Canvas, or Cmd-Shift-F, which collapse the
    // editor pane, the body divider, the message divider,
    // and the message area together.
    const editorPaneEl = document.getElementById("editor-pane");
    // Read the inspector's natural content width with
    // Focus Canvas temporarily off. When the user has
    // Focus Canvas active across reloads the body already
    // carries focus-canvas by this point, which forces the
    // editor pane's flex-basis to zero and makes
    // offsetWidth read 0 — the wrong value for the floor
    // (the divider would let the user drag the inspector
    // away to nothing the next time they exited Focus
    // Canvas). The class is removed, offsetWidth is read
    // synchronously, and the class is re-applied in the
    // same JS tick, so the browser never paints between
    // the toggles.
    let inspectorFloor;
    if (editorPaneEl instanceof HTMLElement) {
        const wasActive = document.body.classList.contains("focus-canvas");
        if (wasActive) document.body.classList.remove("focus-canvas");
        inspectorFloor = editorPaneEl.offsetWidth;
        if (wasActive) document.body.classList.add("focus-canvas");
    }
    installDivider({
        dividerId: "body-divider",
        firstPaneId: "editor-pane",
        containerId: "body",
        orientation: "vertical",
        minPanePx: inspectorFloor,
        persistKey: "gxw.layout.editorPaneWidth",
        onDrag: () => {
            // Update --editor-pane-width on every drag so
            // body.focus-canvas #canvas-toolbar's padding-
            // left tracks the user's current pane size.
            // The variable is read by the focus-canvas
            // spacer rule in main.css.
            if (editorPaneEl instanceof HTMLElement) {
                document.documentElement.style.setProperty(
                    "--editor-pane-width",
                    `${editorPaneEl.offsetWidth}px`,
                );
            }
            canvas.scheduleDraw();
        },
    });
    // Initial --editor-pane-width sync. installDivider just
    // applied either the persisted size or the inspector
    // floor to editor-pane's inline flex; resolve the same
    // value here from localStorage so the CSS variable
    // matches without going through offsetWidth, which would
    // read zero when Focus Canvas is restored as active on
    // first paint. This keeps the focus-canvas spacer rule
    // (body.focus-canvas #canvas-toolbar { padding-left:
    // var(--editor-pane-width); } in main.css) reading the
    // intended width whether Focus Canvas is on or off.
    {
        let initialPaneWidth = inspectorFloor;
        try {
            const stored = parseInt(
                localStorage.getItem("gxw.layout.editorPaneWidth") ?? "",
                10,
            );
            if (Number.isFinite(stored) && stored > 0) {
                initialPaneWidth = Math.max(stored, inspectorFloor ?? 0);
            }
        } catch (e) {
            // localStorage unavailable; fall back to floor.
        }
        if (typeof initialPaneWidth === "number" && initialPaneWidth > 0) {
            document.documentElement.style.setProperty(
                "--editor-pane-width",
                `${initialPaneWidth}px`,
            );
        }
    }
    installDivider({
        dividerId: "message-divider",
        firstPaneId: "message-area",
        containerId: "canvas-pane",
        orientation: "horizontal",
        invertControl: true,
        minPanePx: 56,
        persistKey: "gxw.layout.messageAreaHeight",
        onDrag: () => canvas.scheduleDraw(),
    });

    // --- Image importer ---
    const imageImporter = new ImageImporter({ bundle, canvas, messages });
    imageImporter.installGlobalListeners();

    // Wire the import-complete callback (Stage 4 of the
    // Canvas inspector work). When an import finishes
    // successfully and the gallery push lands, refresh the
    // grid and move the green active-frame to the new entry.
    // The callback fires once per import; failed imports or
    // imports where the gallery push couldn't run leave the
    // active frame at its prior position rather than
    // clearing it, which matches what the user is staring
    // at on the canvas (the prior image is still visible if
    // the new one didn't make it through).
    imageImporter.setOnImportComplete(async ({ galleryId }) => {
        if (!editor.canvasInspector) return;
        await editor.canvasInspector.refreshGallery();
        editor.canvasInspector.setActiveGalleryId(galleryId);
        // Stage 5: refresh the pinned section. The newly
        // imported image's hash may match a pinned slot
        // (re-import of a pinned image), in which case
        // the pinned section's active flag moves to
        // that slot.
        pushPinnedSnapshot();
    });

    // --- Disk mirror ---
    // Restored from IndexedDB if previously configured. The
    // folder handle persists across page reloads but the
    // browser may require permission to be reaffirmed by the
    // user; that re-grant happens implicitly when the user
    // next opens Settings or initiates an action that needs
    // disk access. Polling for external changes also fails
    // silently if permission has lapsed, until the user
    // restores it.
    const diskMirror = new DiskMirror();
    await diskMirror.restore();

    // Mirror IndexedDB writes out to disk transparently. Every
    // path that goes through saveScoreRecord/deleteScoreRecord
    // \u2014 score actions, editor save, runScene's pre-save,
    // imports, restores \u2014 automatically pushes/deletes on
    // disk too. No call site needs to know about disk mirror.
    subscribeAfterSaveScore(async (_path, record) => {
        await diskMirror.pushRecord(record);
        // After every save the backups submenu may have a
        // new slot 1 (rotation copied the pre-save state
        // into the slot before the write). Refresh the
        // native menu's Revert to submenu so it shows the
        // newly-rotated slot. Path is non-null here because
        // saveScoreRecord is only ever called with a real
        // path; untitled bundles take the actionSaveAs
        // detour first which sets a path before saving.
        void pushBackupsToMenu(_path);
    });
    subscribeAfterDeleteScore(async (path) => {
        await diskMirror.deleteScore(scoreNameFromPath(path));
    });

    // Reconnect modal. When the disk mirror's permission lapses
    // (typically after a page reload), getStatus() reports
    // needsReconnect=true and we surface a modal asking the
    // user to grant access again. The modal is only shown on
    // the false-to-true transition so the user isn't pestered
    // multiple times for the same lapse.
    let lastNeedsReconnect = false;
    let lastReady = false;
    /** @type {{ close: () => void } | null} */
    let openReconnectDialog = null;
    diskMirror.subscribeStatus((status) => {
        if (status.needsReconnect && !lastNeedsReconnect) {
            openReconnectDialog = showReconnectDialog(diskMirror, messages);
        } else if (!status.needsReconnect && openReconnectDialog !== null) {
            openReconnectDialog.close();
            openReconnectDialog = null;
        }
        // When the mirror transitions to ready (folder picked,
        // or permission re-granted), refresh the README and
        // write the active-score marker so AI assistants can
        // see what's open.
        if (status.ready && !lastReady) {
            void diskMirror.refreshReadme();
            void diskMirror.setActiveScore(session.bundle.name);
            // Reconcile the active score with disk — the
            // mirror just became available and disk may have
            // newer content than IndexedDB.
            void (async () => {
                const reconciled = await reconcileBundleWithDisk(session.bundle, diskMirror);
                if (reconciled !== session.bundle) {
                    await onExternalChange(reconciled);
                }
            })();
        }
        lastNeedsReconnect = status.needsReconnect;
        lastReady = status.ready;
    });
    if (diskMirror.getStatus().needsReconnect) {
        openReconnectDialog = showReconnectDialog(diskMirror, messages);
        lastNeedsReconnect = true;
    }

    // --- Scene loader ---
    const sceneLoader = new SceneLoader();

    /**
     * Load the current score's scene.json and behaviours.js,
     * build a Scene, and update the canvas. Executes from the
     * in-memory bundle state — the explicit-save model means
     * Run no longer commits to disk first; Cmd-S is the only
     * way bytes leave memory. Errors are reported in the
     * message area; the canvas retains the previous scene on
     * failure.
     */
    runScene = async () => {
        await runBundleMigrations();
        await ensureIdentityFieldsAreFilled();
        const result = sceneLoader.load(session.bundle);
        if (result.success && result.scene !== null) {
            canvas.setScene(result.scene);
            simulation.setScene(result.scene);
            firingEngine.setScene(result.scene);
            applySceneParamsToTransport(result.scene, transport);
            if (editor.inspector) {
                editor.inspector.setScene(result.scene);
            }
            // Sync the Canvas inspector tab's W and H
            // fields to the scene's current values.
            // Doesn't disturb a focused field (the user
            // may be mid-edit on W or H from a different
            // code path), so this is safe to call
            // unconditionally on every scene reload. The
            // call used to land on toolbar.setCanvasSize
            // before the Section 13.5 migration moved the
            // fields into the Canvas inspector tab; same
            // contract, different owner.
            if (editor.canvasInspector) {
                editor.canvasInspector.setCanvasSize(result.scene.canvasW, result.scene.canvasH);
            }
            // Stage A5: refresh the current scene reference
            // and dispatch the canvas's current selection
            // (resolved to object ids against the freshly-
            // loaded scene) to the editor's active-tag
            // highlight. Selection indices are preserved
            // across scene reloads, so re-resolving on
            // every reload picks up any id changes at the
            // same indices (e.g. after an external
            // scene.json edit).
            currentScene = result.scene;
            dispatchSelectedObjectIds(canvas.getSelection());
            dispatchKnownObjectIds();
            messages.write("Scene updated.");
        } else {
            messages.write(result.error ?? "Unknown load error.", "error");
        }
    };

    /**
     * Run bundle-level migrations on the active score's
     * files. Currently the only migration here renames a
     * legacy behaviours.js file to behaviors.js (DESIGN.md
     * v2.4 spelling change). Done before the scene-level
     * fill pass below so the loader's behaviors.js lookup
     * succeeds on a freshly-migrated bundle, and so the
     * editor's tab bar refreshes to show the new label.
     * Returns once any necessary migration has been
     * applied. Steady-state (already-migrated) bundles are
     * a no-op.
     *
     * Persistence: the rename is committed to disk inside
     * this function so the migrated state survives a
     * reload. Without an explicit save here the bundle
     * would be re-migrated every page load, since Run
     * Scene no longer auto-saves and there is no other
     * path that would write the rename out.
     */
    const runBundleMigrations = async () => {
        const renamed = migrateBehaviorsFilename(session.bundle);
        if (renamed) {
            // Re-render the editor so the tab bar picks up
            // the new filename label, and so the renamed
            // file is reachable through selectTab. The
            // active tab survives the call iff its name
            // didn't change — if it was "behaviours.js" the
            // editor falls back to the inspector tab.
            editor.reloadFromBundle();
            // Persist the migrated bundle so the next page
            // load doesn't re-run the rename pass. Save
            // also clears the dirty flag the rename set
            // via Bundle.markDirty, leaving the user a
            // clean state on first paint. Skipped for
            // untitled bundles (no path to save to); the
            // first Save As will commit the migrated state
            // along with anything else the user has done.
            if (session.bundle.path !== null) {
                await editor.save();
            }
        }
    };

    /**
     * Before loading the scene, scan scene.json for objects
     * that lack an id or a name and fill them in, strip
     * fields that became obsolete with the section-27
     * reshape, and run the small remaining set of legacy
     * cleanups (circle-shape migration, removed score-level
     * fields, missing canvas-size). Ids are stable and
     * type-prefixed (sp_xxxxxx, tr_xxxxxx, cv_xxxxxx) and
     * survive across edits because we write them back to
     * the bundle's scene.json text after generating them.
     * Names are inserted as empty strings — the same default
     * the constructors apply — so the user has an obvious
     * place to type a name in the JSON tab without first
     * remembering the field exists. The strip pass cleans
     * out the pre-section-27 per-curve timing fields, the
     * old per-kind callback slots, and the auto-message-
     * interval fields so existing scores in IndexedDB show
     * clean JSON in the Properties JSON tab on first load
     * after the reshape. All passes are no-ops once the
     * steady state is reached.
     *
     * Done before sceneLoader.load() so the loader sees the
     * normalised scene. If scene.json has a parse error we
     * skip silently — sceneLoader will report the error
     * from its own parse.
     *
     * When something does change, the bundle's updateContent
     * marks it dirty. Migrations aren't user edits, so we
     * save explicitly here to keep the dirty flag from
     * surprising the composer on every page load: the score
     * is normalised, then persisted as clean.
     */
    const ensureIdentityFieldsAreFilled = async () => {
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) return;
        const parsed = parseScene(sceneFile.content);
        if (!parsed.ok) return;
        const idsChanged = fillMissingIds(parsed.data);
        const namesChanged = fillEmptyNames(parsed.data);
        const shapesChanged = cleanLegacyShapeFields(parsed.data);
        const sceneFieldsChanged = cleanLegacySceneFields(parsed.data);
        const canvasSizeChanged = fillMissingCanvasSize(parsed.data);
        const obsoleteStripped = stripObsoleteFields(parsed.data);
        if (!idsChanged &&
            !namesChanged &&
            !shapesChanged &&
            !sceneFieldsChanged &&
            !canvasSizeChanged &&
            !obsoleteStripped) return;
        const newText = stringifyScene(parsed.data);
        session.bundle.updateContent("scene.json", newText);
        editor.refreshActiveTabFromBundle();
        // Persist the normalised state so the dirty flag the
        // migration set via updateContent doesn't surprise
        // the composer on first paint. Skipped for untitled
        // bundles; the first Save As will commit the
        // normalised state along with anything else.
        if (session.bundle.path !== null) {
            await editor.save();
        }
    };

    // --- Score session ---
    //
    // refreshScoreNameDisplay used to update both an in-page
    // score-name span and the window title; with the in-page
    // span removed in the toolbar reorganization, the window
    // title (and the macOS documentEdited dot under Electron)
    // is the only on-screen surface. The function is kept
    // under its existing name so callers like
    // renameCurrentScoreTo and switchToBundle continue to
    // work without changes; updateTitleBar reads the current
    // session.bundle on every call, so the new name flows
    // through automatically.
    const refreshScoreNameDisplay = () => {
        updateTitleBar(session.bundle.dirty);
    };

    /**
     * Stage 5 helper for the Canvas inspector's pinned
     * section. The inspector renders the pinned section
     * from a snapshot (each slot is null or
     * { hash, dataUrl, active }). This helper converts
     * the bundle's pinnedSlots and pinnedBytes into
     * snapshot shape and pushes to the inspector. It
     * runs from every place where the bundle's pinned
     * state or current image changes:
     * syncGalleryFromBundle's finally block (which
     * covers score open), imageImporter.setOnImportComplete,
     * the pinned-slot click handler, the drag-to-pinned
     * drop handler, and the remove-image handler.
     */

    /**
     * Encode an ArrayBuffer as a base64 string. Chunked
     * to avoid the "too many arguments" limit that
     * String.fromCharCode hits on buffers larger than
     * the browser's spread-into-call cap (typically
     * around 64K). Used to inline pinned-image bytes
     * as data URLs in the snapshot we push to the
     * Canvas inspector.
     * @param {ArrayBuffer} buffer
     * @returns {string}
     */
    const arrayBufferToBase64 = (buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const slice = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, /** @type {any} */ (slice));
        }
        return btoa(binary);
    };

    /**
     * Convert the current bundle's pinnedSlots and
     * pinnedBytes into the snapshot shape the Canvas
     * inspector renders from. Each non-null slot becomes
     * { hash, dataUrl, active }; missing bytes (which
     * shouldn't happen if the bundle's invariant holds)
     * coerce to null so the slot renders as empty. The
     * active flag goes on whichever slot's hash matches
     * bundle.imageContentHash, which lights the green
     * active-frame on the pinned section.
     * @returns {Array<{ hash: string, dataUrl: string, active: boolean } | null>}
     */
    const buildPinnedSnapshot = () => {
        const bundle = session.bundle;
        const activeHash = bundle.imageContentHash;
        return bundle.pinnedSlots.map((hash) => {
            if (hash === null) return null;
            const bytes = bundle.pinnedBytes.get(hash);
            if (bytes === undefined) return null;
            return {
                hash,
                dataUrl: "data:image/jpeg;base64," + arrayBufferToBase64(bytes),
                active: activeHash !== null && activeHash === hash,
            };
        });
    };

    /**
     * Push the current pinned snapshot to the Canvas
     * inspector. Safe to call when the inspector isn't
     * mounted yet (early no-op).
     * @returns {void}
     */
    // The previous commit also computed a Pin-button
    // enabled/disabled state here (computePinButtonState).
    // That helper is gone in the Stage 5 second commit
    // along with the Pin button itself — the four
    // disabled reasons (no current background, no hash,
    // already pinned, full) no longer surface as button
    // state; they're either irrelevant under the drag
    // gesture (which always pins the dragged image) or
    // absorbed by the drop logic in
    // bundle.dropHashOnPinnedSlot (the splice-reorder
    // case handles dragging an already-pinned image to
    // a different slot).
    const pushPinnedSnapshot = () => {
        if (!editor.canvasInspector) return;
        editor.canvasInspector.setPinnedSnapshot(buildPinnedSnapshot());
    };

    /**
     * Reconcile the gallery's active-frame state with the
     * bundle's current background image (Stage 4 of the
     * Canvas inspector work). Three cases.
     *
     * The bundle has no image. Clear the active gallery id
     * so no slot carries the green frame. The gallery's
     * entry list itself is unchanged.
     *
     * The bundle has an image with an imageContentHash. Look
     * up the matching gallery entry by hash. When found,
     * promote it to slot 1 via gallery.touch and set the
     * active id so the green frame moves there. When not
     * found (the user imported on a different machine, or
     * cleared their gallery, or this score predates the
     * gallery), add a fresh entry from the bundle's bytes
     * with a generated thumbnail; the resulting entry id
     * becomes the active one.
     *
     * The bundle has an image but no hash (a score saved
     * before Stage 4 lands). Compute the hash from the
     * bytes silently — the field is recomputable, so no
     * forced save is needed. Set the field on the in-memory
     * bundle so the next natural save picks it up. From
     * there, fall through to the hash-present path above.
     *
     * The function never throws to its caller. Hash compute
     * failures or gallery IPC failures leave the active id
     * cleared and log to the console rather than disrupting
     * the calling code path (which is usually mid-score-
     * open and shouldn't be derailed by a gallery hiccup).
     */
    const syncGalleryFromBundle = async () => {
        try {
            await syncGalleryFromBundleInner();
        } finally {
            // Always refresh the pinned section after a
            // gallery sync — the bundle's
            // imageContentHash may have been backfilled
            // (legacy migration path), which changes
            // which pinned slot, if any, carries the
            // green active-frame. Runs regardless of
            // which return path the inner function took.
            pushPinnedSnapshot();
        }
    };

    const syncGalleryFromBundleInner = async () => {
        if (!editor.canvasInspector) return;

        if (session.bundle.imageName === null) {
            editor.canvasInspector.setActiveGalleryId(null);
            return;
        }

        const img = session.bundle.getCurrentImage();
        if (img === null) {
            editor.canvasInspector.setActiveGalleryId(null);
            return;
        }

        // Legacy bundles (saved before Stage 4) have no
        // imageContentHash. Recompute from the bytes; assign
        // back to the bundle in memory so subsequent saves
        // pick it up, but don't force a save here — the
        // dirty flag belongs to the user's edits, not
        // background migrations.
        let hash = session.bundle.imageContentHash;
        if (hash === null) {
            try {
                hash = await computeContentHash(img.content);
                session.bundle.imageContentHash = hash;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                    "GXW: failed to compute image hash during gallery sync; active frame cleared.",
                    err,
                );
                messages.write(
                    `Gallery sync skipped: hash compute failed (${msg}).`,
                    "error",
                );
                editor.canvasInspector.setActiveGalleryId(null);
                return;
            }
        }

        try {
            const existing = await galleryFindByContentHash(hash);
            if (existing !== null) {
                // Match found. The stable-position model
                // keeps the existing slot put; just point
                // the green active-frame at it. No
                // gallery-state changes, so no
                // refreshGallery needed.
                editor.canvasInspector.setActiveGalleryId(existing.id);
                return;
            }
            // No matching entry. Generate a thumbnail from
            // the bundle's bytes and create a new entry.
            // sourcePath gets the bundle's image filename;
            // it's the best identity we have for legacy
            // imports, though the content hash is what
            // future syncs will key on.
            const thumb = await generateThumbnail(img.content, img.mimeType);
            const result = await galleryAdd({
                sourcePath: session.bundle.imageName ?? "",
                normalizedBytes: img.content,
                thumbnailBase64: thumb,
                contentHash: hash,
            });
            await editor.canvasInspector.refreshGallery();
            editor.canvasInspector.setActiveGalleryId(result.id);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
                "GXW: gallery sync failed; active frame cleared.",
                err,
            );
            messages.write(
                `Gallery sync failed: ${msg}`,
                "error",
            );
            editor.canvasInspector.setActiveGalleryId(null);
        }
    };

    /**
     * Called by DiskMirror when external file changes are
     * detected on disk for the watched score. The mirror has
     * already persisted the new bundle to IndexedDB (using
     * suppressed-emit so we don't push back to disk). Our job
     * here is just to refresh the in-memory state and the UI.
     *
     * @param {Bundle} newBundle
     */
    const onExternalChange = async (newBundle) => {
        if (newBundle.name !== session.bundle.name) return;
        // Disk-mirror pull constructs a bundle with the
        // display name but no path — the mirror only knows
        // names. Inherit the current session's path so
        // subsequent saves through the primary storage land
        // at the right location.
        newBundle.path = session.bundle.path;
        // Clear canvas selection: the indexes we hold refer to
        // the previous version of this score's arrays. Even
        // when the score name is unchanged, an external write
        // can have inserted, removed, or reordered objects, so
        // letting old indexes survive would silently rebind
        // them to whatever object now sits at that slot. The
        // undo stack is also cleared for the same reason:
        // snapshots taken against the prior in-memory state
        // are no longer coherent with the disk-driven state
        // that just arrived, so Cmd-Z against them would
        // apply stale text on top of fresh edits.
        canvas.setSelection({ sprites: [], triggers: [], curves: [] });
        undoPast.length = 0;
        undoFuture.length = 0;
        session.bundle = newBundle;
        imageImporter.setBundle(newBundle);
        await editor.setBundle(newBundle);
        const img = newBundle.getCurrentImage();
        if (img !== null) {
            await canvas.setImage({ bytes: img.content, mimeType: img.mimeType });
        } else {
            await canvas.setImage(null);
        }
        // Sync brightness to the externally-loaded bundle
        // (Stage 6). Disk edits that change displayBrightness
        // — typically AI assistants editing .gxw-meta.json
        // directly — land here and propagate to both canvas
        // and inspector slider.
        canvas.setDisplayBrightness(newBundle.displayBrightness);
        if (editor.canvasInspector) {
            editor.canvasInspector.setDisplayBrightness(newBundle.displayBrightness);
        }
        await runScene();
        // Refresh the Canvas inspector's gallery active-frame
        // for the externally-loaded bundle (Stage 4). Runs
        // after runScene so any error messages from the
        // gallery sync land below the "Reloaded from disk."
        // line for chronological clarity.
        await syncGalleryFromBundle();
        messages.write("Reloaded from disk.");
    };

    const session = {
        bundle,
        /**
         * Re-establish the disk-mirror watch on the current
         * bundle. Call after any change to session.bundle.name
         * (rename) or session.bundle (switch) so polling tracks
         * the right score's files.
         */
        rewatch() {
            if (session.bundle.path === null) {
                // Untitled bundle: not on disk, nothing to
                // watch and no active-score marker to set.
                // Stop any prior watch so the mirror doesn't
                // keep polling for a former score's files.
                diskMirror.watch(null, null);
                return;
            }
            diskMirror.watch(session.bundle.name, onExternalChange);
            void diskMirror.setActiveScore(session.bundle.name);
        },
        /**
         * @param {Bundle} newBundle
         */
        async switchToBundle(newBundle) {
            // Switching scores invalidates any selection from
            // the previous score — indexes mean different
            // objects in different scenes. Clear up front so
            // setScene's filter logic doesn't rebind stale
            // entries to whatever lives at the same index in
            // the new scene. The undo stack is also cleared:
            // snapshots from the previous score are scene.json
            // texts that have no meaning under the new score,
            // and letting them persist would let Cmd-Z apply
            // foreign text to the active bundle.
            canvas.setSelection({ sprites: [], triggers: [], curves: [] });
            undoPast.length = 0;
            undoFuture.length = 0;

            // Before applying, reconcile with disk so the user
            // sees any external edits made while another score
            // was active (or while GXW was closed).
            newBundle = await reconcileBundleWithDisk(newBundle, diskMirror);

            session.bundle = newBundle;
            imageImporter.setBundle(newBundle);
            await editor.setBundle(newBundle);

            const img = newBundle.getCurrentImage();
            if (img !== null) {
                await canvas.setImage({ bytes: img.content, mimeType: img.mimeType });
            } else {
                await canvas.setImage(null);
            }

            // Sync canvas and inspector brightness to the
            // newly-loaded bundle's stored value (Stage 6).
            // Same-value pushes early-return inside both
            // setters so opening a score whose brightness
            // is 100 (the default) is cheap. Inspector sync
            // is conditional defensively; editor.canvasInspector
            // exists by this point in normal flow, but the
            // check keeps a startup-order regression from
            // throwing here.
            canvas.setDisplayBrightness(newBundle.displayBrightness);
            if (editor.canvasInspector) {
                editor.canvasInspector.setDisplayBrightness(newBundle.displayBrightness);
            }

            refreshScoreNameDisplay();

            // Record this score in the Open Recent submenu's
            // backing list. switchToBundle is the convergence
            // point for every load path — Open, Open Recent,
            // New, Duplicate, Save As, Import, Reload from
            // Disk — so one recordScoreOpen call here covers
            // every entry point. Re-recording the same score
            // (e.g. on Reload from Disk or Revert to Saved)
            // just refreshes its timestamp at the top of the
            // list, which is the desired behaviour.
            if (newBundle.path !== null) {
                recordScoreOpen(newBundle.path);
            }

            // Push to the native menu so Reload from Disk's
            // disabled-when-untitled gate tracks the new
            // bundle's path nullness.
            pushMenuState({ isUntitled: newBundle.path === null });

            // Refresh the native menu's Open Recent and
            // Revert to submenus. Open Recent filters out
            // the now-active bundle from its list; Revert
            // to fetches the new bundle's backup slots from
            // disk and renders their labels.
            pushRecentScoresToMenu(newBundle.path);
            void pushBackupsToMenu(newBundle.path);

            session.rewatch();

            await runScene();
            // Stage 4: refresh the gallery active-frame for
            // the score we just switched to. Runs after
            // runScene so the canvas paint and gallery
            // sync land roughly together.
            await syncGalleryFromBundle();
        },
        refreshScoreNameDisplay,
    };
    refreshScoreNameDisplay();

    // Begin watching the initial score for external changes.
    // This is a no-op when disk mirroring isn't configured;
    // when it later becomes configured (via Settings), the
    // watch state already in place starts polling automatically.
    session.rewatch();

    // Reconcile the active score with disk in case the disk
    // version has changes that happened while GXW wasn't
    // running (typically AI edits while the tab was closed).
    // The polling watcher only sees changes that occur after
    // it starts, so without this step those edits would be
    // invisible until something else triggered a reload.
    {
        const reconciled = await reconcileBundleWithDisk(session.bundle, diskMirror);
        if (reconciled !== session.bundle) {
            session.bundle = reconciled;
            imageImporter.setBundle(reconciled);
            await editor.setBundle(reconciled);
            const img = reconciled.getCurrentImage();
            if (img !== null) {
                await canvas.setImage({ bytes: img.content, mimeType: img.mimeType });
            } else {
                await canvas.setImage(null);
            }
            // Sync brightness to the reconciled bundle
            // (Stage 6). The reconciled version may carry a
            // different displayBrightness if disk had a
            // newer save with the slider in a different
            // position.
            canvas.setDisplayBrightness(reconciled.displayBrightness);
            if (editor.canvasInspector) {
                editor.canvasInspector.setDisplayBrightness(reconciled.displayBrightness);
            }
            messages.write("Loaded latest version from disk.");
        }
    }

    // Stage 4: initial gallery sync against the resolved
    // starting bundle. Sets the green active-frame on the
    // matching slot when the score's background image is
    // already a gallery entry, or registers it as a new
    // entry otherwise. Runs after the reconcile block so
    // session.bundle is settled; runs before the canvas-
    // toolbar wiring and the initial runScene so the grid
    // paints in its final state from the user's first
    // glance at the Canvas tab.
    await syncGalleryFromBundle();

    // --- Canvas toolbar and direct-manipulation editing ---
    //
    // The toolbar sits above the canvas and exposes three
    // creation tools: Add Sprite (click to place), Add
    // Trigger (click to place), and Add Curve (drag to
    // define an ellipse bounding box, hold Shift for a
    // circle). Single-clicking a tool button arms it for
    // one placement; double-clicking locks it for repeated
    // placements until Esc or a second click on the tool.
    // With no tool armed, the canvas is in selection mode:
    // clicks select objects, drag-from-empty draws a
    // marquee, and drag-on-object moves the selection.
    //
    // Canvas edits are committed by parsing scene.json,
    // mutating it, stringifying back, updating the bundle in
    // place, then re-running the scene. Bundle.updateContent
    // marks the bundle dirty as a normal side effect; the
    // user picks when to save via Cmd-S. The editor's
    // Properties (JSON) view is refreshed via
    // refreshActiveTabFromBundle so the JSON reflects the
    // new content immediately.
    const toolbarEl = document.getElementById("canvas-toolbar");
    if (!(toolbarEl instanceof HTMLElement)) {
        console.error("GXW: canvas-toolbar element missing.");
        return;
    }
    const toolbar = new Toolbar(toolbarEl);

    // Wire the transport view and MIDI indicator now that
    // the toolbar has built its DOM. Both modules find
    // their elements by id; the transport view binds
    // rewind-btn, play-btn, musical-position, bpm-input,
    // bpm-group, and the MIDI indicator helper finds
    // midi-indicator. These calls were deferred from the
    // earlier transport / MIDISender construction because
    // those elements now live inside the toolbar rather
    // than in the top row and don't exist in the DOM until
    // Toolbar.render runs.
    const transportBarView = new TransportBarView(transport);
    wireMidiIndicator(midiSender);

    canvas.setToolbar(toolbar);
    toolbar.onChange((tool, locked) => {
        canvas.setActiveTool(tool, locked);
    });
    // The toolbar's image-import button surfaces the same
    // file-picker flow as the File menu's Import Image
    // command. Routed through this callback rather than
    // having the toolbar import the imageImporter module
    // directly, so the toolbar stays decoupled from the
    // import pipeline's other dependencies.
    toolbar.onImageImportClick(() => {
        imageImporter.importViaFilePicker();
    });
    // The Canvas inspector tab's W and H fields emit
    // edits with the same shape inspector and canvas edits
    // use ({kind, value}). Dispatched through applySceneEdit
    // so they share the dirty-state, auto-save, and re-run
    // mechanics. applySceneEdit is declared below this
    // line; the closure captures the binding and resolves
    // it at click/wheel time, by which point the variable
    // is assigned. Before the Section 13.5 migration this
    // subscription was on toolbar.onSceneEdit; the wiring
    // moved here when the W/H fields migrated out of the
    // toolbar.
    if (editor.canvasInspector) {
        editor.canvasInspector.onSceneEdit(async (edit) => {
            if (edit.kind === "setCanvasW") {
                await applySceneEdit((data) => setCanvasW(data, edit.value));
            } else if (edit.kind === "setCanvasH") {
                await applySceneEdit((data) => setCanvasH(data, edit.value));
            }
        });

        // Gallery thumbnail-click handler (Stage 3 of the
        // Canvas inspector tab). The inspector emits an
        // intent with the clicked entry's id; main.js owns
        // the orchestration. Steps: load the full-resolution
        // bytes via gallery.loadImage, swap them into the
        // bundle's current image via replaceImage with a
        // filename derived from the entry id (gallery
        // entries are standalone now, so the id is the most
        // stable name we have), apply to the canvas, promote
        // the entry to slot 1 via gallery.touch, save the
        // bundle, refresh the gallery grid so the new
        // ordering paints, and call setActiveGalleryId so
        // the green active-frame moves to the clicked slot.
        // Errors at any step surface in the messages area;
        // partial-progress states are tolerated (e.g. canvas
        // updated but save failed leaves the bundle dirty,
        // which is the same behaviour the import pipeline
        // already has).
        editor.canvasInspector.onSetBackgroundFromGallery(async ({ id }) => {
            try {
                const { bytes, mimeType } = await galleryLoadImage(id);
                // Compute the hash from the loaded bytes so
                // the bundle's imageContentHash field stays in
                // sync with what gallery-sync will look for on
                // the next score open. We could read the hash
                // off the gallery entry instead, but that's an
                // extra IPC round-trip; SHA-256 on a 1000×1000
                // JPEG is microseconds, simpler to just
                // recompute.
                const contentHash = await computeContentHash(bytes);
                const name = id + ".jpg";
                session.bundle.replaceImage(name, bytes, mimeType, contentHash);
                await canvas.setImage({ bytes, mimeType });
                try {
                    await session.bundle.save();
                } catch (err) {
                    console.error("GXW: failed to persist bundle after gallery set:", err);
                    messages.write(
                        "Image applied but could not be saved to storage.",
                        "error",
                    );
                }
                // Stage 5: recency-bump the clicked entry to
                // the front of the shared section. galleryTouch
                // stamps the entry's addedAt to now; the
                // descending display sort in the shared
                // backend floats it to the head. Then refresh
                // the grid so the new order paints and move
                // the green active-frame to the clicked slot.
                try {
                    await galleryTouch(id);
                } catch (err) {
                    console.error("GXW: gallery touch failed:", err);
                }
                if (editor.canvasInspector) {
                    await editor.canvasInspector.refreshGallery();
                    editor.canvasInspector.setActiveGalleryId(id);
                    // Push pinned snapshot — the new
                    // current background's hash may
                    // match a pinned slot, which moves
                    // the active-frame onto that slot.
                    pushPinnedSnapshot();
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                messages.write(`Could not load gallery image: ${msg}`, "error");
            }
        });

        // Canvas tab Load Image button (Stage 4). Routes to
        // the same file-picker entry point the canvas-
        // toolbar's Image button uses, so the two surfaces
        // share their behaviour and the gallery-push happens
        // automatically via imageImporter._storeAndRender.
        editor.canvasInspector.onLoadImageClick(() => {
            imageImporter.importViaFilePicker();
        });

        // Canvas tab Remove Image button (Stage 4). Removes
        // the current background and clears the active
        // gallery id so the green frame disappears from
        // whichever slot had it. The gallery entry itself
        // stays in place — removing the score's reference
        // doesn't evict the entry from the gallery, which
        // matches the user's mental model of the gallery
        // as a recent-images history.
        editor.canvasInspector.onRemoveImageClick(async () => {
            await imageImporter.removeCurrentImage();
            editor.canvasInspector.setActiveGalleryId(null);
            // Stage 5: refresh pinned section. No current
            // background means no pinned slot carries
            // the green active-frame.
            pushPinnedSnapshot();
        });

        // Pinned-slot click handler. Sets the slot's image
        // as the current background and also add-or-
        // promotes it in the shared section (so the
        // recipient of a shared score builds up their
        // own shared gallery only from images they
        // actually use). The pinned slot's bytes are
        // already in memory via bundle.pinnedBytes, so
        // no IPC round-trip is needed for the swap; the
        // shared add-or-promote path does its own
        // thumbnail generation and gallery push, which
        // may take a moment.
        editor.canvasInspector.onSetBackgroundFromPinnedSlot(async ({ slotIndex, hash }) => {
            const bytes = session.bundle.pinnedBytes.get(hash);
            if (bytes === undefined) {
                messages.write(
                    "Pinned image bytes missing; the score's pinned/ subfolder may be out of sync.",
                    "error",
                );
                return;
            }
            // Synthesise a filename for the bundle's
            // imageName field. The first 12 hex chars of
            // the hash give a short stable suffix; full
            // hash isn't needed because the imageName
            // round-trips through the .gxs folder as a
            // top-level file and the hash already lives
            // on the bundle's imageContentHash field.
            const name = "from-pinned-" + hash.slice(0, 12) + ".jpg";
            session.bundle.replaceImage(name, bytes, "image/jpeg", hash);
            await canvas.setImage({ bytes, mimeType: "image/jpeg" });

            // Add-or-promote in the shared section.
            // galleryAdd's Stage 5 match-and-promote
            // bumps addedAt if this hash is already a
            // shared entry, or creates a fresh entry
            // otherwise. Either way the shared section
            // now has this image at the front of its
            // descending sort. Thumbnail generation
            // runs from the same bytes so the new entry
            // matches the image the user just saw
            // applied.
            /** @type {string | null} */
            let sharedId = null;
            try {
                const thumb = await generateThumbnail(bytes, "image/jpeg");
                const addResult = await galleryAdd({
                    sourcePath: name,
                    normalizedBytes: bytes,
                    thumbnailBase64: thumb,
                    contentHash: hash,
                });
                sharedId = addResult.id;
            } catch (err) {
                console.error(
                    "GXW: failed to add-or-promote pinned image in shared gallery:",
                    err,
                );
                // Non-fatal: the click's primary intent
                // (set as background) succeeded. The
                // shared section just won't reflect the
                // selection this time.
            }

            try {
                await session.bundle.save();
            } catch (err) {
                console.error(
                    "GXW: failed to persist bundle after pinned slot click:",
                    err,
                );
                messages.write(
                    "Image applied but could not be saved to storage.",
                    "error",
                );
            }

            if (editor.canvasInspector) {
                await editor.canvasInspector.refreshGallery();
                editor.canvasInspector.setActiveGalleryId(sharedId);
                // Pinned section's active-frame moves to
                // the clicked slot via the snapshot's
                // active flag, which now matches
                // bundle.imageContentHash.
                pushPinnedSnapshot();
            }
            // slotIndex is captured for any future use
            // (drag-to-unpin in the second commit). For
            // now the click outcome doesn't reference
            // it; the void below silences the unused-
            // parameter lint while keeping the
            // destructured name documented as part of
            // the callback contract.
            void slotIndex;
        });

        // --- Drag-on-pinned-slot handler (Stage 5 second commit) ---
        //
        // The Canvas inspector emits this when the user
        // drags any thumbnail (shared or pinned) onto a
        // specific pinned slot. main.js dispatches on
        // source.kind:
        //
        //   - source.kind === "shared": load bytes via
        //     gallery.loadImage, compute the content
        //     hash, then call dropHashOnPinnedSlot. The
        //     hash may already be in pinnedSlots (re-pin
        //     of a pinned image), in which case
        //     dropHashOnPinnedSlot's splice-reorder path
        //     takes over.
        //
        //   - source.kind === "pinned": the bytes are
        //     already in bundle.pinnedBytes keyed by the
        //     source hash, and dropHashOnPinnedSlot's
        //     splice-reorder path runs because the hash
        //     is by definition already pinned. No
        //     gallery I/O needed.
        //
        // dropHashOnPinnedSlot returns true if the
        // operation actually mutated state, false for
        // the no-op cases (out-of-range slot, drop on
        // own slot). We skip the save and the user-
        // visible message on a no-op.
        editor.canvasInspector.onDropOnPinnedSlot(async ({ source, targetSlotIndex }) => {
            /** @type {ArrayBuffer | null} */
            let bytes = null;
            /** @type {string | null} */
            let hash = null;
            if (source.kind === "shared") {
                try {
                    const loaded = await galleryLoadImage(source.entryId);
                    bytes = loaded.bytes;
                    hash = await computeContentHash(bytes);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    messages.write(`Could not load image for pinning: ${msg}`, "error");
                    return;
                }
            } else {
                // source.kind === "pinned". Bytes already
                // live on the bundle; no IPC needed.
                hash = source.hash;
                const existing = session.bundle.pinnedBytes.get(hash);
                if (existing === undefined) {
                    messages.write(
                        "Pinned image bytes missing; the score's pinned/ subfolder may be out of sync.",
                        "error",
                    );
                    return;
                }
                bytes = existing;
            }
            if (bytes === null || hash === null) return;

            const mutated = session.bundle.dropHashOnPinnedSlot(hash, bytes, targetSlotIndex);
            if (!mutated) return;

            // Push the new pinned snapshot first so the
            // user sees the slot fill in immediately,
            // then save in the background. A save
            // failure leaves the change in memory but
            // flags the persistence issue; the bundle
            // stays dirty so the next Cmd-S retries.
            pushPinnedSnapshot();

            try {
                await session.bundle.save();
            } catch (err) {
                console.error("GXW: failed to persist bundle after drag-to-pin:", err);
                messages.write(
                    "Image pinned but could not be saved to storage.",
                    "error",
                );
                return;
            }
            if (source.kind === "pinned") {
                messages.write(`Pinned image moved to slot ${targetSlotIndex + 1}.`);
            } else {
                messages.write(`Pinned to slot ${targetSlotIndex + 1}.`);
            }
        });

        // --- Drag-off-pane handler (Stage 5 second commit) ---
        //
        // The Canvas inspector emits this when the user
        // drags a thumbnail outside the canvas inspector
        // pane and releases. The vanish animation has
        // already played by the time this fires.
        // Dispatch on source.kind:
        //
        //   - source.kind === "shared": remove the
        //     entry from the shared gallery (deletes
        //     metadata + full-resolution cache copy).
        //     Refresh the inspector's gallery view.
        //
        //   - source.kind === "pinned": unpin the slot.
        //     Clears the slot in pinnedSlots and GCs
        //     bytes from pinnedBytes if no other slot
        //     still references the hash. Save so the
        //     unpin persists.
        editor.canvasInspector.onDragOff(async ({ source }) => {
            if (source.kind === "shared") {
                try {
                    await galleryRemove(source.entryId);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    messages.write(`Could not remove image from gallery: ${msg}`, "error");
                    return;
                }
                if (editor.canvasInspector) {
                    await editor.canvasInspector.refreshGallery();
                    // The removed entry might have been
                    // the active background's gallery
                    // entry; if so the active id is
                    // stale. Clear it defensively. The
                    // canvas itself still shows the
                    // background image — removing the
                    // shared gallery entry doesn't
                    // disturb the score's image data.
                    if (editor.canvasInspector !== null) {
                        // No-op when the cleared id
                        // doesn't match the removed
                        // entry; setActiveGalleryId
                        // short-circuits when the value
                        // is unchanged.
                    }
                }
                messages.write("Image removed from shared gallery.");
                return;
            }
            // source.kind === "pinned". Unpin the slot.
            const wasDirtyBefore = session.bundle.dirty;
            session.bundle.unpinSlot(source.sourceSlotIndex);
            const becameDirty = !wasDirtyBefore && session.bundle.dirty;
            // unpinSlot has no return value; use the
            // dirty-flag transition to detect whether
            // anything actually changed (defensive
            // against an out-of-range or already-empty
            // slot, which would be a no-op).
            pushPinnedSnapshot();
            if (!becameDirty && !session.bundle.dirty) {
                return;
            }
            try {
                await session.bundle.save();
            } catch (err) {
                console.error("GXW: failed to persist bundle after unpin:", err);
                messages.write(
                    "Image unpinned but could not be saved to storage.",
                    "error",
                );
                return;
            }
            messages.write(`Slot ${source.sourceSlotIndex + 1} unpinned.`);
        });

        // Brightness slider (Stage 6). The inspector's
        // slider emits the new integer value in 0..100 on
        // every input event during a drag; main.js routes
        // the value to bundle.setDisplayBrightness (which
        // marks the bundle dirty on any actual change) and
        // canvas.setDisplayBrightness (which schedules a
        // redraw so the visual change is immediate). Both
        // setters early-return on same-value pushes so a
        // slider that holds at one position doesn't churn
        // through redundant dirty-flag toggles or redraws.
        //
        // The brightness control is purely visual:
        // bundle.setDisplayBrightness updates only the
        // bundle's displayBrightness field; image-derived
        // music signals (pxLt, OKLCh, anything sampling
        // pixels) continue to read from the unmodified
        // source bitmap. See DESIGN.md Section 13.5 and
        // Section 26.
        editor.canvasInspector.onDisplayBrightnessChange((value) => {
            session.bundle.setDisplayBrightness(value);
            canvas.setDisplayBrightness(value);
        });

        // Push the bundle's stored brightness to the
        // freshly-mounted slider so the slider position
        // reflects what's actually persisted, not the
        // default 100. The inspector's setDisplayBrightness
        // deliberately does not fire the input listeners
        // (it's an external sync, not a user adjustment),
        // so this doesn't trigger a redundant write back
        // to bundle/canvas. The canvas's mirror was already
        // synced at the top of main() before the inspector
        // existed.
        editor.canvasInspector.setDisplayBrightness(session.bundle.displayBrightness);
    }

    // Play Selected toggle. When on, only currently-
    // selected canvas objects fire their patterns; when
    // off (default), every unmuted object fires. The id
    // set the firing engine gates on is updated by
    // dispatchSelectedObjectIds below on every selection
    // change and after every runScene, so flipping the
    // toggle on takes effect against the current selection
    // immediately without an extra setup call here. The
    // engine's setPlaySelectedMode internally matches the
    // existing mute-gate path: non-permitted sources drop
    // their pending events and skip population while the
    // mode is on, and the bootstrap path re-fills them
    // when the mode flips off.
    toolbar.onPlaySelectedToggle((active) => {
        firingEngine.setPlaySelectedMode(active);
    });

    /**
     * Resolve a canvas selection — arrays of indices into
     * the current scene's sprites, triggers, and curves —
     * into the corresponding set of object ids, and
     * dispatch it to the editor so the Stage A5 active-
     * tag highlight in behaviors.js tracks the selection.
     * Labelled blocks whose dollar-prefixed label matches
     * one of the resolved ids render in accent green; all
     * others stay in the default pink.
     *
     * Called on every canvas selectionChanged event and
     * after each successful runScene. Empty selection
     * dispatches an empty set, which the ViewPlugin reads
     * as no green anywhere. When the scene isn't loaded
     * (initial load before the first runScene completes,
     * or a runScene that failed to build a Scene) the
     * dispatch is still empty — there's no id mapping to
     * resolve indices against.
     *
     * @param {{sprites: number[], triggers: number[], curves: number[]}} selection
     */
    const dispatchSelectedObjectIds = (selection) => {
        /** @type {Set<string>} */
        const ids = new Set();
        if (currentScene !== null) {
            for (const i of selection.sprites) {
                const obj = currentScene.sprites[i];
                if (obj !== undefined && typeof obj.id === "string") ids.add(obj.id);
            }
            for (const i of selection.triggers) {
                const obj = currentScene.triggers[i];
                if (obj !== undefined && typeof obj.id === "string") ids.add(obj.id);
            }
            for (const i of selection.curves) {
                const obj = currentScene.curves[i];
                if (obj !== undefined && typeof obj.id === "string") ids.add(obj.id);
            }
        }
        editor.setSelectedObjectIds(ids);
        // Push the same id set into the firing engine's
        // play-selected gate so the Play Selected toolbar
        // toggle (when on) tracks the live selection. Has
        // no audible effect while the toggle is off; the
        // engine still updates the set so flipping the
        // toggle on lands with the current selection.
        firingEngine.setPlaySelectedIds(ids);
    };

    /**
     * Build the set of all object ids in the current
     * scene and dispatch it to the editor so the orphan-
     * tag decoration in behaviors.js flags labelled
     * blocks whose ids no longer correspond to any
     * scene object. The decoration is a red wavy
     * underline on the $objectId: tag, reading as a
     * hard error since a labelled block with no matching
     * object fires no pattern.
     *
     * Called after each successful runScene, alongside
     * dispatchSelectedObjectIds. The two id sets are
     * independent: selection tracks the canvas's focus
     * (typically a small subset) and changes on every
     * click, while known ids track the scene's full
     * object set and change only when objects are added,
     * removed, or renamed.
     */
    const dispatchKnownObjectIds = () => {
        /** @type {Set<string>} */
        const ids = new Set();
        if (currentScene !== null) {
            for (const obj of currentScene.sprites) {
                if (typeof obj.id === "string") ids.add(obj.id);
            }
            for (const obj of currentScene.triggers) {
                if (typeof obj.id === "string") ids.add(obj.id);
            }
            for (const obj of currentScene.curves) {
                if (typeof obj.id === "string") ids.add(obj.id);
            }
        }
        editor.setKnownObjectIds(ids);
    };

    /**
     * Candidate name list for jumping to an object's first
     * occurrence in behaviors.js. Per section 28's
     * bidirectional navigation spec, an object's source can
     * appear in any of four forms: a labelled pattern block
     * with the dollar-prefixed tag, or one of three
     * callback-function declarations whose names follow the
     * slotName_objectId convention (hasHit_id, beenHit_id,
     * onTick_id). selectTabAndScrollToFunction walks these
     * candidates and lands on whichever appears earliest in
     * the file, falling back to a plain tab switch when none
     * is present.
     *
     * Both the inspector's Pattern row Go-to button and the
     * canvas object's double-click gesture share this
     * candidate list so the navigation behaviour is
     * consistent regardless of which gesture the user
     * picks.
     *
     * @param {string} objectId
     * @returns {string[]}
     */
    const candidatesForObject = (objectId) => [
        "$" + objectId,
        "hasHit_" + objectId,
        "beenHit_" + objectId,
        "onTick_" + objectId,
    ];

    /**
     * Return true when the given object has at least one
     * labelled pattern block or default-named callback
     * declaration in behaviors.js. Used by the canvas
     * double-click handler to decide between the Code tab
     * (scroll to existing source) and the Properties tab
     * (offer scaffold buttons) as the navigation target.
     *
     * The check is aligned with what candidatesForObject
     * navigates to: the dollar-prefixed labelled tag plus
     * the three slotName_objectId callback names. Custom-
     * renamed callbacks bound via the inspector's slot
     * fields are not consulted here because
     * selectTabAndScrollToFunction wouldn't navigate to
     * them either, so the navigation and the check stay
     * aligned: anything we'd take the user to lives
     * inside behaviors.js, anything else means the
     * Properties tab is the right destination.
     *
     * @param {string} objectId
     * @returns {boolean}
     */
    const objectHasCodeSource = (objectId) => {
        if (currentScene === null) return false;
        if (Array.isArray(currentScene.labelledBlocks)) {
            for (const block of currentScene.labelledBlocks) {
                if (block.objectId === objectId) return true;
            }
        }
        const fmap = currentScene.functionMap;
        if (fmap !== null && typeof fmap === "object") {
            if (("hasHit_" + objectId) in fmap) return true;
            if (("beenHit_" + objectId) in fmap) return true;
            if (("onTick_" + objectId) in fmap) return true;
        }
        return false;
    };

    // --- Undo state for canvas-originated mutations ---
    //
    // Snapshot-based undo: each canvas edit pushes the prior
    // scene.json text onto undoPast before mutating; Cmd-Z
    // pops the most recent snapshot, writes it back, and
    // reruns the scene. The current text moves onto
    // undoFuture so Cmd-Shift-Z can redo. Capped at 50
    // entries; the oldest snapshot drops off the bottom of
    // undoPast when a new edit pushes past the cap. The
    // future stack is cleared on every new edit so an undo
    // followed by a new action discards the previously
    // undone work, matching the standard linear-history
    // model. Inspector edits, toolbar canvas-size edits,
    // and Cmd-Enter pattern-promote edits stay outside the
    // stack: they go through plain applySceneEdit so the
    // stack tracks only object-level direct manipulation
    // (create, drag, delete) — the activities the user
    // most expects to undo.
    /** @type {string[]} */
    const undoPast = [];
    /** @type {string[]} */
    const undoFuture = [];
    const UNDO_CAP = 50;

    /**
     * Apply a mutation to the active score's scene.json,
     * refresh the editor view, and re-run the scene. The
     * mutator runs directly on the parsed scene-data object.
     * If the JSON currently has a parse error (typically
     * because the user is mid-edit in the JSON tab), the edit
     * is skipped with a message rather than silently
     * corrupting the file.
     *
     * Returns true iff the mutation actually applied, so
     * applyCanvasEdit can decide whether to record a
     * snapshot. Existing callers that ignore the result
     * still work because they just `await` the call.
     *
     * @param {(data: any) => void} mutate
     * @returns {Promise<boolean>}
     */
    const applySceneEdit = async (mutate) => {
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) {
            messages.write("No scene.json in this score.", "error");
            return false;
        }
        const parsed = parseScene(sceneFile.content);
        if (!parsed.ok) {
            messages.write(
                `Cannot edit canvas while scene.json has a parse error: ${parsed.error}`,
                "error"
            );
            return false;
        }
        mutate(parsed.data);
        const newText = stringifyScene(parsed.data);
        session.bundle.updateContent("scene.json", newText);
        editor.refreshActiveTabFromBundle();
        await runScene();
        return true;
    };

    /**
     * Apply a canvas-originated mutation and record the
     * pre-edit scene.json text on the undo stack. The
     * snapshot is captured before applySceneEdit runs and
     * only joins undoPast after applySceneEdit reports
     * success, so a no-scene-file or parse-error path
     * leaves the stack untouched. Used by every canvas
     * gesture that mutates the scene (sprite, trigger,
     * and curve creation, drag-end translate, Delete-key
     * remove); inspector edits stay on plain
     * applySceneEdit and therefore aren't undoable.
     *
     * @param {(data: any) => void} mutate
     */
    const applyCanvasEdit = async (mutate) => {
        const sceneFile = session.bundle.getFile("scene.json");
        const snapshot = sceneFile === null ? null : sceneFile.content;
        const ok = await applySceneEdit(mutate);
        if (!ok || snapshot === null) return;
        undoPast.push(snapshot);
        if (undoPast.length > UNDO_CAP) {
            undoPast.shift();
        }
        // Any new edit clears the future stack; previously
        // undone work is no longer reachable via redo once
        // the user has taken a different path forward.
        // Matches the standard linear-history undo model.
        undoFuture.length = 0;
    };

    /**
     * Restore the most recent undo snapshot. Pushes the
     * current scene.json text onto the future stack so
     * performRedo can come back, pops past, writes the
     * popped text into the bundle, refreshes the editor's
     * JSON view, and reruns the scene. Selection survives
     * via setScene's index filter: indexes that still
     * exist stay selected, indexes that no longer do are
     * dropped — the right outcome for undo-of-drag (object
     * still at same index, stays selected) and undo-of-
     * create (the just-created object's index is now out
     * of range, so its selection entry drops). No-op when
     * the past stack is empty.
     */
    const performUndo = async () => {
        if (undoPast.length === 0) return;
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) return;
        const target = undoPast.pop();
        if (target === undefined) return;
        undoFuture.push(sceneFile.content);
        session.bundle.updateContent("scene.json", target);
        editor.refreshActiveTabFromBundle();
        await runScene();
    };

    /**
     * Restore the most recent redo snapshot. Symmetric
     * with performUndo: pushes the current text onto the
     * past stack (capped), pops future, writes, reruns.
     * No-op when the future stack is empty.
     */
    const performRedo = async () => {
        if (undoFuture.length === 0) return;
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) return;
        const target = undoFuture.pop();
        if (target === undefined) return;
        undoPast.push(sceneFile.content);
        if (undoPast.length > UNDO_CAP) {
            undoPast.shift();
        }
        session.bundle.updateContent("scene.json", target);
        editor.refreshActiveTabFromBundle();
        await runScene();
    };

    /**
     * Duplicate every currently selected canvas object.
     * Each duplicate is a deep clone of its source with a
     * fresh id and position offset by plus one in canvas X
     * and minus one in canvas Y (rendering as one unit
     * right and one unit down on screen, since canvas Y
     * is up). cyclePattern carries over from the source
     * so the duplicate fires the same pattern from the
     * moment it appears.
     *
     * When the source has a matching labelled pattern
     * block in behaviors.js, a parallel block is
     * appended for the duplicate using the same
     * expression text and the new id. This means the
     * duplicate appears in the Code tab immediately and
     * a canvas double-click on the duplicate navigates
     * to its own labelled block rather than falling
     * through to the Properties tab as an apparent
     * un-authored object. Sources without a labelled
     * block produce duplicates also without one,
     * mirroring the source's state. The expression is
     * copied verbatim from the source's labelled block
     * (not from the duplicate's cyclePattern field), so
     * variable references and other indirection in the
     * source's block are preserved in the duplicate's
     * block.
     *
     * Newly created duplicates are auto-selected, replacing
     * the source selection. The user can immediately drag
     * the new objects, duplicate them again, or tweak
     * properties in the inspector. No-op when the selection
     * is empty.
     *
     * Undo. The undo stack snapshots only scene.json, so
     * undoing a duplicate reverts the scene-level state
     * (object array, ids, positions) but leaves the
     * appended labelled blocks in behaviors.js. The
     * orphaned blocks reference ids that no longer
     * resolve and surface in the Code tab with the
     * orphan-tag red wavy underline, so the user can
     * see and clean them up if desired.
     *
     * Callback function declarations (hasHit_id,
     * beenHit_id, onTick_id) are not yet duplicated by
     * this commit; a duplicated object that referenced
     * a callback by name still references the same
     * function as the source, so both objects share the
     * callback's behaviour. Renaming and cloning those
     * declarations is a separate change.
     */
    const performDuplicate = async () => {
        const sel = canvas.getSelection();
        const total = sel.sprites.length + sel.triggers.length + sel.curves.length;
        if (total === 0) return;

        // Capture array lengths before the mutation so we
        // can compute the indexes of the newly appended
        // duplicates without re-scanning the scene by id.
        // duplicateSelection always appends to each kind's
        // array, so the new objects land at indexes
        // [oldLen, oldLen + count - 1] for each kind.
        const oldSpriteLen = currentScene !== null ? currentScene.sprites.length : 0;
        const oldTriggerLen = currentScene !== null ? currentScene.triggers.length : 0;
        const oldCurveLen = currentScene !== null ? currentScene.curves.length : 0;

        // Capture each selected source's labelled-block
        // expression text (if any) so we can build matching
        // labelled blocks for the duplicates after the scene
        // mutation lands. Done before applyCanvasEdit so the
        // capture sees the pre-duplicate currentScene; the
        // post-duplicate run wouldn't differ for the
        // sources' blocks (they aren't touched), but reading
        // up front keeps the intent obvious. When a source
        // has multiple labelled blocks (section 28 allows
        // variants), only the first is captured; this
        // matches the loader's first-block-wins resolution
        // and the navigation candidate order in
        // candidatesForObject.
        /** @type {Map<string, string>} */
        const sourceExpressions = new Map();
        if (currentScene !== null && Array.isArray(currentScene.labelledBlocks)) {
            /** @type {Set<string>} */
            const sourceIds = new Set();
            for (const i of sel.sprites) {
                const obj = currentScene.sprites[i];
                if (obj !== undefined && typeof obj.id === "string") sourceIds.add(obj.id);
            }
            for (const i of sel.triggers) {
                const obj = currentScene.triggers[i];
                if (obj !== undefined && typeof obj.id === "string") sourceIds.add(obj.id);
            }
            for (const i of sel.curves) {
                const obj = currentScene.curves[i];
                if (obj !== undefined && typeof obj.id === "string") sourceIds.add(obj.id);
            }
            for (const block of currentScene.labelledBlocks) {
                if (sourceIds.has(block.objectId) &&
                    !sourceExpressions.has(block.objectId)) {
                    sourceExpressions.set(block.objectId, block.expressionText);
                }
            }
        }

        /** @type {Array<{kind: "sprite" | "trigger" | "curve", oldId: string | null, newId: string}>} */
        let mappings = [];
        await applyCanvasEdit((data) => {
            mappings = duplicateSelection(data, sel, 1, -1);
        });
        if (mappings.length === 0) return;

        // For each duplicate whose source had a labelled
        // block, append a parallel block to behaviors.js
        // using the captured source expression text and the
        // duplicate's new id. scaffoldPatternBlock trims
        // trailing whitespace and prepends a blank-line
        // separator on each call, so repeated calls produce
        // a sequence of cleanly-separated blocks at the end
        // of the file. After all appends land, refresh the
        // editor view and re-run the scene so the loader's
        // labelledBlocks list picks up the new blocks; this
        // is what flips objectHasCodeSource to true for the
        // duplicates and makes double-click navigate to the
        // Code tab. Skipped entirely when no source in the
        // selection had a labelled block, so the typical
        // duplicate-a-fresh-object case (no labelled blocks
        // anywhere yet) doesn't pay for behaviors.js parsing
        // or an extra runScene.
        if (sourceExpressions.size > 0) {
            const behaviorsFile = session.bundle.getFile("behaviors.js");
            if (behaviorsFile !== null) {
                let newContent = behaviorsFile.content;
                let changed = false;
                for (const m of mappings) {
                    if (m.oldId === null) continue;
                    const expression = sourceExpressions.get(m.oldId);
                    if (expression === undefined) continue;
                    const result = scaffoldPatternBlock(newContent, m.newId, expression);
                    newContent = result.newContent;
                    changed = true;
                }
                if (changed) {
                    session.bundle.updateContent("behaviors.js", newContent);
                    editor.refreshActiveTabFromBundle();
                    await runScene();
                }
            }
        }

        // Count duplicates per kind from the mappings
        // (rather than from the input selection length) so
        // any source entries that were filtered out by
        // duplicateSelection's range check don't throw off
        // the resulting selection indexes.
        let newSpriteCount = 0;
        let newTriggerCount = 0;
        let newCurveCount = 0;
        for (const m of mappings) {
            if (m.kind === "sprite") newSpriteCount++;
            else if (m.kind === "trigger") newTriggerCount++;
            else if (m.kind === "curve") newCurveCount++;
        }
        /** @type {number[]} */
        const newSprites = [];
        for (let i = 0; i < newSpriteCount; i++) newSprites.push(oldSpriteLen + i);
        /** @type {number[]} */
        const newTriggers = [];
        for (let i = 0; i < newTriggerCount; i++) newTriggers.push(oldTriggerLen + i);
        /** @type {number[]} */
        const newCurves = [];
        for (let i = 0; i < newCurveCount; i++) newCurves.push(oldCurveLen + i);

        canvas.setSelection({
            sprites: newSprites,
            triggers: newTriggers,
            curves: newCurves,
        });
    };

    canvas.setEditCallback(async (edit) => {
        if (edit.kind === "addSprite") {
            await applyCanvasEdit((data) => addSpriteAt(data, edit.x, edit.y));
            // Leave the just-placed sprite selected so the
            // user can immediately edit it — drag, tweak
            // via the inspector, or hit Delete to undo.
            // addSpriteAt appends to the sprites array, so
            // the new sprite is the last entry of the
            // freshly-loaded scene. canvas.setSelection
            // emits selectionChanged, which flows through
            // the normal selection-update path so the
            // inspector and the active-tag highlight
            // follow without any extra wiring here.
            if (currentScene !== null && currentScene.sprites.length > 0) {
                canvas.setSelection({
                    sprites: [currentScene.sprites.length - 1],
                    triggers: [],
                    curves: [],
                });
            }
        } else if (edit.kind === "addTrigger") {
            // Symmetric with addSprite: append a trigger at
            // the click position, then select it so the
            // inspector and active-tag highlight track the
            // newly placed object. addTriggerAt appends so
            // the new trigger is the last entry after the
            // scene reloads.
            await applyCanvasEdit((data) => addTriggerAt(data, edit.x, edit.y));
            if (currentScene !== null && currentScene.triggers.length > 0) {
                canvas.setSelection({
                    sprites: [],
                    triggers: [currentScene.triggers.length - 1],
                    curves: [],
                });
            }
        } else if (edit.kind === "addCurve") {
            // Curve creation carries a full shape sub-object
            // produced by the canvas's drag-to-define-
            // ellipse gesture (or in principle any future
            // shape-creating tool that emits this edit
            // kind). addCurveAt rounds coordinates and
            // appends, so the new curve is the last entry
            // after the scene reloads.
            await applyCanvasEdit((data) => addCurveAt(data, edit.shape));
            if (currentScene !== null && currentScene.curves.length > 0) {
                canvas.setSelection({
                    sprites: [],
                    triggers: [],
                    curves: [currentScene.curves.length - 1],
                });
            }
        } else if (edit.kind === "translateSelection") {
            // Canvas drag-end emits the same edit shape
            // the inspector emits when its Position field
            // is committed, so both paths converge on the
            // same sceneEditor primitive. The selection
            // travels with the edit (snapshot taken at
            // drag start) so a partial-redraw race can't
            // lose objects from the translation. The
            // canvas path goes through applyCanvasEdit so
            // the drag is undoable; the inspector path
            // uses plain applySceneEdit and is not
            // undoable.
            await applyCanvasEdit((data) =>
                translateSelection(data, edit.selection, edit.dx, edit.dy),
            );
        } else if (edit.kind === "scaleSelection") {
            // Canvas resize-handle gesture commit. Routed
            // through applyCanvasEdit so the resize lands
            // on the undo stack the same way translate
            // does. The mutator handles sprite/trigger
            // position transforms (keeping their size
            // fields untouched) and curve geometry
            // scaling in one pass; see sceneEditor's
            // scaleSelectionAroundAnchor for the per-kind
            // semantics.
            await applyCanvasEdit((data) =>
                scaleSelectionAroundAnchor(
                    data,
                    edit.selection,
                    edit.ax,
                    edit.ay,
                    edit.sx,
                    edit.sy,
                ),
            );
        } else if (edit.kind === "selectionChanged") {
            // Forward selection changes to the property
            // inspector so the form updates its greying and
            // its title to reflect what's selected. The
            // inspector goes blank when all three arrays are
            // empty, matching GeoSonix's empty-selection
            // convention.
            if (editor.inspector) {
                editor.inspector.setSelection({
                    sprites: edit.sprites,
                    triggers: edit.triggers,
                    curves: edit.curves,
                });
            }
            // Stage A5: drive the Code tab's active-tag
            // highlight from the same selection. Labelled
            // blocks whose dollar-prefixed labels match
            // one of the selected object ids render in
            // accent green; everything else stays pink.
            dispatchSelectedObjectIds({
                sprites: edit.sprites,
                triggers: edit.triggers,
                curves: edit.curves,
            });
        } else if (edit.kind === "openObjectInCode") {
            // Canvas double-click on an object. When the
            // object has at least one labelled pattern
            // block or default-named callback declaration
            // in behaviors.js, switch to the Code tab and
            // scroll to whichever appears earliest in the
            // file. When neither exists (the user has not
            // yet authored a pattern or callback for the
            // object), switch to the Properties tab
            // instead so the inspector's Band 1 pattern
            // row Create and Band 3 callback Create
            // buttons are immediately available as the
            // natural next step.
            if (objectHasCodeSource(edit.objectId)) {
                editor.selectTabAndScrollToFunction(
                    "behaviors.js",
                    candidatesForObject(edit.objectId),
                );
            } else {
                editor.selectInspectorTab();
            }
        } else if (edit.kind === "toggleTransport") {
            // Canvas double-click on empty background.
            // Toggle the transport play state — starts if
            // stopped, stops if playing. A convenient
            // gesture for testing patterns without leaving
            // the canvas to find the Play button. The
            // Spacebar and Ctrl-Period keyboard shortcuts
            // (wired below) share this same toggle.
            //
            // Gated on the strudel runtime being fully
            // loaded. Without the gate, a user whose first
            // interaction is a canvas double-click would
            // see the engine load AND playback start in
            // the same instant — the auto-trigger handler
            // and this toggle handler both fire from the
            // same event. With the gate, the first
            // double-click only loads the engine; once
            // "loaded", subsequent double-clicks toggle
            // normally. Same gate applies to the Spacebar
            // and Ctrl-Period handlers below.
            if (strudelRuntime.status !== "loaded") return;
            transport.toggle();
        }
    });

    // --- Transport bar edit callback ---
    //
    // The BPM input commit fires here. The view has already
    // called transport.setBpm for immediate UI feedback;
    // this path persists the value into scene.json so
    // subsequent inspector edits don't trigger an
    // applySceneParamsToTransport that reverts the user's
    // typed BPM. Wired alongside the canvas and inspector
    // edit callbacks because applySceneEdit must be in
    // scope when the callback fires — it is, since user
    // input only happens after main() finishes wiring.
    transportBarView.setEditCallback(async (edit) => {
        if (edit.kind === "setBpm") {
            await applySceneEdit((data) =>
                setSceneBpm(data, edit.value),
            );
        }
    });

    // --- Inspector edit callback ---
    //
    // The inspector emits edits when the user toggles Mute or
    // Hide or commits a Name change. Each edit carries a kind
    // tag, the new value, and the current selection at the
    // moment of the click. We translate the edit into the
    // matching scene.json mutation and route it through
    // applySceneEdit — the same pipeline the canvas toolbar
    // uses — so inspector edits and canvas edits share the
    // dirty-marking and re-run mechanics without either
    // knowing about the other. Persistence is explicit; the
    // user decides when to save via Cmd-S.
    if (editor.inspector) {
        editor.inspector.setEditCallback(async (edit) => {
            if (edit.kind === "setMute") {
                await applySceneEdit((data) =>
                    setMuteOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setHide") {
                await applySceneEdit((data) =>
                    setHideOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setName") {
                await applySceneEdit((data) =>
                    setNameOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "translateSelection") {
                await applySceneEdit((data) =>
                    translateSelection(data, edit.selection, edit.dx, edit.dy),
                );
            } else if (edit.kind === "scaleCurveAxis") {
                await applySceneEdit((data) =>
                    scaleCurveAxis(data, edit.selection, edit.axis, edit.factor),
                );
            } else if (edit.kind === "setPositionAxis") {
                await applySceneEdit((data) =>
                    setPositionAxisOnSelection(data, edit.selection, edit.axis, edit.value),
                );
            } else if (edit.kind === "setSizeAxis") {
                await applySceneEdit((data) =>
                    setSizeAxisOnSelection(data, edit.selection, edit.axis, edit.value),
                );
            } else if (edit.kind === "setSpriteSize") {
                await applySceneEdit((data) =>
                    setSpriteDisplayDiameterOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setVelocityAxis") {
                // Starting State row's vX and vY fields.
                // setVelocityAxisOnSelection applies to both
                // sprites and curves; triggers in a mixed
                // selection are silently skipped since they
                // don't move under physics.
                await applySceneEdit((data) =>
                    setVelocityAxisOnSelection(data, edit.selection, edit.axis, edit.value),
                );
            } else if (edit.kind === "setTriggerSize") {
                await applySceneEdit((data) =>
                    setTriggerSizeOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCursorR") {
                await applySceneEdit((data) =>
                    setCursorROnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCursorL") {
                await applySceneEdit((data) =>
                    setCursorLOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCurveThickness") {
                await applySceneEdit((data) =>
                    setCurveThicknessOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCursorThickness") {
                await applySceneEdit((data) =>
                    setCursorThicknessOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setColor") {
                await applySceneEdit((data) =>
                    setColorOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setBeatsPerCycle") {
                await applySceneEdit((data) =>
                    setBeatsPerCycleOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setBeatInterval") {
                await applySceneEdit((data) =>
                    setBeatIntervalOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setPatternRepeats") {
                await applySceneEdit((data) =>
                    setPatternRepeatsOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCycleSpeeds") {
                await applySceneEdit((data) =>
                    setCycleSpeedsOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCanHit") {
                await applySceneEdit((data) =>
                    setCanHitOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setHasHitFunction") {
                await applySceneEdit((data) =>
                    setHasHitFunctionOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCanBeHit") {
                await applySceneEdit((data) =>
                    setCanBeHitOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setBeenHitFunction") {
                await applySceneEdit((data) =>
                    setBeenHitFunctionOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCanTick") {
                await applySceneEdit((data) =>
                    setCanTickOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setOnTickFunction") {
                await applySceneEdit((data) =>
                    setOnTickFunctionOnSelection(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "createFunctionStub") {
                // Band 3 Create button. Three steps:
                //   1. Scaffold a stub declaration in
                //      behaviors.js (no-op if a function
                //      with the proposed name already
                //      exists at the top level).
                //   2. Bind the slot's function-name field
                //      on the selected object via the
                //      matching mutator. applySceneEdit
                //      runs save + rebuild, so the new
                //      function ends up in functionMap on
                //      the next render of the inspector.
                //   3. Switch the editor to behaviors.js
                //      and scroll the new declaration to
                //      the top, so the composer can start
                //      filling in the body immediately.
                const behaviorsFile = session.bundle.getFile("behaviors.js");
                if (behaviorsFile === null) {
                    messages.write("No behaviors.js in this score.", "error");
                    return;
                }
                const { newContent, alreadyExists } = scaffoldCallbackSlotFunction(
                    behaviorsFile.content,
                    edit.proposedName,
                    edit.slotKey,
                );
                if (!alreadyExists) {
                    session.bundle.updateContent("behaviors.js", newContent);
                }
                /** @type {Record<string, (d: any, s: any, v: string) => void>} */
                const setterByKind = {
                    "hasHit": setHasHitFunctionOnSelection,
                    "beenHit": setBeenHitFunctionOnSelection,
                    "onTick": setOnTickFunctionOnSelection,
                };
                const setter = setterByKind[edit.slotKey];
                if (typeof setter === "function") {
                    await applySceneEdit((data) =>
                        setter(data, edit.selection, edit.proposedName),
                    );
                }
                editor.selectTabAndScrollToFunction("behaviors.js", edit.proposedName);
            } else if (edit.kind === "goToFunction") {
                editor.selectTabAndScrollToFunction("behaviors.js", edit.functionName);
            } else if (edit.kind === "createPatternBlock") {
                // Band 1 pattern row Create button. Append
                // a $id: <expression> block at the end of
                // behaviors.js, refresh the editor view,
                // run the scene (so the loader picks up
                // the new labelledBlocks entry), then
                // switch to behaviors.js and scroll to the
                // new block so the user can fill in or
                // edit the pattern expression.
                //
                // Default expression. If the selected
                // object already has a cyclePattern set
                // (typical for a duplicate, which inherits
                // its source's cyclePattern, or for any
                // path that populated the field without
                // scaffolding a labelled block), pass
                // that value to scaffoldPatternBlock as
                // the default so the scaffolded block
                // matches what is already playing. With
                // an empty cyclePattern the function
                // falls back to its built-in bd-sn
                // starter.
                const behaviorsFile = session.bundle.getFile("behaviors.js");
                if (behaviorsFile === null) {
                    messages.write("No behaviors.js in this score.", "error");
                    return;
                }
                let defaultExpression = "";
                if (currentScene !== null) {
                    const allObjects = [
                        ...currentScene.sprites,
                        ...currentScene.triggers,
                        ...currentScene.curves,
                    ];
                    for (const obj of allObjects) {
                        if (obj.id === edit.objectId &&
                            typeof obj.cyclePattern === "string") {
                            defaultExpression = obj.cyclePattern;
                            break;
                        }
                    }
                }
                const { newContent } = scaffoldPatternBlock(
                    behaviorsFile.content,
                    edit.objectId,
                    defaultExpression,
                );
                session.bundle.updateContent("behaviors.js", newContent);
                editor.refreshActiveTabFromBundle();
                await runScene();
                editor.selectTabAndScrollToFunction("behaviors.js", "$" + edit.objectId);
            } else if (edit.kind === "goToObjectInCode") {
                // Band 1 pattern row Go-to button. Per section
                // 28's bidirectional navigation spec, the
                // Go-to gesture targets the object's first
                // occurrence in behaviors.js regardless of
                // which form it takes — labelled block tag
                // or any of the three callback-function name
                // declarations. Pass the full candidate list
                // so selectTabAndScrollToFunction's earliest-
                // match logic picks whichever appears first.
                // The Pattern row only surfaces Go-to when a
                // labelled block exists, so the dollar-
                // prefixed tag is always present in the file;
                // the callback candidates let an earlier
                // callback declaration win when the file is
                // ordered that way.
                editor.selectTabAndScrollToFunction(
                    "behaviors.js",
                    candidatesForObject(edit.objectId),
                );
            }
        });
    }

    // --- Cmd-Enter promote-pattern handler ---
    //
    // Stage A4 of the section-28 pattern-authoring
    // sequence. The editor's _tryPromoteLabelledBlock
    // detects whether the Cmd-Enter cursor sits inside a
    // top-level $objectId: expression block in
    // behaviors.js; if so it calls the onPromotePattern
    // callback wired to handlePromotePattern below. The
    // handler parses the expression, logs the result to
    // the messages console, and on parse success writes
    // the body text to the matched object's cyclePattern
    // field via setCyclePatternOnSelection plus the
    // standard applySceneEdit pipeline (parse, mutate,
    // stringify, refresh editor, runScene).
    //
    // On parse failure the handler logs the diagnostic
    // and returns without propagating; the Cmd-Enter has
    // already been consumed by the editor, so no Run
    // Scene falls through. On an object-not-found case
    // (the labelled block's tag references an id that no
    // longer exists in scene.json) the handler likewise
    // logs and returns.
    handlePromotePattern = async (objectIds, expressionBody) => {
        const parseResult = parsePatternToPositions(expressionBody);
        const line = formatParseResultForConsole(expressionBody, parseResult);
        messages.write(line, parseResult.ok ? "info" : "error");
        if (!parseResult.ok) return;

        // Look up each objectId in the current scene.json
        // arrays to determine its kind and index, then build
        // a combined selection for setCyclePatternOnSelection.
        // Chained labelled blocks share one expression across
        // multiple objects (section 9), so a Cmd-Enter on a
        // chain promotes the same expressionBody to every
        // object whose id is on the chain in one
        // applySceneEdit. Single-label blocks fold in as a
        // chain of length one. Ids that don't resolve to any
        // object in scene.json (e.g. the chain carries an
        // orphan label whose object was deleted) are logged
        // as errors but do not abort the operation; the
        // remaining resolved ids still get the promotion.
        // Parsing scene.json here is independent of
        // applySceneEdit's own parse a few lines down; the
        // duplication is cheap (the file is small) and keeps
        // the not-found case observable before the edit
        // pipeline runs.
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) {
            messages.write("No scene.json in this score.", "error");
            return;
        }
        const parsed = parseScene(sceneFile.content);
        if (!parsed.ok) {
            messages.write(
                `Cannot promote pattern while scene.json has a parse error: ${parsed.error}`,
                "error",
            );
            return;
        }

        /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
        const selection = { sprites: [], triggers: [], curves: [] };
        let foundAny = false;
        for (const objectId of objectIds) {
            /** @type {"sprites" | "triggers" | "curves" | null} */
            let foundKind = null;
            let foundIndex = -1;
            for (const kind of /** @type {const} */ (["sprites", "triggers", "curves"])) {
                const arr = parsed.data[kind];
                if (!Array.isArray(arr)) continue;
                for (let i = 0; i < arr.length; i++) {
                    const entry = arr[i];
                    if (entry !== null &&
                        typeof entry === "object" &&
                        !Array.isArray(entry) &&
                        entry.id === objectId) {
                        foundKind = kind;
                        foundIndex = i;
                        break;
                    }
                }
                if (foundKind !== null) break;
            }
            if (foundKind === null) {
                messages.write(
                    `Pattern promote: no object with id ${objectId} in scene.json.`,
                    "error",
                );
                continue;
            }
            selection[foundKind].push(foundIndex);
            foundAny = true;
        }
        if (!foundAny) return;

        await applySceneEdit((data) =>
            setCyclePatternOnSelection(data, selection, expressionBody),
        );
    };

    // --- Cmd-Enter clear-pattern handlers ---
    //
    // Emitted by editor.js's _tryPromoteLabelledBlock when
    // the cursor sits inside a commented-out labelled
    // block of the form `// $id: ...`. The user's gesture
    // "comment out a labelled block and Cmd-Enter" is the
    // textual mirror of the inspector's Mute checkbox plus
    // a true clear: scene.json's cyclePattern for the
    // matching object is set to the empty string. Three
    // pieces of design work this hooks into.
    //
    // scene.json stays the source of truth. The Code
    // editor is a working surface whose Cmd-Enter actions
    // explicitly commit intent to scene.json; this keeps
    // scene.json AI-editable independently of behaviors.js.
    //
    // Edge case for same-id duplicates. A user may have
    // multiple labelled blocks for the same id in
    // behaviors.js as pattern variants. Clearing on a
    // commented one would silently drop the pattern even
    // if a live one elsewhere still defines it. The editor
    // detects this and emits onClearPatternBlocked instead
    // of onClearPattern in that case, carrying the blocking
    // block's 1-based line number so the user can see
    // exactly which other block is preserving the pattern.
    //
    // Firing engine handoff. setCyclePatternOnSelection
    // with the empty string triggers the firing engine's
    // patternDirty path on the next runScene: current-
    // cycle events finish playing, future-cycle events are
    // dropped, and subsequent cycles produce no events
    // because the empty pattern compiles to null and the
    // tick loop skips null-compiled sources. The source
    // falls silent at the next cycle boundary with no
    // audible gap, matching the same Version B clean-
    // takeover behaviour pattern edits use.

    handleClearPattern = async (objectId) => {
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) {
            messages.write("No scene.json in this score.", "error");
            return;
        }
        const parsed = parseScene(sceneFile.content);
        if (!parsed.ok) {
            messages.write(
                `Cannot clear pattern while scene.json has a parse error: ${parsed.error}`,
                "error",
            );
            return;
        }
        // Locate the object by id across the three arrays;
        // same lookup shape handlePromotePattern uses so
        // a not-found case surfaces the same way for both
        // gestures.
        /** @type {"sprites" | "triggers" | "curves" | null} */
        let foundKind = null;
        let foundIndex = -1;
        for (const kind of /** @type {const} */ (["sprites", "triggers", "curves"])) {
            const arr = parsed.data[kind];
            if (!Array.isArray(arr)) continue;
            for (let i = 0; i < arr.length; i++) {
                const entry = arr[i];
                if (entry !== null &&
                    typeof entry === "object" &&
                    !Array.isArray(entry) &&
                    entry.id === objectId) {
                    foundKind = kind;
                    foundIndex = i;
                    break;
                }
            }
            if (foundKind !== null) break;
        }
        if (foundKind === null) {
            messages.write(
                `Pattern clear: no object with id ${objectId} in scene.json.`,
                "error",
            );
            return;
        }
        /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
        const selection = { sprites: [], triggers: [], curves: [] };
        selection[foundKind].push(foundIndex);

        await applySceneEdit((data) =>
            setCyclePatternOnSelection(data, selection, ""),
        );
        messages.write("Pattern cleared for $" + objectId + ".");
    };

    handleClearPatternBlocked = (objectId, blockingLine) => {
        // The clearing intent didn't reach scene.json
        // because another live labelled block is still
        // defining the same id. Report the situation and
        // point the user at the still-active version's
        // line number; they decide whether to comment THAT
        // block out as well (which makes a subsequent
        // Cmd-Enter on any of the commented blocks for
        // this id clear the pattern) or just leave the
        // live one as the active definition.
        messages.write(
            "Pattern $" + objectId + " not cleared: an active block at line " + blockingLine + " is still defining it.",
        );
    };

    // Escape disarms the active tool. Listening at the window
    // level means it works regardless of whether the canvas,
    // editor, or empty body has focus.
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && toolbar.getState().tool !== null) {
            toolbar.setActive(null, false);
        }
    });

    // Transport play/pause shortcuts. Two keyboard shortcuts
    // plus the canvas-background double-click gesture (handled
    // above via the toggleTransport edit) all collapse to the
    // same toggle: start if stopped, stop if playing.
    //
    // Spacebar follows the universal music-app convention.
    // Active globally EXCEPT when focus is in a text-input
    // context (CodeMirror editor, input/textarea element, or
    // contenteditable region) so typing into the Code tab
    // still inserts space characters naturally. The text-
    // context check mirrors the Delete-key handler below.
    //
    // Cmd-Period is the always-active alternative. Works
    // everywhere including inside the Code tab and Properties
    // JSON tab, so the user can toggle playback without
    // leaving the editor. Cmd is the natural modifier for an
    // audio app on macOS (matches the convention in Logic,
    // GarageBand, and most others); the historical Cmd-Period
    // = cancel macOS convention is not strong enough in
    // modern macOS to interfere with deliberate bindings.
    // Cmd-Space and Ctrl-Space were both considered and
    // rejected (Cmd-Space is Spotlight, Ctrl-Space is the
    // conventional autocomplete trigger in CodeMirror /
    // strudel and we expect to add autocomplete to the Code
    // tab eventually).
    window.addEventListener("keydown", (e) => {
        const isCmdPeriod = e.metaKey && !e.ctrlKey && !e.altKey && e.key === ".";
        if (isCmdPeriod) {
            e.preventDefault();
            // Gated on engine being fully loaded; see
            // the toggleTransport edit handler above for
            // the rationale (first user gesture that
            // loads the engine shouldn't also start
            // playback).
            if (strudelRuntime.status !== "loaded") return;
            transport.toggle();
            return;
        }
        if (e.key === " " || e.code === "Space") {
            // Skip text-input contexts so Space still types
            // a space character there. The check matches
            // CodeMirror editors, plain inputs, textareas,
            // and contenteditable regions; everywhere else
            // (canvas, inspector buttons, menu bar, message
            // area, body itself), Space toggles transport.
            const target = e.target;
            if (target instanceof HTMLElement) {
                if (target.closest(".cm-editor") !== null) return;
                if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
                if (target.isContentEditable) return;
            }
            // Prevent the default space-scrolls-page behaviour
            // and the spurious activate-focused-button click
            // that some browsers fire on Space.
            e.preventDefault();
            // Same engine-loaded gate as the Cmd-Period
            // and dblclick paths.
            if (strudelRuntime.status !== "loaded") return;
            transport.toggle();
        }
    });

    // Delete and Backspace remove the selected canvas objects.
    // Listening at the window level means it works regardless
    // of whether the canvas or the body has focus, but text-
    // editor focus contexts are skipped so typing in the
    // CodeMirror tab or any text input still does the obvious
    // thing. preventDefault is only called when there's
    // actually a selection to remove, so an idle Backspace
    // doesn't accidentally swallow browser default behaviour.
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        const target = e.target;
        if (target instanceof HTMLElement) {
            if (target.closest(".cm-editor") !== null) return;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
            if (target.isContentEditable) return;
        }
        const sel = canvas.getSelection();
        const total = sel.sprites.length + sel.triggers.length + sel.curves.length;
        if (total === 0) return;
        e.preventDefault();
        // Clear the canvas's selection up front — the indexes
        // are about to refer to objects that no longer exist,
        // and removeObjects renumbers the remaining entries
        // so any stale index would point at the wrong thing.
        canvas.setSelection({ sprites: [], triggers: [], curves: [] });
        void applyCanvasEdit((data) => removeObjects(data, sel));
    });

    // --- Menus ---
    //
    // Focus Canvas collapses the editor pane, the body
    // divider, the message divider, and the message area
    // together so the canvas fills as much of the window
    // as possible — useful for image-driven composition
    // where every pixel of canvas helps. Three entry
    // points share one closure: the Focus Canvas button at
    // the far left of the canvas-toolbar, the View menu's
    // Focus Canvas item, and Cmd-Shift-F. The closure
    // persists the new state to localStorage so the choice
    // survives reloads, asks the toolbar to refresh its
    // button visual, and schedules a canvas redraw because
    // the canvas pane's container is resizing.
    const toggleFocusCanvas = () => {
        document.body.classList.toggle("focus-canvas");
        const active = document.body.classList.contains("focus-canvas");
        try {
            localStorage.setItem(
                "gxw.layout.focusCanvas",
                active ? "true" : "false",
            );
        } catch (e) {
            // Persistence failures don't block the in-memory
            // toggle; the user just won't get the choice
            // back on next reload.
        }
        toolbar.setFocusCanvasActive(active);
        canvas.scheduleDraw();
    };

    // Wire the toolbar's Focus Canvas button to the same
    // closure the View menu's Focus Canvas item and the
    // Cmd-Shift-F native menu accelerator use, so all three
    // entry points share one piece of state. The toolbar
    // owns the button; main.js's role is just to hand it
    // the closure and push the initial state so the button
    // visual reflects whatever the user had before reload.
    toolbar.onFocusCanvasClick(toggleFocusCanvas);
    toolbar.setFocusCanvasActive(document.body.classList.contains("focus-canvas"));

    // Auto Zoom toggle. When active, the View menu's Zoom
    // In/Out/Reset items grey out and the canvas
    // continuously fits the playable region (canvasW ×
    // canvasH centred on the origin) inside the pane with
    // AUTO_ZOOM_MARGIN_PX of slack on each side. The state
    // persists across page reloads via localStorage,
    // matching the Focus Canvas pattern. Persistence
    // failures are non-fatal: the toggle still works in
    // memory; the user just won't get the choice back on
    // the next reload. There is no keyboard shortcut for
    // Auto Zoom by design — it's a mode switch the user
    // sets occasionally rather than a per-action gesture.
    const toggleAutoZoom = () => {
        const newState = !canvas.getAutoZoom();
        canvas.setAutoZoom(newState);
        try {
            localStorage.setItem(
                "gxw.layout.autoZoom",
                newState ? "true" : "false",
            );
        } catch (e) {
            // Persistence failed; the in-memory toggle
            // still took effect.
        }
        // Push to the native menu so the Auto Zoom
        // checkmark and the disabled state of Zoom
        // In/Out/Reset track the new value.
        pushMenuState({ autoZoom: newState });
    };

    // Restore the user's last Auto Zoom state. Done after
    // the canvas is constructed and the initial _onResize
    // has set cssWidth / cssHeight, but before the first
    // runScene below populates a scene — setScene will
    // re-run the fit against the loaded scene's canvasW /
    // canvasH, so the canvas paints already at the fitted
    // zoom rather than briefly at zoom 1 and then snapping.
    try {
        if (localStorage.getItem("gxw.layout.autoZoom") === "true") {
            canvas.setAutoZoom(true);
        }
    } catch (e) {
        // localStorage unavailable; default to Auto Zoom off.
    }

    // In-page menu installation. The web build relies on
    // these dropdowns and their window-level keyboard
    // shortcuts; the Electron build's native macOS menu
    // (electron-menu.js) replaces both surfaces in sub-
    // commit 5c, so the in-page installers are skipped
    // when running under Electron to avoid double-firing
    // accelerators and ghost dropdowns no one can see.
    if (!isElectron) {
        installViewMenu({
            canvas,
            toggleFocusCanvas,
            toggleAutoZoom,
        });
        installFileMenu({ session, messages, imageImporter, editor, isElectron });
        installEditMenu({ performUndo, performRedo, performDuplicate });
        installRunMenu({ runScene });
        installAppMenu({ diskMirror, messages });
    }

    // --- Native menu (Stage 5 commit 5a) ---
    //
    // Install the IPC dispatcher that routes native macOS
    // menu clicks to the same action functions the in-page
    // menu uses, then push the current state so the native
    // menu's disabled / checked flags reflect reality on
    // first paint. installMenuActions is a no-op on the web
    // build (no window.gxwMenu bridge), so this section is
    // Electron-effective only — the web build's in-page
    // menu continues to be the only menu surface.
    installMenuActions({
        session,
        messages,
        editor,
        imageImporter,
        canvas,
        diskMirror,
        performUndo,
        performRedo,
        performDuplicate,
        runScene: () => { void runScene(); },
        toggleFocusCanvas,
        toggleAutoZoom,
    });
    pushMenuState({
        dirty: session.bundle.dirty,
        isUntitled: session.bundle.path === null,
        autoZoom: canvas.getAutoZoom(),
    });
    // Push initial Open Recent and Revert to submenu data,
    // and subscribe to future changes in the recent-scores
    // list so the submenu rebuilds whenever the user opens
    // a new score, deletes one, renames one, or clears the
    // menu. Backups are refreshed in switchToBundle and in
    // the afterSaveScore subscriber, not subscribed to
    // independently, because every event that changes the
    // backups list happens at one of those two points.
    pushRecentScoresToMenu(session.bundle.path);
    void pushBackupsToMenu(session.bundle.path);
    subscribeToRecentScores(() => {
        pushRecentScoresToMenu(session.bundle.path);
    });

    // --- Save and Save As shortcuts (Cmd-S, Cmd-Shift-S) ---
    //
    // Web-build only. The Electron build's native menu has
    // its own accelerators on Save and Save As, and binding
    // a window-level listener for the same keys would
    // double-fire the action on every press.
    if (!isElectron) {
        window.addEventListener("keydown", (e) => {
            const meta = e.metaKey || e.ctrlKey;
            if (meta && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (e.shiftKey) {
                    void actionSaveAs({ session, messages, editor });
                } else if (session.bundle.path === null) {
                    // Untitled bundle: route Cmd-S through Save As
                    // so the user gets the Save panel and the
                    // bundle acquires a real path before being
                    // persisted. Bundle.save() throws on a null
                    // path, so calling editor.save() here directly
                    // would surface as an error instead.
                    void actionSaveAs({ session, messages, editor });
                } else {
                    editor.save();
                }
            }
        });
    }

    // --- Protect unsaved changes on close ---
    //
    // Two paths converge here. In the web build, beforeunload
    // fires when the user closes the tab, navigates away, or
    // reloads; the only thing we can do is return a non-empty
    // string, which makes the browser show its generic Leave
    // / Stay confirmation. The custom three-button dialog is
    // unreachable from beforeunload because the event is
    // synchronous and the dialog renders asynchronously. In-
    // app switch-away gestures (New, Open, Duplicate, Import,
    // Reload from Disk) use the custom dialog through the
    // scoreActions guard.
    //
    // In the Electron build, beforeunload is skipped entirely:
    // the main process's window-close interceptor runs first,
    // sends gxw:close-requested to the renderer, and the
    // renderer (in the onCloseRequested handler below) shows
    // the same three-button dialog the in-app gestures use.
    // Decision flows back to main via sendCloseDecision; main
    // either calls close() again (which now bypasses the
    // interceptor) or does nothing.
    window.addEventListener("beforeunload", (e) => {
        if (isElectron) return;
        if (session.bundle.dirty) {
            e.preventDefault();
            e.returnValue = "";
            return "";
        }
    });

    if (isElectron) {
        const gxwWindow = /** @type {any} */ (window).gxwWindow;
        if (gxwWindow !== undefined &&
            typeof gxwWindow.onCloseRequested === "function") {
            gxwWindow.onCloseRequested(async () => {
                if (!session.bundle.dirty) {
                    gxwWindow.sendCloseDecision("proceed");
                    return;
                }
                const decision = await confirmDiscardDialog({
                    scoreName: session.bundle.name,
                });
                if (decision === "cancel") {
                    gxwWindow.sendCloseDecision("cancel");
                    return;
                }
                if (decision === "save") {
                    if (session.bundle.path === null) {
                        // Untitled bundle on close: bring up
                        // Save As so the user can give it a
                        // path before the window closes. If
                        // they cancel the Save panel, cancel
                        // the close as well rather than
                        // silently dropping their work.
                        await actionSaveAs({ session, messages, editor });
                        if (session.bundle.path === null) {
                            gxwWindow.sendCloseDecision("cancel");
                            return;
                        }
                    } else {
                        try {
                            await editor.save();
                        } catch (err) {
                            // If the save threw, the bundle is
                            // still dirty; bail out of the close
                            // rather than silently dropping the
                            // user's work. They'll see whatever
                            // error message the save path
                            // already surfaced.
                            gxwWindow.sendCloseDecision("cancel");
                            return;
                        }
                    }
                }
                gxwWindow.sendCloseDecision("proceed");
            });
        }
    }

    // --- Initial auto-run so the canvas shows something ---
    //
    // Skipped in norun mode (see the bundle resolution
    // above). With a fresh empty bundle in hand there's
    // nothing dangerous to run, but skipping the initial
    // run is still useful to keep the message area clean
    // and surface the recovery banner instead.
    if (norunMode) {
        messages.write(
            "Recovery mode active (norun). A fresh empty bundle has been created. " +
            "Use the File menu to open a different score, or fix the broken one " +
            "by switching to it and editing scene.json or behaviors.js by hand. " +
            "Reload without the norun query parameter once the issue is resolved.",
            "info",
        );
    } else {
        await runScene();
    }

    // --- First-run web-storage explainer ---
    //
    // Web only: explains the IndexedDB durability tradeoff
    // and points the user at File > Export Score and the
    // desktop app for work that matters. Gated on a
    // localStorage key so it only appears once per browser.
    // Fires fire-and-forget after runScene so the canvas has
    // a chance to paint before the dialog overlays it; the
    // openDialog backdrop is transparent enough that the
    // running scene stays visible behind the modal.
    if (!isElectron) {
        try {
            if (localStorage.getItem("gxw.firstRun.dismissed") === null) {
                showFirstRunDialog();
            }
        } catch (e) {
            // localStorage unavailable (private-mode, quota).
            // Skip the dialog; the user just won't see it.
        }
    }
}

/**
 * Wire the MIDI indicator in the transport bar to the
 * MIDISender's event stream. The indicator shows the chosen
 * port name once init completes and flashes a CSS class on
 * each note sent so the user can see audio is actually
 * going out the port.
 *
 * The flash is brief (a CSS transition removes it shortly
 * after the class is added). Because notes can fire in
 * rapid succession on short patterns, the indicator schedules
 * the flash-off through a single deferred timer that resets
 * on every send; multiple sends in a row produce a single
 * extended flash rather than rapid on-off flicker.
 *
 * @param {MIDISender} midiSender
 */
function wireMidiIndicator(midiSender) {
    const el = document.getElementById("midi-indicator");
    if (!(el instanceof HTMLElement)) return;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let flashTimeout = null;
    midiSender.onEvent((event) => {
        if (event.type === "ready") {
            const portName = event.portName ?? "(unknown)";
            el.textContent = `MIDI: ${portName}`;
            el.classList.add("midi-indicator-active");
        } else if (event.type === "send") {
            el.classList.add("midi-indicator-flash");
            if (flashTimeout !== null) clearTimeout(flashTimeout);
            flashTimeout = setTimeout(() => {
                el.classList.remove("midi-indicator-flash");
                flashTimeout = null;
            }, 80);
        }
    });
}

/**
 * Apply scene-declared bpm to the Transport if the sketch
 * set one. v2.3 removes score-level time signature; per-curve
 * beatsPerBar + beatInterval express it instead, so the
 * transport's time signature stays at its initial null state.
 * @param {import("./src/scene.js").Scene} scene
 * @param {import("./src/transport.js").Transport} transport
 */
function applySceneParamsToTransport(scene, transport) {
    transport.setBpm(scene.bpm, "sketch");
}

/**
 * Figure out which score to open on startup.
 * @returns {Promise<Bundle>}
 */
async function resolveInitialBundle() {
    try {
        const currentPath = await getCurrentScorePath();
        if (currentPath !== null) {
            const bundle = await loadScoreByPath(currentPath);
            if (bundle !== null) return bundle;
        }

        const scores = await listAvailableScores();
        if (scores.length > 0) {
            const bundle = await loadScoreByPath(scores[0].path);
            if (bundle !== null && bundle.path !== null) {
                await setCurrentScorePath(bundle.path);
                return bundle;
            }
        }
    } catch (err) {
        console.error("GXW: could not resolve initial bundle:", err);
    }

    const bundle = await createNewScore("Untitled");
    if (bundle.path !== null) {
        await setCurrentScorePath(bundle.path);
    }
    return bundle;
}

/**
 * Rename the current score to a new name. Under the disk
 * backend this is a single atomic folder rename via
 * renameScoreRecord, which preserves the score's .backups
 * subfolder; under the IDB backend the public renameScore
 * Record falls back to load + save + delete. The bundle's
 * path and name are updated in place and a subsequent save
 * (if the bundle is dirty) lands at the new path.
 *
 * @param {any} session
 * @param {string} newName
 */
async function renameCurrentScoreTo(session, newName) {
    if (newName === session.bundle.name) return;
    const existing = await listAvailableScores();
    if (existing.some((s) => s.name === newName)) {
        throw new Error(`A score named "${newName}" already exists.`);
    }
    const oldPath = session.bundle.path;
    if (oldPath === null) {
        throw new Error(
            "Cannot rename an untitled bundle; use Save As to give it a path first."
        );
    }
    const newPath = joinScorePath(dirname(oldPath), newName);
    await renameScoreRecord(oldPath, newPath);
    session.bundle.name = newName;
    session.bundle.path = newPath;
    if (session.bundle.dirty) {
        await session.bundle.save();
    }
    await setCurrentScorePath(newPath);
    session.refreshScoreNameDisplay();
    if (typeof session.rewatch === "function") session.rewatch();
}

/**
 * Show a small modal that explains the disk mirror has lost
 * access to its folder, with a button that re-requests
 * permission. The button click counts as a user gesture, so
 * the browser allows requestPermission() to surface its
 * native prompt at that moment.
 *
 * Returns an object with a close() method so the main app can
 * dismiss the dialog if the situation resolves on its own
 * (e.g. the user picked a fresh folder via Settings before
 * clicking Reconnect here).
 *
 * @param {import("./src/diskMirror.js").DiskMirror} diskMirror
 * @param {import("./src/messages.js").MessageArea} messages
 * @returns {{ close: () => void }}
 */
function showReconnectDialog(diskMirror, messages) {
    const status = diskMirror.getStatus();
    const folderName = status.folderName ?? "the chosen folder";
    const handle = openDialog({
        title: "Reconnect to disk storage",
        width: "480px",
    });
    const body = handle.body;

    const intro = document.createElement("div");
    intro.className = "settings-description";
    intro.style.marginBottom = "12px";
    intro.textContent =
        "GXW has lost permission to read or write the disk storage " +
        `folder "${folderName}". This can happen after the browser ` +
        "has been closed for a while. Click Reconnect to grant " +
        "permission again, or Disable Mirroring to switch the " +
        "feature off until you're ready to use it.";
    body.appendChild(intro);

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";

    const disableBtn = document.createElement("button");
    disableBtn.className = "modal-button";
    disableBtn.textContent = "Disable Mirroring";
    disableBtn.addEventListener("click", async () => {
        await diskMirror.setEnabled(false);
        messages.write("Disk mirroring disabled. Re-enable in Settings when ready.");
        handle.close();
    });
    buttons.appendChild(disableBtn);

    const reconnectBtn = document.createElement("button");
    reconnectBtn.className = "modal-button modal-button-primary";
    reconnectBtn.textContent = "Reconnect";
    reconnectBtn.addEventListener("click", async () => {
        // The click event itself is the user gesture that lets
        // the browser show its requestPermission prompt.
        const result = await diskMirror.requestPermissionFromGesture();
        if (result.permission === "granted") {
            messages.write("Disk mirroring reconnected.");
            handle.close();
        } else {
            messages.write(
                "Permission was not granted. You can pick a different " +
                "folder via Settings \u2192 Storage if needed.",
                "error"
            );
            handle.close();
        }
    });
    buttons.appendChild(reconnectBtn);

    body.appendChild(buttons);

    return { close: () => handle.close() };
}

/**
 * Show the first-run web-storage explainer. Web build only;
 * the desktop build has no need for this. Gated by a
 * localStorage key set on close, so the user never sees the
 * explainer twice in the same browser regardless of how
 * they dismiss it (Dismiss button, backdrop click, or
 * Escape).
 *
 * The text surfaces the IndexedDB durability tradeoff in
 * plain terms and points the user at File > Export Score
 * and the desktop app for work that matters. Single Dismiss
 * button styled as the primary action; the dialog closes
 * the moment it's clicked. Uses the existing openDialog
 * modal-overlay infrastructure so it shares the same visual
 * language as the rest of GeoSonel's modals.
 */
function showFirstRunDialog() {
    const handle = openDialog({
        title: "Welcome to GeoSonel on the web",
        width: "520px",
        onClose: () => {
            try {
                localStorage.setItem("gxw.firstRun.dismissed", "true");
            } catch (e) {
                // localStorage unavailable (private-mode,
                // quota). The dialog will appear again on
                // next load, which is graceful degradation
                // rather than a failure path.
            }
        },
    });
    const body = handle.body;

    const intro = document.createElement("div");
    intro.className = "settings-description";
    intro.style.marginBottom = "12px";
    intro.textContent =
        "GeoSonel runs in this browser tab and stores your " +
        "scores in the browser's IndexedDB. That storage is " +
        "private to this browser and origin, but it is not " +
        "as durable as files on disk: clearing site data, " +
        "switching browsers, or going incognito will hide " +
        "or discard your scores. For work that matters, save " +
        "copies via File > Export Score, or use the GeoSonel " +
        "desktop app, which stores scores as files on disk " +
        "like any other document.";
    body.appendChild(intro);

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "modal-button modal-button-primary";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", () => handle.close());
    buttons.appendChild(dismissBtn);

    body.appendChild(buttons);
}

/**
 * Compare an in-memory bundle with the same score's content on
 * disk. If the disk version differs (typically because an AI
 * assistant edited it while GXW wasn't running, or while a
 * different score was active), use the disk version as the
 * source of truth: persist it to IndexedDB and return it.
 * Returns the original bundle when disk has no changes, no
 * version of this score, or the mirror isn't ready.
 *
 * Image data is preserved from the in-memory bundle if disk
 * doesn't have an image for this score, since image
 * roundtrip is one-way (GXW pushes images out, but pull-back
 * relies on the file being present on disk).
 *
 * @param {Bundle} bundle
 * @param {import("./src/diskMirror.js").DiskMirror} mirror
 * @returns {Promise<Bundle>}
 */
async function reconcileBundleWithDisk(bundle, mirror) {
    if (!mirror.getStatus().ready) return bundle;
    if (bundle.path === null) return bundle;
    const diskBundle = await mirror.pullBundle(bundle.name);
    if (diskBundle === null) return bundle;

    const memScene = bundle.getFile("scene.json")?.content ?? "";
    const memBeh = bundle.getFile("behaviours.js")?.content ?? "";
    const diskScene = diskBundle.getFile("scene.json")?.content ?? "";
    const diskBeh = diskBundle.getFile("behaviours.js")?.content ?? "";
    if (memScene === diskScene && memBeh === diskBeh) return bundle;

    // Preserve image from in-memory if disk doesn't have one.
    if (bundle.imageName !== null && diskBundle.imageName === null) {
        const img = bundle.getBinaryFile(bundle.imageName);
        if (img !== null) {
            diskBundle.setBinaryFile(bundle.imageName, img.content, img.mimeType);
            diskBundle.imageName = bundle.imageName;
        }
    }

    // The disk-pulled bundle inherits the in-memory bundle's
    // path so its identity in the primary storage is
    // preserved across the takeover.
    diskBundle.path = bundle.path;

    // Persist disk version to primary storage. Suppress the
    // mirror's push subscriber so we don't write back to
    // disk what we just read.
    suppressNextSaveEmit(bundle.path);
    await saveScoreRecord(bundle.path, diskBundle.toRecord());
    return diskBundle;
}
