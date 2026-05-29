/**
 * Scene editor.
 *
 * Pure functions that mutate scene.json text. Used by the
 * canvas's interaction layer when the user adds, moves, or
 * deletes objects through the toolbar and direct manipulation.
 *
 * The mutation pipeline is parse-mutate-stringify: scene.json
 * text is parsed to a JS object, the object is mutated, then
 * stringified back to text using a custom formatter that
 * approximates the hand-written style of the default template.
 * Top-level keys keep two-space indent. Sprite and trigger
 * entries inside their arrays are formatted on a single line
 * each so the array reads as a compact list. Curve entries
 * are multi-line because they have many fields and a nested
 * shape object. Unknown top-level keys and unknown fields
 * within entries are preserved verbatim through the
 * round-trip.
 *
 * Index identity: scene.json's curves, triggers, and sprites
 * arrays are positionally indexed. The canvas's selection
 * state stores indexes, and these indexes line up one-to-one
 * with the entries in the JSON arrays. Mutations that don't
 * change array length (move) preserve indexes; mutations that
 * append (add) leave existing indexes stable; mutations that
 * remove (delete, future) shift indexes after the removal
 * point and the caller is responsible for invalidating any
 * stale selection.
 */

// @ts-check

import { generateId, ensureIdCounters } from "./idGen.js";
import { isValidBeatInterval } from "./beatIntervals.js";
import * as acorn from "https://esm.sh/acorn@8";

const ARRAY_KEYS = new Set(["curves", "triggers", "sprites"]);
const MULTILINE_ARRAY_KEYS = new Set(["curves"]);

/**
 * Parse scene.json text. Returns { ok, data, error }.
 * @param {string} text
 * @returns {{ok: true, data: any} | {ok: false, error: string}}
 */
export function parseScene(text) {
    try {
        const data = JSON.parse(text);
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
            return { ok: false, error: "scene.json must be a JSON object at top level." };
        }
        return { ok: true, data };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Stringify a parsed scene.json object using GXW's preferred
 * formatting: top-level keys with two-space indent, arrays of
 * sprites/triggers as single-line entries, curves as
 * multi-line entries.
 * @param {any} data
 * @returns {string}
 */
export function stringifyScene(data) {
    const lines = ["{"];
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = data[key];
        const trailing = i === keys.length - 1 ? "" : ",";
        if (ARRAY_KEYS.has(key) && Array.isArray(val)) {
            if (val.length === 0) {
                lines.push(`  ${jsonKey(key)}: []${trailing}`);
            } else {
                lines.push(`  ${jsonKey(key)}: [`);
                const multi = MULTILINE_ARRAY_KEYS.has(key);
                for (let j = 0; j < val.length; j++) {
                    const entryComma = j === val.length - 1 ? "" : ",";
                    if (multi) {
                        lines.push(...formatMultilineEntry(val[j], 4));
                        // Append a comma to the closing brace line if not last.
                        if (entryComma) {
                            lines[lines.length - 1] += entryComma;
                        }
                    } else {
                        lines.push(`    ${formatInlineEntry(val[j])}${entryComma}`);
                    }
                }
                lines.push(`  ]${trailing}`);
            }
        } else {
            lines.push(`  ${jsonKey(key)}: ${JSON.stringify(val)}${trailing}`);
        }
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}

/**
 * Format an entry as a single-line { "k": v, "k2": v2 } block.
 * Nested objects are themselves single-lined recursively.
 * @param {any} obj
 * @returns {string}
 */
function formatInlineEntry(obj) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        return JSON.stringify(obj);
    }
    const parts = [];
    for (const k of Object.keys(obj)) {
        parts.push(`${jsonKey(k)}: ${JSON.stringify(obj[k])}`);
    }
    return `{ ${parts.join(", ")} }`;
}

/**
 * Format an entry as a multi-line block at the given indent
 * level. Each leaf field is on its own line; nested objects
 * stay inline (typical example: a curve's shape field).
 * Returns an array of lines without trailing commas at the
 * outer level — the caller adds those.
 *
 * @param {any} obj
 * @param {number} indent  Number of leading spaces.
 * @returns {string[]}
 */
function formatMultilineEntry(obj, indent) {
    const pad = " ".repeat(indent);
    const inner = " ".repeat(indent + 2);
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        return [`${pad}${JSON.stringify(obj)}`];
    }
    const lines = [`${pad}{`];
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = obj[k];
        const comma = i === keys.length - 1 ? "" : ",";
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            lines.push(`${inner}${jsonKey(k)}: ${formatInlineEntry(v)}${comma}`);
        } else {
            lines.push(`${inner}${jsonKey(k)}: ${JSON.stringify(v)}${comma}`);
        }
    }
    lines.push(`${pad}}`);
    return lines;
}

/** @param {string} k */
function jsonKey(k) {
    return JSON.stringify(k);
}

// --- Mutation helpers ---

/**
 * Walk the parsed scene data and fill in a freshly generated
 * id for any object whose id field is missing, null, or an
 * empty string. Ids already present and non-empty are left
 * alone, even if they don't match the conventional generated
 * pattern — a user-supplied id from a hand-written scene.json
 * is respected, and the counter-advancement step run via
 * ensureIdCounters doesn't try to reconcile against
 * unconventional ids.
 *
 * Also ensures data.idCounters exists and is at least as high
 * as the next id needed for each kind: the missing sub-object
 * is created when absent, and stale counters are advanced
 * past any conventional id whose integer is higher (see
 * idGen.js ensureIdCounters for the full rule).
 *
 * The id field is inserted as the first key of the entry, so
 * the formatted JSON output (V8 preserves insertion order)
 * shows the id on the top line of the entry where a reader
 * expects to find it.
 *
 * Returns true iff at least one id was added or idCounters
 * was created or advanced; the caller can use that signal to
 * decide whether to write the mutated scene back to the
 * bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function fillMissingIds(data) {
    let changed = ensureIdCounters(data);
    /** @type {Array<["curve" | "trigger" | "sprite", string]>} */
    const kindAndKey = [
        ["curve", "curves"],
        ["trigger", "triggers"],
        ["sprite", "sprites"],
    ];
    for (const [kind, arrayKey] of kindAndKey) {
        const arr = data?.[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
            const entry = arr[i];
            if (entry === null ||
                typeof entry !== "object" ||
                Array.isArray(entry)) continue;
            if (typeof entry.id === "string" && entry.id.length > 0) continue;
            const newId = generateId(kind, data);
            // Replace the entry with a new object whose id is
            // the first key. Discard any pre-existing null or
            // empty id field so it doesn't leak through.
            const { id: _discard, ...rest } = entry;
            arr[i] = { id: newId, ...rest };
            changed = true;
        }
    }
    return changed;
}

/**
 * Walk the parsed scene data and fill in an empty name field
 * for any object that doesn't already have a name key. Always
 * inserts the name immediately after id, so the two identity
 * fields sit together at the top of the formatted entry. The
 * empty-string default is the same value the constructors
 * apply for missing names; making it visible in the JSON
 * just gives the user an obvious place to type the name they
 * want without first remembering the field exists. Existing
 * name keys are left alone regardless of their value (empty
 * string, set string, even null).
 *
 * Returns true iff at least one name was added; the caller
 * uses that signal to decide whether to write the mutated
 * scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function fillEmptyNames(data) {
    let changed = false;
    for (const arrayKey of ["curves", "triggers", "sprites"]) {
        const arr = data?.[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
            const entry = arr[i];
            if (entry === null ||
                typeof entry !== "object" ||
                Array.isArray(entry)) continue;
            if ("name" in entry) continue;
            // Walk the existing keys preserving order, and
            // insert name immediately after id. If id isn't
            // present (shouldn't happen after fillMissingIds
            // but defensive), fall back to inserting name
            // first.
            /** @type {Record<string, any>} */
            const newEntry = {};
            let inserted = false;
            for (const k of Object.keys(entry)) {
                newEntry[k] = entry[k];
                if (k === "id" && !inserted) {
                    newEntry.name = "";
                    inserted = true;
                }
            }
            arr[i] = inserted ? newEntry : { name: "", ...entry };
            changed = true;
        }
    }
    return changed;
}

/**
 * Migrate legacy circle-typed curve shapes to the unified
 * ellipse shape. Old form: { type: "circle", cx, cy, r }.
 * New form: { type: "ellipse", cx, cy, w, h } where w = h =
 * 2*r so the visual geometry is preserved exactly. Stored as
 * an ellipse regardless of whether width and height are
 * equal, so the inspector's W and H fields can be edited
 * independently without the shape's type string flipping as
 * a side effect of typing in a number.
 *
 * Done here so existing scores in IndexedDB self-update on
 * the next scene load. The Curve constructor and the canvas
 * renderer no longer recognise the "circle" type, so leaving
 * an old circle in the JSON would render as an empty curve
 * and confuse the user.
 *
 * Key order in the rebuilt shape mirrors the original: the
 * type field stays first; cx and cy keep their positions; r
 * is replaced in place by w followed by h. Any extra keys
 * the original shape carried (none in current usage but
 * defensive against hand-edited or future-versioned scores)
 * are preserved.
 *
 * Returns true iff at least one curve was migrated; the
 * caller uses that signal to decide whether to write the
 * mutated scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function cleanLegacyShapeFields(data) {
    const arr = data?.curves;
    if (!Array.isArray(arr)) return false;
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
        const entry = arr[i];
        if (entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)) continue;
        const shape = entry.shape;
        if (shape === null ||
            typeof shape !== "object" ||
            Array.isArray(shape)) continue;
        if (shape.type !== "circle") continue;
        const r = typeof shape.r === "number" ? shape.r : 0;
        /** @type {Record<string, any>} */
        const newShape = {};
        for (const k of Object.keys(shape)) {
            if (k === "type") {
                newShape.type = "ellipse";
            } else if (k === "r") {
                newShape.w = 2 * r;
                newShape.h = 2 * r;
            } else {
                newShape[k] = shape[k];
            }
        }
        // Defensive: a circle shape without an r key is
        // malformed but possible; ensure w and h are present
        // so the renderer doesn't render a degenerate ellipse.
        if (!("w" in newShape)) newShape.w = 0;
        if (!("h" in newShape)) newShape.h = 0;
        entry.shape = newShape;
        changed = true;
    }
    return changed;
}

