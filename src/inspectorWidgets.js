
/**
 * Programmatically select every character inside a
 * contenteditable element. Used by wireFocusSelect's tab-
 * focus path so a tabbed-into field's first keystroke
 * replaces the existing value the way a standard input
 * element behaves on tab. Mouse-origin focus skips this
 * via wireFocusSelect's mousedown-flag mechanism, so a
 * single click positions the caret precisely where the
 * user clicked and they can edit in place.
 *
 * @param {HTMLElement} el
 */
export function selectAllInElement(el) {
    const sel = window.getSelection();
    if (sel === null) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
}

/**
 * Wire mouse-aware focus-and-select behaviour on a
 * contenteditable field. Focus arriving via mouse leaves
 * the caret at the click position (browser default on
 * mouseup) and skips the select-all, so a single click
 * positions the caret where the user clicked. Focus
 * arriving via keyboard tab still selects-all so the
 * first keystroke replaces the existing value, matching
 * standard <input> tab behaviour. Double-click selects
 * the word under the pointer via browser default; triple-
 * click selects the full field.
 *
 * Detects mouse-origin focus via a mousedown listener
 * that sets a flag when the element isn't yet the
 * active element. The focus listener checks the flag,
 * skips select-all and clears the flag when set, and
 * otherwise selects all. A blur listener clears the flag
 * for safety in case a drag-off ever loses the mouseup.
 *
 * The optional onFocus callback runs first on every focus
 * regardless of origin, used by the Slot field to clear
 * its placeholder text before any select-all decision.
 *
 * @param {HTMLElement} el
 * @param {{ onFocus?: () => void }} [opts]
 */
export function wireFocusSelect(el, opts = {}) {
    let mouseFocusing = false;
    el.addEventListener("mousedown", () => {
        if (document.activeElement !== el) mouseFocusing = true;
    });
    el.addEventListener("focus", () => {
        if (opts.onFocus !== undefined) opts.onFocus();
        if (mouseFocusing) {
            mouseFocusing = false;
            return;
        }
        selectAllInElement(el);
    });
    el.addEventListener("blur", () => { mouseFocusing = false; });
}

/**
 * Wrap a numeric editable field in a container that holds
 * the field plus a two-button spinner band on the right.
 * The wrapper carries the green border and lighter-grey
 * fill that the standalone field would have had; the
 * field inside has its border and fill suppressed so the
 * field + spinner read visually as one bordered control.
 * The wrapper exists as a sibling of the spinner so the
 * spinner's pointer events don't sit inside the
 * contenteditable, which would risk the browser placing
 * the caret at the spinner on click.
 *
 * Spinner behaviour. Each half (upper for increment,
 * lower for decrement) is the full click target; the
 * visible green button graphics are CSS pseudo-elements
 * centred in each half, so the hit area extends well
 * beyond the visible button. pointerdown steps once
 * immediately, then after 500 ms starts auto-repeating at
 * 60 ms intervals until pointerup. The field's textContent
 * updates live on every step so the user sees the value
 * scrubbing; the emit to the scene fires only on
 * pointerup (default) or on every step (spinLive: true,
 * used by Position so the canvas tracks the object's
 * location live during a scrub).
 *
 * Step size is controlled by opts.spinStep, defaulting to
 * 0.1 for floats. Integer-typed fields override to
 * opts.spinStep = 1, which stepOnce detects via
 * Number.isInteger and rounds accordingly so successive
 * increments don't drift off integer values — the
 * mechanism that made the previous wheel-handler's 0.3 /
 * 0.1 precision incompatible with integer fields.
 * Out-of-bounds candidates (validator returns "hard")
 * silently no-op rather than dimming the button — adding
 * dim-the-button UX would require each numeric field to
 * declare its min/max to the field builder, deferred to a
 * follow-up.
 *
 * Window-level pointerup listeners ensure the press
 * cleanly ends even if a mid-press re-render destroys the
 * spinner half element (which can happen for spinLive
 * fields, since each step emits and triggers
 * applySceneEdit → setScene → _render). The press state
 * lives in closure variables that survive the DOM swap;
 * the destroyed half's textContent reference stays
 * usable because detached elements keep their textContent
 * and the value continues marching from the same base on
 * each tick, while the visible field in the rebuilt panel
 * shows the latest scene-state value.
 *
 * @param {HTMLDivElement} fieldEl  The contenteditable field, already wired.
 * @param {any} opts                 The field's full opts (passed through to stepOnce).
 * @param {Inspector} inspector
 * @returns {HTMLDivElement}
 */
