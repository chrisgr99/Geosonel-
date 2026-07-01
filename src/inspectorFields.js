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
        // Stable key so the inspector can restore focus + caret to this field
        // after a re-render rebuilds the form (see Inspector._render).
        if (typeof opts.editKind === "string") el.dataset.editKind = opts.editKind;

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
            // A per-option disabled flag greys an entry (selectable list shows it,
            // but it can't be chosen) — used for not-yet-wired modes.
            if (tok.disabled) option.disabled = true;
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
     * Build a 0..1 depth slider with None / Full end labels — the influence
     * control on each Canvas to Sound Drivers row. The value commits on release
     * (the `change` event, not `input`) so a re-render doesn't interrupt a drag;
     * the thumb tracks live during the drag via the browser's native handling.
     *
     * @param {{
     *   value: number,          // 0..1 (non-finite → 1 / Full)
     *   editable: boolean,
     *   editKind: string,       // emitted as { kind, value: <0..1 number> }
     *   width?: number,         // slider width in px (default 96)
     * }} opts
     * @returns {HTMLElement}
     */
    _buildSliderField(opts) {
        const wrap = document.createElement("div");
        wrap.className = "insp-slider-field" + (opts.editable ? "" : " disabled");
        const none = document.createElement("span");
        none.className = "insp-slider-end";
        none.textContent = "None";
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.01";
        slider.className = "insp-slider";
        slider.style.width = `${opts.width || 96}px`;
        slider.value = String(Number.isFinite(opts.value) ? opts.value : 1);
        const full = document.createElement("span");
        full.className = "insp-slider-end";
        full.textContent = "Full";
        if (opts.editable) {
            slider.addEventListener("change", () => {
                this._emitEdit({ kind: opts.editKind, value: Number(slider.value) });
            });
        } else {
            slider.disabled = true;
        }
        wrap.appendChild(none);
        wrap.appendChild(slider);
        wrap.appendChild(full);
        return wrap;
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
            // A label may carry a "\n" to wrap onto two lines (e.g.
            // "Hide\nCursor"), which narrows that option so the row fits.
            // The explicit <br> overrides the label's nowrap.
            if (o.label.includes("\n")) {
                const span = document.createElement("span");
                span.style.lineHeight = "1.05";
                const lines = o.label.split("\n");
                for (let j = 0; j < lines.length; j++) {
                    if (j > 0) span.appendChild(document.createElement("br"));
                    span.appendChild(document.createTextNode(lines[j]));
                }
                label.appendChild(span);
            } else {
                label.appendChild(document.createTextNode(o.label));
            }
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

        // Swatch-only mode: no hex-text field — just the colour square.
        // Clicking it opens the OS picker; committing a pick emits the
        // colour edit. Used where the row has no room for the hex text
        // (the Color swatch riding on the Cursor row).
        if (opts.swatchOnly) {
            el.classList.add("swatch-only");
            if (!opts.editable) return el;
            const picker = document.createElement("input");
            picker.type = "color";
            picker.className = "insp-color-picker";
            picker.value = normaliseHexForPicker(initialHex, placeholderColour);
            el.appendChild(picker);
            swatch.style.cursor = "pointer";
            swatch.addEventListener("click", () => picker.click());
            let committedSwatch = false;
            picker.addEventListener("change", () => {
                const result = validateHexColor(picker.value);
                if (result.kind === "hard") return;
                swatch.style.backgroundColor = result.value;
                if (committedSwatch) return;
                if (result.value !== initialHex) {
                    committedSwatch = true;
                    this._emitEdit({ kind: "setColor", value: result.value });
                }
            });
            return el;
        }

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
     * script.js. Both muted treatments use inline
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

        // A proposed (or typed) function name that doesn't exist in
        // the Script tab yet is NOT dimmed: the field and its name stay
        // in the enabled state, and the Create button to the right is
        // the sole signal that the function isn't created yet (it
        // flips to Go to once it exists). Only a disabled row (below)
        // greys the field.

        if (!opts.editable) {
            el.classList.add("disabled");
            el.textContent = opts.value;
            return el;
        }

        el.setAttribute("contenteditable", "plaintext-only");
        el.setAttribute("spellcheck", "false");
        if (typeof opts.editKind === "string") el.dataset.editKind = opts.editKind;

        // The displayed name is the committed binding if there is one,
        // otherwise the proposed default — shown as ORDINARY editable
        // content (not a cleared-on-focus placeholder). So a click lands
        // the caret where you clicked and the proposed name stays put for
        // editing (the common case: tweak it). The .placeholder-shown
        // class marks the unbound/proposed case but renders identically
        // to a committed value; only the Create button signals it isn't
        // created yet.
        const baseline = opts.value !== "" ? opts.value : opts.placeholder;
        el.textContent = baseline;
        if (opts.value === "" && opts.placeholder !== "") {
            el.classList.add("placeholder-shown");
        }

        // Mouse-aware focus: a click leaves the caret at the click
        // position; Tab selects-all so the first keystroke replaces the
        // whole name. No placeholder clearing.
        wireFocusSelect(el);

        // Commit only when the user actually CHANGES the field from what
        // was shown. Leaving the proposed name untouched does NOT bind it
        // — the Create button is how an unedited proposal gets bound and
        // scaffolded; editing it to a different name commits that name.
        // The committed flag guards the detached-blur double-emit after a
        // commit re-renders the inspector.
        let committed = false;
        const commitIfChanged = () => {
            if (committed) return;
            const candidate = el.textContent ?? "";
            if (candidate === baseline) return;
            // Clearing an already-unbound field is a no-op, not an edit.
            if (candidate === "" && opts.value === "") return;
            committed = true;
            this._emitEdit({ kind: opts.editKind, value: candidate });
        };

        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commitIfChanged();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                el.textContent = baseline;
                el.blur();
                return;
            }
        });
        el.addEventListener("blur", () => {
            commitIfChanged();
            // If the field was emptied on an unbound slot without
            // committing, restore the proposed name display.
            if (!committed && el.textContent === "" && opts.value === "" && opts.placeholder !== "") {
                el.textContent = opts.placeholder;
            }
        });

        return el;
    },

    /**
     * Build the Create / Go-to button for a Band 3 slot
     * row (rows 3 through 5). Disabled state uses the
     * existing insp-btn-create.disabled styling. Enabled
     * click routes to one of two edits: goToFunction when
     * the named function already exists in script.js,
     * or createFunctionStub when it does not. The slotKey
     * tags the createFunctionStub edit so main.js can
     * dispatch the binding mutator (one of
     * setHasCollidedFunctionOnSelection,
     * setBeenTriggeredFunctionOnSelection,
     * setOnTickFunctionOnSelection).
     *
     * @param {{
     *   label: string,
     *   disabled: boolean,
     *   slotKey: "hasCollided" | "beenTriggered" | "onActiveBeat" | "onTick",
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
        // Stable key for focus restoration across an inspector re-render.
        if (typeof opts.editKind === "string") input.dataset.editKind = opts.editKind;
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

        // Manual Active Beats: an in-place, measure-aligned grid editor. Typing
        // OVERWRITES the cell at the caret (never inserts); Backspace/Delete clears
        // it to a dot; at the very end, typing appends a whole measure and
        // Backspace/Delete removes the last one. The value is always a whole number
        // of measures (each `cellsPerBar` cells, padded with dots). See
        // design/measure-patterns.md. Commits on blur/Enter like the normal field.
        if (opts.fixedGrid) {
            const cpb = Math.max(1, Math.round(Number(opts.cellsPerBar)) || 1);
            // Cap the typed pattern at the cycle length (Measures × cells-per-bar):
            // appends that would exceed it are rejected. Infinity = uncapped.
            const maxCells = (typeof opts.maxCells === "number" && opts.maxCells > 0)
                ? Math.floor(opts.maxCells) : Infinity;
            const cellsOf = (disp) => (disp || "").replace(/\|/g, "");
            // Keep only valid cell chars, ensure at least one cell, pad the partial
            // last measure with dots so the value is whole measures.
            const normalize = (cells) => {
                let s = (cells || "").replace(/[^xX.0-9]/g, "");
                // Never show more than the cap (Measures × cells-per-bar): a pattern
                // stored longer than the current Measures is truncated on display.
                if (Number.isFinite(maxCells)) s = s.slice(0, maxCells);
                // allowEmpty (repeats 2+): an empty pattern stays empty (no measure
                // shown) until the first character is typed. Otherwise default to a
                // single active beat.
                if (s.length === 0) { if (opts.allowEmpty) return ""; s = "x"; }
                // Pad the partial last measure to a whole measure. Measures is only a
                // CAP — raising it doesn't add measures, so the field shows just the
                // pattern's own (capped) measures, not Measures of them.
                const rem = s.length % cpb;
                return rem === 0 ? s : s + ".".repeat(cpb - rem);
            };
            const minCells = opts.allowEmpty ? 0 : cpb;     // smallest the pattern may shrink to
            // ratchetOnly (Euclidean): the active/rest structure is generated and
            // read-only; the only edit allowed is ratcheting an ACTIVE beat (typing
            // 2–9 to repeat it that many times) or reverting it (x). No rests can be
            // created or removed, and no measures added/deleted.
            const ratchetOnly = opts.ratchetOnly === true;
            // Map a typed character to a cell. A rest: the dot key OR the SPACE bar
            // (space is the natural "rest" key while tapping in a rhythm, and from a
            // field it no longer toggles transport — that's canvas-only now). An
            // active beat: x/X OR the COMMA key — comma sits right next to the dot, so
            // a beat pattern can be tapped in one-handed (comma = beat, dot = rest). A
            // ratchet: a digit 2–9 (repeat that beat that many evenly-spaced times).
            // In ratchetOnly the rest keys are dropped (structure is fixed).
            const cellChar = ratchetOnly
                ? (ch) => (ch === "x" || ch === "X" || ch === "," ? "x" : (/[2-9]/.test(ch) ? ch : null))
                : (ch) => (ch === "." || ch === " " ? "." : (ch === "x" || ch === "X" || ch === "," ? "x" : (/[2-9]/.test(ch) ? ch : null)));
            // Display with a bar divider after EVERY complete measure — INCLUDING a
            // trailing one — so a finished measure visibly shows it's complete.
            const gridBarize = (cells) => {
                let out = "";
                for (let i = 0; i < cells.length; i++) {
                    out += cells[i];
                    if ((i + 1) % cpb === 0) out += "|";
                }
                return out;
            };
            const logicalCaret = () => {
                const disp = input.value;
                const caret = input.selectionStart ?? disp.length;
                let L = 0;
                for (let i = 0; i < caret && i < disp.length; i++) if (disp[i] !== "|") L++;
                return L;
            };
            const render = (cells, caret, afterTail = false) => {
                const disp = gridBarize(cells);
                input.value = disp;
                let off;
                if (caret >= cells.length) {
                    // End of the cells. Default: land just BEFORE the trailing bar
                    // divider (the gap at the end of the last measure) so typing here
                    // APPENDS a new measure. After a measure DELETE (afterTail), land
                    // AFTER the trailing divider instead, so the next Delete/Backspace
                    // removes the next measure (rather than clearing a cell).
                    off = (!afterTail && disp.length > 0 && disp[disp.length - 1] === "|") ? disp.length - 1 : disp.length;
                } else {
                    off = disp.length; let count = 0;
                    for (let i = 0; i <= disp.length; i++) {
                        if (count === caret) { off = i; break; }
                        if (i < disp.length && disp[i] !== "|") count++;
                    }
                }
                input.setSelectionRange(off, off);
                updateGhost();
            };

            // Ghost preview: a lighter-font overlay showing the beats that WILL play
            // beyond what's typed — the recycled fill of a partly-defined phrase, or
            // the whole inherited pattern of an empty phrase. opts.ghost is the full
            // resolved play-out (barized, the cycle's length); the typed value is its
            // prefix, so the suffix after it is what's ghosted (pipes included). The
            // overlay (insp-beat-ghost) is added next to the input by wrapBeatField.
            const ghostEl = document.createElement("div");
            ghostEl.className = "insp-beat-ghost";
            ghostEl.style.width = `${opts.width}px`;
            ghostEl.style.display = "none";
            input._ghostEl = ghostEl;
            const updateGhost = () => {
                const full = (typeof opts.ghost === "string") ? opts.ghost : "";
                const val = input.value;
                const suffix = (val === "") ? full
                    : (full.length > val.length && full.startsWith(val)) ? full.slice(val.length) : "";
                ghostEl.textContent = "";
                if (suffix === "") { ghostEl.style.display = "none"; return; }
                ghostEl.style.display = "";
                // A hidden prefix span occupies the typed text's width so the visible
                // ghost lands exactly where the typed value ends.
                const pre = document.createElement("span");
                pre.className = "insp-beat-ghost-pre";
                pre.textContent = val;
                const gh = document.createElement("span");
                gh.className = "insp-beat-ghost-text";
                gh.textContent = suffix;
                ghostEl.appendChild(pre);
                ghostEl.appendChild(gh);
            };

            // Commit IMMEDIATELY on each edit (the beforeinput handler calls commit()
            // after every change), so the pattern applies live — no Enter needed.
            // `dirty` only guards a no-op commit (a focus/blur or rejected keystroke
            // that changed nothing) from re-emitting and re-running the scene; it's
            // set by each real edit and cleared once that edit is sent.
            let dirty = false;
            const commit = () => {
                if (!dirty) return;
                dirty = false;
                // Commit the no-trailing-pipe form (matches sceneEditor's repipe).
                const v = barizeBeatString(cellsOf(input.value), cpb);
                if (typeof opts.onCommit === "function") opts.onCommit(v);
                else this._emitEdit({ kind: opts.editKind, value: v });
            };
            const reset = () => {
                input.value = gridBarize(normalize(cellsOf(opts.value)));
                dirty = false;
                updateGhost();
            };
            reset();

            // Ghost materialization (Manual rows). A row whose ghosted (looped /
            // inherited) measures extend past what's typed shows the FULL resolved
            // play-out WHILE FOCUSED, so the caret can reach and edit any cell —
            // including a ghosted measure a few bars ahead. Nothing is stored until
            // the FIRST edit (which commits the whole materialised row); blurring
            // without editing reverts to the short stored form, so a stray focus
            // never pins the row. Off unless opts.materializeGhostOnFocus is set.
            const materialize = opts.materializeGhostOnFocus === true;
            const showFullForEditing = () => {
                if (!materialize) return;
                const full = typeof opts.ghost === "string" ? cellsOf(opts.ghost) : "";
                if (full.length > cellsOf(input.value).length) {
                    input.value = gridBarize(full);
                    updateGhost();
                }
            };
            // Explicit materialise-and-place-caret. Clicks in the phrase box are owned
            // by the measure-selection overlay, which calls this on a plain click so a
            // ghosted measure can be edited in place: focus, reveal the full play-out,
            // and drop the caret at charIdx (a char offset into the barized value).
            input._materializeCaret = (charIdx) => {
                if (document.activeElement !== input) input.focus();
                showFullForEditing();
                const c = Math.max(0, Math.min((charIdx | 0), input.value.length));
                try { input.setSelectionRange(c, c); } catch (_e) { /* detached */ }
            };
            input.addEventListener("focus", () => {
                reset();
                showFullForEditing();
            });
            input.addEventListener("blur", () => {
                const edited = dirty;
                commit();
                if (materialize && !edited) reset();
            });
            // Edit through beforeinput (the same path the normal field uses, which
            // works reliably here), but OVERWRITE the cell at the caret instead of
            // inserting; at the very end, type appends a whole measure and a delete
            // removes the last one.
            input.addEventListener("beforeinput", (e) => {
                const t = e.inputType;
                let cells = cellsOf(input.value);
                const L = logicalCaret();
                // "Past the end" = the caret at or beyond the last cell (the gap
                // before the trailing `|`, or after it). atEnd governs the delete
                // branches' remove-last-measure; the insert branch decides per
                // character from `pos` instead, so a caret that advances into that
                // gap appends the next measure.
                const atEnd = (input.selectionStart ?? input.value.length) >= input.value.length;
                if (t === "insertText" || t === "insertFromPaste" || t === "insertReplacementText") {
                    e.preventDefault();
                    let pos = L;
                    for (const raw of (e.data ?? "")) {
                        const ch = cellChar(raw);
                        if (ch === null) continue;
                        if (pos >= cells.length) {
                            // Caret is in the gap past the last cell: start a NEW
                            // measure (its first cell is the typed beat), unless that
                            // would exceed the cap (Measures × cells-per-bar).
                            if (ratchetOnly) continue;                                    // structure fixed — no new measures
                            if (cells.length + cpb > maxCells) continue;                  // at the cycle cap — reject
                            cells = cells + ch + ".".repeat(cpb - 1);                     // new measure
                            pos = cells.length - cpb + 1;                                 // caret after the typed beat
                        } else if (ratchetOnly) {
                            // Only ratchet an ACTIVE beat; rest cells are read-only.
                            // Advance past rests so a run of digits lands on the active
                            // beats it passes.
                            const cur = cells[pos];
                            if (cur === "x" || cur === "X" || /[2-9]/.test(cur)) {
                                cells = cells.slice(0, pos) + ch + cells.slice(pos + 1);
                            }
                            pos = pos + 1;
                        } else {
                            cells = cells.slice(0, pos) + ch + cells.slice(pos + 1);      // overwrite the cell
                            pos = pos + 1;                                                // ALWAYS advance — may reach
                            //                                                              cells.length (the gap before |)
                        }
                    }
                    dirty = true; render(cells, pos);
                } else if (t === "deleteContentBackward") {
                    e.preventDefault();
                    // ratchetOnly: structure is fixed, so Backspace does nothing (revert
                    // a ratchet by typing x). afterTail: leave the caret AFTER the new
                    // trailing | so a repeated Delete keeps removing measures.
                    if (ratchetOnly) { /* no-op */ }
                    else if (atEnd && cells.length - cpb >= minCells) { cells = cells.slice(0, cells.length - cpb); dirty = true; render(cells, cells.length, true); }
                    else if (L > 0) { const p = Math.min(L - 1, cells.length - 1); cells = cells.slice(0, p) + "." + cells.slice(p + 1); dirty = true; render(cells, p); }
                } else if (t === "deleteContentForward") {
                    e.preventDefault();
                    if (ratchetOnly) { /* no-op */ }
                    else if (atEnd && cells.length - cpb >= minCells) { cells = cells.slice(0, cells.length - cpb); dirty = true; render(cells, cells.length, true); }
                    else if (L < cells.length) { cells = cells.slice(0, L) + "." + cells.slice(L + 1); dirty = true; render(cells, L); }
                } else if (t.startsWith("insert")) {
                    e.preventDefault();                      // block newlines / other inserts
                }
                // Apply the edit live — no Enter/blur required.
                commit();
            });
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); input.blur(); return; }
                // Up/Down move between repeat tabs (commit the current edit first).
                if (typeof opts.onArrowTab === "function" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault(); commit(); opts.onArrowTab(e.key === "ArrowUp" ? -1 : 1);
                }
            });
            return input;
        }

        const bar = Math.max(1, Math.round(Number(opts.beatsPerBar)) || 1);
        const isPattern = opts.kind === "pattern";
        /** @param {string} ch */
        // A dot can be entered with EITHER the period or the SPACE
        // bar (space is the natural "rest" key while tapping in a
        // rhythm). In Active Beats a dot/space is a rest, a digit 1-9
        // is a ratchet (that many hits in the slot), and any other key
        // becomes "x" (a single hit); in Beat Strength a dot or space
        // becomes a dot, digits 0-9 pass through, and everything else
        // is rejected. (Note: space is checked before the whitespace-
        // drop rule, so it maps to "." rather than being discarded;
        // tabs/newlines and pipes are still dropped.)
        const transform = isPattern
            ? (ch) => (ch === "." || ch === " " ? "."
                : (/[1-9]/.test(ch) ? ch : (/[|\s]/.test(ch) ? null : "x")))
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

        // Commit only after an ACTUAL edit. `dirty` is reset on focus and set by the
        // beforeinput handler; a plain focus+blur (no keystroke) never commits. This
        // matters for the live variation preview, where the field may be showing a
        // varied cycle that differs from the stored base — without this, merely
        // clicking in and out would bake that variation. (Harmless elsewhere: a
        // no-change commit was already a no-op.)
        // Commit IMMEDIATELY on each edit (the dirty-flag beforeinput listener below
        // calls commit() right after the editing handler has applied the change), so
        // the field applies live — no Enter needed. `dirty` is reset on focus and set
        // by each real edit, so a focus/blur with no keystroke never commits — which
        // also keeps the live variation PREVIEW from baking, since the per-frame loop
        // writes the field WITHOUT a beforeinput (dirty stays false).
        let dirty = false;
        const commit = () => {
            if (!dirty) return;
            dirty = false;
            if (typeof opts.onCommit === "function") opts.onCommit(input.value);
            else this._emitEdit({ kind: opts.editKind, value: input.value });
        };
        input.addEventListener("focus", () => {
            // Snap back to the editable BASE, dropping any live variation preview the
            // per-frame loop wrote in — so edits go straight to the base and the
            // mutation is never baked. (No-op for fields that aren't live-updated:
            // their value already equals opts.value.)
            input.value = opts.value ?? "";
            dirty = false;
        });
        // Registered AFTER the editing beforeinput handler above, so by the time this
        // runs the value is already updated; mark the edit and apply it live.
        input.addEventListener("beforeinput", () => { dirty = true; commit(); });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
                input.blur();
            } else if (typeof opts.onArrowTab === "function" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                // Up/Down move between repeat tabs (commit the current edit first).
                e.preventDefault(); commit(); opts.onArrowTab(e.key === "ArrowUp" ? -1 : 1);
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
