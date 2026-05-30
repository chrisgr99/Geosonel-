/**
 * StrudelRuntime — Tier 1 foundation.
 *
 * Wraps strudel's audio engine and exposes a small lifecycle
 * surface that GXW will build on in Tier 2. This file is the
 * Tier 1 deliverable: it does not yet drive any pattern output,
 * does not subscribe to scenes, does not commit events to Web
 * Audio. What it does is initialise the engine, share the
 * AudioContext with GXW's Transport, load sample banks, set
 * defensive globals, seed determinism, and expose itself for
 * console-level inspection.
 *
 * Architectural premises (from design/sections/section-27-
 * strudel-pattern-language.md):
 *
 *   - GXW owns the WHEN (timing) via the simulation. Strudel's
 *     cyclist is never started; we drive Pattern.queryArc and
 *     superdough manually in later tiers. The empirical layer
 *     separation is verified by spike-strudel.html.
 *
 *   - Master tempo is BPM at the transport. Per-source rhythm
 *     is cycleBeats. Effective cps for any source is BPM / 60 /
 *     cycleBeats. window.cps gets a default value derived from
 *     master BPM and a default cycleBeats of 4, set defensively
 *     for any strudel internal that consults it outside a
 *     per-source queryArc.
 *
 *   - Determinism is a guiding principle. The runtime seeds a
 *     random number generator from a fixed default seed so
 *     replays are sample-identical. The seed is hidden from the
 *     default user; expert seed-changing UI lands later.
 *
 * Lifecycle (this file's surface):
 *
 *   - new StrudelRuntime(transport): construct with a reference
 *     to the GXW Transport. Cheap; does no async work.
 *   - init(): asynchronously brings the engine up. Imports
 *     @strudel/web, calls initStrudel, waits for window.note to
 *     register, tells strudel's webaudio layer to use the
 *     Transport's AudioContext, loads dirt-samples and piano
 *     samples in parallel, sets defensive globals (window.cps),
 *     seeds the RNG. Returns when ready.
 *   - status getter: reports "idle" | "loading" | "loaded" |
 *     "failed". Used by the transport bar to update the Load
 *     Engine button's label.
 *   - onStatusChange(callback): subscribe to status transitions.
 *     Returns an unsubscribe function. The transport bar uses
 *     this to update the button's label without polling.
 *
 * Tier 2 will add the pattern evaluation primitive on top of
 * this: a function that takes a parsed Pattern, a cycle range,
 * a wall-clock window, and a firing source, and produces
 * scheduled superdough events using the simulation-tick-driven
 * commit-window approach decided in section 27 item 5.
 */

// @ts-check

/** @typedef {import("../transport.js").Transport} Transport */
/** @typedef {"idle" | "loading" | "loaded" | "failed"} RuntimeStatus */

const LOG_PREFIX = "[GXW StrudelRuntime]";

/**
 * Default cycleBeats used when computing the global window.cps
 * value. Per-source effective cps is computed separately from
 * the source's own cycleBeats during scheduling; this default
 * is just for any strudel internal that consults the global
 * window.cps outside a queryArc call.
 */
const DEFAULT_CYCLE_BEATS = 4;

/**
 * Default seed for the deterministic RNG. Fixed magic number
 * so a freshly-loaded score always plays identically. Score-
 * specific seed override lands later as an expert UI.
 */
const DEFAULT_SEED = 0x47585721; // "GXW!" in ASCII as a 32-bit int

/**
 * Maximum time (ms) to wait for window.note to register after
 * initStrudel returns. initStrudel kicks off pattern-builder
 * registration asynchronously and returns before it completes,
 * so we have to poll. 5 seconds is generous for a slow connection
 * fetching modules from esm.sh; on a warm cache it is typically
 * tens of milliseconds.
 */
const GLOBALS_TIMEOUT_MS = 5000;

/**
 * Poll interval while waiting for window.note. 20 ms keeps the
 * worst-case latency within human perception while not burning
 * cycles.
 */
