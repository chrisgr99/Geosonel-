// @ts-check

/**
 * Property-changes apply pipeline for the composition mirror (Phase 2
 * of the AI canvas-property editing feature).
 *
 * An AI editing through the mirror writes a one-shot `property-changes.json`
 * instruction file describing targeted property edits by object ID, e.g.
 *
 *   { "changes": [ { "object": "CRV4", "set": { "activeBeatsCount": 12 } } ] }
 *
 * The app validates it against the current scene, shows the same
 * confirm-to-apply dialog used for code edits (with a per-field
 * before→after summary in the message area), and on accept applies the
 * changes through the SAME validated inspector setters the Properties
 * panel uses (sceneEditor.js setXxxOnSelection), then rebuilds. Property
 * changes do NOT apply live — a normal scene rebuild follows accept.
 *
 * This module is pure: it maps field keys to setters and reads current
 * values for the diff. It does no I/O and no scene rebuild — the caller
 * (main.js) runs the mutators through applySceneEdit.
 *
 * Field scope: the full inspector field set EXCEPT a few risky ones —
 * object IDs (renaming breaks callback bindings), raw curve/shape
 * geometry arrays (edited on canvas), and the image. Only ABSOLUTE
 * values are accepted; a relative request ("move 2 left") is resolved
 * to its absolute target by the AI before writing the file.
 */

import {
    setNameOnSelection,
    setGroupOnSelection,
    setBeatPointsModeOnSelection,
    setActiveBeatsOnSelection,
    setStrengthOnSelection,
    setBeatPatternOnSelection,
    setCycleIntervalOnSelection,
    setCycleCountOnSelection,
    setBeatsPerBarOnSelection,
    setActiveBeatsCountOnSelection,
    setBeatShiftOnSelection,
    setRepeatsOnSelection,
    setVariabilityOnSelection,
    setCanActiveBeatOnSelection,
    setOnActiveBeatFunctionOnSelection,
    setCanCollideOnSelection,
    setHasCollidedFunctionOnSelection,
    setCanBeTriggeredOnSelection,
    setBeenTriggeredFunctionOnSelection,
    setCanTickOnSelection,
    setOnTickFunctionOnSelection,
    setTriggerSizeOnSelection,
    setSpriteDisplayDiameterOnSelection,
    setPositionAxisOnSelection,
    setSizeAxisOnSelection,
    setVelocityAxisOnSelection,
    setSceneObjectVoiceField,
} from "./sceneEditor.js";
import { computeShapeBbox, computeShapeBboxCentroid } from "./inspectorSelection.js";

/** Empty selection, used as the base for a single-object selection. */
function emptySelection() {
    return { curves: [], triggers: [], sprites: [] };
}

/**
 * A single-object selection in the {curves,triggers,sprites:[index]}
 * shape the setters expect.
 * @param {string} kind  "curve" | "trigger" | "sprite"
 * @param {number} index
 */
function selectionFor(kind, index) {
    const sel = emptySelection();
    if (kind === "curve") sel.curves = [index];
    else if (kind === "trigger") sel.triggers = [index];
    else if (kind === "sprite") sel.sprites = [index];
    return sel;
}

/**
 * Read an object's current position on one axis, for the position diff.
 * Triggers and sprites carry x/y directly; a curve's position is its
 * shape's bounding-box centre (which is what setPositionAxisOnSelection
 * moves to the absolute target).
 * @param {any} record
 * @param {"x" | "y"} axis
 */
function readPosition(record, axis) {
    if (record !== null && record.shape !== undefined && record.shape !== null) {
        const c = computeShapeBboxCentroid(record.shape);
        if (c === null) return null;
        return axis === "x" ? c.x : c.y;
    }
    return axis === "x" ? record.x : record.y;
}

/**
 * Read a curve's current bounding-box width (axis "x") or height
 * (axis "y"), for the size diff. setSizeAxisOnSelection sets this
 * dimension to an absolute target.
 * @param {any} record
 * @param {"x" | "y"} axis
 */
function readCurveDimension(record, axis) {
    const b = (record !== null) ? computeShapeBbox(record.shape) : null;
    if (b === null) return null;
    return axis === "x" ? (b.x2 - b.x1) : (b.y2 - b.y1);
}

/**
 * The field registry. Each entry maps an AI-facing field key to:
 *   - apply(data, selection, value): mutate the scene data via a setter.
 *   - read(record): the object's current value (for the before→after diff).
 *   - kinds: which object kinds the field applies to (for validation).
 *
 * Most entries are thin wrappers over a setXxxOnSelection setter; the
 * axis fields (x/y, vx/vy) bind the axis, and `instrument` targets the
 * nested superdough voice. The read functions pull the current value
 * straight from the scene.json record for the diff.
 *
 * @type {Record<string, { apply: (data: any, selection: any, value: any) => void, read: (record: any) => any, kinds: string[] }>}
 */
