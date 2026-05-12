/**
 * Strudel pattern expression parsing for the cyclePattern
 * field.
 *
 * Parses a strudel pattern expression — a JavaScript
 * expression that evaluates to a strudel Pattern — into
 * the fractional cycle positions of one cycle's events.
 * The expression is a pattern-constructor function call
 * like note("c d e f") or s("bd sn"), with any chained
 * modifiers like .fast(2), .every(4, rev), .gain(0.7),
 * .s("piano"). The string argument inside the constructor
 * call is mini-notation; the constructor functions handle
 * the mini-parsing internally. This shape lets the user
 * express the full strudel API (sound selection,
 * modulation, repetition, alternation) directly rather
 * than being limited to bare mini-notation.
 *
 * Evaluation. The expression is evaluated through the
 * Function constructor in the global scope, where
 * strudel's pattern-constructor functions (note, s, n,
 * stack, cat, mini, ...) are installed as window globals
 * by StrudelRuntime.init's call to initStrudel. Without
 * those globals — that is, before the user has clicked
 * Load Engine in the transport bar — the parser surfaces
 * a friendly "Load Engine first" message rather than a
 * raw "note is not defined" ReferenceError.
 *
 * Validation. A successfully-evaluated expression must
 * produce a strudel Pattern, identifiable by the presence
 * of a queryArc method. Anything else (a number, a
 * string, a Hap array from accidentally calling queryArc
 * inside the expression) is reported as
 * "expression did not produce a Pattern". Once a Pattern
 * is in hand, queryArc(0, 1) gives the events for one
 * cycle and we extract their fractional begin positions
 * for downstream consumers.
 *
 * Use site. Called by main.js's Cmd-Enter promote-pattern
 * handler when the user presses Cmd-Enter on a labelled
 * $objectId: expression block in the Code tab (Stage A4
 * of the section-28 pattern-authoring sequence). On
 * parse success the positions are logged to the GXW
 * console and the body text is written to the matched
 * object's cyclePattern field; on parse failure the
 * diagnostic is logged and the scene mutation is skipped.
 * The cached parsed Pattern is not yet stored on the
 * source object; a future stage will add parse-on-promote
 * caching for downstream marker rendering.
 */

// @ts-check

const STRUDEL_NOT_LOADED_ERROR =
    "strudel engine not loaded; click Load Engine in the transport bar";

/**
 * @typedef {Object} ParsedHap
 * @property {number} begin  Fractional cycle position where the event starts.
 * @property {number} end    Fractional cycle position where the event ends.
 * @property {any} value     The event's value (e.g. {note: 60} or {s: "bd"}).
 *
 * @typedef {Object} ParseSuccess
 * @property {true} ok
 * @property {number[]} positions  The fractional begin positions, filtered to [0, 1).
 * @property {ParsedHap[]} haps    Full Hap details for downstream consumers.
 * @property {any} pattern         The compiled strudel Pattern object. Carries
 *                                 a queryArc method so callers that need event
 *                                 lists for cycles other than the unit interval
 *                                 (e.g. the firing engine querying the current
 *                                 per-source cycle counter) can do so directly
 *                                 against this object rather than re-parsing.
 *                                 Use sites that only need marker positions can
 *                                 ignore this field.
 *
 * @typedef {Object} ParseFailure
 * @property {false} ok
 * @property {string} error
 *
 * @typedef {ParseSuccess | ParseFailure} ParseResult
 */

/**
 * Parse a strudel pattern expression string and compute
 * the fractional cycle positions of one cycle's events.
 *
 * Empty or whitespace-only input is treated as an explicit
 * "no pattern" state, which parses successfully as an
 * empty event list. Anything else is evaluated as a
 * JavaScript expression in the global scope where
 * strudel's pattern-constructor functions live; the
 * resulting Pattern is queried for its first cycle and
 * the begin positions are extracted.
 *
 * @param {string} expressionString
 * @returns {ParseResult}
 */
