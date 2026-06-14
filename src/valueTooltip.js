// @ts-check

/**
 * Live value tooltip for the Script tab (GeoSonixV2).
 *
 * Hover a `this.*` expression in a callback (or select an expression
 * and hover the selection) and a tooltip shows its current evaluated
 * value, refreshed as the simulation plays — the value the expression
 * had the last time that callback fired. Moving on / a new firing
 * updates it. Nothing shows when:
 *   - the callback hasn't fired since the last rewind (no context),
 *   - the hovered/selected text isn't a complete, parseable expression,
 *   - evaluating it throws (references something not in the context),
 *   - or it CALLS a side-effecting function (playNote / playSound /
 *     applyForce / print) — we will not fire a note just to inspect.
 *     Pure calls (Math.sin, a mapping function, …) are fine.
 *
 * The expression is evaluated with `this` bound to the cached firing
 * context (Simulation.lastContextForFunction), so `this.col.r`,
 * `this.vel`, `this.col.r * 127`, `Math.sin(this.beat)` all work.
 */

import { hoverTooltip } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { syntaxTree } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";
import * as acorn from "https://esm.sh/acorn@8";

/** Functions whose calls must never be evaluated — they have side effects. */
const BLOCKED_CALLS = new Set([
    "playNote", "playSound", "applyForce", "print", "nxtNote",
]);

/**
 * Walk an acorn AST, visiting every node.
 * @param {any} node
 * @param {(n: any) => void} visit
 */
function walkAst(node, visit) {
    if (node === null || typeof node !== "object" || typeof node.type !== "string") return;
    visit(node);
    for (const key in node) {
        if (key === "type" || key === "start" || key === "end") continue;
        const v = node[key];
        if (Array.isArray(v)) {
            for (const c of v) walkAst(c, visit);
        } else if (v !== null && typeof v === "object" && typeof v.type === "string") {
            walkAst(v, visit);
        }
    }
}

/**
 * Parse the expression and report whether it's a complete expression
 * and whether it calls any blocked (side-effecting) function — bare
 * `playNote(...)` or `this.playNote(...)` / `x.playNote(...)`.
 * @param {string} text
 * @returns {{ ok: boolean }}
 */
function exprIsInspectable(text) {
    let ast;
    try {
        ast = acorn.parseExpressionAt(text, 0, { ecmaVersion: 2022 });
    } catch (_e) {
        return { ok: false };
    }
    // parseExpressionAt stops at the first complete expression; if the
    // selection had trailing tokens it isn't a single clean expression.
    if (ast.end < text.trim().length) {
        // Allow trailing whitespace only.
        if (text.slice(ast.end).trim() !== "") return { ok: false };
    }
    let blocked = false;
    walkAst(ast, (n) => {
        if (n.type !== "CallExpression") return;
        const callee = n.callee;
        let name = null;
        if (callee.type === "Identifier") name = callee.name;
        else if (callee.type === "MemberExpression"
            && callee.property && callee.property.type === "Identifier") {
            name = callee.property.name;
        }
        if (name !== null && BLOCKED_CALLS.has(name)) blocked = true;
    });
    return { ok: !blocked };
}

/**
 * Compile an expression into an evaluator bound to a firing context.
 * The blocked function names are passed as throwing stubs so even a
 * bare call the AST check somehow missed can't fire. Returns null if
 * the expression won't compile.
 * @param {string} text
 * @returns {((ctx: any) => any) | null}
 */
function compileEvaluator(text) {
    let fn;
    try {
        // eslint-disable-next-line no-new-func
        fn = new Function(
            "playNote", "playSound", "applyForce", "print",
            "return (" + text + ");",
        );
    } catch (_e) {
        return null;
    }
    const stub = () => { throw new Error("side-effecting call blocked in tooltip"); };
    return (ctx) => fn.call(ctx, stub, stub, stub, stub);
}

/**
 * Format an evaluated value for the tooltip.
 * @param {any} v
 */
function formatValue(v) {
    if (typeof v === "number") {
        return Number.isInteger(v) ? String(v) : v.toFixed(3);
    }
    if (typeof v === "string") return JSON.stringify(v);
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "function") return "[function]";
    if (typeof v === "object") {
        try { return JSON.stringify(v); } catch (_e) { return String(v); }
    }
    return String(v);
}

/**
 * Find the name of the function declaration enclosing `pos`, or null.
 * @param {any} state
 * @param {number} pos
 * @returns {string | null}
 */
function enclosingFunctionName(state, pos) {
    let node = syntaxTree(state).resolveInner(pos, -1);
    while (node !== null && node.name !== "FunctionDeclaration") {
        node = node.parent;
    }
    if (node === null) return null;
    let child = node.firstChild;
    while (child !== null) {
        if (child.name === "VariableDefinition") {
            return state.sliceDoc(child.from, child.to);
        }
        child = child.nextSibling;
    }
    return null;
}

