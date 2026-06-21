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
 * Deterministic pseudo-random value in [0,1) from a (seed, cycle index, slot
 * index) triple. No Math.random, so a given triple always yields the same draw —
 * the variation is reproducible on rewind/reload, re-rolling is just a new seed,
 * and each cycle (repeat) varies because the cycle index is mixed in.
 * @param {number} seed @param {number} cycle @param {number} slot @returns {number}
 */
function roll(seed, cycle, slot) {
    let h = ((seed | 0) ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ ((cycle | 0) + 0x165667b1), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ ((slot | 0) + 0xd3a2646c), 0xc2b2ae35) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x735a2d97) >>> 0; h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** The downbeat (slot 0) is a flip candidate only when its own per-cycle die clears
 *  this bar — so it's eligible only ~(1 − DOWNBEAT_PROTECT) of cycles (and even then
 *  must out-roll the others). Anchors the beat without making it strictly immovable;
 *  raise toward 1 to protect harder, drop to 0 to flip it like any other slot. */
const DOWNBEAT_PROTECT = 0.85;

/**
 * One cycle's variation, AT THE PATTERN'S OWN LENGTH: flip exactly `flips` of the
 * original string's slots (capped at its length) — the top-rolling ones for this
 * cycle — and return a string of the SAME length. It then loops to fill the cycle
 * just as the unvaried pattern does, so an 8-char pattern stays 8 chars rather than
 * being expanded to beatsPerCycle. Symmetric — an active slot (incl. a ratchet,
 * whose digit survives if unflipped) goes silent; a rest sounds once as "x". A
 * delta from the original (never cumulative), deterministic per (seed, cycle index).
 * The first beat of EACH BAR (slot j where j % beatsPerBar === 0) is protected (see
 * DOWNBEAT_PROTECT) so downbeats rarely flip, for any time signature.
 * @param {string} original @param {number} flips @param {number} seed
 * @param {number} cycle @param {unknown} beatsPerBar @returns {string}
 */
function variedCycle(original, flips, seed, cycle, beatsPerBar) {
    const len = original.length;
    const count = Math.min(Math.max(0, flips), len);
    // Bar length: the time-signature beats/bar when set (>= 2), else the whole
    // pattern (so only slot 0, the cycle's first beat, counts as a downbeat).
    const bpb = Math.round(Number(beatsPerBar));
    const bar = (Number.isFinite(bpb) && bpb >= 2) ? bpb : (len || 1);
    /** @type {Set<number>} */
    let flipSet = new Set();
    if (count > 0) {
        const order = [];
        for (let j = 0; j < len; j++) {
            // A bar-downbeat (j % bar === 0) joins the candidate pool only when its
            // OWN per-cycle die clears DOWNBEAT_PROTECT — eligible only rarely, and
            // even then it must out-roll the rest, so the beat stays anchored.
            if (len > 1 && (j % bar === 0) && roll(seed, cycle, -1 - j) < DOWNBEAT_PROTECT) continue;
            order.push(j);
        }
        order.sort((a, b) => roll(seed, cycle, b) - roll(seed, cycle, a));
        flipSet = new Set(order.slice(0, Math.min(count, order.length)));
    }
    let out = "";
    for (let j = 0; j < len; j++) {
        const ch = original[j];
        const wasActive = beatCountForSlot(ch) > 0;
        const nowActive = flipSet.has(j) ? !wasActive : wasActive;
        out += nowActive ? (wasActive ? ch : "x") : ".";
    }
    return out;
}

/**
 * The varied active-beats string for ONE specific cycle (repeat) index — what the
 * inspector shows live while playing. SAME length as the authored pattern (it loops
 * to fill the cycle); `vary` 0 returns the original unchanged.
 * @param {unknown} activeBeats @param {unknown} vary @param {unknown} varySeed
 * @param {unknown} cycleIndex @param {unknown} beatsPerBar @returns {string}
 */
