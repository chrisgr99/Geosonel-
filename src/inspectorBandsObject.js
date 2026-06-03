import {
    validateCycleSpeeds,
    validateNumber,
} from "./curveFieldValidation.js";
import {
    aggregateColor,
    aggregateCurveSize,
    aggregatePosition,
    aggregateString,
    aggregateVelocity,
    selectedObjects,
    selectionSummaryTitle,
    singleSelectIdTitle,
    sizeRowActive,
    sizeRowLabel,
} from "./inspectorSelection.js";
import {
    W,
} from "./inspectorShared.js";
import {
    mkField,
    mkInlineLetter,
    mkLabel,
    mkRow,
    mkUnits,
} from "./inspectorWidgets.js";
import { TOKENS as BEAT_INTERVAL_TOKENS } from "./beatIntervals.js";

export const bandObjectMethods = {

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
    },

    /**
     * Band 1 — Identity. Three rows. Row 1: Object ID
     * is read-only and greyed for multi-select; a single
     * State dropdown is editable for any non-empty selection
     * and defaults to Active. The dropdown is the three-state
     * `state` field: Active / Hide Cursor / Disable for curves
     * and sprites, Active / Disable for triggers (a trigger
     * has no cursor, so no passive state). "Hide Cursor"
     * stores the value "passive". The separate
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
        const togglesEnabled = ctx.total > 0;
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

        // The three-state `state` field aggregates across every
        // selected object (any kind). aggregateString returns
        // the common value or "varies"; "varies" maps to a blank
        // dropdown trigger. The option set depends on the
        // selection: curves and sprites can be made passive
        // ("Hide Cursor"), triggers cannot, so a triggers-only
        // selection offers just Active / Disable. A mixed
        // selection offers all three; applying "passive" then
        // affects only the curves and sprites (setStateOnSelection
        // skips triggers for that value). Active drives the same
        // Cmd-Shift-M toggle and Mute menu item under Edit.
        const stateValue = aggregateString(objs.all, "state");
        const hasCursorKinds = ctx.hasCurves || ctx.hasSprites;
        const stateOptions = hasCursorKinds
            ? [
                { value: "active", label: "Active" },
                { value: "passive", label: "Hide Cursor" },
                { value: "disabled", label: "Disable" },
            ]
            : [
                { value: "active", label: "Active" },
                { value: "disabled", label: "Disable" },
            ];

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

        // cycleSpeeds aggregates across the curve and
        // sprite slices — both kinds carry the field with
        // the same shape and meaning (a per-cycle speed
        // multiplier list); triggers don't, so they're
        // excluded. The Speeds field gate (cycleSpeedsActive
        // below) keeps the field greyed for selections with
        // no curve or sprite; mixed or multi-object
        // selections show "varies" as a blank field, and a
        // typed value applies uniformly across every
        // selected curve and sprite.
        const cycleSpeedsActive = ctx.hasCurves || ctx.hasSprites;
        const cycleSpeedsAgg = aggregateString(
            [...objs.curves, ...objs.sprites], "cycleSpeeds");

        const r1 = mkRow();
        r1.appendChild(mkLabel("Object ID", { width: W.leftLabel, disabled: !idEditable }));
        r1.appendChild(mkField({
            value: idValue,
            style: idEditable ? "locked" : "",
            disabled: !idEditable,
            width: W.idField,
        }));
        // State control: a horizontal radio group on the SAME
        // row as Object ID, to the right of the id field with a
        // small gap before the first radio. No visible field
        // label — the group is announced via role="radiogroup" +
        // aria-label "State". Built from stateOptions (the
        // field's enumValues), so triggers show only Active /
        // Disable and curves and sprites show Active / Hide
        // Cursor / Disable. Emits the same setState edit the
        // dropdown did ("Hide Cursor" stores "passive"); "varies"
        // passes "" so no radio is checked on a divergent
        // multi-select.
        const stateGroup = this._buildRadioGroupField({
            options: stateOptions,
            value: stateValue === "varies" ? "" : stateValue,
            name: "insp-state",
            editable: togglesEnabled,
            editKind: "setState",
            ariaLabel: "State",
        });
        stateGroup.style.marginLeft = "12px";
        r1.appendChild(stateGroup);
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
        // Speeds label and field. Curves and sprites:
        // greyed when the selection has no curve or sprite.
        // The field is a whitespace-separated number list
        // (integers or decimals, possibly negative) with
        // validation through validateCycleSpeeds. Mixed and
        // multi-object selections aggregate across the curve
        // and sprite slices, so "varies" renders as blank
        // and a typed value commits uniformly across every
        // selected curve and sprite.
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
    },

    /**
     * Band 2 — Geometry and visual. Starting State's X and Y
     * fields are universal (any non-empty selection) and
     * write to the object's starting position; vX and vY
     * apply to sprites and curves and grey for trigger-only
     * selections since triggers don't move under physics
     * and carry no vx/vy fields. Curve dimensions and Curve
     * Thickness activate when curves are in the selection;
     * cursor extents and Cursor Thickness extend to curves
     * and sprites; sprite/trigger size activates
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

        // Cursor R/L + Cursor Thickness. All three apply to
        // curves and sprites under the cursor-as-collider
        // model; cursor presence is the gate for self-firing
        // and collision capability. The fields grey when the
        // selection contains no curve or sprite, or when none
        // of the selected curves and sprites is active (a
        // passive or disabled object has no cursor; the state
        // control hides the cursor without losing the extent
        // settings). The sprite cursor
        // line itself is drawn in a later commit; this row
        // stores the authored thickness now so the control
        // is in place when the rendering lands.
        const cursorObjs = [...objs.curves, ...objs.sprites];
        const cursorRAgg = aggregateString(cursorObjs, "cursorR");
        const cursorLAgg = aggregateString(cursorObjs, "cursorL");
        const cursorThicknessAgg = aggregateString(cursorObjs, "cursorThickness");
        const cursorExtentDisabled =
            cursorObjs.length === 0
            || cursorObjs.every((o) => o.state !== "active");

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
        r3.appendChild(mkLabel("Cursor\nThickness", { width: W.cursorThick, disabled: cursorExtentDisabled, multiline: true }));
        r3.appendChild(this._buildEditableField({
            value: cursorThicknessAgg === "varies" ? "" : cursorThicknessAgg,
            numeric: true,
            width: W.thickness,
            editable: !cursorExtentDisabled,
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
    },
};
