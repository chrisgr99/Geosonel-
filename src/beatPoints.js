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
 *   ranges?: number[],
 *   drops?: number[],
 *   inactivePositions: number[],
 *   sources?: Array<{measure: number, start: number, end: number} | null>,
 *   error?: string,
 * }} BeatPoints
 *
 * `ranges` (Strudel measure mode) is index-aligned with `strengths`: 0 = a
 * fixed digit, > 0 = a `NcM` canvas token whose strength swings ±range about the
 * base (`strengths[i]`) driven by the object's Driver-from-Canvas channel,
 * resolved at fire time.
 *
 * `drops` (Strudel measure mode) is index-aligned with `strengths`: 0 = the beat
 * always plays; 1..9 = a canvas DROP level from the third positional digit
 * (`SVD`, e.g. `705`). At fire time the beat is SILENCED where the object's
 * Drop-from-Canvas channel under it sits in the lowest `drop × 10%` of its range
 * (low = drop), so the line thins out over part of the image. Like `ranges`,
 * drops are flat-only (0 for engine-parsed measures).
 *
 * `sources` (Strudel measure mode only) is index-aligned with `positions`: each
 * is the source box index + character span within that box's pattern that
 * produced the beat, for the playing-token highlight (null when unknown).
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
 * and `phrases` then multiplies the whole thing N times around the path.
 * @param {unknown} activeBeats
 * @param {unknown} strength
 * @param {unknown} beatsPerCycle
 * @param {unknown} phrases
 * @returns {BeatPoints}
 */
function deriveNormalLooped(activeBeats, strength, beatsPerCycle, phrases, vary, varySeed, beatsPerBar, phraseSlots) {
    // Phrases lays whole copies of a base pattern end-to-end around the path: N
    // copies → N × beat points, the cursor sweeping them in one traversal. The
    // pattern (and strength) may be PER PHRASE — an array entry per phrase (Manual,
    // fill-forward resolved by the caller) — or a single string used for every
    // phrase (Euclidean/Auto, one generated pattern). Each phrase loops its own
    // pattern/strength to fill its cycle independently.
    //
    // Phrases are normally all the same `beatsPerCycle` slots (uniform tiling).
    // `phraseSlots`, when given (chart-following), is a per-phrase slot count, so
    // the phrases are VARIABLE length — phrase k spans phraseSlots[k] slots. Each
    // phrase still loops its own pattern + strength to fill its OWN length, and
    // the ghost/fill-forward the caller resolved per phrase is unchanged; only the
    // phrase boundaries move. The total slot count n is their sum.
    const r = Number(phrases);
    const reps = (Number.isFinite(r) && r >= 1) ? Math.floor(r) : 1;
    const patAt = (k) => bareString(Array.isArray(activeBeats)
        ? activeBeats[Math.min(k, activeBeats.length - 1)] : activeBeats) || "x";
    const strAt = (k) => bareString(Array.isArray(strength)
        ? strength[Math.min(k, strength.length - 1)] : strength) || String(DEFAULT_STRENGTH);
    const phrasePats = Array.from({ length: reps }, (_, k) => patAt(k));
    const phraseStrs = Array.from({ length: reps }, (_, k) => strAt(k));
    const bpc = Number(beatsPerCycle);
    const base = (Number.isFinite(bpc) && bpc >= 1) ? Math.floor(bpc) : phrasePats[0].length;
    // Per-phrase slot counts: the explicit variable list (clamped to >= 1, falling
    // back to `base` for a bad entry) or a uniform `base` for every phrase.
    const slotsPer = (Array.isArray(phraseSlots) && phraseSlots.length === reps)
        ? phraseSlots.map((s) => { const v = Math.floor(Number(s)); return Number.isFinite(v) && v >= 1 ? v : base; })
        : Array.from({ length: reps }, () => base);
    const n = slotsPer.reduce((a, b) => a + b, 0) || 1;
    // Variation: `vary` = max notes flipped PER CYCLE. Each phrase (cycle) gets its
    // OWN variation — a delta from THAT phrase's pattern (non-cumulative), seeded by
    // the phrase index so phrases differ; the varied pattern then LOOPS to fill the
    // cycle exactly as the unvaried one does. vary 0 → the phrase's pattern as-is.
    const maxFlips = Math.max(0, Math.floor(Number(vary)) || 0);
    const seed = Number(varySeed) | 0;
    const cyclePats = (maxFlips > 0)
        ? phrasePats.map((p, k) => variedCycle(p, maxFlips, seed, k, beatsPerBar))
        : phrasePats;
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const out = [];
    /** @type {number[]} */
    const inactivePositions = [];
    let i = 0;                                    // running global slot index
    for (let k = 0; k < reps; k++) {              // each phrase, in order
        const pat = cyclePats[k];
        const strs = phraseStrs[k];
        const slots = slotsPer[k];
        for (let slot = 0; slot < slots; slot++) {  // slots within THIS phrase
            const ch = pat[slot % pat.length];
            const count = beatCountForSlot(ch);
            if (count > 0) {
                const d = strs[slot % strs.length];  // strength loops WITHIN the phrase
                const strengthVal = (d !== undefined && isDigit(d))
                    ? Number(d) : DEFAULT_STRENGTH;
                // A digit slot is a ratchet: `count` evenly-spaced sub-hits
                // across the slot's interval, all at the slot's strength.
                for (let j = 0; j < count; j++) {
                    positions.push((i + j / count) / n);
                    out.push(strengthVal);
                }
            } else {
                inactivePositions.push(i / n);
            }
            i += 1;
        }
    }
    return { positions, strengths: out, inactivePositions };
}

