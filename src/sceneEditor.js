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
 * Update positions of multiple sprites in one shot. The
 * `positions` parameter is a Map from sprite index to {x, y}.
 * Mutates `data` in place.
 * @param {any} data
 * @param {Map<number, {x: number, y: number}>} positions
 */
export function setSpritePositions(data, positions) {
    if (!Array.isArray(data.sprites)) return;
    for (const [idx, pos] of positions) {
        if (idx < 0 || idx >= data.sprites.length) continue;
        const entry = data.sprites[idx];
        if (typeof entry !== "object" || entry === null) continue;
        entry.x = roundCoord(pos.x);
        entry.y = roundCoord(pos.y);
    }
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
 * Round canvas coordinates to two decimal places. Keeps the
 * JSON readable and avoids trailing precision noise from
 * floating-point arithmetic during drag operations.
 * @param {number} n
 * @returns {number}
 */
function roundCoord(n) {
    return Math.round(n * 100) / 100;
}
