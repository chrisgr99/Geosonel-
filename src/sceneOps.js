/**
 * Scene operations — the GeosonixV2 substrate's operation set.
 *
 * This is the single layer every scene-mutating surface resolves to: the
 * construction code (later), the per-object callbacks (later), the inspector
 * and canvas tools (their existing sceneEditor path stays as-is for now), and
 * the save format. It exposes five operations addressed by id and selector,
 * plus the id-keyed selective-merge semantics that let construction code be
 * re-run against a living, hand-edited scene without clobbering it. See
 * design/DESIGN.md section 3 (The shared substrate) for the full rationale.
 *
 * What it operates on. A parsed scene.json object (the canonical authored
 * scene): an object with `curves`, `triggers`, and `sprites` arrays whose
 * entries carry the schema fields, plus the `idCounters` block that idGen
 * maintains. sceneOps mutates that object in place; stringifying it back to
 * scene.json text is the caller's job (via sceneEditor.stringifyScene), and no
 * surface is wired to sceneOps yet — this module is the inert foundation the
 * later build stages sit on.
 *
 * The operations.
 *   - create(kind, id?)  Make a curve, trigger, or sprite. With an explicit id
 *                        that already exists this ADDRESSES the existing object
 *                        (sets it current, returns its id) rather than
 *                        duplicating — the heart of the selective-merge rule.
 *                        With a new or omitted id it appends a minimal entry and
 *                        returns the id. Always sets the current target.
 *   - position(selector, x, y)  Place sprites and triggers at x, y. (Curve
 *                        positioning is shape geometry and is handled by the
 *                        geometry / construction layer in a later stage, so
 *                        curves in the selection are skipped here.)
 *   - set(selector, field, value)  Assign one field on every addressed object.
 *                        This is the generic property write; it only touches the
 *                        named field, so re-running construction retains every
 *                        property it does not explicitly set — including the
 *                        user's hand edits. That retention IS the merge.
 *   - group(selector, name)  Tag the addressed objects with a group name (a
 *                        thin set of the `group` field) so later operations can
 *                        address the whole group.
 *   - select(selector)  Set the current target to the addressed object.
 *   - clear()           Full reset: empty the object arrays. The monotonic id
 *                        counters are deliberately NOT reset, so ids stay unique
 *                        across a clear-and-rebuild and never silently rebind a
 *                        script.js label.
 *
 * Selectors. A selector addresses zero or more objects:
 *   - an id string ("CRV2", "TRG3", "SPR1") -> that one object;
 *   - "all"        -> every object;
 *   - "current"    -> the last created or last selected object;
 *   - "selection"  -> the host's canvas selection (supplied via setSelection);
 *   - any other string -> a group name (every object whose `group` matches).
 * Reserved tokens win over ids, and an id match wins over a group-name match.
 *
 * Why self-contained. The design sketch had sceneOps wrap sceneEditor's
 * set*OnSelection family directly. sceneEditor imports acorn from a URL for its
 * script.js AST editing, which makes it unloadable under `node --test`, so
 * wrapping it would make this whole foundation untestable offline. Instead
 * sceneOps implements the generic field write itself (the same per-entry
 * assignment sceneEditor's internal setFieldOnSelection does) and shares only
 * idGen, which is dependency-free. The inspector keeps using sceneEditor; the
 * two apply the same field-write semantics, and unifying them behind one writer
 * is a later cleanup if it earns its keep. The formatting-bearing setters (beat
 * re-barring, clamps) are a higher layer the construction builder can call; the
 * substrate's `set` is the plain assignment primitive the design specifies.
 */

// @ts-check

import { generateId, ensureIdCounters } from "./idGen.js";

/** @type {Record<"sprite" | "trigger" | "curve", "sprites" | "triggers" | "curves">} */
const ARRAY_KEY_BY_KIND = {
    sprite: "sprites",
    trigger: "triggers",
    curve: "curves",
};

/** @type {Array<"sprite" | "trigger" | "curve">} */
const KINDS = ["sprite", "trigger", "curve"];

/** @type {Array<"sprites" | "triggers" | "curves">} */
const ARRAY_KEYS = ["sprites", "triggers", "curves"];

/** Selector tokens with special meaning, never treated as ids or group names. */
const RESERVED_SELECTORS = new Set(["all", "current", "selection"]);

/**
 * @typedef {{sprites: number[], triggers: number[], curves: number[]}} IndexSelection
 * Per-kind arrays of array indices, the same shape sceneEditor's setters and
 * the canvas selection use.
 */

/**
 * Build a minimal valid entry for a freshly-created object. Mirrors the shapes
 * sceneEditor's addSpriteAt / addTriggerAt / addCurveAt produce, minus the
 * canvas position (create places at the origin; position() moves it). A curve
 * gets a zero-extent ellipse placeholder and an audible cursor surface; its
 * real geometry is set later through the geometry / construction layer.
 *
 * @param {"sprite" | "trigger" | "curve"} kind
 * @param {string} id
 * @returns {Record<string, any>}
 */
