// @ts-check

/**
 * Rhythm-style audition (Styles tab, design/rhythm-auto-generation.md M2).
 *
 * A SELF-CONTAINED loop player for hearing a Rhythm style as you edit it — no
 * scene, no canvas object, no main transport. It generates a one-bar phrase from
 * the style's rhythm core (the editor's live sandbox) and loops it through a
 * neutral percussion click, optionally over a steady metronome, so you can dial
 * the knobs and hear the character against a grid.
 *
 * Timing: a look-ahead scheduler on the audio clock (the standard Web Audio
 * pattern) — a coarse setInterval wakes up often and schedules every onset that
 * falls inside the next look-ahead window at a precise `audioTime`, so the beat is
 * tight even though the timer itself is jittery. The audio context + the one-shot
 * fire function are injected (the host owns the engine); this module is pure
 * timing + generation. The phrase is regenerated at each loop boundary from the
 * current core, so an edit is heard at the next bar (≤ one loop), never mid-bar.
 *
 * Independent of the main transport's BPM: the audition carries its own tempo.
 */

import { generatePhrase } from "./rhythmGenerator.js";

/** 16th-note grid: slots per quarter-note beat. */
const SUBDIV = 4;
/** Schedule onsets this far ahead of the audio clock (seconds). */
const LOOKAHEAD_S = 0.12;
/** Scheduler wake-up period (ms). */
const TICK_MS = 25;
/** Drum bank + samples for the click voices. */
const BANK = "RolandTR909";
const ONSET_SAMPLE = "hh";     // the style's onsets — a neutral closed hat
const METRO_SAMPLE = "rim";    // the metronome tick — a distinct rim, downbeat louder

export class RhythmAudition {
    /**
     * @param {{
     *   ensureAudioContext: () => (AudioContext | null),
     *   fire: (spec: { sample: string, bank: string, amplitude: number, audioTime: number }) => void,
     *   onSlot?: (slotIndex: number, totalSlots: number) => void,
     * }} deps
     *   ensureAudioContext resumes/returns the shared audio context (call from a
     *   user gesture); fire schedules one click; onSlot (optional) reports the
     *   playing slot for a visual playhead (−1 = stopped).
     */
    constructor(deps) {
        this._ensureAudioContext = deps.ensureAudioContext;
        this._fire = deps.fire;
        this._onSlot = (typeof deps.onSlot === "function") ? deps.onSlot : null;

        /** @type {ReturnType<typeof setInterval> | null} */
        this._timer = null;
        this._playing = false;

        this._tempo = 120;        // BPM (quarter notes)
        this._beatsPerBar = 4;    // numerator (quarters per bar)
        this._metronome = false;

        /** @type {() => any} the current rhythm core (the editor sandbox). */
        this._getCore = () => ({});
        this._phrase = { activeBeats: "", strength: "" };
        this._slot = 0;
        this._nextTime = 0;
    }

    isPlaying() { return this._playing; }

    /** @param {() => any} fn  Provider for the live rhythm core. */
    setCoreProvider(fn) { this._getCore = (typeof fn === "function") ? fn : (() => ({})); }

    /** @param {number} bpm */
    setTempo(bpm) {
        const n = Number(bpm);
        if (Number.isFinite(n) && n > 0) this._tempo = n;
    }

    /** @param {number} n  Quarters per bar (3/4 → 3, 4/4 → 4, …). */
    setBeatsPerBar(n) {
        const v = Math.round(Number(n));
        if (Number.isFinite(v) && v >= 1) this._beatsPerBar = v;
    }

    /** @param {boolean} on */
    setMetronome(on) { this._metronome = !!on; }

    _slotsPerBar() { return this._beatsPerBar * SUBDIV; }
    /** Seconds per grid slot (a 16th note). */
    _slotDuration() { return (60 / this._tempo) / SUBDIV; }

    _regenerate() {
        const slots = this._slotsPerBar();
        const core = this._getCore();
        this._phrase = generatePhrase({ beatsPerBar: slots, beatsPerPhrase: slots, core, dice: null });
    }

    /** Start the loop. Returns false if the audio context isn't available. */
    start() {
        if (this._playing) return true;
        const ctx = this._ensureAudioContext();
        if (ctx === null || typeof ctx.currentTime !== "number") return false;
        this._regenerate();
        this._slot = 0;
        this._nextTime = ctx.currentTime + 0.08;
        this._playing = true;
        this._timer = setInterval(() => this._tick(ctx), TICK_MS);
        return true;
    }

    /** Stop the loop and clear the playhead. */
    stop() {
        this._playing = false;
        if (this._timer !== null) { clearInterval(this._timer); this._timer = null; }
        if (this._onSlot !== null) this._onSlot(-1, this._slotsPerBar());
    }

    /** @param {AudioContext} ctx */
    _tick(ctx) {
        if (!this._playing) return;
        const slots = this._slotsPerBar();
        const dur = this._slotDuration();
        const horizon = ctx.currentTime + LOOKAHEAD_S;
        // Schedule every slot whose time has come within the look-ahead window.
        // Guard the loop count so a long stall (tab backgrounded) can't spin.
        let guard = 0;
        while (this._nextTime < horizon && guard < 256) {
            guard += 1;
            const i = this._slot;
            if (i === 0) this._regenerate();   // fresh pattern each loop → live edits land here
            this._scheduleSlot(i, this._nextTime);
            this._reportSlot(ctx, i, slots, this._nextTime);
            this._nextTime += dur;
            this._slot = (i + 1) % slots;
        }
    }

    /** @param {number} i @param {number} time */
    _scheduleSlot(i, time) {
        const ab = this._phrase.activeBeats;
        const st = this._phrase.strength;
        if (ab[i] === "x") {
            const d = Number(st[i]);
            const vel = (Number.isFinite(d) ? d : 5) / 9;
            this._fire({ sample: ONSET_SAMPLE, bank: BANK, amplitude: 0.15 + 0.75 * vel, audioTime: time });
        }
        if (this._metronome && (i % SUBDIV === 0)) {
            const accent = (i === 0);
            this._fire({ sample: METRO_SAMPLE, bank: BANK, amplitude: accent ? 0.6 : 0.35, audioTime: time });
        }
    }

    /** Fire the visual playhead near the slot's audio time (best-effort). */
    _reportSlot(ctx, i, slots, time) {
        if (this._onSlot === null) return;
        const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
        setTimeout(() => { if (this._playing) this._onSlot(i, slots); }, delayMs);
    }
}
