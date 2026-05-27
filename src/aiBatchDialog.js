/**
 * AI batch confirm-to-apply dialog (Section 15 Phase 1B
 * commit 4b).
 *
 * Visual surface for the confirm-to-apply state machine
 * in mirrorPush.js. Subscribes to mirrorPush state
 * changes and renders one of four visible states (the
 * fifth state, idle, hides everything):
 *
 *   - thinking: small dialog above the message area
 *     showing a pulsating yellowish-orange "Thinking…"
 *     button (non-clickable, an indicator) alongside a
 *     red Cancel button. The AI is still working; the
 *     held batch is not yet built. Cancel here calls
 *     mirrorPush.cancelApply which routes through the
 *     main-process cancelBatch IPC plus a rollback push.
 *
 *   - ready: same small dialog, with the primary button
 *     transitioned to a green Accept (now clickable)
 *     and Cancel still red. Validation passed; the batch
 *     is held in mirrorPush awaiting user confirmation.
 *     Accept calls confirmApply (pauses transport,
 *     applies, resumes); Cancel calls cancelApply
 *     (discards and rolls back).
 *
 *   - rejected: small dialog shows the "AI edit issue"
 *     label, a Details button, and a Dismiss button.
 *     Validation failed inside mirrorPush; the rollback
 *     push has already restored the mirror folder to
 *     the bundle's known-good state. Details click
 *     expands a larger error dialog centered over the
 *     canvas; Dismiss calls cancelApply which on the
 *     rejected state just clears state and dismisses.
 *
 *   - rejected with large error showing: the small
 *     dialog hides; the larger error dialog appears in
 *     the center of the canvas with the failing
 *     filename, parser error message, reassurance that
 *     the score is unchanged, and Copy details / Close
 *     buttons. Close dismisses everything; Copy details
 *     puts a plain-text summary on the clipboard.
 *
 * The dialog mounts into #canvas-area (which has
 * position: relative). The small dialog sits anchored
 * to the bottom of canvas-area, just above the message
 * divider; the large error dialog centers within
 * canvas-area. The canvas remains visible behind both —
 * the dialogs are accent overlays rather than modal
 * curtains.
 *
 * Edge cases handled here:
 *
 *   - State transition out of the rejected-with-large-
 *     error visualisation: the render method always
 *     hides the large error dialog on state change, so
 *     any sudden state move (a new batch starting while
 *     we're looking at a rejection's details, for
 *     example) cleans up the overlay automatically.
 *
 *   - Double-click on Accept or Cancel: the dialog's
 *     buttons are simple click handlers; rapid clicks
 *     just call confirmApply / cancelApply repeatedly,
 *     which mirrorPush gates internally on state. No
 *     local debounce needed.
 *
 *   - Mount-time race: if construction races the canvas
 *     not yet having #canvas-area in the DOM, we
 *     silently skip the append. The dialog is non-
 *     functional in that case but the state listener
 *     still runs harmlessly; this branch is for
 *     defensive consistency with the rest of main.js's
 *     null tolerance, not because the race is expected
 *     to fire in practice.
 *
 * Edit blocking (Phase 1B commit 4b.2). While the dialog
 * is visible (any non-idle state), _render toggles
 * body.ai-batch-active on the document body so the CSS
 * rules in mode-overrides.css can dim and disable
 * editable surfaces — inspector form fields, canvas
 * tool-layer clicks, toolbar tool/action/canvas-field
 * buttons, BPM field, and the in-page menubar. The Code
 * tab's CodeMirror view is gated via editor.setReadOnly
 * (a state-effect dispatch, not a CSS rule) at the same
 * transition. Any currently-armed or locked toolbar tool
 * is dropped to idle when the lock engages so the canvas
 * doesn't carry stale tool state across the locked
 * period. Transport, sidebar-toggle (Focus Canvas), Play
 * Selected, and the display-only indicators stay live
 * — those don't mutate score data, so locking them
 * would just frustrate the user.
 *
 * OS notification (Phase 1B commit 4b.2). When the
 * dialog transitions from thinking to ready, _render
 * fires a native banner notification announcing the
 * held batch is awaiting review. The notification fires
 * unconditionally rather than only when the window is
 * unfocused: focused-window firing duplicates the
 * in-window dialog (a minor cost) but never misses the
 * notification when the user has moved focus to a
 * different app to keep working. Wrapped in try/catch
 * so the web build's default-permission state doesn't
 * throw; Electron requires no permission and the banner
 * fires natively.
 */

