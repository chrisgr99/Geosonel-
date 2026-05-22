/**
 * Scene field schema.
 *
 * Single source of truth for the per-object data fields that
 * make up a GXW score. Each field carries:
 *   - key:    the JSON property name (camelCase, JS-safe)
 *   - label:  the human-readable name shown in the property
 *             editor (matches GeoSonix terminology where
 *             possible)
 *   - type:   the field's data shape, used by the loader for
 *             function-ref resolution and by the future
 *             property panel to pick an input widget
 *   - default: the value applied when the field is omitted
 *              (informational; the runtime defaults still live
 *              in the Scene/Curve/Trigger/Sprite constructors
 *              for now, and the schema mirrors them)
 *   - enumValues: for enum-typed fields, the allowed values
 *
 * Field types:
 *   "integer", "number", "string", "boolean"   — primitives
 *   "enum"                                      — one of enumValues
 *   "tuple"                                     — small ordered array
 *   "color"                                     — RGBA string or named palette entry
 *   "shape"                                     — curve geometry sub-object
 *   "object"                                    — opaque sub-object
 *   "functionRef"                               — name of a function defined in script.js
 *
 * The schema is read by:
 *   - the scene loader, to know which fields are functionRef
 *     and need name-to-function resolution
 *   - the property panel (future), to render forms
 *   - AI assistants editing scene.json or script.js, as a
 *     reference for what fields exist and what they mean
 *
 * When adding a new field: update this schema first, then
 * update the corresponding constructor in scene.js to read it
 * with a matching default. The two should stay in lock-step
 * until a future milestone moves runtime defaults into the
 * schema as well.
 */

// @ts-check

import { DEFAULT_BEAT_INTERVAL, allBeatIntervalTokens } from "./beatIntervals.js";

/**
 * @typedef {Object} FieldDef
 * @property {string} key
 * @property {string} label
 * @property {string} type
 * @property {*} default
 * @property {string[]} [enumValues]
 * @property {number} [min]
 * @property {number} [max]
 */

/**
 * Harmony override fields shared by Curve, Trigger, and
 * Sprite. Each one has a null default meaning "inherit from
 * the score-level setting".
 * @type {FieldDef[]}
 */
const HARMONY_OVERRIDE_FIELDS = [
    { key: "tonic", label: "Tonic", type: "string", default: null },
    { key: "scaleName", label: "Scale", type: "string", default: null },
    { key: "root", label: "Root", type: "string", default: null },
    { key: "chordName", label: "Chord", type: "string", default: null },
    { key: "range", label: "Range In Semitones", type: "integer", default: null },
    { key: "rangeLow", label: "Lowest Note", type: "integer", default: null },
    {
        key: "mapNotesTo",
        label: "Map Notes To",
        type: "enum",
        default: null,
        enumValues: ["Score", "Scale", "Chord", "None"],
    },
];

/**
 * Callback-slot fields shared by Curve, Trigger, and Sprite.
 * Every source kind carries the cyclePattern field and the
 * three Code-tab callback slots (hasHit, beenHit, onTick),
 * each guarded by a Can-X gate boolean (canHit, canBeHit,
 * canTick). The cyclePattern lives in the Band 4 CodeMirror
 * editor; cursor-as-collider derives self-firing from cursor
 * extents and mute, so there is no canCycle gate. The
 * beatsPerCycle field gives the cycle length in master beats
 * and surfaces in Band 1 as the cycle duration row.
 *
 * Function naming convention: each Code-tab slot's function
 * is named slotName_sourceId, e.g. hasHit_tr_a3f7,
 * beenHit_tr_a3f7, onTick_sp_b9c2. The cyclePattern's home
 * is the Band 4 editor and not the Code tab.
 * @type {FieldDef[]}
 */
const CALLBACK_SLOT_FIELDS = [
    { key: "cyclePattern", label: "Cycle Pattern", type: "string", default: "" },
    { key: "beatsPerCycle", label: "Beats/Cycle", type: "number", default: 4, min: 0 },
    {
        key: "beatInterval",
        label: "Beat Interval",
        type: "enum",
        default: DEFAULT_BEAT_INTERVAL,
        enumValues: allBeatIntervalTokens(),
    },
    { key: "canHit", label: "Can Hit", type: "boolean", default: false },
    { key: "hasHitFunction", label: "Has Hit Function", type: "functionRef", default: "" },
    { key: "canBeHit", label: "Can Be Hit", type: "boolean", default: false },
    { key: "beenHitFunction", label: "Been Hit Function", type: "functionRef", default: "" },
    { key: "canTick", label: "Can Tick", type: "boolean", default: false },
    { key: "onTickFunction", label: "On Tick Function", type: "functionRef", default: "" },
];

/**
 * Score-level (piece-wide) fields. These live at the top of
 * scene.json, not inside any object array.
 * @type {FieldDef[]}
 */
