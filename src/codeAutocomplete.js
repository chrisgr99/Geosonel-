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
 *   - After `this.col.` / `this.ownColor.` → the colour channels.
 *   - After `this.` → the firing-context reads/emitters.
 *   - After `styles.` → the built-in nxtNote style profiles.
 *   - Otherwise (a normal identifier position):
 *       · the curated callback API (playNote, nxtNote, reRange, …), each
 *         carrying its signature + a docs panel (info) — keyboard-navigable,
 *         no hover needed;
 *       · SNIPPET FAMILIES — type a family word (vel / dur / note / play /
 *         cb) to expand a tab-stop template for that building block, so the
 *         callback's arguments can be built piecewise instead of one long
 *         line;
 *       · JS keywords (including structural ones like function / for / if);
 *       · every identifier already defined/used in the document (a
 *         scope-agnostic scan — covers defined variables and used
 *         property names).
 */

import {
    autocompletion,
    snippetCompletion,
} from "https://esm.sh/@codemirror/autocomplete@6?deps=@codemirror/state@6.5.2";
import { DEFAULT_KINEMATICS } from "./scene.js";
import { styles as STYLE_DEFS } from "./harmonyMelody.js";
import { NOTE_FIELDS, MSTYLE_FIELDS } from "./mStyle.js";

/**
 * Firing-context members offered after `this.` — the reads and
 * emitter methods a callback's bound object exposes (§3.2/§3.3). The
 * superset across callback kinds.
 */
const THIS_MEMBERS = [
    "vel", "velocity", "beatStrength", "col", "x", "y", "vx", "vy", "speed",
    "flipX", "flipY", "cyclePhase", "cycleCount", "beat", "time", "bpm",
    "id", "kind", "beatIndex", "beatCount", "otherId", "otherKind",
    "hitSpeed", "poly", "playNote", "playSound", "ownColor",
    // The per-slot melodic STYLE (a MStyle): the inspector-assigned voice a
    // no-argument nxtNote() uses; copy it (this.style.copy()) to customise.
    "style",
    // Live harmony under the playhead (commit 4): the current/next chord as
    // { root, notes } (root MIDI + semitone offsets) and the beats remaining
    // in the current chord.
    "chord", "nextChord", "beatsToNext",
];

/**
 * Colour channels offered after `this.col.` (image colour under the cursor)
 * AND `this.ownColor.` (the object's own authored colour). lt = lightness,
 * chr = chroma.
 */
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

/** Built-in melodic styles offered after `styles.` (nxtNote profiles). */
const STYLE_MEMBERS = Object.keys(STYLE_DEFS);

/** MStyle fields offered after a `.` on a MStyle variable (or this.style). */
const NOTE_STYLE_MEMBERS = MSTYLE_FIELDS;
/** Note fields offered after a `.` on a Note variable (built from nxtNote). */
const NOTE_MEMBERS = NOTE_FIELDS;

/**
 * Infer the TYPE of a local variable from HOW it was created (its assignment),
 * not its name — so member completion is robust to renaming. Scans the document
 * before the cursor for the variable's last `const/let/var NAME = …` and
 * classifies the right-hand side:
 *   - `nxtNote(…)`                                   → "Note"
 *   - `….copy()` / `this.style…` / `styles.NAME` / `new MStyle(…)` → "MStyle"
 * Returns null when it can't tell.
 * @param {any} state    CodeMirror EditorState
 * @param {number} pos   cursor position (start of the word being completed)
 * @param {string} ident the receiver variable name
 * @returns {"Note" | "MStyle" | null}
 */
