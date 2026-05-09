/**
 * Property Inspector module.
 *
 * Renders the form-based property inspector that lives in
 * the Properties tab. The form is always rendered —
 * nothing-selected state shows every band with all fields
 * greyed and a "No selection" handle in the title bar.
 * When at least one object is selected, the same bands
 * populate with that object's data and the appropriate
 * fields un-grey based on which kinds are present in the
 * selection.
 *
 * Stage 2A scope. Inspector currently renders Bands 1
 * (Identity) and 2 (Geometry / visual) only. The four
 * obsolete bands from the pre-section-27 design (Message
 * Functions, Auto Beat Interval, Beat Points, Cycle
 * Parameters) were removed when their underlying schema
 * fields were removed in Tier 3 Stage 1; Stage 2B will add
 * a new Band 3 that exposes the four uniform callback
 * slots (cycle, hasHit, beenHit, onTick) defined in section
 * 27 of DESIGN.md, and Stages 3 and 4 will add the
 * CodeMirror Band 4 and the Create-button / validation
 * surface.
 *
 * Band 1 — Identity. Object ID is read-only and greyed for
 * multi-select; Name is editable for single-select and
 * greyed for multi-select; Mute is editable for any non-
 * empty selection; Hide is curve-only and greyed when the
 * selection contains no curves.
 *
 * Band 2 — Geometry / visual. Position is universal (any
 * non-empty selection); Curve Size W/H, Curve Thickness,
 * Cursor R/L, Cursor Thickness activate when curves are in
 * the selection; Sprite/Trigger Size activates when the
 * selection is exclusively that kind (the row's label
 * tracks which); Color activates when sprites or triggers
 * are present (curves carry no per-object colour at this
 * milestone). Position and Curve Size W/H use absolute-set
 * semantics — typing a value commits that value as the new
 * coordinate (or dimension) for every applicable selected
 * object — so single-select, uniform multi-select, and
 * varies multi-select all flow through the same primitive.
 *
 * Edit lifecycle. Editable fields share a validator-driven
 * commit lifecycle: hard errors squiggle red and refuse to
 * commit (Enter retains focus, blur silently reverts);
 * soft warnings squiggle yellow and commit; ok values
 * commit cleanly. Soft squiggles are transient — they
 * appear at commit time and are gone after the scene
 * reloads, except for Name's duplicate-name check which
 * runs at render time so the squiggle persists until the
 * conflict is resolved.
 *
 * Numeric fields support scroll-wheel adjustment. Hovering
 * over a numeric field and rotating the wheel nudges the
 * value in 0.3 increments — wheel up to increase, wheel
 * down to decrease. The validator clamps during scrolling
 * so field-specific bounds act as soft walls. Each wheel
 * event emits a fresh edit so the canvas, the JSON tab,
 * and any other scene-derived UI track the value
 * continually as the user scrolls. Wheel emits bypass the
 * keyboard commit's destruction-blur guard because wheel
 * scrolling doesn't focus the field.
 *
 * Greying rules.
 *   - Universal fields (Position, Mute) are active for any
 *     non-empty selection.
 *   - Object ID and Name are active only for single-object
 *     selections; greyed for multi-select since both are
 *     per-object unique.
 *   - Hide applies only to curves; greyed when the
 *     selection contains no curves.
 *   - Sprite/Trigger Size is active only when the selection
 *     is exclusively sprites or exclusively triggers; the
 *     row's label tracks which.
 *   - Curve-only fields (Curve Size, Cursor Size, the two
 *     Thicknesses) are active only when at least one curve
 *     is selected.
 *   - Color is active when sprites or triggers are present;
 *     a curve-only selection greys it.
 *
 * The Inspector exposes setSelection(), setScene(), and
 * setEditCallback(); main.js wires the three together so
 * the inspector tracks selection changes, scene reloads,
 * and edit commits.
 *
 * Aesthetic tracks GeoSonix closely: dark grey panel,
 * lighter grey field fills (visible even when empty so
 * each field's footprint reads), bright white labels and
 * values for active fields, muted grey for disabled
 * fields, green frames on editable fields, green-filled
 * checkboxes, green stepper dots on numeric fields. See
 * main.css for the .insp-* class styles that produce this
 * look.
 */

// @ts-check

import {
    validateName,
    collectOtherNames,
    nameConflictsInScene,
} from "./nameValidation.js";
import {
    validateNumber,
    validateHexColor,
} from "./curveFieldValidation.js";

// Width constants. Centralised so layout adjustments touch
// one set of numbers, not scattered inline styles.
const W = {
    // Left-edge label column. Wide enough for the longest
    // band-1-or-2 label at 10pt; everything narrower gets
    // the same width so the label column aligns down the
    // entire form.
    leftLabel: 78,

    // ID field — short generated identifier (e.g. "sp_a3f7").
    idField: 80,

    // Inline labels next to the row's leftmost field group,
    // sized to the shortest text that fits at 10pt.
    mute: 36,          // "Mute"
    hide: 36,          // "Hide"
    curveThick: 60,    // "Curve\nThickness" multiline
    cursorThick: 60,   // "Cursor\nThickness" multiline

    // Numeric fields.
    posXY: 60,         // Position X, Y
    sizeWH: 60,        // Curve Size W, H
    cursorRL: 50,      // Cursor R, L
    thickness: 60,     // Curve/Cursor Thickness
    spriteTriggerSize: 60,

    // Text fields.
    name: 280,
};

