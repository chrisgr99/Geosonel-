// @ts-check

/**
 * Audition toolbar (seed-variation audition workflow).
 *
 * A floating, always-on-top, MODELESS toolbar over the canvas for
 * auditioning seed candidates. Modeless means it sits visually
 * above the canvas but the canvas and the inspector stay fully
 * interactive while it is up, so Chris can tweak an object's
 * Variability and re-press Mutate without dismissing it. It mounts
 * into the (position: relative) canvas area and anchors near the
 * top, centred.
 *
 * Contents, left to right: a Beats number field (the pass / loop
 * length N, in master-clock beats), a Mutate button, a Loop
 * checkbox, and a reserved slot for a future "move to curated list"
 * capture button (left empty now). The two controls combine:
 *
 *   - Loop UNCHECKED: Mutate plays one finite N-beat pass of the
 *     next variation, then stops.
 *   - Loop CHECKED: the current pattern loops continually (reset
 *     and repeat every N beats). Mutate restarts immediately with
 *     a new variation, which then keeps looping (retained) until
 *     Mutate is pressed again.
 *
 * The underlying seed is intentionally NOT shown: the user doesn't
 * care what the number is, only that it will be captured as the key
 * to recreate a pattern when curation lands.
 *
 * The main toolbar carries an "Audition" toggle that shows / hides
 * this bar; the bar defaults to visible. main.js owns the
 * behaviour (the seed stepping, the loop boundary, the queued
 * mutation); this module is just the surface and emits Mutate and
 * Loop-toggle intents and reports the current Beats value.
 *
 * Accessibility (this UI is for Chris — limited eyesight, macOS
 * Zoom + Speak Selection): predictable anchored position, large hit
 * targets, plainly labelled controls. See css/canvas-toolbar.css
 * for the .audition-bar styles.
 */

const DEFAULT_BEATS = 16;
// Transport glyphs, matching the main transport bar: a right-pointing
// triangle for Play, two vertical bars for Pause, skip-to-start for
// Rewind.
const PLAY_GLYPH = "▶";   // ▶
const PAUSE_GLYPH = "⏸";  // ⏸
const REWIND_GLYPH = "⏮"; // ⏮

export class AuditionBar {
    /**
     * @param {HTMLElement} container  The canvas area (position: relative) to overlay.
     */
    constructor(container) {
        this.container = container;
        /** @type {Array<() => void>} */
        this._mutateListeners = [];
        /** @type {Array<() => void>} */
        this._rewindListeners = [];
        /** @type {Array<() => void>} */
        this._playPauseListeners = [];
        /** @type {HTMLInputElement | null} */
        this._beatsInput = null;
        /** @type {HTMLButtonElement | null} */
        this._playPauseBtn = null;
        /** Whether the audition is currently playing (button shows ⏸). */
        this._playing = false;
        /** @type {HTMLElement | null} */
        this._bar = null;
        // Hidden by default: the floating bar appears only when the
        // user turns it on via the toolbar's Audition toggle. A fresh
        // score loads with no audition bar and no audition running.
        this._visible = false;
        this._render();
    }

    /**
     * Subscribe to Mutate clicks (advance the variation).
     * @param {() => void} cb
     */
    onMutate(cb) {
        this._mutateListeners.push(cb);
    }

    /**
     * Subscribe to Rewind clicks (restart the current variation from
     * the beginning).
     * @param {() => void} cb
     */
    onRewind(cb) {
        this._rewindListeners.push(cb);
    }

    /**
     * Subscribe to Play/Pause clicks. The callback decides what to do
     * based on the current play state (start the looping audition, or
     * pause it); it should call setPlaying to reflect the new state.
     * @param {() => void} cb
     */
    onPlayPause(cb) {
        this._playPauseListeners.push(cb);
    }

    /**
     * The current pass / loop length N, in master-clock beats. An
     * integer of at least 1; falls back to the default when the
     * field is empty or unparseable.
     * @returns {number}
     */
    getBeats() {
        if (this._beatsInput === null) return DEFAULT_BEATS;
        const n = Math.round(Number(this._beatsInput.value));
        if (!Number.isFinite(n) || n < 1) return DEFAULT_BEATS;
        return n;
    }

    /** @returns {boolean} Whether the audition is currently playing. */
    isPlaying() {
        return this._playing;
    }

    /**
     * Reflect the audition play state on the Play/Pause button: ⏸ (a
     * pause glyph) while playing, ▶ (a play triangle) while stopped.
     * Purely visual — callers own the actual transport.
     * @param {boolean} playing
     */
    setPlaying(playing) {
        this._playing = playing;
        if (this._playPauseBtn !== null) {
            this._playPauseBtn.textContent = playing ? PAUSE_GLYPH : PLAY_GLYPH;
            this._playPauseBtn.setAttribute(
                "aria-label", playing ? "Pause" : "Play");
        }
    }

