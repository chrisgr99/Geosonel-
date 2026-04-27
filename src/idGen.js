/**
 * ID generation utility.
 *
 * Generates stable, type-prefixed identifiers for the objects
 * in a score: sp_xxxxxx for sprites, tr_xxxxxx for triggers,
 * cv_xxxxxx for curves, where xxxxxx is six lowercase hex
 * digits drawn at random. Six hex digits give 16,777,216
 * possibilities per kind, so collisions within a single score
 * are vanishingly rare and the generator just re-rolls on the
 * rare conflict.
 *
 * IDs are written into scene.json by the load-time fill-in
 * step (sceneEditor.fillMissingIds) and survive across edits.
 * Once assigned, an id never changes for the life of an
 * object. Deleting an object does not free its id for reuse:
 * the random format makes the deleted id statistically
 * unrecoverable, which matches the design's no-reuse
 * preference without needing a counter.
 *
 * The format is documented as stable: TWO lowercase letters,
 * an underscore, then SIX lowercase hex digits. Names typed
 * by the user into the property inspector cannot match this
 * pattern (the inspector reserves it) so user-visible names
 * never shadow generated ids.
 */

// @ts-check

/** @type {Record<"sprite" | "trigger" | "curve", string>} */
const PREFIX_BY_KIND = {
    sprite: "sp",
    trigger: "tr",
    curve: "cv",
};

const HEX_CHARS = "0123456789abcdef";
const SUFFIX_LENGTH = 6;

/**
 * Pattern matching a generated id: two lowercase letters,
 * underscore, exactly six lowercase hex digits. The inspector
 * uses this to reject user-typed names in this shape, so
 * generated ids and user-typed names never collide.
 */
export const GENERATED_ID_PATTERN = /^[a-z]{2}_[0-9a-f]{6}$/;

/**
 * @param {unknown} s
 * @returns {boolean}
 */
export function isGeneratedIdFormat(s) {
    return typeof s === "string" && GENERATED_ID_PATTERN.test(s);
}

/**
 * Generate a fresh id for the given kind, avoiding the values
 * in `existing`. Re-rolls on the rare collision (six hex
 * digits gives 16M+ possibilities per kind, so the very first
 * attempt almost always succeeds).
 *
 * @param {"sprite" | "trigger" | "curve"} kind
 * @param {Set<string>} existing  Set of ids already in use.
 *                                Cross-kind ids can share the
 *                                same set safely; the prefix
 *                                namespaces them so a sprite
 *                                and a trigger with the same
 *                                hex suffix cannot collide.
 * @returns {string}
 */
export function generateId(kind, existing) {
    const prefix = PREFIX_BY_KIND[kind];
    if (prefix === undefined) {
        throw new Error(`generateId: unknown kind "${kind}".`);
    }
    // Bound the loop to keep it from running away if the
    // caller somehow passes a saturated set; in practice the
    // very first attempt almost always succeeds.
    for (let i = 0; i < 1000; i++) {
        const candidate = prefix + "_" + randomHex(SUFFIX_LENGTH);
        if (!existing.has(candidate)) return candidate;
    }
    throw new Error(
        `generateId: could not find a free id for kind "${kind}" after 1000 attempts.`
    );
}

/**
 * Collect every existing id in a parsed scene-data object.
 * Used by callers that need to seed the existing-ids set
 * before generating new ids — e.g. the fill-in pass over a
 * just-loaded scene.json, or the toolbar's add-sprite path.
 *
 * @param {any} data
 * @returns {Set<string>}
 */
export function collectExistingIds(data) {
    /** @type {Set<string>} */
    const out = new Set();
    if (data === null || typeof data !== "object") return out;
    for (const arrayKey of ["curves", "triggers", "sprites"]) {
        const arr = data[arrayKey];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
            if (entry !== null &&
                typeof entry === "object" &&
                typeof entry.id === "string" &&
                entry.id.length > 0) {
                out.add(entry.id);
            }
        }
    }
    return out;
}

/**
 * @param {number} length
 * @returns {string}
 */
function randomHex(length) {
    let out = "";
    for (let i = 0; i < length; i++) {
        out += HEX_CHARS[Math.floor(Math.random() * 16)];
    }
    return out;
}
