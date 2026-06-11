/**
 * Scene loader.
 *
 * Builds a populated Scene from a score bundle's scene.json
 * and script.js files. Replaces the earlier sketchRunner
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
 *   2. Parse script.js with Acorn to find every top-level
 *      function declaration and every const/let bound to a
 *      function expression or arrow, AND to split out every
 *      top-level $objectId: expression labelled statement.
 *      The function names are the identifiers a scene.json
 *      function-ref field can refer to (hasCollidedFunction,
 *      beenTriggeredFunction, onTickFunction). The labelled
 *      statements are pattern blocks per section 28; they
 *      are extracted into a separate list and their source
 *      ranges in the executable stream are replaced with
 *      whitespace so the calls inside them (note, s, stack,
 *      and so on) do not run at scene-load time. Cmd-Enter
 *      on a labelled block in the Script tab is the only
 *      path that activates one (Stage A4 of the section-28
 *      pattern-authoring sequence).
 *
 *   3. Execute the stripped script.js inside a wrapper
 *      that returns a name-to-function map. The labelled
 *      pattern blocks have been replaced with whitespace by
 *      this point, so calls like note("c d e f") that would
 *      otherwise execute at load time stay inert until
 *      promoted via Cmd-Enter. The user's non-pattern code
 *      only contains declarations, no top-level side
 *      effects expected (and none required), so re-executing
 *      on every Run Scene is cheap.
 *
 * After steps 2 and 3 we have a function map and a list of
 * labelled pattern blocks. The function map is attached to
 * the Scene as scene.functionMap and consulted by the
 * simulation when a slot fires. The labelled blocks are
 * attached as scene.labelledBlocks for the inspector's
 * pattern row and the Script tab's active-tag highlighting to
 * consume (Stages A3 through A5). Slot fields on Curve,
 * Trigger, and Sprite hold STRING NAMES throughout — the
 * loader passes them through to the constructors verbatim
 * and does NOT resolve them at load time. A name that
 * doesn't match any top-level function in script.js is a
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
 * structured loc field. Runtime errors during script.js
 * execution use the same offset-calibration trick as the old
 * runner so line numbers map back to the user's source rather
 * than the wrapper's body.
 */

// @ts-check

import { Scene, DEFAULT_KINEMATICS, sceneDataHasBackgroundImage } from "./scene.js";
import {
    playNote as bareplayNote,
    playSound as bareplaySound,
    applyForce as bareApplyForce,
    onBeatInterval as bareOnBeatInterval,
} from "./callbackContext.js";
import * as acorn from "https://esm.sh/acorn@8";

