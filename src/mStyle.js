/**
 * MStyle — a MELODIC voice style (an "mStyle"): one of the two subtypes under the
 * vStyle umbrella (the other is the rhythmic rStyle). The configurable inputs
 * `nxtNote` combines with the ambient firing context to produce one coordinated
 * note (pitch + velocity + duration + pan, plus a reserved bend). It is the rich
 * INPUT half of the note pipeline; `nxtNote` turns an MStyle into a slim note
 * object `{ sound, note, velocity, duration, pan, bend }` that `playNote`
 * consumes.
 *
 * An mStyle is the melodic BEHAVIOUR — how colour and groove become a pitched
 * note — distinct from the object's INSTRUMENT/timbre (the `voice` / `sound`
 * field elsewhere). It carries pitch behaviour, the four axis drivers, and (via
 * the shared rhythm core) the knobs that generate its own beat pattern in Auto
 * mode; an rStyle reuses that same rhythm core, once per drum lane.
 *
 * Each axis input — `pitch` / `velocity` / `duration` / `pan` — is a DRIVER:
 *   - a number       → a fixed value;
 *   - a string       → a colour-channel name, read from `ctx.col` (e.g. "r", "lt");
 *   - a function     → a formula of the ambient context, e.g. `(c) => c.col.r ** 2`.
 * `resolveDrive` collapses any of those to a 0..1 number. Velocity and duration
 * also carry a WEIGHT blending the beat strength against that image drive, plus
 * phrase-position shaping. Every field has a default, so an mStyle can be
 * assembled one property at a time.
 *
 * For the app-wide library an mStyle is stored as JSON, so it can't hold live
 * functions: {@link serializeMStyle} / {@link materializeMStyle} convert between
 * the runtime form (drivers as number | channel | function) and the stored form
 * (drivers tagged fixed | channel | formula, the formula a source STRING
 * compiled back to a function on load).
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
 * The default mStyle (a singable melodic line). Mirrors the pitch behaviour of
 * the built-in melodic style and adds neutral driver/shaping defaults. Frozen —
 * an MStyle copies values OUT of it, never references it.
 */
const DEFAULTS = Object.freeze({
    // The melodic sub-kind. "melodic" is the only one built; "chordal" (return
    // several notes) is reserved. nxtNote dispatches off this; unknown kinds fall
    // back to melodic.
    kind: "melodic",
    // Whether this note style picks a pitch. true = melodic; false = percussion
    // (no pitch — the sound comes from the object's voice). Toggled by the Note
    // editor's melodic/percussion flag; when false the Pitch band is hidden.
    pitched: true,
    // --- pitch behaviour (read by harmonyMelody.expandProfile / melodicStep) ---
    scale: "key",
    // How strongly notes are pulled to the scale (0 = chromatic-free, 1 = locked
    // to scale). Reserved: the generator still hard-filters to the scale until
    // the soft-scale change lands; this field is the future Scale Pull strength.
    scalePull: 0.85,
    range: [60, 84],
    smoothness: 0.75,
    chordLock: 0.55,
    rootPull: undefined,
    descendBias: 1.1,
    lead: 1.8,
    gravity: 0.4,
    // Phrase-end breath as a 0..1 amount (0 = play through, no breath; 1 = a full
    // breath). The LENGTH it maps to is a later engine change; for now > 0 just
    // means "breathe" (the current fixed length).
    breathe: 1,
    // --- axis drivers: value | colour-channel name | function(ctx) ---
    pitch: "lt",        // the pitch "dice" — lightness picks the scale position
    velocity: "r",      // the image side of velocity
    duration: "b",      // the image side of duration
    pan: undefined,     // undefined = centre (reserved for collision geometry)
    // --- reserved: pitch-bend spec. undefined = Off. No playback yet (the
    //     per-note automation scheduler and the MIDI bend-message stream are
    //     deferred); the field exists so the model is forward-compatible. ---
    bend: undefined,
    // --- shaping knobs ---
    velocityWeight: 0.5,   // 0 = all beat strength, 1 = all image  (image amount, matches durationWeight)
    durationWeight: 0.5,   // 0 = all default sustain, 1 = all image
    articulation: 0.9,     // default SUSTAIN in beats — how long the note holds (absolute, ~0..2)
    overlap: 0,            // beats past (+) / short of (−) the next onset — legato overlap / gap
    accentResponse: 1,     // > 1 = punchier beat-strength → velocity contrast
    phraseDynamics: 0.5,   // how much phrase position shapes velocity / duration
    // --- rhythm core: the Auto beat-pattern generation controls (design/styles.md,
    //     design/rhythm-auto-generation.md). Used when this voice generates its own
    //     beats in Auto beat-points mode (and, later, once per RhythmStyle drum
    //     lane). Plain data — scalars + small nested groups. Grid resolution
    //     (subdivision) is the OBJECT's beat grid, not a knob here. ---
    rhythm: Object.freeze({
        density: 0.5,        // sparse ↔ busy (target onset fraction)
        syncopation: 0.2,    // straight ↔ off-beat (weight off strong beats)
        imageTiming: Object.freeze({   // Image Influence on Timing
            amount: 0.5,     // None ↔ Strong: how much the image bends the onsets
            channel: "b",    // which colour channel drives the bend
        }),
        dynamicRange: 0.5,   // beat-strength spread (flat ↔ wide) → Velocity "A"
        fills: Object.freeze({
            frequency: 0.0,  // how often a fill fires (phrase-level)
            intensity: 0.5,  // how big the fill (density surge + subdivision + push)
        }),
        ratchets: Object.freeze({
            frequency: 0.0,  // how often a hit becomes a buzz/roll
            intensity: 0.5,  // how big the burst (sub-hit count / density)
        }),
        salt: 0,             // per-style variation seed (the Variation re-roll)
    }),
    // (No `sound` field: a style never carries an instrument — the firing object's
    //  own voice is always used. The style is purely musical behaviour.)
    // --- musical role: the voice's function in the ensemble (foundation, pulse,
    //     accent, lead, pad, fill, counter), or "none" for a free voice. Shared by
    //     melodic and rhythmic styles; role presets/biasing is a later step. ---
    role: "none",
});