const GLOBALS_POLL_MS = 20;

/**
 * Sample map for the tidal-drum-machines collection, lazy-
 * loaded on demand the first time a per-object voice selects
 * an unpitched drum-machine bank (RolandTR909, LinnDrum, ...)
 * in the inspector. superdough's .bank() lookup resolves
 * names like RolandTR909_bd against this map, so without it
 * loaded a banked drum event finds no sample and stays
 * silent. Confirmed as the standard bank source by the
 * felixroos/dough-samples README. Only the name-to-URL map
 * loads here; the audio files lazy-load per-name on first
 * play.
 */
const TIDAL_DRUM_MACHINES_URL =
    "https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json";

/**
 * Sample map for the VCSL (Versilian Community Sample
 * Library) collection, lazy-loaded on demand the first
 * time a per-object voice selects a VCSL pitched
 * instrument (steinway, vibraphone, ...) in the
 * inspector. Plays the role for pitched sample
 * instruments that TIDAL_DRUM_MACHINES_URL plays for
 * unpitched drum kits: the chosen sound name only
 * resolves to audio once this name-to-URL map is loaded.
 * The map is a single felixroos/dough-samples JSON of
 * 128 CC0 instruments by Versilian Studios; the audio
 * files themselves lazy-load per-instrument on first
 * play, so a freshly chosen instrument can be silent on
 * its very first hit then sound from then on. This is
 * the option-one path that avoids the soundfonts package
 * the @strudel/web umbrella omits, so it needs no engine
 * architecture change.
 */
const VCSL_URL =
    "https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json";

/**
 * The VCSL instrument names surfaced in the inspector's
 * pitched-sound dropdown. ensureSamplesForVoice loads the
 * VCSL map when the chosen sound is one of these, the
 * pitched-sample analogue of the bank check. Kept in sync
 * with the PITCHED_SOUND_OPTIONS VCSL entries in
 * inspector.js by hand; the set is small and changes
 * rarely. A name not in this set and not gm_-prefixed and
 * not a built-in synth (e.g. piano, which loads at
 * startup) simply triggers no lazy load, which is the
 * correct behaviour for the startup-loaded and built-in
 * sounds.
 */
const VCSL_SOUND_NAMES = new Set([
    "steinway",
    "vibraphone",
    "marimba",
    "kalimba",
    "harp",
    "sax",
]);

export class StrudelRuntime {
    /**
     * @param {Transport} transport
     */
    constructor(transport) {
        /** @type {Transport} */
        this._transport = transport;

        /** @type {RuntimeStatus} */
        this._status = "idle";

        /** @type {Set<(status: RuntimeStatus) => void>} */
        this._statusListeners = new Set();

        /**
         * @type {AudioContext | null}
         * The shared AudioContext. Populated during init from
         * the Transport, before strudel imports run. Stored
         * here as a convenience for downstream tiers.
         */
        this._audioContext = null;

        /**
         * @type {(() => number) | null}
         * Seeded random function. Replaces strudel's default
         * Math.random consumption when the runtime can install
         * itself there; otherwise just used by GXW code that
         * needs determinism. mulberry32 produces a uniform
         * [0, 1) double, sufficient for strudel's needs.
         */
        this._random = null;

        /**
         * @type {(() => void) | null}
         * Unsubscribe handle for the BPM listener. Cleared on
         * dispose (currently unused, but present for tidiness).
         */
        this._bpmUnsubscribe = null;

        /**
         * @type {((value: any, deadline: number, duration?: number) => void) | null}
         * The strudel superdough audio output function,
         * captured from the @strudel/web umbrella import
         * after initStrudel completes. Used by the Tier 2
         * pattern firing engine via the play() method to
         * schedule sample and synthesised events on the
         * shared AudioContext. Stays null until init()
         * has finished successfully; callers should check
         * the runtime status before invoking play().
         */
        this._superdough = null;

        /**
         * @type {any}
         * The @strudel/web umbrella module, captured during
         * init. Held so the lazy soundfont path can probe the
         * umbrella for a registration function (e.g.
         * registerSoundfonts) that shares the umbrella's own
         * bundled @strudel/core instance. Importing the
         * separate @strudel/soundfonts package instead would
         * risk the duplicate-copies-of-core problem documented
         * in _doInit, registering gm_ sounds into a core
         * registry the running engine never consults.
         */
        this._web = null;

        /**
         * @type {Set<string>}
         * Sample-map URLs already requested this session.
         * Seeded in _doInit with the startup collections so
         * ensureSamplesForVoice's lazy loads never re-request
         * a map that init already loaded; each lazy collection
         * (currently the tidal-drum-machines bank map) is
         * requested at most once. A failed load removes its
         * URL so a later pick can retry.
         */
        this._loadedSampleUrls = new Set();

        /**
         * @type {boolean}
         * Guards the one-time soundfont registration probe so
         * a gm_ voice selected on many objects (or re-scanned
         * on every setScene) triggers the registration attempt
         * just once. Reset to false only when an attempt
         * actively fails (threw or rejected) so a later pick
         * can retry; left true after a successful registration
         * or after a probe that found no registration function
         * on the umbrella (which logs the available exports
         * once for diagnosis).
         */
        this._soundfontsRequested = false;

        /**
         * @type {Promise<void> | null}
         * In-flight init promise. Used to dedupe concurrent
         * init() calls.
         */
        this._initPromise = null;
    }

