/**
 * Semantic Code Speech Layer.
 *
 * CodeMirror extension that lets the user point the mouse
 * at a line of code and press a keyboard shortcut to hear
 * a compressed semantic reading of that line while the
 * corresponding source regions highlight in the editor.
 * The extension is an accessibility provision for low-
 * vision developers; full design lives in Section 31 of
 * DESIGN.md. v0.1 scope is the Code tab in GXW only,
 * reading behaviors.js for the active score.
 *
 * Commit 1 lands the scaffold: a CodeMirror extension
 * wired into the Code tab, a single keyboard shortcut
 * bound (Mod-Shift-'), the pointer position tracked across
 * the editor surface and mapped to a document position via
 * posAtCoords, the Lezer tree walked from that position up
 * to the enclosing ExpressionStatement, and the matched
 * text plus source range logged to the browser console.
 *
 * Commit 2 adds speech wiring. The matched statement text
 * is piped through the browser SpeechSynthesis API on
 * every successful match, with speechSynthesis.cancel()
 * called ahead of every speak() so a fresh shortcut press
 * interrupts any utterance still in flight from a previous
 * press.
 *
 * Commit 3 adds the walker, chunk queue, and synchronised
 * highlights for the four core syntactic forms. The walker
 * traverses a Lezer SyntaxNode tree recursively and emits
 * chunks per form: a CallExpression emits chunks for its
 * callee followed by chunks for each argument; a
 * MemberExpression emits a single chunk with the full
 * member-access source text; an identifier emits one chunk;
 * a literal emits one chunk. Anything the walker doesn't
 * recognise falls back to a single raw-text chunk so output
 * is always non-empty for a valid statement. Each chunk
 * carries the text to speak plus an array of source ranges
 * to highlight while that text is being read.
 *
 * Commit 3a adds method-chain unfolding and
 * LabeledStatement support. The MemberExpression case
 * checks whether its object is itself a CallExpression; if
 * so, it recurses into the object first and then emits just
 * the property name as its own chunk, so a chained
 * expression like note("c4").gain(0.5).fast(2) reads
 * left-to-right as discrete chunks (note, "c4", gain, 0.5,
 * fast, 2) instead of as one big nested blob. Non-chain
 * MemberExpressions (the object is a simple identifier or
 * another MemberExpression with no call inside) still emit
 * a single chunk for the full member-access text, so
 * property-access chains like pxLt.range read naturally as
 * one unit. The enclosing-statement finder now also accepts
 * LabeledStatement, both when the pointer is on the label
 * itself (where the cursor walk never reaches an
 * ExpressionStatement) and when the ExpressionStatement it
 * finds is the body of a LabeledStatement (where the
 * LabeledStatement is preferred so the label is read). A
 * new LabeledStatement walker case emits the label name as
 * a leading chunk and then walks the body. A new
 * ExpressionStatement walker case (reached indirectly
 * through LabeledStatement, since the finder still digs
 * into ExpressionStatement directly when it's the chosen
 * enclosing node) walks the inner expression. The result
 * is that pointer-on-label and pointer-on-body of a
 * labelled pattern statement read the same chunks in the
 * same order: label first, then expression chunks.
 *
 * Commit 4 (this commit) adds walker cases for the
 * remaining core syntactic forms listed in the design's
 * build phasing: AssignmentExpression, BinaryExpression,
 * ConditionalExpression (ternary), ReturnStatement,
 * ArrowFunction, and ObjectExpression. A Property case
 * is added as a helper for ObjectExpression, and a
 * ParenthesizedExpression case is folded in as a quality-
 * of-life addition so a parenthesised sub-expression
 * inside one of the new forms walks its inner expression
 * instead of falling to the raw-text default. Operators
 * are spoken as words via a small OPERATOR_WORDS map
 * covering the common arithmetic, comparison, logical, and
 * assignment operators; the full operator speech table
 * arrives in Commit 6. Synthesized keyword chunks (the
 * "if" of a ternary, the "function" of an arrow function,
 * the "object" of an object literal) carry a
 * keepHighlight: true flag that tells playChunks to skip
 * the highlight dispatch for that chunk, so the previous
 * chunk's highlight stays in place during the keyword
 * reading rather than the highlight flashing off and on.
 * Keyword chunks that DO have a natural source anchor
 * (the "then" / "else" of a ternary anchored to the "?"
 * and ":" tokens, the "yields" of an arrow function
 * anchored to the "=>" token, the "is" of an object
 * property anchored to the ":" token) use that anchor's
 * range so the highlight moves to the punctuation while
 * the keyword is read. The enclosing-statement finder
 * also now accepts ReturnStatement so a return line read
 * directly (e.g. inside an arrow function with a block
 * body) reads just the return rather than walking up to
 * the outer enclosing statement.
 *
 * VariableDeclaration is not in Commit 4's scope; a line
 * like const x = 5 will still hit the no-match diagnostic.
 * If that pattern is common in real behaviors.js code, a
 * follow-up commit can add it. Block bodies in arrow
 * functions also still fall to raw-text default since
 * Block isn't handled; concise arrow function bodies (the
 * common case in behaviors.js) work correctly.
 *
 * Commit 5 (this commit) adds four user-visible
 * affordances. (1) A CodeMirror hover tooltip surfaces
 * parameter names for known functions: hovering on an
 * argument shows the parameter name for that argument;
 * hovering on the callee identifier shows the full
 * one-line signature with the function name. Tooltip
 * content is sourced from src/codeSpeechSignatures.js, a Claude-maintained
 * file mapping function names to ordered arrays of
 * parameter names. The lookup key is the rightmost
 * identifier of the callee, so plain calls and method
 * calls share the dispatch. Functions without an entry
 * surface no tooltip and read unchanged. (2) Escape
 * stops speech and clears the highlight when speech is
 * in flight; when speech is not playing, Escape falls
 * through to whatever else handles it (closing
 * completion popups, etc.). (3) Spacebar toggles
 * pause/resume during playback, gated on speech being
 * active or paused so when speech isn't playing
 * Spacebar types a space normally in the editor. The
 * highlight stays in place while paused so the user
 * sees where they stopped. (4) Reading starts from the
 * pointer position rather than always at the beginning
 * of the enclosing statement. The walker still produces
 * the full chunk queue for the enclosing statement,
 * but readEnclosingStatement skips chunks whose source
 * range ends before the pointer before handing the
 * queue to playChunks. Pointing at the start of a
 * statement still produces the full reading; pointing
 * deeper skips ahead. Synthesized keyword chunks
 * ("if", "function", "object") that fall before the
 * start index are skipped along with their content,
 * but ones that fall after are kept so e.g. "then" /
 * "else" still appear when the start lands inside a
 * ternary's consequent.
 *
 * Highlights live in a CodeMirror StateField holding a
 * DecorationSet of mark decorations. A StateEffect updates
 * the field with the active chunk's ranges; an empty
 * ranges array clears the highlight. The theme rule for
 * the highlight is a placeholder (saturated yellow
 * background, black text, white outline) intended for
 * Commit 7 to refine into the production look under
 * macOS Zoom magnification and dark mode.
 *
 * Playback walks the chunk queue sequentially. For each
 * chunk: dispatch the highlight effect, create a
 * SpeechSynthesisUtterance, set its onend handler to
 * advance to the next chunk, and call speak. A
 * monotonically increasing generation counter guards
 * against cancel races: when a fresh shortcut press
 * starts a new queue it bumps the counter, and any
 * onend handler from a previous queue checks the counter
 * against its captured generation before advancing, so a
 * cancelled-then-fired onend can't drive a stale queue.
 * Commit 8 adds further interruption-robustness work
 * (voiceschanged listener, rapid-trigger stutter
 * mitigation).
 *
 * Subsequent commits land the full pronunciation
 * dictionary and operator speech table, the highlight
 * visual styling pass, and the remaining SpeechSynthesis
 * interruption robustness work.
 *
 * The extension factory codeSpeechExtension takes an
 * isCodeTab callback that returns true iff the active tab
 * is the Code tab. The keymap command checks isCodeTab at
 * the top and returns false on non-Code tabs so the
 * keystroke falls through cleanly. The factory pattern
 * keeps the speech layer decoupled from the TabbedEditor
 * class — the speech module knows nothing about tabs or
 * bundles, only that some external state decides whether
 * its shortcut should fire.
 */

