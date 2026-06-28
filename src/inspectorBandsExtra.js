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
    validateActiveBeatsCount,
    validateBeatShift,
    validatePhrases,
    validateCycleSpeeds,
} from "./curveFieldValidation.js";
import { listStyles } from "./styleStore.js";
import { getBankSoundNames } from "./drumMachineSounds.js";
import { splitMeasures, resolveMeasures, deriveCurveBeatPoints, fillForwardPhrases, moduleLoopFill } from "./beatPoints.js";
import { layoutChart, groupRows, sectionLabelFor, rangesForLabel, chartSections } from "./harmonyChartLayout.js";

/** Wrap a beat-string input in a positioned span carrying the playing-beat
 *  highlight overlay, so the box can sit over the cell under the cursor. */
function wrapBeatField(input) {
    const wrap = document.createElement("span");
    wrap.className = "insp-beat-wrap";
    const hl = document.createElement("div");
    hl.className = "insp-beat-hl";
    wrap.appendChild(input);
    // Ghost-preview overlay (lighter font, recycled/inherited beats), when the
    // field built one. Sits between the input and the highlight box.
    if (input._ghostEl) wrap.appendChild(input._ghostEl);
    wrap.appendChild(hl);
    return wrap;
}

/** Beat-pattern type options for the Rhythm band's mode picker. "normal" is the
 *  Manual grid (type the active-beats + strength strings); Euclidean generates
 *  the pattern from a k-of-n count; Strudel authors a mini-notation pattern;
 *  "Harmony driven" (chart) follows the loaded chord chart's phrases — one
 *  variable-length phrase row per chart phrase, structure locked to the chart.
 *  The deprecated "none"/"auto" modes are not offered. */
const BEAT_POINTS_MODE_OPTIONS = [
    { value: "normal", label: "Manual" },
    { value: "euclidean", label: "Euclidean" },
    { value: "strudel", label: "Strudel" },
    { value: "chart", label: "Harmony driven" },
];

/** Pan-mode options for the Canvas to Sound Drivers Pan row. Collision L/R is
 *  reserved (greyed) until wired. */
const PAN_MODE_OPTIONS = [
    { value: "off", label: "Off" },
    { value: "canvasLR", label: "Canvas L/R" },
    { value: "collisionLR", label: "Collision L/R", disabled: true },
];

