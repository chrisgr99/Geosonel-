/**
 * GXW main entry point.
 *
 * At this milestone (Milestone 1 — static layout skeleton), this
 * file only wires up the play-pause toggle icon and the rewind
 * button's elapsed-time reset. The rest of the UI is static HTML
 * and CSS. Real logic — CodeMirror editor, Transport object,
 * canvas rendering, sketch execution, audio output — arrives in
 * later milestones.
 */

// @ts-check

/** @type {HTMLButtonElement} */
// @ts-ignore — runtime-checked below
const playBtn = document.getElementById("play-btn");

/** @type {HTMLButtonElement} */
// @ts-ignore — runtime-checked below
const rewindBtn = document.getElementById("rewind-btn");

/** @type {HTMLDivElement} */
// @ts-ignore — runtime-checked below
const elapsedTime = document.getElementById("elapsed-time");

if (!playBtn || !rewindBtn || !elapsedTime) {
    console.error("GXW: required DOM elements not found; aborting script setup.");
} else {
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
}