export class Inspector {
    /**
     * @param {HTMLElement} container
     */
    constructor(container) {
        this.container = container;
        this.container.classList.add("inspector-pane");
        /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
        this._selection = { sprites: [], triggers: [], curves: [] };
        /**
         * The runtime Scene built by sceneLoader. Field reads
         * for Band 1 (id, name, mute, hide) come from this.
         * Null until the first runScene completes; in that
         * window the inspector falls back to greyed/empty
         * placeholders instead of crashing on lookup.
         * @type {import("./scene.js").Scene | null}
         */
        this._scene = null;
        /**
         * Callback fired when the user commits an inspector
         * edit. main.js wires this to applyInspectorEdit
         * which runs the parse-mutate-stringify pipeline and
         * re-runs the scene. Edits carry a kind tag plus per-
         * kind payload, with the current selection attached
         * automatically by _emitEdit.
         * @type {((edit: any) => void) | null}
         */
        this._editCallback = null;
        this._render();
    }

    /**
     * Register the callback that handles inspector edit
     * commits. main.js installs this once during setup; the
     * callback is invoked synchronously from the inspector's
     * event handlers (checkbox clicks, name field commits)
     * and is expected to be async-safe.
     * @param {(edit: any) => void} callback
     */
    setEditCallback(callback) {
        this._editCallback = callback;
    }

    /**
     * Emit an inspector edit to the registered callback,
     * attaching the current selection automatically. If the
     * callback isn't wired yet the edit is dropped silently
     * — happens in startup ordering edge cases but otherwise
     * shouldn't.
     * @param {Object} edit
     */
    _emitEdit(edit) {
        if (typeof this._editCallback === "function") {
            this._editCallback({ ...edit, selection: this._selection });
        }
    }

    /**
     * Update the inspector's reference to the runtime Scene.
     * Called by main.js after each successful scene reload.
     * Triggers a re-render so currently-displayed Band 1
     * values reflect the new data — important after edits
     * that change id, name, mute, or hide.
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        this._render();
    }

    /**
     * Update the inspector to reflect a new canvas selection.
     * Empty arrays mean nothing selected — the form clears
     * entirely. Non-empty selections re-populate the form with
     * the appropriate greying.
     * @param {{sprites?: number[], triggers?: number[], curves?: number[]}} selection
     */
    setSelection(selection) {
        this._selection = {
            sprites: selection.sprites ?? [],
            triggers: selection.triggers ?? [],
            curves: selection.curves ?? [],
        };
        this._render();
    }

    _render() {
        this.container.innerHTML = "";

        // The form is always rendered, even when nothing is
        // selected. Empty-selection state shows every band
        // with all fields greyed and a "No selection" handle
        // in the title bar. This is the GeoSonix convention
        // and is convenient for testing layout, scrolling,
        // and band greying without first having to click on
        // an object. The selection-driven greying machinery
        // (ctx.hasCurves and so on) returns false for every
        // kind when total === 0, so every band renders with
        // its dis flag true, which is exactly the visual
        // outcome we want.
        const ctx = buildSelectionContext(this._selection);

        const panel = document.createElement("div");
        panel.className = "inspector-panel";

        panel.appendChild(this._buildTitleBar(ctx));
        panel.appendChild(this._buildBandIdentity(ctx));
        panel.appendChild(this._buildBandGeometry(ctx));

        // Bottom spacer. Pushes the last band's fields up by
        // about two row heights so the macOS dock doesn't
        // pop over them when the user mouses near the screen
        // edge while editing fields in the lower bands. Lives
        // inside the panel so it scrolls with the rest of the
        // form rather than docking to the pane bottom.
        const spacer = document.createElement("div");
        spacer.className = "insp-bottom-spacer";
        panel.appendChild(spacer);

        this.container.appendChild(panel);
    }