    /**
     * Briefly flash the Play/Pause button to signal that the loop just
     * restarted, so the user can see each repeat while listening
     * continuously. Re-triggerable: the animation class is removed and
     * re-added (with a reflow between) so a flash can fire every loop.
     */
    flashLoopRestart() {
        const btn = this._playPauseBtn;
        if (btn === null) return;
        btn.classList.remove("audition-loop-flash");
        // Force a reflow so removing then re-adding restarts the CSS
        // animation rather than being coalesced into a no-op.
        void btn.offsetWidth;
        btn.classList.add("audition-loop-flash");
    }

    /** @returns {boolean} */
    isVisible() {
        return this._visible;
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        this._visible = visible;
        if (this._bar !== null) {
            this._bar.classList.toggle("hidden", !visible);
        }
    }

    show() { this.setVisible(true); }
    hide() { this.setVisible(false); }

    /** Flip visibility; returns the new state. @returns {boolean} */
    toggle() {
        this.setVisible(!this._visible);
        return this._visible;
    }

    _emitMutate() {
        for (const cb of this._mutateListeners) {
            try { cb(); } catch (err) { console.error("GXW: audition mutate listener threw.", err); }
        }
    }

    _emitRewind() {
        for (const cb of this._rewindListeners) {
            try { cb(); } catch (err) { console.error("GXW: audition rewind listener threw.", err); }
        }
    }

    _emitPlayPause() {
        for (const cb of this._playPauseListeners) {
            try { cb(); } catch (err) { console.error("GXW: audition play/pause listener threw.", err); }
        }
    }

    _render() {
        const bar = document.createElement("div");
        bar.className = "audition-bar";
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", "Audition");
        bar.classList.toggle("hidden", !this._visible);

        // Beats field (the pass / loop length N).
        const beatsLabel = document.createElement("label");
        beatsLabel.className = "audition-field";
        const beatsText = document.createElement("span");
        beatsText.className = "audition-field-label";
        beatsText.textContent = "Beats";
        beatsLabel.appendChild(beatsText);
        const beatsInput = document.createElement("input");
        beatsInput.type = "number";
        beatsInput.className = "audition-beats";
        beatsInput.min = "1";
        beatsInput.step = "1";
        beatsInput.value = String(DEFAULT_BEATS);
        beatsInput.setAttribute("aria-label", "Audition length in beats");
        beatsLabel.appendChild(beatsInput);
        this._beatsInput = beatsInput;
        bar.appendChild(beatsLabel);

        // Mutate — advance the variation. One finite pass when Loop
        // is off; changes the upcoming looped pattern when Loop is on.
        const mutateBtn = document.createElement("button");
        mutateBtn.type = "button";
        mutateBtn.className = "audition-btn audition-mutate";
        mutateBtn.textContent = "Mutate";
        mutateBtn.title = "Mutate. Advance to the next variation and restart immediately. With Loop off, plays one finite pass of the set number of beats then stops. With Loop on, the new variation keeps looping until Mutate is pressed again.";
        mutateBtn.addEventListener("click", () => this._emitMutate());
        bar.appendChild(mutateBtn);

        // Rewind — restart the current variation from the beginning.
        // Sits just left of Play/Pause.
        const rewindBtn = document.createElement("button");
        rewindBtn.type = "button";
        rewindBtn.className = "audition-btn audition-rewind";
        rewindBtn.textContent = REWIND_GLYPH;
        rewindBtn.setAttribute("aria-label", "Rewind");
        rewindBtn.title = "Rewind. Reset the current variation to the beginning and play it again from the start.";
        rewindBtn.addEventListener("click", () => this._emitRewind());
        bar.appendChild(rewindBtn);

        // Play / Pause — play the current variation looping (it repeats
        // every N beats), or pause it immediately. The glyph toggles
        // ▶ ⇄ ⏸ via setPlaying; it also flashes on each loop restart.
        const playPauseBtn = document.createElement("button");
        playPauseBtn.type = "button";
        playPauseBtn.className = "audition-btn audition-playpause";
        playPauseBtn.textContent = PLAY_GLYPH;
        playPauseBtn.setAttribute("aria-label", "Play");
        playPauseBtn.title = "Play / Pause. Play the current variation looping (it repeats every set number of beats, flashing on each restart); pause stops it immediately.";
        playPauseBtn.addEventListener("click", () => this._emitPlayPause());
        this._playPauseBtn = playPauseBtn;
        bar.appendChild(playPauseBtn);

        // Reserved slot for a future "move to curated list" capture
        // button — leave room, do not build it now. (Capture will
        // store the underlying seed as the pattern's key; the user
        // never sees the number.)
        const reserved = document.createElement("div");
        reserved.className = "audition-capture-reserved";
        reserved.setAttribute("aria-hidden", "true");
        bar.appendChild(reserved);

        this._bar = bar;
        this.container.appendChild(bar);
    }
}
