/**
 * Scene data model.
 *
 * A Scene is the declared structure of a GXW score: a bag of
 * curves, triggers, and sprites, plus piece-level parameters
 * (transport, harmony framework, image, output target).
 *
 * The Scene is produced by running the sketch's setup() and
 * top-level code. The sketch references piece-level setters
 * (bpm, tonic, scale, etc.) and adds objects via
 * scene.addCurve, scene.addTrigger, scene.addSprite — each
 * receiving a single options object with declarative
 * properties.
 *
 * Object types follow the section-27 strudel-pattern-language
 * model. Each source kind (curve, trigger, sprite) carries
 * the same four uniform callback slots, each guarded by a
 * Can-X gate boolean:
 *
 *   - cycle    — fires on cycle start. Carries cyclePattern,
 *                cyclePatternLocation ("Here" or "Code Tab"),
 *                and beatsPerCycle. cyclePattern is an inline
 *                strudel mini-notation pattern in "Here" mode,
 *                or the name of a function in the Code tab in
 *                "Code Tab" mode.
 *   - hasHit   — fires when the source hits another source;
 *                bound function in hasHitFunction.
 *   - beenHit  — fires when the source is hit by another;
 *                bound function in beenHitFunction.
 *   - onTick   — fires every simulation tick; bound function
 *                in onTickFunction.
 *
 * Curves additionally carry geometry and a cursor with
 * left/right extents. Triggers additionally carry position,
 * size, colour, and an optional payload. Sprites additionally
 * carry position, velocity, maxSpeed, and displayDiameter.
 *
 * Function-name fields (hasHitFunction, beenHitFunction,
 * onTickFunction, and cyclePattern in "Code Tab" mode) hold
 * STRING NAMES of functions defined in the bundle's
 * behaviors.js file, not function references. The Scene also
 * carries a functionMap built by the scene loader at load
 * time, mapping each top-level function name in behaviors.js
 * to its function reference; the simulation looks up names
 * against this map when firing. Empty-string slot fields mean
 * "no binding". A non-empty slot whose name doesn't resolve
 * in the map is a soft error — the slot stays inert for that
 * object and the inspector eventually surfaces a warning, but
 * the scene still runs.
 *
 * Per-object harmony override fields (tonic, scaleName, root,
 * chordName, range, rangeLow, mapNotesTo) default to null
 * meaning "inherit from score". Per-object MIDI routing
 * (channel, port, base note) is not yet modeled — that arrives
 * with audio output in a later milestone.
 */

// @ts-check

import { generateId } from "./idGen.js";

