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
 *                cyclePatternLocation ("Here" or "Script tab"),
 *                and beatsPerCycle. cyclePattern is an inline
 *                strudel mini-notation pattern in "Here" mode,
 *                or the name of a function in the Script tab in
 *                "Script tab" mode.
 *   - hasCollided — fires when the source (the active collider)
 *                hits another; bound function in hasCollidedFunction.
 *   - beenTriggered — fires when the source is hit (the passive
 *                target); bound function in beenTriggeredFunction.
 *   - onTick   — fires every simulation tick; bound function
 *                in onTickFunction.
 *
 * Curves additionally carry geometry and a cursor with
 * left/right extents. Triggers additionally carry position,
 * size, colour, and an optional payload. Sprites additionally
 * carry position, velocity, mass, and displayDiameter.
 *
 * Function-name fields (hasCollidedFunction, beenTriggeredFunction,
 * onTickFunction, and cyclePattern in "Script tab" mode) hold
 * STRING NAMES of functions defined in the bundle's
 * script.js file, not function references. The Scene also
 * carries a functionMap built by the scene loader at load
 * time, mapping each top-level function name in script.js
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
 * Default score-level kinematics (cinematics) tuning — the global
 * feel knobs for sprite motion. Set per score from script.js
 * via the `score.kinematics` object (e.g. `score.kinematics.jitter
 * = 0.5`) and read by the simulation. Defined here as the single
 * source of truth: the Scene constructor seeds scene.kinematics
 * from these, the scene loader pre-fills the `score` global the
 * composer mutates, and the simulation falls back to them when a
 * scene has no kinematics.
 *
 *   drag   — linear drag rate (1/sec) on the force-driven impulse
 *            layer; higher settles a force-driven sprite to a
 *            steady speed faster. 0 disables damping. Score-wide
 *            (was briefly a per-sprite field; never needed to be).
 *   jitter — magnitude of the deterministic anti-trap agitation
 *            force injected in force-active regions to shake a
 *            sprite out of a colour well. 0 disables it.
 *   coast  — minimum coast speed (canvas units/sec) the force-
 *            driven impulse is held at so a weak region can't damp
 *            a sprite to a crawl. 0 disables the floor.
 *   turnDamping — time constant (seconds) of the low-pass on a
 *            sprite's pointing direction (the nose / perpendicular
 *            cursor heading). Higher turns the nose more gently
 *            toward the recent overall direction of travel,
 *            smoothing out the rapid wobble small frame-to-frame
 *            direction changes (e.g. the anti-trap jitter) would
 *            otherwise cause; 0 disables smoothing (instant
 *            heading). Affects only the pointing direction, never
 *            the centre-point motion. Read by the canvas renderer,
 *            not the simulation.
 * @type {{drag: number, jitter: number, coast: number, turnDamping: number}}
 */
export const DEFAULT_KINEMATICS = { drag: 2, jitter: 1.0, coast: 0.2, turnDamping: 0.9 };

/**
 * Whether parsed scene.json data names a background image — true
 * exactly when its `imageName` is a non-empty string. Backs the
 * `score.hasBackgroundImage` flag a script.js reads (see
 * sceneLoader.load): a tiny pure predicate so the loader's getter and
 * its unit test share one definition of "has an image".
 * @param {any} data Parsed scene.json object (or any value).
 * @returns {boolean}
 */
export function sceneDataHasBackgroundImage(data) {
    return data !== null && typeof data === "object"
        && typeof data.imageName === "string" && data.imageName !== "";
}