/** Canvas channel options — the ten col image signals a Canvas to Sound Drivers
 *  row reads under each beat (drives beat strength, drop, velocity, sustain). */
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
     * A Pattern Type picker at the head of row 1 chooses how beat points
     * are defined, per object:
     *   - Manual (normal) / Euclidean — the grid fields: Beat Interval,
     *     Per Bar, a variation row (dice + flips, Euclidean count + shift),
     *     and the Active Beats + Beat Strength strings (typed for Manual,
     *     generated read-only for Euclidean).
     *   - Strudel — Measures + Repeats, then the measure-box Pattern field
     *     (digits = beat strengths, ~ a rest, operators via the real parser).
     * The band's bottom row (Cycle Speeds + Time Lag) shows for every mode.
     *
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
        // Canvas-driven strength (the swing/range digit of a strength token) maps
        // the image colour under each beat onto its loudness, for BOTH beatbox
        // (the drum's velocity is the strength) and instrument voices (the
        // strength feeds shapeVelocity). So the Driver-from-Canvas channel shows
        // for every Strudel voice, not beatbox only.

        // Beat-pattern type is chosen per object by the mode picker at the head of
        // row 1: Manual (normal) and Euclidean drive the grid fields, Strudel the
        // mini-notation pattern. The aggregate is "" for a mixed selection (no
        // single mode), which shows neither field set — just the picker.
        const modeAgg = aggregateString(bpObjs, "beatPointsMode");
        const mode = (modeAgg === "varies" || modeAgg === "") ? "" : modeAgg;
        // gridMode = the Manual/Euclidean grid fields; isStrudel = the mini-notation
        // pattern + Repeats. (Auto is on hold and not offered by the picker.)
        const gridMode = mode === "normal" || mode === "euclidean" || mode === "auto";
        const isStrudel = mode === "strudel";
        // Clear any prior chart-mode highlight map; only the chart branch re-sets it,
        // so the Manual/Euclidean highlight path isn't fed a stale chart mapping.
        this._chartHl = null;
        // Harmony-driven (chart-mirror): the rhythm editor shows the LOADED chart's
        // measures, laid out like the Harmony tab (4 per row, folded repeats), each an
        // editable beat field. The structure comes from the chart, not the
        // Measures/Phrases fields. Single-select only; needs a loaded harmony.
        const chartMode = mode === "chart";
        const chartHarmony = (chartMode && bpObjs.length === 1
            && this._scene && this._scene.harmony
            && Array.isArray(this._scene.harmony.progression)
            && this._scene.harmony.progression.length > 0)
            ? this._scene.harmony : null;

        // Master meter: beats (quarter notes) per measure = the scene time-
        // signature numerator (default 4).
        const masterBeats = (() => {
            const ts = this._scene && Array.isArray(this._scene.timeSignature)
                ? Number(this._scene.timeSignature[0]) : NaN;
            return (Number.isFinite(ts) && ts >= 1) ? Math.floor(ts) : 4;
        })();
        const measuresAgg = aggregateString(bpObjs, "measures");
        // Cells per bar = the master beats per measure — each cell is a quarter note
        // (Beat Interval is fixed to a quarter for Manual and Euclidean alike). This
        // is the `|` bar-grouping width and, × Measures, the cycle length.
        const cellsPerBar = masterBeats;
        const measuresNum = (() => {
            const m = Number(measuresAgg);
            return (Number.isFinite(m) && m >= 1) ? Math.floor(m) : 1;
        })();
        // Pattern length in beats (slots) = Measures × cells-per-bar; bounds the
        // Euclidean Active-Beats count below.
        const cycleDur = measuresNum * cellsPerBar;
        const bpbForBars = cellsPerBar;

        // Row 1: the Pattern Type picker leads, then the per-mode fields.
        const r1 = mkRow();

        // Pattern Type — Manual / Euclidean / Strudel. Drives which fields below
        // render (gridMode vs isStrudel). Single-line label at the tab control's
        // left-column width, so the dropdown left-aligns with the tabs/box below.
        r1.appendChild(mkLabel("Pattern Type", { width: W.beatStrengthLabel, disabled: !active }));
        r1.appendChild(this._buildDropdownField({
            options: BEAT_POINTS_MODE_OPTIONS,
            value: mode,
            width: W.beatPointsMode,
            editable: active,
            editKind: "setBeatPointsMode",
        }));

        // In chart mode the practice-loop button rides on this row, just right of
        // the Pattern Type menu — a small square ⟲ toggle (no label, no row of its
        // own). Select measures below, press to loop that span; press with nothing
        // selected to clear. Wired further down, once the measure box + segments
        // exist (the chartMode block below).
        let loopBtn = null;
        if (chartMode && chartHarmony !== null
            && bpObjs.length === 1 && typeof bpObjs[0].id === "string") {
            loopBtn = document.createElement("button");
            loopBtn.type = "button";
            const looping = Array.isArray(this._loopRange);
            loopBtn.className = "insp-loop-btn" + (looping ? " active" : "");
            loopBtn.textContent = "⟲";
            loopBtn.title = "Select measures below (drag or shift-click), then press to loop just that span. "
                + "The transport plays only it; rewind goes to its first bar. Press with nothing selected to clear.";
            loopBtn.disabled = !active;
            loopBtn.setAttribute("aria-pressed", looping ? "true" : "false");
            loopBtn.style.marginLeft = "7px";
            loopBtn.setAttribute("aria-label", "Practice loop");
            r1.appendChild(loopBtn);
        }

        // Measures — the pattern length in bars; × cells-per-bar gives the cycle
        // length the pattern loops to fill. Sits between Pattern Type and Beat
        // Interval, for every mode (each bar is one master-meter measure).
        if (gridMode || isStrudel) {
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
        }

        // Phrases — directly after Measures on row 1, for every mode. The pattern
        // (Manual's per-phrase tabs, or the Strudel/Euclidean cycle) is laid end-to-
        // end Phrases times around the path. Beat Interval is gone (always a quarter).
        if (gridMode || isStrudel) {
            const sPhrasesAgg = aggregateString(bpObjs, "phrases");
            r1.appendChild(mkLabel("Phrases", { width: W.beatStackLabel, disabled: !active }));
            const phrasesField = this._buildEditableField({
                value: sPhrasesAgg === "varies" ? "" : sPhrasesAgg,
                numeric: true,
                width: W.beatNum,
                editable: active,
                validator: (c) => validatePhrases(c),
                editKind: "setPhrases",
                spinStep: 1,
                selectOnFocus: false,
            });
            // Nudge the field clear of its label so the number doesn't crowd it.
            phrasesField.style.marginLeft = "7px";
            r1.appendChild(phrasesField);
        }
        // (The per-object Per Bar field is gone: the bar grouping is now the
        // master meter's cells-per-bar, computed above as bpbForBars.)
        band.appendChild(r1);

        // Random variation: a 🎲 re-roll button + the flip-count field. For Manual
        // these move INTO the tab row (built into the grid below, left of the tabs)
        // to save a row; Euclidean/Auto keep them on their own row, followed by the
        // generator's Active Beats count + Beat Shift.
        const makeDiceVary = () => {
            const wrap = document.createElement("div");
            wrap.className = "insp-dicevary";
            const diceBtn = document.createElement("button");
            diceBtn.type = "button";
            diceBtn.className = "insp-dice-btn";
            diceBtn.textContent = "🎲";
            diceBtn.style.width = "22px";
            diceBtn.style.padding = "0";
            diceBtn.title = "Re-roll the variation — a new random variation of the original pattern.";
            diceBtn.disabled = !active;
            if (active) diceBtn.addEventListener("click", () => {
                this._emitEdit({ kind: "setVarySeed", value: Math.floor(Math.random() * 0x7fffffff) });
            });
            wrap.appendChild(diceBtn);
            const varyAgg = aggregateString(bpObjs, "vary");
            const varyField = this._buildEditableField({
                value: varyAgg === "varies" ? "" : varyAgg,
                numeric: true,
                width: W.beatNum + 12,
                editable: active,
                validator: (c) => validateNumber(c, { min: 0, integer: true }),
                editKind: "setVary",
                spinStep: 1,
                selectOnFocus: false,
            });
            varyField.title = "Notes flipped per cycle (0 = none). Each cycle flips this many beats x<->., a fresh delta from the base pattern; use Repeats for variety across cycles.";
            varyField.style.marginLeft = "3px";
            wrap.appendChild(varyField);
            return wrap;
        };

        if (mode === "euclidean") {
            // Euclidean generator params: Active Beats count + Beat Shift, on their
            // own row. (Dice + vary are hidden for now — they may later move to the
            // end of each phrase row; makeDiceVary is kept above for that.)
            const rV = mkRow();
            const countAgg = aggregateString(bpObjs, "activeBeatsCount");
            const shiftAgg = aggregateString(bpObjs, "beatShift");
            // "Active Beats" label widened to the Pattern Type label's width so the
            // count field left-aligns with the Pattern Type dropdown above it (and
            // Beat Shift shifts over by the same amount).
            rV.appendChild(mkLabel("Active\nBeats", { width: W.beatStrengthLabel, disabled: !active, multiline: true }));
            rV.appendChild(this._buildEditableField({
                value: countAgg === "varies" ? "" : countAgg,
                numeric: true, width: W.beatNum, editable: active,
                validator: (c) => validateActiveBeatsCount(c, cycleDur),
                editKind: "setActiveBeatsCount", spinStep: 1, selectOnFocus: false,
            }));
            rV.appendChild(mkLabel("Beat\nShift", { width: W.beatStackLabel, disabled: !active, multiline: true }));
            rV.appendChild(this._buildEditableField({
                value: shiftAgg === "varies" ? "" : shiftAgg,
                numeric: true, width: W.beatNum, editable: active,
                validator: validateBeatShift,
                editKind: "setBeatShift", spinStep: 1, selectOnFocus: false,
            }));
            band.appendChild(rV);
        }

        // Active Beats pattern string + Beat Strength digit
        // string, shown for BOTH Normal and Euclidean. In Normal
        // the pattern is typed directly; in Euclidean it is the
        // generated result, and Beat Strength still sets per-beat
        // velocity. Both strings loop.
        if (gridMode && mode === "normal") {
            // Manual: every PHRASE's beat-pattern field stacked in ONE box — a phrase
            // number + vertical divider at the left of each row, horizontal rules
            // between rows. Phrase 1 is phrasePatterns[0] (falling back to the legacy
            // activeBeats); later phrases start empty and fill-forward (inherit) at
            // play time. Beat Strength is a SINGLE field below — one strength repeats
            // across every phrase. (Dice/vary is hidden for now.)
            const phrasesAgg = aggregateString(bpObjs, "phrases");
            const phrasesNum = (() => {
                const n = Number(phrasesAgg);
                return (Number.isFinite(n) && n >= 1) ? Math.min(8, Math.floor(n)) : 1;
            })();
            const rowCells = () => cycleDur;
            const patAgg = aggregateString(bpObjs, "phrasePatterns");
            const abAgg = aggregateString(bpObjs, "activeBeats");
            const stAgg = aggregateString(bpObjs, "strength");
            const single = bpObjs.length === 1 && typeof bpObjs[0].id === "string";
            // Pull phrase k's segment from a comma-joined aggregate; phrase 0 falls
            // back to the legacy activeBeats. "varies" / missing → blank.
            const seg = (agg, k, fallback) => {
                if (agg === "varies") return "";
                const parts = (typeof agg === "string" && agg !== "") ? agg.split(",") : [];
                const v = (k < parts.length) ? parts[k] : "";
                return (v === "" && k === 0) ? (fallback === "varies" ? "" : fallback) : v;
            };
            // phrase r's RESOLVED play-out (its own pattern, or the inherited one if
            // empty) looped to the full cycle (cycleDur cells) and barized — the ghost
            // the row shows in a lighter font beyond what's typed.
            const ghostFor = (r) => {
                const cyc = rowCells(r);                              // phrase r's length in cells
                const patFF = patAgg === "varies" ? "" : patAgg;
                const abFF = abAgg === "varies" ? "" : abAgg;
                const resolved = fillForwardPhrases(patFF, r + 1, abFF)[r] || "";
                let cells = resolved.replace(/\|/g, "");
                if (cells === "" || !(cyc > 0)) return "";
                const rem = cells.length % bpbForBars;
                if (rem !== 0) cells += ".".repeat(bpbForBars - rem);   // pad to a whole measure
                let out = "";
                for (let i = 0; i < cyc; i++) {
                    out += cells[i % cells.length];
                    if ((i + 1) % bpbForBars === 0) out += "|";
                }
                return out;
            };

            const box = document.createElement("div");
            box.className = "insp-phrase-box" + (active ? "" : " disabled");
            /** @type {Array<{field: any, highlight: Element|null, playout: string, numberEl: HTMLElement}>} */
            const phraseFields = [];
            // Up/Down move the caret between phrase rows (the field commits first).
            const moveRow = (r, delta) => {
                const next = phraseFields[r + delta];
                if (next) next.field.focus();
            };
            for (let r = 0; r < phrasesNum; r++) {
                const row = document.createElement("div");
                row.className = "insp-phrase-row";
                const numEl = document.createElement("div");
                numEl.className = "insp-phrase-num";
                numEl.textContent = String(r + 1);
                row.appendChild(numEl);
                const ghost = ghostFor(r);
                const field = this._buildBeatStringField({
                    value: seg(patAgg, r, abAgg),
                    width: W.repeatField,
                    editable: active,
                    fixedGrid: true,
                    cellsPerBar: bpbForBars,
                    maxCells: rowCells(r),
                    allowEmpty: r > 0,
                    kind: "pattern",
                    ghost,
                    editKind: `setPhrasePattern:${r}`,   // unique per row (focus restore)
                    onCommit: (v) => this._emitEdit({ kind: "setPhrasePattern", value: v, index: r }),
                    onArrowTab: (delta) => moveRow(r, delta),
                    ariaLabel: `Phrase ${r + 1} Beat Pattern`,
                });
                const wrap = wrapBeatField(field);
                row.appendChild(wrap);
                box.appendChild(row);
                phraseFields.push({ field, highlight: wrap.querySelector(".insp-beat-hl"), playout: ghost, numberEl: numEl });
            }
            // "Active Beats" label in front of the phrase box.
            const abRow = mkRow();
            abRow.classList.add("insp-phrase-ab-row");
            abRow.appendChild(mkLabel("Active Beats", { width: W.beatStrengthLabel, disabled: !active }));
            abRow.appendChild(box);

            // Beat Strength: ONE field; repeats across every phrase. Gets the same
            // stepping highlight box while playing.
            const sRow = mkRow();
            sRow.classList.add("insp-phrase-strength-row");
            sRow.appendChild(mkLabel("Beat Strength", { width: W.beatStrengthLabel, disabled: !active }));
            const strField = this._buildBeatStringField({
                value: stAgg === "varies" ? "" : stAgg,
                width: W.repeatField,
                editable: active,
                beatsPerBar: bpbForBars,
                kind: "strength",
                editKind: "setStrength",
                ariaLabel: "Beat Strength",
            });
            const strWrap = wrapBeatField(strField);
            sRow.appendChild(strWrap);

            // Both rows carry the same-width label, so the Active Beats box and the
            // Beat Strength field share a left edge (vertically aligned).
            band.appendChild(abRow);
            band.appendChild(sRow);

            // Playing-beat highlight wiring (single beat-points object only). main.js
            // calls setBeatHighlight each frame with the global beat index; the box
            // steps the PLAYING phrase's row (over its full play-out, ghost included),
            // that row's number lights up, and the strength box cycles in step.
            if (single) {
                this._phraseFields = phraseFields;
                this._activeBeatsObjectId = bpObjs[0].id;
                this._beatStrengthField = strField;
                this._beatStrengthHighlight = strWrap.querySelector(".insp-beat-hl");
            }
        } else if (gridMode) {
            // Euclidean / Auto: the GENERATED Active Beats shown READ-ONLY in the same
            // phrase box as Manual — one row per phrase, every phrase identical for now
            // (the generated pattern is considered to repeat each phrase) — plus a
            // single Beat Strength field below. Mirrors the Manual layout; the playing-
            // beat box steps the sounding phrase's row and lights its number.
            const single = bpObjs.length === 1 && typeof bpObjs[0].id === "string";
            const phrasesNum = (() => {
                const n = Number(aggregateString(bpObjs, "phrases"));
                return (Number.isFinite(n) && n >= 1) ? Math.min(8, Math.floor(n)) : 1;
            })();
            const activeBeatsAgg = aggregateString(bpObjs, "activeBeats");
            const strengthAgg = aggregateString(bpObjs, "strength");
            // Barize the generated pattern (a bar divider every cells-per-bar) so the
            // rows read like the Manual box.
            const barize = (s) => {
                const cells = (typeof s === "string" ? s : "").replace(/\|/g, "");
                let out = "";
                for (let i = 0; i < cells.length; i++) {
                    out += cells[i];
                    if ((i + 1) % bpbForBars === 0) out += "|";
                }
                return out;
            };
            const genValue = barize(activeBeatsAgg === "varies" ? "" : activeBeatsAgg);

            const box = document.createElement("div");
            box.className = "insp-phrase-box" + (active ? "" : " disabled");
            /** @type {Array<{field: any, highlight: Element|null, playout: string, numberEl: HTMLElement}>} */
            const phraseFields = [];
            // Up/Down move the caret between rows (every row edits the same generated
            // Active Beats, so they all show any ratchet).
            const moveRow = (r, delta) => {
                const next = phraseFields[r + delta];
                if (next) next.field.focus();
            };
            for (let r = 0; r < phrasesNum; r++) {
                const row = document.createElement("div");
                row.className = "insp-phrase-row";
                const numEl = document.createElement("div");
                numEl.className = "insp-phrase-num";
                numEl.textContent = String(r + 1);
                row.appendChild(numEl);
                // ratchetOnly: the generated structure is read-only; only typing 2–9
                // on an active beat (or x to revert) edits it. Commits the whole
                // pattern back to the single generated Active Beats (shown in every
                // row). The ratchet survives until count/shift/measures regenerate.
                const field = this._buildBeatStringField({
                    value: genValue,
                    width: W.repeatField,
                    editable: active,
                    fixedGrid: true,
                    ratchetOnly: true,
                    cellsPerBar: bpbForBars,
                    maxCells: cycleDur,
                    kind: "pattern",
                    editKind: `euclidPattern:${r}`,
                    onCommit: (v) => this._emitEdit({ kind: "setActiveBeats", value: v }),
                    onArrowTab: (delta) => moveRow(r, delta),
                    ariaLabel: `Phrase ${r + 1} Active Beats`,
                });
                const wrap = wrapBeatField(field);
                row.appendChild(wrap);
                box.appendChild(row);
                phraseFields.push({ field, highlight: wrap.querySelector(".insp-beat-hl"), playout: "", numberEl: numEl });
            }

            const abRow = mkRow();
            abRow.classList.add("insp-phrase-ab-row");
            abRow.appendChild(mkLabel("Active Beats", { width: W.beatStrengthLabel, disabled: !active }));
            abRow.appendChild(box);

            const sRow = mkRow();
            sRow.classList.add("insp-phrase-strength-row");
            sRow.appendChild(mkLabel("Beat Strength", { width: W.beatStrengthLabel, disabled: !active }));
            const stField = this._buildBeatStringField({
                value: strengthAgg === "varies" ? "" : strengthAgg,
                width: W.repeatField,
                editable: active,
                locked: mode === "auto",
                beatsPerBar: bpbForBars, kind: "strength",
                editKind: "setStrength", ariaLabel: "Beat Strength",
            });
            const stWrap = wrapBeatField(stField);
            sRow.appendChild(stWrap);

            band.appendChild(abRow);
            band.appendChild(sRow);

            if (single) {
                this._phraseFields = phraseFields;
                this._activeBeatsObjectId = bpObjs[0].id;
                this._beatStrengthField = stField;
                this._beatStrengthHighlight = stWrap.querySelector(".insp-beat-hl");
            }
        }

        // Chart-mirror editor (Harmony-driven): the loaded chart's measures laid out
        // like the Harmony tab — rows of measures — where each ROW is ONE Manual-style
        // beat field (caret flows across, typing carries into the next measure, pipes
        // divide the bars). Storage is PER ROW: a row's pattern loops to fill its bars
        // and fills forward to the next row. The object plays the chart's UNFOLDED
        // timeline, mapping each played bar onto its row's pattern. (Variable bar
        // widths for mid-tune meter changes, per-group unfold, and the played-bar
        // highlight are the remaining pieces.)
        if (chartMode) {
            const single = bpObjs.length === 1 && typeof bpObjs[0].id === "string";
            /** @type {Array<{field: any, highlight: Element | null, playout: string}>} */
            const phraseFields = [];   // one per row, for the playing-beat highlight
            /** @type {HTMLElement[]} per-measure segments (reading order) for the
             * practice-loop drag and the measure SELECTION (drag-select + Delete). */
            this._loopSegs = [];
            // Measure selection (text-like, row-major run): a [startIdx, endIdx]
            // into _loopSegs, or null. Rebuilt each render, so drop a stale one.
            this._mselRange = null;
            // Anchor measure (the last plain click / caret) a shift-click extends
            // from. Kept across renders so a shift-click after a re-run still works.
            if (!Number.isFinite(this._mselAnchor)) this._mselAnchor = null;
            // Bind the Delete-to-clear key handler once.
            if (!this._mselKeyBound) {
                document.addEventListener("keydown", (e) => this._onMselKey(e));
                this._mselKeyBound = true;
            }

            // (The practice-loop button was built up on the Pattern Type row and is
            // wired below, once the measure box + segments exist.)

            const abRow = mkRow();
            abRow.appendChild(mkLabel("Active Beats", { width: W.beatStrengthLabel, disabled: !active }));
            const box = document.createElement("div");
            box.className = "insp-phrase-box" + (active ? "" : " disabled");

            if (chartHarmony === null) {
                const hint = document.createElement("div");
                hint.style.padding = "4px 8px";
                hint.style.opacity = "0.7";
                hint.style.fontSize = "11px";
                hint.textContent = (bpObjs.length !== 1)
                    ? "Select a single object to edit its chart rhythm."
                    : "Load a chord chart in the Chord Chart tab — its measures appear here to fill in.";
                box.appendChild(hint);
            } else {
                const ts = Array.isArray(this._scene.timeSignature) ? this._scene.timeSignature : [masterBeats, 4];
                const allBars = layoutChart(chartHarmony.progression, chartHarmony.key, "letter", ts);
                // Scope the grid. ASSIGNED → its label's FIRST occurrence (later
                // occurrences re-trace this same pattern). UNASSIGNED, when other
                // objects are assigned → all the active sections concatenated (so
                // beats can be authored per section). Else → the whole chart.
                const secLabel = single ? sectionLabelFor(allBars, bpObjs[0].chartSection) : null;
                const secRanges = secLabel ? rangesForLabel(allBars, secLabel) : [];
                const range = secRanges.length > 0 ? secRanges[0] : null;
                let bars;
                if (range) {
                    bars = allBars.slice(Math.max(0, range[0]), Math.min(allBars.length - 1, range[1]) + 1);
                } else if (single) {
                    const assigned = new Set();
                    for (const arr of [this._scene.curves, this._scene.sprites, this._scene.triggers]) {
                        for (const c of (Array.isArray(arr) ? arr : [])) {
                            if (c && c.beatPointsMode === "chart") {
                                const l = sectionLabelFor(allBars, c.chartSection);
                                if (l) assigned.add(l);
                            }
                        }
                    }
                    bars = [];
                    const seen = new Set();
                    for (const s of chartSections(allBars)) {
                        if (assigned.has(s.label) && !seen.has(s.label)) {
                            seen.add(s.label);
                            for (let i = s.range[0]; i <= s.range[1]; i += 1) bars.push(allBars[i]);
                        }
                    }
                    if (bars.length === 0) bars = allBars;     // nothing assigned → whole chart
                } else {
                    bars = allBars;
                }
                const rows = groupRows(bars, 4);
                const patAgg = aggregateString(bpObjs, "phrasePatterns");
                const abAgg = aggregateString(bpObjs, "activeBeats");
                const patFF = patAgg === "varies" ? "" : patAgg;
                const abFF = abAgg === "varies" ? "" : abAgg;
                const parts = patFF !== "" ? patFF.split(",") : [];
                // Row r's TYPED pattern (row 0 falls back to the legacy activeBeats).
                const seg = (r) => {
                    const v = (r < parts.length) ? parts[r] : "";
                    return (v === "" && r === 0) ? abFF : v;
                };
                // Bars in each row (excluding alignment padding) → its cell length.
                const rowBars = rows.map((row) => row.filter((c) => !(c && c.empty === true)).length);
                // The displayed grid starts at this ABSOLUTE folded bar (the section's
                // first bar, or 0 for the whole form) — so a loop range maps back to
                // the whole chart's bars for the form-clock window.
                const absBase = range ? Math.max(0, range[0]) : 0;
                // Running count of bars before each row, to number measures across rows.
                let barsBefore = 0;
                // Row r's RESOLVED play-out: its own (or inherited) pattern looped to the
                // row's cells, barized — the ghost the row shows beyond what's typed. When
                // NOTHING is defined yet it falls back to RESTS, so the empty measure grid
                // (dots + bar lines, full width) is always visible — the structure shows
                // before any beats are typed.
                const ghostFor = (r) => {
                    const resolved = fillForwardPhrases(patFF, r + 1, abFF)[r] || "";
                    let cells = resolved.replace(/\|/g, "");
                    const total = Math.max(bpbForBars, rowBars[r] * bpbForBars);
                    if (total <= 0) return "";
                    if (cells === "") cells = ".";          // empty → show the rest grid
                    const rem = cells.length % bpbForBars;
                    if (rem !== 0) cells += ".".repeat(bpbForBars - rem);
                    let out = "";
                    for (let i = 0; i < total; i += 1) {
                        out += cells[i % cells.length];
                        if ((i + 1) % bpbForBars === 0) out += "|";
                    }
                    return out;
                };
                for (let r = 0; r < rows.length; r += 1) {
                    const rowEl = document.createElement("div");
                    rowEl.className = "insp-phrase-row";
                    const total = Math.max(bpbForBars, rowBars[r] * bpbForBars);
                    const playout = ghostFor(r);          // full row play-out (positions the highlight)
                    const field = this._buildBeatStringField({
                        value: seg(r),
                        width: 0,                         // real width set below to fit the row
                        editable: active,
                        fixedGrid: true,
                        cellsPerBar: bpbForBars,
                        maxCells: total,
                        allowEmpty: true,                 // empty rows show the grid (ghost), not a default beat
                        kind: "pattern",
                        ghost: playout,
                        editKind: `setPhrasePattern:${r}`,
                        onCommit: (v) => this._emitEdit({ kind: "setPhrasePattern", value: v, index: r }),
                        ariaLabel: `Row ${r + 1} beat pattern`,
                    });
                    // Fit the whole row: its cells + one bar line each + the field padding.
                    // Size BOTH the input and its ghost overlay (which defaults to the
                    // passed width=0), so an un-typed row's ghosted grid isn't clipped.
                    const rowW = `calc(${total + rowBars[r] + 1}ch + 14px)`;
                    field.style.width = rowW;
                    if (field._ghostEl) field._ghostEl.style.width = rowW;
                    const wrap = wrapBeatField(field);
                    rowEl.appendChild(wrap);
                    // Per-measure overlay: one segment per measure, over the field.
                    // These are the hit-test targets for measure selection and carry
                    // the olive loop highlight; each holds its ABSOLUTE folded bar
                    // plus its row/col for clearing. The segments themselves are
                    // pointer-transparent — the box catches the drag.
                    const overlay = document.createElement("div");
                    overlay.className = "insp-loop-overlay";
                    for (let m = 0; m < rowBars[r]; m += 1) {
                        const seg = document.createElement("div");
                        seg.className = "insp-loop-seg";
                        // The field inside the box has no border, so its cells start
                        // at 11px (5px field margin + 6px padding).
                        seg.style.left = `calc(11px + ${m * (bpbForBars + 1)}ch)`;
                        seg.style.width = `${bpbForBars}ch`;
                        seg.dataset.bar = String(absBase + barsBefore + m);
                        seg.dataset.row = String(r);     // for measure-selection clear
                        seg.dataset.col = String(m);
                        overlay.appendChild(seg);
                        this._loopSegs.push(seg);
                    }
                    rowEl.appendChild(overlay);
                    box.appendChild(rowEl);
                    phraseFields.push({ field, highlight: wrap.querySelector(".insp-beat-hl"), playout });
                    barsBefore += rowBars[r];
                }
            }
            abRow.appendChild(box);
            band.appendChild(abRow);

            // Wire the practice-loop tool now the box + segments exist. Pressing it
            // loops the current measure selection (replacing any active loop) and
            // consumes the selection; with nothing selected it clears the loop.
            if (loopBtn !== null) {
                this._loopBox = box;
                loopBtn.addEventListener("click", () => {
                    const bars = this._selectionBarRange();
                    if (bars !== null) {               // selection → loop it
                        this._loopRange = bars;
                        this._emitEdit({ kind: "setPracticeLoop", range: [bars[0], bars[1]] });
                        this._mselRange = null;        // the selection becomes the loop
                        this._paintMsel();
                    } else if (Array.isArray(this._loopRange)) {  // nothing selected → clear
                        this._loopRange = null;
                        this._emitEdit({ kind: "clearPracticeLoop" });
                    }
                    const on = Array.isArray(this._loopRange);
                    loopBtn.classList.toggle("active", on);
                    loopBtn.setAttribute("aria-pressed", on ? "true" : "false");
                    this._paintLoopSegs();
                });
                this._paintLoopSegs();                 // reflect any existing loop
            }

            // Measure SELECTION drag (text-like, row-major). When the loop tool is
            // NOT armed, dragging across the measures selects a contiguous run
            // (down a row → to its end → on into the next row); a plain click
            // clears the selection and falls through to the field for the caret.
            // Delete/Backspace then blanks the selected measures' beats.
            if (active) box.addEventListener("mousedown", (e) => this._onMselDown(e, box));

            // Beat Strength — one field, looped across every bar (as in Manual mode).
            const sRow = mkRow();
            sRow.appendChild(mkLabel("Beat Strength", { width: W.beatStrengthLabel, disabled: !active }));
            const stAgg = aggregateString(bpObjs, "strength");
            const strField = this._buildBeatStringField({
                value: stAgg === "varies" ? "" : stAgg,
                width: W.repeatField,
                editable: active,
                beatsPerBar: bpbForBars,
                kind: "strength",
                editKind: "setStrength",
                ariaLabel: "Beat Strength",
            });
            const strWrap = wrapBeatField(strField);
            sRow.appendChild(strWrap);
            band.appendChild(sRow);

            // Playing-beat highlight (single object, chart loaded): the white box steps
            // through the PLAYED (unfolded) timeline, mapping each played bar back to its
            // folded ROW + cell, so it cycles through a repeated group as the cursor
            // advances — like the chord-chart cursor. setBeatHighlight reads this map.
            if (single && chartHarmony !== null) {
                this._phraseFields = phraseFields;
                this._activeBeatsObjectId = bpObjs[0].id;
                this._beatStrengthField = strField;
                this._beatStrengthHighlight = strWrap.querySelector(".insp-beat-hl");
                const o = bpObjs[0];
                this._chartHl = {
                    seq: Array.isArray(o.chartBarSeq) ? o.chartBarSeq : [],
                    row: Array.isArray(o.chartBarRow) ? o.chartBarRow : [],
                    pos: Array.isArray(o.chartBarPos) ? o.chartBarPos : [],
                    cpb: Math.max(1, Math.floor(Number(bpbForBars)) || 1),
                };
            } else {
                this._activeBeatsObjectId = null;
            }

            // Readout of what's being followed.
            if (chartHarmony !== null) {
                const fc = Number(bpObjs[0].foldedBarCount) || 0;
                const played = Array.isArray(bpObjs[0].chartBarSeq) ? bpObjs[0].chartBarSeq.length : 0;
                const note = mkRow();
                const n = document.createElement("div");
                n.style.opacity = "0.7";
                n.style.fontSize = "11px";
                n.textContent = `Following chart — ${fc} measure${fc === 1 ? "" : "s"}`
                    + (played && played !== fc ? `, ${played} played (repeats unfolded).` : ".");
                note.appendChild(n);
                band.appendChild(note);
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
            // Lay the measures in rows of four, each row its own flex line, so the
            // boxes stay snug (no last-box stretch) and the field never spreads
            // into one long row when the pane is widened. A horizontal rule
            // separates consecutive rows; same-row gaps get the bar divider.
            const PER_ROW = 4;
            let rowEl = null;
            for (let i = 0; i < M; i++) {
                if (i % PER_ROW === 0) {
                    if (i > 0) {
                        const sep = document.createElement("div");
                        sep.className = "insp-measure-rowsep";
                        fieldEl.appendChild(sep);
                    }
                    rowEl = document.createElement("div");
                    rowEl.className = "insp-measure-row";
                    fieldEl.appendChild(rowEl);
                } else {
                    const divider = document.createElement("span");
                    divider.className = "insp-measure-divider";
                    rowEl.appendChild(divider);
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
                rowEl.appendChild(cell);
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

        // Bottom row — cursor-cycle controls relocated from the removed Timing
        // band: Cycle Speeds (curves/sprites) and Time Lag In Object (universal,
        // multiplier × interval). Start/Stop at Cycle and Trigger Sync were
        // dropped for now; their data fields stay in the model (may return).
        const speedsAgg = aggregateString(bpObjs, "cycleSpeeds");
        const allObjs = [...objs.curves, ...objs.triggers, ...objs.sprites];
        const anySelected = ctx.total > 0;
        const timeLagMultAgg = aggregateString(allObjs, "timeLagMultiplier");
        const timeLagIntervalAgg = aggregateString(allObjs, "timeLagInterval");
        const timeLagIntervalValue =
            (timeLagIntervalAgg === "varies" || timeLagIntervalAgg === "")
                ? "" : timeLagIntervalAgg;

        const rCycle = mkRow();
        rCycle.classList.add("insp-cyclespeeds-row");
        rCycle.appendChild(mkLabel("Cycle\nSpeeds", { width: W.beatStackLabel, disabled: !active, multiline: true }));
        rCycle.appendChild(this._buildEditableField({
            value: speedsAgg === "varies" ? "" : speedsAgg,
            width: W.cycleSpeedsShort,
            editable: active,
            validator: validateCycleSpeeds,
            editKind: "setCycleSpeeds",
            selectOnFocus: false,
        }));
        const timeLagLabel = mkLabel("Time Lag", { width: W.timeLagLabel, disabled: !anySelected });
        timeLagLabel.style.marginLeft = "12px";
        rCycle.appendChild(timeLagLabel);
        rCycle.appendChild(this._buildEditableField({
            value: timeLagMultAgg === "varies" ? "" : timeLagMultAgg,
            numeric: true,
            width: W.timeLagMult,
            editable: anySelected,
            validator: (c) => validateNumber(c, { min: 0 }),
            editKind: "setTimeLagMultiplier",
            spinStep: 1,
            selectOnFocus: false,
        }));
        rCycle.appendChild(mkInlineLetter("x", { disabled: !anySelected }));
        rCycle.appendChild(this._buildDropdownField({
            options: INTERVAL_OPTIONS,
            value: timeLagIntervalValue,
            width: W.timeLagInterval,
            editable: anySelected,
            editKind: "setTimeLagInterval",
        }));
        band.appendChild(rCycle);

        return band;
    },

    /**
     * Canvas to Sound Drivers band — one row per sound parameter the canvas can
     * drive, each a channel dropdown plus a None..Full depth slider (how strongly
     * that channel influences this object). This milestone wires Beat strength and
     * Drop (likelihood of beat); Note velocity, Sustain, Pan and Bend follow in
     * later milestones. The depth scales the per-beat swing / drop digits before
     * they are evaluated. See design/canvas-to-sound-drivers.md.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCanvasDrivers(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        band.appendChild(mkBandHeader("Canvas to Sound Drivers"));

        const objs = selectedObjects(this._scene, this._activeSelection);
        const bpObjs = [...objs.curves, ...objs.sprites];
        const active = ctx.hasCurves || ctx.hasSprites;
        // Beatbox voices are one-shot drums with no sustain (the sample plays its
        // own length), so the Sustain row greys for an all-beatbox selection. The
        // other rows — including Note Velocity, which now also shapes a drum's
        // loudness — stay live.
        const beatboxOnly = aggregateVoiceField(bpObjs, "superdough", "source") === "beatbox";

        // A 0..1 depth aggregate → slider value; default Full (1) when the
        // selection is empty or its depths vary (no blank state on a range input).
        const depthValue = (agg) => {
            const n = Number(agg);
            return (agg === "varies" || agg === "" || !Number.isFinite(n)) ? 1 : n;
        };

        // One driver row: right-aligned label, channel dropdown, then depth slider.
        // rowActive lets a row grey independently (e.g. Sustain for beatbox).
        const driverRow = (labelText, channelField, channelKind, depthField, depthKind, rowActive = active) => {
            const row = mkRow();
            row.appendChild(mkLabel(labelText, { width: W.beatStackLabel, disabled: !rowActive, multiline: true }));
            const chanAgg = aggregateString(bpObjs, channelField);
            row.appendChild(this._buildDropdownField({
                options: STRENGTH_CHANNEL_OPTIONS,
                value: chanAgg === "varies" ? "" : chanAgg,
                width: 84,
                editable: rowActive,
                editKind: channelKind,
            }));
            const slider = this._buildSliderField({
                value: depthValue(aggregateString(bpObjs, depthField)),
                editable: rowActive,
                editKind: depthKind,
            });
            slider.style.marginLeft = "10px";
            row.appendChild(slider);
            band.appendChild(row);
        };

        driverRow("Beat\nStrength", "strengthChannel", "setStrengthChannel", "strengthDepth", "setStrengthDepth");
        driverRow("Drop", "dropChannel", "setDropChannel", "dropDepth", "setDropDepth");
        driverRow("Note\nVelocity", "velocityChannel", "setVelocityChannel", "velocityDepth", "setVelocityDepth");
        driverRow("Sustain", "durationChannel", "setDurationChannel", "durationDepth", "setDurationDepth", active && !beatboxOnly);

        // Pan — its own mode dropdown (not a channel) plus a depth slider.
        const panRow = mkRow();
        panRow.appendChild(mkLabel("Pan", { width: W.beatStackLabel, disabled: !active, multiline: true }));
        const panModeAgg = aggregateString(bpObjs, "panMode");
        panRow.appendChild(this._buildDropdownField({
            options: PAN_MODE_OPTIONS,
            value: panModeAgg === "varies" ? "" : panModeAgg,
            width: 84,
            editable: active,
            editKind: "setPanMode",
        }));
        const panSlider = this._buildSliderField({
            value: depthValue(aggregateString(bpObjs, "panDepth")),
            editable: active,
            editKind: "setPanDepth",
        });
        panSlider.style.marginLeft = "10px";
        panRow.appendChild(panSlider);
        band.appendChild(panRow);

        // Bend — reserved placeholder (TBD), greyed: label + disabled stub controls
        // so the band's shape is settled.
        const bendRow = mkRow();
        bendRow.appendChild(mkLabel("Bend", { width: W.beatStackLabel, disabled: true, multiline: true }));
        bendRow.appendChild(this._buildDropdownField({
            options: [{ value: "", label: "—" }],
            value: "",
            width: 84,
            editable: false,
            editKind: "setBend",
        }));
        const bendSlider = this._buildSliderField({ value: 0, editable: false, editKind: "setBend" });
        bendSlider.style.marginLeft = "10px";
        bendRow.appendChild(bendSlider);
        band.appendChild(bendRow);

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

    // --- Practice-loop drag-select (Harmony-driven beat editor) ---

    /**
     * Mouse-down on a measure segment while the loop tool is armed: begin a
     * drag, anchoring the range at this bar. Document listeners extend it.
     * @param {MouseEvent} e
     * @param {HTMLElement} seg
     */
    /** The current measure selection as a folded-bar range [lo, hi], or null when
     *  nothing is selected. The selection is contiguous in reading order, so its
     *  bars are too — take the min/max of the selected segments' bars. */
    _selectionBarRange() {
        const segs = Array.isArray(this._loopSegs) ? this._loopSegs : [];
        const r = this._mselRange;
        if (!Array.isArray(r)) return null;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = r[0]; i <= r[1] && i < segs.length; i += 1) {
            const b = Number(segs[i].dataset.bar);
            if (!Number.isFinite(b)) continue;
            if (b < lo) lo = b;
            if (b > hi) hi = b;
        }
        return lo <= hi ? [lo, hi] : null;
    },

    /** Paint the olive highlight on every segment whose bar is in the loop range. */
    _paintLoopSegs() {
        const segs = Array.isArray(this._loopSegs) ? this._loopSegs : [];
        const r = Array.isArray(this._loopRange) ? this._loopRange : null;
        for (const seg of segs) {
            const bar = Number(seg.dataset.bar);
            const on = r !== null && bar >= r[0] && bar <= r[1];
            seg.classList.toggle("selected", on);
        }
    },

    // --- Measure selection (drag-select + Delete) — chart-mirror editor ---

    /** The selectable measure nearest a viewport point: its index into _loopSegs
     *  (reading order), row-first then horizontal. -1 when there are no segments. */
    _mselHitTest(clientX, clientY) {
        const segs = Array.isArray(this._loopSegs) ? this._loopSegs : [];
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < segs.length; i += 1) {
            const r = segs[i].getBoundingClientRect();
            const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
            const dx = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
            const score = dy * 10000 + dx;     // row dominates, then x within it
            if (score < bestScore) { bestScore = score; best = i; }
        }
        return best;
    },

    /** Paint the measure-selection highlight over the segments in _mselRange. */
    _paintMsel() {
        const segs = Array.isArray(this._loopSegs) ? this._loopSegs : [];
        const r = Array.isArray(this._mselRange) ? this._mselRange : null;
        for (let i = 0; i < segs.length; i += 1) {
            segs[i].classList.toggle("msel", r !== null && i >= r[0] && i <= r[1]);
        }
    },

    /**
     * Mouse-down in the chart-mirror box: a drag selects a contiguous, text-like
     * run of measures across rows; a plain click clears the selection and leaves
     * the underlying field to place the caret. The selection then feeds both
     * Delete (blank measures) and the Loop button (loop the span).
     * @param {MouseEvent} e
     * @param {HTMLElement} box
     */
    _onMselDown(e, box) {
        const idx = this._mselHitTest(e.clientX, e.clientY);
        if (idx < 0) return;
        // Shift-click EXTENDS the run from the anchor (the last plain click / caret)
        // to here — no drag, no native text selection. Delete then acts on it.
        if (e.shiftKey) {
            e.preventDefault();
            const a = Number.isFinite(this._mselAnchor) ? this._mselAnchor : idx;
            this._mselRange = [Math.min(a, idx), Math.max(a, idx)];
            this._paintMsel();
            const fae = document.activeElement;
            if (fae && typeof (/** @type {any} */ (fae).blur) === "function") (/** @type {any} */ (fae)).blur();
            return;
        }
        // A fresh plain click → this measure becomes the anchor for a later
        // shift-click (the click also drops the text caret here for typing).
        this._mselAnchor = idx;
        const anchor = idx;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        const move = (ev) => {
            if (!dragging) {
                if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
                dragging = true;
                // Take over from native text selection.
                const ae = document.activeElement;
                if (ae && typeof (/** @type {any} */ (ae).blur) === "function") (/** @type {any} */ (ae)).blur();
                const sel = window.getSelection && window.getSelection();
                if (sel && sel.removeAllRanges) sel.removeAllRanges();
                box.classList.add("msel-dragging");    // suppress text selection while dragging
            }
            const cur = this._mselHitTest(ev.clientX, ev.clientY);
            if (cur < 0) return;
            this._mselRange = [Math.min(anchor, cur), Math.max(anchor, cur)];
            this._paintMsel();
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            box.classList.remove("msel-dragging");
            if (!dragging) {                            // a click → clear, let the field take the caret
                this._mselRange = null;
                this._paintMsel();
            }
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    },

    /** Delete/Backspace with a measure selection (and not typing) blanks the
     *  selected measures' beats. */
    _onMselKey(e) {
        if (!Array.isArray(this._mselRange)) return;
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;   // typing
        e.preventDefault();
        this._clearSelectedMeasures();
    },

    /** Clear every selected measure to BLANK (not rest-dots), one setPhrasePattern
     *  edit per affected row. Blank measures let the ghost/fill show through: a
     *  shorter row value loops its earlier pattern across the cleared tail, and a
     *  fully cleared row inherits the row above — rest-dots ("....") would instead
     *  pin explicit silence and block both. */
    _clearSelectedMeasures() {
        const segs = Array.isArray(this._loopSegs) ? this._loopSegs : [];
        const range = this._mselRange;
        const fields = Array.isArray(this._phraseFields) ? this._phraseFields : [];
        if (!Array.isArray(range)) return;
        /** @type {Map<number, Set<number>>} row → cols to clear */
        const byRow = new Map();
        for (let i = range[0]; i <= range[1] && i < segs.length; i += 1) {
            const row = Number(segs[i].dataset.row);
            const col = Number(segs[i].dataset.col);
            if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
            if (!byRow.has(row)) byRow.set(row, new Set());
            byRow.get(row).add(col);
        }
        for (const [row, cols] of byRow) {
            const f = fields[row] && fields[row].field;
            if (!f) continue;
            const measures = String(f.value || "").split("|");
            const maxCol = Math.max(...cols);
            while (measures.length <= maxCol) measures.push("");   // pad with blanks, not dots
            for (const c of cols) measures[c] = "";                // clear to blank → ghost shows through
            // Drop trailing blanks so the row value is the shortest form that
            // ghosts the tail (and an all-cleared row becomes "" → inherits above).
            while (measures.length > 0 && measures[measures.length - 1] === "") measures.pop();
            this._emitEdit({ kind: "setPhrasePattern", value: measures.join("|"), index: row });
        }
        this._mselRange = null;
        this._paintMsel();
    },
};
