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
import { computeContentHash } from "./imageHash.js";
import { generateThumbnail } from "./thumbnailGen.js";
import { add as galleryAdd } from "./gallery.js";

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

        /**
         * Callback fired after a successful import once the
         * gallery has been populated and the bundle saved.
         * Carries the gallery entry id for the now-current
         * background so main.js can refresh the Canvas
         * inspector's grid and call setActiveGalleryId.
         * Stage 4 of the Canvas inspector work; null while
         * unwired (no listener registered) and after an
         * import where the gallery push failed.
         * @type {((info: {galleryId: string}) => void) | null}
         */
        this._onImportComplete = null;
    }

    /**
     * Register a callback fired after each successful
     * import with the resulting gallery entry id. Only
     * the most recent callback survives — a single wiring
     * point in main.js is the expected usage. Pass null
     * to clear.
     * @param {((info: {galleryId: string}) => void) | null} cb
     */
    setOnImportComplete(cb) {
        this._onImportComplete = cb;
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

    /**
     * Paste an image from the system clipboard: read the
     * clipboard image, then route it through the same
     * normalize / store / gallery pipeline every other import
     * path uses, so it replaces the canvas background and
     * lands as the most recent entry in the Canvas tab's
     * recent-images section. Backs the Edit menu's Paste
     * Image command.
     *
     * Reads through the Electron main-process bridge
     * (window.gxwClipboard) when present, falling back to the
     * web Clipboard API otherwise. When the clipboard holds
     * no image, writes a message to the message area and
     * returns false rather than failing silently — the user
     * gets audible confirmation the command ran. Returns true
     * when an image was found and handed to the import
     * pipeline (which surfaces its own success or error
     * message).
     *
     * @returns {Promise<boolean>}
     */
    async importFromSystemClipboard() {
        const result = await this._readClipboardImage();
        if (result === null) {
            this.messages.write("No image found on the clipboard.");
            return false;
        }
        // Reuse _importFromFile so the accepted-format and
        // size checks, the pasted-name generation, and the
        // full store-and-gallery pipeline all run exactly as
        // they do for a dropped or file-picked image. isPaste
        // forces a generated pasted-YYYYMMDD-HHMMSS name.
        const file = new File([result.bytes], "pasted", { type: result.mimeType });
        await this._importFromFile(file, /* isPaste */ true);
        return true;
    }

    // --- Internals ---

    /**
     * Read an image off the system clipboard, returning
     * { bytes, mimeType } or null when none is present.
     * Prefers the Electron main-process bridge
     * (window.gxwClipboard.readImage), which reads via
     * Electron's clipboard module and returns PNG bytes;
     * falls back to the web async Clipboard API
     * (navigator.clipboard.read) on the browser build. Both
     * failure paths (no bridge and no Clipboard API, a
     * rejected read, or a clipboard with no image item)
     * resolve to null so the caller can report the empty
     * case uniformly.
     * @returns {Promise<{bytes: ArrayBuffer, mimeType: string} | null>}
     */
    async _readClipboardImage() {
        const bridge = /** @type {any} */ (window).gxwClipboard;
        if (bridge !== undefined && bridge !== null &&
            typeof bridge.readImage === "function") {
            try {
                const result = await bridge.readImage();
                if (result !== null && result !== undefined && result.bytes) {
                    return {
                        bytes: result.bytes,
                        mimeType: typeof result.mimeType === "string"
                            ? result.mimeType
                            : "image/png",
                    };
                }
                return null;
            } catch (err) {
                console.error("GXW: clipboard image read (Electron) failed:", err);
                return null;
            }
        }
        // Web build fallback: the async Clipboard API. The
        // menu click is the user gesture the browser requires
        // for clipboard reads; a denied permission or a
        // clipboard with no image item lands in the null
        // return below.
        try {
            const clip = /** @type {any} */ (navigator).clipboard;
            if (clip !== undefined && clip !== null &&
                typeof clip.read === "function") {
                const items = await clip.read();
                for (const item of items) {
                    const imageType = item.types.find(
                        (/** @type {string} */ t) => t.startsWith("image/"),
                    );
                    if (imageType !== undefined) {
                        const blob = await item.getType(imageType);
                        const bytes = await blob.arrayBuffer();
                        return { bytes, mimeType: blob.type || imageType };
                    }
                }
            }
        } catch (err) {
            console.error("GXW: clipboard image read (web) failed:", err);
        }
        return null;
    }

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
     *
     * Stage 4 of the Canvas inspector work added two parallel
     * post-normalize steps: a SHA-256 hash of the normalized
     * bytes (stored on the bundle as imageContentHash and
     * used as the gallery's match-and-promote key) and a
     * 96×96 thumbnail (passed to gallery.add for the new
     * entry's display in the Canvas tab). The two are
     * computed in parallel via Promise.all; both run against
     * the same normalized bytes so neither depends on the
     * other's completion. Failure of either step degrades
     * gracefully — the import still completes, the bundle
     * still gets the image, only the gallery integration is
     * skipped with a console-logged error.
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

        // Parallel hash + thumbnail computation against the
        // normalized bytes. Both are required for the
        // gallery push; if either fails we still complete
        // the import (bundle gets the image, canvas paints)
        // but skip the gallery integration with a logged
        // error. The bundle's imageContentHash stays null
        // in that case and a future open will recompute.
        /** @type {string | null} */
        let contentHash = null;
        /** @type {string} */
        let thumbnailBase64 = "";
        try {
            const [h, t] = await Promise.all([
                computeContentHash(normalized.bytes),
                generateThumbnail(normalized.bytes, normalized.mimeType),
            ]);
            contentHash = h;
            thumbnailBase64 = t;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
                "GXW: failed to compute image hash or thumbnail; gallery push skipped.",
                err,
            );
            this.messages.write(
                `Gallery push skipped: hash or thumbnail compute failed (${msg}).`,
                "error",
            );
        }

        this.bundle.replaceImage(
            normalizedName,
            normalized.bytes,
            normalized.mimeType,
            contentHash,
        );
        await this.canvas.setImage({
            bytes: normalized.bytes,
            mimeType: normalized.mimeType,
        });

        // Populate the gallery. Match-and-promote inside
        // gallery.add handles the case where this image (by
        // content hash) is already a gallery entry — the
        // existing entry is promoted to slot 1 rather than
        // duplicated. galleryId is null when the hash compute
        // failed (above) or the add call itself threw; both
        // suppress the onImportComplete fire below so main.js
        // doesn't try to highlight a nonexistent entry.
        /** @type {string | null} */
        let galleryId = null;
        if (contentHash !== null) {
            try {
                const result = await galleryAdd({
                    sourcePath: normalizedName,
                    normalizedBytes: normalized.bytes,
                    thumbnailBase64,
                    contentHash,
                });
                galleryId = result.id;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                    "GXW: failed to add image to gallery; gallery view will not show this entry.",
                    err,
                );
                this.messages.write(
                    `Gallery add failed: ${msg}`,
                    "error",
                );
            }
        }

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

        // Fire the import-complete callback so main.js can
        // refresh the Canvas inspector's gallery grid and
        // move the green active-frame to the new entry. Only
        // fired when galleryId is known; otherwise main.js
        // would have nothing to highlight.
        if (this._onImportComplete !== null && galleryId !== null) {
            try {
                this._onImportComplete({ galleryId });
            } catch (err) {
                console.error("GXW: import-complete listener threw:", err);
            }
        }
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
