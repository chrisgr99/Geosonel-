/**
 * StrudelRuntime — audio engine wrapper.
 *
 * Bridges between GXW's Transport / Scene model and Strudel's
 * scheduler. Owns the lifecycle of Strudel's audio engine and
 * the active pattern the scheduler is playing.
 *
 * Phase 3 commit 1 landed the skeleton: init, start, stop,
 * setPattern. Commit 2 added a Load Engine button, transport-
 * play wiring, and a temporary placeholder pattern. Commit 3
 * replaced the placeholder with setScene, which builds the
 * active stack pattern from the scene's cycle-bound sprites
 * by calling each sprite's cycle function from
 * scene.functionMap and applying cycleDuration via slow or
 * compress and cyclePhase via late before stacking. setCps
 * also landed in commit 3, driven from main.js by a
 * transport.on("cps") subscription. The user-facing CPS field
 * is honoured by scaling each sprite's cycleDuration during
 * pattern construction rather than by calling Strudel's
 * setcps: the @strudel/web version on the import map (1.0.3)
 * does not register setcps as a window global, expose it as a
 * module export, or surface it inside evaluate's eval scope,
 * and a 1.3.0 trial showed the only reachable path (via
 * evaluate) takes the cyclist over as a side effect, breaking
 * pause. Scaling cycleDuration is API-version-agnostic and
 * has no side effects. setPlaceholderPattern was removed;
 * runScene in main.js drives the runtime by calling setScene
 * each time the scene reloads. Commit 4 wrapped the per-
 * sprite construction in _buildSpritePattern in a try/catch
 * shim so an exception thrown by a composer's cycle function
 * or by Strudel's slow/compress/late/set operations falls
 * back to silence for that sprite without poisoning the
 * whole stack — the rest of the score keeps playing — and
 * tagged each surviving sub-pattern with _spriteId via
 * pattern.set for downstream attribution. Commit 5 (this
 * commit) adds pause-with-position-preservation by tracking
 * accumulated musical time during play and applying
 * pattern.early(offset) to the active pattern on every
 * transition into audible playback. The offset accumulates
 * across stop/start cycles and across cps changes during
 * play; the conversion to a strudel-cycle offset uses the
 * factor STRUDEL_DEFAULT_CPS / gxCps to compose correctly
 * with commit 3's bake-cps approach. Multi-sprite phase
 * relationships are preserved automatically by the single-
 * stack .early. Phase 3 is complete after this commit.
 *
 * Lifecycle:
 *
 *   - init() asynchronously imports @strudel/web (an umbrella
 *     ES module covering core, mini, webaudio, and superdough),
 *     calls its initStrudel function, then waits for the
 *     pattern-builder globals (note, s, hush, stack, samples,
 *     ...) to actually register on window. initStrudel kicks
 *     off that registration asynchronously and returns before
 *     it completes, so init's promise has to resolve on
 *     "globals are live" rather than "initStrudel returned" —
 *     callers that rely on the globals (this module's own
 *     scene-driven pattern assembly) would otherwise race
 *     ahead and find window.note still undefined. Once the
 *     globals are live, init loads the default sample
 *     banks: github:tidalcycles/dirt-samples for drum /
 *     percussion sounds, and felixroos/dough-samples
 *     piano.json for s("piano"). Patterns using sample
 *     names like s("bd sd hh") and s("piano") play
 *     without any user setup. Each bank loads
 *     independently — a failure of one (offline, rate-
 *     limited, etc.) logs a warning and continues with
 *     whichever banks succeeded; note() patterns and any
 *     user-supplied samples('...') call still work
 *     regardless. After the globals are live and samples have
 *     loaded (or failed), init's tail rebuilds the active
 *     pattern from any stored Scene so a setScene call that
 *     arrived before the engine was ready becomes audible as
 *     soon as init resolves. The CPS value flows in through
 *     pattern construction itself rather than a separate
 *     apply step, so a stored _cps needs no special handling
 *     at this point. initStrudel is idempotent and sets up
 *     the AudioContext lazily on first user gesture, so
 *     init() can be called eagerly or lazily without
 *     affecting correctness. GXW's user surface is a Load
 *     Engine button (Phase 3 commit 2) that invokes init on
 *     click, where the click also satisfies the browser's
 *     gesture requirement for the AudioContext.
 *
 *   - setPattern(pattern) stores a Strudel pattern as the
 *     scheduler's active pattern. While running, Strudel's own
 *     pattern.play() acts as a glitch-free swap — the scheduler
 *     keeps its clock and switches the pattern under it — so
 *     setPattern called mid-play with a new pattern swaps audio
 *     without restarting the cycle counter. setPattern called
 *     before start just stores the pattern; start picks it up.
 *     setPattern(null) clears the active pattern; with playback
 *     running this silences output but keeps the runtime in
 *     the playing state, so a subsequent non-null setPattern
 *     resumes audio without needing a fresh start.
 *
 *   - setScene(scene) hands the runtime a Scene to play.
 *     Walks scene.paths and scene.sprites, picks cycle-bound
 *     sprites that are cycle-enabled and unmuted, calls each
 *     sprite's cycle function from scene.functionMap, applies
 *     cycleDuration as a hidden speed modifier via
 *     pattern.slow(effectiveDuration) so the pattern's
 *     musical cycle rate equals the cursor's cycle rate,
 *     applies cyclePhase via late (omitted when zero), and
 *     stacks the result into the active pattern.
 *     An empty stack — empty scene, all sprites muted/gated/
 *     unbound — becomes setPattern(null) for silence, so
 *     binding a cycle later mid-session resumes audio without
 *     a fresh start. Safe to call before init: the scene is
 *     stored and the build defers until init's tail completes
 *     the rebuild. After init, subsequent calls rebuild
 *     immediately, swapping glitch-free under the scheduler's
 *     clock.
 *
 *   - setCps(cps) stores a cycles-per-second value that
 *     pattern construction reads back during _buildSpritePattern
 *     to scale each sprite's effective cycleDuration. The
 *     scaling factor is STRUDEL_DEFAULT_CPS / cps, applied as
 *     a multiplier on cycleDuration inside the slow call;
 *     the result is that user-set CPS controls audible
 *     pattern rate without ever asking Strudel's scheduler to
 *     change its internal cps. setCps also rebuilds the
 *     active pattern when there's a scene, so the new rate
 *     becomes audible immediately rather than waiting for the
 *     next scene reload. Driven from main.js by a
 *     transport.on("cps") subscription, so manual CPS field
 *     edits and scene-load CPS application both flow through.
 *     Safe to call before init: the value is stored on
 *     this._cps and the rebuild defers until init's tail.
 *     Non-finite or non-positive inputs are rejected silently
 *     — the Transport already clamps to [0.01, 100] before
 *     emitting, so a bad value here would indicate a
 *     programming error rather than user input.
 *
 *   - start() begins playback of the current pattern. No-op
 *     (with a console warning) if init hasn't completed.
 *
 *   - stop() halts playback. Strudel's hush() is the underlying
 *     primitive. The audio engine stays initialised and the
 *     AudioContext stays alive, so a subsequent start resumes
 *     without re-initialising.
 *
 *   - Pause/resume position preservation. The runtime tracks
 *     musical time accumulated during play (in gx-cycles, a
 *     unit that survives cps changes) and a wall-clock
 *     anchor of the current play period. start() re-anchors
 *     to wall-clock-now without changing the accumulator;
 *     stop() flushes wall-clock-elapsed * current-cps into
 *     the accumulator and clears the anchor; setCps during
 *     play flushes at the OLD cps then re-anchors at now,
 *     so the rate change doesn't smear the accumulator;
 *     rewind() resets the accumulator to zero. The
 *     transport always pauses before rewinding, so rewind
 *     never fires during play — the runtime sees a stop
 *     followed by a rewind, both ending in the
 *     accumulator-cleared paused-at-zero state, and the
 *     next start() plays from cycle zero. Every transition
 *     into audible playback (start picking up an existing
 *     pattern, setPattern swapping in a freshly built one)
 *     wraps the active pattern with pattern.early(offset)
 *     where offset = accumulated * STRUDEL_DEFAULT_CPS /
 *     gxCps. The conversion factor compensates for commit
 *     3's bake-cps slow factor so pattern position is
 *     preserved across stop/start and across cps changes
 *     during play. Multi-sprite phase relationships are
 *     preserved automatically by the single-stack .early
 *     — every sprite's sub-pattern shifts by the same
 *     musical amount because each sprite's slow factor was
 *     computed from the same gxCps.
 *
 * The module assumes the @strudel/web import map specifier is
 * declared in index.html (Phase 1 commit 3 set that up). Phase
 * 4 adds the firing-context pointer that each sub-pattern's
 * wrapper sets and clears around queryArc; that's additive
 * and doesn't disturb the lifecycle methods landed here.
 */