/**
 * Resolve a comma-segmented per-MEASURE field into a length-`count` array with
 * GHOSTED-MODULE fill: the most recent run of consecutive typed measures forms a
 * "module" that LOOPS forward into the blanks that follow it, until the next typed
 * measure starts a fresh module. So typing one measure repeats it every bar
 * (`A→A A A A`); typing two repeats the pair (`A B→A B A B`); typing a new pattern
 * later begins a new loop there. This is the chart-mirror fill — each measure
 * plays its own or the looped-module pattern, ghosted in the editor. (Distinct
 * from fillForwardPhrases' inherit-nearest, which holds the last value instead of
 * looping the module.)
 * @param {unknown} agg  comma-joined per-measure patterns, or ""/non-string.
 * @param {number} count  number of measures.
 * @param {unknown} fallback  the legacy single value for measure 0 if it's blank.
 * @returns {string[]}
 */
export function moduleLoopFill(agg, count, fallback) {
    const parts = (typeof agg === "string" && agg !== "") ? agg.split(",") : [];
    const typed = (k) => {
        const v = (k < parts.length && typeof parts[k] === "string") ? parts[k] : "";
        return (v === "" && k === 0 && typeof fallback === "string") ? fallback : v;
    };
    const REST = ".";                                       // a blank/pad measure = a rest bar
    const out = [];
    let moduleStart = -1;
    /** @type {string[]} */ let run = [];                   // the typed run, while collecting
    /** @type {string[] | null} */ let cycle = null;        // run snapped + rest-padded, once a blank ends it
    for (let i = 0; i < count; i += 1) {
        const t = typed(i);
        if (t !== "") {
            // A typed measure right after a blank (or the first one) starts a fresh
            // module; otherwise it extends the current run.
            if (run.length === 0 || typed(i - 1) === "") { moduleStart = i; run = [t]; cycle = null; }
            else run.push(t);
            out.push(t);
        } else if (run.length > 0) {
            // First blank after the run fixes the loop length: snap it to the 4-bar
            // grid (1,2 keep their length; 3+ round up to a multiple of 4) and pad the
            // shortfall with REST bars, so e.g. 3 typed → "A B C ." looped every 4.
            if (cycle === null) {
                const len = run.length <= 2 ? run.length : Math.ceil(run.length / 4) * 4;
                cycle = run.slice();
                while (cycle.length < len) cycle.push(REST);
            }
            out.push(cycle[(i - moduleStart) % cycle.length]);
        } else {
            out.push(REST);                                 // nothing typed yet → rest
        }
    }
    return out;
}

