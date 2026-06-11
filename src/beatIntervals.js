/**
 * Beat-interval token table.
 *
 * Each curve carries a beatInterval field whose value is one
 * of the tokens in TOKENS below. The token names a musical
 * note duration; the engine converts the token to integer
 * ticks at runtime through this table. The list is the
 * authoritative dropdown order for the inspector and the
 * authoritative validation set for any code that accepts a
 * beatInterval value.
 *
 * Tick rate. Ticks are integer counts at 960 ticks per
 * quarter-note, the rate documented in DESIGN.md Section 7.
 * 960 is MIDI's standard PPQ rate, so any future MIDI-
 * related code inherits the same arithmetic without
 * conversion. It also makes every entry in TOKENS land on
 * an integer tick count, since 960 = 2^6 × 3 × 5 covers
 * the divisibility needs of 128th-notes (factor of 32),
 * triplets (factor of 3), and dotted variants (factor of
 * 2).
 *
 * Triplet semantics. The "Tr" suffix names the duration of
 * one note in a triplet that occupies one of the named
 * subdivision's worth of time. So 8th Tr is a triplet within
 * an 8th — each note is 1/3 of an 8th = 1/6 quarter = 160
 * ticks. Qtr Tr is a triplet within a quarter — each note is
 * 1/3 quarter = 320 ticks. Half Tr is a triplet within a half
 * — each note is 2/3 quarter = 640 ticks. This convention
 * places each "Tr" entry between the two regular subdivisions
 * adjacent to it in duration: 8th Tr (160) sits between 32nd
 * (120) and 16th (240); Qtr Tr (320) sits between 16th (240)
 * and Dot 16th (360); Half Tr (640) sits between 8th (480)
 * and Dot 8th (720). The dropdown order in TOKENS preserves
 * this ascending-duration order.
 *
 * Dotted semantics. The "Dot" prefix names a duration 1.5
 * times the named subdivision: Dot 16th = 1.5 × 16th = 3/8
 * quarter = 360 ticks. Dot 8th = 1.5 × 8th = 3/4 quarter =
 * 720 ticks. And so on.
 *
 * Multipliers. "2 x Wh" and "4 x Wh" name two and four whole
 * notes (8 quarters and 16 quarters), useful for slow events
 * where one slot spans multiple bars.
 */

// @ts-check

/**
 * @typedef {Object} BeatIntervalEntry
 * @property {string} token   The string stored in scene.json's beatInterval field.
 * @property {string} label   The human-readable label shown in the inspector dropdown.
 *                            (Currently the same as token; kept distinct so future
 *                            label changes don't perturb stored data.)
 * @property {number} ticks   The duration in 960-PPQ ticks.
 * @property {number} quarterNotes   The duration in quarter-notes (rational, kept
 *                                   as a JS number; equal to ticks / 960).
 */

/**
 * The full token list, in ascending-duration order — also the
 * order they appear in the inspector dropdown.
 * @type {BeatIntervalEntry[]}
 */
export const TOKENS = [
    { token: "128th",    label: "128th",    ticks: 30,    quarterNotes: 1 / 32 },
    { token: "64th",     label: "64th",     ticks: 60,    quarterNotes: 1 / 16 },
    { token: "32nd",     label: "32nd",     ticks: 120,   quarterNotes: 1 / 8 },
    { token: "8th Tr",   label: "8th Tr",   ticks: 160,   quarterNotes: 1 / 6 },
    { token: "16th",     label: "16th",     ticks: 240,   quarterNotes: 1 / 4 },
    { token: "Qtr Tr",   label: "Qtr Tr",   ticks: 320,   quarterNotes: 1 / 3 },
    { token: "Dot 16th", label: "Dot 16th", ticks: 360,   quarterNotes: 3 / 8 },
    { token: "8th",      label: "8th",      ticks: 480,   quarterNotes: 1 / 2 },
    { token: "Half Tr",  label: "Half Tr",  ticks: 640,   quarterNotes: 2 / 3 },
    { token: "Dot 8th",  label: "Dot 8th",  ticks: 720,   quarterNotes: 3 / 4 },
    { token: "Qtr",      label: "Qtr",      ticks: 960,   quarterNotes: 1 },
    { token: "Dot Qtr",  label: "Dot Qtr",  ticks: 1440,  quarterNotes: 3 / 2 },
    { token: "Half",     label: "Half",     ticks: 1920,  quarterNotes: 2 },
    { token: "Dot Half", label: "Dot Half", ticks: 2880,  quarterNotes: 3 },
    { token: "Whole",    label: "Whole",    ticks: 3840,  quarterNotes: 4 },
    { token: "2 x Wh",   label: "2 x Wh",   ticks: 7680,  quarterNotes: 8 },
    { token: "4 x Wh",   label: "4 x Wh",   ticks: 15360, quarterNotes: 16 },
];