/**
 * Strip legacy top-level scene fields that no longer have a
 * place in the v2.3 model. Currently the only such field is
 * `timeSignature`: v2.3 removes the score-level time signature
 * in favour of per-curve beatsPerBar and beatInterval (see
 * DESIGN.md §7 and §10). Existing scores that carry the field
 * have it discarded silently on next load.
 *
 * Returns true iff at least one field was stripped.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function cleanLegacySceneFields(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
    if (!("timeSignature" in data)) return false;
    delete data.timeSignature;
    return true;
}

/**
 * Rename the legacy bundle-level filename "behaviours.js" to
 * the v2.4 "behaviors.js". Bundle-level migration: doesn't
 * touch scene.json text. Preserves the file's content,
 * mimeType, and position in the bundle's file list.
 *
 * No-op when the bundle already has "behaviors.js" (whether
 * or not "behaviours.js" also exists — the new file wins).
 * If both names exist, the legacy file is removed without
 * merging content; the user's hand-edited migrations are
 * the recommended way to consolidate the two should they
 * ever coexist outside of an in-flight migration.
 *
 * Returns true iff a rename was performed.
 *
 * @param {import("./bundle.js").Bundle} bundle
 * @returns {boolean}
 */
export function migrateBehaviorsFilename(bundle) {
    const oldFile = bundle.getFile("behaviours.js");
    if (oldFile === null) return false;
    const newFile = bundle.getFile("behaviors.js");
    if (newFile !== null) {
        // Defensive: both exist. Drop the legacy one without
        // merging — the user's behaviors.js is canonical.
        bundle.removeFile("behaviours.js");
        return true;
    }
    bundle.addTextFile("behaviors.js", oldFile.content, oldFile.mimeType);
    bundle.removeFile("behaviours.js");
    return true;
}

/**
 * Fill in default canvas-size fields for scores that predate
 * the per-scene canvas size feature. Scenes loaded without
 * canvasW or canvasH get the legacy hardcoded image-region
 * dimensions (32 wide × 24 tall) so they look identical
 * before and after the migration. Each field is inserted
 * independently — a partially-edited scene that already has
 * one of the two fields keeps its existing value and only
 * picks up the missing one.
 *
 * Insertion position. The new fields land directly before
 * the first array key (curves, triggers, or sprites), which
 * is the conventional place for top-level scalars in a
 * scene.json. If no array keys are present the fields
 * append at the end of the object.
 *
 * Returns true iff at least one field was added; the caller
 * uses that signal to decide whether to write the mutated
 * scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function fillMissingCanvasSize(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
    const needW = !("canvasW" in data);
    const needH = !("canvasH" in data);
    if (!needW && !needH) return false;
    // Walk existing keys preserving order, inserting the
    // missing canvas-size fields just before the first array
    // key encountered (curves, triggers, or sprites). If no
    // array key is present, fall through to appending at the
    // end — same effect as plain assignment, but goes through
    // the same code path for consistency.
    /** @type {Record<string, any>} */
    const newData = {};
    let inserted = false;
    for (const k of Object.keys(data)) {
        if (!inserted && ARRAY_KEYS.has(k)) {
            if (needW) newData.canvasW = 32;
            if (needH) newData.canvasH = 24;
            inserted = true;
        }
        newData[k] = data[k];
    }
    if (!inserted) {
        if (needW) newData.canvasW = 32;
        if (needH) newData.canvasH = 24;
    }
    // Replace data's keys in place so callers holding a
    // reference to the same object see the new layout.
    for (const k of Object.keys(data)) delete data[k];
    for (const k of Object.keys(newData)) data[k] = newData[k];
    return true;
}

/**
 * Fill in a default engine field for scores that predate
 * the multi-engine audio architecture. Scores loaded
 * without an engine field get a hardcoded "midi" default,
 * the same engine those scores would have used before the
 * migration (midi was the legacy default for the
 * audioOutput preference that surfaced this choice as a
 * global setting). New scores created under the multi-
 * engine architecture pick up "midi" the same way via
 * sceneSchema's SCENE_FIELDS default; this migration
 * pass is the equivalent for already-existing scores.
 *
 * Insertion position. The new field lands directly before
 * the first array key (curves, triggers, or sprites),
 * which is the conventional place for top-level scalars
 * in a scene.json. If no array keys are present the field
 * appends at the end of the object. Mirrors
 * fillMissingCanvasSize's shape so engine sits alongside
 * canvasW / canvasH in the top-of-file scalar block.
 *
 * Returns true iff the field was added; the caller uses
 * that signal to decide whether to write the mutated
 * scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function fillMissingEngine(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
    if ("engine" in data && typeof data.engine === "string") return false;
    const seed = "midi";
    /** @type {Record<string, any>} */
    const newData = {};
    let inserted = false;
    for (const k of Object.keys(data)) {
        if (!inserted && ARRAY_KEYS.has(k)) {
            newData.engine = seed;
            inserted = true;
        }
        newData[k] = data[k];
    }
    if (!inserted) newData.engine = seed;
    for (const k of Object.keys(data)) delete data[k];
    for (const k of Object.keys(newData)) data[k] = newData[k];
    return true;
}

/**
 * Strip curve, trigger, and sprite fields that became
 * obsolete with the section-27 reshape: the four-slot
 * callback model replaces the old per-kind slots
 * (hitBeat, hitTrigger, collision, motionUpdate, auto),
 * the auto-message-interval mechanism is eliminated, and
 * the beat-points-era per-curve timing fields
 * (cycleDuration, beatsPerBar, beatOffset,
 * cycleSpeeds, beatPointsMode, the Euclidean trio,
 * activeBeats, strength, beatsAreTriggers) all go away.
 *
 * Existing scores in IndexedDB carry these fields in
 * their stored scene.json; the constructors silently
 * drop them on load, but the Properties JSON tab surfaces
 * stored field text directly, so this strip pass cleans
 * the stored JSON on first load after the reshape.
 * Steady-state (already-stripped) bundles are a no-op.
 *
 * The strip list also includes the pre-v2.4 transitional
 * function-slot names sprite.step, curve.beat, and
 * curve.sweep that even older scores might still carry.
 * Those were once renamed to the v2.4 names (motionUpdate,
 * hitBeat, hitTrigger), which are themselves now obsolete
 * under the section-27 model, so all of step/beat/sweep
 * and motionUpdate/hitBeat/hitTrigger are stripped
 * together.
 *
 * Returns true iff at least one field was stripped; the
 * caller uses that signal to decide whether to write the
 * mutated scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function stripObsoleteFields(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
    /** @type {Record<string, string[]>} */
    const obsoletePerKind = {
        curves: [
            "cycleDuration", "cycleBeats",
            "beatsPerBar", "beatOffset",
            "beatPointsMode", "activeBeatsCount", "beatShift",
            "repeats", "activeBeats", "strength",
            "beatsAreTriggers", "hitBeat", "hitTrigger",
            "beat", "sweep",
            "canCycle", "cyclePatternLocation",
        ],
        triggers: [
            "collision", "auto", "autoInterval", "autoBeatInterval",
            "canCycle", "cyclePatternLocation",
        ],
        sprites: [
            "motionUpdate", "auto", "autoInterval", "autoBeatInterval",
            "step",
            "canCycle", "cyclePatternLocation",
        ],
    };
    let changed = false;
    for (const kind of ["curves", "triggers", "sprites"]) {
        const arr = data[kind];
        if (!Array.isArray(arr)) continue;
        const fieldsToStrip = obsoletePerKind[kind];
        for (let i = 0; i < arr.length; i++) {
            const entry = arr[i];
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
            for (const field of fieldsToStrip) {
                if (field in entry) {
                    delete entry[field];
                    changed = true;
                }
            }
        }
    }
    return changed;
}

/**
 * Add a sprite to the parsed scene at canvas position (x, y).
 * The sprite gets a freshly generated id, x, y, and vx/vy=0.
 * Other fields fall through to the constructor defaults (no
 * step/auto, default displayDiameter). Mutates `data` in
 * place.
 * @param {any} data
 * @param {number} x
 * @param {number} y
 */
export function addSpriteAt(data, x, y) {
    if (!Array.isArray(data.sprites)) {
        data.sprites = [];
    }
    ensureIdCounters(data);
    const id = generateId("sprite", data);
    data.sprites.push({
        id,
        name: "",
        x: roundCoord(x),
        y: roundCoord(y),
        vx: 0,
        vy: 0,
    });
}

/**
 * Add a trigger to the parsed scene at canvas position
 * (x, y). The trigger gets a freshly generated id, empty
 * name, and x/y; size, color, and the callback slots fall
 * through to the Trigger constructor defaults. Mirrors
 * addSpriteAt's shape so the canvas's click-to-place path
 * for triggers is symmetric with the sprite path. Mutates
 * `data` in place.
 * @param {any} data
 * @param {number} x
 * @param {number} y
 */
export function addTriggerAt(data, x, y) {
    if (!Array.isArray(data.triggers)) {
        data.triggers = [];
    }
    ensureIdCounters(data);
    const id = generateId("trigger", data);
    data.triggers.push({
        id,
        name: "",
        x: roundCoord(x),
        y: roundCoord(y),
    });
}

/**
 * Add a curve to the parsed scene with the given shape
 * sub-object. The curve gets a freshly generated id, empty
 * name, the provided shape, and explicit cursorR and
 * cursorL of 1 (one canvas unit on each side of the
 * curve's path). curveThickness and the callback slots
 * fall through to the Curve constructor defaults. Shape
 * coordinates are rounded to two decimal places via
 * roundCoord to keep the stored JSON readable, mirroring
 * the convention used by sprite and trigger position
 * fields. The caller is responsible for supplying a shape
 * consistent with one of the supported types (line /
 * ellipse / piste); the toolbar's curve creation tool
 * produces ellipse shapes.
 *
 * Cursor extents are set explicitly here rather than left
 * to the schema's natural-zero default so newly-created
 * curves have an audible firing surface from the moment
 * they appear on the canvas. The composer can still
 * widen, narrow, or zero them through the inspector once
 * the geometry is in place. The schema default stays at
 * 0 so a hand-edited scene.json that omits the cursor
 * fields continues to behave as a no-cursor curve.
 * Mutates `data` in place.
 *
 * @param {any} data
 * @param {{type: string, cx?: number, cy?: number, w?: number, h?: number, x1?: number, y1?: number, x2?: number, y2?: number, points?: Array<[number, number]>, closed?: boolean}} shape
 */
