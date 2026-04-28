/**
 * Property Inspector module.
 *
 * Renders the form-based property inspector that lives in the
 * Properties tab. The form is always rendered — nothing-
 * selected state shows every band with all fields greyed and
 * a "No selection" handle in the title bar. When at least one
 * object is selected, the same six bands populate with that
 * object's data and the appropriate fields un-grey based on
 * which kinds are present in the selection.
 *
 * Layout is sized by the constraint rows — the Auto Message
 * Interval row (band 4) and the Cycle Parameters row 1 (band
 * 6) hold the most fields and effectively set the minimum
 * form width. Every other row fits within that width with
 * room to spare. This matches the GeoSonix authoring
 * convention.
 *
 * v1 scope: selection-driven greying for all bands plus
 * read- and write-binding for Band 1 (Object ID, Name,
 * Mute, Hide), Band 5 (Active Beats, Beat Strength), and
 * Band 6 (Cycle Duration, Cycle Speeds, Stop at Cycle).
 * Edits commit back through main.js's applyInspectorEdit
 * pipeline. Name and the five curve-field write paths share
 * the same validator-driven edit lifecycle: hard errors
 * squiggle red and refuse to commit (Enter retains focus,
 * blur reverts); soft warnings squiggle yellow and commit.
 * Soft squiggles in v1 are transient — they appear at
 * commit time and are gone after the scene reloads. A
 * persistent indicator can be added later by running each
 * validator on the displayed value at render time, the way
 * Name's duplicate-name check already does.
 *
 * Band 5 read and write paths consult curves only — sprites
 * activate the band in the layout but neither contribute to
 * displayed values nor receive edits, pending the sprite-
 * auto-timer model extension. Multi-select disagreement on
 * a string or numeric field renders as a blank value for
 * now; a richer divergence indicator can follow if its
 * absence becomes a usability problem (an edit into a
 * varies-blank field propagates to every selected curve —
 * possible by explicit action, not by accidental slip).
 *
 * Bands 2, 3, and 4 still show placeholder values pending
 * their own data-binding work. The Inspector exposes
 * setSelection(), setScene(), and setEditCallback(); main.js
 * wires the three together so the inspector tracks selection
 * changes, scene reloads, and edit commits.
 *
 * Six bands above the (deferred) harmony / global area:
 *   1. Identity (id, name, mute, hide — hide is curve-only)
 *   2. Geometry / visual (position, curve size, cursor size,
 *      sprite/trigger size, color)
 *   3. Message functions (two function-binding rows with
 *      Create buttons; labels change by kind: Step/Auto for
 *      sprite, Collision/Auto for trigger, Beat/Sweep for
 *      curve)
 *   4. Auto message interval (curve, trigger, sprite columns)
 *   5. Beat points (curve beat-point generator, active beats
 *      string, strength string) — curves only
 *   6. Cycle parameters (cycle duration, cycle speeds, stop
 *      at cycle, sync-to-beat) — curves only
 *
 * Greying rules:
 *   - Universal fields (position, color, mute) are active
 *     for any non-empty selection.
 *   - id and name are active only for single-object selections;
 *     greyed for multi-select since they're per-object unique.
 *   - Hide applies only to curves; it is greyed when the
 *     selection contains no curves.
 *   - Sprite/Trigger size is active only when the selection is
 *     exclusively sprites or exclusively triggers; the row's
 *     label tracks which.
 *   - Curve-only fields (curve size, cursor size, beat points,
 *     cycle params) are active only when at least one curve
 *     is selected.
 *   - Function-binding rows are active only when the selection
 *     is single-kind, since the labels carry kind-specific
 *     semantics that don't compose across kinds.
 *   - Auto-interval columns are independent: each kind's
 *     column is active iff that kind appears in the selection.
 *
 * Aesthetic tracks GeoSonix closely: dark grey panel, lighter
 * grey field fills (visible even when empty so each field's
 * footprint reads), bright white labels and values for active
 * fields, muted grey for disabled fields, green frames on
 * editable fields, green-filled checkboxes, green stepper dots
 * on numeric fields, green combo-box triangles. See main.css
 * for the .insp-* class styles that produce this look.
 */

// @ts-check

import {
    validateName,
    collectOtherNames,
    nameConflictsInScene,
} from "./nameValidation.js";
import {
    validateCycleDuration,
    validateStopAtCycle,
    validateCycleSpeeds,
    validateActiveBeats,
    validateStrength,
} from "./curveFieldValidation.js";

