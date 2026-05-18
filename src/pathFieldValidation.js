/**
 * Path field validation.
 *
 * Validators for the editable fields the inspector still
 * surfaces. v2.5 dropped the v2.4 deferred rhythm fields
 * (beatInterval, beatsPerBar, beatOffset, cycleSpeeds,
 * beatPointsMode, activeBeatsCount, beatShift, repeats,
 * activeBeats, strength); the validators that served them
 * have been removed along with the schema fields. The
 * cycleDuration validator went too — its v2.4 integer-
 * rounding semantics no longer match the new floating-
 * point Rate field; the inspector-wiring commit will add
 * a number-aware replacement when it surfaces the Rate
 * row. What remains here: validateStopAtCycle plus the
 * general-purpose validateNumber, validateHexColor, and
 * validateFunctionName.
 *
 * The file is named after paths (rather than bound
 * sprites specifically) because path-authoring is the
 * user-facing concept these validators support.
 *
 * Each validator returns the same {kind, value, message?}
 * shape used by name validation:
 *   - "ok": value is acceptable; commit it.
 *   - "soft": value is acceptable but unusual; commit it
 *     and mark the field with a yellow squiggle.
 *   - "hard": value is invalid; refuse the commit and mark
 *     the field with a red squiggle.
 *
 * The returned `value` is the canonicalised string form
 * suitable for storage (after trimming, integer rounding,
 * etc.). The inspector's edit dispatch uses it as both
 * the comparison value (against the original displayed
 * string) and the payload value sent through to the
 * sceneEditor function. The sceneEditor function converts
 * to runtime type where needed (e.g. numeric for
 * stopAtCycle).
 */

// @ts-check

import { IDENTIFIER_PATTERN, RESERVED_WORDS } from "./nameValidation.js";

/**
 * Validation result returned by every validator.
 * @typedef {{ kind: "ok", value: string }
 *         | { kind: "soft", value: string, message: string }
 *         | { kind: "hard", value: string, message: string }} ValidationResult
 */

/**
 * Validate Stop at Cycle. Runtime value is an integer with
 * -1 as the play-forever sentinel. Positive integers halt
 * the cursor after that many cycles; non-(-1) negatives are
 * functionally equivalent to -1 and soft-warn (probably
 * typed by mistake). Non-integer numeric input is rounded
 * with a soft warning. Non-numeric and empty input are
 * hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateStopAtCycle(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Stop at Cycle is required (use -1 for play forever).",
        };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a number.`,
        };
    }
    const rounded = Math.round(n);
    const roundedStr = String(rounded);
    const wasIntegerInput = (n === rounded);
    if (rounded < -1) {
        return {
            kind: "soft", value: roundedStr,
            message: `Stop at Cycle of ${rounded} behaves like -1 (play forever); use -1 if that's what you meant.`,
        };
    }
    if (!wasIntegerInput) {
        return {
            kind: "soft", value: roundedStr,
            message: `Stop at Cycle must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: roundedStr };
}

/**
 * General-purpose numeric validator used by Band 2 (Position,
 * sizes, cursor extents, thicknesses, path W/H). Empty input
 * is hard-blocked since every Band 2 field requires a value;
 * non-numeric input is hard-blocked; out-of-range input
 * (when min or max are supplied) is hard-blocked. Non-integer
 * input on an integer-typed field soft-warns and rounds.
 *
 * Despite living alongside the path-specific validators in
 * this file, validateNumber is general-purpose and is used
 * across object kinds. The file name reflects path-authoring
 * being the dominant consumer rather than the strict scope.
 *
 * @param {string} candidate
 * @param {{ min?: number, max?: number, maxExclusive?: boolean, integer?: boolean }} [opts]
 * @returns {ValidationResult}
 */
export function validateNumber(candidate, opts) {
    const o = opts || {};
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "A number is required.",
        };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a number.`,
        };
    }
    if (typeof o.min === "number" && n < o.min) {
        return {
            kind: "hard", value: "",
            message: `Must be at least ${o.min}.`,
        };
    }
    if (typeof o.max === "number") {
        if (o.maxExclusive) {
            if (n >= o.max) {
                return {
                    kind: "hard", value: "",
                    message: `Must be less than ${o.max}.`,
                };
            }
        } else if (n > o.max) {
            return {
                kind: "hard", value: "",
                message: `Must be at most ${o.max}.`,
            };
        }
    }
    if (o.integer && n !== Math.round(n)) {
        const rounded = Math.round(n);
        return {
            kind: "soft", value: String(rounded),
            message: `Rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: String(n) };
}

/**
 * Validate a CSS hex colour. Accepts "#RRGGBB" form (with or
 * without the leading #, with case-insensitive hex digits)
 * and canonicalises to lowercase "#rrggbb". The 3-digit short
 * form ("#abc") is also accepted and expanded to 6 digits.
 * Empty input and other formats are hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateHexColor(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "A colour is required.",
        };
    }
    const stripped = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    if (/^[0-9a-fA-F]{3}$/.test(stripped)) {
        // Expand short form: "abc" → "aabbcc".
        const expanded =
            stripped[0] + stripped[0] +
            stripped[1] + stripped[1] +
            stripped[2] + stripped[2];
        return { kind: "ok", value: "#" + expanded.toLowerCase() };
    }
    if (/^[0-9a-fA-F]{6}$/.test(stripped)) {
        return { kind: "ok", value: "#" + stripped.toLowerCase() };
    }
    return {
        kind: "hard", value: "",
        message: `"${trimmed}" is not a hex colour (expected #RRGGBB).`,
    };
}

/**
 * Validate a function-name binding for the inspector's
 * Behaviours band slot fields. In v2.5 every callback slot
 * (motionUpdate, cycle, hitTrigger, collision, hitBeat,
 * auto) lives on the unified Sprite class and uses this
 * validator to gate input. Runtime value is either the
 * empty string (slot unbound) or a valid JavaScript
 * identifier matching a top-level function in the score's
 * behaviors.js file. The validator checks identifier
 * syntax and reserved-word membership; resolution against
 * functionMap happens at fire time, not commit time, so a
 * name that doesn't yet exist in behaviors.js still passes
 * validation here — the soft-error model in the loader
 * (DESIGN.md §9) lets the slot stay inert until the user
 * types the function body, without blocking the bind.
 *
 * Empty string is valid (the unbound state). Names that
 * fail the identifier check or match a reserved word are
 * hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateFunctionName(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return { kind: "ok", value: "" };
    }
    if (!IDENTIFIER_PATTERN.test(trimmed)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a valid JavaScript identifier (letters, digits, underscore, dollar sign; can't start with a digit).`,
        };
    }
    if (RESERVED_WORDS.has(trimmed)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is a JavaScript reserved word and can't be used as a function name.`,
        };
    }
    return { kind: "ok", value: trimmed };
}