    // --- Status surface ---

    /**
     * @returns {RuntimeStatus}
     */
    get status() {
        return this._status;
    }

    /**
     * @returns {AudioContext | null}
     */
    get audioContext() {
        return this._audioContext;
    }

    /**
     * Subscribe to status transitions. Callback fires immediately
     * with the current status, then again on every change.
     * Returns an unsubscribe function.
     * @param {(status: RuntimeStatus) => void} callback
     * @returns {() => void}
     */
    onStatusChange(callback) {
        this._statusListeners.add(callback);
        callback(this._status);
        return () => { this._statusListeners.delete(callback); };
    }

    /**
     * Schedule a strudel hap value through superdough at
     * the given audio-context absolute time. The current
     * @strudel/web superdough treats its second argument
     * as an absolute audio-context time in seconds, not as
     * an offset from currentTime, so we pass audioTime
     * through directly. Older strudel versions used the
     * offset convention; if a future version flips back,
     * compute `audioTime - this._audioContext.currentTime`
     * here.
     *
     * Past-time clamp. Superdough silently drops events
     * whose audioTime is in the past relative to the audio
     * context's currentTime — unlike Web MIDI, which fires
     * past-timed events immediately with send-now
     * semantics. The firing engine's late-refresh dispatch
     * is allowed to dispatch events up to 200ms in the
     * past (its past-slack window) because most events
     * lagging that little are still musically meaningful;
     * MIDI handles them fine. For superdough, dispatching
     * a past-time event without clamping reads as silence:
     * the event reaches superdough, superdough sees a past
     * timestamp, and the note never sounds. Clamping
     * audioTime to max(audioTime, currentTime) lets
     * slightly-late events fire at "now" instead of
     * getting dropped, matching the way MIDI handles the
     * same case. The audible cost is that an event
     * originally scheduled for, say, 8 ms ago fires now
     * instead of 8 ms ago — a small late-arrival jitter
     * that's preferable to silence. Events further in the
     * past than the firing engine's stale-event guard (200
     * ms) are dropped before they ever reach this wrapper.
     *
     * No-op when the engine is not yet loaded, when
     * superdough was not captured during init (some older
     * strudel versions don't expose it on the umbrella),
     * or when the audio context is missing. Errors thrown
     * by superdough are caught and logged so a malformed
     * hap value doesn't tear down the firing loop.
     *
     * @param {any} value      Strudel hap value (e.g. {s: "bd"} or {note: 60}).
     * @param {number} audioTime  Absolute audio-context time in seconds.
     * @param {number} [duration]  Optional event duration in seconds.
     */
    play(value, audioTime, duration) {
        if (this._status !== "loaded") return;
        if (this._superdough === null) return;
        if (this._audioContext === null) return;
        const clampedTime = Math.max(audioTime, this._audioContext.currentTime);
        try {
            if (typeof duration === "number" && Number.isFinite(duration)) {
                this._superdough(value, clampedTime, duration);
            } else {
                this._superdough(value, clampedTime);
            }
        } catch (err) {
            console.warn(`${LOG_PREFIX} superdough failed:`, err);
        }
    }

