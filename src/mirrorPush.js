/**
 * Composition mirror push pipeline (renderer side).
 *
 * Section 15 of DESIGN.md, Phase 1A commit 2. Owns the
 * renderer-side half of the composition mirror's write
 * path: subscribe to the active bundle's content-change
 * events, debounce ~500ms after the last change, then
 * package the bundle's scene.json text, behaviours.js
 * text, and (if any) image bytes and dispatch to the
 * main process via window.gxwMirror.pushScore. The main-
 * process module (electron-mirror.js) takes the payload,
 * writes each file atomically using temp-and-rename, and
 * updates active-score.json.
 *
 * Lifecycle:
 *
 *   - setBundle(bundle) tells the pipeline which bundle to
 *     track. Subscribes to the new bundle's content-change
 *     and dirty-change events; unsubscribes from the prior
 *     bundle. Triggers an immediate push when the mirror
 *     is enabled, so a score switch reflects in the mirror
 *     folder right away rather than waiting for the next
 *     edit.
 *
 *   - setEnabled(enabled) tells the pipeline whether the
 *     mirror feature is on. Driven by the Settings dialog's
 *     toggle and queried once at startup. Toggling on
 *     triggers an immediate push of the current bundle;
 *     toggling off cancels any pending debounce (the main-
 *     process disable path clears the folder).
 *
 *   - The pipeline subscribes to two bundle events.
 *     subscribeContentChange fires on every file mutation,
 *     including each keystroke that lands in CodeMirror's
 *     updateContent call. subscribeDirtyChange fires on
 *     dirty boolean transitions, including the
 *     dirty-to-clean edge on save: we listen because the
 *     active-score.json's dirty field needs to update
 *     promptly after a save even though the content itself
 *     is unchanged. Both paths run through the same
 *     debounced push so multiple rapid events coalesce
 *     into one push.
 *
 * Naming. The bundle's internal text file for the score's
 * callback code is named behaviors.js (American spelling).
 * The mirror writes it on disk as behaviours.js (British
 * spelling) per Section 15. The translation happens here:
 * we read bundle.getFile under the American name and pass
 * the content under the payload key behavioursJsText,
 * which the main process writes as behaviours.js.
 *
 * What is not in scope for commit 2: validation of incoming
 * edits (Phase 1B), fs.watch round-trip (Phase 1B), the
 * snapshot PNGs (Phase 1A commit 3), snapshot-
 * description.md (Phase 1A commit 4), full active-score.json
 * schema (Phase 1A commit 5). This module pushes the
 * round-trip files (scene.json, behaviours.js, image) and a
 * partial active-score.json snapshot covering score identity
 * and sync timestamp; the rest builds on top in later
 * commits.
 */

// @ts-check

import { sampleCurve } from "./curveGeometry.js";

const DEBOUNCE_MS = 500;

// Bundle's internal name for the callback-code file is
// American behaviors.js; Section 15 specifies the mirror
// surface uses British behaviours.js. The translation lives
// here: the payload field name is the mirror-surface name
// (behavioursJsText) and the read from the bundle uses the
// American name.
const BUNDLE_BEHAVIORS_FILENAME = "behaviors.js";

export class MirrorPush {
    /**
     * @param {{ messages?: import("./messages.js").MessageArea | null }} [options]
     */
    constructor(options = {}) {
        /** @type {import("./messages.js").MessageArea | null} */
        this._messages = options.messages ?? null;

        /** @type {import("./bundle.js").Bundle | null} */
        this._bundle = null;

        /** @type {(() => void) | null} */
        this._unsubscribeContent = null;

        /** @type {(() => void) | null} */
        this._unsubscribeDirty = null;

        /** @type {ReturnType<typeof setTimeout> | null} */
        this._debounceTimer = null;

        /**
         * Cached enabled flag. The renderer mirrors the
         * main process's enabled state through the Settings
         * dialog toggle and an initial status query at
         * startup. Used to gate push attempts at the
         * renderer so we do not waste IPC and ArrayBuffer
         * copies when the feature is off.
         * @type {boolean}
         */
        this._enabled = false;

        /**
         * Reentrancy guard. A push is in flight: skip
         * starting a second concurrent push. The next
         * content-change event will schedule a fresh
         * debounce after this push resolves, so no work
         * is lost.
         * @type {boolean}
         */
        this._pushing = false;

        // --- Runtime-state push pipeline (Phase 1A commit 3) ---
        //
        // Separate from the text-file push pipeline above.
        // Runtime state captures simulation-side state that
        // scene.json cannot express — current sprite
        // positions and velocities after physics has run,
        // current cursor positions along each curve,
        // transport time and beat at the moment of capture.
        // Written to runtime-state.json via a separate IPC
        // (gxw:mirror-push-runtime-state) so the cadence
        // stays independent of text-file pushes: runtime
        // state changes on simulation events (runScene
        // success, pause, rewind) while text changes on
        // every edit. At-rest captures only: when the
        // transport is playing, the push is skipped to
        // avoid producing a churn of files no AI is going
        // to read through.

        /** @type {import("./simulation.js").Simulation | null} */
        this._simulation = null;

        /** @type {import("./transport.js").Transport | null} */
        this._transport = null;

        /** @type {import("./scene.js").Scene | null} */
        this._scene = null;

        /** @type {(() => void) | null} */
        this._unsubscribePlay = null;

        /** @type {(() => void) | null} */
        this._unsubscribeRewind = null;

        /** @type {boolean} */
        this._pushingRuntime = false;
    }

