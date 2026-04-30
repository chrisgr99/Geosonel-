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
 * Layout is sized by the constraint rows — the Beat Points
 * timing row (band 5 row 1) and the Cycle Parameters row
 * (band 6) hold the most fields and effectively set the
 * minimum form width. Every other row fits within that width
 * with room to spare. The Auto Beat Interval row (band 4)
 * also drives the layout but became narrower in v2.3 once
 * the Curve column was dropped from it (curves get their
 * beat interval from the band 5 timing row instead). This
 * matches the GeoSonix authoring convention.
 *
 * v1 scope: selection-driven greying for all bands plus
 * read- and write-binding for Band 1 (Object ID, Name,
 * Mute, Hide), Band 2 (Position, Curve Size W/H, Curve
 * Thickness, Cursor R/L, Cursor Thickness, Sprite/Trigger
 * Size, Color), Band 5 (Active Beats, Beat Strength), and
 * Band 6 (Cycle Speeds, Stop at Cycle, Beat Offset).
 * Edits commit back through main.js's applyInspectorEdit
 * pipeline. Name and the curve-field write paths share
 * the same validator-driven edit lifecycle: hard errors
 * squiggle red and refuse to commit (Enter retains focus,
 * blur reverts); soft warnings squiggle yellow and commit.
 * Soft squiggles in v1 are transient — they appear at
 * commit time and are gone after the scene reloads. A
 * persistent indicator can be added later by running each
 * validator on the displayed value at render time, the way
 * Name's duplicate-name check already does.
 *
 * Band 2 special cases. Position and Curve Size W/H use
 * absolute-set semantics: typing a value commits that value
 * as the new coordinate (or dimension) for every applicable
 * selected object. This works the same way across single-
 * select, uniform multi-select, and varies multi-select
 * cases — including snapping multiple objects with
 * different starting positions to the same X by typing into
 * the field's blank "varies" state. Position emits
 * setPositionAxis ({axis, value}); curve W/H emit setSizeAxis
 * ({axis, value}); the rest emit setX edits with the typed
 * value as payload. Per-shape geometry inside
 * setPositionAxisOnSelection and setSizeAxisOnSelection
 * handles the curve-vs-sprite differences (sprites and
 * triggers assign x/y directly; curves translate by a per-
 * shape delta from current centroid to target, or scale by
 * a per-shape factor from current bbox extent to target).
 * Curves carry no per-object colour at this milestone — a
 * curve-color discussion is deferred — so the Color row
 * activates only when sprites or triggers are in the
 * selection.
 *
 * Numeric fields support scroll-wheel adjustment as well as
 * text edit. Hovering over a numeric field and rotating the
 * scroll wheel nudges the value in 0.3 increments — wheel
 * up to increase, wheel down to decrease. The validator
 * clamps during scrolling so field-specific bounds act as
 * soft walls (a Curve W field with min: 0 won't display
 * negative values mid-scroll). Each wheel event emits a
 * fresh edit so the canvas, the JSON tab, and any other
 * scene-derived UI track the value continually as the user
 * scrolls. Emits bypass the keyboard commit's destruction-
 * blur guard because wheel scrolling doesn't focus the
 * field; the guard only matters for focused-field edits
 * where re-render fires a stray blur on the detached node.
 * A modifier-key option to alter the step rate is deferred
 * until after some real use — the current 0.3 rate is the
 * starting point.
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
 * Bands 3 and 4 stay visible as placeholder rows pending
 * the Strudel migration (DESIGN.md §27), since their
 * semantics overlap with the pattern model and will be
 * redesigned alongside Band 5's collapse into a single
 * Strudel-pattern field. Their fields keep their current
 * footprint so the form layout stays consistent across
 * the migration window. The Inspector exposes
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
 *   4. Auto beat interval (trigger, sprite columns)
 *   5. Beat points (curve beat-point generator, active beats
 *      string, strength string) — curves only
 *   6. Cycle parameters (cycle speeds, stop at cycle, beat
 *      offset) — curves only
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
 *   - Auto-beat-interval columns are independent: each kind's
 *     column is active iff that kind appears in the selection.
 *     Curves don't have a column on the row — their beat
 *     interval lives in the Band 5 timing row.
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
    validateNumber,
    validateHexColor,
    validateBeatInterval,
    validateBeatsPerBar,
    validateBeatOffset,
    validateBeatPointsMode,
    validateActiveBeatsCount,
    validateBeatShift,
    validateRepeats,
} from "./curveFieldValidation.js";
import { allBeatIntervalTokens } from "./beatIntervals.js";