function inferVarType(state, pos, ident) {
    const doc = state.sliceDoc(0, pos);
    // Identifiers are [A-Za-z_$][\w$]*, so `ident` needs no regex escaping.
    const re = new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*([^;\\n]+)`, "g");
    let m;
    let rhs = null;
    while ((m = re.exec(doc)) !== null) rhs = m[1];
    if (rhs === null) return null;
    rhs = rhs.trim();
    if (/\bnxtNote\s*\(/.test(rhs)) return "Note";
    if (/\.copy\s*\(\s*\)\s*$/.test(rhs)
        || /^this\.style\b/.test(rhs)
        || /^styles\.[A-Za-z_$][\w$]*\s*$/.test(rhs)
        || /\bnew\s+MStyle\b/.test(rhs)) {
        return "MStyle";
    }
    return null;
}

/** Bare action globals callable without a prefix. */
const BARE_GLOBALS = [
    "playNote", "playSound", "applyForce", "print", "onBeatInterval",
    "mapToHarmony", "reRange", "nxtNote", "styles", "score",
];

/**
 * Function/parameter documentation for the callback API. `detail` is the short
 * signature shown inline in the completion; `info` is the longer description
 * shown in the side panel when the entry is highlighted. Keyboard-navigable —
 * arrow through the suggestions and the panel updates, no hover needed.
 * @type {Record<string, {detail: string, info: string}>}
 */
const API_DOCS = {
    playNote: {
        detail: "(sound, note, vel?, dur?)",
        info: "Play a pitched note from this object's voice. sound e.g. \"piano\"; note is a MIDI number or name (\"c4\"); vel 0–1; dur in beats. Also (\"instrument\", note, …) or an options object.",
    },
    playSound: {
        detail: "(sample, vel?)",
        info: "Play a sample / one-shot, e.g. playSound(\"bd\"). Optional bank: (\"bank\", sample, vel?).",
    },
    applyForce: {
        detail: "(fx, fy)",
        info: "Push a sprite (onTick) — x/y force components steer its motion.",
    },
    print: {
        detail: "(...args)",
        info: "Print values to the message area for debugging.",
    },
    onBeatInterval: {
        detail: "(interval)",
        info: "In an onTick callback, returns true once per beat interval — gate a body to a musical pulse.",
    },
    mapToHarmony: {
        detail: "(value, lowValue, highValue, rangeLow, rangeHigh)",
        info: "Map a value onto a tone of the CURRENT chord laid out across [rangeLow, rangeHigh]. Indexes chord tones, so it can leap. For a stepwise line use nxtNote.",
    },
    reRange: {
        detail: "(value, lo, hi)",
        info: "Re-map an already-0–1 value into [lo, hi], clamped. The colour channels (this.col.*) are already 0–1, so e.g. reRange(this.col.r, 0.3, 1) for velocity, reRange(this.col.b, 0.2, 1.5) for a note length. Works on any 0–1 value.",
    },
    nxtNote: {
        detail: "(drive, style, low?, span?)",
        info: "Next note of a melodic line — stepwise, chord-aware. drive is a 0–1 signal you choose (e.g. this.col.lt); style is a styles.* profile; low/span optionally override the register.",
    },
    styles: {
        detail: "melodic / bass / lead",
        info: "Built-in nxtNote style profiles. Customise by spreading: { ...styles.melodic, scale: \"blues\" }.",
    },
    score: {
        detail: "kinematics / poly / groupPoly",
        info: "Score-wide configuration, read/written in a top-level setup script.",
    },
};

/**
 * Snippet families — keyed by the word you type; each variant is
 * [label-suffix, template]. The shared key groups the family in the popup
 * (type "vel" → all velocity variants). Templates use ${} tab-stops whose text
 * is the pre-selected default. Adding a variant is one row; adding a family is
 * one key.
 * @type {Record<string, Array<[string, string]>>}
 */
const SNIPPET_FAMILIES = {
    vel: [
        ["colour", "const vel = this.col.${r};"],
        ["colour → range", "const vel = reRange(this.col.${r}, ${0.3}, ${1});"],
        ["beat strength", "const vel = this.vel * ${1.2};"],
        ["constant", "const vel = ${0.8};"],
    ],
    dur: [
        ["colour → range", "const dur = reRange(this.col.${b}, ${0.2}, ${1.5});"],
        ["constant", "const dur = ${1};"],
    ],
    note: [
        ["melodic", "const note = nxtNote(this.col.lt, styles.melodic);"],
        ["bass", "const note = nxtNote(this.col.lt, styles.bass);"],
        ["harmony", "const note = mapToHarmony(this.col.lt, 0, 1, ${48}, ${72});"],
    ],
    play: [
        ["note", 'playNote("${piano}", note, vel, dur);'],
    ],
    cb: [
        ["callback", "function ${name}() {\n  ${}\n}"],
    ],
};

/** Build the snippet completions from {@link SNIPPET_FAMILIES}. */
function snippetOptions() {
    /** @type {any[]} */
    const out = [];
    for (const [key, variants] of Object.entries(SNIPPET_FAMILIES)) {
        for (const [suffix, template] of variants) {
            out.push(snippetCompletion(template, {
                label: `${key}: ${suffix}`,
                type: "snippet",
            }));
        }
    }
    return out;
}

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
    if (/this\.col\.$/.test(before) || /this\.ownColor\.$/.test(before)) {
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
    if (/styles\.$/.test(before)) {
        return { from: word.from, options: opts(STYLE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    // The per-slot style is a MStyle, so `this.style.` offers its fields.
    if (/this\.style\.$/.test(before)) {
        return { from: word.from, options: opts(NOTE_STYLE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    // A direct factory chain (no variable): nxtNote(…). → Note fields,
    // ….copy(). → MStyle fields.
    if (/\bnxtNote\s*\([^()]*\)\.$/.test(before)) {
        return { from: word.from, options: opts(NOTE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    if (/\.copy\s*\(\s*\)\.$/.test(before)) {
        return { from: word.from, options: opts(NOTE_STYLE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
    }
    // A member access on a LOCAL VARIABLE: infer its type from how it was
    // created (not its name) and offer that type's fields. `const note =
    // nxtNote(style)` → note.<Note fields>; `const v = this.style.copy()` →
    // v.<MStyle fields>. Robust to renaming.
    const dotVar = /(^|[^\w$.])([A-Za-z_$][\w$]*)\.$/.exec(before);
    if (dotVar) {
        const t = inferVarType(context.state, word.from - 1, dotVar[2]);
        if (t === "Note") {
            return { from: word.from, options: opts(NOTE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
        }
        if (t === "MStyle") {
            return { from: word.from, options: opts(NOTE_STYLE_MEMBERS, "property"), validFor: /^[\w$]*$/ };
        }
    }
    if (word.from === word.to && !context.explicit) return null;

    // General identifier position: globals + keywords +
    // document identifiers, de-duplicated by label (first wins, so a
    // curated entry beats a doc-scanned one).
    /** @type {Map<string, any>} */
    const byLabel = new Map();
    const add = (entry) => { if (!byLabel.has(entry.label)) byLabel.set(entry.label, entry); };
    // Curated callback API — each carries its signature (detail) + docs (info,
    // shown in the side panel when highlighted).
    for (const label of BARE_GLOBALS) {
        const doc = API_DOCS[label];
        add(doc
            ? { label, type: "function", detail: doc.detail, info: doc.info }
            : { label, type: "function" });
    }
    // Snippet families — unique "key: variant" labels, so they survive dedup
    // and the shared key groups them when you type it.
    for (const e of snippetOptions()) add(e);
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
