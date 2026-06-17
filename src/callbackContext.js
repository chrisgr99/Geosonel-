// @ts-check

/**
 * Ambient callback context for bare-call emitters (GeoSonixV2 §3.2).
 *
 * A procedural callback runs with its object handle bound as `this`
 * (so reads are `this.vel`, `this.r`, `this.x`), and the ACTION
 * functions — playNote, playSound, applyForce — are callable BARE,
 * with no prefix and no context argument, exactly as in GeoSonix.
 *
 * A bare `playNote(60)` has to reach the object that is firing. The
 * engine sets the "current" firing context right before it invokes a
 * callback and clears it right after; the bare emitters here forward
 * to that current context's matching method. It is a single, tightly
 * scoped ambient pointer around each synchronous callback call (the
 * standard dynamic-context pattern, like p5.js global mode), not a
 * pile of per-property globals.
 *
 * The same functions are injected into every script.js callback's
 * scope by the scene loader (executeScript), so they resolve as bare
 * names; they are stable singletons that route dynamically through
 * `current`.
 */

import { mapToHarmonyCore, mapRange, MAP_TO_HARMONY_DEFAULTS } from "./harmonyMap.js";
import {
    melodicStep,
    scalePitchClasses,
    expandProfile,
    styles as STYLES,
} from "./harmonyMelody.js";
import { resolveDrive, shapeVelocity, shapeDuration, Note } from "./vStyle.js";

/**
 * Per-object melodic memory for nxtNote: object id → its last MIDI note. The
 * generator is sequential (each note depends on the previous), so the line's
 * state lives here, keyed by the firing object's id, and is CLEARED on rewind /
 * scene change ({@link clearMelodyState}) so a replay reproduces the same line.
 * @type {Map<string, number>}
 */
const melodyState = new Map();

/** Reset the per-object melodic memory (called by the engine on rewind / setScene). */
export function clearMelodyState() {
    melodyState.clear();
}

/** @type {any} */
let current = null;

/**
 * Ambient "current harmony" for the bare `mapToHarmony` global, mirroring the
 * ambient `current` firing context. The engine sets it right before a
 * callback fires (the chord sounding at that beat, plus the song key) and
 * clears it after. `mapToHarmony` reads it so a bare `mapToHarmony(value)` maps
 * to a tone of the chord under the playhead. null when no harmony is loaded or
 * playback has ended (loop off) — `mapToHarmony` then degrades to a linear map.
 *
 * It also carries the optional `phrase` state for `nxtNote` (the musical
 * phrasing grid, scene.harmony.phrases): whether this beat falls in a gap
 * between phrases (rest), and whether it is a phrase's first / last note (so
 * the line can anchor to a primary / cadential tone). Absent when no phrase
 * grid is defined — the line then plays continuously, as before.
 * @type {{ chord: any, key: any, phrase?: { inGap: boolean, atStart: boolean, atEnd: boolean } } | null}
 */
let currentHarmony = null;

/**
 * Bind the ambient harmony for the bare `mapToHarmony` / `nxtNote` globals.
 * Called by the engine immediately before invoking a callback, alongside
 * {@link setCallbackContext}.
 * @param {{ chord: any, key: any, phrase?: { inGap: boolean, atStart: boolean, atEnd: boolean } } | null} harmony
 */
export function setCallbackHarmony(harmony) {
    currentHarmony = harmony;
}

/** Clear the ambient harmony after a callback returns (or throws). */
export function clearCallbackHarmony() {
    currentHarmony = null;
}

/**
 * Bare mapToHarmony — map a value to a MIDI note of the CURRENT chord (the
 * chord sounding under the playhead at the moment the callback fires).
 *
 *   mapToHarmony(value, lowValue?, highValue?, rangeLow?, rangeHigh?)
 *
 * Defaults: lowValue=0, highValue=1, rangeLow=40, rangeHigh=70 (MIDI). The
 * chord's tones are laid out ascending across [rangeLow, rangeHigh] and the
 * value (clamped to [lowValue, highValue]) indexes into them — chord-tone
 * INDEXING, like GeoSonix. With no current chord (no imported harmony, or
 * playback ended with loop off) it degrades to a LINEAR map of the value
 * across [rangeLow, rangeHigh]. Returns a MIDI note number; returns 60
 * (middle C) as a last resort when called outside any callback.
 * @param {number} value
 * @param {number} [lowValue]
 * @param {number} [highValue]
 * @param {number} [rangeLow]
 * @param {number} [rangeHigh]
 * @returns {number}
 */