export function wrapNumericFieldWithSpinner(fieldEl, opts, inspector) {
    const wrap = document.createElement("div");
    wrap.className = "insp-field-num-wrap";
    wrap.style.width = `${opts.width}px`;
    wrap.appendChild(fieldEl);

    const spinner = document.createElement("div");
    spinner.className = "insp-spinner";

    const upHalf = document.createElement("div");
    upHalf.className = "insp-spinner-up";
    spinner.appendChild(upHalf);

    const downHalf = document.createElement("div");
    downHalf.className = "insp-spinner-down";
    spinner.appendChild(downHalf);

    wrap.appendChild(spinner);

    const step = typeof opts.spinStep === "number" ? opts.spinStep : 0.1;
    const live = opts.spinLive === true;

    wireSpinnerHalf(upHalf, +1, step, live, fieldEl, opts, inspector);
    wireSpinnerHalf(downHalf, -1, step, live, fieldEl, opts, inspector);

    return wrap;
}

/**
 * Wire one half of a spinner (upper or lower) to drive
 * incremental edits on a numeric field. Handles the
 * pointerdown / pointerup lifecycle, the 500 ms initial
 * delay plus 60 ms repeat interval auto-repeat (no
 * acceleration), and the emit policy (release-only by
 * default, every-step when live is true).
 *
 * preventDefault on pointerdown stops the click from
 * stealing focus away from whatever the user was editing
 * before — clicking a spinner never interrupts text-edit
 * state in a different field. Window-level pointerup and
 * pointercancel listeners ensure the press ends cleanly
 * even if the spinner DOM gets destroyed mid-press by a
 * spinLive emit's re-render.
 *
 * @param {HTMLDivElement} halfEl
 * @param {1 | -1} direction
 * @param {number} step
 * @param {boolean} live
 * @param {HTMLDivElement} fieldEl
 * @param {any} opts
 * @param {Inspector} inspector
 */
export function wireSpinnerHalf(halfEl, direction, step, live, fieldEl, opts, inspector) {
    let pressing = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let initialDelayTimer = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let repeatInterval = null;

    const emit = (/** @type {string} */ value) => {
        if (typeof opts.onCommit === "function") {
            opts.onCommit(value);
        } else if (typeof opts.editKind === "string") {
            inspector._emitEdit({ kind: opts.editKind, value });
        }
    };

    const stepOnce = () => {
        const currentText = fieldEl.textContent ?? "";
        const currentValue = parseFloat(currentText);
        if (!Number.isFinite(currentValue)) return;
        let candidate = currentValue + direction * step;
        if (Number.isInteger(step)) {
            candidate = Math.round(candidate);
        } else {
            // Round to the step's precision so floating-point
            // drift doesn't accumulate across many ticks. For
            // step 0.1 this rounds to one decimal place.
            const precision = 1 / step;
            candidate = Math.round(candidate * precision) / precision;
        }
        const result = opts.validator(String(candidate));
        if (result.kind === "hard") return;
        fieldEl.textContent = result.value;
        if (live) {
            opts.value = result.value;
            emit(result.value);
        }
    };

    const finishPress = () => {
        if (!pressing) return;
        pressing = false;
        if (initialDelayTimer !== null) {
            clearTimeout(initialDelayTimer);
            initialDelayTimer = null;
        }
        if (repeatInterval !== null) {
            clearInterval(repeatInterval);
            repeatInterval = null;
        }
        halfEl.classList.remove("pressing");
        window.removeEventListener("pointerup", finishPress);
        window.removeEventListener("pointercancel", finishPress);
        // Release-only emit for the non-live path. If the
        // value changed during the press, emit once with
        // the final value and update opts.value so a
        // subsequent blur tryCommit doesn't fire a redundant
        // edit. The live path has already emitted per-step
        // so there's nothing left to commit here.
        if (!live) {
            const finalText = fieldEl.textContent ?? "";
            if (finalText !== opts.value) {
                opts.value = finalText;
                emit(finalText);
            }
        }
    };

    halfEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (pressing) return;
        // preventDefault stops the contenteditable field
        // beside us from gaining focus on this click, so a
        // spin doesn't interrupt the user's text-editing
        // state in a different field.
        e.preventDefault();
        pressing = true;
        halfEl.classList.add("pressing");
        // Window-level listeners survive mid-press re-renders
        // that destroy the spinner DOM. For spinLive fields
        // each step triggers applySceneEdit → setScene →
        // _render which clears and rebuilds the whole
        // panel; a half-element-scoped listener would never
        // fire on release.
        window.addEventListener("pointerup", finishPress);
        window.addEventListener("pointercancel", finishPress);
        stepOnce();
        initialDelayTimer = setTimeout(() => {
            initialDelayTimer = null;
            repeatInterval = setInterval(stepOnce, 60);
        }, 500);
    });
}

