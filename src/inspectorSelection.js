
/**
 * Whether a cyclePattern string appears to use a note-
 * style generator — note(...) or n(...) — whose events
 * carry no s field and so are the events the Note Voice
 * (pitched-sound) override fills. Used only to decide
 * whether to grey the Note Voice dropdown for a single
 * selected object as a do-nothing hint; it never gates
 * the actual injection, which the firing engine applies
 * per event regardless. Deliberately a cheap textual
 * match rather than a parse: it looks for the function
 * name followed by an opening paren (tolerating spaces),
 * with a preceding-character guard so n( inside a longer
 * identifier like fn( or seqn( does not count. Being
 * textual it can misjudge exotic patterns (a name built
 * dynamically, a string literal containing "note("), so
 * the caller only ever uses it to grey, never to block.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function patternUsesNote(text) {
    if (typeof text !== "string" || text === "") return false;
    return /(^|[^A-Za-z0-9_$])(note|n)\s*\(/.test(text);
}

/**
 * Whether a cyclePattern string appears to use a sound-
 * style generator — sound(...) or s(...) — whose events
 * carry a raw drum name in the s field that the Sound
 * Bank override prefixes. Companion to patternUsesNote
 * with the same textual-match caveats and the same grey-
 * only use; see that function's note. The preceding-
 * character guard keeps the single-letter s( from
 * matching inside longer identifiers (e.g. cps( or
 * superimpose-style names).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function patternUsesSound(text) {
    if (typeof text !== "string" || text === "") return false;
    return /(^|[^A-Za-z0-9_$])(sound|s)\s*\(/.test(text);
}

/**
 * Compute derived state from a raw selection. Centralised
 * so each band builder reads from a consistent shape rather
 * than re-deriving whether sprites/triggers/curves are
 * present.
 *
 * @param {{sprites: number[], triggers: number[], curves: number[]}} selection
 */
export function buildSelectionContext(selection) {
    const sprites = selection.sprites || [];
    const triggers = selection.triggers || [];
    const curves = selection.curves || [];
    const total = sprites.length + triggers.length + curves.length;

    /** @type {Array<"sprite"|"trigger"|"curve">} */
    const kinds = [];
    if (sprites.length > 0) kinds.push("sprite");
    if (triggers.length > 0) kinds.push("trigger");
    if (curves.length > 0) kinds.push("curve");

    return {
        sprites, triggers, curves, total, kinds,
        isSingle: total === 1,
        singleKind: kinds.length === 1 ? kinds[0] : null,
        hasSprites: sprites.length > 0,
        hasTriggers: triggers.length > 0,
        hasCurves: curves.length > 0,
    };
}

/**
 * Compute the title text for any non-empty selection.
 * Used as the multi-select title verbatim, and as the
 * single-select fallback when the scene hasn't loaded yet
 * or the object's id can't be resolved (single-select
 * normally uses singleSelectIdTitle below). Single-kind
 * selections read as "N Kind" or "N Kinds" with simple
 * pluralisation; multi-kind selections join the per-kind
 * counts with commas ("2 Sprites, 1 Curve").
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 * @returns {string}
 */
export function selectionSummaryTitle(ctx) {
    const parts = [];
    if (ctx.hasSprites) parts.push(pluralCount(ctx.sprites.length, "Sprite"));
    if (ctx.hasTriggers) parts.push(pluralCount(ctx.triggers.length, "Trigger"));
    if (ctx.hasCurves) parts.push(pluralCount(ctx.curves.length, "Curve"));
    return parts.join(", ");
}

/**
 * Compose the single-select title as "Kind ID" — for
 * example "Sprite SPR1", "Trigger TRG3", "Curve CRV2".
 * Returns null when the scene isn't loaded yet, when the
 * selected index can't be resolved against the scene's
 * arrays, or when the object lacks an id; the caller
 * falls back to the count-based summary in those narrow
 * cases. Multi-select callers shouldn't reach here; the
 * function bails defensively if they do.
 *
 * @param {ReturnType<typeof buildSelectionContext>} ctx
 * @param {import("./scene.js").Scene | null} scene
 * @returns {string | null}
 */
export function singleSelectIdTitle(ctx, scene) {
    if (scene === null || !ctx.isSingle || ctx.singleKind === null) return null;
    const kind = ctx.singleKind;
    const idx = ctx.sprites[0] ?? ctx.triggers[0] ?? ctx.curves[0];
    const arr = kind === "sprite" ? scene.sprites
              : kind === "trigger" ? scene.triggers
              : scene.curves;
    if (idx < 0 || idx >= arr.length) return null;
    const obj = arr[idx];
    const id = typeof obj.id === "string" ? obj.id : "";
    if (id.length === 0) return null;
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    return `${cap} ${id}`;
}