export class Scene {
    constructor() {
        /** @type {Curve[]} */
        this.curves = [];
        /** @type {Trigger[]} */
        this.triggers = [];
        /** @type {Sprite[]} */
        this.sprites = [];

        // --- Transport ---
        /** @type {number | null} */
        this.bpm = null;

        // --- Harmony framework (score-level defaults). ---
        /** @type {string | null} */
        this.tonic = null;
        /** @type {string | null} */
        this.scaleName = null;
        /** @type {string | null} */
        this.root = null;
        /** @type {string | null} */
        this.chordName = null;
        /** @type {number | null} */
        this.range = null;
        /** @type {number | null} */
        this.rangeLow = null;
        /** @type {("Score" | "Scale" | "Chord" | "None") | null} */
        this.mapNotesTo = null;

        // --- Image and output ---
        /** @type {string | null} */
        this.imageName = null;
        /** @type {{target: string, port: string | null} | null} */
        this.output = null;

        // --- Canvas size ---
        // Width and height of the rectangular play area in
        // canvas units, centred on the origin. The image
        // (when one is loaded) stretches to fill this region;
        // the area outside it draws as a darker grey with a
        // grey border around the canvas. Sprite walls bounce
        // at canvas ± W/2 and ± H/2 once sprite physics lands
        // in milestone 2. Independent of the viewport: the
        // viewport stays at ±16 × ±12 at zoom 1 regardless of
        // canvas size, so a small canvas reads as a small
        // bordered rectangle in the centre of a larger empty
        // viewport, and a large canvas extends past the
        // viewport (zoom out to see it all).
        // Defaults match the legacy hardcoded image region
        // so scenes loading without canvas-size fields look
        // identical to before.
        //
        // The canvas is a SOFT boundary, not a hard
        // constraint on what can exist in the scene. Three
        // concrete jobs depend on the canvas dimensions:
        //   - Image stretching: the image (when loaded)
        //     fills exactly canvasW × canvasH centred on the
        //     origin. Pixel sampling for trigger and sprite
        //     fills tracks the same region.
        //   - Sprite walls (milestone 2): sprites bounce off
        //     the four canvas edges using these dimensions.
        //   - Visual play-area hint: the canvas border anchors
        //     the eye on where composition was intended.
        // Curves and triggers are explicitly NOT clamped to
        // the canvas. A curve whose geometry extends past
        // the canvas is fully traced by its cursor; the
        // cursor visibly leaves the canvas region into the
        // darker surround when the curve takes it there.
        // This is by design — a composer might author such
        // curves intentionally (an off-stage gesture
        // returning to the canvas) or leave them half-out
        // accidentally, and a hard clamp would silently
        // damage the second case while denying the first.
        //
        // Off-canvas firing semantics (deferred until the
        // audio path lands with the Strudel migration).
        // Intended default: the cursor mutes audio firing
        // whenever its position is outside the canvas
        // region, since music-generation samples there
        // read the no-image fallback colour and would
        // produce sound the composer didn't paint. A
        // composer who wants the off-canvas fallback as
        // part of the piece can override the mute via a
        // per-scene muteOffCanvas boolean (default true);
        // a global preference can layer on top later if
        // useful. The boolean is intentionally NOT added
        // to the schema here — it lands alongside the
        // firing path so its semantics and consumer arrive
        // together rather than sitting as an inert future
        // hook.
        /** @type {number} */
        this.canvasW = 32;
        /** @type {number} */
        this.canvasH = 24;

        // --- Per-score display scales ---
        // Multipliers applied to every trigger and sprite at
        // draw time. Travel with the score so a piece looks
        // the same on any user's screen as it did on its
        // author's. The Settings dialog seeds these values into
        // newly-created scores; they're never overridden once
        // stored. spriteScale is part of the music (it changes
        // how sprites bounce off canvas walls); triggerScale
        // is purely visual under the point-collision model.
        /** @type {number} */
        this.triggerScale = 1;
        /** @type {number} */
        this.spriteScale = 1;

        // --- Function map ---
        // Map of top-level function names in behaviors.js to
        // their function references. Built by the scene loader
        // at load time and attached here for the simulation to
        // consult when firing a slot. Slot fields on Curve,
        // Trigger, and Sprite hold name strings; the simulation
        // resolves them against this map at fire time. An
        // unresolved name (typo, function deleted from
        // behaviors.js without unbinding) is a soft error —
        // the slot stays inert for that object and the
        // inspector surfaces a warning, but the scene runs.
        // Empty by default; populated only for scenes loaded
        // through SceneLoader.load() with a behaviors.js file
        // present.
        /** @type {Object<string, Function>} */
        this.functionMap = {};
    }

    /**
     * Add a curve to the scene.
     * @param {Object} opts
     * @returns {Curve}
     */
    addCurve(opts) {
        const id = opts.id ?? this._nextId("curve");
        const c = new Curve(opts, id);
        this.curves.push(c);
        return c;
    }

    /**
     * Add a trigger to the scene.
     * @param {Object} opts
     * @returns {Trigger}
     */
    addTrigger(opts) {
        const id = opts.id ?? this._nextId("trigger");
        const t = new Trigger(opts, id);
        this.triggers.push(t);
        return t;
    }

    /**
     * Add a sprite to the scene.
     * @param {Object} opts
     * @returns {Sprite}
     */
    addSprite(opts) {
        const id = opts.id ?? this._nextId("sprite");
        const s = new Sprite(opts, id);
        this.sprites.push(s);
        return s;
    }

