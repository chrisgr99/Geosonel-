/**
 * Per-field builders and DOM primitives for the Property
 * Inspector.
 *
 * Sits below inspector.js as the field-construction layer.
 * Each builder returns an HTMLElement that the band methods
 * compose into rows. The builders that emit edits take an
 * Inspector instance as their first argument so they can
 * call inspector._emitEdit(...); the lower-level mk*
 * primitives are pure DOM constructors that don't need the
 * inspector reference.
 *
 * Commit lifecycle (shared by Name, Editable, Color, and
 * Slot fields):
 *   - Hard error: red squiggle. On Enter the field keeps
 *     focus so the user can fix the value; on blur the
 *     field silently reverts to the last-saved value.
 *   - Soft warning: yellow squiggle. The value commits.
 *   - OK: no squiggle. The value commits.
 *   - Wheel scrolling on a numeric field bypasses the
 *     focus-blur double-emit guard because wheel events
 *     don't focus the field.
 *
 * The destruction-blur double-emit guard lives in each
 * builder's tryCommit closure as a `committed` flag. After
 * a successful Enter, the inspector re-renders and the
 * focused element is detached; the browser fires a stray
 * blur on the detached node which would otherwise re-emit
 * the same edit. The flag stops the second emit.
 */

// @ts-check

import {
    validateName,
    collectOtherNames,
    nameConflictsInScene,
} from "./nameValidation.js";
import {
    validateHexColor,
    validateFunctionName,
} from "./pathFieldValidation.js";
import {
    editKindForSlot,
    proposedFunctionName,
} from "./inspectorSelection.js";

// --- Editable field ---

/**
 * Build an editable field with arbitrary validation. Used
 * by Band 2 (Position, Path Size, Cursor R/L, thicknesses,
 * Sprite Size). Each call site supplies a validator plus
 * either an editKind tag identifying the edit OR an onCommit
 * callback that receives the validated value and emits
 * whatever edit shape it likes — used by Position
 * (translateSelection with computed delta) and Path W/H
 * (setSizeAxis with computed factor) where the edit isn't a
 * simple field-equals-value commit.
 *
 * Multi-select edits propagate the validated value to every
 * member of the appropriate selection slice via the matching
 * sceneEditor function. The varies-blank case renders an
 * empty field; for fields where editing varies has well-
 * defined semantics (set all to the typed value) the call
 * site passes editable=true; for fields where varies-edit is
 * ambiguous the call site passes editable=false so the field
 * is locked.
 *
 * @param {import("./inspector.js").Inspector} inspector
 * @param {{
 *   value: string,
 *   width: number,
 *   numeric?: boolean,
 *   editable: boolean,
 *   validator: (candidate: string) => { kind: "ok" | "soft" | "hard", value: string, message?: string },
 *   editKind?: string,
 *   onCommit?: (value: string) => void,
 *   wheelStep?: number,
 *   wheelPrecision?: number,
 * }} opts
 * @returns {HTMLDivElement}
 */