/** The fields a MStyle carries (and copies). Exported so the Script-tab
 *  autocomplete can offer them after a `.` on a MStyle variable. */
export const MSTYLE_FIELDS = Object.keys(DEFAULTS);

/** The rhythm-core (Rhythm style) field names (design/rhythm-auto-generation.md) —
 *  a heterogeneous set: scalars (density, syncopation, dynamicRange, salt) plus the
 *  nested groups imageTiming / fills / ratchets. A NoteStyle carries one core
 *  (`.rhythm`); a RhythmStyle reuses this shape (later, once per drum lane). */
export const RHYTHM_CORE_FIELDS = Object.keys(DEFAULTS.rhythm);

/** A fresh, mutable rhythm core seeded with the defaults — deep, so the nested
 *  groups (imageTiming / fills / ratchets) are independent copies. For RhythmStyle
 *  lanes and the editor's "reset" affordance. */
export function defaultRhythmCore() {
    return mergeRhythmCore(null);
}

/**
 * Deep-merge a partial / stored rhythm core onto a fresh default core. Plain data
 * (no drivers): scalars overlay by value, the nested groups merge field-by-field —
 * so a partial or older core fills its defaults, and the result owns independent
 * nested objects (a copy never shares the source's groups).
 * @param {any} v @returns {object}
 */
function mergeRhythmCore(v) {
    const d = DEFAULTS.rhythm;
    const src = (v && typeof v === "object") ? v : {};
    const num = (x, fb) => (typeof x === "number" && Number.isFinite(x)) ? x : fb;
    const grp = (key, scalarFields) => {
        const o = (src[key] && typeof src[key] === "object") ? src[key] : {};
        const out = {};
        for (const f of Object.keys(d[key])) {
            out[f] = scalarFields.includes(f)
                ? num(o[f], d[key][f])
                : (typeof o[f] === "string" ? o[f] : d[key][f]);   // channel (string)
        }
        return out;
    };
    return {
        density: num(src.density, d.density),
        syncopation: num(src.syncopation, d.syncopation),
        imageTiming: grp("imageTiming", ["amount"]),
        dynamicRange: num(src.dynamicRange, d.dynamicRange),
        fills: grp("fills", ["frequency", "intensity"]),
        ratchets: grp("ratchets", ["frequency", "intensity"]),
        salt: num(src.salt, d.salt),
    };
}

/**
 * The driver axes whose STORED form is tagged (fixed | channel | formula); every
 * other MStyle field serialises as plain JSON. `bend` is NOT here — it is
 * reserved and stored as-is until bend playback lands.
 */
export const DRIVER_FIELDS = ["pitch", "velocity", "duration", "pan"];

/**
 * A reusable, mutable vStyle. Build one from a base (another MStyle, or a
 * plain style object like the built-in `styles.melodic`) or from nothing (all
 * defaults), then set whatever properties you like — one line at a time.
 */
export class MStyle {
    /**
     * @param {object | MStyle} [base]  values to seed from; missing fields
     *   fall back to the defaults (so `new MStyle(styles.melodic)` inherits its
     *   pitch behaviour and picks up the default drivers/weights).
     */
    constructor(base) {
        const src = (base && typeof base === "object") ? base : DEFAULTS;
        for (const k of MSTYLE_FIELDS) {
            const v = (k in src) ? src[k] : DEFAULTS[k];
            if (k === "rhythm") {
                // Deep-merge over the defaults so a partial / missing core fills in,
                // and so a copy owns an independent core (nested groups and all).
                this.rhythm = mergeRhythmCore(v);
            } else {
                // Clone the range array so a copy can't mutate the source's;
                // driver functions are shared by reference (they're stateless).
                this[k] = (k === "range" && Array.isArray(v)) ? v.slice() : v;
            }
        }
    }

