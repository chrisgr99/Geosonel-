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
 * The save model is explicit-only: typing marks the bundle
 * dirty; Cmd-S saves. Run Scene implicitly saves first. A
 * visible indicator next to the score name shows Saved or
 * Unsaved. A beforeunload warning protects against tab close
 * with unsaved changes.
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
 *   - Run Scene command (Cmd-Enter) with auto-save-before-run.
 *   - First-load auto-run so the canvas shows something.
 */

// @ts-check

import {
    Bundle,
    loadScoreByName,
    createNewScore,
    listAvailableScores,
} from "./src/bundle.js";
import {
    requestPersistentStorage,
    getCurrentScoreName,
    setCurrentScoreName,
    saveScoreRecord,
    deleteScoreRecord,
    suppressNextSaveEmit,
    subscribeAfterSaveScore,
    subscribeAfterDeleteScore,
} from "./src/storage.js";
import { TabbedEditor } from "./src/editor.js";
import { Transport } from "./src/transport.js";
import { Simulation } from "./src/simulation.js";
import { TransportBarView } from "./src/transportBar.js";
import { StrudelRuntime } from "./src/strudel/runtime.js";
import { installDivider } from "./src/paneDivider.js";
import { Canvas } from "./src/canvas.js";
import { MessageArea } from "./src/messages.js";
import { ImageImporter } from "./src/imageImporter.js";
import { installViewMenu } from "./src/viewMenu.js";
import { installFileMenu } from "./src/fileMenu.js";
import { installRunMenu } from "./src/runMenu.js";
import { installAppMenu } from "./src/appMenu.js";
import { SceneLoader } from "./src/sceneLoader.js";
import { DiskMirror } from "./src/diskMirror.js";
import { openDialog } from "./src/dialog.js";
import { Toolbar } from "./src/toolbar.js";
import {
    parsePatternToPositions,
    formatParseResultForConsole,
} from "./src/strudel/patternParse.js";
import {
    parseScene,
    stringifyScene,
    addSpriteAt,
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
    setPositionAxisOnSelection,
    setSizeAxisOnSelection,
    setSpriteDisplayDiameterOnSelection,
    setTriggerSizeOnSelection,
    setCursorROnSelection,
    setCursorLOnSelection,
    setCurveThicknessOnCurves,
    setCursorThicknessOnCurves,
    setColorOnSelection,
    setCyclePatternOnSelection,
    setBeatsPerCycleOnSelection,
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
} from "./src/sceneEditor.js";

main();