    /**
     * Title bar. Empty selection shows "No selection" in the
     * dim-italic placeholder style. Single selection of a
     * named object shows the kind followed by the user-typed
     * name ("Sprite drum1") since the name is the meaningful
     * identity. Single selection without a typed name falls
     * back to count phrasing ("1 Sprite") since the kind
     * alone with no name doesn't add information that the
     * Object ID field below isn't already showing. Multi-
     * select always uses count phrasing ("2 Sprites, 1
     * Curve") regardless of any names — listing names for
     * many objects would be long; picking one would be
     * misleading; the count is the right level of summary.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildTitleBar(ctx) {
        const bar = document.createElement("div");
        bar.className = "insp-title-bar";

        const left = document.createElement("div");
        left.className = "insp-title-left";

        if (ctx.total === 0) {
            const handleEl = document.createElement("span");
            handleEl.className = "insp-title-handle placeholder";
            handleEl.textContent = "No selection";
            left.appendChild(handleEl);
        } else if (ctx.isSingle) {
            const named = singleSelectNamedTitle(ctx, this._scene);
            left.textContent = named ?? selectionSummaryTitle(ctx);
        } else {
            left.textContent = selectionSummaryTitle(ctx);
        }

        bar.appendChild(left);

        const right = document.createElement("div");
        right.className = "insp-title-right";
        bar.appendChild(right);

        return bar;
    }

    /**
     * Band 1 — Identity. ID is read-only and greyed for multi-
     * select; Name is editable for single-select and greyed
     * for multi-select; Mute is editable for any non-empty
     * selection and defaults to off (false = not muted); Hide
     * is curve-only and greyed when the selection contains no
     * curves.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandIdentity(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const objs = selectedObjects(this._scene, this._selection);
        const idEditable = ctx.isSingle;
        const nameEditable = ctx.isSingle;
        const hideActive = ctx.hasCurves;

        // ID and name come from the single selected object on
        // single-select. On multi-select the row is greyed and
        // the values are blank, since both fields are per-
        // object unique. Defensive null checks: if the scene
        // hasn't loaded yet, objs.all is empty and we fall
        // through to the same blank-greyed presentation.
        let idValue = "";
        let nameValue = "";
        /** @type {string | null} */
        let singleObjId = null;
        let nameConflict = false;
        if (ctx.isSingle && objs.all.length === 1) {
            const obj = objs.all[0];
            idValue = typeof obj.id === "string" ? obj.id : "";
            nameValue = typeof obj.name === "string" ? obj.name : "";
            singleObjId = idValue !== "" ? idValue : null;
            if (nameValue !== "") {
                nameConflict = nameConflictsInScene(
                    nameValue, this._scene, singleObjId,
                );
            }
        }

        // Mute aggregates across every selected object (any
        // kind). Hide aggregates across selected curves only,
        // since hide is curve-only. Both return true / false /
        // "varies" so a tri-state checkbox can render the
        // mixed case as a visually distinct "divergent" state.
        const muteState = aggregateBoolean(objs.all, "mute");
        const hideState = ctx.hasCurves
            ? aggregateBoolean(objs.curves, "hide")
            : false;