/**
 * Resolve a comma-segmented per-phrase field (phrasePatterns / phraseStrengths)
 * into a length-`count` array with FILL-FORWARD: a phrase with no segment of its
 * own inherits the nearest preceding phrase that has one. Phrase 0 (and any empty
 * leading phrases) falls back to `fallback` — the legacy single field. So defining
 * a pattern at phrase N makes it apply from N forward until the next phrase that
 * defines its own, or the end.
 * @param {unknown} agg  comma-joined segments (one per phrase), or ""/non-string.
 * @param {number} count  number of phrases.
 * @param {unknown} fallback  the legacy single value for phrase 0 / unfilled head.
 * @returns {string[]}
 */
export function fillForwardPhrases(agg, count, fallback) {
    const parts = (typeof agg === "string" && agg !== "") ? agg.split(",") : [];
    const out = [];
    let last = (typeof fallback === "string") ? fallback : "";
    for (let k = 0; k < count; k++) {
        const v = (k < parts.length && typeof parts[k] === "string") ? parts[k] : "";
        if (v !== "") last = v;          // this phrase defines its own → the running value
        out.push(last);                  // own, or inherited from the nearest defined phrase
    }
    return out;
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
 * directly: a "~" rest, a bare "x"/"X" beat, a single strength digit,
 * or a canvas token (NcM / cM). Anything else (multi-character, sample
 * names, partial operators) means the pattern isn't flat and goes to
 * the engine.
 * @param {string} tok
 */
function isSimpleToken(tok) {
    return tok === "~" || tok === "x" || tok === "X"
        || DIGITS_TOKEN.test(tok)
        || CANVAS_TOKEN.test(tok);
}

/**
 * Canvas-driven strength token: `NcM` = base strength N (single digit) with a
 * ±M swing driven by the object's Driver-from-Canvas channel; `cM` = base 0.
 * The swing M is a single digit. The base/range are read at fire time against
 * the image colour under the beat (see the strength→velocity resolution in
 * simulation.js); here it just records the base (as the strength) and the range.
 */
const CANVAS_TOKEN = /^(\d?)c(\d)$/;

/**
 * Positional digit token, 1–3 digits, `S` / `SV` / `SVD`:
 *   - S   strength (0–9).
 *   - V   ±swing about the strength, driven by the canvas strength channel —
 *         the brief equivalent of the `NcM` swing token (`72` == `7c2`).
 *   - D   canvas DROP level (1–9): the beat is silenced where the object's
 *         Drop-from-Canvas channel under it is in the lowest `D × 10%` of its
 *         range (low = drop); 0/absent = always plays.
 * The swing slot must be present (use `0`) to reach the drop digit, e.g. `705`
 * = strength 7, no swing, ~50% drop. Resolved at fire time in simulation.js.
 */
const DIGITS_TOKEN = /^(\d)(\d)?(\d)?$/;

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
    if (tokens.length === 0) return { positions: [], strengths: [], inactivePositions: [], ranges: [], drops: [] };
    if (!tokens.every(isSimpleToken)) return null;
    const n = tokens.length;
    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const strengths = [];
    /** @type {number[]} */
    const inactivePositions = [];
    /** @type {number[]} */
    const ranges = [];   // 0 = fixed; > 0 = ±swing driven by the canvas channel
    /** @type {number[]} */
    const drops = [];    // 0 = always plays; 1..9 = canvas drop level (low = drop)
    for (let i = 0; i < n; i++) {
        const tok = tokens[i];
        if (tok === "~") {
            // A rest is an inactive beat: drawn small, never fired.
            inactivePositions.push(i / n);
            continue;
        }
        const cm = CANVAS_TOKEN.exec(tok);
        if (cm !== null) {
            positions.push(i / n);
            strengths.push(cm[1] === "" ? 0 : Number(cm[1]));   // base (cM → 0)
            ranges.push(Number(cm[2]));                          // ±swing
            drops.push(0);                                       // NcM carries no drop
            continue;
        }
        const dm = DIGITS_TOKEN.exec(tok);
        if (dm !== null) {
            positions.push(i / n);
            strengths.push(Number(dm[1]));                       // S
            ranges.push(dm[2] !== undefined ? Number(dm[2]) : 0);// V swing
            drops.push(dm[3] !== undefined ? Number(dm[3]) : 0); // D drop
            continue;
        }
        // x / X: default-strength beat, no swing, no drop.
        positions.push(i / n);
        strengths.push(DEFAULT_STRENGTH);
        ranges.push(0);
        drops.push(0);
    }
    return { positions, strengths, inactivePositions, ranges, drops };
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

/**
 * The character span of each ACTIVE token in a flat pattern (whitespace-split,
 * "~" rests skipped), index-aligned with deriveFlatSequence's positions — so a
 * beat point can be mapped back to the token in its measure box that produced it.
 * @param {string} raw  a trimmed flat pattern
 * @returns {Array<{start: number, end: number}>}
 */
function flatActiveSpans(raw) {
    /** @type {Array<{start: number, end: number}>} */
    const spans = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        if (m[0] === "~") continue;   // a rest is inactive, no active position
        spans.push({ start: m.index, end: m.index + m[0].length });
    }
    return spans;
}