async function main() {
    // --- Persistent storage request (best-effort, early) ---
    requestPersistentStorage().catch(() => {});

    // --- Initial bundle ---
    const bundle = await resolveInitialBundle();

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

    if (bundle.getCurrentImage() !== null) {
        const img = bundle.getCurrentImage();
        if (img !== null) {
            await canvas.setImage({ bytes: img.content, mimeType: img.mimeType });
        }
    }

    // --- Saved indicator (top row) ---
    const savedIndicatorEl = document.getElementById("saved-indicator");
    const setSavedIndicator = (/** @type {"saved" | "unsaved" | "just-saved"} */ state) => {
        if (!(savedIndicatorEl instanceof HTMLElement)) return;
        savedIndicatorEl.classList.remove("unsaved", "just-saved");
        if (state === "unsaved") {
            savedIndicatorEl.textContent = "Unsaved";
            savedIndicatorEl.classList.add("unsaved");
        } else {
            savedIndicatorEl.textContent = "Saved";
            if (state === "just-saved") {
                savedIndicatorEl.classList.add("just-saved");
            }
        }
    };
    setSavedIndicator("saved");

    // --- Editor ---
    const tabBarEl = document.querySelector(".tab-bar");
    const editorAreaEl = document.getElementById("editor-area");
    const inspectorAreaEl = document.getElementById("inspector-area");
    if (!(tabBarEl instanceof HTMLElement) ||
        !(editorAreaEl instanceof HTMLElement) ||
        !(inspectorAreaEl instanceof HTMLElement)) {
        console.error("GXW: editor mount points missing.");
        return;
    }
    /** @type {any} */
    let justSavedTimeout = null;

    /** @type {() => Promise<void>} */
    let runScene = async () => {};

    /** @type {(objectId: string, expressionBody: string) => Promise<void>} */
    let handlePromotePattern = async () => {};

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

    const editor = new TabbedEditor(tabBarEl, editorAreaEl, inspectorAreaEl, bundle, {
        onDirtyChange: (dirty) => {
            setSavedIndicator(dirty ? "unsaved" : "saved");
        },
        onSaved: () => {
            setSavedIndicator("just-saved");
            clearTimeout(justSavedTimeout);
            justSavedTimeout = setTimeout(() => setSavedIndicator("saved"), 1000);
        },
        onRunScene: () => { runScene(); },
        onPromotePattern: (objectId, expressionBody) => {
            void handlePromotePattern(objectId, expressionBody);
        },
    });

    // --- Transport and audio engine ---
    //
    // The StrudelRuntime is constructed here but not initialised
    // until the user clicks Load Engine in the transport bar.
    // The click is the browser gesture that allows the shared
    // AudioContext (owned by Transport, used by both Transport
    // and strudel's webaudio layer) to start. Tier 1 leaves the
    // runtime idle; Tier 2 will add the pattern evaluation
    // primitive that drives output.
    const transport = new Transport();
    const strudelRuntime = new StrudelRuntime(transport);
    new TransportBarView(transport, strudelRuntime);
    /** @type {any} */ (window).strudelRuntime = strudelRuntime;

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
    // entirely, use View → Hide Inspector (Cmd-\\), which
    // hides the editor pane and the body divider together.
    const editorPaneEl = document.getElementById("editor-pane");
    const inspectorFloor = (editorPaneEl instanceof HTMLElement)
        ? editorPaneEl.offsetWidth
        : undefined;
    installDivider({
        dividerId: "body-divider",
        firstPaneId: "editor-pane",
        containerId: "body",
        orientation: "vertical",
        minPanePx: inspectorFloor,
        persistKey: "gxw.layout.editorPaneWidth",
        onDrag: () => canvas.scheduleDraw(),
    });
    installDivider({
        dividerId: "message-divider",
        firstPaneId: "canvas-area",
        containerId: "canvas-pane",
        orientation: "horizontal",
    });

    // --- Image importer ---
    const imageImporter = new ImageImporter({ bundle, canvas, messages });
    imageImporter.installGlobalListeners();

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
    subscribeAfterSaveScore(async (record) => {
        await diskMirror.pushRecord(record);
    });
    subscribeAfterDeleteScore(async (name) => {
        await diskMirror.deleteScore(name);
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
     * build a Scene, and update the canvas. Saves the bundle
     * first so the bytes on disk match what we executed.
     * Errors are reported in the message area; the canvas
     * retains the previous scene on failure.
     */
    runScene = async () => {
        if (editor.isDirty) {
            await editor.save();
        }
        await runBundleMigrations();
        await ensureIdentityFieldsAreFilled();
        const result = sceneLoader.load(session.bundle);
        if (result.success && result.scene !== null) {
            canvas.setScene(result.scene);
            simulation.setScene(result.scene);
            applySceneParamsToTransport(result.scene, transport);
            if (editor.inspector) {
                editor.inspector.setScene(result.scene);
            }
            // Sync the toolbar's canvas-size fields to the
            // scene's current values. Doesn't disturb a
            // focused field (the user may be mid-edit on
            // W or H from a different code path), so this
            // is safe to call unconditionally on every
            // scene reload.
            toolbar.setCanvasSize(result.scene.canvasW, result.scene.canvasH);
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
     * Persistence: the rename is committed to IndexedDB
     * inside this function so the migrated state survives
     * a reload. Without an explicit save here the bundle
     * would be re-migrated every page load, since
     * editor.reloadFromBundle resets the dirty flag and
     * runScene's later save check sees nothing to persist.
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
            // load doesn't re-run the rename pass. save()
            // also clears the dirty flag, leaving runScene's
            // subsequent dirty-driven save paths to handle
            // any further mutation in this same cycle.
            await editor.save();
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
     * normalised scene; done after editor.save() so we don't
     * lose pending text edits in the JSON tab. If scene.json
     * has a parse error we skip silently — sceneLoader will
     * report the error from its own parse.
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
    };

    // --- Score session ---
    const scoreNameEl = document.getElementById("current-score-name");
    const refreshScoreNameDisplay = () => {
        if (scoreNameEl instanceof HTMLElement) {
            scoreNameEl.textContent = session.bundle.name;
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
        // Clear canvas selection: the indexes we hold refer to
        // the previous version of this score's arrays. Even
        // when the score name is unchanged, an external write
        // can have inserted, removed, or reordered objects, so
        // letting old indexes survive would silently rebind
        // them to whatever object now sits at that slot.
        canvas.setSelection({ sprites: [], triggers: [], curves: [] });
        session.bundle = newBundle;
        imageImporter.setBundle(newBundle);
        await editor.setBundle(newBundle);
        const img = newBundle.getCurrentImage();
        if (img !== null) {
            await canvas.setImage({ bytes: img.content, mimeType: img.mimeType });
        } else {
            await canvas.setImage(null);
        }
        setSavedIndicator("saved");
        await runScene();
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
            // the new scene.
            canvas.setSelection({ sprites: [], triggers: [], curves: [] });

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
            refreshScoreNameDisplay();
            setSavedIndicator("saved");

            session.rewatch();

            await runScene();
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
            messages.write("Loaded latest version from disk.");
        }
    }

    // --- Canvas toolbar and direct-manipulation editing ---
    //
    // The toolbar sits above the canvas and currently exposes
    // a single tool: Add Sprite. Single-clicking arms it for
    // one placement; double-clicking locks it for repeated
    // placements until Esc or a second click on the tool. With
    // no tool armed, the canvas is in selection mode: clicks
    // select sprites, drag-from-empty draws a marquee, and
    // drag-on-sprite moves the selection.
    //
    // Canvas edits are committed by parsing scene.json,
    // mutating it, stringifying back, updating the bundle in
    // place, then re-running the scene. runScene auto-saves
    // first, so each canvas edit also persists through the
    // normal save pipeline (and out to disk if mirroring is
    // on). The editor's Properties (JSON) view is refreshed
    // via refreshActiveTabFromBundle so the JSON reflects the
    // new content immediately.
    const toolbarEl = document.getElementById("canvas-toolbar");
    if (!(toolbarEl instanceof HTMLElement)) {
        console.error("GXW: canvas-toolbar element missing.");
        return;
    }
    const toolbar = new Toolbar(toolbarEl);
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
    // The toolbar's canvas-size fields emit edits with the
    // same shape inspector and canvas edits use
    // ({kind, value}). Dispatched through applySceneEdit so
    // they share the dirty-state, auto-save, and re-run
    // mechanics. applySceneEdit is declared below this
    // line; the closure captures the binding and resolves
    // it at click/wheel time, by which point the variable
    // is assigned.
    toolbar.onSceneEdit(async (edit) => {
        if (edit.kind === "setCanvasW") {
            await applySceneEdit((data) => setCanvasW(data, edit.value));
        } else if (edit.kind === "setCanvasH") {
            await applySceneEdit((data) => setCanvasH(data, edit.value));
        }
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
     * Apply a mutation to the active score's scene.json,
     * refresh the editor view, and re-run the scene. The
     * mutator runs directly on the parsed scene-data object.
     * If the JSON currently has a parse error (typically
     * because the user is mid-edit in the JSON tab), the edit
     * is skipped with a message rather than silently
     * corrupting the file.
     *
     * @param {(data: any) => void} mutate
     */
    const applySceneEdit = async (mutate) => {
        const sceneFile = session.bundle.getFile("scene.json");
        if (sceneFile === null) {
            messages.write("No scene.json in this score.", "error");
            return;
        }
        const parsed = parseScene(sceneFile.content);
        if (!parsed.ok) {
            messages.write(
                `Cannot edit canvas while scene.json has a parse error: ${parsed.error}`,
                "error"
            );
            return;
        }
        mutate(parsed.data);
        const newText = stringifyScene(parsed.data);
        session.bundle.updateContent("scene.json", newText);
        editor.refreshActiveTabFromBundle();
        await runScene();
    };

    canvas.setEditCallback(async (edit) => {
        if (edit.kind === "addSprite") {
            await applySceneEdit((data) => addSpriteAt(data, edit.x, edit.y));
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
        } else if (edit.kind === "translateSelection") {
            // Canvas drag-end emits the same edit shape
            // the inspector emits when its Position field
            // is committed, so both paths converge on the
            // same sceneEditor primitive. The selection
            // travels with the edit (snapshot taken at
            // drag start) so a partial-redraw race can't
            // lose objects from the translation.
            await applySceneEdit((data) =>
                translateSelection(data, edit.selection, edit.dx, edit.dy),
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
            // Canvas double-click on an object. Switches to
            // the Code tab and scrolls to the object's
            // first occurrence in behaviors.js, walking
            // the same candidate list (labelled block tag
            // plus the three callback-function name forms)
            // that the inspector's Pattern row Go-to
            // button uses. selectTabAndScrollToFunction
            // falls back to a plain tab switch when none
            // of the candidates is present.
            editor.selectTabAndScrollToFunction(
                "behaviors.js",
                candidatesForObject(edit.objectId),
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
    // dirty-state, auto-save, and re-run mechanics without
    // either knowing about the other.
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
                // a $id: sound("") stub at the end of
                // behaviors.js, refresh the editor view,
                // run the scene (so the loader picks up
                // the new labelledBlocks entry), then
                // switch to behaviors.js and scroll to the
                // new stub so the user can fill in the
                // pattern expression.
                const behaviorsFile = session.bundle.getFile("behaviors.js");
                if (behaviorsFile === null) {
                    messages.write("No behaviors.js in this score.", "error");
                    return;
                }
                const { newContent } = scaffoldPatternBlock(behaviorsFile.content, edit.objectId);
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
    handlePromotePattern = async (objectId, expressionBody) => {
        const parseResult = parsePatternToPositions(expressionBody);
        const line = formatParseResultForConsole(expressionBody, parseResult);
        messages.write(line, parseResult.ok ? "info" : "error");
        if (!parseResult.ok) return;

        // Look up the object by id in the current scene.json
        // arrays to determine its kind and index, then build
        // a synthetic single-object selection for
        // setCyclePatternOnSelection. Parsing scene.json
        // here is independent of applySceneEdit's own parse
        // a few lines down; the duplication is cheap (the
        // file is small) and keeps the not-found case
        // observable before the edit pipeline runs.
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
            return;
        }
        /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
        const selection = { sprites: [], triggers: [], curves: [] };
        selection[foundKind].push(foundIndex);

        await applySceneEdit((data) =>
            setCyclePatternOnSelection(data, selection, expressionBody),
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
        void applySceneEdit((data) => removeObjects(data, sel));
    });

    // --- Inline rename ---
    if (scoreNameEl instanceof HTMLElement) {
        wireInlineRename(scoreNameEl, session, messages);
    }

    // --- Menus ---
    //
    // The View menu owns two visibility toggles that share
    // the same end-result shape (canvas fills the body) but
    // are conceptually distinct. Focus Canvas hides the
    // editor pane plus the message area for distraction-free
    // playback; Hide Inspector hides only the editor pane,
    // leaving the message area visible, and is the route
    // users take when they want canvas room without giving
    // up the messages console. The two toggles are
    // independent classes so either can be on without the
    // other.
    const toggleHideInspector = () => {
        document.body.classList.toggle("inspector-hidden");
    };

    installViewMenu({
        canvas,
        toggleFocusCanvas: () => {
            document.body.classList.toggle("focus-canvas");
        },
        toggleHideInspector,
    });
    installFileMenu({ session, messages, imageImporter, diskMirror });
    installRunMenu({ runScene });
    installAppMenu({ diskMirror, messages });

    // --- Save shortcut (Cmd-S) ---
    window.addEventListener("keydown", (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key.toLowerCase() === "s" && !e.shiftKey) {
            e.preventDefault();
            editor.save();
        }
    });

    // --- Protect unsaved changes on tab close ---
    window.addEventListener("beforeunload", (e) => {
        if (editor.isDirty) {
            e.preventDefault();
            e.returnValue = "";
            return "";
        }
    });

    // --- Initial auto-run so the canvas shows something ---
    await runScene();
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
        const currentName = await getCurrentScoreName();
        if (currentName) {
            const bundle = await loadScoreByName(currentName);
            if (bundle !== null) return bundle;
        }

        const scores = await listAvailableScores();
        if (scores.length > 0) {
            const bundle = await loadScoreByName(scores[0].name);
            if (bundle !== null) {
                await setCurrentScoreName(bundle.name);
                return bundle;
            }
        }
    } catch (err) {
        console.error("GXW: could not resolve initial bundle:", err);
    }

    const bundle = await createNewScore("Untitled");
    await setCurrentScoreName(bundle.name);
    return bundle;
}

/**
 * Wire the current-score-name element so clicking it enters
 * an editable state.
 * @param {HTMLElement} el
 * @param {any} session
 * @param {import("./src/messages.js").MessageArea} messages
 */
function wireInlineRename(el, session, messages) {
    el.addEventListener("click", () => {
        if (el.classList.contains("editing")) return;
        startEdit();
    });

    const startEdit = () => {
        const originalName = session.bundle.name;
        el.classList.add("editing");
        el.setAttribute("contenteditable", "true");
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        if (sel !== null) {
            sel.removeAllRanges();
            sel.addRange(range);
        }

        const finish = async (/** @type {boolean} */ commit) => {
            el.removeEventListener("keydown", onKey);
            el.removeEventListener("blur", onBlur);
            el.classList.remove("editing");
            el.removeAttribute("contenteditable");
            const proposed = (el.textContent ?? "").trim();
            if (!commit || proposed === "" || proposed === originalName) {
                el.textContent = originalName;
                return;
            }
            try {
                await renameCurrentScoreTo(session, proposed);
                messages.write(`Renamed to "${proposed}".`);
            } catch (err) {
                el.textContent = originalName;
                const msg = err instanceof Error ? err.message : String(err);
                messages.write(`Rename failed: ${msg}`, "error");
            }
        };

        const onKey = (/** @type {KeyboardEvent} */ e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
            }
        };
        const onBlur = () => finish(true);

        el.addEventListener("keydown", onKey);
        el.addEventListener("blur", onBlur);
    };
}

/**
 * Rename the current score to a new name. The save and delete
 * events fire automatically through storage.js's hooks, which
 * the disk mirror picks up to push the new folder and delete
 * the old one. So the rename appears on disk as a copy-then-
 * delete, which is functionally identical to a rename.
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
    const oldName = session.bundle.name;
    const record = session.bundle.toRecord();
    record.name = newName;
    record.updatedAt = Date.now();
    await saveScoreRecord(record);
    await deleteScoreRecord(oldName);
    session.bundle.name = newName;
    await setCurrentScoreName(newName);
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

    // Persist disk version to IndexedDB. Suppress the mirror's
    // push subscriber so we don't write back to disk what we
    // just read.
    suppressNextSaveEmit(diskBundle.name);
    await saveScoreRecord(diskBundle.toRecord());
    return diskBundle;
}
