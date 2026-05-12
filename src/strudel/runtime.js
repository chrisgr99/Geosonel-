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
        try {
            if (typeof duration === "number" && Number.isFinite(duration)) {
                this._superdough(value, audioTime, duration);
            } else {
                this._superdough(value, audioTime);
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
