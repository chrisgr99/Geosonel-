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
