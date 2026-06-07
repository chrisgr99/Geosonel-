/**
 * Construction builder — the GeosonixV2 scene-construction API.
 *
 * This is the thin, stateful sugar layer the code tab's SETUP section uses to
 * build a scene procedurally, the GeosonixV2 analogue of GeoSonix's standard
 * library (addCurve / addTrigger / setGroup / …). Every builder call desugars
 * to the operation set in sceneOps — create, set, group, position, select, and
 * clear — so construction code, the inspector, the canvas tools, and the save
 * format all resolve to ONE set of operations. See design/DESIGN.md section 3.
 *
 * Stateful CURRENT-OBJECT model. addCurve / addTrigger / addSprite create an
 * object AND make it the current target; the bare setters that follow (set,
 * setColor, group, position, …) act on the current object, so a per-object
 * construction block reads cleanly (create, then describe). select(selector)
 * re-points the current target at an existing object. The selective-merge rule
 * lives in sceneOps: re-running a construction block changes only the fields it
 * explicitly sets and retains everything else, including the user's hand edits;
 * clear() is the explicit full reset.
 *
 * Scope of THIS layer. It covers object creation, the current-target model, and
 * the generic / common-field writes. The richer GeoSonix vocabulary that is tied
 * to geometry or the firing engine — setPointAt / ellipse / plot (curve
 * geometry), the cursor speed/pattern specifics, group-named styling sweeps, and
 * the score-level setup verbs (setBPM / setBackground, which belong to the score
 * handle) — arrives with the geometry and firing-flow stages. The builder is
 * deliberately small and behaviour-free: it is NOT wired to anything yet.
 */

// @ts-check

/**
 * Create a construction builder bound to one operation set.
 *
 * @param {ReturnType<import("./sceneOps.js").createSceneOps>} ops
 * @returns {Record<string, any>}
 */
export function createBuilder(ops) {
    /** The selector the bare setters act on: the current target. */
    const CURRENT = "current";

    const builder = {
        /** The current target id, or null. */
        get current() { return ops.current; },

        /**
         * Full reset: empty the scene. Mirrors the reference example's opening
         * clear(); without it, a run merges into the living scene.
         * @returns {Record<string, any>} this builder, for chaining.
         */
        clear() { ops.clear(); return builder; },

        /**
         * Create a curve (or address an existing one by id) and make it current.
         * @param {string} [id]
         * @returns {string} the curve's id.
         */
        addCurve(id) { return ops.create("curve", id); },

        /**
         * Create a trigger (or address an existing one by id) and make it
         * current. Beat points and triggers are the same diamond object, so a
         * trigger here is also the standalone-trigger form.
         * @param {string} [id]
         * @returns {string} the trigger's id.
         */
        addTrigger(id) { return ops.create("trigger", id); },

        /**
         * Create a sprite (or address an existing one by id) and make it current.
         * @param {string} [id]
         * @returns {string} the sprite's id.
         */
        addSprite(id) { return ops.create("sprite", id); },

        /**
         * Re-point the current target at an existing object (by id or any
         * selector; the last match wins). Returns the new current id or null.
         * @param {string} selector
         * @returns {string | null}
         */
        select(selector) { return ops.select(selector); },

        /**
         * List the ids a selector resolves to.
         * @param {string} selector
         * @returns {string[]}
         */
        ids(selector) { return ops.ids(selector); },

        /**
         * Set one field on the current object. The plain write primitive; only
         * the named field changes (the selective merge).
         * @param {string} field
         * @param {any} value
         * @returns {Record<string, any>} this builder, for chaining.
         */
        set(field, value) { ops.set(CURRENT, field, value); return builder; },

        /**
         * Set one field on every object a selector addresses (not just current).
         * @param {string} selector
         * @param {string} field
         * @param {any} value
         * @returns {Record<string, any>} this builder, for chaining.
         */
        setOn(selector, field, value) { ops.set(selector, field, value); return builder; },

        /**
         * Place the current object at (x, y). Sprites and triggers move;
         * curves are positioned by their geometry, set in the geometry layer.
         * @param {number} x
         * @param {number} y
         * @returns {Record<string, any>} this builder, for chaining.
         */
        position(x, y) { ops.position(CURRENT, x, y); return builder; },

        /**
         * Place every object a selector addresses at (x, y).
         * @param {string} selector
         * @param {number} x
         * @param {number} y
         * @returns {Record<string, any>} this builder, for chaining.
         */
        positionOn(selector, x, y) { ops.position(selector, x, y); return builder; },

        /**
         * Tag the current object with a group name ("" clears membership).
         * @param {string} name
         * @returns {Record<string, any>} this builder, for chaining.
         */
        setGroup(name) { ops.group(CURRENT, name); return builder; },

        /**
         * Tag every object a selector addresses with a group name.
         * @param {string} selector
         * @param {string} name
         * @returns {Record<string, any>} this builder, for chaining.
         */
        groupOn(selector, name) { ops.group(selector, name); return builder; },

        /**
         * Set the current object's display name.
         * @param {string} name
         * @returns {Record<string, any>} this builder, for chaining.
         */
        setName(name) { ops.set(CURRENT, "name", name); return builder; },

        /**
         * Set the current object's colour (a hex string, matching the schema).
         * @param {string} color
         * @returns {Record<string, any>} this builder, for chaining.
         */
        setColor(color) { ops.set(CURRENT, "color", color); return builder; },

        /**
         * Set the current object's per-cycle direction/speed string (cycleSpeeds
         * — GeoSonix's setPattern / setSpeed map here, confirmed from the
         * library: it is the cursor's successive-cycle direction and speed, not
         * a note pattern).
         * @param {string} cycleSpeeds
         * @returns {Record<string, any>} this builder, for chaining.
         */
        setSpeed(cycleSpeeds) { ops.set(CURRENT, "cycleSpeeds", String(cycleSpeeds)); return builder; },
    };

    return builder;
}

