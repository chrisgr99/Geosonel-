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

    const body = document.createElement("div");
    body.className = "modal-body";
    dialog.appendChild(body);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKeyDown);
        overlay.removeEventListener("click", onOverlayClick);
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