// @ts-check

/**
 * Strudel's documented default cps (cycles per second). The
 * engine ran at 1 cps prior to a 2024 default change; since
 * then a fresh Strudel context with no setcps call schedules
 * patterns at 0.5. Used by _buildSpritePattern to compute the
 * conversion factor between GXW's user-set cps and the rate
 * Strudel's scheduler actually uses, so cycleDuration ends up
 * scaled correctly without ever calling setcps.
 */
const STRUDEL_DEFAULT_CPS = 0.5;

export class StrudelRuntime {
    constructor() {
        /** @type {boolean} */
        this._initialized = false;
        /** @type {Promise<void> | null} */
        this._initPromise = null;
        /**
         * The active Strudel pattern, or null.
         * @type {any}
         */
        this._currentPattern = null;
        /**
         * The Scene currently bound to the runtime, or null
         * if setScene hasn't been called yet. Stored on every
         * setScene call regardless of init state. When init
         * completes, the stored scene is rebuilt into the
         * active pattern via init's tail; subsequent setScene
         * calls rebuild immediately. The reference is held
         * across rebuilds so the runtime can re-derive the
         * stack pattern from the same scene without the
         * caller needing to pass it in again.
         * @type {import("./scene.js").Scene | null}
         */
        this._scene = null;
        /**
         * The cycles-per-second value backing pattern
         * construction's CPS-aware scaling, or null if
         * setCps hasn't been called yet. Read by
         * _buildSpritePattern on every rebuild to compute
         * the slow/compress factor; never pushed into
         * Strudel's scheduler directly. Stored on every
         * setCps call regardless of init state. After init,
         * subsequent calls rebuild the active pattern so
         * the new rate is audible immediately.
         * @type {number | null}
         */
        this._cps = null;
        /**
         * True between start() and stop(). The scheduler is
         * actually producing sound iff this is true AND
         * _currentPattern is non-null.
         * @type {boolean}
         */
        this._playing = false;
        /**
         * Accumulated musical time across all play periods,
         * in gx-cycles. Updated by stop() and setCps()
         * during play to flush wall-clock-elapsed *
         * current-cps into this counter; read by
         * _cycleOffset() to compute the .early offset that
         * makes pause/resume preserve position. Tracked in
         * gx-cycles rather than wall-seconds so the unit
         * survives cps changes — musical time advances at
         * the user-perceived rate. Reset to zero by
         * rewind().
         * @type {number}
         */
        this._accumulatedGxCycles = 0;
        /**
         * Wall-clock time (seconds via performance.now()/
         * 1000) at which the current accumulation period
         * started, or null when not playing. Set by start()
         * and re-anchored by setCps() when called during
         * play; cleared by stop() so subsequent
         * _cycleOffset reads use only the accumulated
         * counter.
         * @type {number | null}
         */
        this._syncWallTime = null;
        /**
         * Cursor-sync callback, fired at each cycle
         * boundary by an invisible marker pattern stacked
         * alongside each sprite's audio sub-pattern. The
         * callback receives the sprite id; the consumer
         * (the simulation) dispatches by sprite kind —
         * path-bound sprites snap their cursor to t=0,
         * free sprites snap their position and velocity
         * back to authored values. Set via
         * setCursorSyncCallback; null when no callback has
         * been registered, in which case marker patterns
         * are not built at all.
         * @type {((spriteId: string) => void) | null}
         */
        this._cursorSyncCallback = null;
        /**
         * Solo state. When _soloActive is true, sprites
         * whose id is NOT in _soloIds are treated as if
         * muted — no audio sub-pattern, no marker. When
         * _soloActive is false, _soloIds is ignored and
         * mute is determined entirely by the per-sprite
         * mute field. Set via setSolo; the toolbar's Solo
         * Selected toggle drives the active flag and
         * main.js converts canvas selection indexes into
         * sprite ids before pushing them in. Solo is a
         * runtime-only testing aid and never persists to
         * scene.json. Per-sprite mute still takes
         * precedence: a muted sprite stays silent even
         * when in the solo set, so the user's deliberate
         * mute choices are honoured during solo testing.
         * @type {boolean}
         */
        this._soloActive = false;
        /**
         * Set of sprite ids currently soloed. Empty when
         * _soloActive is false (cleared on toggle off so a
         * stale set can't inadvertently apply later);
         * tracks the live canvas selection's resolved
         * sprite ids when _soloActive is true. Solo on
         * with an empty set silences every sprite — the
         * "selected nothing" case visibly produces no
         * audio, prompting the user to either pick
         * something or toggle solo off.
         * @type {Set<string>}
         */
        this._soloIds = new Set();
    }