        const r1 = mkRow();
        r1.appendChild(mkLabel("Object ID", { width: W.leftLabel, disabled: !idEditable }));
        r1.appendChild(mkField({
            value: idValue,
            style: idEditable ? "locked" : "",
            disabled: !idEditable,
            width: W.idField,
        }));
        r1.appendChild(mkLabel("Mute", { width: W.mute }));
        r1.appendChild(mkCheckbox({
            checked: muteState === true,
            varies: muteState === "varies",
            onClick: () => this._onBooleanCheckboxClick("setMute", muteState),
        }));
        r1.appendChild(mkLabel("Hide", { width: W.hide, disabled: !hideActive }));
        r1.appendChild(mkCheckbox({
            checked: hideState === true,
            varies: hideState === "varies",
            disabled: !hideActive,
            onClick: hideActive
                ? () => this._onBooleanCheckboxClick("setHide", hideState)
                : undefined,
        }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Name", { width: W.leftLabel, disabled: !nameEditable }));
        r2.appendChild(this._buildNameField({
            value: nameValue,
            editable: nameEditable,
            conflict: nameConflict,
            objId: singleObjId,
        }));
        band.appendChild(r2);

        return band;
    }

    /**
     * Translate a Mute or Hide checkbox click into the
     * appropriate edit. The varies state (multi-select with
     * divergent values) resolves to true — the declarative
     * "do this thing" outcome — so the click commits to a
     * uniform muted-or-hidden state. Other states toggle.
     *
     * @param {"setMute" | "setHide"} kind
     * @param {boolean | "varies"} currentState
     */
    _onBooleanCheckboxClick(kind, currentState) {
        const newValue = (currentState === "varies") ? true : !currentState;
        this._emitEdit({ kind, value: newValue });
    }

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
     * @param {{ value: string, editable: boolean, conflict: boolean, objId: string | null }} opts
     * @returns {HTMLDivElement}
     */
    _buildNameField(opts) {
        const el = document.createElement("div");
        el.className = "insp-field";
        el.style.width = `${W.name}px`;

        if (!opts.editable) {
            el.classList.add("disabled");
            el.textContent = opts.value;
            return el;
        }

        el.setAttribute("contenteditable", "plaintext-only");
        el.setAttribute("spellcheck", "false");
        el.textContent = opts.value;
        if (opts.conflict) el.classList.add("error-soft");

        // Select all on focus so the user's first keystroke
        // replaces the existing value, the way a standard
        // <input> works. Without this, typing into a
        // contenteditable inserts characters at the cursor
        // position, so a click-and-type on a field showing
        // "4" produces "48" or "84" depending on where the
        // cursor landed — which then validates as a
        // different number than the user intended to enter.
        el.addEventListener("focus", () => selectAllInElement(el));

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
    }

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
     * }} opts
     * @returns {HTMLDivElement}
     */
    _buildEditableField(opts) {
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
        // Hovering over the field and rotating the wheel
        // updates the displayed value in 0.3 increments and
        // emits an edit on every wheel event so the canvas
        // and JSON tab track the value continually as the
        // user scrolls. The validator clamps during
        // scrolling so bounds (e.g. min: 0 for sizes) act as
        // soft walls. Wheel-over-field is suppressed while
        // the field is focused for text edit — normal page-
        // scrolling and text-cursor behaviour take over.
        //
        // Wheel emits go directly through opts.onCommit /
        // opts.editKind rather than through tryCommit. The
        // committed flag in tryCommit prevents destruction-
        // blur double-emit on focused fields after Enter,
        // and would also block successive wheel commits if
        // the wheel went through that path. Wheel scrolling
        // doesn't focus the field, so destruction-blur
        // doesn't fire, so the guard isn't needed and would
        // be actively harmful here.
        if (opts.numeric) {
            el.addEventListener("wheel", (e) => {
                if (document.activeElement === el) return;
                const currentText = el.textContent ?? "";
                const currentValue = parseFloat(currentText);
                if (!Number.isFinite(currentValue)) return;
                e.preventDefault();
                const direction = e.deltaY < 0 ? 1 : -1;
                const newValue = currentValue + direction * 0.3;
                const rounded = Math.round(newValue * 10) / 10;
                const result = opts.validator(String(rounded));
                if (result.kind === "hard") return;
                el.textContent = result.value;
                // Update opts.value so a subsequent click-blur on
                // the field doesn't fire a redundant tryCommit
                // emit — the keyboard path's diff check compares
                // textContent against opts.value to decide whether
                // to commit, and without this update the wheel-
                // modified textContent would always look new
                // relative to the render-time original.
                opts.value = result.value;
                if (typeof opts.onCommit === "function") {
                    opts.onCommit(result.value);
                } else if (typeof opts.editKind === "string") {
                    this._emitEdit({ kind: opts.editKind, value: result.value });
                }
            }, { passive: false });
        }

        // Select all on focus so the user's first keystroke
        // replaces the existing value rather than inserting
        // into it. See _buildNameField for the full rationale.
        el.addEventListener("focus", () => {
            selectAllInElement(el);
        });

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

        return el;
    }

    /**
     * Build the Color field, used by the Band 2 Color row.
     * The field consists of a colour swatch followed by an
     * editable hex string. As the user types valid hex into
     * the text portion, the swatch updates live so the user
     * can see the colour they're approaching before they
     * commit. Commit and revert lifecycle mirrors
     * _buildEditableField but is duplicated here because the
     * field's structure is two-part (swatch + text) rather
     * than a single contenteditable div.
     *
     * Disabled state (no sprites or triggers in the selection,
     * or curve-only selection) shows a dim swatch and the
     * stored hex value as plain text. Varies state (multi-
     * select with mismatched colours) shows a placeholder
     * neutral swatch and an empty text field; typing a value
     * and committing sets every selected sprite and trigger
     * to the typed colour.
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

        text.setAttribute("contenteditable", "plaintext-only");
        text.setAttribute("spellcheck", "false");
        text.textContent = initialHex.toUpperCase();

        // Select all on focus so the user's first keystroke
        // replaces the existing hex string rather than
        // inserting into it. See _buildNameField for the
        // full rationale.
        text.addEventListener("focus", () => selectAllInElement(text));

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
                text.blur();
                return;
            }
        });
        text.addEventListener("blur", () => {
            tryCommit("blur");
        });

        el.appendChild(text);
        return el;
    }

    /**
     * Band 2 — Geometry and visual. Position is universal
     * (any non-empty selection); curve dimensions, cursor
     * extents, and the two thicknesses activate when curves
     * are in the selection; sprite/trigger size activates
     * when the selection is exclusively that kind; colour
     * activates when sprites or triggers are present (curves
     * carry no per-object colour at this milestone).
     *
     * Position and Curve Size W/H use absolute-set semantics:
     * the user types a value and every applicable selected
     * object's coordinate becomes that value. This works for
     * single-select (typing 5 in a field showing 3 sets X=5),
     * uniform multi-select (typing 0 sets every selected
     * object's X to 0), and varies multi-select (typing 0 in
     * a blank "varies" field snaps every selected object to
     * X=0 regardless of starting value). The other Band 2
     * fields (sizes, cursor extents, thicknesses, colour)
     * also commit their typed value as the new value for
     * every applicable selected object.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandGeometry(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const curveDisabled = !ctx.hasCurves;
        const sizeActive = sizeRowActive(ctx);
        const sizeLabel = sizeRowLabel(ctx);
        const colorActive = ctx.hasSprites || ctx.hasTriggers;
        const positionActive = ctx.total > 0;

        const objs = selectedObjects(this._scene, this._selection);

        // Position. Reads from sprite/trigger x,y and from
        // curve bbox centroid; aggregates across kinds. Edits
        // emit setPositionAxis (absolute) so that single-
        // select, uniform multi-select, and varies multi-
        // select all flow through the same primitive: type a
        // value, every selected object's X (or Y) becomes
        // that value. For curves the per-shape semantics fall
        // out automatically — setPositionAxisOnSelection
        // computes a per-curve translation delta from the
        // current centroid to the target.
        const positionXAgg = aggregatePosition(objs, "x");
        const positionYAgg = aggregatePosition(objs, "y");
        const positionXEditable = positionActive;
        const positionYEditable = positionActive;

        const r1 = mkRow();
        r1.appendChild(mkLabel("Position", { width: W.leftLabel, disabled: !positionActive }));
        r1.appendChild(this._buildEditableField({
            value: positionXAgg === "varies" ? "" : positionXAgg,
            numeric: true,
            width: W.posXY,
            editable: positionXEditable,
            validator: (c) => validateNumber(c, {}),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value)) {
                    this._emitEdit({ kind: "setPositionAxis", axis: "x", value });
                }
            },
        }));
        r1.appendChild(this._buildEditableField({
            value: positionYAgg === "varies" ? "" : positionYAgg,
            numeric: true,
            width: W.posXY,
            editable: positionYEditable,
            validator: (c) => validateNumber(c, {}),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value)) {
                    this._emitEdit({ kind: "setPositionAxis", axis: "y", value });
                }
            },
        }));
        r1.appendChild(mkUnits("(X, Y)", { disabled: !positionActive }));
        band.appendChild(r1);

        // Curve Size W/H + Curve Thickness. Curves only.
        // W and H read from each curve's bbox dimensions and
        // edits emit setSizeAxis (absolute) so single-select,
        // uniform multi-select, and varies multi-select share
        // one path. Per-shape semantics inside
        // setSizeAxisOnSelection: ellipse assigns shape.w or
        // shape.h directly (so a degenerate axis can be grown
        // back to non-zero); line/piste compute a per-shape
        // factor and scale around the bbox-axis midpoint, and
        // skip silently when their starting extent is zero
        // because midpoint scaling can't grow zero. Curve
        // Thickness is a direct field commit.
        const sizeWAgg = aggregateCurveSize(objs.curves, "x");
        const sizeHAgg = aggregateCurveSize(objs.curves, "y");
        const curveThicknessAgg = aggregateString(objs.curves, "curveThickness");
        const sizeWEditable = !curveDisabled;
        const sizeHEditable = !curveDisabled;

        const r2 = mkRow();
        r2.appendChild(mkLabel("Curve Size", { width: W.leftLabel, disabled: curveDisabled }));
        r2.appendChild(this._buildEditableField({
            value: sizeWAgg === "varies" ? "" : sizeWAgg,
            numeric: true,
            width: W.sizeWH,
            editable: sizeWEditable,
            validator: (c) => validateNumber(c, { min: 0 }),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value) && value >= 0) {
                    this._emitEdit({ kind: "setSizeAxis", axis: "x", value });
                }
            },
        }));
        r2.appendChild(this._buildEditableField({
            value: sizeHAgg === "varies" ? "" : sizeHAgg,
            numeric: true,
            width: W.sizeWH,
            editable: sizeHEditable,
            validator: (c) => validateNumber(c, { min: 0 }),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value) && value >= 0) {
                    this._emitEdit({ kind: "setSizeAxis", axis: "y", value });
                }
            },
        }));
        r2.appendChild(mkUnits("(W, H)", { disabled: curveDisabled }));
        r2.appendChild(mkLabel("Curve\nThickness", { width: W.curveThick, disabled: curveDisabled, multiline: true }));
        r2.appendChild(this._buildEditableField({
            value: curveThicknessAgg === "varies" ? "" : curveThicknessAgg,
            numeric: true,
            width: W.thickness,
            editable: !curveDisabled,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCurveThickness",
        }));
        band.appendChild(r2);

        // Cursor R/L + Cursor Thickness. Curves only. All
        // three are direct field commits via setFieldOnSelection.
        const cursorRAgg = aggregateString(objs.curves, "cursorR");
        const cursorLAgg = aggregateString(objs.curves, "cursorL");
        const cursorThicknessAgg = aggregateString(objs.curves, "cursorThickness");

        const r3 = mkRow();
        r3.appendChild(mkLabel("Cursor Size", { width: W.leftLabel, disabled: curveDisabled }));
        r3.appendChild(mkInlineLetter("R", { disabled: curveDisabled }));
        r3.appendChild(this._buildEditableField({
            value: cursorRAgg === "varies" ? "" : cursorRAgg,
            numeric: true,
            width: W.cursorRL,
            editable: !curveDisabled,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorR",
        }));
        r3.appendChild(mkInlineLetter("L", { disabled: curveDisabled }));
        r3.appendChild(this._buildEditableField({
            value: cursorLAgg === "varies" ? "" : cursorLAgg,
            numeric: true,
            width: W.cursorRL,
            editable: !curveDisabled,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorL",
        }));
        r3.appendChild(mkLabel("Cursor\nThickness", { width: W.cursorThick, disabled: curveDisabled, multiline: true }));
        r3.appendChild(this._buildEditableField({
            value: cursorThicknessAgg === "varies" ? "" : cursorThicknessAgg,
            numeric: true,
            width: W.thickness,
            editable: !curveDisabled,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorThickness",
        }));
        band.appendChild(r3);

        // Sprite/Trigger Size. Active only when the selection
        // is exclusively sprites or exclusively triggers; the
        // label and edit kind switch to match. Direct field
        // commit.
        const sizeFieldAgg = ctx.singleKind === "sprite"
            ? aggregateString(objs.sprites, "displayDiameter")
            : ctx.singleKind === "trigger"
            ? aggregateString(objs.triggers, "size")
            : "";
        const sizeEditKind = ctx.singleKind === "trigger" ? "setTriggerSize" : "setSpriteSize";

        const r4 = mkRow();
        r4.appendChild(mkLabel(sizeLabel, { width: W.leftLabel, disabled: !sizeActive }));
        r4.appendChild(this._buildEditableField({
            value: sizeFieldAgg === "varies" ? "" : sizeFieldAgg,
            numeric: true,
            width: W.spriteTriggerSize,
            editable: sizeActive,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: sizeEditKind,
        }));
        band.appendChild(r4);

        // Color. Sprites and triggers only — curves carry no
        // per-object colour. Editable when at least one
        // sprite or trigger is in the selection, including
        // when the value varies (typing commits the typed
        // colour to all selected sprites and triggers).
        const colorAgg = aggregateColor(objs);

        const r5 = mkRow();
        r5.appendChild(mkLabel("Color", { width: W.leftLabel, disabled: !colorActive }));
        r5.appendChild(this._buildColorField({
            hex: colorAgg === "varies" ? "" : colorAgg,
            editable: colorActive,
            varies: colorAgg === "varies",
        }));
        band.appendChild(r5);

        return band;
    }
}

// --- Selection-context helpers ---

/**
 * Compute derived state from a raw selection. Centralised
 * so each band builder reads from a consistent shape rather
 * than re-deriving whether sprites/triggers/curves are
 * present.
 *
 * @param {{sprites: number[], triggers: number[], curves: number[]}} selection
 */