export function buildEditableField(inspector, opts) {
    const el = document.createElement("div");
    el.className = "insp-field";
    if (opts.numeric) el.classList.add("insp-field-numeric");
    el.style.width = `${opts.width}px`;

    if (!opts.editable) {
        el.classList.add("disabled");
        el.textContent = opts.value;
        return el;
    }

    el.setAttribute("contenteditable", "plaintext-only");
    el.setAttribute("spellcheck", "false");
    el.textContent = opts.value;

    // Numeric fields support scroll-wheel adjustment.
    // Default step is 0.3 with rounding to 0.1 precision
    // (10x finer than the step so floating-point drift
    // doesn't accumulate); fields that want a finer or
    // coarser scrub override via wheelStep and
    // wheelPrecision (Phase uses 0.01 / 0.01, for
    // example). Wheel events bypass the keyboard commit's
    // destruction-blur guard because wheel doesn't focus
    // the field.
    if (opts.numeric) {
        const wheelStep = opts.wheelStep ?? 0.3;
        const wheelPrecision = opts.wheelPrecision ?? 0.1;
        const wheelMultiplier = 1 / wheelPrecision;
        el.addEventListener("wheel", (e) => {
            if (document.activeElement === el) return;
            const currentText = el.textContent ?? "";
            const currentValue = parseFloat(currentText);
            if (!Number.isFinite(currentValue)) return;
            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            const newValue = currentValue + direction * wheelStep;
            const rounded = Math.round(newValue * wheelMultiplier) / wheelMultiplier;
            const result = opts.validator(String(rounded));
            if (result.kind === "hard") return;
            el.textContent = result.value;
            // Update opts.value so a subsequent click-blur
            // doesn't fire a redundant tryCommit emit.
            opts.value = result.value;
            if (typeof opts.onCommit === "function") {
                opts.onCommit(result.value);
            } else if (typeof opts.editKind === "string") {
                inspector._emitEdit({ kind: opts.editKind, value: result.value });
            }
        }, { passive: false });
    }

    el.addEventListener("focus", () => selectAllInElement(el));

    let committed = false;

    const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
        const candidate = el.textContent ?? "";
        const result = opts.validator(candidate);
        if (result.kind === "hard") {
            if (mode === "blur") {
                el.textContent = opts.value;
                el.classList.remove("error-hard", "error-soft");
                return;
            }
            el.classList.remove("error-soft");
            el.classList.add("error-hard");
            return;
        }
        el.classList.remove("error-hard");
        if (result.kind === "soft") el.classList.add("error-soft");
        else el.classList.remove("error-soft");
        if (committed) return;
        if (result.value !== opts.value) {
            committed = true;
            if (typeof opts.onCommit === "function") {
                opts.onCommit(result.value);
            } else if (typeof opts.editKind === "string") {
                inspector._emitEdit({ kind: opts.editKind, value: result.value });
            }
        }
    };

    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            tryCommit("enter");
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            el.textContent = opts.value;
            el.classList.remove("error-hard", "error-soft");
            el.blur();
            return;
        }
        if (el.classList.contains("error-hard")) {
            queueMicrotask(() => el.classList.remove("error-hard"));
        }
    });
    el.addEventListener("blur", () => tryCommit("blur"));

    return el;
}

// --- Name field ---

/**
 * Build the Name field for Band 1. Validates against the
 * JS-identifier rule, the reserved-word list, and the
 * generated-id pattern; surfaces a soft yellow squiggle on
 * names that already exist on another object in the scene.
 *
 * @param {import("./inspector.js").Inspector} inspector
 * @param {{ value: string, editable: boolean, conflict: boolean, objId: string | null, width: number }} opts
 * @returns {HTMLDivElement}
 */
export function buildNameField(inspector, opts) {
    const el = document.createElement("div");
    el.className = "insp-field";
    el.style.width = `${opts.width}px`;

    if (!opts.editable) {
        el.classList.add("disabled");
        el.textContent = opts.value;
        return el;
    }

    el.setAttribute("contenteditable", "plaintext-only");
    el.setAttribute("spellcheck", "false");
    el.textContent = opts.value;
    if (opts.conflict) el.classList.add("error-soft");

    el.addEventListener("focus", () => selectAllInElement(el));

    let committed = false;

    const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
        const candidate = el.textContent ?? "";
        const otherNames = collectOtherNames(inspector._scene, opts.objId);
        const result = validateName(candidate, otherNames);
        if (result.kind === "hard") {
            if (mode === "blur") {
                el.textContent = opts.value;
                el.classList.remove("error-hard", "error-soft");
                if (opts.conflict) el.classList.add("error-soft");
                return;
            }
            el.classList.remove("error-soft");
            el.classList.add("error-hard");
            return;
        }
        el.classList.remove("error-hard");
        if (result.kind === "soft") el.classList.add("error-soft");
        else el.classList.remove("error-soft");
        if (committed) return;
        if (result.value !== opts.value) {
            committed = true;
            inspector._emitEdit({ kind: "setName", value: result.value });
        }
    };

    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            tryCommit("enter");
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            el.textContent = opts.value;
            el.classList.remove("error-hard", "error-soft");
            if (opts.conflict) el.classList.add("error-soft");
            el.blur();
            return;
        }
        if (el.classList.contains("error-hard")) {
            queueMicrotask(() => el.classList.remove("error-hard"));
        }
    });
    el.addEventListener("blur", () => tryCommit("blur"));

    return el;
}

// --- Color field ---