export function addCurveAt(data, shape) {
    if (!Array.isArray(data.curves)) {
        data.curves = [];
    }
    ensureIdCounters(data);
    const id = generateId("curve", data);
    /** @type {Record<string, any>} */
    const roundedShape = { type: shape.type };
    if (shape.type === "ellipse") {
        roundedShape.cx = roundCoord(shape.cx ?? 0);
        roundedShape.cy = roundCoord(shape.cy ?? 0);
        roundedShape.w = roundCoord(shape.w ?? 0);
        roundedShape.h = roundCoord(shape.h ?? 0);
    } else if (shape.type === "line") {
        roundedShape.x1 = roundCoord(shape.x1 ?? 0);
        roundedShape.y1 = roundCoord(shape.y1 ?? 0);
        roundedShape.x2 = roundCoord(shape.x2 ?? 0);
        roundedShape.y2 = roundCoord(shape.y2 ?? 0);
    } else if (shape.type === "piste") {
        const pts = Array.isArray(shape.points) ? shape.points : [];
        roundedShape.points = pts.map((p) => [
            roundCoord(Array.isArray(p) && typeof p[0] === "number" ? p[0] : 0),
            roundCoord(Array.isArray(p) && typeof p[1] === "number" ? p[1] : 0),
        ]);
        if (shape.closed) roundedShape.closed = true;
    }
    data.curves.push({
        id,
        name: "",
        shape: roundedShape,
        cursorR: 1,
        cursorL: 1,
    });
}

/**
 * Duplicate every object in the given selection. Each
 * duplicate is a deep clone of its source with two
 * targeted changes: a freshly generated id (next in the
 * same counter sequence the toolbar's creation tools use)
 * and position offset by (dx, dy) in canvas units
 * (sprites and triggers shift their top-level x and y;
 * curves translate their shape geometry via
 * translateShape). Everything else — including
 * cyclePattern, size, color, cursor extents, callback
 * function-name references, Can-X gates, harmony
 * overrides, beatsPerCycle, name, mute, hide — carries
 * over verbatim.
 *
 * Labelled pattern blocks in behaviors.js are NOT
 * duplicated. The duplicate fires its inherited
 * cyclePattern from the moment it is created, but does
 * not appear in the Code tab until the user clicks
 * Create on the inspector's pattern row. The Create
 * button uses the duplicate's existing cyclePattern as
 * the default expression for the scaffolded labelled
 * block (see scaffoldPatternBlock's defaultExpression
 * parameter), so the labelled block lands matching what
 * is already playing rather than overwriting with the
 * bd-sn starter. If the source's pattern was a variable
 * reference like drumPat, the duplicate's cyclePattern
 * is the same string, both objects resolve drumPat in
 * behaviors.js's scope to the same value, and the
 * sharing is preserved through the variable.
 *
 * Mutates `data` in place. Returns an array of id mappings
 * (kind, oldId, newId) so the caller can locate the new
 * objects after the mutation lands. Duplicates are
 * appended to their respective arrays, so the new sprites
 * occupy indexes [oldSpritesLen, oldSpritesLen + count -
 * 1] and similarly for triggers and curves; the caller can
 * compute these from the pre-mutation array lengths
 * without consulting the returned mappings.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {number} dx
 * @param {number} dy
 * @returns {Array<{kind: "sprite" | "trigger" | "curve", oldId: string | null, newId: string}>}
 */
export function duplicateSelection(data, selection, dx, dy) {
    ensureIdCounters(data);
    /** @type {Array<{kind: "sprite" | "trigger" | "curve", oldId: string | null, newId: string}>} */
    const mappings = [];
    /** @type {Array<["sprite" | "trigger" | "curve", "sprites" | "triggers" | "curves"]>} */
    const kindAndKey = [
        ["sprite", "sprites"],
        ["trigger", "triggers"],
        ["curve", "curves"],
    ];
    for (const [kind, arrayKey] of kindAndKey) {
        const indexes = selection[arrayKey];
        if (indexes === undefined) continue;
        const arr = data[arrayKey];
        if (!Array.isArray(arr)) continue;
        // Capture the source entries before we start
        // appending. Pushing duplicates extends the array,
        // and a naive in-place iteration that consulted
        // arr[idx] after each push would risk picking up a
        // freshly-appended duplicate as a source on the
        // next round of a multi-select duplicate (an
        // out-of-range index here is harmless, but a
        // newly-duplicated entry at the original
        // selection's position would lead to a runaway
        // chain). Snapshotting the sources up front keeps
        // the loop bounded to the original selection.
        /** @type {any[]} */
        const sources = [];
        for (const idx of indexes) {
            if (idx >= 0 && idx < arr.length) {
                sources.push(arr[idx]);
            }
        }
        for (const source of sources) {
            if (source === null ||
                typeof source !== "object" ||
                Array.isArray(source)) continue;
            // Deep clone via JSON roundtrip. Scene entries
            // are JSON-safe by construction (no functions,
            // no DOM refs, no cycles), so this is the
            // simplest correct clone for our purposes.
            /** @type {any} */
            const dup = JSON.parse(JSON.stringify(source));
            const newId = generateId(kind, data);
            dup.id = newId;
            // cyclePattern is intentionally NOT cleared.
            // The deep clone above carried it over from
            // the source, and we want the duplicate to
            // fire the same pattern from the moment it
            // appears. If the source's cyclePattern is a
            // variable reference (e.g. "drumPat"), the
            // duplicate's resolves to the same value via
            // behaviors.js's scope, giving true sharing.
            // If it's a literal expression, the duplicate
            // gets its own independent copy.
            if (kind === "sprite" || kind === "trigger") {
                dup.x = roundCoord((typeof dup.x === "number" ? dup.x : 0) + dx);
                dup.y = roundCoord((typeof dup.y === "number" ? dup.y : 0) + dy);
            } else if (kind === "curve") {
                translateShape(dup.shape, dx, dy);
            }
            arr.push(dup);
            mappings.push({
                kind,
                oldId: typeof source.id === "string" ? source.id : null,
                newId,
            });
        }
    }
    return mappings;
}

/**
 * Paste a clipboard's worth of pre-cloned scene objects
 * into the parsed scene with an XY offset, fresh ids, and
 * append-to-array semantics. The clipboard's sprites,
 * triggers, and curves arrays each hold deep-clones of
 * scene entries captured at copy or cut time; this
 * function takes them, gives each a fresh id from the
 * scene's id counter, applies (dx, dy) to position
 * (sprite and trigger x/y, curve shape geometry), and
 * appends to the matching scene array. Mutates `data` in
 * place. Returns the same {kind, oldId, newId} mapping
 * array shape as duplicateSelection so the caller can
 * compute the resulting selection indexes from the pre-
 * mutation array lengths.
 *
 * Each pasted object gets a second JSON-roundtrip deep
 * clone from its clipboard source so a clipboard can
 * paste repeatedly without the second paste sharing
 * references with the first. cyclePattern carries over
 * verbatim, matching the duplicate semantics, so pasted
 * objects fire the same pattern as their sources from the
 * moment they appear.
 *
 * No behaviors.js edits fire from this function. Pasted
 * objects do NOT join their source's labelled-block chain
 * (the way duplicates do via addLabelToBlock); the caller
 * intentionally keeps paste simpler than duplicate, so a
 * paste across scores or after a cut produces independent
 * objects rather than implicitly extending some chain.
 * Inline patterns and variable-reference patterns in the
 * cyclePattern field still work because they don't depend
 * on a labelled block existing.
 *
 * @param {any} data
 * @param {{sprites?: any[], triggers?: any[], curves?: any[]}} clipboard
 * @param {number} dx
 * @param {number} dy
 * @returns {Array<{kind: "sprite" | "trigger" | "curve", oldId: string | null, newId: string}>}
 */
export function pasteObjects(data, clipboard, dx, dy) {
    ensureIdCounters(data);
    /** @type {Array<{kind: "sprite" | "trigger" | "curve", oldId: string | null, newId: string}>} */
    const mappings = [];
    /** @type {Array<["sprite" | "trigger" | "curve", "sprites" | "triggers" | "curves"]>} */
    const kindAndKey = [
        ["sprite", "sprites"],
        ["trigger", "triggers"],
        ["curve", "curves"],
    ];
    for (const [kind, arrayKey] of kindAndKey) {
        const sources = Array.isArray(clipboard[arrayKey])
            ? clipboard[arrayKey]
            : [];
        if (sources.length === 0) continue;
        if (!Array.isArray(data[arrayKey])) {
            data[arrayKey] = [];
        }
        const arr = data[arrayKey];
        for (const source of sources) {
            if (source === null ||
                typeof source !== "object" ||
                Array.isArray(source)) continue;
            /** @type {any} */
            const dup = JSON.parse(JSON.stringify(source));
            const newId = generateId(kind, data);
            dup.id = newId;
            if (kind === "sprite" || kind === "trigger") {
                dup.x = roundCoord((typeof dup.x === "number" ? dup.x : 0) + dx);
                dup.y = roundCoord((typeof dup.y === "number" ? dup.y : 0) + dy);
            } else if (kind === "curve") {
                translateShape(dup.shape, dx, dy);
            }
            arr.push(dup);
            mappings.push({
                kind,
                oldId: typeof source.id === "string" ? source.id : null,
                newId,
            });
        }
    }
    return mappings;
}

/**
 * Remove objects from the scene by kind and index. Indexes
 * refer to positions in the original arrays at the time of
 * the call; the function filters them out and the resulting
 * arrays are renumbered automatically (which is fine, since
 * the caller is expected to clear its own selection state
 * before calling). Indexes that fall out of range are
 * silently ignored, which keeps the call site simple if a
 * selection is lagging behind the JSON. Mutates `data` in
 * place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 */
export function removeObjects(data, selection) {
    const sprites = new Set(selection.sprites ?? []);
    const triggers = new Set(selection.triggers ?? []);
    const curves = new Set(selection.curves ?? []);
    if (Array.isArray(data.sprites) && sprites.size > 0) {
        data.sprites = data.sprites.filter((_, i) => !sprites.has(i));
    }
    if (Array.isArray(data.triggers) && triggers.size > 0) {
        data.triggers = data.triggers.filter((_, i) => !triggers.has(i));
    }
    if (Array.isArray(data.curves) && curves.size > 0) {
        data.curves = data.curves.filter((_, i) => !curves.has(i));
    }
}