function buildSelectionContext(selection) {
    const sprites = selection.sprites || [];
    const triggers = selection.triggers || [];
    const curves = selection.curves || [];
    const total = sprites.length + triggers.length + curves.length;

    /** @type {Array<"sprite"|"trigger"|"curve">} */
    const kinds = [];
    if (sprites.length > 0) kinds.push("sprite");
    if (triggers.length > 0) kinds.push("trigger");
    if (curves.length > 0) kinds.push("curve");

    return {
        sprites, triggers, curves, total, kinds,
        isSingle: total === 1,
        singleKind: kinds.length === 1 ? kinds[0] : null,
        hasSprites: sprites.length > 0,
        hasTriggers: triggers.length > 0,
        hasCurves: curves.length > 0,
    };
}

/**
 * Compute the title text for any non-empty selection.
 * Always a count-and-kinds summary, never per-object
 * identity — the per-object id and name live in Band 1
 * below where they can be read and edited. Single-kind
 * selections read as "N Kind" or "N Kinds" with simple
 * pluralisation; multi-kind selections join the per-kind
 * counts with commas ("2 Sprites, 1 Curve").
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 * @returns {string}
 */
function selectionSummaryTitle(ctx) {
    const parts = [];
    if (ctx.hasSprites) parts.push(pluralCount(ctx.sprites.length, "Sprite"));
    if (ctx.hasTriggers) parts.push(pluralCount(ctx.triggers.length, "Trigger"));
    if (ctx.hasCurves) parts.push(pluralCount(ctx.curves.length, "Curve"));
    return parts.join(", ");
}