/**
 * Build the Band 2 Color field — a colour swatch followed
 * by an editable hex string. The swatch updates live as the
 * user types valid hex; the commit lifecycle mirrors
 * buildEditableField but is duplicated here because the
 * field's structure is two-part rather than a single
 * contenteditable.
 *
 * @param {import("./inspector.js").Inspector} inspector
 * @param {{ hex: string, editable: boolean, varies: boolean }} opts
 * @returns {HTMLDivElement}
 */
export function buildColorField(inspector, opts) {
    const el = document.createElement("div");
    el.className = "insp-color";
    if (!opts.editable) el.classList.add("disabled");

    const placeholderColour = "#444444";
    const initialHex = opts.hex || "";

    const swatch = document.createElement("div");
    swatch.className = "insp-color-swatch";
    swatch.style.backgroundColor = initialHex || placeholderColour;
    el.appendChild(swatch);

    const text = document.createElement("div");
    text.className = "insp-color-text";

    if (!opts.editable) {
        text.textContent = initialHex.toUpperCase();
        el.appendChild(text);
        return el;
    }

    text.setAttribute("contenteditable", "plaintext-only");
    text.setAttribute("spellcheck", "false");
    text.textContent = initialHex.toUpperCase();
    text.addEventListener("focus", () => selectAllInElement(text));

    let committed = false;

    const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
        const candidate = text.textContent ?? "";
        const result = validateHexColor(candidate);
        if (result.kind === "hard") {
            if (mode === "blur") {
                text.textContent = initialHex.toUpperCase();
                text.classList.remove("error-hard", "error-soft");
                swatch.style.backgroundColor = initialHex || placeholderColour;
                return;
            }
            text.classList.remove("error-soft");
            text.classList.add("error-hard");
            return;
        }
        text.classList.remove("error-hard");
        if (result.kind === "soft") text.classList.add("error-soft");
        else text.classList.remove("error-soft");
        if (committed) return;
        if (result.value !== initialHex) {
            committed = true;
            inspector._emitEdit({ kind: "setColor", value: result.value });
        }
    };

    text.addEventListener("input", () => {
        const candidate = text.textContent ?? "";
        const result = validateHexColor(candidate);
        if (result.kind !== "hard") {
            swatch.style.backgroundColor = result.value;
        }
        if (text.classList.contains("error-hard")) {
            queueMicrotask(() => text.classList.remove("error-hard"));
        }
    });
    text.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            tryCommit("enter");
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            text.textContent = initialHex.toUpperCase();
            text.classList.remove("error-hard", "error-soft");
            swatch.style.backgroundColor = initialHex || placeholderColour;
            text.blur();
            return;
        }
    });
    text.addEventListener("blur", () => tryCommit("blur"));

    el.appendChild(text);
    return el;
}

// --- Slot field (Band 3) ---

/**
 * Build a slot field for one Band 3 row. Mirrors the commit
 * lifecycle of buildEditableField with placeholder-hint
 * display: when the field is empty and unfocused, the
 * proposed function name shows in muted text. Focus clears
 * the placeholder for editing; blur restores it iff the
 * field is empty.
 *
 * @param {import("./inspector.js").Inspector} inspector
 * @param {{
 *   value: string,
 *   placeholder: string,
 *   width: number,
 *   editable: boolean,
 *   slotKey: string,
 *   kind: "path" | "sprite" | null,
 * }} opts
 * @returns {HTMLDivElement}
 */