/**
 * Set the mute field on every object in the given selection,
 * across all three kinds. Used by the inspector's Band 1
 * Mute checkbox commit. Mutates `data` in place. Indexes
 * that fall outside their array are silently ignored —
 * keeps a transient mismatch between the inspector's cached
 * scene and the just-edited bundle from breaking the commit.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {boolean} value
 */
export function setMuteOnSelection(data, selection, value) {
    setBooleanFieldOnSelection(data, selection, "mute", value, true);
}

/**
 * Set the hide field on every curve in the given selection.
 * Sprites and triggers in the selection are ignored — hide
 * is curve-only per Band 1's design. Mutates `data` in
 * place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {boolean} value
 */
export function setHideOnCurves(data, selection, value) {
    setBooleanFieldOnSelection(data, { curves: selection.curves }, "hide", value, true);
}

/**
 * Set the name field on every object in the given selection,
 * across all three kinds. Used by the inspector's Name field
 * commit on single-select. Multi-select doesn't reach this
 * path because the inspector greys the Name field, but if
 * called with a multi-select the function applies the same
 * name to every member — the resulting duplicate names
 * would be soft-blocked at validation. Mutates `data` in
 * place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setNameOnSelection(data, selection, value) {
    setStringFieldOnSelection(data, selection, "name", value);
}

// --- Band 2 (Geometry and visual) write paths ---
//
// Inspector edits to the Position, Curve W/H, Sprite/Trigger
// Size, Cursor R/L, Curve Thickness, Cursor Thickness, and
// Color fields land in the functions below. translateSelection
// also serves the canvas drag-end gesture once that pipeline
// is migrated (commit four), so a user moving objects via
// inspector edit and a user dragging on the canvas converge on
// one mutation primitive.

/**
 * Translate every selected object by (dx, dy) in canvas
 * units. Sprites and triggers shift their top-level x and y;
 * curves translate the geometry inside their shape sub-object
 * via translateShape. Indexes that fall outside the relevant
 * array are silently skipped — keeps a transient mismatch
 * between the inspector's cached scene and the just-edited
 * bundle from breaking the commit. Mutates `data` in place.
 *
 * Resulting positions are rounded to two decimal places via
 * roundCoord so floating-point precision noise from repeated
 * deltas (especially during dragging, once the drag pipeline
 * migrates here) doesn't accumulate in the JSON. The user's
 * typed values reach this function as clean two-decimal
 * numbers anyway, so for inspector edits the rounding is a
 * no-op.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {number} dx
 * @param {number} dy
 */
export function translateSelection(data, selection, dx, dy) {
    if (selection.sprites !== undefined && Array.isArray(data?.sprites)) {
        for (const idx of selection.sprites) {
            if (idx < 0 || idx >= data.sprites.length) continue;
            const s = data.sprites[idx];
            if (s === null || typeof s !== "object" || Array.isArray(s)) continue;
            s.x = roundCoord((typeof s.x === "number" ? s.x : 0) + dx);
            s.y = roundCoord((typeof s.y === "number" ? s.y : 0) + dy);
        }
    }
    if (selection.triggers !== undefined && Array.isArray(data?.triggers)) {
        for (const idx of selection.triggers) {
            if (idx < 0 || idx >= data.triggers.length) continue;
            const t = data.triggers[idx];
            if (t === null || typeof t !== "object" || Array.isArray(t)) continue;
            t.x = roundCoord((typeof t.x === "number" ? t.x : 0) + dx);
            t.y = roundCoord((typeof t.y === "number" ? t.y : 0) + dy);
        }
    }
    if (selection.curves !== undefined && Array.isArray(data?.curves)) {
        for (const idx of selection.curves) {
            if (idx < 0 || idx >= data.curves.length) continue;
            const c = data.curves[idx];
            if (c === null || typeof c !== "object" || Array.isArray(c)) continue;
            translateShape(c.shape, dx, dy);
        }
    }
}

/**
 * Set the X or Y position of every selected object to an
 * absolute target value. Used by the inspector's Position
 * field commit. Per-kind semantics:
 *   - Sprite / trigger: x or y is assigned directly.
 *   - Curve: a per-curve delta is computed as target minus
 *     the current bounding-box centroid in the relevant
 *     axis, then translateShape is applied so the curve's
 *     centroid lands at the target while preserving the
 *     curve's geometry around it.
 * Curves whose shape produces no centroid (degenerate or
 * not-yet-implemented shape types) are silently skipped.
 *
 * Absolute set is the right semantics for inspector edits in
 * both single-select (typing 5 in a field showing 3 sets X
 * to 5, the same outcome the previous translate-by-2
 * approach produced) and multi-select varies (typing 0 in
 * a blank "varies" field snaps every selected object to
 * X=0, which the previous delta approach couldn't express
 * because there was no single starting value to subtract).
 * Canvas drag still uses translateSelection because drag is
 * inherently delta-based.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {"x" | "y"} axis
 * @param {number} value
 */
export function setPositionAxisOnSelection(data, selection, axis, value) {
    if (!Number.isFinite(value)) return;
    const target = roundCoord(value);
    if (selection.sprites !== undefined && Array.isArray(data?.sprites)) {
        for (const idx of selection.sprites) {
            if (idx < 0 || idx >= data.sprites.length) continue;
            const s = data.sprites[idx];
            if (s === null || typeof s !== "object" || Array.isArray(s)) continue;
            if (axis === "x") s.x = target;
            else s.y = target;
        }
    }
    if (selection.triggers !== undefined && Array.isArray(data?.triggers)) {
        for (const idx of selection.triggers) {
            if (idx < 0 || idx >= data.triggers.length) continue;
            const t = data.triggers[idx];
            if (t === null || typeof t !== "object" || Array.isArray(t)) continue;
            if (axis === "x") t.x = target;
            else t.y = target;
        }
    }
    if (selection.curves !== undefined && Array.isArray(data?.curves)) {
        for (const idx of selection.curves) {
            if (idx < 0 || idx >= data.curves.length) continue;
            const c = data.curves[idx];
            if (c === null || typeof c !== "object" || Array.isArray(c)) continue;
            const centroid = shapeBboxCentroid(c.shape);
            if (centroid === null) continue;
            const current = axis === "x" ? centroid.x : centroid.y;
            const delta = target - current;
            if (delta === 0) continue;
            if (axis === "x") translateShape(c.shape, delta, 0);
            else translateShape(c.shape, 0, delta);
        }
    }
}

/**
 * Set the W or H bounding-box dimension of every selected
 * curve to an absolute target value. Used by the inspector's
 * Curve Size W and H field commits. Per shape type:
 *   - Ellipse: shape.w (or shape.h) is assigned directly
 *     since those fields are exactly the bbox extents. This
 *     allows growing a degenerate axis (w=0) to a non-zero
 *     value, which factor-based scaling can't do because
 *     anything times zero is zero.
 *   - Line / piste: a per-shape factor is computed as
 *     target divided by the current bbox extent in the axis,
 *     then scaleShape is applied. A degenerate axis (current
 *     extent = 0) is silently skipped because there's no
 *     factor that grows zero into a non-zero value via
 *     midpoint scaling — the shape would need to acquire
 *     extent from somewhere, and the right semantics for
 *     that aren't obvious enough to commit to here.
 * Sprites and triggers in the selection are ignored.
 *
 * Absolute set is the right semantics for inspector edits.
 * Canvas resize handles, when added, may use either this
 * primitive or scaleCurveAxis depending on the gesture.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {"x" | "y"} axis
 * @param {number} value
 */
export function setSizeAxisOnSelection(data, selection, axis, value) {
    if (!Number.isFinite(value) || value < 0) return;
    const target = roundCoord(value);
    if (selection.curves === undefined || !Array.isArray(data?.curves)) return;
    for (const idx of selection.curves) {
        if (idx < 0 || idx >= data.curves.length) continue;
        const c = data.curves[idx];
        if (c === null || typeof c !== "object" || Array.isArray(c)) continue;
        const shape = c.shape;
        if (shape === null || typeof shape !== "object" || Array.isArray(shape)) continue;
        if (shape.type === "ellipse") {
            if (axis === "x") shape.w = target;
            else shape.h = target;
            continue;
        }
        const bbox = shapeBbox(shape);
        if (bbox === null) continue;
        const current = axis === "x" ? (bbox.x2 - bbox.x1) : (bbox.y2 - bbox.y1);
        if (current === 0) continue;
        const factor = target / current;
        if (!Number.isFinite(factor) || factor === 0) continue;
        scaleShape(shape, axis, factor);
    }
}

/**
 * Scale every selected curve along one axis by the given
 * factor, keeping the curve's bounding-box centroid fixed in
 * that axis. Used by the canvas drag pipeline (commit four)
 * for resize gestures. Sprites and triggers in the selection
 * are ignored. The two axes are independent — a horizontal
 * resize emits scaleCurveAxis("x", ...) and a vertical resize
 * emits scaleCurveAxis("y", ...), and either can be applied
 * without affecting the other.
 *
 * Inspector W/H edits do NOT use this primitive; they use
 * setSizeAxisOnSelection because absolute-set semantics work
 * across single-select and multi-select varies cases without
 * a separate code path.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {"x" | "y"} axis
 * @param {number} factor
 */
export function scaleCurveAxis(data, selection, axis, factor) {
    if (selection.curves === undefined || !Array.isArray(data?.curves)) return;
    if (!Number.isFinite(factor) || factor === 0) return;
    for (const idx of selection.curves) {
        if (idx < 0 || idx >= data.curves.length) continue;
        const c = data.curves[idx];
        if (c === null || typeof c !== "object" || Array.isArray(c)) continue;
        scaleShape(c.shape, axis, factor);
    }
}