const SCRIPT_PREFIX = `"use strict";\n`;
const SCRIPT_FILENAME = "script.js";

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
    constructor() {
        /**
         * Diagnostic print sink exposed to script.js as the
         * global `print(...)`. Defaults to a no-op so the loader
         * runs headless; main.js wires it to the message area via
         * setPrint. See executeScript for how it reaches user code.
         * @type {(...args: any[]) => void}
         */
        this._print = () => {};
    }

    /**
     * Set the diagnostic print sink that script.js can call
     * as print(...). Called once from main.js with a writer that
     * formats its arguments into the GXW message area.
     * @param {(...args: any[]) => void} fn
     */
    setPrint(fn) {
        this._print = typeof fn === "function" ? fn : () => {};
    }

    /**
     * Load a Scene from the bundle's scene.json and
     * script.js files.
     * @param {import("./bundle.js").Bundle} bundle
     * @returns {LoadResult}
     */
    load(bundle) {
        const sceneFile = bundle.getFile("scene.json");
        if (sceneFile === null) {
            return errorResult("This score has no scene.json file.");
        }
        const scriptFile = bundle.getFile(SCRIPT_FILENAME);
        if (scriptFile === null) {
            return errorResult(`This score has no script file.`);
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

        // --- 2/3. Parse + execute script.js for the function map ---
        //        and labelled blocks. A script.js error (syntax or
        //        runtime) is NON-FATAL: the objects come from
        //        scene.json, not the script, so we must still load and
        //        DISPLAY them. On a script error we proceed with an
        //        empty function map (callbacks inert until the script
        //        is fixed) and carry the error message back so the
        //        caller can surface it. Only scene.json problems are
        //        fatal — they genuinely prevent building objects.
        //
        //        Labelled pattern blocks are replaced with whitespace
        //        before execution so they don't run at load time. A
        //        `score` object is passed in so script.js can set
        //        score-wide kinematics; it's pre-filled with defaults
        //        and read back after execution.
        const scoreGlobal = { kinematics: { ...DEFAULT_KINEMATICS } };
        // hasBackgroundImage tells a script whether the scene has a
        // background image loaded. The image is tracked on the BUNDLE
        // (bundle.imageName, set whenever the user loads/imports one) —
        // that's the source the canvas samples for this.col, and a UI
        // image-add updates the bundle, NOT scene.json's imageName. So
        // read bundle.imageName, falling back to the parsed scene data
        // (e.g. a freshly-declared imageName not yet loaded). A live
        // getter, not a snapshot, so a callback sees an image added after
        // the scene ran — the bundle is mutated in place, so this closure
        // observes the change.
        Object.defineProperty(scoreGlobal, "hasBackgroundImage", {
            enumerable: true,
            get() {
                return sceneDataHasBackgroundImage(bundle)
                    || sceneDataHasBackgroundImage(sceneData);
            },
        });
        /** @type {Object<string, Function>} */
        let functionMap = {};
        /** @type {any[]} */
        let labelledBlocks = [];
        /** @type {string | null} */
        let scriptError = null;

        const parseResult = extractTopLevelFunctionNames(scriptFile.content);
        if (!parseResult.ok) {
            scriptError = parseResult.error;
        } else {
            const split = splitLabelledStatements(parseResult.ast, scriptFile.content);
            labelledBlocks = split.labelledBlocks;
            const execResult = executeScript(
                split.strippedSource, parseResult.names, scoreGlobal, this._print);
            if (!execResult.ok) {
                scriptError = execResult.error;
            } else {
                functionMap = execResult.functions;
            }
        }

        // --- 4. Build the Scene ---
        const scene = new Scene();
        scene.functionMap = functionMap;
        scene.labelledBlocks = labelledBlocks;
        scene.kinematics = sanitizeKinematics(scoreGlobal.kinematics);

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

        // Success: objects built and displayable. scriptError is non-
        // null when script.js failed to compile — the scene still
        // loads (callbacks inert) and the caller reports the error.
        return { success: true, scene, error: null, scriptError };
    }

    /**
     * Run the SETUP section of a script.js source: execute the script and
     * call its top-level setup() function, with a construction API supplied as
     * globals so the body reads like the GeoSonix reference example (bare
     * addCurve / setGroup / set / … calls). This is the Stage-1 wiring of the
     * scene-construction substrate (DESIGN section 3, subsection 5).
     *
     * It does NOT touch the scene model itself: the construction API the caller
     * passes is a builder bound to the caller's parsed scene.json data, so the
     * mutation lands on that data and the caller persists and reloads it. The
     * load path above is entirely separate and unchanged — this method only
     * borrows the same parse, labelled-block strip, and error-formatting helpers.
     *
     * Labelled $-blocks (the Strudel-era pattern blocks) are stripped before
     * execution exactly as load() strips them, so they do not run here either.
     *
     * @param {string} scriptSource  The current script.js text.
     * @param {Record<string, any>} api  Construction globals (builder verbs,
     *   math helpers, and any score-level setters) injected into the script's
     *   scope by name. print(...) is added automatically from setPrint.
     * @returns {{ok: boolean, ranSetup: boolean, error: string | null}}
     *   ok=false on a syntax/runtime error (error set); ok=true otherwise, with
     *   ranSetup=true iff a setup() function was found and called.
     */
    runSetup(scriptSource, api) {
        const parseResult = extractTopLevelFunctionNames(scriptSource);
        if (!parseResult.ok) {
            return { ok: false, ranSetup: false, error: parseResult.error };
        }
        const { strippedSource } = splitLabelledStatements(parseResult.ast, scriptSource);
        return executeSetupScript(strippedSource, api ?? {}, this._print);
    }

    /**
     * Compile just the callback function map from a script.js source,
     * without building a Scene. Used by the composition mirror's
     * live-apply path: when an AI edits only script.js while the score
     * is playing, the bundle recompiles the callbacks and swaps them
     * onto the running scene's functionMap in place — no setScene, no
     * runScene, no transport interruption (callbacks resolve by name
     * at fire time, so the swap takes effect on the next firing).
     *
     * Returns ok=false with an error string when the source fails to
     * parse or execute. The live-apply caller treats that as a
     * rejection and keeps the currently-running functionMap, so a
     * syntax error in an edit never silences a playing score. This is
     * a STRICTER contract than load(), which is deliberately resilient
     * (a script error there leaves an empty functionMap but still
     * displays the objects); mid-playback we must not swap in a broken
     * or empty map.
     *
     * Labelled $-blocks are stripped before execution exactly as
     * load() strips them, so they do not run here. Score-level
     * kinematics set at the top level are not persisted by this path
     * (they ride on the next full load); a fresh defaults object keeps
     * such assignments from throwing.
     *
     * @param {string} scriptSource The current script.js text.
     * @returns {{ ok: true, functionMap: Object<string, Function> }
     *          | { ok: false, error: string }}
     */
    compileScriptFunctions(scriptSource) {
        const parseResult = extractTopLevelFunctionNames(scriptSource);
        if (!parseResult.ok) {
            return { ok: false, error: parseResult.error };
        }
        const { strippedSource } = splitLabelledStatements(
            parseResult.ast, scriptSource);
        const scoreGlobal = { kinematics: { ...DEFAULT_KINEMATICS } };
        const execResult = executeScript(
            strippedSource, parseResult.names, scoreGlobal, this._print);
        if (!execResult.ok) {
            return { ok: false, error: execResult.error };
        }
        return { ok: true, functionMap: execResult.functions };
    }
}