// Width constants. Centralised so layout adjustments touch
// one set of numbers, not scattered inline styles. The
// constraint rows (band 4 ABI, band 5 row 1, band 6 cycle
// params row) drive these — every other row fits within
// the natural width those rows produce.
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
    abiTrigger: 42,    // "Trigger" in Auto Beat Interval row
    abiSprite: 36,     // "Sprite"
    curveThick: 60,    // "Curve\nThickness" multiline
    cursorThick: 60,   // "Cursor\nThickness" multiline
    stopAt: 50,        // "Stop at\nCycle" multiline

    // Numeric fields.
    posXY: 60,         // Position X, Y
    sizeWH: 60,        // Curve Size W, H
    cursorRL: 50,      // Cursor R, L
    thickness: 60,     // Curve/Cursor Thickness
    spriteTriggerSize: 60,
    cycleDurationF: 50,  // Beats/Cycle
    beatsPerBarF: 36,    // Beats/Bar
    beatOffsetF: 50,     // Beat Offset
    activeBeatsCountF: 36,
    beatShiftF: 36,
    repeatsF: 36,
    stopAtF: 50,

    // Multi-line tight labels for Band 5's timing row, packed
    // tightly to fit five fields on one row at the inspector's
    // approximately-700-pixel target width.
    beatsPerCycleLabel: 38,  // "Beats/\nCycle"
    beatIntervalLabel: 50,   // "Beat\nInterval"
    beatsPerBarLabel: 32,    // "Beats/\nBar"
    activeBeatsLabel: 50,    // "Active\nBeats" (Euclidean param row)
    beatShiftLabel: 32,      // "Beat\nShift"
    repeatsLabel: 42,        // "Repeats" (single line; sized to text)
    beatOffsetLabel: 36,     // "Beat\nOffset"

    // Text fields. funcBinding and rhythmString are sized
    // to fill the inspector's content-driven width — each
    // row reaches roughly the same total width as the
    // Cycle Parameters constraint row, so the function-
    // binding fields run nearly to the Create button at
    // the right margin and the rhythm strings run nearly
    // to the right edge of the panel. Wider rhythm strings
    // also help readability for longer active-beats and
    // strength patterns. cycleSpeeds is sized to keep its
    // row no wider than the band 5 timing row — 240px was
    // wider than the typical multiplier list needs and
    // pushed band 6 out past the other constraint rows;
    // 200px fits a 12-or-so-character list comfortably
    // (e.g. "-1 2 0.5 1.5") with room to scroll for longer
    // ones. If a future row widens the constraint, lift
    // these in step.
    name: 280,
    funcBinding: 280,
    cycleSpeeds: 200,
    rhythmString: 360, // Active Beats / Beat Strength

    // Combos.
    abiCombo: 80,               // Auto Beat Interval token dropdown (matches beatIntervalCombo)
    beatPointsModeCombo: 92,    // Mode dropdown: "Normal" / "Euclidean" / "None"
    beatIntervalCombo: 80,      // Beat Interval token dropdown
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
        /**
         * Per-curve stash for activeBeats strings when the
         * user transitions a curve into none mode. Keyed by
         * curve id; value is the string that was displayed
         * (with pipes preserved) at the moment of the
         * transition. Consulted on transition out of none
         * back to normal mode and dropped after restoration.
         * Persists across selection changes and scene
         * reloads; cleared only on inspector destruction
         * (page reload). See decision 5 of milestone 2.
         * @type {Map<string, string>}
         */
        this._noneStash = new Map();
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
     * by the curve-field write paths in Band 5 (Active Beats,
     * Beat Strength) and Band 6 (Cycle Duration, Cycle
     * Speeds, Stop at Cycle), and by every editable field in
     * Band 2 (Position, sizes, cursor extents, thicknesses,
     * curve W/H). Each call site supplies a validator function
     * from curveFieldValidation.js plus either an editKind tag
     * identifying the edit OR an onCommit callback that
     * receives the validated value and emits whatever edit
     * shape it likes — used by Position (translateSelection
     * with computed delta) and curve W/H (scaleCurveAxis with
     * computed factor) where the edit isn't a simple
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
        // translateSelection (delta-based) and Curve W/H
        // emits scaleCurveAxis (factor-based) — a double-
        // application of either compounds visibly: a
        // requested move from y=1.84 to y=0 produces y=-1.84
        // because the dy=-1.84 delta gets applied twice.
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
     * Band 4 — Auto Beat Interval. Two independent columns,
     * one for triggers and one for sprites; each is active
     * iff the corresponding kind is in the selection. The
     * row label itself stays bright (always applies). The
     * Curve column was dropped in v2.3: curves carry their
     * beat interval in the Band 5 timing row, so a separate
     * Curve column here was redundant and pulled the row
     * out wider than its sibling constraint rows.
     *
     * The two combos are placeholders pending the Strudel
     * migration (DESIGN.md §27), where the auto-firing
     * cadence is expected to be expressed by a pattern
     * rather than a single interval token. They render the
     * full beat-interval token list plus an "Off" entry as
     * a UI preview, but their onSelect is a no-op: nothing
     * commits, and the displayed value stays "Off". When the
     * Strudel pattern model lands the field will rewire to a
     * real value (or be replaced wholesale by a pattern
     * field, in which case this row collapses).
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandAutoInterval(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const r = mkRow();
        r.appendChild(mkLabel("Auto Beat\nInterval", { width: W.leftLabel, multiline: true }));
        r.appendChild(mkLabel("Trigger", { width: W.abiTrigger, disabled: !ctx.hasTriggers }));
        r.appendChild(this._buildAutoBeatIntervalCombo({
            disabled: !ctx.hasTriggers,
        }));
        r.appendChild(mkLabel("Sprite", { width: W.abiSprite, disabled: !ctx.hasSprites }));
        r.appendChild(this._buildAutoBeatIntervalCombo({
            disabled: !ctx.hasSprites,
        }));
        band.appendChild(r);

        return band;
    }

    /**
     * Build an Auto Beat Interval dropdown for the Band 4
     * Trigger or Sprite column. Options are "Off" plus the
     * full beat-interval token list. Selection is a no-op
     * pending the Strudel migration; the popover opens and
     * closes normally, but no edit is emitted and the
     * displayed value remains "Off". A user-visible UI
     * preview that lets the row's intent be readable from
     * the inspector.
     * @param {{ disabled: boolean }} opts
     */
    _buildAutoBeatIntervalCombo(opts) {
        const options = [
            { value: "off", label: "Off" },
            ...allBeatIntervalTokens().map((token) => ({ value: token, label: token })),
        ];
        return mkPopoverCombo({
            value: "Off",
            width: W.abiCombo,
            disabled: opts.disabled,
            options,
            currentValue: "off",
            onSelect: () => {
                // Placeholder pending data binding. The
                // popover closes via closeAllPopovers in the
                // option-click handler; nothing else needs
                // to happen here.
            },
        });
    }

    /**
     * Band 5 — Beat points. Curves and sprites both activate
     * the band; sprites contribute layout but not data binding
     * yet (sprite-side activeBeats and strength fields are
     * deferred along with sprite-auto-timer simulation).
     * Triggers in the selection are simply ignored. Empty
     * fields still render their lighter-grey footprint so the
     * row layout reads as a row of fields even when greyed.
     *
     * Layout in v2.3 (four rows tall, fixed regardless of
     * mode per the reflow rule in DESIGN.md §13):
     *
     *   r1: row label "Curve / Beat Points" + Mode dropdown
     *       + Beats/Cycle + Beat Interval + Beats/Bar.
     *   r2: Euclidean parameter row (Active Beats + Beat
     *       Shift + Repeats). Visible only when mode is
     *       euclidean. The row's vertical space stays
     *       reserved in normal and none modes so the
     *       activeBeats and strength rows below don't shift
     *       position.
     *   r3: Active Beats string. Read-only when mode is
     *       euclidean (string is generator-driven) or none
     *       (string is conceptually empty).
     *   r4: Beat Strength string. Editable in normal and
     *       euclidean modes; read-only in none.
     *
     * The activeBeats and strength fields use the rhythm
     * string variant of the editable-field builder, which
     * runs per-keystroke pipe insertion and canonicalisation
     * for live visual feedback as the user types (see
     * _buildRhythmStringField).
     *
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
        const modeAgg = aggregateString(objs.curves, "beatPointsMode");
        const cycleDurationAgg = aggregateString(objs.curves, "cycleDuration");
        const beatIntervalAgg = aggregateString(objs.curves, "beatInterval");
        const beatsPerBarAgg = aggregateString(objs.curves, "beatsPerBar");
        const activeBeatsAgg = aggregateString(objs.curves, "activeBeats");
        const strengthAgg = aggregateString(objs.curves, "strength");
        const activeBeatsCountAgg = aggregateString(objs.curves, "activeBeatsCount");
        const beatShiftAgg = aggregateString(objs.curves, "beatShift");
        const repeatsAgg = aggregateString(objs.curves, "repeats");

        // Determine effective mode for visibility decisions.
        // Multi-select with mismatched modes shows the mode
        // dropdown blank; the Euclidean parameter row hides
        // (its visibility requires every selected curve to
        // be in euclidean mode); the activeBeats and
        // strength rows are editable.
        const allEuclidean = ctx.hasCurves &&
            modeAgg !== "varies" && modeAgg === "euclidean";
        const allNone = ctx.hasCurves &&
            modeAgg !== "varies" && modeAgg === "none";
        // The activeBeats field is read-only whenever every
        // selected curve is in euclidean or none mode. Mixed-
        // mode selections (e.g. one normal + one euclidean)
        // remain editable since some curves can accept
        // edits; the per-curve mutators decide what to do
        // with the value (curves in normal mode store it,
        // curves in euclidean mode have it overridden by the
        // generator on the next regeneration).
        const activeBeatsReadOnly = allEuclidean || allNone;
        // Strength is read-only only in none mode; in
        // euclidean mode the user still composes velocity
        // patterns by hand.
        const strengthReadOnly = allNone;

        // beatsPerBar value parsed for use by the rhythm-
        // string field's pipe-placement helper. Falls back
        // to 4 when the aggregate is empty or non-numeric
        // (varies, no curves selected).
        const beatsPerBar = parseBeatsPerBar(beatsPerBarAgg);

        // --- Row 1: timing fields ---
        const r1 = mkRow();
        r1.appendChild(mkLabel(label, { width: W.leftLabel, disabled: dis, multiline: true }));
        r1.appendChild(this._buildModeCombo({
            value: modeAgg === "varies" ? "" : modeAgg,
            disabled: dis || !ctx.hasCurves,
            currentActiveBeats: activeBeatsAgg,
        }));
        r1.appendChild(mkLabel("Beats/\nCycle", { width: W.beatsPerCycleLabel, disabled: dis || !ctx.hasCurves, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: cycleDurationAgg === "varies" ? "" : cycleDurationAgg,
            numeric: true,
            width: W.cycleDurationF,
            editable: ctx.hasCurves,
            validator: validateCycleDuration,
            editKind: "setCycleDuration",
        }));
        r1.appendChild(mkLabel("Beat\nInterval", { width: W.beatIntervalLabel, disabled: dis || !ctx.hasCurves, multiline: true }));
        r1.appendChild(this._buildBeatIntervalCombo({
            value: beatIntervalAgg === "varies" ? "" : beatIntervalAgg,
            disabled: dis || !ctx.hasCurves,
        }));
        r1.appendChild(mkLabel("Beats/\nBar", { width: W.beatsPerBarLabel, disabled: dis || !ctx.hasCurves, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: beatsPerBarAgg === "varies" ? "" : beatsPerBarAgg,
            numeric: true,
            width: W.beatsPerBarF,
            editable: ctx.hasCurves,
            validator: validateBeatsPerBar,
            editKind: "setBeatsPerBar",
        }));
        band.appendChild(r1);

        // --- Row 2: Euclidean parameters (visible only in euclidean mode) ---
        // The row's vertical space is reserved unconditionally
        // by giving the empty row the same min-height as the
        // populated row (.insp-row's CSS provides this), so
        // bands below stay in their fixed positions per the
        // reflow rule. When mode is normal or none, we render
        // an empty row with no children.
        const r2 = mkRow();
        if (allEuclidean) {
            r2.appendChild(mkLabel("", { width: W.leftLabel }));
            r2.appendChild(mkLabel("Active\nBeats", { width: W.activeBeatsLabel, multiline: true }));
            r2.appendChild(this._buildEditableField({
                value: activeBeatsCountAgg === "varies" ? "" : activeBeatsCountAgg,
                numeric: true,
                width: W.activeBeatsCountF,
                editable: true,
                validator: (c) => validateActiveBeatsCount(c, parseCycleDuration(cycleDurationAgg)),
                onCommit: (newValue) => {
                    this._emitEdit({
                        kind: "setEuclideanParameter",
                        paramName: "activeBeatsCount",
                        value: newValue,
                    });
                },
            }));
            r2.appendChild(mkLabel("Beat\nShift", { width: W.beatShiftLabel, multiline: true }));
            r2.appendChild(this._buildEditableField({
                value: beatShiftAgg === "varies" ? "" : beatShiftAgg,
                numeric: true,
                width: W.beatShiftF,
                editable: true,
                validator: validateBeatShift,
                onCommit: (newValue) => {
                    this._emitEdit({
                        kind: "setEuclideanParameter",
                        paramName: "beatShift",
                        value: newValue,
                    });
                },
            }));
            r2.appendChild(mkLabel("Repeats", { width: W.repeatsLabel }));
            r2.appendChild(this._buildEditableField({
                value: repeatsAgg === "varies" ? "" : repeatsAgg,
                numeric: true,
                width: W.repeatsF,
                editable: true,
                validator: (c) => validateRepeats(c, parseCycleDuration(cycleDurationAgg)),
                onCommit: (newValue) => {
                    this._emitEdit({
                        kind: "setEuclideanParameter",
                        paramName: "repeats",
                        value: newValue,
                    });
                },
            }));
        }
        band.appendChild(r2);

        // --- Row 3: Active Beats string ---
        const r3 = mkRow();
        r3.appendChild(mkLabel("Active Beats", { width: W.leftLabel, disabled: dis }));
        r3.appendChild(this._buildRhythmStringField({
            value: activeBeatsAgg === "varies" ? "" : activeBeatsAgg,
            width: W.rhythmString,
            editable: ctx.hasCurves && !activeBeatsReadOnly,
            readOnlyHint: activeBeatsReadOnly
                ? (allEuclidean
                    ? "Read-only in Euclidean mode \u2014 change the mode to type a custom pattern."
                    : "Read-only in None mode \u2014 change the mode to type a custom pattern.")
                : null,
            validator: validateActiveBeats,
            editKind: "setActiveBeats",
            beatsPerBar,
            stringKind: "activeBeats",
        }));
        band.appendChild(r3);

        // --- Row 4: Beat Strength string ---
        const r4 = mkRow();
        r4.appendChild(mkLabel("Beat Strength", { width: W.leftLabel, disabled: dis }));
        r4.appendChild(this._buildRhythmStringField({
            // None mode displays an empty strength field even
            // though the underlying data persists. The
            // strength string is not consulted by the engine
            // when no beats fire (None mode's activeBeats is
            // "."), so showing the previous values would
            // suggest they're in effect when they aren't. The
            // data survives the round-trip so switching back
            // to Normal or Euclidean re-displays the saved
            // strength pattern.
            value: strengthAgg === "varies"
                ? ""
                : (allNone ? "" : strengthAgg),
            width: W.rhythmString,
            editable: ctx.hasCurves && !strengthReadOnly,
            readOnlyHint: strengthReadOnly
                ? "Read-only in None mode \u2014 change the mode to type a custom pattern."
                : null,
            validator: validateStrength,
            editKind: "setStrength",
            beatsPerBar,
            stringKind: "strength",
        }));
        band.appendChild(r4);

        return band;
    }

    /**
     * Band 6 — Cycle parameters. Curves-only band, sized as
     * one row in v2.3 after Beats/Cycle migrated up to Band 5
     * and Beat Offset joined Cycle Speeds + Stop at Cycle on
     * the row. The earlier Trigger Sync to Beat placeholder
     * has been dropped from the row; the question of how
     * sync-to-beat is expressed (per-trigger versus per-curve,
     * what its semantics are) is now folded into the Strudel
     * pattern redesign in DESIGN.md §27 rather than carrying
     * an inert combo on the band.
     *
     * Field roles. Cycle Speeds is a string of per-cycle
     * multipliers cycling through the list cycle by cycle
     * (negative values reverse direction). Stop at Cycle
     * halts the cursor after a specified count (-1 means
     * play forever). Beat Offset shifts the cursor's
     * score-beat-zero position by a signed integer slot
     * count, also defining where rewind sends the cursor.
     *
     * Read binding pulls from the selected curves; multi-
     * select disagreement renders as a blank field per the
     * v1 read-binding decision.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCycleParams(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        const dis = !ctx.hasCurves;

        const objs = selectedObjects(this._scene, this._selection);
        const cycleSpeedsAgg = aggregateString(objs.curves, "cycleSpeeds");
        const stopAtCycleAgg = aggregateString(objs.curves, "stopAtCycle");
        const beatOffsetAgg = aggregateString(objs.curves, "beatOffset");

        const r1 = mkRow();
        r1.appendChild(mkLabel("Cycle Speeds", { width: W.leftLabel, disabled: dis }));
        r1.appendChild(this._buildEditableField({
            value: cycleSpeedsAgg === "varies" ? "" : cycleSpeedsAgg,
            width: W.cycleSpeeds,
            editable: !dis,
            validator: validateCycleSpeeds,
            editKind: "setCycleSpeeds",
        }));
        r1.appendChild(mkLabel("Stop at\nCycle", { width: W.stopAt, disabled: dis, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: stopAtCycleAgg === "varies" ? "" : stopAtCycleAgg,
            numeric: true,
            width: W.stopAtF,
            editable: !dis,
            validator: validateStopAtCycle,
            editKind: "setStopAtCycle",
        }));
        r1.appendChild(mkLabel("Beat\nOffset", { width: W.beatOffsetLabel, disabled: dis, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: beatOffsetAgg === "varies" ? "" : beatOffsetAgg,
            numeric: true,
            width: W.beatOffsetF,
            editable: !dis,
            validator: validateBeatOffset,
            editKind: "setBeatOffset",
        }));
        band.appendChild(r1);

        return band;
    }

    // --- Custom popover combo widgets (Mode, Beat Interval) ---

    /**
     * Build the beat-points Mode dropdown for Band 5's row 1.
     * Three options: Normal, Euclidean, None. Selection emits
     * a setBeatPointsMode edit; the mutator handles parameter
     * insertion, activeBeats regeneration, and (for the None
     * transition) replacement with "." plus the inspector's
     * stash hand-off described in milestone 2's question 5.
     *
     * Stash mechanics. On transition into None, the
     * inspector captures the current activeBeats string
     * (with pipes preserved as displayed) into _noneStash
     * keyed by each affected curve's id. On transition out
     * of None back to Normal, the stashed string is
     * forwarded to the mutator as restoreActiveBeats so the
     * curve's previous activeBeats is restored. On
     * transition from None to Euclidean, the stash is
     * cleared without consultation since Euclidean fills
     * activeBeats from the generator. Stash is keyed by
     * curve id and persists across selection changes and
     * scene reloads; cleared only on inspector destruction.
     *
     * Disabled state shows the existing value (or empty for
     * varies-or-no-curves selection) without the dropdown
     * triangle's full green tint, matching mkCombo's
     * disabled treatment. Multi-select with mixed modes
     * shows a blank value; selecting an option from the
     * popover commits that mode to every selected curve.
     *
     * @param {{ value: string, disabled: boolean, currentActiveBeats: string }} opts
     */
    _buildModeCombo(opts) {
        return mkPopoverCombo({
            value: modeDisplayLabel(opts.value),
            width: W.beatPointsModeCombo,
            disabled: opts.disabled,
            options: [
                { value: "normal", label: "Normal" },
                { value: "euclidean", label: "Euclidean" },
                { value: "none", label: "None" },
            ],
            currentValue: opts.value,
            onSelect: (newMode) => this._onModeSelected(newMode, opts.value, opts.currentActiveBeats),
        });
    }

    /**
     * Handle a Mode dropdown selection. Captures the current
     * activeBeats into _noneStash for every affected curve
     * if the new mode is None; consults _noneStash for the
     * restoreActiveBeats payload if the new mode is Normal
     * (and the previous mode for that curve was None);
     * clears stale stash entries on transitions that don't
     * use them. Then emits the setBeatPointsMode edit.
     *
     * Per-curve stash semantics work even across multi-
     * select: each curve's id is independently keyed in the
     * Map, so a multi-select transition into None populates
     * one entry per curve, and a transition back out of
     * None consults each entry independently. The mutator
     * receives a single restoreActiveBeats string, so when
     * multiple curves transition None -> Normal together,
     * the inspector cannot pass per-curve restore strings
     * through one edit. We do the most useful thing
     * possible: if every selected curve has a stash entry
     * AND every entry holds the same string, pass that
     * string. Otherwise pass null (no restoration); the
     * mutator leaves activeBeats alone, which under None
     * mode is ".". The user gets a single-rest activeBeats
     * which they can immediately edit. This is acceptable
     * because mismatched-stash multi-select-out-of-None is
     * a niche workflow, and nothing about it is
     * destructive — the user can still type a fresh string.
     *
     * @param {string} newMode
     * @param {string} oldMode  Previous mode aggregate (or "" if varies / unknown).
     * @param {string} currentActiveBeats  Active-beats aggregate at the moment of the click.
     */
    _onModeSelected(newMode, oldMode, currentActiveBeats) {
        const curveIds = collectSelectedCurveIds(this._scene, this._selection);
        if (newMode === "none") {
            // Capture the current activeBeats (per-curve, since
            // selected curves may differ) into the stash.
            const objs = selectedObjects(this._scene, this._selection);
            for (const c of objs.curves) {
                if (typeof c.id !== "string") continue;
                const ab = typeof c.activeBeats === "string" ? c.activeBeats : "";
                this._noneStash.set(c.id, ab);
            }
            this._emitEdit({ kind: "setBeatPointsMode", value: "none" });
            return;
        }
        if (newMode === "normal") {
            // Consult stash. Use a uniform restoreActiveBeats
            // payload only when every selected curve has a
            // matching stash entry; clear all consulted
            // entries afterward.
            /** @type {string | null} */
            let restore = null;
            const stashedValues = curveIds
                .map((id) => this._noneStash.get(id))
                .filter((s) => typeof s === "string");
            if (
                stashedValues.length > 0 &&
                stashedValues.length === curveIds.length &&
                stashedValues.every((s) => s === stashedValues[0])
            ) {
                restore = stashedValues[0];
            }
            for (const id of curveIds) this._noneStash.delete(id);
            const edit = { kind: "setBeatPointsMode", value: "normal" };
            if (restore !== null) edit.restoreActiveBeats = restore;
            this._emitEdit(edit);
            return;
        }
        if (newMode === "euclidean") {
            // Stash is dropped without consultation per
            // milestone 2 question 5: Euclidean populates from
            // the generator with zero parameters and ignores
            // any stashed string.
            for (const id of curveIds) this._noneStash.delete(id);
            this._emitEdit({ kind: "setBeatPointsMode", value: "euclidean" });
            return;
        }
    }

    /**
     * Build the Beat Interval dropdown for Band 5's row 1.
     * The eighteen-entry list comes from beatIntervals.js.
     * Selection emits a setBeatInterval edit; multi-select
     * propagates to every selected curve.
     *
     * Disabled state shows the existing value (or empty for
     * varies-or-no-curves) without the dropdown triangle's
     * full green tint. Empty-value-with-no-curves renders as
     * a blank greyed combo; users see the field's footprint
     * but can't open it.
     *
     * @param {{ value: string, disabled: boolean }} opts
     */
    _buildBeatIntervalCombo(opts) {
        return mkPopoverCombo({
            value: opts.value,
            width: W.beatIntervalCombo,
            disabled: opts.disabled,
            options: allBeatIntervalTokens().map((token) => ({ value: token, label: token })),
            currentValue: opts.value,
            onSelect: (newToken) => {
                this._emitEdit({ kind: "setBeatInterval", value: newToken });
            },
        });
    }

    /**
     * Build the rhythm-string field used for activeBeats and
     * strength in Band 5. Mostly mirrors _buildEditableField's
     * commit lifecycle (Enter to commit with red squiggle on
     * hard error, blur to silently revert hard errors,
     * commit-once flag to suppress destruction-blur double-
     * emit), but adds two pieces of behaviour specific to
     * the rhythm strings: per-keystroke pipe insertion at
     * Beats/Bar boundaries, and per-keystroke canonicalisation.
     * The activeBeats field accepts only x and . as
     * meaningful content; whitespace (space, tab, newline)
     * maps to "." as a typing shortcut; every other
     * character is rejected silently. The strength field
     * accepts digits 0-9 plus single-space separators;
     * non-digit non-whitespace characters are rejected.
     * Whitespace collapse applies only to the strength
     * field since activeBeats does not display whitespace
     * at all.
     *
     * The pipe handling treats pipes as zero-width to the
     * cursor: when computing the cursor's "position in typed
     * content" the pipe is invisible, and after a re-pipe
     * pass the cursor lands at the same typed-character
     * offset in the new displayed string. Backspace deletes
     * the typed character to the left of the cursor; if a
     * pipe sat between the cursor and that character, the
     * pipe is reabsorbed by the post-deletion re-pipe pass
     * (which puts pipes only where the new typed-character
     * count earns them).
     *
     * Read-only mode (mode === euclidean for activeBeats,
     * or mode === none for either string) accepts focus and
     * allows text selection plus copy-to-clipboard but
     * rejects all keystrokes that would mutate content. The
     * field's frame is muted to read as not-currently-
     * editable; a focus hint near the field describes how to
     * unlock editing.
     *
     * Backwards-compatible with non-pipe strings: when
     * beatsPerBar is 0 (which can't happen at runtime, but
     * the parsed-value helper falls back to 4 in that case)
     * the field renders without auto-inserted pipes.
     *
     * @param {{
     *   value: string,
     *   width: number,
     *   editable: boolean,
     *   readOnlyHint: string | null,
     *   validator: (candidate: string) => { kind: "ok" | "soft" | "hard", value: string, message?: string },
     *   editKind: string,
     *   beatsPerBar: number,
     *   stringKind: "activeBeats" | "strength",
     * }} opts
     */
    _buildRhythmStringField(opts) {
        const el = document.createElement("div");
        el.className = "insp-field insp-rhythm-string";
        el.style.width = `${opts.width}px`;
        el.textContent = opts.value;

        if (!opts.editable) {
            // Read-only treatment: accepts focus and allows
            // text selection + copy, but rejects mutating
            // keystrokes. Visual styling drops the bright
            // green frame for the muted readonly look.
            el.classList.add("readonly");
            el.setAttribute("contenteditable", "true");
            el.setAttribute("spellcheck", "false");
            // Block keystrokes that would mutate content.
            // Modifier-held combinations (Cmd-A, Cmd-C) pass
            // through so select-all and copy still work.
            el.addEventListener("keydown", (e) => {
                if (e.metaKey || e.ctrlKey) return;
                // Allow arrow keys, Home, End, Tab, Escape
                // for navigation and focus changes.
                const navKeys = [
                    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
                    "Home", "End", "Tab", "Escape", "Shift",
                ];
                if (navKeys.includes(e.key)) return;
                e.preventDefault();
            });
            // Block paste and drag-drop too.
            el.addEventListener("paste", (e) => e.preventDefault());
            el.addEventListener("drop", (e) => e.preventDefault());
            el.addEventListener("beforeinput", (e) => {
                // beforeinput fires for any content-mutating
                // input event including IME composition. The
                // keydown handler catches single keystrokes
                // but composition events can slip through.
                e.preventDefault();
            });
            // Hint shown on focus, removed on blur.
            if (typeof opts.readOnlyHint === "string") {
                /** @type {HTMLElement | null} */
                let hintEl = null;
                el.addEventListener("focus", () => {
                    if (hintEl !== null) return;
                    hintEl = document.createElement("div");
                    hintEl.className = "insp-readonly-hint";
                    hintEl.textContent = opts.readOnlyHint;
                    const rect = el.getBoundingClientRect();
                    hintEl.style.left = `${rect.left}px`;
                    hintEl.style.top = `${rect.bottom + 2}px`;
                    document.body.appendChild(hintEl);
                });
                el.addEventListener("blur", () => {
                    if (hintEl !== null) {
                        hintEl.remove();
                        hintEl = null;
                    }
                });
            }
            return el;
        }

        // Editable path.
        el.setAttribute("contenteditable", "plaintext-only");
        el.setAttribute("spellcheck", "false");

        // Per-keystroke handler: re-canonicalise + re-pipe the
        // string after every input event, restoring cursor
        // position to the same typed-character offset. The
        // input event fires after the browser has applied the
        // user's keystroke (or paste, or composition end), so
        // the field's textContent already contains the new
        // raw text including any uncanonical characters and
        // any out-of-place pipes.
        const beatsPerBar = opts.beatsPerBar;
        const stringKind = opts.stringKind;
        el.addEventListener("input", () => {
            const sel = window.getSelection();
            // Count typed (non-pipe, non-whitespace) chars
            // before cursor in the current display. Whitespace
            // counts because the user might be in the middle
            // of a multi-space run that hasn't collapsed yet.
            // Actually: count non-pipe characters because
            // pipes are the only zero-width formatting; spaces
            // are real characters that may or may not still be
            // there after canonicalisation.
            let typedBefore = 0;
            const display = el.textContent ?? "";
            if (sel !== null && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
                const range = sel.getRangeAt(0);
                const offset = getCaretOffsetInElement(el, range.endContainer, range.endOffset);
                for (let i = 0; i < offset && i < display.length; i++) {
                    if (display[i] !== "|") typedBefore++;
                }
            }
            // Strip pipes from the display, leaving spaces
            // and meaningful chars. Run canonicalisation, then
            // re-pipe.
            const stripped = display.replace(/\|/g, "");
            const canonical = canonicaliseRhythmString(stripped, stringKind);
            // Adjust typed-before to reflect canonicalisation.
            // Canonicalisation may shrink the input — for
            // activeBeats by dropping rejected characters
            // (digits, letters like q, symbols), for
            // strength by dropping non-digits and collapsing
            // consecutive whitespace — so typedBefore
            // (counted in the pre-canonical string) might
            // now exceed the canonical length. Clamp to
            // canonical length.
            const canonicalTypedBefore = Math.min(
                typedBefore, canonical.length,
            );
            const repiped = repipeForDisplay(canonical, beatsPerBar);
            if (repiped !== display) {
                el.textContent = repiped;
                // Restore cursor: find the position in repiped
                // such that there are canonicalTypedBefore
                // non-pipe characters before it.
                const newOffset = findOffsetAfterTypedChars(
                    repiped, canonicalTypedBefore,
                );
                placeCaretAtOffset(el, newOffset);
            }
        });

        // No select-all on focus for rhythm-string fields,
        // unlike the Name and numeric editable fields. The
        // user is editing positions within an existing
        // pattern — "set the third beat to a rest", "swap an
        // x for a ." — not replacing the whole pattern with a
        // new one. Selecting all on focus would suggest the
        // entire string is about to be overwritten, which is
        // misleading. The cursor lands wherever the user
        // clicked, which is what they expect for in-place
        // editing.

        // Commit-once flag against destruction-blur double-
        // emit. See _buildEditableField's flag for full
        // rationale.
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
            if (result.kind === "soft") {
                el.classList.add("error-soft");
            } else {
                el.classList.remove("error-soft");
            }
            if (committed) return;
            if (result.value !== opts.value) {
                committed = true;
                this._emitEdit({ kind: opts.editKind, value: result.value });
            }
        };

        // Overwrite mode for printable keystrokes. The user's
        // mental model for rhythm-string editing is "this
        // string has a fixed length and I'm editing positions
        // within it" — typing 'x' at position 3 should set
        // position 3 to 'x', not insert a new beat that pushes
        // everything right. The exception is typing past the
        // end of typed content, which still extends the
        // string (so users can grow a pattern when they
        // genuinely want to). Backspace and Delete still work
        // as default browser behaviour, deleting one character
        // and shrinking the string — letting the input handler
        // canonicalise and re-pipe afterward. Invalid keys
        // (e.g. "q" in strength) are silently rejected
        // without changing the field, both in overwrite
        // position and at end-of-content.
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

            // Printable single-char key, no modifiers, with a
            // collapsed selection (caret only) inside this
            // field: candidate for overwrite mode. Any other
            // case (modifier-held, multi-char key like Tab
            // or Backspace, selection range, focus elsewhere)
            // falls through to default browser behaviour and
            // the input handler's canonicalise+repipe pass.
            if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const sel = window.getSelection();
                if (sel !== null && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    if (range.collapsed && el.contains(range.endContainer)) {
                        const display = el.textContent ?? "";
                        const cursorOffset = getCaretOffsetInElement(
                            el, range.endContainer, range.endOffset,
                        );
                        // Count typed (non-pipe) characters
                        // before cursor and total. Pipes are
                        // zero-width to the cursor; everything
                        // else (x, ., digit, space) counts as a
                        // typed-content position.
                        let typedBefore = 0;
                        let typedTotal = 0;
                        for (let i = 0; i < display.length; i++) {
                            if (display[i] !== "|") {
                                typedTotal++;
                                if (i < cursorOffset) typedBefore++;
                            }
                        }

                        if (typedBefore < typedTotal) {
                            // Cursor is in the middle of typed
                            // content — overwrite the char at
                            // typedBefore with the new one.
                            e.preventDefault();
                            const canonicalKey = canonicaliseSingleChar(
                                e.key, stringKind,
                            );
                            if (canonicalKey === null) {
                                // Rejected (e.g. "q" in
                                // strength). Leave the field
                                // unchanged.
                                return;
                            }
                            const stripped = display.replace(/\|/g, "");
                            const newStripped =
                                stripped.substring(0, typedBefore) +
                                canonicalKey +
                                stripped.substring(typedBefore + 1);
                            // Run the full canonicaliser on
                            // the new string. For activeBeats
                            // this normalises a typed space
                            // into a dot if it slipped past
                            // the single-char step (defensive
                            // for paste paths). For strength
                            // it handles the edge case where
                            // the new character is a space
                            // adjacent to an existing space,
                            // which collapses.
                            const canonical = canonicaliseRhythmString(
                                newStripped, stringKind,
                            );
                            const repiped = repipeForDisplay(
                                canonical, beatsPerBar,
                            );
                            el.textContent = repiped;
                            const newTypedBefore = Math.min(
                                typedBefore + 1, canonical.length,
                            );
                            const newOffset = findOffsetAfterTypedChars(
                                repiped, newTypedBefore,
                            );
                            placeCaretAtOffset(el, newOffset);
                            if (el.classList.contains("error-hard")) {
                                queueMicrotask(() => {
                                    el.classList.remove("error-hard");
                                });
                            }
                            return;
                        }
                        // Cursor at end of typed content — fall
                        // through to default insert. Browser
                        // inserts the char; input handler
                        // canonicalises and re-pipes after.
                    }
                }
            }

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
 * commit through translateSelection with the user's typed
 * value minus this aggregated value as the delta; the
 * inspector locks the field when this returns "varies"
 * because translation by a single delta isn't well-defined
 * across objects with different starting positions.
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
 * commit through scaleCurveAxis with the user's typed value
 * divided by this aggregated value as the factor; the
 * inspector locks the field when this returns "varies"
 * because scaling by a single factor wouldn't preserve the
 * meaning of "set W to 5" across curves with different
 * starting widths.
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

