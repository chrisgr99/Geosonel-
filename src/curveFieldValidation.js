/**
 * Curve field validation.
 *
 * Validators for the editable curve fields in Band 5 (Active
 * Beats, Beat Strength) and Band 6 (Cycle Duration, Cycle
 * Speeds, Stop at Cycle). Each validator returns the same
 * {kind, value, message?} shape used by name validation:
 *   - "ok": value is acceptable; commit it.
 *   - "soft": value is acceptable but unusual; commit it
 *     and mark the field with a yellow squiggle.
 *   - "hard": value is invalid; refuse the commit and mark
 *     the field with a red squiggle.
 *
 * The returned `value` is the canonicalised string form
 * suitable for storage (after trimming, integer rounding,
 * etc.). The inspector's edit dispatch uses it as both the
 * comparison value (against the original displayed string)
 * and the payload value sent through to the sceneEditor
 * function. The sceneEditor function converts to runtime
 * type where needed (e.g. numeric for cycleDuration and
 * stopAtCycle).
 *
 * Trim semantics: leading and trailing whitespace are
 * trimmed before validation. Internal whitespace is
 * meaningful in cycleSpeeds (token separator) and is
 * tolerated as formatting in activeBeats and strength
 * (where it is stripped before the character-set check
 * but preserved in the returned value alongside any
 * inspector-inserted pipes). Other fields fail their
 * character-set checks if internal whitespace is
 * present.
 */

// @ts-check

import { isValidBeatInterval } from "./beatIntervals.js";
import { IDENTIFIER_PATTERN, RESERVED_WORDS } from "./nameValidation.js";

/**
 * Validation result returned by every validator.
 * @typedef {{ kind: "ok", value: string }
 *         | { kind: "soft", value: string, message: string }
 *         | { kind: "hard", value: string, message: string }} ValidationResult
 */

/**
 * Validate Cycle Duration. Runtime value is a positive
 * integer in score beats. Non-integer numeric input is
 * accepted with a soft warning and rounded; zero, negative,
 * non-numeric, and empty input are hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateCycleDuration(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Cycle Duration is required.",
        };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a number.`,
        };
    }
    if (n < 1) {
        return {
            kind: "hard", value: "",
            message: "Cycle Duration must be at least 1 beat.",
        };
    }
    const rounded = Math.round(n);
    const roundedStr = String(rounded);
    if (n !== rounded) {
        return {
            kind: "soft", value: roundedStr,
            message: `Cycle Duration must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: roundedStr };
}

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
 * Validate Cycle Speeds. Runtime value is a string of
 * whitespace-separated floats, each a multiplier applied to
 * cycleDuration on its respective cycle (cycling through
 * the list cycle by cycle). Negative values reverse
 * direction; zero would freeze the cursor for that cycle
 * and soft-warns. Empty input and non-numeric tokens are
 * hard-blocked. Internal whitespace is canonicalised to
 * single spaces in the returned value.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateCycleSpeeds(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: 'Cycle Speeds is required (use "1" for uniform pacing).',
        };
    }
    const tokens = trimmed.split(/\s+/);
    /** @type {number[]} */
    const parsed = [];
    for (const tok of tokens) {
        const n = Number(tok);
        if (!Number.isFinite(n)) {
            return {
                kind: "hard", value: "",
                message: `"${tok}" is not a number.`,
            };
        }
        parsed.push(n);
    }
    const canonical = tokens.join(" ");
    if (parsed.some((n) => n === 0)) {
        return {
            kind: "soft", value: canonical,
            message: "A zero in Cycle Speeds freezes the cursor for that cycle.",
        };
    }
    return { kind: "ok", value: canonical };
}

