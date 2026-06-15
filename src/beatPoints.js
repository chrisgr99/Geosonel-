// @ts-check

/**
 * Beat-point derivation (GeoSonixV2, Phase 3.1a).
 *
 * Turns a curve's authored Beat Points data (the Band-5 fields:
 * beatPointsMode plus the activeBeats / strength strings, or the
 * Strudel beatPattern) into the set of CYCLE-FRACTION positions
 * where beat-point diamonds sit, each with its STRENGTH (the
 * accent that maps to velocity when the beat fires in §3.6's
 * onActiveBeat path).
 *
 * A position is a fraction in [0, 1) of one cursor cycle: position
 * `f` places a diamond at the curve sample point `t = f` (the
 * cursor's parameter when its cycle phase reaches `f`). The same
 * positions drive both the on-canvas drawing (this slice, 3.1a)
 * and the onActiveBeat firing that hooks onto them next (3.1b).
 *
 * This SUPERSEDES the old cyclePattern-driven markers as the
 * curve's diamond source. cyclePattern is a dead Strudel-era
 * firing path (dropped per §3.6 / §10); its remaining references
 * are removed in the later cleanup slice, not here.
 *
 * Modes:
 *   - none: no beat points.
 *   - normal: the activeBeats x/dot string, LOOPED. The cycle is
 *     divided into Per Cycle (beatsPerCycle) equal slots; the
 *     activeBeats and strength strings each loop (sampled modulo
 *     their own length) to fill them, so a short string drives a
 *     long cycle. An "x" slot is a beat, a "." slot a rest.
 *   - euclidean: the activeBeats x/dot string as-is (the generator
 *     makes it beatsPerCycle long, so it already spans the cycle —
 *     no looping). Strength is read slot-for-slot, default when
 *     absent.
 *     Both: bars ("|") and whitespace are layout only and stripped
 *     first. Position = slotIndex / slotCount.
 *   - strudel: the beatPattern mini-notation. Parsed once for
 *     one cycle's event begins (the positions) and per-event
 *     token strengths; needs the Strudel runtime, so it yields
 *     nothing until the engine is loaded (same as the old
 *     cyclePattern markers did).
 */

import { parsePatternToPositions } from "./strudel/patternParse.js";

/** Bars and whitespace are layout-only in the beat strings. */
const LAYOUT_CHARS = /[|\s]/g;

/**
 * Strength for a beat whose strength digit is missing or not a
 * digit (a bare "x" in Strudel, or a strength string shorter than
 * the active-beats string). 9 is the Beat Strength field's own
 * default — a full-accent beat.
 */
const DEFAULT_STRENGTH = 9;

/**
 * @typedef {{
 *   positions: number[],
 *   strengths: number[],
 *   inactivePositions: number[],
 *   error?: string,
 * }} BeatPoints
 *
 * `positions` / `strengths` are the ACTIVE beats (an "x" slot, or a
 * Strudel strength token), index-aligned; these fire onActiveBeat
 * and act as collision targets. `inactivePositions` are the REST
 * slots (a "." in normal/euclidean, a "~" in a flat Strudel
 * pattern) — drawn as smaller diamonds to show the grid, but never
 * fired and not collision targets. Strudel patterns that use
 * mini-notation operators expose no rest positions, so their
 * inactivePositions is empty (active beats only).
 */

/**
 * Strip bars and whitespace from a beat string, leaving the bare
 * slot characters (x / . / digits).
 * @param {unknown} s
 * @returns {string}
 */
function bareString(s) {
    return (typeof s === "string" ? s : "").replace(LAYOUT_CHARS, "");
}

/**
 * Is `ch` a single decimal digit 0-9?
 * @param {string} ch
 */
function isDigit(ch) {
    return ch >= "0" && ch <= "9";
}

/**
 * Hits a beat-pattern slot character produces. "x"/"X" is one hit; a
 * digit 1-9 is a ratchet of that many evenly-spaced sub-hits across the
 * slot's interval; anything else (".", "0") is a rest (0 hits).
 * @param {string} ch
 * @returns {number}
 */
function beatCountForSlot(ch) {
    if (ch === "x" || ch === "X") return 1;
    if (isDigit(ch)) {
        const v = Number(ch);
        return v >= 1 ? v : 0;
    }
    return 0;
}

