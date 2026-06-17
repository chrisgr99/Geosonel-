/**
 * VStyle — a reusable VOICE STYLE (a "vStyle"): the configurable inputs
 * `nxtNote` combines with the ambient firing context to produce one coordinated
 * note (pitch + velocity + duration + pan, plus a reserved bend). It is the rich
 * INPUT half of the note pipeline; `nxtNote` turns a VStyle into a slim note
 * object `{ sound, note, velocity, duration, pan, bend }` that `playNote`
 * consumes.
 *
 * Named vStyle (class `VStyle`), NOT "voice": the object's INSTRUMENT/timbre is
 * already the `voice` / `sound` field elsewhere, whereas a vStyle is the
 * BEHAVIOUR — how colour and groove become a note. The "Style" half is
 * pitch-neutral on purpose, so a vStyle covers both pitched notes and percussive
 * hits (the `kind` field).
 *
 * Each axis input — `pitch` / `velocity` / `duration` / `pan` — is a DRIVER:
 *   - a number       → a fixed value;
 *   - a string       → a colour-channel name, read from `ctx.col` (e.g. "r", "lt");
 *   - a function     → a formula of the ambient context, e.g. `(c) => c.col.r ** 2`.
 * `resolveDrive` collapses any of those to a 0..1 number. Velocity and duration
 * also carry a WEIGHT blending the beat strength against that image drive, plus
 * phrase-position shaping. Every field has a default, so a vStyle can be
 * assembled one property at a time.
 *
 * For the app-wide library a vStyle is stored as JSON, so it can't hold live
 * functions: {@link serializeVStyle} / {@link materializeVStyle} convert between
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
 * The default vStyle (melody-like). Mirrors the pitch behaviour of the built-in
 * melody style and adds neutral driver/shaping defaults. Frozen — a VStyle
 * copies values OUT of it, never references it.
 */
const DEFAULTS = Object.freeze({
    // What the vStyle GENERATES. "melodic" (the only kind built today) picks a
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
    pan: undefined,     // undefined = centre (reserved for collision geometry)
    // --- reserved: pitch-bend spec. undefined = Off. No playback yet (the
    //     per-note automation scheduler and the MIDI bend-message stream are
    //     deferred); the field exists so the model is forward-compatible. ---
    bend: undefined,
    // --- shaping knobs ---
    velocityWeight: 0.5,   // 0 = all image, 1 = all beat strength
    durationWeight: 0.5,   // 0 = all articulation baseline, 1 = all image
    articulation: 0.8,     // 0 = staccato, 1 = legato (fill the slot)
    accentResponse: 1,     // > 1 = punchier beat-strength → velocity contrast
    phraseDynamics: 0.5,   // how much phrase position shapes velocity / duration
    // --- output instrument ---
    sound: undefined,
});

/** The fields a VStyle carries (and copies). Exported so the Script-tab
 *  autocomplete can offer them after a `.` on a VStyle variable. */
export const VSTYLE_FIELDS = Object.keys(DEFAULTS);

/**
 * The driver axes whose STORED form is tagged (fixed | channel | formula); every
 * other VStyle field serialises as plain JSON. `bend` is NOT here — it is
 * reserved and stored as-is until bend playback lands.
 */
export const DRIVER_FIELDS = ["pitch", "velocity", "duration", "pan"];

/**
 * A reusable, mutable vStyle. Build one from a base (another VStyle, or a
 * plain style object like the built-in `styles.melody`) or from nothing (all
 * defaults), then set whatever properties you like — one line at a time.
 */
export class VStyle {
    /**
     * @param {object | VStyle} [base]  values to seed from; missing fields
     *   fall back to the defaults (so `new VStyle(styles.melody)` inherits its
     *   pitch behaviour and picks up the default drivers/weights).
     */
    constructor(base) {
        const src = (base && typeof base === "object") ? base : DEFAULTS;
        for (const k of VSTYLE_FIELDS) {
            const v = (k in src) ? src[k] : DEFAULTS[k];
            // Clone the range array so a copy can't mutate the source's; driver
            // functions are shared by reference (they're stateless).
            this[k] = (k === "range" && Array.isArray(v)) ? v.slice() : v;
        }
    }

    /**
     * A mutable copy — independent of this one (range cloned; driver functions
     * shared). This is how you take a library vStyle and customize it without
     * touching the shared template: `const lead = styles.lead.copy()`.
     * @returns {VStyle}
     */
    copy() {
        return new VStyle(this);
    }
}

/** The fields a Note carries — nxtNote's output, playNote's input. Exported so
 *  the autocomplete can offer them after a `.` on a Note variable. */
export const NOTE_FIELDS = ["sound", "note", "velocity", "duration", "pan", "bend"];

/**
 * One playable NOTE — the slim, coordinated output of `nxtNote`, consumed by
 * `playNote`. A real class (parallel to {@link VStyle}) so its type is
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
 * Serialise a runtime VStyle to a JSON-safe plain object for the app-wide
 * library. Driver axes become tagged forms; every other field copies through
 * (range cloned, `bend` as-is). Inverse of {@link materializeVStyle}.
 * @param {VStyle | object} vStyle
 * @returns {object}
 */
export function serializeVStyle(vStyle) {
    const src = (vStyle && typeof vStyle === "object") ? vStyle : DEFAULTS;
    /** @type {Record<string, any>} */
    const out = {};
    for (const k of VSTYLE_FIELDS) {
        const v = (k in src) ? /** @type {any} */ (src)[k] : DEFAULTS[k];
        if (DRIVER_FIELDS.includes(k)) {
            out[k] = driverToStored(v);
        } else if (k === "range" && Array.isArray(v)) {
            out[k] = v.slice();
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Build a runtime VStyle from a stored JSON object (the inverse of
 * {@link serializeVStyle}). Driver axes compile from their tagged form; every
 * other field copies through, with a missing field falling back to the default.
 * @param {object | null | undefined} json
 * @returns {VStyle}
 */
export function materializeVStyle(json) {
    const src = (json && typeof json === "object") ? /** @type {Record<string, any>} */ (json) : {};
    /** @type {Record<string, any>} */
    const seed = {};
    for (const k of VSTYLE_FIELDS) {
        if (DRIVER_FIELDS.includes(k)) {
            seed[k] = (k in src) ? driverFromStored(src[k]) : DEFAULTS[k];
        } else {
            seed[k] = (k in src) ? src[k] : DEFAULTS[k];
        }
    }
    return new VStyle(seed);
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
