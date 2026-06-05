// @ts-check

/**
 * Enclosing-parenthesis highlighting for the Code tab.
 *
 * An accessibility aid (for Chris: limited eyesight, macOS Zoom +
 * Speak Selection): make a Strudel pattern's nesting structure
 * easy to perceive without visually tracing where long, wrapped
 * expressions open and close. Always on, independent of the
 * speak-on-hover toggle.
 *
 * For each of two reference points — the text CARET and the MOUSE
 * POINTER over the code — it finds the INNERMOST parenthesis pair
 * that ENCLOSES that point (the pair "one level up": the open paren
 * is before the point and its matching close paren is after it, so
 * the caret anywhere inside a function's argument list lights that
 * function's parens). The two reference points are independent, so
 * when the caret and the pointer fall inside different pairs BOTH
 * pairs light at once.
 *
 * Rendering:
 *   - Both paren GLYPHS of each enclosing pair are drawn in white.
 *   - The MOUSE pair additionally gets its enclosed span lightly
 *     shaded, so the extent of the hovered range stays visible even
 *     when its closing paren has soft-wrapped off-screen. (The
 *     caret pair is glyphs-only, to avoid a persistent shaded block
 *     wherever the caret happens to sit.)
 *
 * The pair is found through the Lezer syntax tree (paren-delimited
 * nodes — ArgList, ParenthesizedExpression, ParamList, etc., all of
 * which open with a "(" token and close with a ")" token), so
 * parentheses inside string literals or comments are correctly
 * ignored. Recomputed on caret move, document change, and pointer
 * move; pointer moves are coalesced to one dispatch per animation
 * frame so the handler stays cheap.
 *
 * Colours are kept subtle here so the white parens and the faint
 * span read clearly against the existing active-token outline and
 * beat-highlight decorations rather than competing with them.
 */

import { EditorView, Decoration, ViewPlugin } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { StateField, StateEffect } from "https://esm.sh/@codemirror/state@6.5.2";
import { syntaxTree } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";

/**
 * Effect carrying the latest document offset under the pointer
 * (or null when the pointer isn't over document content). The
 * pointer tracker dispatches it, coalesced to one per frame.
 */
const setPointerOffset = StateEffect.define();

/**
 * State field holding the current pointer offset. Mapped through
 * document changes so it stays valid between pointer moves.
 * @type {StateField<number | null>}
 */
const pointerOffsetField = StateField.define({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) {
            if (e.is(setPointerOffset)) return e.value;
        }
        if (value !== null && tr.docChanged) {
            return tr.changes.mapPos(value, -1);
        }
        return value;
    },
});

const parenGlyphMark = Decoration.mark({ class: "cm-enclosing-paren" });
const parenSpanMark = Decoration.mark({ class: "cm-enclosing-paren-span" });

/**
 * The "(" / ")" glyph positions of a paren-delimited node (ArgList,
 * ParenthesizedExpression, ParamList, ...), or null if the node
 * isn't wrapped in a paren pair. Detected by the node's actual
 * first and last characters rather than child token names —
 * Lezer's JavaScript tree does not surface the "(" / ")"
 * punctuation as child nodes, but a paren-delimited node's span
 * still starts at "(" and ends at ")" by the grammar.
 * @param {any} node
 * @param {import("https://esm.sh/@codemirror/state@6.5.2").Text} doc
 * @returns {{openPos: number, closePos: number} | null}
 */
function parenPairOfNode(node, doc) {
    if (node.to - node.from < 2) return null;
    if (doc.sliceString(node.from, node.from + 1) === "(" &&
        doc.sliceString(node.to - 1, node.to) === ")") {
        return { openPos: node.from, closePos: node.to - 1 };
    }
    return null;
}

/**
 * The paren pair to highlight for a reference point.
 *
 * Two cases, so that hovering or placing the point ANYWHERE on a
 * call lights that call's own argument region:
 *
 *   - On the function NAME (the callee of a CallExpression): use
 *     that call's own ArgList parens, so hovering a function lights
 *     its parameter region (its "(...)"), even for the outermost
 *     call where the name itself sits inside no parens.
 *   - Otherwise: the INNERMOST paren pair that ENCLOSES the point
 *     (open paren before it, close paren at/after it) — the point
 *     inside an argument list lights that list's parens.
 *
 * Found through the Lezer tree, so parens in strings/comments are
 * ignored. Returns { openPos, closePos } (the two glyph positions)
 * or null when the point is on no relevant pair.
 *
 * @param {import("https://esm.sh/@codemirror/state@6.5.2").EditorState} state
 * @param {number | null} offset
 * @returns {{openPos: number, closePos: number} | null}
 */