    /**
     * A mutable copy — independent of this one (range cloned; driver functions
     * shared). This is how you take a library vStyle and customize it without
     * touching the shared template: `const lead = styles.lead.copy()`.
     * @returns {MStyle}
     */
    copy() {
        return new MStyle(this);
    }
}

/** The fields a Note carries — nxtNote's output, playNote's input. Exported so
 *  the autocomplete can offer them after a `.` on a Note variable. */
export const NOTE_FIELDS = ["sound", "note", "velocity", "duration", "pan", "bend"];

/**
 * One playable NOTE — the slim, coordinated output of `nxtNote`, consumed by
 * `playNote`. A real class (parallel to {@link MStyle}) so its type is
 * explicit and the autocomplete can recognise a variable built from `nxtNote`.
 *   - `note`     — pitch (MIDI; 0 = rest);
 *   - `velocity` — 0..1;
 *   - `duration` — seconds;
 *   - `sound`    — instrument, or undefined to use the object's own voice;
 *   - `pan`      — -1..1, or undefined for centre;
 *   - `bend`     — reserved pitch-bend spec, or undefined for none (no playback yet).
 */
export class Note {
    /** @param {{sound?: any, note?: number, velocity?: number, duration?: number, pan?: number, bend?: any}} [fields] */
    constructor(fields = {}) {
        this.sound = fields.sound;
        this.note = fields.note;
        this.velocity = fields.velocity;
        this.duration = fields.duration;
        this.pan = fields.pan;
        this.bend = fields.bend;
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
 * Compile a formula expression string — a JS expression in terms of the firing
 * context `c` (e.g. "c.col.r ** 2") — into a driver function. `resolveDrive`
 * calls it as `fn.call(ctx, ctx)`, so both `c` and `this` are the context. The
 * source is stashed on a non-enumerable `__src` so the function round-trips back
 * to its stored form. Returns undefined when the expression won't compile, so a
 * typo can't crash the engine (the axis just falls back to its default).
 * @param {string} expr
 * @returns {Function | undefined}
 */
export function compileFormula(expr) {
    if (typeof expr !== "string" || expr.trim() === "") return undefined;
    try {
        // The vStyle author writes their own formulas, same trust model as the
        // Script-tab callback bodies the engine already compiles.
        // eslint-disable-next-line no-new-func
        const fn = new Function("c", `"use strict"; return (${expr});`);
        Object.defineProperty(fn, "__src", { value: expr, enumerable: false });
        return /** @type {Function} */ (fn);
    } catch (_err) {
        return undefined;
    }
}

/**
 * Convert a runtime driver (number | channel-name string | function) to its
 * JSON-storable TAGGED form. A function carries its source on `__src` when it
 * came from {@link compileFormula}; otherwise we best-effort its toString (a
 * code-built closure may not round-trip, but form-built formulas always do).
 * @param {*} driver
 * @returns {{src: string, value?: number, channel?: string, expr?: string}}
 */
export function driverToStored(driver) {
    if (typeof driver === "function") {
        const anyFn = /** @type {any} */ (driver);
        const expr = (typeof anyFn.__src === "string") ? anyFn.__src : driver.toString();
        return { src: "formula", expr };
    }
    if (typeof driver === "string") return { src: "channel", channel: driver };
    if (typeof driver === "number" && Number.isFinite(driver)) return { src: "fixed", value: driver };
    return { src: "off" };
}

/**
 * Convert a stored tagged driver back to a runtime driver. A formula compiles to
 * a function of the context; an unknown/off form yields undefined (the axis
 * falls back to its default at resolve time). Tolerates a bare number/string too
 * (a hand-authored or legacy value).
 * @param {*} stored
 * @returns {number | string | Function | undefined}
 */
export function driverFromStored(stored) {
    if (stored === null || typeof stored !== "object") {
        if (typeof stored === "number" && Number.isFinite(stored)) return stored;
        if (typeof stored === "string") return stored;
        return undefined;
    }
    switch (stored.src) {
        case "fixed": return (typeof stored.value === "number" && Number.isFinite(stored.value)) ? stored.value : undefined;
        case "channel": return (typeof stored.channel === "string") ? stored.channel : undefined;
        case "formula": return compileFormula(stored.expr);
        default: return undefined;
    }
}

/**
 * Serialise a runtime MStyle to a JSON-safe plain object for the app-wide
 * library. Driver axes become tagged forms; every other field copies through
 * (range cloned, `bend` as-is). Inverse of {@link materializeMStyle}.
 * @param {MStyle | object} vStyle
 * @returns {object}
 */
export function serializeMStyle(vStyle) {
    const src = (vStyle && typeof vStyle === "object") ? vStyle : DEFAULTS;
    /** @type {Record<string, any>} */
    const out = {};
    for (const k of MSTYLE_FIELDS) {
        const v = (k in src) ? /** @type {any} */ (src)[k] : DEFAULTS[k];
        if (DRIVER_FIELDS.includes(k)) {
            out[k] = driverToStored(v);
        } else if (k === "rhythm") {
            out[k] = mergeRhythmCore(v);
        } else if (k === "range" && Array.isArray(v)) {
            out[k] = v.slice();
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Build a runtime MStyle from a stored JSON object (the inverse of
 * {@link serializeMStyle}). Driver axes compile from their tagged form; every
 * other field copies through, with a missing field falling back to the default.
 * @param {object | null | undefined} json
 * @returns {MStyle}
 */
export function materializeMStyle(json) {
    const src = (json && typeof json === "object") ? /** @type {Record<string, any>} */ (json) : {};
    /** @type {Record<string, any>} */
    const seed = {};
    for (const k of MSTYLE_FIELDS) {
        if (DRIVER_FIELDS.includes(k)) {
            seed[k] = (k in src) ? driverFromStored(src[k]) : DEFAULTS[k];
        } else {
            seed[k] = (k in src) ? src[k] : DEFAULTS[k];
        }
    }
    return new MStyle(seed);
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
 * @param {number} [p.weight]                 velocityWeight 0..1 (0 = all strength, 1 = all image)
 * @param {number} [p.accentResponse]         > 0; > 1 = punchier
 * @param {{atStart?:boolean,atEnd?:boolean}|null} [p.phrase]
 * @param {number} [p.phraseDynamics]         0..1
 * @returns {number} 0..1
 */
export function shapeVelocity({ beatStrength, image, weight, accentResponse, phrase, phraseDynamics }) {
    const s = clamp01(num(beatStrength, 0));
    const img = (typeof image === "number" && Number.isFinite(image)) ? clamp01(image) : null;
    const w = clamp01(num(weight, 0.5));
    let v = (img === null) ? s : (w * img + (1 - w) * s);
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
 * Coordinated note SUSTAIN in BEATS — how long the note holds from its onset,
 * ABSOLUTE (not a fraction of the slot), so it works for notes with no scheduled
 * next note (collisions / triggers). `articulation` is the default sustain in beats
 * (0..SUSTAIN_MAX); the image drive (0..1) scales to the same range and blends by
 * `weight`. Shape to Phrases multiplies it (longer into a phrase end, clipped on a
 * weak mid-phrase beat). Finally, IF a next note is known, the note ends at
 * `min(sustain, beatsToNext + overlap)`: +overlap rings past the next onset, −overlap
 * stops short of it. No next note → the absolute sustain stands.
 *
 * @param {object} p
 * @param {number|null} [p.beatsToNext]  beats to the next onset, or null (no next note)
 * @param {number} [p.image]             0..1 image drive (scales to the sustain range)
 * @param {number} [p.weight]            durationWeight 0..1
 * @param {number} [p.articulation]      default sustain in BEATS (~0..2)
 * @param {number} [p.overlap]           beats past (+) / short of (−) the next onset
 * @param {number} [p.beatStrength]      0..1
 * @param {{atStart?:boolean,atEnd?:boolean}|null} [p.phrase]
 * @param {number} [p.phraseDynamics]    0..1
 * @returns {number} sustain in beats (> 0)
 */
export function shapeDuration({ beatsToNext, image, weight, articulation, overlap, beatStrength, phrase, phraseDynamics }) {
    const SUSTAIN_MAX = 2;
    const art = clampRange(num(articulation, 0.9), 0, SUSTAIN_MAX);
    const img = (typeof image === "number" && Number.isFinite(image)) ? clamp01(image) * SUSTAIN_MAX : null;
    const w = clamp01(num(weight, 0.5));
    let sustain = (img === null) ? art : (w * img + (1 - w) * art);   // beats
    const pd = clamp01(num(phraseDynamics, 0));
    if (pd > 0) {
        if (phrase && phrase.atEnd) sustain *= 1 + 0.25 * pd;
        else sustain *= 1 - 0.15 * pd * (1 - clamp01(num(beatStrength, 0.5)));
    }
    sustain = Math.max(0.02, sustain);
    if (typeof beatsToNext === "number" && beatsToNext > 0) {
        const limit = Math.max(0.02, beatsToNext + num(overlap, 0));
        return Math.min(sustain, limit);
    }
    return sustain;
}
