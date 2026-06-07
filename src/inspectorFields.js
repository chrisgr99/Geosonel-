import {
    validateHexColor,
} from "./curveFieldValidation.js";
import {
    W,
} from "./inspectorShared.js";
import {
    normaliseHexForPicker,
    wireFocusSelect,
    wrapNumericFieldWithSpinner,
} from "./inspectorWidgets.js";
import {
    collectOtherNames,
    validateName,
} from "./nameValidation.js";

export const fieldMethods = {

    /**
     * Translate a boolean checkbox click (the Hide field or a
     * Can-X gate) into the appropriate edit. The varies state
     * (multi-select with divergent values) resolves to true —
     * the declarative "do this thing" outcome — so the click
     * commits the whole selection to a uniform on state. Other
     * states toggle. (The object's three-state `state` field is
     * a separate dropdown control, not routed through here.)
     *
     * @param {"setHide" | "setCanCollide" | "setCanBeTriggered" | "setCanTick"} kind
     * @param {boolean | "varies"} currentState
     */
    _onBooleanCheckboxClick(kind, currentState) {
        const newValue = (currentState === "varies") ? true : !currentState;
        this._emitEdit({ kind, value: newValue });
    },

    /**
     * Build the Name field. When editable (single-select),
     * the field is contenteditable and wires keydown and
     * blur handlers for commit and validation; when not
     * editable (multi-select), it's a plain greyed display.
     *
     * Validation outcomes:
     *   - ok: clear any error class; emit a setName edit
     *     (which triggers runScene and a re-render).
     *   - soft (duplicate name): same commit as ok, but add
     *     the error-soft class so a yellow squiggle persists
     *     under the name until the user resolves the
     *     duplicate.
     *   - hard (invalid identifier, reserved word, reserved
     *     id-format pattern): on Enter, add error-hard for
     *     the red squiggle and keep focus so the user can
     *     fix it; on blur, silently revert to the saved
     *     value so an abandoned attempt doesn't carry
     *     invalid state across navigations.
     *
     * Initial render shows the saved value with error-soft
     * applied iff the saved name conflicts with another
     * object's name in the scene.
     *
     * @param {{ value: string, editable: boolean, conflict: boolean, objId: string | null, width?: number }} opts
     * @returns {HTMLDivElement}
     */
    _buildNameField(opts) {
        const el = document.createElement("div");
        el.className = "insp-field";
        el.style.width = `${opts.width ?? W.name}px`;

        if (!opts.editable) {
            el.classList.add("disabled");
            el.textContent = opts.value;
            return el;
        }

        el.setAttribute("contenteditable", "plaintext-only");
        el.setAttribute("spellcheck", "false");
        el.textContent = opts.value;
        if (opts.conflict) el.classList.add("error-soft");

        // Mouse-aware focus selection: mouse-origin focus
        // leaves the caret at the click position, tab-origin
        // focus selects-all so the first keystroke replaces
        // the value the way a standard input element does
        // on tab.
        wireFocusSelect(el);

        // Track whether this field has already emitted its
        // edit. After an Enter or successful blur commit,
        // applySceneEdit's async runScene chain eventually
        // calls inspector.setScene which clears innerHTML;
        // the focused element is detached and the browser
        // fires a blur event on the detached element. That
        // blur runs tryCommit("blur") which would compute
        // the same typed-versus-original difference and emit
        // a second edit — producing visible double-application
        // of dx/dy translates and double-multiplication of
        // scale factors. The flag stops the second emit. The
        // flag is per-closure so a fresh field after re-render
        // starts uncommitted.
        let committed = false;

        const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
            const candidate = el.textContent ?? "";
            const otherNames = collectOtherNames(this._scene, opts.objId);
            const result = validateName(candidate, otherNames);
            if (result.kind === "hard") {
                if (mode === "blur") {
                    // Silently revert: an abandoned bad name
                    // shouldn't carry invalid state forward.
                    el.textContent = opts.value;
                    el.classList.remove("error-hard", "error-soft");
                    if (opts.conflict) el.classList.add("error-soft");
                    return;
                }
                el.classList.remove("error-soft");
                el.classList.add("error-hard");
                return;
            }
            // ok or soft — commit if the trimmed value differs
            // from what's currently saved.
            el.classList.remove("error-hard");
            if (result.kind === "soft") {
                el.classList.add("error-soft");
            } else {
                el.classList.remove("error-soft");
            }
            if (committed) return;
            if (result.value !== opts.value) {
                committed = true;
                this._emitEdit({ kind: "setName", value: result.value });
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
            // Any other keystroke should clear a hard-error
            // squiggle so the user can see their edits as
            // they fix the name. queueMicrotask runs after
            // the character is inserted so the squiggle
            // disappears in step with the user's typing.
            if (el.classList.contains("error-hard")) {
                queueMicrotask(() => {
                    el.classList.remove("error-hard");
                });
            }
        });
        el.addEventListener("blur", () => {
            tryCommit("blur");
        });

        return el;
    },

    /**
     * Build an editable field with arbitrary validation. Used
     * by every editable field in Band 2 (Position, sizes,
     * cursor extents, thicknesses, curve W/H). Each call site
     * supplies a validator function from
     * curveFieldValidation.js plus either an editKind tag
     * identifying the edit OR an onCommit callback that
     * receives the validated value and emits whatever edit
     * shape it likes — used by Position (setPositionAxis with
     * computed value) and curve W/H (setSizeAxis with
     * computed value) where the edit isn't a simple
     * field-equals-value commit. The rest of the commit
     * lifecycle — hard error red squiggle on Enter with focus
     * retained, hard error silent revert on blur, soft warning
     * yellow squiggle on commit, ok commit — mirrors the Name
     * field's behaviour.
     *
     * Multi-select edits propagate the validated value to
     * every member of the appropriate selection slice via the
     * matching sceneEditor function. The varies-blank case
     * renders an empty field; for fields where editing varies
     * has well-defined semantics (set all to the typed value)
     * the call site passes editable=true; for fields where
     * varies-edit is ambiguous (Position, curve W/H) the call
     * site passes editable=false so the field is locked.
     *
     * @param {{
     *   value: string,
     *   width: number,
     *   numeric?: boolean,
     *   editable: boolean,
     *   validator: (candidate: string) => { kind: "ok" | "soft" | "hard", value: string, message?: string },
     *   editKind?: string,
     *   onCommit?: (value: string) => void,
     *   selectOnFocus?: boolean,
     * }} opts
     * @returns {HTMLDivElement}
     */
    _buildEditableField(opts) {
        const el = document.createElement("div");
        el.className = "insp-field";
        if (opts.numeric) el.classList.add("insp-field-numeric");

        if (!opts.editable) {
            el.classList.add("disabled");
            el.style.width = `${opts.width}px`;
            el.textContent = opts.value;
            return el;
        }

        el.setAttribute("contenteditable", "plaintext-only");
        el.setAttribute("spellcheck", "false");
        el.textContent = opts.value;

        // Focus selection. Mouse focus leaves the caret at
        // the click position so a single click positions
        // the caret where the user clicked and the user can
        // edit in place; tab focus still selects-all so the
        // first keystroke replaces the existing value, the
        // way a standard input element does on tab. Double-
        // click selects the word under the pointer via
        // browser default; triple-click selects the full
        // field. selectOnFocus: false skips both — used by
        // multi-token fields like cycleSpeeds where editing
        // one entry in place is the normal case.
        if (opts.selectOnFocus !== false) {
            wireFocusSelect(el);
        }

        // See _buildNameField for the rationale behind this
        // flag. The destruction-blur double-commit problem
        // is most visible here because Position emits
        // setPositionAxis (absolute) and Curve W/H emits
        // setSizeAxis (absolute) — a double-application of
        // either is functionally idempotent for absolute
        // semantics but the flag keeps the emit chain clean.
        let committed = false;

        const tryCommit = (/** @type {"enter" | "blur"} */ mode) => {
            const candidate = el.textContent ?? "";
            const result = opts.validator(candidate);
            if (result.kind === "hard") {
                if (mode === "blur") {
                    // Silently revert: an abandoned bad value
                    // shouldn't carry invalid state forward.
                    el.textContent = opts.value;
                    el.classList.remove("error-hard", "error-soft");
                    return;
                }
                el.classList.remove("error-soft");
                el.classList.add("error-hard");
                return;
            }
            el.classList.remove("error-hard");
            if (result.kind === "soft") {
                el.classList.add("error-soft");
            } else {
                el.classList.remove("error-soft");
            }
            // Canonicalise the visible text to the validated
            // value so a normalisation that leaves the stored
            // value unchanged is still reflected in the field.
            // Without this, a fold the validator applies (the
            // Speeds field dropping entries past a zero, or
            // trailing whitespace) would linger on screen,
            // since no edit emits and so no re-render lands.
            if ((el.textContent ?? "") !== result.value) {
                el.textContent = result.value;
            }
            if (committed) return;
            if (result.value !== opts.value) {
                committed = true;
                if (typeof opts.onCommit === "function") {
                    opts.onCommit(result.value);
                } else if (typeof opts.editKind === "string") {
                    this._emitEdit({ kind: opts.editKind, value: result.value });
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
            // Clear a hard-error squiggle on the next
            // keystroke so the user sees their corrections
            // in step with their typing. queueMicrotask runs
            // after the character is inserted.
            if (el.classList.contains("error-hard")) {
                queueMicrotask(() => {
                    el.classList.remove("error-hard");
                });
            }
        });
        el.addEventListener("blur", () => {
            tryCommit("blur");
        });

        // Numeric editable fields wrap in a container with
        // a two-button spinner band on the right edge. The
        // wrapper takes opts.width; the field shrinks
        // inside to make room for the spinner. Non-numeric
        // editable fields take the width on the field
        // itself, since there's no surrounding chrome.
        if (opts.numeric) {
            return wrapNumericFieldWithSpinner(el, opts, this);
        }
        el.style.width = `${opts.width}px`;
        return el;
    },

    /**
     * Build a native <select> dropdown field. Used by Band
     * 1's Beat Interval control. Native <select> rather
     * than a custom popover gives OS-level keyboard
     * navigation (arrow keys, type-ahead), VoiceOver
     * compatibility, and a popup menu that escapes the
     * inspector pane's clipping without extra code. The
     * .insp-dropdown CSS suppresses the native arrow
     * chrome and paints a custom green chevron so the
     * field reads as a sibling of the inspector's other
     * editable controls.
     *
     * Varies / empty state: pass value = "" to render the
     * dropdown trigger blank. Native <select> leaves the
     * trigger empty when the assigned value doesn't match
     * any <option>, so the empty / divergent case needs
     * no special option in the list; selecting any token
     * from the dropdown then fires the change handler with
     * a real value and the field becomes uniform across
     * the selection.
     *
     * Disabled state: the .disabled class plus the native
     * disabled attribute together suppress the green frame
     * (via CSS), mute the text, and block interaction. The
     * field's footprint stays visible so the row layout
     * doesn't shift when the gate flips.
     *
     * onChange override: when opts.onChange is supplied it runs
     * instead of the default _emitEdit on a change, receiving
     * (selectedValue, selectElement). The Group dropdown uses this
     * to intercept its "New group…" sentinel (prompt for a name)
     * and its "None" value before committing. editKind is then
     * optional. Returning the select element lets the handler
     * reset el.value on a cancelled prompt.
     *
     * @param {{
     *   options: Array<{value: string, label: string}>,
     *   value: string,
     *   width: number,
     *   editable: boolean,
     *   editKind?: string,
     *   onChange?: (value: string, el: HTMLSelectElement) => void,
     * }} opts
     * @returns {HTMLSelectElement}
     */
    _buildDropdownField(opts) {
        const el = document.createElement("select");
        el.className = "insp-dropdown";
        el.style.width = `${opts.width}px`;
        if (!opts.editable) {
            el.classList.add("disabled");
            el.disabled = true;
        }
        for (const tok of opts.options) {
            const option = document.createElement("option");
            option.value = tok.value;
            option.textContent = tok.label;
            el.appendChild(option);
        }
        // Assignment after children are attached so the
        // browser can match value against a real <option>.
        // An unmatched value leaves the trigger blank, which
        // is the varies / empty-state look.
        el.value = opts.value;
        if (opts.editable) {
            el.addEventListener("change", () => {
                if (typeof opts.onChange === "function") {
                    opts.onChange(el.value, el);
                } else {
                    this._emitEdit({ kind: opts.editKind, value: el.value });
                }
            });
        }
        return el;
    },

    /**
     * Build a horizontal radio-button group field. Parallel to
     * _buildDropdownField but renders one native radio input
     * plus its label per option, in options order, on a single
     * row — a single-select control where exactly one radio is
     * checked. Used by Band 1's object State control (Active /
     * Hide Cursor / Disable for curves and sprites; Active /
     * Disable for triggers, since the option list is built from
     * the field's enumValues).
     *
     * Each pair is a <label> with the <input type="radio">
     * nested first, then the label text, so the input sits
     * immediately to the left of its text and the nesting
     * associates the two without needing matched for/id. All
     * radios share opts.name so the browser enforces
     * single-select within the group; the radio whose value
     * equals opts.value is checked. A value that matches no
     * option (the multi-select "varies" / empty state, passed
     * as "") leaves every radio unchecked, mirroring the
     * dropdown's blank trigger.
     *
     * There is no visible field label, so the group carries
     * role="radiogroup" and an aria-label (opts.ariaLabel) so
     * Speak Selection and VoiceOver announce it.
     *
     * Disabled state (empty selection): the inputs are disabled
     * and the group dims, matching the greyed look the other
     * controls use when the row is inactive.
     *
     * On change, emits the same edit the dropdown did:
     * { kind: opts.editKind, value: <chosen option value> }.
     *
     * @param {{
     *   options: Array<{value: string, label: string}>,
     *   value: string,
     *   name: string,
     *   editable: boolean,
     *   editKind: string,
     *   ariaLabel?: string,
     * }} opts
     * @returns {HTMLDivElement}
     */
    _buildRadioGroupField(opts) {
        const group = document.createElement("div");
        group.className = "insp-radio-group";
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", opts.ariaLabel ?? "State");
        group.style.display = "flex";
        group.style.flexDirection = "row";
        group.style.alignItems = "center";
        // Never let the group shrink: when the identity row is
        // wider than the inspector pane, a shrinking flex item
        // would compress these inline-flex labels and wrap their
        // text ("No Cursor" onto two lines). flex-shrink:0 keeps
        // every option on one line.
        group.style.flexShrink = "0";
        if (!opts.editable) {
            group.classList.add("disabled");
            group.style.opacity = "0.5";
        }
        for (let i = 0; i < opts.options.length; i++) {
            const o = opts.options[i];
            const label = document.createElement("label");
            label.className = "insp-radio";
            label.style.display = "inline-flex";
            label.style.alignItems = "center";
            label.style.whiteSpace = "nowrap";
            label.style.flexShrink = "0";
            // Small horizontal gap before each pair after the
            // first, separating one radio-and-label from the next.
            if (i > 0) label.style.marginLeft = "8px";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = opts.name;
            input.value = o.value;
            input.checked = o.value === opts.value;
            // Input immediately to the left of its label text.
            input.style.marginRight = "4px";
            if (!opts.editable) {
                input.disabled = true;
            } else {
                input.addEventListener("change", () => {
                    if (input.checked) {
                        this._emitEdit({ kind: opts.editKind, value: o.value });
                    }
                });
            }
            label.appendChild(input);
            label.appendChild(document.createTextNode(o.label));
            group.appendChild(label);
        }
        return group;
    },

    /**
     * Build the Color field, used by the Band 2 Color row.
     * The field consists of a colour swatch, a hidden native
     * <input type="color"> picker, and an editable hex
     * string. As the user types valid hex into the text
     * portion, the swatch updates live so the user can see
     * the colour they're approaching before they commit.
     * Clicking the swatch opens the OS colour picker (the
     * native input is positioned offscreen but invoked via
     * .click()); a colour committed in the picker fires the
     * picker's change event and emits a setColor edit
     * immediately, just like the text field's Enter commit.
     * Commit and revert lifecycle for the text portion
     * mirrors _buildEditableField but is duplicated here
     * because the field's structure is multi-part (swatch +
     * picker + text) rather than a single contenteditable
     * div.
     *
     * Disabled state (empty selection) shows a dim swatch
     * and the stored hex value as plain text, with the
     * picker omitted entirely so a stray swatch click on a
     * greyed row does nothing. Varies state (multi-select
     * with mismatched colours) shows a placeholder neutral
     * swatch and an empty text field; the picker opens on
     * the placeholder colour, and picking a value commits
     * to every selected object regardless of kind via
     * setColorOnSelection.
     *
     * Picker emit timing: only the change event triggers
     * an emit, not input. The native picker's input event
     * fires continuously as the user drags through colours;
     * emitting on every fire would trigger an inspector
     * re-render that destroys the picker DOM mid-session,
     * collapsing the picker and aborting the pick. The
     * change event fires once per commit (mouseup after
     * drag, or Enter in the picker's hex input), which
     * matches the user's mental model of "I'm done
     * picking" and lets the re-render happen cleanly
     * after the picker closes. The trade-off is no live
     * canvas preview as the user drags, but the picker's
     * own gradient preview gives immediate visual
     * feedback inside the picker UI.
     *
     * @param {{ hex: string, editable: boolean, varies: boolean }} opts
     * @returns {HTMLDivElement}
     */
    _buildColorField(opts) {
        const el = document.createElement("div");
        el.className = "insp-color";
        if (!opts.editable) el.classList.add("disabled");

        // Placeholder colour for empty / varies states keeps
        // the swatch visible as a footprint rather than a
        // hole in the layout.
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

        // Native colour picker, hidden visually but invoked
        // programmatically when the user clicks the swatch.
        // The OS picker gives the user a colour gradient,
        // hue slider, hex input, and (on platforms that
        // support it) an eyedropper without leaving the
        // inspector's footprint. The picker element is
        // sized to 1px with zero opacity so it contributes
        // nothing visually; .click() on a hidden element
        // still opens the picker as long as the element is
        // in the DOM and not display:none.
        //
        // Native colour input accepts and returns
        // "#rrggbb" strings only (lowercase, exactly 7
        // chars). The picker's initial value is normalised
        // to that shape; an empty initial value (varies
        // state) falls back to the placeholder grey so the
        // picker opens on a neutral colour rather than
        // #000000, which would feel like the picker had
        // "lost" the current colour.
        const picker = document.createElement("input");
        picker.type = "color";
        picker.className = "insp-color-picker";
        picker.value = normaliseHexForPicker(initialHex, placeholderColour);
        el.appendChild(picker);

        // Clicking the swatch opens the picker. The cursor
        // change signals the click affordance; the disabled
        // branch above returned before reaching here, so the
        // swatch is always clickable in this code path.
        swatch.style.cursor = "pointer";
        swatch.addEventListener("click", () => {
            picker.click();
        });

        text.setAttribute("contenteditable", "plaintext-only");
        text.setAttribute("spellcheck", "false");
        text.textContent = initialHex.toUpperCase();

        // Mouse-aware focus selection: see _buildNameField.
        wireFocusSelect(text);

        // See _buildNameField for the rationale.
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
            if (result.kind === "soft") {
                text.classList.add("error-soft");
            } else {
                text.classList.remove("error-soft");
            }
            if (committed) return;
            if (result.value !== initialHex) {
                committed = true;
                // Sync the picker so a subsequent open
                // reflects the just-committed colour
                // rather than the original.
                picker.value = normaliseHexForPicker(result.value, placeholderColour);
                this._emitEdit({ kind: "setColor", value: result.value });
            }
        };

        text.addEventListener("input", () => {
            // Live swatch preview while the user types valid
            // hex. Invalid intermediate states (e.g. "#7d")
            // leave the swatch on its previous colour.
            const candidate = text.textContent ?? "";
            const result = validateHexColor(candidate);
            if (result.kind !== "hard") {
                swatch.style.backgroundColor = result.value;
                // Sync the picker to the in-flight typed
                // value too so an open picker (if the user
                // somehow has one) reflects the live state.
                picker.value = normaliseHexForPicker(result.value, placeholderColour);
            }
            if (text.classList.contains("error-hard")) {
                queueMicrotask(() => {
                    text.classList.remove("error-hard");
                });
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
                picker.value = normaliseHexForPicker(initialHex, placeholderColour);
                text.blur();
                return;
            }
        });
        text.addEventListener("blur", () => {
            tryCommit("blur");
        });

        // Picker -> commit. The change event fires once per
        // user commit (mouseup after drag, or Enter in the
        // picker's hex input). See the band docstring above
        // for why we don't wire the input event here.
        picker.addEventListener("change", () => {
            const pickedHex = picker.value;
            const result = validateHexColor(pickedHex);
            if (result.kind === "hard") return;
            // Update the in-place visuals before emitting so
            // the field reads correctly during the brief
            // window before the inspector re-render lands.
            swatch.style.backgroundColor = result.value;
            text.textContent = result.value.toUpperCase();
            text.classList.remove("error-hard", "error-soft");
            if (committed) return;
            if (result.value !== initialHex) {
                committed = true;
                this._emitEdit({ kind: "setColor", value: result.value });
            }
        });

        el.appendChild(text);
        return el;
    },

    /**
     * Build a slot function-name field for Band 3 rows 3
     * through 5. Like _buildEditableField but with two
     * additions: a placeholder shown in muted text when
     * the field is empty (the proposed default function
     * name), and a render-time muted treatment for the
     * typed text when the named function doesn't exist in
     * behaviors.js. Both muted treatments use inline
     * opacity so the field reads correctly without
     * dedicated CSS in this commit.
     *
     * Commit lifecycle mirrors _buildEditableField: Enter
     * commits, Escape reverts, blur silently reverts a
     * hard-error candidate. Stage 2B uses an identity
     * validator (every input commits as ok); Stage 4 will
     * swap in validateFunctionName.
     *
     * @param {{
     *   value: string,
     *   placeholder: string,
     *   width: number,
     *   editable: boolean,
     *   functionExists: boolean,
     *   editKind: string,
     * }} opts
     * @returns {HTMLDivElement}
     */
    _buildSlotField(opts) {
        const el = document.createElement("div");
        el.className = "insp-field insp-slot-field";
        el.style.width = `${opts.width}px`;

        // Function-doesn't-exist muted treatment for typed
        // names. Placeholder text gets its own muted
        // styling below; this branch handles the case where
        // the user has typed (or stored) a name that
        // doesn't resolve in scene.functionMap yet.
        if (opts.editable && !opts.functionExists && opts.value !== "") {
            el.style.opacity = "0.55";
        }

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
            el.style.opacity = "0.55";
        };
        const clearPlaceholder = () => {
            el.textContent = "";
            el.classList.remove("placeholder-shown");
            el.style.opacity = "";
        };

        if (opts.value !== "") {
            el.textContent = opts.value;
        } else if (opts.placeholder !== "") {
            showPlaceholder();
        }

        // Mouse-aware focus selection with placeholder-clear
        // hook. The onFocus callback runs first on every
        // focus regardless of origin and clears the
        // placeholder if one is shown, after which the tab-
        // vs-mouse branching applies (tab selects-all on
        // the now-empty field — a harmless no-op; mouse
        // leaves the caret at the click position).
        wireFocusSelect(el, {
            onFocus: () => {
                if (el.classList.contains("placeholder-shown")) {
                    clearPlaceholder();
                }
            },
        });

        let committed = false;
        const tryCommit = () => {
            const candidate = el.textContent ?? "";
            if (committed) return;
            if (candidate !== opts.value) {
                committed = true;
                this._emitEdit({ kind: opts.editKind, value: candidate });
            }
        };

        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                tryCommit();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                if (opts.value !== "") {
                    el.textContent = opts.value;
                    el.style.opacity = opts.functionExists ? "" : "0.55";
                } else if (opts.placeholder !== "") {
                    showPlaceholder();
                } else {
                    el.textContent = "";
                    el.style.opacity = "";
                }
                el.blur();
                return;
            }
        });
        el.addEventListener("blur", () => {
            tryCommit();
            if (
                el.textContent === "" &&
                opts.placeholder !== ""
            ) {
                showPlaceholder();
            }
        });

        return el;
    },

    /**
     * Build the Create / Go-to button for a Band 3 slot
     * row (rows 3 through 5). Disabled state uses the
     * existing insp-btn-create.disabled styling. Enabled
     * click routes to one of two edits: goToFunction when
     * the named function already exists in behaviors.js,
     * or createFunctionStub when it does not. The slotKey
     * tags the createFunctionStub edit so main.js can
     * dispatch the binding mutator (one of
     * setCollidedFunctionOnSelection,
     * setTriggeredFunctionOnSelection,
     * setOnTickFunctionOnSelection).
     *
     * @param {{
     *   label: string,
     *   disabled: boolean,
     *   slotKey: "collided" | "triggered" | "onTick",
     *   functionName: string,
     *   functionExists: boolean,
     * }} opts
     * @returns {HTMLButtonElement}
     */
    _buildSlotButton(opts) {
        const el = document.createElement("button");
        el.className = "insp-btn-create";
        el.style.minWidth = `${W.slotButton}px`;
        if (opts.disabled) el.classList.add("disabled");
        el.textContent = opts.label;

        if (!opts.disabled) {
            el.addEventListener("click", () => {
                if (opts.functionExists) {
                    this._emitEdit({
                        kind: "goToFunction",
                        functionName: opts.functionName,
                    });
                } else {
                    this._emitEdit({
                        kind: "createFunctionStub",
                        slotKey: opts.slotKey,
                        proposedName: opts.functionName,
                    });
                }
            });
        }
        return el;
    },

    /**
     * Whether a top-level function with the given name
     * already exists in the current scene's functionMap.
     * Used by the slot button's Create-vs-Go-to decision
     * and by the slot field's function-doesn't-exist
     * muted treatment. Null scene or empty name returns
     * false so the gates settle on Create with whatever
     * name shows up next.
     *
     * @param {string} name
     * @returns {boolean}
     */
    _functionExistsInScene(name) {
        if (this._scene === null || name === "") return false;
        return Object.prototype.hasOwnProperty.call(
            this._scene.functionMap, name,
        );
    },

    /**
     * Live-editing field for Band 5's Active Beats and Beat
     * Strength. Each keystroke is coerced to a single legal
     * character and bar `|` separators are maintained as the
     * string grows and shrinks:
     *   - kind "pattern" (Active Beats): "." stays a dot; any other
     *     typed character becomes a lowercase "x"; pipes/whitespace
     *     typed or pasted are dropped (bars are auto-managed).
     *   - kind "strength" (Beat Strength): only digits 0-9 are
     *     accepted; everything else is rejected.
     * After every edit the pipe-free logical string is re-grouped
     * into bars of opts.beatsPerBar characters (mirrors
     * sceneEditor.repipeWithBars), with the caret preserved in
     * logical position. Commit (Enter or blur) emits opts.editKind
     * with the barred value; the matching setter re-bars it.
     *
     * @param {{ value: string, width: number, editable: boolean,
     *   beatsPerBar: number, kind: "pattern" | "strength",
     *   editKind: string, ariaLabel?: string }} opts
     * @returns {HTMLInputElement}
     */
    _buildBeatStringField(opts) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "insp-field insp-beat-field";
        input.style.width = `${opts.width}px`;
        input.spellcheck = false;
        if (opts.ariaLabel) input.setAttribute("aria-label", opts.ariaLabel);
        input.value = opts.value ?? "";
        if (!opts.editable) {
            input.classList.add("disabled");
            input.disabled = true;
            return input;
        }
        if (opts.locked) {
            // Read-only but still readable (NOT greyed) — used for
            // the Euclidean Active Beats pattern, which is generated
            // from the parameters and shown for reference. readOnly
            // blocks editing; the .locked style drops the editable
            // mint frame to signal it's not directly editable while
            // keeping the value at full contrast.
            input.readOnly = true;
            input.tabIndex = -1;
            input.classList.add("locked");
            return input;
        }

        const bar = Math.max(1, Math.round(Number(opts.beatsPerBar)) || 1);
        const isPattern = opts.kind === "pattern";
        /** @param {string} ch */
        // A dot can be entered with EITHER the period or the SPACE
        // bar (space is the natural "rest" key while tapping in a
        // rhythm). In Active Beats any other key becomes "x"; in
        // Beat Strength a dot or space becomes a dot, digits 0-9
        // pass through, and everything else is rejected. (Note:
        // space is checked before the whitespace-drop rule, so it
        // maps to "." rather than being discarded; tabs/newlines
        // and pipes are still dropped.)
        const transform = isPattern
            ? (ch) => (ch === "." || ch === " " ? "." : (/[|\s]/.test(ch) ? null : "x"))
            : (ch) => (ch === "." || ch === " " ? "." : (/[0-9]/.test(ch) ? ch : null));
        const toLogical = (s) => s.replace(/\|/g, "");

        // Re-bar input.value, restoring the caret to its logical
        // (pipe-free) position. Call after any content change.
        const reformat = () => {
            const disp = input.value;
            const caret = input.selectionStart ?? disp.length;
            let logicalCaret = 0;
            for (let i = 0; i < caret; i++) if (disp[i] !== "|") logicalCaret++;
            const next = barizeBeatString(toLogical(disp), bar);
            let off = next.length;
            let count = 0;
            for (let i = 0; i <= next.length; i++) {
                if (count === logicalCaret) { off = i; break; }
                if (i < next.length && next[i] !== "|") count++;
            }
            input.value = next;
            input.setSelectionRange(off, off);
        };

        input.addEventListener("beforeinput", (e) => {
            const t = e.inputType;
            if (t === "insertText" || t === "insertFromPaste" || t === "insertReplacementText") {
                e.preventDefault();
                let ins = "";
                for (const ch of (e.data ?? "")) {
                    const r = transform(ch);
                    if (r !== null) ins += r;
                }
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                input.value = input.value.slice(0, start) + ins + input.value.slice(end);
                input.setSelectionRange(start + ins.length, start + ins.length);
                reformat();
            } else if (t === "deleteContentBackward") {
                e.preventDefault();
                let start = input.selectionStart ?? 0;
                const end = input.selectionEnd ?? start;
                if (start !== end) {
                    input.value = input.value.slice(0, start) + input.value.slice(end);
                    input.setSelectionRange(start, start);
                } else {
                    // Skip an auto-inserted pipe so backspace removes
                    // a real character, not a separator.
                    if (start > 0 && input.value[start - 1] === "|") start--;
                    if (start > 0) {
                        input.value = input.value.slice(0, start - 1) + input.value.slice(start);
                        input.setSelectionRange(start - 1, start - 1);
                    }
                }
                reformat();
            } else if (t === "deleteContentForward") {
                e.preventDefault();
                let start = input.selectionStart ?? 0;
                const end = input.selectionEnd ?? start;
                if (start !== end) {
                    input.value = input.value.slice(0, start) + input.value.slice(end);
                } else {
                    if (start < input.value.length && input.value[start] === "|") start++;
                    if (start < input.value.length) {
                        input.value = input.value.slice(0, start) + input.value.slice(start + 1);
                    }
                }
                input.setSelectionRange(start, start);
                reformat();
            } else if (t.startsWith("insert")) {
                e.preventDefault();
            }
        });

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            this._emitEdit({ kind: opts.editKind, value: input.value });
        };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
                input.blur();
            }
        });
        input.addEventListener("blur", () => commit());

        return input;
    },
};

/**
 * Re-bar an x/./digit string: strip every existing `|` and
 * whitespace, then reinsert a `|` after each group of beatsPerBar
 * characters (no trailing pipe). Mirrors sceneEditor's
 * repipeWithBars so the live field and the committed value group
 * identically.
 * @param {string} s
 * @param {number} beatsPerBar
 * @returns {string}
 */
function barizeBeatString(s, beatsPerBar) {
    if (typeof s !== "string") return "";
    const stripped = s.replace(/[|\s]/g, "");
    // beatsPerBar of 1 (or less) draws no bar lines.
    if (beatsPerBar <= 1) return stripped;
    let result = "";
    for (let i = 0; i < stripped.length; i++) {
        result += stripped[i];
        if ((i + 1) % beatsPerBar === 0 && i < stripped.length - 1) {
            result += "|";
        }
    }
    return result;
}
