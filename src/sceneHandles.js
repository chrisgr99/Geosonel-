/**
 * Scene handles — the GeosonixV2 substrate's live object and score handles.
 *
 * A handle is a live reference whose properties read and write THROUGH to the
 * scene, the way GeoSonix's _obj(id) / _o(id) and _score did. It is the surface
 * both construction code and (later) the per-object callbacks use to read and
 * change an object or the score. See design/DESIGN.md section 3 (The shared
 * substrate) for the full rationale.
 *
 * Two layers of state, one handle. An object has AUTHORED fields (the schema
 * fields stored in scene.json — position, colour, beat points, callback
 * bindings, and so on) and DERIVED runtime reads (live speed, cycle phase, the
 * ten px* colour reads under the object) that only exist while the simulation
 * runs. The handle reads and writes authored fields through the operation set
 * (sceneOps), so a handle write is the same selective-merge write the inspector
 * performs. The derived reads come from an optional RUNTIME ADAPTER; until the
 * firing-flow stage wires a real one, they return inert defaults (0 / false), so
 * the handle has its full shape now but stays behaviour-free.
 *
 * This module is NOT wired to anything yet. It is the inert foundation the
 * construction builder and the firing-flow callback context will sit on; in the
 * firing-flow stage the per-fire callback `this` becomes an object handle from
 * here (plus per-firing fields), so callbacks and construction share one type.
 *
 * HARMONY IS DEFERRED. The score and object handles will later carry harmony
 * state (tonic / root / scale / chord / range / mapNotesTo), reworked on TONAL.
 * That layer is intentionally NOT modelled here beyond the generic get/set
 * pass-through; see the substrate design.
 */

// @ts-check

import { OBJECT_FIELDS_BY_KIND } from "./sceneSchema.js";

/**
 * Derived runtime reads — NOT stored schema fields. They reflect live
 * simulation state and are read-only on the handle. A runtime adapter supplies
 * them at firing time; absent one, they default (flipX/flipY false, the rest 0).
 */
const DERIVED_READS = [
    "speed", "cyclePhase", "cycleCount", "flipX", "flipY",
    "pxLt", "pxChr", "pxR", "pxG", "pxY", "pxB", "pxOr", "pxLi", "pxCy", "pxPu",
];

/** Names the handle manages itself, never as plain authored-field accessors. */
const RESERVED_NAMES = new Set(["id", "kind", "exists", "get", "set", ...DERIVED_READS]);

/**
 * The union of authored field keys across all three kinds, minus id (managed
 * specially) and anything that collides with a reserved name. A handle exposes
 * every authored field as a named property; which ones actually apply depends on
 * the object's kind, but reading an absent field simply yields undefined and the
 * schema-correctness of a write is the caller's concern — the same latitude the
 * operation set's plain `set` gives.
 */
const AUTHORED_FIELD_KEYS = (() => {
    const keys = new Set();
    for (const kind of ["curves", "triggers", "sprites"]) {
        const fields = OBJECT_FIELDS_BY_KIND[kind] || [];
        for (const f of fields) {
            if (f.key === "id") continue;
            if (RESERVED_NAMES.has(f.key)) continue;
            keys.add(f.key);
        }
    }
    return [...keys];
})();

/**
 * Read a derived runtime value through the adapter, or its inert default.
 * @param {{read?: (id: string, key: string) => any} | null} runtime
 * @param {string} id
 * @param {string} key
 * @returns {any}
 */
function readRuntime(runtime, id, key) {
    if (runtime !== null && typeof runtime.read === "function") {
        return runtime.read(id, key);
    }
    return (key === "flipX" || key === "flipY") ? false : 0;
}

/**
 * Create a live object handle addressed by id. Authored-field properties read
 * and write through the operation set; derived properties read through the
 * runtime adapter (or its inert default) and throw on assignment. The handle
 * stays valid across the object being addressed, replaced, or rebuilt because
 * every access re-resolves by id — it never captures a stale entry reference.
 *
 * @param {ReturnType<import("./sceneOps.js").createSceneOps>} ops  The operation
 *   set bound to the scene the handle reads and writes.
 * @param {string} id  The object id this handle refers to.
 * @param {{runtime?: {read?: (id: string, key: string) => any} | null}} [options]
 * @returns {Record<string, any>}
 */
