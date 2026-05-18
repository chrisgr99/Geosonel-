/**
 * Selection-context helpers for the Property Inspector.
 *
 * Pure functions that derive a selection summary, materialise
 * the selected objects out of a runtime scene, and aggregate
 * field values across them. Sits below inspector.js and
 * inspectorFields.js as the kind-aware data layer those two
 * modules consume.
 *
 * v2.5 selection model: {paths, sprites}. The v2.4 third
 * slice (triggers) is gone — free sprites that act as
 * triggers are just sprites whose collision slot is set, so
 * one selection slice covers both roles.
 *
 * Most readers need one of three slices of the selection:
 *
 *   - paths        — Path objects, for shape, curveThickness,
 *                    and hide reads (the path-level fields).
 *   - pathSprites  — the bound Sprite from each selected
 *                    path. Carries every other field that
 *                    belongs to a path's identity (id, name,
 *                    mute, cursor extents, hit slots, motion
 *                    update slot, ...).
 *   - sprites      — free Sprite objects.
 *
 * For aggregations across every selected sprite-shaped
 * object (e.g. mute, name, motionUpdate), the union
 * `allSprites = pathSprites + sprites` is the right input
 * — the unified Sprite class makes one schema cover both
 * locations.
 */

// @ts-check

/**
 * @typedef {{paths: number[], sprites: number[]}} Selection
 */

/**
 * User-facing identifiers for the v2.5 Behaviours band
 * callback slots, in camelCase to match JavaScript naming
 * convention. These appear as the inspector row labels and
 * as the prefix in placeholder function names (e.g.
 * cycle_drum1, onTick_drum1). The schema field names
 * underneath are cycle, motionUpdate, hitTrigger, and
 * collision; the user never sees them, except for cycle
 * where the user-facing label and the schema field name
 * happen to coincide. CALLBACK_LABELS and CALLBACK_SLOT_KEYS
 * are index-aligned so callers can map between display name
 * and storage key by position.
 *
 * The onTick name (rather than motionUpdate) reflects the
 * slot's evolution from a motion-only hook to a general
 * per-tick callback the composer can use for any tick-rate
 * effect.
 */
export const CALLBACK_LABELS = ["cycle", "onTick", "hasHit", "beenHit"];
export const CALLBACK_SLOT_KEYS = ["cycle", "motionUpdate", "hitTrigger", "collision"];

/**
 * Build a selection-context summary used by the band
 * builders and the title bar.
 *
 * @param {Selection} selection
 */
export function buildSelectionContext(selection) {
    const paths = selection.paths || [];
    const sprites = selection.sprites || [];
    const total = paths.length + sprites.length;

    /** @type {Array<"path"|"sprite">} */
    const kinds = [];
    if (paths.length > 0) kinds.push("path");
    if (sprites.length > 0) kinds.push("sprite");

    return {
        paths, sprites, total, kinds,
        isSingle: total === 1,
        singleKind: kinds.length === 1 ? kinds[0] : null,
        hasPaths: paths.length > 0,
        hasSprites: sprites.length > 0,
    };
}

/**
 * Compute the title text for any non-empty selection.
 * Always a count-and-kinds summary, never per-object
 * identity — the per-object id and name live in Band 1
 * below where they can be read and edited. Single-kind
 * selections read as "N Path[s]" or "M Sprite[s]"; multi-
 * kind selections join the per-kind counts with commas
 * ("2 Sprites, 1 Path").
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 */
export function selectionSummaryTitle(ctx) {
    const parts = [];
    if (ctx.hasPaths) parts.push(pluralCount(ctx.paths.length, "Path"));
    if (ctx.hasSprites) parts.push(pluralCount(ctx.sprites.length, "Sprite"));
    return parts.join(", ");
}

