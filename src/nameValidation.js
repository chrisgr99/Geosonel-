/**
 * Object-name validation.
 *
 * Names are optional user-typed identifiers for sprites,
 * triggers, and curves. When set, they double as code-level
 * handles in behaviours.js (getSprite/getTrigger/getCurve
 * lookups), so they have to be valid JavaScript identifiers
 * to work in that role. The validation here is consulted by
 * the property inspector before committing a name edit, and
 * is conservative: ambiguous cases are rejected so a typed
 * name that survives validation is guaranteed to work as a
 * code handle.
 *
 * Validation has two outcomes that aren't simple pass-or-fail.
 * Hard-block: the name is malformed (not an identifier, a
 * reserved word, or a string in the reserved id-format
 * pattern). The commit is refused; the inspector marks the
 * field with a red squiggle and keeps focus so the user can
 * fix it. Soft-block: the name is well-formed but already
 * used by another object in the score. The commit goes
 * through anyway; the inspector marks both objects' Name
 * fields with a yellow squiggle until one is changed to
 * something unique.
 *
 * Empty string is the "no name" state and is always valid.
 * Leading and trailing whitespace are trimmed before
 * validation, so " drum " is accepted as "drum"; internal
 * whitespace fails the identifier check.
 */

// @ts-check

import { GENERATED_ID_PATTERN } from "./idGen.js";

/**
 * JS identifier pattern: leading letter, underscore, or
 * dollar sign, followed by alphanumerics, underscores, or
 * dollar signs. Conservative — Unicode identifier characters
 * are technically allowed by the JS spec but cause more
 * trouble than they're worth as code handles.
 */
const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * JavaScript reserved words that can't be used as identifiers.
 * Includes current keywords, future-reserved words, strict-
 * mode reserved words, and the boolean and null literals.
 * Kept inclusive: better to reject a few rare-but-legal
 * names than to let through one that breaks behaviours.js
 * when used as a code handle.
 */
const RESERVED_WORDS = new Set([
    // Current keywords
    "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "export", "extends", "finally",
    "for", "function", "if", "import", "in", "instanceof", "let", "new",
    "of", "return", "super", "switch", "this", "throw", "try", "typeof",
    "var", "void", "while", "with", "yield",
    // Future reserved
    "await", "enum", "implements", "interface", "package", "private",
    "protected", "public", "static",
    // Strict-mode reserved
    "arguments", "eval",
    // Literals
    "true", "false", "null", "undefined",
    // Globals worth keeping clear of
    "globalThis", "self",
]);

/**
 * Validate a candidate name.
 *
 * Returns one of three outcomes via the `kind` field:
 *   - "ok": name is valid; commit it.
 *   - "soft": name is valid but conflicts with another
 *     object's name; commit it but mark the field with a
 *     yellow conflict squiggle.
 *   - "hard": name is invalid; refuse the commit and mark
 *     the field with a red error squiggle.
 *
 * The returned `value` is the name that should actually be
 * stored — for "ok" and "soft" outcomes it's the trimmed
 * candidate; for "hard" it's the empty string (defensive).
 *
 * @param {string} candidate  The user-typed name, possibly
 *                            with surrounding whitespace.
 * @param {Map<string, string>} otherNames  Map of id → name
 *                            for all other objects in the
 *                            score (excluding the one being
 *                            named). Used for the duplicate
 *                            check.
 * @returns {{ kind: "ok", value: string }
 *          | { kind: "soft", value: string, message: string }
 *          | { kind: "hard", value: string, message: string }}
 */
export function validateName(candidate, otherNames) {
    const trimmed = candidate.trim();

    // Empty name is always valid — "no name" state.
    if (trimmed === "") {
        return { kind: "ok", value: "" };
    }

    // Reserved id-format pattern: catch sp_a3f7e2-style names
    // that would shadow generated ids if used as handles.
    if (GENERATED_ID_PATTERN.test(trimmed)) {
        return {
            kind: "hard",
            value: "",
            message: `"${trimmed}" matches the auto-generated id format and is reserved.`,
        };
    }

    // JavaScript identifier check.
    if (!IDENTIFIER_PATTERN.test(trimmed)) {
        return {
            kind: "hard",
            value: "",
            message: `"${trimmed}" is not a valid JavaScript identifier (letters, digits, underscore, dollar sign; can't start with a digit).`,
        };
    }

    // Reserved-word check.
    if (RESERVED_WORDS.has(trimmed)) {
        return {
            kind: "hard",
            value: "",
            message: `"${trimmed}" is a JavaScript reserved word and can't be used as a name.`,
        };
    }

    // Duplicate check against other objects' names.
    for (const otherName of otherNames.values()) {
        if (otherName === trimmed) {
            return {
                kind: "soft",
                value: trimmed,
                message: `"${trimmed}" is already used by another object.`,
            };
        }
    }

    return { kind: "ok", value: trimmed };
}

/**
 * Build a map of id → name for every object in a runtime
 * Scene, optionally excluding one object by id (used by the
 * inspector to exclude the currently-edited object from its
 * own duplicate check). Empty names are omitted since they
 * never trigger duplicates with each other.
 *
 * @param {import("./scene.js").Scene | null} scene
 * @param {string | null} [excludeId]
 * @returns {Map<string, string>}
 */
export function collectOtherNames(scene, excludeId) {
    /** @type {Map<string, string>} */
    const out = new Map();
    if (scene === null) return out;
    for (const arr of [scene.sprites, scene.triggers, scene.curves]) {
        for (const obj of arr) {
            if (typeof obj.id !== "string") continue;
            if (excludeId !== undefined && excludeId !== null && obj.id === excludeId) continue;
            if (typeof obj.name !== "string" || obj.name.length === 0) continue;
            out.set(obj.id, obj.name);
        }
    }
    return out;
}

/**
 * Whether the given name conflicts with another object's
 * name in the scene (excluding the object identified by
 * excludeId). Used by the read path's render to decide
 * whether to show the yellow conflict squiggle on a name
 * that's already been committed.
 *
 * @param {string} name
 * @param {import("./scene.js").Scene | null} scene
 * @param {string | null} excludeId
 * @returns {boolean}
 */
export function nameConflictsInScene(name, scene, excludeId) {
    if (typeof name !== "string" || name.length === 0) return false;
    const others = collectOtherNames(scene, excludeId);
    for (const otherName of others.values()) {
        if (otherName === name) return true;
    }
    return false;
}
