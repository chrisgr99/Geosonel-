/**
 * Selection-driven source-binding highlighting plus
 * orphan-label flagging plus muted-state badge for
 * behaviors.js.
 *
 * Stage A5 of the section-28 pattern-authoring sequence,
 * extended to cover the full source-binding surface, an
 * orphan-binding warning, and an inline muted-state
 * badge. Two decoration classes plus one widget,
 * applied alone or in combination on labelled-block
 * tags and callback function declaration names:
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
 * Mute badge (cm-pattern-mute-badge, bright orange
 * marker). A widget decoration that renders an inline
 * "$mute:" marker immediately after the binding
 * identifier of any source whose object is currently
 * muted in the scene. The marker is a virtual DOM
 * element rendered by Decoration.widget, not source
 * text, so behaviors.js stays untouched on mute toggles
 * and the bundle doesn't dirty when a curve gets muted
 * via Cmd-Shift-M or the inspector checkbox. The marker
 * text mirrors a label form ("$mute:") so the visual
 * reads as "this binding is currently shadowed by a
 * mute flag" even though no $mute object actually
 * exists in the scene. Saturated orange (#ff9933) sits
 * between the toolbar amber and the lint-error red, in
 * the same family as DAW mute indicators (Ableton, Pro
 * Tools, Cubase all use yellow/orange).
 *
 * The badge sits OUTSIDE the active-tag green mark span
 * (the mark ends at the colon for a labelled block, and
 * at the end of the identifier for a function
 * declaration), so the badge gets its own amber styling
 * without inheriting the green colour. This is also why
 * the earlier strikethrough-on-the-identifier approach
 * was abandoned: CodeMirror's text-decoration handling
 * inside its inner syntax-highlighter spans suppressed
 * the line at the layer where the muted-tag class was
 * applied, but a sibling widget at a position outside
 * the mark renders cleanly because it's a discrete DOM
 * element rather than a styling overlay on existing
 * spans.
 *
 * The match is selection-based for active-tag, scene-wide
 * for orphan-tag, and scene-wide for the mute badge. A
 * binding for an unselected, existing, unmuted object
 * stays pink with nothing extra. Selecting another object
 * moves the green to its bindings; deselecting clears
 * all green but leaves orphan and mute decorations
 * untouched. Multi-selection lights up every selected
 * object's bindings in parallel.
 *
 * Duplicate bindings for the same object id (two labelled
 * blocks with the same tag, or two function declarations
 * with the same name) all highlight when their object is
 * selected, orphaned, or muted. The runtime resolves
 * duplicates per its own rules — most-recent Cmd-Enter
 * wins for cyclePattern; later top-level function
 * declarations shadow earlier ones in JavaScript — but
 * the source-tree view honestly surfaces every place the
 * binding appears.
 *
 * The decoration recomputes on every doc change (cheap:
 * Acorn parses small files in microseconds) and on every
 * setSelectedObjectIdsEffect, setKnownObjectIdsEffect,
 * or setMutedObjectIdsEffect dispatch. main.js dispatches
 * all three effects after each successful runScene (so
 * the highlight, orphan flags, and mute badges start with
 * the right state on first load), the selection effect on
 * every canvas selectionChanged event (so the highlight
 * tracks clicks in real time), and the known-ids and
 * muted-ids effects after each scene reload (so orphan
 * flags and mute badges update when objects come and go
 * or change their mute state).
 */

// @ts-check

import { ViewPlugin, Decoration, WidgetType } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
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

/**
 * Effect carrying a fresh set of object ids whose `mute`
 * field is true in the current scene. Dispatched by
 * main.js after each successful runScene and after any
 * mute-state change (toggle via Cmd-Shift-M, inspector
 * checkbox, AI edit through the mirror) so the inline
 * mute badge tracks the live mute state.
 */
export const setMutedObjectIdsEffect = StateEffect.define();

const ACTIVE_TAG_CLASS = "cm-pattern-active-tag";
const ORPHAN_TAG_CLASS = "cm-pattern-orphan-tag";
const MUTE_BADGE_CLASS = "cm-pattern-mute-badge";