export function mapToHarmony(
    value,
    lowValue = MAP_TO_HARMONY_DEFAULTS.lowValue,
    highValue = MAP_TO_HARMONY_DEFAULTS.highValue,
    rangeLow = MAP_TO_HARMONY_DEFAULTS.rangeLow,
    rangeHigh = MAP_TO_HARMONY_DEFAULTS.rangeHigh,
) {
    const v = (typeof value === "number" && Number.isFinite(value)) ? value : 0;
    const chord = currentHarmony ? currentHarmony.chord : null;
    const key = currentHarmony ? currentHarmony.key : null;
    return mapToHarmonyCore(chord, key, v, lowValue, highValue, rangeLow, rangeHigh);
}

/**
 * Pitch classes (0..11) of a chord STRUCTURE ({root: MIDI, notes: offsets})
 * as exposed on the firing context (this.chord / this.nextChord). Empty for a
 * null chord.
 * @param {{ root: number, notes: number[] } | null | undefined} c
 * @returns {number[]}
 */
function chordStructurePcs(c) {
    if (c === null || c === undefined || !Array.isArray(c.notes)) return [];
    return c.notes.map((n) => (((c.root + n) % 12) + 12) % 12);
}

/**
 * Bare nxtNote — the next note of a melodic LINE for the firing object. Two
 * calling forms, dispatched on the first argument:
 *
 *   nxtNote(drive, style, low?, span?)  → a bare MIDI note (legacy)
 *   nxtNote(noteStyle)                  → { sound, note, velocity, duration, pan }
 *
 * LEGACY (a number first): `drive` is the 0..1 signal you choose (e.g. the colour
 * under the cursor); `style` is a {@link styles} profile; `low`/`span` override
 * the register. Returns a MIDI note (0 = rest).
 *
 * VOICE (a VStyle first): pitch, velocity, and duration are computed TOGETHER
 * from the style's drivers + the ambient beat strength / colour / phrase, and
 * returned as one coordinated note object for `playNote` (src/vStyle.js).
 *
 * Either way the current chord, next chord, beats-to-next, beat index, key, and
 * the object's previous note come from the ambient firing context. Outside a
 * callback: 60 (number) / a default note object.
 *
 * @param {number | import("./vStyle.js").VStyle} arg0
 * @param {import("./harmonyMelody.js").Style} [style]
 * @param {number} [low]
 * @param {number} [span]
 * @returns {number | import("./vStyle.js").Note}
 */
export function nxtNote(arg0, style, low, span) {
    if (current === null) {
        // Outside a callback: keep the legacy number default; a style argument
        // gets a benign default Note so a caller can't crash.
        return (arg0 !== null && typeof arg0 === "object")
            ? new Note({ sound: arg0.sound, note: 60, velocity: 0.8 })
            : 60;
    }
    // No argument → the callback slot's STYLE (`this.style`, set by the engine
    // from the object's inspector-assigned style), or the default melody style
    // when none is assigned. The zero-boilerplate `playNote(nxtNote())` path.
    if (arg0 === undefined) {
        return nxtNoteFromStyle(current.style || STYLES.melodic);
    }
    // A VStyle (any object) → the COORDINATED note object { sound, note,
    // velocity, duration, pan }. A number → the legacy bare-MIDI return, so
    // existing scripts are untouched.
    if (arg0 !== null && typeof arg0 === "object") {
        return nxtNoteFromStyle(arg0);
    }
    return nxtNoteLegacy(arg0, style, low, span);
}

/**
 * Legacy nxtNote: a number `drive` + a style profile → a bare MIDI note (0 =
 * rest). The original contract, kept verbatim for back-compat.
 * @returns {number}
 */
function nxtNoteLegacy(drive, style, low, span) {
    const ctx = current;
    const prof = style || STYLES.melodic;
    const breathes = prof.breathe !== false;
    const phrase = currentHarmony ? currentHarmony.phrase : null;
    // Phrase silence (return 0 — playNote treats it as a rest, leaving the
    // line's previous note as the melodic memory): a GAP between phrases (every
    // phrased voice rests). For BREATHING voices (melody/lead, breathe !== false)
    // also the phrase's auto-breath tail; and they cap the current note so it
    // releases just before the next phrase. A bass / accompaniment ignores the
    // breath and plays through. The cap is read by the engine's note emitter via
    // this firing context's _breathReleaseBeats.
    delete ctx._breathReleaseBeats;
    if (phrase) {
        if (phrase.inGap) return 0;
        if (breathes && typeof phrase.release === "number") {
            if (phrase.release <= 0) return 0;          // in the breath tail → rest
            ctx._breathReleaseBeats = phrase.release;   // else release just before it
        }
    }
    const dice = (typeof drive === "number" && Number.isFinite(drive)) ? drive : 0;
    return pickMelodicNote(ctx, prof, dice, low, span, phrase);
}