/**
 * Scale every selected object around an external anchor
 * point by independent x and y factors. Used by the
 * canvas's resize-handle gesture: dragging a handle on the
 * selection bounding box derives the anchor (the opposite
 * corner or edge midpoint) and the factors (the ratio of
 * new to old bbox dimensions in each axis) and applies
 * them through this primitive.
 *
 * Per-kind semantics:
 *
 *   - Sprite / trigger: position transforms around the
 *     anchor (new_x = ax + (old_x - ax) * sx, same for y),
 *     but the size field (displayDiameter / size) is NOT
 *     changed. Sprites and triggers reposition
 *     proportionally inside the resized bounding box; they
 *     don't grow or shrink with it. This keeps a small
 *     beat-source consistent in audible footprint even
 *     when the user resizes a group it belongs to.
 *   - Curve: geometry transforms around the anchor via
 *     scaleShapeAroundAnchor. Both vertex positions and
 *     ellipse extents (w, h) change, so a curve in the
 *     selection visibly resizes along with the bounding
 *     box.
 *
 * Indexes that fall outside their array are silently
 * skipped. Mutates `data` in place. No-op on infinite or
 * NaN factors, or factors of exactly zero (which would
 * collapse the geometry to a point and lose all shape
 * information).
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {number} ax  Anchor X in canvas units.
 * @param {number} ay  Anchor Y in canvas units.
 * @param {number} sx  X-axis scale factor.
 * @param {number} sy  Y-axis scale factor.
 */
export function scaleSelectionAroundAnchor(data, selection, ax, ay, sx, sy) {
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    if (sx === 0 || sy === 0) return;
    if (selection.sprites !== undefined && Array.isArray(data?.sprites)) {
        for (const idx of selection.sprites) {
            if (idx < 0 || idx >= data.sprites.length) continue;
            const s = data.sprites[idx];
            if (s === null || typeof s !== "object" || Array.isArray(s)) continue;
            const x = typeof s.x === "number" ? s.x : 0;
            const y = typeof s.y === "number" ? s.y : 0;
            s.x = roundCoord(ax + (x - ax) * sx);
            s.y = roundCoord(ay + (y - ay) * sy);
        }
    }
    if (selection.triggers !== undefined && Array.isArray(data?.triggers)) {
        for (const idx of selection.triggers) {
            if (idx < 0 || idx >= data.triggers.length) continue;
            const t = data.triggers[idx];
            if (t === null || typeof t !== "object" || Array.isArray(t)) continue;
            const x = typeof t.x === "number" ? t.x : 0;
            const y = typeof t.y === "number" ? t.y : 0;
            t.x = roundCoord(ax + (x - ax) * sx);
            t.y = roundCoord(ay + (y - ay) * sy);
        }
    }
    if (selection.curves !== undefined && Array.isArray(data?.curves)) {
        for (const idx of selection.curves) {
            if (idx < 0 || idx >= data.curves.length) continue;
            const c = data.curves[idx];
            if (c === null || typeof c !== "object" || Array.isArray(c)) continue;
            scaleShapeAroundAnchor(c.shape, ax, ay, sx, sy);
        }
    }
}

/**
 * Set displayDiameter on every selected sprite. Triggers and
 * curves in the selection are ignored. Mutates `data` in
 * place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setSpriteDisplayDiameterOnSelection(data, selection, value) {
    setFieldOnSelection(data, { sprites: selection.sprites }, "displayDiameter", Number(value));
}

/**
 * Set the starting X or Y axis velocity (vx or vy) on every
 * selected sprite and curve. Triggers in the selection are
 * silently ignored since triggers don't move under physics
 * and carry no vx/vy fields. Used by the inspector's
 * Starting State row vX and vY field commits, paralleling
 * setPositionAxisOnSelection's axis-parameterised shape.
 * The new value is the starting velocity for the next
 * playback run; the live runtime velocity is not snapped,
 * so a source already in motion when the edit lands
 * continues with its current velocity until the next
 * rewind or scene reload. Mutates `data` in place.
 *
 * Curves currently store the value without acting on it;
 * the per-tick translation of the curve's shape by
 * (vx, vy) lands with the curve-bounce work in a later
 * milestone. Sprites consume vx and vy through the
 * existing physics path.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {"x" | "y"} axis
 * @param {string | number} value
 */
export function setVelocityAxisOnSelection(data, selection, axis, value) {
    const field = axis === "x" ? "vx" : "vy";
    setFieldOnSelection(data, {
        sprites: selection.sprites,
        curves: selection.curves,
    }, field, Number(value));
}

/**
 * Set size on every selected trigger. Sprites and curves in
 * the selection are ignored. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setTriggerSizeOnSelection(data, selection, value) {
    setFieldOnSelection(data, { triggers: selection.triggers }, "size", Number(value));
}

/**
 * Set cursorR on every selected curve and sprite. Triggers
 * in the selection are ignored since triggers cannot have
 * cursors under the cursor-as-collider model. Mutates
 * `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setCursorROnSelection(data, selection, value) {
    setFieldOnSelection(data, {
        sprites: selection.sprites,
        curves: selection.curves,
    }, "cursorR", Number(value));
}

/**
 * Set cursorL on every selected curve and sprite. Triggers
 * in the selection are ignored since triggers cannot have
 * cursors under the cursor-as-collider model. Mutates
 * `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setCursorLOnSelection(data, selection, value) {
    setFieldOnSelection(data, {
        sprites: selection.sprites,
        curves: selection.curves,
    }, "cursorL", Number(value));
}

/**
 * Set curveThickness on every selected curve. Sprites and
 * triggers in the selection are ignored. Mutates `data` in
 * place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setCurveThicknessOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "curveThickness", Number(value));
}

/**
 * Set cursorThickness on every selected curve. Sprites and
 * triggers in the selection are ignored. Mutates `data` in
 * place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setCursorThicknessOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "cursorThickness", Number(value));
}

/**
 * Set color on every selected sprite, trigger, and curve.
 * Universal across kinds since every object kind carries a
 * per-object colour field. The value is a CSS hex string
 * stored as-is. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setColorOnSelection(data, selection, value) {
    setFieldOnSelection(data, {
        sprites: selection.sprites,
        triggers: selection.triggers,
        curves: selection.curves,
    }, "color", String(value));
}

// --- Top-level scene-field write paths ---
//
// Mutators for fields that live at the top level of
// scene.json rather than inside one of the object arrays.
// Toolbar edits (canvas size, image-import-driven scene
// updates) come through the inspector edit pipeline and
// land here.

/**
 * Set the canvas width field at the top level of scene.json.
 * Used by the toolbar's Canvas W field commit. The value is
 * the canonicalised string from the inspector's number
 * validator, parseable as a positive integer; this function
 * parses and clamps it to the documented 1..200 range
 * before storage. If canvasW isn't present in the scene,
 * the migration pass (fillMissingCanvasSize) will have
 * inserted a default before this commit ever runs, so we
 * just assign here.
 * @param {any} data
 * @param {string | number} value
 */
export function setCanvasW(data, value) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return;
    const n = clampCanvasDimension(value);
    if (n === null) return;
    data.canvasW = n;
}

/**
 * Set the canvas height field at the top level of scene.json.
 * Symmetric with setCanvasW; see that function for details.
 * @param {any} data
 * @param {string | number} value
 */
export function setCanvasH(data, value) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return;
    const n = clampCanvasDimension(value);
    if (n === null) return;
    data.canvasH = n;
}

/**
 * Set the bpm field at the top level of scene.json. Used by
 * the transport bar's BPM input commit so user-typed BPM
 * changes survive subsequent applySceneEdit round-trips.
 * Without this persistence, every inspector edit would
 * trigger runScene which calls transport.setBpm(scene.bpm)
 * and stomps the user's typed BPM back to whatever is in
 * the file. The clamp range mirrors transport.setBpm's own
 * [1, 1000] clamp so the persisted value matches what the
 * transport would have accepted from the same input. Non-
 * numeric input is treated as a no-op rather than wiping
 * the field, which matches how the BPM input handler
 * already guards against parseInt returning NaN.
 * @param {any} data
 * @param {string | number} value
 */
export function setSceneBpm(data, value) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return;
    const n = clampBpm(value);
    if (n === null) return;
    data.bpm = n;
}

/**
 * Set the engine field at the top level of scene.json.
 * Used by the property inspector's global band's Sound
 * Engine dropdown. The engine choice is per-score: it
 * lives in scene.json alongside bpm and the harmony
 * settings, and runScene's success branch pushes it into
 * firingEngine.setOutputMode so the active scene's
 * engine wins over any other source of truth. Invalid
 * values are silently no-ops, matching setSceneBpm's
 * defensive shape; the inspector's dropdown only emits
 * known tokens so this is just belt-and-braces against
 * a hand-edited scene.json or a future programmatic
 * call site.
 * @param {any} data
 * @param {string} value
 */
export function setSceneEngine(data, value) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return;
    if (typeof value !== "string") return;
    if (value !== "midi" && value !== "superdough") return;
    data.engine = value;
}

/**
 * Parse and clamp a BPM value to the documented [1, 1000]
 * range. Returns null on values that can't be coerced to a
 * finite number, which the call site treats as a no-op.
 * Non-integer numeric input rounds to the nearest integer,
 * matching Transport.setBpm's own rounding.
 * @param {string | number} value
 * @returns {number | null}
 */
function clampBpm(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return null;
    if (n < 1) return 1;
    if (n > 1000) return 1000;
    return n;
}

/**
 * Parse and clamp a canvas-dimension value to the documented
 * 1..200 range. Returns null on values that can't be
 * coerced to a finite number, which the call site treats as
 * a no-op. Non-integer numeric input rounds to the nearest
 * integer (the toolbar's validator is integer-only, so this
 * is mostly defensive against hand-edited scene.json).
 * @param {string | number} value
 * @returns {number | null}
 */
function clampCanvasDimension(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return null;
    if (n < 1) return 1;
    if (n > 200) return 200;
    return n;
}

// --- Callback slot write paths (section 27) ---
//
// Section 27 collapses the per-kind callback slots into
// four uniform slots — cycle, hasHit, beenHit, onTick —
// shared across curves, triggers, and sprites. The ten
// fields below each get one mutator, applied to every
// kind in the selection because the slots are uniform
// across kinds. The thin wrappers exist so the dispatch
// in main.js can stay one-edit-kind-per-field, matching
// the shape of the bands above.