// @ts-check

export class AiBatchDialog {
    /**
     * @param {import("./mirrorPush.js").MirrorPush} mirrorPush
     */
    constructor(mirrorPush) {
        this._mirrorPush = mirrorPush;

        /** @type {'idle' | 'thinking' | 'ready' | 'rejected'} */
        this._currentState = "idle";

        /**
         * Previous state, tracked across _render calls so
         * the thinking→ready transition can fire the OS
         * notification (commit 4b.2) and the idle→non-idle
         * transition can disarm an active toolbar tool.
         * Always reflects the most recent state seen by
         * _render. Initialised to idle to match
         * _currentState's initial value.
         * @type {'idle' | 'thinking' | 'ready' | 'rejected'}
         */
        this._previousState = "idle";

        /** @type {{filename: string, error: string} | null} */
        this._currentRejectionInfo = null;

        /**
         * Editor reference for the commit 4b.2 read-only
         * lock. Wired by main.js via setEditor after both
         * editor and dialog are constructed. Null until
         * wired; _render guards on null so the dialog
         * still works (minus the read-only lock) if the
         * wiring is somehow skipped.
         * @type {import("./editor.js").TabbedEditor | null}
         */
        this._editor = null;

        /**
         * Toolbar reference for the commit 4b.2 tool
         * disarm. Wired by main.js via setToolbar after
         * both toolbar and dialog are constructed (toolbar
         * is built later than the dialog, hence the setter
         * rather than a constructor argument). Null until
         * wired; _render guards on null.
         * @type {import("./toolbar.js").Toolbar | null}
         */
        this._toolbar = null;

        this._buildSmallDialog();
        this._buildLargeErrorDialog();

        const canvasAreaEl = document.getElementById("canvas-area");
        if (canvasAreaEl !== null) {
            canvasAreaEl.appendChild(this._smallEl);
            canvasAreaEl.appendChild(this._largeEl);
        }

        // Subscribe to mirrorPush state changes. The
        // initial state is idle, so the dialog starts
        // hidden; _render handles that case by leaving
        // both surfaces with the hidden class.
        this._unsubscribe = mirrorPush.addStateChangeListener((s) => {
            this._render(s);
        });
        this._render({ state: "idle", heldBatch: null, rejectionInfo: null });
    }

    /**
     * Wire the editor reference used for the commit 4b.2
     * read-only lock. main.js calls this after the editor
     * is constructed (the editor exists before the dialog
     * does, so this could equally be a constructor
     * argument; the setter form keeps the wiring symmetric
     * with setToolbar, which has to be a setter because
     * the toolbar is built later in main.js).
     * @param {import("./editor.js").TabbedEditor} editor
     */
    setEditor(editor) {
        this._editor = editor;
    }

    /**
     * Wire the toolbar reference used for the commit 4b.2
     * tool disarm on lock engagement. main.js calls this
     * after the toolbar is constructed, which happens
     * after this dialog is constructed — hence the setter
     * rather than a constructor argument.
     * @param {import("./toolbar.js").Toolbar} toolbar
     */
    setToolbar(toolbar) {
        this._toolbar = toolbar;
    }