    /**
     * Tell the pipeline which bundle to track. Unsubscribes
     * from the previous bundle's events, subscribes to the
     * new one's, and triggers an immediate push when the
     * mirror is enabled. A null bundle disconnects the
     * pipeline (no events tracked, no pushes fire).
     *
     * Called from main.js initially after the bundle loads
     * and again from switchToBundle so the pipeline follows
     * score switches. Idempotent on the same bundle
     * reference: passing the current bundle is a no-op.
     *
     * @param {import("./bundle.js").Bundle | null} bundle
     */
    setBundle(bundle) {
        if (this._bundle === bundle) return;

        if (this._unsubscribeContent !== null) {
            this._unsubscribeContent();
            this._unsubscribeContent = null;
        }
        if (this._unsubscribeDirty !== null) {
            this._unsubscribeDirty();
            this._unsubscribeDirty = null;
        }

        this._bundle = bundle;

        if (bundle === null) {
            this._cancelDebounce();
            return;
        }

        this._unsubscribeContent = bundle.subscribeContentChange(() => {
            this._scheduleDebouncedPush();
        });
        // Dirty-change subscription specifically catches the
        // dirty-to-clean transition that save() produces, so
        // active-score.json's dirty field updates promptly
        // after a save even though content is unchanged. The
        // false-to-true transition is already covered by the
        // content-change subscription (the edit that flips
        // dirty fires content-change too); listening to both
        // sides is harmless because the debounce coalesces.
        this._unsubscribeDirty = bundle.subscribeDirtyChange(() => {
            this._scheduleDebouncedPush();
        });

        if (this._enabled) {
            // Score switch: push the new score immediately
            // rather than waiting for an edit, so the
            // mirror's folder reflects the active score
            // promptly. _pushNow cancels any pending
            // debounce so we do not double-push.
            void this._pushNow();
        }
    }