/**
 * CodeMirror widget rendering the inline "$mute:" badge
 * for muted-source bindings. The widget produces a single
 * span with the cm-pattern-mute-badge class plus inline
 * !important styles for colour, weight, and margin.
 *
 * Why inline !important rather than CSS-only styling: the
 * cm-pattern-mute-badge stylesheet rule in main.css carries
 * !important on the colour, but something in CodeMirror's
 * theme cascade (likely oneDark's per-element colour rules
 * applied via StyleModule with a high enough effective
 * specificity) still overrides it and renders the badge in
 * the editor's default off-white. Inline styles with
 * !important sit at the top of CSS cascade priority above
 * every author rule including !important author rules, so
 * the badge's colour and weight survive whatever
 * CodeMirror does to widget content under its hood. The
 * stylesheet rule stays as documentation and a fallback.
 *
 * eq() returns true for any pair of widget instances
 * because every badge renders identical DOM — CodeMirror
 * can reuse the same DOM element across recomputes rather
 * than tearing down and rebuilding.
 *
 * ignoreEvent() returns true so click and selection
 * events on the badge don't propagate to CodeMirror's
 * document machinery; the badge is purely an indicator,
 * not interactive content.
 */
class MuteBadgeWidget extends WidgetType {
    eq() { return true; }
    toDOM() {
        const el = document.createElement("span");
        el.className = MUTE_BADGE_CLASS;
        el.textContent = "$mute:";
        el.style.setProperty("color", "#ff9933", "important");
        el.style.setProperty("font-weight", "bold", "important");
        el.style.setProperty("margin-left", "6px", "important");
        el.style.setProperty("margin-right", "6px", "important");
        el.style.setProperty("user-select", "none", "important");
        return el;
    }
    ignoreEvent() { return true; }
}

/**
 * Single shared widget decoration instance reused across
 * every muted binding. The widget itself is stateless so
 * one instance suffices regardless of how many bindings
 * are muted. side: 1 sorts the widget AFTER any content
 * at the same document position, so a widget added at the
 * end of a mark range (e.g. at colonPos + 1 for a
 * labelled-block tag) renders as a sibling of the mark
 * rather than inside it.
 */
const muteBadgeDecoration = Decoration.widget({
    widget: new MuteBadgeWidget(),
    side: 1,
});

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
 * selected canvas objects, for orphaned labelled blocks,
 * and for muted-object bindings. Returns a RangeSet
 * covering the $objectId: tags of labelled blocks plus
 * the function-name identifiers of callback function
 * declarations, each carrying either an active-tag or
 * orphan-tag class mark, and each muted binding
 * additionally getting a mute-badge widget inserted
 * immediately after the identifier.
 *
 * Class marks and widget decorations compose naturally:
 * the mark spans a text range and styles its contents,
 * the widget is a zero-length insertion at a single
 * position. A muted-and-selected binding gets BOTH an
 * active-tag mark (green identifier) AND a mute-badge
 * widget (amber pill after the identifier). The two
 * decorations don't interfere because they sit at
 * different layers in CodeMirror's decoration model.
 *
 * @param {import("@codemirror/view").EditorView} view
 * @param {Set<string> | null} selectedObjectIds
 * @param {Set<string> | null} knownObjectIds
 * @param {Set<string> | null} mutedObjectIds
 * @returns {import("@codemirror/state").RangeSet<any>}
 */