    /**
     * Initialise Strudel's audio engine. Idempotent: concurrent
     * calls share one in-flight promise; subsequent calls after
     * completion return immediately. Returns once @strudel/web
     * is imported and initStrudel has completed.
     *
     * Designed to be called from a user-gesture handler so the
     * AudioContext can start. The Load Engine button's click
     * handler is the conventional caller in GXW.
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return;
        if (this._initPromise !== null) return this._initPromise;
        this._initPromise = (async () => {
            const web = await import("@strudel/web");
            web.initStrudel();
            await this._waitForGlobals();
            // Load the default sample banks: dirt-samples
            // for drum / percussion sounds and the dough-
            // samples piano bank for s("piano"). Patterns
            // using sample names — s("bd sd hh"),
            // s("piano c e g"), and friends — play without
            // any user setup. The cycle-slot Create button
            // scaffolds a stub that uses these samples, so
            // freshly-created cycles are audible by
            // default. Each bank loads independently;
            // failure (offline, rate-limited, etc.) is
            // non-fatal: the engine continues, note()
            // patterns still work, custom samples('...')
            // calls still work, and whichever banks did
            // load are usable.
            await this._loadDefaultSamples();
            this._initialized = true;
            // Rebuild from any scene that was set before the
            // engine was ready (the typical page-load order:
            // runScene fires before the user clicks Load
            // Engine). The current _cps value flows in
            // through _buildSpritePattern's slow/compress
            // computation, so no separate cps-apply step is
            // needed at this point.
            if (this._scene !== null) {
                this._rebuildPattern();
            }
        })();
        return this._initPromise;
    }

    /**
     * @returns {boolean} True iff init has completed.
     */
    isInitialized() {
        return this._initialized;
    }

