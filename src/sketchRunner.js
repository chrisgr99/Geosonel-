/**
 * Sketch runner.
 *
 * Executes a score's sketch.js source to produce a populated
 * Scene. The sketch is wrapped in a function body that
 * receives the GXW sketch API as named parameters; the user's
 * code references those as free variables.
 *
 * The convention is that the sketch (a) defines a setup()
 * function that configures piece-level parameters (bpm,
 * timeSignature, tonic, scale, etc.), and (b) at top level
 * adds objects to the singleton `scene` via scene.addCurve,
 * scene.addTrigger, scene.addSprite. The runner executes the
 * top-level code first, then invokes setup() if it exists.
 *
 * The injected API (DESIGN.md §11, §14, §18):
 *   - scene: the Scene the user populates.
 *   - bpm, timeSignature: transport setters.
 *   - tonic, scale, root, chord, range, rangeLow, mapNotesTo:
 *     score-level harmony framework setters.
 *   - image, output: resource setters.
 *   - scaleMap, rangeMap, chordMap, harmonyMap, listMap:
 *     mapping helpers used by firing functions. Stubbed at
 *     this milestone — they return reasonable placeholders so
 *     sketches that reference them don't error, but no firing
 *     functions are invoked yet (the simulation loop arrives
 *     in a later milestone).
 *
 * Errors — syntax errors from new Function(), or runtime
 * errors from setup() — are caught, parsed for line numbers
 * where possible, and returned alongside a null scene so the
 * caller can render the previous scene and surface the error
 * to the user.
 *
 * Line numbers from new Function() stack traces are offset by
 * the wrapper's own lines. V8 counts the generated
 * `function anonymous(args) {` header as real lines. Different
 * engines produce different offsets, so we calibrate at
 * startup by running a probe with a known-line error and
 * measuring what V8 reports.
 */

// @ts-check

import { Scene } from "./scene.js";

const PREFIX = `"use strict";\n`;
const SUFFIX = `\n;if (typeof setup === "function") { setup(); }\n//# sourceURL=sketch.js`;

/**
 * Names of the API parameters injected into every sketch
 * wrapper. Listed here as the single source of truth so the
 * calibration probe and the actual run path stay in sync.
 */
const API_NAMES = [
    "scene",
    "bpm",
    "timeSignature",
    "tonic",
    "scale",
    "root",
    "chord",
    "range",
    "rangeLow",
    "mapNotesTo",
    "image",
    "output",
    "scaleMap",
    "rangeMap",
    "chordMap",
    "harmonyMap",
    "listMap",
];

/** Function-wrapper line offset, calibrated on first use. */
/** @type {number | null} */
let calibratedOffset = null;

/**
 * Determine how many lines new Function() adds before the body.
 * Runs a probe that throws from body line 2 (one line after
 * `"use strict";`, same shape as real sketches). The difference
 * between the reported line and 2 tells us the wrapper's
 * contribution; we add 1 for our prefix to get the total
 * stack-to-source offset.
 * @returns {number}
 */
function calibrateOffset() {
    const probeBody =
        `"use strict";\nthrow new Error("__gxw_probe__");\n//# sourceURL=sketch.js`;
    try {
        // eslint-disable-next-line no-new-func
        new Function(...API_NAMES, probeBody)();
    } catch (err) {
        if (err instanceof Error) {
            const info = extractLineInfo(err);
            if (info !== null) {
                // Throw is at body line 2. stack-to-source offset
                // for real sketches (where source starts at body
                // line 2 after our prefix) equals (reported - 2) + 1
                // = reported - 1.
                return info.line - 1;
            }
        }
    }
    return 1; // fallback: assume only our prefix line contributes
}

function getOffset() {
    if (calibratedOffset === null) {
        calibratedOffset = calibrateOffset();
    }
    return calibratedOffset;
}

/**
 * @typedef {Object} RunResult
 * @property {boolean} success
 * @property {Scene | null} scene
 * @property {string | null} error
 */

export class SketchRunner {
    /**
     * Run the given sketch source and produce a populated Scene.
     * @param {string} source
     * @returns {RunResult}
     */
    run(source) {
        const scene = new Scene();
        const api = buildApi(scene);

        // Order must match API_NAMES exactly; build the values
        // array in that order so the wrapper's parameter list
        // and our argument list align with what calibration
        // measured.
        const argValues = API_NAMES.map((name) => api[name]);

        const body = PREFIX + source + SUFFIX;

        let fn;
        try {
            // eslint-disable-next-line no-new-func
            fn = new Function(...API_NAMES, body);
        } catch (err) {
            return {
                success: false,
                scene: null,
                error: formatError("Syntax error", err, source),
            };
        }

        try {
            fn.apply(null, argValues);
            return { success: true, scene, error: null };
        } catch (err) {
            return {
                success: false,
                scene: null,
                error: formatError("Runtime error", err, source),
            };
        }
    }
}