function makeEntry(kind, id) {
    if (kind === "sprite") {
        return { id, name: "", x: 0, y: 0, vx: 0, vy: 0 };
    }
    if (kind === "trigger") {
        return { id, name: "", x: 0, y: 0 };
    }
    return {
        id,
        name: "",
        shape: { type: "ellipse", cx: 0, cy: 0, w: 0, h: 0 },
        cursorR: 1,
        cursorL: 1,
    };
}

/** @returns {IndexSelection} */
function emptyIndexSelection() {
    return { sprites: [], triggers: [], curves: [] };
}

/**
 * Coerce an arbitrary selection-like value into a clean IndexSelection of
 * number arrays. Tolerates missing kinds and iterables.
 * @param {any} sel
 * @returns {IndexSelection}
 */
function normalizeSelection(sel) {
    const out = emptyIndexSelection();
    if (sel === null || typeof sel !== "object") return out;
    for (const key of ARRAY_KEYS) {
        const v = sel[key];
        if (v === undefined || v === null) continue;
        try {
            out[key] = Array.from(v, (n) => Number(n)).filter((n) => Number.isFinite(n));
        } catch {
            // Not iterable; leave this kind empty.
        }
    }
    return out;
}

/**
 * Round a canvas coordinate to two decimal places, matching sceneEditor's
 * stored-JSON convention so positions written here read the same as positions
 * written by the inspector and canvas tools.
 * @param {number} n
 * @returns {number}
 */