    /**
     * @param {RuntimeStatus} status
     */
    _setStatus(status) {
        if (this._status === status) return;
        this._status = status;
        for (const cb of this._statusListeners) cb(status);
    }

    // --- Init ---

    /**
     * Bring the engine up. Idempotent: calling init twice is
     * harmless; the second call just resolves with the existing
     * loaded state. Concurrent calls share one in-flight init.
     * @returns {Promise<void>}
     */
    async init() {
        if (this._status === "loaded") return;
        if (this._status === "loading" && this._initPromise) {
            return this._initPromise;
        }
        this._setStatus("loading");
        this._initPromise = this._doInit().catch((err) => {
            console.error(`${LOG_PREFIX} init failed:`, err);
            this._setStatus("failed");
            throw err;
        });
        return this._initPromise;
    }

    async _doInit() {
        console.log(`${LOG_PREFIX} initialising strudel`);

        // Step 1: Make sure the AudioContext exists. The Load
        // Engine click is the user gesture, so the call here
        // creates the context if play() has not been clicked
        // yet. From here on out, both Transport and strudel
        // share this one context.
        const ctx = this._transport.ensureAudioContext();
        this._audioContext = ctx;

        // Step 2: Import the strudel umbrella package and call
        // initStrudel. The umbrella covers core, mini, webaudio,
        // and superdough; we use it rather than importing each
        // subpackage separately because the four-package shape
        // produces a duplicate-copies-of-core problem inside
        // strudel's scheduler. Section 27 and GXSTR's Phase 3
        // both record this finding.
        const web = await import("@strudel/web");
        this._web = web;

        // initStrudel sets up strudel's globals (note, s, hush,
        // stack, samples, ...) on window. It returns before
        // registration finishes, so we have to wait for window.note
        // to actually be live before continuing. initStrudel
        // accepts options including a pre-existing AudioContext
        // (so strudel does not create its own); we pass GXW's.
        if (typeof web.initStrudel === "function") {
            try {
                await web.initStrudel({ audioContext: ctx });
            } catch (err) {
                // Some strudel versions do not accept the options
                // object; fall back to the no-arg form. If even
                // that fails, the error propagates up.
                console.warn(`${LOG_PREFIX} initStrudel(opts) failed; retrying with no args:`, err);
                await web.initStrudel();
            }
        } else {
            throw new Error("initStrudel not found on @strudel/web");
        }

        await this._waitForGlobals();
        console.log(`${LOG_PREFIX} pattern globals ready`);

        // Step 3: Tell strudel's webaudio layer about our
        // AudioContext. Some strudel versions accept this through
        // initStrudel's options (handled above); others expose
        // setAudioContext through the umbrella's exports. We do
        // NOT import @strudel/webaudio separately here, because
        // the umbrella has already loaded core internally and a
        // separate webaudio import would pull a second copy of
        // core, producing the duplicate-copies-of-core warning
        // GXSTR's section 27 documented. If neither path exposes
        // setAudioContext, strudel will use whatever context
        // initStrudel set up and we accept that.
        if (typeof (/** @type {any} */ (web).setAudioContext) === "function") {
            try {
                /** @type {any} */ (web).setAudioContext(ctx);
            } catch (err) {
                console.warn(`${LOG_PREFIX} setAudioContext failed:`, err);
            }
        }

        // Step 4: Load sample banks in parallel. Each load is
        // independent — a failure of one does not block the
        // other. dirt-samples covers the standard drum and
        // percussion vocabulary (bd, sn, hh, cp, ...). dough-
        // samples piano.json provides s("piano") for pitched
        // tests.
        const samplesFn = /** @type {((url: string) => Promise<void>) | undefined} */ (
            /** @type {any} */ (window).samples
        );
        if (typeof samplesFn === "function") {
            // dirt-samples uses the github: prefix because the repo
            // root has a strudel.json manifest; the prefix resolves
            // to a raw.githubusercontent URL plus /strudel.json. The
            // dough-samples repo has individual instrument JSON
            // files (piano.json, bass.json, ...) at the repo root
            // rather than a single manifest, so we pass a direct
            // https URL for piano. Mixing forms is fine; samples()
            // dispatches on prefix.
            const loads = [
                samplesFn("github:tidalcycles/dirt-samples").then(
                    () => console.log(`${LOG_PREFIX} dirt-samples loaded`),
                    (err) => console.warn(`${LOG_PREFIX} dirt-samples failed:`, err),
                ),
                samplesFn("https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json").then(
                    () => console.log(`${LOG_PREFIX} piano samples loaded`),
                    (err) => console.warn(`${LOG_PREFIX} piano samples failed:`, err),
                ),
            ];
            await Promise.all(loads);
            // Record the startup collections so the lazy
            // ensureSamplesForVoice path treats them as
            // already-loaded and never re-requests them.
            this._loadedSampleUrls.add("github:tidalcycles/dirt-samples");
            this._loadedSampleUrls.add(
                "https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json",
            );
        } else {
            console.warn(`${LOG_PREFIX} samples() not found on window; sample banks not loaded`);
        }

        // Step 5: Defensive globals. window.cps is set from the
        // current BPM and a default cycleBeats of 4. Subscribe to
        // BPM changes so the global tracks the transport. Note
        // that per-source scheduling does NOT use this global; it
        // computes its own effective cps from the source's own
        // cycleBeats at queryArc time. This default exists only
        // for any strudel internal that consults the global
        // outside our per-source path.
        this._applyCps();
        this._bpmUnsubscribe = this._transport.on("bpm", () => this._applyCps());

        // Step 6: Seed the RNG. mulberry32 is a small, fast PRNG
        // that produces deterministic output from a 32-bit seed.
        // Whether strudel actually consumes from this depends on
        // its internal implementation; for now we install it on
        // a known global (window.gxwRandom) and let Tier 2's
        // pattern evaluation primitive route random consumption
        // through it as the integration shape becomes clear.
        this._random = makeMulberry32(DEFAULT_SEED);
        /** @type {any} */ (window).gxwRandom = this._random;

        // Capture superdough from the umbrella export so the
        // Tier 2 firing engine can drive audio output without
        // a second @strudel/web import (which would risk
        // pulling duplicate copies of core). The umbrella
        // re-exports superdough from @strudel/webaudio, so
        // this is exactly the same function the spike
        // verified against. Captured here once after
        // initStrudel completes; null is acceptable when the
        // export is missing (older strudel versions), and
        // callers handle the null case as "no audio output
        // available".
        if (typeof (/** @type {any} */ (web).superdough) === "function") {
            this._superdough = /** @type {any} */ (web).superdough;
        } else {
            console.warn(`${LOG_PREFIX} superdough not found on @strudel/web; audio output will not work`);
        }

        console.log(`${LOG_PREFIX} engine ready`);
        this._setStatus("loaded");
    }