/**
 * Set the cyclePattern field across the selection. Stored
 * verbatim. Under the cursor-as-collider model the pattern
 * fires when the source has non-zero cursor extents and is
 * unmuted; for triggers the pattern stays editable for
 * future Tier 5 collision-firing work.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setCyclePatternOnSelection(data, selection, value) {
    setStringFieldOnSelection(data, selection, "cyclePattern", String(value));
}

/**
 * Set the beatsPerCycle field across the selection. Stored
 * as an integer, clamped to a minimum of 1 since a cycle
 * with zero or fewer beats has no defined behaviour.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setBeatsPerCycleOnSelection(data, selection, value) {
    const n = Math.max(1, Math.round(Number(value)));
    if (!Number.isFinite(n)) return;
    setFieldOnSelection(data, selection, "beatsPerCycle", n);
}

/**
 * Set the beatInterval field across the selection. Stored as
 * a token string from beatIntervals.js's TOKENS table (e.g.
 * "Qtr", "8th", "Dot 16th"). Invalid tokens silently no-op,
 * so a hand-edited scene.json that injects a bogus value
 * doesn't propagate to other selected objects via this
 * setter. The field is universal across kinds since curves,
 * sprites, and triggers all carry beatInterval (triggers'
 * cycle counter is currently internal-only, but the field
 * is on the schema and stays editable from the inspector
 * for future Tier 5 collision-firing work).
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setBeatIntervalOnSelection(data, selection, value) {
    if (typeof value !== "string" || !isValidBeatInterval(value)) return;
    setFieldOnSelection(data, selection, "beatInterval", value);
}

/**
 * Set the patternRepeats field across the curve selection.
 * Sprites and triggers in the selection are ignored —
 * patternRepeats is curve-only, since only curves have a
 * visible cursor sweeping along a path where "how many
 * copies of the pattern fit" is meaningful. Stored as an
 * integer clamped to a minimum of 1. Sister to
 * setBeatsPerCycleOnSelection but scoped to curves only.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setPatternRepeatsOnCurves(data, selection, value) {
    const n = Math.max(1, Math.round(Number(value)));
    if (!Number.isFinite(n)) return;
    setFieldOnSelection(data, { curves: selection.curves }, "patternRepeats", n);
}

/**
 * Set the cycleSpeeds field across the curve selection.
 * Sprites and triggers in the selection are ignored —
 * cycleSpeeds is curve-only, since the direction-reversal
 * effect of negative entries only has visible meaning where
 * a cursor moves along a path. Stored verbatim as the
 * whitespace-separated string the user typed; the runtime
 * parser in simulation.js is responsible for converting to
 * an integer list and dropping entries after a first zero.
 *
 * Validation lives at the inspector edge
 * (validateCycleSpeeds in curveFieldValidation.js): a hard
 * error there refuses the commit, so by the time this
 * setter runs the value has been syntactically vetted as a
 * non-empty whitespace-separated integer list. Hand-edited
 * scenes that get here with malformed strings stay
 * malformed in scene.json and the runtime parser falls
 * back to [1] on load.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setCycleSpeedsOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "cycleSpeeds", String(value));
}

/**
 * Set the canHit field across the selection.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {boolean} value
 */
export function setCanHitOnSelection(data, selection, value) {
    setBooleanFieldOnSelection(data, selection, "canHit", !!value, true);
}

/**
 * Set the hasHitFunction field across the selection.
 * Value is a function name string. No validation in
 * Stage 2B; the soft-error model leaves the slot inert
 * until the named function appears in scene.functionMap.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setHasHitFunctionOnSelection(data, selection, value) {
    setStringFieldOnSelection(data, selection, "hasHitFunction", String(value));
}

/**
 * Set the canBeHit field across the selection.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {boolean} value
 */
export function setCanBeHitOnSelection(data, selection, value) {
    setBooleanFieldOnSelection(data, selection, "canBeHit", !!value, true);
}

/**
 * Set the beenHitFunction field across the selection. See
 * setHasHitFunctionOnSelection for the validation note.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setBeenHitFunctionOnSelection(data, selection, value) {
    setStringFieldOnSelection(data, selection, "beenHitFunction", String(value));
}

/**
 * Set the canTick field across the selection.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {boolean} value
 */
export function setCanTickOnSelection(data, selection, value) {
    setBooleanFieldOnSelection(data, selection, "canTick", !!value, true);
}

/**
 * Set the onTickFunction field across the selection. See
 * setHasHitFunctionOnSelection for the validation note.
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setOnTickFunctionOnSelection(data, selection, value) {
    setStringFieldOnSelection(data, selection, "onTickFunction", String(value));
}

/**
 * Append a stub function declaration to behaviors.js for a
 * Band 3 callback-slot binding (section 27 vocabulary).
 * Used by the inspector's Create button on the hasHit,
 * beenHit, or onTick rows when the proposed function name
 * doesn't yet exist in behaviors.js. The stub body is
 * generic: section 27's ctx contract for the new slots is
 * still being settled, so the body stays empty for the
 * composer to fill in once that contract lands.
 *
 * Returns { newContent, alreadyExists }. When the named
 * function already exists at the top level, alreadyExists
 * is true and newContent equals the input — no append, no
 * duplicate declaration. The Create button's enable gate
 * in the inspector should already preempt this case; the
 * defensive check here means a race (two Create clicks
 * before the first re-render lands) doesn't end up with
 * two declarations of the same name.
 *
 * The function is appended at the end of the file with a
 * blank line separator so the existing structure is left
 * undisturbed and the new declaration is easy to find.
 *
 * @param {string} content  Current behaviors.js source.
 * @param {string} functionName  Identifier to scaffold.
 * @param {"hasHit" | "beenHit" | "onTick"} slotKey
 * @returns {{ newContent: string, alreadyExists: boolean }}
 */
export function scaffoldCallbackSlotFunction(content, functionName, slotKey) {
    // Conservative regex: line starting with `function NAME(`
    // (optional `export ` prefix). Misses const/let bindings
    // to function expressions, which is acceptable here —
    // the inspector's Create gate uses scene.functionMap
    // membership built by the loader, which catches every
    // shape of top-level function declaration. This regex is
    // the second line of defence against a Create-click race.
    const re = new RegExp(
        `^[ \\t]*(?:export[ \\t]+)?function[ \\t]+${escapeForRegex(functionName)}[ \\t]*\\(`,
        "m"
    );
    if (re.test(content)) {
        return { newContent: content, alreadyExists: true };
    }
    const stub = `function ${functionName}(ctx) {\n    // Section 27 ${slotKey} slot callback.\n    // See DESIGN.md section 27 for ctx fields and return\n    // semantics.\n}\n`;
    const trimmed = content.replace(/\s+$/, "");
    const separator = trimmed.length === 0 ? "" : "\n\n";
    return { newContent: `${trimmed}${separator}${stub}`, alreadyExists: false };
}

/**
 * Append a labelled pattern block to behaviors.js for the
 * given object id. Used by the inspector's Band 1 pattern
 * row Create button (Stage A3 of the section-28 pattern-
 * authoring sequence) when no labelled block for the
 * selected object yet exists. The scaffolded form is
 * $id: sound("bd sn bd sn") — a labelled
 * ExpressionStatement whose body is a call to strudel's
 * `sound` constructor with a four-beat bass-drum / snare
 * pattern. The `bd sn bd sn` starter parses cleanly under
 * mini-notation, fires audibly through superdough once the
 * engine is loaded, and renders four marker diamonds along
 * the curve immediately on Cmd-Enter, so the user gets
 * concrete feedback from the very first promote rather
 * than a parse error from an empty string. The user is
 * expected to edit the starter to something more
 * interesting (or replace it with note(...), stack(...),
 * or any other strudel constructor) as they work; the
 * starter just makes the round trip from Create to audible
 * output land cleanly. Stage A2's splitLabelledStatements
 * recognises the block as a labelled ExpressionStatement
 * and strips it from the scene-load execution stream, so
 * the sound() call never runs at load time.
 *
 * The block is appended at the end of the file with a blank
 * line separator so the existing structure is left
 * undisturbed and the new block is easy to find.
 *
 * Unlike scaffoldCallbackSlotFunction, this function does
 * not gate on duplicate detection: section 28 explicitly
 * allows multiple labelled blocks for the same object as
 * variants. The inspector's Create button only fires when
 * no labelled block exists for the selected object, so the
 * no-duplicate case is gated on the read side; users
 * wanting additional variants type them directly in the
 * Code tab.
 *
 * The expression body defaults to the bd-sn starter
 * described above, but the caller can override it via the
 * defaultExpression parameter. The Create button path in
 * main.js passes the object's current cyclePattern, which
 * is non-empty for duplicates (which inherit the source's
 * pattern) and for any other path that pre-populates the
 * field without scaffolding a labelled block. With a
 * non-empty override the scaffolded block matches what
 * the object is already playing instead of replacing it
 * with the generic starter.
 *
 * @param {string} content  Current behaviors.js source.
 * @param {string} objectId  Identifier of the object to tag.
 * @param {string} [defaultExpression]  Override for the
 *   expression body. When omitted or empty, the bd-sn
 *   starter is used.
 * @returns {{ newContent: string }}
 */
export function scaffoldPatternBlock(content, objectId, defaultExpression) {
    const expression = (typeof defaultExpression === "string" && defaultExpression.length > 0)
        ? defaultExpression
        : "sound(\"bd sn bd sn\")";
    const block = "$" + objectId + ": " + expression + ";\n";
    const trimmed = content.replace(/\s+$/, "");
    const separator = trimmed.length === 0 ? "" : "\n\n";
    return { newContent: `${trimmed}${separator}${block}` };
}

