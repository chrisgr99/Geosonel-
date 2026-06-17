/**
 * Melodic note generator (GeoSonixV2).
 *
 * Where mapToHarmony indexes the current chord's tones by a value — so
 * consecutive draws can leap — this produces a LINE: mostly stepwise motion,
 * occasional leaps, resolving smoothly across chord changes. It is the shared
 * PURE CORE behind the callback helpers `mapMelody`, `mapBass`, … (each a thin
 * wrapper that supplies a PROFILE and the per-object previous note; the wrapper
 * + engine-owned state live elsewhere).
 *
 * The model, per step:
 *   1. PALETTE — the key's diatonic scale notes in [rangeLow, rangeHigh] within
 *      a window of the previous note (so 1-2 semitone steps are available, not
 *      just 3-4 semitone chord-tone jumps).
 *   2. WEIGHT — each candidate scored by melodic plausibility: a step/leap
 *      interval table, a current-chord boost (extra on strong beats), a root
 *      boost (for bass lines), voice-leading toward the NEXT chord as the change
 *      approaches, a register-gravity pull toward the window centre, and a gentle
 *      descending bias.
 *   3. PICK — weights → CDF, sampled by `dice` (the colour under the cursor, in
 *      [0, 1)). Same image + path → same line, so replays stay deterministic.
 *
 * Pure module: no DOM, no esm.sh, no Node built-ins — node --testable. Reuses
 * the harmony helpers for chord/scale pitch classes (passed in as plain arrays,
 * so the core never imports the chord parser).
 */

// @ts-check

import { MStyle } from "./mStyle.js";
import { getMaterializedMelodic } from "./styleStore.js";

/** Diatonic scale intervals (semitones from the tonic). */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
/** Natural minor (a sensible default; harmonic/melodic refinements are later). */
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/**
 * Named scale palettes (intervals from the tonic). A style's `scale` names one
 * of these; "key" means "follow the song key's own major/minor mode". Adding a
 * scale here is all it takes to make it available to every style.
 * @type {Record<string, number[]>}
 */