/**
 * Validate Active Beats. Runtime value is a string of "x"
 * (active beat) and "." (inactive beat) characters; the
 * string cycles independently of cycleDuration so its
 * length need not match. Pipe characters are inspector-
 * inserted display formatting and are preserved through
 * the round-trip per DESIGN.md §10 ("Spaces and pipes are
 * formatting characters preserved in the JSON exactly as
 * the inspector renders them"); whitespace is also
 * tolerated for backward compatibility with legacy data
 * predating the no-whitespace activeBeats rule. The
 * character-set check runs against a stripped copy with
 * pipes and whitespace removed; the returned value is the
 * trimmed candidate with formatting intact, so re-loading
 * the score reproduces the same visual structure the
 * user typed. A candidate that strips to empty (empty
 * string, or only pipes / whitespace) soft-warns since
 * the curve's rhythm would be muted, and returns the
 * empty string as the canonical no-content form. Other
 * characters are hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateActiveBeats(candidate) {
    const trimmed = candidate.trim();
    // Strip pipes and whitespace before the character-set
    // check. Pipes are display-only formatting that the
    // inspector inserts at bar boundaries; whitespace is
    // tolerated here for legacy data even though current
    // inspector input rules keep activeBeats free of it.
    const stripped = trimmed.replace(/[|\s]/g, "");
    if (stripped === "") {
        return {
            kind: "soft", value: "",
            message: "Empty Active Beats mutes the curve's rhythm.",
        };
    }
    if (!/^[x.]+$/.test(stripped)) {
        return {
            kind: "hard", value: "",
            message: 'Active Beats may contain only "x" (active) and "." (inactive).',
        };
    }
    return { kind: "ok", value: trimmed };
}

/**
 * Validate Beat Strength. Runtime value is a digit string
 * 0-9, cycling independently of activeBeats. Pipe
 * characters and single-space separators are tolerated as
 * inspector-inserted display formatting and pass through
 * unchanged in the returned value (the inspector's
 * pipe-display rule and strength canonicalisation
 * preserve them across round-trip per DESIGN.md §10). The
 * character-set check runs against a stripped copy with
 * pipes and whitespace removed; the returned value is the
 * trimmed candidate with formatting intact. A candidate
 * that strips to empty soft-warns since the curve's beats
 * would be muted, and returns the empty string as the
 * canonical no-content form. Non-digit characters are
 * hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateStrength(candidate) {
    const trimmed = candidate.trim();
    // Strip pipes and whitespace before the character-set
    // check. Pipes are display-only formatting at bar
    // boundaries; spaces are user-typed visual separators
    // preserved through the round-trip.
    const stripped = trimmed.replace(/[|\s]/g, "");
    if (stripped === "") {
        return {
            kind: "soft", value: "",
            message: "Empty Beat Strength mutes the curve's beats.",
        };
    }
    if (!/^[0-9]+$/.test(stripped)) {
        return {
            kind: "hard", value: "",
            message: "Beat Strength may contain only digits 0-9.",
        };
    }
    return { kind: "ok", value: trimmed };
}

/**
 * General-purpose numeric validator used by Band 2 (Position,
 * sizes, cursor extents, thicknesses, curve W/H). Empty input
 * is hard-blocked since every Band 2 field requires a value;
 * non-numeric input is hard-blocked; out-of-range input
 * (when min or max are supplied) is hard-blocked. Non-integer
 * input on an integer-typed field soft-warns and rounds.
 *
 * Despite living alongside the curve-specific validators in
 * this file, validateNumber is general-purpose and is used
 * across object kinds. The file name reflects history rather
 * than current scope.
 *
 * @param {string} candidate
 * @param {{ min?: number, max?: number, integer?: boolean }} [opts]
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
    if (typeof o.max === "number" && n > o.max) {
        return {
            kind: "hard", value: "",
            message: `Must be at most ${o.max}.`,
        };
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
 * Validate Beat Interval. Runtime value is a token from the
 * fixed list in beatIntervals.js (e.g. "Qtr", "16th",
 * "Dot 8th"). Empty input is hard-blocked; unknown tokens
 * are hard-blocked. The validator does no canonicalisation
 * — tokens are case-sensitive matches against the table.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateBeatInterval(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Beat Interval is required.",
        };
    }
    if (!isValidBeatInterval(trimmed)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a recognised beat interval.`,
        };
    }
    return { kind: "ok", value: trimmed };
}

/**
 * Validate Beats/Bar. Runtime value is a positive integer
 * naming the numerator of the curve's time signature. Non-
 * integer numeric input is rounded with a soft warning;
 * zero, negative, non-numeric, and empty input are
 * hard-blocked. No upper cap (a curve with very large
 * Beats/Bar is unusual but not invalid; the inspector's
 * pipe-display rule still works at any value).
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateBeatsPerBar(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Beats/Bar is required.",
        };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a number.`,
        };
    }
    if (n < 1) {
        return {
            kind: "hard", value: "",
            message: "Beats/Bar must be at least 1.",
        };
    }
    const rounded = Math.round(n);
    const roundedStr = String(rounded);
    if (n !== rounded) {
        return {
            kind: "soft", value: roundedStr,
            message: `Beats/Bar must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: roundedStr };
}

/**
 * Validate Beat Offset. Runtime value is a signed integer
 * giving the slot offset between the curve's slot 0 and the
 * cursor's position at score-beat zero. Any integer is
 * accepted (the engine takes mod cycleDuration); non-integer
 * numeric input rounds with a soft warning; non-numeric and
 * empty input are hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateBeatOffset(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Beat Offset is required (use 0 for no offset).",
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
    if (n !== rounded) {
        return {
            kind: "soft", value: roundedStr,
            message: `Beat Offset must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: roundedStr };
}

/**
 * Validate Curve Beat Points mode. Runtime value is one of
 * "normal", "euclidean", or "none". Empty input and
 * unrecognised values are hard-blocked. Case-sensitive
 * match against the enum.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateBeatPointsMode(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "normal" || trimmed === "euclidean" || trimmed === "none") {
        return { kind: "ok", value: trimmed };
    }
    return {
        kind: "hard", value: "",
        message: `"${trimmed}" is not a recognised beat-points mode (expected normal, euclidean, or none).`,
    };
}

/**
 * Validate Active Beats count (the Euclidean parameter, not
 * the activeBeats string). Runtime value is an integer in
 * [0, cycleDuration]. Out-of-range values silently clamp
 * with a soft warning so the user can type freely without
 * being rejected; non-integer input rounds with a soft
 * warning; non-numeric and empty input are hard-blocked.
 *
 * The cycleDuration argument provides the upper bound for
 * clamping; pass the curve's current cycleDuration so the
 * clamp matches the slot count the count will be
 * distributed across.
 *
 * @param {string} candidate
 * @param {number} cycleDuration
 * @returns {ValidationResult}
 */
