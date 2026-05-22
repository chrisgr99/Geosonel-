/**
 * Transport bar view.
 *
 * Binds the DOM elements in the transport bar to the Transport
 * object. Handles three flows of data:
 *
 *   Transport to UI: when play state or BPM changes, redraw
 *   the affected controls. An animation-frame loop drives the
 *   elapsed time and musical position displays while playing.
 *
 *   UI to Transport: button clicks and BPM field edits call
 *   into the Transport's API. Keyboard shortcuts (spacebar and
 *   R) go through the same paths.
 *
 *   Conditional visibility: when the transport has a BPM, the
 *   musical-position display and BPM field are visible. When
 *   BPM is null (time-based piece), they are hidden.
 *
 * v2.3 removed the score-level time signature display from the
 * transport bar (per DESIGN.md §13). The Transport class still
 * tracks an internal time-signature value for the bars.beats
 * portion of the musical-position readout, but it is no longer
 * exposed through the UI.
 *
 * Following the top-row elimination, the transport elements
 * live inside the canvas-toolbar built by toolbar.js; the
 * elapsed-time wall-clock display and the Load Engine button
 * were dropped in the same pass. TransportBarView no longer
 * receives or wires the StrudelRuntime; engine loading runs
 * automatically on the first user interaction, handled by
 * main.js.
 */

// @ts-check

/** @typedef {import("./transport.js").Transport} Transport */

const PLAY_GLYPH = "▶";
const PAUSE_GLYPH = "⏸";