/**
 * Build the API object exposed to the sketch. The object's
 * keys are the names sketches reference as free variables; the
 * values are the implementations bound to the run's Scene.
 * @param {Scene} scene
 * @returns {Object<string, any>}
 */
function buildApi(scene) {
    return {
        // The Scene the sketch populates.
        scene,

        // --- Transport ---
        bpm: (/** @type {number} */ n) => {
            scene.bpm = n;
        },
        timeSignature: (/** @type {number} */ num, /** @type {number} */ den) => {
            scene.timeSignature = [num, den];
        },

        // --- Harmony framework ---
        tonic: (/** @type {string} */ name) => {
            scene.tonic = name;
        },
        scale: (/** @type {string} */ name) => {
            scene.scaleName = name;
        },
        root: (/** @type {string} */ name) => {
            scene.root = name;
        },
        chord: (/** @type {string} */ name) => {
            scene.chordName = name;
        },
        range: (/** @type {number} */ semitones) => {
            scene.range = semitones;
        },
        rangeLow: (/** @type {number} */ midi) => {
            scene.rangeLow = midi;
        },
        mapNotesTo: (/** @type {"Score" | "Scale" | "Chord" | "None"} */ target) => {
            scene.mapNotesTo = target;
        },

        // --- Resources ---
        image: (/** @type {string} */ name) => {
            scene.imageName = name;
        },
        output: (/** @type {string} */ target, /** @type {string | null} */ port = null) => {
            scene.output = { target, port };
        },

        // --- Mapping helpers (stubs until audio milestone). ---
        // Signatures match what firing functions will use; the
        // returned values are placeholders so a sketch that
        // references these names doesn't error if its functions
        // get evaluated. The simulation loop that actually
        // invokes firing functions arrives in a later
        // milestone, so the placeholder values never reach
        // audio output at this stage.
        scaleMap: (/** @type {number} */ _value, /** @type {object} */ _opts) => 60,
        rangeMap: (/** @type {number} */ _value, /** @type {object} */ _opts) => 60,
        chordMap: (/** @type {number} */ _index, /** @type {object} */ _opts) => 60,
        harmonyMap: (/** @type {number} */ _value, /** @type {object} */ _opts) => 60,
        listMap: (/** @type {number} */ index, /** @type {Array<any>} */ list) => {
            if (!Array.isArray(list) || list.length === 0) return null;
            const len = list.length;
            const i = ((index % len) + len) % len;
            return list[i];
        },
    };
}

/**
 * Format an error for display, including a best-effort line
 * number pointing into the user's source.
 * @param {string} kind
 * @param {unknown} err
 * @param {string} source
 * @returns {string}
 */
function formatError(kind, err, source) {
    if (!(err instanceof Error)) {
        return `${kind}: ${String(err)}`;
    }
    const info = extractLineInfo(err);
    const name = err.name && err.name !== "Error" ? err.name : kind;
    if (info !== null) {
        const userLine = info.line - getOffset();
        const lineText = lineFromSource(source, userLine);
        if (lineText !== null && userLine >= 1) {
            return `${name} on line ${userLine}: ${err.message}\n  ${lineText.trim()}`;
        }
        return `${name}: ${err.message}`;
    }
    return `${name}: ${err.message}`;
}

/**
 * Pull a {line, column} pair out of an error's stack or
 * non-standard properties.
 * @param {Error} err
 * @returns {{line: number, column: number} | null}
 */
function extractLineInfo(err) {
    // Firefox exposes lineNumber and columnNumber directly.
    // @ts-ignore — non-standard properties
    if (typeof err.lineNumber === "number") {
        // @ts-ignore
        return { line: err.lineNumber, column: err.columnNumber ?? 0 };
    }
    const stack = typeof err.stack === "string" ? err.stack : "";
    const patterns = [
        /sketch\.js:(\d+):(\d+)/,
        /<anonymous>:(\d+):(\d+)/,
        /eval at.*:(\d+):(\d+)/,
    ];
    for (const re of patterns) {
        const m = stack.match(re);
        if (m !== null) {
            return { line: parseInt(m[1], 10), column: parseInt(m[2], 10) };
        }
    }
    return null;
}

/**
 * Return the Nth line of source (1-based), or null if out of
 * range.
 * @param {string} source
 * @param {number} lineNumber
 * @returns {string | null}
 */
function lineFromSource(source, lineNumber) {
    if (lineNumber < 1) return null;
    const lines = source.split("\n");
    if (lineNumber > lines.length) return null;
    return lines[lineNumber - 1];
}