/**
 * Compute the title text for a single-object selection.
 * Three cases, in priority order:
 *
 *   - User has typed a name on the object: "Kind name"
 *     (e.g. "Sprite drum1"). The kind prefix makes
 *     explicit what kind of object the user-typed name
 *     belongs to, since the typed name itself doesn't
 *     necessarily encode kind.
 *   - User hasn't typed a name: just the auto-id (e.g.
 *     "sprite1" or "path1"). The id already carries its
 *     kind as a prefix so a separate kind word would just
 *     repeat it.
 *   - Object can't be resolved (scene null, index out of
 *     range, missing identity fields): null. The caller
 *     falls back to a count-based summary in that case,
 *     matching the not-yet-loaded behaviour the inspector
 *     used before counted ids landed.
 *
 * For a path the identity fields live on the bound sprite
 * (path.sprite.name, path.sprite.id); for a free sprite,
 * on the entry itself.
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 * @param {import("./scene.js").Scene | null} scene
 * @returns {string | null}
 */
export function singleSelectTitle(ctx, scene) {
    if (scene === null || !ctx.isSingle || ctx.singleKind === null) return null;
    /** @type {{name: string, id: string} | null} */
    let identity = null;
    if (ctx.singleKind === "path") {
        const idx = ctx.paths[0];
        if (idx < 0 || idx >= scene.paths.length) return null;
        const sp = scene.paths[idx]?.sprite;
        if (sp === null || sp === undefined) return null;
        identity = {
            name: typeof sp.name === "string" ? sp.name : "",
            id: typeof sp.id === "string" ? sp.id : "",
        };
    } else {
        const idx = ctx.sprites[0];
        if (idx < 0 || idx >= scene.sprites.length) return null;
        const s = scene.sprites[idx];
        identity = {
            name: typeof s.name === "string" ? s.name : "",
            id: typeof s.id === "string" ? s.id : "",
        };
    }
    if (identity.name.length > 0) {
        const cap = ctx.singleKind.charAt(0).toUpperCase() + ctx.singleKind.slice(1);
        return `${cap} ${identity.name}`;
    }
    if (identity.id.length > 0) return identity.id;
    return null;
}

/**
 * Materialise the selected objects out of a runtime scene.
 * Returns sliced views of the selection that the band
 * builders consume:
 *
 *   - all          — paths + sprites combined (for total-
 *                    count callers)
 *   - paths        — Path objects (geometry-level reads:
 *                    shape, curveThickness, hide)
 *   - pathSprites  — each selected path's bound Sprite
 *                    (identity and most field reads on a
 *                    path)
 *   - sprites      — free Sprite objects
 *   - allSprites   — pathSprites + sprites (uniformly-
 *                    schema'd reads: id, name, mute,
 *                    motionUpdate, hitTrigger, collision)
 *
 * Indexes that fall outside their array are silently
 * dropped, so a transient mismatch between the inspector's
 * cached scene and the just-edited bundle doesn't crash
 * the read paths.
 *
 * @param {import("./scene.js").Scene | null} scene
 * @param {Selection} selection
 */
export function selectedObjects(scene, selection) {
    if (scene === null) {
        return { all: [], paths: [], pathSprites: [], sprites: [], allSprites: [] };
    }
    const paths = (selection.paths || [])
        .filter((idx) => idx >= 0 && idx < scene.paths.length)
        .map((idx) => scene.paths[idx]);
    const pathSprites = paths
        .map((p) => p.sprite)
        .filter((s) => s !== null && typeof s === "object");
    const sprites = (selection.sprites || [])
        .filter((idx) => idx >= 0 && idx < scene.sprites.length)
        .map((idx) => scene.sprites[idx]);
    return {
        all: [...paths, ...sprites],
        paths,
        pathSprites,
        sprites,
        allSprites: [...pathSprites, ...sprites],
    };
}