/**
 * New nxtNote: a VStyle → one COORDINATED note object. Pitch, velocity, and
 * duration are computed together — pitch from the style's `pitch` driver,
 * velocity from the beat strength blended with the `velocity` driver, duration
 * from the groove spacing shaped by `articulation`/phrase — so the line reads as
 * intentional. `sound` rides through (unset = the object's own voice). A drawn
 * gap rests (note 0). See src/vStyle.js.
 * @param {any} style  a VStyle (or style-shaped object)
 * @returns {{ sound: any, note: number, velocity: number, duration: number|undefined, pan: number|undefined }}
 */
function nxtNoteFromStyle(style) {
    const ctx = current;
    const phrase = currentHarmony ? currentHarmony.phrase : null;
    delete ctx._breathReleaseBeats; // the explicit duration replaces the old cap
    if (phrase && phrase.inGap) {
        return new Note({ sound: style.sound, note: 0, velocity: 0, duration: 0 });
    }
    let dice = resolveDrive(style.pitch, ctx);
    dice = (typeof dice === "number" && Number.isFinite(dice))
        ? Math.min(0.999999, Math.max(0, dice)) : 0;
    const note = pickMelodicNote(ctx, style, dice, undefined, undefined, phrase);

    const strength = (typeof ctx.vel === "number" && Number.isFinite(ctx.vel)) ? ctx.vel : 0.8;
    const velocity = shapeVelocity({
        beatStrength: strength,
        image: resolveDrive(style.velocity, ctx),
        weight: style.velocityWeight,
        accentResponse: style.accentResponse,
        phrase,
        phraseDynamics: style.phraseDynamics,
    });
    const durBeats = shapeDuration({
        beatsToNext: typeof ctx.beatsToNext === "number" ? ctx.beatsToNext : null,
        image: resolveDrive(style.duration, ctx),
        weight: style.durationWeight,
        articulation: style.articulation,
        beatStrength: strength,
        phrase,
        phraseDynamics: style.phraseDynamics,
    });
    const bpm = (typeof ctx.bpm === "number" && ctx.bpm > 0) ? ctx.bpm : 120;
    return new Note({
        sound: style.sound,
        note,
        velocity,
        duration: durBeats * 60 / bpm,        // beats → seconds (playNote's unit)
        pan: resolveDrive(style.pan, ctx),
    });
}

/**
 * Pick the next MIDI note of the line for the firing object and update its
 * per-object line memory (keyed by object id, so a rewind's clearMelodyState
 * resets it deterministically). Shared by both nxtNote paths.
 * @param {any} ctx     the firing context
 * @param {any} prof    a style / VStyle (scale, range, smoothness, …)
 * @param {number} dice the 0..1 pitch draw
 * @param {number|undefined} low
 * @param {number|undefined} span
 * @param {any} phrase  ambient phrase state (for anchoring), or null
 * @returns {number}
 */
function pickMelodicNote(ctx, prof, dice, low, span, phrase) {
    const key = (currentHarmony && currentHarmony.key)
        ? currentHarmony.key : { tonicPitchClass: 0, mode: "major" };
    const scalePcs = scalePitchClasses(key, prof.scale);
    const chordPcs = chordStructurePcs(ctx.chord);
    const rootPc = (ctx.chord && typeof ctx.chord.root === "number")
        ? (((ctx.chord.root % 12) + 12) % 12) : null;
    const nextPcs = chordStructurePcs(ctx.nextChord);
    const raw = expandProfile(prof, low, span);

    // Phrase anchoring: a phrase START leans on a primary tone (tonic /
    // dominant / the chord's own root); a phrase END leans on a cadential
    // resting tone (tonic / chord root). Mid-phrase notes anchor to nothing.
    const anchorPcs = phraseAnchorPcs(phrase, key, rootPc);

    const id = typeof ctx.id === "string" ? ctx.id : "";
    const prev = melodyState.has(id) ? melodyState.get(id) : null;
    const beatsToNext = typeof ctx.beatsToNext === "number" ? ctx.beatsToNext : null;
    const beatIndex = typeof ctx.beatIndex === "number" ? ctx.beatIndex : 0;

    const note = melodicStep(
        prev === undefined ? null : prev,
        scalePcs, chordPcs, rootPc, nextPcs,
        beatsToNext, beatIndex, dice, raw,
        anchorPcs, anchorPcs.length > 0 ? PHRASE_ANCHOR_STRENGTH : 1,
    );
    melodyState.set(id, note);
    return note;
}