export function variedCycleAt(activeBeats, vary, varySeed, cycleIndex, beatsPerBar) {
    const original = bareString(activeBeats) || "x";
    const flips = Math.max(0, Math.floor(Number(vary)) || 0);
    if (flips <= 0) return original;
    const seed = Number(varySeed) | 0;
    const k = Math.max(0, Math.floor(Number(cycleIndex)) || 0);
    return variedCycle(original, flips, seed, k, beatsPerBar);
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
function deriveNormalLooped(activeBeats, strength, beatsPerCycle, repeats, vary, varySeed, beatsPerBar) {
    const original = bareString(activeBeats) || "x";
    const strengths = bareString(strength) || String(DEFAULT_STRENGTH);
    const bpc = Number(beatsPerCycle);
    const base = (Number.isFinite(bpc) && bpc >= 1) ? Math.floor(bpc) : original.length;
    // Repeats lays whole copies of the base pattern end-to-end around the path:
    // N copies → N × beat points, the cursor sweeping them in one traversal.
    const r = Number(repeats);
    const reps = (Number.isFinite(r) && r >= 1) ? Math.floor(r) : 1;
    const n = base * reps;
    // Variation: `vary` = max notes flipped PER CYCLE. Each repeat (cycle) gets its
    // OWN variation — a delta from the ORIGINAL at the PATTERN's length (non-
    // cumulative), seeded by the cycle index so cycles differ; that varied pattern
    // then LOOPS to fill the cycle exactly as the unvaried one does (so an 8-char
    // pattern stays 8 chars, not expanded to beatsPerCycle). vary 0 → original.
    const maxFlips = Math.max(0, Math.floor(Number(vary)) || 0);
    const seed = Number(varySeed) | 0;
    const patLen = original.length;
    const cycles = (maxFlips > 0)
        ? Array.from({ length: reps }, (_, k) => variedCycle(original, maxFlips, seed, k, beatsPerBar))
        : null;
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const out = [];
    /** @type {number[]} */
    const inactivePositions = [];
    for (let i = 0; i < n; i++) {
        const ch = (cycles !== null)
            ? cycles[Math.floor(i / base)][(i % base) % patLen]
            : original[i % patLen];
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
const STRUDEL_OPERATORS = /[[\]<>(){}*/!@,?|]/;

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
 * Read a Hap's begin position. Strudel exposes the event extent in
 * `whole` (the full span) and `part` (the portion within the queried
 * arc); whole is preferred with part as a fallback — same precedence
 * as patternParse's hapBoundary.
 * @param {any} hap
 * @returns {number}
 */
function hapBegin(hap) {
    if (hap === null || typeof hap !== "object") return NaN;
    if (hap.whole && typeof hap.whole === "object" && "begin" in hap.whole) {
        return Number(hap.whole.begin);
    }
    if (hap.part && typeof hap.part === "object" && "begin" in hap.part) {
        return Number(hap.part.begin);
    }
    return NaN;
}

/**
 * Derive positions + strengths from a Strudel mini-notation
 * beatPattern, tiled across `reps` SUB-CYCLES around the path.
 *
 * Each sub-cycle k samples the pattern at Strudel CYCLE k — not always
 * cycle 0 — so cross-cycle modifiers evolve from one sub-cycle to the
 * next instead of repeating a frozen first-cycle snapshot: `<a b>`
 * alternates, `t/2` (slow) plays only every other sub-cycle, `t?`
 * (degrade) re-rolls its drops. Sub-Cycles is therefore the period over
 * which such patterns vary before the path loops; bump it to give the
 * variation room (a `t/2` needs Sub-Cycles ≥ 2 to ever show its OFF
 * cycle).
 *
 * A FLAT space-separated sequence (no mini-notation operators) is
 * identical every cycle, so it is placed natively by deriveFlatSequence
 * — engine-free, so simple patterns like "x x x x" or "0 3 ~ 9" work the
 * instant they are typed — and tiled unchanged.
 *
 * An operator pattern ([] grouping, * speed, <> alternation, (k,n)
 * euclidean, …) is parsed ONCE via the real Strudel parser (the raw
 * mini-notation wrapped in s("...") so arbitrary tokens parse
 * uniformly); each sub-cycle is then read with a fresh queryArc(k, k+1)
 * against the compiled Pattern, and only the event BEGINS and their
 * tokens are used (the pattern is never played as samples). Rests ("~")
 * produce no hap and drop out. The parse returns empty (carrying the
 * error string) when the engine is not loaded or the expression fails
 * to parse, so an unloaded engine simply shows no diamonds for an
 * operator pattern rather than throwing.
 *
 * The `cycleOffset` is the Strudel cycle that slice 0 samples; slice k samples
 * cycleOffset + k. At rest / scene-load it is 0 (the path shows cycles
 * 0..reps-1). The firing path advances it over time — curve loop c passes
 * cycleOffset = c × reps — so stochastic / cross-cycle operators keep evolving
 * as the curve loops instead of replaying a frozen first window. A flat
 * sequence is identical every cycle, so cycleOffset doesn't affect it.
 *
 * @param {unknown} beatPattern
 * @param {unknown} reps  Sub-Cycles (coerced to an integer >= 1).
 * @param {unknown} [cycleOffset]  Strudel cycle sampled by slice 0 (default 0).
 * @returns {BeatPoints}
 */
function deriveStrudelTiled(beatPattern, reps, cycleOffset) {
    const raw = (typeof beatPattern === "string" ? beatPattern : "").trim();
    const r = Number(reps);
    const n = (Number.isFinite(r) && r >= 1) ? Math.floor(r) : 1;
    const o = Number(cycleOffset);
    const off = Number.isFinite(o) ? Math.floor(o) : 0;
    if (raw === "") return { positions: [], strengths: [], inactivePositions: [] };

    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const strengths = [];
    /** @type {number[]} */
    const inactivePositions = [];

    // Flat sequence: no operators, so every cycle is identical. Place it
    // natively once and tile that placement into each of the n slices.
    const flat = deriveFlatSequence(raw);
    if (flat !== null) {
        for (let k = 0; k < n; k++) {
            for (let i = 0; i < flat.positions.length; i++) {
                positions.push((k + flat.positions[i]) / n);
                strengths.push(flat.strengths[i]);
            }
            for (let i = 0; i < flat.inactivePositions.length; i++) {
                inactivePositions.push((k + flat.inactivePositions[i]) / n);
            }
        }
        return { positions, strengths, inactivePositions };
    }

    // Operator pattern: parse once, then sample each sub-cycle at its own
    // Strudel cycle so cross-cycle modifiers advance across the slices.
    const expr = `s(${JSON.stringify(raw)})`;
    const result = parsePatternToPositions(expr);
    if (!result.ok) {
        return { positions: [], strengths: [], inactivePositions: [], error: result.error };
    }
    const pattern = result.pattern;
    if (pattern === null || typeof pattern.queryArc !== "function") {
        return { positions: [], strengths: [], inactivePositions: [] };
    }
    for (let k = 0; k < n; k++) {
        const cyc = off + k;   // the Strudel cycle this slice samples
        let haps;
        try {
            haps = pattern.queryArc(cyc, cyc + 1);
        } catch (err) {
            return {
                positions: [], strengths: [], inactivePositions: [],
                error: err instanceof Error ? err.message : String(err),
            };
        }
        if (!Array.isArray(haps)) continue;
        for (const hap of haps) {
            const begin = hapBegin(hap);
            if (!Number.isFinite(begin)) continue;
            const frac = begin - cyc;                // position within cycle cyc, [0,1)
            if (!(frac >= 0 && frac < 1)) continue;  // drop events spilling past the cycle
            positions.push((k + frac) / n);          // map into spatial slice k
            strengths.push(strengthFromHapValue(hap.value));
        }
    }
    // Operator patterns expose only events, not rests, so there are
    // no inactive positions to draw.
    return { positions, strengths, inactivePositions };
}

/**
 * Derive the beat points of a curve from its Beat Points band
 * fields. The single entry point used by the canvas (drawing) and
 * the simulation (firing).
 *
 * `cycleOffset` only affects Strudel mode: it is the Strudel cycle that
 * slice 0 samples (the firing/draw paths advance it as the curve loops so
 * stochastic operators keep evolving; default 0 for the at-rest snapshot).
 * @param {any} curve
 * @param {number} [cycleOffset]  Strudel base cycle (default 0).
 * @returns {BeatPoints}
 */
export function deriveCurveBeatPoints(curve, cycleOffset) {
    const mode = curve !== null && typeof curve.beatPointsMode === "string"
        ? curve.beatPointsMode
        : "none";
    if (mode === "normal" || mode === "auto" || mode === "euclidean") {
        // Manual, Auto, and Euclidean all play their (possibly generated)
        // activeBeats/strength through one looped derivation, with Repeats
        // multiplying the beat-point count.
        return deriveNormalLooped(
            curve.activeBeats, curve.strength, curve.beatsPerCycle, curve.repeats,
            curve.vary, curve.varySeed, curve.beatsPerBar);
    }
    if (mode === "strudel") {
        // Sub-Cycles (the curve's `repeats`) tiles the mini-notation N times
        // around the path; slice k samples Strudel cycle cycleOffset + k so
        // cross-cycle operators evolve across the slices AND across curve loops
        // (the firing/draw paths feed an advancing cycleOffset = loop × repeats).
        return deriveStrudelTiled(curve.beatPattern, curve.repeats, cycleOffset);
    }
    return { positions: [], strengths: [], inactivePositions: [] };
}
