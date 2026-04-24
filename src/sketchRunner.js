/**
 * Sketch runner.
 *
 * Executes a score's sketch.js source to produce a populated
 * Scene. The sketch is wrapped in a function body that
 * receives the sketch API as named parameters; the user's code
 * references those as free variables (scene, bpm,
 * timeSignature, scale, image).
 *
 * The convention is that the sketch defines a setup() function
 * that builds the scene's structure. The runner executes the
 * top-level code (which typically just declares functions) and
 * then invokes setup() if it exists.
 *
 * An update() function is reserved by name for later milestones
 * (it will be called by the simulation loop during playback)
 * but is not invoked here.
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
    const argNames = ["scene", "bpm", "timeSignature", "scale", "image"];
    const probeBody =
        `"use strict";\nthrow new Error("__gxw_probe__");\n//# sourceURL=sketch.js`;
    try {
        // eslint-disable-next-line no-new-func
        new Function(...argNames, probeBody)();
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

        const api = {
            scene,
            bpm: (/** @type {number} */ n) => {
                scene.bpm = n;
            },
            timeSignature: (/** @type {number} */ num, /** @type {number} */ den) => {
                scene.timeSignature = [num, den];
            },
            scale: (/** @type {string} */ name) => {
                scene.scaleName = name;
            },
            image: (/** @type {string} */ name) => {
                scene.imageName = name;
            },
        };

        const argNames = Object.keys(api);
        const argValues = Object.values(api);

        const body = PREFIX + source + SUFFIX;

        let fn;
        try {
            // eslint-disable-next-line no-new-func
            fn = new Function(...argNames, body);
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
