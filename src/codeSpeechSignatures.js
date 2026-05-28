// @ts-check

/**
 * Parameter signature lookup for the Semantic Code Speech
 * Layer's hover tooltip. See Section 31's "Parameter name
 * tooltips (v0.1)" subsection in DESIGN.md for the design
 * rationale.
 *
 * Each entry maps a function name to an ordered array of
 * parameter names. The CodeMirror hover tooltip uses this
 * to surface "functionName: parameter name" when the
 * composer hovers an argument, and the full one-line
 * signature when they hover the callee identifier.
 *
 * Lookup key is the rightmost identifier of the callee:
 * for plain calls like mapClip(...) the key is "mapClip";
 * for method calls like pxLt.range(...) the key is
 * "range". Name collisions across different objects are
 * possible and tolerable for v0.1; if a collision matters
 * in practice the key format can grow to Object.method
 * qualifiers.
 *
 * Functions without an entry produce no tooltip, the
 * same as everything outside a known call. The file
 * grows additively: adding an entry only adds a tooltip
 * surface, never breaks any existing reading.
 *
 * Claude maintains this file. Ask Claude to add a new
 * entry when a helper function warrants tooltip support;
 * Claude appends the entry with parameter names taken
 * from the function declaration.
 *
 * @type {Record<string, string[]>}
 */
export const FUNCTION_SIGNATURES = {
    // GXW signal helpers.
    mapClip: [
        "signal",
        "input min",
        "input max",
        "output min",
        "output max",
    ],

    // Strudel signal-range method. Called as a method on
    // a signal (e.g. pxLt.range(0.2, 1.0)); the lookup
    // key is the rightmost identifier of the callee, so
    // the entry is keyed simply as "range".
    range: [
        "min",
        "max",
    ],

    // Strudel pattern constructors and modifiers. Mostly
    // single-argument calls where the tooltip's value is
    // showing the parameter name on the callee hover so
    // the composer can confirm what shape of argument
    // the function expects without leaving the line.
    note: [
        "pattern",
    ],
    gain: [
        "value",
    ],
    struct: [
        "rhythm",
    ],
    scale: [
        "scale name",
    ],
};
