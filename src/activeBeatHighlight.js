/**
 * Live active-token highlighting for the Code tab.
 *
 * Boxes the currently-sounding token of a curve's cyclePattern
 * in the behaviours.js editor as the curve's cursor sweeps,
 * mirroring the Strudel REPL's outline-the-active-event
 * behaviour. When a curve playing `s("bd sd hh")` reaches the
 * sd, the `sd` token in the source gets a white outline.
 *
 * GXW-native, index-based, no Strudel transpiler. Two inputs
 * feed one derived decoration set:
 *
 *   1. Token map (rebuilt on doc change and on a forced
 *      recompute). The doc is parsed with Acorn to find each
 *      `$objectId:` labelled block, the same walk patternHighlight
 *      uses. For a block whose pattern expression contains
 *      EXACTLY ONE string literal (the v1 scope — a simple
 *      single mini-notation string like note("c e g") or
 *      s("bd sd"), with any chained no-string modifiers), the
 *      expression is parsed via parsePatternToPositions and each
 *      in-cycle hap becomes a base beat token carrying its
 *      absolute document range plus its [begin, end) cycle
 *      position. The document range is the string literal node's
 *      start (the opening quote) plus the hap's location offsets,
 *      which the mini parser reports relative to the quoted
 *      string (0 = opening quote) — so the two line up exactly.
 *      Blocks with zero or two-plus string literals (e.g.
 *      note("...").s("piano"), stack(...)) are skipped and get
 *      no highlight; multi-string support is a later refinement.
 *
 *   2. Active beats (set every frame by the canvas via
 *      setActiveBeatsEffect). A Map<objectId, {t, repeats}>
 *      where t is the curve's cursor parameter in [0, 1) over
 *      one GXW cycle and repeats is its patternRepeats. The
 *      pattern-local fraction is (t * repeats) mod 1; the active
 *      token is the one whose [begin, end) span contains it. One
 *      token per curve; every playing curve's token lights at
 *      once. A fraction landing in a gap (a rest) lights nothing.
 *
 * The active-token timing lives entirely in this extension's own
 * parse (begin/end per token), so the canvas only has to supply
 * the cursor fraction and repeat count — there is no second
 * source of truth to keep in sync.
 *
 * Recompute timing. Token building needs the strudel engine
 * loaded (parsePatternToPositions no-ops until window.note
 * exists), so a score opened before Load Engine builds no tokens
 * until the engine arrives. main.js dispatches recomputeTokensEffect
 * on the strudel "loaded" transition and after each scene reload
 * so the map catches up; doc edits rebuild it directly.
 */

// @ts-check

import { ViewPlugin, Decoration } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { StateEffect, RangeSetBuilder } from "https://esm.sh/@codemirror/state@6.5.2";
import * as acorn from "https://esm.sh/acorn@8";
import { parsePatternToPositions } from "./strudel/patternParse.js";

/**
 * Effect carrying the per-curve active-beat state for this
 * frame: a Map<objectId, {t: number, repeats: number}> where
 * t is the cursor parameter in [0, 1) and repeats is the
 * curve's patternRepeats. Dispatched by the editor each render
 * frame during playback (via applyActiveBeats), driven by the
 * canvas. An empty map (or no dispatch) clears all boxes.
 */
export const setActiveBeatsEffect = StateEffect.define();

/**
 * Effect forcing a rebuild of the token map without a document
 * edit. Dispatched by main.js when the strudel engine finishes
 * loading and after each scene reload, since token building
 * depends on the engine being available and on the current
 * document's labelled blocks.
 */
export const recomputeTokensEffect = StateEffect.define();

/**
 * Inline style for an active beat box. Inline (rather than a CSS
 * class) for the same reason patternHighlight.js inlines its
 * badge: the editor theme's cascade can otherwise swallow an
 * author rule. A white outline matches the REPL's box on the
 * dark theme Chris runs.
 */
const ACTIVE_BEAT_STYLE = "outline: 2px solid #ffffff; border-radius: 2px;";

