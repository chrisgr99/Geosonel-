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
 * meaningful only for cycleSpeeds, where it separates
 * tokens. Other fields fail their character-set checks if
 * internal whitespace is present.
 */

// @ts-check

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
 * length need not match. Empty string is allowed but soft-
 * warns since it would mute the curve's rhythm. Other
 * characters and internal whitespace are hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateActiveBeats(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "soft", value: "",
            message: "Empty Active Beats mutes the curve's rhythm.",
        };
    }
    if (!/^[x.]+$/.test(trimmed)) {
        return {
            kind: "hard", value: "",
            message: 'Active Beats may contain only "x" (active) and "." (inactive).',
        };
    }
    return { kind: "ok", value: trimmed };
}

/**
 * Validate Beat Strength. Runtime value is a digit string
 * 0-9, cycling independently of activeBeats. Empty string
 * is allowed but soft-warns since it would mute the
 * curve's beats. Non-digit characters and internal
 * whitespace are hard-blocked.
 *
 * @param {string} candidate
 * @returns {ValidationResult}
 */
export function validateStrength(candidate) {
    const trimmed = candidate.trim();
    if (trimmed === "") {
        return {
            kind: "soft", value: "",
            message: "Empty Beat Strength mutes the curve's beats.",
        };
    }
    if (!/^[0-9]+$/.test(trimmed)) {
        return {
            kind: "hard", value: "",
            message: "Beat Strength may contain only digits 0-9.",
        };
    }
    return { kind: "ok", value: trimmed };
}