export function parsePatternToPositions(expressionString) {
    if (typeof expressionString !== "string" || expressionString.trim() === "") {
        return { ok: true, positions: [], haps: [], pattern: null };
    }
    // Strudel pattern constructors (note, s, n, stack, ...) are
    // installed as window globals by StrudelRuntime.init's call
    // to initStrudel. Detecting their absence here lets us
    // surface a clear "click Load Engine" message rather than a
    // raw ReferenceError that would say "note is not defined"
    // and require the user to know that means the engine
    // has not been loaded yet.
    if (typeof (/** @type {any} */ (window).note) !== "function") {
        return { ok: false, error: STRUDEL_NOT_LOADED_ERROR };
    }
    let pattern;
    try {
        // Function constructor evaluates in the global scope,
        // so window globals are accessible without needing to
        // be passed as named arguments. The expression is
        // wrapped in parentheses so expressions starting with
        // a brace (e.g. an object literal) are not mistaken
        // for a function body.
        const fn = new Function(`return (${expressionString});`);
        pattern = fn();
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    if (pattern === null || pattern === undefined) {
        return { ok: false, error: "expression returned null or undefined" };
    }
    if (typeof pattern.queryArc !== "function") {
        return { ok: false, error: "expression did not produce a Pattern" };
    }
    let haps;
    try {
        haps = pattern.queryArc(0, 1);
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    if (!Array.isArray(haps)) {
        return { ok: false, error: "queryArc did not return an array" };
    }
    /** @type {ParsedHap[]} */
    const parsed = [];
    /** @type {number[]} */
    const positions = [];
    for (const hap of haps) {
        const begin = hapBoundary(hap, "begin");
        const end = hapBoundary(hap, "end");
        if (!Number.isFinite(begin) || !Number.isFinite(end)) continue;
        parsed.push({ begin, end, value: hap.value });
        // Position list filters to events that begin within
        // the unit cycle. queryArc may return Haps that span
        // the cycle boundary (begin < 0 or begin >= 1) for
        // patterns with cross-cycle modifiers; those are
        // valid Haps but their visual marker belongs to a
        // neighbouring cycle, not this one.
        if (begin >= 0 && begin < 1) positions.push(begin);
    }
    return { ok: true, positions, haps: parsed, pattern };
}

/**
 * Read a boundary (begin or end) from a strudel Hap.
 * Strudel exposes the event extent in two TimeSpan fields:
 * whole (the event's full span) and part (the portion
 * contained in the queried arc). For one-cycle queries
 * against standard patterns the two agree; whole is
 * preferred, with part as a fallback.
 *
 * @param {any} hap
 * @param {"begin" | "end"} key
 * @returns {number}
 */
function hapBoundary(hap, key) {
    if (hap === null || typeof hap !== "object") return NaN;
    if (hap.whole && typeof hap.whole === "object" && key in hap.whole) {
        return Number(hap.whole[key]);
    }
    if (hap.part && typeof hap.part === "object" && key in hap.part) {
        return Number(hap.part[key]);
    }
    return NaN;
}

/**
 * Format a parse result for display in the GXW console.
 * Used by main.js's Cmd-Enter promote-pattern handler to
 * surface what the parser saw, since on-canvas marker
 * rendering for the parsed positions is not yet wired.
 *
 * The original expression is intentionally not echoed
 * in the formatted line; an expression containing
 * string literals (which all useful patterns do) would
 * otherwise produce a console line with nested or
 * unbalanced quotes that is hard to read. The user can
 * correlate the console output with their typed
 * expression via recency since each Cmd-Enter on a
 * labelled block produces one line. A future
 * visualisation stage retires this console output in
 * favour of on-canvas marker rendering.
 *
 * @param {string} _expressionString
 * @param {ParseResult} result
 * @returns {string}
 */
export function formatParseResultForConsole(_expressionString, result) {
    if (!result.ok) {
        return `Pattern parse error: ${result.error}`;
    }
    if (result.positions.length === 0) {
        return `Pattern parsed: 0 events`;
    }
    const formatted = result.positions
        .map((p) => p.toFixed(3))
        .join(", ");
    const eventWord = result.positions.length === 1 ? "event" : "events";
    return `Pattern parsed: ${result.positions.length} ${eventWord} at ${formatted}`;
}
