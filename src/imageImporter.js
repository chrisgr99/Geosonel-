/**
 * Image importer.
 *
 * A single import pipeline fed by three paths:
 *   1. File picker invoked from UI surfaces (the canvas
 *      toolbar's Image button in Stage 1; the Canvas
 *      inspector tab's Load Image button in Stage 4).
 *   2. Drag-and-drop onto the canvas or app window.
 *   3. Paste (Cmd-V) anywhere in the app except text-editing
 *      widgets.
 *
 * Each path produces an {ArrayBuffer, mimeType, suggestedName}
 * triple that is handed to importImage(). That function
 * validates the format, normalizes the image to the canonical
 * 1000×1000 JPEG@70 form via imageNormalize (uniform
 * geometry for pattern signals; see imageNormalize.js for
 * the rationale), stores the normalized bytes in the bundle,
 * triggers a canvas redraw, persists to storage, and logs a
 * message.
 *
 * Accepted input formats: PNG, JPEG, WEBP. Other formats
 * are rejected with a message. All stored content emerges
 * as image/jpeg with a .jpg extension regardless of source.
 *
 * Maximum file size: 20MB on input. Files above this are
 * rejected before normalization runs.
 */

// @ts-check

import { normalizeForCanvas } from "./imageNormalize.js";

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
     * Common final step: normalize the bytes to the
     * canonical 1000×1000 JPEG@70 form, put the normalized
     * bytes into the bundle, tell the canvas to render them,
     * persist to storage, and log. The pre-normalize bytes
     * never reach the bundle — every score's embedded image
     * is the post-normalization version so pattern signals
     * see uniform geometry regardless of how the image
     * arrived.
     * @param {string} name
     * @param {ArrayBuffer} bytes
     * @param {string} mimeType
     */
    async _storeAndRender(name, bytes, mimeType) {
        let normalized;
        try {
            normalized = await normalizeForCanvas(bytes, mimeType);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.messages.write(
                `Could not normalize image "${name}": ${msg}`,
                "error",
            );
            return;
        }
        // Every stored image lands as JPEG; rewrite the
        // extension so the bundle's filename matches the
        // bytes inside it. A screenshot.png that's actually
        // JPEG bytes after normalization would be a
        // misleading filename downstream (export, disk
        // mirror, AI-edit tooling all read the extension).
        const normalizedName = forceJpgExtension(name);
        this.bundle.replaceImage(normalizedName, normalized.bytes, normalized.mimeType);
        await this.canvas.setImage({ bytes: normalized.bytes, mimeType: normalized.mimeType });
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
        this.messages.write(`Imported image "${normalizedName}".`);
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
 * Rewrite a filename's extension to .jpg. The normalize
 * step in _storeAndRender produces JPEG bytes unconditionally,
 * so the stored filename should match. Names without any
 * extension get one appended.
 * @param {string} name
 * @returns {string}
 */
function forceJpgExtension(name) {
    const dot = name.lastIndexOf(".");
    if (dot === -1) return name + ".jpg";
    return name.slice(0, dot) + ".jpg";
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
