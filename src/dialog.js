/**
 * Modal dialog helper.
 *
 * Thin wrapper around the existing modal-overlay / modal-dialog
 * CSS used elsewhere in the app. Callers supply title and body
 * content; the helper handles the overlay backdrop, click-
 * outside dismissal, Escape dismissal, and focus management.
 *
 * Returns an object with a close() method and the body element
 * the caller can populate. The dialog is removed from the DOM
 * on close.
 *
 * Also exposes promptDialog(): a styled in-app replacement for
 * window.prompt(), which fails silently in Electron under
 * sandboxed/context-isolated webPreferences.
 */

// @ts-check

/**
 * @typedef {Object} DialogHandle
 * @property {HTMLElement} body            The .modal-dialog content area to populate.
 * @property {HTMLElement} dialogElement   The .modal-dialog itself, in case the caller needs it.
 * @property {HTMLElement} overlay         The full-screen .modal-overlay element.
 * @property {() => void} close            Dismisses the dialog.
 */

/**
 * @typedef {Object} DialogOptions
 * @property {string} title
 * @property {string} [width]            Optional CSS width (default 480px).
 * @property {() => void} [onClose]       Optional callback fired after the dialog is removed.
 */

/**
 * Open a modal dialog. The returned body element is empty and
 * ready to be populated by the caller; titles and structural
 * chrome are added automatically.
 * @param {DialogOptions} options
 * @returns {DialogHandle}
 */
export function openDialog(options) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog";
    if (options.width !== undefined) {
        dialog.style.minWidth = options.width;
        dialog.style.width = options.width;
    }
    overlay.appendChild(dialog);

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = options.title;
    dialog.appendChild(title);

    // Drag state and handlers. The title bar acts as a drag
    // handle so the user can move the dialog out of the way
    // to see canvas content underneath — particularly useful
    // for the Settings dialog when adjusting controls (such as
    // the brightness-reduction sliders) whose effect needs to
    // be evaluated visually against the canvas. The dialog
    // stays positioned by the overlay's flex centring; drag
    // adds a CSS transform that offsets from centre and
    // accumulates across multiple drags. No persistence:
    // every newly opened dialog starts centred again.
    let dragAccumDx = 0;
    let dragAccumDy = 0;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragging = false;

    /** @param {MouseEvent} e */
    const onTitleMouseDown = (e) => {
        if (e.button !== 0) return;
        dragging = true;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;
        // preventDefault stops text selection inside the title.
        e.preventDefault();
    };

    /** @param {MouseEvent} e */
    const onWindowMouseMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStartClientX;
        const dy = e.clientY - dragStartClientY;
        dialog.style.transform =
            `translate(${dragAccumDx + dx}px, ${dragAccumDy + dy}px)`;
    };

    /** @param {MouseEvent} e */
    const onWindowMouseUp = (e) => {
        if (!dragging) return;
        dragging = false;
        dragAccumDx += e.clientX - dragStartClientX;
        dragAccumDy += e.clientY - dragStartClientY;
    };

    title.addEventListener("mousedown", onTitleMouseDown);
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);

    const body = document.createElement("div");
    body.className = "modal-body";
    dialog.appendChild(body);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKeyDown);
        overlay.removeEventListener("click", onOverlayClick);
        title.removeEventListener("mousedown", onTitleMouseDown);
        window.removeEventListener("mousemove", onWindowMouseMove);
        window.removeEventListener("mouseup", onWindowMouseUp);
        if (overlay.parentNode !== null) {
            overlay.parentNode.removeChild(overlay);
        }
        if (options.onClose !== undefined) options.onClose();
    };

    /**
     * @param {KeyboardEvent} e
     */
    const onKeyDown = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };

    /**
     * @param {MouseEvent} e
     */
    const onOverlayClick = (e) => {
        // Click on the dimmed backdrop dismisses; click inside
        // the dialog itself does not.
        if (e.target === overlay) close();
    };

    document.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("click", onOverlayClick);

    document.body.appendChild(overlay);

    return { body, dialogElement: dialog, overlay, close };
}

/**
 * @typedef {Object} PromptDialogOptions
 * @property {string} title                Dialog title (the question being asked).
 * @property {string} [defaultValue]       Initial value, pre-selected so the user can type to replace.
 * @property {string} [description]        Optional descriptive text shown above the input.
 * @property {string} [okLabel]            Defaults to "OK".
 * @property {string} [cancelLabel]        Defaults to "Cancel".
 * @property {string} [errorMessage]       Optional inline error text shown above the input (in red).
 *                                          Used by callers that loop on validation failure.
 */