function computeDecorations(view, selectedObjectIds, knownObjectIds, mutedObjectIds) {
    const builder = new RangeSetBuilder();
    const noSelection = selectedObjectIds === null || selectedObjectIds.size === 0;
    const noKnown = knownObjectIds === null;
    const noMuted = mutedObjectIds === null || mutedObjectIds.size === 0;
    if (noSelection && noKnown && noMuted) {
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
    // source order, and within each iteration we add the
    // class mark first (starts at label.start or id.start)
    // and the widget second (at colonPos + 1 or id.end,
    // strictly later in the document), satisfying the
    // builder's non-decreasing-from requirement without
    // explicit sorting.
    for (const node of ast.body) {
        if (node.type === "LabeledStatement") {
            // Walk the chain of nested LabeledStatements
            // inward. A chained block like $A: $B: note(...)
            // parses as one outer LabeledStatement
            // (label = $A) whose body is another
            // LabeledStatement (label = $B) whose body
            // is the expression. Processing each $-
            // prefixed label individually means a
            // selected, orphaned, or muted inner label
            // gets its own active/orphan/mute treatment
            // independent of the outer label, which is
            // what makes per-label cursor mute (Cmd-
            // Shift-M on a specific label in a chain)
            // read correctly with the badge appearing
            // after the muted label alone. Non-$ labels
            // (regular JS labels mixed into a chain —
            // uncommon but possible) are skipped
            // without decoration but the walk continues
            // to inner labels. Labels are in strictly
            // increasing source position as we walk
            // inward (each label's body starts after
            // the outer label's colon), so the per-
            // label decoration adds satisfy
            // RangeSetBuilder's non-decreasing-from
            // requirement naturally.
            let current = node;
            while (current !== null &&
                   typeof current === "object" &&
                   current.type === "LabeledStatement") {
                const label = current.label;
                if (label === null ||
                    label.type !== "Identifier" ||
                    typeof label.name !== "string") {
                    break;
                }
                if (label.name.startsWith("$")) {
                    const objectId = label.name.slice(1);
                    // Find the colon between this label
                    // and its body explicitly so any
                    // whitespace between them does not
                    // become part of the styled range.
                    const colonPos = source.indexOf(":", label.end);
                    if (colonPos !== -1) {
                        // Active-tag and orphan-tag are
                        // mutually exclusive (a selected
                        // object exists in the scene, so
                        // its id is in knownObjectIds),
                        // so a single class name suffices
                        // per label.
                        let className = null;
                        if (selectedObjectIds !== null && selectedObjectIds.has(objectId)) {
                            className = ACTIVE_TAG_CLASS;
                        } else if (knownObjectIds !== null && !knownObjectIds.has(objectId)) {
                            className = ORPHAN_TAG_CLASS;
                        }
                        if (className !== null) {
                            builder.add(
                                label.start,
                                colonPos + 1,
                                Decoration.mark({ class: className }),
                            );
                        }
                        // Mute badge widget. Position is
                        // colonPos + 1 (immediately
                        // after the label's colon),
                        // which is the end of the
                        // active/orphan mark range so
                        // the widget renders as a
                        // sibling of the mark rather
                        // than inside it. The widget
                        // shows for muted bindings
                        // regardless of selection or
                        // known-id state; a muted-and-
                        // selected binding gets both
                        // the green identifier and the
                        // orange badge.
                        if (mutedObjectIds !== null && mutedObjectIds.has(objectId)) {
                            builder.add(colonPos + 1, colonPos + 1, muteBadgeDecoration);
                        }
                    }
                }
                current = current.body;
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
            // Function declarations get active-tag only —
            // never orphan-tag, see the module docstring
            // for why the slotName_objectId convention is
            // too unreliable for automatic orphan
            // detection. Highlight just the function-name
            // identifier (id.start to id.end); the
            // "function" keyword and parameter list stay
            // in their default syntax-highlighter colours.
            if (selectedObjectIds !== null && selectedObjectIds.has(objectId)) {
                builder.add(
                    id.start,
                    id.end,
                    Decoration.mark({ class: ACTIVE_TAG_CLASS }),
                );
            }
            // Mute badge widget. Position is id.end
            // (immediately after the function name), which
            // sits between the name and the opening
            // parenthesis. The CSS gives the badge a small
            // horizontal margin so it reads as a discrete
            // pill rather than crowding against either the
            // name or the parens.
            if (mutedObjectIds !== null && mutedObjectIds.has(objectId)) {
                builder.add(id.end, id.end, muteBadgeDecoration);
            }
        }
    }
    return builder.finish();
}

/**
 * Build the CodeMirror extension that maintains the
 * selection-driven source-binding highlight, orphan-
 * label flag, and inline mute-badge decorations. The
 * extension is a ViewPlugin holding three id sets:
 * selectedObjectIds (canvas selection), knownObjectIds
 * (all object ids in the current scene), and
 * mutedObjectIds (object ids with mute === true). Each
 * set updates when main.js dispatches the matching
 * effect. Doc changes trigger a recompute against the
 * existing sets (the user has changed the file but
 * neither the canvas selection nor the scene has
 * changed).
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
                /** @type {Set<string> | null} */
                this.mutedObjectIds = null;
                this.decorations = computeDecorations(
                    view,
                    this.selectedObjectIds,
                    this.knownObjectIds,
                    this.mutedObjectIds,
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
                        } else if (e.is(setMutedObjectIdsEffect)) {
                            this.mutedObjectIds = e.value;
                            stateChanged = true;
                        }
                    }
                }
                if (update.docChanged || stateChanged) {
                    this.decorations = computeDecorations(
                        update.view,
                        this.selectedObjectIds,
                        this.knownObjectIds,
                        this.mutedObjectIds,
                    );
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );
}