function pairForOffset(state, offset) {
    if (offset === null) return null;
    const doc = state.doc;
    const tree = syntaxTree(state);
    /** @type {any} */
    const node = tree.resolveInner(offset, 0);

    // Callee case: walk up to the nearest CallExpression and, if the
    // point is within its callee (on the function name / member
    // chain, not in its ArgList), light that call's ArgList.
    for (let n = node; n !== null; n = n.parent) {
        if (n.name === "CallExpression") {
            const callee = n.firstChild;
            if (callee !== null && offset >= callee.from && offset <= callee.to) {
                for (let c = n.firstChild; c !== null; c = c.nextSibling) {
                    if (c.name === "ArgList") {
                        const pair = parenPairOfNode(c, doc);
                        if (pair !== null) return pair;
                    }
                }
            }
            break;
        }
    }

    // Enclosing case: innermost paren-delimited ancestor that
    // strictly contains the point (past the open paren, at or before
    // the close paren — not sitting on the opening glyph, which
    // belongs to the pair one level out).
    for (let n = node; n !== null; n = n.parent) {
        const pair = parenPairOfNode(n, doc);
        if (pair !== null && pair.openPos < offset && offset <= pair.closePos) {
            return pair;
        }
    }
    return null;
}

/**
 * Build the decoration set for the current caret + pointer pairs.
 * White glyphs on both pairs (deduplicated when they coincide);
 * a light span over the mouse pair's enclosed range.
 * @param {EditorView} view
 * @returns {import("https://esm.sh/@codemirror/view@6").DecorationSet}
 */
function computeDecorations(view) {
    const state = view.state;
    const caretPair = pairForOffset(state, state.selection.main.head);
    const mousePair = pairForOffset(state, state.field(pointerOffsetField));

    /** @type {Array<any>} */
    const decos = [];
    // Background shade over the text BETWEEN each enclosing pair's
    // parens (the interior, not the parens themselves), so the
    // extent of the enclosing scope reads at a glance even when its
    // close paren has soft-wrapped off-screen. Deliberately does NOT
    // include the paren glyphs: that keeps the span from overlapping
    // the white-glyph marks at the same positions (overlapping marks
    // render unreliably) and matches "the text between the parens".
    // Deduplicated by open position so coinciding caret/mouse pairs
    // don't double-shade.
    const spanned = new Set();
    for (const pair of [caretPair, mousePair]) {
        if (pair === null || spanned.has(pair.openPos)) continue;
        spanned.add(pair.openPos);
        const innerFrom = pair.openPos + 1;
        const innerTo = pair.closePos;
        if (innerTo > innerFrom) {
            decos.push(parenSpanMark.range(innerFrom, innerTo));
        }
    }
    const seen = new Set();
    for (const pair of [caretPair, mousePair]) {
        if (pair === null) continue;
        for (const pos of [pair.openPos, pair.closePos]) {
            if (seen.has(pos)) continue;
            seen.add(pos);
            decos.push(parenGlyphMark.range(pos, pos + 1));
        }
    }
    // sort=true: the span and glyph marks share start positions, so
    // let CodeMirror order them rather than hand-sorting.
    return Decoration.set(decos, true);
}

const parenHighlightPlugin = ViewPlugin.fromClass(
    class {
        /** @param {EditorView} view */
        constructor(view) {
            this.decorations = computeDecorations(view);
        }
        /** @param {import("https://esm.sh/@codemirror/view@6").ViewUpdate} update */
        update(update) {
            const pointerChanged = update.transactions.some((tr) =>
                tr.effects.some((e) => e.is(setPointerOffset)));
            if (update.docChanged || update.selectionSet || update.viewportChanged || pointerChanged) {
                this.decorations = computeDecorations(update.view);
            }
        }
    },
    { decorations: (v) => v.decorations },
);

/**
 * Pointer tracker: maps each mousemove to a document offset and
 * dispatches it, coalesced to one dispatch per animation frame so
 * a fast drag doesn't flood the update cycle. A move off the
 * document content (below the last line, past the right edge) is
 * reported as null so the mouse pair clears.
 */
function pointerTracker() {
    /** @type {number | null} */
    let pendingOffset = null;
    let havePending = false;
    let rafId = 0;

    return EditorView.domEventHandlers({
        mousemove(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            pendingOffset = pos;
            havePending = true;
            if (rafId !== 0) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (!havePending) return;
                havePending = false;
                if (view.state.field(pointerOffsetField, false) === pendingOffset) return;
                view.dispatch({ effects: setPointerOffset.of(pendingOffset) });
            });
        },
        mouseleave(_event, view) {
            if (view.state.field(pointerOffsetField, false) === null) return;
            view.dispatch({ effects: setPointerOffset.of(null) });
        },
    });
}

const parenHighlightTheme = EditorView.theme({
    // The two enclosing-paren glyphs: white and bold so they stand
    // out against the syntax colours and the white active-token
    // outline without being mistaken for it (that one is an outline
    // box around a token; this is just brighter, heavier paren
    // characters).
    ".cm-enclosing-paren": {
        color: "#ffffff",
        fontWeight: "bold",
    },
    // Background shade over the text between an enclosing pair's
    // parens. Distinctly different from the dark editor background
    // so the range reads at a glance; where the caret and mouse
    // pairs nest, the two overlap into a stronger shade (the deeper
    // level). A background wash on the text, not a restyle of it.
    ".cm-enclosing-paren-span": {
        backgroundColor: "rgba(80, 130, 200, 0.35)",
    },
});

/**
 * The enclosing-paren highlight extension. Add to the Code
 * editor's extension list.
 * @returns {Array<any>}
 */
export function parenHighlightExtension() {
    return [
        pointerOffsetField,
        parenHighlightPlugin,
        pointerTracker(),
        parenHighlightTheme,
    ];
}
