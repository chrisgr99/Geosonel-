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

import { showContextMenu } from "./contextMenu.js";

/** @typedef {"info" | "error"} MessageLevel */

export class MessageArea {
    /**
     * @param {HTMLElement} rootElement
     */
    constructor(rootElement) {
        this.root = rootElement;
        this._hasMessages = false;
        this._installContextMenu();
    }

    /**
     * Append a message to the log. Error-level messages get a
     * "! " prefix so they can be recognised even when displayed
     * in the same colour as info-level messages — brightness-
     * only readers rely on the prefix character rather than hue.
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
        entry.textContent = level === "error" ? `! ${text}` : text;
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

    /**
     * Text currently selected within the message area, or "" if
     * the selection is empty or lies outside the area.
     * @returns {string}
     */
    _selectionText() {
        const sel = window.getSelection();
        if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return "";
        const range = sel.getRangeAt(0);
        if (!this.root.contains(range.commonAncestorContainer)) return "";
        return sel.toString();
    }

    /**
     * All message text, newline-separated. "" when the log holds
     * only the placeholder.
     * @returns {string}
     */
    _allText() {
        if (!this._hasMessages) return "";
        return Array.from(this.root.querySelectorAll(".message-entry"))
            .map((el) => el.textContent ?? "")
            .join("\n");
    }

    /**
     * Copy the message-area text selection to the clipboard if
     * there is one. Returns true when it handled the copy — the
     * Edit > Copy / Cmd-C chain calls this so selected log text
     * copies before falling back to the canvas-object copy. Uses
     * execCommand so it runs synchronously inside the menu's
     * user-gesture context (matching the editor's copy path).
     * @returns {boolean}
     */
    tryCopySelection() {
        if (this._selectionText() === "") return false;
        try {
            return document.execCommand("copy");
        } catch (_e) {
            return false;
        }
    }

    /**
     * Right-click context menu: Copy (the selection), Copy All
     * (the whole log), and Clear. Selection/all text is captured
     * at menu-open time so a click that clears the page selection
     * doesn't lose what the user meant to copy.
     */
    _installContextMenu() {
        this.root.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const selText = this._selectionText();
            const allText = this._allText();
            showContextMenu([
                {
                    label: "Copy",
                    disabled: selText === "",
                    action: () => { void navigator.clipboard.writeText(selText); },
                },
                {
                    label: "Copy All",
                    disabled: allText === "",
                    action: () => { void navigator.clipboard.writeText(allText); },
                },
                {
                    label: "Clear",
                    action: () => { this.clear(); },
                },
            ], e.clientX, e.clientY);
        });
    }
}