/**
 * Derive positions + strengths for the looped beat-points path, where the
 * active-beats and strength strings LOOP to fill the cycle.
 *
 * The number of beats is `beatsPerCycle` (Per Cycle), NOT the string
 * length: the cycle is divided into that many equal slots, and the two
 * strings are each sampled MODULO their own length to fill them. So a
 * short string drives a long cycle (e.g. "xx.x" across 16 beats repeats
 * four times) and the two strings loop independently of each other and
 * of the beat count. An "x"/"X" slot is a beat at the aligned (looped)
 * strength digit; any other slot ("." etc.) is an inactive rest.
 *
 * Empty strings fall back to the field defaults — an all-active "x"
 * grid at DEFAULT_STRENGTH — so the cycle is still filled. When no
 * valid beatsPerCycle is supplied (degenerate data or a legacy caller)
 * the count falls back to the active-beats string's own length.
 *
 * Manual, Euclidean, and Auto all flow through here: Euclidean and Auto store
 * a full-length (beatsPerCycle) generated pattern, Manual a short looping one,
 * and `repeats` then multiplies the whole thing N times around the path.
 * @param {unknown} activeBeats
 * @param {unknown} strength
 * @param {unknown} beatsPerCycle
 * @param {unknown} repeats
 * @returns {BeatPoints}
 */
function deriveNormalLooped(activeBeats, strength, beatsPerCycle, repeats) {
    const slots = bareString(activeBeats) || "x";
    const strengths = bareString(strength) || String(DEFAULT_STRENGTH);
    const bpc = Number(beatsPerCycle);
    const base = (Number.isFinite(bpc) && bpc >= 1) ? Math.floor(bpc) : slots.length;
    // Repeats lays whole copies of the base pattern end-to-end around the path:
    // N copies → N × beat points, the pattern tiling across all of them, the
    // cursor sweeping them in one (proportionally longer) traversal.
    const r = Number(repeats);
    const reps = (Number.isFinite(r) && r >= 1) ? Math.floor(r) : 1;
    const n = base * reps;
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const out = [];
    /** @type {number[]} */
    const inactivePositions = [];
    for (let i = 0; i < n; i++) {
        const ch = slots[i % slots.length];
        const count = beatCountForSlot(ch);
        if (count > 0) {
            const d = strengths[i % strengths.length];
            const strengthVal = (d !== undefined && isDigit(d))
                ? Number(d) : DEFAULT_STRENGTH;
            // A digit slot is a ratchet: `count` evenly-spaced sub-hits
            // across the slot's interval, all at the slot's strength.
            for (let k = 0; k < count; k++) {
                positions.push((i + k / count) / n);
                out.push(strengthVal);
            }
        } else {
            inactivePositions.push(i / n);
        }
    }
    return { positions, strengths: out, inactivePositions };
}

/**
 * Pull a single-token strength out of a parsed Strudel hap value.
 * A numeric token ("0".."9") is that strength; anything else (a
 * bare "x", a sample name) is a default-accent beat. The token
 * sits in the value's `s` field when the pattern was wrapped in
 * s(...), with note/n as fallbacks.
 * @param {any} value
 * @returns {number}
 */
function strengthFromHapValue(value) {
    let token = value;
    if (value !== null && typeof value === "object") {
        token = value.s ?? value.note ?? value.n ?? value.value;
    }
    const str = String(token);
    if (str.length === 1 && isDigit(str)) return Number(str);
    return DEFAULT_STRENGTH;
}

/**
 * Mini-notation operator characters. A pattern containing any of
 * these needs Strudel's real parser (grouping, speed, alternation,
 * replication, euclidean shorthand, …); a pattern WITHOUT them is
 * a flat space-separated token sequence we can place natively
 * without the engine.
 */
const STRUDEL_OPERATORS = /[[\]<>(){}*/!@,]/;

/**
 * A "simple" token is one whose position and strength we can read
 * directly: a "~" rest, a bare "x"/"X" beat, or a single strength
 * digit. Anything else (multi-character, sample names, partial
 * operators) means the pattern isn't flat and goes to the engine.
 * @param {string} tok
 */