/**
 * The expression range to inspect at `pos`: the active selection when
 * `pos` falls inside it, otherwise the full member expression /
 * identifier under the pointer (so hovering any part of `this.col.r`
 * resolves the whole thing). Returns null when there's nothing
 * expression-like there.
 * @param {any} state
 * @param {number} pos
 * @returns {{ from: number, to: number, text: string } | null}
 */
function expressionRangeAt(state, pos) {
    const sel = state.selection.main;
    if (!sel.empty && pos >= sel.from && pos <= sel.to) {
        return { from: sel.from, to: sel.to, text: state.sliceDoc(sel.from, sel.to) };
    }
    let node = syntaxTree(state).resolveInner(pos, -1);
    // Climb out of the member chain to the outermost MemberExpression.
    while (node.parent !== null && node.parent.name === "MemberExpression") {
        node = node.parent;
    }
    if (node.name !== "MemberExpression"
        && node.name !== "VariableName"
        && node.name !== "this"
        && node.name !== "PropertyName") {
        return null;
    }
    return { from: node.from, to: node.to, text: state.sliceDoc(node.from, node.to) };
}

/**
 * Compute the user's current focus in the Script editor: the deictic
 * "this" pointer for an AI working through the composition mirror. The
 * user places the text cursor on the code they mean (they can't hover
 * the canvas while typing in Claude Desktop) and refers to it. We
 * report the enclosing callback function, the expression/identifier
 * under the caret, the selected text if any, and the caret's line and
 * column, so an AI can resolve "this" without a screenshot.
 *
 * Returns null when there's nothing meaningful to report (empty doc /
 * caret on blank space outside any function). The caller writes the
 * result to focus.json.
 *
 * @param {any} state CodeMirror EditorState
 * @returns {{
 *   function: string | null,
 *   expression: string | null,
 *   selection: string | null,
 *   caret: { line: number, column: number, offset: number },
 *   lineText: string,
 *   range: { from: number, to: number } | null
 * } | null}
 */
export function computeScriptFocus(state) {
    const sel = state.selection.main;
    const head = sel.head;
    if (state.doc.length === 0) return null;
    const line = state.doc.lineAt(head);
    const fnName = enclosingFunctionName(state, head);
    const range = expressionRangeAt(state, head);
    const hasSelection = !sel.empty;

    // Nothing worth reporting: caret is outside any callback and there's
    // no expression under it and no selection.
    if (fnName === null && range === null && !hasSelection) return null;

    return {
        function: fnName,
        expression: range !== null ? range.text : null,
        selection: hasSelection ? state.sliceDoc(sel.from, sel.to) : null,
        caret: {
            line: line.number,
            column: head - line.from + 1,
            offset: head,
        },
        lineText: line.text,
        range: range !== null ? { from: range.from, to: range.to } : null,
    };
}

/**
 * Build the live-value hover tooltip extension.
 * @param {{ getSimulation: () => any, isCodeTab: () => boolean }} opts
 */
export function valueTooltipExtension({ getSimulation, isCodeTab }) {
    return hoverTooltip((view, pos) => {
        if (!isCodeTab()) return null;
        const range = expressionRangeAt(view.state, pos);
        if (range === null || range.text.trim() === "") return null;
        const fnName = enclosingFunctionName(view.state, pos);
        if (fnName === null) return null;
        if (!exprIsInspectable(range.text).ok) return null;
        const evaluate = compileEvaluator(range.text);
        if (evaluate === null) return null;

        // Evaluate once against the current cached context; show nothing
        // until the callback has fired at least once (no context yet).
        const tryEval = () => {
            const sim = getSimulation();
            const ctx = sim !== null ? sim.lastContextForFunction(fnName) : null;
            if (ctx === null) return null;
            try {
                return { value: evaluate(ctx) };
            } catch (_e) {
                return null;
            }
        };
        if (tryEval() === null) return null;

        return {
            // Anchor at the hovered document position; rendered BELOW
            // it, left-aligned, so the tooltip's upper-left corner sits
            // just below the cursor.
            pos,
            above: false,
            create() {
                const dom = document.createElement("div");
                dom.className = "gxw-value-tooltip";
                let raf = 0;
                const render = () => {
                    const r = tryEval();
                    dom.textContent = r === null ? "—" : formatValue(r.value);
                };
                const loop = () => { render(); raf = requestAnimationFrame(loop); };
                render();
                raf = requestAnimationFrame(loop);
                return {
                    dom,
                    destroy() { if (raf !== 0) cancelAnimationFrame(raf); },
                };
            },
        };
    }, { hoverTime: 250 });
}
