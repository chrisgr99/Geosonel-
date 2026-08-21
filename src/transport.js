/**
 * Transport module.
 *
 * Owns the playback clock. Internally the clock is wall-clock
 * time — AudioContext.currentTime is the source of truth. Beats
 * are a derived quantity, computed as elapsed seconds times BPM
 * divided by sixty, and are only meaningful when a BPM has been
 * declared.
 *
 * BPM is optional. A sketch that declares a BPM in setup() is a
 * beat-based composition; a sketch that omits it is time-based.
 * The UI adapts: when BPM is null the musical-position display,
 * BPM field, and time signature are hidden and the wall-clock
 * display becomes primary.
 *
 * At this milestone there is no sketch loader yet, so the
 * Transport starts with a default BPM of 120 and a 4/4 time
 * signature so both displays can be exercised during development.
 * The API supports setBpm(null) and setTimeSignature(null) so the
 * future sketch loader can drop into time-based mode cleanly.
 *
 * The Transport emits change events on play state, bpm, and time
 * signature. The UI layer subscribes and redraws itself.
 */

// @ts-check

/**
 * @typedef {"play" | "bpm" | "timeSignature" | "rewind"} TransportEvent
 */

/**
 * @typedef {[number, number]} TimeSignature  [numerator, denominator]
 */

/**
 * Ticks per quarter note. 480 is the MIDI standard and common DAW
 * default. Used only for musical position display; the internal
 * clock is seconds.
 */
export const TICKS_PER_BEAT = 480;

export class Transport {
    /**
     * @param {object} [host]
     * @param {AudioContext} [host.audioContext]  The context to run on. GIVEN, NOT MADE, when GXW is
     *   embedded: a host running more than one thing creates one context and hands the same one to
     *   everything, because two AudioContexts cannot be patched to each other at any price. Omitted,
     *   the transport makes its own on first play, which is what standalone GXW wants.
     * @param {AudioNode} [host.output]  Where the sound goes. Embedded, this is the module's own
     *   output node, so GXW's voices arrive in the rack as ordinary audio to be filtered, delayed or
     *   mixed. Omitted, it is the context's destination — the speakers, as today.
     */
    constructor(host = {}) {
        /**
         * @type {AudioContext | null}
         * Created lazily on first play() call because browsers
         * require a user gesture to initialise an AudioContext.
         * Non-null from the start when a host supplied one.
         */
        this._audioContext = host.audioContext || null;

        /**
         * @type {AudioNode | null}
         * The node GXW's sound leaves through. Null means the context's destination, resolved late
         * rather than here because with no context yet there is no destination to point at.
         */
        this._outputNode = host.output || null;

        /** @type {boolean} */
        this._isPlaying = false;

        /**
         * @type {number}
         * Accumulated elapsed seconds from all previous play
         * sessions, not including the current one if playing.
         */
        this._accumulatedSeconds = 0;

        /**
         * @type {number}
         * AudioContext.currentTime at the moment play started.
         * Valid only while playing.
         */
        this._playStartContextTime = 0;

        /**
         * @type {number}
         * Musical-position offset in beats, added to elapsedBeats to give the
         * FORM beat (the chord-chart / harmony position) without touching the
         * physical clock. A practice loop sets this to its first bar so the
         * transport can physically run [0, loopLen) — monotonic audio time,
         * rewind lands at the loop start — while the chart cursor and
         * harmony-following objects read [loopStart, loopEnd). 0 = no offset
         * (formBeats === elapsedBeats), the default.
         */
        this._loopOffsetBeats = 0;

        /**
         * @type {number | null}
         * Beats per minute. null means the piece is time-based
         * and has no notion of beats.
         */
        this._bpm = 120;

        /**
         * @type {TimeSignature | null}
         * Time signature as [numerator, denominator]. Only
         * meaningful when bpm is non-null.
         */
        this._timeSignature = [4, 4];

        /**
         * @type {Map<TransportEvent, Set<() => void>>}
         * Listeners keyed by event name.
         */
        this._listeners = new Map();
    }