/**
 * One $objectId: expression labelled statement extracted from
 * script.js at scene-load time. The loader walks the
 * top-level statements via Acorn, pulls out the ones whose
 * label is dollar-prefixed and whose body is an expression
 * statement, and attaches the resulting list to
 * Scene.labelledBlocks. The blocks are inert at scene-load:
 * the loader replaces their source ranges with whitespace
 * before executing script.js, so the pattern constructor
 * calls inside them do not run. The blocks are held here for
 * the Script tab and inspector to consult (active-tag
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
 *     script.js source.
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
        /**
         * Global time signature as [numerator, denominator]. The
         * numerator is beats-per-bar against the master BPM beat;
         * the denominator is display-only in v1. Defaults to 4/4.
         * @type {[number, number]}
         */
        this.timeSignature = [4, 4];

        // --- Chosen progression (harmony import). ---
        // A single Song picked from the harmony library, frozen into
        // the score so it travels with the piece. Null when the
        // composer hasn't chosen one. Serialisable shape (see
        // src/harmonyScene.js):
        //   { title, composer, key: {tonicPitchClass, mode},
        //     timeSignature: [n, d], progression: ProgressionCell[] }
        // The progression cells are already plain JSON (harmonyModel.js).
        // The loader runs the raw scene.json value through
        // sanitiseSceneHarmony so a malformed block reads as null
        // rather than crashing the load. No engine wiring yet — this is
        // pure storage; playback arrives in a later commit.
        /** @type {import("./harmonyScene.js").SceneHarmony | null} */
        this.harmony = null;

        // Whether the chosen progression loops at the end of the piece
        // (true = play the whole progression on repeat) or stops once the
        // last bar has sounded. Feeds the harmony player's `loop` argument
        // (src/harmonyPlayer.js). Default true.
        /** @type {boolean} */
        this.harmonyLoop = true;

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

        // --- Kinematics (score-wide motion feel) ---
        // Global cinematics knobs for sprite motion: drag
        // (damping), jitter (anti-trap agitation), and coast
        // (minimum coast speed). Score-wide, not per object.
        // Set from script.js via the `score.kinematics`
        // object the loader exposes; seeded here with the
        // defaults so a scene always has the field, and the
        // loader overrides from whatever the composer set. The
        // simulation reads these each step. Travels with the
        // score in script.js, so playback is portable.
        /** @type {{drag: number, jitter: number, coast: number}} */
        this.kinematics = { ...DEFAULT_KINEMATICS };

        // --- Polyphony (voice limiting) ---
        // Whole-score and per-group voice caps (design/polyphony.md),
        // set from script.js via `score.poly` / `score.groupPoly(name, n)`
        // and read back here after the top-level script runs (same path
        // as score.kinematics). poly is the whole-score cap; groupPoly is
        // a plain { groupName: limit } object keyed by an object's `group`
        // field. Unset = unlimited (Infinity / no entry). The simulation
        // reads these at each note-start to drop notes once a scope is at
        // its cap (suppress-new); per-object caps are enforced by the sim's
        // _objectPoly map, not here.
        /** @type {number} */
        this.poly = Infinity;
        /** @type {Object<string, number>} */
        this.groupPoly = {};

        // --- Function map ---
        // Map of top-level function names in script.js to
        // their function references. Built by the scene loader
        // at load time and attached here for the simulation to
        // consult when firing a slot. Slot fields on Curve,
        // Trigger, and Sprite hold name strings; the simulation
        // resolves them against this map at fire time. An
        // unresolved name (typo, function deleted from
        // script.js without unbinding) is a soft error —
        // the slot stays inert for that object and the
        // inspector surfaces a warning, but the scene runs.
        // Empty by default; populated only for scenes loaded
        // through SceneLoader.load() with a script.js file
        // present.
        /** @type {Object<string, Function>} */
        this.functionMap = {};

        // --- Labelled pattern blocks ---
        // List of $objectId: expression labelled statements
        // extracted from script.js by the scene loader
        // (Stage A2 of the section-28 pattern-authoring
        // sequence). Each entry is one top-level labelled
        // block found in script.js. The blocks are inert
        // at scene-load: the loader replaces their source
        // ranges with whitespace before executing the file,
        // so a $spr1: note("c d e f") block does not call
        // note() at load time. Cmd-Enter on a block in the
        // Script tab (Stage A4) is the only path that
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