export const SCENE_FIELDS = [
    { key: "bpm", label: "BPM", type: "integer", default: null, min: 1, max: 1000 },
    { key: "tonic", label: "Tonic", type: "string", default: null },
    { key: "scaleName", label: "Scale", type: "string", default: null },
    { key: "root", label: "Root", type: "string", default: null },
    { key: "chordName", label: "Chord", type: "string", default: null },
    { key: "range", label: "Range In Semitones", type: "integer", default: null },
    { key: "rangeLow", label: "Lowest Note", type: "integer", default: null },
    {
        key: "mapNotesTo",
        label: "Map Notes To",
        type: "enum",
        default: null,
        enumValues: ["Score", "Scale", "Chord", "None"],
    },
    { key: "imageName", label: "Image", type: "string", default: null },
    { key: "output", label: "Output", type: "object", default: null },
    { key: "triggerScale", label: "Trigger Scale", type: "number", default: 1, min: 0.1, max: 10 },
    { key: "spriteScale", label: "Sprite Scale", type: "number", default: 1, min: 0.1, max: 10 },
];

/**
 * Curve-specific fields, followed by the shared callback-slot
 * fields and the harmony overrides.
 * @type {FieldDef[]}
 */
export const CURVE_FIELDS = [
    { key: "id", label: "Object ID", type: "string", default: null },
    { key: "name", label: "Name", type: "string", default: "" },
    { key: "mute", label: "Mute", type: "boolean", default: false },
    { key: "hide", label: "Hide", type: "boolean", default: false },
    { key: "shape", label: "Shape", type: "shape", default: null },
    { key: "vx", label: "VX", type: "number", default: 0 },
    { key: "vy", label: "VY", type: "number", default: 0 },
    { key: "curveThickness", label: "Curve Thickness", type: "number", default: 1 },
    { key: "stopAtCycle", label: "Stop at Cycle", type: "integer", default: -1 },
    { key: "cursorR", label: "Cursor R", type: "number", default: 0 },
    { key: "cursorL", label: "Cursor L", type: "number", default: 0 },
    { key: "cursorThickness", label: "Cursor Thickness", type: "number", default: 2 },
    { key: "patternRepeats", label: "Repeats", type: "integer", default: 1, min: 1 },
    { key: "cycleSpeeds", label: "Speeds", type: "string", default: "1" },
    ...CALLBACK_SLOT_FIELDS,
    ...HARMONY_OVERRIDE_FIELDS,
];

/**
 * Trigger-specific fields, followed by the shared callback-slot
 * fields and the harmony overrides.
 * @type {FieldDef[]}
 */
export const TRIGGER_FIELDS = [
    { key: "id", label: "Object ID", type: "string", default: null },
    { key: "name", label: "Name", type: "string", default: "" },
    { key: "mute", label: "Mute", type: "boolean", default: false },
    { key: "x", label: "X", type: "number", default: 0 },
    { key: "y", label: "Y", type: "number", default: 0 },
    { key: "size", label: "Trigger Size", type: "number", default: 0.35 },
    { key: "color", label: "Color", type: "color", default: "#7db8d6" },
    { key: "note", label: "Note", type: "integer", default: null },
    { key: "payload", label: "Payload", type: "object", default: null },
    ...CALLBACK_SLOT_FIELDS,
    ...HARMONY_OVERRIDE_FIELDS,
];

/**
 * Sprite-specific fields, followed by the shared callback-slot
 * fields and the harmony overrides.
 * @type {FieldDef[]}
 */
export const SPRITE_FIELDS = [
    { key: "id", label: "Object ID", type: "string", default: null },
    { key: "name", label: "Name", type: "string", default: "" },
    { key: "mute", label: "Mute", type: "boolean", default: false },
    { key: "x", label: "X", type: "number", default: 0 },
    { key: "y", label: "Y", type: "number", default: 0 },
    { key: "vx", label: "VX", type: "number", default: 0 },
    { key: "vy", label: "VY", type: "number", default: 0 },
    { key: "maxSpeed", label: "Max Speed", type: "number", default: 16 },
    { key: "displayDiameter", label: "Display Diameter", type: "number", default: 1.05 },
    { key: "color", label: "Color", type: "color", default: "#7db8d6" },
    { key: "cursorR", label: "Cursor R", type: "number", default: 0 },
    { key: "cursorL", label: "Cursor L", type: "number", default: 0 },
    ...CALLBACK_SLOT_FIELDS,
    ...HARMONY_OVERRIDE_FIELDS,
];

/**
 * Lookup of the per-object-type field arrays, keyed by the
 * scene.json array name (curves / triggers / sprites).
 */
export const OBJECT_FIELDS_BY_KIND = {
    curves: CURVE_FIELDS,
    triggers: TRIGGER_FIELDS,
    sprites: SPRITE_FIELDS,
};

/**
 * Return the names of fields whose value is a function
 * reference, for a given object kind. Used by the loader to
 * resolve string-valued function names against the executed
 * script.
 * @param {"curves" | "triggers" | "sprites"} kind
 * @returns {string[]}
 */
export function functionRefFieldsFor(kind) {
    const fields = OBJECT_FIELDS_BY_KIND[kind];
    if (!fields) return [];
    return fields.filter((f) => f.type === "functionRef").map((f) => f.key);
}