/**
 * Execute a stripped script.js source with a construction API in scope and
 * call its setup() if present. Mirrors executeScript's wrapper shape (same
 * "use strict" prefix and sourceURL, so the calibrated line-number offset still
 * applies), but injects the api's keys as named parameters — the bare globals
 * the construction code calls — instead of harvesting a function map.
 *
 * @param {string} source  Stripped script source.
 * @param {Record<string, any>} api  Name→value globals (functions and numbers).
 * @param {(...args: any[]) => void} printFn  Diagnostic sink, exposed as print(...).
 * @returns {{ok: boolean, ranSetup: boolean, error: string | null}}
 */
function executeSetupScript(source, api, printFn) {
    const names = Object.keys(api);
    const values = names.map((n) => api[n]);
    // Provide the same `score` and `print` globals the load wrapper provides, so
    // any existing top-level statements in script.js (e.g. setting
    // score.kinematics) execute here without a ReferenceError. The construction
    // api keys are injected as additional bare globals. score.kinematics changes
    // are not persisted by setup (they ride on the next load, which re-reads
    // script.js); a fresh defaults object is enough to keep the script running.
    const scoreGlobal = { kinematics: { ...DEFAULT_KINEMATICS } };
    const body =
        SCRIPT_PREFIX +
        source +
        `\n;var __gxwRanSetup = (typeof setup === "function");` +
        `\nif (__gxwRanSetup) { setup(); }` +
        `\nreturn __gxwRanSetup;` +
        `\n//# sourceURL=${SCRIPT_FILENAME}`;

    let fn;
    try {
        // eslint-disable-next-line no-new-func
        fn = new Function(...names, "print", "score", body);
    } catch (err) {
        return { ok: false, ranSetup: false, error: formatScriptRuntimeError("Syntax error", err, source) };
    }

    let ran;
    try {
        ran = fn(...values, typeof printFn === "function" ? printFn : () => {}, scoreGlobal);
    } catch (err) {
        return { ok: false, ranSetup: false, error: formatScriptRuntimeError("Runtime error", err, source) };
    }
    return { ok: true, ranSetup: ran === true, error: null };
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
    if ("engine" in data && typeof data.engine === "string") {
        scene.engine = data.engine;
    }
    if ("voiceSuperdough" in data
        && typeof data.voiceSuperdough === "object"
        && data.voiceSuperdough !== null
        && !Array.isArray(data.voiceSuperdough)) {
        scene.voiceSuperdough = data.voiceSuperdough;
    }
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
 * Sanitise the kinematics object the composer set on the
 * `score` global in script.js. Each knob must be a finite
 * number >= 0; anything else (missing, NaN, string, negative)
 * falls back to the default. Returns a fresh object so the
 * Scene does not alias the loader's working copy.
 * @param {any} kin
 * @returns {{drag: number, jitter: number, coast: number, turnDamping: number}}
 */
function sanitizeKinematics(kin) {
    const pick = (v, fallback) =>
        (typeof v === "number" && Number.isFinite(v) && v >= 0) ? v : fallback;
    const src = (kin !== null && typeof kin === "object") ? kin : {};
    return {
        drag: pick(src.drag, DEFAULT_KINEMATICS.drag),
        jitter: pick(src.jitter, DEFAULT_KINEMATICS.jitter),
        coast: pick(src.coast, DEFAULT_KINEMATICS.coast),
        turnDamping: pick(src.turnDamping, DEFAULT_KINEMATICS.turnDamping),
    };
}

/**
 * Use Acorn to parse the script source and extract the
 * names of every top-level function declaration plus every
 * top-level const/let/var bound to a function expression or
 * arrow. Returns the AST too on success so callers can run
 * additional passes (e.g. splitLabelledStatements) over the
 * same parse.
 *
 * @param {string} source
 * @returns {{ok: true, names: string[], ast: any} | {ok: false, error: string}}
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
                error: `script syntax error on line ${line}: ${message}`,
            };
        }
        return { ok: false, error: `script syntax error: ${message}` };
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
    return { ok: true, names, ast };
}

/**
 * Walk a script.js AST for top-level labelled statements
 * whose label is dollar-prefixed ($objectId form) and whose
 * body is an expression statement, directly or via a chain
 * of further dollar-prefixed labels. Each such labelled
 * block is a strudel pattern block per section 9.
 *
 * A chain like `$CRV1: $CRV5: note("c d e f");` parses as
 * nested LabeledStatements wrapping one ExpressionStatement.
 * The walk collects every dollar-prefixed label until it
 * reaches the inner ExpressionStatement and emits one
 * labelledBlock entry per collected label, all sharing the
 * same expressionText and the same source range (the outer
 * statement's start/end). Downstream consumers operate
 * per-label without structural change; the only difference
 * is that several entries now resolve to the same expression
 * text, which is precisely what the shared block conveys.
 *
 * Return the extracted blocks plus a stripped source where
 * each block's range is replaced with whitespace, preserving
 * the file's line layout so error line numbers from
 * executing the remainder still match the user's original
 * source.
 *
 * Labelled statements whose label does not start with a
 * dollar, and labelled statements whose body is not an
 * expression (a labelled block statement, a labelled var
 * declaration), are left untouched in the stripped source
 * and execute as ordinary JavaScript like anything else. A
 * chain that mixes a dollar-prefixed label with a non-dollar
 * one is treated as ordinary code in the same way.
 *
 * @param {any} ast Acorn AST of the script source.
 * @param {string} source Original script source.
 * @returns {{strippedSource: string, labelledBlocks: import("./scene.js").LabelledBlock[]}}
 */
function splitLabelledStatements(ast, source) {
    /** @type {import("./scene.js").LabelledBlock[]} */
    const labelledBlocks = [];
    const chars = source.split("");

    for (const node of ast.body) {
        if (node.type !== "LabeledStatement") continue;
        const labelName = node.label && node.label.name;
        if (!labelName || labelName[0] !== "$") continue;

        // Walk the label chain inward, collecting every
        // dollar-prefixed label until the body is no longer
        // a LabeledStatement. The chain is valid only if
        // every label along the way is dollar-prefixed and
        // the innermost body is an ExpressionStatement. A
        // non-dollar label anywhere in the chain, or a
        // non-expression terminus, leaves the entire chain
        // intact in the stripped source as ordinary code.
        /** @type {string[]} */
        const objectIds = [];
        let current = node;
        let chainValid = true;
        while (current && current.type === "LabeledStatement") {
            const curLabel = current.label && current.label.name;
            if (!curLabel || curLabel[0] !== "$") {
                chainValid = false;
                break;
            }
            objectIds.push(curLabel.slice(1));
            current = current.body;
        }
        if (!chainValid) continue;
        if (!current || current.type !== "ExpressionStatement") continue;

        const expr = current.expression;
        const expressionText = source.slice(expr.start, expr.end);
        const range = { start: node.start, end: node.end };

        for (const objectId of objectIds) {
            labelledBlocks.push({
                objectId,
                expressionText,
                range,
            });
        }

        // Replace the block's source range with whitespace,
        // keeping newlines in place so the stripped source
        // has the same line count and layout as the
        // original. Runtime errors from executing the
        // remainder still report against line numbers that
        // match the user's source.
        for (let i = node.start; i < node.end; i++) {
            if (chars[i] !== "\n") chars[i] = " ";
        }
    }

    return { strippedSource: chars.join(""), labelledBlocks };
}

/**
 * Build a wrapper around the user script source that,
 * after running the user's declarations, returns a
 * name-to-function map. The wrapper uses
 * `typeof name === "function"` guards so a name that Acorn
 * flagged but that isn't actually a function at runtime (e.g.
 * a const reassigned to a non-function) still doesn't crash
 * the wrapper.
 *
 * The wrapper also receives a `score` object so script.js
 * can set score-wide config (currently the kinematics knobs);
 * the object is mutated in place by the user's top-level
 * assignments and read back by the caller.
 *
 * @param {string} source
 * @param {string[]} functionNames
 * @param {any} scoreGlobal  The `score` object exposed to script.js.
 * @param {(...args: any[]) => void} [printFn]  Diagnostic sink exposed to
 *   script.js as the global print(...); defaults to a no-op. Passed as a
 *   Function parameter (not prepended to the source) so it does not shift
 *   user line numbers for error reporting.
 * @returns {{ok: true, functions: Object<string, Function>} | {ok: false, error: string}}
 */
function executeScript(source, functionNames, scoreGlobal, printFn) {
    const returnObjectEntries = functionNames
        .map((n) => `${JSON.stringify(n)}: typeof ${n} === "function" ? ${n} : null`)
        .join(", ");
    const body =
        SCRIPT_PREFIX +
        source +
        `\n;return { ${returnObjectEntries} };` +
        `\n//# sourceURL=${SCRIPT_FILENAME}`;

    let fn;
    try {
        // eslint-disable-next-line no-new-func
        // `score` and `print` plus the bare action emitters (playNote,
        // playSound, applyForce) are passed as Function parameters so
        // every top-level callback closes over them as bare names —
        // no `this.` / `ctx.` prefix (§3.2/§3.3). They are stable
        // singletons from callbackContext.js that route to whichever
        // object the engine has set as the current firing context.
        // Passed as parameters (not prepended to the source) so they
        // do not shift user line numbers in error reports.
        fn = new Function(
            "score", "print", "playNote", "playSound", "applyForce",
            "onBeatInterval", body);
    } catch (err) {
        // Acorn already caught syntax errors at parse time, but
        // belt-and-braces in case the new Function path catches
        // something Acorn didn't.
        return {
            ok: false,
            error: formatScriptRuntimeError("Syntax error", err, source),
        };
    }

    let raw;
    try {
        raw = fn(
            scoreGlobal,
            typeof printFn === "function" ? printFn : () => {},
            bareplayNote, bareplaySound, bareApplyForce, bareOnBeatInterval);
    } catch (err) {
        return {
            ok: false,
            error: formatScriptRuntimeError("Runtime error", err, source),
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
        `"use strict";\nthrow new Error("__gxw_probe__");\n//# sourceURL=${SCRIPT_FILENAME}`;
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
 * Format an error from script.js execution, with a line
 * number into the user's source where possible.
 * @param {string} kind
 * @param {unknown} err
 * @param {string} source
 * @returns {string}
 */
function formatScriptRuntimeError(kind, err, source) {
    if (!(err instanceof Error)) {
        return `script ${kind.toLowerCase()}: ${String(err)}`;
    }
    const info = extractLineInfo(err);
    const name = err.name && err.name !== "Error" ? err.name : kind;
    if (info !== null) {
        const userLine = info.line - getOffset();
        const lineText = lineFromSource(source, userLine);
        if (lineText !== null && userLine >= 1) {
            return `script ${name} on line ${userLine}: ${err.message}\n  ${lineText.trim()}`;
        }
    }
    return `script ${name}: ${err.message}`;
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
        /script\.js:(\d+):(\d+)/,
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
