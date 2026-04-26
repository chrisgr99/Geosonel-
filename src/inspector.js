/**
 * Property Inspector module.
 *
 * Renders the form-based property inspector that lives in the
 * Properties tab. Driven by the canvas selection model: when
 * nothing is selected, the inspector area above the (deferred)
 * global section is entirely blank, matching GeoSonix's
 * convention. When at least one object is selected, all six
 * bands appear, with fields greyed according to which kinds
 * are present in the selection.
 *
 * Layout is sized by the constraint rows — the Auto Message
 * Interval row (band 4) and the Cycle Parameters row 2 (band
 * 6) hold the most fields and effectively set the minimum
 * form width. Every other row fits within that width with
 * room to spare. This matches the GeoSonix authoring
 * convention.
 *
 * v1 scope: layout and selection-driven greying. Field values
 * are placeholders — the next milestone wires real values
 * from scene.json into the form. The Inspector exposes
 * setSelection(); main.js calls it from the canvas's
 * selectionChanged event.
 *
 * Six bands above the (deferred) harmony / global area:
 *   1. Identity (id, name, enable, hide)
 *   2. Geometry / visual (position, curve size, cursor size,
 *      sprite/trigger size, color)
 *   3. Message functions (two function-binding rows with
 *      Create buttons; labels change by kind: Step/Auto for
 *      sprite, Collision/Auto for trigger, Beat/Sweep for
 *      curve)
 *   4. Auto message interval (curve, trigger, sprite columns)
 *   5. Beat points (curve beat-point generator, active beats
 *      string, strength string) — curves only
 *   6. Cycle parameters (cycle speeds, stop, cursor speed,
 *      cycle time, time lock, sync-to-beat) — curves only
 *
 * Greying rules:
 *   - Universal fields (position, color, enable, hide) are
 *     active for any non-empty selection.
 *   - id and name are active only for single-object selections;
 *     greyed for multi-select since they're per-object unique.
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

// Width constants. Centralised so layout adjustments touch
// one set of numbers, not scattered inline styles. The
// constraint rows (band 4 AMI, band 6 cycle params row 2)
// drive these — every other row fits within the natural
// width those rows produce.
const W = {
    // Left-edge label column. Wide enough for "Cursor Speed"
    // and "Curve Beat Points" at 10pt; everything narrower
    // gets the same width so the label column aligns down
    // the entire form.
    leftLabel: 78,

    // ID field — short numeric/identifier. Eventually holds
    // generated IDs like "sp_a3f7"; 80px fits that comfortably.
    idField: 80,

    // Inline labels next to the row's leftmost field group,
    // sized to the shortest text that fits at 10pt.
    enable: 50,        // "Enable"
    hide: 36,          // "Hide"
    amiCurve: 32,      // "Curve" in AMI row
    amiTrigger: 42,    // "Trigger"
    amiSprite: 36,     // "Sprite"
    curveThick: 60,    // "Curve\nThickness" multiline
    cursorThick: 60,   // "Cursor\nThickness" multiline
    stopAt: 50,        // "Stop at\nCycle" multiline
    cycleTime: 36,     // "Cycle\nTime" multiline
    timeLock: 32,      // "Time\nLock" multiline
    triggerSync: 78,   // "Trigger Sync\nTo Beat" multiline

    // Numeric fields.
    posXY: 60,         // Position X, Y
    sizeWH: 60,        // Curve Size W, H
    cursorRL: 50,      // Cursor R, L
    thickness: 60,     // Curve/Cursor Thickness
    spriteTriggerSize: 60,
    cursorSpeed: 60,
    cycleTimeF: 60,
    stopAtF: 50,

    // Text fields.
    name: 280,
    funcBinding: 200,
    cycleSpeeds: 240,
    rhythmString: 320, // Active Beats / Beat Strength

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

        const ctx = buildSelectionContext(this._selection);
        if (ctx.total === 0) {
            // Nothing selected: leave the inspector area blank.
            // The (deferred) global section will appear at the
            // bottom of the area when implemented.
            return;
        }

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
     * Title bar. Single-select: "{Kind} {index}" (eventually
     * "{Kind} {name}" when scene.json has names). Multi-select:
     * the selection breakdown like "1 trigger, 2 sprites" on
     * the upper left, right side reserved.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildTitleBar(ctx) {
        const bar = document.createElement("div");
        bar.className = "insp-title-bar";

        const left = document.createElement("div");
        left.className = "insp-title-left";
        left.textContent = titleTextFor(ctx);
        bar.appendChild(left);

        const right = document.createElement("div");
        right.className = "insp-title-right";
        bar.appendChild(right);

        return bar;
    }

    /**
     * Band 1 — Identity. ID is read-only and greyed for multi-
     * select; Name is editable for single-select and greyed
     * for multi-select; Enable and Hide always editable.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandIdentity(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        // Until scene.json has explicit id and name fields, we
        // surface the array index as a placeholder ID and leave
        // Name blank. The shapes of the fields and the greying
        // rules already match the eventual model.
        const idValue = ctx.isSingle ? String(idOfFirst(ctx)) : "";
        const nameValue = "";
        const idEditable = ctx.isSingle;
        const nameEditable = ctx.isSingle;

        const r1 = mkRow();
        r1.appendChild(mkLabel("Object ID", { width: W.leftLabel, disabled: !idEditable }));
        r1.appendChild(mkField({
            value: idValue,
            style: idEditable ? "locked" : "",
            disabled: !idEditable,
            width: W.idField,
        }));
        r1.appendChild(mkLabel("Enable", { width: W.enable }));
        r1.appendChild(mkCheckbox({ checked: true }));
        r1.appendChild(mkLabel("Hide", { width: W.hide }));
        r1.appendChild(mkCheckbox({ checked: false }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Name", { width: W.leftLabel, disabled: !nameEditable }));
        r2.appendChild(mkField({ value: nameValue, disabled: !nameEditable, width: W.name }));
        band.appendChild(r2);

        return band;
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
        r2.appendChild(mkSpacer());
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
        r3.appendChild(mkSpacer());
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
     * Band 5 — Beat points. Curves-only band. Empty fields
     * still render their lighter-grey footprint so the
     * row layout reads as a row of fields even when no curve
     * is in the selection.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandBeatPoints(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        const dis = !ctx.hasCurves;

        const r1 = mkRow();
        r1.appendChild(mkLabel("Curve\nBeat Points", { width: W.leftLabel, disabled: dis, multiline: true }));
        r1.appendChild(mkCombo({ value: "None", width: W.beatPointsCombo, disabled: dis }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Active Beats", { width: W.leftLabel, disabled: dis }));
        r2.appendChild(mkField({ value: "", width: W.rhythmString, disabled: dis }));
        band.appendChild(r2);

        const r3 = mkRow();
        r3.appendChild(mkLabel("Beat Strength", { width: W.leftLabel, disabled: dis }));
        r3.appendChild(mkField({ value: "", width: W.rhythmString, disabled: dis }));
        band.appendChild(r3);

        return band;
    }

    /**
     * Band 6 — Cycle parameters. Curves-only band. Time Lock
     * eventually governs which of cursor speed and cycle time
     * is the authored value and which is derived; v1 just
     * lays out both fields. The second row here is the other
     * constraint row driving form width.
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCycleParams(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";
        const dis = !ctx.hasCurves;

        const r1 = mkRow();
        r1.appendChild(mkLabel("Cycle Speeds", { width: W.leftLabel, disabled: dis }));
        r1.appendChild(mkField({ value: "1", width: W.cycleSpeeds, disabled: dis }));
        r1.appendChild(mkSpacer());
        r1.appendChild(mkLabel("Stop at\nCycle", { width: W.stopAt, disabled: dis, multiline: true }));
        r1.appendChild(mkField({ value: "-1", numeric: true, width: W.stopAtF, disabled: dis }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Cursor Speed", { width: W.leftLabel, disabled: dis }));
        r2.appendChild(mkField({ value: "1.000", numeric: true, width: W.cursorSpeed, disabled: dis }));
        r2.appendChild(mkLabel("Cycle\nTime", { width: W.cycleTime, disabled: dis, multiline: true }));
        r2.appendChild(mkField({ value: "19.09", numeric: true, width: W.cycleTimeF, disabled: dis }));
        r2.appendChild(mkLabel("Time\nLock", { width: W.timeLock, disabled: dis, multiline: true }));
        r2.appendChild(mkCheckbox({ checked: false, disabled: dis }));
        r2.appendChild(mkSpacer());
        r2.appendChild(mkLabel("Trigger Sync\nTo Beat", { width: W.triggerSync, disabled: dis, multiline: true }));
        r2.appendChild(mkCombo({ value: "Off", width: W.triggerSyncCombo, disabled: dis }));
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
 * Build the title-bar text for the current selection.
 * Single: "Sprite 0" / "Trigger 2" / "Curve 1"
 * Multi same kind: "3 sprites"
 * Multi mixed: "1 sprite, 2 triggers, 1 curve"
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 */
function titleTextFor(ctx) {
    if (ctx.isSingle) {
        const kind = ctx.kinds[0];
        const idx = idOfFirst(ctx);
        const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
        return `${cap} ${idx}`;
    }
    const parts = [];
    if (ctx.hasSprites) parts.push(pluralCount(ctx.sprites.length, "sprite"));
    if (ctx.hasTriggers) parts.push(pluralCount(ctx.triggers.length, "trigger"));
    if (ctx.hasCurves) parts.push(pluralCount(ctx.curves.length, "curve"));
    return parts.join(", ");
}

/** @param {ReturnType<typeof buildSelectionContext>} ctx */
function idOfFirst(ctx) {
    if (ctx.sprites.length > 0) return ctx.sprites[0];
    if (ctx.triggers.length > 0) return ctx.triggers[0];
    return ctx.curves[0];
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
 * @param {{ checked?: boolean, disabled?: boolean }} [opts]
 */
function mkCheckbox(opts = {}) {
    const el = document.createElement("div");
    el.className = "insp-checkbox";
    if (opts.checked) el.classList.add("checked");
    if (opts.disabled) el.classList.add("disabled");
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

/**
 * @returns {HTMLDivElement}
 */
function mkSpacer() {
    const el = document.createElement("div");
    el.className = "insp-spacer";
    return el;
}
