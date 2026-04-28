/**
 * Image importer.
 *
 * A single import pipeline fed by four paths:
 *   1. File menu picker (Import Image).
 *   2. File menu URL prompt (Import Image from URL).
 *   3. Drag-and-drop onto the canvas or app window.
 *   4. Paste (Cmd-V) anywhere in the app except text-editing
 *      widgets.
 *
 * Each path produces an {ArrayBuffer, mimeType, suggestedName}
 * triple that is handed to importImage(). That function
 * validates the format, stores it in the bundle, triggers a
 * canvas redraw, persists to IndexedDB, and logs a message.
 *
 * Accepted formats: PNG, JPEG, WEBP. Other formats are rejected
 * with a message.
 *
 * Maximum file size: 20MB. Files above this are rejected. Can
 * be raised later if needed.
 */

// @ts-check

/** @typedef {import("./bundle.js").Bundle} Bundle */
/** @typedef {import("./canvas.js").Canvas} Canvas */
/** @typedef {import("./messages.js").MessageArea} MessageArea */

const ACCEPTED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
]);

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * @typedef {Object} ImageImporterContext
 * @property {Bundle} bundle
 * @property {Canvas} canvas
 * @property {MessageArea} messages
 */

export class ImageImporter {
    /**
     * @param {ImageImporterContext} ctx
     */
    constructor(ctx) {
        this.bundle = ctx.bundle;
        this.canvas = ctx.canvas;
        this.messages = ctx.messages;
    }

    /**
     * Point the importer at a different bundle. Called by the
     * score session after New / Open / Save As / Rename /
     * Delete.
     * @param {Bundle} bundle
     */
    setBundle(bundle) {
        this.bundle = bundle;
    }

    // --- Public entry points for each import path ---

