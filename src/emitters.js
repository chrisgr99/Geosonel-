// @ts-check

/**
 * Emitter argument parsing (GeoSonixV2 §3.3).
 *
 * Turns the flexible playNote / playSound call forms a callback uses
 * into a normalized spec the firing path consumes. Pure — no DOM, no
 * audio — so it unit-tests offline.
 *
 * playNote (pitched, plays from the object's NOTE voice):
 *   playNote(note, vel?, duration?, pan?)
 *   playNote("instrument", note, vel?, duration?, pan?)   // leading string overrides the voice
 *   playNote({ note, vel|velocity, sound, duration, pan })
 *
 * playSound (sample, plays from the object's SOUND BANK):
 *   playSound(sample, vel?)
 *   playSound("bank", sample, vel?)                        // two leading strings override the bank
 *   playSound({ sample, bank, vel|velocity })
 *
 * In both, the velocity (0..1) defaults to the firing context's
 * `vel` (the beat accent) when omitted, so `playNote(60)` plays the
 * note at the beat's strength. A note may be a MIDI number or a note
 * name ("c4"); to tell a leading note-name string from a leading
 * instrument string, a string that LOOKS like a pitch is treated as
 * the note, anything else (with a note following) as the instrument.
 */

/**
 * @param {unknown} o
 * @returns {boolean}
 */
function isPlainObject(o) {
    return o !== null && typeof o === "object" && !Array.isArray(o);
}

/**
 * Pick a finite velocity, else fall back to the context default.
 * @param {unknown} v
 * @param {number} fallback
 * @returns {number}
 */
function pickVelocity(v, fallback) {
    return (typeof v === "number" && Number.isFinite(v)) ? v : fallback;
}

/**
 * @param {unknown} v
 * @returns {number | undefined}
 */
function numberOrUndefined(v) {
    return (typeof v === "number" && Number.isFinite(v)) ? v : undefined;
}

/**
 * Does this string look like a pitch (a note name) rather than an
 * instrument or sample name? Matches a letter A-G with an optional
 * accidental (#, b, s) and an optional octave (e.g. "c", "C#4",
 * "eb3", "f#-1"). "bd", "piano", "RolandTR909" do not match.
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeNoteName(s) {
    return /^[A-Ga-g](#|b|s)?(-?\d{1,2})?$/.test(s);
}

/**
 * @typedef {{ sound: string|null, note: unknown, velocity: number,
 *   duration: number|undefined, pan: number|undefined }} NoteSpec
 */

/**
 * Normalize playNote arguments into a NoteSpec.
 * @param {unknown[]} args  The arguments the callback passed.
 * @param {number} defaultVel  The firing context's vel (beat accent).
 * @returns {NoteSpec}
 */
export function buildNoteSpec(args, defaultVel) {
    if (args.length === 1 && isPlainObject(args[0])) {
        const o = /** @type {any} */ (args[0]);
        return {
            sound: (typeof o.sound === "string" && o.sound.length > 0) ? o.sound : null,
            note: o.note,
            velocity: pickVelocity(o.vel ?? o.velocity, defaultVel),
            duration: numberOrUndefined(o.duration),
            pan: numberOrUndefined(o.pan),
        };
    }
    let i = 0;
    /** @type {string|null} */
    let sound = null;
    // Leading string + a following argument = instrument override,
    // UNLESS the string is itself a pitch (a note name).
    if (typeof args[0] === "string" && args.length >= 2 && !looksLikeNoteName(args[0])) {
        sound = args[0];
        i = 1;
    }
    const note = args[i++];
    const velocity = pickVelocity(args[i++], defaultVel);
    const duration = numberOrUndefined(args[i++]);
    const pan = numberOrUndefined(args[i++]);
    return { sound, note, velocity, duration, pan };
}

/**
 * @typedef {{ bank: string|null, sample: unknown, velocity: number }} SoundSpec
 */

/**
 * Normalize playSound arguments into a SoundSpec.
 * @param {unknown[]} args
 * @param {number} defaultVel
 * @returns {SoundSpec}
 */
export function buildSoundSpec(args, defaultVel) {
    if (args.length === 1 && isPlainObject(args[0])) {
        const o = /** @type {any} */ (args[0]);
        return {
            bank: (typeof o.bank === "string" && o.bank.length > 0) ? o.bank : null,
            sample: o.sample,
            velocity: pickVelocity(o.vel ?? o.velocity, defaultVel),
        };
    }
    let i = 0;
    /** @type {string|null} */
    let bank = null;
    let sample;
    // Two leading strings = bank override then sample; otherwise the
    // first argument is the sample and the bank comes from the object.
    if (typeof args[0] === "string" && typeof args[1] === "string") {
        bank = args[0];
        sample = args[1];
        i = 2;
    } else {
        sample = args[0];
        i = 1;
    }
    const velocity = pickVelocity(args[i++], defaultVel);
    return { bank, sample, velocity };
}