/**
 * Aggregate a boolean field across a list of objects.
 * Returns true if every object's field is truthy, false if
 * every object's field is falsy, or "varies" on disagreement.
 * Empty list returns false (the field has no representative
 * value). Used by Band 1 for Mute and Hide and by Band 3
 * for the cycle/collide gates.
 *
 * The optional defaultTrue flag governs how a missing field
 * (undefined or null on the object) is interpreted. With
 * defaultTrue=false the field reads as falsy; with
 * defaultTrue=true the field reads as truthy. Use the latter
 * for schema fields whose constructor default is true and
 * which existing scenes may not yet have on disk — canCycle,
 * canHit, canBeHit — so the inspector renders the gate
 * checkboxes in the same checked state the runtime applies.
 * The first toggle persists the field with whichever value
 * the user picked, so the missing-field state is transient
 * per object.
 *
 * @param {any[]} objects
 * @param {string} fieldName
 * @param {boolean} [defaultTrue]  Treat a missing field as true.
 * @returns {boolean | "varies"}
 */
export function aggregateBoolean(objects, fieldName, defaultTrue = false) {
    if (objects.length === 0) return false;
    let value = null;
    for (const obj of objects) {
        const raw = obj[fieldName];
        const v = (raw === undefined || raw === null) ? defaultTrue : !!raw;
        if (value === null) value = v;
        else if (value !== v) return "varies";
    }
    return value === true;
}

/**
 * Aggregate a string-valued (or stringifiable) field across
 * a list of objects. Returns the common value as a string,
 * "varies" on disagreement, or empty string for an empty list
 * or a uniformly-null/undefined field. Numeric fields work
 * too — they're compared by raw value (so number 4 and
 * string "4" stay distinct) and stringified only on output.
 *
 * @param {any[]} objects
 * @param {string} fieldName
 * @returns {string | "varies"}
 */
export function aggregateString(objects, fieldName) {
    if (objects.length === 0) return "";
    const firstRaw = objects[0][fieldName];
    for (let i = 1; i < objects.length; i++) {
        if (objects[i][fieldName] !== firstRaw) return "varies";
    }
    if (firstRaw === null || firstRaw === undefined) return "";
    return String(firstRaw);
}