    /**
     * Generate a fresh id for a new object. Used when an
     * object is added through scene.addCurve/addTrigger/
     * addSprite without an explicit id. The fill-in pass in
     * sceneEditor.fillMissingIds covers the load-time case;
     * this fallback covers the rare path where an object is
     * built in memory without going through scene.json (e.g.
     * tests, or future programmatic-construction APIs).
     *
     * @param {"curve" | "trigger" | "sprite"} kind
     * @returns {string}
     */
    _nextId(kind) {
        const existing = new Set();
        for (const c of this.curves) existing.add(c.id);
        for (const t of this.triggers) existing.add(t.id);
        for (const s of this.sprites) existing.add(s.id);
        return generateId(kind, existing);
    }
}

/**
 * @typedef {Object} ShapeLine
 * @property {"line"} type
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * @typedef {Object} ShapeEllipse
 * @property {"ellipse"} type
 * @property {number} cx
 * @property {number} cy
 * @property {number} w  Full width in canvas units (horizontal extent).
 * @property {number} h  Full height in canvas units (vertical extent).
 *
 * A circle is an ellipse with w === h. Stored as an ellipse
 * regardless so that toolbar-created circles and runtime-
 * distorted ellipses share one geometry primitive — the
 * inspector's W and H fields can be edited independently and
 * the shape-type string never has to change as a side effect
 * of typing in a number.
 */

/**
 * @typedef {Object} ShapePiste
 * @property {"piste"} type
 * @property {Array<[number, number]>} points
 * @property {boolean} [closed]
 */

/** @typedef {ShapeLine | ShapeEllipse | ShapePiste} CurveShape */

export class Curve {
    /**
     * @param {Object} opts
     * @param {string} id
     */
    constructor(opts, id) {
        /** @type {string} */
        this.id = id;

        /**
         * Optional user-typed name. Empty string when unset.
         * Validated against the JS-identifier rule and the
         * generated-id pattern by the property inspector
         * before being committed.
         * @type {string}
         */
        this.name = opts.name ?? "";

        /**
         * When true the curve is muted: its callback slots
         * do not fire. The cursor still advances visibly so
         * the curve's rhythm structure stays readable as
         * motion. Wired into the simulation loop in a later
         * milestone.
         * @type {boolean}
         */
        this.mute = opts.mute ?? false;

        /**
         * When true the curve is hidden: its geometry does
         * not render. The cursor still renders subject to
         * its R and L extents (so a hidden curve with
         * non-zero cursor extent shows the cursor as the
         * only visible part). Selection markers still draw
         * on a hidden curve. Wired into the canvas render
         * path in a later milestone.
         * @type {boolean}
         */
        this.hide = opts.hide ?? false;

        // --- Geometry ---
        /** @type {CurveShape} */
        this.shape = opts.shape;

        /**
         * Stroke thickness for the curve's geometric body, in
         * CSS pixels. The cursor's stroke uses cursorThickness
         * below; these are kept independent so a thin curve
         * can have a thick cursor (or vice versa) without
         * either constraining the other.
         * @type {number}
         */
        this.curveThickness = opts.curveThickness ?? 1;

        /**
         * Cycle count at which the cursor halts. Default -1
         * means play forever; positive integers stop the
         * cursor after that many full cycles. Validated by
         * the inspector when its Stop at Cycle field wires.
         * @type {number}
         */
        this.stopAtCycle = opts.stopAtCycle ?? -1;

        // --- Cursor ---
        /** Cursor extent right of curve direction, canvas units. */
        this.cursorR = opts.cursorR ?? 0;
        /** Cursor extent left of curve direction, canvas units. */
        this.cursorL = opts.cursorL ?? 0;
        /**
         * Stroke thickness for the cursor segment, in CSS
         * pixels. Independent of curveThickness so a thin
         * curve can carry a thick cursor for visibility.
         * @type {number}
         */
        this.cursorThickness = opts.cursorThickness ?? 2;

        // --- Callback slots ---
        // Section-27 four-slot model: cycle / hasHit / beenHit
        // / onTick. Each slot is guarded by a Can-X gate
        // boolean; a slot fires only when its gate is true.
        // The cycle slot additionally carries cyclePattern,
        // cyclePatternLocation, and beatsPerCycle.
        // Function-name fields hold STRING NAMES of functions
        // in behaviors.js; empty string means no binding.

        /** @type {boolean} */
        this.canCycle = opts.canCycle ?? false;
        /**
         * Strudel mini-notation pattern (when
         * cyclePatternLocation is "Here") or the name of a
         * function in the Code tab (when "Code Tab"). Empty
         * string means no binding.
         * @type {string}
         */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {"Here" | "Code Tab"} */
        this.cyclePatternLocation = opts.cyclePatternLocation ?? "Here";
        /**
         * Cycle length in master beats. Wall-clock cycle
         * duration is beatsPerCycle * 60 / BPM. Default 4
         * (one master bar in 4/4).
         * @type {number}
         */
        this.beatsPerCycle = opts.beatsPerCycle ?? 4;

        /** @type {boolean} */
        this.canHit = opts.canHit ?? false;
        /** @type {string} */
        this.hasHitFunction = opts.hasHitFunction ?? "";

        /** @type {boolean} */
        this.canBeHit = opts.canBeHit ?? false;
        /** @type {string} */
        this.beenHitFunction = opts.beenHitFunction ?? "";

        /** @type {boolean} */
        this.canTick = opts.canTick ?? false;
        /** @type {string} */
        this.onTickFunction = opts.onTickFunction ?? "";

        // --- Harmony overrides (null = inherit from score). ---
        /** @type {string | null} */
        this.tonic = opts.tonic ?? null;
        /** @type {string | null} */
        this.scaleName = opts.scaleName ?? null;
        /** @type {string | null} */
        this.root = opts.root ?? null;
        /** @type {string | null} */
        this.chordName = opts.chordName ?? null;
        /** @type {number | null} */
        this.range = opts.range ?? null;
        /** @type {number | null} */
        this.rangeLow = opts.rangeLow ?? null;
        /** @type {("Score" | "Scale" | "Chord" | "None") | null} */
        this.mapNotesTo = opts.mapNotesTo ?? null;
    }
}

