/**
 * Cursor-target id derivation.
 *
 * Exports deriveCursorTargetIds(source, from, to, scene),
 * which inspects every top-level statement of behaviors.js
 * whose source range overlaps the editor's current
 * selection range and unions the object ids those
 * statements logically own. A bare cursor (no selection)
 * comes through as a zero-width range where from === to,
 * which the overlap test handles identically to the
 * single-position case it used to be: a node at
 * [node.start, node.end] overlaps [from, to] iff
 * node.start <= to && node.end >= from.
 *
 * Two top-level statement shapes contribute ids:
 *
 *   - A labelled pattern block (single label or a chain
 *     of dollar-prefixed labels) whose innermost body is
 *     an ExpressionStatement. Every chained label's id
 *     contributes.
 *
 *   - A FunctionDeclaration whose name appears in any
 *     curve, trigger, or sprite's hasHitFunction,
 *     beenHitFunction, or onTickFunction slot. Every
 *     binding object's id contributes.
 *
 * Any other top-level node (variable declaration, plain
 * expression statement, a non-pattern labelled block, etc.)
 * contributes nothing. A whole-file parse error or a null
 * scene returns an empty set; the syntax-error diagnostic
 * is surfaced separately by the editor's linter and by
 * the Run Scene path, so the highlight just dims silently
 * while the file is in a broken state.
 *
 * A selection that lies entirely in whitespace between
 * top-level statements highlights nothing: whitespace is
 * not part of any node's range, so the overlap test fails
 * for every node. A drag selection that spans a labelled
 * block in the middle (starting and ending in surrounding
 * whitespace) still highlights that block, because the
 * selection range overlaps the block's range.
 *
 * Commented-out labelled blocks (// $CRV1: ...) are
 * deliberately NOT detected. The cursor-target highlight
 * only follows live source ownership; the Cmd-Enter
 * clear-pattern path is what the comment-out gesture
 * routes through.
 */

// @ts-check

import * as acorn from "https://esm.sh/acorn@8";

/**
 * Function-reference slot names across all three object
 * kinds. The names match sceneSchema.functionRefFieldsFor's
 * output but are hardcoded here so this module stays
 * self-contained.
 */
const CALLBACK_FIELD_NAMES = [
    "hasHitFunction",
    "beenHitFunction",
    "onTickFunction",
];

/**
 * @param {string} source
 * @param {number} from
 * @param {number} to
 * @param {{curves: any[], triggers: any[], sprites: any[]} | null} scene
 * @returns {Set<string>}
 */
export function deriveCursorTargetIds(source, from, to, scene) {
    if (scene === null) return new Set();

    let ast;
    try {
        ast = acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
            locations: false,
        });
    } catch (err) {
        return new Set();
    }
    if (ast === null || !Array.isArray(ast.body)) return new Set();

    // Walk every top-level node whose source range overlaps
    // the selection. Inclusive on both ends so a selection
    // touching a node's opening or closing punctuation still
    // counts. Empty selection (from === to) reduces to the
    // single-position test exactly: a node overlaps iff
    // node.start <= cursorPos && node.end >= cursorPos.
    const result = new Set();
    for (const node of ast.body) {
        if (node.end < from || node.start > to) continue;
        _collectIdsFromNode(node, scene, result);
    }
    return result;
}

/**
 * Apply the labelled-block or function-declaration logic
 * to a single top-level node and accumulate any contributed
 * ids into result. A node that doesn't match either shape,
 * or matches but fails the validity check (chain with a
 * non-dollar-prefixed label, chain not terminating at an
 * ExpressionStatement, function declaration with no
 * binding object), contributes nothing.
 *
 * @param {any} node
 * @param {{curves: any[], triggers: any[], sprites: any[]}} scene
 * @param {Set<string>} result
 */
function _collectIdsFromNode(node, scene, result) {
    // Labelled-block path. Walk the chain inward, collecting
    // every dollar-prefixed label. The chain must terminate
    // at an ExpressionStatement for the block to count as a
    // pattern block, mirroring the detection in editor.js's
    // _tryPromoteLabelledBlock.
    if (node.type === "LabeledStatement") {
        const ids = [];
        let current = node;
        while (current !== null && current.type === "LabeledStatement") {
            const lbl = current.label;
            if (lbl === null ||
                lbl.type !== "Identifier" ||
                typeof lbl.name !== "string" ||
                !lbl.name.startsWith("$")) {
                return;
            }
            ids.push(lbl.name.slice(1));
            current = current.body;
        }
        if (current === null || current.type !== "ExpressionStatement") {
            return;
        }
        for (const id of ids) result.add(id);
        return;
    }

    // Function-declaration path. Look up the function name
    // across every object's three function-reference slots
    // and accumulate the object ids that bind it. The
    // runtime Scene objects store hasHitFunction /
    // beenHitFunction / onTickFunction as string names; the
    // simulation resolves those names against the Scene's
    // functionMap at fire time, but the names themselves
    // stay on the objects, which is what we compare against
    // here.
    if (node.type === "FunctionDeclaration" &&
        node.id !== null &&
        typeof node.id.name === "string" &&
        node.id.name.length > 0) {
        const fnName = node.id.name;
        const arrays = [
            Array.isArray(scene.curves) ? scene.curves : [],
            Array.isArray(scene.triggers) ? scene.triggers : [],
            Array.isArray(scene.sprites) ? scene.sprites : [],
        ];
        for (const arr of arrays) {
            for (const obj of arr) {
                if (typeof obj.id !== "string") continue;
                for (const slot of CALLBACK_FIELD_NAMES) {
                    if (obj[slot] === fnName) {
                        result.add(obj.id);
                        break;
                    }
                }
            }
        }
    }
}
