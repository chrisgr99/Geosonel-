import {
    aggregateBoolean,
    aggregateString,
    aggregateVoiceField,
    patternUsesNote,
    patternUsesSound,
    selectedObjects,
} from "./inspectorSelection.js";
import {
    GLOBAL_BANK_OPTIONS,
    GLOBAL_SOUND_OPTIONS,
    PER_OBJECT_BANK_OPTIONS,
    PER_OBJECT_SOUND_OPTIONS,
    W,
} from "./inspectorShared.js";
import {
    mkBandHeader,
    mkCheckbox,
    mkInlineLetter,
    mkLabel,
    mkRow,
    proposedFunctionName,
} from "./inspectorWidgets.js";
import { INTERVAL_OPTIONS } from "./intervalMenu.js";
import {
    validateNumber,
    validateBeatsPerBar,
    validateActiveBeatsCount,
    validateBeatShift,
    validateRepeats,
    validateCycleSpeeds,
    validateStopAtCycle,
} from "./curveFieldValidation.js";
import { TOKENS as BEAT_INTERVAL_TOKENS } from "./beatIntervals.js";

export const bandExtraMethods = {

    /**
     * Band 3 — Msg Functions (callback slots).
     * Four callback rows in order onActiveBeat, hasCollided, beenTriggered,
     * onTick. Each callback row carries a row label, a
     * Can-X checkbox, a function-name field, and a
     * Create or Go-to button. Every callback row activates for
     * any non-empty selection regardless of kinds,
     * since the slot vocabulary is shared across
     * curves, triggers, and sprites.
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
        // insp-band-callbacks adds a little extra vertical space
        // between the four single-line callback rows: their one-
        // word labels make them shorter than the two-line-label
        // rows in the other bands, so at the shared row margin
        // they read as cramped.
        band.className = "insp-band insp-band-callbacks";
        band.appendChild(mkBandHeader("Behaviour Functions"));

        const objs = selectedObjects(this._scene, this._selection);
        const slotActive = ctx.total > 0;

        // Single-object context. The placeholder name, the
        // function-existence check, and the Create / Go-to
        // button gate all read against one specific object.
        // Multi-object selections drop to a blank
        // placeholder and a disabled button.
        const singleObj = (ctx.isSingle && objs.all.length === 1) ? objs.all[0] : null;

        const canCollideAgg = aggregateBoolean(objs.all, "canCollide");
        const hasCollidedFunctionAgg = aggregateString(objs.all, "hasCollidedFunction");
        const canBeTriggeredAgg = aggregateBoolean(objs.all, "canBeTriggered");
        const beenTriggeredFunctionAgg = aggregateString(objs.all, "beenTriggeredFunction");
        const canActiveBeatAgg = aggregateBoolean(objs.all, "canActiveBeat");
        const onActiveBeatFunctionAgg = aggregateString(objs.all, "onActiveBeatFunction");
        const canTickAgg = aggregateBoolean(objs.all, "canTick");
        const onTickFunctionAgg = aggregateString(objs.all, "onTickFunction");

        // Slot rows driven by a small config table so they share one
        // construction loop. Order: onActiveBeat FIRST (the primary
        // musical callback — fires on each active beat of the object's
        // own rhythm), then the collision pair hasCollided (active) /
        // beenTriggered (passive), then onTick LAST.
        // onActiveBeat applies to the beat-point-capable kinds (curves
        // and sprites), greyed for trigger-only / empty selections —
        // triggers have no beat points. Parallels the Beat Points band's
        // own gating. (The firing itself lands with the scheduler.)
        const activeBeatEnabled = slotActive && (ctx.hasCurves || ctx.hasSprites);
        /** @type {Array<{
         *   label: string,
         *   slotKey: "onActiveBeat" | "hasCollided" | "beenTriggered" | "onTick",
         *   canEditKind: "setCanActiveBeat" | "setCanCollide" | "setCanBeTriggered" | "setCanTick",
         *   canAgg: boolean | "varies",
         *   funcEditKind: "setOnActiveBeatFunction" | "setHasCollidedFunction" | "setBeenTriggeredFunction" | "setOnTickFunction",
         *   funcAgg: string | "varies",
         *   enabled?: boolean,
         * }>} */
        const slotRows = [
            { label: "onActiveBeat", slotKey: "onActiveBeat", canEditKind: "setCanActiveBeat", canAgg: canActiveBeatAgg, funcEditKind: "setOnActiveBeatFunction", funcAgg: onActiveBeatFunctionAgg, enabled: activeBeatEnabled },
            { label: "hasCollided", slotKey: "hasCollided", canEditKind: "setCanCollide", canAgg: canCollideAgg, funcEditKind: "setHasCollidedFunction", funcAgg: hasCollidedFunctionAgg },
            { label: "beenTriggered", slotKey: "beenTriggered", canEditKind: "setCanBeTriggered", canAgg: canBeTriggeredAgg, funcEditKind: "setBeenTriggeredFunction", funcAgg: beenTriggeredFunctionAgg },
            { label: "onTick", slotKey: "onTick", canEditKind: "setCanTick", canAgg: canTickAgg, funcEditKind: "setOnTickFunction", funcAgg: onTickFunctionAgg },
        ];
        // Build one callback slot row: label + Can-X checkbox +
        // function-name field + Create/Go-to button. A row may set its
        // own `enabled` gate (onActiveBeat does); the rest default to
        // slotActive (any non-empty selection).
        const buildSlotRow = (row) => {
            const rowEnabled = row.enabled ?? slotActive;
            const r = mkRow();
            r.appendChild(mkLabel(row.label, { width: W.leftLabel, disabled: !rowEnabled }));
            r.appendChild(mkCheckbox({
                checked: row.canAgg === true,
                varies: row.canAgg === "varies",
                disabled: !rowEnabled,
                onClick: rowEnabled
                    ? () => this._onBooleanCheckboxClick(row.canEditKind, row.canAgg)
                    : undefined,
            }));
            // Aggregate disagreement renders blank; the placeholder
            // is the proposed default name for a single object.
            const fieldValue = row.funcAgg === "varies" ? "" : row.funcAgg;
            const placeholder = singleObj !== null
                ? proposedFunctionName(row.slotKey, singleObj)
                : "";
            // Effective name: typed value, else the proposed
            // default; empty means nothing to look up / scaffold.
            const effectiveName = fieldValue.length > 0 ? fieldValue : placeholder;
            const functionExists = effectiveName.length > 0
                && this._functionExistsInScene(effectiveName);
            r.appendChild(this._buildSlotField({
                value: fieldValue,
                placeholder,
                width: W.callbackField,
                editable: rowEnabled,
                functionExists,
                editKind: row.funcEditKind,
            }));
            const canChecked = row.canAgg === true;
            const buttonEnabled = rowEnabled && canChecked && singleObj !== null && effectiveName.length > 0;
            const buttonLabel = functionExists ? "Go to" : "Create";
            r.appendChild(this._buildSlotButton({
                label: buttonLabel,
                disabled: !buttonEnabled,
                slotKey: row.slotKey,
                functionName: effectiveName,
                functionExists,
            }));
            return r;
        };

        // Render order: onActiveBeat, hasCollided, beenTriggered, onTick.
        band.appendChild(buildSlotRow(slotRows[0])); // onActiveBeat
        band.appendChild(buildSlotRow(slotRows[1])); // hasCollided
        band.appendChild(buildSlotRow(slotRows[2])); // beenTriggered
        band.appendChild(buildSlotRow(slotRows[3])); // onTick

        return band;
    },

    /**
     * Band 5 — Beat Points (formerly GeoSonix's "Curve Beat
     * Points"). Available for curves OR sprites, never triggers;
     * the whole band greys when the selection has no curve and
     * no sprite. Three rows:
     *   1. mode dropdown (None / Normal / Euclidean, extensible)
     *      plus Beats/Cycle (the cycle's beat count).
     *   2. Active Beats — a compact x/./| string (x active, .
     *      inactive, | bar separator) that loops.
     *   3. Beat Strength — a 0-9 digit string, one per beat,
     *      that loops independently.
     * All fields aggregate across the selected curves and
     * sprites; "varies" renders blank and a committed value
     * applies to every selected curve and sprite. Triggers in a
     * mixed selection are excluded by the setters.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandBeatPoints(ctx) {
        const band = document.createElement("div");
        // insp-band-beatpoints tightens the row gap so the dense
        // normal/euclidean row 1 (mode + Beat Interval + Beats/Cycle +
        // Beats/Bar) fits on one line no wider than other rows.
        band.className = "insp-band insp-band-beatpoints";
        band.appendChild(mkBandHeader("Rhythm"));

        const objs = selectedObjects(this._scene, this._selection);
        const active = ctx.hasCurves || ctx.hasSprites;
        const bpObjs = [...objs.curves, ...objs.sprites];

        const modeAgg = aggregateString(bpObjs, "beatPointsMode");
        const mode = modeAgg === "varies" ? "" : modeAgg;
        const beatsPerCycleAgg = aggregateString(bpObjs, "beatsPerCycle");
        // cycleDuration bounds the Active-Beats-count and Repeats
        // clamps. Falls back to 16 when the aggregate isn't a
        // clean single value (varies / empty multi-select).
        const cycleDur = (() => {
            const n = Number(beatsPerCycleAgg);
            return Number.isFinite(n) && n >= 1 ? n : 16;
        })();

        // Row 1: the mode dropdown, always present. For normal /
        // euclidean it is followed on the same row by Beat Interval
        // (right of the mode dropdown), Beats/Cycle, and Beats/Bar.
        const r1 = mkRow();
        // Lead label: "Beat Pattern" across all modes — a reasonable
        // description whether the pattern is defined by x/dot, the
        // Euclidean generator, or a Strudel mini-notation expression.
        r1.appendChild(mkLabel("Beat\nPattern", { width: W.beatStackLabel, disabled: !active, multiline: true }));
        r1.appendChild(this._buildDropdownField({
            options: [
                { value: "none", label: "None" },
                { value: "normal", label: "Normal" },
                { value: "euclidean", label: "Euclidean" },
                { value: "strudel", label: "Strudel" },
            ],
            value: mode,
            width: W.beatPointsMode,
            editable: active,
            editKind: "setBeatPointsMode",
        }));

        // Beat Interval — the note-duration of each beat, which with
        // Beats/Cycle sets the cycle length (cycleDurationSeconds uses
        // it in every mode). Shown for normal AND euclidean (both
        // grid-based), placed right of the mode dropdown. Strudel has
        // its own Cycle Length interval; None has no beats.
        if (mode === "normal" || mode === "euclidean") {
            const beatIntervalAgg = aggregateString(bpObjs, "beatInterval");
            r1.appendChild(mkLabel("Beat\nInterval", { width: W.beatStackLabel, disabled: !active, multiline: true }));
            r1.appendChild(this._buildDropdownField({
                options: BEAT_INTERVAL_TOKENS.map((t) => ({ value: t.token, label: t.label })),
                value: beatIntervalAgg === "varies" ? "" : beatIntervalAgg,
                width: W.beatInterval,
                editable: active,
                editKind: "setBeatInterval",
            }));
        }

        if (mode === "normal" || mode === "euclidean") {
            r1.appendChild(mkLabel("Per\nCycle", { width: W.beatPerCycleLabel, disabled: !active, multiline: true }));
            r1.appendChild(this._buildEditableField({
                value: beatsPerCycleAgg === "varies" ? "" : beatsPerCycleAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validateNumber(c, { min: 1 }),
                editKind: "setBeatsPerCycle",
                spinStep: 1,
                selectOnFocus: false,
            }));
        }
        // Strudel mode replaces Beats/Cycle + Beats/Bar with a single
        // Cycle Length spec: a note-duration dropdown (the shared
        // interval menu, minus "Off") times an integer count. The
        // one-cycle mini-notation pattern maps across this span;
        // cycle length = cycleInterval × cycleCount (§4).
        if (mode === "strudel") {
            const cycleIntervalAgg = aggregateString(bpObjs, "cycleInterval");
            const cycleCountAgg = aggregateString(bpObjs, "cycleCount");
            r1.appendChild(mkLabel("Cycle Length", { width: W.cycleLengthLabel, disabled: !active }));
            r1.appendChild(this._buildDropdownField({
                options: INTERVAL_OPTIONS.filter((o) => o.value !== "Off"),
                value: cycleIntervalAgg === "varies" ? "" : cycleIntervalAgg,
                width: W.beatInterval,
                editable: active,
                editKind: "setCycleInterval",
            }));
            r1.appendChild(mkInlineLetter("x", { disabled: !active }));
            r1.appendChild(this._buildEditableField({
                value: cycleCountAgg === "varies" ? "" : cycleCountAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validateNumber(c, { min: 1 }),
                editKind: "setCycleCount",
                spinStep: 1,
                selectOnFocus: false,
            }));
        }
        // Beats/Bar shows in both normal and euclidean — it is the
        // time signature's beat count (e.g. 3 for 3/4), and it groups
        // the Active Beats / Beat Strength strings into bars with `|`
        // separators.
        if (mode === "normal" || mode === "euclidean") {
            const beatsPerBarAgg = aggregateString(bpObjs, "beatsPerBar");
            r1.appendChild(mkLabel("Per\nBar", { width: W.beatPerBarLabel, disabled: !active, multiline: true }));
            r1.appendChild(this._buildEditableField({
                value: beatsPerBarAgg === "varies" ? "" : beatsPerBarAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: validateBeatsPerBar,
                editKind: "setBeatsPerBar",
                spinStep: 1,
                selectOnFocus: false,
            }));
        }
        band.appendChild(r1);

        // Euclidean generator parameters (Euclidean only): the
        // Active Beats COUNT (k), Beat Shift, and Repeats. The
        // count is the INPUT the pattern is generated from, as
        // opposed to the Active Beats pattern string shown below.
        if (mode === "euclidean") {
            const countAgg = aggregateString(bpObjs, "activeBeatsCount");
            const shiftAgg = aggregateString(bpObjs, "beatShift");
            const repeatsAgg = aggregateString(bpObjs, "repeats");

            const rE = mkRow();
            // Indent this row so the Active Beats COUNT lines up
            // directly under the Beats/Cycle field in row 1 — it is
            // "how many of those cycle beats are active", and the
            // alignment portrays that relationship (and keeps this
            // count's label out of the left column, where the
            // Active Beats pattern string's label sits below).
            // Spacer width = leftLabel + row gap + mode dropdown.
            const rEIndent = document.createElement("div");
            rEIndent.style.width = `${W.beatStackLabel + 3 + W.beatPointsMode}px`;
            rEIndent.style.flexShrink = "0";
            rE.appendChild(rEIndent);
            rE.appendChild(mkLabel("Active\nBeats", { width: W.beatStackLabel, disabled: !active, multiline: true }));
            rE.appendChild(this._buildEditableField({
                value: countAgg === "varies" ? "" : countAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validateActiveBeatsCount(c, cycleDur),
                editKind: "setActiveBeatsCount",
                spinStep: 1,
                selectOnFocus: false,
            }));
            rE.appendChild(mkLabel("Beat\nShift", { width: W.beatStackLabel, disabled: !active, multiline: true }));
            rE.appendChild(this._buildEditableField({
                value: shiftAgg === "varies" ? "" : shiftAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: validateBeatShift,
                editKind: "setBeatShift",
                spinStep: 1,
                selectOnFocus: false,
            }));
            rE.appendChild(mkLabel("Repeats", { width: W.beatStackLabel, disabled: !active }));
            rE.appendChild(this._buildEditableField({
                value: repeatsAgg === "varies" ? "" : repeatsAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validateRepeats(c, cycleDur),
                editKind: "setRepeats",
                spinStep: 1,
                selectOnFocus: false,
            }));
            band.appendChild(rE);
        }

        // Active Beats pattern string + Beat Strength digit
        // string, shown for BOTH Normal and Euclidean. In Normal
        // the pattern is typed directly; in Euclidean it is the
        // generated result, and Beat Strength still sets per-beat
        // velocity. Both strings loop.
        if (mode === "normal" || mode === "euclidean") {
            const activeBeatsAgg = aggregateString(bpObjs, "activeBeats");
            const strengthAgg = aggregateString(bpObjs, "strength");
            // Beats/Bar drives the live bar grouping in both fields.
            const bpbForBars = (() => {
                const n = Number(aggregateString(bpObjs, "beatsPerBar"));
                return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
            })();

            const rA = mkRow();
            rA.appendChild(mkLabel("Active\nBeats", { width: W.beatStrengthLabel, disabled: !active, multiline: true }));
            rA.appendChild(this._buildBeatStringField({
                value: activeBeatsAgg === "varies" ? "" : activeBeatsAgg,
                width: W.beatString,
                editable: active,
                // In Euclidean the pattern is generated from the
                // parameters, so lock it (read-only) — it's a
                // reference, not directly editable.
                locked: mode === "euclidean",
                beatsPerBar: bpbForBars,
                kind: "pattern",
                editKind: "setActiveBeats",
                ariaLabel: "Active Beats",
            }));
            band.appendChild(rA);

            const rS = mkRow();
            rS.appendChild(mkLabel("Beat\nStrength", { width: W.beatStrengthLabel, disabled: !active, multiline: true }));
            rS.appendChild(this._buildBeatStringField({
                value: strengthAgg === "varies" ? "" : strengthAgg,
                width: W.beatString,
                editable: active,
                beatsPerBar: bpbForBars,
                kind: "strength",
                editKind: "setStrength",
                ariaLabel: "Beat Strength",
            }));
            band.appendChild(rS);
        }

        // Strudel mode: a single mini-notation pattern field REPLACES
        // the Active Beats x/dot string, and Beat Strength is hidden —
        // strength is carried inline in the one pattern (digits 0–9,
        // "~" rest, bare "x" default). It is a free-form text field
        // (not the live x/dot input), parsed once per cycle by
        // patternParse.js for positions and strengths (§4, §10).
        if (mode === "strudel") {
            const patternAgg = aggregateString(bpObjs, "beatPattern");
            const rP = mkRow();
            rP.appendChild(mkLabel("Pattern", { width: W.beatStackLabel, disabled: !active }));
            rP.appendChild(this._buildEditableField({
                value: patternAgg === "varies" ? "" : patternAgg,
                width: W.strudelPattern,
                editable: active,
                validator: (c) => ({ kind: "ok", value: c }),
                editKind: "setBeatPattern",
                selectOnFocus: false,
            }));
            band.appendChild(rP);
        }

        return band;
    },

    /**
     * Band 6 — Cycle. Two lines:
     *   1. Cycle Speeds (short field) + Start at Cycle + Stop at
     *      Cycle. These are cursor-cycle controls, so they apply to
     *      curves and sprites and grey for trigger-only / empty.
     *      Start default 0 (from the beginning), Stop default -1
     *      (never stop).
     *   2. Trigger Sync To Beat — the shared interval dropdown
     *      ("Off" = no sync). Applies to triggers; greys otherwise.
     * GeoSonix's Cursor Speed / Cycle Time / Time Lock are dropped.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCycle(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        band.appendChild(mkBandHeader("Timing"));

        const objs = selectedObjects(this._scene, this._selection);
        const cycleObjs = [...objs.curves, ...objs.sprites];
        const cycleActive = ctx.hasCurves || ctx.hasSprites;
        const triggerActive = ctx.hasTriggers;

        const speedsAgg = aggregateString(cycleObjs, "cycleSpeeds");
        const startAgg = aggregateString(cycleObjs, "startAtCycle");
        const stopAgg = aggregateString(cycleObjs, "stopAtCycle");

        const r1 = mkRow();
        r1.appendChild(mkLabel("Cycle\nSpeeds", { width: W.beatStackLabel, disabled: !cycleActive, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: speedsAgg === "varies" ? "" : speedsAgg,
            width: W.cycleSpeedsShort,
            editable: cycleActive,
            validator: validateCycleSpeeds,
            editKind: "setCycleSpeeds",
            selectOnFocus: false,
        }));
        r1.appendChild(mkLabel("Start at\nCycle", { width: W.beatStackLabel, disabled: !cycleActive, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: startAgg === "varies" ? "" : startAgg,
            numeric: true,
            width: W.beatNum,
            editable: cycleActive,
            validator: (c) => validateNumber(c, { min: 0, integer: true }),
            editKind: "setStartAtCycle",
            spinStep: 1,
            selectOnFocus: false,
        }));
        r1.appendChild(mkLabel("Stop at\nCycle", { width: W.beatStackLabel, disabled: !cycleActive, multiline: true }));
        r1.appendChild(this._buildEditableField({
            value: stopAgg === "varies" ? "" : stopAgg,
            numeric: true,
            width: W.beatNum,
            editable: cycleActive,
            validator: validateStopAtCycle,
            editKind: "setStopAtCycle",
            spinStep: 1,
            selectOnFocus: false,
        }));
        band.appendChild(r1);

        const syncAgg = aggregateString(objs.triggers, "triggerSyncToBeat");
        // Time Lag In Object aggregates across the WHOLE selection
        // (universal across kinds), independent of Trigger Sync.
        const allObjs = [...objs.curves, ...objs.triggers, ...objs.sprites];
        const anySelected = ctx.total > 0;
        const timeLagMultAgg = aggregateString(allObjs, "timeLagMultiplier");
        const timeLagIntervalAgg = aggregateString(allObjs, "timeLagInterval");
        const timeLagIntervalValue =
            (timeLagIntervalAgg === "varies" || timeLagIntervalAgg === "")
                ? ""
                : timeLagIntervalAgg;

        const r2 = mkRow();
        r2.appendChild(mkLabel("Trigger Sync\nTo Beat", { width: W.leftLabel, disabled: !triggerActive, multiline: true }));
        r2.appendChild(this._buildDropdownField({
            options: INTERVAL_OPTIONS,
            value: syncAgg === "varies" ? "" : syncAgg,
            width: W.timeLagInterval,
            editable: triggerActive,
            editKind: "setTriggerSyncToBeat",
        }));
        // Time Lag In Object: moved here from Band 1 (to make room
        // for Group). Universal across kinds — editable for any
        // non-empty selection. Separated from Trigger Sync To Beat
        // by a FIXED gap (not margin-left:auto) so the two read as
        // unrelated controls without the field riding to the far
        // edge when the inspector pane is widened; the fixed gap
        // keeps this row no wider than the other inspector lines.
        // A multiplier times an interval from the shared menu; the
        // "x" reads "times". Runtime behaviour is still TBD.
        const timeLagLabel = mkLabel("Time Lag", {
            width: W.timeLagLabel,
            disabled: !anySelected,
        });
        timeLagLabel.style.marginLeft = "40px";
        r2.appendChild(timeLagLabel);
        r2.appendChild(this._buildEditableField({
            value: timeLagMultAgg === "varies" ? "" : timeLagMultAgg,
            numeric: true,
            width: W.timeLagMult,
            editable: anySelected,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setTimeLagMultiplier",
            spinStep: 1,
            selectOnFocus: false,
        }));
        r2.appendChild(mkInlineLetter("x", { disabled: !anySelected }));
        r2.appendChild(this._buildDropdownField({
            options: INTERVAL_OPTIONS,
            value: timeLagIntervalValue,
            width: W.timeLagInterval,
            editable: anySelected,
            editKind: "setTimeLagInterval",
        }));
        band.appendChild(r2);

        return band;
    },

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
        // Only superdough has per-object voice rows; under MIDI the band
        // stays empty — no header divider, no rows.
        if (engine !== "superdough") return band;
        band.appendChild(mkBandHeader("Voice"));

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
    },

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

        // "Global" titled-divider header. Marks the score-wide section
        // as distinct from the per-object bands by name; it carries the
        // same titled-divider styling as the other bands (uniform, not
        // heavier).
        band.appendChild(mkBandHeader("Global"));

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
    },
};