    /**
     * Build the small dialog DOM. Has three primary
     * elements that toggle visibility per state: the
     * status label (rejected only, shows "AI edit
     * issue"), the primary button (thinking shows
     * pulsating "Thinking…", ready shows green
     * "Accept"), and the details button (rejected only).
     * Cancel is always visible whenever the dialog
     * itself is.
     */
    _buildSmallDialog() {
        const root = document.createElement("div");
        root.className = "ai-batch-dialog hidden";

        // Status label, shown only in rejected state.
        // The primary button is hidden in that state and
        // this label replaces it as a text-only
        // indicator.
        const label = document.createElement("span");
        label.className = "ai-batch-label hidden";
        label.textContent = "AI edit issue";
        root.appendChild(label);
        this._labelEl = label;

        // Primary button. Shown in thinking and ready
        // states; hidden in rejected. Its text and CSS
        // class are set per-state in _render. Disabled
        // in thinking state (it's an indicator, not an
        // action); enabled in ready as the green Accept.
        const primary = document.createElement("button");
        primary.className = "ai-batch-primary";
        primary.type = "button";
        primary.addEventListener("click", () => {
            // Only ready state triggers a real apply;
            // thinking's primary is disabled and ignored
            // here as a guard if the disabled attribute
            // somehow doesn't suppress the click.
            if (this._currentState !== "ready") return;
            void this._mirrorPush.confirmApply();
        });
        root.appendChild(primary);
        this._primaryEl = primary;

        // Details button, rejected state only. Click
        // expands the large error dialog over the
        // canvas. The small dialog hides during that
        // visualisation so the user has one clear
        // surface at a time.
        const details = document.createElement("button");
        details.className = "ai-batch-details hidden";
        details.type = "button";
        details.textContent = "Details";
        details.addEventListener("click", () => {
            this._showLargeError();
        });
        root.appendChild(details);
        this._detailsEl = details;

        // Cancel button. Text changes per state: Cancel
        // in thinking/ready, Dismiss in rejected.
        // mirrorPush.cancelApply handles the per-state
        // semantics (IPC cancel + rollback push in
        // thinking, just rollback in ready, just
        // dismiss in rejected).
        const cancel = document.createElement("button");
        cancel.className = "ai-batch-cancel";
        cancel.type = "button";
        cancel.addEventListener("click", () => {
            void this._mirrorPush.cancelApply();
        });
        root.appendChild(cancel);
        this._cancelEl = cancel;

        this._smallEl = root;
    }

    /**
     * Build the large error dialog DOM. Hidden by
     * default; revealed via _showLargeError when the
     * user clicks Details from the rejected state.
     * Centred over the canvas; does not dim the canvas
     * behind it. Two buttons: Copy details (writes a
     * plain-text summary to the clipboard) and Close
     * (dismisses everything).
     */
    _buildLargeErrorDialog() {
        const root = document.createElement("div");
        root.className = "ai-batch-error-dialog hidden";

        const header = document.createElement("h2");
        header.className = "ai-batch-error-header";
        header.textContent = "AI edit failed";
        root.appendChild(header);

        const fileEl = document.createElement("div");
        fileEl.className = "ai-batch-error-file";
        root.appendChild(fileEl);
        this._errorFileEl = fileEl;

        const messageEl = document.createElement("pre");
        messageEl.className = "ai-batch-error-message";
        root.appendChild(messageEl);
        this._errorMessageEl = messageEl;

        const reassurance = document.createElement("div");
        reassurance.className = "ai-batch-error-reassurance";
        reassurance.textContent = "Your score is unchanged.";
        root.appendChild(reassurance);

        const action = document.createElement("div");
        action.className = "ai-batch-error-action";
        action.textContent = "Ask the AI to fix the error and try again.";
        root.appendChild(action);

        const buttons = document.createElement("div");
        buttons.className = "ai-batch-error-buttons";

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "ai-batch-error-button";
        copyBtn.textContent = "Copy details";
        copyBtn.addEventListener("click", () => {
            void this._copyErrorDetails();
        });
        buttons.appendChild(copyBtn);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "ai-batch-error-button";
        closeBtn.textContent = "Close";
        closeBtn.addEventListener("click", () => {
            // Close from the large error dismisses
            // everything: hide the large dialog and
            // call cancelApply, which from rejected
            // state just clears state to idle and
            // hides the small dialog. The rollback
            // push has already run inside
            // _reportRejectionAndRollback so no
            // further main-side work is needed.
            this._hideLargeError();
            void this._mirrorPush.cancelApply();
        });
        buttons.appendChild(closeBtn);

        root.appendChild(buttons);

        this._largeEl = root;
    }