    // --- Event subscription ---

    /**
     * Subscribe to a transport event. Returns an unsubscribe
     * function.
     * @param {TransportEvent} event
     * @param {() => void} callback
     * @returns {() => void}
     */
    on(event, callback) {
        let set = this._listeners.get(event);
        if (set === undefined) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(callback);
        return () => {
            const s = this._listeners.get(event);
            if (s !== undefined) s.delete(callback);
        };
    }

    /**
     * @param {TransportEvent} event
     */
    _emit(event) {
        const set = this._listeners.get(event);
        if (set === undefined) return;
        // Isolate listeners: a throw in one MUST NOT starve the others. The set
        // includes the disc-mirror's flush/runtime push (critical for debugging)
        // and the canvas/transport-bar/audition handlers; before this guard, a
        // throw in an earlier-subscribed listener (e.g. the canvas) silently
        // aborted the loop and froze every later listener, including the mirror.
        // Snapshot first so an unsubscribe during dispatch can't disturb iteration.
        for (const cb of [...set]) {
            try {
                cb();
            } catch (err) {
                console.warn(`GXW: transport "${event}" listener threw:`, err);
            }
        }
    }

    // --- Play state ---

    /**
     * Begin playback from the current position.
     */
    play() {
        if (this._isPlaying) return;
        const ctx = this._ensureAudioContext();
        this._playStartContextTime = ctx.currentTime;
        this._isPlaying = true;
        this._emit("play");
    }

    /**
     * Pause at the current position. Elapsed time is preserved;
     * a subsequent play() resumes from this point.
     */
    pause() {
        if (!this._isPlaying) return;
        this._accumulatedSeconds = this.elapsedSeconds;
        this._isPlaying = false;
        this._emit("play");
    }