// --- Popover combo widget ---
//
// Used by Band 4's Auto Beat Interval dropdowns and Band 5's
// Mode and Beat Interval dropdowns. The trigger looks like a
// regular mkCombo (lighter-grey fill, green frame, green
// triangle on the right); clicking opens a popover floating
// over the page listing the configured options. Clicking
// outside or pressing Escape closes without selecting;
// clicking an option fires onSelect and closes. Disabled
// combos do not open the popover and read as muted matching
// mkCombo.disabled. The popover is appended to document.body
// and positioned via fixed coordinates from the trigger's
// getBoundingClientRect, so it sits over the inspector pane's
// overflow:auto container without being clipped. The
// positioning is viewport-aware: the popover's max-height is
// clamped to the available room, and a popover that would
// extend past the viewport bottom flips to open above the
// trigger when above has more room.

/**
 * @param {{
 *   value: string,
 *   width: number,
 *   disabled: boolean,
 *   options: Array<{ value: string, label: string }>,
 *   currentValue: string,
 *   onSelect: (value: string) => void,
 * }} opts
 * @returns {HTMLDivElement}
 */
function mkPopoverCombo(opts) {
    const el = document.createElement("div");
    el.className = "insp-combo";
    if (opts.disabled) el.classList.add("disabled");
    el.style.width = `${opts.width}px`;
    el.textContent = opts.value;
    if (opts.disabled) return el;

    el.addEventListener("click", (e) => {
        e.stopPropagation();
        // Toggle: if a popover for this combo is already
        // open, close it. Otherwise close any other open
        // popover anywhere first, then open ours.
        if (el.classList.contains("insp-combo-open")) {
            closeAllPopovers();
            return;
        }
        closeAllPopovers();
        el.classList.add("insp-combo-open");

        const popover = document.createElement("div");
        popover.className = "insp-popover";
        const rect = el.getBoundingClientRect();

        // Viewport-aware positioning. The popover ideally
        // wants a generous max-height (PREFERRED_MAX_HEIGHT)
        // so long token lists like Beat Interval's 18-entry
        // list show as much as possible without scrolling,
        // but it must stay inside the viewport so its bottom
        // edge (and its own scrollbar) are reachable. We
        // compute the available room below the trigger and
        // above it, then either place the popover below
        // (the GeoSonix-default direction) when there is
        // sensible room there, or flip it above when above
        // has more room. In either case the max-height is
        // clamped to the available room minus a small
        // viewport margin so the popover never extends past
        // the screen edge — inside the popover, the existing
        // overflow-y: auto then handles overflow naturally.
        const VIEWPORT_MARGIN = 8;
        const PREFERRED_MAX_HEIGHT = 380;
        const MIN_USABLE_HEIGHT = 80;
        const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = rect.top - VIEWPORT_MARGIN;
        const placeBelow =
            spaceBelow >= PREFERRED_MAX_HEIGHT || spaceBelow >= spaceAbove;
        const availableHeight = Math.max(
            MIN_USABLE_HEIGHT,
            placeBelow ? spaceBelow : spaceAbove,
        );
        popover.style.maxHeight = `${Math.min(availableHeight, PREFERRED_MAX_HEIGHT)}px`;
        popover.style.left = `${rect.left}px`;
        popover.style.minWidth = `${rect.width}px`;
        // Provisional top: place below until we know the
        // measured height for the flip-up case. Using the
        // below position as the initial value avoids any
        // flicker for the (much more common) below case.
        popover.style.top = `${rect.bottom + 1}px`;

        for (const option of opts.options) {
            const item = document.createElement("div");
            item.className = "insp-popover-option";
            if (option.value === opts.currentValue) {
                item.classList.add("selected");
            }
            item.textContent = option.label;
            item.addEventListener("click", (ev) => {
                ev.stopPropagation();
                closeAllPopovers();
                opts.onSelect(option.value);
            });
            popover.appendChild(item);
        }
        document.body.appendChild(popover);

        // If we're flipping above, the popover's height is
        // now known (it has been laid out by the document
        // append) so we can position its top such that its
        // bottom sits just above the trigger. Clamp to the
        // viewport margin so a popover taller than the
        // window doesn't end up with a negative top.
        if (!placeBelow) {
            const popoverHeight = popover.offsetHeight;
            const desiredTop = rect.top - popoverHeight - 1;
            popover.style.top = `${Math.max(VIEWPORT_MARGIN, desiredTop)}px`;
        }

        // Scroll the currently-selected option into view if
        // it's outside the popover's initial scroll position.
        // Useful for the Beat Interval combo where the
        // current value can sit well past the visible range
        // — without this, the user opens the popover and the
        // first 16 tokens are visible, but the selected
        // "Whole" or "4 x Wh" sits below the fold and isn't
        // obvious as the current value. block: "nearest"
        // means in-view options stay unscrolled.
        const selectedItem = popover.querySelector(".insp-popover-option.selected");
        if (selectedItem instanceof HTMLElement) {
            selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
        }

        // Install document-level listeners on the next tick
        // so the click that opened the popover doesn't
        // immediately dismiss it through the outside-click
        // handler. The pair gets removed inside
        // closeAllPopovers (set up here so the closure
        // captures the listeners we install).
        const outsideListener = () => closeAllPopovers();
        const keyListener = (/** @type {KeyboardEvent} */ ev) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                closeAllPopovers();
            }
        };
        setTimeout(() => {
            document.addEventListener("click", outsideListener);
            document.addEventListener("keydown", keyListener);
        }, 0);
        // Remember how to undo the listeners on close.
        // closeAllPopovers reads this map to clean up.
        _popoverCleanups.push(() => {
            document.removeEventListener("click", outsideListener);
            document.removeEventListener("keydown", keyListener);
        });
    });

    return el;
}