const FIELDS = {
    // --- Identity / grouping ---
    name: { apply: (d, s, v) => setNameOnSelection(d, s, v), read: (r) => r.name ?? null, kinds: ["curve", "trigger", "sprite"] },
    group: { apply: (d, s, v) => setGroupOnSelection(d, s, v), read: (r) => r.group ?? null, kinds: ["curve", "trigger", "sprite"] },

    // --- Position (image-space). For a curve, x/y moves the whole
    //     shape so its bounding-box centre lands at the absolute
    //     target; for triggers/sprites it sets x/y directly. (Moving a
    //     single curve vertex is a canvas reshape, not exposed here.) ---
    x: { apply: (d, s, v) => setPositionAxisOnSelection(d, s, "x", v), read: (r) => readPosition(r, "x"), kinds: ["curve", "trigger", "sprite"] },
    y: { apply: (d, s, v) => setPositionAxisOnSelection(d, s, "y", v), read: (r) => readPosition(r, "y"), kinds: ["curve", "trigger", "sprite"] },

    // --- Velocity (sprites; curves accept it too via the setter) ---
    vx: { apply: (d, s, v) => setVelocityAxisOnSelection(d, s, "x", v), read: (r) => r.vx, kinds: ["sprite", "curve"] },
    vy: { apply: (d, s, v) => setVelocityAxisOnSelection(d, s, "y", v), read: (r) => r.vy, kinds: ["sprite", "curve"] },

    // --- Size ---
    triggerSize: { apply: (d, s, v) => setTriggerSizeOnSelection(d, s, v), read: (r) => r.size, kinds: ["trigger"] },
    displayDiameter: { apply: (d, s, v) => setSpriteDisplayDiameterOnSelection(d, s, v), read: (r) => r.displayDiameter, kinds: ["sprite"] },
    // Curve bounding-box size: absolute width / height.
    width: { apply: (d, s, v) => setSizeAxisOnSelection(d, s, "x", v), read: (r) => readCurveDimension(r, "x"), kinds: ["curve"] },
    height: { apply: (d, s, v) => setSizeAxisOnSelection(d, s, "y", v), read: (r) => readCurveDimension(r, "y"), kinds: ["curve"] },

    // --- Beat points ---
    beatPointsMode: { apply: (d, s, v) => setBeatPointsModeOnSelection(d, s, v), read: (r) => r.beatPointsMode, kinds: ["curve", "sprite"] },
    activeBeats: { apply: (d, s, v) => setActiveBeatsOnSelection(d, s, v), read: (r) => r.activeBeats, kinds: ["curve", "sprite"] },
    strength: { apply: (d, s, v) => setStrengthOnSelection(d, s, v), read: (r) => r.strength, kinds: ["curve", "sprite"] },
    beatPattern: { apply: (d, s, v) => setBeatPatternOnSelection(d, s, v), read: (r) => r.beatPattern, kinds: ["curve", "sprite"] },
    cycleInterval: { apply: (d, s, v) => setCycleIntervalOnSelection(d, s, v), read: (r) => r.cycleInterval, kinds: ["curve", "sprite"] },
    cycleCount: { apply: (d, s, v) => setCycleCountOnSelection(d, s, v), read: (r) => r.cycleCount, kinds: ["curve", "sprite"] },
    beatsPerBar: { apply: (d, s, v) => setBeatsPerBarOnSelection(d, s, v), read: (r) => r.beatsPerBar, kinds: ["curve", "sprite"] },
    activeBeatsCount: { apply: (d, s, v) => setActiveBeatsCountOnSelection(d, s, v), read: (r) => r.activeBeatsCount, kinds: ["curve", "sprite"] },
    beatShift: { apply: (d, s, v) => setBeatShiftOnSelection(d, s, v), read: (r) => r.beatShift, kinds: ["curve", "sprite"] },
    repeats: { apply: (d, s, v) => setRepeatsOnSelection(d, s, v), read: (r) => r.repeats, kinds: ["curve", "sprite"] },
    variability: { apply: (d, s, v) => setVariabilityOnSelection(d, s, v), read: (r) => r.variability, kinds: ["curve", "sprite"] },

    // --- Callback gates + function names ---
    canActiveBeat: { apply: (d, s, v) => setCanActiveBeatOnSelection(d, s, v), read: (r) => r.canActiveBeat ?? false, kinds: ["curve", "sprite"] },
    onActiveBeatFunction: { apply: (d, s, v) => setOnActiveBeatFunctionOnSelection(d, s, v), read: (r) => r.onActiveBeatFunction ?? "", kinds: ["curve", "sprite"] },
    canCollide: { apply: (d, s, v) => setCanCollideOnSelection(d, s, v), read: (r) => r.canCollide ?? false, kinds: ["curve", "trigger", "sprite"] },
    hasCollidedFunction: { apply: (d, s, v) => setHasCollidedFunctionOnSelection(d, s, v), read: (r) => r.hasCollidedFunction ?? "", kinds: ["curve", "trigger", "sprite"] },
    canBeTriggered: { apply: (d, s, v) => setCanBeTriggeredOnSelection(d, s, v), read: (r) => r.canBeTriggered ?? false, kinds: ["curve", "trigger", "sprite"] },
    beenTriggeredFunction: { apply: (d, s, v) => setBeenTriggeredFunctionOnSelection(d, s, v), read: (r) => r.beenTriggeredFunction ?? "", kinds: ["curve", "trigger", "sprite"] },
    canTick: { apply: (d, s, v) => setCanTickOnSelection(d, s, v), read: (r) => r.canTick ?? false, kinds: ["curve", "trigger", "sprite"] },
    onTickFunction: { apply: (d, s, v) => setOnTickFunctionOnSelection(d, s, v), read: (r) => r.onTickFunction ?? "", kinds: ["curve", "trigger", "sprite"] },

    // --- Voice / instrument (superdough). Alias `instrument` → nested voice.superdough.sound. ---
    instrument: {
        apply: (d, s, v) => setSceneObjectVoiceField(d, s, "superdough", "sound", v),
        read: (r) => (r.voice && r.voice.superdough && r.voice.superdough.sound) ? r.voice.superdough.sound : null,
        kinds: ["curve", "trigger", "sprite"],
    },
};

