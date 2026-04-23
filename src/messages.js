/**
 * Message area.
 *
 * The bottom strip of the canvas pane. Displays a rolling log
 * of informational and error messages from the app: image
 * import results, sketch execution errors once the runner
 * exists, and any other transient user-visible feedback.
 *
 * Messages are written via write(text, level). level is either
 * "info" (default) or "error". Errors are tinted to stand out.
 *
 * New messages appear at the bottom; the area scrolls to the
 * latest entry on every write. The "(No messages)" placeholder
 * is shown while the log is empty and removed on the first
 * real message.
 */

// @ts-check

/** @typedef {"info" | "error"} MessageLevel */

export class MessageArea {
    /**
     * @param {HTMLElement} rootElement
     */
    constructor(rootElement) {
        this.root = rootElement;
        this._hasMessages = false;
    }

    /**
     * Append a message to the log.
     * @param {string} text
     * @param {MessageLevel} [level]
     */
    write(text, level = "info") {
        if (!this._hasMessages) {
            this.root.innerHTML = "";
            this._hasMessages = true;
        }
        const entry = document.createElement("div");
        entry.className = level === "error"
            ? "message-entry message-error"
            : "message-entry";
        entry.textContent = text;
        this.root.appendChild(entry);
        // Scroll to the latest entry.
        this.root.scrollTop = this.root.scrollHeight;
    }

    /**
     * Reset the log to empty (with the placeholder). Useful
     * during development or if we ever want a Clear Messages
     * action.
     */
    clear() {
        this.root.innerHTML = "";
        const placeholder = document.createElement("div");
        placeholder.className = "message-placeholder";
        placeholder.textContent = "(No messages)";
        this.root.appendChild(placeholder);
        this._hasMessages = false;
    }
}