function roundCoord(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Create a scene-operations instance bound to one parsed scene.json object.
 * The instance keeps the stateful current target and the host's selection.
 *
 * @param {any} data  Parsed scene.json object; mutated in place.
 * @param {{selection?: any}} [options]
 */
export function createSceneOps(data, options = {}) {
    /** @type {string | null} The current target id (last created or selected). */
    let current = null;
    /** @type {IndexSelection} The host's canvas selection, for the "selection" selector. */
    let selection = normalizeSelection(options.selection);

    function ensureArrays() {
        for (const key of ARRAY_KEYS) {
            if (!Array.isArray(data[key])) data[key] = [];
        }
    }

    /**
     * Locate an object by id across all three arrays.
     * @param {string} id
     * @returns {{kind: "sprite" | "trigger" | "curve", key: "sprites" | "triggers" | "curves", index: number, entry: Record<string, any>} | null}
     */
    function findById(id) {
        for (const kind of KINDS) {
            const key = ARRAY_KEY_BY_KIND[kind];
            const arr = data[key];
            if (!Array.isArray(arr)) continue;
            for (let i = 0; i < arr.length; i++) {
                const e = arr[i];
                if (e !== null && typeof e === "object" && !Array.isArray(e) && e.id === id) {
                    return { kind, key, index: i, entry: e };
                }
            }
        }
        return null;
    }

    /**
     * Resolve a selector to per-kind array indices.
     * @param {string} selector
     * @returns {IndexSelection}
     */
    function resolve(selector) {
        const sel = emptyIndexSelection();
        if (selector === "all") {
            for (const kind of KINDS) {
                const key = ARRAY_KEY_BY_KIND[kind];
                const arr = data[key];
                if (Array.isArray(arr)) {
                    for (let i = 0; i < arr.length; i++) sel[key].push(i);
                }
            }
            return sel;
        }
        if (selector === "selection") {
            for (const kind of KINDS) {
                const key = ARRAY_KEY_BY_KIND[kind];
                const arr = Array.isArray(data[key]) ? data[key] : [];
                for (const idx of selection[key]) {
                    if (idx >= 0 && idx < arr.length) sel[key].push(idx);
                }
            }
            return sel;
        }
        if (selector === "current") {
            if (current !== null) {
                const f = findById(current);
                if (f !== null) sel[f.key].push(f.index);
            }
            return sel;
        }
        if (typeof selector !== "string" || selector.length === 0) return sel;
        // An id match addresses exactly one object and wins over a group name.
        const byId = findById(selector);
        if (byId !== null) {
            sel[byId.key].push(byId.index);
            return sel;
        }
        // Otherwise treat the string as a group name.
        for (const kind of KINDS) {
            const key = ARRAY_KEY_BY_KIND[kind];
            const arr = data[key];
            if (!Array.isArray(arr)) continue;
            for (let i = 0; i < arr.length; i++) {
                const e = arr[i];
                if (e !== null && typeof e === "object" && !Array.isArray(e) && e.group === selector) {
                    sel[key].push(i);
                }
            }
        }
        return sel;
    }

    /**
     * Run fn over every entry in a resolved selection.
     * @param {IndexSelection} sel
     * @param {(entry: Record<string, any>, kind: "sprite" | "trigger" | "curve", index: number) => void} fn
     */
    function eachSelected(sel, fn) {
        for (const kind of KINDS) {
            const key = ARRAY_KEY_BY_KIND[kind];
            const arr = data[key];
            if (!Array.isArray(arr)) continue;
            for (const idx of sel[key]) {
                if (idx < 0 || idx >= arr.length) continue;
                const e = arr[idx];
                if (e === null || typeof e !== "object" || Array.isArray(e)) continue;
                fn(e, kind, idx);
            }
        }
    }

    /**
     * Create an object, or address an existing one by id.
     * @param {"sprite" | "trigger" | "curve"} kind
     * @param {string} [id]
     * @returns {string} The id of the created or addressed object.
     */
    function create(kind, id) {
        if (!KINDS.includes(kind)) {
            throw new Error(`createSceneOps.create: unknown kind "${kind}".`);
        }
        ensureArrays();
        ensureIdCounters(data);
        const explicit = typeof id === "string" && id.length > 0;
        if (explicit) {
            const existing = findById(/** @type {string} */(id));
            if (existing !== null) {
                // Address, don't duplicate: the following sets update it in place.
                current = /** @type {string} */ (id);
                return current;
            }
        }
        const newId = explicit ? /** @type {string} */ (id) : generateId(kind, data);
        data[ARRAY_KEY_BY_KIND[kind]].push(makeEntry(kind, newId));
        // Advance the counters past an explicit conventional id so a later
        // auto-create can't collide with it.
        if (explicit) ensureIdCounters(data);
        current = newId;
        return newId;
    }

    /**
     * Assign one field on every addressed object. Only the named field is
     * written; all other fields are retained, which is the selective merge.
     * @param {string} selector
     * @param {string} field
     * @param {any} value
     */
    function set(selector, field, value) {
        if (typeof field !== "string" || field.length === 0) return;
        eachSelected(resolve(selector), (e) => { e[field] = value; });
    }

    /**
     * Tag every addressed object with a group name. Empty string clears
     * membership (ungrouped).
     * @param {string} selector
     * @param {string} name
     */
    function group(selector, name) {
        set(selector, "group", String(name));
    }

    /**
     * Place every addressed sprite and trigger at (x, y). Curves are skipped:
     * a curve's position is its shape geometry, set through the geometry layer.
     * @param {string} selector
     * @param {number} x
     * @param {number} y
     */
    function position(selector, x, y) {
        const nx = Number(x);
        const ny = Number(y);
        eachSelected(resolve(selector), (e, kind) => {
            if (kind === "curve") return;
            if (Number.isFinite(nx)) e.x = roundCoord(nx);
            if (Number.isFinite(ny)) e.y = roundCoord(ny);
        });
    }

    /**
     * Set the current target to the addressed object. When the selector
     * resolves to several objects the last one wins. Returns the new current
     * id, or null when nothing resolved.
     * @param {string} selector
     * @returns {string | null}
     */
    function select(selector) {
        let last = null;
        eachSelected(resolve(selector), (e) => {
            if (typeof e.id === "string") last = e.id;
        });
        if (last !== null) current = last;
        return last;
    }

    /**
     * Full reset: empty every object array. The monotonic id counters are kept
     * so rebuilt ids stay unique across the clear.
     */
    function clear() {
        for (const key of ARRAY_KEYS) data[key] = [];
        current = null;
    }

    /**
     * List the ids a selector resolves to, in array order across kinds.
     * @param {string} selector
     * @returns {string[]}
     */
    function ids(selector) {
        /** @type {string[]} */
        const out = [];
        eachSelected(resolve(selector), (e) => {
            if (typeof e.id === "string") out.push(e.id);
        });
        return out;
    }

    /**
     * Read one field off the FIRST object a selector resolves to, or
     * undefined when nothing resolves. The read complement of set(); the
     * object handle reads authored fields through this so reads and writes
     * share one addressing path.
     * @param {string} selector
     * @param {string} field
     * @returns {any}
     */
    function get(selector, field) {
        let value;
        let found = false;
        eachSelected(resolve(selector), (e) => {
            if (!found) { value = e[field]; found = true; }
        });
        return value;
    }

    /**
     * The kind ("sprite" | "trigger" | "curve") of the object with this id,
     * or null when no such object exists. Lets a handle report its kind and
     * test existence without exposing the internal index lookup.
     * @param {string} id
     * @returns {"sprite" | "trigger" | "curve" | null}
     */
    function kindOf(id) {
        const f = findById(id);
        return f === null ? null : f.kind;
    }

    return {
        /** The current target id, or null. */
        get current() { return current; },
        /** The bound scene.json object. */
        get data() { return data; },
        /**
         * Supply the host's canvas selection for the "selection" selector.
         * @param {any} sel
         */
        setSelection(sel) { selection = normalizeSelection(sel); },
        resolve,
        ids,
        get,
        kindOf,
        create,
        set,
        group,
        position,
        select,
        clear,
    };
}
