/**
 * MIDI output adapter.
 *
 * Sends GXW pattern firing events out a Web MIDI port to an
 * external software synth. The MIDISender is parallel in
 * role to StrudelRuntime: one adapter consumes the firing
 * engine's per-event (value, audioTime, duration) signature
 * and routes to its respective output. The firing engine
 * talks to whichever adapter it is wired to.
 *
 * Port selection. Walks navigator.requestMIDIAccess()
 * outputs Map and prefers a port whose name contains "IAC"
 * (case-insensitive substring) so the typical macOS setup
 * lands automatically on the IAC bus the user has
 * configured in Audio MIDI Setup. Falls back to the first
 * available output with a console.warn naming the chosen
 * port and the IAC-preference miss. Goes to a non-functional
 * state with a console.warn when no outputs are available at
 * all; subsequent send() calls become no-ops.
 *
 * Timing. The Web MIDI API takes timestamps in
 * performance.now() milliseconds; the firing engine emits
 * audioTime values in audioContext.currentTime seconds. The
 * MIDISender captures the offset once on its first send
 * (lazy because the AudioContext doesn't exist at app load,
 * only after the user clicks Play or Load Engine) and
 * applies the same offset to every subsequent conversion.
 * The two clocks could drift slightly over long sessions but
 * for the cycle-length time windows we care about (sub-
 * second scheduling horizons) the single-capture offset is
 * accurate enough.
 *
 * Value mapping. Reads fields off the strudel Hap value as
 * confirmed by the MIDI integration spike:
 *
 *   - note (required, string): note name like "c4" or "C4",
 *     converted to MIDI number via noteNameToMidi. Events
 *     without a recognised note field are skipped silently
 *     after a one-time console.warn (typical for sample-
 *     based patterns like sound("bd") that don't translate
 *     to MIDI).
 *   - gain (optional, number 0-1): mapped to MIDI velocity
 *     0-127 via Math.round(gain * 127). When absent or
 *     non-numeric, defaults to 64 (mezzo-forte) which is
 *     audibly present without being loud.
 *   - midichan (optional, number 1-16): MIDI channel.
 *     Defaults to 1 when absent. Clamped to the 1-16 range.
 *   - clip (optional, number): duration multiplier applied
 *     to the firing engine's natural slot duration. The
 *     strudel .legato(N) modifier sets this field, so
 *     legato 0.5 produces staccato and legato 2.0 produces
 *     overlap into the next slot. Defaults to 1.0 when
 *     absent.
 *
 * Event subscribers. The MIDISender exposes onEvent for
 * subscribers (typically the transport bar indicator) that
 * want to know when the port becomes ready and when notes
 * fire. Events: { type: "ready", portName } at init
 * completion; { type: "send", note, velocity, channel } on
 * each noteOn dispatched.
 */

// @ts-check

/** @typedef {import("../transport.js").Transport} Transport */

/**
 * @typedef {Object} MIDIEvent
 * @property {"ready" | "send"} type
 * @property {string} [portName]
 * @property {string} [note]
 * @property {number} [velocity]
 * @property {number} [channel]
 */

export class MIDISender {
    /**
     * @param {Transport} transport
     */
    constructor(transport) {
        this._transport = transport;
        /** @type {MIDIAccess | null} */
        this._access = null;
        /** @type {MIDIOutput | null} */
        this._output = null;
        /** @type {string | null} */
        this._chosenPortName = null;
        /** @type {boolean} */
        this._isReady = false;
        /**
         * Time-base offset capture. Captured lazily on the
         * first send because audioContext does not exist
         * at app-load time. Holds the performance.now() value
         * and the matching audioContext.currentTime value at
         * the same instant.
         * @type {{ midiTime: number, audioTime: number } | null}
         */
        this._timeOffset = null;
        /** @type {Set<(event: MIDIEvent) => void>} */
        this._listeners = new Set();
        /** @type {boolean} */
        this._warnedNoNote = false;
    }

