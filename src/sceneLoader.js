/**
 * Scene loader.
 *
 * Builds a populated Scene from a score bundle's scene.json
 * and behaviors.js files. Replaces the earlier sketchRunner
 * that combined data and behaviour in a single sketch.js \u2014
 * DESIGN.md v2.4 splits the two so a property panel and AI
 * assistants can edit them independently.
 *
 * The loader does three things in sequence:
 *
 *   1. Parse scene.json. Top-level fields become piece-wide
 *      Scene properties (bpm, tonic, etc.). Arrays of curves,
 *      triggers, and sprites are walked and handed to
 *      scene.addCurve / addTrigger / addSprite.
 *
 *   2. Parse behaviors.js with Acorn to find every top-level
 *      function declaration and every const/let bound to a
 *      function expression or arrow. Those names are the
 *      identifiers a scene.json function-ref field can refer
 *      to (hitBeat, hitTrigger, collision, motionUpdate,
 *      auto).
 *
 *   3. Execute behaviors.js inside a wrapper that returns a
 *      name-to-function map. The user's code only contains
 *      declarations, no top-level side effects expected (and
 *      none required), so re-executing on every Run Scene is
 *      cheap.
 *
 * After steps 2 and 3 we have a function map. The map is
 * attached to the Scene as scene.functionMap and consulted
 * by the simulation when a slot fires. Slot fields on Curve,
 * Trigger, and Sprite hold STRING NAMES throughout — the
 * loader passes them through to the constructors verbatim
 * and does NOT resolve them at load time. A name that
 * doesn't match any top-level function in behaviors.js is a
 * soft error: the slot stays inert at fire time and the
 * inspector eventually surfaces a warning, but the scene
 * still runs. This v2.4 model differs from the pre-v2.4
 * model where slot fields stored Function references
 * resolved at load time and a missing reference was a hard
 * load-time error.
 *
 * Error reporting tries to give a line number into the
 * relevant source. JSON parse errors carry "position N" or
 * "line N column M" patterns we can convert to a 1-based line
 * number. JavaScript syntax errors come from Acorn with a
 * structured loc field. Runtime errors during behaviors.js
 * execution use the same offset-calibration trick as the old
 * runner so line numbers map back to the user's source rather
 * than the wrapper's body.
 */

// @ts-check

import { Scene } from "./scene.js";
import * as acorn from "https://esm.sh/acorn@8";

const SCRIPT_PREFIX = `"use strict";\n`;
const BEHAVIORS_FILENAME = "behaviors.js";

/** Function-wrapper line offset, calibrated on first use. */
/** @type {number | null} */
let calibratedOffset = null;

/**
 * @typedef {Object} LoadResult
 * @property {boolean} success
 * @property {Scene | null} scene
 * @property {string | null} error
 */

export class SceneLoader {
    /**
     * Load a Scene from the bundle's scene.json and
     * behaviors.js files.
     * @param {import("./bundle.js").Bundle} bundle
     * @returns {LoadResult}
     */
    load(bundle) {
        const sceneFile = bundle.getFile("scene.json");
        if (sceneFile === null) {
            return errorResult("This score has no scene.json file.");
        }
        const behaviorsFile = bundle.getFile(BEHAVIORS_FILENAME);
        if (behaviorsFile === null) {
            return errorResult(`This score has no ${BEHAVIORS_FILENAME} file.`);
        }

        // --- 1. Parse scene.json ---
        let sceneData;
        try {
            sceneData = JSON.parse(sceneFile.content);
        } catch (err) {
            return errorResult(
                formatJsonParseError(err, sceneFile.content)
            );
        }
        if (typeof sceneData !== "object" || sceneData === null || Array.isArray(sceneData)) {
            return errorResult("scene.json must be a JSON object at top level.");
        }

        // --- 2. Parse behaviors.js with Acorn for function names ---
        const namesResult = extractTopLevelFunctionNames(behaviorsFile.content);
        if (!namesResult.ok) {
            return errorResult(namesResult.error);
        }
        const functionNames = namesResult.names;

        // --- 3. Execute behaviors.js to get a function map ---
        const execResult = executeScript(behaviorsFile.content, functionNames);
        if (!execResult.ok) {
            return errorResult(execResult.error);
        }
        const functionMap = execResult.functions;

        // --- 4. Build the Scene ---
        const scene = new Scene();
        scene.functionMap = functionMap;

        try {
            applyPieceLevelFields(scene, sceneData);
        } catch (err) {
            return errorResult(`scene.json: ${(err instanceof Error) ? err.message : String(err)}`);
        }

        for (const kind of /** @type {const} */ (["curves", "triggers", "sprites"])) {
            const arr = sceneData[kind];
            if (arr === undefined || arr === null) continue;
            if (!Array.isArray(arr)) {
                return errorResult(`scene.json: "${kind}" must be an array.`);
            }
            for (let i = 0; i < arr.length; i++) {
                const entry = arr[i];
                if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                    return errorResult(
                        `scene.json: ${kind}[${i}] must be an object.`
                    );
                }
                // Slot fields hold string names; pass them
                // through verbatim. Resolution against
                // functionMap happens at fire time, not here
                // — a name that doesn't resolve is a soft error
                // (slot stays inert) rather than a load-time
                // failure. See DESIGN.md §9.
                const opts = { ...entry };

                if (kind === "curves") scene.addCurve(opts);
                else if (kind === "triggers") scene.addTrigger(opts);
                else scene.addSprite(opts);
            }
        }