export class TransportBarView {
    /**
     * @param {Transport} transport
     */
    constructor(transport) {
        this.transport = transport;

        /**
         * Optional scene-edit callback. Wired from main.js
         * after construction via setEditCallback. When set,
         * BPM input commits fire { kind: "setBpm", value }
         * through it in addition to the direct
         * transport.setBpm call. The direct call keeps the
         * UI responsive without waiting for the
         * applySceneEdit round trip; the emitted edit
         * persists the value into scene.json so the next
         * runScene's applySceneParamsToTransport doesn't
         * stomp it back to whatever the file said before.
         * Null when not wired — main.js may construct the
         * view before the edit pipeline is ready, and BPM
         * input still works in that window (just without
         * persistence).
         * @type {((edit: any) => void) | null}
         */
        this._editCallback = null;

        // Gather DOM references. If any of these are missing,
        // the transport bar is malformed and we log and bail.
        this.playBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("play-btn")
        );
        this.rewindBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("rewind-btn")
        );
        this.musicalPositionEl = document.getElementById("musical-position");
        this.bpmInput = /** @type {HTMLInputElement | null} */ (
            document.getElementById("bpm-input")
        );
        this.bpmGroup = document.getElementById("bpm-group");

        if (!this.playBtn || !this.rewindBtn ||
            !this.musicalPositionEl || !this.bpmInput || !this.bpmGroup) {
            console.error("GXW: transport DOM elements missing; view not bound.");
            return;
        }

        this._wireEvents();
        this._applyBpmToField();
        this._applyPlayState();
        this._applyBpmVisibility();

        this._tick = this._tick.bind(this);
        requestAnimationFrame(this._tick);
    }

    // --- Wiring ---

    /**
     * Register the callback that handles scene-edit emits
     * from this view. Currently only the BPM input commit
     * fires through here; the play and rewind buttons go
     * straight to transport methods because they don't
     * mutate scene state. main.js installs this once during
     * setup; the callback is invoked synchronously from the
     * BPM input change handler and is expected to be
     * async-safe.
     * @param {(edit: any) => void} callback
     */
    setEditCallback(callback) {
        this._editCallback = callback;
    }

    _wireEvents() {
        if (!this.playBtn || !this.rewindBtn || !this.bpmInput) return;

        this.playBtn.addEventListener("click", () => this.transport.toggle());
        this.rewindBtn.addEventListener("click", () => this.transport.rewind());

        // BPM field edits flow into the Transport. We commit on
        // "change" (focus loss / Enter) rather than every
        // keystroke, so partially-typed numbers don't momentarily
        // set a nonsense BPM.
        this.bpmInput.addEventListener("change", () => {
            if (!this.bpmInput) return;
            const value = parseInt(this.bpmInput.value, 10);
            if (Number.isFinite(value)) {
                // Direct call keeps the transport responsive
                // (UI shows the new BPM immediately without
                // waiting for the applySceneEdit round trip).
                // The emitted edit then persists the value
                // into scene.json so subsequent inspector
                // edits don't stomp it via
                // applySceneParamsToTransport. Both calls
                // are idempotent: if the edit's runScene
                // re-applies the same BPM via setBpm, the
                // clamped-equals-current early return makes
                // it a no-op.
                this.transport.setBpm(value, "user");
                if (this._editCallback !== null) {
                    this._editCallback({ kind: "setBpm", value });
                }
            }
        });

        // Keyboard shortcuts. Spacebar (transport toggle) is
        // handled centrally in main.js alongside Cmd-Period
        // and the canvas-background double-click gesture, so
        // it's not bound here — a duplicate binding would
        // toggle twice per keystroke (once here, once in
        // main.js) and cancel itself out. R/r is the only
        // shortcut left at this layer; it stays here because
        // rewind is a transport-bar concern that doesn't
        // overlap with the canvas/editor ergonomics main.js
        // owns.
        window.addEventListener("keydown", (e) => {
            // Don't intercept keys while the user is typing in an
            // input, textarea, or the CodeMirror editor.
            if (this._isTypingTarget(e.target)) return;
            if (e.key === "r" || e.key === "R") {
                e.preventDefault();
                this.transport.rewind();
            }
        });

        // Transport-side listeners.
        this.transport.on("play", () => this._applyPlayState());
        this.transport.on("bpm", () => {
            this._applyBpmToField();
            this._applyBpmVisibility();
        });
        // Time-signature changes are still emitted by the
        // Transport but no longer drive any visible UI in v2.3.
        // The musical-position readout uses the transport's
        // internal default time signature, which the sketch
        // loader does not override.
    }

    /**
     * @param {EventTarget | null} target
     * @returns {boolean}
     */
    _isTypingTarget(target) {
        if (!(target instanceof HTMLElement)) return false;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return true;
        // CodeMirror's contenteditable content.
        if (target.closest(".cm-editor") !== null) return true;
        // Any other contenteditable element — includes the
        // property inspector's Name field, the inline score-
        // rename span, and anything similar that lands later.
        // Without this, R triggers transport rewind and Space
        // toggles play even while the user is typing.
        if (target.isContentEditable) return true;
        return false;
    }

    // --- UI updates driven by transport state ---

    _applyPlayState() {
        if (!this.playBtn) return;
        if (this.transport.isPlaying) {
            this.playBtn.textContent = PAUSE_GLYPH;
            this.playBtn.setAttribute("aria-label", "Pause");
        } else {
            this.playBtn.textContent = PLAY_GLYPH;
            this.playBtn.setAttribute("aria-label", "Play");
        }
    }

    _applyBpmToField() {
        if (!this.bpmInput) return;
        const bpm = this.transport.bpm;
        if (bpm === null) return;
        // Only overwrite the input if the user isn't actively
        // editing it — otherwise we'd clobber their typing.
        if (document.activeElement !== this.bpmInput) {
            this.bpmInput.value = String(bpm);
        }
    }

    _applyBpmVisibility() {
        // BPM field and musical-position display are visible
        // when the transport has a BPM (beat-based piece) and
        // hidden when BPM is null (time-based piece). v2.3
        // removed the time-signature display, so this method
        // covers only the BPM-driven elements; isBeatBased
        // (which still requires a non-null time signature) is
        // not the right gate now that time signature is no
        // longer surfaced through the UI.
        const show = this.transport.bpm !== null;
        if (this.musicalPositionEl) {
            this.musicalPositionEl.style.display = show ? "" : "none";
        }
        if (this.bpmGroup) {
            this.bpmGroup.style.display = show ? "" : "none";
        }
    }

    // --- Animation frame loop for time displays ---

    _tick() {
        if (this.musicalPositionEl && this.transport.bpm !== null) {
            const pos = this.transport.musicalPosition;
            this.musicalPositionEl.textContent =
                pos === null ? "" : formatMusicalPosition(pos);
        }
        requestAnimationFrame(this._tick);
    }
}

// --- Formatting helpers ---

/**
 * Format musical position as bars.beats.ticks (e.g. "17.3.240").
 * Bars and beats are 1-based integers; ticks are zero-padded to
 * three digits.
 * @param {{bars: number, beats: number, ticks: number}} pos
 * @returns {string}
 */
function formatMusicalPosition(pos) {
    return `${pos.bars}.${pos.beats}.${pad3(pos.ticks)}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
function pad3(n) {
    if (n < 10) return `00${n}`;
    if (n < 100) return `0${n}`;
    return String(n);
}
