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

import { generateId, collectExistingIds } from "./idGen.js";

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
 * alone, even if they don't match the generated pattern — a
 * user-supplied id from a hand-written scene.json is
 * respected.
 *
 * The id field is inserted as the first key of the entry, so
 * the formatted JSON output (V8 preserves insertion order)
 * shows the id on the top line of the entry where a reader
 * expects to find it.
 *
 * Returns true iff at least one id was added; the caller can
 * use that signal to decide whether to write the mutated
 * scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function fillMissingIds(data) {
    const existing = collectExistingIds(data);
    let changed = false;
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
            const newId = generateId(kind, existing);
            existing.add(newId);
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
 * Clean up vestigial curve fields from scores created before
 * the cycle-parameter simplification. cycleBeats is renamed
 * to cycleDuration (preserving the stored value, since the
 * field's meaning carries over: cycle duration in score
 * beats); beatsPerCycle is dropped entirely. If both
 * cycleBeats and cycleDuration are present in the same
 * entry, cycleDuration wins and cycleBeats is dropped.
 *
 * Done here so existing scores in IndexedDB clean themselves
 * up on the next scene load without losing curve timing.
 * The Curve constructor no longer reads cycleBeats or
 * beatsPerCycle, so leaving those fields in the JSON would
 * just be inert clutter — visible in the JSON tab and
 * confusing to the user.
 *
 * Returns true iff at least one entry was changed; the caller
 * uses that signal to decide whether to write the mutated
 * scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function cleanLegacyCurveFields(data) {
    const arr = data?.curves;
    if (!Array.isArray(arr)) return false;
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
        const entry = arr[i];
        if (entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)) continue;
        const hasCycleBeats = "cycleBeats" in entry;
        const hasCycleDuration = "cycleDuration" in entry;
        const hasBeatsPerCycle = "beatsPerCycle" in entry;
        if (!hasCycleBeats && !hasBeatsPerCycle) continue;
        // Rebuild the entry preserving key order, substituting
        // cycleBeats → cycleDuration where appropriate and
        // dropping beatsPerCycle. The position of cycleBeats
        // in the original entry's key sequence becomes the
        // position of cycleDuration in the new entry, so the
        // formatted JSON keeps the cycle field in roughly the
        // same visual location it occupied before.
        /** @type {Record<string, any>} */
        const newEntry = {};
        for (const k of Object.keys(entry)) {
            if (k === "beatsPerCycle") continue;
            if (k === "cycleBeats") {
                if (hasCycleDuration) continue;
                newEntry["cycleDuration"] = entry[k];
                continue;
            }
            newEntry[k] = entry[k];
        }
        arr[i] = newEntry;
        changed = true;
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
    const id = generateId("sprite", collectExistingIds(data));
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

/**
 * Set the cycleDuration field on every curve in the
 * selection. Sprites and triggers in the selection are
 * ignored — cycleDuration is curve-only. The value is the
 * canonicalised string from the inspector's validator,
 * always parseable as a positive integer; this function
 * parses it for storage. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setCycleDurationOnCurves(data, selection, value) {
    const n = Math.round(Number(value));
    setFieldOnSelection(data, { curves: selection.curves }, "cycleDuration", n);
}

/**
 * Set the cycleSpeeds field on every curve in the selection.
 * Sprites and triggers in the selection are ignored. The
 * value is a whitespace-separated multiplier string and is
 * stored as-is. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setCycleSpeedsOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "cycleSpeeds", value);
}

/**
 * Set the stopAtCycle field on every curve in the selection.
 * Sprites and triggers in the selection are ignored. The
 * value is the canonicalised string from the inspector's
 * validator, always parseable as an integer; this function
 * parses it for storage. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setStopAtCycleOnCurves(data, selection, value) {
    const n = Math.round(Number(value));
    setFieldOnSelection(data, { curves: selection.curves }, "stopAtCycle", n);
}

/**
 * Set the activeBeats field on every curve in the selection.
 * Sprites and triggers in the selection are ignored. The
 * value is a string of "x" and "." characters (or empty,
 * which mutes the rhythm) and is stored as-is. Mutates
 * `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setActiveBeatsOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "activeBeats", value);
}

/**
 * Set the strength field on every curve in the selection.
 * Sprites and triggers in the selection are ignored. The
 * value is a digit string 0-9 (or empty, which mutes the
 * beats) and is stored as-is. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setStrengthOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "strength", value);
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
 * Set cursorR on every selected curve. Sprites and triggers
 * in the selection are ignored. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setCursorROnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "cursorR", Number(value));
}

/**
 * Set cursorL on every selected curve. Sprites and triggers
 * in the selection are ignored. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string | number} value
 */
export function setCursorLOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "cursorL", Number(value));
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
 * Set color on every selected sprite and trigger. Curves in
 * the selection are ignored — curves carry no per-object
 * colour field at this milestone; their stroke uses the
 * global CURVE_COLOUR constant. (A curve-colour discussion is
 * deferred to a future commit.) The value is a CSS hex string
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
    }, "color", String(value));
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
