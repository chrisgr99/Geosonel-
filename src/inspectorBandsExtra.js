import {
    aggregateBoolean,
    aggregateString,
    aggregateVoiceField,
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
import { listStyles } from "./styleStore.js";
import { getBankSoundNames } from "./drumMachineSounds.js";
import { splitMeasures, resolveMeasures, deriveCurveBeatPoints } from "./beatPoints.js";

/** Wrap a beat-string input in a positioned span carrying the playing-beat
 *  highlight overlay, so the box can sit over the cell under the cursor. */
function wrapBeatField(input) {
    const wrap = document.createElement("span");
    wrap.className = "insp-beat-wrap";
    const hl = document.createElement("div");
    hl.className = "insp-beat-hl";
    wrap.appendChild(input);
    wrap.appendChild(hl);
    return wrap;
}

/** Driver-from-Canvas channel options — the col image signals an NcM canvas
 *  token reads under each beat to swing its strength (beatbox voices). */
const STRENGTH_CHANNEL_OPTIONS = [
    { value: "lt", label: "Lightness" },
    { value: "chr", label: "Chroma" },
    { value: "r", label: "Red" },
    { value: "g", label: "Green" },
    { value: "y", label: "Yellow" },
    { value: "b", label: "Blue" },
    { value: "or", label: "Orange" },
    { value: "li", label: "Lime" },
    { value: "cy", label: "Cyan" },
    { value: "pu", label: "Purple" },
];

/** Voice Role options — the object's ensemble function (this.role). */
const ROLE_OPTIONS = [
    { value: "none", label: "None" },
    { value: "foundation", label: "Foundation" },
    { value: "pulse", label: "Pulse" },
    { value: "accent", label: "Accent" },
    { value: "lead", label: "Lead" },
    { value: "pad", label: "Pad" },
    { value: "fill", label: "Fill" },
    { value: "counter", label: "Counter" },
];

/** Options for the Note Style dropdown (the nxtNote voice a no-arg nxtNote()
 *  uses): Default + built-in note styles + the user's note library. */
function noteStyleOptions() {
    const opts = [
        { value: "", label: "Default" },
        { value: "bass", label: "Bass" },
        { value: "lead", label: "Lead" },
    ];
    for (const rec of listStyles("note")) opts.push({ value: rec.name, label: rec.name });
    return opts;
}

// (The Auto-mode Rhythm Style dropdown options builder lived here; removed with
//  the picker while the rhythm-styles feature is on hold. See rhythmStyles.js.)

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

        const objs = selectedObjects(this._scene, this._activeSelection);
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
        // Per-slot STYLE aggregate — only onActiveBeat surfaces a nxtNote-style
        // picker now. hasCollided / beenTriggered keep their stored *Style fields
        // (resolving to Default) but no inspector control — the off-grid/async
        // semantics are deferred to the async-callback work.
        const onActiveBeatStyleAgg = aggregateString(objs.all, "onActiveBeatStyle");
        const roleAgg = aggregateString(objs.all, "role");
        // Beatbox voices don't use a note style (their accent comes straight from
        // the beat strength, canvas-driven), so the style picker is hidden for them.
        const slotIsBeatbox = aggregateVoiceField(objs.all, "superdough", "source") === "beatbox";
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
                // The function-name field spans the full width up to the Create/Go-to
                // button: its own column + the 6px row gap + the (now removed)
                // style-picker column. Total row width is unchanged, so the button stays put.
                width: W.callbackField + 6 + W.slotStyle,
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
        // Note Style + Voice Role, on a row under onActiveBeat. Note Style is the
        // onActiveBeat nxtNote voice; Voice Role is the object's ensemble function
        // (this.role). Both ride the onActiveBeat gate (curves/sprites).
        const styleRowEditable = activeBeatEnabled && (canActiveBeatAgg === true);
        const nsRow = mkRow();
        // The label spans the leftLabel column + the 6px gap + the 18px checkbox
        // column, so (right-aligned) it hugs its dropdown — which still lines up
        // under the onActiveBeat function field above.
        if (!slotIsBeatbox) {
            nsRow.appendChild(mkLabel("nxtNote Style", { width: W.leftLabel + 6 + 18, disabled: !styleRowEditable }));
            nsRow.appendChild(this._buildDropdownField({
                options: noteStyleOptions(),
                value: onActiveBeatStyleAgg === "varies" ? "" : onActiveBeatStyleAgg,
                width: W.callbackField,
                editable: styleRowEditable,
                editKind: "setOnActiveBeatStyle",
            }));
        }
        // "Role" sizes to its text (no fixed column) so it sits right up against the
        // nxtNote Style field, hugging the Role dropdown on its other side.
        nsRow.appendChild(mkLabel("Role", { disabled: !styleRowEditable }));
        nsRow.appendChild(this._buildDropdownField({
            options: ROLE_OPTIONS,
            value: roleAgg === "varies" ? "" : roleAgg,
            width: W.slotStyle,
            editable: styleRowEditable,
            editKind: "setRole",
        }));
        band.appendChild(nsRow);
        band.appendChild(buildSlotRow(slotRows[1])); // hasCollided
        band.appendChild(buildSlotRow(slotRows[2])); // beenTriggered
        band.appendChild(buildSlotRow(slotRows[3])); // onTick

        return band;
    },

    /**
     * Band 5 — Rhythm (formerly GeoSonix's "Curve Beat Points").
     * Available for curves OR sprites, never triggers; the whole
     * band greys when the selection has no curve and no sprite.
     *
     * The rhythm is always a Strudel mini-notation pattern now (the
     * legacy None / Manual / Euclidean / Auto grid modes are
     * deprecated and the mode picker is gone). Two rows:
     *   1. Quarter Notes per Cycle (the cycle length in master
     *      quarter notes) and Repeats (how many cycles tile the path).
     *   2. Pattern — a full-width, auto-growing Strudel mini-notation
     *      field; digits are beat strengths, ~ a rest, and operators
     *      ([] * <> ? | (k,n) …) go through the real Strudel parser.
     * An empty pattern means no beats (what "None" used to express).
     *
     * The grid-mode field branches below remain but are dead while the
     * mode is pinned to "strudel"; they go when the grid UI is removed.
     * All fields aggregate across the selected curves and sprites;
     * "varies" renders blank and a committed value applies to every
     * selected curve and sprite. Triggers in a mixed selection are
     * excluded by the setters.
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

        const objs = selectedObjects(this._scene, this._activeSelection);
        const active = ctx.hasCurves || ctx.hasSprites;
        const bpObjs = [...objs.curves, ...objs.sprites];
        // Beatbox voices author canvas-driven strengths (NcM tokens), so the
        // band shows a Driver-from-Canvas channel for them. All-beatbox only.
        const isBeatbox = aggregateVoiceField(bpObjs, "superdough", "source") === "beatbox";

        // Beat-pattern mode is now always Strudel. The None / Manual / Euclidean
        // (and on-hold Auto) modes are deprecated and the picker is gone; the
        // rhythm band always authors a Strudel mini-notation pattern, and an empty
        // pattern means no beats (what "None" used to express). The grid-mode
        // branches below stay for now but never run while mode is pinned here.
        const mode = "strudel";
        const beatsPerCycleAgg = aggregateString(bpObjs, "beatsPerCycle");
        // cycleDuration bounds the Active-Beats-count and Repeats
        // clamps. Falls back to 16 when the aggregate isn't a
        // clean single value (varies / empty multi-select).
        const cycleDur = (() => {
            const n = Number(beatsPerCycleAgg);
            return Number.isFinite(n) && n >= 1 ? n : 16;
        })();
        // gridMode is always false now (mode is pinned to "strudel" above), so the
        // legacy grid branches below are dead — kept for now until the grid UI is
        // removed wholesale. isStrudel gates the live Strudel fields.
        const gridMode = mode === "normal" || mode === "euclidean" || mode === "auto";
        const isStrudel = mode === "strudel";

        // Row 1 (Strudel only): Quarter Notes per Cycle, then Repeats. The mode
        // picker is gone — the pattern is always Strudel — so the cycle-length
        // field now leads the row at the left edge.
        const r1 = mkRow();

        // Beat Interval — the note-duration of each beat; with Per Cycle it sets the
        // cycle length (cycleDurationSeconds). Grid modes only: Strudel's count unit
        // is fixed to one master quarter note, so it carries no Beat Interval field.
        if (gridMode) {
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

        // Measures — the phrase length (number of measure-bars in the Beat
        // Pattern field). Each measure is one master-meter bar; the cycle length
        // is measures × master-beats × repeats quarter notes (beatsPerCycle is
        // derived in the simulation). Interim M1 UI: a plain number; the
        // measure-box pattern field arrives in M2. See design/measure-patterns.md.
        const measuresAgg = aggregateString(bpObjs, "measures");
        r1.appendChild(mkLabel("Measures", { disabled: !active }));
        r1.appendChild(this._buildEditableField({
            value: measuresAgg === "varies" ? "" : measuresAgg,
            numeric: true,
            width: W.beatNum,
            editable: active,
            validator: (c) => validateNumber(c, { min: 1, integer: true }),
            editKind: "setMeasures",
            spinStep: 1,
            selectOnFocus: false,
        }));
        // Strudel: Repeats sits on row 1. The mini-notation cycle (Counts/Cycle
        // quarter notes long) is laid end-to-end Repeats times around the path, so
        // the total path length is Counts/Cycle × Repeats quarter notes. Slice k
        // samples Strudel cycle k, so cross-cycle operators evolve across the
        // repeats (see deriveStrudelTiled in beatPoints.js).
        if (isStrudel) {
            const sRepeatsAgg = aggregateString(bpObjs, "repeats");
            r1.appendChild(mkLabel("Repeats", { width: W.beatStackLabel, disabled: !active }));
            const repeatsField = this._buildEditableField({
                value: sRepeatsAgg === "varies" ? "" : sRepeatsAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validateRepeats(c),
                editKind: "setRepeats",
                spinStep: 1,
                selectOnFocus: false,
            });
            // Nudge the field clear of its label so the number doesn't crowd it.
            repeatsField.style.marginLeft = "7px";
            r1.appendChild(repeatsField);
        }
        // Driver from Canvas (beatbox only): the image channel an NcM canvas
        // token reads to swing the beat strength. Sits at the right of the row.
        if (isStrudel && isBeatbox) {
            const channelAgg = aggregateString(bpObjs, "strengthChannel");
            const lbl = mkLabel("Driver from\nCanvas", { width: 60, disabled: !active, multiline: true });
            lbl.style.marginLeft = "12px";
            r1.appendChild(lbl);
            r1.appendChild(this._buildDropdownField({
                options: STRENGTH_CHANNEL_OPTIONS,
                value: channelAgg === "varies" ? "" : channelAgg,
                width: 84,
                editable: active,
                editKind: "setStrengthChannel",
            }));
        }
        // Beats/Bar shows in both normal and euclidean — it is the
        // time signature's beat count (e.g. 3 for 3/4), and it groups
        // the Active Beats / Beat Strength strings into bars with `|`
        // separators.
        if (gridMode) {
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

        // Variation + Repeats row — directly under the Beat Pattern dropdown
        // (Manual / Euclidean). On the LEFT, no labels: a 🎲 dice button (aligned
        // under the mode dropdown via a lead spacer) + the 0–1 flip-probability
        // field. The flip is applied at DERIVATION time from the ORIGINAL pattern, so
        // re-rolls never drift. (The per-cycle auto-roll CHECKBOX — between them and
        // Repeats — lands with Phase 2.) On the RIGHT: Repeats, at the same column as
        // the Euclidean Repeats below, so it stays put across modes.
        if (gridMode) {
            const diceW = 22;                 // snug around the dice glyph
            const varyW = W.beatNum + 12;       // wide enough for a decimal like 0.35
            const rV = mkRow();
            const lead = document.createElement("div");   // align the dice under the mode dropdown
            lead.style.width = `${W.beatStackLabel}px`;
            lead.style.flexShrink = "0";
            rV.appendChild(lead);
            const diceBtn = document.createElement("button");
            diceBtn.type = "button";
            diceBtn.className = "insp-dice-btn";
            diceBtn.textContent = "🎲";
            diceBtn.style.width = `${diceW}px`;
            diceBtn.style.padding = "0";
            diceBtn.title = "Re-roll the variation — a new random variation of the original pattern.";
            diceBtn.disabled = !active;
            if (active) {
                diceBtn.addEventListener("click", () => {
                    this._emitEdit({ kind: "setVarySeed", value: Math.floor(Math.random() * 0x7fffffff) });
                });
            }
            rV.appendChild(diceBtn);
            const varyAgg = aggregateString(bpObjs, "vary");
            const varyField = this._buildEditableField({
                value: varyAgg === "varies" ? "" : varyAgg,
                numeric: true,
                width: varyW,
                editable: active,
                validator: (c) => validateNumber(c, { min: 0, integer: true }),
                editKind: "setVary",
                spinStep: 1,
                selectOnFocus: false,
            });
            varyField.title = "Notes flipped per cycle (0 = none). Each cycle flips this many beats x<->., a fresh delta from the base pattern; use Repeats for variety across cycles.";
            rV.appendChild(varyField);
            // running x-cost of everything placed so far (widths + their trailing
            // gaps), used to size the spacer so Repeats lands at a fixed column.
            let usedLeft = (W.beatStackLabel + 3) + (diceW + 3) + (varyW + 3);   // lead + dice + vary
            // Euclidean: the generator's Active Beats count + Beat Shift sit on THIS
            // row — between the variation fields and Repeats — instead of a row below.
            if (mode === "euclidean") {
                const countAgg = aggregateString(bpObjs, "activeBeatsCount");
                const shiftAgg = aggregateString(bpObjs, "beatShift");
                rV.appendChild(mkLabel("Active\nBeats", { width: W.beatStackLabel, disabled: !active, multiline: true }));
                rV.appendChild(this._buildEditableField({
                    value: countAgg === "varies" ? "" : countAgg,
                    numeric: true,
                    width: W.beatNum,
                    editable: active,
                    validator: (c) => validateActiveBeatsCount(c, cycleDur),
                    editKind: "setActiveBeatsCount",
                    spinStep: 1,
                    selectOnFocus: false,
                }));
                rV.appendChild(mkLabel("Beat\nShift", { width: W.beatStackLabel, disabled: !active, multiline: true }));
                rV.appendChild(this._buildEditableField({
                    value: shiftAgg === "varies" ? "" : shiftAgg,
                    numeric: true,
                    width: W.beatNum,
                    editable: active,
                    validator: validateBeatShift,
                    editKind: "setBeatShift",
                    spinStep: 1,
                    selectOnFocus: false,
                }));
                usedLeft += (W.beatStackLabel + 3) + (W.beatNum + 3) + (W.beatStackLabel + 3) + (W.beatNum + 3);
            }
            // Repeats on the FAR RIGHT, at a fixed column (x≈314) across modes; the
            // spacer fills from the last field to there.
            const repeatsColX = (W.beatStackLabel + 3 + W.beatPointsMode) + 3 + (2 * W.beatStackLabel + 2 * W.beatNum + 3 * 3) + 3;
            const repSpacer = document.createElement("div");
            repSpacer.style.width = `${repeatsColX - 3 - usedLeft}px`;   // − the gap before the Repeats label
            repSpacer.style.flexShrink = "0";
            rV.appendChild(repSpacer);
            const repeatsAgg = aggregateString(bpObjs, "repeats");
            rV.appendChild(mkLabel("Repeats", { width: W.beatStackLabel, disabled: !active }));
            rV.appendChild(this._buildEditableField({
                value: repeatsAgg === "varies" ? "" : repeatsAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validateRepeats(c),
                editKind: "setRepeats",
                spinStep: 1,
                selectOnFocus: false,
            }));
            band.appendChild(rV);
        }

        // (Auto is coerced to Manual above and the rhythm-styles feature is on hold,
        // so there's no Auto-specific row. The Euclidean Active Beats count + Beat
        // Shift, and Repeats for all modes, now live on the variation row above.)

        // Active Beats pattern string + Beat Strength digit
        // string, shown for BOTH Normal and Euclidean. In Normal
        // the pattern is typed directly; in Euclidean it is the
        // generated result, and Beat Strength still sets per-beat
        // velocity. Both strings loop.
        if (gridMode) {
            const activeBeatsAgg = aggregateString(bpObjs, "activeBeats");
            const strengthAgg = aggregateString(bpObjs, "strength");
            // Beats/Bar drives the live bar grouping in both fields.
            const bpbForBars = (() => {
                const n = Number(aggregateString(bpObjs, "beatsPerBar"));
                return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
            })();

            // The Active Beats field always shows the editable BASE pattern (the
            // variation is NOT shown here — it plays per cycle and appears on the
            // canvas dots + audio). Editing it changes the base the per-cycle deltas
            // are taken from. Euclidean's generated pattern stays read-only.
            const single = bpObjs.length === 1 && typeof bpObjs[0].id === "string";

            const rA = mkRow();
            rA.appendChild(mkLabel("Active Beats", { width: W.beatStrengthLabel, disabled: !active }));
            const abField = this._buildBeatStringField({
                value: activeBeatsAgg === "varies" ? "" : activeBeatsAgg,
                width: W.beatString,
                editable: active,
                locked: mode === "euclidean" || mode === "auto",
                beatsPerBar: bpbForBars,
                kind: "pattern",
                editKind: "setActiveBeats",
                ariaLabel: "Active Beats",
            });
            const abWrap = wrapBeatField(abField);
            rA.appendChild(abWrap);
            band.appendChild(rA);
            // Capture for the live variation preview + playing-beat highlight: for a
            // single beat-points object, main.js drives both per frame while playing
            // (the preview value, and the slot-under-the-cursor box on both fields).
            if (single) {
                this._activeBeatsField = abField;
                this._activeBeatsObjectId = bpObjs[0].id;
                this._activeBeatsHighlight = abWrap.querySelector(".insp-beat-hl");
            }

            const rS = mkRow();
            rS.appendChild(mkLabel("Beat Strength", { width: W.beatStrengthLabel, disabled: !active }));
            const stField = this._buildBeatStringField({
                value: strengthAgg === "varies" ? "" : strengthAgg,
                width: W.beatString,
                editable: active,
                // Auto generates Beat Strength too, so lock it there; Euclidean
                // and Manual leave it editable (it sets per-beat velocity).
                locked: mode === "auto",
                beatsPerBar: bpbForBars,
                kind: "strength",
                editKind: "setStrength",
                ariaLabel: "Beat Strength",
            });
            const stWrap = wrapBeatField(stField);
            rS.appendChild(stWrap);
            band.appendChild(rS);
            if (single) {
                this._beatStrengthField = stField;
                this._beatStrengthHighlight = stWrap.querySelector(".insp-beat-hl");
            }
        }

        // Strudel mode: the Beat Strength Pattern field — one rubber-band box per
        // measure, with marker dividers between them. The beatPattern is `|`-joined
        // measures; each box holds one bar's mini-notation (digits 0-9 = strength,
        // "~" rest, native operators). An empty box inherits (ghosts) the nearest
        // filled bar to its left; bars beyond `measures` are hidden but preserved.
        if (isStrudel) {
            const patternAgg = aggregateString(bpObjs, "beatPattern");
            const measuresAgg = aggregateString(bpObjs, "measures");
            const mNum = Number(measuresAgg);
            const M = (Number.isFinite(mNum) && mNum >= 1) ? Math.floor(mNum) : 1;
            const raw = patternAgg === "varies" ? "" : patternAgg;
            const segs = splitMeasures(raw);            // all authored bars
            const ghosts = resolveMeasures(segs, M);    // fill-down effective (for ghosts)

            const rL = mkRow();
            rL.appendChild(mkLabel("Beat Strength Pattern", { disabled: !active }));
            band.appendChild(rL);

            const fieldEl = document.createElement("div");
            fieldEl.className = "insp-measure-field" + (active ? "" : " disabled");

            /** @type {HTMLInputElement[]} */
            const inputs = [];
            // Rebuild the beatPattern from the M visible boxes plus any hidden
            // trailing bars (preserved), joined by `|`, and commit.
            const commit = () => {
                const visible = inputs.map((inp) => inp.value.trim());
                const hidden = segs.slice(M);
                this._emitEdit({ kind: "setBeatPattern", value: [...visible, ...hidden].join(" | ") });
            };

            const MIN_SIZE = 4;
            for (let i = 0; i < M; i++) {
                if (i > 0) {
                    const divider = document.createElement("span");
                    divider.className = "insp-measure-divider";
                    fieldEl.appendChild(divider);
                }
                const cell = document.createElement("div");
                cell.className = "insp-measure";
                const num = document.createElement("span");
                num.className = "insp-measure-num";
                num.textContent = String(i + 1);
                cell.appendChild(num);
                const inp = document.createElement("input");
                inp.type = "text";
                inp.className = "insp-measure-box";
                inp.spellcheck = false;
                const val = i < segs.length ? segs[i] : "";
                inp.value = val;
                // Ghost: an empty box that inherits a filled bar to its left shows
                // that bar faint (grey-italic placeholder) so the user sees what plays.
                if (val === "" && ghosts[i] !== "") inp.placeholder = ghosts[i];
                const resize = () => {
                    inp.size = Math.max(MIN_SIZE, inp.value.length || inp.placeholder.length);
                };
                resize();
                if (active) {
                    inp.addEventListener("input", resize);
                    inp.addEventListener("blur", commit);
                    // Enter commits the pattern (single-line inputs don't submit
                    // on their own); blur runs commit, then the re-render lands.
                    inp.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
                    });
                } else {
                    inp.disabled = true;
                }
                inputs.push(inp);
                cell.appendChild(inp);
                fieldEl.appendChild(cell);
            }
            band.appendChild(fieldEl);

            // Playing-token highlight wiring (M3): for a SINGLE selected object,
            // stash the boxes plus its derived beat positions + per-beat source
            // spans, so the per-frame driver (main.js) can light the currently
            // sounding token in its source box. Reset each render below.
            this._measureBoxes = inputs;
            if (active && bpObjs.length === 1 && typeof bpObjs[0].id === "string") {
                const bp = deriveCurveBeatPoints(bpObjs[0]);
                this._measurePositions = bp.positions;
                this._measureSources = bp.sources || null;
                this._measureHighlightObjectId = bpObjs[0].id;
            }
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

        const objs = selectedObjects(this._scene, this._activeSelection);
        const cycleObjs = [...objs.curves, ...objs.sprites];
        const cycleActive = ctx.hasCurves || ctx.hasSprites;
        const triggerActive = ctx.hasTriggers;

        const speedsAgg = aggregateString(cycleObjs, "cycleSpeeds");
        const startAgg = aggregateString(cycleObjs, "startAtCycle");
        const stopAgg = aggregateString(cycleObjs, "stopAtCycle");

        const r1 = mkRow();
        r1.classList.add("insp-cyclespeeds-row");
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
        r2.classList.add("insp-triggersync-row");
        r2.appendChild(mkLabel("Trigger Sync", { width: W.leftLabel, disabled: !triggerActive }));
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

        // MIDI is deprecated — every object plays through Superdough — so the
        // Voice band always renders; there is no longer an engine gate.
        band.appendChild(mkBandHeader("Voice"));

        const objs = selectedObjects(this._scene, this._activeSelection);
        const voiceActive = ctx.total > 0;
        const soundAgg = aggregateVoiceField(objs.all, "superdough", "sound");
        const bankAgg = aggregateVoiceField(objs.all, "superdough", "bank");

        // An object's voice is ONE of two mutually-exclusive sound sources,
        // chosen by a radio in front of each row:
        //   Instrument — a pitched superdough sound (the old Note Voice).
        //   Beatbox    — a drum-machine bank plus a sound within it.
        // The radio (voice.superdough.source = "instrument" | "beatbox") picks
        // which is in effect; the unpicked row greys. A new/untouched object
        // defaults to Instrument; a mixed multi-select ("varies") shows neither
        // picked and greys both until one is chosen.
        const sampleAgg = aggregateVoiceField(objs.all, "superdough", "sample");
        const sourceAgg = aggregateVoiceField(objs.all, "superdough", "source");
        const source = sourceAgg === "varies" ? ""
            : (sourceAgg === "beatbox" ? "beatbox" : "instrument");
        const instrumentActive = voiceActive && source === "instrument";
        const beatboxActive = voiceActive && source === "beatbox";

        const mkSourceRadio = (val) => {
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "insp-voice-source";
            input.className = "insp-voice-radio";
            input.checked = source === val;
            input.disabled = !voiceActive;
            if (voiceActive) {
                input.addEventListener("change", () => {
                    if (input.checked) {
                        this._emitEdit({ kind: "setVoiceSuperdoughSource", value: val });
                    }
                });
            }
            return input;
        };

        const labelW = W.voiceBankLabel;

        // Instrument row: radio + label + pitched-sound dropdown.
        const rNote = mkRow();
        rNote.appendChild(mkSourceRadio("instrument"));
        rNote.appendChild(mkLabel("Instrument", { width: labelW, disabled: !instrumentActive }));
        rNote.appendChild(this._buildDropdownField({
            options: PER_OBJECT_SOUND_OPTIONS,
            value: soundAgg === "varies" ? "" : soundAgg,
            width: W.voiceFieldCombined,
            editable: instrumentActive,
            editKind: "setVoiceSuperdoughSound",
        }));
        band.appendChild(rNote);

        // Beatbox row: radio + label + drum-bank dropdown + sound-in-bank dropdown.
        const rBank = mkRow();
        rBank.appendChild(mkSourceRadio("beatbox"));
        rBank.appendChild(mkLabel("Beatbox", { width: labelW, disabled: !beatboxActive }));
        rBank.appendChild(this._buildDropdownField({
            options: PER_OBJECT_BANK_OPTIONS,
            value: bankAgg === "varies" ? "" : bankAgg,
            width: W.voiceFieldCombined,
            editable: beatboxActive,
            editKind: "setVoiceSuperdoughBank",
        }));
        // Sound-in-bank dropdown: the individual sounds within the object's
        // bank — the chosen drum machine's drums, or the Dirt-Samples kit when
        // the bank is "superdirt" (the "" sentinel). Picking one stores
        // voice.superdough.sample; it doesn't inject into playback here — the
        // on-active-beat voice style reads it later. The list comes from the
        // sound index (loaded async; greys until it arrives). A mixed
        // multi-select ("varies") has no single bank, so it lists nothing.
        const bankSoundNames = bankAgg === "varies" ? [] : getBankSoundNames(bankAgg);
        rBank.appendChild(this._buildDropdownField({
            options: [
                { value: "", label: "—" },
                ...bankSoundNames.map((s) => ({ value: s, label: s })),
            ],
            value: sampleAgg === "varies" ? "" : sampleAgg,
            width: 96,
            editable: beatboxActive && bankSoundNames.length > 0,
            editKind: "setVoiceSuperdoughSample",
        }));
        band.appendChild(rBank);

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
        band.className = "insp-band insp-band-global";

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

            // Note Voice and Sound Bank share ONE row, identical layout
            // and widths to the per-object Voice band: label + field +
            // label + field within a 440px row. Score-wide defaults,
            // never pattern-greyed (editable unconditionally).
            const vr1 = mkRow();
            vr1.appendChild(mkLabel("Note Voice", { width: W.voiceNoteLabel }));
            vr1.appendChild(this._buildDropdownField({
                options: GLOBAL_SOUND_OPTIONS,
                value: globalSoundVal,
                width: W.voiceFieldCombined,
                editable: true,
                editKind: "setSceneVoiceSuperdoughSound",
            }));
            vr1.appendChild(mkLabel("Sound Bank", { width: W.voiceBankLabel }));
            vr1.appendChild(this._buildDropdownField({
                options: GLOBAL_BANK_OPTIONS,
                value: globalBankVal,
                width: W.voiceFieldCombined,
                editable: true,
                editKind: "setSceneVoiceSuperdoughBank",
            }));
            band.appendChild(vr1);
        }

        return band;
    },
};
