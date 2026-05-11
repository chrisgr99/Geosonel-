/**
 * Selection-driven source-binding highlighting for
 * behaviors.js.
 *
 * Stage A5 of the section-28 pattern-authoring sequence,
 * extended to cover the full source-binding surface. The
 * decoration paints two kinds of identifier in accent green
 * via the cm-pattern-active-tag CSS class whenever the
 * identifier resolves to a currently-selected canvas
 * object:
 *
 *   - The $objectId: tag of a top-level labelled pattern
 *     block (label name plus colon).
 *   - The name of a top-level function declaration whose
 *     name follows the slotName_objectId convention, where
 *     slotName is one of hasHit, beenHit, or onTick.
 *
 * Both forms point at the same conceptual thing: a piece
 * of behaviors.js source bound to a scene object. The
 * green visually ties the canvas's current focus to the
 * code that handles it. Inactive bindings stay in the
 * default name-token pink.
 *
 * The match is selection-based, not scene-wide. A binding
 * for an unselected object stays pink even though the
 * object exists in scene.json. Selecting another object
 * moves the green to its bindings; deselecting clears all
 * green. Multi-selection lights up every selected
 * object's bindings in parallel.
 *
 * Duplicate bindings for the same object id (two labelled
 * blocks with the same tag, or two function declarations
 * with the same name) all highlight when their object is
 * selected. The runtime resolves duplicates per its own
 * rules — most-recent Cmd-Enter wins for cyclePattern;
 * later top-level function declarations shadow earlier
 * ones in JavaScript — but the source-tree view honestly
 * surfaces every place the binding appears.
 *
 * The decoration recomputes on every doc change (cheap:
 * Acorn parses small files in microseconds) and on every
 * setSelectedObjectIdsEffect dispatch. main.js dispatches
 * that effect both after each successful runScene (so the
 * highlight starts with the right state on first load) and
 * on every canvas selectionChanged event (so the highlight
 * tracks clicks in real time).
 */

// @ts-check

import { ViewPlugin, Decoration } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { StateEffect, RangeSetBuilder } from "https://esm.sh/@codemirror/state@6.5.2";
import * as acorn from "https://esm.sh/acorn@8";

/**
 * Effect carrying a fresh set of object ids that are
 * currently selected on the canvas. Dispatched by main.js
 * on canvas selection changes and after each runScene so
 * the decoration tracks the canvas's selection state.
 */
export const setSelectedObjectIdsEffect = StateEffect.define();

const activeTagMark = Decoration.mark({ class: "cm-pattern-active-tag" });

/**
 * Slot-name prefixes for top-level callback function
 * declarations. Each prefix matches one of section 27's
 * Code-tab callback slots; the object id follows the
 * trailing underscore. Sorted with the longest prefix
 * first so the matching loop's startsWith probes don't
 * cause beenHit to be mistaken for a name starting with
 * the shorter onTick prefix (which doesn't actually
 * conflict here, but keeping prefixes sorted by length is
 * the safe convention for prefix matching).
 *
 * @type {Array<{prefix: string, length: number}>}
 */
const CALLBACK_PREFIXES = [
    { prefix: "beenHit_", length: "beenHit_".length },
    { prefix: "hasHit_", length: "hasHit_".length },
    { prefix: "onTick_", length: "onTick_".length },
];

/**
 * Compute decorations for the source bindings of currently-
 * selected canvas objects. Returns a DecorationSet covering
 * the $objectId: tags of matching labelled blocks plus the
 * function-name identifiers of matching callback function
 * declarations.
 *
 * @param {import("@codemirror/view").EditorView} view
 * @param {Set<string> | null} selectedObjectIds
 * @returns {import("@codemirror/state").RangeSet<any>}
 */
function computeDecorations(view, selectedObjectIds) {
    const builder = new RangeSetBuilder();
    if (selectedObjectIds === null || selectedObjectIds.size === 0) {
        return builder.finish();
    }
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
        // Whole-file syntax error: no decorations until
        // the file parses cleanly again.
        return builder.finish();
    }
    if (ast === null || !Array.isArray(ast.body)) {
        return builder.finish();
    }
    for (const node of ast.body) {
        if (node.type === "LabeledStatement") {
            const label = node.label;
            if (label === null ||
                label.type !== "Identifier" ||
                typeof label.name !== "string") continue;
            if (!label.name.startsWith("$")) continue;
            const objectId = label.name.slice(1);
            if (!selectedObjectIds.has(objectId)) continue;
            // Find the colon between the label and the body
            // explicitly so any whitespace between them does
            // not become part of the styled range. The colon
            // must exist between label.end and the
            // LabelledStatement body's start by the JavaScript
            // grammar; the -1 guard is defence against a
            // malformed AST.
            const colonPos = source.indexOf(":", label.end);
            if (colonPos === -1) continue;
            builder.add(label.start, colonPos + 1, activeTagMark);
        } else if (node.type === "FunctionDeclaration") {
            const id = node.id;
            if (id === null ||
                id.type !== "Identifier" ||
                typeof id.name !== "string") continue;
            const name = id.name;
            let objectId = null;
            for (const cp of CALLBACK_PREFIXES) {
                if (name.startsWith(cp.prefix)) {
                    objectId = name.slice(cp.length);
                    break;
                }
            }
            if (objectId === null) continue;
            if (!selectedObjectIds.has(objectId)) continue;
            // Highlight just the function-name identifier
            // (id.start to id.end). The "function" keyword
            // and parameter list stay in their default
            // syntax-highlighter colours, so only the
            // object-binding part of the declaration reads
            // as green.
            builder.add(id.start, id.end, activeTagMark);
        }
    }
    return builder.finish();
}

/**
 * Build the CodeMirror extension that maintains the
 * selection-driven source-binding highlight decorations.
 * The extension is a ViewPlugin holding the current
 * selected object ids; the set updates when main.js
 * dispatches setSelectedObjectIdsEffect. Doc changes
 * trigger a recompute against the existing id set (the
 * user has changed the file but the canvas selection has
 * not).
 *
 * @returns {import("@codemirror/state").Extension}
 */
export function patternHighlightExtension() {
    return ViewPlugin.fromClass(
        class {
            /**
             * @param {import("@codemirror/view").EditorView} view
             */
            constructor(view) {
                /** @type {Set<string> | null} */
                this.selectedObjectIds = null;
                this.decorations = computeDecorations(view, this.selectedObjectIds);
            }

            /**
             * @param {import("@codemirror/view").ViewUpdate} update
             */
            update(update) {
                let idsChanged = false;
                for (const tr of update.transactions) {
                    for (const e of tr.effects) {
                        if (e.is(setSelectedObjectIdsEffect)) {
                            this.selectedObjectIds = e.value;
                            idsChanged = true;
                        }
                    }
                }
                if (update.docChanged || idsChanged) {
                    this.decorations = computeDecorations(update.view, this.selectedObjectIds);
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );
}