// Width constants. Centralised so layout adjustments touch
// one set of numbers, not scattered inline styles. The
// constraint rows (band 4 AMI, band 6 cycle params row 1)
// drive these — every other row fits within the natural
// width those rows produce.
const W = {
    // Left-edge label column. Wide enough for "Cycle Speeds"
    // and "Curve Beat Points" at 10pt; everything narrower
    // gets the same width so the label column aligns down
    // the entire form.
    leftLabel: 78,

    // ID field — short numeric/identifier. Eventually holds
    // generated IDs like "sp_a3f7"; 80px fits that comfortably.
    idField: 80,

    // Inline labels next to the row's leftmost field group,
    // sized to the shortest text that fits at 10pt.
    mute: 36,          // "Mute"
    hide: 36,          // "Hide"
    amiCurve: 32,      // "Curve" in AMI row
    amiTrigger: 42,    // "Trigger"
    amiSprite: 36,     // "Sprite"
    curveThick: 60,    // "Curve\nThickness" multiline
    cursorThick: 60,   // "Cursor\nThickness" multiline
    stopAt: 50,        // "Stop at\nCycle" multiline
    triggerSync: 78,   // "Trigger Sync\nTo Beat" multiline

    // Numeric fields.
    posXY: 60,         // Position X, Y
    sizeWH: 60,        // Curve Size W, H
    cursorRL: 50,      // Cursor R, L
    thickness: 60,     // Curve/Cursor Thickness
    spriteTriggerSize: 60,
    cycleDurationF: 60,
    stopAtF: 50,

    // Text fields. funcBinding and rhythmString are sized
    // to fill the inspector's content-driven width — each
    // row reaches roughly the same total width as the
    // Cycle Parameters constraint row, so the function-
    // binding fields run nearly to the Create button at
    // the right margin and the rhythm strings run nearly
    // to the right edge of the panel. Wider rhythm strings
    // also help readability for longer active-beats and
    // strength patterns. If a future row widens the
    // constraint, lift these in step.
    name: 280,
    funcBinding: 280,
    cycleSpeeds: 240,
    rhythmString: 360, // Active Beats / Beat Strength

    // Combos.
    amiCombo: 60,
    triggerSyncCombo: 60,
    beatPointsCombo: 110,
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
        panel.appendChild(this._buildBandMessageFunctions(ctx));
        panel.appendChild(this._buildBandAutoInterval(ctx));
        panel.appendChild(this._buildBandBeatPoints(ctx));
        panel.appendChild(this._buildBandCycleParams(ctx));

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
            if (result.value !== opts.value) {
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
     * by the curve-field write paths in Band 5 (Active Beats,
     * Beat Strength) and Band 6 (Cycle Duration, Cycle
     * Speeds, Stop at Cycle). Each call site supplies a
     * validator function from curveFieldValidation.js plus
     * an editKind tag identifying the edit; the rest of the
     * commit lifecycle — hard error red squiggle on Enter
     * with focus retained, hard error silent revert on blur,
     * soft warning yellow squiggle on commit, ok commit —
     * mirrors the Name field's behaviour. Soft squiggles
     * here are transient (lost on the next render); a
     * persistent indicator could be reintroduced later by
     * running the validator on opts.value at render time,
     * the way Name handles duplicate-name conflicts.
     *
     * Multi-select edits propagate the validated value to
     * every member of the selection's curves array via the
     * matching sceneEditor function. The varies-blank case
     * renders an empty field; a typed-and-committed value
     * will set every selected curve to that value, which is
     * potentially destructive but only by explicit user
     * action.
     *
     * @param {{
     *   value: string,
     *   width: number,
     *   numeric?: boolean,
     *   editable: boolean,
     *   validator: (candidate: string) => { kind: "ok" | "soft" | "hard", value: string, message?: string },
     *   editKind: string,
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
            if (result.value !== opts.value) {
                this._emitEdit({ kind: opts.editKind, value: result.value });
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
     * Band 2 — Geometry and visual. Position and color are
     * universal; curve dimensions activate when curves are in
     * the selection; sprite/trigger size activates when the
     * selection is exclusively that kind.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandGeometry(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const curveDisabled = !ctx.hasCurves;
        const sizeActive = sizeRowActive(ctx);
        const sizeLabel = sizeRowLabel(ctx);

        // Position
        const r1 = mkRow();
        r1.appendChild(mkLabel("Position", { width: W.leftLabel }));
        r1.appendChild(mkField({ value: "0.00", numeric: true, width: W.posXY }));
        r1.appendChild(mkField({ value: "0.00", numeric: true, width: W.posXY }));
        r1.appendChild(mkUnits("(X, Y)"));
        band.appendChild(r1);

        // Curve Size + Curve Thickness
        const r2 = mkRow();
        r2.appendChild(mkLabel("Curve Size", { width: W.leftLabel, disabled: curveDisabled }));
        r2.appendChild(mkField({ value: "0.0000", numeric: true, width: W.sizeWH, disabled: curveDisabled }));
        r2.appendChild(mkField({ value: "0.0000", numeric: true, width: W.sizeWH, disabled: curveDisabled }));
        r2.appendChild(mkUnits("(W, H)", { disabled: curveDisabled }));
        r2.appendChild(mkLabel("Curve\nThickness", { width: W.curveThick, disabled: curveDisabled, multiline: true }));
        r2.appendChild(mkField({ value: "1.0000", numeric: true, width: W.thickness, disabled: curveDisabled }));
        band.appendChild(r2);

        // Cursor Size + Cursor Thickness
        const r3 = mkRow();
        r3.appendChild(mkLabel("Cursor Size", { width: W.leftLabel, disabled: curveDisabled }));
        r3.appendChild(mkInlineLetter("R", { disabled: curveDisabled }));
        r3.appendChild(mkField({ value: "0.50", numeric: true, width: W.cursorRL, disabled: curveDisabled }));
        r3.appendChild(mkInlineLetter("L", { disabled: curveDisabled }));
        r3.appendChild(mkField({ value: "0.50", numeric: true, width: W.cursorRL, disabled: curveDisabled }));
        r3.appendChild(mkLabel("Cursor\nThickness", { width: W.cursorThick, disabled: curveDisabled, multiline: true }));
        r3.appendChild(mkField({ value: "2.0000", numeric: true, width: W.thickness, disabled: curveDisabled }));
        band.appendChild(r3);

        // Sprite/Trigger size — label tracks the active kind,
        // greyed for mixed selections (both sprites and
        // triggers) and selections containing curves.
        const r4 = mkRow();
        r4.appendChild(mkLabel(sizeLabel, { width: W.leftLabel, disabled: !sizeActive }));
        r4.appendChild(mkField({ value: "0.50", numeric: true, width: W.spriteTriggerSize, disabled: !sizeActive }));
        band.appendChild(r4);

        // Color — universal
        const r5 = mkRow();
        r5.appendChild(mkLabel("Color", { width: W.leftLabel }));
        r5.appendChild(mkColorField({ hex: "#3A8FDC" }));
        band.appendChild(r5);

        return band;
    }

    /**
     * Band 3 — Message functions. Active only when the
     * selection is single-kind (since the labels carry kind-
     * specific semantics). Labels: Step/Auto for sprites,
     * Collision/Auto for triggers, Beat/Sweep for curves.
     * Multi-kind selections see the default sprite labels,
     * greyed.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandMessageFunctions(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const labels = functionLabelsFor(ctx);
        const active = ctx.singleKind !== null;
        const dis = !active;

        const r1 = mkRow();
        r1.appendChild(mkLabel(labels[0], { width: W.leftLabel, disabled: dis }));
        r1.appendChild(mkField({ value: "", width: W.funcBinding, disabled: dis }));
        r1.appendChild(mkCreateButton({ disabled: dis }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel(labels[1], { width: W.leftLabel, disabled: dis }));
        r2.appendChild(mkField({ value: "", width: W.funcBinding, disabled: dis }));
        r2.appendChild(mkCreateButton({ disabled: dis }));
        band.appendChild(r2);

        return band;
    }

    /**
     * Band 4 — Auto message interval. Three independent
     * columns; each is active iff the corresponding kind is
     * in the selection. The Auto Message Interval label
     * itself stays bright (the row label always applies).
     * One of the two constraint rows that drives form width.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandAutoInterval(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const r = mkRow();
        r.appendChild(mkLabel("Auto Message\nInterval", { width: W.leftLabel, multiline: true }));
        r.appendChild(mkLabel("Curve", { width: W.amiCurve, disabled: !ctx.hasCurves }));
        r.appendChild(mkCombo({ value: "Off", width: W.amiCombo, disabled: !ctx.hasCurves }));
        r.appendChild(mkLabel("Trigger", { width: W.amiTrigger, disabled: !ctx.hasTriggers }));
        r.appendChild(mkCombo({ value: "Off", width: W.amiCombo, disabled: !ctx.hasTriggers }));
        r.appendChild(mkLabel("Sprite", { width: W.amiSprite, disabled: !ctx.hasSprites }));
        r.appendChild(mkCombo({ value: "Off", width: W.amiCombo, disabled: !ctx.hasSprites }));
        band.appendChild(r);

        return band;
    }

    /**
     * Band 5 — Beat points. Active when the selection contains
     * curves, sprites, or both — sprites use the same active-
     * beats and strength strings to gate their auto-timer
     * firings, with the auto interval providing the metric
     * pulse and the strings deciding which pulses actually
     * sound and how strongly. The first row's label tracks the
     * selection: "Curve / Beat Points" for curves alone,
     * "Sprite / Auto Beats" for sprites alone, "Beat / Pattern"
     * when both are present. Triggers in the selection don't
     * affect this band — they have no beat-pattern feature and
     * are simply left untouched by edits made here, so a mixed
     * selection of curves or sprites with triggers still keeps
     * the band active. Empty fields still render their lighter-
     * grey footprint so the row layout reads as a row of fields
     * even when greyed.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandBeatPoints(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        const dis = !beatBandActive(ctx);
        const label = beatBandLabel(ctx);

        // Read binding consults curves only. The band
        // activates for sprites too (see beatBandActive),
        // but sprites have no activeBeats or strength fields
        // in their schema or runtime model yet — that's a
        // future milestone alongside sprite auto-timer
        // simulation. When sprite-side fields are added,
        // include objs.sprites in the aggregate sources here
        // and update the audit doc's Sprite Auto Beats /
        // Strength entry.
        const objs = selectedObjects(this._scene, this._selection);
        const activeBeatsAgg = aggregateString(objs.curves, "activeBeats");
        const strengthAgg = aggregateString(objs.curves, "strength");

        const r1 = mkRow();
        r1.appendChild(mkLabel(label, { width: W.leftLabel, disabled: dis, multiline: true }));
        r1.appendChild(mkCombo({ value: "None", width: W.beatPointsCombo, disabled: dis }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Active Beats", { width: W.leftLabel, disabled: dis }));
        r2.appendChild(this._buildEditableField({
            value: activeBeatsAgg === "varies" ? "" : activeBeatsAgg,
            width: W.rhythmString,
            // Editable iff curves are in the selection, even
            // when sprites also activate the band: sprite-side
            // write is deferred along with sprite-side read.
            editable: ctx.hasCurves,
            validator: validateActiveBeats,
            editKind: "setActiveBeats",
        }));
        band.appendChild(r2);

        const r3 = mkRow();
        r3.appendChild(mkLabel("Beat Strength", { width: W.leftLabel, disabled: dis }));
        r3.appendChild(this._buildEditableField({
            value: strengthAgg === "varies" ? "" : strengthAgg,
            width: W.rhythmString,
            editable: ctx.hasCurves,
            validator: validateStrength,
            editKind: "setStrength",
        }));
        band.appendChild(r3);

        return band;
    }

    /**
     * Band 6 — Cycle parameters. Curves-only band. Cycle
     * Duration is the cycle's length in score beats and also
     * the source of the cycle's tick-position resolution
     * (one tick per beat); Cycle Speeds is a string of per-
     * cycle multipliers cycling through the list cycle by
     * cycle (negative values reverse direction); Stop at
     * Cycle halts the cursor after a specified count (-1
     * means play forever). Read binding is wired for the
     * three curve fields; the Trigger Sync to Beat combo is
     * a placeholder pending its own design pass. The first
     * row is the other constraint row driving form width.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCycleParams(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        const dis = !ctx.hasCurves;

        // Cycle params are curve-only; read binding pulls
        // from the selected curves with multi-select
        // disagreement rendered as a blank field per the v1
        // read-binding decision. cycleDuration and
        // stopAtCycle are integers at runtime; aggregateString
        // stringifies them for display. The Trigger Sync to
        // Beat combo stays a placeholder pending its own
        // design pass.
        const objs = selectedObjects(this._scene, this._selection);
        const cycleDurationAgg = aggregateString(objs.curves, "cycleDuration");
        const stopAtCycleAgg = aggregateString(objs.curves, "stopAtCycle");
        const cycleSpeedsAgg = aggregateString(objs.curves, "cycleSpeeds");

        const r1 = mkRow();
        r1.appendChild(mkLabel("Cycle\nDuration", { width: W.leftLabel, disabled: dis, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: cycleDurationAgg === "varies" ? "" : cycleDurationAgg,
            numeric: true,
            width: W.cycleDurationF,
            editable: !dis,
            validator: validateCycleDuration,
            editKind: "setCycleDuration",
        }));
        r1.appendChild(mkUnits("beats", { disabled: dis }));
        r1.appendChild(mkLabel("Stop at\nCycle", { width: W.stopAt, disabled: dis, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: stopAtCycleAgg === "varies" ? "" : stopAtCycleAgg,
            numeric: true,
            width: W.stopAtF,
            editable: !dis,
            validator: validateStopAtCycle,
            editKind: "setStopAtCycle",
        }));
        r1.appendChild(mkLabel("Trigger Sync\nTo Beat", { width: W.triggerSync, disabled: dis, multiline: true }));
        r1.appendChild(mkCombo({ value: "Off", width: W.triggerSyncCombo, disabled: dis }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Cycle Speeds", { width: W.leftLabel, disabled: dis }));
        r2.appendChild(this._buildEditableField({
            value: cycleSpeedsAgg === "varies" ? "" : cycleSpeedsAgg,
            width: W.cycleSpeeds,
            editable: !dis,
            validator: validateCycleSpeeds,
            editKind: "setCycleSpeeds",
        }));
        band.appendChild(r2);

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

/** @param {ReturnType<typeof buildSelectionContext>} ctx */
function functionLabelsFor(ctx) {
    if (ctx.singleKind === "sprite") return ["Step", "Auto"];
    if (ctx.singleKind === "trigger") return ["Collision", "Auto"];
    if (ctx.singleKind === "curve") return ["Beat", "Sweep"];
    // Multi-kind: row is greyed; default to sprite labels so
    // the row's text content stays the same length.
    return ["Step", "Auto"];
}

/**
 * Whether the Beat Points band (band 5) should be active for
 * the current selection. Curves use the active-beats and
 * strength strings as their cycle rhythm; sprites use the
 * same strings to gate their auto-timer firings. Triggers
 * have no beat-pattern feature — their presence in a mixed
 * selection neither activates nor deactivates the band.
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 */
function beatBandActive(ctx) {
    return ctx.hasCurves || ctx.hasSprites;
}

/**
 * The first-row label for the Beat Points band, picked from
 * the kinds present in the selection (ignoring triggers,
 * which don't participate). Curves alone get the original
 * "Curve / Beat Points" wording; sprites alone get "Sprite
 * / Auto Beats"; mixed curves-and-sprites get the neutral
 * "Beat / Pattern". When neither curves nor sprites are
 * present (e.g. trigger-only selection) the band is greyed
 * and the label falls back to the curve wording — the v1
 * default — so the form's footprint stays consistent.
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 */
function beatBandLabel(ctx) {
    if (ctx.hasCurves && ctx.hasSprites) return "Beat\nPattern";
    if (ctx.hasSprites) return "Sprite\nAuto Beats";
    return "Curve\nBeat Points";
}

/**
 * @param {number} n
 * @param {string} singular
 */
function pluralCount(n, singular) {
    return `${n} ${singular}${n === 1 ? "" : "s"}`;
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
 * @param {{ value?: string, width?: number, disabled?: boolean }} opts
 */
function mkCombo(opts) {
    const el = document.createElement("div");
    el.className = "insp-combo";
    if (opts.disabled) el.classList.add("disabled");
    if (typeof opts.width === "number") el.style.width = `${opts.width}px`;
    el.textContent = opts.value ?? "";
    return el;
}

/**
 * @param {{ disabled?: boolean }} [opts]
 */
function mkCreateButton(opts = {}) {
    const el = document.createElement("button");
    el.className = "insp-btn-create";
    if (opts.disabled) el.classList.add("disabled");
    el.textContent = "Create";
    return el;
}

/**
 * @param {{ hex: string, disabled?: boolean }} opts
 */
function mkColorField(opts) {
    const el = document.createElement("div");
    el.className = "insp-color";
    if (opts.disabled) el.classList.add("disabled");

    const swatch = document.createElement("div");
    swatch.className = "insp-color-swatch";
    swatch.style.backgroundColor = opts.hex;
    el.appendChild(swatch);

    const text = document.createElement("div");
    text.className = "insp-color-text";
    text.textContent = opts.hex.toUpperCase();
    el.appendChild(text);

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