    /**
     * Update the cached enabled flag. Called by the
     * Settings dialog after the user toggles the mirror in
     * AI Integration, and once at startup after the initial
     * gxwMirror.getStatus() resolves.
     *
     * Enabling triggers an immediate push of the current
     * bundle so the user sees content in the mirror folder
     * right away rather than after their next edit.
     * Disabling cancels any pending debounce; the main-
     * process disable path clears the folder's contents
     * separately.
     *
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        const wasEnabled = this._enabled;
        this._enabled = Boolean(enabled);
        if (!this._enabled) {
            this._cancelDebounce();
            return;
        }
        if (!wasEnabled && this._bundle !== null) {
            void this._pushNow();
        }
        if (!wasEnabled) {
            // Toggling on also pushes a fresh runtime-state
            // snapshot if a scene is loaded and the
            // transport is at rest, so the AI sees both
            // the round-trip files and the runtime state
            // immediately on enable.
            void this._pushRuntimeStateNow();
        }
    }

    /**
     * Start (or reset) the debounce timer. After the timer
     * fires (DEBOUNCE_MS milliseconds with no further
     * content or dirty changes) _pushNow runs and packages
     * the current bundle state.
     */
    _scheduleDebouncedPush() {
        if (!this._enabled) return;
        if (this._bundle === null) return;
        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            void this._pushNow();
        }, DEBOUNCE_MS);
    }

    _cancelDebounce() {
        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }

    /**
     * Gather the current bundle's state into a payload and
     * dispatch via window.gxwMirror.pushScore. Cancels the
     * pending debounce (we are pushing now) and skips if
     * another push is already in flight. Failures log a
     * warning and surface to the message area if one was
     * provided to the constructor.
     */
    async _pushNow() {
        this._cancelDebounce();
        if (!this._enabled) return;
        if (this._bundle === null) return;
        if (this._pushing) return;

        /** @type {any} */
        const gxwMirror = (/** @type {any} */ (window)).gxwMirror;
        if (gxwMirror === undefined || gxwMirror === null ||
            typeof gxwMirror.pushScore !== "function") {
            // Web build or main-process bridge unavailable.
            // Silently no-op: the Settings UI is also gated
            // on isElectron, so this branch is only reached
            // if the bridge somehow disappeared mid-session.
            return;
        }

        const bundle = this._bundle;
        const sceneJson = bundle.getFile("scene.json");
        const behaviorsJs = bundle.getFile(BUNDLE_BEHAVIORS_FILENAME);
        const image = bundle.getCurrentImage();

        const payload = {
            sceneJsonText: sceneJson !== null ? sceneJson.content : "",
            behavioursJsText: behaviorsJs !== null ? behaviorsJs.content : "",
            image: image !== null ? {
                name: image.name,
                bytes: image.content,
                mimeType: image.mimeType,
            } : null,
            score: {
                displayName: bundle.name,
                path: bundle.path,
                dirty: bundle.dirty,
            },
        };

        this._pushing = true;
        try {
            await gxwMirror.pushScore(payload);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("GXW: mirror push failed:", err);
            if (this._messages !== null) {
                this._messages.write(`Mirror push failed: ${msg}`, "error");
            }
        } finally {
            this._pushing = false;
        }
    }

    // --- Runtime-state push pipeline (Phase 1A commit 3) ---

    /**
     * Hand the pipeline a reference to the Simulation it
     * should read runtime state from. Called once from
     * main.js after the Simulation is constructed.
     * @param {import("./simulation.js").Simulation | null} simulation
     */
    setSimulation(simulation) {
        this._simulation = simulation;
    }

    /**
     * Hand the pipeline a reference to the Transport and
     * subscribe to its play and rewind events so a pause
     * or rewind triggers a fresh runtime-state push. The
     * "play" event fires on both play() and pause(); the
     * at-rest gate inside _pushRuntimeStateNow handles the
     * play() case (skip, we're entering playback). Rewind
     * always resets elapsed time to zero; pushing on rewind
     * captures the reset positions so the runtime file
     * reflects what the user sees after the rewind.
     *
     * Idempotent and switchable: passing a new transport
     * unsubscribes from the old one's events first. Passing
     * null unsubscribes and leaves the pipeline without
     * transport-driven captures.
     *
     * @param {import("./transport.js").Transport | null} transport
     */
    setTransport(transport) {
        if (this._unsubscribePlay !== null) {
            this._unsubscribePlay();
            this._unsubscribePlay = null;
        }
        if (this._unsubscribeRewind !== null) {
            this._unsubscribeRewind();
            this._unsubscribeRewind = null;
        }
        this._transport = transport;
        if (transport === null) return;
        this._unsubscribePlay = transport.on("play", () => {
            void this._pushRuntimeStateNow();
        });
        this._unsubscribeRewind = transport.on("rewind", () => {
            void this._pushRuntimeStateNow();
        });
    }

    /**
     * Update the pipeline's scene reference and push a
     * fresh runtime-state snapshot. Called from main.js's
     * runScene after a successful Scene build, so every
     * scene reload (including the initial auto-run, score
     * switches, and edits that trigger Cmd-Enter) updates
     * runtime-state.json. The at-rest gate inside
     * _pushRuntimeStateNow ensures the push is skipped
     * when the transport happens to be playing through
     * the reload.
     *
     * Passing null clears the scene reference and skips
     * any push; used during teardown or when the scene
     * load failed.
     *
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        if (scene === null) return;
        void this._pushRuntimeStateNow();
    }

    /**
     * Build a runtime-state payload from the current scene,
     * simulation, and transport, and dispatch via
     * window.gxwMirror.pushRuntimeState. No-op when the
     * mirror is disabled, when any of scene/simulation/
     * transport is missing, when another runtime push is
     * already in flight, or when the transport is actively
     * playing (the at-rest-only rule keeps the file stable
     * while audio is firing). Failures log a warning and
     * surface to the message area if one was provided.
     */
    async _pushRuntimeStateNow() {
        if (!this._enabled) return;
        if (this._scene === null) return;
        if (this._simulation === null) return;
        if (this._transport === null) return;
        if (this._transport.isPlaying) return;
        if (this._pushingRuntime) return;

        /** @type {any} */
        const gxwMirror = (/** @type {any} */ (window)).gxwMirror;
        if (gxwMirror === undefined || gxwMirror === null ||
            typeof gxwMirror.pushRuntimeState !== "function") {
            return;
        }

        const payload = this._captureRuntimeState();
        if (payload === null) return;

        this._pushingRuntime = true;
        try {
            await gxwMirror.pushRuntimeState(payload);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("GXW: mirror runtime-state push failed:", err);
            if (this._messages !== null) {
                this._messages.write(
                    `Mirror runtime-state push failed: ${msg}`,
                    "error",
                );
            }
        } finally {
            this._pushingRuntime = false;
        }
    }

    /**
     * Build the runtime-state payload. Returns null when
     * any required reference is missing (callers gate
     * separately, but the helper defends).
     *
     * Sprites: id, current position, current velocity,
     * cycle counter and progress. The position and velocity
     * are the live simulation values, which equal the
     * authored values at true edit time (no playback yet)
     * and diverge under physics after the transport has
     * advanced and paused.
     *
     * Curves: id, current physics offset (dx, dy) relative
     * to the authored shape, cycle counter and progress,
     * halted flag, and cursor position. The cursor object
     * carries the t parameter in [0, 1] plus the world
     * coordinates (sampleCurve evaluated against the
     * authored shape, then translated by the runtime
     * offset). A null cursor means the shape couldn't be
     * sampled — typically a degenerate piste with fewer
     * than two points, or a not-yet-implemented shape type.
     *
     * Triggers are intentionally omitted: they don't move
     * (no velocity field in the schema) and scene.json
     * fully describes their position.
     *
     * Transport: state ("stopped" when elapsedSeconds is
     * 0, "paused" otherwise; never "playing" since the
     * at-rest gate in _pushRuntimeStateNow filters that
     * out before we get here), elapsedSeconds,
     * elapsedBeats (null for time-based pieces),
     * musicalPosition (null for time-based or when no
     * time signature is set), and bpm.
     *
     * @returns {object | null}
     */
    _captureRuntimeState() {
        const scene = this._scene;
        const simulation = this._simulation;
        const transport = this._transport;
        if (scene === null || simulation === null || transport === null) {
            return null;
        }

        const elapsedSeconds = transport.elapsedSeconds;
        const state = elapsedSeconds === 0 ? "stopped" : "paused";

        const sprites = [];
        for (const sprite of scene.sprites) {
            if (typeof sprite.id !== "string") continue;
            const runtime = simulation.getSpriteRuntime(sprite.id);
            if (runtime === null) continue;
            sprites.push({
                id: sprite.id,
                position: { x: runtime.x, y: runtime.y },
                velocity: { vx: runtime.vx, vy: runtime.vy },
                cycle: {
                    count: runtime.cycleCount,
                    progress: runtime.cycleProgress,
                },
            });
        }

        const curves = [];
        for (const curve of scene.curves) {
            if (typeof curve.id !== "string") continue;
            const t = simulation.getCurveCursorT(curve.id);
            const offset = simulation.getCurveRuntimeOffset(curve.id);
            const cycleState = simulation.getCurveCycleState(curve.id);
            const halted = simulation.isCurveHalted(curve.id);
            const sample = sampleCurve(curve.shape, t);
            const dx = offset !== null ? offset.dx : 0;
            const dy = offset !== null ? offset.dy : 0;
            const cursor = sample !== null
                ? { t, x: sample.x + dx, y: sample.y + dy }
                : null;
            curves.push({
                id: curve.id,
                offset: { dx, dy },
                halted,
                cycle: cycleState !== null
                    ? {
                        count: cycleState.cycleCount,
                        progress: cycleState.cycleProgress,
                    }
                    : { count: 0, progress: 0 },
                cursor,
            });
        }

        return {
            transport: {
                state,
                elapsedSeconds,
                elapsedBeats: transport.elapsedBeats,
                musicalPosition: transport.musicalPosition,
                bpm: transport.bpm,
            },
            sprites,
            curves,
        };
    }
}
