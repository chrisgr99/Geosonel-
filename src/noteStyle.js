/**
 * NoteStyle — a reusable VOICE: the configurable inputs `nxtNote` combines with
 * the ambient firing context to produce one coordinated note (pitch + velocity +
 * duration + pan). It is the rich INPUT half of the note pipeline; `nxtNote`
 * turns a NoteStyle into a slim note object `{ sound, note, velocity, duration,
 * pan }` that `playNote` consumes. (See the GX2 note-voice design notes.)
 *
 * Each axis input — `pitch` / `velocity` / `duration` / `pan` — is a DRIVER:
 *   - a number       → a fixed value;
 *   - a string       → a colour-channel name, read from `ctx.col` (e.g. "r", "lt");
 *   - a function     → a formula of the ambient context, e.g. `(c) => c.col.r ** 2`.
 * `resolveDrive` collapses any of those to a 0..1 number. Velocity and duration
 * also carry a WEIGHT blending the beat strength against that image drive, plus
 * phrase-position shaping. Every field has a default, so a voice can be
 * assembled one property at a time.
 *
 * Pure module: no DOM, no engine state — importable by `node --test` and
 * checkable by `node --check`.
 */

// @ts-check

/** @returns {number} v if finite, else d */
function num(v, d) { return (typeof v === "number" && Number.isFinite(v)) ? v : d; }
/** Clamp to [0, 1]. */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
/** Clamp to [lo, hi]. */
function clampRange(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * The default voice (melody-like). Mirrors the pitch behaviour of the built-in
 * melody style and adds neutral driver/shaping defaults. Frozen — a NoteStyle
 * copies values OUT of it, never references it.
 */
const DEFAULTS = Object.freeze({
    // What the voice GENERATES. "melodic" (the only kind built today) picks a
    // pitched scale tone; reserved for "percussion"/"beatbox" (pick a drum
    // sample) and "chordal" (return several notes) later. nxtNote dispatches off
    // this; unknown kinds fall back to melodic.
    kind: "melodic",
    // --- pitch behaviour (read by harmonyMelody.expandProfile / melodicStep) ---
    scale: "key",
    range: [60, 84],
    smoothness: 0.75,
    chordLock: 0.55,
    rootPull: undefined,
    descendBias: 1.1,
    lead: 1.8,
    gravity: 0.4,
    breathe: true,
    // --- axis drivers: value | colour-channel name | function(ctx) ---
    pitch: "lt",        // the pitch "dice" — lightness picks the scale position
    velocity: "r",      // the image side of velocity
    duration: "b",      // the image side of duration
    pan: undefined,     // undefined = centre
    // --- shaping knobs ---
    velocityWeight: 0.5,   // 0 = all image, 1 = all beat strength
    durationWeight: 0.5,   // 0 = all articulation baseline, 1 = all image
    articulation: 0.8,     // 0 = staccato, 1 = legato (fill the slot)
    accentResponse: 1,     // > 1 = punchier beat-strength → velocity contrast
    phraseDynamics: 0.5,   // how much phrase position shapes velocity / duration
    // --- output instrument ---
    sound: undefined,
});

/** The fields a NoteStyle carries (and copies). */
const FIELDS = Object.keys(DEFAULTS);

/**
 * A reusable, mutable voice. Build one from a base (another NoteStyle, or a
 * plain style object like the built-in `styles.melody`) or from nothing (all
 * defaults), then set whatever properties you like — one line at a time.
 */
export class NoteStyle {
    /**
     * @param {object | NoteStyle} [base]  values to seed from; missing fields
     *   fall back to the defaults (so `new NoteStyle(styles.melody)` inherits its
     *   pitch behaviour and picks up the default drivers/weights).
     */
    constructor(base) {
        const src = (base && typeof base === "object") ? base : DEFAULTS;
        for (const k of FIELDS) {
            const v = (k in src) ? src[k] : DEFAULTS[k];
            // Clone the range array so a copy can't mutate the source's; driver
            // functions are shared by reference (they're stateless).
            this[k] = (k === "range" && Array.isArray(v)) ? v.slice() : v;
        }
    }

    /**
     * A mutable copy — independent of this one (range cloned; driver functions
     * shared). This is how you take a library voice and customize it without
     * touching the shared template: `const lead = styles.lead.copy()`.
     * @returns {NoteStyle}
     */
    copy() {
        return new NoteStyle(this);
    }
}

/**
 * Resolve an axis DRIVER against the ambient firing context to a 0..1 number
 * (or undefined → the caller falls back to that axis's default).
 *   - function → `driver.call(ctx, ctx)` — so `(c) => …` and a `function(){ this… }`
 *     both see the context;
 *   - string   → `ctx.col[name]` — a colour channel;
 *   - number   → the value itself.
 * @param {*} driver
 * @param {*} ctx  firing context (exposes `col`, `vel`, `beatsToNext`, `chord`, …)
 * @returns {number | undefined}
 */
export function resolveDrive(driver, ctx) {
    if (typeof driver === "function") {
        const v = driver.call(ctx, ctx);
        return (typeof v === "number" && Number.isFinite(v)) ? v : undefined;
    }
    if (typeof driver === "string") {
        const col = ctx && ctx.col;
        const v = (col && typeof col === "object") ? col[driver] : undefined;
        return (typeof v === "number" && Number.isFinite(v)) ? v : undefined;
    }
    if (typeof driver === "number" && Number.isFinite(driver)) return driver;
    return undefined;
}

/**
 * Coordinated note velocity (0..1): the beat strength and the image drive
 * blended by `weight`, gamma-shaped by `accentResponse`, then nudged by phrase
 * position (firmer entering a phrase, softer at its close). With no image drive,
 * velocity is the beat strength alone.
 *
 * @param {object} p
 * @param {number} p.beatStrength             0..1 beat accent (the firing `vel`)
 * @param {number} [p.image]                  0..1 image drive, or undefined
 * @param {number} [p.weight]                 velocityWeight 0..1 (1 = all strength)
 * @param {number} [p.accentResponse]         > 0; > 1 = punchier
 * @param {{atStart?:boolean,atEnd?:boolean}|null} [p.phrase]
 * @param {number} [p.phraseDynamics]         0..1
 * @returns {number} 0..1
 */
export function shapeVelocity({ beatStrength, image, weight, accentResponse, phrase, phraseDynamics }) {
    const s = clamp01(num(beatStrength, 0));
    const img = (typeof image === "number" && Number.isFinite(image)) ? clamp01(image) : null;
    const w = clamp01(num(weight, 0.5));
    let v = (img === null) ? s : (w * s + (1 - w) * img);
    const ar = num(accentResponse, 1);
    if (ar > 0 && ar !== 1) v = Math.pow(v, ar);
    const pd = clamp01(num(phraseDynamics, 0));
    if (phrase && pd > 0) {
        if (phrase.atStart) v += 0.12 * pd;
        else if (phrase.atEnd) v -= 0.18 * pd;
    }
    return clamp01(v);
}

/**
 * Coordinated note duration in BEATS: the groove spacing (`beatsToNext`, the
 * slot length) times an articulation fraction — the `articulation` baseline
 * stretched toward the image drive by `weight`, then shaped by phrase position
 * (sustain into a phrase end; clip a weak mid-phrase beat). The fraction may
 * exceed 1 slightly so a legato note can overlap into the next.
 *
 * @param {object} p
 * @param {number|null} [p.beatsToNext]  beats to the next onset; null/invalid → 1
 * @param {number} [p.image]             0..1 image drive
 * @param {number} [p.weight]            durationWeight 0..1
 * @param {number} [p.articulation]      0..1 (0 staccato, 1 legato)
 * @param {number} [p.beatStrength]      0..1
 * @param {{atStart?:boolean,atEnd?:boolean}|null} [p.phrase]
 * @param {number} [p.phraseDynamics]    0..1
 * @returns {number} duration in beats (> 0)
 */
export function shapeDuration({ beatsToNext, image, weight, articulation, beatStrength, phrase, phraseDynamics }) {
    const slot = (typeof beatsToNext === "number" && beatsToNext > 0) ? beatsToNext : 1;
    const art = clamp01(num(articulation, 0.8));
    const img = (typeof image === "number" && Number.isFinite(image)) ? clamp01(image) : null;
    const w = clamp01(num(weight, 0.5));
    let frac = (img === null) ? art : (w * img + (1 - w) * art);
    const pd = clamp01(num(phraseDynamics, 0));
    if (pd > 0) {
        if (phrase && phrase.atEnd) frac += 0.25 * pd;
        else frac -= 0.15 * pd * (1 - clamp01(num(beatStrength, 0.5)));
    }
    frac = clampRange(frac, 0.05, 1.25);
    return slot * frac;
}