    /**
     * Trigger a hidden file input to open a native picker.
     * The accept attribute combines extensions and MIME types
     * to give the strongest possible hint to the OS picker.
     * On macOS the picker is fundamentally a hint rather than
     * a strict allow-list — the OS is free to retain previous
     * user filter choices and to show files it thinks the
     * user might want (PDFs sometimes show up because Preview
     * advertises image-handling capabilities). There is no
     * web API that forces the picker to physically hide non-
     * matching files; runtime MIME-type validation in
     * _importFromFile is what actually enforces the rule.
     */
    importViaFilePicker() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (file) await this._importFromFile(file);
        });
        input.click();
    }

    /**
     * Prompt the user for a URL and fetch its bytes into the
     * bundle.
     */
    async importFromUrlPrompt() {
        const url = window.prompt("Image URL:");
        if (url === null || url.trim() === "") return;
        await this._importFromUrl(url.trim());
    }

    /**
     * Install global drop and paste listeners so the user can
     * drag an image onto the app window or paste one from the
     * clipboard.
     */
    installGlobalListeners() {
        // Drag-and-drop. Listen on the whole body so the drop
        // target isn't confined to the canvas.
        document.body.addEventListener("dragover", (e) => {
            if (this._eventHasImage(e)) {
                e.preventDefault();
            }
        });

        document.body.addEventListener("drop", async (e) => {
            if (!this._eventHasImage(e)) return;
            e.preventDefault();
            const file = e.dataTransfer?.files?.[0];
            if (file) await this._importFromFile(file);
        });

        // Paste. Only handle the paste when focus isn't in a
        // text-editing widget — otherwise the widget should get
        // the paste normally.
        document.addEventListener("paste", async (e) => {
            if (isTypingTarget(/** @type {EventTarget | null} */ (document.activeElement))) {
                return;
            }
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.kind === "file" && item.type.startsWith("image/")) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) await this._importFromFile(file, /* isPaste */ true);
                    return;
                }
            }
        });
    }

    /**
     * Remove the current image from the bundle, if any, and
     * redraw.
     */
    async removeCurrentImage() {
        if (this.bundle.imageName === null) {
            this.messages.write("No image to remove.");
            return;
        }
        const removedName = this.bundle.imageName;
        this.bundle.removeImage();
        this.canvas.setImage(null);
        try {
            await this.bundle.save();
        } catch (err) {
            console.error("GXW: failed to persist bundle after image removal:", err);
        }
        this.messages.write(`Removed image "${removedName}".`);
    }

    // --- Internals ---

    /**
     * @param {DragEvent} e
     * @returns {boolean}
     */
    _eventHasImage(e) {
        const items = e.dataTransfer?.items;
        if (!items) return false;
        for (const item of items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {File} file
     * @param {boolean} [isPaste]
     */
    async _importFromFile(file, isPaste = false) {
        if (!ACCEPTED_MIME_TYPES.has(file.type)) {
            this.messages.write(
                `Ignoring "${file.name || "(pasted image)"}": format ${file.type || "unknown"} not supported. Use PNG, JPEG, or WEBP.`,
                "error"
            );
            return;
        }
        if (file.size > MAX_BYTES) {
            this.messages.write(
                `Ignoring "${file.name}": ${Math.round(file.size / 1024 / 1024)}MB exceeds the 20MB limit.`,
                "error"
            );
            return;
        }
        const bytes = await file.arrayBuffer();
        const name = isPaste || !file.name
            ? generatePastedName(file.type)
            : file.name;
        await this._storeAndRender(name, bytes, file.type);
    }

    /**
     * @param {string} url
     */
    async _importFromUrl(url) {
        let response;
        try {
            response = await fetch(url);
        } catch (err) {
            this.messages.write(
                `Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
                "error"
            );
            return;
        }
        if (!response.ok) {
            this.messages.write(
                `Fetch failed: ${response.status} ${response.statusText}`,
                "error"
            );
            return;
        }
        const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
            this.messages.write(
                `URL served unsupported type "${mimeType}". Use PNG, JPEG, or WEBP.`,
                "error"
            );
            return;
        }
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > MAX_BYTES) {
            this.messages.write(
                `Ignoring fetched image: ${Math.round(bytes.byteLength / 1024 / 1024)}MB exceeds the 20MB limit.`,
                "error"
            );
            return;
        }
        const name = deriveNameFromUrl(url, mimeType);
        await this._storeAndRender(name, bytes, mimeType);
    }

    /**
     * Common final step: put the bytes into the bundle, tell the
     * canvas to render them, persist to IndexedDB, and log.
     * @param {string} name
     * @param {ArrayBuffer} bytes
     * @param {string} mimeType
     */
    async _storeAndRender(name, bytes, mimeType) {
        this.bundle.replaceImage(name, bytes, mimeType);
        await this.canvas.setImage({ bytes, mimeType });
        try {
            await this.bundle.save();
        } catch (err) {
            console.error("GXW: failed to persist bundle after image import:", err);
            this.messages.write(
                "Image imported but could not be saved to browser storage.",
                "error"
            );
            return;
        }
        this.messages.write(`Imported image "${name}".`);
    }
}

/**
 * Generate a filename for a pasted (or nameless) image.
 * @param {string} mimeType
 * @returns {string}
 */
function generatePastedName(mimeType) {
    const ext = extensionFromMimeType(mimeType);
    const now = new Date();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
    const stamp =
        now.getFullYear() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        "-" +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds());
    return `pasted-${stamp}.${ext}`;
}

/**
 * Try to extract a usable filename from a URL's path; fall back
 * to a timestamp if the URL has no obvious filename.
 * @param {string} url
 * @param {string} mimeType
 * @returns {string}
 */
function deriveNameFromUrl(url, mimeType) {
    try {
        const parsed = new URL(url);
        const last = parsed.pathname.split("/").pop() ?? "";
        if (last && /\.[a-z0-9]{2,5}$/i.test(last)) {
            return last;
        }
    } catch {
        // Malformed URL: fall through to timestamp-based name.
    }
    return generatePastedName(mimeType);
}

/**
 * @param {string} mimeType
 * @returns {string}
 */
function extensionFromMimeType(mimeType) {
    switch (mimeType) {
        case "image/png": return "png";
        case "image/jpeg": return "jpg";
        case "image/webp": return "webp";
        default: return "bin";
    }
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if (target.closest(".cm-editor") !== null) return true;
    return false;
}
