/**
 * ID generation utility.
 *
 * Generates stable, type-prefixed identifiers for the objects
 * in a score: SPR1, SPR2, ... for sprites; TRG1, TRG2, ... for
 * triggers; CRV1, CRV2, ... for curves. The three-uppercase-
 * letter prefix denotes the object kind; the suffix is a
 * positive integer with no leading zero, assigned in creation
 * order per kind. See section 28 of DESIGN.md (Object
 * identifiers subsection) for the full design rationale.
 *
 * Once assigned, an id never changes for the life of an
 * object. Deleting an object does not free its number for
 * reuse: the next-integer counter monotonically increases per
 * kind, so a deleted object's id is permanently retired and
 * the gap stays visible in the numbering. This is the name-
 * stability property that the pattern-block and callback-
 * function conventions rely on — a labelled block $SPR4 in
 * behaviors.js stays meaningful as long as SPR4 exists, and
 * recycling that number for a different freshly-created
 * sprite later would orphan or silently rebind the reference.
 *
 * The next-integer counters live in scene.json as a top-level
 * `idCounters` sub-object with `sprite`, `trigger`, and
 * `curve` keys, each holding the integer the next-created
 * object of that kind will receive. Counters are persisted
 * with the score and travel through save, load, and disk
 * mirroring without any special handling. ensureIdCounters
 * initialises them if missing and advances them past the max
 * conventional id integer found in the object data;
 * idempotent, so callers can call it freely.
 *
 * Hand-edited ids that don't match the conventional shape are
 * left alone by the fill pass and don't affect counter
 * advancement. References to such ids in behaviors.js are the
 * user's responsibility to keep in sync; the system has no
 * opinion.
 *
 * The format is documented as stable: a three-uppercase-letter
 * kind prefix from the fixed set {SPR, TRG, CRV}, immediately
 * followed by a positive integer with no leading zero. User-
 * typed Names cannot match this pattern (the name validator
 * rejects names in this shape) so generated ids and user-typed
 * names never collide.
 */

// @ts-check

/** @type {Record<"sprite" | "trigger" | "curve", string>} */
const PREFIX_BY_KIND = {
    sprite: "SPR",
    trigger: "TRG",
    curve: "CRV",
};

/** @type {Record<"sprite" | "trigger" | "curve", string>} */
const ARRAY_KEY_BY_KIND = {
    sprite: "sprites",
    trigger: "triggers",
    curve: "curves",
};

/**
 * Pattern matching a generated id: a three-uppercase-letter
 * prefix from the fixed set {SPR, TRG, CRV} followed by a
 * positive integer with no leading zero. The name validator
 * consults this to reject user-typed Names in this shape, so
 * generated ids and user-typed names never collide.
 */
export const GENERATED_ID_PATTERN = /^(SPR|TRG|CRV)[1-9]\d*$/;

/**
 * Suffix-only pattern used internally for parsing the integer
 * portion of a conventional id after the kind prefix has been
 * matched. Same shape as the suffix portion of
 * GENERATED_ID_PATTERN.
 */
const SUFFIX_PATTERN = /^[1-9]\d*$/;

/**
 * @param {unknown} s
 * @returns {boolean}
 */
export function isGeneratedIdFormat(s) {
    return typeof s === "string" && GENERATED_ID_PATTERN.test(s);
}

/**
 * Ensure data.idCounters exists and is at least as high as
 * the next id needed for each kind. Creates the sub-object
 * if missing. For each of sprite, trigger, curve, walks the
 * matching object array, finds the largest integer portion
 * of any conventional id, and advances the counter to
 * max(currentCounter, maxFoundInteger + 1). Counter values
 * below 1 are corrected to 1.
 *
 * Idempotent and cheap on already-correct data: the walk is
 * linear in each array's length but does no allocations
 * beyond a couple of integer comparisons. Callers that need
 * a fresh id should call this once before the first
 * generateId, and may call it again freely (e.g. defensively
 * in interaction handlers).
 *
 * Returns true iff at least one counter was created or
 * advanced; the caller (typically fillMissingIds in
 * sceneEditor) uses this signal to decide whether to write
 * the mutated scene back to the bundle.
 *
 * @param {any} data
 * @returns {boolean}
 */
export function ensureIdCounters(data) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
    let changed = false;
    if (data.idCounters === null ||
        typeof data.idCounters !== "object" ||
        Array.isArray(data.idCounters)) {
        data.idCounters = {};
        changed = true;
    }
    const counters = data.idCounters;
    /** @type {Array<"sprite" | "trigger" | "curve">} */
    const kinds = ["sprite", "trigger", "curve"];
    for (const kind of kinds) {
        const prefix = PREFIX_BY_KIND[kind];
        const arr = data[ARRAY_KEY_BY_KIND[kind]];
        let maxInt = 0;
        if (Array.isArray(arr)) {
            for (const entry of arr) {
                if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
                const id = entry.id;
                if (typeof id !== "string" || !id.startsWith(prefix)) continue;
                const suffix = id.slice(prefix.length);
                if (!SUFFIX_PATTERN.test(suffix)) continue;
                const n = parseInt(suffix, 10);
                if (n > maxInt) maxInt = n;
            }
        }
        const current = typeof counters[kind] === "number" ? counters[kind] : 1;
        const safeCurrent = current < 1 ? 1 : current;
        const next = safeCurrent > maxInt + 1 ? safeCurrent : maxInt + 1;
        if (counters[kind] !== next) {
            counters[kind] = next;
            changed = true;
        }
    }
    return changed;
}

/**
 * Generate the next id for the given kind. Reads the relevant
 * counter from data.idCounters, returns the constructed id
 * (e.g. "SPR1"), and increments the counter by one so the
 * next call produces the next integer in sequence.
 *
 * Callers should arrange for ensureIdCounters(data) to have
 * been called at some prior point in the data's lifetime
 * (typically by fillMissingIds at scene-load time). The
 * defensive lazy init below covers cases where the data
 * arrives here without having been through that path.
 *
 * @param {"sprite" | "trigger" | "curve"} kind
 * @param {any} data  Scene data object carrying idCounters.
 *                    Mutated: the relevant counter is read,
 *                    then incremented.
 * @returns {string}
 */
export function generateId(kind, data) {
    const prefix = PREFIX_BY_KIND[kind];
    if (prefix === undefined) {
        throw new Error(`generateId: unknown kind "${kind}".`);
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("generateId: data must be an object.");
    }
    if (data.idCounters === null ||
        typeof data.idCounters !== "object" ||
        Array.isArray(data.idCounters)) {
        ensureIdCounters(data);
    }
    const counters = data.idCounters;
    const counter = typeof counters[kind] === "number" ? counters[kind] : 1;
    const safe = counter < 1 ? 1 : counter;
    const id = prefix + safe;
    counters[kind] = safe + 1;
    return id;
}

/**
 * Collect every existing id in a parsed scene-data object.
 * Used by orphan detection and similar checks where the
 * caller wants to know what ids exist regardless of their
 * format. Conventional integer-format ids and hand-edited
 * unconventional ids both end up in the returned set.
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