    /**
     * Register a callback fired at each cycle boundary for
     * any cycle-bound sprite in the active scene. The
     * callback receives the sprite's id; the simulation's
     * cursor-sync handler dispatches by which runtime map
     * the id appears in: path-bound sprites snap their
     * cursor t to 0 (the path's natural starting position),
     * free sprites snap their position and velocity back
     * to authored values — the same operation a transport
     * rewind performs.
     *
     * Driven by a silent marker pattern stacked alongside
     * each sprite's audio in StrudelRuntime; the marker
     * fires once per user-cycle and its hap onTrigger calls
     * back here. Bounds cursor-vs-audio phase drift at one
     * cycle: any drift accumulated during a cycle is
     * corrected at the next boundary rather than
     * accumulating across multiple cycles, which matters
     * for both steady-state play (simulation's accumulator
     * has floating-point error that grows over time) and
     * for pattern rebuilds (Duration / Phase / scene reload
     * paths bypass the simulation's clock).
     *
     * Path-bound sprites get a marker even when they have
     * no audio cycle, because the cursor advances and
     * needs sync regardless. Free sprites only get a
     * marker when they have audio — there's no semantic
     * for "reset wandering free sprite" without an audio
     * cycle defining the period.
     *
     * The callback is also used as a sentinel for whether
     * to build marker patterns at all: a null callback
     * means no consumer is registered, so marker
     * construction is skipped.
     *
     * Driven from main.js with a callback that delegates
     * to simulation.snapToRewindPosition, alongside the
     * four transport subscriptions.
     *
     * @param {((spriteId: string) => void) | null} callback
     */
    setCursorSyncCallback(callback) {
        this._cursorSyncCallback = callback;
        if (this._initialized && this._scene !== null) {
            // Rebuild so existing patterns pick up new
            // marker construction (or its absence). A common
            // case is the callback being registered after
            // the engine has already rebuilt with a scene
            // present — in that case the active pattern
            // has no markers and the cursor would drift
            // until the next setScene or setCps. Rebuilding
            // here closes that gap.
            this._rebuildPattern();
        }
    }

    /**
     * Update solo state. When `active` is true, sprites
     * whose id is in `ids` produce audio (and markers, when
     * applicable); every other sprite is treated as muted
     * and contributes nothing to the active stack. When
     * `active` is false, `ids` is ignored and mute is
     * determined entirely by the per-sprite mute field.
     *
     * Triggers a rebuild of the active pattern when init
     * has completed and a scene is bound, so the audible
     * effect lands immediately on toggle and on every
     * selection change while solo is on. Safe to call
     * before init: the state is stored and the rebuild
     * defers until init's tail.
     *
     * The `ids` argument is iterated into a fresh internal
     * Set, so the caller doesn't have to retain ownership
     * of a particular collection across calls. Passing an
     * empty list with active=true is a valid "solo nothing"
     * state — every sprite is muted; the rebuild produces
     * a silent stack until the user changes selection or
     * toggles solo off.
     *
     * Per-sprite mute still takes precedence over solo: a
     * muted sprite in the solo set stays silent. The user's
     * deliberate mute choices are honoured even during
     * solo testing.
     *
     * @param {boolean} active
     * @param {Iterable<string>} ids
     */
    setSolo(active, ids) {
        this._soloActive = !!active;
        this._soloIds = new Set(this._soloActive ? ids : []);
        if (this._initialized && this._scene !== null) {
            this._rebuildPattern();
        }
    }

    /**
     * Set the scheduler's active pattern. See the file header
     * for swap semantics and the null case.
     *
     * @param {any} pattern A Strudel pattern, or null.
     */
    setPattern(pattern) {
        this._currentPattern = pattern;
        if (!this._playing) return;
        if (pattern === null) {
            this._hush();
            return;
        }
        this._playPattern(pattern);
    }