    /**
     * Wait for the strudel globals (window.note in particular)
     * to register. initStrudel returns before its asynchronous
     * registration completes, so this poll bridges the gap.
     */
    async _waitForGlobals() {
        const start = performance.now();
        while (performance.now() - start < GLOBALS_TIMEOUT_MS) {
            if (typeof (/** @type {any} */ (window).note) === "function") return;
            await new Promise((resolve) => setTimeout(resolve, GLOBALS_POLL_MS));
        }
        throw new Error("strudel globals (window.note) did not register within timeout");
    }

    /**
     * Compute window.cps from the transport's current BPM and a
     * default cycleBeats of 4. Called on init and on every
     * "bpm" event from the transport.
     */
    _applyCps() {
        const bpm = this._transport.bpm;
        if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return;
        const cps = bpm / 60 / DEFAULT_CYCLE_BEATS;
        /** @type {any} */ (window).cps = cps;
    }

    /**
     * Lazy-load the sample/soundfont resources a per-object
     * superdough voice needs, on demand when the voice is
     * chosen or when a score carrying the voice loads. The
     * firing engine calls this for every source's
     * voice.superdough block on setScene and again when the
     * engine finishes loading, so a chosen voice's samples
     * are requested as soon as the pick re-runs the scene
     * and a disk-loaded score's voices are requested once
     * the engine is up.
     *
     * Three routes, matching the two inspector dropdowns:
     *
     *   - bank (unpitched drum kit, e.g. "RolandTR909"):
     *     loads the tidal-drum-machines sample map, which
     *     superdough's .bank() lookup needs to resolve names
     *     like RolandTR909_bd. The map is small (name-to-URL
     *     entries only); the audio files themselves still
     *     lazy-load on first hit, so a freshly chosen kit can
     *     be silent on its very first beat then sound from
     *     then on.
     *
     *   - VCSL pitched instrument (e.g. "vibraphone"):
     *     loads the VCSL sample map, which superdough needs
     *     to resolve the instrument name to audio. Same
     *     mechanism as the bank path; the per-instrument
     *     audio still lazy-loads on first hit. This is the
     *     working pitched-sample route that does not depend
     *     on the soundfonts package the umbrella omits.
     *
     *   - gm_ pitched sound (e.g. "gm_marimba"): attempts to
     *     register the General MIDI soundfonts via the
     *     umbrella. Currently a dead end on this build — the
     *     @strudel/web umbrella ships no soundfont code (see
     *     _ensureSoundfonts) — so gm_ entries stay silent.
     *     The pitched dropdown uses VCSL instruments instead;
     *     this branch is retained so a future engine change
     *     that brings real soundfonts in needs no firing-path
     *     edits.
     *
     *   - built-in synth/noise sounds (sawtooth, sine,
     *     square, triangle, white, pink, brown, crackle) and
     *     the startup-loaded piano: no-op. These need no
     *     extra resource — the synths are superdough
     *     built-ins and piano's map loads at init.
     *
     * Safe to call before the engine is loaded (no-op until
     * status is "loaded" and window.samples exists) and safe
     * to call repeatedly (each underlying load happens at
     * most once per session).
     *
     * @param {any} sound  voice.superdough.sound, or undefined.
     * @param {any} bank   voice.superdough.bank, or undefined.
     */
    ensureSamplesForVoice(sound, bank) {
        if (this._status !== "loaded") return;
        if (typeof bank === "string" && bank.length > 0) {
            this._ensureSamplesUrl(TIDAL_DRUM_MACHINES_URL);
        }
        if (typeof sound === "string") {
            if (VCSL_SOUND_NAMES.has(sound)) {
                this._ensureSamplesUrl(VCSL_URL);
            } else if (sound.startsWith("gm_")) {
                this._ensureSoundfonts();
            }
        }
    }