/**
 * The source character span of a Strudel hap within its measure pattern, from
 * the mini-notation location the parser attaches. Offsets come back relative to
 * the QUOTED string (0 = the opening quote), so shift by -1 to land within the
 * pattern. Null when the hap carries no location.
 * @param {any} hap
 * @returns {{start: number, end: number} | null}
 */
function hapLoc(hap) {
    const locs = (hap && hap.context && Array.isArray(hap.context.locations))
        ? hap.context.locations : null;
    if (!locs || locs.length === 0 || locs[0] === null || typeof locs[0] !== "object") return null;
    const start = Number(locs[0].start);
    const end = Number(locs[0].end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start: Math.max(0, start - 1), end: Math.max(0, end - 1) };
}

/** Compile one measure pattern to a reusable form (cached per distinct string).
 *  @param {string} p @returns {{kind:string, flat?:any, spans?:any, pattern?:any, error?:string}} */
function compileMeasure(p) {
    const t = p.trim();
    if (t === "") return { kind: "empty" };
    const flat = deriveFlatSequence(t);
    if (flat !== null) return { kind: "flat", flat, spans: flatActiveSpans(t) };
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
 * @param {unknown} phrases      phrase tilings R (coerced to an integer >= 1).
 * @returns {BeatPoints}
 */
function deriveStrudelMeasures(beatPattern, measures, phrases) {
    const raw = typeof beatPattern === "string" ? beatPattern : "";
    const mM = Number(measures);
    const M = Number.isFinite(mM) && mM >= 1 ? Math.floor(mM) : 1;
    const rR = Number(phrases);
    const R = Number.isFinite(rR) && rR >= 1 ? Math.floor(rR) : 1;
    const slices = M * R;

    // Resolve fill-down AND track which box index SOURCES each measure (the
    // filled box a measure inherits from), so the playing-token highlight lights
    // the source box during an inherited bar. -1 = a rest (nothing to source).
    const segs = splitMeasures(raw);
    /** @type {string[]} */ const resolved = [];
    /** @type {number[]} */ const sourceBox = [];
    let last = "";
    let lastBox = -1;
    for (let i = 0; i < M; i++) {
        const seg = i < segs.length ? segs[i] : "";
        if (seg !== "") { last = seg; lastBox = i; }
        resolved.push(seg !== "" ? seg : last);
        sourceBox.push(seg !== "" ? i : lastBox);
    }

    /** @type {Map<string, any>} */
    const cache = new Map();
    const compile = (p) => {
        if (!cache.has(p)) cache.set(p, compileMeasure(p));
        return cache.get(p);
    };

    /** @type {number[]} */ const positions = [];
    /** @type {number[]} */ const strengths = [];
    /** @type {number[]} */ const ranges = [];
    /** @type {number[]} */ const drops = [];
    /** @type {number[]} */ const inactivePositions = [];
    /** @type {Array<{measure: number, start: number, end: number} | null>} */
    const sources = [];
    /** @type {string|undefined} */ let error;

    for (let s = 0; s < slices; s++) {
        const mi = s % M;
        const box = sourceBox[mi];   // source box index for this measure's pattern
        const c = compile(resolved[mi]);
        const base = s / slices;
        const span = 1 / slices;
        if (c.kind === "flat") {
            for (let i = 0; i < c.flat.positions.length; i++) {
                positions.push(base + c.flat.positions[i] * span);
                strengths.push(c.flat.strengths[i]);
                ranges.push(c.flat.ranges[i] || 0);
                drops.push((c.flat.drops && c.flat.drops[i]) || 0);
                const sp = c.spans[i];
                sources.push(sp ? { measure: box, start: sp.start, end: sp.end } : null);
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
                ranges.push(0);                          // canvas tokens are flat-only
                drops.push(0);                           // drop is flat-only too
                const loc = hapLoc(hap);
                sources.push(loc ? { measure: box, start: loc.start, end: loc.end } : null);
            }
        } else if (c.kind === "error") {
            error = c.error;
        }
        // "empty" → a rest measure, nothing placed.
    }
    /** @type {BeatPoints} */
    const out = { positions, strengths, ranges, drops, inactivePositions, sources };
    if (error !== undefined && positions.length === 0) out.error = error;
    return out;
}

/**
 * Total phrases tiled around the path for a beat-points object: the three-level
 * model's middle × outer levels, `phrases` (per section) × `sections`. Each
 * coerces to an integer >= 1 (default 1), so a curve with no `sections` field is
 * the legacy two-level model (sections = 1 → reps = phrases). The SINGLE source
 * of this product, shared by the canvas/firing derivation (deriveCurveBeatPoints)
 * and the path-length computation (simulation.effectiveBeatsPerCycle), so the two
 * can never disagree on how long the baked path is.
 * @param {any} obj
 * @returns {number}
 */
export function totalPhrases(obj) {
    const p = Number(obj == null ? NaN : obj.phrases);
    const perSection = (Number.isFinite(p) && p >= 1) ? Math.floor(p) : 1;
    const s = Number(obj == null ? NaN : obj.sections);
    const sections = (Number.isFinite(s) && s >= 1) ? Math.floor(s) : 1;
    return perSection * sections;
}

/**
 * The explicit per-phrase slot counts for a CHART-FOLLOWING object, or null when
 * the object tiles uniformly. `phraseBars` is the list of chart phrase lengths in
 * BARS (one entry per chart phrase, filled on chart load); each becomes
 * phraseBars[i] × cells-per-bar slots, so the object's phrases are variable
 * length and track the chart's phrase structure exactly. cells-per-bar is the
 * object's master-derived `beatsPerBar`. Shared by deriveCurveBeatPoints and the
 * firing path length (simulation.effectiveBeatsPerCycle) so they agree.
 * @param {any} obj
 * @returns {number[] | null}
 */
export function chartPhraseSlots(obj) {
    const bars = obj == null ? null : obj.phraseBars;
    if (!Array.isArray(bars) || bars.length === 0) return null;
    const c = Number(obj.beatsPerBar);
    const cellsPerBar = (Number.isFinite(c) && c >= 1) ? Math.floor(c) : 1;
    return bars.map((b) => {
        const n = Math.floor(Number(b) * cellsPerBar);
        return Number.isFinite(n) && n >= 1 ? n : cellsPerBar;
    });
}

/**
 * Chart-mirror derivation (beatPointsMode "chart"): the object plays the chart's
 * UNFOLDED played-bar timeline — `curve.chartBarSeq`, the folded-measure index
 * sounding at each played position, filled from the loaded chart by the run
 * pipeline. Each played bar emits its FOLDED measure's beat pattern (resolved
 * across the folded measures by the ghosted-module fill), looped within that one
 * bar's cells. So a repeated group replays its measures' patterns and a coda jump
 * follows the chart — the object tracks the chart bar for bar. cells-per-bar is
 * the object's master-derived `beatsPerBar`; the path is one cell-group per played
 * bar.
 * @param {any} curve
 * @returns {BeatPoints}
 */
function deriveChartMirror(curve) {
    const seq = curve.chartBarSeq;
    const c = Number(curve.beatsPerBar);
    const cpb = (Number.isFinite(c) && c >= 1) ? Math.floor(c) : 1;
    const rowOf = Array.isArray(curve.chartBarRow) ? curve.chartBarRow : null;
    const posOf = Array.isArray(curve.chartBarPos) ? curve.chartBarPos : null;
    const rc = Number(curve.chartRowCount);
    const rowCount = (Number.isFinite(rc) && rc >= 1) ? Math.floor(rc) : 1;
    // Per-ROW patterns (the Manual model): each chart row is one stored pattern,
    // fill-forward across rows (a blank row inherits the one above), looping to fill
    // its bars. Each PLAYED bar emits its bar's slice of its row's looped pattern.
    const rowPats = fillForwardPhrases(curve.phrasePatterns, rowCount, curve.activeBeats);
    const rowCells = (ri) => {
        const p = String(rowPats[Math.min(ri, rowPats.length - 1)] || "").replace(/\|/g, "");
        return p === "" ? "x" : p;
    };
    const ab = seq.map((fi) => {
        const i = Number(fi);
        const ri = rowOf ? (Number(rowOf[i]) || 0) : 0;
        const pos = posOf ? (Number(posOf[i]) || 0) : 0;
        const rp = rowCells(ri);
        let out = "";
        for (let j = 0; j < cpb; j += 1) out += rp[(pos * cpb + j) % rp.length];
        return out;
    });
    const slots = seq.map(() => cpb);
    return deriveNormalLooped(
        ab, curve.strength, curve.beatsPerCycle, ab.length,
        curve.vary, curve.varySeed, cpb, slots);
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
    // Chart-mirror: follow the loaded chart's played-bar timeline. (With no chart
    // yet, chartBarSeq is absent and chart mode falls through to the grid path.)
    if (mode === "chart" && Array.isArray(curve.chartBarSeq) && curve.chartBarSeq.length > 0) {
        return deriveChartMirror(curve);
    }
    if (mode === "normal" || mode === "auto" || mode === "euclidean" || mode === "chart") {
        // Manual / Euclidean grid: one looped derivation, Phrases multiplying the
        // beat-point count. Manual resolves a pattern (and strength) PER PHRASE with
        // fill-forward — a phrase with no pattern of its own inherits the nearest
        // preceding phrase that has one, phrase 1 falling back to the legacy
        // activeBeats/strength. Euclidean/Auto have no per-phrase tabs, so their one
        // generated activeBeats/strength tiles across every phrase.
        // Phrase count + per-phrase lengths. Chart-following objects carry an
        // explicit variable-length list (one phrase per chart phrase); otherwise
        // reps = phrases (per section) × sections, all the same length.
        const variable = chartPhraseSlots(curve);
        const reps = variable ? variable.length : totalPhrases(curve);
        const ab = (mode === "normal" || mode === "chart")
            ? fillForwardPhrases(curve.phrasePatterns, reps, curve.activeBeats)
            : curve.activeBeats;
        // Beat Strength is a SINGLE value that repeats across every phrase (no longer
        // per-phrase) — one looped string for all phrases.
        const st = curve.strength;
        return deriveNormalLooped(
            ab, st, curve.beatsPerCycle, reps,
            curve.vary, curve.varySeed, curve.beatsPerBar, variable);
    }
    if (mode === "strudel") {
        // Measure-based phrase: M measures × R phrases around the path; slice s
        // takes measure (s mod M) sampled at Strudel cycle s (see
        // deriveStrudelMeasures and design/measure-patterns.md).
        return deriveStrudelMeasures(curve.beatPattern, curve.measures, totalPhrases(curve));
    }
    return { positions: [], strengths: [], inactivePositions: [] };
}