    /**
     * Toggle between play and pause.
     */
    toggle() {
        if (this._isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * Reset elapsed time to zero. If playing, continues playing
     * from zero; if paused, stays paused at zero. Matches the
     * behaviour we agreed: rewind resets position without
     * changing play state.
     */
    rewind() {
        this._accumulatedSeconds = 0;
        if (this._isPlaying) {
            const ctx = this._ensureAudioContext();
            this._playStartContextTime = ctx.currentTime;
        }
        // Notify listeners. The Canvas needs this so a rewind
        // while paused triggers a redraw to show the cursor at
        // the reset position; a rewind while playing is
        // already handled by the play-driven render loop, but
        // the event still fires for symmetry. Listeners that
        // care only about position changes during playback can
        // ignore this event safely.
        this._emit("rewind");
    }

    /**
     * Rewind to the start AND stop playback — the behaviour the user-facing
     * Rewind controls use (the top transport bar and the beat editor). Pausing
     * before the rewind leaves the clock frozen at zero. (Plain rewind() keeps
     * the play state and is still used by the internal repositioning paths —
     * chart change, unwind, seed, audition — which must not stop the score.)
     */
    rewindAndStop() {
        this.pause();
        this.rewind();
    }

    /**
     * @returns {boolean}
     */
    get isPlaying() {
        return this._isPlaying;
    }

    // --- Elapsed time (derived) ---

    /**
     * Wall-clock seconds since the last rewind, respecting
     * pauses.
     * @returns {number}
     */
    get elapsedSeconds() {
        if (!this._isPlaying) return this._accumulatedSeconds;
        if (this._audioContext === null) return this._accumulatedSeconds;
        const delta = this._audioContext.currentTime - this._playStartContextTime;
        return this._accumulatedSeconds + delta;
    }

    /**
     * Map an elapsed-seconds value (the simulation clock) to an
     * absolute AudioContext time, the inverse of elapsedSeconds.
     * The look-ahead scheduler (§3.6) steps the sim AHEAD of the
     * playhead and uses this to stamp each fired note with the exact
     * audio time its step corresponds to, so events schedule at their
     * true future time rather than "now + a fixed offset".
     *
     * Returns null when there is no AudioContext yet. While paused
     * the play-relative timer is frozen, so a future elapsed value
     * still maps against the last play anchor; callers clamp to
     * currentTime at dispatch so a stale/past result never schedules
     * in the past.
     * @param {number} elapsed  Elapsed seconds since the last rewind.
     * @returns {number | null}
     */
    audioTimeForElapsed(elapsed) {
        if (this._audioContext === null) return null;
        // audioTime = playStart + (elapsed - accumulatedBeforeThisPlay).
        return this._playStartContextTime + (elapsed - this._accumulatedSeconds);
    }

    /**
     * Elapsed beats since the last rewind. Returns null when the
     * piece is time-based (no BPM declared).
     * @returns {number | null}
     */
    get elapsedBeats() {
        if (this._bpm === null) return null;
        return (this.elapsedSeconds * this._bpm) / 60;
    }

    /**
     * The FORM beat — the musical position the chord chart and harmony-following
     * objects read: elapsedBeats plus the loop offset. Equals elapsedBeats when
     * no practice loop is set. Null when the piece is time-based.
     * @returns {number | null}
     */
    get formBeats() {
        const eb = this.elapsedBeats;
        return eb === null ? null : eb + this._loopOffsetBeats;
    }

    /**
     * Set the musical-position offset (beats) added to give formBeats. Used by
     * the practice loop; 0 clears it. Does not touch the physical clock.
     * @param {number} beats
     */
    setLoopOffsetBeats(beats) {
        this._loopOffsetBeats = (typeof beats === "number" && Number.isFinite(beats)) ? beats : 0;
    }

    /** The current form-beat offset (added to elapsedBeats to give formBeats). */
    get loopOffsetBeats() {
        return this._loopOffsetBeats;
    }

    /**
     * Move the PHYSICAL clock to a musical position: elapsedSeconds becomes the
     * seconds equivalent of `beats` at the current BPM, so elapsedBeats (and
     * formBeats, with no loop offset) read `beats`. Unlike setLoopOffsetBeats —
     * which shifts the FORM beat while the physical clock still runs from 0 and
     * wraps back to the loop start — this moves the playhead itself, so a piece
     * started here plays forward from `beats` and a whole-form wrap returns to
     * the top. Used by "start playback at this measure": seek while stopped, then
     * play. No-op offset when the piece is time-based (no BPM). Emits "rewind" so
     * the canvas repositions and the firing engine flushes any pending audio.
     * @param {number} beats  musical position in beats from the top (>= 0)
     */
    seekToBeats(beats) {
        const b = (typeof beats === "number" && Number.isFinite(beats) && beats > 0) ? beats : 0;
        this._accumulatedSeconds = this._bpm ? (b * 60) / this._bpm : 0;
        if (this._isPlaying && this._audioContext !== null) {
            this._playStartContextTime = this._audioContext.currentTime;
        }
        this._emit("rewind");
    }

    // --- BPM ---

    /**
     * @returns {number | null}
     */
    get bpm() {
        return this._bpm;
    }

    /**
     * Set the BPM. Pass null to declare the piece time-based.
     * Clamps to [1, 1000] when non-null. Changing BPM preserves
     * the current elapsed time — beats elapsed before the change
     * count at the old rate, beats after at the new rate. This
     * is achieved by freezing the accumulated seconds at the
     * moment of change and restarting the play-relative timer.
     * @param {number | null} bpm
     * @param {"user" | "sketch"} _source  Currently unused; will
     *     matter when the sketch loader arrives so runtime user
     *     edits don't propagate back to the sketch file.
     */
    setBpm(bpm, _source = "user") {
        let clamped = bpm;
        if (clamped !== null) {
            clamped = Math.max(1, Math.min(1000, Math.round(clamped)));
        }
        if (clamped === this._bpm) return;
        // Freeze elapsed time at the moment of BPM change so
        // beats past stay at the old rate.
        if (this._isPlaying && this._audioContext !== null) {
            this._accumulatedSeconds = this.elapsedSeconds;
            this._playStartContextTime = this._audioContext.currentTime;
        }
        this._bpm = clamped;
        this._emit("bpm");
    }

    // --- Time signature ---

    /**
     * @returns {TimeSignature | null}
     */
    get timeSignature() {
        return this._timeSignature;
    }

    /**
     * Set the time signature. Pass null to clear. Only meaningful
     * when BPM is also set.
     * @param {TimeSignature | null} ts
     */
    setTimeSignature(ts) {
        this._timeSignature = ts;
        this._emit("timeSignature");
    }

    /**
     * True when the piece is beat-based (has both a BPM and a
     * time signature). The UI uses this to show or hide the
     * musical-position display, BPM field, and time-signature
     * readout.
     * @returns {boolean}
     */
    get isBeatBased() {
        return this._bpm !== null && this._timeSignature !== null;
    }

    /**
     * Compute the musical position as {bars, beats, ticks}
     * relative to the current time signature. Returns null when
     * the piece is time-based. Bars and beats are 1-based; ticks
     * are 0-based out of TICKS_PER_BEAT.
     * @returns {{bars: number, beats: number, ticks: number} | null}
     */
    get musicalPosition() {
        if (!this.isBeatBased) return null;
        const totalBeats = this.elapsedBeats;
        if (totalBeats === null) return null;
        // Time signature numerator gives beats per bar. We treat
        // the denominator as informational (4 means quarter-note
        // gets the beat, 8 means eighth, etc.) and drive the
        // display from beats directly. A future refinement can
        // scale the beat unit by the denominator.
        const ts = this._timeSignature;
        if (ts === null) return null;
        const beatsPerBar = ts[0];
        const integerBeat = Math.floor(totalBeats);
        const beatFraction = totalBeats - integerBeat;
        const bars = Math.floor(integerBeat / beatsPerBar) + 1;
        const beats = (integerBeat % beatsPerBar) + 1;
        const ticks = Math.floor(beatFraction * TICKS_PER_BEAT);
        return { bars, beats, ticks };
    }

    // --- AudioContext management ---

    /**
     * Lazily create the AudioContext. Called on first play() so
     * the browser's user-gesture requirement is satisfied.
     * @returns {AudioContext}
     */
    _ensureAudioContext() {
        if (this._audioContext === null) {
            // Only reached when no host supplied one; see the constructor.
            // @ts-ignore — webkitAudioContext fallback for older Safari
            const Ctor = window.AudioContext || window.webkitAudioContext;
            this._audioContext = new Ctor();
        }
        // Resume in case the browser auto-suspended it.
        if (this._audioContext.state === "suspended") {
            this._audioContext.resume();
        }
        return this._audioContext;
    }

    /**
     * Public accessor for the AudioContext. Returns null until
     * something has caused _ensureAudioContext to run (typically
     * the first play() click, or an explicit ensureAudioContext
     * call from the StrudelRuntime). The runtime uses this to
     * pass GXW's single AudioContext to strudel's webaudio layer
     * rather than letting strudel create its own; sharing one
     * context avoids two-audio-thread overhead and the risk of
     * one context suspending while the other does not.
     * @returns {AudioContext | null}
     */
    get audioContext() {
        return this._audioContext;
    }

    /**
     * Where GXW's sound should be connected. The host's node when embedded, the speakers otherwise.
     * Resolved on each call rather than cached, since the context may not have existed when the
     * transport was built. Returns null before there is any context at all.
     * @returns {AudioNode | null}
     */
    get outputNode() {
        if (this._outputNode) return this._outputNode;
        return this._audioContext ? this._audioContext.destination : null;
    }

    /**
     * Eagerly create and return the AudioContext, satisfying the
     * browser's user-gesture requirement at the call site. Used
     * by the StrudelRuntime when the user clicks Load Engine —
     * that click is the gesture, and we want the context live
     * before strudel initialises.
     * @returns {AudioContext}
     */
    ensureAudioContext() {
        return this._ensureAudioContext();
    }
}