    /**
     * Request a strudel sample map by URL exactly once per
     * session. Marks the URL as loaded before awaiting so a
     * burst of calls (e.g. setScene scanning several objects
     * that share a bank) dispatches a single samples() call;
     * a failed load un-marks the URL so a later pick can
     * retry. This method does not await — window.samples
     * registers the name-to-URL map and the per-name audio
     * files lazy-load on first play, so the brief first-hit
     * silence is superdough's normal lazy-sample behaviour
     * rather than anything this code blocks on.
     *
     * @param {string} url
     */
    _ensureSamplesUrl(url) {
        if (this._loadedSampleUrls.has(url)) return;
        const samplesFn = /** @type {((url: string) => Promise<void>) | undefined} */ (
            /** @type {any} */ (window).samples
        );
        if (typeof samplesFn !== "function") return;
        this._loadedSampleUrls.add(url);
        Promise.resolve(samplesFn(url)).then(
            () => console.log(`${LOG_PREFIX} lazy-loaded sample map: ${url}`),
            (err) => {
                this._loadedSampleUrls.delete(url);
                console.warn(`${LOG_PREFIX} lazy sample-map load failed: ${url}`, err);
            },
        );
    }

    /**
     * Register the General MIDI soundfonts so gm_-prefixed
     * pitched sounds resolve. The @strudel/web umbrella does
     * not load soundfonts by default — the four built-in
     * oscillators (sawtooth/sine/square/triangle) and the
     * noise sources are synth built-ins that work without any
     * registration, which is why those already sound, but
     * gm_ patches come from the separate soundfonts package
     * and stay silent until something registers them.
     *
     * The registration has to run against the umbrella's OWN
     * bundled @strudel/core instance, so this probes the
     * captured umbrella module for a registration function
     * rather than importing @strudel/soundfonts separately (a
     * separate import would pull its own copy of core and
     * register the gm_ map into a registry the running engine
     * never reads — the same duplicate-copies-of-core trap
     * _doInit avoids for webaudio).
     *
     * Whether the umbrella exposes such a function varies by
     * strudel version. When found, it is called and the
     * result (sync or promise) is handled defensively. When
     * not found, the available umbrella export names are
     * logged once so the correct entry point can be wired in
     * a follow-up; gm_ sounds stay silent until then, but
     * nothing else is affected.
     */
    _ensureSoundfonts() {
        if (this._soundfontsRequested) return;
        this._soundfontsRequested = true;
        const web = this._web;
        if (web === null || typeof web !== "object") {
            this._soundfontsRequested = false;
            return;
        }
        // Log the umbrella's export names once so the available
        // registration entry points are visible for diagnosis.
        // registerSynthSounds is deliberately NOT used here: it
        // registers the basic oscillators (which already work),
        // not the GM soundfonts, so calling it logs a
        // misleading success while gm_ stays silent.
        const exportNames = Object.keys(web);
        console.log(`${LOG_PREFIX} @strudel/web exports: ${exportNames.join(", ")}`);
        const fn = /** @type {any} */ (web).registerSoundfonts;
        if (typeof fn === "function") {
            try {
                Promise.resolve(fn()).then(
                    () => console.log(`${LOG_PREFIX} soundfonts registered via registerSoundfonts()`),
                    (err) => {
                        this._soundfontsRequested = false;
                        console.warn(`${LOG_PREFIX} registerSoundfonts() rejected:`, err);
                    },
                );
            } catch (err) {
                this._soundfontsRequested = false;
                console.warn(`${LOG_PREFIX} registerSoundfonts() threw:`, err);
            }
            return;
        }
        // No registerSoundfonts on the umbrella. The export
        // list above is the diagnostic for choosing the right
        // soundfont path; gm_ stays silent until that lands.
        console.warn(
            `${LOG_PREFIX} no registerSoundfonts on @strudel/web umbrella; ` +
            `gm_ pitched sounds need a soundfont registration path (see exports above).`,
        );
    }
}

/**
 * Mulberry32 PRNG. Returns a function that produces uniform
 * [0, 1) doubles given a 32-bit unsigned integer seed. Small,
 * fast, deterministic, suitable for replaceable use as a
 * Math.random substitute.
 * @param {number} seed
 * @returns {() => number}
 */
function makeMulberry32(seed) {
    let s = seed >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