    /**
     * Render the dialog according to the current
     * mirrorPush state. Idempotent: re-rendering the
     * same state is cheap and produces no visible
     * change. Always hides the large error dialog on
     * state transition so any in-progress error
     * visualisation is cleared when state changes
     * (typically rejected -> idle after Dismiss, but
     * defensive against rejected -> thinking edge
     * cases too).
     *
     * @param {{state: string, heldBatch: any, rejectionInfo: any}} stateSnapshot
     */
    _render(stateSnapshot) {
        this._currentState = /** @type {any} */ (stateSnapshot.state);
        this._currentRejectionInfo = stateSnapshot.rejectionInfo;

        // Phase 1B commit 4b.2: edit blocking plus OS
        // notification. The body class drives the CSS rules
        // in mode-overrides.css; the editor read-only call
        // drives the CodeMirror state-effect. Both follow
        // dialog visibility — on while the dialog is
        // visible (any non-idle state), off when state
        // returns to idle.
        const wasIdle = this._previousState === "idle";
        const isIdle = stateSnapshot.state === "idle";
        document.body.classList.toggle("ai-batch-active", !isIdle);
        if (this._editor !== null) {
            this._editor.setReadOnly(!isIdle);
        }
        // On the idle→non-idle edge (typically thinking),
        // disarm any active toolbar tool so the canvas
        // doesn't carry stale tool state through the
        // locked period. Idempotent inside the non-idle
        // window: re-renders within thinking, ready, or
        // rejected skip the call.
        if (wasIdle && !isIdle && this._toolbar !== null) {
            this._toolbar.disarmAll();
        }
        // OS banner on thinking→ready transition. Fires
        // regardless of window focus per the simpler-
        // version 4b.2 spec.
        if (this._previousState === "thinking" &&
            stateSnapshot.state === "ready") {
            this._fireReadyNotification();
        }
        this._previousState = /** @type {any} */ (stateSnapshot.state);

        // Always hide the large error on state
        // transition; the Details button is the only
        // path that re-shows it, and only in the
        // rejected state.
        this._largeEl.classList.add("hidden");
        this._largeEl.classList.remove("ai-batch-error-dialog-expanding");

        // Clear all per-state classes from the small
        // dialog; the matching class for the new state
        // (if any) is added below. Keeping all three
        // state classes mutually exclusive at this
        // central point lets the CSS rules key off a
        // single state class without juggling.
        this._smallEl.classList.remove(
            "ai-batch-dialog-thinking",
            "ai-batch-dialog-ready",
            "ai-batch-dialog-rejected",
        );

        if (stateSnapshot.state === "idle") {
            this._smallEl.classList.add("hidden");
            return;
        }

        this._smallEl.classList.remove("hidden");

        if (stateSnapshot.state === "thinking") {
            this._smallEl.classList.add("ai-batch-dialog-thinking");
            this._labelEl.classList.add("hidden");
            this._primaryEl.classList.remove("hidden");
            this._primaryEl.textContent = "Thinking\u2026";
            this._primaryEl.disabled = true;
            this._detailsEl.classList.add("hidden");
            this._cancelEl.textContent = "Cancel";
        } else if (stateSnapshot.state === "ready") {
            this._smallEl.classList.add("ai-batch-dialog-ready");
            this._labelEl.classList.add("hidden");
            this._primaryEl.classList.remove("hidden");
            this._primaryEl.textContent = "Accept";
            this._primaryEl.disabled = false;
            this._detailsEl.classList.add("hidden");
            this._cancelEl.textContent = "Cancel";
        } else if (stateSnapshot.state === "rejected") {
            this._smallEl.classList.add("ai-batch-dialog-rejected");
            this._labelEl.classList.remove("hidden");
            this._primaryEl.classList.add("hidden");
            this._detailsEl.classList.remove("hidden");
            this._cancelEl.textContent = "Dismiss";
        }
    }