/** Field keys that exist but are deliberately not settable here. */
const RISKY_FIELDS = new Set(["id", "shape", "imageName", "points"]);

/** @returns {string[]} The settable field keys, for docs/diagnostics. */
export function settableFields() {
    return Object.keys(FIELDS);
}

/**
 * Find an object by ID in parsed scene data, returning its kind, index,
 * and record, or null if not found.
 * @param {any} data  Parsed scene.json data.
 * @param {string} id
 * @returns {{ kind: string, index: number, record: any } | null}
 */
function findObject(data, id) {
    const kinds = /** @type {const} */ ([["curve", "curves"], ["trigger", "triggers"], ["sprite", "sprites"]]);
    for (const [kind, arrKey] of kinds) {
        const arr = data[arrKey];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].id === id) return { kind, index: i, record: arr[i] };
        }
    }
    return null;
}

/**
 * Validate a changes list against the current scene and build an apply
 * plan with before→after values for the diff. Returns either a plan
 * (ops to apply) or an error describing the first problem — mirroring
 * scene.json's all-or-nothing rejection so a bad batch never partially
 * applies.
 *
 * @param {any} data  Parsed scene.json data (read-only here).
 * @param {any} changes  The parsed `changes` array from property-changes.json.
 * @returns {{ ok: true, ops: Array<{ object: string, kind: string, selection: any, field: string, from: any, to: any }> }
 *          | { ok: false, error: string }}
 */
export function planPropertyChanges(data, changes) {
    if (!Array.isArray(changes)) {
        return { ok: false, error: "property-changes.json: \"changes\" must be an array." };
    }
    if (changes.length === 0) {
        return { ok: false, error: "property-changes.json: \"changes\" is empty." };
    }
    const ops = [];
    for (let c = 0; c < changes.length; c++) {
        const change = changes[c];
        if (typeof change !== "object" || change === null) {
            return { ok: false, error: `changes[${c}] must be an object.` };
        }
        const id = change.object;
        if (typeof id !== "string" || id === "") {
            return { ok: false, error: `changes[${c}].object must be a non-empty object ID.` };
        }
        const found = findObject(data, id);
        if (found === null) {
            return { ok: false, error: `No object with ID "${id}" in the scene.` };
        }
        const set = change.set;
        if (typeof set !== "object" || set === null || Array.isArray(set)) {
            return { ok: false, error: `changes[${c}].set must be an object of field:value pairs.` };
        }
        for (const field of Object.keys(set)) {
            if (RISKY_FIELDS.has(field)) {
                return { ok: false, error: `Field "${field}" cannot be changed through property-changes (edit it on the canvas or in script.js).` };
            }
            const entry = FIELDS[field];
            if (entry === undefined) {
                return { ok: false, error: `Unknown field "${field}". Settable fields: ${Object.keys(FIELDS).join(", ")}.` };
            }
            if (!entry.kinds.includes(found.kind)) {
                return { ok: false, error: `Field "${field}" does not apply to a ${found.kind} (object "${id}").` };
            }
            ops.push({
                object: id,
                kind: found.kind,
                selection: selectionFor(found.kind, found.index),
                field,
                from: entry.read(found.record),
                to: set[field],
            });
        }
    }
    return { ok: true, ops };
}

/**
 * Apply a validated plan's ops to the scene data in place, via the
 * inspector setters. Call inside applySceneEdit's mutate callback so a
 * single stringify + rebuild covers the whole batch.
 * @param {any} data  Parsed scene.json data (mutated in place).
 * @param {Array<{ selection: any, field: string, to: any }>} ops
 */
export function applyPropertyChanges(data, ops) {
    for (const op of ops) {
        FIELDS[op.field].apply(data, op.selection, op.to);
    }
}

/**
 * A short human-readable before→after summary of a plan, for the
 * message area so the user sees what the confirm dialog will apply.
 * @param {Array<{ object: string, field: string, from: any, to: any }>} ops
 * @returns {string}
 */
export function summarizePlan(ops) {
    const fmt = (v) => {
        if (v === null || v === undefined) return "—";
        if (typeof v === "string") return v === "" ? "—" : v;
        return String(v);
    };
    return ops.map((o) => `${o.object}: ${o.field} ${fmt(o.from)} → ${fmt(o.to)}`).join("\n");
}
