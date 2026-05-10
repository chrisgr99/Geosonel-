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
import { generateEuclideanPattern } from "./euclidean.js";

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
 * Add the v2.3 per-curve musical-timing fields
 * (beatInterval, beatsPerBar, beatOffset) and the
 * beatPointsMode field to any curve missing them. Defaults
 * preserve pre-v2.3 audible behaviour: beatInterval "Qtr"
 * (so cycleDuration N still corresponds to N quarter-notes
 * of cycle time), beatsPerBar 4 (the most common time-
 * signature numerator), beatOffset 0 (the cursor still
 * starts at slot 0 on rewind), beatPointsMode "normal" (the
 * stored activeBeats string is the source of truth, matching
 * how pre-v2.3 scores were authored).
 *
 * Field positioning is chosen to match the JSON-on-disk
 * order documented in DESIGN.md §14's example. The timing
 * fields land directly after cycleDuration; beatPointsMode
 * lands directly before activeBeats. The Euclidean parameter
 * fields (activeBeatsCount, beatShift, repeats) are NOT
 * inserted by this pass, since legacy scores are never in
 * euclidean mode and adding inert parameters to every curve
 * would be schema clutter.
 *
 * Returns true iff at least one entry was changed; the
 * caller uses that signal to decide whether to write the
 * mutated scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function fillMissingMusicalTimingFields(data) {
    const arr = data?.curves;
    if (!Array.isArray(arr)) return false;
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
        const entry = arr[i];
        if (entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)) continue;

        const need = {
            beatInterval: !("beatInterval" in entry),
            beatsPerBar: !("beatsPerBar" in entry),
            beatOffset: !("beatOffset" in entry),
            beatPointsMode: !("beatPointsMode" in entry),
        };
        if (!need.beatInterval &&
            !need.beatsPerBar &&
            !need.beatOffset &&
            !need.beatPointsMode) continue;

        // Walk existing keys preserving order, inserting new
        // fields at sensible anchor points.
        /** @type {Record<string, any>} */
        const newEntry = {};
        let beatPointsModeInserted = false;
        for (const k of Object.keys(entry)) {
            if (k === "activeBeats" && need.beatPointsMode && !beatPointsModeInserted) {
                newEntry.beatPointsMode = "normal";
                beatPointsModeInserted = true;
            }
            newEntry[k] = entry[k];
            if (k === "cycleDuration") {
                if (need.beatInterval) newEntry.beatInterval = "Qtr";
                if (need.beatsPerBar) newEntry.beatsPerBar = 4;
                if (need.beatOffset) newEntry.beatOffset = 0;
            }
        }
        // Fallbacks for entries missing the natural anchors.
        // A curve without cycleDuration is unusual but possible;
        // a curve without activeBeats likewise. Append in those
        // cases so the fields still get filled in.
        if (need.beatInterval && !("beatInterval" in newEntry)) {
            newEntry.beatInterval = "Qtr";
        }
        if (need.beatsPerBar && !("beatsPerBar" in newEntry)) {
            newEntry.beatsPerBar = 4;
        }
        if (need.beatOffset && !("beatOffset" in newEntry)) {
            newEntry.beatOffset = 0;
        }
        if (need.beatPointsMode && !beatPointsModeInserted) {
            newEntry.beatPointsMode = "normal";
        }

        arr[i] = newEntry;
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
 * Rename pre-v2.4 function-slot field names to their v2.4
 * equivalents on every curve, trigger, and sprite entry:
 *
 *   - sprite.step → sprite.motionUpdate
 *   - curve.beat → curve.hitBeat
 *   - curve.sweep → curve.hitTrigger
 *
 * Trigger.collision and trigger.auto are unchanged; sprite.auto
 * is unchanged; the renaming only touches slots whose
 * conceptual name changed in v2.4 (see DESIGN.md §9). The
 * stored value (typically a function-name string) is preserved
 * verbatim, so a curve that referenced "circleBeat" before now
 * references "circleBeat" through the new hitBeat key. The
 * composer is free to rename the function in behaviors.js to
 * match the new convention (hitBeat_circle) but is not required
 * to.
 *
 * Field positioning preserves key order: the new key replaces
 * the old key in the entry's key sequence, so the formatted
 * JSON keeps the slot in roughly the same visual location.
 * Entries already in v2.4 form (no legacy keys) are skipped.
 * If both legacy and new keys coexist (a partially-migrated
 * entry, possible in hand-edited JSON), the new key wins and
 * the legacy key is dropped.
 *
 * Returns true iff at least one entry was changed.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function renameFunctionSlotFields(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
    let changed = false;
    /** @type {Array<[string, Record<string, string>]>} */
    const renamesPerKind = [
        ["curves", { beat: "hitBeat", sweep: "hitTrigger" }],
        ["sprites", { step: "motionUpdate" }],
        // Triggers carry no slot-name renames in v2.4 (Collision
        // and Auto labels are unchanged); listed here as an
        // empty map for symmetry so a future rename only adds
        // an entry rather than restructuring the loop.
        ["triggers", {}],
    ];
    for (const [arrayKey, renames] of renamesPerKind) {
        const renameKeys = Object.keys(renames);
        if (renameKeys.length === 0) continue;
        const arr = data[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
            const entry = arr[i];
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
            const present = renameKeys.filter((k) => k in entry);
            if (present.length === 0) continue;
            // Walk existing keys preserving order, replacing
            // each legacy key with its new key (and value)
            // in place. If the new key is already present
            // (partially-migrated entry), the new value wins
            // and the legacy key is dropped without inserting
            // a duplicate.
            /** @type {Record<string, any>} */
            const newEntry = {};
            for (const k of Object.keys(entry)) {
                if (k in renames) {
                    const newKey = renames[k];
                    if (newKey in entry) {
                        // The new key already lives on the
                        // entry at its own position, so we
                        // simply drop the legacy key here
                        // and let the new key carry through
                        // when its own iteration reaches it.
                        continue;
                    }
                    newEntry[newKey] = entry[k];
                } else {
                    newEntry[k] = entry[k];
                }
            }
            arr[i] = newEntry;
            changed = true;
        }
    }
    return changed;
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
 * Strip curve, trigger, and sprite fields that became
 * obsolete with the section-27 reshape: the four-slot
 * callback model replaces the old per-kind slots
 * (hitBeat, hitTrigger, collision, motionUpdate, auto),
 * the auto-message-interval mechanism is eliminated, and
 * the beat-points-era per-curve timing fields
 * (cycleDuration, beatInterval, beatsPerBar, beatOffset,
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
            "cycleDuration", "cycleBeats", "beatInterval",
            "beatsPerBar", "beatOffset", "cycleSpeeds",
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
    const indexes = selection.curves;
    if (indexes === undefined) return;
    const arr = data?.curves;
    if (!Array.isArray(arr)) return;
    for (const idx of indexes) {
        if (idx < 0 || idx >= arr.length) continue;
        const entry = arr[idx];
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        entry.cycleDuration = n;
        // Clamp Euclidean parameters that depend on cycleDuration
        // for their valid range. activeBeatsCount cannot exceed
        // cycleDuration (you can't have more actives than slots);
        // repeats cannot exceed cycleDuration (you can't have
        // more repeats than slots). Clamping here matches the
        // validators' clamp ranges so a programmatic edit and
        // an inspector edit converge on the same valid state.
        if (typeof entry.activeBeatsCount === "number" && entry.activeBeatsCount > n) {
            entry.activeBeatsCount = n;
        }
        if (typeof entry.repeats === "number" && entry.repeats > n) {
            entry.repeats = Math.max(1, n);
        }
        // Regenerate activeBeats from Euclidean parameters if
        // the curve is in euclidean mode — the new cycleDuration
        // changes how many slots the pattern fills.
        regenerateActiveBeatsIfEuclidean(entry);
    }
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

/**
 * Set the beatInterval field on every curve in the selection.
 * Sprites and triggers in the selection are ignored. The
 * value is a token from the fixed list in beatIntervals.js;
 * the inspector's validator gates the input, so the value is
 * stored as-is. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setBeatIntervalOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "beatInterval", String(value));
}

/**
 * Set the beatsPerBar field on every curve in the selection,
 * and recompute the pipe-character placement in each curve's
 * activeBeats and strength strings to reflect the new bar
 * size. Sprites and triggers in the selection are ignored.
 * The value is the canonicalised string from the inspector's
 * validator, always parseable as a positive integer; this
 * function parses it for storage. Mutates `data` in place.
 *
 * Per DESIGN.md §10's pipe-character rule, pipes are
 * display-only formatting auto-inserted by the inspector at
 * positions k×beatsPerBar where the typed-character count is
 * at least k×beatsPerBar. When beatsPerBar changes, those
 * positions move, so the stored strings need their pipes
 * repositioned. The repipeWithBars helper strips existing
 * pipes (and any spaces) and re-inserts pipes at the new
 * positions. The engine sees no change since it strips both
 * before cycling.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setBeatsPerBarOnCurves(data, selection, value) {
    const n = Math.max(1, Math.round(Number(value)));
    const indexes = selection.curves;
    if (indexes === undefined) return;
    const arr = data?.curves;
    if (!Array.isArray(arr)) return;
    for (const idx of indexes) {
        if (idx < 0 || idx >= arr.length) continue;
        const entry = arr[idx];
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        entry.beatsPerBar = n;
        if (typeof entry.activeBeats === "string") {
            entry.activeBeats = repipeWithBars(entry.activeBeats, n);
        }
        if (typeof entry.strength === "string") {
            entry.strength = repipeWithBars(entry.strength, n);
        }
    }
}

/**
 * Set the beatOffset field on every curve in the selection.
 * Sprites and triggers in the selection are ignored. The
 * value is the canonicalised string from the inspector's
 * validator, always parseable as a signed integer; this
 * function parses it for storage. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setBeatOffsetOnCurves(data, selection, value) {
    const n = Math.round(Number(value));
    setFieldOnSelection(data, { curves: selection.curves }, "beatOffset", n);
}

/**
 * Switch every selected curve to a new beat-points mode
 * ("normal", "euclidean", or "none"). Sprites and triggers
 * in the selection are ignored. The mode change carries
 * side effects per DESIGN.md §10's mode-switching rules:
 *
 *   - To euclidean: ensure activeBeatsCount, beatShift, and
 *     repeats are present on the entry (defaulting any
 *     missing field to 0, 0, and 1 respectively, matching
 *     the question-3 design that fresh Euclidean mode
 *     starts with zero actives), then regenerate
 *     activeBeats from those parameters. Pre-existing
 *     parameter values from a hand-edited JSON survive the
 *     transition.
 *
 *   - To normal: delete activeBeatsCount, beatShift, and
 *     repeats so the JSON only carries the parameters when
 *     the mode actually uses them. If restoreActiveBeats is
 *     supplied (typically by the inspector restoring its
 *     none-mode stash), the curve's activeBeats is replaced
 *     with that string, with pipe-character placement
 *     applied per beatsPerBar. Otherwise activeBeats is
 *     left as-is — either the previously-generated string
 *     from euclidean mode (which becomes the user's
 *     editable starting content) or whatever was already
 *     there.
 *
 *   - To none: delete the Euclidean parameters as above,
 *     and replace activeBeats with ".", which the engine
 *     reads as a single rest cycling forever. The diamond
 *     beat-point markers don't render in none mode (the
 *     inspector's render path checks beatPointsMode).
 *
 * Curves whose mode already equals newMode are skipped
 * entirely — no parameter resets, no regeneration, no
 * activeBeats overwrite.
 *
 * Field insertion order: when adding the Euclidean
 * parameters to an entry that didn't have them, they go
 * directly after beatPointsMode in the entry's key sequence,
 * matching the JSON-on-disk layout in DESIGN.md §14's
 * example for euclidean-mode curves.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} newMode  One of "normal", "euclidean", "none".
 * @param {string | null} [restoreActiveBeats]  Optional string used as
 *     the new activeBeats when transitioning to normal mode
 *     (typically the previous activeBeats stashed by the
 *     inspector when the user entered none mode).
 */
export function setBeatPointsModeOnCurves(data, selection, newMode, restoreActiveBeats = null) {
    if (newMode !== "normal" && newMode !== "euclidean" && newMode !== "none") return;
    const indexes = selection.curves;
    if (indexes === undefined) return;
    const arr = data?.curves;
    if (!Array.isArray(arr)) return;
    for (const idx of indexes) {
        if (idx < 0 || idx >= arr.length) continue;
        const entry = arr[idx];
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        const oldMode = entry.beatPointsMode;
        if (oldMode === newMode) continue;
        const beatsPerBar = typeof entry.beatsPerBar === "number" ? entry.beatsPerBar : 4;
        if (newMode === "euclidean") {
            ensureFieldsAfter(entry, "beatPointsMode", {
                activeBeatsCount: 0,
                beatShift: 0,
                repeats: 1,
            });
            entry.beatPointsMode = "euclidean";
            regenerateActiveBeatsIfEuclidean(entry);
        } else if (newMode === "normal") {
            delete entry.activeBeatsCount;
            delete entry.beatShift;
            delete entry.repeats;
            entry.beatPointsMode = "normal";
            if (typeof restoreActiveBeats === "string") {
                entry.activeBeats = repipeWithBars(restoreActiveBeats, beatsPerBar);
            }
        } else {
            // newMode === "none"
            delete entry.activeBeatsCount;
            delete entry.beatShift;
            delete entry.repeats;
            entry.beatPointsMode = "none";
            entry.activeBeats = ".";
        }
    }
}

/**
 * Set one of the three Euclidean parameters
 * (activeBeatsCount, beatShift, repeats) on every curve in
 * the selection, then regenerate activeBeats from the new
 * parameter set for any curve currently in euclidean mode.
 * Sprites and triggers in the selection are ignored.
 *
 * The value is the canonicalised string from the inspector's
 * validator, always parseable as an integer; this function
 * parses it for storage. Mutates `data` in place.
 *
 * Curves not in euclidean mode are skipped — storing
 * Euclidean parameter values on a curve in normal or none
 * mode would clutter the JSON with fields that the engine
 * does not read, and per our mode-switching design the
 * params are reset to (0, 0, 1) on the next entry into
 * euclidean mode anyway, so any pre-populated values would
 * be lost on transition.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {"activeBeatsCount" | "beatShift" | "repeats"} paramName
 * @param {string} value
 */
export function setEuclideanParameterOnCurves(data, selection, paramName, value) {
    if (paramName !== "activeBeatsCount" &&
        paramName !== "beatShift" &&
        paramName !== "repeats") return;
    const n = Math.round(Number(value));
    const indexes = selection.curves;
    if (indexes === undefined) return;
    const arr = data?.curves;
    if (!Array.isArray(arr)) return;
    for (const idx of indexes) {
        if (idx < 0 || idx >= arr.length) continue;
        const entry = arr[idx];
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        if (entry.beatPointsMode !== "euclidean") continue;
        entry[paramName] = n;
        regenerateActiveBeatsIfEuclidean(entry);
    }
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

// --- Band 3 / Band 4 (Message function slots and auto-beat-interval) write paths ---
//
// Each slot field (motionUpdate, hitBeat, hitTrigger,
// collision, auto) holds a STRING name pointing into
// behaviors.js. Empty string is the unbound state. The
// inspector's slot-field commits and Create button land in
// the per-slot mutators below; selection-kind dispatch
// happens in main.js's applyInspectorEdit so the inspector
// only has to know which slot it's editing, not which
// mutator name maps to it.
//
// Slots are kind-specific by design (DESIGN.md §9):
// motionUpdate is sprite-only, hitBeat / hitTrigger are
// curve-only, collision is trigger-only, auto exists on
// both sprites and triggers but with separate semantics
// (sprite Auto fires on the sprite's beat-aligned timer;
// trigger Auto fires on the trigger's). The mutators take
// a selection slice keyed to their kind so a multi-kind
// selection edit only touches objects whose kind matches
// the slot.

/**
 * Set the motionUpdate slot field on every selected sprite.
 * Triggers and curves in the selection are ignored —
 * motionUpdate is sprite-only. Empty value clears the bind
 * (the sprite then falls back to the conventional shared
 * `motionUpdate` function in behaviors.js per the shared-
 * default rule from DESIGN.md §9). Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setMotionUpdateOnSprites(data, selection, value) {
    setFieldOnSelection(data, { sprites: selection.sprites }, "motionUpdate", String(value));
}

/**
 * Set the auto slot field on every selected sprite.
 * Triggers and curves in the selection are ignored. Empty
 * value clears the bind. Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setAutoOnSprites(data, selection, value) {
    setFieldOnSelection(data, { sprites: selection.sprites }, "auto", String(value));
}

/**
 * Set the collision slot field on every selected trigger.
 * Sprites and curves in the selection are ignored —
 * collision is trigger-only. Empty value clears the bind.
 * Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setCollisionOnTriggers(data, selection, value) {
    setFieldOnSelection(data, { triggers: selection.triggers }, "collision", String(value));
}

/**
 * Set the auto slot field on every selected trigger.
 * Sprites and curves in the selection are ignored. Empty
 * value clears the bind. Distinct from setAutoOnSprites
 * because the two paths run independently against
 * different selection slices, even though both fields
 * share the same key name.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setAutoOnTriggers(data, selection, value) {
    setFieldOnSelection(data, { triggers: selection.triggers }, "auto", String(value));
}

/**
 * Set the hitBeat slot field on every selected curve.
 * Sprites and triggers in the selection are ignored —
 * hitBeat is curve-only. Empty value clears the bind.
 * Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setHitBeatOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "hitBeat", String(value));
}

/**
 * Set the hitTrigger slot field on every selected curve.
 * Sprites and triggers in the selection are ignored —
 * hitTrigger is curve-only. Empty value clears the bind.
 * Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setHitTriggerOnCurves(data, selection, value) {
    setFieldOnSelection(data, { curves: selection.curves }, "hitTrigger", String(value));
}

/**
 * Set the autoBeatInterval field on every selected sprite.
 * Triggers and curves in the selection are ignored. Value
 * is a token from the fixed beat-interval list plus the
 * sentinel "Off" which suppresses Auto firings entirely.
 * Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setAutoBeatIntervalOnSprites(data, selection, value) {
    setFieldOnSelection(data, { sprites: selection.sprites }, "autoBeatInterval", String(value));
}

/**
 * Set the autoBeatInterval field on every selected trigger.
 * Sprites and curves in the selection are ignored. Value is
 * a token from the fixed beat-interval list plus "Off".
 * Mutates `data` in place.
 *
 * @param {any} data
 * @param {{sprites?: Iterable<number>, triggers?: Iterable<number>, curves?: Iterable<number>}} selection
 * @param {string} value
 */
export function setAutoBeatIntervalOnTriggers(data, selection, value) {
    setFieldOnSelection(data, { triggers: selection.triggers }, "autoBeatInterval", String(value));
}

/**
 * Append a stub function declaration to behaviors.js for a
 * fresh slot binding. Used by the inspector's Create button
 * in Band 3, which fires on a slot whose name doesn't yet
 * exist in behaviors.js. The stub's body shape varies by
 * slot kind so the user starts with a callable function
 * that returns the right shape for its slot:
 *
 *   - motionUpdate (sprite Motion Update): returns
 *     { ax: 0, ay: 0 } so the simulation reads zero
 *     acceleration without crashing.
 *   - hitBeat / hitTrigger / collision / auto: returns
 *     null. The audio path eventually treats null as "no
 *     event fires this tick", so a fresh stub is silent
 *     until the composer fills in the body.
 *
 * Returns {newContent, alreadyExists}. When the named
 * function already exists at the top level, alreadyExists
 * is true and newContent equals the input — no append, no
 * duplicate declaration. The Create button's enable/disable
 * gate in the inspector should already preempt this case;
 * the defensive check here means a race (two Create clicks
 * before the first re-render lands) doesn't end up with
 * two declarations of the same name in behaviors.js.
 *
 * The function is appended at the end of the file with a
 * blank line separator so the existing structure is left
 * undisturbed and the new declaration is easy to find.
 *
 * @param {string} content  Current behaviors.js source.
 * @param {string} functionName  Identifier to scaffold.
 * @param {"motionUpdate" | "hitBeat" | "hitTrigger" | "collision" | "auto"} slotKind
 * @returns {{ newContent: string, alreadyExists: boolean }}
 */
export function scaffoldFunctionInBehaviors(content, functionName, slotKind) {
    // Look for an existing top-level function declaration
    // with the same name. Conservative regex match: line
    // starting with `function NAME(` (optional `export `
    // prefix). Misses const/let bindings to function
    // expressions, which is acceptable here — the inspector
    // gates Create on functionMap membership built by the
    // loader, which catches every shape of top-level
    // function declaration. This regex is the second line
    // of defence against a race in the inspector's gate.
    const re = new RegExp(
        `^[ \\t]*(?:export[ \\t]+)?function[ \\t]+${escapeForRegex(functionName)}[ \\t]*\\(`,
        "m"
    );
    if (re.test(content)) {
        return { newContent: content, alreadyExists: true };
    }
    const stub = stubBodyFor(slotKind, functionName);
    // Ensure exactly one blank line between the existing
    // content and the appended stub. Strip trailing
    // newlines, then add the separator and the stub. The
    // stub itself ends with a newline so the file's
    // trailing-newline convention survives.
    const trimmed = content.replace(/\s+$/, "");
    const separator = trimmed.length === 0 ? "" : "\n\n";
    return { newContent: `${trimmed}${separator}${stub}`, alreadyExists: false };
}

/**
 * Slot-kind-specific stub body for scaffoldFunctionInBehaviors.
 * @param {"motionUpdate" | "hitBeat" | "hitTrigger" | "collision" | "auto"} slotKind
 * @param {string} functionName
 * @returns {string}
 */
function stubBodyFor(slotKind, functionName) {
    if (slotKind === "motionUpdate") {
        return `function ${functionName}(ctx) {\n    // Return acceleration { ax, ay } applied to the sprite\n    // before integration. See DESIGN.md \u00a79 for the ctx\n    // fields available (dt, x, y, vx, vy, imageColor,\n    // imageColorAt).\n    return { ax: 0, ay: 0 };\n}\n`;
    }
    // Music-event slots (hitBeat, hitTrigger, collision, auto).
    // All four return either a music-event object or null;
    // the stub returns null so a freshly-created binding is
    // silent until the composer fills in the body.
    return `function ${functionName}(ctx) {\n    // Return a music event ({ note, velocity, duration })\n    // or null for no firing. See DESIGN.md \u00a79 for the\n    // ctx fields available for this slot.\n    return null;\n}\n`;
}

/**
 * Escape a string for safe inclusion in a RegExp source.
 * Used by scaffoldFunctionInBehaviors's existence check;
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
 * Strip pipes and whitespace from a beat-string and re-
 * insert pipes at the bar boundaries determined by
 * beatsPerBar. Used by setBeatsPerBarOnCurves and
 * regenerateActiveBeatsIfEuclidean to keep the stored
 * activeBeats and strength strings consistent with the
 * curve's current beatsPerBar.
 *
 * Pipes appear strictly between bars: a pipe goes after
 * the kth typed character whenever k is a positive
 * multiple of beatsPerBar AND there is at least one more
 * typed character later in the string. The trailing-pipe
 * suppression matches the inspector's repipeForDisplay
 * rule (DESIGN.md §10) so a string that round-trips
 * through this helper renders identically in the
 * inspector. Without the suppression a fully-typed last
 * bar produces a pipe with nothing after it, which the
 * inspector cannot delete because the input handler
 * immediately re-inserts it.
 *
 * Spaces are dropped on output. The user-typed-spaces
 * preservation in DESIGN.md is handled at the inspector's
 * per-keystroke editing layer, not here — this helper is
 * called when the inspector commits a beatsPerBar change
 * or when the Euclidean generator produces a fresh string,
 * neither of which carry user-spacing intent.
 *
 * @param {string} s
 * @param {number} beatsPerBar
 * @returns {string}
 */
function repipeWithBars(s, beatsPerBar) {
    if (typeof s !== "string") return "";
    const stripped = s.replace(/[|\s]/g, "");
    if (beatsPerBar <= 0) return stripped;
    let result = "";
    for (let i = 0; i < stripped.length; i++) {
        result += stripped[i];
        // Pipe goes between bars only — suppress it at the
        // very end of the string (when this is the last
        // typed character) so the result has no trailing
        // pipe to round-trip.
        if (
            (i + 1) % beatsPerBar === 0 &&
            i < stripped.length - 1
        ) {
            result += "|";
        }
    }
    return result;
}

/**
 * If the curve is in euclidean mode, regenerate its
 * activeBeats string from cycleDuration plus the three
 * Euclidean parameters (activeBeatsCount, beatShift,
 * repeats). The newly-generated string is repiped per the
 * curve's beatsPerBar so the stored JSON stays consistent
 * with the inspector's display rule.
 *
 * No-op for curves in normal or none mode, or for curves
 * with a missing/unrecognised beatPointsMode. Defensive
 * defaults read sensibly from the entry so a hand-edited
 * scene.json with partial Euclidean fields still produces
 * a valid string rather than crashing.
 *
 * @param {any} entry
 */
function regenerateActiveBeatsIfEuclidean(entry) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
    if (entry.beatPointsMode !== "euclidean") return;
    const cycleDuration = typeof entry.cycleDuration === "number" ? entry.cycleDuration : 4;
    const activeBeatsCount = typeof entry.activeBeatsCount === "number" ? entry.activeBeatsCount : 0;
    const beatShift = typeof entry.beatShift === "number" ? entry.beatShift : 0;
    const repeats = typeof entry.repeats === "number" ? entry.repeats : 1;
    const beatsPerBar = typeof entry.beatsPerBar === "number" ? entry.beatsPerBar : 4;
    const generated = generateEuclideanPattern(cycleDuration, activeBeatsCount, beatShift, repeats);
    entry.activeBeats = repipeWithBars(generated, beatsPerBar);
}

/**
 * Add zero or more fields to an entry, inserting each
 * missing field directly after the named anchor key in the
 * entry's key order. Fields already present on the entry
 * keep their existing position and value (the helper does
 * not overwrite). If the anchor key is not present on the
 * entry, the missing fields are appended at the end.
 *
 * Used by setBeatPointsModeOnCurves to add the three
 * Euclidean parameters (activeBeatsCount, beatShift,
 * repeats) right after beatPointsMode when transitioning a
 * curve into euclidean mode, matching the JSON-on-disk
 * layout in DESIGN.md §14.
 *
 * Mutates the entry in place by deleting all keys and
 * re-adding them in the new order, preserving the entry's
 * object identity (other code with a reference to the
 * entry continues to see the same object).
 *
 * @param {any} entry
 * @param {string} anchorKey
 * @param {Object<string, any>} fieldsToAdd
 */
function ensureFieldsAfter(entry, anchorKey, fieldsToAdd) {
    const additions = Object.keys(fieldsToAdd).filter((k) => !(k in entry));
    if (additions.length === 0) return;
    if (!(anchorKey in entry)) {
        for (const k of additions) entry[k] = fieldsToAdd[k];
        return;
    }
    /** @type {string[]} */
    const oldKeys = Object.keys(entry);
    /** @type {Record<string, any>} */
    const oldValues = {};
    for (const k of oldKeys) oldValues[k] = entry[k];
    for (const k of oldKeys) delete entry[k];
    for (const k of oldKeys) {
        entry[k] = oldValues[k];
        if (k === anchorKey) {
            for (const m of additions) entry[m] = fieldsToAdd[m];
        }
    }
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