/**
 * Materialise the selected objects out of a runtime scene.
 * Returns four arrays: per-kind groupings plus a combined
 * "all" list useful for cross-kind aggregation (e.g. mute
 * across the whole selection). Indexes that fall outside
 * the scene's arrays are silently dropped — the canvas
 * filters its own stale selection on every reload but a
 * defensive filter here keeps a transient mismatch from
 * crashing the inspector.
 *
 * @param {import("./scene.js").Scene | null} scene
 * @param {{sprites: number[], triggers: number[], curves: number[]}} selection
 * @returns {{ all: any[], sprites: any[], triggers: any[], curves: any[] }}
 */
export function selectedObjects(scene, selection) {
    if (scene === null) {
        return { all: [], sprites: [], triggers: [], curves: [] };
    }
    const sprites = selection.sprites
        .filter((idx) => idx >= 0 && idx < scene.sprites.length)
        .map((idx) => scene.sprites[idx]);
    const triggers = selection.triggers
        .filter((idx) => idx >= 0 && idx < scene.triggers.length)
        .map((idx) => scene.triggers[idx]);
    const curves = selection.curves
        .filter((idx) => idx >= 0 && idx < scene.curves.length)
        .map((idx) => scene.curves[idx]);
    return {
        all: [...sprites, ...triggers, ...curves],
        sprites, triggers, curves,
    };
}

/**
 * Aggregate a boolean field across a list of objects.
 * Returns true if every object's field is truthy, false if
 * every object's field is falsy, or the string "varies" if
 * the values disagree. Empty list returns false (the field
 * has no representative value). Used by Band 1 for Mute and
 * by Band 3 for the canHit / canBeHit / canTick checkboxes
 * so multi-select can render a tri-state checkbox indicating
 * divergence.
 *
 * @param {any[]} objects
 * @param {string} fieldName
 * @returns {boolean | "varies"}
 */
export function aggregateBoolean(objects, fieldName) {
    if (objects.length === 0) return false;
    let value = null;
    for (const obj of objects) {
        const v = !!obj[fieldName];
        if (value === null) {
            value = v;
        } else if (value !== v) {
            return "varies";
        }
    }
    return value === true;
}

/**
 * Aggregate a string-valued (or stringifiable) field across
 * a list of objects. Returns the common value as a string
 * when every object's field matches, the literal "varies"
 * when values disagree, or empty string for an empty list
 * or a uniformly-null/undefined field. Numeric fields work
 * too — they're compared by raw value (so number 4 and
 * string "4" stay distinct) and stringified only on output.
 *
 * Read-binding call sites unwrap the "varies" return as an
 * empty field — the v1 decision is to render divergence
 * blank for now and revisit a richer indicator once write
 * binding makes a divergent commit potentially destructive.
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
 * Aggregate a per-object voice subfield (e.g.
 * voice.superdough.sound) across a list of objects.
 * Returns the common value as a string when every
 * object's nested field matches, the literal "varies"
 * when values disagree, or empty string for an empty
 * list or a uniformly-missing field. Missing nesting at
 * any level (no voice key, no engine subkey, no field
 * subkey) reads as the empty-string "Default" sentinel
 * so an object that never customised its voice
 * aggregates cleanly alongside one that explicitly set
 * the field to its default. Used by the middle band's
 * dropdown read bindings.
 *
 * @param {any[]} objects
 * @param {string} engine  Engine name (e.g. "superdough").
 * @param {string} field   Field name within the engine subobject (e.g. "sound").
 * @returns {string | "varies"}
 */
export function aggregateVoiceField(objects, engine, field) {
    if (objects.length === 0) return "";
    let common = null;
    let initialised = false;
    for (const obj of objects) {
        const voice = (obj === null || typeof obj !== "object") ? null : obj.voice;
        const sub = (voice === null || typeof voice !== "object" || Array.isArray(voice))
            ? null
            : voice[engine];
        const raw = (sub === null || typeof sub !== "object" || Array.isArray(sub))
            ? undefined
            : sub[field];
        const normalised = (raw === null || raw === undefined) ? "" : String(raw);
        if (!initialised) {
            common = normalised;
            initialised = true;
        } else if (normalised !== common) {
            return "varies";
        }
    }
    return common ?? "";
}

