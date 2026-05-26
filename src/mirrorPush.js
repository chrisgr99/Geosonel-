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
 * schema (Phase 1A commit 4 — was originally planned for
 * commit 5 before the slot collapsed). This module pushes
 * the round-trip files (scene.json, behaviours.js, image)
 * and a partial active-score.json snapshot covering score
 * identity and sync timestamp; the rest builds on top in
 * later commits.
 */

// @ts-check

import { sampleCurve } from "./curveGeometry.js";
import { parseScene } from "./sceneEditor.js";
import * as acorn from "https://esm.sh/acorn@8";

const DEBOUNCE_MS = 500;

// Bundle's internal name for the callback-code file is
// American behaviors.js; Section 15 specifies the mirror
// surface uses British behaviours.js. The translation lives
// here: the payload field name is the mirror-surface name
// (behavioursJsText) and the read from the bundle uses the
// American name.
const BUNDLE_BEHAVIORS_FILENAME = "behaviors.js";

// Filename the mirror writes the callback-code file as on
// disk. Phase 1B commit 2's applyBatch translates from
// this mirror-surface name to BUNDLE_BEHAVIORS_FILENAME
// when updating the bundle, so an AI's behaviours.js write
// lands on the bundle's behaviors.js without the bundle
// having to know about the spelling difference.
const MIRROR_BEHAVIOURS_FILENAME = "behaviours.js";
const MIRROR_SCENE_FILENAME = "scene.json";

export class MirrorPush {
    /**
     * Subscribe to state changes in the confirm-to-apply
     * machine. The callback receives an object with
     * {state, heldBatch, rejectionInfo} on every
     * transition. Returns an unsubscribe function.
     *
     * Used by the dialog UI in main.js to update its
     * visual state when batches start, become ready,
     * fail validation, or are accepted/cancelled.
     *
     * @param {(state: {state: string, heldBatch: any, rejectionInfo: any}) => void} callback
     * @returns {() => void}
     */
    addStateChangeListener(callback) {
        this._stateChangeListeners.add(callback);
        return () => this._stateChangeListeners.delete(callback);
    }

