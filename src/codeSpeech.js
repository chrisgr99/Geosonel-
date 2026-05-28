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
 * Commit 3a (this commit) adds method-chain unfolding and
 * LabeledStatement support. The MemberExpression case now
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
 * Subsequent commits land the rest of the walker rules
 * (assignment, binary expression, ternary, return, arrow
 * function, object literal), the pronunciation dictionary
 * and operator speech table, the JSDoc signature
 * annotations, the highlight visual styling pass, and the
 * SpeechSynthesis interruption robustness.
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

import { EditorView, keymap, Decoration } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { StateField, StateEffect } from "https://esm.sh/@codemirror/state@6.5.2";
import { syntaxTree } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";

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
});

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
        case "VariableName":
        case "PropertyName":
        case "Number":
        case "String":
        case "TemplateString":
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
    const gen = ++playbackGeneration;

    if (chunks.length === 0) {
        view.dispatch({ effects: setCodeSpeechHighlight.of([]) });
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
        view.dispatch({
            effects: setCodeSpeechHighlight.of(chunk.ranges),
        });
        const utterance = new window.SpeechSynthesisUtterance(chunk.text);
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
        } while (cursor.parent());

        if (found === null) {
            console.log(
                "[codeSpeech] no enclosing ExpressionStatement at offset",
                lastPointerOffset,
            );
            return true;
        }

        /** @type {any} */
        let targetNode;
        if (found.name === "LabeledStatement") {
            // Pass the LabeledStatement directly to the
            // walker, whose LabeledStatement case emits
            // the label as a leading chunk and walks the
            // body's inner expression.
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
        /** @type {Array<{text: string, ranges: Array<[number, number]>}>} */
        const chunks = [];
        walkNode(targetNode, source, chunks);

        console.log("[codeSpeech] chunks:", chunks);
        playChunks(view, chunks);
        return true;
    };

    const speechKeymap = keymap.of([
        {
            key: "Mod-Shift-'",
            run: readEnclosingStatement,
            preventDefault: true,
        },
    ]);

    return [
        pointerTracker,
        speechKeymap,
        codeSpeechHighlightField,
        codeSpeechHighlightTheme,
    ];
}
