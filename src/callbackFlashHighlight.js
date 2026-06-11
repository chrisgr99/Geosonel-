/**
 * "Callback firing flash" highlight for the Script tab.
 *
 * When a procedural MOMENT callback fires (a collision /
 * beenTriggered, or a curve's onActiveBeat), this extension
 * briefly outlines, in the script.js editor:
 *
 *   1. the callback's function-declaration name, and
 *   2. each `this.<...>` value-read that actually executed on
 *      that firing — the reads recorded by the simulation's
 *      recording proxy.
 *
 * It mirrors activeBeatHighlight.js: a ViewPlugin holding a
 * doc-derived map (rebuilt on doc change) plus the latest
 * per-firing flash state (set every frame by the canvas via
 * setCallbackFlashesEffect), deriving its decoration set from
 * the two. The white outline fades with the supplied opacity so
 * a firing flashes and then dims out over a short window.
 *
 * Doc map. The document is parsed with Acorn; every top-level
 * FunctionDeclaration with a name contributes its name range and
 * the document ranges of its `this.<a>.<b>` / `this.<a>` reads.
 * A member expression that is the callee of a call (this.playNote
 * (...), this.agc(...)) is excluded, so methods never flash even
 * though the proxy records their access.
 *
 * The fired `paths` come from the simulation, which records the
 * dotted property chain after `this` (e.g. "col.r", "x") via a
 * read-recording proxy. A read flashes only when its path is in
 * the firing function's fired-path set.
 */

// @ts-check

import { ViewPlugin, Decoration } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { StateEffect, RangeSetBuilder } from "https://esm.sh/@codemirror/state@6.5.2";
import * as acorn from "https://esm.sh/acorn@8";

/**
 * Effect carrying the per-firing flash state for this frame: a
 * Map<functionName, {paths: string[], opacity: number}>. Set by
 * the editor each render frame during playback (via
 * applyCallbackFlashes), driven by the canvas, which reads the
 * simulation's recent-firings map and computes a fading opacity.
 * An empty map (or no dispatch) clears all boxes.
 */
export const setCallbackFlashesEffect = StateEffect.define();

/**
 * Climb an Acorn MemberExpression whose object chain roots at a
 * ThisExpression and return the dotted property path after
 * `this` (e.g. "col.r", "x"), or null if the chain does not root
 * at `this` or uses computed / non-identifier members.
 * @param {any} node  A MemberExpression node.
 * @returns {string | null}
 */
function thisMemberPath(node) {
    /** @type {string[]} */
    const parts = [];
    let cur = node;
    while (cur !== null && typeof cur === "object" && cur.type === "MemberExpression") {
        if (cur.computed) return null;
        if (cur.property === null || cur.property.type !== "Identifier") return null;
        parts.unshift(cur.property.name);
        cur = cur.object;
    }
    if (cur === null || cur.type !== "ThisExpression") return null;
    if (parts.length === 0) return null;
    return parts.join(".");
}

/**
 * Recursively visit every node, calling visit(node, parent).
 * @param {any} node
 * @param {any} parent
 * @param {(n: any, p: any) => void} visit
 */
function walkAst(node, parent, visit) {
    if (node === null || typeof node !== "object" || typeof node.type !== "string") return;
    visit(node, parent);
    for (const key in node) {
        if (key === "type" || key === "start" || key === "end"
            || key === "loc" || key === "range") continue;
        const v = node[key];
        if (Array.isArray(v)) {
            for (const c of v) walkAst(c, node, visit);
        } else if (v !== null && typeof v === "object" && typeof v.type === "string") {
            walkAst(v, node, visit);
        }
    }
}

/**
 * Parse the document and build the function map:
 * Map<functionName, {nameFrom, nameTo, reads: [{path, from, to}]}>.
 * Only top-level FunctionDeclarations with a name are recorded.
 * `reads` are this.* member expressions, excluding any that is the
 * callee of a CallExpression (method calls never flash).
 *
 * @param {import("@codemirror/view").EditorView} view
 * @returns {Map<string, {nameFrom: number, nameTo: number, reads: Array<{path: string, from: number, to: number}>}>}
 */
function buildFunctionMap(view) {
    /** @type {Map<string, {nameFrom: number, nameTo: number, reads: Array<{path: string, from: number, to: number}>}>} */
    const fns = new Map();
    const source = view.state.doc.toString();
    let ast;
    try {
        ast = acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
            locations: false,
        });
    } catch (_err) {
        // Whole-file syntax error: no map until it parses.
        return fns;
    }
    if (ast === null || !Array.isArray(ast.body)) return fns;
    for (const node of ast.body) {
        if (node.type !== "FunctionDeclaration") continue;
        if (node.id === null || node.id.type !== "Identifier") continue;
        const name = node.id.name;
        if (typeof name !== "string" || name === "") continue;
        /** @type {Array<{path: string, from: number, to: number}>} */
        const reads = [];
        walkAst(node.body, node, (n, parent) => {
            if (n.type !== "MemberExpression") return;
            // Skip a member expression that is itself the object of
            // an enclosing member expression — only the outermost
            // member of a chain becomes a read (this.col.r, not the
            // inner this.col).
            if (parent !== null && parent.type === "MemberExpression"
                && parent.object === n) return;
            // Skip a call target (this.playNote(...), this.agc(...)).
            if (parent !== null && parent.type === "CallExpression"
                && parent.callee === n) return;
            const path = thisMemberPath(n);
            if (path === null) return;
            reads.push({ path, from: n.start, to: n.end });
        });
        fns.set(name, {
            nameFrom: node.id.start,
            nameTo: node.id.end,
            reads,
        });
    }
    return fns;
}

