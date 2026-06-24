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
import { INTERVAL_TOKENS, DEFAULT_INTERVAL } from "./intervalMenu.js";

/**
 * Time Lag In Object (Band 1, GeoSonixV2): a multiplier times an
 * interval chosen from the shared interval menu. The lag is the
 * multiplier counted in that interval's units. Shared verbatim by
 * curves, triggers and sprites. Default 0 × "Off" = no lag.
 * @type {FieldDef[]}
 */
const TIME_LAG_FIELDS = [
    { key: "timeLagMultiplier", label: "Time Lag", type: "number", default: 0, min: 0 },
    { key: "timeLagInterval", label: "Time Lag Interval", type: "enum", default: DEFAULT_INTERVAL, enumValues: INTERVAL_TOKENS },
];

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
 * Code-tab callback slots (onActiveBeat, hasCollided, beenTriggered,
 * onTick), each guarded by a Can-X gate boolean (canCollide,
 * canBeTriggered, canActiveBeat, canTick). The cyclePattern lives in the Band 4 CodeMirror
 * editor; cursor-as-collider derives self-firing from cursor
 * extents and the object's state, so there is no canCycle gate. The
 * beatsPerCycle field gives the cycle length in master beats
 * and surfaces in Band 1 as the cycle duration row.
 *
 * Function naming convention: each Code-tab slot's function
 * is named slotName_sourceId, e.g. hasHit_tr_a3f7,
 * beenHit_tr_a3f7, onTick_sp_b9c2. The cyclePattern's home
 * is the Band 4 editor and not the Script tab.
 * @type {FieldDef[]}
 */