export function createObjectHandle(ops, id, options = {}) {
    const runtime = options.runtime ?? null;
    /** @type {Record<string, any>} */
    const handle = {};

    Object.defineProperty(handle, "id", { enumerable: true, get: () => id });
    Object.defineProperty(handle, "kind", { enumerable: true, get: () => ops.kindOf(id) });
    Object.defineProperty(handle, "exists", { enumerable: true, get: () => ops.kindOf(id) !== null });

    // Generic escape hatches for any field, including ones not in the schema.
    handle.get = (field) => ops.get(id, field);
    handle.set = (field, value) => { ops.set(id, field, value); return handle; };

    // Named authored-field accessors: read/write through the operation set.
    for (const key of AUTHORED_FIELD_KEYS) {
        Object.defineProperty(handle, key, {
            enumerable: true,
            get: () => ops.get(id, key),
            set: (v) => { ops.set(id, key, v); },
        });
    }

    // Derived runtime reads: read-only; assignment is a programming error.
    for (const key of DERIVED_READS) {
        Object.defineProperty(handle, key, {
            enumerable: true,
            get: () => readRuntime(runtime, id, key),
            set: () => {
                throw new Error(`Object handle ${id}: "${key}" is a derived runtime read and cannot be assigned.`);
            },
        });
    }

    return handle;
}

/**
 * Score-level fields the handle exposes as named read/write accessors. bpm is
 * intentionally absent here — it gets a special accessor (below) that also
 * pushes to the transport.
 */
const SCORE_FIELDS = [
    "output", "engine", "imageName",
    "canvasW", "canvasH", "triggerScale", "spriteScale",
];

/**
 * Create the score handle: score-level state plus the transport and selection
 * reads. Score fields read and write the parsed scene.json object directly
 * (they are piece-wide, not per-object, so they do not go through the per-object
 * operation set). The transport methods forward to an injected transport when
 * present and no-op otherwise, so the handle is inert until the firing-flow
 * stage wires the real transport. Selection is read from an injected source.
 *
 * @param {any} data  The parsed scene.json object (piece-wide fields live here).
 * @param {{
 *   transport?: {play?: Function, stop?: Function, rewind?: Function, setBpm?: Function} | null,
 *   selectionSource?: (() => any) | null,
 * }} [options]
 * @returns {Record<string, any>}
 */
export function createScoreHandle(data, options = {}) {
    const transport = options.transport ?? null;
    const selectionSource = typeof options.selectionSource === "function"
        ? options.selectionSource
        : null;

    /** @type {Record<string, any>} */
    const handle = {};

    // Named score-field accessors read/write the scene object directly.
    for (const key of SCORE_FIELDS) {
        Object.defineProperty(handle, key, {
            enumerable: true,
            get: () => data[key],
            set: (v) => { data[key] = v; },
        });
    }

    // bpm also pushes to the transport when one is wired, so a live tempo
    // change reaches the clock; the authored bpm field is the source of truth.
    Object.defineProperty(handle, "bpm", {
        enumerable: true,
        get: () => data.bpm,
        set: (v) => {
            data.bpm = v;
            if (transport !== null && typeof transport.setBpm === "function") transport.setBpm(v);
        },
    });

    // GeoSonix's hasBackgroundImage gate, derived from the image name.
    Object.defineProperty(handle, "hasBackgroundImage", {
        enumerable: true,
        get: () => typeof data.imageName === "string" && data.imageName.length > 0,
    });

    // The current canvas selection, for the "selection" selector and for
    // callbacks that want to read what the user has selected.
    Object.defineProperty(handle, "selection", {
        enumerable: true,
        get: () => (selectionSource !== null ? selectionSource() : null),
    });

    // Transport: forward to the injected transport, or no-op.
    handle.play = (speed) => {
        if (transport !== null && typeof transport.play === "function") transport.play(speed);
        return handle;
    };
    handle.stop = () => {
        if (transport !== null && typeof transport.stop === "function") transport.stop();
        return handle;
    };
    handle.rewind = () => {
        if (transport !== null && typeof transport.rewind === "function") transport.rewind();
        return handle;
    };

    // Generic escape hatches for any piece-wide field, including the deferred
    // harmony fields (tonic / root / scaleName / chordName / range / rangeLow /
    // mapNotesTo) the substrate does not yet model as named accessors.
    handle.get = (field) => data[field];
    handle.set = (field, value) => { data[field] = value; return handle; };

    return handle;
}