/**
 * Aggregate a numeric position coordinate (X or Y) across
 * every selected sprite, trigger, and curve. For sprites and
 * triggers the coordinate comes from the object's x/y field;
 * for curves it comes from the bounding-box centroid via
 * computeShapeBboxCentroid. Returns the common value as a
 * stringified number, the literal "varies" when objects
 * disagree, or empty string for an empty selection or a
 * curve whose shape produced no centroid.
 *
 * Used by the Band 2 Position field's read binding. Edits
 * commit through setPositionAxis (absolute), so the field
 * stays editable across single-select, uniform multi-select,
 * and varies multi-select.
 *
 * @param {{ sprites: any[], triggers: any[], curves: any[] }} objs
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
    for (const t of objs.triggers) {
        const v = axis === "x" ? t.x : t.y;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    for (const c of objs.curves) {
        const centroid = computeShapeBboxCentroid(c.shape);
        if (centroid === null) continue;
        const v = axis === "x" ? centroid.x : centroid.y;
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
 * Aggregate a starting velocity component (vx or vy) across
 * every selected sprite and curve. Triggers in the selection
 * are ignored — triggers don't move under physics and carry
 * no vx/vy fields. Returns the common value as a stringified
 * number, the literal "varies" when sources disagree, or
 * empty string for a selection with no sprite or curve.
 * Mirrors aggregatePosition's shape; the axis parameter
 * follows the position-axis convention ("x" or "y") and
 * maps internally to the vx/vy field names.
 *
 * Used by the Band 2 Starting State row's vX and vY read
 * binding. Edits commit through setVelocityAxis (absolute),
 * so the fields stay editable across single-select, uniform
 * multi-select, and varies multi-select.
 *
 * @param {{ sprites: any[], triggers: any[], curves: any[] }} objs
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
export function aggregateVelocity(objs, axis) {
    /** @type {number[]} */
    const values = [];
    for (const s of objs.sprites) {
        const v = axis === "x" ? s.vx : s.vy;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    for (const c of objs.curves) {
        const v = axis === "x" ? c.vx : c.vy;
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return String(first);
}

/**
 * Aggregate a curve's W or H dimension across every selected
 * curve. The dimension comes from each curve's bounding box:
 * for an ellipse the bbox width is shape.w (the field is
 * already the bbox extent); for a line it is the absolute
 * difference of endpoint coordinates; for a piste it is the
 * spread of point coordinates in that axis. Returns the
 * common value as a stringified number, "varies" when curves
 * disagree, or empty for an empty curve list.
 *
 * Used by the Band 2 Curve Size field's read binding. Edits
 * commit through setSizeAxis (absolute), so the field stays
 * editable across single-select, uniform multi-select, and
 * varies multi-select.
 *
 * @param {any[]} curves
 * @param {"x" | "y"} axis
 * @returns {string | "varies"}
 */
export function aggregateCurveSize(curves, axis) {
    /** @type {number[]} */
    const values = [];
    for (const c of curves) {
        const bbox = computeShapeBbox(c.shape);
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
 * Aggregate the colour field across every selected object.
 * Curves, sprites, and triggers all carry a per-object
 * colour, so the aggregate walks all three slices. Returns
 * the common value as a hex string, "varies" when objects
 * disagree, or empty for an empty selection.
 *
 * @param {{ sprites: any[], triggers: any[], curves: any[] }} objs
 * @returns {string | "varies"}
 */
export function aggregateColor(objs) {
    /** @type {string[]} */
    const values = [];
    for (const s of objs.sprites) {
        if (typeof s.color === "string") values.push(s.color);
    }
    for (const t of objs.triggers) {
        if (typeof t.color === "string") values.push(t.color);
    }
    for (const c of objs.curves) {
        if (typeof c.color === "string") values.push(c.color);
    }
    if (values.length === 0) return "";
    const first = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] !== first) return "varies";
    }
    return first;
}

/**
 * Compute the axis-aligned bounding box of a curve shape in
 * canvas units, or null when the shape is degenerate or not
 * yet implemented (bezier, helice). Used by the Band 2 read
 * paths to derive Position (centroid) and Curve Size (W, H)
 * values for curves. Mirrors canvas.js's curveBoundingBox
 * function but lives here as a separate copy so the
 * inspector doesn't have to import canvas internals — the
 * shape grammar is small and stable.
 *
 * @param {any} shape
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
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
 * Compute the bounding-box centroid of a curve shape in
 * canvas units, or null when the shape is degenerate or not
 * yet implemented. Used by the Band 2 Position read path
 * for curves — a curve's "position" is its bbox centroid,
 * matching the visual centre of the selection-marker
 * rectangle drawn around it.
 *
 * @param {any} shape
 * @returns {{ x: number, y: number } | null}
 */
export function computeShapeBboxCentroid(shape) {
    const bbox = computeShapeBbox(shape);
    if (bbox === null) return null;
    return {
        x: (bbox.x1 + bbox.x2) / 2,
        y: (bbox.y1 + bbox.y2) / 2,
    };
}

/** @param {ReturnType<typeof buildSelectionContext>} ctx */
export function sizeRowLabel(ctx) {
    if (ctx.singleKind === "sprite") return "Sprite Size";
    if (ctx.singleKind === "trigger") return "Trigger Size";
    // For mixed and curve-only selections the row is greyed;
    // default to "Sprite Size" so the row's footprint stays
    // identical regardless of selection.
    return "Sprite Size";
}

/** @param {ReturnType<typeof buildSelectionContext>} ctx */
export function sizeRowActive(ctx) {
    // Active only when the selection is exclusively sprites
    // or exclusively triggers — XOR of those two flags, with
    // no curves in the selection.
    return (ctx.hasSprites !== ctx.hasTriggers) && !ctx.hasCurves;
}

/**
 * @param {number} n
 * @param {string} singular
 */
export function pluralCount(n, singular) {
    return `${n} ${singular}${n === 1 ? "" : "s"}`;
}