    /**
     * Hand the runtime a Scene to play. Walks scene.paths
     * and scene.sprites and asks _buildSpritePattern for
     * each sprite's contribution; the contribution is a
     * stack of an audio sub-pattern and a silent cursor-
     * sync marker, either of which can be absent. Surviving
     * sub-patterns are stacked into the active pattern via
     * setPattern.
     *
     * Audio sub-pattern is built only when the sprite's
     * cycle slot is non-empty, canCycle is on, and the
     * sprite isn't muted. The cycle function from
     * scene.functionMap is called; the returned pattern is
     * .slow(effectiveDuration)'d so the musical cycle rate
     * matches the cursor's, .late(cyclePhase)'d when phase
     * is non-zero, and .set({_spriteId})'d for downstream
     * attribution.
     *
     * Marker sub-pattern is built when a cursor-sync
     * callback is registered, the sprite isn't muted, and
     * either the sprite is path-bound (cursor advances
     * regardless of audio, so always wants sync) or audio
     * is being built for it (free sprite reset alignment).
     * The marker is pure(0).slow(effectiveDuration) with
     * optional .late(cyclePhase) and .onTrigger that
     * delegates to the registered cursor-sync callback;
     * pure(0)'s value carries no audio control parameters
     * so the hap fires silently — only the onTrigger
     * runs.
     *
     * Empty case (no sprite contributed audio or marker)
     * becomes setPattern(null) — silence with the runtime
     * still in its current play state, so binding a cycle
     * later mid-session resumes audio without a fresh start.
     *
     * Safe to call before init: the scene is stored on
     * this._scene and the rebuild defers until init's tail
     * runs the build. After init, subsequent calls rebuild
     * immediately. The clock survives rebuilds because
     * Strudel's setPattern swaps the active pattern under
     * the scheduler without restarting the cycle counter.
     *
     * Per-sprite construction is wrapped in a try/catch —
     * an exception thrown by the composer's cycle function
     * or by any of Strudel's slow / late / set / pure /
     * stack operations is logged via console.error with
     * the sprite's label and the cycle slot name; the
     * sprite contributes silence to the stack while the
     * rest of the score continues unaffected.
     *
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        if (this._initialized) {
            this._rebuildPattern();
        }
    }

    /**
     * Store a cycles-per-second value and rebuild the active
     * pattern so the new rate is audible immediately. The
     * stored value flows into _buildSpritePattern's slow and
     * compress factors; Strudel's own scheduler cps stays at
     * its default and is never written to. Called from
     * main.js by a transport.on("cps") subscription, so
     * manual CPS field edits and scene-load CPS application
     * both flow through.
     *
     * Safe to call before init: the value is stored on
     * this._cps and the rebuild defers until init's tail.
     * After init, the rebuild is gated on having a scene
     * — with no scene there's nothing to rebuild and the
     * stored value just waits for the next setScene call.
     *
     * Non-finite or non-positive inputs are rejected
     * silently — the Transport already clamps to [0.01, 100]
     * before emitting, so a bad value here would indicate a
     * programming error rather than user input.
     *
     * Future commits may add real Strudel-side cps control
     * driven from a per-tick loop after onTick bodies have
     * written to a writable globalCPS; that would supplement
     * rather than replace the cycleDuration scaling, which
     * stays as the user-facing tempo control regardless.
     *
     * @param {number} cps
     */
    setCps(cps) {
        if (!Number.isFinite(cps) || cps <= 0) return;
        // Flush accumulated musical time at the OLD cps
        // before updating to the new one. Without the flush
        // the accumulator would be smeared across the rate
        // change and the resume position would drift. After
        // flushing, re-anchor the wall-clock to now so the
        // post-change period accumulates at the new cps.
        if (this._playing && this._syncWallTime !== null && this._cps !== null) {
            const now = performance.now() / 1000;
            this._accumulatedGxCycles += (now - this._syncWallTime) * this._cps;
            this._syncWallTime = now;
        }
        this._cps = cps;
        if (!this._initialized) return;
        if (this._scene === null) return;
        this._rebuildPattern();
    }

    /**
     * Start playback of the current pattern. No-op (with a
     * console warning) if init hasn't completed yet.
     */
    start() {
        if (!this._initialized) {
            console.warn(
                "StrudelRuntime.start() called before init(); ignoring.",
            );
            return;
        }
        if (!this._playing) {
            this._playing = true;
            this._syncWallTime = performance.now() / 1000;
        }
        if (this._currentPattern !== null) {
            this._playPattern(this._currentPattern);
        }
    }

    /**
     * Stop playback. The audio engine stays initialised and
     * the AudioContext stays alive, so a subsequent start
     * resumes without re-initialising. Flushes accumulated
     * musical time before clearing the wall-clock anchor so
     * the next start() starts a fresh accumulation period
     * without losing the time spent playing this period.
     */
    stop() {
        if (this._playing && this._syncWallTime !== null && this._cps !== null) {
            const now = performance.now() / 1000;
            this._accumulatedGxCycles += (now - this._syncWallTime) * this._cps;
        }
        this._syncWallTime = null;
        this._playing = false;
        if (this._initialized) {
            this._hush();
        }
    }

