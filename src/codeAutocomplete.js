// @ts-check

/**
 * JavaScript autocompletion for the Script tab (GeoSonixV2).
 *
 * Replaces the old Strudel-symbol completion. One self-contained
 * CodeMirror 6 completion source — deliberately NOT split across
 * several override sources and NOT walking the syntax tree, because
 * both of those made completion silently die at the top level (a
 * syntax-tree walk throws on the error node a half-typed top-level
 * statement produces, and a thrown override source aborts the whole
 * query). This source only reads text, so it behaves identically at
 * the top level and inside a function.
 *
 * What it offers, merged and de-duplicated:
 *   - After `this.col.` → the colour channels.
 *   - After `this.` → the firing-context reads/emitters.
 *   - Otherwise (a normal identifier position):
 *       · the bare action globals (playNote/playSound/applyForce/print),
 *       · JS keywords (including the structural ones like
 *         function / for / if),
 *       · every identifier already defined/used in the document (a
 *         scope-agnostic scan — covers defined variables and used
 *         property names).
 */

import {
    autocompletion,
} from "https://esm.sh/@codemirror/autocomplete@6?deps=@codemirror/state@6.5.2";
import { DEFAULT_KINEMATICS } from "./scene.js";

/**
 * Firing-context members offered after `this.` — the reads and
 * emitter methods a callback's bound object exposes (§3.2/§3.3). The
 * superset across callback kinds.
 */
const THIS_MEMBERS = [
    "vel", "velocity", "beatStrength", "col", "x", "y", "vx", "vy", "speed",
    "flipX", "flipY", "cyclePhase", "cycleCount", "beat", "time", "bpm",
    "id", "kind", "beatIndex", "beatCount", "otherId", "otherKind",
    "hitSpeed", "poly", "playNote", "playSound",
    // Live harmony under the playhead (commit 4): the current/next chord as
    // { root, notes } (root MIDI + semitone offsets) and the beats remaining
    // in the current chord.
    "chord", "nextChord", "beatsToNext",
];

/** Colour channels offered after `this.col.` (lt = lightness, chr = chroma). */
const COL_MEMBERS = ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"];

/**
 * The `score` global's members offered after `score.` — the score-wide
 * config a setup (top-level) script reads/writes: kinematics knobs, the
 * polyphony caps (poly value + groupPoly(name, N) setter), and the
 * read-only hasBackgroundImage flag.
 */
const SCORE_MEMBERS = ["kinematics", "poly", "groupPoly", "hasBackgroundImage"];

/** Kinematics knobs offered after `score.kinematics.` (kept in sync with the defaults). */
const KINEMATICS_MEMBERS = Object.keys(DEFAULT_KINEMATICS);

/** Bare action globals callable without a prefix. */
const BARE_GLOBALS = ["playNote", "playSound", "applyForce", "print", "mapToHarmony"];

/** JS keywords, including the structural ones (function / for / if / …). */
const JS_KEYWORDS = [
    "const", "let", "var", "function", "return", "new", "typeof",
    "instanceof", "in", "of", "if", "else", "for", "while", "do",
    "switch", "case", "default", "break", "continue", "this", "true",
    "false", "null", "undefined", "void", "delete", "async", "await",
    "yield", "class", "extends", "try", "catch", "finally", "throw",
];

/**
 * @param {string[]} labels
 * @param {string} type
 */
function opts(labels, type) {
    return labels.map((label) => ({ label, type }));
}

/**
 * Identifiers (length >= 2) appearing anywhere in the document, minus
 * the word currently being typed at [from, to). Scope-agnostic but
 * robust and tree-free. Cheap for typical script sizes.
 * @param {any} state
 * @param {number} from
 * @returns {{label: string, type: string}[]}
 */
function docIdentifiers(state, from) {
    const text = state.doc.toString();
    const seen = new Set();
    const re = /[A-Za-z_$][\w$]*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m[0].length < 2) continue;
        if (m.index === from) continue; // the word being typed
        seen.add(m[0]);
    }
    return [...seen].map((label) => ({ label, type: "variable" }));
}

/**
 * Single completion source for the Script tab.
 * @param {any} context
 */
function scriptCompletionSource(context) {
    const word = context.matchBefore(/[\w$]*/);
    if (word === null) return null;
    // Don't pop the list on an empty word unless explicitly asked
    // (Ctrl-Space) — except right after a member dot, where showing
    // the members on the bare dot is the point.
    const before = context.state.sliceDoc(Math.max(0, word.from - 24), word.from);
    if (/this\.col\.$/.test(before)) {
        return { from: word.from, options: opts(COL_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    if (/this\.$/.test(before)) {
        return { from: word.from, options: opts(THIS_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    if (/score\.kinematics\.$/.test(before)) {
        return { from: word.from, options: opts(KINEMATICS_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    if (/score\.$/.test(before)) {
        return { from: word.from, options: opts(SCORE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    if (word.from === word.to && !context.explicit) return null;

    // General identifier position: globals + keywords +
    // document identifiers, de-duplicated by label (first wins, so a
    // curated entry beats a doc-scanned one).
    /** @type {Map<string, any>} */
    const byLabel = new Map();
    const add = (entry) => { if (!byLabel.has(entry.label)) byLabel.set(entry.label, entry); };
    for (const e of opts(BARE_GLOBALS, "function")) add(e);
    for (const e of opts(JS_KEYWORDS, "keyword")) add(e);
    for (const e of docIdentifiers(context.state, word.from)) add(e);
    return { from: word.from, options: [...byLabel.values()], validFor: /^[\w$]*$/ };
}

/**
 * The CodeMirror autocompletion extension for the Script tab. closeOn-
 * Blur is false so the popup survives a focus flicker, matching the
 * old behaviour.
 */
export const jsAutocomplete = autocompletion({
    override: [scriptCompletionSource],
    closeOnBlur: false,
});