/**
 * Default beatInterval token for newly-created curves and for
 * legacy scores that do not declare a value. "Qtr" preserves
 * the pre-v2.3 implicit assumption that one slot equals one
 * score-beat at quarter-note resolution, so existing scores
 * with cycleDuration N play with a cycle lasting N quarter-
 * notes before and after migration.
 */
export const DEFAULT_BEAT_INTERVAL = "Qtr";

/**
 * Number of ticks per quarter-note. Internal master time
 * unit for the simulation engine; not exposed to the user
 * (DESIGN.md Section 7's determinism block is the only
 * place this number appears outside of code).
 */
export const TICKS_PER_QUARTER = 960;

/** @type {Map<string, BeatIntervalEntry>} */
const TOKEN_LOOKUP = new Map(TOKENS.map((entry) => [entry.token, entry]));

/**
 * Look up a beatInterval token's full entry. Returns null if
 * the token is unrecognised. Validators and the simulation
 * engine call this to convert a stored token into a duration
 * for arithmetic.
 * @param {string} token
 * @returns {BeatIntervalEntry | null}
 */
export function getBeatIntervalEntry(token) {
    return TOKEN_LOOKUP.get(token) ?? null;
}

/**
 * Test whether a string is a valid beatInterval token.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidBeatInterval(value) {
    return typeof value === "string" && TOKEN_LOOKUP.has(value);
}

/**
 * Convenience: array of just the tokens in dropdown order, for
 * code (such as the schema) that wants the enumeration without
 * the per-entry metadata.
 * @returns {string[]}
 */
export function allBeatIntervalTokens() {
    return TOKENS.map((entry) => entry.token);
}

/**
 * Parse a beat-interval value into a count of beats (quarter-notes),
 * for the onTick `onBeatInterval(interval)` gate. Accepts three forms,
 * all defensive — anything unrecognised or non-finite returns 0, which
 * the caller treats as a no-op (the gate never fires):
 *
 *   (a) a token in the TOKENS table (e.g. "Qtr", "8th", "Dot 16th") →
 *       its quarterNotes value (Qtr = 1, 8th = 0.5);
 *   (b) a fraction string "N/D" naming a note value relative to a WHOLE
 *       note → beats = 4 × (N / D), so "1/8" = 0.5, "1/4" = 1,
 *       "3/32" = 0.375, "1/1" = 4. A zero or non-finite denominator,
 *       or a non-finite numerator, yields 0;
 *   (c) a plain finite number (or numeric string) → that many beats.
 *
 * @param {unknown} interval
 * @returns {number}  Beats (quarter-notes); 0 when unparseable.
 */
export function parseBeatInterval(interval) {
    // (c) a real number passed directly.
    if (typeof interval === "number") {
        return Number.isFinite(interval) && interval > 0 ? interval : 0;
    }
    if (typeof interval !== "string") return 0;
    const s = interval.trim();
    if (s === "") return 0;

    // (a) a token in the table.
    const entry = TOKEN_LOOKUP.get(s);
    if (entry !== undefined) return entry.quarterNotes;

    // (b) a fraction "N/D" — note value relative to a whole note.
    const slash = s.indexOf("/");
    if (slash !== -1) {
        const num = Number(s.slice(0, slash).trim());
        const den = Number(s.slice(slash + 1).trim());
        if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
            return 0;
        }
        const beats = 4 * (num / den);
        return Number.isFinite(beats) && beats > 0 ? beats : 0;
    }

    // (c) a numeric string.
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Pure boundary test for the onTick `onBeatInterval` gate. Returns true
 * when the musical-beat position crossed a multiple of intervalBeats
 * between the previous onTick and this one — i.e. the floor of the beat
 * position over the interval ticked up. Fires exactly once per boundary
 * and tracks BPM (the caller derives prev/cur from this.beat, which is
 * sim time scaled by tempo, not wall clock). A non-positive interval is
 * a no-op (returns false), matching parseBeatInterval's 0 sentinel.
 *
 * @param {number} prevBeat  Beat position at the previous onTick.
 * @param {number} curBeat   Beat position at this onTick.
 * @param {number} intervalBeats  Boundary spacing in beats.
 * @returns {boolean}
 */
export function crossesInterval(prevBeat, curBeat, intervalBeats) {
    if (!(intervalBeats > 0)) return false;
    if (!Number.isFinite(prevBeat) || !Number.isFinite(curBeat)) return false;
    return Math.floor(curBeat / intervalBeats) > Math.floor(prevBeat / intervalBeats);
}