    /**
     * Async initialisation. Calls navigator.requestMIDIAccess
     * and chooses a port. Safe to call once at app load.
     * Errors (permission denied, no Web MIDI support) put
     * the sender in non-functional state without throwing;
     * sends become no-ops and a console.warn explains the
     * cause.
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (typeof navigator.requestMIDIAccess !== "function") {
            console.warn("[MIDI] Web MIDI not supported in this browser.");
            return;
        }
        try {
            this._access = await navigator.requestMIDIAccess();
        } catch (err) {
            console.warn("[MIDI] requestMIDIAccess failed:", err);
            return;
        }
        /** @type {MIDIOutput | null} */
        let firstOutput = null;
        /** @type {MIDIOutput | null} */
        let iacOutput = null;
        for (const output of this._access.outputs.values()) {
            if (firstOutput === null) firstOutput = output;
            const name = output.name;
            if (typeof name === "string" && name.toLowerCase().includes("iac")) {
                iacOutput = output;
                break;
            }
        }
        if (iacOutput !== null) {
            this._output = iacOutput;
            this._chosenPortName = iacOutput.name ?? "(unnamed)";
        } else if (firstOutput !== null) {
            this._output = firstOutput;
            this._chosenPortName = firstOutput.name ?? "(unnamed)";
            console.warn(
                `[MIDI] No IAC port found. Falling back to first available output: "${this._chosenPortName}". ` +
                "If you intended to send to an IAC bus, enable it in Audio MIDI Setup, " +
                "add a port, and reload the page.",
            );
        } else {
            console.warn(
                "[MIDI] No MIDI outputs available. Open Audio MIDI Setup, enable the IAC Driver, " +
                "add at least one port, then reload the page.",
            );
            return;
        }
        this._isReady = true;
        this._emit({ type: "ready", portName: this._chosenPortName });
    }

    /**
     * @returns {boolean}
     */
    get isReady() {
        return this._isReady;
    }

    /**
     * @returns {string | null}
     */
    get chosenPortName() {
        return this._chosenPortName;
    }

    /**
     * Subscribe to lifecycle and send events. Returns an
     * unsubscribe function. Used by the transport bar
     * indicator to update its label on ready and to flash
     * on each send.
     *
     * @param {(event: MIDIEvent) => void} callback
     * @returns {() => void}
     */
    onEvent(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * @param {MIDIEvent} event
     */
    _emit(event) {
        for (const listener of this._listeners) {
            listener(event);
        }
    }

    /**
     * Send a pattern event as a MIDI noteOn followed by a
     * matching noteOff. The audioTime is in audioContext
     * seconds and gets converted to Web MIDI's
     * performance.now() millisecond timeline. The duration
     * times the value.clip multiplier (defaulting to 1)
     * gives the noteOff offset from noteOn.
     *
     * Skips silently when not ready or when the value has
     * no recognisable note field. The first skip due to a
     * missing note logs a console.warn so the user knows
     * their sample-based pattern (sound, s modifiers) is
     * not routing to MIDI; subsequent skips are silent so
     * the console doesn't fill up with the same warning.
     *
     * @param {any} value
     * @param {number} audioTime
     * @param {number} duration
     */
    send(value, audioTime, duration) {
        if (!this._isReady || this._output === null) return;
        if (value === null || typeof value !== "object") return;

        const noteStr = value.note;
        if (typeof noteStr !== "string") {
            if (!this._warnedNoNote) {
                this._warnedNoNote = true;
                console.warn(
                    "[MIDI] Pattern event has no note field; skipping. " +
                    "Sample-based patterns (sound, s) do not translate to MIDI; " +
                    "use note() or n().scale() to drive an external synth.",
                );
            }
            return;
        }
        const noteNumber = noteNameToMidi(noteStr);
        if (noteNumber < 0) {
            console.warn(`[MIDI] Unrecognised note name: "${noteStr}". Skipping.`);
            return;
        }

        const gain = typeof value.gain === "number" ? value.gain : null;
        const velocity = gain === null
            ? 64
            : clamp(Math.round(gain * 127), 0, 127);

        const rawChannel = typeof value.midichan === "number" ? value.midichan : 1;
        const channel = clamp(Math.round(rawChannel), 1, 16);

        const clipMult = typeof value.clip === "number" ? value.clip : 1.0;
        const offDuration = Math.max(0, duration * clipMult);

        const noteOnMidiTime = this._audioToMidiTime(audioTime);
        if (noteOnMidiTime === null) return;
        const noteOffMidiTime = noteOnMidiTime + offDuration * 1000;

        const statusOn = 0x90 | (channel - 1);
        const statusOff = 0x80 | (channel - 1);
        this._output.send([statusOn, noteNumber, velocity], noteOnMidiTime);
        this._output.send([statusOff, noteNumber, 0], noteOffMidiTime);

        this._emit({
            type: "send",
            note: noteStr,
            velocity,
            channel,
        });
    }

    /**
     * Convert an audioContext.currentTime value into a
     * performance.now() value via the captured offset.
     * Captures the offset lazily on first call; returns
     * null when audioContext is not yet available.
     *
     * @param {number} audioTime
     * @returns {number | null}
     */
    _audioToMidiTime(audioTime) {
        if (this._timeOffset === null) {
            const ctx = this._transport.audioContext;
            if (ctx === null) return null;
            this._timeOffset = {
                midiTime: performance.now(),
                audioTime: ctx.currentTime,
            };
        }
        return this._timeOffset.midiTime +
            (audioTime - this._timeOffset.audioTime) * 1000;
    }
}

/**
 * Convert a strudel note-name string (like "c4", "C4",
 * "c#4", "Eb3", "Gb-1") to a MIDI note number. Returns -1
 * for unrecognised input. C4 is MIDI 60 (middle C in
 * strudel's convention, which matches most synths but not
 * all — some treat C3 as MIDI 60). Octave numbers can be
 * negative.
 *
 * @param {string} name
 * @returns {number}
 */
function noteNameToMidi(name) {
    const match = /^([a-gA-G])([#sb]?)(-?\d+)$/.exec(name.trim());
    if (match === null) return -1;
    const letter = match[1].toLowerCase();
    const accidental = match[2];
    const octave = parseInt(match[3], 10);
    if (!Number.isFinite(octave)) return -1;
    /** @type {Record<string, number>} */
    const letterToSemitone = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    const base = letterToSemitone[letter];
    if (base === undefined) return -1;
    let shift = 0;
    if (accidental === "#" || accidental === "s") shift = 1;
    else if (accidental === "b") shift = -1;
    return (octave + 1) * 12 + base + shift;
}

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
