/**
 * GXW main entry point.
 *
 * Wires up every component and owns the score session. In
 * addition to the existing concerns (editor, transport, canvas,
 * dividers, menus, image importer), this milestone adds the
 * sketch runner: the current score's sketch.js is executed on
 * demand (Cmd-Enter or Run menu) to produce a Scene, which the
 * canvas renders on top of the grid.
 *
 * The save model is explicit-only: typing marks the bundle
 * dirty; Cmd-S saves. Run Scene implicitly saves first. A
 * visible indicator next to the score name shows Saved or
 * Unsaved. A beforeunload warning protects against tab close
 * with unsaved changes.
 *
 * Milestone 7 scope:
 *   - Scene data model (Scene, Event, Mover, Projector).
 *   - Sketch runner that builds a Scene from sketch.js.
 *   - Canvas rendering of scenes (static).
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
import { SketchRunner } from "./src/sketchRunner.js";

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
    if (!(tabBarEl instanceof HTMLElement) || !(editorAreaEl instanceof HTMLElement)) {
        console.error("GXW: editor mount points missing.");
        return;
    }
    /** @type {any} */
    let justSavedTimeout = null;

    // runScene is defined further down (it depends on both
    // session and the editor itself). To let the editor's
    // CodeMirror keymap invoke it, we use a let binding that
    // starts as a no-op and gets reassigned once the real
    // function is ready.
    /** @type {() => Promise<void>} */
    let runScene = async () => {};

    const editor = new TabbedEditor(tabBarEl, editorAreaEl, bundle, {
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
    installDivider({
        dividerId: "body-divider",
        firstPaneId: "editor-pane",
        containerId: "body",
        orientation: "vertical",
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

    // --- Sketch runner ---
    const sketchRunner = new SketchRunner();

    /**
     * Execute the current score's sketch.js and update the
     * canvas with the resulting scene. Saves the bundle first
     * so the bytes on disk match what we executed. Errors are
     * reported in the message area; the canvas retains the
     * previous scene on failure.
     */
    runScene = async () => {
        if (editor.isDirty) {
            await editor.save();
        }
        const sketchFile = session.bundle.getFile("sketch.js");
        if (sketchFile === null) {
            messages.write("No sketch.js in this score.", "error");
            return;
        }
        const result = sketchRunner.run(sketchFile.content);
        if (result.success && result.scene !== null) {
            canvas.setScene(result.scene);
            applySceneParamsToTransport(result.scene, transport);
            messages.write("Scene updated.");
        } else {
            messages.write(result.error ?? "Unknown run error.", "error");
        }
    };

    // --- Score session ---
    const scoreNameEl = document.getElementById("current-score-name");
    const refreshScoreNameDisplay = () => {
        if (scoreNameEl instanceof HTMLElement) {
            scoreNameEl.textContent = session.bundle.name;
        }
    };

    const session = {
        bundle,
        /**
         * @param {Bundle} newBundle
         */
        async switchToBundle(newBundle) {
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

            // Auto-run the sketch on score switch so the canvas
            // reflects the newly-opened score.
            await runScene();
        },
        refreshScoreNameDisplay,
    };
    refreshScoreNameDisplay();

    // --- Inline rename ---
    if (scoreNameEl instanceof HTMLElement) {
        wireInlineRename(scoreNameEl, session, messages);
    }

    // --- Menus ---
    installViewMenu({
        canvas,
        toggleFocusCanvas: () => {
            document.body.classList.toggle("focus-canvas");
        },
    });
    installFileMenu({ session, messages, imageImporter });
    installRunMenu({ runScene });

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
            // Modern browsers ignore the custom message and
            // show a standard dialog, but returning a string
            // is still what triggers the prompt.
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
 * if the sketch set them. Preserves null — a time-based sketch
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
 * Rename the current score to a new name.
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
}