const CALLBACK_SLOT_FIELDS = [
    { key: "cyclePattern", label: "Cycle Pattern", type: "string", default: "" },
    { key: "beatsPerCycle", label: "Beats/Cycle", type: "number", default: 16, min: 0 },
    {
        key: "beatInterval",
        label: "Beat Interval",
        type: "enum",
        default: DEFAULT_BEAT_INTERVAL,
        enumValues: allBeatIntervalTokens(),
    },
    // Beat Points (Band 5): a beat-points rhythm for curves and
    // sprites (not triggers). The rhythm is now always authored as a
    // Strudel mini-notation pattern (default "strudel"); the legacy
    // none/normal/euclidean/auto grid modes are deprecated and no
    // longer selectable in the inspector, though the enum and their
    // derivation/runtime paths remain for any score that still uses
    // them. An empty beatPattern means no beats (what "none" expressed).
    { key: "beatPointsMode", label: "Beat Points", type: "enum", default: "normal", enumValues: ["none", "normal", "euclidean", "auto", "strudel"] },
    // Auto-mode RHYTHM style (by name): the generator reads this to weight the
    // generated Active Beats / Beat Strength pattern. A rhythm-style-library name
    // (built-in straight/syncopated or a user style); "" = default. (Stored as a
    // free string so the dynamic library can grow; the generator falls back to
    // its default profile for names it doesn't know.)
    { key: "autoStyle", label: "Auto Style", type: "string", default: "" },
    { key: "activeBeats", label: "Active Beats", type: "string", default: "x" },
    { key: "strength", label: "Beat Strength", type: "string", default: "9" },
    // Strudel beat-points mode (beatPointsMode === "strudel"): a
    // mini-notation expression whose one-cycle event positions and
    // numeric tokens become the beat points and their strengths,
    // replacing the activeBeats / strength strings. Parsed for
    // positions at firing time (later stage); just stored here.
    { key: "beatPattern", label: "Beat Pattern", type: "string", default: "" },
    // Measure-based phrase (beatPointsMode === "strudel"): the beatPattern is
    // split on the top-level `|` into measures; `measures` is how many of those
    // measures the phrase spans (the box count). Each measure is one master-meter
    // bar; the cycle length is measures × master-beats × repeats quarter notes
    // (so beatsPerCycle is derived, not authored). See design/measure-patterns.md.
    { key: "measures", label: "Measures", type: "integer", default: 1, min: 1 },
    // Driver from Canvas (beatbox voices): the image colour channel that an NcM
    // canvas token reads under each beat to swing its strength. One of the col
    // signals (lt = lightness, r/g/b, …). See design/measure-patterns.md.
    { key: "strengthChannel", label: "Driver from Canvas", type: "enum", default: "lt", enumValues: ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"] },
    // Canvas to Sound Drivers band. dropChannel is the image channel the
    // likelihood-of-beat (drop) digit reads; strengthDepth / dropDepth are the
    // object-wide influence (None 0 … Full 1) that scales the per-beat swing /
    // drop digits before evaluation. See design/canvas-to-sound-drivers.md.
    { key: "dropChannel", label: "Drop Driver from Canvas", type: "enum", default: "chr", enumValues: ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"] },
    { key: "strengthDepth", label: "Beat Strength Depth", type: "number", default: 1, min: 0, max: 1 },
    { key: "dropDepth", label: "Drop Depth", type: "number", default: 1, min: 0, max: 1 },
    // Note velocity / sustain image drivers (Canvas to Sound Drivers band). The
    // channel each reads under the beat and its depth (None 0 … Full 1, default
    // None — the style no longer carries image influence).
    { key: "velocityChannel", label: "Velocity Driver from Canvas", type: "enum", default: "lt", enumValues: ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"] },
    { key: "velocityDepth", label: "Velocity Depth", type: "number", default: 0, min: 0, max: 1 },
    { key: "durationChannel", label: "Sustain Driver from Canvas", type: "enum", default: "lt", enumValues: ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"] },
    { key: "durationDepth", label: "Sustain Depth", type: "number", default: 0, min: 0, max: 1 },
    // Pan driver (Canvas to Sound Drivers band). panMode chooses how pan is
    // generated ("off" centre, "canvasLR" by horizontal offset from the canvas
    // centre, "collisionLR" reserved); panDepth (None 0 … Full 1) scales it.
    { key: "panMode", label: "Pan", type: "enum", default: "off", enumValues: ["off", "canvasLR", "collisionLR"] },
    { key: "panDepth", label: "Pan Depth", type: "number", default: 1, min: 0, max: 1 },
    // Strudel cycle length (beatPointsMode === "strudel"): the span
    // the one-cycle mini-notation pattern maps across, given as a
    // note-duration token times an integer count
    // (cycleInterval × cycleCount). Replaces Beats/Cycle + Beats/Bar
    // in Strudel mode. "Off" is excluded — a cycle must have length.
    // Default Qtr × 16 = a sixteen-quarter-note cycle.
    { key: "cycleInterval", label: "Cycle Length Interval", type: "enum", default: "Qtr", enumValues: INTERVAL_TOKENS.filter((t) => t !== "Off") },
    { key: "cycleCount", label: "Cycle Length Count", type: "integer", default: 16, min: 1 },
    // Euclidean-mode parameters (Band 5, shown only when
    // beatPointsMode === "euclidean"). The pattern is generated
    // from these by src/euclidean.js generateEuclideanPattern.
    { key: "beatsPerBar", label: "Beats/Bar", type: "integer", default: 1, min: 1 },
    { key: "activeBeatsCount", label: "Active Beats Count", type: "integer", default: 0, min: 0 },
    { key: "beatShift", label: "Beat Shift", type: "integer", default: 0 },
    { key: "repeats", label: "Beat Repeats", type: "integer", default: 1, min: 1 },
    // Pattern variation: `vary` = the number of notes flipped per cycle (each cycle
    // flips this many beats x<->., as a delta from the ORIGINAL activeBeats — never
    // cumulative). Applied when beat points are derived, per repeat (cycle), seeded
    // by varySeed + the cycle index, so each Repeat flips different slots and it's
    // reproducible on rewind. 0 = off. The dice rolls a new varySeed. Manual + Euclidean.
    { key: "vary", label: "Vary", type: "integer", default: 0, min: 0 },
    { key: "varySeed", label: "Vary Seed", type: "integer", default: 0 },
    { key: "canCollide", label: "Can Collide", type: "boolean", default: false },
    { key: "hasCollidedFunction", label: "Has Collided Function", type: "functionRef", default: "" },
    // The melodic STYLE (nxtNote MStyle, by name) this note callback uses by
    // default — distinct from `voice` (the object's instrument / sound bank). The
    // engine binds a fresh copy as `this.style`, and a no-argument nxtNote() uses
    // it. Empty = the default melody style. (Not on onTick — not a note event.)
    { key: "hasCollidedStyle", label: "Has Collided Style", type: "string", default: "" },
    { key: "canBeTriggered", label: "Can Be Triggered", type: "boolean", default: false },
    { key: "beenTriggeredFunction", label: "Been Triggered Function", type: "functionRef", default: "" },
    { key: "beenTriggeredStyle", label: "Been Triggered Style", type: "string", default: "" },
    // onActiveBeat (Band 3): fires when a cursor crosses one of this
    // object's active beat points. Curves and sprites only (the UI
    // greys it for triggers, which have no beat points). Its firing
    // lands with the scheduler in the firing-flow stage; the slot is
    // scaffolding for now.
    { key: "canActiveBeat", label: "Can Active Beat", type: "boolean", default: false },
    { key: "onActiveBeatFunction", label: "On Active Beat Function", type: "functionRef", default: "" },
    { key: "onActiveBeatStyle", label: "On Active Beat Style", type: "string", default: "" },
    // Voice Role (Band 3, beside Note Style): the object's ensemble function,
    // read by nxtNote (as this.role) to coordinate through the master object. An
    // OBJECT property (not a style field) — the same voice can play any role.
    { key: "role", label: "Voice Role", type: "enum", default: "none", enumValues: ["none", "foundation", "pulse", "accent", "lead", "pad", "fill", "counter"] },
    { key: "canTick", label: "Can Tick", type: "boolean", default: false },
    { key: "onTickFunction", label: "On Tick Function", type: "functionRef", default: "" },
];

/**
 * Per-object voice field shared by Curve, Trigger, and
 * Sprite. The `voice` object is nested by engine name
 * (e.g. `voice: { superdough: { sound, bank } }`) so that
 * switching engines preserves the inactive engines' voice
 * settings rather than destructively migrating between
 * shapes. The inspector's middle band reads only the
 * active engine's subfield and renders its controls. The
 * default is null because most objects don't customise
 * their voice; an absent or empty subfield reads as the
 * "Default" sentinel in the inspector UI and produces no
 * soft-injection at firing time, so legacy scores without
 * the field need no migration.
 * @type {FieldDef[]}
 */
const VOICE_FIELDS = [
    { key: "voice", label: "Voice", type: "object", default: null },
];

/**
 * Score-level (piece-wide) fields. These live at the top of
 * scene.json, not inside any object array.
 * @type {FieldDef[]}
 */
export const SCENE_FIELDS = [
    { key: "bpm", label: "BPM", type: "integer", default: null, min: 1, max: 1000 },
    {
        // Global time signature, stored as a 2-element array
        // [numerator, denominator]. The numerator is the
        // beats-per-bar count (against the master BPM beat); the
        // denominator is display-only in v1. Default 4/4.
        key: "timeSignature",
        label: "Time Signature",
        type: "array",
        default: [4, 4],
    },
    {
        // Chosen progression: a single Song picked from the harmony
        // library, frozen into the score. Null = none chosen. Stored
        // as a serialisable object
        //   { title, composer, key, timeSignature, progression }
        // (see src/harmonyScene.js for the exact shape and the load-time
        // sanitiser). No inspector widget yet — this is pure storage.
        key: "harmony",
        label: "Chosen Progression",
        type: "object",
        default: null,
    },
    {
        // Whether the chosen progression LOOPS at the end of the piece
        // (true = play the whole progression on repeat) or STOPS once the
        // last bar has sounded (false). Feeds harmonyAt's `loop` argument in
        // the harmony player. Default true so a short progression keeps
        // sounding under a longer sketch. See src/harmonyPlayer.js.
        key: "harmonyLoop",
        label: "Loop Progression",
        type: "boolean",
        default: true,
    },
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
    {
        key: "engine",
        label: "Sound Engine",
        type: "enum",
        default: "midi",
        enumValues: ["midi", "superdough"],
    },
    {
        // Score-wide default superdough voice. Per-object
        // voices inherit these when their own sound/bank is
        // unset (the per-object "Global" sentinel). Shape
        // mirrors the per-object voice.superdough subobject:
        // { sound, bank } with empty-string meaning the
        // global "Default" sentinel (no injection at all).
        // Null default because a fresh score has no global
        // override; an absent field reads as both-empty,
        // i.e. global Default for sound and bank.
        key: "voiceSuperdough",
        label: "Global Superdough Voice",
        type: "object",
        default: null,
    },
    { key: "triggerScale", label: "Trigger Scale", type: "number", default: 1, min: 0.1, max: 10 },
    { key: "spriteScale", label: "Sprite Scale", type: "number", default: 1, min: 0.1, max: 10 },
];

/**
 * Curve-specific fields, followed by the shared callback-slot
 * fields and the harmony overrides.
 *
 * Deprecation note on `hide`: this curve-only field predates
 * the universal `state` control. It still hides the curve's
 * cursor when true, and the runtime honours
 * `hide || state !== "active"` for cursor visibility so a
 * cursor renders only on an active, non-hidden curve. New work
 * should use `state` instead: the "passive" state removes the
 * cursor — gating pattern firing as well as cursor rendering —
 * uniformly across curves and sprites, and "disabled" makes
 * any object fully inert (greyed, frozen, out of collisions).
 * The Hide row was removed from the curve inspector in the
 * Commit 2 visual-feedback pass; the field stays in the
 * schema for backward compatibility with existing scene.json
 * files.
 * @type {FieldDef[]}
 */
export const CURVE_FIELDS = [
    { key: "id", label: "Object ID", type: "string", default: null },
    { key: "name", label: "Name", type: "string", default: "" },
    { key: "state", label: "State", type: "enum", default: "active", enumValues: ["active", "passive", "disabled"] },
    // Group membership (Band 1). Empty string = ungrouped. A
    // group name lets a selector address every object tagged
    // with it; the inspector offers existing names plus a
    // "New group…" prompt. See DESIGN.md section 3 (substrate).
    { key: "group", label: "Group", type: "string", default: "" },
    ...TIME_LAG_FIELDS,
    // Deprecated; see the CURVE_FIELDS JSDoc above. Honoured
    // by the runtime for backward compatibility; not surfaced
    // in the inspector.
    { key: "hide", label: "Hide", type: "boolean", default: false },
    { key: "shape", label: "Shape", type: "shape", default: null },
    { key: "vx", label: "VX", type: "number", default: 0 },
    { key: "vy", label: "VY", type: "number", default: 0 },
    { key: "curveThickness", label: "Curve Thickness", type: "number", default: 1 },
    { key: "color", label: "Color", type: "color", default: "#7dd68a" },
    // Band 6 (Cycle): startAtCycle / stopAtCycle are the cycle
    // indices the object begins and ends on. start 0 = from the
    // beginning; stop -1 = never stop.
    { key: "startAtCycle", label: "Start at Cycle", type: "integer", default: 0, min: 0 },
    { key: "stopAtCycle", label: "Stop at Cycle", type: "integer", default: -1 },
    { key: "cursorR", label: "Cursor R", type: "number", default: 0 },
    { key: "cursorL", label: "Cursor L", type: "number", default: 0 },
    { key: "cursorThickness", label: "Cursor Thickness", type: "number", default: 2 },
    { key: "patternRepeats", label: "Repeats", type: "integer", default: 1, min: 1 },
    { key: "cycleSpeeds", label: "Speeds", type: "string", default: "1" },
    // Seed-variation dial. 0 (default) locks the object — it is
    // never moved by a seeded rewind. A positive value scales the
    // Gaussian spread of the per-seed position (and, for kinds
    // that carry one, velocity) offset. See src/seed/seedOffset.js.
    { key: "variability", label: "Variability", type: "number", default: 0, min: 0 },
    // Mutability placeholders (Band 2): position and size mutation amounts.
    // The velocity amount reuses the existing `variability` field. Scaffolding
    // - the seed/mutation engine does not read these yet (behaviour TBD).
    { key: "mutatePosition", label: "Mutate Position", type: "number", default: 0, min: 0 },
    { key: "mutateSize", label: "Mutate Size", type: "number", default: 0, min: 0 },
    ...CALLBACK_SLOT_FIELDS,
    ...VOICE_FIELDS,
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
    { key: "state", label: "State", type: "enum", default: "active", enumValues: ["active", "disabled"] },
    { key: "group", label: "Group", type: "string", default: "" },
    ...TIME_LAG_FIELDS,
    { key: "x", label: "X", type: "number", default: 0 },
    { key: "y", label: "Y", type: "number", default: 0 },
    { key: "size", label: "Trigger Size", type: "number", default: 0.35 },
    { key: "color", label: "Color", type: "color", default: "#7db8d6" },
    { key: "note", label: "Note", type: "integer", default: null },
    { key: "payload", label: "Payload", type: "object", default: null },
    // Band 6 (Cycle): a trigger's firing can sync to a beat
    // interval from the shared note-duration menu ("Off" = no sync).
    { key: "triggerSyncToBeat", label: "Trigger Sync To Beat", type: "enum", default: "Off", enumValues: INTERVAL_TOKENS },
    // Seed-variation dial; see CURVE_FIELDS. Triggers carry only
    // a position offset (no starting velocity).
    { key: "variability", label: "Variability", type: "number", default: 0, min: 0 },
    // Mutability placeholders (Band 2): position and size mutation amounts.
    // The velocity amount reuses the existing `variability` field. Scaffolding
    // - the seed/mutation engine does not read these yet (behaviour TBD).
    { key: "mutatePosition", label: "Mutate Position", type: "number", default: 0, min: 0 },
    { key: "mutateSize", label: "Mutate Size", type: "number", default: 0, min: 0 },
    ...CALLBACK_SLOT_FIELDS,
    ...VOICE_FIELDS,
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
    { key: "state", label: "State", type: "enum", default: "active", enumValues: ["active", "passive", "disabled"] },
    { key: "group", label: "Group", type: "string", default: "" },
    ...TIME_LAG_FIELDS,
    { key: "x", label: "X", type: "number", default: 0 },
    { key: "y", label: "Y", type: "number", default: 0 },
    { key: "vx", label: "VX", type: "number", default: 0 },
    { key: "vy", label: "VY", type: "number", default: 0 },
    { key: "displayDiameter", label: "Display Diameter", type: "number", default: 1.05 },
    { key: "mass", label: "Mass", type: "number", default: 1, min: 0.1 },
    { key: "color", label: "Color", type: "color", default: "#7db8d6" },
    { key: "cursorR", label: "Cursor R", type: "number", default: 0 },
    { key: "cursorL", label: "Cursor L", type: "number", default: 0 },
    { key: "cursorThickness", label: "Cursor Thickness", type: "number", default: 2 },
    { key: "cycleSpeeds", label: "Speeds", type: "string", default: "1" },
    // Band 6 (Cycle): sprites cycle too, so they carry start/stop.
    { key: "startAtCycle", label: "Start at Cycle", type: "integer", default: 0, min: 0 },
    { key: "stopAtCycle", label: "Stop at Cycle", type: "integer", default: -1 },
    // Seed-variation dial; see CURVE_FIELDS. Sprites carry both a
    // position and a starting-velocity offset.
    { key: "variability", label: "Variability", type: "number", default: 0, min: 0 },
    // Mutability placeholders (Band 2): position and size mutation amounts.
    // The velocity amount reuses the existing `variability` field. Scaffolding
    // - the seed/mutation engine does not read these yet (behaviour TBD).
    { key: "mutatePosition", label: "Mutate Position", type: "number", default: 0, min: 0 },
    { key: "mutateSize", label: "Mutate Size", type: "number", default: 0, min: 0 },
    ...CALLBACK_SLOT_FIELDS,
    ...VOICE_FIELDS,
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