export class Trigger {
    /**
     * @param {Object} opts
     * @param {string} id
     */
    constructor(opts, id) {
        /** @type {string} */
        this.id = id;

        /**
         * Optional user-typed name. Empty string when unset.
         * @type {string}
         */
        this.name = opts.name ?? "";

        /**
         * When true the trigger is muted: its callback slots
         * do not fire. The trigger still renders. Wired into
         * the simulation loop in a later milestone.
         * @type {boolean}
         */
        this.mute = opts.mute ?? false;

        this.x = opts.x ?? 0;
        this.y = opts.y ?? 0;
        /**
         * Visual size in canvas units, drawn as a diamond on
         * the canvas with diagonal half-length `size`. Purely
         * a display attribute under the point-collision model:
         * triggers collide as points along their position
         * (DESIGN.md §6; collision is point-vs-point with the
         * sweeping cursor or with sprites). User-overridable
         * per object via the size field in scene.json. The
         * user's triggerDisplayScale preference multiplies
         * this value at draw time without changing the stored
         * value, since size doesn't influence the music.
         */
        this.size = opts.size ?? 0.35;
        /**
         * Boundary ring colour, as a CSS hex string. The
         * trigger's interior fill always shows the image
         * pixel under its centre (or a placeholder when no
         * image is loaded); the boundary ring stays at this
         * stored colour. Default is the system trigger
         * boundary colour, matching the legacy hardcoded
         * value before per-object colours were introduced.
         * @type {string}
         */
        this.color = opts.color ?? "#7db8d6";
        /** Optional shorthand note. */
        this.note = opts.note ?? null;
        /** Arbitrary payload available as this.* in functions. */
        this.payload = opts.payload ?? null;

        // --- Callback slots ---
        // Section-27 four-slot model. See Curve for the full
        // description of the slot semantics.

        /** @type {boolean} */
        this.canCycle = opts.canCycle ?? false;
        /** @type {string} */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {"Here" | "Code Tab"} */
        this.cyclePatternLocation = opts.cyclePatternLocation ?? "Here";
        /** @type {number} */
        this.beatsPerCycle = opts.beatsPerCycle ?? 4;

        /** @type {boolean} */
        this.canHit = opts.canHit ?? false;
        /** @type {string} */
        this.hasHitFunction = opts.hasHitFunction ?? "";

        /** @type {boolean} */
        this.canBeHit = opts.canBeHit ?? false;
        /** @type {string} */
        this.beenHitFunction = opts.beenHitFunction ?? "";

        /** @type {boolean} */
        this.canTick = opts.canTick ?? false;
        /** @type {string} */
        this.onTickFunction = opts.onTickFunction ?? "";

        // --- Harmony overrides (null = inherit from score). ---
        /** @type {string | null} */
        this.tonic = opts.tonic ?? null;
        /** @type {string | null} */
        this.scaleName = opts.scaleName ?? null;
        /** @type {string | null} */
        this.root = opts.root ?? null;
        /** @type {string | null} */
        this.chordName = opts.chordName ?? null;
        /** @type {number | null} */
        this.range = opts.range ?? null;
        /** @type {number | null} */
        this.rangeLow = opts.rangeLow ?? null;
        /** @type {("Score" | "Scale" | "Chord" | "None") | null} */
        this.mapNotesTo = opts.mapNotesTo ?? null;
    }
}