        return { success: true, scene, error: null };
    }
}

/**
 * Apply the score-level (piece-wide) fields from the parsed
 * scene.json to the Scene. Only known fields are copied;
 * unknown fields are silently ignored at this milestone (a
 * future schema-strict mode could surface them as warnings).
 *
 * @param {Scene} scene
 * @param {Object} data
 */
function applyPieceLevelFields(scene, data) {
    if ("bpm" in data) scene.bpm = data.bpm;
    // v2.3 removed score-level timeSignature; if a legacy
    // scene.json still carries the field, the migration pass
    // (cleanLegacySceneFields) strips it before this loader
    // runs, so we silently ignore it here without touching
    // the Scene object.
    if ("tonic" in data) scene.tonic = data.tonic;
    if ("scaleName" in data) scene.scaleName = data.scaleName;
    if ("root" in data) scene.root = data.root;
    if ("chordName" in data) scene.chordName = data.chordName;
    if ("range" in data) scene.range = data.range;
    if ("rangeLow" in data) scene.rangeLow = data.rangeLow;
    if ("mapNotesTo" in data) scene.mapNotesTo = data.mapNotesTo;
    if ("imageName" in data) scene.imageName = data.imageName;
    if ("output" in data) scene.output = data.output;
    if ("triggerScale" in data && typeof data.triggerScale === "number") {
        scene.triggerScale = data.triggerScale;
    }
    if ("spriteScale" in data && typeof data.spriteScale === "number") {
        scene.spriteScale = data.spriteScale;
    }
    if ("canvasW" in data && typeof data.canvasW === "number" && data.canvasW > 0) {
        scene.canvasW = data.canvasW;
    }
    if ("canvasH" in data && typeof data.canvasH === "number" && data.canvasH > 0) {
        scene.canvasH = data.canvasH;
    }
}

/**
 * Use Acorn to parse the behaviours source and extract the
 * names of every top-level function declaration plus every
 * top-level const/let/var bound to a function expression or
 * arrow.
 *
 * @param {string} source
 * @returns {{ok: true, names: string[]} | {ok: false, error: string}}
 */
function extractTopLevelFunctionNames(source) {
    /** @type {any} */
    let ast;
    try {
        ast = acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
            locations: true,
        });
    } catch (err) {
        // @ts-ignore \u2014 Acorn attaches loc as { line, column }.
        const loc = err && err.loc;
        const line = loc && typeof loc.line === "number" ? loc.line : null;
        const message = err instanceof Error ? err.message : String(err);
        if (line !== null) {
            return {
                ok: false,
                error: `${BEHAVIORS_FILENAME} syntax error on line ${line}: ${message}`,
            };
        }
        return { ok: false, error: `${BEHAVIORS_FILENAME} syntax error: ${message}` };
    }

    /** @type {string[]} */
    const names = [];
    for (const node of ast.body) {
        if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
            names.push(node.id.name);
        } else if (node.type === "VariableDeclaration") {
            for (const decl of node.declarations) {
                if (
                    decl.id && decl.id.type === "Identifier" &&
                    decl.init && (
                        decl.init.type === "FunctionExpression" ||
                        decl.init.type === "ArrowFunctionExpression"
                    )
                ) {
                    names.push(decl.id.name);
                }
            }
        }
    }
    return { ok: true, names };
}

/**
 * Build a wrapper around the user behaviours source that,
 * after running the user's declarations, returns a
 * name-to-function map. The wrapper uses
 * `typeof name === "function"` guards so a name that Acorn
 * flagged but that isn't actually a function at runtime (e.g.
 * a const reassigned to a non-function) still doesn't crash
 * the wrapper.
 *
 * @param {string} source
 * @param {string[]} functionNames
 * @returns {{ok: true, functions: Object<string, Function>} | {ok: false, error: string}}
 */