export function buildSlotField(inspector, opts) {
    const el = document.createElement("div");
    el.className = "insp-field insp-slot-field";
    el.style.width = `${opts.width}px`;

    if (!opts.editable) {
        el.classList.add("disabled");
        el.textContent = opts.value;
        return el;
    }

    el.setAttribute("contenteditable", "plaintext-only");
    el.setAttribute("spellcheck", "false");

    const showPlaceholder = () => {
        el.textContent = opts.placeholder;
        el.classList.add("placeholder-shown");
    };
    const clearPlaceholder = () => {
        el.textContent = "";
        el.classList.remove("placeholder-shown");
    };
    if (opts.value !== "") {
        el.textContent = opts.value;
    } else if (opts.placeholder !== "") {
        showPlaceholder();
    }

    el.addEventListener("focus", () => {
        if (el.classList.contains("placeholder-shown")) clearPlaceholder();
        else selectAllInElement(el);
    });

    let committed = false;
    const editKind = editKindForSlot(opts.slotKey);

    const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
        const candidate = el.textContent ?? "";
        const result = validateFunctionName(candidate);
        if (result.kind === "hard") {
            if (mode === "blur") {
                el.classList.remove("error-hard", "error-soft");
                if (opts.value !== "") el.textContent = opts.value;
                else if (opts.placeholder !== "") showPlaceholder();
                else el.textContent = "";
                return;
            }
            el.classList.remove("error-soft");
            el.classList.add("error-hard");
            return;
        }
        el.classList.remove("error-hard");
        if (result.kind === "soft") el.classList.add("error-soft");
        else el.classList.remove("error-soft");
        if (committed) return;
        if (result.value !== opts.value) {
            committed = true;
            inspector._emitEdit({ kind: editKind, value: result.value });
        }
    };

    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            tryCommit("enter");
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            el.classList.remove("error-hard", "error-soft");
            if (opts.value !== "") el.textContent = opts.value;
            else if (opts.placeholder !== "") showPlaceholder();
            else el.textContent = "";
            el.blur();
            return;
        }
        if (el.classList.contains("error-hard")) {
            queueMicrotask(() => el.classList.remove("error-hard"));
        }
    });
    el.addEventListener("blur", () => {
        tryCommit("blur");
        if (
            el.textContent === "" &&
            !el.classList.contains("error-hard") &&
            opts.placeholder !== ""
        ) {
            showPlaceholder();
        }
    });

    return el;
}

/**
 * Build the slot button for one Band 3 row. Carries one of
 * two labels — Create when the proposed function name doesn't
 * yet exist in behaviors.js, or Go-to when it does. The
 * action picks at click time based on what the field
 * actually contains.
 *
 * @param {import("./inspector.js").Inspector} inspector
 * @param {{
 *   disabled: boolean,
 *   label: string,
 *   slotKey: string,
 *   kind: "path" | "sprite" | null,
 *   obj: any,
 * }} opts
 */
export function buildSlotCreateButton(inspector, opts) {
    const el = document.createElement("button");
    el.className = "insp-btn-create";
    if (opts.disabled) el.classList.add("disabled");
    el.textContent = opts.label;
    if (opts.disabled || opts.kind === null || opts.obj === null) return el;

    el.addEventListener("click", () => {
        const fieldEl = el.previousElementSibling;
        let typed = "";
        if (
            fieldEl instanceof HTMLElement &&
            !fieldEl.classList.contains("placeholder-shown")
        ) {
            typed = (fieldEl.textContent ?? "").trim();
        }
        const placeholder = proposedFunctionName(opts.slotKey, opts.kind, opts.obj);
        const proposed = typed.length > 0 ? typed : placeholder;
        if (proposed.length === 0) return;

        const result = validateFunctionName(proposed);
        if (result.kind === "hard") return;
        const name = result.value;

        if (functionExistsInScene(inspector, name)) {
            inspector._emitEdit({ kind: "goToFunction", functionName: name });
            return;
        }
        inspector._emitEdit({
            kind: "createFunctionStub",
            slotKey: opts.slotKey,
            objectKind: opts.kind,
            proposedName: name,
        });
    });
    return el;
}

/**
 * Whether a top-level function with the given name already
 * exists in the current scene's functionMap. Used by the
 * Create-vs-Go-to gate. A null scene or empty name treats
 * the function as not-existing.
 *
 * @param {import("./inspector.js").Inspector} inspector
 * @param {string} name
 * @returns {boolean}
 */
export function functionExistsInScene(inspector, name) {
    if (inspector._scene === null || name === "") return false;
    return Object.prototype.hasOwnProperty.call(
        inspector._scene.functionMap, name,
    );
}

// --- DOM primitives ---

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
 * Static (read-only) field display. Used for the locked-state
 * Object ID field in Band 1 and for any place a value should
 * show without being edited.
 *
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
 * Tri-state checkbox: checked / unchecked / varies. The
 * varies state styles distinct from both checked and empty
 * so multi-select divergence reads at a glance.
 *
 * @param {{ checked?: boolean, varies?: boolean, disabled?: boolean, onClick?: () => void }} [opts]
 */
export function mkCheckbox(opts = {}) {
    const el = document.createElement("div");
    el.className = "insp-checkbox";
    if (opts.checked) el.classList.add("checked");
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

/**
 * Programmatically select every character inside a
 * contenteditable element. Used by the editable field
 * builders on focus, so that the user's first keystroke
 * replaces the existing value the way a standard <input>
 * behaves.
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
