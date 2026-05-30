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

import { generateId, ensureIdCounters } from "./idGen.js";
import { DEFAULT_BEAT_INTERVAL } from "./beatIntervals.js";

/**
 * One $objectId: expression labelled statement extracted from
 * behaviors.js at scene-load time. The loader walks the
 * top-level statements via Acorn, pulls out the ones whose
 * label is dollar-prefixed and whose body is an expression
 * statement, and attaches the resulting list to
 * Scene.labelledBlocks. The blocks are inert at scene-load:
 * the loader replaces their source ranges with whitespace
 * before executing behaviors.js, so the pattern constructor
 * calls inside them do not run. The blocks are held here for
 * the Code tab and inspector to consult (active-tag
 * highlighting, scaffolding, Cmd-Enter routing in the
 * section-28 pattern-authoring stages A3 through A5).
 *
 * @typedef {Object} LabelledBlock
 * @property {string} objectId The object id parsed from the
 *     dollar-prefixed label (label name with the leading
 *     dollar stripped).
 * @property {string} expressionText The expression body as
 *     source text, ready to be parsed by the strudel
 *     mini-notation parser at Cmd-Enter time.
 * @property {{start: number, end: number}} range Character
 *     range of the whole labelled statement in the original
 *     behaviors.js source.
 */

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

        // --- Audio engine ---
        // Per-score choice of pattern-firing engine. Currently
        // "midi" (events go to the MIDI output device chosen at
        // app level) or "superdough" (events render through
        // Strudel's built-in Web Audio engine). The field is
        // the source of truth for the playing engine: runScene
        // pushes it into firingEngine.setOutputMode on every
        // successful reload. Null in the constructor; the
        // loader copies the value from scene.json, and the
        // migration pass fillMissingEngine seeds it from the
        // audioOutput preference for legacy scores without
        // the field. After commit 2 of the multi-engine
        // migration the preference is gone and the migration
        // pass falls back to a hardcoded "midi" default.
        /** @type {string | null} */
        this.engine = null;

        // --- Global superdough voice ---
        // Score-wide default Note Voice (sound) and Sound
        // Bank that per-object voices inherit when their own
        // setting is the "Global" sentinel (the default for
        // untouched objects). Shape mirrors the per-object
        // voice.superdough subobject: { sound, bank }, with
        // empty-string meaning the global "Default" sentinel
        // (inject nothing, let the pattern / superdough
        // default win). Null in the constructor and for a
        // fresh score, read as both-empty (global Default for
        // sound and bank). The firing engine reads this as the
        // middle fallback in the three-level resolution:
        // explicit pattern value > per-object voice > this
        // global voice > superdough default.
        /** @type {{sound?: string, bank?: string} | null} */
        this.voiceSuperdough = null;

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

        // --- Labelled pattern blocks ---
        // List of $objectId: expression labelled statements
        // extracted from behaviors.js by the scene loader
        // (Stage A2 of the section-28 pattern-authoring
        // sequence). Each entry is one top-level labelled
        // block found in behaviors.js. The blocks are inert
        // at scene-load: the loader replaces their source
        // ranges with whitespace before executing the file,
        // so a $spr1: note("c d e f") block does not call
        // note() at load time. Cmd-Enter on a block in the
        // Code tab (Stage A4) is the only path that
        // activates one, writing the expression body to the
        // named object's cyclePattern field in scene.json.
        // The blocks are held here for later stages (A3
        // through A5) to consult.
        /** @type {LabelledBlock[]} */
        this.labelledBlocks = [];
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
     * The counter is derived fresh from the in-memory arrays
     * on each call rather than persisted on the Scene, since
     * the Scene runtime model has no notion of id-counter
     * persistence — that lives in scene.json. Practical
     * consequence: in a create-delete-create sequence on a
     * Scene that wasn't built from scene.json, the deleted
     * id's number could be reused by the next call, where
     * the scene.json path's persisted counters would advance
     * past it. sceneLoader doesn't hit this path because it
     * always passes explicit ids from scene.json; direct
     * programmatic Scene construction (limited to tests
     * today) is the only caller that reaches here.
     *
     * @param {"curve" | "trigger" | "sprite"} kind
     * @returns {string}
     */
    _nextId(kind) {
        // Build a synthetic scene-data object so the same
        // ensureIdCounters + generateId pair that scene.json's
        // load path uses applies cleanly here. ensureIdCounters
        // walks the in-memory arrays, finds the max integer in
        // any conventional id per kind, and seeds the synthetic
        // counters past it; generateId then reads from those
        // counters to produce the next id.
        /** @type {any} */
        const data = {
            curves: this.curves,
            triggers: this.triggers,
            sprites: this.sprites,
        };
        ensureIdCounters(data);
        return generateId(kind, data);
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
         * Starting velocity components along the canvas X
         * and Y axes, in canvas units per second. The
         * authored value persists in scene.json and is
         * editable through the inspector's Starting State
         * row; live runtime translation of the shape by
         * (vx, vy) per simulation tick lands with the
         * curve-bounce work in a later milestone. Same
         * default of 0 as Sprite.vx and vy.
         * @type {number}
         */
        this.vx = opts.vx ?? 0;
        /** @type {number} */
        this.vy = opts.vy ?? 0;

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
         * Stroke colour for the curve's geometric body, as a
         * CSS hex string. Default matches the legacy global
         * curve colour from canvas.js (CURVE_COLOUR), so
         * existing scores that load without a per-curve
         * color field render identically to before. Editable
         * through the inspector's Color row alongside sprite
         * and trigger colours.
         * @type {string}
         */
        this.color = opts.color ?? "#7dd68a";

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

        /**
         * Number of times the cyclePattern is laid out around
         * the curve in one cursor traversal (one GXW cycle).
         * Independent of cycle duration: beatsPerCycle and
         * beatInterval control how long the cursor takes to
         * traverse once, patternRepeats controls how many
         * copies of the strudel pattern fit along the curve
         * during that traversal. The strudel cycle counter
         * still advances once per GXW cycle, so cross-cycle
         * pattern operators (every, iter, alternation) keep
         * their natural cadence across GXW cycles rather
         * than across repeats; each repeat replays the same
         * strudel cycle's events at successively later
         * audioTimes. Curve-only: only curves have a visible
         * cursor sweeping along a path where "how many copies
         * fit" is a meaningful question. Default 1 reproduces
         * the pre-patternRepeats one-pattern-per-cycle
         * behaviour, so legacy scenes load unchanged.
         * @type {number}
         */
        this.patternRepeats = opts.patternRepeats ?? 1;

        /**
         * Per-cycle speed multiplier list, as a whitespace-
         * separated string of numbers (integers or decimals,
         * e.g. "1 0.5 -2"). Each entry is a multiplier for
         * one cycle, applied in order with the index wrapping
         * back to 0 after the last entry. A positive value N
         * compresses that cycle's wall-clock duration to
         * baseCycleDuration / N with the cursor advancing
         * from t=0 to t=1 as usual; a negative value
         * compresses by |N| but reverses the cursor (t goes
         * from 1 to 0); a zero halts the curve permanently
         * until the next rewind (entries after the first zero
         * are unreachable and silently dropped at runtime
         * parse).
         *
         * Direction reversal across the boundary between two
         * adjacent cycles preserves the cursor's position
         * rather than snapping it home: a positive cycle
         * followed by a negative one leaves the cursor at
         * t=1 (where the positive cycle ended, and equivalently
         * the home for the incoming negative cycle), and it
         * starts moving back toward t=0. Same-direction
         * adjacent cycles snap to the direction's home at the
         * boundary (t=0 for positive, t=1 for negative), the
         * standard cycle-restart behaviour.
         *
         * stopAtCycle counts wraps regardless of speed sign or
         * magnitude, and patternRepeats is independent (the
         * pattern copies compress in proportion with the
         * cycle).
         *
         * Curve-only because the direction-reversal effect
         * only has visible meaning where a cursor moves along
         * a path. Default "1" preserves pre-cycleSpeeds
         * behaviour exactly. Stored verbatim; the runtime
         * parser is permissive (falls back to [1] on any
         * unparseable input) so a hand-edited scene with a
         * typo doesn't silently halt the curve.
         * @type {string}
         */
        this.cycleSpeeds = opts.cycleSpeeds ?? "1";

        // --- Callback slots ---
        // Section-27 four-slot model: hasHit / beenHit /
        // onTick are Code-tab slots, each guarded by a
        // Can-X gate. The cyclePattern carries the
        // strudel mini-notation pattern that fires when
        // the source has cursor extents and is unmuted
        // (per the cursor-as-collider model). Function-
        // name fields hold STRING NAMES of functions in
        // behaviors.js; empty string means no binding.

        /**
         * Strudel mini-notation pattern. Empty string
         * means no pattern.
         * @type {string}
         */
        this.cyclePattern = opts.cyclePattern ?? "";
        /**
         * Cycle length in `beatInterval` units. Wall-clock
         * cycle duration is beatsPerCycle ×
         * beatIntervalQuarters × 60 / BPM, where
         * beatIntervalQuarters is the duration of one
         * beatInterval expressed in quarter notes (looked up
         * via getBeatIntervalEntry). Default 4 with
         * beatInterval defaulting to "Qtr" reproduces the
         * pre-v2.3 implicit assumption of one master bar in
         * 4/4.
         * @type {number}
         */
        this.beatsPerCycle = opts.beatsPerCycle ?? 4;
        /**
         * Beat-interval token naming the unit each
         * beatsPerCycle count refers to. Valid tokens are
         * the entries of TOKENS in beatIntervals.js ("16th",
         * "Qtr", "Dot 8th", "Qtr Tr", "4 x Wh", etc.). Pre-
         * v2.3 scenes omit the field; they read as Qtr so
         * the cycle-duration formula reduces to
         * beatsPerCycle × 60 / BPM and existing playback is
         * preserved.
         * @type {string}
         */
        this.beatInterval = opts.beatInterval ?? DEFAULT_BEAT_INTERVAL;

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

        // --- Per-object voice ---
        // Engine-keyed nested map of voice settings, e.g.
        // { superdough: { sound: "piano", bank: "RolandTR909" } }.
        // Null or an empty subfield means "Default": no
        // soft-injection at firing time, so the pattern's
        // own values (or strudel's no-s defaults) win.
        // Switching engines preserves inactive engines'
        // subfields exactly so a round-trip through another
        // engine doesn't lose configuration. The inspector's
        // middle band reads only the active engine's subfield
        // and renders its controls.
        /** @type {Object<string, Object<string, any>> | null} */
        this.voice = opts.voice ?? null;
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
        // Section-27 model. Triggers do not self-fire under
        // the cursor-as-collider model (they have no cursor),
        // but the cyclePattern stays editable for future
        // Tier 5 collision-firing work.

        /** @type {string} */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {number} */
        this.beatsPerCycle = opts.beatsPerCycle ?? 4;
        /** @type {string} */
        this.beatInterval = opts.beatInterval ?? DEFAULT_BEAT_INTERVAL;

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

        // --- Per-object voice ---
        // See the Curve constructor for the full description.
        /** @type {Object<string, Object<string, any>> | null} */
        this.voice = opts.voice ?? null;
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

        // --- Cursor (cursor-as-collider model) ---
        // Cursor extents perpendicular to the sprite's last
        // motion direction. cursorR units extend right of
        // motion, cursorL units extend left. A sprite has a
        // visible, firing, colliding cursor iff cursorR or
        // cursorL is non-zero AND mute is unchecked. Default
        // zero so existing sprites do not silently grow
        // cursors on schema migration.
        /** @type {number} */
        this.cursorR = opts.cursorR ?? 0;
        /** @type {number} */
        this.cursorL = opts.cursorL ?? 0;

        // --- Callback slots ---
        // Section-27 model. See Curve for the full
        // description of the slot semantics.

        /** @type {string} */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {number} */
        this.beatsPerCycle = opts.beatsPerCycle ?? 4;
        /** @type {string} */
        this.beatInterval = opts.beatInterval ?? DEFAULT_BEAT_INTERVAL;

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

        // --- Per-object voice ---
        // See the Curve constructor for the full description.
        /** @type {Object<string, Object<string, any>> | null} */
        this.voice = opts.voice ?? null;
    }
}