/**
 * If the single selected object has a user-typed name,
 * compose the title as "Kind name" (e.g. "Sprite drum1").
 * Returns null when the scene isn't loaded yet, when the
 * selected object can't be resolved, or when the object
 * has no typed name — in those cases the caller falls
 * back to the count-based summary. Multi-select callers
 * shouldn't reach here; the function bails defensively if
 * they do.
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 * @param {import("./scene.js").Scene | null} scene
 * @returns {string | null}
 */
function singleSelectNamedTitle(ctx, scene) {
    if (scene === null || !ctx.isSingle || ctx.singleKind === null) return null;
    const kind = ctx.singleKind;
    const idx = ctx.sprites[0] ?? ctx.triggers[0] ?? ctx.curves[0];
    const arr = kind === "sprite" ? scene.sprites
              : kind === "trigger" ? scene.triggers
              : scene.curves;
    if (idx < 0 || idx >= arr.length) return null;
    const obj = arr[idx];
    const name = typeof obj.name === "string" ? obj.name : "";
    if (name.length === 0) return null;
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    return `${cap} ${name}`;
}

/**
 * Materialise the selected objects out of a runtime scene.
 * Returns four arrays: per-kind groupings plus a combined
 * "all" list useful for cross-kind aggregation (e.g. mute
 * across the whole selection). Indexes that fall outside
 * the scene's arrays are silently dropped — the canvas
 * filters its own stale selection on every reload but a
 * defensive filter here keeps a transient mismatch from
 * crashing the inspector.
 *
 * @param {import("./scene.js").Scene | null} scene
 * @param {{sprites: number[], triggers: number[], curves: number[]}} selection
 * @returns {{ all: any[], sprites: any[], triggers: any[], curves: any[] }}
 */