export class Sprite {
    /**
     * @param {Object} opts
     * @param {string} id
     */
    constructor(opts, id) {
        /** @type {string} */
        this.id = id;

        /**
         * Optional user-typed name. Empty string when unset.
         * @type {string}
         */
        this.name = opts.name ?? "";

        /**
         * When true the sprite is muted: its callback slots
         * do not fire. Physics, image-sampling, and rendering
         * continue. Wired into the simulation loop in a later
         * milestone.
         * @type {boolean}
         */
        this.mute = opts.mute ?? false;

        this.x = opts.x ?? 0;
        this.y = opts.y ?? 0;
        this.vx = opts.vx ?? 0;
        this.vy = opts.vy ?? 0;
        /** Velocity ceiling, canvas units per second. */
        this.maxSpeed = opts.maxSpeed ?? 16;
        /**
         * Visual diameter in canvas units. Sprites are points
         * geometrically (DESIGN.md §6), but their display
         * diameter is also their collision radius against the
         * canvas edges — a sprite bounces when its boundary
         * touches a wall, not when its centre crosses one.
         * That makes displayDiameter part of the music, so it
         * is stored per sprite in scene.json. The user's
         * newSpriteSize preference is used only to seed the
         * value when a new sprite is created; it never
         * overrides what's stored.
         */
        this.displayDiameter = opts.displayDiameter ?? 1.05;

        /**
         * Boundary ring colour, as a CSS hex string. The
         * sprite's interior fill always shows the image
         * pixel under its centre (or a placeholder when no
         * image is loaded); the boundary ring stays at this
         * stored colour. Default matches the legacy hardcoded
         * sprite boundary colour.
         * @type {string}
         */
        this.color = opts.color ?? "#7db8d6";

        // --- Callback slots ---
        // Section-27 four-slot model. See Curve for the full
        // description of the slot semantics.

        /** @type {boolean} */
        this.canCycle = opts.canCycle ?? false;
        /** @type {string} */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {"Here" | "Code Tab"} */
        this.cyclePatternLocation = opts.cyclePatternLocation ?? "Here";
        /** @type {number} */
        this.beatsPerCycle = opts.beatsPerCycle ?? 4;

        /** @type {boolean} */
        this.canHit = opts.canHit ?? false;
        /** @type {string} */
        this.hasHitFunction = opts.hasHitFunction ?? "";

        /** @type {boolean} */
        this.canBeHit = opts.canBeHit ?? false;
        /** @type {string} */
        this.beenHitFunction = opts.beenHitFunction ?? "";

        /** @type {boolean} */
        this.canTick = opts.canTick ?? false;
        /** @type {string} */
        this.onTickFunction = opts.onTickFunction ?? "";

        // --- Harmony overrides (null = inherit from score). ---
        /** @type {string | null} */
        this.tonic = opts.tonic ?? null;
        /** @type {string | null} */
        this.scaleName = opts.scaleName ?? null;
        /** @type {string | null} */
        this.root = opts.root ?? null;
        /** @type {string | null} */
        this.chordName = opts.chordName ?? null;
        /** @type {number | null} */
        this.range = opts.range ?? null;
        /** @type {number | null} */
        this.rangeLow = opts.rangeLow ?? null;
        /** @type {("Score" | "Scale" | "Chord" | "None") | null} */
        this.mapNotesTo = opts.mapNotesTo ?? null;
    }
}