/** Weight multiplier applied to anchor tones at a phrase boundary. */
const PHRASE_ANCHOR_STRENGTH = 4;

/**
 * Pitch classes to favour at a phrase boundary. A phrase START anchors to the
 * tonic, the dominant, and the current chord's root (a strong, grounded entry);
 * a phrase END anchors to the tonic and the chord root (a resting cadential
 * note). Returns [] for a mid-phrase note (or no phrase grid), which disables
 * anchoring in {@link melodicStep}.
 * @param {{ atStart: boolean, atEnd: boolean } | null | undefined} phrase
 * @param {{ tonicPitchClass: number }} key
 * @param {number | null} rootPc
 * @returns {number[]}
 */
function phraseAnchorPcs(phrase, key, rootPc) {
    if (!phrase) return [];
    const tonic = (typeof key.tonicPitchClass === "number")
        ? (((key.tonicPitchClass % 12) + 12) % 12) : 0;
    const dominant = (tonic + 7) % 12;
    /** @type {number[]} */
    const pcs = [];
    if (phrase.atStart) {
        pcs.push(tonic, dominant);
        if (rootPc !== null) pcs.push(rootPc);
    } else if (phrase.atEnd) {
        pcs.push(tonic);
        if (rootPc !== null) pcs.push(rootPc);
    }
    return pcs;
}

/**
 * Bind the firing context that bare emitter calls route to. Called by
 * the engine immediately before invoking a callback (with the same
 * object that is bound as the callback's `this`).
 * @param {any} ctx
 */
export function setCallbackContext(ctx) {
    current = ctx;
}

/** Clear the firing context after a callback returns (or throws). */
export function clearCallbackContext() {
    current = null;
}

/** @returns {any} The current firing context, or null. */
export function getCallbackContext() {
    return current;
}

/**
 * Bare playNote — forwards to the firing object's playNote. No-op
 * when called outside a callback (no current context) or by a
 * context kind without the method.
 * @param {...any} args
 */
export function playNote(...args) {
    if (current !== null && typeof current.playNote === "function") {
        return current.playNote(...args);
    }
    return undefined;
}

/**
 * Bare playSound — forwards to the firing object's playSound.
 * @param {...any} args
 */
export function playSound(...args) {
    if (current !== null && typeof current.playSound === "function") {
        return current.playSound(...args);
    }
    return undefined;
}

/**
 * Bare applyForce — forwards to the firing object's applyForce
 * (meaningful for sprites; a no-op where the context has no such
 * method, e.g. a curve's onActiveBeat).
 * @param {...any} args
 */
export function applyForce(...args) {
    if (current !== null && typeof current.applyForce === "function") {
        return current.applyForce(...args);
    }
    return undefined;
}

/**
 * Bare onBeatInterval — forwards to the firing object's onBeatInterval
 * (present only on onTick contexts). Returns false outside an onTick
 * callback or in a context kind without the method, so the gate is a
 * safe no-op anywhere it doesn't apply.
 * @param {...any} args
 * @returns {boolean}
 */
export function onBeatInterval(...args) {
    if (current !== null && typeof current.onBeatInterval === "function") {
        return current.onBeatInterval(...args);
    }
    return false;
}

/**
 * Bare reRange — re-map an already-0..1 value into the range [lo, hi],
 * clamped. The image colour channels (this.col.*) are already percentile-
 * stretched to 0..1 per image, so this is the everyday tool for putting a colour read
 * (or any 0..1 value — this.vel, a computed number) onto a useful output
 * band: `reRange(this.col.r, 0.3, 1)` for velocity, `reRange(this.col.b, 0.2,
 * 1.5)` for a note length. Pure (no firing context needed); defaults lo=0,
 * hi=1. A non-finite value reads as 0.
 * @param {number} value  a value in [0, 1]
 * @param {number} [lo]
 * @param {number} [hi]
 * @returns {number}
 */
export function reRange(value, lo = 0, hi = 1) {
    const v = (typeof value === "number" && Number.isFinite(value)) ? value : 0;
    return mapRange(v, 0, 1, lo, hi);
}