/**
 * A smooth spline through control points (centripetal Catmull-Rom). Same
 * shape as a piste — an array of control points — but sampled as a
 * smooth interpolating curve rather than straight segments. The clicked
 * points are the control points (the curve passes through them), kept so
 * tangent-handle editing can be layered on later.
 * @typedef {Object} ShapeSpline
 * @property {"spline"} type
 * @property {Array<[number, number]>} points
 * @property {boolean} [closed]
 */

/** @typedef {ShapeLine | ShapeEllipse | ShapePiste | ShapeSpline} CurveShape */

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
         * Three-state activity field. "active" (the default):
         * normal — cursor shown, self-fires, is both collider
         * and target, onTick runs. "passive": cursor removed,
         * so no self-firing and not a collider, but the curve
         * still moves, still runs onTick, is still a valid
         * target (its beenTriggered runs), and renders at full
         * colour. "disabled": fully inert — greyed, frozen,
         * out of collisions as both collider and target, no
         * firing, onTick does not run.
         * @type {"active" | "passive" | "disabled"}
         */
        this.state = opts.state ?? "active";
        // Group membership (Band 1, GeoSonixV2): "" = ungrouped,
        // else a group name a selector can address. See DESIGN.md
        // section 3 (the substrate).
        this.group = opts.group ?? "";
        // Time Lag In Object (Band 1, GeoSonixV2): a multiplier
        // counted in units of an interval from the shared interval
        // menu. Behaviour (how the lag delays the object) is TBD;
        // these are model/inspector scaffolding for now.
        this.timeLagMultiplier = opts.timeLagMultiplier ?? 0;
        this.timeLagInterval = opts.timeLagInterval ?? "Off";

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
        /** @type {number} Band 6: cycle index the curve starts on (0 = from the start). */
        this.startAtCycle = opts.startAtCycle ?? 0;

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

        /**
         * Seed-variation dial. 0 (default) locks the curve so a
         * seeded rewind never moves it; a positive value scales
         * the Gaussian spread of its per-seed position and
         * starting-velocity offset. See src/seed/seedOffset.js.
         * @type {number}
         */
        this.variability = opts.variability ?? 0;
        this.mutatePosition = opts.mutatePosition ?? 0;
        this.mutateSize = opts.mutateSize ?? 0;

        // --- Callback slots ---
        // Section-27 four-slot model: hasCollided / beenTriggered /
        // onTick are Code-tab slots, each guarded by a
        // Can-X gate. The cyclePattern carries the
        // strudel mini-notation pattern that fires when
        // the source has cursor extents and state "active"
        // (per the cursor-as-collider model). Function-
        // name fields hold STRING NAMES of functions in
        // script.js; empty string means no binding.

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
        this.beatsPerCycle = opts.beatsPerCycle ?? 16;
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
        /** @type {"none" | "normal" | "euclidean" | "auto" | "strudel"} Beat Points mode (Band 5). */
        this.beatPointsMode = opts.beatPointsMode ?? "none";
        /** @type {"melody"|"lead"|"bass"} Auto-mode rhythmic style (Band 5). */
        this.autoStyle = opts.autoStyle ?? "melody";
        /** @type {string} Active Beats pattern (x / . / | string), Band 5. Loops. Default one active beat. */
        this.activeBeats = opts.activeBeats ?? "x";
        /** @type {string} Beat Strength (digits 0-9 and dots), Band 5. Loops. Default single 9. */
        this.strength = opts.strength ?? "9";
        this.beatPattern = opts.beatPattern ?? "";
        this.measures = opts.measures ?? 1;
        this.strengthChannel = opts.strengthChannel ?? "lt";
        // Canvas to Sound Drivers: the drop channel (likelihood-of-beat), and the
        // object-wide depths that scale the per-beat swing/drop digits before they
        // are evaluated (0 = no image influence, 1 = full). See
        // design/canvas-to-sound-drivers.md.
        this.dropChannel = opts.dropChannel ?? "chr";
        this.strengthDepth = opts.strengthDepth ?? 1;
        this.dropDepth = opts.dropDepth ?? 1;
        // Note velocity / sustain image drivers: the channel each reads and its
        // depth (0 = no image, the note's velocity/length come from beat strength
        // and the style; 1 = full image). Default None — opt-in, since the style
        // no longer carries image influence.
        this.velocityChannel = opts.velocityChannel ?? "lt";
        this.velocityDepth = opts.velocityDepth ?? 0;
        this.durationChannel = opts.durationChannel ?? "lt";
        this.durationDepth = opts.durationDepth ?? 0;
        this.cycleInterval = opts.cycleInterval ?? "Qtr";
        this.cycleCount = opts.cycleCount ?? 16;
        /** @type {number} Euclidean: beats per bar (Band 5). Default 1 (no bar lines drawn). */
        this.beatsPerBar = opts.beatsPerBar ?? 1;
        /** @type {number} Euclidean: count of active beats to distribute. */
        this.activeBeatsCount = opts.activeBeatsCount ?? 0;
        /** @type {number} Euclidean: rotational shift in slots. */
        this.beatShift = opts.beatShift ?? 0;
        /** @type {number} Euclidean: internal repeat count. */
        this.repeats = opts.repeats ?? 1;
        /** @type {number} Pattern variation: per-slot x<->. flip probability (0 = off). */
        this.vary = opts.vary ?? 0;
        /** @type {number} The seed the current variation rolled (the dice button re-rolls it). */
        this.varySeed = opts.varySeed ?? 0;

        /** @type {boolean} */
        this.canCollide = opts.canCollide ?? false;
        /** @type {string} */
        this.hasCollidedFunction = opts.hasCollidedFunction ?? "";
        /** @type {string} Per-slot melodic STYLE name (nxtNote); "" = default. */
        this.hasCollidedStyle = opts.hasCollidedStyle ?? "";

        /** @type {boolean} */
        this.canBeTriggered = opts.canBeTriggered ?? false;
        /** @type {string} */
        this.beenTriggeredFunction = opts.beenTriggeredFunction ?? "";
        /** @type {string} */
        this.beenTriggeredStyle = opts.beenTriggeredStyle ?? "";
        this.canActiveBeat = opts.canActiveBeat ?? false;
        this.onActiveBeatFunction = opts.onActiveBeatFunction ?? "";
        /** @type {string} */
        this.onActiveBeatStyle = opts.onActiveBeatStyle ?? "";

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
         * Activity field. A trigger has no cursor, so it has no
         * "passive" state — only "active" (the default; normal,
         * a valid target whose beenTriggered runs and which can
         * auto-fire) and "disabled" (fully inert: greyed,
         * frozen, out of collisions as a target, no firing).
         * @type {"active" | "disabled"}
         */
        this.state = opts.state ?? "active";
        // Group membership (Band 1, GeoSonixV2): "" = ungrouped,
        // else a group name a selector can address. See DESIGN.md
        // section 3 (the substrate).
        this.group = opts.group ?? "";
        // Time Lag In Object (Band 1, GeoSonixV2): a multiplier
        // counted in units of an interval from the shared interval
        // menu. Behaviour (how the lag delays the object) is TBD;
        // these are model/inspector scaffolding for now.
        this.timeLagMultiplier = opts.timeLagMultiplier ?? 0;
        this.timeLagInterval = opts.timeLagInterval ?? "Off";

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
        /** @type {string} Band 6: shared-interval token the trigger's firing syncs to ("Off" = no sync). */
        this.triggerSyncToBeat = opts.triggerSyncToBeat ?? "Off";

        /**
         * Seed-variation dial. 0 (default) locks the trigger; a
         * positive value scales the Gaussian spread of its
         * per-seed position offset. Triggers carry no starting
         * velocity, so only position is offset. See
         * src/seed/seedOffset.js.
         * @type {number}
         */
        this.variability = opts.variability ?? 0;
        this.mutatePosition = opts.mutatePosition ?? 0;
        this.mutateSize = opts.mutateSize ?? 0;

        // --- Callback slots ---
        // Section-27 model. Triggers do not self-fire under
        // the cursor-as-collider model (they have no cursor),
        // but the cyclePattern stays editable for future
        // Tier 5 collision-firing work.

        /** @type {string} */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {number} */
        this.beatsPerCycle = opts.beatsPerCycle ?? 16;
        /** @type {string} */
        this.beatInterval = opts.beatInterval ?? DEFAULT_BEAT_INTERVAL;
        /** @type {"none" | "normal" | "euclidean" | "auto" | "strudel"} Beat Points mode (Band 5). */
        this.beatPointsMode = opts.beatPointsMode ?? "none";
        /** @type {"melody"|"lead"|"bass"} Auto-mode rhythmic style (Band 5). */
        this.autoStyle = opts.autoStyle ?? "melody";
        /** @type {string} Active Beats pattern (x / . / | string), Band 5. Loops. Default one active beat. */
        this.activeBeats = opts.activeBeats ?? "x";
        /** @type {string} Beat Strength (digits 0-9 and dots), Band 5. Loops. Default single 9. */
        this.strength = opts.strength ?? "9";
        this.beatPattern = opts.beatPattern ?? "";
        this.measures = opts.measures ?? 1;
        this.strengthChannel = opts.strengthChannel ?? "lt";
        // Canvas to Sound Drivers: the drop channel (likelihood-of-beat), and the
        // object-wide depths that scale the per-beat swing/drop digits before they
        // are evaluated (0 = no image influence, 1 = full). See
        // design/canvas-to-sound-drivers.md.
        this.dropChannel = opts.dropChannel ?? "chr";
        this.strengthDepth = opts.strengthDepth ?? 1;
        this.dropDepth = opts.dropDepth ?? 1;
        // Note velocity / sustain image drivers: the channel each reads and its
        // depth (0 = no image, the note's velocity/length come from beat strength
        // and the style; 1 = full image). Default None — opt-in, since the style
        // no longer carries image influence.
        this.velocityChannel = opts.velocityChannel ?? "lt";
        this.velocityDepth = opts.velocityDepth ?? 0;
        this.durationChannel = opts.durationChannel ?? "lt";
        this.durationDepth = opts.durationDepth ?? 0;
        this.cycleInterval = opts.cycleInterval ?? "Qtr";
        this.cycleCount = opts.cycleCount ?? 16;
        /** @type {number} Euclidean: beats per bar (Band 5). Default 1 (no bar lines drawn). */
        this.beatsPerBar = opts.beatsPerBar ?? 1;
        /** @type {number} Euclidean: count of active beats to distribute. */
        this.activeBeatsCount = opts.activeBeatsCount ?? 0;
        /** @type {number} Euclidean: rotational shift in slots. */
        this.beatShift = opts.beatShift ?? 0;
        /** @type {number} Euclidean: internal repeat count. */
        this.repeats = opts.repeats ?? 1;
        /** @type {number} Pattern variation: per-slot x<->. flip probability (0 = off). */
        this.vary = opts.vary ?? 0;
        /** @type {number} The seed the current variation rolled (the dice button re-rolls it). */
        this.varySeed = opts.varySeed ?? 0;

        /** @type {boolean} */
        this.canCollide = opts.canCollide ?? false;
        /** @type {string} */
        this.hasCollidedFunction = opts.hasCollidedFunction ?? "";
        /** @type {string} Per-slot melodic STYLE name (nxtNote); "" = default. */
        this.hasCollidedStyle = opts.hasCollidedStyle ?? "";

        /** @type {boolean} */
        this.canBeTriggered = opts.canBeTriggered ?? false;
        /** @type {string} */
        this.beenTriggeredFunction = opts.beenTriggeredFunction ?? "";
        /** @type {string} */
        this.beenTriggeredStyle = opts.beenTriggeredStyle ?? "";
        this.canActiveBeat = opts.canActiveBeat ?? false;
        this.onActiveBeatFunction = opts.onActiveBeatFunction ?? "";
        /** @type {string} */
        this.onActiveBeatStyle = opts.onActiveBeatStyle ?? "";

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
         * Three-state activity field. "active" (the default):
         * normal — cursor shown, self-fires, is both collider
         * and target, physics and onTick run. "passive": cursor
         * removed, so no self-firing and not a collider, but
         * the sprite still moves, still runs onTick, is still a
         * valid target (its beenTriggered runs), and renders at full
         * colour. "disabled": fully inert — greyed, frozen (no
         * physics), out of collisions as both collider and
         * target, no firing, onTick does not run.
         * @type {"active" | "passive" | "disabled"}
         */
        this.state = opts.state ?? "active";
        // Group membership (Band 1, GeoSonixV2): "" = ungrouped,
        // else a group name a selector can address. See DESIGN.md
        // section 3 (the substrate).
        this.group = opts.group ?? "";
        // Time Lag In Object (Band 1, GeoSonixV2): a multiplier
        // counted in units of an interval from the shared interval
        // menu. Behaviour (how the lag delays the object) is TBD;
        // these are model/inspector scaffolding for now.
        this.timeLagMultiplier = opts.timeLagMultiplier ?? 0;
        this.timeLagInterval = opts.timeLagInterval ?? "Off";

        this.x = opts.x ?? 0;
        this.y = opts.y ?? 0;
        this.vx = opts.vx ?? 0;
        this.vy = opts.vy ?? 0;
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
         * Relative inertial mass, dimensionless. Default one is
         * the reference object: an onTick force produces an
         * impulse-velocity change of force / mass, so a sprite
         * of mass two responds half as much to the same force
         * and a sprite of mass one-half twice as much. There is
         * no physical unit — only the ratio matters, which is
         * all the force model and any future inter-object
         * gravity need. The inspector enforces a positive floor
         * of one tenth (so a near-zero mass can't divide a
         * force into an unbounded acceleration), and the
         * simulation re-applies the same floor defensively at
         * force time. Part of the music, so stored per sprite
         * in scene.json.
         * @type {number}
         */
        this.mass = opts.mass ?? 1;

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
        // cursorL is non-zero AND state is "active". Default
        // zero so existing sprites do not silently grow
        // cursors on schema migration.
        /** @type {number} */
        this.cursorR = opts.cursorR ?? 0;
        /** @type {number} */
        this.cursorL = opts.cursorL ?? 0;
        /**
         * Stroke thickness for the sprite's cursor segment,
         * in CSS pixels. Independent of the body outline so a
         * sprite can carry a thick cursor for visibility.
         * Matches the curve cursorThickness field's default
         * of 2. The cursor line itself is drawn in a later
         * commit; this stores the authored thickness.
         * @type {number}
         */
        this.cursorThickness = opts.cursorThickness ?? 2;

        /**
         * Per-cycle speed multiplier list, as a whitespace-
         * separated string of numbers (integers or decimals,
         * possibly negative, e.g. "1 0.5 -2"). Same shape and
         * meaning as the curve cycleSpeeds field: each entry
         * multiplies one cycle's speed in order, the index
         * wrapping back to 0 after the last entry, with a
         * negative value reversing direction. The runtime
         * application to sprite motion lands in a later
         * commit; this stores the authored string. Default
         * "1" preserves existing single-speed behaviour.
         * @type {string}
         */
        this.cycleSpeeds = opts.cycleSpeeds ?? "1";
        /** @type {number} Band 6: cycle index the sprite starts on (0 = from the start). */
        this.startAtCycle = opts.startAtCycle ?? 0;
        /** @type {number} Band 6: cycle index the sprite stops on (-1 = never stop). */
        this.stopAtCycle = opts.stopAtCycle ?? -1;

        /**
         * Seed-variation dial. 0 (default) locks the sprite; a
         * positive value scales the Gaussian spread of its
         * per-seed position and starting-velocity offset. See
         * src/seed/seedOffset.js.
         * @type {number}
         */
        this.variability = opts.variability ?? 0;
        this.mutatePosition = opts.mutatePosition ?? 0;
        this.mutateSize = opts.mutateSize ?? 0;

        // --- Callback slots ---
        // Section-27 model. See Curve for the full
        // description of the slot semantics.

        /** @type {string} */
        this.cyclePattern = opts.cyclePattern ?? "";
        /** @type {number} */
        this.beatsPerCycle = opts.beatsPerCycle ?? 16;
        /** @type {string} */
        this.beatInterval = opts.beatInterval ?? DEFAULT_BEAT_INTERVAL;
        /** @type {"none" | "normal" | "euclidean" | "auto" | "strudel"} Beat Points mode (Band 5). */
        this.beatPointsMode = opts.beatPointsMode ?? "none";
        /** @type {"melody"|"lead"|"bass"} Auto-mode rhythmic style (Band 5). */
        this.autoStyle = opts.autoStyle ?? "melody";
        /** @type {string} Active Beats pattern (x / . / | string), Band 5. Loops. Default one active beat. */
        this.activeBeats = opts.activeBeats ?? "x";
        /** @type {string} Beat Strength (digits 0-9 and dots), Band 5. Loops. Default single 9. */
        this.strength = opts.strength ?? "9";
        this.beatPattern = opts.beatPattern ?? "";
        this.measures = opts.measures ?? 1;
        this.strengthChannel = opts.strengthChannel ?? "lt";
        // Canvas to Sound Drivers: the drop channel (likelihood-of-beat), and the
        // object-wide depths that scale the per-beat swing/drop digits before they
        // are evaluated (0 = no image influence, 1 = full). See
        // design/canvas-to-sound-drivers.md.
        this.dropChannel = opts.dropChannel ?? "chr";
        this.strengthDepth = opts.strengthDepth ?? 1;
        this.dropDepth = opts.dropDepth ?? 1;
        // Note velocity / sustain image drivers: the channel each reads and its
        // depth (0 = no image, the note's velocity/length come from beat strength
        // and the style; 1 = full image). Default None — opt-in, since the style
        // no longer carries image influence.
        this.velocityChannel = opts.velocityChannel ?? "lt";
        this.velocityDepth = opts.velocityDepth ?? 0;
        this.durationChannel = opts.durationChannel ?? "lt";
        this.durationDepth = opts.durationDepth ?? 0;
        this.cycleInterval = opts.cycleInterval ?? "Qtr";
        this.cycleCount = opts.cycleCount ?? 16;
        /** @type {number} Euclidean: beats per bar (Band 5). Default 1 (no bar lines drawn). */
        this.beatsPerBar = opts.beatsPerBar ?? 1;
        /** @type {number} Euclidean: count of active beats to distribute. */
        this.activeBeatsCount = opts.activeBeatsCount ?? 0;
        /** @type {number} Euclidean: rotational shift in slots. */
        this.beatShift = opts.beatShift ?? 0;
        /** @type {number} Euclidean: internal repeat count. */
        this.repeats = opts.repeats ?? 1;
        /** @type {number} Pattern variation: per-slot x<->. flip probability (0 = off). */
        this.vary = opts.vary ?? 0;
        /** @type {number} The seed the current variation rolled (the dice button re-rolls it). */
        this.varySeed = opts.varySeed ?? 0;

        /** @type {boolean} */
        this.canCollide = opts.canCollide ?? false;
        /** @type {string} */
        this.hasCollidedFunction = opts.hasCollidedFunction ?? "";
        /** @type {string} Per-slot melodic STYLE name (nxtNote); "" = default. */
        this.hasCollidedStyle = opts.hasCollidedStyle ?? "";

        /** @type {boolean} */
        this.canBeTriggered = opts.canBeTriggered ?? false;
        /** @type {string} */
        this.beenTriggeredFunction = opts.beenTriggeredFunction ?? "";
        /** @type {string} */
        this.beenTriggeredStyle = opts.beenTriggeredStyle ?? "";
        this.canActiveBeat = opts.canActiveBeat ?? false;
        this.onActiveBeatFunction = opts.onActiveBeatFunction ?? "";
        /** @type {string} */
        this.onActiveBeatStyle = opts.onActiveBeatStyle ?? "";

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