function isSimpleToken(tok) {
    return tok === "~" || tok === "x" || tok === "X" || (tok.length === 1 && isDigit(tok));
}

/**
 * Place a flat space-separated mini-notation sequence natively —
 * no Strudel engine. The sequence is divided into N equal slots
 * (N = token count); token i sits at i / N. "~" is a rest (no
 * beat), "x" a default-strength beat, a digit that beat's
 * strength. Returns null when the pattern is NOT flat (it contains
 * a mini-notation operator, or any non-simple token), signalling
 * the caller to fall back to the engine.
 * @param {string} raw  Trimmed, non-empty pattern.
 * @returns {BeatPoints | null}
 */
function deriveFlatSequence(raw) {
    if (STRUDEL_OPERATORS.test(raw)) return null;
    const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return { positions: [], strengths: [], inactivePositions: [] };
    if (!tokens.every(isSimpleToken)) return null;
    const n = tokens.length;
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const strengths = [];
    /** @type {number[]} */
    const inactivePositions = [];
    for (let i = 0; i < n; i++) {
        const tok = tokens[i];
        if (tok === "~") {
            // A rest is an inactive beat: drawn small, never fired.
            inactivePositions.push(i / n);
            continue;
        }
        positions.push(i / n);
        strengths.push(isDigit(tok) ? Number(tok) : DEFAULT_STRENGTH);
    }
    return { positions, strengths, inactivePositions };
}

/**
 * Derive positions + strengths from a Strudel mini-notation
 * beatPattern.
 *
 * A FLAT space-separated sequence (no mini-notation operators) is
 * placed natively by deriveFlatSequence — engine-free, so simple
 * patterns like "x x x x" or "0 3 ~ 9" work the instant they are
 * typed, regardless of whether the Strudel runtime has loaded.
 *
 * A pattern using operators ([] grouping, * speed, <> alternation,
 * (k,n) euclidean, …) falls back to the real Strudel parser: the
 * raw mini-notation is wrapped in s("...") so arbitrary tokens
 * parse uniformly, and only the event BEGINS and their tokens are
 * read (the pattern is never played as samples). Rests ("~")
 * produce no hap and drop out. That path returns empty (with an
 * error string) when the engine is not loaded or the expression
 * fails to parse, so an unloaded engine simply shows no diamonds
 * for an operator pattern rather than throwing.
 * @param {unknown} beatPattern
 * @returns {BeatPoints}
 */
function deriveFromStrudel(beatPattern) {
    const raw = (typeof beatPattern === "string" ? beatPattern : "").trim();
    if (raw === "") return { positions: [], strengths: [], inactivePositions: [] };
    const flat = deriveFlatSequence(raw);
    if (flat !== null) return flat;
    const expr = `s(${JSON.stringify(raw)})`;
    const result = parsePatternToPositions(expr);
    if (!result.ok) {
        return { positions: [], strengths: [], inactivePositions: [], error: result.error };
    }
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const strengths = [];
    for (const hap of result.haps) {
        if (!(hap.begin >= 0 && hap.begin < 1)) continue;
        positions.push(hap.begin);
        strengths.push(strengthFromHapValue(hap.value));
    }
    // Operator patterns expose only events, not rests, so there are
    // no inactive positions to draw.
    return { positions, strengths, inactivePositions: [] };
}

/**
 * Derive the beat points of a curve from its Beat Points band
 * fields. The single entry point used by the canvas (drawing) and
 * the simulation (firing).
 * @param {any} curve
 * @returns {BeatPoints}
 */
export function deriveCurveBeatPoints(curve) {
    const mode = curve !== null && typeof curve.beatPointsMode === "string"
        ? curve.beatPointsMode
        : "none";
    if (mode === "normal" || mode === "auto" || mode === "euclidean") {
        // Manual, Auto, and Euclidean all play their (possibly generated)
        // activeBeats/strength through one looped derivation, with Repeats
        // multiplying the beat-point count.
        return deriveNormalLooped(
            curve.activeBeats, curve.strength, curve.beatsPerCycle, curve.repeats);
    }
    if (mode === "strudel") {
        return deriveFromStrudel(curve.beatPattern);
    }
    return { positions: [], strengths: [], inactivePositions: [] };
}