function executeScript(source, functionNames) {
    const returnObjectEntries = functionNames
        .map((n) => `${JSON.stringify(n)}: typeof ${n} === "function" ? ${n} : null`)
        .join(", ");
    const body =
        SCRIPT_PREFIX +
        source +
        `\n;return { ${returnObjectEntries} };` +
        `\n//# sourceURL=${BEHAVIORS_FILENAME}`;

    let fn;
    try {
        // eslint-disable-next-line no-new-func
        fn = new Function(body);
    } catch (err) {
        // Acorn already caught syntax errors at parse time, but
        // belt-and-braces in case the new Function path catches
        // something Acorn didn't.
        return {
            ok: false,
            error: formatBehavioursRuntimeError("Syntax error", err, source),
        };
    }

    let raw;
    try {
        raw = fn();
    } catch (err) {
        return {
            ok: false,
            error: formatBehavioursRuntimeError("Runtime error", err, source),
        };
    }

    /** @type {Object<string, Function>} */
    const functions = {};
    if (raw && typeof raw === "object") {
        for (const name of Object.keys(raw)) {
            if (typeof raw[name] === "function") {
                functions[name] = raw[name];
            }
        }
    }
    return { ok: true, functions };
}

/**
 * Determine how many lines new Function() adds before the
 * body. Runs a probe that throws from body line 2 (one line
 * after `"use strict";`) so we can subtract the wrapper's
 * contribution from any reported line number.
 * @returns {number}
 */
function calibrateOffset() {
    const probeBody =
        `"use strict";\nthrow new Error("__gxw_probe__");\n//# sourceURL=${BEHAVIORS_FILENAME}`;
    try {
        // eslint-disable-next-line no-new-func
        new Function(probeBody)();
    } catch (err) {
        if (err instanceof Error) {
            const info = extractLineInfo(err);
            if (info !== null) {
                return info.line - 1;
            }
        }
    }
    return 1;
}

function getOffset() {
    if (calibratedOffset === null) {
        calibratedOffset = calibrateOffset();
    }
    return calibratedOffset;
}

/**
 * Format an error from behaviours.js execution, with a line
 * number into the user's source where possible.
 * @param {string} kind
 * @param {unknown} err
 * @param {string} source
 * @returns {string}
 */
function formatBehavioursRuntimeError(kind, err, source) {
    if (!(err instanceof Error)) {
        return `${BEHAVIORS_FILENAME} ${kind.toLowerCase()}: ${String(err)}`;
    }
    const info = extractLineInfo(err);
    const name = err.name && err.name !== "Error" ? err.name : kind;
    if (info !== null) {
        const userLine = info.line - getOffset();
        const lineText = lineFromSource(source, userLine);
        if (lineText !== null && userLine >= 1) {
            return `${BEHAVIORS_FILENAME} ${name} on line ${userLine}: ${err.message}\n  ${lineText.trim()}`;
        }
    }
    return `${BEHAVIORS_FILENAME} ${name}: ${err.message}`;
}

/**
 * Format a JSON parse error with a 1-based line number into
 * the source. Browser engines disagree on the exact text of
 * SyntaxError messages from JSON.parse; we look for both the
 * "position N" pattern (V8) and "line N column M" pattern
 * (SpiderMonkey) and fall back to the raw message.
 * @param {unknown} err
 * @param {string} source
 * @returns {string}
 */
function formatJsonParseError(err, source) {
    const message = err instanceof Error ? err.message : String(err);
    let line = null;

    let m = message.match(/position\s+(\d+)/i);
    if (m !== null) {
        line = lineNumberAtPosition(source, parseInt(m[1], 10));
    } else {
        m = message.match(/line\s+(\d+)/i);
        if (m !== null) {
            line = parseInt(m[1], 10);
        }
    }

    if (line !== null) {
        return `scene.json parse error on line ${line}: ${message}`;
    }
    return `scene.json parse error: ${message}`;
}

/**
 * Convert a 0-based character position into a 1-based line
 * number.
 * @param {string} source
 * @param {number} pos
 * @returns {number}
 */
function lineNumberAtPosition(source, pos) {
    let line = 1;
    const limit = Math.min(pos, source.length);
    for (let i = 0; i < limit; i++) {
        if (source.charCodeAt(i) === 10) line++;
    }
    return line;
}

/**
 * Pull a {line, column} pair out of an error's stack or
 * non-standard properties.
 * @param {Error} err
 * @returns {{line: number, column: number} | null}
 */
function extractLineInfo(err) {
    // @ts-ignore \u2014 Firefox non-standard properties.
    if (typeof err.lineNumber === "number") {
        // @ts-ignore
        return { line: err.lineNumber, column: err.columnNumber ?? 0 };
    }
    const stack = typeof err.stack === "string" ? err.stack : "";
    const patterns = [
        /behaviors\.js:(\d+):(\d+)/,
        /behaviours\.js:(\d+):(\d+)/,
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

/**
 * Produce a failure LoadResult with the given message.
 * @param {string} message
 * @returns {LoadResult}
 */
function errorResult(message) {
    return { success: false, scene: null, error: message };
}