// @ts-check

import { EditorView, keymap, Decoration, hoverTooltip } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { StateField, StateEffect } from "https://esm.sh/@codemirror/state@6.5.2";
import { syntaxTree } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";
import { FUNCTION_SIGNATURES } from "./codeSpeechSignatures.js";

/**
 * StateEffect carrying the array of [from, to] tuples that
 * should be highlighted as the active chunk's spoken
 * regions. An empty array clears the highlight; a non-
 * empty array replaces whatever was previously
 * highlighted.
 *
 * The effect value type is intentionally simple (plain
 * tuples) so callers outside this module don't need to
 * import CodeMirror types to build it. The state field
 * below converts the tuples into mark decorations at
 * apply time.
 */
const setCodeSpeechHighlight = StateEffect.define();

/**
 * The mark decoration used for every highlighted range.
 * All ranges in a chunk share this single decoration
 * instance, which means CodeMirror renders them with
 * identical styling and the user reads multi-range
 * chunks (introduced in Commit 5 with JSDoc annotations)
 * as a visual group.
 */
const codeSpeechHighlightMark = Decoration.mark({
    class: "cm-codeSpeechHighlight",
});

/**
 * StateField holding the current highlight as a
 * DecorationSet. Update path: on every transaction, map
 * the existing set through the changes (so a concurrent
 * edit doesn't shear the highlight off its anchor), then
 * scan effects for setCodeSpeechHighlight. The last
 * matching effect wins, so a transaction carrying both
 * a clear and a set ends in the set state.
 *
 * Ranges are sorted by from position before being passed
 * to Decoration.set, which requires sorted input. For
 * Commit 3 the ranges in any one chunk are always a
 * single entry, so sorting is effectively a no-op; for
 * Commit 5 and later when grouped ranges arrive
 * (input range, output range as multi-range chunks), the
 * sort matters.
 */