/**
 * Add a label to an existing labelled pattern block whose
 * chain contains the given source id. The new label is
 * inserted on its own line, immediately above the line
 * holding the chain's first label, so a single-label
 * block like:
 *
 *     $CRV1: note("c d e f");
 *
 * becomes:
 *
 *     $CRV5:
 *     $CRV1: note("c d e f");
 *
 * after adding CRV5. A chain that already has stacked
 * labels keeps its existing labels in place and the new
 * label lands on top, so repeated duplicates pile up
 * above the original (newest on top). JavaScript parses
 * the stacked form as one chained LabeledStatement
 * regardless of the whitespace between labels, so the
 * loader and Cmd-Enter behaviour are unaffected; the
 * line-per-label layout is purely a readability
 * convention that makes co-labels easy to scan and edit
 * in the Code tab.
 *
 * Used by the duplicate path in performDuplicate
 * (main.js): for each duplicated object whose source
 * has a labelled block, the duplicate's id joins the
 * source's chain rather than landing as a separate
 * block elsewhere in behaviors.js. This implements
 * section 9's shared-pattern model — duplicated objects
 * join their source's sharing group automatically, and
 * editing the pattern in one place affects every label
 * on the chain.
 *
 * Chain detection mirrors the loader's
 * splitLabelledStatements and the editor's
 * _tryPromoteLabelledBlock: walk top-level
 * LabeledStatements, then descend through nested
 * LabeledStatement bodies as long as every label is
 * dollar-prefixed, until reaching the inner
 * ExpressionStatement. A chain is valid only when every
 * label along the way is dollar-prefixed and the
 * innermost body is an ExpressionStatement.
 *
 * Indentation. The new label's line picks up the
 * leading whitespace of the line containing the chain,
 * so an indented chain stays visually aligned. Top-
 * level blocks (the usual case) have no leading
 * whitespace and the new label lines up at column zero.
 * In the unusual case that the chain doesn't start at
 * a line boundary (something else precedes it on the
 * same line), the helper prepends a newline so the new
 * label still lands on its own line.
 *
 * Returns { newContent, added }. When no top-level
 * chain contains the source id, added is false and
 * newContent equals the input. Parse failures in
 * behaviors.js are also treated as a no-op (added is
 * false, content unchanged), so a broken file doesn't
 * cascade into a chained edit that compounds the
 * error.
 *
 * @param {string} content  Current behaviors.js source.
 * @param {string} sourceId  Identifier of the source
 *   object whose chain to extend.
 * @param {string} newId  Identifier to add as a new
 *   label.
 * @returns {{ newContent: string, added: boolean }}
 */
export function addLabelToBlock(content, sourceId, newId) {
    /** @type {any} */
    let ast;
    try {
        ast = acorn.parse(content, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
        });
    } catch (err) {
        return { newContent: content, added: false };
    }
    if (ast === null ||
        typeof ast !== "object" ||
        !Array.isArray(ast.body)) {
        return { newContent: content, added: false };
    }
    for (const node of ast.body) {
        if (node.type !== "LabeledStatement") continue;
        /** @type {string[]} */
        const objectIds = [];
        /** @type {any} */
        let current = node;
        let chainValid = true;
        while (current && current.type === "LabeledStatement") {
            const curLabel = current.label && current.label.name;
            if (!curLabel || curLabel[0] !== "$") {
                chainValid = false;
                break;
            }
            objectIds.push(curLabel.slice(1));
            current = current.body;
        }
        if (!chainValid) continue;
        if (!current || current.type !== "ExpressionStatement") continue;
        if (!objectIds.includes(sourceId)) continue;
        // Insert the new label as its own line
        // immediately above the chain. Indent matches
        // the leading whitespace of the line holding
        // the existing chain so the stacked labels
        // align visually. When the chain doesn't sit
        // at a line boundary (unusual but possible),
        // prepend a newline so the new label still
        // lands on its own line.
        const insertPos = node.start;
        let lineStart = insertPos;
        while (lineStart > 0 && content.charCodeAt(lineStart - 1) !== 10) {
            lineStart--;
        }
        const beforeNode = content.slice(lineStart, insertPos);
        const insert = /^\s*$/.test(beforeNode)
            ? "$" + newId + ":\n" + beforeNode
            : "\n$" + newId + ":\n";
        const newContent = content.slice(0, insertPos) + insert + content.slice(insertPos);
        return { newContent, added: true };
    }
    return { newContent: content, added: false };
}

/**
 * Remove a label from a labelled pattern block whose chain
 * contains the given object id. When the chain has more
 * than one label, the target label is dropped and the chain
 * is rebuilt in the stacked convention (one label per line
 * above a final line that carries the innermost label and
 * the expression). When the chain has only this one label,
 * the entire block is removed from behaviors.js, along with
 * one blank-line separator so adjacent blocks don't end up
 * with doubled gaps between them.
 *
 * Used by the delete path in main.js: for each deleted
 * object whose source has a labelled block, the object's
 * label is trimmed from its chain via this helper. Deleted
 * objects without a labelled block skip the trim entirely;
 * behaviors.js is left untouched. Symmetric counterpart to
 * addLabelToBlock on the duplicate path.
 *
 * Chain detection mirrors the loader's
 * splitLabelledStatements and the editor's
 * _tryPromoteLabelledBlock: walk top-level
 * LabeledStatements, then descend through nested
 * LabeledStatement bodies as long as every label is
 * dollar-prefixed, until reaching the inner
 * ExpressionStatement. A chain is valid only when every
 * label along the way is dollar-prefixed and the innermost
 * body is an ExpressionStatement.
 *
 * Rebuild format. The remaining labels are emitted in the
 * stacked convention used by addLabelToBlock: each label
 * (except the innermost) on its own line, and the innermost
 * label on the same line as the expression. The indent
 * matches the leading whitespace of the original chain so
 * an indented block stays aligned. Chains that arrived
 * here in inline form (multiple labels on one line, an
 * older convention or a hand-typed layout) are normalised
 * to the stacked form by this rebuild — the helper's only
 * way of writing labels is the stacked form, so any chain
 * touched by a delete comes out stacked.
 *
 * Returns { newContent, removed }. When no top-level chain
 * contains the object id, removed is false and newContent
 * equals the input. Parse failures in behaviors.js are also
 * treated as a no-op (removed is false, content unchanged),
 * so a broken file doesn't cascade into a destructive edit.
 *
 * @param {string} content  Current behaviors.js source.
 * @param {string} objectId  Identifier of the object whose
 *   label to trim from its chain.
 * @returns {{ newContent: string, removed: boolean }}
 */
export function removeLabelFromBlock(content, objectId) {
    /** @type {any} */
    let ast;
    try {
        ast = acorn.parse(content, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
        });
    } catch (err) {
        return { newContent: content, removed: false };
    }
    if (ast === null ||
        typeof ast !== "object" ||
        !Array.isArray(ast.body)) {
        return { newContent: content, removed: false };
    }
    for (const node of ast.body) {
        if (node.type !== "LabeledStatement") continue;
        /** @type {string[]} */
        const objectIds = [];
        /** @type {any} */
        let current = node;
        let chainValid = true;
        while (current && current.type === "LabeledStatement") {
            const curLabel = current.label && current.label.name;
            if (!curLabel || curLabel[0] !== "$") {
                chainValid = false;
                break;
            }
            objectIds.push(curLabel.slice(1));
            current = current.body;
        }
        if (!chainValid) continue;
        if (!current || current.type !== "ExpressionStatement") continue;
        if (!objectIds.includes(objectId)) continue;

        // Compute the line-start of the outer block and
        // the indent (leading whitespace of that line).
        const outerStart = node.start;
        const outerEnd = node.end;
        let lineStart = outerStart;
        while (lineStart > 0 && content.charCodeAt(lineStart - 1) !== 10) {
            lineStart--;
        }
        const beforeNode = content.slice(lineStart, outerStart);
        const indent = /^\s*$/.test(beforeNode) ? beforeNode : "";
        // Extend the removal end past the block's
        // terminator newline (if present) so removing
        // the block doesn't leave a blank line behind.
        let removalEnd = outerEnd;
        const hadTerminator =
            removalEnd < content.length &&
            content.charCodeAt(removalEnd) === 10;
        if (hadTerminator) removalEnd++;

        // Filter the labels. Drop every instance of the
        // target id (an id should appear at most once,
        // but the filter is defensive against a
        // malformed chain).
        const remaining = objectIds.filter((id) => id !== objectId);

        if (remaining.length === 0) {
            // No labels left — remove the whole block.
            // Collapse one blank-line separator if the
            // removal would otherwise leave doubled
            // blank lines.
            let dropStart = lineStart;
            let dropEnd = removalEnd;
            if (dropStart > 0 &&
                content.charCodeAt(dropStart - 1) === 10 &&
                dropEnd < content.length &&
                content.charCodeAt(dropEnd) === 10) {
                dropEnd++;
            }
            const newContent = content.slice(0, dropStart) + content.slice(dropEnd);
            return { newContent, removed: true };
        }

        // Rebuild the chain with remaining labels in
        // the stacked convention. Every label except
        // the innermost lives on its own line; the
        // innermost sits on the same line as the
        // expression.
        const expressionText = content.slice(current.start, current.end);
        const lines = [];
        for (let i = 0; i < remaining.length; i++) {
            const label = remaining[i];
            if (i < remaining.length - 1) {
                lines.push(indent + "$" + label + ":");
            } else {
                lines.push(indent + "$" + label + ": " + expressionText);
            }
        }
        const rebuilt = lines.join("\n") + (hadTerminator ? "\n" : "");
        const newContent = content.slice(0, lineStart) + rebuilt + content.slice(removalEnd);
        return { newContent, removed: true };
    }
    return { newContent: content, removed: false };
}

/**
 * Escape a string for safe inclusion in a RegExp source.
 * Used by scaffoldCallbackSlotFunction's existence check;
 * function names that pass the inspector's identifier
 * validator never contain regex metacharacters, but the
 * defensive escape covers any path that bypasses the
 * validator.
 * @param {string} s
 * @returns {string}
 */
function escapeForRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generic helper for the boolean-field setters. The
 * preserveExisting flag keeps the field's slot in the entry
 * even when the new value matches the default — so a click
 * that sets mute to false on a previously-true object
 * leaves "mute": false in the JSON rather than removing the
 * key, which keeps the field's editing footprint visible.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} fieldName
 * @param {boolean} value
 * @param {boolean} _preserveExisting
 */