/**
 * Styled in-app replacement for window.prompt(). Resolves to
 * the entered string (with whitespace untouched) or null if the
 * user cancelled. Enter submits, Escape cancels.
 *
 * window.prompt() returns null synchronously in Electron under
 * the sandboxed/context-isolated webPreferences we use, which
 * makes any code path that depends on it (New Score, Rename
 * Score, etc.) silently fail. Use this instead.
 *
 * @param {PromptDialogOptions} options
 * @returns {Promise<string | null>}
 */
export function promptDialog(options) {
    return new Promise((resolve) => {
        let resolved = false;
        const settle = (/** @type {string | null} */ value) => {
            if (resolved) return;
            resolved = true;
            handle.close();
            resolve(value);
        };

        const handle = openDialog({
            title: options.title,
            onClose: () => {
                // The user clicked outside or pressed Escape;
                // openDialog already removed the DOM. Treat as
                // cancel if we haven't resolved yet.
                if (!resolved) {
                    resolved = true;
                    resolve(null);
                }
            },
        });

        const { body } = handle;

        if (options.description !== undefined) {
            const desc = document.createElement("div");
            desc.className = "modal-description";
            desc.textContent = options.description;
            body.appendChild(desc);
        }

        if (options.errorMessage !== undefined && options.errorMessage !== "") {
            const err = document.createElement("div");
            err.className = "modal-error";
            err.textContent = options.errorMessage;
            body.appendChild(err);
        }

        const input = document.createElement("input");
        input.type = "text";
        input.className = "modal-input";
        input.value = options.defaultValue ?? "";
        body.appendChild(input);

        const buttons = document.createElement("div");
        buttons.className = "modal-buttons";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "modal-button";
        cancelBtn.textContent = options.cancelLabel ?? "Cancel";
        cancelBtn.addEventListener("click", () => settle(null));
        buttons.appendChild(cancelBtn);

        const okBtn = document.createElement("button");
        okBtn.className = "modal-button modal-button-primary";
        okBtn.textContent = options.okLabel ?? "OK";
        okBtn.addEventListener("click", () => settle(input.value));
        buttons.appendChild(okBtn);

        body.appendChild(buttons);

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                settle(input.value);
            }
        });

        // Focus the input and select existing text so the user
        // can immediately type to replace it. Done in a
        // microtask so the focus lands after the dialog is
        // fully attached.
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    });
}

/**
 * @typedef {"save" | "discard" | "cancel"} CloseDialogDecision
 */

/**
 * @typedef {Object} ConfirmDiscardOptions
 * @property {string} scoreName            Name of the score with unsaved changes (used in the dialog title).
 * @property {string} [description]        Optional override for the body text.
 * @property {string} [saveLabel]          Defaults to "Save".
 * @property {string} [discardLabel]       Defaults to "Don't Save".
 * @property {string} [cancelLabel]        Defaults to "Cancel".
 */

/**
 * The macOS-style three-button "You have unsaved changes"
 * prompt: Save (default), Don't Save, Cancel. Resolves to
 * one of three strings naming the user's decision; caller
 * decides what to do with it.
 *
 * Save is the primary action and is bound to Return. Cancel
 * is bound to Escape and to clicks on the dimmed backdrop
 * (consistent with every other modal in the app). Don't
 * Save has no key binding by design — the destructive
 * action requires an explicit click so it is never reached
 * by accident.
 *
 * Used by:
 *   - The Electron window-close interceptor when a close
 *     gesture (red dot, Cmd-W, Cmd-Q) is initiated while
 *     the bundle is dirty.
 *   - In-app gestures that switch away from the current
 *     score (New Score, Open Score, Duplicate Score,
 *     Delete Score, Import Score, Reload Score from Disk).
 *
 * The web version's tab close, page reload, and browser
 * navigation paths use the browser's generic beforeunload
 * prompt instead; that path is out of the application's
 * control and cannot use this dialog.
 *
 * @param {ConfirmDiscardOptions} options
 * @returns {Promise<CloseDialogDecision>}
 */