export const SCALES = Object.freeze({
    major: MAJOR_SCALE,
    minor: MINOR_SCALE,
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    majorPentatonic: [0, 2, 4, 7, 9],
    minorPentatonic: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    bebopDominant: [0, 2, 4, 5, 7, 9, 10, 11],
    bebopMajor: [0, 2, 4, 5, 7, 8, 9, 11],
    wholeTone: [0, 2, 4, 6, 8, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
});

/**
 * Relative likelihood of a melodic interval by ABSOLUTE semitone distance
 * (0 = repeat, 1-2 = step, 3-4 = third, …). Steps dominate, small leaps are
 * fine, the tritone and large leaps are rare, the octave is a slightly-special
 * leap. Indexed by |distance|; distances past the end read as ~0. A profile's
 * `leapAversion` exponent sharpens (>1) or flattens (<1) this curve.
 * @type {number[]}
 */
export const INTERVAL_WEIGHTS = [
    0.10, // 0  unison / repeat
    0.90, // 1  m2
    1.00, // 2  M2  (the commonest step)
    0.50, // 3  m3
    0.40, // 4  M3
    0.25, // 5  P4
    0.05, // 6  tritone
    0.15, // 7  P5
    0.06, // 8  m6
    0.05, // 9  M6
    0.04, // 10 m7
    0.03, // 11 M7
    0.10, // 12 octave (special)
];

/**
 * @typedef {Object} MelodyProfile
 * @property {number} rangeLow      lowest MIDI note allowed
 * @property {number} rangeHigh     highest MIDI note allowed
 * @property {number} window        max |interval| from the previous note (semitones)
 * @property {number} leapAversion  exponent on the interval weight (>1 = stricter steps)
 * @property {number} chordPull     weight multiplier for current-chord tones
 * @property {number} strongChordPull  EXTRA multiplier for chord tones on strong beats
 * @property {number} rootPull      EXTRA multiplier for the chord ROOT on strong beats (bass)
 * @property {number} passing       weight multiplier for non-chord scale tones
 * @property {number} lead          boost for tones a step from a NEXT-chord tone near a change
 * @property {number} leadWindow    beats-to-next at/under which `lead` engages
 * @property {number} gravity       0..1 pull toward the register centre
 * @property {number} descendBias   multiplier for descending candidates (>1 favours down)
 */

/** Melody: mid/high register, stepwise, chord tones on strong beats. */
export const MELODY = Object.freeze({
    rangeLow: 60, rangeHigh: 84, window: 12,
    leapAversion: 1.0, chordPull: 2.5, strongChordPull: 2.0, rootPull: 1.0,
    passing: 1.0, lead: 2.0, leadWindow: 1.0, gravity: 0.4, descendBias: 1.1,
});

/** Bass: low register, narrow window, ROOT on the change, approach the next root. */
export const BASS = Object.freeze({
    rangeLow: 36, rangeHigh: 55, window: 7,
    leapAversion: 0.8, chordPull: 3.0, strongChordPull: 2.0, rootPull: 4.0,
    passing: 0.5, lead: 3.0, leadWindow: 1.0, gravity: 0.5, descendBias: 1.0,
});

/**
 * The scale pitch classes (0..11, ascending) for a key, optionally overriding
 * the scale by name. `scaleName` absent or "key" follows the key's own mode;
 * any {@link SCALES} name (e.g. "blues", "minorPentatonic", "dorian") roots
 * that scale on the key's tonic.
 * @param {{ tonicPitchClass: number, mode: "major" | "minor" }} key
 * @param {string} [scaleName]
 * @returns {number[]}
 */
export function scalePitchClasses(key, scaleName) {
    const tonic = (((key && key.tonicPitchClass) || 0) % 12 + 12) % 12;
    let ivs;
    if (scaleName && scaleName !== "key" && SCALES[scaleName]) {
        ivs = SCALES[scaleName];
    } else {
        ivs = key && key.mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
    }
    return ivs.map((iv) => (tonic + iv) % 12);
}

/** Clamp v to [0, 1]. */
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * A FRIENDLY style — the small, composer-facing surface a `styles.*` object
 * exposes: a scale name, a default register, and the two macro feel-knobs
 * (`smoothness`, `chordLock`). `expandProfile` turns it into the raw weights
 * {@link melodicStep} consumes. Optional `rootPull` / `descendBias` / `lead` /
 * `gravity` pass straight through for fine-tuning.
 * @typedef {Object} Style
 * @property {string} scale           scale name, or "key" to follow the key's mode
 * @property {[number, number]} range default [low, high] MIDI register
 * @property {number} smoothness      0..1 — steps vs leaps (higher = smoother)
 * @property {number} chordLock       0..1 — float on the scale vs land on chord tones
 * @property {number} [rootPull]      extra weight for the chord root on strong beats
 * @property {number} [descendBias]   multiplier for descending candidates
 * @property {number} [lead]          voice-leading boost into the next chord
 * @property {number} [gravity]       pull toward the register centre
 * @property {boolean} [breathe]      take the automatic phrase-end breath (rest
 *   the phrase's last beat). True for singing voices (melody/lead); set false
 *   for a continuous foundation (bass, accompaniment) that plays through.
 *   Defaults to true when unset.
 */

/**
 * Built-in styles. Frozen — customise by SPREADING into a new object
 * (`{ ...styles.melodic, scale: "blues" }`), never by mutating these.
 * @type {Record<"melodic" | "bass" | "lead", Style>}
 */
export const styles = Object.freeze({
    // Singable mid-register line: mostly steps, chord tones on strong beats.
    melodic: Object.freeze(new MStyle({
        scale: "key", range: [60, 84], smoothness: 0.75, chordLock: 0.55,
        descendBias: 1.1, lead: 1.8, gravity: 0.4, breathe: true,
    })),
    // Low, narrow, root on the change, walks to the next root. A foundation
    // voice: it plays THROUGH phrase ends (no breath). Sustained and
    // groove-driven by default.
    bass: Object.freeze(new MStyle({
        scale: "key", range: [36, 55], smoothness: 0.55, chordLock: 0.85,
        rootPull: 4, descendBias: 1.0, lead: 2.5, gravity: 0.5, breathe: false,
        articulation: 0.95, velocityWeight: 0.7,
    })),
    // Lead-guitar feel: high, minor-pentatonic, leapier and looser on the chord.
    // A touch more separated and punchy.
    lead: Object.freeze(new MStyle({
        scale: "minorPentatonic", range: [64, 88], smoothness: 0.5, chordLock: 0.4,
        descendBias: 1.0, lead: 1.4, gravity: 0.3, breathe: true,
        articulation: 0.65, accentResponse: 1.3,
    })),
});

/**
 * Resolve a STYLE NAME to its (shared, frozen) MStyle TEMPLATE — the
 * per-callback voice-of-pitch the engine binds as `this.style`. Callers `.copy()`
 * it to customise (the scaffolded callback does); a no-argument nxtNote() reads
 * it directly. Resolution order: the app-wide user library (styleStore) first,
 * then the built-in `styles`, then the default melodic style. An empty or unknown
 * name yields the default. A user voice style shadows a built-in of the same name.
 * @param {string} name
 * @returns {import("./mStyle.js").MStyle}
 */
export function resolveStyleByName(name) {
    if (typeof name === "string" && name !== "") {
        const user = getMaterializedMelodic(name);
        if (user !== null) return user;
        if (styles[name]) return styles[name];
    }
    return styles.melodic;
}

/**
 * Expand a friendly {@link Style} (+ optional low/span register override) into
 * the raw weights {@link melodicStep} consumes. `smoothness` drives the leap
 * aversion and window; `chordLock` drives chord-tone pull vs passing-tone
 * allowance.
 * @param {Style} style
 * @param {number} [low]   override lowest MIDI note
 * @param {number} [span]  override register width in semitones (high = low + span)
 * @returns {MelodyProfile}
 */
export function expandProfile(style, low, span) {
    const s = style || styles.melodic;
    const sm = clamp01(typeof s.smoothness === "number" ? s.smoothness : 0.7);
    const cl = clamp01(typeof s.chordLock === "number" ? s.chordLock : 0.5);
    const range = Array.isArray(s.range) ? s.range : [60, 84];
    const rLow = typeof low === "number" ? low : range[0];
    const rHigh = (typeof low === "number" && typeof span === "number")
        ? low + span : range[1];
    return {
        rangeLow: rLow,
        rangeHigh: rHigh,
        window: Math.round(7 + (1 - sm) * 7),     // 7 (smooth) .. 14 (leapy)
        leapAversion: 0.5 + sm * 1.5,             // 0.5 .. 2.0
        chordPull: 1 + cl * 3,                    // 1 .. 4
        strongChordPull: 1 + cl * 2,              // 1 .. 3
        rootPull: typeof s.rootPull === "number" ? s.rootPull : 1,
        passing: 1 - cl * 0.7,                    // 1 .. 0.3
        lead: typeof s.lead === "number" ? s.lead : 1.6,
        leadWindow: 1,
        gravity: typeof s.gravity === "number" ? s.gravity : 0.4,
        descendBias: typeof s.descendBias === "number" ? s.descendBias : 1.05,
    };
}

/** Interval weight for an absolute semitone distance (>=0). */
function intervalWeight(dist) {
    if (dist < 0) dist = -dist;
    return dist < INTERVAL_WEIGHTS.length ? INTERVAL_WEIGHTS[dist] : 0;
}

/** Whether a beat is "strong" (downbeat-ish): even beat index in the cycle. */
function isStrongBeat(beatIndex) {
    return (typeof beatIndex === "number" ? beatIndex : 0) % 2 === 0;
}

/**
 * Choose the next melodic MIDI note. PURE.
 *
 * @param {number | null} prevNote  previous MIDI note, or null to seed the line
 * @param {number[]} scalePcs       palette pitch classes (the key's scale)
 * @param {number[]} chordPcs       current chord pitch classes (harmonic anchor)
 * @param {number | null} rootPc    current chord root pitch class (for rootPull), or null
 * @param {number[]} nextChordPcs   next chord pitch classes (voice-leading), [] if none
 * @param {number | null} beatsToNext  beats until the next chord change, or null
 * @param {number} beatIndex        beat index in the cycle (strong-beat detection)
 * @param {number} dice             draw in [0, 1) — the colour under the cursor
 * @param {MelodyProfile} profile
 * @param {number[]} [anchorPcs]     pitch classes to favour at a phrase boundary
 *   (e.g. tonic / dominant / chord root at a phrase start, tonic / root at its
 *   end). Empty for a mid-phrase note.
 * @param {number} [anchorStrength]  weight multiplier for anchorPcs (1 = none)
 * @returns {number} a MIDI note in [rangeLow, rangeHigh]
 */
export function melodicStep(
    prevNote, scalePcs, chordPcs, rootPc, nextChordPcs,
    beatsToNext, beatIndex, dice, profile, anchorPcs = [], anchorStrength = 1,
) {
    const lo = Math.ceil(profile.rangeLow);
    const hi = Math.floor(profile.rangeHigh);
    const centre = (lo + hi) / 2;
    const halfSpan = Math.max(1, (hi - lo) / 2);
    const chordSet = new Set(chordPcs);
    const nextSet = new Set(nextChordPcs);
    const scaleSet = new Set(scalePcs);
    const anchorSet = (anchorPcs.length > 0 && anchorStrength !== 1)
        ? new Set(anchorPcs.map((pc) => ((pc % 12) + 12) % 12)) : null;
    const strong = isStrongBeat(beatIndex);
    const leadOn = typeof beatsToNext === "number"
        && beatsToNext <= profile.leadWindow && nextSet.size > 0;

    /** @type {Array<{ note: number, w: number }>} */
    const cands = [];
    let total = 0;
    for (let n = lo; n <= hi; n++) {
        const pc = ((n % 12) + 12) % 12;
        if (!scaleSet.has(pc)) continue;
        // Window around the previous note keeps motion local (skip on seed).
        if (prevNote !== null && Math.abs(n - prevNote) > profile.window) continue;

        let w = 1;
        if (prevNote !== null) {
            w *= Math.pow(intervalWeight(n - prevNote), profile.leapAversion);
            if (n < prevNote) w *= profile.descendBias;
        }
        const isChord = chordSet.has(pc);
        w *= isChord ? profile.chordPull : profile.passing;
        if (strong && isChord) w *= profile.strongChordPull;
        if (strong && rootPc !== null && pc === ((rootPc % 12) + 12) % 12) {
            w *= profile.rootPull;
        }
        if (leadOn) {
            // A step (1-2 semitones) from any next-chord tone → resolves smoothly.
            for (const npc of nextSet) {
                const d = Math.min(((pc - npc) % 12 + 12) % 12, ((npc - pc) % 12 + 12) % 12);
                if (d >= 1 && d <= 2) { w *= profile.lead; break; }
            }
        }
        // Register gravity: pull toward the window centre.
        w *= 1 - profile.gravity * (Math.abs(n - centre) / halfSpan);
        // Phrase anchoring: at a phrase boundary, favour primary/cadential tones.
        if (anchorSet !== null && anchorSet.has(pc)) w *= anchorStrength;
        if (!(w > 0)) continue;
        cands.push({ note: n, w });
        total += w;
    }

    if (cands.length === 0 || total <= 0) {
        // Degenerate (no in-window scale notes / all zero): nearest scale note to
        // the previous, or the register centre on a seed.
        return nearestScaleNote(prevNote === null ? Math.round(centre) : prevNote, scaleSet, lo, hi);
    }

    // CDF sample by the colour draw.
    const d = (typeof dice === "number" && Number.isFinite(dice))
        ? Math.min(0.999999, Math.max(0, dice)) : 0;
    let acc = 0;
    const target = d * total;
    for (const c of cands) {
        acc += c.w;
        if (acc > target) return c.note;
    }
    return cands[cands.length - 1].note;
}

/**
 * Nearest MIDI note in [lo, hi] whose pitch class is in the scale, searching
 * outward from `from`. Falls back to `from` clamped if the scale set is empty.
 * @param {number} from
 * @param {Set<number>} scaleSet
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function nearestScaleNote(from, scaleSet, lo, hi) {
    const clamp = (n) => Math.min(hi, Math.max(lo, n));
    const start = clamp(Math.round(from));
    for (let r = 0; r <= hi - lo; r++) {
        for (const n of [start - r, start + r]) {
            if (n < lo || n > hi) continue;
            if (scaleSet.has(((n % 12) + 12) % 12)) return n;
        }
    }
    return start;
}