export function validateActiveBeatsCount(candidate, cycleDuration) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Active Beats count is required.",
        };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a number.`,
        };
    }
    const upper = Math.max(0, Math.round(cycleDuration));
    const rounded = Math.round(n);
    const wasIntegerInput = (n === rounded);
    if (rounded < 0) {
        return {
            kind: "soft", value: "0",
            message: "Active Beats count clamped to 0 (cannot be negative).",
        };
    }
    if (rounded > upper) {
        return {
            kind: "soft", value: String(upper),
            message: `Active Beats count clamped to ${upper} (cannot exceed cycle length).`,
        };
    }
    if (!wasIntegerInput) {
        return {
            kind: "soft", value: String(rounded),
            message: `Active Beats count must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: String(rounded) };
}

/**
 * Validate Beat Shift (the Euclidean parameter). Runtime
 * value is a signed integer naming a rotational offset in
 * slots. Any integer is accepted (the generator takes mod
 * cycleDuration); non-integer numeric input rounds with a
 * soft warning; non-numeric and empty input are
 * hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateBeatShift(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Beat Shift is required (use 0 for no shift).",
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
    if (n !== rounded) {
        return {
            kind: "soft", value: roundedStr,
            message: `Beat Shift must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: roundedStr };
}

/**
 * Validate Repeats (the Euclidean parameter). Runtime value
 * is a positive integer in [1, cycleDuration]. Out-of-range
 * values silently clamp with a soft warning; non-integer
 * input rounds with a soft warning; non-numeric and empty
 * input are hard-blocked. The cycleDuration argument bounds
 * the clamp.
 *
 * @param {string} candidate
 * @param {number} cycleDuration
 * @returns {ValidationResult}
 */
export function validateRepeats(candidate, cycleDuration) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "hard", value: "",
            message: "Repeats is required.",
        };
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
        return {
            kind: "hard", value: "",
            message: `"${trimmed}" is not a number.`,
        };
    }
    const upper = Math.max(1, Math.round(cycleDuration));
    const rounded = Math.round(n);
    const wasIntegerInput = (n === rounded);
    if (rounded < 1) {
        return {
            kind: "soft", value: "1",
            message: "Repeats clamped to 1 (must be at least 1).",
        };
    }
    if (rounded > upper) {
        return {
            kind: "soft", value: String(upper),
            message: `Repeats clamped to ${upper} (cannot exceed cycle length).`,
        };
    }
    if (!wasIntegerInput) {
        return {
            kind: "soft", value: String(rounded),
            message: `Repeats must be an integer; rounded to ${rounded}.`,
        };
    }
    return { kind: "ok", value: String(rounded) };
}

/**
 * Validate a function-name binding for Band 3's slot fields
 * (Sprite Motion Update / Auto, Trigger Collision / Auto,
 * Curve Hit Beat / Hit Trigger). Runtime value is either
 * the empty string (slot unbound) or a valid JavaScript
 * identifier matching a top-level function in the score's
 * behaviors.js file. The validator checks identifier syntax
 * and reserved-word membership; resolution against
 * functionMap happens at fire time, not commit time, so a
 * name that doesn't yet exist in behaviors.js still passes
 * validation here — the soft-error model in the loader
 * (DESIGN.md §9) lets the slot stay inert until the user
 * types the function body, without blocking the bind.
 *
 * Empty string is valid (the unbound state). Names that
 * fail the identifier check or match a reserved word are
 * hard-blocked. Names that match the auto-generated id
 * pattern (sp_xxxxxx etc.) are accepted here but soft-warn
 * — they're legal identifiers and would work as function
 * names, but they're easy to confuse with object ids in
 * the JSON, so the yellow squiggle cues the user to pick a
 * less ambiguous name.
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
