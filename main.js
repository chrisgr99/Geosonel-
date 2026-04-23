/**
 * GXW main entry point.
 *
 * Wires up all the app's components and owns the score session
 * — the identity of the currently-open score. When the user
 * switches scores via File menu actions, the session's
 * switchToBundle() method swaps the open bundle and updates
 * every component that needs to know (editor, canvas, image
 * importer).
 *
 * Milestone scope so far:
 *   1. Static layout skeleton — done.
 *   2. Functional editor with tabs — done.
 *   3. Transport with AudioContext clock — done.
 *   4. Canvas rendering, message area, View menu, zoom, Focus
 *      Canvas — done.
 *   5. Image loading with IndexedDB persistence — done.
 *   6. Multi-score management with auto-persist, export,
 *      import, backup, restore — this one.
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

main();

async function main() {
    // --- Persistent storage request (best-effort, early) ---
    requestPersistentStorage().catch(() => {});

    // --- Figure out which score to open ---
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

    // --- Editor ---
    const tabBarEl = document.querySelector(".tab-bar");
    const editorAreaEl = document.getElementById("editor-area");
    if (!(tabBarEl instanceof HTMLElement) || !(editorAreaEl instanceof HTMLElement)) {
        console.error("GXW: editor mount points missing.");
        return;
    }
    const savedIndicatorEl = document.getElementById("saved-indicator");
    const flashSaved = () => {
        if (!(savedIndicatorEl instanceof HTMLElement)) return;
        savedIndicatorEl.classList.add("visible");
        clearTimeout(flashSaved._t);
        flashSaved._t = setTimeout(() => {
            savedIndicatorEl.classList.remove("visible");
        }, 1200);
    };
    /** @type {any} */
    flashSaved._t = null;
    const editor = new TabbedEditor(tabBarEl, editorAreaEl, bundle, flashSaved);

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

    // --- Score session ---
    // The session ties together every component that holds a
    // reference to the current bundle. When the user switches
    // scores, switchToBundle() updates each component.
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
        },
        refreshScoreNameDisplay,
    };
    refreshScoreNameDisplay();

    // --- Inline rename on the score-name element ---
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

    // No Cmd-S handler anymore — autosave handles persistence.
}

/**
 * Figure out which score to open on startup:
 *   - If a "currentScoreName" setting exists and that score is
 *     present in IndexedDB, open it.
 *   - Else if any scores exist, open the most recently updated.
 *   - Else create a fresh "Untitled" score.
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
 * an editable state. Enter commits; Escape or blur with an
 * empty or duplicate name cancels. Commits call through to
 * the same rename logic used by the menu item, keeping the
 * two paths consistent.
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
        // Select all text inside for easy replace.
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
 * Rename the current score to a new name. Validates that the
 * name is non-empty and unique.
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
