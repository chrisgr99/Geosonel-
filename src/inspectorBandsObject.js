import {
    validateNumber,
} from "./curveFieldValidation.js";
import { promptDialog } from "./dialog.js";
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
} from "./inspectorSelection.js";
import {
    W,
} from "./inspectorShared.js";
import {
    mkBandHeader,
    mkField,
    mkInlineLetter,
    mkLabel,
    mkRow,
} from "./inspectorWidgets.js";
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
     * Identity band (GeosonixV2). Two rows.
     *
     * Row 1: Object ID + State. Object ID is read-only
     * ("locked" styling) on single-select and blank-greyed on
     * multi-select (the id is per-object unique). State is a
     * three-state radio group on the same row — Active / No
     * Cursor / Disable for curves and sprites, Active / Disable
     * for triggers (no cursor). The labels map to the `state`
     * field's values active / passive / disabled ("Hide Cursor"
     * stores "passive").
     *
     * Row 2: Object Name + Time Lag. Object Name reuses the
     * `name` schema field but is rendered BLANK and
     * non-editable for now — there is no defined way to author
     * object names yet, and the legacy `name` may hold stale
     * values we don't surface; it becomes editable and binds to
     * `name` once the authoring semantics are designed. Time Lag
     * is a multiplier numeric field × an interval chosen from the
     * shared interval menu (the "×" reads "times"); it writes the
     * timeLagMultiplier and timeLagInterval fields. Its runtime
     * behaviour (how the lag delays the object) is still TBD.
     *
     * GXW's old Identity rows (the Hide Cursor / Mute control, the
     * cycle-duration row, and the Strudel pattern row) are gone:
     * the cycle controls moved to the Beat Points and Cycle bands,
     * and the pattern row was dropped with Strudel. See DESIGN.md
     * section 4.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandIdentity(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const objs = selectedObjects(this._scene, this._selection);
        const idEditable = ctx.isSingle;
        const togglesEnabled = ctx.total > 0;

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
                { value: "passive", label: "Hide\nCursor" },
                { value: "disabled", label: "Disable" },
            ]
            : [
                { value: "active", label: "Active" },
                { value: "disabled", label: "Disable" },
            ];

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
        stateGroup.style.marginLeft = "8px";
        r1.appendChild(stateGroup);
        band.appendChild(r1);

        // Object Name: reuses GXW's `name` field, but rendered
        // BLANK and non-editable for now. There is no defined way
        // to author object names yet, and the legacy `name` holds
        // stale values we don't want to surface, so the field is a
        // placeholder: value "" and editable false. When the
        // authoring semantics are defined this becomes editable
        // and binds to `name`.
        const r2 = mkRow();
        r2.appendChild(mkLabel("Object Name", {
            width: W.leftLabel,
            disabled: true,
        }));
        r2.appendChild(this._buildNameField({
            value: "",
            editable: false,
            conflict: false,
            objId: null,
            width: W.objectName,
        }));
        // Group (Band 1). Group membership is universal across
        // kinds — editable for any non-empty selection. The
        // dropdown offers every group name already defined in the
        // scene, plus None (ungroup), plus a "New group…" entry
        // that prompts for a name. Time Lag formerly sat here; it
        // moved to the Cycle band to make room. See _buildGroupField.
        r2.appendChild(mkLabel("Group", {
            width: W.groupLabel,
            disabled: !togglesEnabled,
        }));
        r2.appendChild(this._buildGroupField(objs.all, togglesEnabled));
        band.appendChild(r2);

        return band;
    },

    /**
     * Build the Band 1 Group dropdown.
     *
     * Display rule (Chris's spec): with NO groups defined anywhere
     * in the scene the trigger is BLANK; with groups defined, an
     * object in a group shows that group's name and an ungrouped
     * object shows "None". A divergent multi-select shows blank.
     *
     * Options: every distinct group name currently in the scene,
     * a "None" entry (only when groups exist) that clears
     * membership, and a "New group…" entry that prompts for a name
     * and assigns it. Joining is limited to names that already
     * exist; new names are born through the prompt (or, later,
     * through construction code's setGroup).
     *
     * Internals: the stored `group` field is "" (ungrouped) or a
     * name. The "None" option carries value "" so an ungrouped
     * object selects it when groups exist, and falls through to a
     * blank trigger when none do (no None option present). "New
     * group…" and the varies state use sentinel values that match
     * no real option, handled in onChange before any commit.
     *
     * @param {any[]} selectedObjs  The selected objects (all kinds).
     * @param {boolean} editable
     * @returns {HTMLSelectElement}
     */
    _buildGroupField(selectedObjs, editable) {
        const NEW_SENTINEL = " __newgroup__";
        const VARIES_SENTINEL = " __varies__";

        const names = this._collectGroupNames();
        const hasGroups = names.length > 0;

        const groupAgg = aggregateString(selectedObjs, "group");
        // The select value that produces the right trigger text:
        // a real name selects its option; "" selects None when
        // groups exist (else no match -> blank); varies -> a
        // non-matching sentinel -> blank.
        const displayValue = groupAgg === "varies" ? VARIES_SENTINEL : groupAgg;

        /** @type {Array<{value: string, label: string}>} */
        const options = [];
        if (hasGroups) {
            options.push({ value: "", label: "None" });
            for (const n of names) options.push({ value: n, label: n });
        }
        options.push({ value: NEW_SENTINEL, label: "New group…" });

        return this._buildDropdownField({
            options,
            value: displayValue,
            width: W.group,
            editable,
            onChange: (value, el) => {
                if (value === NEW_SENTINEL) {
                    // Reset the visible trigger immediately; the
                    // prompt is async and a successful create will
                    // re-render the whole inspector anyway.
                    el.value = displayValue;
                    promptDialog({
                        title: "New group",
                        description: "Name the group these objects join.",
                        okLabel: "Create",
                    }).then((name) => {
                        const trimmed = (name ?? "").trim();
                        if (trimmed !== "") {
                            this._emitEdit({ kind: "setGroup", value: trimmed });
                        }
                    });
                    return;
                }
                // A real name joins that group; "" (the None
                // option) clears membership.
                this._emitEdit({ kind: "setGroup", value });
            },
        });
    },

    /**
     * Collect the distinct, sorted group names defined across the
     * whole scene (every curve, trigger, and sprite). Empty
     * strings (ungrouped) are excluded. Returns [] before the
     * scene loads. The Group dropdown uses this for its
     * join-an-existing-group options.
     * @returns {string[]}
     */
    _collectGroupNames() {
        if (this._scene === null) return [];
        const set = new Set();
        for (const arr of [this._scene.curves, this._scene.triggers, this._scene.sprites]) {
            if (!Array.isArray(arr)) continue;
            for (const obj of arr) {
                const g = obj && typeof obj.group === "string" ? obj.group : "";
                if (g !== "") set.add(g);
            }
        }
        return [...set].sort();
    },

    /**
     * Transform & appearance band (GeosonixV2). Rows:
     *   - Initial Conditions: X, Y (universal, the starting
     *     position) and vX, vY (the starting velocity; apply to
     *     curves and sprites, grey for trigger-only since triggers
     *     don't move under physics).
     *   - Dimension: ONE merged size row. When curves are selected
     *     it shows Length + Width (the bbox dimensions) and Line
     *     Width (curve thickness); for a sprite-only or trigger-only
     *     selection it shows a single Size value (sprite
     *     displayDiameter / trigger size).
     *   - Cursor: Cursor Length (the R and L extents) + Cursor Width
     *     (cursor thickness); applies to curves and sprites.
     *   - Color + Variability on one row: a single colour (no
     *     when-inactive colour) with the seed-variation dial beside
     *     it. Colour is active for any non-empty selection.
     * There is no Z coordinate anywhere.
     *
     * Position X/Y and the curve Length/Width fields use
     * absolute-set semantics: the typed value becomes that
     * coordinate/dimension on every applicable selected object —
     * so single-select, uniform multi-select, and a blank "varies"
     * multi-select all flow through one primitive. The other fields
     * commit their typed value the same way.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandGeometry(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        band.appendChild(mkBandHeader("Geometry"));

        const curveDisabled = !ctx.hasCurves;
        const sizeActive = sizeRowActive(ctx);
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

        // Size. GeoSonixV2-unified single "Size" row: two
        // dimensions (W, H) when curves are selected, one value
        // for sprites and triggers (the old separate Trigger
        // Size folds in here). Curve Thickness rides along on
        // the curve variant, unchanged. W/H read from each
        // curve's bbox and edit via setSizeAxis (absolute,
        // per-shape semantics inside setSizeAxisOnSelection:
        // ellipse assigns shape.w/shape.h directly so a
        // degenerate axis can grow back; line/piste scale around
        // the bbox-axis midpoint and skip a zero extent). The
        // single sprite/trigger value is a direct field commit.
        // Curves win a mixed selection (W/H shown); the sprite
        // and trigger variant gates on the exclusive-kind
        // sizeRowActive check.
        const r2 = mkRow();
        if (ctx.hasCurves) {
            const sizeWAgg = aggregateCurveSize(objs.curves, "x");
            const sizeHAgg = aggregateCurveSize(objs.curves, "y");
            const curveThicknessAgg = aggregateString(objs.curves, "curveThickness");
            r2.appendChild(mkLabel("Length", { width: W.leftLabel, disabled: curveDisabled }));
            r2.appendChild(this._buildEditableField({
                value: sizeWAgg === "varies" ? "" : sizeWAgg,
                numeric: true,
                width: W.sizeWH,
                editable: !curveDisabled,
                spinLive: true,
                validator: (c) => validateNumber(c, { min: 0 }),
                onCommit: (newValue) => {
                    const value = Number(newValue);
                    if (Number.isFinite(value) && value >= 0) {
                        this._emitEdit({ kind: "setSizeAxis", axis: "x", value });
                    }
                },
            }));
            const widthLabel = mkLabel("Width", { width: W.dimWidthLabel, disabled: curveDisabled });
            widthLabel.style.marginLeft = "10px";
            r2.appendChild(widthLabel);
            r2.appendChild(this._buildEditableField({
                value: sizeHAgg === "varies" ? "" : sizeHAgg,
                numeric: true,
                width: W.sizeWH,
                editable: !curveDisabled,
                spinLive: true,
                validator: (c) => validateNumber(c, { min: 0 }),
                onCommit: (newValue) => {
                    const value = Number(newValue);
                    if (Number.isFinite(value) && value >= 0) {
                        this._emitEdit({ kind: "setSizeAxis", axis: "y", value });
                    }
                },
            }));
            r2.appendChild(mkLabel("Line Width", { width: W.curveThick, disabled: curveDisabled }));
            r2.appendChild(this._buildEditableField({
                value: curveThicknessAgg === "varies" ? "" : curveThicknessAgg,
                numeric: true,
                width: W.thickness,
                editable: !curveDisabled,
                spinLive: true,
                validator: (c) => validateNumber(c, { min: 0 }),
                editKind: "setCurveThickness",
            }));
        } else {
            // Sprite-only or trigger-only: a single Size value
            // (sprite displayDiameter or trigger size). Greyed
            // for empty or mixed sprite+trigger selections.
            const sizeFieldAgg = ctx.singleKind === "sprite"
                ? aggregateString(objs.sprites, "displayDiameter")
                : ctx.singleKind === "trigger"
                ? aggregateString(objs.triggers, "size")
                : "";
            const sizeEditKind = ctx.singleKind === "trigger" ? "setTriggerSize" : "setSpriteSize";
            r2.appendChild(mkLabel("Size", { width: W.leftLabel, disabled: !sizeActive }));
            r2.appendChild(this._buildEditableField({
                value: sizeFieldAgg === "varies" ? "" : sizeFieldAgg,
                numeric: true,
                width: W.spriteTriggerSize,
                editable: sizeActive,
                spinLive: true,
                validator: (c) => validateNumber(c, { min: 0 }),
                editKind: sizeEditKind,
            }));
        }
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
        r3.appendChild(mkLabel("Cursor\nLength", { width: W.leftLabel, disabled: cursorExtentDisabled, multiline: true }));
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
        r3.appendChild(mkLabel("Cursor\nWidth", { width: W.cursorThick, disabled: cursorExtentDisabled, multiline: true }));
        r3.appendChild(this._buildEditableField({
            value: cursorThicknessAgg === "varies" ? "" : cursorThicknessAgg,
            numeric: true,
            width: W.cursorWidthField,
            editable: !cursorExtentDisabled,
            spinLive: true,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setCursorThickness",
        }));
        // Color label + SWATCH ride on the right of the Cursor row
        // (swatch only — no hex text; the swatch carries the standard
        // field border). Universal across kinds; editable for any
        // non-empty selection. A fixed left margin on the label pushes
        // the pair right so the swatch sits toward the vY column
        // (estimated; kept short of vY so the row never exceeds the
        // Initial Conditions line, and it stays put when the pane widens).
        const colorAgg = aggregateColor(objs);
        const colorLabel = mkLabel("Color", { disabled: !colorActive });
        colorLabel.style.marginLeft = "24px";
        r3.appendChild(colorLabel);
        r3.appendChild(this._buildColorField({
            hex: colorAgg === "varies" ? "" : colorAgg,
            editable: colorActive,
            varies: colorAgg === "varies",
            swatchOnly: true,
        }));
        band.appendChild(r3);

        return band;
    },

    /**
     * Mutability band (its own band as of the layout move). The per-
     * object seed-variation amounts the mutation / audition system
     * applies, split by aspect: Position, Velocity, Rhythm. VELOCITY
     * reuses the existing `variability` field (the live seed-variation
     * dial) so today's behaviour is preserved; Position and Rhythm are
     * PLACEHOLDERS — backed by mutatePosition / mutateSize (the Rhythm
     * field is the relabelled former "Size" field; its decimal value
     * persists, but the seed engine doesn't read it yet, and what it
     * means to mutate the rhythm per rhythm-mode is still TBD).
     * Universal across kinds; narrow two-decimal fields. No left "row"
     * label — the band's own MUTABILITY title carries that. Sits just
     * above the per-object voice band, with room to grow more aspects.
     */
    _buildBandMutability(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        band.appendChild(mkBandHeader("Mutability"));

        const objs = selectedObjects(this._scene, this._selection);
        const mutabilityActive = ctx.total > 0;
        const variabilityAgg = aggregateString(objs.all, "variability");
        const mutatePositionAgg = aggregateString(objs.all, "mutatePosition");
        const mutateSizeAgg = aggregateString(objs.all, "mutateSize");

        const mkMutabilityField = (agg, editKind) =>
            this._buildEditableField({
                value: agg === "varies" ? "" : agg,
                numeric: true,
                width: W.mutability,
                editable: mutabilityActive,
                spinLive: true,
                spinStep: 0.01,
                validator: (c) => validateNumber(c, { min: 0 }),
                editKind,
            });

        // No leading "row" label — the band's MUTABILITY title divider
        // already names the section, so Position is the first element.
        const r = mkRow();
        r.appendChild(mkLabel("Position", { disabled: !mutabilityActive }));
        r.appendChild(mkMutabilityField(mutatePositionAgg, "setMutatePosition"));
        const velLabel = mkLabel("Velocity", { disabled: !mutabilityActive });
        velLabel.style.marginLeft = "10px";
        r.appendChild(velLabel);
        r.appendChild(mkMutabilityField(variabilityAgg, "setVariability"));
        // "Rhythm" (the relabelled former "Size" field). Still backed by
        // mutateSize / setMutateSize for now — only the label changed;
        // the rhythm-mutation semantics come later.
        const rhythmLabel = mkLabel("Rhythm", { disabled: !mutabilityActive });
        rhythmLabel.style.marginLeft = "10px";
        r.appendChild(rhythmLabel);
        r.appendChild(mkMutabilityField(mutateSizeAgg, "setMutateSize"));
        band.appendChild(r);

        return band;
    },
};
