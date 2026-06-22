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

/** Opening/closing mini-notation grouping chars — `|` inside any of these is
 *  a Strudel operator (random choice), NOT a measure divider. */
const GROUP_OPEN = "[<({";
const GROUP_CLOSE = "]>)}";

/**
 * Split a beatPattern into its measure segments on the top-level `|` bar line,
 * bracket-depth-aware so a `[a|b]` random-choice INSIDE a measure survives.
 * Segments are trimmed; an empty segment is an empty (inheriting) measure.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitMeasures(raw) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of raw) {
        if (GROUP_OPEN.includes(ch)) depth++;
        else if (GROUP_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === "|" && depth === 0) { out.push(cur.trim()); cur = ""; }
        else cur += ch;
    }
    out.push(cur.trim());
    return out;
}

/**
 * Resolve the first `M` measures with FILL-DOWN: an empty measure inherits the
 * nearest non-empty measure to its left; a leading empty (nothing to inherit)
 * is a rest. Returns exactly M patterns ("" = rest).
 * @param {string[]} segments
 * @param {number} M
 * @returns {string[]}
 */
export function resolveMeasures(segments, M) {
    const out = [];
    let last = "";
    for (let i = 0; i < M; i++) {
        const seg = i < segments.length ? segments[i] : "";
        if (seg !== "") last = seg;
        out.push(seg !== "" ? seg : last);
    }
    return out;
}

/** Compile one measure pattern to a reusable form (cached per distinct string).
 *  @param {string} p @returns {{kind:string, flat?:any, pattern?:any, error?:string}} */
function compileMeasure(p) {
    const t = p.trim();
    if (t === "") return { kind: "empty" };
    const flat = deriveFlatSequence(t);
    if (flat !== null) return { kind: "flat", flat };
    const result = parsePatternToPositions(`s(${JSON.stringify(t)})`);
    if (!result.ok) return { kind: "error", error: result.error };
    if (result.pattern !== null && typeof result.pattern.queryArc === "function") {
        return { kind: "pattern", pattern: result.pattern };
    }
    return { kind: "empty" };
}

/**
 * Derive positions + strengths from a measure-based beatPattern.
 *
 * The pattern is `M` measures (split on the top-level `|`), each a short Strudel
 * mini-notation cycle, laid `R` times (Repeats) around the path — so the path
 * holds `M × R` slices. Slice `s` takes measure `s mod M` (the phrase tiles) and
 * samples it at Strudel cycle `s`, so stochastic / alternating operators (`?`,
 * `<a b>`, `t/2`) differ across the M·R slices of one trip around the path. The
 * whole array is baked once and the cursor loops it, so the groove RESETS each
 * loop (reproducible, rewind-safe). Empty measures fill down (see
 * resolveMeasures); a flat (operator-free) measure places engine-free, an
 * operator measure goes through the real Strudel parser (empty + error-bearing
 * when the engine isn't loaded).
 *
 * @param {unknown} beatPattern  the `|`-joined measure string.
 * @param {unknown} measures     phrase length M (coerced to an integer >= 1).
 * @param {unknown} repeats      phrase tilings R (coerced to an integer >= 1).
 * @returns {BeatPoints}
 */
function deriveStrudelMeasures(beatPattern, measures, repeats) {
    const raw = typeof beatPattern === "string" ? beatPattern : "";
    const mM = Number(measures);
    const M = Number.isFinite(mM) && mM >= 1 ? Math.floor(mM) : 1;
    const rR = Number(repeats);
    const R = Number.isFinite(rR) && rR >= 1 ? Math.floor(rR) : 1;
    const slices = M * R;

    const resolved = resolveMeasures(splitMeasures(raw), M);
    /** @type {Map<string, any>} */
    const cache = new Map();
    const compile = (p) => {
        if (!cache.has(p)) cache.set(p, compileMeasure(p));
        return cache.get(p);
    };

    /** @type {number[]} */ const positions = [];
    /** @type {number[]} */ const strengths = [];
    /** @type {number[]} */ const inactivePositions = [];
    /** @type {string|undefined} */ let error;

    for (let s = 0; s < slices; s++) {
        const c = compile(resolved[s % M]);
        const base = s / slices;
        const span = 1 / slices;
        if (c.kind === "flat") {
            for (let i = 0; i < c.flat.positions.length; i++) {
                positions.push(base + c.flat.positions[i] * span);
                strengths.push(c.flat.strengths[i]);
            }
            for (let i = 0; i < c.flat.inactivePositions.length; i++) {
                inactivePositions.push(base + c.flat.inactivePositions[i] * span);
            }
        } else if (c.kind === "pattern") {
            let haps;
            try {
                haps = c.pattern.queryArc(s, s + 1);   // sample Strudel cycle s
            } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                continue;
            }
            if (!Array.isArray(haps)) continue;
            for (const hap of haps) {
                const begin = hapBegin(hap);
                if (!Number.isFinite(begin)) continue;
                const frac = begin - s;                  // within cycle s, [0,1)
                if (!(frac >= 0 && frac < 1)) continue;
                positions.push(base + frac * span);
                strengths.push(strengthFromHapValue(hap.value));
            }
        } else if (c.kind === "error") {
            error = c.error;
        }
        // "empty" → a rest measure, nothing placed.
    }
    /** @type {BeatPoints} */
    const out = { positions, strengths, inactivePositions };
    if (error !== undefined && positions.length === 0) out.error = error;
    return out;
}

/**
 * Derive the beat points of a curve from its Beat Points band
 * fields. The single entry point used by the canvas (drawing) and
 * the simulation (firing). The result is fixed for the object — it bakes the
 * whole `Measures × Repeats` phrase once and loops it (the groove resets each
 * path loop), so no per-cycle re-derivation is needed.
 * @param {any} curve
 * @returns {BeatPoints}
 */
export function deriveCurveBeatPoints(curve) {
    const mode = curve !== null && typeof curve.beatPointsMode === "string"
        ? curve.beatPointsMode
        : "none";
    if (mode === "normal" || mode === "auto" || mode === "euclidean") {
        // Legacy grid modes (deprecated, no inspector UI): one looped derivation,
        // with Repeats multiplying the beat-point count.
        return deriveNormalLooped(
            curve.activeBeats, curve.strength, curve.beatsPerCycle, curve.repeats,
            curve.vary, curve.varySeed, curve.beatsPerBar);
    }
    if (mode === "strudel") {
        // Measure-based phrase: M measures × R repeats around the path; slice s
        // takes measure (s mod M) sampled at Strudel cycle s (see
        // deriveStrudelMeasures and design/measure-patterns.md).
        return deriveStrudelMeasures(curve.beatPattern, curve.measures, curve.repeats);
    }
    return { positions: [], strengths: [], inactivePositions: [] };
}