function setBooleanFieldOnSelection(data, selection, fieldName, value, _preserveExisting) {
    /** @type {Array<[string, Iterable<number> | undefined]>} */
    const arrays = [
        ["sprites", selection.sprites],
        ["triggers", selection.triggers],
        ["curves", selection.curves],
    ];
    for (const [arrayKey, indexes] of arrays) {
        if (indexes === undefined) continue;
        const arr = data?.[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (const idx of indexes) {
            if (idx < 0 || idx >= arr.length) continue;
            const entry = arr[idx];
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
            entry[fieldName] = value;
        }
    }
}

/**
 * Generic helper for the string-field setters.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} fieldName
 * @param {string} value
 */
function setStringFieldOnSelection(data, selection, fieldName, value) {
    /** @type {Array<[string, Iterable<number> | undefined]>} */
    const arrays = [
        ["sprites", selection.sprites],
        ["triggers", selection.triggers],
        ["curves", selection.curves],
    ];
    for (const [arrayKey, indexes] of arrays) {
        if (indexes === undefined) continue;
        const arr = data?.[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (const idx of indexes) {
            if (idx < 0 || idx >= arr.length) continue;
            const entry = arr[idx];
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
            entry[fieldName] = value;
        }
    }
}

/**
 * Generic setter used by the curve-only Band 5 / Band 6
 * write paths (cycleDuration, cycleSpeeds, stopAtCycle,
 * activeBeats, strength). Type-agnostic: the caller is
 * responsible for parsing strings to numbers where the
 * field expects a number. Mirrors the body of the boolean
 * and string variants above; kept separate to leave the
 * existing helpers undisturbed while the inspector grows
 * its write surface.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} fieldName
 * @param {any} value
 */
function setFieldOnSelection(data, selection, fieldName, value) {
    /** @type {Array<[string, Iterable<number> | undefined]>} */
    const arrays = [
        ["sprites", selection.sprites],
        ["triggers", selection.triggers],
        ["curves", selection.curves],
    ];
    for (const [arrayKey, indexes] of arrays) {
        if (indexes === undefined) continue;
        const arr = data?.[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (const idx of indexes) {
            if (idx < 0 || idx >= arr.length) continue;
            const entry = arr[idx];
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
            entry[fieldName] = value;
        }
    }
}

/**
 * Round canvas coordinates to two decimal places. Keeps the
 * JSON readable and avoids trailing precision noise from
 * floating-point arithmetic during drag operations.
 * @param {number} n
 * @returns {number}
 */
function roundCoord(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Compute the axis-aligned bounding box of a curve shape, or
 * null if the shape is degenerate or not yet implemented.
 * Used by setPositionAxisOnSelection and
 * setSizeAxisOnSelection. Mirrors the inspector module's
 * computeShapeBbox; kept as a separate copy here to avoid
 * the layering inversion that would result from sceneEditor
 * importing inspector.
 *
 * @param {any} shape
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
function shapeBbox(shape) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return null;
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
 * Bounding-box centroid of a curve shape, or null if the
 * shape is degenerate or not yet implemented.
 *
 * @param {any} shape
 * @returns {{ x: number, y: number } | null}
 */
function shapeBboxCentroid(shape) {
    const bbox = shapeBbox(shape);
    if (bbox === null) return null;
    return {
        x: (bbox.x1 + bbox.x2) / 2,
        y: (bbox.y1 + bbox.y2) / 2,
    };
}

/**
 * Translate a curve shape sub-object by (dx, dy) in canvas
 * units. Per shape type:
 *   - line: both endpoints shift
 *   - ellipse: cx and cy shift; w and h are extent fields
 *     and don't move under translation
 *   - piste: each point in the points array shifts
 * Other shape types (bezier, helice) are silently skipped —
 * they're documented in DESIGN.md §4 but not yet implemented
 * as geometry-bearing primitives. Mutates the shape in place.
 * Defensive against missing or non-numeric coordinate fields
 * so a partially-formed shape from hand-edited JSON doesn't
 * crash the edit pipeline.
 *
 * @param {any} shape
 * @param {number} dx
 * @param {number} dy
 */
function translateShape(shape, dx, dy) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return;
    if (shape.type === "line") {
        shape.x1 = roundCoord((typeof shape.x1 === "number" ? shape.x1 : 0) + dx);
        shape.y1 = roundCoord((typeof shape.y1 === "number" ? shape.y1 : 0) + dy);
        shape.x2 = roundCoord((typeof shape.x2 === "number" ? shape.x2 : 0) + dx);
        shape.y2 = roundCoord((typeof shape.y2 === "number" ? shape.y2 : 0) + dy);
    } else if (shape.type === "ellipse") {
        shape.cx = roundCoord((typeof shape.cx === "number" ? shape.cx : 0) + dx);
        shape.cy = roundCoord((typeof shape.cy === "number" ? shape.cy : 0) + dy);
    } else if (shape.type === "piste") {
        if (!Array.isArray(shape.points)) return;
        for (let i = 0; i < shape.points.length; i++) {
            const p = shape.points[i];
            if (!Array.isArray(p) || p.length < 2) continue;
            p[0] = roundCoord((typeof p[0] === "number" ? p[0] : 0) + dx);
            p[1] = roundCoord((typeof p[1] === "number" ? p[1] : 0) + dy);
        }
    }
}

/**
 * Scale a curve shape along one axis ("x" or "y") by a
 * factor, keeping the bounding-box centroid in that axis
 * fixed so the shape distorts in place rather than walking
 * across the canvas. Per shape type:
 *   - line: each endpoint's coordinate scales around the
 *     midpoint between the two endpoints
 *   - ellipse: w (axis x) or h (axis y) scales by factor;
 *     cx/cy stay put because the bbox centroid is exactly
 *     (cx, cy) for a centred ellipse
 *   - piste: bbox centroid in the scaling axis is computed
 *     from the points array, then each point's coordinate
 *     in that axis scales around the centroid
 * Mutates the shape in place. Other shape types skipped.
 *
 * @param {any} shape
 * @param {"x" | "y"} axis
 * @param {number} factor
 */
function scaleShape(shape, axis, factor) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return;
    if (shape.type === "line") {
        if (axis === "x") {
            const x1 = typeof shape.x1 === "number" ? shape.x1 : 0;
            const x2 = typeof shape.x2 === "number" ? shape.x2 : 0;
            const mid = (x1 + x2) / 2;
            shape.x1 = roundCoord(mid + (x1 - mid) * factor);
            shape.x2 = roundCoord(mid + (x2 - mid) * factor);
        } else {
            const y1 = typeof shape.y1 === "number" ? shape.y1 : 0;
            const y2 = typeof shape.y2 === "number" ? shape.y2 : 0;
            const mid = (y1 + y2) / 2;
            shape.y1 = roundCoord(mid + (y1 - mid) * factor);
            shape.y2 = roundCoord(mid + (y2 - mid) * factor);
        }
    } else if (shape.type === "ellipse") {
        if (axis === "x") {
            const w = typeof shape.w === "number" ? shape.w : 0;
            shape.w = roundCoord(w * factor);
        } else {
            const h = typeof shape.h === "number" ? shape.h : 0;
            shape.h = roundCoord(h * factor);
        }
    } else if (shape.type === "piste") {
        if (!Array.isArray(shape.points) || shape.points.length === 0) return;
        const ai = axis === "x" ? 0 : 1;
        let min = Infinity;
        let max = -Infinity;
        for (const p of shape.points) {
            if (Array.isArray(p) && typeof p[ai] === "number") {
                if (p[ai] < min) min = p[ai];
                if (p[ai] > max) max = p[ai];
            }
        }
        if (!Number.isFinite(min)) return;
        const mid = (min + max) / 2;
        for (const p of shape.points) {
            if (Array.isArray(p) && typeof p[ai] === "number") {
                p[ai] = roundCoord(mid + (p[ai] - mid) * factor);
            }
        }
    }
}

/**
 * Scale a curve shape around an external anchor point by
 * independent x and y factors. Used by
 * scaleSelectionAroundAnchor (resize-handle gesture). Per
 * shape type:
 *   - line: each endpoint's coordinates transform as
 *     new = anchor + (old - anchor) * scale, with sx and sy
 *     applied independently.
 *   - ellipse: cx/cy transform around the anchor (the
 *     ellipse translates as a whole); w/h scale by
 *     Math.abs(sx) and Math.abs(sy). Absolute value because
 *     w and h are scalar magnitudes — a negative scale
 *     factor would otherwise produce a negative dimension,
 *     which the renderer treats as malformed. The visual
 *     outcome of a negative factor (mirror) is achieved by
 *     the cx/cy transform alone, since the ellipse is
 *     centrally symmetric and looks identical mirrored.
 *   - piste: each point in the points array transforms
 *     around the anchor with independent sx and sy.
 * Other shape types are silently skipped. Mutates the
 * shape in place. Defensive against missing or non-numeric
 * coordinate fields so a partially-formed shape from
 * hand-edited JSON doesn't crash the edit pipeline.
 *
 * @param {any} shape
 * @param {number} ax
 * @param {number} ay
 * @param {number} sx
 * @param {number} sy
 */
function scaleShapeAroundAnchor(shape, ax, ay, sx, sy) {
    if (shape === null || typeof shape !== "object" || Array.isArray(shape)) return;
    if (shape.type === "line") {
        const x1 = typeof shape.x1 === "number" ? shape.x1 : 0;
        const y1 = typeof shape.y1 === "number" ? shape.y1 : 0;
        const x2 = typeof shape.x2 === "number" ? shape.x2 : 0;
        const y2 = typeof shape.y2 === "number" ? shape.y2 : 0;
        shape.x1 = roundCoord(ax + (x1 - ax) * sx);
        shape.y1 = roundCoord(ay + (y1 - ay) * sy);
        shape.x2 = roundCoord(ax + (x2 - ax) * sx);
        shape.y2 = roundCoord(ay + (y2 - ay) * sy);
    } else if (shape.type === "ellipse") {
        const cx = typeof shape.cx === "number" ? shape.cx : 0;
        const cy = typeof shape.cy === "number" ? shape.cy : 0;
        const w = typeof shape.w === "number" ? shape.w : 0;
        const h = typeof shape.h === "number" ? shape.h : 0;
        shape.cx = roundCoord(ax + (cx - ax) * sx);
        shape.cy = roundCoord(ay + (cy - ay) * sy);
        shape.w = roundCoord(w * Math.abs(sx));
        shape.h = roundCoord(h * Math.abs(sy));
    } else if (shape.type === "piste") {
        if (!Array.isArray(shape.points)) return;
        for (let i = 0; i < shape.points.length; i++) {
            const p = shape.points[i];
            if (!Array.isArray(p) || p.length < 2) continue;
            const x = typeof p[0] === "number" ? p[0] : 0;
            const y = typeof p[1] === "number" ? p[1] : 0;
            p[0] = roundCoord(ax + (x - ax) * sx);
            p[1] = roundCoord(ay + (y - ay) * sy);
        }
    }
}
