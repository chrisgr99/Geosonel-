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
 *   BPM is null (time-based piece), they are hidden and only
 *   the wall-clock display shows.
 *
 * v2.3 removed the score-level time signature display from the
 * transport bar (per DESIGN.md §13). The Transport class still
 * tracks an internal time-signature value for the bars.beats
 * portion of the musical-position readout, but it is no longer
 * exposed through the UI.
 */

// @ts-check

/** @typedef {import("./transport.js").Transport} Transport */
/** @typedef {import("./strudel/runtime.js").StrudelRuntime} StrudelRuntime */
/** @typedef {import("./strudel/runtime.js").RuntimeStatus} RuntimeStatus */

const PLAY_GLYPH = "▶";
const PAUSE_GLYPH = "⏸";

export class TransportBarView {
    /**
     * @param {Transport} transport
     * @param {StrudelRuntime | null} [strudelRuntime] Optional;
     *     when provided, the Load Engine button gets wired to
     *     it. Passing null leaves the button visible but inert,
     *     useful for tests that mount the transport bar without
     *     a runtime.
     */
    constructor(transport, strudelRuntime = null) {
        this.transport = transport;
        this.strudelRuntime = strudelRuntime;

        // Gather DOM references. If any of these are missing,
        // the transport bar is malformed and we log and bail.
        this.playBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("play-btn")
        );
        this.rewindBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("rewind-btn")
        );
        this.musicalPositionEl = document.getElementById("musical-position");
        this.elapsedTimeEl = document.getElementById("elapsed-time");
        this.bpmInput = /** @type {HTMLInputElement | null} */ (
            document.getElementById("bpm-input")
        );
        this.bpmGroup = document.getElementById("bpm-group");
        this.loadEngineBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("load-engine-btn")
        );

        if (!this.playBtn || !this.rewindBtn || !this.elapsedTimeEl ||
            !this.musicalPositionEl || !this.bpmInput || !this.bpmGroup) {
            console.error("GXW: transport DOM elements missing; view not bound.");
            return;
        }

        this._wireEvents();
        this._applyBpmToField();
        this._applyPlayState();
        this._applyBpmVisibility();
        this._wireLoadEngine();

        this._tick = this._tick.bind(this);
        requestAnimationFrame(this._tick);
    }

    // --- Load Engine button ---

    _wireLoadEngine() {
        if (!this.loadEngineBtn) return;
        if (this.strudelRuntime === null) {
            // No runtime to wire; leave the button as a visible
            // affordance but disable it so clicks do nothing.
            this.loadEngineBtn.disabled = true;
            return;
        }
        this.loadEngineBtn.addEventListener("click", () => {
            if (!this.strudelRuntime) return;
            // The click is the user gesture that lets the
            // AudioContext start. Runtime.init() handles the
            // rest; the button reacts via the status listener
            // below.
            this.strudelRuntime.init().catch(() => {
                // Errors are already logged inside init; the
                // status transition to "failed" updates the
                // button label below.
            });
        });
        this.strudelRuntime.onStatusChange((status) => this._applyEngineStatus(status));
    }

    /**
     * @param {RuntimeStatus} status
     */
    _applyEngineStatus(status) {
        if (!this.loadEngineBtn) return;
        // Swap a single state class on the button so CSS can
        // style each state distinctly (orange idle, dim while
        // loading, green when loaded, red on failure).
        this.loadEngineBtn.classList.remove(
            "engine-state-idle",
            "engine-state-loading",
            "engine-state-loaded",
            "engine-state-failed",
        );
        this.loadEngineBtn.classList.add(`engine-state-${status}`);
        switch (status) {
            case "idle":
                this.loadEngineBtn.textContent = "Load Engine";
                this.loadEngineBtn.disabled = false;
                this.loadEngineBtn.setAttribute("aria-label", "Load audio engine");
                break;
            case "loading":
                this.loadEngineBtn.textContent = "Loading...";
                this.loadEngineBtn.disabled = true;
                this.loadEngineBtn.setAttribute("aria-label", "Audio engine loading");
                break;
            case "loaded":
                this.loadEngineBtn.textContent = "Engine Loaded";
                this.loadEngineBtn.disabled = true;
                this.loadEngineBtn.setAttribute("aria-label", "Audio engine loaded");
                break;
            case "failed":
                this.loadEngineBtn.textContent = "Load Engine (retry)";
                this.loadEngineBtn.disabled = false;
                this.loadEngineBtn.setAttribute("aria-label", "Audio engine failed; click to retry");
                break;
        }
    }

    // --- Wiring ---

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
                this.transport.setBpm(value, "user");
            }
        });

        // Keyboard shortcuts.
        window.addEventListener("keydown", (e) => {
            // Don't intercept keys while the user is typing in an
            // input, textarea, or the CodeMirror editor.
            if (this._isTypingTarget(e.target)) return;
            if (e.key === " ") {
                e.preventDefault();
                this.transport.toggle();
            } else if (e.key === "r" || e.key === "R") {
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
        if (this.elapsedTimeEl) {
            this.elapsedTimeEl.textContent = formatElapsed(
                this.transport.elapsedSeconds
            );
        }
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
 * Format wall-clock elapsed time as minutes:seconds:hundredths.
 * Minutes grows without limit. Seconds and hundredths are zero-
 * padded to two digits.
 * @param {number} seconds
 * @returns {string}
 */
function formatElapsed(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const totalHundredths = Math.floor(seconds * 100);
    const hundredths = totalHundredths % 100;
    const totalSeconds = Math.floor(totalHundredths / 100);
    const secs = totalSeconds % 60;
    const mins = Math.floor(totalSeconds / 60);
    return `${mins}:${pad2(secs)}:${pad2(hundredths)}`;
}

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
function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
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
