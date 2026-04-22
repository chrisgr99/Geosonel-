/**
 * GXW main entry point.
 *
 * Wires up the transport bar's visual controls (rewind and
 * play-pause) and instantiates the tabbed editor against an
 * in-memory default bundle.
 *
 * Milestone scope:
 *   1. Static layout skeleton — done.
 *   2. Functional editor with tabs and dirty state — this one.
 * Later milestones add the Transport object, canvas rendering,
 * the sketch runner, Web Audio output, persistence, and git
 * versioning.
 */

// @ts-check

import { makeDefaultBundle } from "./src/bundle.js";
import { TabbedEditor } from "./src/editor.js";

// --- Editor setup ---

const tabBar = document.querySelector(".tab-bar");
const editorArea = document.getElementById("editor-area");

if (tabBar instanceof HTMLElement && editorArea instanceof HTMLElement) {
    const bundle = makeDefaultBundle();
    const editor = new TabbedEditor(tabBar, editorArea, bundle);

    // Cmd-S saves the active tab, Cmd-Shift-S saves all. At this
    // milestone "save" just clears the dirty flag. Listening on
    // the window so the shortcut works regardless of focus.
    window.addEventListener("keydown", (e) => {
        const isMeta = e.metaKey || e.ctrlKey;
        if (isMeta && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (e.shiftKey) {
                editor.saveAll();
            } else {
                editor.saveCurrent();
            }
        }
    });
} else {
    console.error("GXW: editor mount points not found; editor not initialised.");
}

// --- Transport bar (visual-only controls, unchanged from Milestone 1) ---

const playBtn = document.getElementById("play-btn");
const rewindBtn = document.getElementById("rewind-btn");
const elapsedTime = document.getElementById("elapsed-time");

if (playBtn instanceof HTMLButtonElement &&
    rewindBtn instanceof HTMLButtonElement &&
    elapsedTime instanceof HTMLElement) {
    let isPlaying = false;

    playBtn.addEventListener("click", () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
            playBtn.textContent = "⏸";
            playBtn.setAttribute("aria-label", "Pause");
        } else {
            playBtn.textContent = "▶";
            playBtn.setAttribute("aria-label", "Play");
        }
    });

    rewindBtn.addEventListener("click", () => {
        elapsedTime.textContent = "0:00:00";
    });
} else {
    console.error("GXW: transport controls not found; transport not initialised.");
}