function selectedObjects(scene, selection) {
    if (scene === null) {
        return { all: [], sprites: [], triggers: [], curves: [] };
    }
    const sprites = selection.sprites
        .filter((idx) => idx >= 0 && idx < scene.sprites.length)
        .map((idx) => scene.sprites[idx]);
    const triggers = selection.triggers
        .filter((idx) => idx >= 0 && idx < scene.triggers.length)
        .map((idx) => scene.triggers[idx]);
    const curves = selection.curves
        .filter((idx) => idx >= 0 && idx < scene.curves.length)
        .map((idx) => scene.curves[idx]);
    return {
        all: [...sprites, ...triggers, ...curves],
        sprites, triggers, curves,
    };
}

/**
 * Aggregate a boolean field across a list of objects.
 * Returns true if every object's field is truthy, false if
 * every object's field is falsy, or the string "varies" if
 * the values disagree. Empty list returns false (the field
 * has no representative value). Used by Band 1 for Mute and
 * Hide so multi-select can render a tri-state checkbox
 * indicating divergence.
 *
 * @param {any[]} objects
 * @param {string} fieldName
 * @returns {boolean | "varies"}
 */
function aggregateBoolean(objects, fieldName) {
    if (objects.length === 0) return false;
    let value = null;
    for (const obj of objects) {
        const v = !!obj[fieldName];
        if (value === null) {
            value = v;
        } else if (value !== v) {
            return "varies";
        }
    }
    return value === true;
}

/**
 * Aggregate a string-valued (or stringifiable) field across
 * a list of objects. Returns the common value as a string
 * when every object's field matches, the literal "varies"
 * when values disagree, or empty string for an empty list
 * or a uniformly-null/undefined field. Numeric fields work
 * too — they're compared by raw value (so number 4 and
 * string "4" stay distinct) and stringified only on output.
 *
 * Read-binding call sites unwrap the "varies" return as an
 * empty field — the v1 decision is to render divergence
 * blank for now and revisit a richer indicator once write
 * binding makes a divergent commit potentially destructive.
 *
 * @param {any[]} objects
 * @param {string} fieldName
 * @returns {string | "varies"}
 */
function aggregateString(objects, fieldName) {
    if (objects.length === 0) return "";
    const firstRaw = objects[0][fieldName];
    for (let i = 1; i < objects.length; i++) {
        if (objects[i][fieldName] !== firstRaw) return "varies";
    }
    if (firstRaw === null || firstRaw === undefined) return "";
    return String(firstRaw);
}

