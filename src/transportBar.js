/**
 * Transport bar view.
 *
 * Binds the DOM elements in the transport bar to the Transport
 * object. Handles three flows of data:
 *
 *   Transport to UI: when play state or BPM or time signature
 *   changes, redraw the affected controls. An animation-frame
 *   loop drives the elapsed time and musical position displays
 *   while playing.
 *
 *   UI to Transport: button clicks and BPM field edits call
 *   into the Transport's API. Keyboard shortcuts (spacebar and
 *   R) go through the same paths.
 *
 *   Conditional visibility: when the transport is beat-based,
 *   the musical-position display, BPM field, and time-signature
 *   readout are visible. When time-based (no BPM), they are
 *   hidden and only the wall-clock display shows.
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
        this.timeSigGroup = document.getElementById("time-sig-group");
        this.timeSigEl = document.getElementById("time-signature");

        if (!this.playBtn || !this.rewindBtn || !this.elapsedTimeEl ||
            !this.musicalPositionEl || !this.bpmInput || !this.bpmGroup ||
            !this.timeSigGroup || !this.timeSigEl) {
            console.error("GXW: transport DOM elements missing; view not bound.");
            return;
        }

        this._wireEvents();
        this._applyBpmToField();
        this._applyTimeSignatureDisplay();
        this._applyPlayState();
        this._applyBeatBasedVisibility();

        this._tick = this._tick.bind(this);
        requestAnimationFrame(this._tick);
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
            this._applyBeatBasedVisibility();
        });
        this.transport.on("timeSignature", () => {
            this._applyTimeSignatureDisplay();
            this._applyBeatBasedVisibility();
        });
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

    _applyTimeSignatureDisplay() {
        if (!this.timeSigEl) return;
        const ts = this.transport.timeSignature;
        if (ts === null) {
            this.timeSigEl.textContent = "";
        } else {
            this.timeSigEl.textContent = `${ts[0]}/${ts[1]}`;
        }
    }

    _applyBeatBasedVisibility() {
        const show = this.transport.isBeatBased;
        if (this.musicalPositionEl) {
            this.musicalPositionEl.style.display = show ? "" : "none";
        }
        if (this.bpmGroup) {
            this.bpmGroup.style.display = show ? "" : "none";
        }
        if (this.timeSigGroup) {
            this.timeSigGroup.style.display = show ? "" : "none";
        }
    }

    // --- Animation frame loop for time displays ---

    _tick() {
        if (this.elapsedTimeEl) {
            this.elapsedTimeEl.textContent = formatElapsed(
                this.transport.elapsedSeconds
            );
        }
        if (this.musicalPositionEl && this.transport.isBeatBased) {
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
