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

export class AuditionBar {
    /**
     * @param {HTMLElement} container  The canvas area (position: relative) to overlay.
     */
    constructor(container) {
        this.container = container;
        /** @type {Array<() => void>} */
        this._mutateListeners = [];
        /** @type {Array<(checked: boolean) => void>} */
        this._loopToggleListeners = [];
        /** @type {HTMLInputElement | null} */
        this._beatsInput = null;
        /** @type {HTMLInputElement | null} */
        this._loopCheckbox = null;
        /** @type {HTMLElement | null} */
        this._bar = null;
        this._visible = true;
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
     * Subscribe to Loop checkbox changes. The callback receives the
     * new checked state (true = looping on).
     * @param {(checked: boolean) => void} cb
     */
    onLoopToggle(cb) {
        this._loopToggleListeners.push(cb);
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

    /** @returns {boolean} */
    isLoopChecked() {
        return this._loopCheckbox !== null && this._loopCheckbox.checked;
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

    /** @param {boolean} checked */
    _emitLoopToggle(checked) {
        for (const cb of this._loopToggleListeners) {
            try { cb(checked); } catch (err) { console.error("GXW: audition loop-toggle listener threw.", err); }
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

        // Loop — a checkbox. Checked = the current pattern loops
        // continually (reset and repeat every N beats); unchecked =
        // a Mutate plays one pass then stops.
        const loopLabel = document.createElement("label");
        loopLabel.className = "audition-check";
        const loopBox = document.createElement("input");
        loopBox.type = "checkbox";
        loopBox.className = "audition-loop";
        loopBox.setAttribute("aria-label", "Loop");
        loopBox.addEventListener("change", () => this._emitLoopToggle(loopBox.checked));
        const loopText = document.createElement("span");
        loopText.className = "audition-check-label";
        loopText.textContent = "Loop";
        loopLabel.appendChild(loopBox);
        loopLabel.appendChild(loopText);
        loopLabel.title = "Loop. When checked, the current pattern repeats every set number of beats (a clean restart each time). Mutate while looping changes the upcoming cycle's variation and keeps looping that.";
        this._loopCheckbox = loopBox;
        bar.appendChild(loopLabel);

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