/**
 * Aggregate a numeric position coordinate (X or Y) across
 * every selected sprite, trigger, and curve. For sprites and
 * triggers the coordinate comes from the object's x/y field;
 * for curves it comes from the bounding-box centroid via
 * computeShapeBboxCentroid. Returns the common value as a
 * stringified number, the literal "varies" when objects
 * disagree, or empty string for an empty selection or a
 * curve whose shape produced no centroid.
 *
 * Used by the Band 2 Position field's read binding. Edits
 * commit through setPositionAxis (absolute), so the field
 * stays editable across single-select, uniform multi-select,
 * and varies multi-select.
 *
 * @param {{ sprites: any[], triggers: any[], curves: any[] }} objs
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
function aggregatePosition(objs, axis) {
    /** @type {number[]} */
    const values = [];
    for (const s of objs.sprites) {
        const v = axis === "x" ? s.x : s.y;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    for (const t of objs.triggers) {
        const v = axis === "x" ? t.x : t.y;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    for (const c of objs.curves) {
        const centroid = computeShapeBboxCentroid(c.shape);
        if (centroid === null) continue;
        const v = axis === "x" ? centroid.x : centroid.y;
        if (Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return String(first);
}

/**
 * Aggregate a curve's W or H dimension across every selected
 * curve. The dimension comes from each curve's bounding box:
 * for an ellipse the bbox width is shape.w (the field is
 * already the bbox extent); for a line it is the absolute
 * difference of endpoint coordinates; for a piste it is the
 * spread of point coordinates in that axis. Returns the
 * common value as a stringified number, "varies" when curves
 * disagree, or empty for an empty curve list.
 *
 * Used by the Band 2 Curve Size field's read binding. Edits
 * commit through setSizeAxis (absolute), so the field stays
 * editable across single-select, uniform multi-select, and
 * varies multi-select.
 *
 * @param {any[]} curves
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
function aggregateCurveSize(curves, axis) {
    /** @type {number[]} */
    const values = [];
    for (const c of curves) {
        const bbox = computeShapeBbox(c.shape);
        if (bbox === null) continue;
        const v = axis === "x" ? (bbox.x2 - bbox.x1) : (bbox.y2 - bbox.y1);
        if (Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return String(first);
}

/**
 * Aggregate the colour field across every selected sprite
 * and trigger. Curves are excluded — they have no per-object
 * colour at this milestone (their stroke uses the global
 * CURVE_COLOUR). Returns the common value as a hex string,
 * "varies" when objects disagree, or empty for an empty
 * sprite-and-trigger slice.
 *
 * @param {{ sprites: any[], triggers: any[], curves: any[] }} objs
 * @returns {string | "varies"}
 */
function aggregateColor(objs) {
    /** @type {string[]} */
    const values = [];
    for (const s of objs.sprites) {
        if (typeof s.color === "string") values.push(s.color);
    }
    for (const t of objs.triggers) {
        if (typeof t.color === "string") values.push(t.color);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return first;
}

/**
 * Compute the axis-aligned bounding box of a curve shape in
 * canvas units, or null when the shape is degenerate or not
 * yet implemented (bezier, helice). Used by the Band 2 read
 * paths to derive Position (centroid) and Curve Size (W, H)
 * values for curves. Mirrors canvas.js's curveBoundingBox
 * function but lives here as a separate copy so the
 * inspector doesn't have to import canvas internals — the
 * shape grammar is small and stable.
 *
 * @param {any} shape
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
function computeShapeBbox(shape) {
    if (shape === null || typeof shape !== "object") return null;
    if (shape.type === "line") {
        const x1 = typeof shape.x1 === "number" ? shape.x1 : 0;
        const y1 = typeof shape.y1 === "number" ? shape.y1 : 0;
        const x2 = typeof shape.x2 === "number" ? shape.x2 : 0;
        const y2 = typeof shape.y2 === "number" ? shape.y2 : 0;
        return {
            x1: Math.min(x1, x2),
            y1: Math.min(y1, y2),
            x2: Math.max(x1, x2),
            y2: Math.max(y1, y2),
        };
    }
    if (shape.type === "ellipse") {
        const cx = typeof shape.cx === "number" ? shape.cx : 0;
        const cy = typeof shape.cy === "number" ? shape.cy : 0;
        const w = typeof shape.w === "number" ? shape.w : 0;
        const h = typeof shape.h === "number" ? shape.h : 0;
        return {
            x1: cx - w / 2,
            y1: cy - h / 2,
            x2: cx + w / 2,
            y2: cy + h / 2,
        };
    }
    if (shape.type === "piste") {
        const pts = shape.points;
        if (!Array.isArray(pts) || pts.length === 0) return null;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (!Array.isArray(p) || p.length < 2) continue;
            const px = typeof p[0] === "number" ? p[0] : 0;
            const py = typeof p[1] === "number" ? p[1] : 0;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        }
        if (!Number.isFinite(minX)) return null;
        return { x1: minX, y1: minY, x2: maxX, y2: maxY };
    }
    return null;
}

/**
 * Compute the bounding-box centroid of a curve shape in
 * canvas units, or null when the shape is degenerate or not
 * yet implemented. Used by the Band 2 Position read path
 * for curves — a curve's "position" is its bbox centroid,
 * matching the visual centre of the selection-marker
 * rectangle drawn around it.
 *
 * @param {any} shape
 * @returns {{ x: number, y: number } | null}
 */
function computeShapeBboxCentroid(shape) {
    const bbox = computeShapeBbox(shape);
    if (bbox === null) return null;
    return {
        x: (bbox.x1 + bbox.x2) / 2,
        y: (bbox.y1 + bbox.y2) / 2,
    };
}

/** @param {ReturnType<typeof buildSelectionContext>} ctx */
function sizeRowLabel(ctx) {
    if (ctx.singleKind === "sprite") return "Sprite Size";
    if (ctx.singleKind === "trigger") return "Trigger Size";
    // For mixed and curve-only selections the row is greyed;
    // default to "Sprite Size" so the row's footprint stays
    // identical regardless of selection.
    return "Sprite Size";
}

/** @param {ReturnType<typeof buildSelectionContext>} ctx */
function sizeRowActive(ctx) {
    // Active only when the selection is exclusively sprites
    // or exclusively triggers — XOR of those two flags, with
    // no curves in the selection.
    return (ctx.hasSprites !== ctx.hasTriggers) && !ctx.hasCurves;
}

/**
 * @param {number} n
 * @param {string} singular
 */
function pluralCount(n, singular) {
    return `${n} ${singular}${n === 1 ? "" : "s"}`;
}

/**
 * Programmatically select every character inside a
 * contenteditable element. Used by the inspector's three
 * editable field builders (Name, generic editable field,
 * Color text) on focus, so that the user's first keystroke
 * replaces the existing value the way a standard <input>
 * behaves. Without this, contenteditable elements receive
 * caret-positioned focus and the user's typing inserts
 * into the existing text — producing surprises like
 * "4" becoming "48" when the user thought they were typing
 * a fresh "8".
 *
 * @param {HTMLElement} el
 */
function selectAllInElement(el) {
    const sel = window.getSelection();
    if (sel === null) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
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
function mkRow() {
    const r = document.createElement("div");
    r.className = "insp-row";
    return r;
}

/**
 * @param {string} text
 * @param {{ width?: number, disabled?: boolean, multiline?: boolean }} [opts]
 */
function mkLabel(text, opts = {}) {
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
function mkField(opts) {
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
function mkCheckbox(opts = {}) {
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
function mkUnits(text, opts = {}) {
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
function mkInlineLetter(letter, opts = {}) {
    const el = document.createElement("span");
    el.className = "insp-inline-letter";
    if (opts.disabled) el.classList.add("disabled");
    el.textContent = letter;
    return el;
}