/**
 * Cleanup callbacks for currently-open popovers. Each
 * mkPopoverCombo click pushes one entry; closeAllPopovers
 * runs and clears the entire stack. Module-scoped so the
 * stack survives across multiple combo instances and across
 * inspector re-renders (which would otherwise orphan
 * dangling event listeners on document).
 * @type {Array<() => void>}
 */
const _popoverCleanups = [];

/**
 * Close every open popover anywhere on the page and run
 * each cleanup callback exactly once. Used both by combo
 * triggers when toggling and by outside-click / Escape
 * handlers to dismiss.
 */
function closeAllPopovers() {
    document.querySelectorAll(".insp-popover").forEach((n) => n.remove());
    document.querySelectorAll(".insp-combo-open").forEach((n) => {
        n.classList.remove("insp-combo-open");
    });
    while (_popoverCleanups.length > 0) {
        const fn = _popoverCleanups.pop();
        if (typeof fn === "function") fn();
    }
}

// --- Beat-points helpers ---

/**
 * Convert a beatPointsMode field value to its display
 * label. The runtime / JSON value is "normal",
 * "euclidean", or "none"; the inspector displays "Normal",
 * "Euclidean", "None". An empty value (varies multi-select
 * or no curves) renders as an empty string so the combo's
 * footprint stays without displaying a value.
 * @param {string} value
 * @returns {string}
 */