    /**
     * Internal helper. Polls window for the Strudel pattern-
     * builder globals (note, s, samples) until they appear
     * or a timeout expires. initStrudel returns before its
     * async global-registration work completes, so a naive
     * init() that resolved on initStrudel's return would let
     * callers race ahead and observe window.note still
     * undefined; this helper closes that gap. 50ms poll
     * interval keeps the resolved-state lag imperceptible;
     * 5-second timeout is a defensive cap that should never
     * fire in practice (the Phase 1 smoke test consistently
     * has globals live within one to two seconds of
     * initStrudel), and rejects rather than silently giving
     * up so the Load Engine handler's catch block surfaces
     * the failure to the user. Checking note, s, and samples
     * specifically rather than every Strudel global keeps
     * the ready signal tight and avoids waiting for
     * unrelated registrations.
     *
     * @returns {Promise<void>}
     */
    async _waitForGlobals() {
        const TIMEOUT_MS = 5000;
        const POLL_INTERVAL_MS = 50;
        const start = performance.now();
        while (performance.now() - start < TIMEOUT_MS) {
            /** @type {any} */
            const w = (typeof window !== "undefined") ? window : null;
            if (w !== null &&
                typeof w.note === "function" &&
                typeof w.s === "function" &&
                typeof w.samples === "function") {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        throw new Error(
            "StrudelRuntime: timed out waiting for Strudel pattern " +
            "globals (note, s, samples) to register on window after initStrudel.",
        );
    }

    /**
     * Internal helper. Load the default sample banks so
     * patterns using common sample names — s("bd"),
     * s("sd"), s("hh"), s("piano"), and the rest of the
     * dirt-samples + dough-samples piano canon — play
     * without any user setup. Called once per init from
     * inside the init promise.
     *
     * Two banks are loaded:
     *
     *   - github:tidalcycles/dirt-samples — the long-
     *     standing Tidal Cycles drum bank Strudel docs
     *     use as their canonical example. github: is the
     *     samples() shortcut that auto-discovers a
     *     strudel.json manifest at the repo root.
     *
     *   - felixroos/dough-samples piano.json — the
     *     piano sample manifest the strudel.cc REPL
     *     itself prebakes. dough-samples ships several
     *     instrument JSONs (piano, vcsl, EmuSP12, etc.)
     *     individually, so we pass the full URL to
     *     piano.json rather than using the github:
     *     shortcut, which only auto-discovers a
     *     repo-root strudel.json.
     *
     * samples() fetches each bank's manifest synchronously-
     * ish (small JSON); individual audio buffers are
     * fetched lazily on first play, so the very first hit
     * of a never-played sample may briefly drop while its
     * file downloads, but subsequent hits play cleanly.
     *
     * Each bank loads in its own try/catch so a failure
     * of one (offline, rate-limited, network blocked, etc.)
     * doesn't take out the other. Each failure logs a
     * console warning and returns; the caller (init) still
     * flips _initialized to true regardless. note()
     * patterns and any user-supplied samples('...') call
     * from behaviors.js still work whether either default
     * bank loaded or not.
     *
     * Non-fatal on the missing-globals case: if
     * window.samples is unavailable (Strudel API drift,
     * partial init), neither bank loads and a single
     * warning logs.
     *
     * @returns {Promise<void>}
     */
    async _loadDefaultSamples() {
        /** @type {any} */
        const w = (typeof window !== "undefined") ? window : null;
        if (w === null || typeof w.samples !== "function") {
            console.warn(
                "StrudelRuntime: window.samples is not available; " +
                "default sample banks (drums, piano) will not load. " +
                "note() patterns still work.",
            );
            return;
        }
        try {
            await w.samples("github:tidalcycles/dirt-samples");
        } catch (err) {
            console.warn(
                "StrudelRuntime: failed to load default drum sample " +
                "bank (github:tidalcycles/dirt-samples). Drum samples " +
                "will not play but the rest of the engine continues.",
                err,
            );
        }
        try {
            await w.samples(
                "https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json",
            );
        } catch (err) {
            console.warn(
                "StrudelRuntime: failed to load default piano sample " +
                "bank (felixroos/dough-samples piano.json). s(\"piano\") " +
                "patterns will not play but the rest of the engine " +
                "continues.",
                err,
            );
        }
    }

    /**
     * Internal helper. Rebuilds the active pattern from the
     * stored _scene by walking paths and free sprites and
     * stacking each cycle-bound sprite's contribution. An
     * empty scene or one with no qualifying sprites clears
     * the active pattern (silence). Single-sprite scenes
     * skip the stack wrapper since stack(p) is equivalent
     * to p; multi-sprite scenes stack via window.stack.
     */
    _rebuildPattern() {
        if (this._scene === null) {
            this.setPattern(null);
            return;
        }
        /** @type {any[]} */
        const subPatterns = [];
        for (const path of this._scene.paths) {
            const sub = this._buildSpritePattern(path.sprite);
            if (sub !== null) subPatterns.push(sub);
        }
        for (const sprite of this._scene.sprites) {
            const sub = this._buildSpritePattern(sprite);
            if (sub !== null) subPatterns.push(sub);
        }
        if (subPatterns.length === 0) {
            this.setPattern(null);
            return;
        }
        if (subPatterns.length === 1) {
            this.setPattern(subPatterns[0]);
            return;
        }
        /** @type {any} */
        const w = window;
        this.setPattern(w.stack(...subPatterns));
    }

    /**
     * Internal helper. Builds the sub-pattern for a single
     * sprite, or returns null if the sprite contributes
     * nothing to the stack. The contribution is composed
     * of two independent parts:
     *
     *   - Audio sub-pattern, built when the sprite's cycle
     *     slot is non-empty, canCycle is on, and the sprite
     *     isn't muted. The cycle function from
     *     scene.functionMap is called; the returned pattern
     *     is .slow(effectiveDuration)'d, .late(cyclePhase)'d
     *     (skipped when zero), and .set({_spriteId})'d for
     *     downstream attribution. An unresolved slot name
     *     warns and skips audio. A null/undefined return is
     *     silently skipped (the Create-button stub scaffolds
     *     with `return null;` so a freshly-created cycle is
     *     silent until the composer fills it in).
     *
     *   - Marker sub-pattern, built when a cursor-sync
     *     callback is registered, the sprite isn't muted,
     *     and either the sprite is path-bound (cursor
     *     advances regardless of audio, so always wants
     *     sync) or audio is being built for it. The marker
     *     is pure(0).slow(effectiveDuration) with optional
     *     .late(cyclePhase) and .onTrigger that delegates
     *     to the registered cursor-sync callback. Silent
     *     because pure(0)'s value has no audio control
     *     parameters — only the onTrigger runs.
     *
     * The two parts are stacked when both are built;
     * otherwise whichever is non-null is returned alone.
     * Returns null when neither is built (free sprite with
     * no audio, or any sprite muted, or sprite with no
     * audio and no cursor-sync callback registered).
     *
     * The marker mechanism is what keeps cursor and audio
     * in lockstep: the cursor advances on the simulation's
     * accumulator (subject to floating-point drift over
     * many cycles); the marker fires at Strudel's precise
     * scheduler clock and snaps the cursor back to t=0
     * each user-cycle, bounding drift at one cycle. For
     * path-bound sprites without audio, the marker is the
     * only sync mechanism but is enough — the cursor's
     * apparent rhythm is whatever cycleDuration dictates,
     * and that rhythm stays precise.
     *
     * The onTrigger callback uses setTimeout to delay the
     * snap until the hap's actual play time, since
     * Strudel's scheduler fires onTrigger at scheduler-tick
     * time (~150ms before audio plays). The delay is
     * computed by probing the onTrigger args for a pair of
     * numbers whose difference falls in the [0, 1000ms)
     * range, which identifies the (currentTime, hapTime)
     * pair across Strudel version variation in callback
     * signature. Falls back to immediate snap if no usable
     * pair is found.
     *
     * Construction is wrapped in independent try/catch
     * blocks for audio and marker so a failure in one
     * doesn't take down the other. Errors are logged via
     * console.error with the sprite's label and the cycle
     * slot name; the sprite contributes whichever pattern
     * succeeded (or null if both failed) and the rest of
     * the score continues unaffected.
     *
     * @param {import("./scene.js").Sprite} sprite
     * @returns {any | null}
     */
    _buildSpritePattern(sprite) {
        if (this._scene === null) return null;

        const label = sprite.name !== "" ? sprite.name : sprite.id;
        const isPathBound = this._isPathSprite(sprite.id);

        // Solo gate: when solo is active, a sprite whose id
        // is not in the solo set is effectively muted. The
        // user's per-sprite mute field still applies on top
        // — a muted sprite stays silent even when in the
        // solo set, so deliberate mute choices are honoured
        // during solo testing.
        const soloAllows = !this._soloActive || this._soloIds.has(sprite.id);
        const effectivelyMuted = sprite.mute || !soloAllows;

        // Decide what this sprite contributes. Audio comes
        // from the cycle pattern only when the cycle slot
        // is bound, the cycle gate is on, and the sprite
        // isn't muted (including solo's effective-mute).
        // Marker (cursor / position resync) is needed
        // whenever the cursor-sync callback is registered
        // AND the sprite isn't effectively muted AND either
        // the sprite is path-bound (cursor always advances
        // and needs sync) or there is audio to align the
        // resync to.
        const wantAudio =
            sprite.cycle !== "" &&
            sprite.canCycle &&
            !effectivelyMuted;
        const wantMarker =
            this._cursorSyncCallback !== null &&
            !effectivelyMuted &&
            (isPathBound || wantAudio);

        if (!wantAudio && !wantMarker) return null;

        const gxCps = this._cps !== null ? this._cps : STRUDEL_DEFAULT_CPS;
        const effectiveDuration = sprite.cycleDuration * (STRUDEL_DEFAULT_CPS / gxCps);

        /** @type {any} */
        const w = window;

        // --- Build audio pattern ---
        let audioPattern = null;
        if (wantAudio) {
            const fn = this._scene.functionMap[sprite.cycle];
            if (typeof fn !== "function") {
                console.warn(
                    `StrudelRuntime: sprite "${label}" cycle slot names ` +
                    `"${sprite.cycle}" but no such function exists in ` +
                    `behaviors.js; skipping audio.`,
                );
            } else {
                try {
                    let p = fn();
                    if (p !== null && p !== undefined) {
                        p = p.slow(effectiveDuration);
                        if (sprite.cyclePhase !== 0) {
                            p = p.late(sprite.cyclePhase);
                        }
                        p = p.set({_spriteId: sprite.id});
                        audioPattern = p;
                    }
                } catch (err) {
                    console.error(
                        `StrudelRuntime: error building audio sub-pattern for ` +
                        `sprite "${label}" (cycle slot "${sprite.cycle}"). ` +
                        `Falling back to silence for this sprite's audio; ` +
                        `marker still built if applicable.`,
                        err,
                    );
                }
            }
        }

        // --- Build marker pattern ---
        let markerPattern = null;
        if (wantMarker) {
            try {
                markerPattern = w.pure(0).slow(effectiveDuration);
                if (sprite.cyclePhase !== 0) {
                    markerPattern = markerPattern.late(sprite.cyclePhase);
                }
                const cursorSyncCallback = this._cursorSyncCallback;
                const spriteIdCapture = sprite.id;
                markerPattern = markerPattern.onTrigger((...args) => {
                    // Strudel's onTrigger fires at scheduler-
                    // tick time, up to ~150ms before the
                    // audio actually plays. To align the
                    // snap with the audible cycle boundary,
                    // schedule it via setTimeout for the
                    // moment the hap will fire. The
                    // callback signature varies by Strudel
                    // version; we probe args for a pair of
                    // numbers where one is the AudioContext
                    // currentTime and another is a future
                    // hap time, and use the difference as
                    // the delay. Fallback is immediate snap.
                    let delayMs = 0;
                    for (let i = 0; i < args.length; i++) {
                        const a = args[i];
                        if (typeof a !== "number" || !Number.isFinite(a)) continue;
                        for (let j = 0; j < args.length; j++) {
                            if (i === j) continue;
                            const b = args[j];
                            if (typeof b !== "number" || !Number.isFinite(b)) continue;
                            const diff = (b - a) * 1000;
                            if (diff > 0 && diff < 1000) {
                                delayMs = diff;
                                break;
                            }
                        }
                        if (delayMs > 0) break;
                    }
                    if (delayMs > 0) {
                        setTimeout(() => cursorSyncCallback(spriteIdCapture), delayMs);
                    } else {
                        cursorSyncCallback(spriteIdCapture);
                    }
                });
            } catch (err) {
                console.error(
                    `StrudelRuntime: error building marker pattern for ` +
                    `sprite "${label}". Cursor will drift for this sprite ` +
                    `but the rest of the stack continues to play.`,
                    err,
                );
                markerPattern = null;
            }
        }

        // --- Combine ---
        if (audioPattern !== null && markerPattern !== null) {
            return w.stack(audioPattern, markerPattern);
        }
        if (audioPattern !== null) return audioPattern;
        if (markerPattern !== null) return markerPattern;
        return null;
    }

    /**
     * Internal helper. Returns true iff the given sprite id
     * matches the bound sprite of any path in the active
     * scene. Used by _buildSpritePattern to decide whether
     * to build a marker pattern for cursor sync even when
     * the sprite has no audio cycle: path-bound sprites
     * always need cursor sync, free sprites only need it
     * when there's audio to align to.
     *
     * @param {string} spriteId
     * @returns {boolean}
     */
    _isPathSprite(spriteId) {
        if (this._scene === null) return false;
        for (const path of this._scene.paths) {
            if (path.sprite && path.sprite.id === spriteId) return true;
        }
        return false;
    }

    /**
     * Reset musical position to cycle zero. Mirrors the
     * Transport's rewind semantics: rewind always pauses
     * first (transport.rewind calls pause() before emitting
     * the rewind event), so by the time this method runs
     * _playing is already false. The runtime just zeroes
     * its accumulator; the next start() will compute
     * offset zero from the cleared accumulator and play
     * from cycle zero.
     *
     * Driven from main.js by a transport.on("rewind")
     * subscription, which fires after the play event that
     * the implicit pause emits. Safe to call before init:
     * the accumulator is a simple instance field that
     * exists regardless of init state.
     */
    rewind() {
        this._accumulatedGxCycles = 0;
    }

    /**
     * Internal helper. Computes the .early offset (in
     * strudel cycles) to apply to the active pattern so
     * playback resumes at the paused musical position
     * rather than restarting at strudel cycle 0.
     *
     * Musical time = accumulated + (currently playing?
     * elapsed since sync * current cps : 0). Conversion to
     * strudel cycles applies the cps factor: strudel =
     * musical * STRUDEL_DEFAULT_CPS / gxCps. The factor is
     * necessary because commit 3's bake-cps approach makes
     * pattern timing depend on gxCps via the slow factor;
     * a strudel-cycle offset corresponds to a different
     * musical-cycle shift at different gxCps values, so the
     * conversion has to happen at .early-application time
     * using whichever gxCps is current.
     *
     * Returns 0 when no time has accumulated and we're not
     * playing — the fresh-start case. The caller treats 0
     * as a signal to skip the .early wrapper entirely,
     * since pattern.early(0) is the identity transformation
     * but a wrapper allocation we can avoid.
     *
     * @returns {number} Offset in strudel cycles, non-negative.
     */
    _cycleOffset() {
        let musicalGxCycles = this._accumulatedGxCycles;
        if (this._syncWallTime !== null && this._cps !== null) {
            const now = performance.now() / 1000;
            musicalGxCycles += (now - this._syncWallTime) * this._cps;
        }
        if (musicalGxCycles <= 0) return 0;
        const gxCps = this._cps !== null ? this._cps : STRUDEL_DEFAULT_CPS;
        return musicalGxCycles * STRUDEL_DEFAULT_CPS / gxCps;
    }

    /**
     * Internal helper. Plays a pattern with the position-
     * preserving .early offset applied, so pause/resume
     * picks up at the paused musical position rather than
     * restarting at cycle 0. Used by both setPattern (the
     * rebuild path) and start (the resume-existing-pattern
     * path) so every transition into audible playback goes
     * through the offset machinery.
     *
     * Skips the .early wrapper when offset is 0 — the fresh-
     * start case where no time has accumulated yet — since
     * pattern.early(0) is the identity transformation and we
     * can avoid the allocation.
     *
     * @param {any} pattern A non-null Strudel pattern.
     */
    _playPattern(pattern) {
        const offset = this._cycleOffset();
        if (offset > 0) {
            pattern.early(offset).play();
        } else {
            pattern.play();
        }
    }

    /**
     * Internal helper. Strudel exposes hush as a global on
     * window after initStrudel runs. Wrapped here so the
     * window-global access is centralised in one place.
     */
    _hush() {
        if (typeof window !== "undefined" &&
            typeof (/** @type {any} */ (window).hush) === "function") {
            /** @type {any} */ (window).hush();
        }
    }
}