/**
 * Diagnostic: warn once per token build if a block produced
 * in-cycle haps but none carried a source location. That is the
 * signature of the one empirical risk for this feature — a
 * strudel build whose mini parser does not attach
 * context.locations — and it manifests only as "no boxes ever",
 * which is otherwise hard to tell apart from a wiring fault.
 * Flip to false once locations are confirmed present.
 */
const LOG_MISSING_LOC = true;

/**
 * Recursively collect every string-literal node within an AST
 * node into `out`. Used to count the string literals in a
 * block's pattern expression: v1 highlights only blocks with
 * exactly one (an unambiguous single mini-notation string).
 * Template literals are not collected — uncommon in patterns and
 * out of v1 scope.
 *
 * @param {any} node
 * @param {any[]} out
 */
function collectStringLiterals(node, out) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const child of node) collectStringLiterals(child, out);
        return;
    }
    if (typeof node.type !== "string") return;
    if (node.type === "Literal" && typeof node.value === "string") {
        out.push(node);
    }
    for (const key in node) {
        if (key === "type" || key === "start" || key === "end"
            || key === "loc" || key === "range") continue;
        const child = node[key];
        if (child !== null && typeof child === "object") {
            collectStringLiterals(child, out);
        }
    }
}

/**
 * Build the ordered base beat tokens for one block's pattern
 * expression. exprText is the expression source; strNodeStart is
 * the absolute document offset of the single string literal's
 * opening quote. Returns [] when the engine isn't loaded, the
 * expression fails to parse, or no located in-cycle haps exist.
 *
 * @param {string} exprText
 * @param {number} strNodeStart
 * @returns {Array<{from: number, to: number, begin: number, end: number}>}
 */
function buildBlockTokens(exprText, strNodeStart) {
    const result = parsePatternToPositions(exprText);
    if (!result.ok || !Array.isArray(result.haps)) return [];
    const inCycle = result.haps.filter((h) => h.begin >= 0 && h.begin < 1);
    const located = inCycle
        .filter((h) => h.loc !== null)
        .sort((a, b) => a.begin - b.begin);
    if (located.length === 0) {
        if (LOG_MISSING_LOC && inCycle.length > 0) {
            console.warn(
                "[activeBeatHighlight] block produced " + inCycle.length +
                " in-cycle events but none carried a source location; " +
                "no boxes will show. (strudel build may not attach " +
                "hap.context.locations.)",
            );
        }
        return [];
    }
    /** @type {Array<{from: number, to: number, begin: number, end: number}>} */
    const out = [];
    for (const h of located) {
        const from = strNodeStart + h.loc.start;
        const to = strNodeStart + h.loc.end;
        if (to <= from) continue;
        out.push({ from, to, begin: h.begin, end: h.end });
    }
    return out;
}

/**
 * Parse the whole editor document and build the token map:
 * Map<objectId, orderedBaseTokens>. Walks top-level labelled
 * statements (including chained $A: $B: ... labels, all bound to
 * the same expression) and only keeps blocks whose expression
 * has exactly one string literal.
 *
 * @param {import("@codemirror/view").EditorView} view
 * @returns {Map<string, Array<{from: number, to: number, begin: number, end: number}>>}
 */