function modeDisplayLabel(value) {
    if (value === "normal") return "Normal";
    if (value === "euclidean") return "Euclidean";
    if (value === "none") return "None";
    return "";
}

/**
 * Parse a beatsPerBar aggregate string into a positive
 * integer, falling back to 4 when empty, "varies", or
 * unparseable. Used by the rhythm-string fields' pipe-
 * placement helpers.
 * @param {string} agg
 * @returns {number}
 */
function parseBeatsPerBar(agg) {
    if (agg === "" || agg === "varies") return 4;
    const n = Math.round(Number(agg));
    if (!Number.isFinite(n) || n < 1) return 4;
    return n;
}

/**
 * Parse a cycleDuration aggregate string into a positive
 * integer, falling back to 4 when empty, "varies", or
 * unparseable. Used by the Euclidean parameter validators
 * that need cycleDuration as their clamp range.
 * @param {string} agg
 * @returns {number}
 */
function parseCycleDuration(agg) {
    if (agg === "" || agg === "varies") return 4;
    const n = Math.round(Number(agg));
    if (!Number.isFinite(n) || n < 1) return 4;
    return n;
}

/**
 * Canonicalise a single character about to be inserted
 * into a rhythm string. Returns the canonical replacement
 * character, or null if the character is rejected (drop,
 * no insertion). Used by the overwrite-mode keystroke
 * handler in _buildRhythmStringField, where rejection
 * needs to be detected up front so the existing string
 * can be left unchanged rather than producing a shrunken
 * result.
 *
 * For activeBeats: x and . pass through; whitespace
 * (space, tab, newline) maps to "." as a typing shortcut
 * since space is easier to reach than the period key when
 * laying down a rhythm pattern; every other character is
 * rejected (returns null). The field never displays
 * whitespace; spaces in the user's keystroke are
 * substituted with dots before they enter the field.
 *
 * For strength: digits pass through; whitespace returns a
 * single space (visual separator preserved); every other
 * character is rejected (returns null).
 *
 * @param {string} ch
 * @param {"activeBeats" | "strength"} kind
 * @returns {string | null}
 */