const codeSpeechHighlightField = StateField.define({
    create() {
        return Decoration.none;
    },
    update(value, tr) {
        value = value.map(tr.changes);
        for (const effect of tr.effects) {
            if (effect.is(setCodeSpeechHighlight)) {
                const ranges = effect.value;
                if (!Array.isArray(ranges) || ranges.length === 0) {
                    value = Decoration.none;
                } else {
                    const sorted = ranges.slice().sort(
                        (a, b) => a[0] - b[0],
                    );
                    const decos = sorted.map(
                        ([from, to]) => codeSpeechHighlightMark.range(from, to),
                    );
                    value = Decoration.set(decos);
                }
            }
        }
        return value;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/**
 * Theme rule for the highlight. Placeholder styling
 * intended for Commit 7 to refine: a saturated yellow
 * background carries the eye to the active chunk under
 * macOS Zoom magnification, black text rides on top for
 * legibility against the yellow regardless of the
 * underlying syntax-highlight colour, and a white
 * outline edges each range crisply so the boundary is
 * unambiguous against the dark editor background. The
 * outline is used rather than a border so adding it
 * doesn't shift the surrounding text's layout.
 */
const codeSpeechHighlightTheme = EditorView.theme({
    ".cm-codeSpeechHighlight": {
        backgroundColor: "#ffd000",
        color: "#000",
        outline: "2px solid #ffffff",
        borderRadius: "2px",
    },
    // Parameter-tooltip styling. Targets the inner div
    // created by the paramTooltip factory; the outer
    // cm-tooltip wrapper CodeMirror provides handles
    // positioning. Sizing is generous because the
    // composer reads under macOS Zoom magnification;
    // colours are high contrast against the editor's
    // dark theme. user-select is text so Apple Speak
    // Selection can be triggered on the tooltip via the
    // macro pad.
    ".cm-codeSpeech-tooltip": {
        backgroundColor: "#1f1f1f",
        color: "#bfb878",
        border: "1px solid #888888",
        borderRadius: "4px",
        padding: "2px 6px",
        fontSize: "12px",
        fontFamily: "monospace",
        lineHeight: "1.2",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
        userSelect: "text",
        maxWidth: "600px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    // Strip the default cm-tooltip background and
    // padding so the inner cm-codeSpeech-tooltip
    // styling shows through cleanly without a
    // box-in-box look. translateX(-50%) shifts the
    // wrapper left by half its own width so the
    // tooltip centres horizontally on the hover anchor
    // point (which sits at the character under the
    // mouse) rather than spilling to its lower right.
    ".cm-tooltip.cm-tooltip-hover": {
        backgroundColor: "transparent",
        border: "none",
        padding: "0",
        transform: "translateX(-50%)",
    },
});

/**
 * Operator-symbol-to-spoken-word lookup. Covers the
 * common arithmetic, comparison, logical, and assignment
 * operators that the AssignmentExpression and
 * BinaryExpression walker cases need in Commit 4. The
 * full operator speech table arrives in Commit 6, where
 * it will live alongside the pronunciation dictionary
 * in its own module.
 *
 * Lookup is by the operator's exact source text, so the
 * walker doesn't need to know how Lezer names each
 * operator token (ArithOp vs CompareOp vs bare token).
 * Whatever the operator's source.slice text is, this map
 * either has a spoken form for it or it falls through to
 * operatorToWord's fallback.
 *
 * @type {Record<string, string>}
 */
const OPERATOR_WORDS = {
    "=": "equals",
    "+=": "plus equals",
    "-=": "minus equals",
    "*=": "times equals",
    "/=": "divided by equals",
    "%=": "modulo equals",
    "**=": "to the power of equals",
    "+": "plus",
    "-": "minus",
    "*": "times",
    "/": "divided by",
    "%": "modulo",
    "**": "to the power of",
    "<": "less than",
    "<=": "less than or equal",
    ">": "greater than",
    ">=": "greater than or equal",
    "==": "equals",
    "===": "strictly equals",
    "!=": "not equal",
    "!==": "strictly not equal",
    "&&": "and",
    "||": "or",
    "??": "or nullish",
    "!": "not",
};

/**
 * Look up an operator symbol's spoken word, falling back
 * to the symbol's raw text if not in the table. The
 * fallback keeps the pipeline producing audible output
 * for operators we haven't catalogued yet (the speech
 * synthesizer will read the raw punctuation, which sounds
 * bad but is unambiguous).
 *
 * @param {string} opText
 * @returns {string}
 */
function operatorToWord(opText) {
    return Object.prototype.hasOwnProperty.call(OPERATOR_WORDS, opText)
        ? OPERATOR_WORDS[opText]
        : opText;
}

/**
 * Test whether a child node's source text is one of the
 * known operator symbols. Used by AssignmentExpression,
 * BinaryExpression, and the new walker cases to identify
 * operator children among the siblings. The check is by
 * source text, NOT by node name: Lezer JS wraps many
 * operators in PascalCase nodes (CompareOp for >, <, ==,
 * etc.; LogicOp for ?, :, &&, ||; ArithOp for +, -, *,
 * /; AssignOp for =, +=, etc.), so the PascalCase-means-
 * expression heuristic used by the structural walker
 * cases is wrong for operator detection. Checking source
 * text is safe because OPERATOR_WORDS keys are all
 * punctuation strings; no real identifier matches.
 *
 * @param {any} child
 * @param {string} source
 * @returns {boolean}
 */
function isOperatorChild(child, source) {
    const text = source.slice(child.from, child.to);
    return Object.prototype.hasOwnProperty.call(OPERATOR_WORDS, text);
}

/**
 * Walk a Lezer SyntaxNode and append chunks to the given
 * array. Each chunk is { text, ranges } where ranges is
 * an array of [from, to] tuples; for Commit 3 every chunk
 * has a single range. Dispatches on node.name across the
 * four core forms:
 *
 *   - CallExpression: walk the callee, then walk each
 *     argument. The argument list is the child node named
 *     "ArgList"; punctuation tokens (open paren, commas,
 *     close paren) inside the ArgList are skipped by the
 *     PascalCase test that selects only syntactic nodes.
 *
 *   - MemberExpression: emit a single chunk for the full
 *     member-access source text. The Commit 3a follow-up
 *     replaces this with chain unfolding when the object
 *     is itself a CallExpression so dot-chained calls
 *     read left-to-right as discrete chunks.
 *
 *   - VariableName, PropertyName, Number, String,
 *     TemplateString, BooleanLiteral: single chunk for
 *     the source text. These are the leaf forms — no
 *     children to descend into.
 *
 *   - Anything else: fallback single chunk with the raw
 *     source text. Keeps the pipeline producing output
 *     for forms not yet covered (assignment, binary,
 *     etc., which land in Commit 4) so the user always
 *     hears something on a valid statement rather than
 *     hitting an empty queue.
 *
 * @param {any} node     Lezer SyntaxNode.
 * @param {string} source  Full document source text.
 * @param {Array<{text: string, ranges: Array<[number, number]>}>} chunks
 */
function walkNode(node, source, chunks) {
    const name = node.name;
    switch (name) {
        case "CallExpression": {
            // First child is the callee expression; the
            // ArgList sits as a later sibling. Walk the
            // callee first so its chunks lead.
            const callee = node.firstChild;
            if (callee !== null) {
                walkNode(callee, source, chunks);
            }
            // Find the ArgList among the children. It's
            // typically the last child, but iterate to be
            // robust against any grammar variants.
            let argList = null;
            let c = node.firstChild;
            while (c !== null) {
                if (c.name === "ArgList") {
                    argList = c;
                    break;
                }
                c = c.nextSibling;
            }
            if (argList !== null) {
                let arg = argList.firstChild;
                while (arg !== null) {
                    // Skip punctuation tokens by the
                    // PascalCase test: Lezer JS syntactic
                    // node names are PascalCase, while
                    // anonymous punctuation tokens have
                    // names like "(", ",", ")" that
                    // don't start with an uppercase
                    // letter.
                    if (/^[A-Z]/.test(arg.name)) {
                        walkNode(arg, source, chunks);
                    }
                    arg = arg.nextSibling;
                }
            }
            break;
        }
        case "MemberExpression": {
            // Chain unfolding: when the object is a
            // CallExpression (the left of the dot is
            // itself a method call), recurse into the
            // object so the chain reads left-to-right
            // and then emit the property name as its own
            // chunk. When the object is anything else
            // (a simple identifier, a property-access
            // chain with no call inside), emit the
            // whole member-access as a single chunk so
            // property paths like pxLt.range read as
            // one unit.
            const object = node.firstChild;
            if (object !== null && object.name === "CallExpression") {
                walkNode(object, source, chunks);
                // The property name is the next
                // PascalCase-named sibling after the
                // object (typically PropertyName, but
                // the PascalCase test is tolerant of
                // grammar variants). The intervening
                // "." punctuation token is skipped by
                // the same uppercase-first-letter test
                // the ArgList walk uses.
                let prop = object.nextSibling;
                while (prop !== null && !/^[A-Z]/.test(prop.name)) {
                    prop = prop.nextSibling;
                }
                if (prop !== null) {
                    chunks.push({
                        text: source.slice(prop.from, prop.to),
                        ranges: [[prop.from, prop.to]],
                    });
                }
            } else {
                chunks.push({
                    text: source.slice(node.from, node.to),
                    ranges: [[node.from, node.to]],
                });
            }
            break;
        }
        case "LabeledStatement": {
            // The label communicates which pattern the
            // statement defines, so it's read as the
            // first chunk regardless of where in the
            // line the pointer is. Iterate PascalCase
            // children and walk each one: the label
            // (typically VariableName) is handled by
            // the leaf case below and emits a single
            // chunk; the body (typically
            // ExpressionStatement) is handled by the
            // ExpressionStatement case below and walks
            // the inner expression. The intervening
            // ":" punctuation token is skipped by the
            // PascalCase test.
            let child = node.firstChild;
            while (child !== null) {
                if (/^[A-Z]/.test(child.name)) {
                    walkNode(child, source, chunks);
                }
                child = child.nextSibling;
            }
            break;
        }
        case "ExpressionStatement": {
            // Reached indirectly through
            // LabeledStatement (when the finder picks a
            // LabeledStatement as the enclosing node
            // and walkNode descends into its children).
            // The direct-ExpressionStatement path is
            // handled by the finder itself, which digs
            // into the ExpressionStatement to find its
            // expression child and walks that. Both
            // paths converge on walking the inner
            // expression, just via different entry
            // points.
            let child = node.firstChild;
            while (child !== null) {
                if (/^[A-Z]/.test(child.name)) {
                    walkNode(child, source, chunks);
                }
                child = child.nextSibling;
            }
            break;
        }
        case "ReturnStatement": {
            // The "return" keyword followed by an
            // optional returned expression. The keyword
            // is the first non-PascalCase child whose
            // source text is "return"; the returned
            // expression is the first PascalCase child.
            // Emit "return" anchored to the keyword
            // token's source range so the highlight
            // sits on the keyword while it's read, then
            // walk the expression (which produces its
            // own chunks with their own ranges).
            let child = node.firstChild;
            while (child !== null) {
                if (/^[A-Z]/.test(child.name)) {
                    walkNode(child, source, chunks);
                } else if (source.slice(child.from, child.to) === "return") {
                    chunks.push({
                        text: "return",
                        ranges: [[child.from, child.to]],
                    });
                }
                child = child.nextSibling;
            }
            break;
        }
        case "AssignmentExpression":
        case "BinaryExpression": {
            // Iterate children in source order. Check
            // isOperatorChild FIRST so a child whose
            // source text is an operator gets emitted as
            // the spoken word for that operator, even if
            // Lezer wraps it in a PascalCase node
            // (CompareOp, ArithOp, AssignOp, etc.). A
            // PascalCase child that is NOT an operator
            // is an operand and is walked recursively.
            // The source-order iteration means the
            // chunks come out in natural reading order:
            // for `a + b` we get a, plus, b; for `x = 5`
            // we get x, equals, 5; for `t > 0.5` we get
            // t, greater than, 0.5.
            let child = node.firstChild;
            while (child !== null) {
                if (isOperatorChild(child, source)) {
                    const opText = source.slice(child.from, child.to);
                    chunks.push({
                        text: operatorToWord(opText),
                        ranges: [[child.from, child.to]],
                    });
                } else if (/^[A-Z]/.test(child.name)) {
                    walkNode(child, source, chunks);
                }
                child = child.nextSibling;
            }
            break;
        }
        case "ConditionalExpression": {
            // Ternary: test ? consequent : alternate.
            // Read as "if [test] then [consequent] else
            // [alternate]". Iterate children and pull
            // out the three PascalCase operands plus the
            // "?" and ":" tokens. Then emit chunks in
            // reading order:
            //   - "if" with keepHighlight (no source
            //     anchor before test)
            //   - walk test
            //   - "then" anchored to the "?" token
            //   - walk consequent
            //   - "else" anchored to the ":" token
            //   - walk alternate
            // If the punctuation tokens can't be
            // identified (grammar variant), "then" and
            // "else" fall back to keepHighlight so the
            // user still hears the keyword even though
            // the highlight doesn't anchor to it.
            /** @type {any[]} */
            const exprs = [];
            /** @type {any} */ let questionTok = null;
            /** @type {any} */ let colonTok = null;
            let child = node.firstChild;
            while (child !== null) {
                // Check source text FIRST: Lezer JS
                // wraps the ternary's "?" and ":" in
                // PascalCase LogicOp nodes, so the
                // "PascalCase means expression"
                // heuristic would misclassify them as
                // operands without this guard. Once the
                // punctuation is filtered out, any
                // remaining PascalCase child is one of
                // the three expression operands.
                const text = source.slice(child.from, child.to);
                if (text === "?") {
                    questionTok = child;
                } else if (text === ":") {
                    colonTok = child;
                } else if (/^[A-Z]/.test(child.name)) {
                    exprs.push(child);
                }
                child = child.nextSibling;
            }
            if (exprs.length >= 1) {
                chunks.push({
                    text: "if",
                    ranges: [],
                    keepHighlight: true,
                });
                walkNode(exprs[0], source, chunks);
            }
            if (exprs.length >= 2) {
                if (questionTok !== null) {
                    chunks.push({
                        text: "then",
                        ranges: [[questionTok.from, questionTok.to]],
                    });
                } else {
                    chunks.push({
                        text: "then",
                        ranges: [],
                        keepHighlight: true,
                    });
                }
                walkNode(exprs[1], source, chunks);
            }
            if (exprs.length >= 3) {
                if (colonTok !== null) {
                    chunks.push({
                        text: "else",
                        ranges: [[colonTok.from, colonTok.to]],
                    });
                } else {
                    chunks.push({
                        text: "else",
                        ranges: [],
                        keepHighlight: true,
                    });
                }
                walkNode(exprs[2], source, chunks);
            }
            break;
        }
        case "ArrowFunction": {
            // (params) => body, or single-param-no-parens
            // form: param => body. The parameter(s)
            // arrive either as a ParamList child (whose
            // PascalCase children are the individual
            // params) or as a single PascalCase child
            // before the "=>" arrow. The body comes
            // after the arrow as the next PascalCase
            // child. Reads as "function [params...]
            // yields [body]".
            /** @type {any[]} */
            const params = [];
            /** @type {any} */ let arrowTok = null;
            /** @type {any} */ let body = null;
            let child = node.firstChild;
            while (child !== null) {
                if (child.name === "ParamList") {
                    let p = child.firstChild;
                    while (p !== null) {
                        if (/^[A-Z]/.test(p.name)) params.push(p);
                        p = p.nextSibling;
                    }
                } else if (source.slice(child.from, child.to) === "=>") {
                    arrowTok = child;
                } else if (/^[A-Z]/.test(child.name)) {
                    if (arrowTok === null) {
                        // Single bare parameter before
                        // the arrow (parenless form).
                        params.push(child);
                    } else {
                        // First PascalCase child after
                        // the arrow is the body.
                        body = child;
                    }
                }
                child = child.nextSibling;
            }
            chunks.push({
                text: "function",
                ranges: [],
                keepHighlight: true,
            });
            for (const p of params) {
                walkNode(p, source, chunks);
            }
            if (arrowTok !== null) {
                chunks.push({
                    text: "yields",
                    ranges: [[arrowTok.from, arrowTok.to]],
                });
            } else {
                chunks.push({
                    text: "yields",
                    ranges: [],
                    keepHighlight: true,
                });
            }
            if (body !== null) {
                walkNode(body, source, chunks);
            }
            break;
        }
        case "ObjectExpression": {
            // { key1: value1, key2: value2 }
            // Emit a leading "object" chunk
            // (keepHighlight, no anchor) and then walk
            // each Property child. The Property case
            // below handles the key/value pair reading.
            chunks.push({
                text: "object",
                ranges: [],
                keepHighlight: true,
            });
            let child = node.firstChild;
            while (child !== null) {
                if (child.name === "Property") {
                    walkNode(child, source, chunks);
                }
                child = child.nextSibling;
            }
            break;
        }
        case "Property": {
            // key : value, or shorthand (just key, where
            // the key is also the value). Iterate
            // children; the ":" token (checked by source
            // text FIRST in case Lezer wraps it in a
            // PascalCase node) anchors the "is" keyword
            // chunk between key and value. The first
            // non-punctuation PascalCase child is the
            // key; the second is the value (if present).
            /** @type {any} */ let key = null;
            /** @type {any} */ let value = null;
            /** @type {any} */ let colonTok = null;
            let child = node.firstChild;
            while (child !== null) {
                if (source.slice(child.from, child.to) === ":") {
                    colonTok = child;
                } else if (/^[A-Z]/.test(child.name)) {
                    if (key === null) key = child;
                    else if (value === null) value = child;
                }
                child = child.nextSibling;
            }
            if (key !== null) walkNode(key, source, chunks);
            if (value !== null) {
                if (colonTok !== null) {
                    chunks.push({
                        text: "is",
                        ranges: [[colonTok.from, colonTok.to]],
                    });
                } else {
                    chunks.push({
                        text: "is",
                        ranges: [],
                        keepHighlight: true,
                    });
                }
                walkNode(value, source, chunks);
            }
            break;
        }
        case "ParenthesizedExpression": {
            // (expression) - parens are grouping only,
            // no semantic content of their own. Walk
            // the inner expression directly so the
            // user hears the contents without the
            // distracting "open paren" / "close paren"
            // that a raw-text fallback would produce.
            let child = node.firstChild;
            while (child !== null) {
                if (/^[A-Z]/.test(child.name)) {
                    walkNode(child, source, chunks);
                }
                child = child.nextSibling;
            }
            break;
        }
        case "String":
        case "TemplateString": {
            // Strip the surrounding delimiter characters
            // (", ', or `) from the spoken text. Without
            // this the speech engine interprets the
            // double quote as the unit-of-inches symbol
            // (so "c5" reads as "C5 inches") and the
            // single quote as the unit-of-feet symbol.
            // The highlight range still covers the full
            // quoted string including the delimiters,
            // so the visual presentation is unchanged.
            // Internal escape sequences (\", \', \n,
            // etc.) are spoken as raw text for v0.1;
            // the pronunciation dictionary in Commit 6
            // can refine this if it becomes a problem in
            // practice.
            const text = source.slice(node.from, node.to);
            const inner = text.length >= 2 ? text.slice(1, -1) : text;
            chunks.push({
                text: inner,
                ranges: [[node.from, node.to]],
            });
            break;
        }
        case "VariableName":
        case "PropertyName":
        case "Number":
        case "BooleanLiteral":
            chunks.push({
                text: source.slice(node.from, node.to),
                ranges: [[node.from, node.to]],
            });
            break;
        default:
            // Unrecognised node type. Emit raw text so the
            // pipeline always produces output for valid
            // input.
            chunks.push({
                text: source.slice(node.from, node.to),
                ranges: [[node.from, node.to]],
            });
    }
}

/**
 * Module-level cache of the currently selected
 * SpeechSynthesisVoice. Null until the browser's voice
 * list has been populated and selectVoice has had a
 * chance to pick from it. Set in playChunks on every
 * utterance so the speech engine uses the chosen voice
 * rather than whatever Chromium defaults to (which on
 * Electron is a flat low-quality voice that bears no
 * resemblance to the macOS Speak Selection system
 * voice the composer hears elsewhere).
 *
 * @type {any}
 */
let selectedVoice = null;

/**
 * Pick the best available voice from the browser's voice
 * list and cache it in selectedVoice. Called once at
 * module load and again whenever the SpeechSynthesis API
 * fires its voiceschanged event (the voice list is
 * populated asynchronously after page load, and may
 * change later if voice packs are installed at runtime).
 *
 * Selection preference, from most-preferred to least:
 *   1. Karen Premium / Enhanced / standard — the
 *      composer's chosen macOS voice (Australian
 *      English), in decreasing order of synthesis
 *      quality.
 *   2. Samantha Premium / Enhanced / standard — the
 *      US English fallback if Karen isn't installed.
 *   3. Any English local voice with "Premium" or
 *      "Enhanced" in its name — covers Ava (Premium),
 *      Allison (Enhanced), etc.
 *   4. Any local English voice flagged as default by
 *      the browser.
 *   5. Any local English voice.
 *   6. Any English voice (including non-local).
 *   7. First voice in the list.
 *
 * Logs the selection to the console so the composer can
 * see what voice is being used and request a different
 * preference if desired. The full voice list is also
 * logged on the first selection so the available
 * options are visible.
 */
function selectVoice() {
    if (typeof window === "undefined") return;
    if (typeof window.speechSynthesis === "undefined") return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;

    const wasNull = selectedVoice === null;

    const preferredNames = [
        "Karen (Premium)",
        "Karen (Enhanced)",
        "Karen",
        "Samantha (Premium)",
        "Samantha (Enhanced)",
        "Samantha",
    ];
    for (const name of preferredNames) {
        const found = voices.find((v) => v.name === name);
        if (found) {
            selectedVoice = found;
            logVoiceSelection(voices, wasNull);
            return;
        }
    }

    const englishLocal = voices.filter(
        (v) => v.localService && v.lang.startsWith("en"),
    );
    const premiumOrEnhanced = englishLocal.find(
        (v) => /\(Premium\)|\(Enhanced\)/.test(v.name),
    );
    if (premiumOrEnhanced) {
        selectedVoice = premiumOrEnhanced;
        logVoiceSelection(voices, wasNull);
        return;
    }

    const englishLocalDefault = englishLocal.find((v) => v.default);
    if (englishLocalDefault) {
        selectedVoice = englishLocalDefault;
        logVoiceSelection(voices, wasNull);
        return;
    }

    if (englishLocal.length > 0) {
        selectedVoice = englishLocal[0];
        logVoiceSelection(voices, wasNull);
        return;
    }

    const anyEnglish = voices.find((v) => v.lang.startsWith("en"));
    if (anyEnglish) {
        selectedVoice = anyEnglish;
        logVoiceSelection(voices, wasNull);
        return;
    }

    selectedVoice = voices[0];
    logVoiceSelection(voices, wasNull);
}

/**
 * Log the current voice selection. On the first call
 * (firstTime true) also log the full available-voices
 * list so the composer can see what other options exist
 * and request a different preference if they'd like.
 *
 * @param {any[]} voices
 * @param {boolean} firstTime
 */
function logVoiceSelection(voices, firstTime) {
    if (firstTime) {
        console.log(
            "[codeSpeech] available voices:",
            voices.map((v) => ({
                name: v.name,
                lang: v.lang,
                local: v.localService,
                default: v.default,
            })),
        );
    }
    console.log(
        "[codeSpeech] selected voice:",
        selectedVoice ? `${selectedVoice.name} (${selectedVoice.lang})` : "none",
    );
}

// Initialise the voice selection at module load. The
// voices list may be empty at this point (the browser
// populates it asynchronously), in which case selectVoice
// no-ops and the voiceschanged listener below will fire
// once voices are available and rerun the selection.
if (typeof window !== "undefined" && window.speechSynthesis) {
    selectVoice();
    window.speechSynthesis.addEventListener("voiceschanged", selectVoice);
}

/**
 * Module-level generation counter for the playback engine.
 * Incremented on every new chunk queue start; captured by
 * the playNext closure inside playChunks. The onend handler
 * checks its captured generation against this counter
 * before advancing; if a fresh shortcut press has started
 * a new queue (bumping the counter), the stale onend
 * silently no-ops instead of driving the cancelled queue
 * forward.
 *
 * Lives at module scope because there is only one editor
 * instance in GXW; the speech layer is effectively a
 * singleton from the user's perspective. If the speech
 * layer is ever instantiated for multiple editors
 * simultaneously, this would need to move into the
 * codeSpeechExtension closure.
 */
let playbackGeneration = 0;

/**
 * Speech state for tooltip reading. Only set when the
 * composer holds Option to request that hovered tooltips
 * be spoken aloud. The mechanism: hoverTooltip's create()
 * sets currentTooltipText to the tooltip's text and
 * speaks it if isOptionHeld is true at that moment; the
 * destroy() clears currentTooltipText if it still
 * matches. A window-level Option keydown listener also
 * speaks the current tooltip text (if any) the moment
 * Option is first pressed, covering the hover-then-press
 * case in addition to the hold-then-hover case.
 *
 * isTooltipUtteranceInFlight distinguishes tooltip speech
 * from code-speech (playChunks). When code speech is in
 * flight the tooltip request is ignored so Option-hover
 * doesn't accidentally interrupt a Cmd-Shift-' reading;
 * the composer must press Escape first to stop code
 * speech before requesting tooltip speech. Between
 * consecutive tooltips while Option is held, the new
 * speakTooltip call cancels the previous tooltip
 * utterance so each tooltip cleanly replaces the last.
 */
let currentTooltipText = null;
let isOptionHeld = false;
let isTooltipUtteranceInFlight = false;

/**
 * Speak a single tooltip's text aloud through the same
 * SpeechSynthesis voice the chunk-queue playback uses.
 * Refuses to interrupt code speech in flight; cancels any
 * previous tooltip utterance so consecutive tooltips
 * (continuous Option-hover across multiple arguments)
 * each replace the previous reading cleanly.
 *
 * @param {string} text
 */
function speakTooltip(text) {
    if (typeof window === "undefined") return;
    if (typeof window.speechSynthesis === "undefined") return;
    const synth = window.speechSynthesis;
    if ((synth.speaking || synth.paused) && !isTooltipUtteranceInFlight) {
        return;
    }
    synth.cancel();
    isTooltipUtteranceInFlight = true;
    const utterance = new window.SpeechSynthesisUtterance(text);
    if (selectedVoice !== null) {
        utterance.voice = selectedVoice;
    }
    utterance.onend = () => { isTooltipUtteranceInFlight = false; };
    utterance.onerror = () => { isTooltipUtteranceInFlight = false; };
    synth.speak(utterance);
}

// Window-level Option (Alt) key listeners for tooltip
// speech. event.repeat is checked so auto-repeat fires
// don't re-speak; the speak triggers exactly once on the
// released-to-held transition. Speech only fires if
// currentTooltipText is non-null, which is true only when
// a tooltip is currently visible — and tooltips only
// appear when isCodeTab() is true (gated in the
// hoverTooltip callback) — so these listeners are
// implicitly inactive on tabs other than Code.
if (typeof window !== "undefined") {
    window.addEventListener("keydown", (event) => {
        if (event.key === "Alt" && !event.repeat) {
            isOptionHeld = true;
            if (currentTooltipText !== null) {
                speakTooltip(currentTooltipText);
            }
        }
    });
    window.addEventListener("keyup", (event) => {
        if (event.key === "Alt") {
            isOptionHeld = false;
        }
    });
}

/**
 * Play a chunk queue: for each chunk, dispatch the
 * highlight effect with that chunk's ranges, create a
 * SpeechSynthesisUtterance with the chunk's text, attach
 * an onend handler that advances to the next chunk, and
 * call speechSynthesis.speak. When the queue completes
 * (or starts empty), dispatch a clear effect to remove
 * the highlight.
 *
 * Cancel safety: speechSynthesis.cancel is called up
 * front so any in-flight utterance from a previous queue
 * stops immediately. The generation counter bumps and the
 * new value is captured in the playNext closure; every
 * onend handler tests its captured generation against
 * the module-level counter before doing anything, so a
 * late onend from a cancelled utterance silently no-ops.
 *
 * Defence-in-depth guard: if the SpeechSynthesis API is
 * unavailable (non-browser test env, or browser without
 * the API), the function returns without dispatching any
 * effects. The keymap command's console.log of the
 * chunks still ran before this is called, so the
 * pipeline can still be inspected.
 *
 * @param {any} view     CodeMirror EditorView.
 * @param {Array<{text: string, ranges: Array<[number, number]>}>} chunks
 */
function playChunks(view, chunks) {
    if (typeof window === "undefined") return;
    if (typeof window.speechSynthesis === "undefined") return;

    window.speechSynthesis.cancel();
    // Clear any stale highlight from a previous queue
    // before starting the new one. Without this, if the
    // first chunk of the new queue carries keepHighlight,
    // the previous queue's highlight would remain visible
    // until a non-keepHighlight chunk lands.
    view.dispatch({ effects: setCodeSpeechHighlight.of([]) });
    const gen = ++playbackGeneration;

    if (chunks.length === 0) {
        return;
    }

    let i = 0;
    const playNext = () => {
        if (gen !== playbackGeneration) return;
        if (i >= chunks.length) {
            view.dispatch({ effects: setCodeSpeechHighlight.of([]) });
            return;
        }
        const chunk = chunks[i];
        // Skip the highlight dispatch when the chunk
        // carries keepHighlight: synthesized keyword
        // chunks without a natural source anchor (the
        // "if" of a ternary, the "function" of an arrow
        // function, the "object" of an object literal)
        // use this so the previous chunk's highlight
        // stays in place during the keyword reading,
        // rather than the highlight flashing off and on.
        if (!chunk.keepHighlight) {
            view.dispatch({
                effects: setCodeSpeechHighlight.of(chunk.ranges),
            });
        }
        const utterance = new window.SpeechSynthesisUtterance(chunk.text);
        if (selectedVoice !== null) {
            // Set the chosen voice explicitly so the
            // engine doesn't fall back to Chromium's
            // flat default. selectVoice keeps
            // selectedVoice in sync with the browser's
            // voice list via the voiceschanged listener
            // at module load, so this is always the
            // current best-available voice when the
            // utterance is created.
            utterance.voice = selectedVoice;
        }
        utterance.onend = () => {
            if (gen !== playbackGeneration) return;
            i++;
            playNext();
        };
        window.speechSynthesis.speak(utterance);
    };
    playNext();
}

/**
 * @typedef {Object} CodeSpeechOptions
 * @property {() => boolean} isCodeTab Returns true iff the
 *   active tab is the one where the speech layer should
 *   respond. The keymap command returns false on non-Code
 *   tabs so the keystroke falls through.
 */

/**
 * Build the speech-layer CodeMirror extension. Returns an
 * array of extensions the editor mount can splat into its
 * extension list:
 *
 *   - pointerTracker: DOM mousemove handler updating the
 *     last document position under the pointer.
 *   - speechKeymap: keymap binding Mod-Shift-' to the
 *     read-and-speak command.
 *   - codeSpeechHighlightField: StateField holding the
 *     active highlight DecorationSet.
 *   - codeSpeechHighlightTheme: theme rule styling the
 *     highlighted ranges.
 *
 * The pointer tracker and the keymap share closure state
 * (lastPointerOffset) so the command can read the most
 * recent valid pointer position the mousemove handler saw.
 *
 * @param {CodeSpeechOptions} options
 * @returns {any[]}
 */
export function codeSpeechExtension({ isCodeTab }) {
    /**
     * The most recent document position under the pointer.
     * Updated on every mousemove inside the editor that
     * maps to a valid document position; mousemove events
     * that land outside the document content (below the
     * last line, beyond the right edge) leave the previous
     * value in place so a hand-off-the-mouse gesture
     * doesn't wipe the user's last targeted line. Null
     * before the first valid mousemove; the command logs
     * a diagnostic and no-ops in that case rather than
     * guessing at a position.
     * @type {number | null}
     */
    let lastPointerOffset = null;

    const pointerTracker = EditorView.domEventHandlers({
        mousemove: (event, view) => {
            const pos = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
            });
            if (pos !== null) {
                lastPointerOffset = pos;
            }
        },
    });

    /**
     * Find the enclosing ExpressionStatement at the
     * tracked pointer position, walk it into chunks, and
     * play the chunk queue through the speech engine with
     * synchronised highlights. Returns true on the Code
     * tab so the keystroke is unambiguously consumed
     * there; returns false on other tabs so the keystroke
     * falls through.
     *
     * The enclosing-finder uses the same Lezer cursor
     * walk Commit 1 introduced. After the
     * ExpressionStatement is located, its first
     * syntactic-node child (skipping any leading
     * punctuation) is the expression to walk. The walker
     * produces the chunk queue; playChunks renders it
     * through SpeechSynthesis and the highlight state
     * field.
     *
     * The console.log of the chunks stays in place as
     * a development aid — it's the most reliable way to
     * see what the walker produced for a given input
     * when iterating on walker rules. It can come out
     * later if the noise becomes a distraction.
     *
     * @param {any} view  CodeMirror EditorView.
     * @returns {boolean}
     */
    const readEnclosingStatement = (view) => {
        if (!isCodeTab()) return false;
        if (lastPointerOffset === null) {
            console.log("[codeSpeech] no pointer position tracked yet");
            return true;
        }
        const tree = syntaxTree(view.state);
        const cursor = tree.cursorAt(lastPointerOffset);
        // Walk up looking for an ExpressionStatement or a
        // LabeledStatement, preferring LabeledStatement
        // when both are available so the label is read as
        // the leading chunk. The cursor walks one level
        // per parent() call from the leaf at the pointer
        // position; we record the first match and keep
        // walking only to check whether the parent of an
        // ExpressionStatement match is a LabeledStatement
        // (in which case the parent is preferred).
        /** @type {any} */
        let found = null;
        do {
            if (cursor.name === "LabeledStatement") {
                found = cursor.node;
                break;
            }
            if (cursor.name === "ExpressionStatement") {
                found = cursor.node;
                // Check one more level: if this
                // ExpressionStatement is the body of a
                // LabeledStatement, prefer the
                // LabeledStatement so the label reads.
                if (cursor.parent() && cursor.name === "LabeledStatement") {
                    found = cursor.node;
                }
                break;
            }
            if (cursor.name === "ReturnStatement") {
                // Return is its own statement form.
                // Accepting it here lets the user point
                // at a `return expr;` line inside a
                // function and hear just that return,
                // rather than walking up to the outer
                // enclosing statement (which could be
                // huge, e.g. the whole function
                // declaration). Walker has a
                // ReturnStatement case that emits the
                // "return" keyword anchored to its own
                // source token and walks the returned
                // expression.
                found = cursor.node;
                break;
            }
        } while (cursor.parent());

        if (found === null) {
            console.log(
                "[codeSpeech] no enclosing statement at offset",
                lastPointerOffset,
            );
            return true;
        }

        /** @type {any} */
        let targetNode;
        if (found.name === "LabeledStatement" || found.name === "ReturnStatement") {
            // Pass directly to the walker; the
            // LabeledStatement and ReturnStatement
            // cases handle their own structure (label
            // + body, or "return" keyword + expression
            // respectively).
            targetNode = found;
        } else {
            // ExpressionStatement: dig into the
            // expression child directly (matches the
            // Commit 3 behaviour). Skip any leading
            // anonymous tokens with the same PascalCase
            // test the walker uses.
            let exprChild = found.firstChild;
            while (exprChild !== null && !/^[A-Z]/.test(exprChild.name)) {
                exprChild = exprChild.nextSibling;
            }
            targetNode = exprChild !== null ? exprChild : found;
        }

        const source = view.state.doc.toString();
        /** @type {Array<{text: string, ranges: Array<[number, number]>, keepHighlight?: boolean}>} */
        const chunks = [];
        walkNode(targetNode, source, chunks);

        // Pointer-positioned start. Find the first chunk
        // whose source range ends at or after the
        // pointer position, and slice the queue from
        // there. This lets the composer hear an
        // expression starting from any point inside it
        // rather than always from the beginning. Pointing
        // at the start of the statement keeps all chunks
        // (the first chunk's range end is already >=
        // pointer); pointing deeper skips chunks before
        // the pointer. Synthesized keyword chunks have
        // empty ranges so they're invisible to the scan;
        // they're kept in the playable queue if they fall
        // after the start index (e.g. "then" / "else" in
        // a ternary still appear when the start lands
        // inside the consequent), and dropped if they
        // fall before.
        let startIdx = 0;
        for (let i = 0; i < chunks.length; i++) {
            const ranges = chunks[i].ranges;
            if (ranges.length === 0) continue;
            let maxEnd = 0;
            for (const range of ranges) {
                if (range[1] > maxEnd) maxEnd = range[1];
            }
            if (maxEnd >= lastPointerOffset) {
                startIdx = i;
                break;
            }
        }
        const playableChunks = startIdx > 0
            ? chunks.slice(startIdx)
            : chunks;

        console.log(
            "[codeSpeech] chunks:", chunks,
            "start at index:", startIdx,
        );
        playChunks(view, playableChunks);
        return true;
    };

    /**
     * Stop speech and clear the highlight. Gated on
     * speech being active or paused so the Escape
     * binding falls through cleanly to other handlers
     * (closing completion popups, dismissing dialogs)
     * when speech isn't in flight. Bumping
     * playbackGeneration invalidates any pending onend
     * handlers from the cancelled queue so they no-op
     * silently rather than driving the cleared queue
     * forward.
     *
     * @param {any} view
     * @returns {boolean}
     */
    const stopSpeech = (view) => {
        if (!isCodeTab()) return false;
        if (typeof window === "undefined") return false;
        if (typeof window.speechSynthesis === "undefined") return false;
        const synth = window.speechSynthesis;
        if (!synth.speaking && !synth.paused) return false;
        synth.cancel();
        playbackGeneration++;
        view.dispatch({ effects: setCodeSpeechHighlight.of([]) });
        return true;
    };

    /**
     * Toggle pause/resume on the current speech. Gated
     * on speech being active or paused so the Space
     * binding falls through to normal type-a-space
     * behaviour when speech isn't playing. The
     * highlight stays in place while paused so the
     * composer sees where they stopped; on resume the
     * playback continues from the same chunk's onend
     * handler that was already queued before the
     * pause, so the generation counter doesn't need to
     * change.
     *
     * @param {any} _view
     * @returns {boolean}
     */
    const togglePause = (_view) => {
        if (!isCodeTab()) return false;
        if (typeof window === "undefined") return false;
        if (typeof window.speechSynthesis === "undefined") return false;
        const synth = window.speechSynthesis;
        if (synth.paused) {
            synth.resume();
            return true;
        }
        if (synth.speaking) {
            synth.pause();
            return true;
        }
        return false;
    };

    /**
     * CodeMirror hover-tooltip extension surfacing
     * parameter names from FUNCTION_SIGNATURES. The
     * callback fires on every hover; it walks up the
     * Lezer tree from the hover position to find an
     * enclosing CallExpression, extracts the rightmost
     * identifier of the callee as the lookup key, and
     * returns either the full signature (when hovering
     * on the callee) or the per-argument name (when
     * hovering inside the ArgList). Returns null on
     * anything else — hovers outside a known call,
     * functions without a signatures entry, the tab
     * being something other than Code.
     */
    const paramTooltip = hoverTooltip((view, pos, side) => {
        if (!isCodeTab()) return null;

        const tree = syntaxTree(view.state);
        const node = tree.resolveInner(pos, side);

        // Walk up to find the enclosing CallExpression.
        /** @type {any} */
        let callExpr = null;
        /** @type {any} */
        let walker = node;
        while (walker !== null) {
            if (walker.name === "CallExpression") {
                callExpr = walker;
                break;
            }
            walker = walker.parent;
        }
        if (callExpr === null) return null;

        // Get the callee's rightmost identifier. For a
        // plain VariableName callee that's the callee
        // itself; for a MemberExpression callee it's the
        // last PascalCase child (a chain like a.b.c.d has
        // last-child PropertyName d).
        const callee = callExpr.firstChild;
        if (callee === null) return null;
        /** @type {any} */
        let nameNode = null;
        if (callee.name === "VariableName") {
            nameNode = callee;
        } else if (callee.name === "MemberExpression") {
            /** @type {any} */
            let c = callee.firstChild;
            while (c !== null) {
                if (/^[A-Z]/.test(c.name)) nameNode = c;
                c = c.nextSibling;
            }
        }
        if (nameNode === null) return null;
        const fnName = view.state.sliceDoc(nameNode.from, nameNode.to);

        const signature = FUNCTION_SIGNATURES[fnName];
        if (!signature) return null;

        // Hovering on the callee — show the full
        // signature on one line. The callee's range covers
        // both the plain-identifier case and the
        // member-expression case; for a member chain like
        // pxLt.range, hovering anywhere on the full
        // pxLt.range span (including the dot) counts as a
        // callee hover.
        /** @type {string} */
        let text;
        if (callee.from <= pos && pos <= callee.to) {
            text = `${fnName}(${signature.join(", ")})`;
        } else {
            // Hovering somewhere after the callee — must
            // be inside ArgList for an arg hover.
            /** @type {any} */
            let argList = null;
            /** @type {any} */
            let c = callExpr.firstChild;
            while (c !== null) {
                if (c.name === "ArgList") {
                    argList = c;
                    break;
                }
                c = c.nextSibling;
            }
            if (argList === null) return null;

            let idx = 0;
            let foundIdx = -1;
            /** @type {any} */
            let arg = argList.firstChild;
            while (arg !== null) {
                if (/^[A-Z]/.test(arg.name)) {
                    if (arg.from <= pos && pos <= arg.to) {
                        foundIdx = idx;
                        break;
                    }
                    idx++;
                }
                arg = arg.nextSibling;
            }
            if (foundIdx < 0 || foundIdx >= signature.length) return null;
            // Per-argument tooltip shows the parameter
            // name only, without the function-name
            // prefix. The function name is available on
            // the callee hover (which shows the full
            // signature) so it doesn't need to repeat in
            // every argument tooltip; omitting it also
            // keeps the tooltip narrow enough to fit
            // inside the screen-zoom viewport without
            // being clipped on either side.
            text = signature[foundIdx];
        }

        return {
            pos: pos,
            above: false,
            create: () => {
                const dom = document.createElement("div");
                dom.className = "cm-codeSpeech-tooltip";
                dom.textContent = text;
                // Register this tooltip as the
                // currently visible one so the Option
                // keydown listener can find it; speak it
                // immediately if Option is already held
                // (the hold-then-hover case).
                currentTooltipText = text;
                if (isOptionHeld) {
                    speakTooltip(text);
                }
                return {
                    dom,
                    destroy: () => {
                        // Only clear if this tooltip is
                        // still the current one.
                        // CodeMirror's lifecycle can
                        // call the next tooltip's
                        // create before the previous
                        // tooltip's destroy, so an
                        // unconditional clear would
                        // wipe the new tooltip's text
                        // out from under the keydown
                        // listener.
                        if (currentTooltipText === text) {
                            currentTooltipText = null;
                        }
                    },
                };
            },
        };
    }, {
        // 600ms gives the composer time to settle on a
        // hover target without tooltips firing for every
        // mouse-drift across the line. CodeMirror's
        // default of 300ms is too jumpy under macOS Zoom
        // where small movements feel more deliberate.
        hoverTime: 600,
    });

    const speechKeymap = keymap.of([
        {
            key: "Mod-Shift-'",
            run: readEnclosingStatement,
            preventDefault: true,
        },
        {
            key: "Escape",
            run: stopSpeech,
            // No preventDefault: when speech isn't
            // active stopSpeech returns false and the
            // key falls through to whatever else handles
            // Escape (autocomplete close, etc.).
        },
        {
            key: "Space",
            run: togglePause,
            // No preventDefault: when speech isn't
            // active togglePause returns false and the
            // key falls through to typing a space.
        },
    ]);

    return [
        pointerTracker,
        speechKeymap,
        codeSpeechHighlightField,
        codeSpeechHighlightTheme,
        paramTooltip,
    ];
}
