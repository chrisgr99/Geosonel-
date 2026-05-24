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
 * Timing model. noteOn dispatch uses Web MIDI's scheduled
 * timestamp: output.send(data, audioToMidiTime(audioTime))
 * lets the OS schedule the noteOn at the exact moment in
 * audio time, with sub-millisecond precision on macOS
 * CoreMIDI. noteOff dispatch goes through our own scheduler
 * instead. send() queues each event's noteOff into an
 * internal pending list keyed by audio time; tick() (called
 * from the firing engine on every render frame) walks the
 * list and dispatches any noteOff whose audio time has
 * arrived. This means noteOff precision is bounded by the
 * tick rate (typically 60Hz / 16.6ms), which is more than
 * fine for musical timing. The reason we hand-roll noteOff
 * scheduling rather than reusing Web MIDI's: empirical
 * testing showed Chrome's Web MIDI noteOff timestamps were
 * unreliable at the cycle-length time horizons we use —
 * scheduled noteOffs sometimes fired earlier than their
 * timestamp, producing staccato when the pattern specified
 * legato. Owning the noteOff queue ourselves also opens up
 * the voice-management features that GeoSonix-style
 * authoring needs (max polyphony with oldest-note-steal,
 * sustain-pedal interaction, channel reassignment) since
 * we can inspect and mutate the active-note set directly.
 *
 * The two clocks (audioContext.currentTime and
 * performance.now()) could drift slightly over long
 * sessions but for the cycle-length time windows we care
 * about (sub-second scheduling horizons) the single-capture
 * offset is accurate enough.
 *
 * Value mapping. Reads fields off the strudel Hap value as
 * confirmed by the MIDI integration spike:
 *
 *   - note (required): MIDI pitch as either a string note name
 *     like "c4" / "C4" (converted via noteNameToMidi) or a
 *     numeric MIDI value 0-127 (rounded to the nearest integer).
 *     Numeric values reach this code when the note source is a
 *     continuous signal (sine, pxLt, mapClip, etc.) or an
 *     explicit number passed to strudel's note(). Events without
 *     either form in the note field are skipped silently after a
 *     one-time console.warn (typical for sample-based patterns
 *     like sound("bd") that don't translate to MIDI).
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
 *
 * Build branching. Two backends share this class. On the
 * Electron build (window.gxwMidi exists, exposed by
 * electron-preload.js), bytes route through the gxw:midi-
 * send IPC channel to the main process, which holds open a
 * named virtual CoreMIDI source called "GeoSonel" via node-
 * midi. The renderer never enumerates ports; the DAW sees
 * GeoSonel as a MIDI input and routes from it. On the web
 * build (no window.gxwMidi), bytes route through Web MIDI
 * as before. The build choice is detected at init() time;
 * _sendBytes dispatches to the right backend per-call so
 * the rest of the class doesn't have to know.
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
        /**
         * Pending noteOffs awaiting their audio time. Each
         * entry carries the audioContext time at which the
         * noteOff should fire, plus the channel and note
         * number needed to construct the MIDI message. The
         * list is unsorted; tick() walks all entries and
         * dispatches any whose time has arrived. Bounded
         * growth: each send() adds one entry, each tick()
         * removes any whose time has come, and panic()
         * flushes the list entirely.
         * @type {Array<{channel: number, noteNumber: number, audioOffTime: number}>}
         */
        this._pendingNoteOffs = [];

        // Build mode. Set by init() — "webmidi" for the
        // browser path (using navigator.requestMIDIAccess),
        // "electron" for the Electron path (using
        // window.gxwMidi bridge to the main process's
        // virtual port). _sendBytes routes per-byte-array
        // dispatch to the right backend so the rest of the
        // class doesn't have to know.
        /** @type {"webmidi" | "electron"} */
        this._mode = "webmidi";
        /** @type {any} */
        this._gxwMidi = null;
    }

    /**
     * Async initialisation. Branches between the Electron
     * virtual-port path (window.gxwMidi exposed by
     * electron-preload.js) and the Web MIDI path. Safe to
     * call once at app load. Errors put the sender in non-
     * functional state without throwing; sends become no-ops
     * and a console.warn explains the cause.
     *
     * @returns {Promise<void>}
     */
    async init() {
        const gxwMidi = (typeof window !== "undefined")
            ? /** @type {any} */ (window).gxwMidi
            : undefined;
        if (gxwMidi !== undefined && gxwMidi !== null) {
            await this._initElectron(gxwMidi);
        } else {
            await this._initWebMidi();
        }
    }

    /**
     * Electron init path. Queries the main process's MIDI
     * status (which reflects whether node-midi loaded and
     * the virtual port opened successfully) and emits the
     * "ready" event to the toolbar indicator when the port
     * is open. The portName in the ready event comes from
     * main and is typically "GeoSonel" so the indicator
     * label reads "MIDI: GeoSonel".
     *
     * @param {any} gxwMidi
     */
    async _initElectron(gxwMidi) {
        let status;
        try {
            status = await gxwMidi.getStatus();
        } catch (err) {
            console.warn("[MIDI] gxwMidi.getStatus failed:", err);
            return;
        }
        if (status === null || status === undefined || status.ready !== true) {
            console.warn(
                "[MIDI] Virtual MIDI port could not be opened in the Electron main " +
                "process. MIDI sending will be unavailable. Check that node-midi " +
                "is installed and electron-rebuild has run.",
            );
            return;
        }
        this._mode = "electron";
        this._gxwMidi = gxwMidi;
        this._chosenPortName = typeof status.portName === "string" ? status.portName : "GeoSonel";
        this._isReady = true;
        this._emit({ type: "ready", portName: this._chosenPortName });
    }

    /**
     * Web MIDI init path. Calls navigator.requestMIDIAccess
     * and chooses a port. Used in the web build and as a
     * fallback path for tests that load this module outside
     * an Electron renderer.
     *
     * @returns {Promise<void>}
     */
    async _initWebMidi() {
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
        this._mode = "webmidi";
        this._isReady = true;
        this._emit({ type: "ready", portName: this._chosenPortName });
    }

    /**
     * Internal byte-level dispatch. Routes to the active
     * backend for the current build: Web MIDI's
     * output.send(bytes, midiTime) on web, or
     * gxwMidi.send(bytes, delayMs) over IPC on Electron.
     * The Electron path computes delayMs as
     * (midiTime - performance.now()) so the main process
     * can schedule the actual MIDI write via setTimeout if
     * the delay is positive, dispatching immediately
     * otherwise. Precision tradeoff: Web MIDI's scheduled-
     * send uses OS-level CoreMIDI timing with sub-
     * millisecond precision; the IPC + setTimeout path on
     * Electron has a few milliseconds of jitter. For
     * typical musical material the difference is below the
     * audible threshold; for very tight rhythms it may be
     * noticeable.
     *
     * @param {number[]} bytes
     * @param {number} [midiTime] Absolute performance.now() time. Omit for immediate dispatch.
     */
    _sendBytes(bytes, midiTime) {
        if (this._mode === "electron") {
            if (this._gxwMidi === null) return;
            const delayMs = typeof midiTime === "number"
                ? Math.max(0, midiTime - performance.now())
                : 0;
            // Fire-and-forget. Awaiting the IPC round trip
            // would block the per-event budget the firing
            // engine relies on; the main side's dispatch
            // is synchronous on receipt.
            void this._gxwMidi.send(bytes, delayMs);
            return;
        }
        if (this._output === null) return;
        if (typeof midiTime === "number") {
            this._output.send(bytes, midiTime);
        } else {
            this._output.send(bytes);
        }
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
     * Late-subscribe handling: if the sender is already
     * ready by the time a callback subscribes (typical on
     * Electron, where gxwMidi.getStatus resolves much
     * faster than Web MIDI's requestMIDIAccess), fire a
     * synthetic ready event to the new subscriber
     * immediately. Without this, a subscriber wired after
     * init completes would never see the ready event and
     * the toolbar indicator would stay at its placeholder
     * label.
     *
     * @param {(event: MIDIEvent) => void} callback
     * @returns {() => void}
     */
    onEvent(callback) {
        this._listeners.add(callback);
        if (this._isReady) {
            try {
                callback({
                    type: "ready",
                    portName: this._chosenPortName ?? undefined,
                });
            } catch (err) {
                console.warn("[MIDI] late-subscribe ready handler threw:", err);
            }
        }
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
     * seconds and is used as the Web MIDI scheduled
     * timestamp for the noteOn; the noteOff is queued into
     * the internal pending list and dispatched by tick()
     * when its audio time arrives.
     *
     * Same-note-same-channel voice management. If a noteOff
     * is already pending for the same channel and note
     * number (meaning the previous noteOn for that pitch
     * has not yet had its noteOff fired), the pending
     * noteOff is dispatched immediately and removed from
     * the queue BEFORE the new noteOn is scheduled. This
     * enforces the invariant that a given (channel, note)
     * pair can have at most one active voice at a time;
     * the new noteOn always re-triggers cleanly rather
     * than overlapping with itself. Cutting the old note
     * off at "now" rather than at the new noteOn's
     * scheduled time is a small audible compromise (the
     * note ends slightly earlier than its legato value
     * would otherwise extend it) made in exchange for
     * predictable polyphony.
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
        if (!this._isReady) return;
        if (value === null || typeof value !== "object") return;

        const noteField = value.note;
        /** @type {number} */
        let noteNumber;
        if (typeof noteField === "number" && Number.isFinite(noteField)) {
            // Numeric note value. Reaches this code when the
            // note source is a continuous signal (sine, pxLt,
            // mapClip, etc.) or an explicit number passed to
            // strudel's note(). Round to the nearest integer;
            // out-of-MIDI-range values are dropped with a per-
            // occurrence warning to surface pitch-arithmetic
            // blunders, since a misbehaving signal can flood
            // the console either way and a one-time gate would
            // mask later mistakes.
            noteNumber = Math.round(noteField);
            if (noteNumber < 0 || noteNumber > 127) {
                console.warn(`[MIDI] Note number ${noteNumber} out of MIDI range 0-127. Skipping.`);
                return;
            }
        } else if (typeof noteField === "string") {
            noteNumber = noteNameToMidi(noteField);
            if (noteNumber < 0) {
                console.warn(`[MIDI] Unrecognised note name: "${noteField}". Skipping.`);
                return;
            }
        } else {
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
        const audioOffTime = audioTime + offDuration;

        // Same-note voice management. If a pending noteOff
        // for this channel+note exists from a previous
        // noteOn, dispatch it immediately so the new noteOn
        // re-triggers cleanly rather than overlapping with
        // itself. We find at most one such entry because
        // every noteOn pushes exactly one noteOff to the
        // queue and we never queue duplicates.
        for (let i = 0; i < this._pendingNoteOffs.length; i++) {
            const off = this._pendingNoteOffs[i];
            if (off.channel === channel && off.noteNumber === noteNumber) {
                const status = 0x80 | (off.channel - 1);
                this._sendBytes([status, off.noteNumber, 0]);
                this._pendingNoteOffs.splice(i, 1);
                break;
            }
        }

        const statusOn = 0x90 | (channel - 1);
        this._sendBytes([statusOn, noteNumber, velocity], noteOnMidiTime);
        this._pendingNoteOffs.push({
            channel,
            noteNumber,
            audioOffTime,
        });

        this._emit({
            type: "send",
            note: typeof noteField === "string" ? noteField : String(noteNumber),
            velocity,
            channel,
        });
    }

    /**
     * Dispatch any pending noteOffs whose audio time has
     * arrived. Called from the firing engine's tick on
     * every render frame. noteOff messages are sent through
     * Web MIDI with no timestamp argument so the OS forwards
     * them immediately; the timing precision is bounded by
     * the tick rate (typically 16.6ms) which is fine for
     * musical purposes.
     *
     * @param {number} audioNow Current audioContext.currentTime in seconds.
     */
    tick(audioNow) {
        if (!this._isReady) return;
        if (this._pendingNoteOffs.length === 0) return;
        /** @type {Array<{channel: number, noteNumber: number, audioOffTime: number}>} */
        const remaining = [];
        for (const off of this._pendingNoteOffs) {
            if (off.audioOffTime <= audioNow) {
                const status = 0x80 | (off.channel - 1);
                this._sendBytes([status, off.noteNumber, 0]);
            } else {
                remaining.push(off);
            }
        }
        this._pendingNoteOffs = remaining;
    }

    /**
     * Silence all currently-pending notes immediately. Used
     * by the firing engine when the transport pauses, when
     * the scene changes, and when a pattern edit drops
     * events past the edit point. Without this, a paused
     * transport would leave notes ringing indefinitely
     * because our tick() loop is what drives noteOff
     * dispatch and the firing engine stops ticking the
     * scheduler on pause.
     */
    panic() {
        if (!this._isReady) {
            this._pendingNoteOffs = [];
            return;
        }
        for (const off of this._pendingNoteOffs) {
            const status = 0x80 | (off.channel - 1);
            this._sendBytes([status, off.noteNumber, 0]);
        }
        this._pendingNoteOffs = [];
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