function buildTokenMap(view) {
    /** @type {Map<string, Array<{from: number, to: number, begin: number, end: number}>>} */
    const tokens = new Map();
    const source = view.state.doc.toString();
    let ast;
    try {
        ast = acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
            locations: false,
        });
    } catch (err) {
        // Whole-file syntax error: no tokens until it parses.
        return tokens;
    }
    if (ast === null || !Array.isArray(ast.body)) return tokens;
    for (const node of ast.body) {
        if (node.type !== "LabeledStatement") continue;
        // Walk the label chain inward, collecting every $-prefixed
        // object id; they all bind to the same innermost expression.
        /** @type {string[]} */
        const ids = [];
        let current = node;
        while (current !== null && typeof current === "object"
            && current.type === "LabeledStatement") {
            const label = current.label;
            if (label !== null && label.type === "Identifier"
                && typeof label.name === "string" && label.name.startsWith("$")) {
                ids.push(label.name.slice(1));
            }
            current = current.body;
        }
        if (ids.length === 0) continue;
        if (current === null || current.type !== "ExpressionStatement"
            || !current.expression) continue;
        const exprNode = current.expression;
        /** @type {any[]} */
        const strings = [];
        collectStringLiterals(exprNode, strings);
        if (strings.length !== 1) continue; // v1: single-string only.
        const exprText = source.slice(exprNode.start, exprNode.end);
        const arr = buildBlockTokens(exprText, strings[0].start);
        if (arr.length === 0) continue;
        for (const id of ids) tokens.set(id, arr);
    }
    return tokens;
}

/**
 * Derive the decoration set: for each curve in the active-beats
 * map, find its active base token (the one whose [begin, end)
 * span contains the pattern-local fraction) and outline its
 * document range.
 *
 * @param {Map<string, Array<{from: number, to: number, begin: number, end: number}>>} tokens
 * @param {Map<string, {t: number, repeats: number}> | null} activeBeats
 * @returns {import("@codemirror/view").DecorationSet}
 */
function computeDecorations(tokens, activeBeats) {
    if (tokens.size === 0 || activeBeats === null || activeBeats.size === 0) {
        return Decoration.none;
    }
    /** @type {Array<{from: number, to: number}>} */
    const marks = [];
    for (const [objectId, info] of activeBeats) {
        const arr = tokens.get(objectId);
        if (arr === undefined || arr.length === 0) continue;
        const repeats = (info && typeof info.repeats === "number"
            && info.repeats >= 1) ? info.repeats : 1;
        const t = (info && typeof info.t === "number"
            && Number.isFinite(info.t)) ? info.t : 0;
        let frac = (t * repeats) % 1;
        if (frac < 0) frac += 1;
        for (const tok of arr) {
            if (frac >= tok.begin && frac < tok.end) {
                marks.push({ from: tok.from, to: tok.to });
                break;
            }
        }
    }
    if (marks.length === 0) return Decoration.none;
    // RangeSetBuilder requires non-decreasing `from`.
    marks.sort((a, b) => a.from - b.from);
    const builder = new RangeSetBuilder();
    for (const m of marks) {
        builder.add(m.from, m.to, Decoration.mark({
            attributes: { style: ACTIVE_BEAT_STYLE },
        }));
    }
    return builder.finish();
}

/**
 * Build the active-beat highlight extension: a ViewPlugin
 * holding the token map (rebuilt on doc change or
 * recomputeTokensEffect) and the latest active-beats map (set by
 * setActiveBeatsEffect each frame), deriving its decorations
 * from the two.
 *
 * @returns {import("@codemirror/state").Extension}
 */
export function activeBeatHighlightExtension() {
    return ViewPlugin.fromClass(
        class {
            /**
             * @param {import("@codemirror/view").EditorView} view
             */
            constructor(view) {
                this.tokens = buildTokenMap(view);
                /** @type {Map<string, {t: number, repeats: number}> | null} */
                this.activeBeats = null;
                this.decorations = computeDecorations(this.tokens, this.activeBeats);
            }

            /**
             * @param {import("@codemirror/view").ViewUpdate} update
             */
            update(update) {
                let tokensDirty = update.docChanged;
                let activeChanged = false;
                for (const tr of update.transactions) {
                    for (const e of tr.effects) {
                        if (e.is(recomputeTokensEffect)) {
                            tokensDirty = true;
                        } else if (e.is(setActiveBeatsEffect)) {
                            this.activeBeats = e.value;
                            activeChanged = true;
                        }
                    }
                }
                if (tokensDirty) {
                    this.tokens = buildTokenMap(update.view);
                }
                if (tokensDirty || activeChanged) {
                    this.decorations = computeDecorations(this.tokens, this.activeBeats);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );
}