/**
 * Coerce an arbitrary hex-string-shaped value into the
 * "#rrggbb" format required by native <input type="color">.
 * Native colour inputs reject anything that isn't exactly a
 * leading "#" followed by six lowercase hex digits; passing
 * anything else silently resets the picker's value to
 * "#000000", which would surface as "black" the first time
 * the user opens the picker after an edit landed in a
 * different shape.
 *
 * Accepts an empty string, "#RGB" shorthand, or "#RRGGBB"
 * in any case. Returns the corresponding lowercase 6-digit
 * form, or the supplied fallback when the input is empty or
 * doesn't parse as either shape.
 *
 * @param {string} hex
 * @param {string} fallback
 * @returns {string}
 */
export function normaliseHexForPicker(hex, fallback) {
    if (typeof hex !== "string" || hex.length === 0) return fallback;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
        const r = hex[1], g = hex[2], b = hex[3];
        return ("#" + r + r + g + g + b + b).toLowerCase();
    }
    return fallback;
}

/**
 * Compute the proposed function name for a Band 3 slot
 * row's Create button (and the placeholder hint shown
 * when the field is empty). Convention is
 * slotName_objectId, e.g. onTick_sp_a3f7. The slot keys
 * (hasHit, beenHit, onTick) are valid JS identifiers and
 * the ids are generated as <kind>_<sixhex> which is also
 * identifier-safe, so the joined name passes JS-identifier
 * rules. Returns empty string when the object lacks an
 * id, which the caller treats as no proposed name and
 * disables the Create button accordingly.
 *
 * @param {"collided" | "triggered" | "onTick"} slotKey
 * @param {any} obj
 * @returns {string}
 */
export function proposedFunctionName(slotKey, obj) {
    if (obj === null || typeof obj !== "object") return "";
    const id = typeof obj.id === "string" ? obj.id : "";
    if (id === "") return "";
    return `${slotKey}_${id}`;
}

// --- Field-construction helpers ---
//
// Each helper returns a single DOM element in the .insp-*
// class family. Disabled state means the field stays in
// place but loses its green frame and shows muted text — a
// single visual signal regardless of why the field doesn't
// apply (multi-select restriction, type-irrelevance, locked
// for being read-only, etc.).

/**
 * @returns {HTMLDivElement}
 */
export function mkRow() {
    const r = document.createElement("div");
    r.className = "insp-row";
    return r;
}

/**
 * @param {string} text
 * @param {{ width?: number, disabled?: boolean, multiline?: boolean }} [opts]
 */
export function mkLabel(text, opts = {}) {
    const el = document.createElement("div");
    el.className = "insp-label";
    if (opts.disabled) el.classList.add("disabled");
    if (typeof opts.width === "number") el.style.width = `${opts.width}px`;
    if (opts.multiline) {
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) el.appendChild(document.createElement("br"));
            el.appendChild(document.createTextNode(lines[i]));
        }
    } else {
        el.textContent = text;
    }
    return el;
}

/**
 * @param {{ value?: string, numeric?: boolean, disabled?: boolean, style?: string, width?: number }} opts
 */
export function mkField(opts) {
    const el = document.createElement("div");
    el.className = "insp-field";
    if (opts.numeric) el.classList.add("insp-field-numeric");
    if (opts.disabled) el.classList.add("disabled");
    if (opts.style === "locked") el.classList.add("locked");
    if (typeof opts.width === "number") el.style.width = `${opts.width}px`;
    el.textContent = opts.value ?? "";
    return el;
}

/**
 * @param {{ checked?: boolean, varies?: boolean, disabled?: boolean, onClick?: () => void }} [opts]
 */
export function mkCheckbox(opts = {}) {
    const el = document.createElement("div");
    el.className = "insp-checkbox";
    if (opts.checked) el.classList.add("checked");
    // "varies" is a tri-state for multi-select where the
    // selected objects disagree on this field's value. The
    // checkbox renders distinct from both checked and empty:
    // styled in main.css with a horizontal dash so the
    // divergence reads at a glance.
    if (opts.varies) el.classList.add("varies");
    if (opts.disabled) el.classList.add("disabled");
    if (typeof opts.onClick === "function" && !opts.disabled) {
        el.addEventListener("click", opts.onClick);
    }
    return el;
}

/**
 * @param {string} text
 * @param {{ disabled?: boolean }} [opts]
 */
export function mkUnits(text, opts = {}) {
    const el = document.createElement("span");
    el.className = "insp-units";
    if (opts.disabled) el.classList.add("disabled");
    el.textContent = text;
    return el;
}

/**
 * @param {string} letter
 * @param {{ disabled?: boolean }} [opts]
 */
export function mkInlineLetter(letter, opts = {}) {
    const el = document.createElement("span");
    el.className = "insp-inline-letter";
    if (opts.disabled) el.classList.add("disabled");
    el.textContent = letter;
    return el;
}