/**
 * Flatten a builder into a set of BARE GLOBAL functions for the SETUP section
 * of the code tab, so construction code reads like the GeoSonix reference
 * example — clear(), addCurve(id), setGroup(name), set(field, value), … —
 * rather than builder.addCurve(...). The setup runner injects these as globals
 * in the script's scope. Each wrapper forwards to the builder; the chainable
 * builder return is harmless when called as a bare statement.
 *
 * @param {ReturnType<typeof createBuilder>} builder
 * @returns {Record<string, Function>}
 */
export function builderGlobals(builder) {
    return {
        clear: () => builder.clear(),
        addCurve: (id) => builder.addCurve(id),
        addTrigger: (id) => builder.addTrigger(id),
        addSprite: (id) => builder.addSprite(id),
        select: (selector) => builder.select(selector),
        ids: (selector) => builder.ids(selector),
        set: (field, value) => builder.set(field, value),
        setOn: (selector, field, value) => builder.setOn(selector, field, value),
        setColor: (color) => builder.setColor(color),
        setName: (name) => builder.setName(name),
        setSpeed: (cycleSpeeds) => builder.setSpeed(cycleSpeeds),
        setGroup: (name) => builder.setGroup(name),
        groupOn: (selector, name) => builder.groupOn(selector, name),
        position: (x, y) => builder.position(x, y),
        positionOn: (selector, x, y) => builder.positionOn(selector, x, y),
    };
}

/**
 * Linear remap, the GeoSonix/Processing map(value, inLo, inHi, outLo, outHi). A
 * zero input span returns outLo rather than dividing by zero.
 * @param {number} value @param {number} inLo @param {number} inHi
 * @param {number} outLo @param {number} outHi @returns {number}
 */
function map(value, inLo, inHi, outLo, outHi) {
    if (inHi === inLo) return outLo;
    return outLo + ((Number(value) - inLo) * (outHi - outLo)) / (inHi - inLo);
}

/**
 * Convenience math globals for SETUP construction code, matching the bare names
 * GeoSonix scripts use (sin, cos, TWO_PI, map, …). Numbers and Math functions;
 * the setup runner injects them alongside the builder globals. random() is plain
 * (non-seeded) here — construction is authoring, not the deterministic per-tick
 * replay path; seeded randomness belongs to the firing-flow callbacks.
 */
export const MATH_GLOBALS = {
    PI: Math.PI,
    TWO_PI: Math.PI * 2,
    HALF_PI: Math.PI / 2,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow,
    floor: Math.floor, round: Math.round, ceil: Math.ceil,
    min: Math.min, max: Math.max,
    map,
    random: (lo, hi) => (lo === undefined
        ? Math.random()
        : Number(lo) + Math.random() * (Number(hi) - Number(lo))),
};
