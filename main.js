/**
 * GXW main entry point.
 *
 * Wires up every component and owns the score session. The
 * current score's data and behaviour are kept in two files
 * inside the bundle \u2014 scene.json (declarative data) and
 * behaviours.js (named functions) \u2014 which the scene loader
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
 *     behaviours.js, with named function references resolved
 *     against the behaviours' top-level declarations.
 *   - Canvas rendering of scenes (static).
 *   - Editor with Properties (JSON) and Behaviours (JS) tabs,
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
import { TransportBarView } from "./src/transportBar.js";
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
    parseScene,
    stringifyScene,
    addSpriteAt,
    setSpritePositions,
    removeObjects,
    fillMissingIds,
    fillEmptyNames,
    cleanLegacyCurveFields,
    cleanLegacyShapeFields,
    setMuteOnSelection,
    setHideOnCurves,
    setNameOnSelection,
    setCycleDurationOnCurves,
    setCycleSpeedsOnCurves,
    setStopAtCycleOnCurves,
    setActiveBeatsOnCurves,
    setStrengthOnCurves,
    translateSelection,
    scaleCurveAxis,
    setPositionAxisOnSelection,
    setSizeAxisOnSelection,
    setSpriteDisplayDiameterOnSelection,
    setTriggerSizeOnSelection,
    setCursorROnCurves,
    setCursorLOnCurves,
    setCurveThicknessOnCurves,
    setCursorThicknessOnCurves,
    setColorOnSelection,
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
    });

    // --- Transport ---
    const transport = new Transport();
    new TransportBarView(transport);

    // --- Dividers ---
    //
    // Only the message-area divider is draggable. The body
    // divider between editor and canvas was previously
    // draggable but is now a static 3px strip: the inspector
    // has a fixed natural width matching its narrowest
    // constraint row (Cycle Parameters row 1, ~560px), and
    // there is no useful state for the body divider to be in
    // other than fixed at that width. To gain canvas room
    // entirely, use View → Hide Inspector (Cmd-\\), which
    // hides the editor pane and the body divider together.
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
        await ensureIdentityFieldsAreFilled();
        const result = sceneLoader.load(session.bundle);
        if (result.success && result.scene !== null) {
            canvas.setScene(result.scene);
            applySceneParamsToTransport(result.scene, transport);
            if (editor.inspector) {
                editor.inspector.setScene(result.scene);
            }
            messages.write("Scene updated.");
        } else {
            messages.write(result.error ?? "Unknown load error.", "error");
        }
    };

    /**
     * Before loading the scene, scan scene.json for objects
     * that lack an id or a name and fill them in, and clean
     * up any vestigial curve fields left over from older
     * model versions. Ids are stable and type-prefixed
     * (sp_xxxxxx, tr_xxxxxx, cv_xxxxxx) and survive across
     * edits because we write them back to the bundle's
     * scene.json text after generating them. Names are
     * inserted as empty strings — the same default the
     * constructors apply — so the user has an obvious place
     * to type a name in the JSON tab without first
     * remembering the field exists. Legacy curve fields
     * (cycleBeats, beatsPerCycle) are cleaned up: cycleBeats
     * is renamed to cycleDuration to reflect the new model;
     * beatsPerCycle is dropped entirely since the new model
     * doesn't use it. All passes are no-ops once the steady
     * state is reached, which is the case once a score has
     * been loaded once after these passes were introduced.
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
        const legacyChanged = cleanLegacyCurveFields(parsed.data);
        const shapesChanged = cleanLegacyShapeFields(parsed.data);
        if (!idsChanged && !namesChanged && !legacyChanged && !shapesChanged) return;
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
        } else if (edit.kind === "moveSprites") {
            await applySceneEdit((data) => setSpritePositions(data, edit.positions));
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
            } else if (edit.kind === "setCycleDuration") {
                await applySceneEdit((data) =>
                    setCycleDurationOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCycleSpeeds") {
                await applySceneEdit((data) =>
                    setCycleSpeedsOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setStopAtCycle") {
                await applySceneEdit((data) =>
                    setStopAtCycleOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setActiveBeats") {
                await applySceneEdit((data) =>
                    setActiveBeatsOnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setStrength") {
                await applySceneEdit((data) =>
                    setStrengthOnCurves(data, edit.selection, edit.value),
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
                    setCursorROnCurves(data, edit.selection, edit.value),
                );
            } else if (edit.kind === "setCursorL") {
                await applySceneEdit((data) =>
                    setCursorLOnCurves(data, edit.selection, edit.value),
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
            }
        });
    }

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
 * Apply scene-declared bpm and time signature to the Transport
 * if the sketch set them. Preserves null \u2014 a time-based sketch
 * (no bpm declared) hides the musical-position display.
 * @param {import("./src/scene.js").Scene} scene
 * @param {import("./src/transport.js").Transport} transport
 */
function applySceneParamsToTransport(scene, transport) {
    transport.setBpm(scene.bpm, "sketch");
    if (scene.timeSignature !== null) {
        transport.setTimeSignature(scene.timeSignature);
    } else {
        transport.setTimeSignature(null);
    }
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