function canonicaliseSingleChar(ch, kind) {
    if (kind === "activeBeats") {
        if (ch === "x" || ch === ".") return ch;
        // Space is a shortcut for typing a dot. Tab,
        // newline, and the non-breaking space (which
        // contenteditable elements may insert in place of
        // a regular space, especially at end-of-content)
        // get the same treatment for paste-from-text and
        // browser-quirk consistency.
        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\u00A0") return ".";
        // Every other character (q, digits, letters,
        // symbols) is rejected silently.
        return null;
    }
    // strength
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\u00A0") return " ";
    if (ch >= "0" && ch <= "9") return ch;
    return null;
}

/**
 * Canonicalise a rhythm string per the v2.3 spec.
 *
 * For activeBeats: x and . pass through; whitespace
 * (space, tab, newline) maps to "." as a typing
 * shortcut; every other character is dropped silently.
 * The field never displays whitespace, so any spaces in
 * incoming text (paste, legacy data) are converted to
 * dots and the displayed string ends up composed only
 * of x, ., and the auto-inserted pipes.
 *
 * For strength: digits pass through; consecutive
 * whitespace collapses to a single space; every other
 * character is dropped. Dropped non-digit non-whitespace
 * characters do not reset the run-of-spaces state, so
 * "9 q 5" canonicalises to "9 5" rather than "9  5" —
 * the dropped char is treated as if it never existed in
 * the input, and the spaces around it collapse normally.
 *
 * The input must already have pipes stripped — pipes are
 * display-only formatting handled separately by
 * repipeForDisplay.
 *
 * @param {string} input
 * @param {"activeBeats" | "strength"} kind
 * @returns {string}
 */
