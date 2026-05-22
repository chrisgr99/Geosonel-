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
 * Cursor-as-collider stage. Inspector renders Bands 1
 * (Identity), 2 (Geometry / visual), and 3 (Callback
 * slots). Band 3 exposes three Code-tab callback slots
 * (hasHit, beenHit, onTick) defined in sections 27 and
 * 28 of DESIGN.md; each row carries a Can-X checkbox,
 * a function-name field, and a Create or Go-to button.
 * Band 1's bottom row is the cycle-pattern authoring
 * row: a static "Pattern for This Object" label plus
 * one button that reads either "Create $id" or "Go to
 * $id" depending on whether a labelled block for the
 * selected object exists in behaviors.js. The canCycle
 * gate is derived from cursor extents and mute
 * (cursor-as-collider model).
 *
 * Band 1 — Identity. Three rows. Row 1: Object ID
 * (read-only, greyed for multi-select), Hide Cursor
 * (editable for any non-empty selection, stored in
 * scene.json's `mute` field, suppresses cursor
 * rendering and the firing that depends on it per the
 * cursor-as-collider model). Row 2
 * is the cycle duration row, reading as "Cycles In [N]
 * beats" with the schema's beatsPerCycle field as the
 * editable number between the label and the units. The
 * cycle duration field is universal across kinds but
 * greys for trigger-only selections since triggers
 * cannot self-fire under the cursor-as-collider model.
 * Row 3 is the pattern row: a static "Pattern for
 * This Object" label plus one button whose text
 * incorporates the labelled-block tag the button
 * targets. With a single object selected the button
 * reads "Create $id" when no labelled block for the
 * selected object exists in behaviors.js, or "Go to
 * $id" when one does. Multi-select and empty
 * selections grey the row and shorten the button text
 * to just "Create" with no identifier.
 * The user-typed Name field that earlier inspector
 * versions exposed has been dropped; the schema field
 * stays in place for future re-surfacing.
 *
 * Band 2 — Geometry / visual. Starting State carries the
 * object's starting position (X, Y, universal for any
 * non-empty selection) and starting velocity (vX, vY,
 * active when the selection contains at least one sprite
 * or curve, greyed for trigger-only selections since
 * triggers don't move under physics); Curve Size W/H and
 * Curve Thickness activate when curves are in the
 * selection; Cursor R/L extends to curves and sprites
 * under the cursor-as-collider model and greys when all
 * selected curves and sprites are muted; Cursor
 * Thickness stays curve-only since sprite cursor
 * visualisation is deferred; Sprite/Trigger Size
 * activates when the selection is exclusively that kind
 * (the row's label tracks which); Color activates when
 * sprites or triggers are present (curves carry no
 * per-object colour at this milestone). Starting State's
 * four numeric fields and Curve Size W/H use absolute-
 * set semantics — typing a value commits that value as
 * the new coordinate (or dimension or velocity
 * component) for every applicable selected object — so
 * single-select, uniform multi-select, and varies
 * multi-select all flow through the same primitive.
 *
 * Band 3 — Callback slots. Three rows: hasHit, beenHit,
 * onTick. Each row carries a row label, a Can-X
 * checkbox, a function-name field, and a Create or
 * Go-to button. Every row activates for any non-empty
 * selection regardless of kinds, since the slot
 * vocabulary is shared across curves, triggers, and
 * sprites.
 *
 * Create / Go-to buttons. Operative for all three
 * slots. Both disable when the slot's Can-X checkbox
 * is unchecked or when the selection isn't single-
 * object. When checked and a single object is
 * selected, the displayed function name (or the
 * proposed default if the field is empty) is looked up
 * in scene.functionMap. Found triggers the Go-to label
 * and a goToFunction edit; not-found triggers the
 * Create label and a createFunctionStub edit. The
 * function-name field's text renders muted when the
 * named function doesn't yet exist in behaviors.js —
 * a low-key cue that the slot's not yet wired up.
 * Default proposed name when the field is empty is
 * slotName_objectId, e.g. onTick_sp_a3f7.
 *
 * cyclePattern field. The schema field exists on every
 * source but is not directly editable through the
 * inspector. Stage A3 of the pattern-authoring pivot
 * added the pattern row at the bottom of Band 1, whose
 * Create / Go-to button navigates into the Code tab
 * where labelled-statement blocks of the form
 * $objectId: expression act as the authoring surface
 * per section 28. Stage A4 will land Cmd-Enter routing
 * that promotes a labelled block's expression body to
 * the named object's cyclePattern field in scene.json;
 * until then, existing cyclePattern values keep firing
 * through the runtime but the Code-tab blocks are the
 * place to draft and revise.
 *
 * Stage 1 inert pieces. The function-name fields
 * accept any text without validation. A future stage
 * will add validateFunctionName for the three function
 * fields.
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
 *   - Universal fields (Starting State X/Y, Hide Cursor)
 *     are active for any non-empty selection.
 *   - Object ID is active only for single-object
 *     selections; greyed for multi-select since the id
 *     is per-object unique.
 *   - Sprite/Trigger Size is active only when the selection
 *     is exclusively sprites or exclusively triggers; the
 *     row's label tracks which.
 *   - Curve-only fields (Curve Size, Cursor Size, the two
 *     Thicknesses) are active only when at least one curve
 *     is selected.
 *   - Color is active when sprites or triggers are present;
 *     a curve-only selection greys it.
 *   - Band 3 callback slots are universal: every row
 *     activates for any non-empty selection regardless
 *     of kinds.
 *   - Band 1's pattern row activates only for single-
 *     object selections.
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
    validateCycleSpeeds,
} from "./curveFieldValidation.js";
import { TOKENS as BEAT_INTERVAL_TOKENS } from "./beatIntervals.js";

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
    hideCursor: 90,    // "Hide Cursor" — wide enough to fit the two-word label on one line at 10pt
    curveThick: 60,    // "Curve\nThickness" multiline
    cursorThick: 60,   // "Cursor\nThickness" multiline

    // Numeric fields.
    posXY: 60,         // Position X, Y (legacy; superseded by startState)
    startState: 60,    // Starting State X, Y, vX, vY — four fields share the row at curve-size width (60) to match the visual weight of the surrounding rows
    sizeWH: 60,        // Curve Size W, H
    cursorRL: 50,      // Cursor R, L
    thickness: 60,     // Curve/Cursor Thickness
    spriteTriggerSize: 60,

    // Text fields.
    name: 280,

    // Band 3 function-name and cyclePattern fields. Sized
    // to match the Name field width so the right edge of
    // Band 3 lines up with Band 1's Name row.
    callbackField: 280,

    // Band 1 cycle duration numeric field. Small width
    // since the value is typically a single-digit master-
    // beat count (4 by default).
    beatsPerCycle: 50,

    // Band 1 cycle duration row's Beat Interval label and
    // dropdown. The label sits between the beatsPerCycle
    // field and the dropdown; the dropdown shows the
    // current token ("Qtr", "8th", "Dot 16th", etc.) drawn
    // from the 17-entry TOKENS table in beatIntervals.js.
    // Dropdown width fits the longest token text plus the
    // custom arrow chrome at 11pt. The label wraps to two
    // lines ("Beat" / "Interval") so its column is narrower
    // than the single-line text would need, making room for
    // the Speeds field that follows in the same row.
    beatInterval: 84,
    beatIntervalLabel: 60,

    // Band 1 cycle duration row's cycleSpeeds field and
    // label. The Speeds field carries a whitespace-
    // separated number list (integers or decimals, e.g.
    // "1", "1 -1", "0.5 2 -1.5"). Wider than the
    // original integer-only sizing now that decimals are
    // accepted — multi-entry decimal lists stretch
    // across more characters than a typical integer list,
    // so the field is enlarged to fit them comfortably.
    // The row's leftLabel column stays at the standard
    // 78px width matching every other row above and
    // below; the wider Speeds field grows the row past
    // its pre-decimal footprint, which is acceptable
    // since the Starting State row in Band 2 is similarly
    // wide. The label sits to the left of the field on
    // a single line. Curve-only since the direction-
    // reversal effect of negative entries only has
    // visible meaning where a cursor moves along a path.
    cycleSpeeds: 80,
    cycleSpeedsLabel: 50,

    // Band 1 pattern row's Repeats field. Single-digit
    // integer field for the curve-only patternRepeats
    // value. Default value 1 fits in a narrow box; values
    // greater than ~10 are unusual in practice so the
    // field stays small even at the upper end of typical
    // use.
    patternRepeats: 36,
    patternRepeatsLabel: 50,

    // Band 3 Create / Go-to button. Wide enough for the
    // longer "Go to" label (and "Create") at 10pt.
    slotButton: 56,
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
        panel.appendChild(this._buildBandCallbackSlots(ctx));

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
     * dim-italic placeholder style. Single selection shows the
     * kind followed by the object's system-assigned id
     * (e.g. "Sprite SPR1", "Trigger TRG3", "Curve CRV2")
     * — the title carries the per-object identity so a
     * glance answers "what am I looking at?" without
     * needing to read down to Band 1's Object ID field.
     * Multi-select uses count phrasing ("2 Sprites, 1
     * Curve") regardless of kinds, since listing ids for
     * many objects would be long and picking one would be
     * misleading; the count is the right level of summary.
     * Defensive fallback to the count phrasing covers the
     * narrow window when the scene hasn't loaded yet or
     * the selected index doesn't resolve.
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
            const idTitle = singleSelectIdTitle(ctx, this._scene);
            left.textContent = idTitle ?? selectionSummaryTitle(ctx);
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
     * Band 1 — Identity. Three rows. Row 1: Object ID
     * is read-only and greyed for multi-select; Hide Cursor
     * is editable for any non-empty selection and defaults
     * to off (false = cursor visible and firing active).
     * The Hide Cursor field is stored in scene.json's
     * existing `mute` field — the rename is UI-only and
     * existing scores need no migration. The separate
     * `hide` schema field (which controls whether a
     * curve's geometry renders, independent of the cursor)
     * has been dropped from the inspector but stays in the
     * schema so a hand-edited scene.json can still toggle
     * it; the JSON tab is the only surface for that field
     * now. The user-typed Name field that earlier versions
     * of the inspector exposed has been dropped under the
     * cursor-as-collider reshape; the schema field stays
     * in place for future re-surfacing, but only the
     * system-assigned id is shown.
     *
     * Row 2 is the cycle duration row, which reads as
     * "Cycles In [N] beats" with the small numeric field
     * (the underlying schema key is beatsPerCycle) sitting
     * between the "Cycles In" label on the left and the
     * "beats" units suffix on the right. The field is
     * universal across kinds since curves, sprites, and
     * triggers all carry a cycle counter, but greys for
     * trigger-only selections since triggers cannot self-
     * fire under the cursor-as-collider model and their
     * cycle counter is internal-only.
     *
     * Row 3 is the pattern row: a static "Pattern for
     * This Object" label plus one button whose text
     * incorporates the labelled-block tag the button
     * targets. With a single object selected the button
     * reads "Create $id" when no labelled block for the
     * selected object exists in behaviors.js, or "Go to
     * $id" when one does. Multi-select and empty
     * selections grey the row and shorten the button
     * text to just "Create" with no identifier.
     * Existence check is strictly labelled-block-based:
     * scene.labelledBlocks is scanned for an entry
     * whose objectId matches the selected object's id.
     * The button routes through two edit kinds:
     * createPatternBlock when no block exists (scaffolds
     * $id: sound("") at the end of behaviors.js via
     * scaffoldPatternBlock) and goToObjectInCode when
     * one does (scrolls the Code tab to the block's
     * declaration line).
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandIdentity(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const objs = selectedObjects(this._scene, this._selection);
        const idEditable = ctx.isSingle;
        const hideCursorActive = ctx.total > 0;
        // Cycle duration row gate. The row is universal
        // across kinds: curves, sprites, and triggers all
        // carry beatsPerCycle and beatInterval on the
        // schema, and a trigger's beat-interval field is
        // editable from the inspector for future Tier 5
        // collision-firing work. Greying applies only when
        // the selection is empty, mirroring the Hide Cursor
        // gate above.
        const cycleDurationActive = ctx.total > 0;

        // ID comes from the single selected object on
        // single-select. On multi-select the field is greyed
        // and the value is blank, since id is per-object
        // unique. Defensive null checks: if the scene hasn't
        // loaded yet, objs.all is empty and we fall through
        // to the same blank-greyed presentation.
        let idValue = "";
        if (ctx.isSingle && objs.all.length === 1) {
            const obj = objs.all[0];
            idValue = typeof obj.id === "string" ? obj.id : "";
        }

        // Hide Cursor aggregates across every selected
        // object (any kind). The schema field is `mute` and
        // the edit kind stays setMute; only the inspector
        // label has been renamed to reflect what the boolean
        // controls under the cursor-as-collider model
        // (suppressing the cursor, which in turn suppresses
        // firing). The aggregate returns true / false /
        // "varies" so a tri-state checkbox can render the
        // mixed case as a visually distinct "divergent"
        // state.
        const hideCursorState = aggregateBoolean(objs.all, "mute");

        // beatsPerCycle aggregates across the whole selection
        // since the schema field is universal. The row greys
        // only when the selection is empty (cycleDurationActive
        // gate above), so any non-empty selection — including
        // trigger-only — keeps the row editable. The aggregate
        // reads from objs.all so mixed selections show the
        // common value (or varies) across every kind.
        const beatsPerCycleAgg = aggregateString(objs.all, "beatsPerCycle");
        // beatInterval aggregates the same way. Stored as a
        // token string from beatIntervals.js's TOKENS table
        // (e.g. "Qtr", "8th", "Dot 16th"). Missing / null /
        // undefined values fall through to empty string and
        // render as a blank dropdown trigger; the dropdown's
        // change handler commits a valid token via
        // setBeatInterval, and the underlying field then
        // shows up.
        const beatIntervalAgg = aggregateString(objs.all, "beatInterval");
        const beatIntervalValue =
            (beatIntervalAgg === "varies" || beatIntervalAgg === "")
                ? ""
                : beatIntervalAgg;

        // cycleSpeeds aggregates across the curve slice
        // only — sprites and triggers don't carry the
        // field, so including them in the aggregate would
        // always read undefined and clutter the "varies"
        // check. The Speeds field gate (cycleSpeedsActive
        // below) keeps the field greyed for selections
        // with no curves; multi-curve selections show
        // "varies" as a blank field, and a typed value
        // applies uniformly across every selected curve.
        const cycleSpeedsActive = ctx.hasCurves;
        const cycleSpeedsAgg = aggregateString(objs.curves, "cycleSpeeds");

        const r1 = mkRow();
        r1.appendChild(mkLabel("Object ID", { width: W.leftLabel, disabled: !idEditable }));
        r1.appendChild(mkField({
            value: idValue,
            style: idEditable ? "locked" : "",
            disabled: !idEditable,
            width: W.idField,
        }));
        r1.appendChild(mkLabel("Hide Cursor", { width: W.hideCursor, disabled: !hideCursorActive }));
        r1.appendChild(mkCheckbox({
            checked: hideCursorState === true,
            varies: hideCursorState === "varies",
            disabled: !hideCursorActive,
            onClick: hideCursorActive
                ? () => this._onBooleanCheckboxClick("setMute", hideCursorState)
                : undefined,
        }));
        band.appendChild(r1);

        const r2 = mkRow();
        // "Beats /\nCycle" wraps to two lines so the
        // label fits the standard leftLabel column width,
        // matching the multiline pattern used by
        // "State\nat Start" in Band 2 and "Beat\nInterval"
        // later in this same row. The 78px column width
        // keeps the row's label column aligned vertically
        // with every other row in the band above and
        // below; text right-aligns within the column via
        // the .insp-label CSS default.
        r2.appendChild(mkLabel("Beats /\nCycle", {
            width: W.leftLabel,
            disabled: !cycleDurationActive,
            multiline: true,
        }));
        r2.appendChild(this._buildEditableField({
            value: beatsPerCycleAgg === "varies" ? "" : beatsPerCycleAgg,
            numeric: true,
            width: W.beatsPerCycle,
            editable: cycleDurationActive,
            validator: (c) => validateNumber(c, { min: 1 }),
            editKind: "setBeatsPerCycle",
            selectOnFocus: false,
        }));
        // Inline label between the count field and the
        // dropdown. Wraps to two lines ("Beat" / "Interval")
        // so the label column is narrower than the single-
        // line text would need, leaving room for the Speeds
        // field that follows. The .insp-label class right-
        // aligns text within its width box.
        r2.appendChild(mkLabel("Beat\nInterval", {
            width: W.beatIntervalLabel,
            disabled: !cycleDurationActive,
            multiline: true,
        }));
        r2.appendChild(this._buildDropdownField({
            options: BEAT_INTERVAL_TOKENS.map((t) => ({ value: t.token, label: t.label })),
            value: beatIntervalValue,
            width: W.beatInterval,
            editable: cycleDurationActive,
            editKind: "setBeatInterval",
        }));
        // Speeds label and field. Curve-only: greyed when
        // the selection has no curves. The field is a
        // whitespace-separated integer list with validation
        // through validateCycleSpeeds (hard error on non-
        // integer entries). Multi-curve selections aggregate
        // through objs.curves, so "varies" renders as blank
        // and a typed value commits uniformly across every
        // selected curve.
        r2.appendChild(mkLabel("Speeds", {
            width: W.cycleSpeedsLabel,
            disabled: !cycleSpeedsActive,
        }));
        r2.appendChild(this._buildEditableField({
            value: cycleSpeedsAgg === "varies" ? "" : cycleSpeedsAgg,
            width: W.cycleSpeeds,
            editable: cycleSpeedsActive,
            validator: validateCycleSpeeds,
            editKind: "setCycleSpeeds",
            selectOnFocus: false,
        }));
        band.appendChild(r2);

        // Row 3: pattern row. Active only for single-
        // object selections; multi-select and empty
        // selections grey the row. Existence check is
        // strictly labelled-block-based.
        const patternRowActive = ctx.isSingle && objs.all.length === 1;
        const patternObj = patternRowActive ? objs.all[0] : null;
        let labelledBlockExists = false;
        if (patternObj !== null && this._scene !== null) {
            const blocks = this._scene.labelledBlocks;
            labelledBlockExists = Array.isArray(blocks)
                && blocks.some((b) => b.objectId === patternObj.id);
        }

        const r3 = mkRow();
        // The left label uses an inline width wider
        // than W.leftLabel (78px) since "Pattern for
        // This Object" doesn't fit at that width. Not
        // promoted to a W constant since this row is
        // the only use; the longer label pushes the
        // button right but the row stays visually
        // balanced with the rows above.
        r3.appendChild(mkLabel("Pattern for This Object", {
            width: 160,
            disabled: !patternRowActive,
        }));

        const patternButton = document.createElement("button");
        patternButton.className = "insp-btn-create";
        if (!patternRowActive) patternButton.classList.add("disabled");

        // Button text varies with state. Single-object
        // selection shows the labelled-block tag the
        // button will create or jump to; empty or multi-
        // select shows just the verb "Create" since no
        // specific identifier applies.
        if (patternObj !== null) {
            const tag = "$" + patternObj.id;
            patternButton.textContent = (labelledBlockExists ? "Go to " : "Create ") + tag;
        } else {
            patternButton.textContent = "Create";
        }

        if (patternObj !== null) {
            const objId = patternObj.id;
            patternButton.addEventListener("click", () => {
                if (labelledBlockExists) {
                    this._emitEdit({
                        kind: "goToObjectInCode",
                        objectId: objId,
                    });
                } else {
                    this._emitEdit({
                        kind: "createPatternBlock",
                        objectId: objId,
                    });
                }
            });
        }
        r3.appendChild(patternButton);

        // Repeats field. Curve-only: only curves have a
        // visible cursor sweeping along a path where "how
        // many copies of the pattern fit" is meaningful.
        // Active when the single-selected object is a curve;
        // greyed for any other selection (multi-select,
        // sprite-only, trigger-only, empty). The setter in
        // sceneEditor silently ignores sprites and triggers
        // in the selection, so a stray emit from a mixed
        // selection would be a no-op, but the inspector
        // grey gate is what the user sees first. Aggregates
        // across the curve slice only — sprites and
        // triggers don't carry patternRepeats so including
        // them in the aggregate would always read undefined
        // and clutter the "varies" check.
        const patternRepeatsActive = ctx.isSingle
            && ctx.singleKind === "curve"
            && objs.curves.length === 1;
        const patternRepeatsAgg = aggregateString(objs.curves, "patternRepeats");
        r3.appendChild(mkLabel("Repeats", {
            width: W.patternRepeatsLabel,
            disabled: !patternRepeatsActive,
        }));
        r3.appendChild(this._buildEditableField({
            value: patternRepeatsAgg === "varies" ? "" : patternRepeatsAgg,
            numeric: true,
            width: W.patternRepeats,
            editable: patternRepeatsActive,
            validator: (c) => validateNumber(c, { min: 1 }),
            editKind: "setPatternRepeats",
        }));

        band.appendChild(r3);

        return band;
    }

    /**
     * Translate a Mute or Hide checkbox click into the
     * appropriate edit. The varies state (multi-select with
     * divergent values) resolves to true — the declarative
     * "do this thing" outcome — so the click commits to a
     * uniform muted-or-hidden state. Other states toggle.
     *
     * @param {"setMute" | "setHide" | "setCanHit" | "setCanBeHit" | "setCanTick"} kind
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
     *   selectOnFocus?: boolean,
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
        // Pass selectOnFocus: false to suppress — used by
        // multi-token fields like cycleSpeeds where editing
        // one entry in place is the normal case, and by
        // small numeric fields on rows where consistency
        // with such neighbours matters more than the
        // replace-on-type convenience.
        if (opts.selectOnFocus !== false) {
            el.addEventListener("focus", () => {
                selectAllInElement(el);
            });
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
     * @param {{
     *   options: Array<{value: string, label: string}>,
     *   value: string,
     *   width: number,
     *   editable: boolean,
     *   editKind: string,
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
                this._emitEdit({ kind: opts.editKind, value: el.value });
            });
        }
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
     * Band 2 — Geometry and visual. Starting State's X and Y
     * fields are universal (any non-empty selection) and
     * write to the object's starting position; vX and vY
     * apply to sprites and curves and grey for trigger-only
     * selections since triggers don't move under physics
     * and carry no vx/vy fields. Curve dimensions, cursor
     * extents, and the two thicknesses activate when curves
     * are in the selection; sprite/trigger size activates
     * when the selection is exclusively that kind; colour
     * activates when sprites or triggers are present (curves
     * carry no per-object colour at this milestone).
     *
     * Starting State's four fields and Curve Size W/H use
     * absolute-set semantics: the user types a value and
     * every applicable selected object's coordinate becomes
     * that value. This works for single-select (typing 5 in
     * a field showing 3 sets X=5), uniform multi-select
     * (typing 0 sets every selected object's X to 0), and
     * varies multi-select (typing 0 in a blank "varies"
     * field snaps every selected object to X=0 regardless of
     * starting value). The other Band 2 fields (sizes,
     * cursor extents, thicknesses, colour) also commit their
     * typed value as the new value for every applicable
     * selected object.
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
        // Velocity applies to sprites and curves; triggers
        // don't move under physics and carry no vx/vy
        // fields. The vX and vY fields in the Starting State
        // row grey only when the selection has no sprite and
        // no curve (trigger-only or empty selections).
        // setVelocityAxisOnSelection silently skips any
        // trigger indexes in mixed selections, matching the
        // Color row's mixed-selection shape.
        const velocityActive = ctx.hasSprites || ctx.hasCurves;

        const objs = selectedObjects(this._scene, this._selection);

        // Starting State row. X and Y read from sprite/trigger
        // x,y and from curve bbox centroid; vX and vY read
        // from sprite vx/vy and curve vx/vy uniformly. X and
        // Y edits emit setPositionAxis (absolute) so single-
        // select, uniform multi-select, and varies multi-
        // select all flow through the same primitive: type a
        // value, every selected object's X (or Y) becomes
        // that value. For curves the per-shape semantics
        // fall out automatically — setPositionAxisOnSelection
        // computes a per-curve translation delta from the
        // current centroid to the target. vX and vY edits
        // emit setVelocityAxis with axis "x" or "y" and
        // route through setVelocityAxisOnSelection, which
        // applies the value to every sprite and curve in
        // the selection.
        //
        // "Starting State" reads literally: the schema's x,
        // y, vx, vy fields are the initial conditions the
        // simulation resets to on each playback run. The
        // live runtime values during playback are not
        // surfaced here. Curve velocity is currently stored
        // but not yet acted on by the simulation; the per-
        // tick translation by (vx, vy) lands with the
        // curve-bounce work.
        const positionXAgg = aggregatePosition(objs, "x");
        const positionYAgg = aggregatePosition(objs, "y");
        const velocityXAgg = aggregateVelocity(objs, "x");
        const velocityYAgg = aggregateVelocity(objs, "y");

        const r1 = mkRow();
        // Marker class for the Stage 5 Canvas inspector's
        // gallery-width measurement. This is the widest
        // row in the Properties tab, and canvasInspector
        // queries it via this class at mount time to size
        // the pinned and shared gallery sections to
        // match the inspector's natural floor width.
        r1.classList.add("insp-row-starting-state");
        r1.appendChild(mkLabel("State\nat Start", {
            width: W.leftLabel,
            disabled: !positionActive,
            multiline: true,
        }));
        r1.appendChild(mkInlineLetter("X", { disabled: !positionActive }));
        r1.appendChild(this._buildEditableField({
            value: positionXAgg === "varies" ? "" : positionXAgg,
            numeric: true,
            width: W.startState,
            editable: positionActive,
            validator: (c) => validateNumber(c, {}),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value)) {
                    this._emitEdit({ kind: "setPositionAxis", axis: "x", value });
                }
            },
        }));
        r1.appendChild(mkInlineLetter("Y", { disabled: !positionActive }));
        r1.appendChild(this._buildEditableField({
            value: positionYAgg === "varies" ? "" : positionYAgg,
            numeric: true,
            width: W.startState,
            editable: positionActive,
            validator: (c) => validateNumber(c, {}),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value)) {
                    this._emitEdit({ kind: "setPositionAxis", axis: "y", value });
                }
            },
        }));
        // Wider left-margin on the vX letter visually
        // separates the velocity pair from the position
        // pair within the same row. Picked by eye to read
        // as a deliberate gap without pushing the row past
        // the widest line in the inspector (the Band 3
        // callback-slot rows).
        const vXLetter = mkInlineLetter("vX", { disabled: !velocityActive });
        vXLetter.style.marginLeft = "14px";
        r1.appendChild(vXLetter);
        r1.appendChild(this._buildEditableField({
            value: velocityXAgg === "varies" ? "" : velocityXAgg,
            numeric: true,
            width: W.startState,
            editable: velocityActive,
            validator: (c) => validateNumber(c, {}),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value)) {
                    this._emitEdit({ kind: "setVelocityAxis", axis: "x", value });
                }
            },
        }));
        r1.appendChild(mkInlineLetter("vY", { disabled: !velocityActive }));
        r1.appendChild(this._buildEditableField({
            value: velocityYAgg === "varies" ? "" : velocityYAgg,
            numeric: true,
            width: W.startState,
            editable: velocityActive,
            validator: (c) => validateNumber(c, {}),
            onCommit: (newValue) => {
                const value = Number(newValue);
                if (Number.isFinite(value)) {
                    this._emitEdit({ kind: "setVelocityAxis", axis: "y", value });
                }
            },
        }));
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

        // Cursor R/L + Cursor Thickness. Cursor R and L
        // apply to curves and sprites under the cursor-as-
        // collider model; cursor presence is the gate for
        // self-firing and collision capability. Cursor
        // Thickness stays curve-only since sprite cursor
        // visualisation is deferred. The R and L extent
        // fields grey when the selection contains no
        // curves or sprites, or when all selected curves
        // and sprites are muted (mute is the operational
        // toggle that hides the cursor without losing the
        // extent settings).
        const cursorObjs = [...objs.curves, ...objs.sprites];
        const cursorRAgg = aggregateString(cursorObjs, "cursorR");
        const cursorLAgg = aggregateString(cursorObjs, "cursorL");
        const cursorThicknessAgg = aggregateString(objs.curves, "cursorThickness");
        const cursorMuteAgg = aggregateBoolean(cursorObjs, "mute");
        const cursorExtentDisabled =
            cursorObjs.length === 0 || cursorMuteAgg === true;

        const r3 = mkRow();
        r3.appendChild(mkLabel("Cursor Size", { width: W.leftLabel, disabled: cursorExtentDisabled }));
        r3.appendChild(mkInlineLetter("R", { disabled: cursorExtentDisabled }));
        r3.appendChild(this._buildEditableField({
            value: cursorRAgg === "varies" ? "" : cursorRAgg,
            numeric: true,
            width: W.cursorRL,
            editable: !cursorExtentDisabled,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorR",
        }));
        r3.appendChild(mkInlineLetter("L", { disabled: cursorExtentDisabled }));
        r3.appendChild(this._buildEditableField({
            value: cursorLAgg === "varies" ? "" : cursorLAgg,
            numeric: true,
            width: W.cursorRL,
            editable: !cursorExtentDisabled,
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
     * Band 3 — Callback slots. Three rows: hasHit,
     * beenHit, onTick. Each row carries a row label, a
     * Can-X checkbox, a function-name field, and a
     * Create or Go-to button. Every row activates for
     * any non-empty selection regardless of kinds,
     * since the slot vocabulary is shared across
     * curves, triggers, and sprites. The canCycle gate
     * is gone (cursor presence is derived from cursor
     * extents and mute), the cycle duration
     * (beatsPerCycle) field lives on Band 1's second
     * row, and the cycle-pattern authoring row is the
     * third row of Band 1.
     *
     * Read binding aggregates each field across the
     * entire selection (objs.all). Multi-select
     * disagreement renders blank for the function-name
     * fields and as a tri-state varies-checkbox for the
     * Can-X bools. Editing a blank-varies field commits
     * the typed value to every selected object
     * regardless of kind.
     *
     * Create / Go-to buttons. Disabled when the slot's
     * Can-X checkbox is unchecked or when the selection
     * isn't single-object. When checked and a single
     * object is selected, the displayed function name
     * (or the proposed default when the field is empty)
     * is looked up in scene.functionMap; found triggers
     * Go-to, not-found triggers Create. The function-
     * name field renders muted when its text doesn't
     * resolve in functionMap.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCallbackSlots(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const objs = selectedObjects(this._scene, this._selection);
        const slotActive = ctx.total > 0;

        // Single-object context. The placeholder name, the
        // function-existence check, and the Create / Go-to
        // button gate all read against one specific object.
        // Multi-object selections drop to a blank
        // placeholder and a disabled button.
        const singleObj = (ctx.isSingle && objs.all.length === 1) ? objs.all[0] : null;

        const canHitAgg = aggregateBoolean(objs.all, "canHit");
        const hasHitFunctionAgg = aggregateString(objs.all, "hasHitFunction");
        const canBeHitAgg = aggregateBoolean(objs.all, "canBeHit");
        const beenHitFunctionAgg = aggregateString(objs.all, "beenHitFunction");
        const canTickAgg = aggregateBoolean(objs.all, "canTick");
        const onTickFunctionAgg = aggregateString(objs.all, "onTickFunction");

        // Three slot rows driven by a small config table
        // so they share one construction loop.
        /** @type {Array<{
         *   label: string,
         *   slotKey: "hasHit" | "beenHit" | "onTick",
         *   canEditKind: "setCanHit" | "setCanBeHit" | "setCanTick",
         *   canAgg: boolean | "varies",
         *   funcEditKind: "setHasHitFunction" | "setBeenHitFunction" | "setOnTickFunction",
         *   funcAgg: string | "varies",
         * }>} */
        const slotRows = [
            { label: "hasHit", slotKey: "hasHit", canEditKind: "setCanHit", canAgg: canHitAgg, funcEditKind: "setHasHitFunction", funcAgg: hasHitFunctionAgg },
            { label: "beenHit", slotKey: "beenHit", canEditKind: "setCanBeHit", canAgg: canBeHitAgg, funcEditKind: "setBeenHitFunction", funcAgg: beenHitFunctionAgg },
            { label: "onTick", slotKey: "onTick", canEditKind: "setCanTick", canAgg: canTickAgg, funcEditKind: "setOnTickFunction", funcAgg: onTickFunctionAgg },
        ];
        for (const row of slotRows) {
            const r = mkRow();
            r.appendChild(mkLabel(row.label, { width: W.leftLabel, disabled: !slotActive }));
            r.appendChild(mkCheckbox({
                checked: row.canAgg === true,
                varies: row.canAgg === "varies",
                disabled: !slotActive,
                onClick: slotActive
                    ? () => this._onBooleanCheckboxClick(row.canEditKind, row.canAgg)
                    : undefined,
            }));

            // Field value and placeholder. Aggregate
            // disagreement renders blank; the placeholder
            // hint is the proposed default name when the
            // field is empty and the selection is a single
            // object.
            const fieldValue = row.funcAgg === "varies" ? "" : row.funcAgg;
            const placeholder = singleObj !== null
                ? proposedFunctionName(row.slotKey, singleObj)
                : "";
            // Effective name for existence-and-button
            // purposes: typed value if non-empty, else
            // the proposed default. Empty effective name
            // (multi-object with no typed value) means
            // there's no name to look up or scaffold and
            // the button stays disabled.
            const effectiveName = fieldValue.length > 0 ? fieldValue : placeholder;
            const functionExists = effectiveName.length > 0
                && this._functionExistsInScene(effectiveName);

            r.appendChild(this._buildSlotField({
                value: fieldValue,
                placeholder,
                width: W.callbackField,
                editable: slotActive,
                functionExists,
                editKind: row.funcEditKind,
            }));

            // Button. Disabled when slot Can-X unchecked,
            // multi-object selected, or no name to act on.
            const canChecked = row.canAgg === true;
            const buttonEnabled = canChecked && singleObj !== null && effectiveName.length > 0;
            const buttonLabel = functionExists ? "Go to" : "Create";
            r.appendChild(this._buildSlotButton({
                label: buttonLabel,
                disabled: !buttonEnabled,
                slotKey: row.slotKey,
                functionName: effectiveName,
                functionExists,
            }));

            band.appendChild(r);
        }

        return band;
    }

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

        el.addEventListener("focus", () => {
            if (el.classList.contains("placeholder-shown")) {
                clearPlaceholder();
            } else {
                selectAllInElement(el);
            }
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
    }

    /**
     * Build the Create / Go-to button for a Band 3 slot
     * row (rows 3 through 5). Disabled state uses the
     * existing insp-btn-create.disabled styling. Enabled
     * click routes to one of two edits: goToFunction when
     * the named function already exists in behaviors.js,
     * or createFunctionStub when it does not. The slotKey
     * tags the createFunctionStub edit so main.js can
     * dispatch the binding mutator (one of
     * setHasHitFunctionOnSelection,
     * setBeenHitFunctionOnSelection,
     * setOnTickFunctionOnSelection).
     *
     * @param {{
     *   label: string,
     *   disabled: boolean,
     *   slotKey: "hasHit" | "beenHit" | "onTick",
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
    }

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
 * Used as the multi-select title verbatim, and as the
 * single-select fallback when the scene hasn't loaded yet
 * or the object's id can't be resolved (single-select
 * normally uses singleSelectIdTitle below). Single-kind
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
 * Compose the single-select title as "Kind ID" — for
 * example "Sprite SPR1", "Trigger TRG3", "Curve CRV2".
 * Returns null when the scene isn't loaded yet, when the
 * selected index can't be resolved against the scene's
 * arrays, or when the object lacks an id; the caller
 * falls back to the count-based summary in those narrow
 * cases. Multi-select callers shouldn't reach here; the
 * function bails defensively if they do.
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 * @param {import("./scene.js").Scene | null} scene
 * @returns {string | null}
 */
function singleSelectIdTitle(ctx, scene) {
    if (scene === null || !ctx.isSingle || ctx.singleKind === null) return null;
    const kind = ctx.singleKind;
    const idx = ctx.sprites[0] ?? ctx.triggers[0] ?? ctx.curves[0];
    const arr = kind === "sprite" ? scene.sprites
              : kind === "trigger" ? scene.triggers
              : scene.curves;
    if (idx < 0 || idx >= arr.length) return null;
    const obj = arr[idx];
    const id = typeof obj.id === "string" ? obj.id : "";
    if (id.length === 0) return null;
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    return `${cap} ${id}`;
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
 * Aggregate a starting velocity component (vx or vy) across
 * every selected sprite and curve. Triggers in the selection
 * are ignored — triggers don't move under physics and carry
 * no vx/vy fields. Returns the common value as a stringified
 * number, the literal "varies" when sources disagree, or
 * empty string for a selection with no sprite or curve.
 * Mirrors aggregatePosition's shape; the axis parameter
 * follows the position-axis convention ("x" or "y") and
 * maps internally to the vx/vy field names.
 *
 * Used by the Band 2 Starting State row's vX and vY read
 * binding. Edits commit through setVelocityAxis (absolute),
 * so the fields stay editable across single-select, uniform
 * multi-select, and varies multi-select.
 *
 * @param {{ sprites: any[], triggers: any[], curves: any[] }} objs
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
function aggregateVelocity(objs, axis) {
    /** @type {number[]} */
    const values = [];
    for (const s of objs.sprites) {
        const v = axis === "x" ? s.vx : s.vy;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    for (const c of objs.curves) {
        const v = axis === "x" ? c.vx : c.vy;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
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
 * @param {"hasHit" | "beenHit" | "onTick"} slotKey
 * @param {any} obj
 * @returns {string}
 */
function proposedFunctionName(slotKey, obj) {
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