export function confirmDiscardDialog(options) {
    return new Promise((resolve) => {
        let resolved = false;
        /** @param {CloseDialogDecision} decision */
        const settle = (decision) => {
            if (resolved) return;
            resolved = true;
            handle.close();
            resolve(decision);
        };

        const handle = openDialog({
            title: `Save changes to “${options.scoreName}”?`,
            onClose: () => {
                // Backdrop click or Escape: treat as cancel.
                if (!resolved) {
                    resolved = true;
                    resolve("cancel");
                }
            },
        });

        const { body } = handle;

        const desc = document.createElement("div");
        desc.className = "modal-description";
        desc.textContent = options.description ??
            "If you don’t save, your changes will be lost.";
        body.appendChild(desc);

        const buttons = document.createElement("div");
        buttons.className = "modal-buttons";

        // Cancel sits on the left; Don't Save in the middle; Save on the
        // right as the primary action. This is the macOS HIG ordering for
        // a destructive-prompt three-button dialog (where the safe answer
        // is rightmost and the destructive action is set off in the
        // middle position so it isn't pressed by accidental Return).
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "modal-button";
        cancelBtn.textContent = options.cancelLabel ?? "Cancel";
        cancelBtn.addEventListener("click", () => settle("cancel"));
        buttons.appendChild(cancelBtn);

        const discardBtn = document.createElement("button");
        discardBtn.className = "modal-button";
        discardBtn.textContent = options.discardLabel ?? "Don’t Save";
        discardBtn.addEventListener("click", () => settle("discard"));
        buttons.appendChild(discardBtn);

        const saveBtn = document.createElement("button");
        saveBtn.className = "modal-button modal-button-primary";
        saveBtn.textContent = options.saveLabel ?? "Save";
        saveBtn.addEventListener("click", () => settle("save"));
        buttons.appendChild(saveBtn);

        body.appendChild(buttons);

        // Return triggers the primary action (Save). Escape is already
        // handled by openDialog's keydown listener via the onClose path,
        // so a separate Escape binding here would double-fire.
        const onBodyKeyDown = (/** @type {KeyboardEvent} */ e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                settle("save");
            }
        };
        document.addEventListener("keydown", onBodyKeyDown);
        const origClose = handle.close;
        handle.close = () => {
            document.removeEventListener("keydown", onBodyKeyDown);
            origClose();
        };

        // Focus the Save button so Return commits the primary action
        // immediately. A microtask defers focus until the dialog is in
        // the DOM.
        setTimeout(() => saveBtn.focus(), 0);
    });
}

/**
 * @typedef {Object} ConfirmDialogOptions
 * @property {string} title                Dialog title (the question being asked).
 * @property {string} [description]        Optional descriptive text below the title.
 * @property {string} [confirmLabel]       Primary button label. Defaults to "OK".
 * @property {string} [cancelLabel]        Secondary button label. Defaults to "Cancel".
 */

/**
 * Two-button Mac-standard confirmation dialog. Cancel on the
 * left (secondary, Escape-bound, backdrop-click-bound),
 * confirm on the right (primary, Return-bound). Resolves to
 * true on confirm, false on cancel.
 *
 * Used by Save As's collision confirm (“A score named X
 * already exists. Replace it?”) and Revert to Saved (“Revert
 * to the last saved version of X?”). Return is bound to the
 * destructive action because the user explicitly came to the
 * dialog to do that action; the three-button
 * confirmDiscardDialog pattern (Don’t Save in the middle) is
 * reserved for the case where the destructive answer is one
 * of three plausible choices, not the already-implied one.
 *
 * @param {ConfirmDialogOptions} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options) {
    return new Promise((resolve) => {
        let resolved = false;
        /** @param {boolean} value */
        const settle = (value) => {
            if (resolved) return;
            resolved = true;
            handle.close();
            resolve(value);
        };

        const handle = openDialog({
            title: options.title,
            onClose: () => {
                // Backdrop click or Escape: treat as cancel.
                if (!resolved) {
                    resolved = true;
                    resolve(false);
                }
            },
        });

        const { body } = handle;

        if (options.description !== undefined) {
            const desc = document.createElement("div");
            desc.className = "modal-description";
            desc.textContent = options.description;
            body.appendChild(desc);
        }

        const buttons = document.createElement("div");
        buttons.className = "modal-buttons";

        // Cancel on the left, confirm on the right as the primary action.
        // Standard macOS HIG ordering for a two-button dialog.
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "modal-button";
        cancelBtn.textContent = options.cancelLabel ?? "Cancel";
        cancelBtn.addEventListener("click", () => settle(false));
        buttons.appendChild(cancelBtn);

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "modal-button modal-button-primary";
        confirmBtn.textContent = options.confirmLabel ?? "OK";
        confirmBtn.addEventListener("click", () => settle(true));
        buttons.appendChild(confirmBtn);

        body.appendChild(buttons);

        // Return triggers the primary action (confirm). Escape is
        // already handled by openDialog's keydown listener via the
        // onClose path, so a separate Escape binding here would
        // double-fire.
        const onBodyKeyDown = (/** @type {KeyboardEvent} */ e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                settle(true);
            }
        };
        document.addEventListener("keydown", onBodyKeyDown);
        const origClose = handle.close;
        handle.close = () => {
            document.removeEventListener("keydown", onBodyKeyDown);
            origClose();
        };

        // Focus the confirm button so Return commits the primary action
        // immediately. A microtask defers focus until the dialog is in
        // the DOM.
        setTimeout(() => confirmBtn.focus(), 0);
    });
}