    _emitStateChange() {
        const snapshot = {
            state: this._batchState,
            heldBatch: this._heldBatch,
            rejectionInfo: this._rejectionInfo,
        };
        for (const cb of this._stateChangeListeners) {
            try {
                cb(snapshot);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`GXW: mirrorPush state-change listener threw: ${msg}`);
            }
        }
    }

    /**
     * Called via the gxwMirror.onBatchStarted IPC
     * subscription when the main process detects that an
     * AI batch is beginning — either because .pending
     * appeared or because the first round-trip event of
     * a no-sentinel batch arrived. Transitions the state
     * machine to 'thinking' so the dialog UI can show
     * the pulsing Thinking indicator. No-op when already
     * in a non-idle state (the latch on the main side
     * should prevent duplicate signals, but defending is
     * cheap).
     */
    onBatchStarted() {
        if (this._batchState !== "idle") return;
        this._batchState = "thinking";
        this._emitStateChange();
    }

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

        /**
         * BPM-change subscription on the transport. Added
         * in commit 4 so the active-score.json transport
         * block stays current as the user adjusts BPM —
         * BPM is a session-level setting that doesn't
         * flow through content-change events, so without
         * this subscription the AI's view of tempo would
         * be stale.
         * @type {(() => void) | null}
         */
        this._unsubscribeBpm = null;

        /** @type {boolean} */
        this._pushingRuntime = false;

        // --- Apply pipeline (Phase 1B commit 2) ---
        //
        // References used by applyBatch to push validated
        // AI-originated content back into the active
        // editor and trigger a scene rebuild. Wired up
        // from main.js after the editor, canvas, and
        // runScene are constructed; null until then, and
        // applyBatch tolerates any of them being null
        // (the validation and bundle-update path still
        // runs; only the editor refresh, canvas image
        // refresh, or scene rebuild that depend on the
        // missing reference are skipped).

        /** @type {import("./editor.js").TabbedEditor | null} */
        this._editor = null;

        /** @type {import("./canvas.js").Canvas | null} */
        this._canvas = null;

        /** @type {(() => Promise<void>) | null} */
        this._runScene = null;

        // --- Confirm-to-apply state machine (Phase 1B commit 4b) ---
        //
        // Under confirm-to-apply, applyBatch no longer
        // applies immediately on batch-ready arrival.
        // Instead it validates and holds the batch in
        // _heldBatch, transitions _batchState to 'ready',
        // and emits to listeners (the dialog UI) which
        // then shows the user the Accept/Cancel buttons.
        // When the user clicks Accept, confirmApply runs
        // the actual apply work. When the user clicks
        // Cancel, cancelApply discards and rolls back.
        // Validation failures transition to 'rejected'
        // with the error details captured in _rejectionInfo.

        /** @type {'idle' | 'thinking' | 'ready' | 'rejected'} */
        this._batchState = "idle";

        /** @type {Array<{filename: string, kind: "text" | "binary", content: string | ArrayBuffer, mimeType?: string}> | null} */
        this._heldBatch = null;

        /** @type {{filename: string, error: string} | null} */
        this._rejectionInfo = null;

        /** @type {Set<(state: {state: string, heldBatch: any, rejectionInfo: any}) => void>} */
        this._stateChangeListeners = new Set();
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
            transport: this._captureActiveScoreTransport(),
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

    /**
     * Build the transport block written into active-
     * score.json's snapshot. Commit 4 surface: state
     * ("playing", "paused", or "stopped"), elapsedSeconds,
     * beat (transport.elapsedBeats, which is null for
     * time-based pieces), bpm (null for time-based
     * pieces). Returns null when no Transport is wired
     * yet — main.js calls setTransport after construction,
     * but a _pushNow racing that wiring should produce a
     * coherent payload rather than throw.
     *
     * Distinct from _captureRuntimeState's transport
     * block: that one carries more (elapsedBeats,
     * musicalPosition) and lands in runtime-state.json,
     * which is captured at-rest only. The active-score.json
     * block reflects the live transport at push time,
     * including during playback, since the active-score
     * push fires on play, rewind, and bpm events.
     *
     * @returns {{state: string, elapsedSeconds: number, beat: number | null, bpm: number | null} | null}
     */
    _captureActiveScoreTransport() {
        const transport = this._transport;
        if (transport === null) return null;
        const elapsedSeconds = transport.elapsedSeconds;
        let state;
        if (transport.isPlaying) {
            state = "playing";
        } else if (elapsedSeconds === 0) {
            state = "stopped";
        } else {
            state = "paused";
        }
        return {
            state,
            elapsedSeconds,
            beat: transport.elapsedBeats,
            bpm: transport.bpm,
        };
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
     * subscribe to its play, rewind, and bpm events. The
     * play and rewind events fire two pushes each: a
     * runtime-state push (so runtime-state.json reflects
     * the new at-rest moment) and a debounced active-score
     * push (so active-score.json's transport block
     * reflects current playback state). The bpm event
     * fires only the active-score push, since bpm changes
     * don't affect at-rest runtime state in a way that
     * needs a runtime-state refresh on its own.
     *
     * The "play" event fires on both play() and pause();
     * the at-rest gate inside _pushRuntimeStateNow handles
     * the play() case (skip, we're entering playback) while
     * the active-score push has no such gate — it captures
     * "playing" as a state value rather than skipping.
     * Rewind always resets elapsed time to zero; pushing on
     * rewind captures the reset positions and the new
     * state="stopped" transport value.
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
        if (this._unsubscribeBpm !== null) {
            this._unsubscribeBpm();
            this._unsubscribeBpm = null;
        }
        this._transport = transport;
        if (transport === null) return;
        this._unsubscribePlay = transport.on("play", () => {
            void this._pushRuntimeStateNow();
            this._scheduleDebouncedPush();
        });
        this._unsubscribeRewind = transport.on("rewind", () => {
            void this._pushRuntimeStateNow();
            this._scheduleDebouncedPush();
        });
        this._unsubscribeBpm = transport.on("bpm", () => {
            this._scheduleDebouncedPush();
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

    // --- Apply pipeline (Phase 1B commit 2) ---

    /**
     * Hand the pipeline a reference to the TabbedEditor.
     * Used by applyBatch to refresh the editor's tabs
     * from the bundle after an AI batch lands, so the
     * JSON and Code tabs show the AI's edits rather than
     * the bundle's pre-edit content. Called once from
     * main.js after the editor is constructed; null
     * during early startup and during teardown.
     *
     * @param {import("./editor.js").TabbedEditor | null} editor
     */
    setEditor(editor) {
        this._editor = editor;
    }

    /**
     * Hand the pipeline a reference to the Canvas. Used
     * by applyBatch to push fresh image bytes onto the
     * canvas after the bundle's replaceImage lands, so
     * the visual background updates without waiting for
     * the next runScene to redraw. Called once from
     * main.js after the canvas is constructed; null
     * during early startup and during teardown.
     *
     * @param {import("./canvas.js").Canvas | null} canvas
     */
    setCanvas(canvas) {
        this._canvas = canvas;
    }

    /**
     * Hand the pipeline a thunk that triggers the
     * renderer's runScene flow. Called from main.js after
     * runScene is assigned. The thunk shape (rather than
     * a direct function reference) lets main.js capture
     * the runScene binding by closure so the actual
     * function looked up at call time reflects any
     * post-construction reassignment.
     *
     * @param {(() => Promise<void>) | null} runScene
     */
    setRunScene(runScene) {
        this._runScene = runScene;
    }

    /**
     * Validate an incoming AI batch and either hold it
     * for user confirmation (success) or reject it with
     * an immediate rollback (validation failure). Phase
     * 1B commit 4b refactor of the previous applyBatch:
     * the actual bundle mutations and runScene have
     * moved into confirmApply, which fires only when
     * the user clicks Accept on the dialog. This method
     * just validates and updates state — the bundle is
     * not touched here.
     *
     * Empty batch (AI wrote .pending and removed it
     * without writing any round-trip files, or the
     * orphan timer fired with nothing accumulated)
     * dismisses the dialog silently: writes a success
     * result with empty applied[], returns to idle
     * state. No user prompt needed.
     *
     * Validation pass mirrors what commit 2 established:
     * scene.json must parse via parseScene; behaviours.js
     * must parse cleanly under Acorn; image entries are
     * accepted without validation. On any text-entry
     * validation failure the whole batch is rejected:
     * last-apply-result.json is written with the rejection
     * details, the bundle's last-known-good state is
     * force-pushed back to the mirror to overwrite the
     * AI's bad write, and the state machine transitions
     * to 'rejected' so the dialog can surface the error
     * details to the user.
     *
     * On validation success the validated batch is
     * stored in _heldBatch and the state machine
     * transitions to 'ready'. The dialog shows the
     * Accept button (green); a subsequent confirmApply
     * call applies the held batch via the existing
     * bundle.updateContent / replaceImage / runScene
     * machinery.
     *
     * @param {Array<{filename: string, kind: "text" | "binary", content: string | ArrayBuffer, mimeType?: string}>} batch
     * @returns {Promise<void>}
     */
    async onBatchReceived(batch) {
        if (!Array.isArray(batch)) return;
        if (this._bundle === null) return;

        // Empty batch dismisses silently. The dialog that
        // appeared on batch-started returns to idle
        // without prompting the user.
        if (batch.length === 0) {
            await this._writeApplyResult({
                status: "success",
                timestamp: new Date().toISOString(),
                applied: [],
            });
            this._heldBatch = null;
            this._rejectionInfo = null;
            this._batchState = "idle";
            this._emitStateChange();
            return;
        }

        // Validation pass.
        for (const entry of batch) {
            if (entry.kind !== "text") continue;
            const content = typeof entry.content === "string" ? entry.content : "";
            if (entry.filename === MIRROR_SCENE_FILENAME) {
                const parsed = parseScene(content);
                if (!parsed.ok) {
                    const errorMessage = parsed.error;
                    console.warn(
                        `GXW: AI batch rejected — scene.json validation failed: ${errorMessage}`,
                    );
                    await this._reportRejectionAndRollback(MIRROR_SCENE_FILENAME, errorMessage);
                    return;
                }
            } else if (entry.filename === MIRROR_BEHAVIOURS_FILENAME) {
                try {
                    acorn.parse(content, {
                        ecmaVersion: "latest",
                        sourceType: "script",
                        allowReturnOutsideFunction: true,
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn(
                        `GXW: AI batch rejected — behaviours.js validation failed: ${msg}`,
                    );
                    await this._reportRejectionAndRollback(MIRROR_BEHAVIOURS_FILENAME, msg);
                    return;
                }
            }
        }

        // Validation succeeded — hold the batch and
        // transition to 'ready'. The dialog UI shows the
        // green Accept button. confirmApply will be
        // invoked when the user clicks it.
        this._heldBatch = batch;
        this._rejectionInfo = null;
        this._batchState = "ready";
        this._emitStateChange();
    }

    /**
     * Apply the held batch on user confirmation. Phase
     * 1B commit 4b: this is the second half of what was
     * applyBatch in commit 2 — the actual bundle
     * mutations, editor refresh, and scene rebuild that
     * land the AI's changes. Wraps the apply in a
     * transport pause-and-resume so playback doesn't
     * glitch during the runScene rebuild.
     *
     * No-op when not in 'ready' state — the dialog UI
     * should already gate the user-facing Accept button
     * to the ready state, but defensive checks here
     * prevent any race or double-click from triggering
     * an unwanted apply.
     *
     * Writes last-apply-result.json with status "success"
     * and the list of files applied, then transitions
     * state to 'idle' so the dialog dismisses.
     */
    async confirmApply() {
        if (this._batchState !== "ready") return;
        if (this._heldBatch === null) return;
        if (this._bundle === null) return;

        const batch = this._heldBatch;
        this._heldBatch = null;

        // Pause transport if playing so runScene's scene
        // rebuild doesn't fire mid-cycle. We resume after
        // the apply completes.
        const transport = this._transport;
        const wasPlaying = transport !== null && transport.isPlaying;
        if (wasPlaying) {
            try {
                transport.pause();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`GXW: transport.pause failed during apply: ${msg}`);
            }
        }

        // Apply each entry into the bundle.
        const applied = [];
        for (const entry of batch) {
            if (entry.kind === "text") {
                const content = typeof entry.content === "string" ? entry.content : "";
                const bundleName = entry.filename === MIRROR_BEHAVIOURS_FILENAME
                    ? BUNDLE_BEHAVIORS_FILENAME
                    : entry.filename;
                this._bundle.updateContent(bundleName, content);
                applied.push(entry.filename);
            } else if (entry.kind === "binary") {
                if (!(entry.content instanceof ArrayBuffer)) continue;
                const mimeType = typeof entry.mimeType === "string" && entry.mimeType !== ""
                    ? entry.mimeType
                    : "application/octet-stream";
                this._bundle.replaceImage(entry.filename, entry.content, mimeType, null);
                applied.push(entry.filename);
                if (this._canvas !== null) {
                    try {
                        await this._canvas.setImage({
                            bytes: entry.content,
                            mimeType,
                        });
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.warn(`GXW: canvas setImage failed during AI batch apply: ${msg}`);
                    }
                }
            }
        }

        if (this._editor !== null) {
            try {
                this._editor.reloadFromBundle();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`GXW: editor reload failed during AI batch apply: ${msg}`);
            }
        }

        if (this._runScene !== null) {
            try {
                await this._runScene();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`GXW: runScene failed during AI batch apply: ${msg}`);
            }
        }

        // Resume transport if it was playing before the
        // apply.
        if (wasPlaying && transport !== null) {
            try {
                transport.play();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`GXW: transport.play failed after apply: ${msg}`);
            }
        }

        await this._writeApplyResult({
            status: "success",
            timestamp: new Date().toISOString(),
            applied,
        });

        this._batchState = "idle";
        this._emitStateChange();
    }

    /**
     * Cancel the current batch on user request. Phase
     * 1B commit 4b. Behaviour depends on the state at
     * cancel time:
     *
     *   - 'thinking': the AI is still working; the held
     *     batch is not yet built. Call the main-process
     *     cancelBatch IPC to clear the sentinel and any
     *     accumulated events. Then force-push the
     *     bundle's state back to the mirror to overwrite
     *     anything the AI partially wrote. Write a
     *     cancelled result so the AI sees the outcome.
     *
     *   - 'ready': the batch is in our hands but hasn't
     *     been applied. Discard the held batch, force-
     *     push bundle state to mirror, write cancelled
     *     result.
     *
     *   - 'rejected': the rollback already ran inside
     *     _reportRejectionAndRollback. Just dismiss the
     *     dialog — no further work needed.
     *
     *   - 'idle': no-op.
     *
     * The state transitions to 'idle' immediately so a
     * double-click on Cancel can't trigger duplicate
     * rollback pushes.
     */
    async cancelApply() {
        const previousState = this._batchState;
        if (previousState === "idle") return;

        // Snapshot and clear state first so a fast
        // double-click can't re-enter the cancel work.
        this._batchState = "idle";
        this._heldBatch = null;
        this._rejectionInfo = null;
        this._emitStateChange();

        // 'rejected' state had its rollback inside
        // _reportRejectionAndRollback already; nothing
        // more to do.
        if (previousState === "rejected") return;

        // 'thinking' state: tell main to clear the
        // sentinel and pending events. Best-effort — if
        // the IPC bridge is unavailable (web build,
        // teardown race) we proceed with the rollback
        // anyway.
        if (previousState === "thinking") {
            /** @type {any} */
            const gxwMirror = (/** @type {any} */ (window)).gxwMirror;
            if (gxwMirror !== undefined && gxwMirror !== null
                && typeof gxwMirror.cancelBatch === "function") {
                try {
                    await gxwMirror.cancelBatch();
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.warn(`GXW: cancelBatch IPC failed: ${msg}`);
                }
            }
        }

        // For both 'thinking' and 'ready' cancels: force-
        // push bundle state back to the mirror so any
        // partially-written AI content is overwritten
        // with the known-good content.
        try {
            await this._pushNow();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`GXW: rollback push failed during cancel: ${msg}`);
        }

        await this._writeApplyResult({
            status: "cancelled",
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Write a rejection record to last-apply-result.json
     * and force-push the bundle's current state back to
     * the mirror so the AI's bad write is overwritten
     * with the last-known-good content. Phase 1B commit
     * 3. Both operations are best-effort: the rollback
     * runs regardless of whether the result write
     * succeeded, since keeping the mirror folder
     * consistent with the bundle is the higher-priority
     * concern. The result write surfaces the cause of
     * rejection to the AI; the rollback restores the
     * mirror's contents.
     *
     * @param {string} filename Mirror-surface filename that failed validation.
     * @param {string} error Validation error message.
     * @returns {Promise<void>}
     */
    async _reportRejectionAndRollback(filename, error) {
        await this._writeApplyResult({
            status: "rejected",
            timestamp: new Date().toISOString(),
            filename,
            error,
        });
        try {
            await this._pushNow();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`GXW: rollback push failed: ${msg}`);
        }
        // Transition to 'rejected' state so the dialog UI
        // can surface the error details to the user. The
        // user clicks Dismiss to acknowledge; the
        // rollback above already restored the mirror to
        // last-known-good state.
        this._heldBatch = null;
        this._rejectionInfo = { filename, error };
        this._batchState = "rejected";
        this._emitStateChange();
    }

    /**
     * Forward an apply-result payload to the main process
     * via the gxwMirror bridge. Tolerates the bridge
     * being unavailable (web build or early startup
     * before the preload script attached). Errors are
     * logged but never thrown, since reporting the apply
     * result is best-effort — the apply itself has
     * already taken effect (or, on rejection, the
     * rollback is about to run regardless).
     *
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async _writeApplyResult(payload) {
        /** @type {any} */
        const gxwMirror = (/** @type {any} */ (window)).gxwMirror;
        if (gxwMirror === undefined || gxwMirror === null ||
            typeof gxwMirror.writeApplyResult !== "function") {
            return;
        }
        try {
            await gxwMirror.writeApplyResult(payload);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`GXW: writeApplyResult failed: ${msg}`);
        }
    }
}