    /**
     * Show the large error dialog. Hides the small
     * dialog during the visualisation; the user has
     * one surface at a time. Populates the filename
     * and error fields from _currentRejectionInfo and
     * triggers the scale-in animation by toggling the
     * expanding class on the next frame so the CSS
     * transition runs from the initial scale to the
     * final.
     */
    _showLargeError() {
        if (this._currentRejectionInfo === null) return;
        this._smallEl.classList.add("hidden");
        this._errorFileEl.textContent =
            "File: " + this._currentRejectionInfo.filename;
        this._errorMessageEl.textContent = this._currentRejectionInfo.error;
        this._largeEl.classList.remove("hidden");
        // Toggle the expanding class in the next frame
        // so the browser has a paint cycle with the
        // initial transform applied before the
        // transition starts. Without the rAF, the
        // dialog would appear instantly at its final
        // scale.
        requestAnimationFrame(() => {
            this._largeEl.classList.add("ai-batch-error-dialog-expanding");
        });
    }

    /**
     * Hide the large error dialog. Only called from
     * the Close button's handler and from _render on
     * state transition. The small dialog comes back
     * into view via the next _render if the state
     * still warrants it (after Close the cancelApply
     * call transitions to idle, so the small dialog
     * also stays hidden).
     */
    _hideLargeError() {
        this._largeEl.classList.add("hidden");
        this._largeEl.classList.remove("ai-batch-error-dialog-expanding");
    }

    /**
     * Write a plain-text summary of the rejection to
     * the clipboard so the user can paste it into the
     * AI chat for diagnosis. Best-effort: clipboard
     * write can fail under various browser policies
     * (no user gesture, document not focused) and we
     * just log the failure rather than surfacing it
     * to the user.
     */
    async _copyErrorDetails() {
        if (this._currentRejectionInfo === null) return;
        const text =
            "AI edit failed\n" +
            "File: " + this._currentRejectionInfo.filename + "\n" +
            "Error: " + this._currentRejectionInfo.error;
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("GXW: copy error details to clipboard failed:", msg);
        }
    }

    /**
     * Fire an OS-level banner notification announcing
     * that the held batch has transitioned to ready and
     * is awaiting user confirmation (Phase 1B commit
     * 4b.2). Title "GeoSonel", body "AI edits ready to
     * review." — short and self-contained so the
     * notification reads at a glance from another app's
     * notification stack.
     *
     * Always fires regardless of window focus (the
     * simpler-version 4b.2 choice). When GeoSonel has
     * focus the banner duplicates the in-window dialog,
     * a minor cost; when focus is elsewhere the
     * notification is the user's only signal that the
     * AI's edits are ready and the window needs
     * attention.
     *
     * Wrapped in try/catch because the web build's
     * default Notification permission state can throw
     * on construction in some browsers; Electron grants
     * Notification by default so this just works there.
     * On the web build a denied or default permission
     * leaves the user without a banner but the in-window
     * dialog still serves as the primary signal, so we
     * deliberately don't prompt for permission — the
     * notification is a nice-to-have, not a load-bearing
     * surface.
     */
    _fireReadyNotification() {
        try {
            new Notification("GeoSonel", {
                body: "AI edits ready to review.",
            });
        } catch (err) {
            // Permission denied or Notification API
            // unavailable. Silently skip; the in-window
            // dialog still serves as the primary signal.
        }
    }
}
