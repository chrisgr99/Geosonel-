/**
 * Selection-driven source-binding highlighting plus
 * orphan-label flagging for behaviors.js.
 *
 * Stage A5 of the section-28 pattern-authoring sequence,
 * extended to cover the full source-binding surface and
 * an orphan-binding warning. Two decoration kinds:
 *
 * Active-tag (cm-pattern-active-tag, accent green). Paints
 * identifiers whose object id matches a currently-selected
 * canvas object. Two identifier forms are recognised:
 *   - The $objectId: tag of a top-level labelled pattern
 *     block (label name plus colon).
 *   - The name of a top-level function declaration whose
 *     name follows the slotName_objectId convention, where
 *     slotName is one of hasHit, beenHit, or onTick.
 * Both point at the same conceptual thing: a piece of
 * behaviors.js source bound to a scene object. The green
 * visually ties the canvas's current focus to the code
 * that handles it. Inactive bindings stay in the default
 * name-token pink.
 *
 * Orphan-tag (cm-pattern-orphan-tag, red wavy underline).
 * Paints the $objectId: tag of a labelled pattern block
 * whose objectId does not match any object in the current
 * scene. A label with no object is a real error: the block
 * fires no pattern and the user almost certainly wants to
 * either remove the block or rename it to point at an
 * existing object. The underline matches the inspector
 * and toolbar's existing error-hard convention (wavy red
 * #d4564b) so the visual language stays consistent across
 * surfaces. Callback function declarations are not flagged
 * because the slotName_objectId convention is not
 * enforced (users can rename callbacks freely) and a
 * function whose name suggests one object may legitimately
 * be shared across several, so name-based orphan detection
 * would have false positives.
 *
 * Active-tag and orphan-tag are mutually exclusive on the
 * same label, since a selected object exists in the scene
 * by definition. When both could apply the active-tag
 * wins (selected, present); the orphan-tag only fires for
 * labels whose object id is absent from the scene.
 *
 * The match is selection-based for active-tag and scene-
 * wide for orphan-tag. A binding for an unselected
 * existing object stays pink. Selecting another object
 * moves the green to its bindings; deselecting clears
 * all green but leaves orphan markings untouched.
 * Multi-selection lights up every selected object's
 * bindings in parallel.
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
 * setSelectedObjectIdsEffect or setKnownObjectIdsEffect
 * dispatch. main.js dispatches both effects after each
 * successful runScene (so the highlight and orphan flags
 * start with the right state on first load), the
 * selection effect on every canvas selectionChanged event
 * (so the highlight tracks clicks in real time), and the
 * known-ids effect after each scene reload (so orphan
 * flags update when objects come and go).
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

/**
 * Effect carrying a fresh set of object ids that exist in
 * the current scene. Dispatched by main.js after each
 * successful runScene. Used by the orphan-tag check: a
 * labelled block whose object id is not in this set is
 * flagged because no scene object will receive its
 * promoted pattern.
 */
export const setKnownObjectIdsEffect = StateEffect.define();

const activeTagMark = Decoration.mark({ class: "cm-pattern-active-tag" });
const orphanTagMark = Decoration.mark({ class: "cm-pattern-orphan-tag" });

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
 * selected canvas objects and for orphaned labelled blocks.
 * Returns a DecorationSet covering the $objectId: tags of
 * matching labelled blocks plus the function-name
 * identifiers of matching callback function declarations
 * (active-tag mark, green), and the $objectId: tags of
 * labelled blocks whose object id is not present in the
 * scene (orphan-tag mark, red wavy underline).
 *
 * @param {import("@codemirror/view").EditorView} view
 * @param {Set<string> | null} selectedObjectIds
 * @param {Set<string> | null} knownObjectIds
 * @returns {import("@codemirror/state").RangeSet<any>}
 */
function computeDecorations(view, selectedObjectIds, knownObjectIds) {
    const builder = new RangeSetBuilder();
    if ((selectedObjectIds === null || selectedObjectIds.size === 0) &&
        knownObjectIds === null) {
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
    // Walk ast.body in source order. RangeSetBuilder
    // requires decorations added in document-start order;
    // top-level statements in ast.body are already in
    // source order, and each iteration adds at most one
    // decoration, so the natural traversal satisfies the
    // requirement without explicit sorting.
    for (const node of ast.body) {
        if (node.type === "LabeledStatement") {
            const label = node.label;
            if (label === null ||
                label.type !== "Identifier" ||
                typeof label.name !== "string") continue;
            if (!label.name.startsWith("$")) continue;
            const objectId = label.name.slice(1);
            // Find the colon between the label and the body
            // explicitly so any whitespace between them does
            // not become part of the styled range. The colon
            // must exist between label.end and the
            // LabelledStatement body's start by the JavaScript
            // grammar; the -1 guard is defence against a
            // malformed AST.
            const colonPos = source.indexOf(":", label.end);
            if (colonPos === -1) continue;
            // Active-tag wins over orphan-tag when both could
            // apply. In practice they are mutually exclusive
            // (a selected object exists in the scene, so its
            // id is in knownObjectIds), but the explicit
            // priority makes the rule clear at the call site.
            if (selectedObjectIds !== null && selectedObjectIds.has(objectId)) {
                builder.add(label.start, colonPos + 1, activeTagMark);
            } else if (knownObjectIds !== null && !knownObjectIds.has(objectId)) {
                builder.add(label.start, colonPos + 1, orphanTagMark);
            }
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
            if (selectedObjectIds === null || !selectedObjectIds.has(objectId)) continue;
            // Highlight just the function-name identifier
            // (id.start to id.end). The "function" keyword
            // and parameter list stay in their default
            // syntax-highlighter colours, so only the
            // object-binding part of the declaration reads
            // as green. Orphan flagging is intentionally
            // not applied to function declarations — see
            // the module docstring for why the slotName_
            // objectId convention is too unreliable for
            // automatic orphan detection.
            builder.add(id.start, id.end, activeTagMark);
        }
    }
    return builder.finish();
}

/**
 * Build the CodeMirror extension that maintains the
 * selection-driven source-binding highlight and orphan-
 * label flag decorations. The extension is a ViewPlugin
 * holding two id sets: selectedObjectIds (canvas
 * selection) and knownObjectIds (all object ids in the
 * current scene). Each set updates when main.js
 * dispatches the matching effect. Doc changes trigger a
 * recompute against the existing sets (the user has
 * changed the file but neither the canvas selection nor
 * the scene has changed).
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
                /** @type {Set<string> | null} */
                this.knownObjectIds = null;
                this.decorations = computeDecorations(
                    view,
                    this.selectedObjectIds,
                    this.knownObjectIds,
                );
            }

            /**
             * @param {import("@codemirror/view").ViewUpdate} update
             */
            update(update) {
                let stateChanged = false;
                for (const tr of update.transactions) {
                    for (const e of tr.effects) {
                        if (e.is(setSelectedObjectIdsEffect)) {
                            this.selectedObjectIds = e.value;
                            stateChanged = true;
                        } else if (e.is(setKnownObjectIdsEffect)) {
                            this.knownObjectIds = e.value;
                            stateChanged = true;
                        }
                    }
                }
                if (update.docChanged || stateChanged) {
                    this.decorations = computeDecorations(
                        update.view,
                        this.selectedObjectIds,
                        this.knownObjectIds,
                    );
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );
}
