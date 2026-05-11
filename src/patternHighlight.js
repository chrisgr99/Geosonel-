/**
 * Selection-driven tag highlighting for labelled pattern
 * blocks in behaviors.js.
 *
 * Stage A5 of the section-28 pattern-authoring sequence.
 * A top-level $objectId: expression block in behaviors.js
 * renders its $objectId: tag (label name plus colon) in
 * accent green via the cm-pattern-active-tag CSS class
 * whenever the dollar-prefixed label matches the id of an
 * object that is currently selected on the canvas.
 * Inactive tags stay in the default name-token colour from
 * cmTheme.
 *
 * The match is selection-based, not scene-wide. A labelled
 * block for an unselected object stays pink even though
 * the object exists in scene.json. The green communicates
 * "this is the pattern block for the object you currently
 * have selected" \u2014 a navigational cue tying the canvas
 * focus to its corresponding source. Selecting another
 * object moves the green to its block; deselecting clears
 * all green.
 *
 * Multi-selection works the same way: every selected
 * object's labelled block(s) light up in parallel.
 * Selection of an object that has no labelled block
 * produces no green anywhere, which is also a useful cue
 * (the composer can see when an object's pattern source
 * hasn't been written yet, or when the dollar-prefixed
 * label has a typo).
 *
 * Duplicate labelled blocks (two blocks with the same
 * $objectId tag) both highlight when their object is
 * selected, since each is a pattern source for that
 * object from the source-tree point of view. The runtime
 * resolves duplicates per its own rule (the most recent
 * Cmd-Enter promote wins).
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
 * Compute decorations for the labelled-block tags bound
 * to currently-selected canvas objects. Returns a
 * DecorationSet covering the $objectId: ranges (label
 * name plus colon) of blocks whose dollar-prefixed label
 * matches an id in the selection set.
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
        if (node.type !== "LabeledStatement") continue;
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
    }
    return builder.finish();
}

/**
 * Build the CodeMirror extension that maintains the
 * selection-driven tag highlight decorations. The
 * extension is a ViewPlugin holding the current selected
 * object ids; the set updates when main.js dispatches
 * setSelectedObjectIdsEffect. Doc changes trigger a
 * recompute against the existing id set (the user has
 * changed the file but the canvas selection has not).
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