/**
 * Aggregate a numeric position coordinate (X or Y) across
 * every selected path and sprite. For sprites the coordinate
 * comes from x/y; for paths from the bounding-box centroid.
 * Returns the common value as a stringified number, "varies"
 * on disagreement, or empty string for an empty selection or
 * a path whose shape produced no centroid.
 *
 * @param {{paths: any[], sprites: any[]}} objs
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
export function aggregatePosition(objs, axis) {
    /** @type {number[]} */
    const values = [];
    for (const s of objs.sprites) {
        const v = axis === "x" ? s.x : s.y;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    for (const p of objs.paths) {
        const c = computeShapeBboxCentroid(p.shape);
        if (c === null) continue;
        const v = axis === "x" ? c.x : c.y;
        if (Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return String(first);
}

/**
 * Aggregate a path's W or H bounding-box dimension across
 * every selected path. Returns the common value as a
 * stringified number, "varies" on disagreement, or empty
 * string for an empty path list or a degenerate shape.
 *
 * Used by the Band 2 Path Size field's read binding. Edits
 * commit through setSizeAxisOnSelection with the typed value
 * as the absolute target.
 *
 * @param {any[]} paths
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
export function aggregatePathSize(paths, axis) {
    /** @type {number[]} */
    const values = [];
    for (const p of paths) {
        const bbox = computeShapeBbox(p.shape);
        if (bbox === null) continue;
        const v = axis === "x" ? (bbox.x2 - bbox.x1) : (bbox.y2 - bbox.y1);
        if (Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return String(first);
}

/**
 * Aggregate the colour field across every selected free
 * sprite. Path-bound-sprite colour editing is deferred from
 * this pass — the schema carries the field but the v2.5
 * Phase 1 inspector only writes Color for free sprites.
 * Unified colour editing across both kinds lands later.
 *
 * @param {{sprites: any[]}} objs
 * @returns {string | "varies"}
 */
export function aggregateColor(objs) {
    /** @type {string[]} */
    const values = [];
    for (const s of objs.sprites) {
        if (typeof s.color === "string") values.push(s.color);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return first;
}

/**
 * Compute the axis-aligned bounding box of a path shape, or
 * null if the shape is degenerate or not yet implemented
 * (bezier, helice). Used by the Band 2 read paths to derive
 * Position (centroid) and Path Size (W, H) values for paths.
 *
 * @param {any} shape
 * @returns {{x1: number, y1: number, x2: number, y2: number} | null}
 */
export function computeShapeBbox(shape) {
    if (shape === null || typeof shape !== "object") return null;
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
        return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
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
 * Bounding-box centroid of a path shape, or null if the
 * shape is degenerate or not yet implemented.
 */
export function computeShapeBboxCentroid(shape) {
    const bbox = computeShapeBbox(shape);
    if (bbox === null) return null;
    return { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 };
}

/**
 * Sprite Size row label. v2.5 has only one label here since
 * triggers are gone; kept as a function for symmetry with
 * sizeRowActive in case future kinds reintroduce per-kind
 * labels.
 */
export function sizeRowLabel() {
    return "Sprite Size";
}

/**
 * Sprite Size row active iff the selection contains free
 * sprites and no paths. The displayDiameter field exists on
 * bound sprites too via the unified schema, but the v2.5
 * Phase 1 inspector only exposes it for free sprites; bound-
 * sprite size editing in the inspector lands later.
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 */
export function sizeRowActive(ctx) {
    return ctx.hasSprites && !ctx.hasPaths;
}

/**
 * The edit kind a Behaviours band slot field commit emits,
 * given the slot key. main.js dispatches on the returned
 * string to a sceneEditor mutator. Covers all four wired
 * slots in the v2.5 Behaviours band: cycle, onTick (stored
 * as motionUpdate), hasHit (hitTrigger), and beenHit
 * (collision).
 */
export function editKindForSlot(slotKey) {
    if (slotKey === "cycle") return "setCycle";
    if (slotKey === "motionUpdate") return "setMotionUpdate";
    if (slotKey === "hitTrigger") return "setHitTrigger";
    if (slotKey === "collision") return "setCollision";
    return "setMotionUpdate"; // defensive; the four slots above cover the band
}

/**
 * Compute the proposed function name for a slot's Create
 * button (and the placeholder hint shown when the slot's
 * field is empty).
 *
 * The form is `<userLabel>_<objectName>`, where userLabel
 * is the inspector row's user-facing identifier (onTick,
 * hasHit, beenHit) and objectName is the typed name when
 * present, falling back to the generated id otherwise. All
 * three slots behave uniformly — there is no shared-default
 * special case for any slot, so the inspector's Create
 * button always scaffolds a per-object function.
 *
 * For a path the identity fields (id, name) live on the
 * bound sprite; for a free sprite, on the entry itself.
 * The function descends into entry.sprite when given a
 * Path so callers can pass either kind directly.
 *
 * @param {string} slotKey  Schema key (cycle, motionUpdate,
 *     hitTrigger, collision).
 * @param {"path" | "sprite" | null} kind
 * @param {any} obj  The single selected object.
 * @returns {string}
 */
export function proposedFunctionName(slotKey, kind, obj) {
    const slotIdx = CALLBACK_SLOT_KEYS.indexOf(slotKey);
    const userLabel = slotIdx >= 0 ? CALLBACK_LABELS[slotIdx] : slotKey;
    const identity = (kind === "path" && obj && typeof obj === "object" && obj.sprite)
        ? obj.sprite
        : obj;
    if (identity === null || typeof identity !== "object") return userLabel;
    const name = (typeof identity.name === "string" && identity.name.length > 0)
        ? identity.name
        : null;
    const id = typeof identity.id === "string" ? identity.id : "";
    const suffix = name !== null ? name : id;
    if (suffix === "") return userLabel;
    return `${userLabel}_${suffix}`;
}

/**
 * @param {number} n
 * @param {string} singular
 */
export function pluralCount(n, singular) {
    return `${n} ${singular}${n === 1 ? "" : "s"}`;
}
