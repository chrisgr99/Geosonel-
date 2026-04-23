/**
 * GXW main entry point.
 *
 * Wires up the tabbed editor against an in-memory default bundle,
 * the Transport and its view, the canvas with grid rendering, the
 * draggable dividers between panes and between canvas and message
 * area, and the View menu with zoom and focus-mode controls.
 *
 * Milestone scope:
 *   1. Static layout skeleton \u2014 done.
 *   2. Functional editor with tabs and dirty state \u2014 done.
 *   3. Transport object with AudioContext-driven clock \u2014 done.
 *   4. Canvas rendering, message area, View menu, Focus Canvas,
 *      zoom \u2014 this one.
 * Later milestones add the sketch runner, Web Audio output,
 * persistence, and git versioning.
 */

// @ts-check

import { makeDefaultBundle } from "./src/bundle.js";
import { TabbedEditor } from "./src/editor.js";
import { Transport } from "./src/transport.js";
import { TransportBarView } from "./src/transportBar.js";
import { installDivider } from "./src/paneDivider.js";
import { Canvas } from "./src/canvas.js";
import { installViewMenu } from "./src/viewMenu.js";

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

// --- Transport setup ---

// The Transport starts beat-based by default (BPM 120, time
// signature 4/4) so that both the musical-position and wall-clock
// displays are exercised during development. When the sketch
// loader arrives in a later milestone it will call setBpm(null)
// / setTimeSignature(null) for time-based sketches, and the UI
// will adapt automatically.
const transport = new Transport();
new TransportBarView(transport);

// --- Canvas setup ---

const canvasArea = document.getElementById("canvas-area");
/** @type {Canvas | null} */
let canvas = null;
if (canvasArea instanceof HTMLElement) {
    canvas = new Canvas(canvasArea);
} else {
    console.error("GXW: canvas-area element not found; canvas not initialised.");
}

// --- Draggable dividers ---

// Vertical divider between editor and canvas panes.
installDivider({
    dividerId: "body-divider",
    firstPaneId: "editor-pane",
    containerId: "body",
    orientation: "vertical",
});

// Horizontal divider between canvas area and message area,
// inside the canvas pane. Since dragging this divider changes
// the canvas-area's height, the canvas must redraw \u2014 its
// ResizeObserver catches that automatically.
installDivider({
    dividerId: "message-divider",
    firstPaneId: "canvas-area",
    containerId: "canvas-pane",
    orientation: "horizontal",
});

// --- View menu ---

if (canvas !== null) {
    installViewMenu({
        canvas,
        toggleFocusCanvas: () => {
            document.body.classList.toggle("focus-canvas");
        },
    });
}