function canonicaliseRhythmString(input, kind) {
    let out = "";
    if (kind === "activeBeats") {
        for (const ch of input) {
            if (ch === "x" || ch === ".") {
                out += ch;
            } else if (
                ch === " " ||
                ch === "\t" ||
                ch === "\n" ||
                ch === "\u00A0"
            ) {
                // Whitespace is the typing-shortcut form of
                // a dot. Each whitespace character maps to
                // one dot — no collapsing, since dots are
                // meaningful content the user wants to keep.
                // Non-breaking space (\u00A0) is handled
                // alongside regular space because
                // contenteditable elements sometimes insert
                // the nbsp form on a space keystroke.
                out += ".";
            }
            // Everything else (digits, q, other letters,
            // symbols) is dropped silently.
        }
        return out;
    }
    // strength: keep digits, drop everything else.
    // Dropped characters intentionally do NOT reset
    // prevSpace, so that "9 q 5" canonicalises to
    // "9 5" rather than "9  5" — the dropped char is
    // treated as if it never existed in the input,
    // and the spaces around it collapse normally.
    let prevSpace = false;
    for (const ch of input) {
        if (
            ch === " " ||
            ch === "\t" ||
            ch === "\n" ||
            ch === "\u00A0"
        ) {
            if (!prevSpace) out += " ";
            prevSpace = true;
            continue;
        }
        if (ch >= "0" && ch <= "9") {
            out += ch;
            prevSpace = false;
        }
    }
    return out;
}