// Neutral box colour for the function name and non-colour reads.
const FLASH_GREY = [144, 144, 144];
// Representative RGB per image-colour channel (the last path segment of a
// `col.*` / `color.*` read). Hue signals get their hue; lightness is white;
// chroma and anything else fall through to grey.
const CHANNEL_COLOURS = {
    r: [255, 70, 70], g: [70, 200, 70], b: [90, 130, 255], y: [220, 210, 50],
    or: [255, 150, 50], li: [150, 220, 50], cy: [50, 200, 200], pu: [190, 70, 220],
    lt: [235, 235, 235],
};

/**
 * RGB for a read path: the channel colour for a `col.*` / `color.*` signal
 * read, or null (→ grey) for chroma and non-colour reads.
 * @param {string} path
 * @returns {number[] | null}
 */
function readColour(path) {
    const m = /^(?:col|color)\.([a-z]+)$/.exec(path);
    if (m === null) return null;
    return CHANNEL_COLOURS[m[1]] ?? null;
}

/** Outline-box inline style for an [r,g,b] and an alpha. */
function boxStyle(rgb, alpha) {
    const a = alpha < 0 ? 0 : (alpha > 1 ? 1 : alpha);
    return `outline: 2px solid rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a}); border-radius: 2px;`;
}

/**
 * Derive the decoration set: for each fired function found in the doc
 * map, box its name (neutral grey) and every read recorded this firing.
 * A colour-signal read (`col.*` / `color.*`) is tinted by its channel,
 * brightness carrying the read value (floored at 50% so a weak read still
 * shows); other reads stay grey. All fade with the firing's opacity.
 *
 * @param {Map<string, {nameFrom: number, nameTo: number, reads: Array<{path: string, from: number, to: number}>}>} fns
 * @param {Map<string, {values: Map<string, any>, opacity: number}> | null} flashes
 * @returns {import("@codemirror/view").DecorationSet}
 */
function computeDecorations(fns, flashes) {
    if (fns.size === 0 || flashes === null || flashes.size === 0) {
        return Decoration.none;
    }
    /** @type {Array<{from: number, to: number, style: string}>} */
    const marks = [];
    for (const [name, info] of flashes) {
        const fn = fns.get(name);
        if (fn === undefined) continue;
        const opacity = (info && typeof info.opacity === "number"
            && Number.isFinite(info.opacity)) ? info.opacity : 1;
        if (opacity <= 0) continue;
        const values = (info && info.values instanceof Map)
            ? info.values : new Map();
        marks.push({
            from: fn.nameFrom, to: fn.nameTo,
            style: boxStyle(FLASH_GREY, opacity),
        });
        for (const read of fn.reads) {
            if (!values.has(read.path)) continue;
            const value = values.get(read.path);
            const colour = readColour(read.path);
            if (colour !== null && typeof value === "number") {
                const v = value < 0 ? 0 : (value > 1 ? 1 : value);
                const intensity = 0.5 + 0.5 * v;
                marks.push({
                    from: read.from, to: read.to,
                    style: boxStyle(colour, intensity * opacity),
                });
            } else {
                marks.push({
                    from: read.from, to: read.to,
                    style: boxStyle(FLASH_GREY, opacity),
                });
            }
        }
    }
    if (marks.length === 0) return Decoration.none;
    // RangeSetBuilder requires non-decreasing `from`.
    marks.sort((a, b) => a.from - b.from || a.to - b.to);
    const builder = new RangeSetBuilder();
    for (const m of marks) {
        builder.add(m.from, m.to, Decoration.mark({
            attributes: { style: m.style },
        }));
    }
    return builder.finish();
}

/**
 * Build the callback-flash highlight extension: a ViewPlugin
 * holding the function map (rebuilt on doc change) and the latest
 * flash state (set by setCallbackFlashesEffect each frame),
 * deriving its decorations from the two.
 *
 * @returns {import("@codemirror/state").Extension}
 */
export function callbackFlashHighlightExtension() {
    return ViewPlugin.fromClass(
        class {
            /**
             * @param {import("@codemirror/view").EditorView} view
             */
            constructor(view) {
                this.fns = buildFunctionMap(view);
                /** @type {Map<string, {paths: string[], opacity: number}> | null} */
                this.flashes = null;
                this.decorations = computeDecorations(this.fns, this.flashes);
            }

            /**
             * @param {import("@codemirror/view").ViewUpdate} update
             */
            update(update) {
                let fnsDirty = update.docChanged;
                let flashesChanged = false;
                for (const tr of update.transactions) {
                    for (const e of tr.effects) {
                        if (e.is(setCallbackFlashesEffect)) {
                            this.flashes = e.value;
                            flashesChanged = true;
                        }
                    }
                }
                if (fnsDirty) {
                    this.fns = buildFunctionMap(update.view);
                }
                if (fnsDirty || flashesChanged) {
                    this.decorations = computeDecorations(this.fns, this.flashes);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );
}
