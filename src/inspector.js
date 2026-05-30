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
 * Row 3 is the pattern row: a static "Pattern" label
 * plus one button whose text incorporates the labelled-
 * block tag the button targets. With a single object
 * selected the button reads "Create $id" when no
 * labelled block for the selected object exists in
 * behaviors.js, or "Go to $id" when one does. When the
 * selected object's labelled block is part of a chain
 * shared with other objects (section 9), a small "+N"
 * indicator follows the button showing the count of
 * co-labels (other objects sharing the same block).
 * Multi-select and empty selections grey the row and
 * shorten the button text to just "Create" with no
 * identifier.
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
 * (the row's label tracks which); Color activates for any
 * non-empty selection since curves, sprites, and triggers
 * all carry a per-object colour. Starting State's
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
 *   - Color is active when any object is present; curves,
 *     sprites, and triggers all carry a per-object
 *     colour.
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
    hideCursor: 90,    // "Hide Cursor" — deprecated width key, kept for any legacy reference; the Band 1 mute row now uses W.mute instead
    mute: 40,          // "Mute" — the universal mute label on Band 1's row 1, renamed from "Hide Cursor" once mute consolidated across curves, sprites, and triggers (Commit 2 of the pattern-correspondence invariant work)
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

    // Global band's Sound Engine dropdown. Wide enough for
    // the longest enum label ("Superdough (Web Audio)") at
    // 11pt with the custom green chevron chrome on the
    // right edge. The dropdown lives at the bottom of the
    // inspector in the always-visible global band, which
    // controls which engine the rest of the audio surfaces
    // reshape around.
    soundEngine: 180,
    soundEngineLabel: 90,

    // Middle band voice-field dropdowns under superdough.
    // Wide enough for the longest pitched-sound entry
    // (the "... (noise)" and "... (VCSL)" suffixed labels)
    // and the longest drum-machine bank name at 11pt with
    // the custom green chevron chrome on the right edge,
    // with comfortable margin.
    voiceField: 200,
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

        // Structural break separating the per-object
        // bands above from the engine-driven bands below.
        // The middle area is currently empty and reserved
        // for the per-object voice band the multi-engine
        // design lands later (sound / bank dropdowns under
        // superdough, port / channel / program under MIDI,
        // synth-class fields under Tone.js); the global
        // band carries the always-visible Sound Engine
        // dropdown that controls which engine the rest of
        // the audio surfaces reshape around.
        const sep1 = document.createElement("div");
        sep1.className = "insp-separator";
        panel.appendChild(sep1);
        panel.appendChild(this._buildBandMiddleArea(ctx));
        const sep2 = document.createElement("div");
        sep2.className = "insp-separator insp-separator-heavy";
        panel.appendChild(sep2);
        panel.appendChild(this._buildBandGlobal(ctx));

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
     * Row 3 is the pattern row: a static "Pattern"
     * label plus one button whose text incorporates
     * the labelled-block tag the button targets. With
     * a single object selected the button reads
     * "Create $id" when no labelled block for the
     * selected object exists in behaviors.js, or "Go
     * to $id" when one does. When the selected
     * object's labelled block is part of a chain
     * shared with other objects (section 9), a small
     * "+N" indicator follows the button showing the
     * count of co-labels (other objects sharing the
     * same block). Multi-select and empty selections
     * grey the row and shorten the button text to
     * just "Create" with no identifier. Existence
     * check and co-label count are strictly
     * labelled-block-based: scene.labelledBlocks is
     * scanned for an entry whose objectId matches the
     * selected object's id, then for sibling entries
     * that share the same source range (the loader
     * emits one entry per label in a chain, all
     * sharing the chain's range). The button routes
     * through two edit kinds: createPatternBlock when
     * no block exists (scaffolds $id: sound("") at
     * the end of behaviors.js via
     * scaffoldPatternBlock) and goToObjectInCode
     * when one does (scrolls the Code tab to the
     * block's declaration line).
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandIdentity(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const objs = selectedObjects(this._scene, this._selection);
        const idEditable = ctx.isSingle;
        const muteActive = ctx.total > 0;
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

        // Mute aggregates across every selected object
        // (any kind). The aggregate returns true / false /
        // "varies" so a tri-state checkbox can render the
        // mixed case as a visually distinct "divergent"
        // state. Label was "Hide Cursor" in earlier inspector
        // versions when the control was curve-shaped; with
        // mute consolidated across all three kinds in
        // Commit 1 of the pattern-correspondence invariant
        // work and visual feedback for muted sprites and
        // triggers added in Commit 2, the label now reads
        // simply "Mute" to match the schema field name, the
        // Cmd-Shift-M keyboard toggle, and the Mute menu
        // item under Edit.
        const muteState = aggregateBoolean(objs.all, "mute");

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
        r1.appendChild(mkLabel("Mute", { width: W.mute, disabled: !muteActive }));
        r1.appendChild(mkCheckbox({
            checked: muteState === true,
            varies: muteState === "varies",
            disabled: !muteActive,
            onClick: muteActive
                ? () => this._onBooleanCheckboxClick("setMute", muteState)
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
            spinStep: 1,
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
        // selections grey the row. Existence check and
        // co-label count are strictly labelled-block-
        // based. The loader emits one labelledBlocks
        // entry per label in a chain, all sharing the
        // same source range; the count of OTHER entries
        // with the matching range is the +N indicator.
        const patternRowActive = ctx.isSingle && objs.all.length === 1;
        const patternObj = patternRowActive ? objs.all[0] : null;
        let labelledBlockExists = false;
        let coLabelCount = 0;
        if (patternObj !== null && this._scene !== null) {
            const blocks = this._scene.labelledBlocks;
            if (Array.isArray(blocks)) {
                const myBlock = blocks.find((b) => b.objectId === patternObj.id);
                if (myBlock !== undefined) {
                    labelledBlockExists = true;
                    for (const b of blocks) {
                        if (b.objectId !== patternObj.id &&
                            b.range.start === myBlock.range.start &&
                            b.range.end === myBlock.range.end) {
                            coLabelCount++;
                        }
                    }
                }
            }
        }

        const r3 = mkRow();
        r3.appendChild(mkLabel("Pattern", {
            width: W.leftLabel,
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

        // +N co-label indicator. Rendered only when the
        // selected object's labelled block has at least
        // one co-label (another object sharing the same
        // chain). The right margin doubles as the
        // spacer that keeps the indicator from
        // crowding into the Repeats label below; when
        // there's no indicator the row's normal flex
        // gap is the only spacing between button and
        // Repeats label.
        if (labelledBlockExists && coLabelCount > 0) {
            const coLabel = document.createElement("span");
            coLabel.className = "insp-co-label-count";
            coLabel.textContent = "+" + coLabelCount;
            r3.appendChild(coLabel);
        }

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
            spinStep: 1,
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
     * activates for any non-empty selection (curves, sprites,
     * and triggers all carry a per-object colour).
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
        const colorActive = ctx.total > 0;
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
        r1.appendChild(mkLabel("Initial\nConditions", {
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
            spinLive: true,
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
            spinLive: true,
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
            spinLive: true,
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
            spinLive: true,
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
            spinLive: true,
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
            spinLive: true,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorR",
        }));
        r3.appendChild(mkInlineLetter("L", { disabled: cursorExtentDisabled }));
        r3.appendChild(this._buildEditableField({
            value: cursorLAgg === "varies" ? "" : cursorLAgg,
            numeric: true,
            width: W.cursorRL,
            editable: !cursorExtentDisabled,
            spinLive: true,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorL",
        }));
        r3.appendChild(mkLabel("Cursor\nThickness", { width: W.cursorThick, disabled: curveDisabled, multiline: true }));
        r3.appendChild(this._buildEditableField({
            value: cursorThicknessAgg === "varies" ? "" : cursorThicknessAgg,
            numeric: true,
            width: W.thickness,
            editable: !curveDisabled,
            spinLive: true,
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
            spinLive: true,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: sizeEditKind,
        }));
        band.appendChild(r4);

        // Color. Universal across kinds — curves, sprites,
        // and triggers all carry a per-object colour. Editable
        // when at least one object is selected, including when
        // the value varies (typing commits the typed colour
        // to every object in the selection).
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

    /**
     * Middle area band. Populated when the active sound
     * engine is superdough: two dropdowns let the user
     * override the strudel sound and bank used for any
     * pattern event that doesn't carry an explicit one,
     * with a "Default" sentinel at the top of each list
     * meaning "no injection — let the pattern's own
     * values (or strudel's no-s defaults) win". The
     * pitched-sound dropdown applies to events from
     * note() and n() patterns (no s field on the event);
     * the unpitched-bank dropdown applies to events from
     * sound() patterns whose s field is a raw drum name
     * with no underscore. Soft-injection happens in the
     * firing engine right before dispatch, so explicit
     * pattern values like sound("bd").bank("RolandTR808")
     * always win. The right side of the band is left
     * empty as a reservation for future per-object
     * effects controls.
     *
     * Empty when the active engine is MIDI (no per-object
     * MIDI voice fields in this commit — see IN_FLIGHT for
     * the rationale, briefly: Electron mode exposes a
     * single virtual GeoSonel CoreMIDI source and per-
     * track routing happens inside the DAW). Future
     * engines (tone, csound, dough) will reshape the
     * band based on this._scene.engine the same way the
     * superdough branch does today.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandMiddleArea(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band insp-band-middle";

        const engine =
            (this._scene !== null && typeof this._scene.engine === "string")
                ? this._scene.engine
                : "midi";
        if (engine !== "superdough") return band;

        const objs = selectedObjects(this._scene, this._selection);
        const voiceActive = ctx.total > 0;
        const soundAgg = aggregateVoiceField(objs.all, "superdough", "sound");
        const bankAgg = aggregateVoiceField(objs.all, "superdough", "bank");

        // Per-field relevance. A Note Voice override only
        // has an effect on events from note() / n() patterns
        // (which carry no s field for the sound to fill);
        // a Sound Bank override only matters for events from
        // sound() / s() patterns (raw drum names the bank
        // prefixes). When a single object's pattern uses
        // only one of those forms, the other dropdown is
        // greyed as a hint that it would do nothing for this
        // object. The check is textual on the cyclePattern
        // string (see patternUsesNote / patternUsesSound),
        // deliberately simple: it can be fooled by unusual
        // patterns, so it only ever greys a field, never
        // disables the underlying edit path, and both fields
        // stay active whenever the relevance is uncertain.
        // Uncertain cases that leave BOTH active: multi-
        // select (per-object patterns may differ), an empty
        // or unparsed-looking pattern, or a pattern that uses
        // both forms. This mirrors the "never surprise the
        // user with a disabled control" stance the rest of
        // the inspector takes.
        let soundRelevant = true;
        let bankRelevant = true;
        if (ctx.isSingle && objs.all.length === 1) {
            const pat = objs.all[0].cyclePattern;
            const patText = typeof pat === "string" ? pat : "";
            const usesNote = patternUsesNote(patText);
            const usesSound = patternUsesSound(patText);
            // Only narrow when exactly one form is present.
            // Neither-present (empty / still-typing / non-
            // standard) and both-present both leave the
            // fields as they are.
            if (usesNote !== usesSound) {
                soundRelevant = usesNote;
                bankRelevant = usesSound;
            }
        }

        const r1 = mkRow();
        r1.appendChild(mkLabel("Note\nVoice", {
            width: W.leftLabel,
            disabled: !voiceActive || !soundRelevant,
            multiline: true,
        }));
        r1.appendChild(this._buildDropdownField({
            options: PER_OBJECT_SOUND_OPTIONS,
            value: soundAgg === "varies" ? "" : soundAgg,
            width: W.voiceField,
            editable: voiceActive && soundRelevant,
            editKind: "setVoiceSuperdoughSound",
        }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Sound\nBank", {
            width: W.leftLabel,
            disabled: !voiceActive || !bankRelevant,
            multiline: true,
        }));
        r2.appendChild(this._buildDropdownField({
            options: PER_OBJECT_BANK_OPTIONS,
            value: bankAgg === "varies" ? "" : bankAgg,
            width: W.voiceField,
            editable: voiceActive && bankRelevant,
            editKind: "setVoiceSuperdoughBank",
        }));
        band.appendChild(r2);

        return band;
    }

    /**
     * Global band. Sits at the bottom of the inspector,
     * always visible regardless of selection. Carries the
     * Sound Engine dropdown that controls which engine
     * the rest of the audio surfaces reshape around. The
     * dropdown reads scene.engine (null falls back to
     * "midi" for the brief startup window before the
     * loader's migration pass fills the field); changes
     * emit a setSceneEngine edit that main.js routes
     * through applySceneEdit, which writes the new value
     * to scene.json, marks the bundle dirty, and re-runs
     * the scene so firingEngine.setOutputMode picks up
     * the change.
     *
     * Under superdough the band also carries two voice
     * rows below the engine dropdown — the score-wide
     * Note Voice and Sound Bank defaults that per-object
     * voices left on "Global" inherit (see
     * _buildBandMiddleArea). Their top sentinel is
     * "Default" (inject nothing) since the global band
     * can't inherit from itself. Further global-band
     * content (per-engine score-wide effect controls —
     * superdough's reverb and delay character knobs,
     * Tone.js's score-wide layer if added) would layer
     * below those when it lands. The engine dropdown
     * stays at the top of the band as the parent control
     * the rest of the audio surfaces depend on.
     *
     * @param {ReturnType<typeof buildSelectionContext>} _ctx
     */
    _buildBandGlobal(_ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        // Section header titling the band as "Global
        // Settings". The header plus the heavier
        // separator above the band together do the work
        // of marking the global section as distinct from
        // the per-object bands, without depending on a
        // layout mechanism to push the band to the
        // bottom of the pane. Future per-object voice
        // fields in the middle band will naturally
        // space the global section lower as content
        // populates the middle area.
        const header = document.createElement("div");
        header.className = "insp-band-header";
        header.textContent = "Global Settings";
        band.appendChild(header);

        const engineValue =
            (this._scene !== null && typeof this._scene.engine === "string")
                ? this._scene.engine
                : "midi";

        const r = mkRow();
        r.appendChild(mkLabel("Sound\nEngine", {
            width: W.soundEngineLabel,
            multiline: true,
        }));
        r.appendChild(this._buildDropdownField({
            options: [
                { value: "midi", label: "MIDI" },
                { value: "superdough", label: "Superdough (Web Audio)" },
            ],
            value: engineValue,
            width: W.soundEngine,
            editable: true,
            editKind: "setSceneEngine",
        }));
        band.appendChild(r);

        // Global voice rows. Visible only under superdough,
        // matching the middle band's gate. These set the
        // score-wide default Note Voice and Sound Bank that
        // every per-object voice left on "Global" inherits.
        // The top sentinel in each list is "Default" (inject
        // nothing / superdough's own default) rather than
        // the per-object band's "Global", since the global
        // band can't inherit from itself. Read directly
        // from scene.voiceSuperdough.{sound,bank} with
        // object guards; an absent or non-string field
        // reads as the empty-string "Default" sentinel.
        // Never pattern-greyed — the global voice is score-
        // wide and not tied to any one object's pattern —
        // so editable is unconditionally true here, unlike
        // the middle band's per-object dropdowns.
        if (engineValue === "superdough") {
            const vs =
                (this._scene !== null
                    && this._scene.voiceSuperdough !== null
                    && typeof this._scene.voiceSuperdough === "object"
                    && !Array.isArray(this._scene.voiceSuperdough))
                    ? this._scene.voiceSuperdough
                    : null;
            const globalSoundVal =
                (vs !== null && typeof vs.sound === "string") ? vs.sound : "";
            const globalBankVal =
                (vs !== null && typeof vs.bank === "string") ? vs.bank : "";

            const vr1 = mkRow();
            vr1.appendChild(mkLabel("Note\nVoice", {
                width: W.leftLabel,
                multiline: true,
            }));
            vr1.appendChild(this._buildDropdownField({
                options: GLOBAL_SOUND_OPTIONS,
                value: globalSoundVal,
                width: W.voiceField,
                editable: true,
                editKind: "setSceneVoiceSuperdoughSound",
            }));
            band.appendChild(vr1);

            const vr2 = mkRow();
            vr2.appendChild(mkLabel("Sound\nBank", {
                width: W.leftLabel,
                multiline: true,
            }));
            vr2.appendChild(this._buildDropdownField({
                options: GLOBAL_BANK_OPTIONS,
                value: globalBankVal,
                width: W.voiceField,
                editable: true,
                editKind: "setSceneVoiceSuperdoughBank",
            }));
            band.appendChild(vr2);
        }

        return band;
    }
}

// --- Selection-context helpers ---

/**
 * Pitched-sound dropdown options for the superdough voice
 * controls, shared by both the per-object middle band and
 * the score-wide global band. The list holds ONLY the
 * instrument entries — no leading sentinel — because the
 * two bands need different top sentinels: the per-object
 * band prepends a "Global" entry (inherit the global
 * voice), while the global band prepends a "Default" entry
 * (inject nothing / superdough's own default). Each band
 * builds its full option list by prepending its own
 * sentinel to these shared entries (see _buildBandMiddle-
 * Area and _buildBandGlobal). Both sentinels use the
 * empty-string value; they differ only in label and in
 * which level they sit at.
 *
 * The entries: the four built-in oscillators, the four
 * noise sources, the startup-loaded Salamander grand
 * piano, and seven VCSL (Versilian Community Sample
 * Library) pitched instruments lazy-loaded from the VCSL
 * sample map on first selection. The VCSL set replaced an
 * earlier list of gm_ General MIDI entries: the
 * @strudel/web umbrella this build uses ships no soundfont
 * code, so gm_ names produced no sound, whereas the VCSL
 * instruments resolve through the same samples() path that
 * already serves the drum banks and piano. The runtime's
 * VCSL_SOUND_NAMES set must stay in sync with the VCSL
 * entries here so ensureSamplesForVoice loads the map when
 * one is chosen. No trumpet or other brass appears because
 * the VCSL map contains none; a real trumpet would need
 * the soundfont path (gm_trumpet) that this build lacks.
 */
const PITCHED_SOUND_OPTIONS = [
    { value: "sine", label: "sine wave" },
    { value: "sawtooth", label: "sawtooth wave" },
    { value: "square", label: "square wave" },
    { value: "triangle", label: "triangle wave" },
    { value: "white", label: "white (noise)" },
    { value: "pink", label: "pink (noise)" },
    { value: "brown", label: "brown (noise)" },
    { value: "crackle", label: "crackle (noise)" },
    { value: "piano", label: "piano" },
    { value: "steinway", label: "steinway (VCSL)" },
    { value: "vibraphone", label: "vibraphone (VCSL)" },
    { value: "marimba", label: "marimba (VCSL)" },
    { value: "kalimba", label: "kalimba (VCSL)" },
    { value: "harp", label: "harp (VCSL)" },
    { value: "sax", label: "sax (VCSL)" },
];

/**
 * Unpitched bank dropdown options for the superdough voice
 * controls, shared by the per-object middle band and the
 * score-wide global band. As with PITCHED_SOUND_OPTIONS,
 * the list holds ONLY the 13 alphabetised drum-machine
 * bank names from the tidal-drum-machines catalogue — no
 * leading sentinel — and each band prepends its own:
 * "Global" for the per-object band, "Default" for the
 * global band. The names match the bank prefixes
 * superdough applies via strudel's .bank() function: a
 * value of "RolandTR909" means an event with s="bd" (no
 * underscore) becomes RolandTR909_bd at dispatch.
 */
const UNPITCHED_BANK_OPTIONS = [
    { value: "AceToneRhythmAce", label: "AceToneRhythmAce" },
    { value: "AkaiMPC60", label: "AkaiMPC60" },
    { value: "EmuSP12", label: "EmuSP12" },
    { value: "KorgKR55", label: "KorgKR55" },
    { value: "LinnDrum", label: "LinnDrum" },
    { value: "LinnLM1", label: "LinnLM1" },
    { value: "OberheimDMX", label: "OberheimDMX" },
    { value: "RolandCR78", label: "RolandCR78" },
    { value: "RolandTR606", label: "RolandTR606" },
    { value: "RolandTR707", label: "RolandTR707" },
    { value: "RolandTR808", label: "RolandTR808" },
    { value: "RolandTR909", label: "RolandTR909" },
];

/**
 * Per-object (middle band) option lists: the shared
 * instrument/bank entries with a "Global" sentinel
 * prepended. "Global" (empty-string value) means the
 * object inherits the score-wide global voice for that
 * field; it is the default for a new or untouched object
 * (an absent/empty stored value maps to "Global"). The
 * firing engine resolves a per-object "Global" by falling
 * through to scene.voiceSuperdough at dispatch time.
 */
const PER_OBJECT_SOUND_OPTIONS = [
    { value: "", label: "Global" },
    ...PITCHED_SOUND_OPTIONS,
];
const PER_OBJECT_BANK_OPTIONS = [
    { value: "", label: "Global" },
    ...UNPITCHED_BANK_OPTIONS,
];

/**
 * Global-band option lists: the shared instrument/bank
 * entries with a "Default" sentinel prepended. "Default"
 * (empty-string value) means inject nothing at the global
 * level — superdough's own default — so an object
 * inheriting "Global" against a "Default" global resolves
 * to no injection (today's behavior for a fresh score).
 * The global band can't inherit from itself, so its top
 * sentinel is "Default", not "Global".
 */
const GLOBAL_SOUND_OPTIONS = [
    { value: "", label: "Default" },
    ...PITCHED_SOUND_OPTIONS,
];
const GLOBAL_BANK_OPTIONS = [
    { value: "", label: "Default" },
    ...UNPITCHED_BANK_OPTIONS,
];

/**
 * Whether a cyclePattern string appears to use a note-
 * style generator — note(...) or n(...) — whose events
 * carry no s field and so are the events the Note Voice
 * (pitched-sound) override fills. Used only to decide
 * whether to grey the Note Voice dropdown for a single
 * selected object as a do-nothing hint; it never gates
 * the actual injection, which the firing engine applies
 * per event regardless. Deliberately a cheap textual
 * match rather than a parse: it looks for the function
 * name followed by an opening paren (tolerating spaces),
 * with a preceding-character guard so n( inside a longer
 * identifier like fn( or seqn( does not count. Being
 * textual it can misjudge exotic patterns (a name built
 * dynamically, a string literal containing "note("), so
 * the caller only ever uses it to grey, never to block.
 *
 * @param {string} text
 * @returns {boolean}
 */
function patternUsesNote(text) {
    if (typeof text !== "string" || text === "") return false;
    return /(^|[^A-Za-z0-9_$])(note|n)\s*\(/.test(text);
}

/**
 * Whether a cyclePattern string appears to use a sound-
 * style generator — sound(...) or s(...) — whose events
 * carry a raw drum name in the s field that the Sound
 * Bank override prefixes. Companion to patternUsesNote
 * with the same textual-match caveats and the same grey-
 * only use; see that function's note. The preceding-
 * character guard keeps the single-letter s( from
 * matching inside longer identifiers (e.g. cps( or
 * superimpose-style names).
 *
 * @param {string} text
 * @returns {boolean}
 */
function patternUsesSound(text) {
    if (typeof text !== "string" || text === "") return false;
    return /(^|[^A-Za-z0-9_$])(sound|s)\s*\(/.test(text);
}

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
 * by Band 3 for the canHit / canBeHit / canTick checkboxes
 * so multi-select can render a tri-state checkbox indicating
 * divergence.
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
 * Aggregate a per-object voice subfield (e.g.
 * voice.superdough.sound) across a list of objects.
 * Returns the common value as a string when every
 * object's nested field matches, the literal "varies"
 * when values disagree, or empty string for an empty
 * list or a uniformly-missing field. Missing nesting at
 * any level (no voice key, no engine subkey, no field
 * subkey) reads as the empty-string "Default" sentinel
 * so an object that never customised its voice
 * aggregates cleanly alongside one that explicitly set
 * the field to its default. Used by the middle band's
 * dropdown read bindings.
 *
 * @param {any[]} objects
 * @param {string} engine  Engine name (e.g. "superdough").
 * @param {string} field   Field name within the engine subobject (e.g. "sound").
 * @returns {string | "varies"}
 */
function aggregateVoiceField(objects, engine, field) {
    if (objects.length === 0) return "";
    let common = null;
    let initialised = false;
    for (const obj of objects) {
        const voice = (obj === null || typeof obj !== "object") ? null : obj.voice;
        const sub = (voice === null || typeof voice !== "object" || Array.isArray(voice))
            ? null
            : voice[engine];
        const raw = (sub === null || typeof sub !== "object" || Array.isArray(sub))
            ? undefined
            : sub[field];
        const normalised = (raw === null || raw === undefined) ? "" : String(raw);
        if (!initialised) {
            common = normalised;
            initialised = true;
        } else if (normalised !== common) {
            return "varies";
        }
    }
    return common ?? "";
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
 * Aggregate the colour field across every selected object.
 * Curves, sprites, and triggers all carry a per-object
 * colour, so the aggregate walks all three slices. Returns
 * the common value as a hex string, "varies" when objects
 * disagree, or empty for an empty selection.
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
    for (const c of objs.curves) {
        if (typeof c.color === "string") values.push(c.color);
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
function selectAllInElement(el) {
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
function wireFocusSelect(el, opts = {}) {
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
function wrapNumericFieldWithSpinner(fieldEl, opts, inspector) {
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
function wireSpinnerHalf(halfEl, direction, step, live, fieldEl, opts, inspector) {
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
function normaliseHexForPicker(hex, fallback) {
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