/**
 * Re-insert pipe characters into a stripped rhythm string
 * per Beats/Bar boundaries. Pipes appear strictly between
 * bars: a pipe goes after the kth typed character whenever
 * k is a positive multiple of beatsPerBar AND there is at
 * least one more typed character later in the string.
 * Whitespace passes through unchanged at its original
 * position; pipes are not counted toward the typed-char
 * total.
 *
 * The "more typed characters later" clause is what keeps
 * the trailing pipe from sticking to the end of a string
 * whose length is an exact multiple of beatsPerBar. Without
 * it, a fully-typed bar produces a pipe with nothing after
 * it, and the input handler's repipe pass would re-insert
 * that pipe immediately after a Backspace deleted it,
 * making the pipe undeletable.
 *
 * Pipe placement examples with beatsPerBar = 3:
 *   "x"      → "x"
 *   "xxx"    → "xxx"          (no trailing pipe)
 *   "xxxx"   → "xxx|x"
 *   "xxxxxx" → "xxx|xxx"      (no trailing pipe)
 *   "xxxxxxx" → "xxx|xxx|x"
 *
 * @param {string} input  Canonicalised, pipe-free rhythm string (may contain spaces).
 * @param {number} beatsPerBar  The bar size in beat slots.
 * @returns {string}
 */
function repipeForDisplay(input, beatsPerBar) {
    if (beatsPerBar <= 0) return input;
    // First pass: count total typed (non-whitespace)
    // characters so the second pass can suppress a pipe at
    // the very end of the string. Without this two-pass
    // structure we would have to look ahead from each
    // position to decide whether to emit the pipe, which
    // amounts to the same work.
    let totalTyped = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch !== " " && ch !== "\t" && ch !== "\n") totalTyped++;
    }
    let out = "";
    let typedCount = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        out += ch;
        if (ch !== " " && ch !== "\t" && ch !== "\n") {
            typedCount++;
            if (typedCount % beatsPerBar === 0 && typedCount < totalTyped) {
                out += "|";
            }
        }
    }
    return out;
}

/**
 * Find the offset within `displayed` such that there are
 * exactly `n` non-pipe characters before that offset, with
 * the cursor positioned past any auto-inserted pipe trailing
 * the nth typed character. If `n` exceeds the count of non-
 * pipe characters, returns displayed.length. Used by the
 * rhythm-string field's input handler to restore cursor
 * position after re-piping.
 * @param {string} displayed
 * @param {number} n
 * @returns {number}
 */
function findOffsetAfterTypedChars(displayed, n) {
    if (n <= 0) return 0;
    let count = 0;
    for (let i = 0; i < displayed.length; i++) {
        if (displayed[i] !== "|") count++;
        if (count === n) {
            // Position immediately after this character. If
            // the next character is a pipe, skip past it so
            // the cursor sits between typed-content runs and
            // not between content and a decoration pipe.
            let pos = i + 1;
            while (pos < displayed.length && displayed[pos] === "|") pos++;
            return pos;
        }
    }
    return displayed.length;
}

/**
 * Compute the flat offset within `el` corresponding to a
 * Selection range's (node, offset). Walks `el`'s descendants
 * counting characters until reaching the named node, then
 * adds the offset within that node. Returns 0 if the node
 * isn't a descendant. Plaintext-only contenteditable
 * elements typically have a single text-node child, in
 * which case the result equals offsetWithinTextNode, but
 * the walk handles browser-inserted intermediate elements
 * defensively.
 * @param {HTMLElement} el
 * @param {Node} targetNode
 * @param {number} targetOffset
 * @returns {number}
 */
function getCaretOffsetInElement(el, targetNode, targetOffset) {
    let total = 0;
    let found = false;
    /** @param {Node} node */
    function walk(node) {
        if (found) return;
        if (node === targetNode) {
            if (node.nodeType === Node.TEXT_NODE) {
                total += targetOffset;
            } else {
                for (let i = 0; i < targetOffset && i < node.childNodes.length; i++) {
                    total += node.childNodes[i].textContent?.length ?? 0;
                }
            }
            found = true;
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            total += node.textContent?.length ?? 0;
            return;
        }
        for (const child of node.childNodes) {
            walk(child);
            if (found) return;
        }
    }
    walk(el);
    return total;
}

/**
 * Place the caret at flat offset `offset` within `el`.
 * Walks descendant text nodes counting characters until
 * reaching the target offset, then sets a Selection range
 * to that position. If the offset exceeds total text
 * length, the caret lands at the end. Plaintext-only
 * contenteditable elements typically have a single text-
 * node child but the walking version handles browser-
 * inserted intermediate elements.
 * @param {HTMLElement} el
 * @param {number} offset
 */
function placeCaretAtOffset(el, offset) {
    const sel = window.getSelection();
    if (sel === null) return;
    const range = document.createRange();
    let consumed = 0;
    let placed = false;
    /** @type {Text | null} */
    let lastTextNode = null;
    /** @param {Node} node */
    function walk(node) {
        if (placed) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = /** @type {Text} */ (node);
            const length = text.textContent?.length ?? 0;
            lastTextNode = text;
            if (consumed + length >= offset) {
                range.setStart(text, offset - consumed);
                range.setEnd(text, offset - consumed);
                placed = true;
                return;
            }
            consumed += length;
            return;
        }
        for (const child of node.childNodes) {
            walk(child);
            if (placed) return;
        }
    }
    walk(el);
    if (!placed) {
        if (lastTextNode !== null) {
            const length = lastTextNode.textContent?.length ?? 0;
            range.setStart(lastTextNode, length);
            range.setEnd(lastTextNode, length);
        } else {
            range.setStart(el, 0);
            range.setEnd(el, 0);
        }
    }
    sel.removeAllRanges();
    sel.addRange(range);
}

/**
 * Collect the curve ids from the current selection in scene
 * order. Used by the mode-switch stash machinery to address
 * stash entries by curve id rather than by selection index
 * (indices change when curves are added or removed; ids do
 * not). Returns an empty array when scene is null or no
 * curves are selected.
 * @param {import("./scene.js").Scene | null} scene
 * @param {{ curves: number[] }} selection
 * @returns {string[]}
 */
function collectSelectedCurveIds(scene, selection) {
    if (scene === null) return [];
    /** @type {string[]} */
    const out = [];
    for (const idx of selection.curves) {
        if (idx >= 0 && idx < scene.curves.length) {
            const id = scene.curves[idx].id;
            if (typeof id === "string") out.push(id);
        }
    }
    return out;
}
