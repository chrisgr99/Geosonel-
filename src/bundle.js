/**
 * Bundle module.
 *
 * A Bundle is the internal data structure for a score. The
 * user-facing term is "score"; code still says "bundle" because
 * that's what the data structure is (a collection of files).
 *
 * A bundle carries:
 *   - A name (also its IndexedDB key).
 *   - A list of files, each either text (JavaScript sources the
 *     composer edits) or binary (imported images).
 *   - An imageName pointing to which binary file, if any, is the
 *     current background image. Null means no image, which is a
 *     first-class valid state.
 *
 * Persistence flows through src/storage.js. Bundles can round-
 * trip through its ScoreRecord format.
 */

// @ts-check

import {
    saveScoreRecord,
    loadScoreRecord,
    deleteScoreRecord,
    listScores,
} from "./storage.js";

/**
 * @typedef {Object} TextFile
 * @property {"text"} kind
 * @property {string} name
 * @property {string} mimeType
 * @property {string} content
 */

/**
 * @typedef {Object} BinaryFile
 * @property {"binary"} kind
 * @property {string} name
 * @property {string} mimeType
 * @property {ArrayBuffer} content
 */

/** @typedef {TextFile | BinaryFile} BundleFile */

export class Bundle {
    /**
     * @param {string} name
     */
    constructor(name) {
        /** @type {string} */
        this.name = name;

        /** @type {BundleFile[]} */
        this.files = [];

        /**
         * Name of the file currently acting as the background
         * image, or null if the score has no image. Null is a
         * valid end state — not all scores use images.
         * @type {string | null}
         */
        this.imageName = null;
    }

    // --- Text file operations ---

    /**
     * Add a text file to the bundle.
     * @param {string} name
     * @param {string} content
     * @param {string} [mimeType]
     */
    addTextFile(name, content, mimeType = "text/javascript") {
        this.files.push({ kind: "text", name, mimeType, content });
    }

    /**
     * Editor-facing: text files only.
     * @returns {TextFile[]}
     */
    get textFiles() {
        return /** @type {TextFile[]} */ (
            this.files.filter((f) => f.kind === "text")
        );
    }

    /**
     * Look up a text file by name. Returns null if not found or
     * if the file is binary.
     * @param {string} name
     * @returns {TextFile | null}
     */
    getFile(name) {
        const f = this.files.find((f) => f.name === name && f.kind === "text");
        return f === undefined ? null : /** @type {TextFile} */ (f);
    }

    /**
     * Update a text file's content. With auto-persistence there
     * is no dirty flag; the caller is expected to trigger a
     * save separately (typically debounced).
     * @param {string} name
     * @param {string} content
     */
    updateContent(name, content) {
        const file = this.getFile(name);
        if (file === null) return;
        file.content = content;
    }

    // --- Binary file operations (image importer-facing) ---

    /**
     * Add or replace a binary file in the bundle.
     * @param {string} name
     * @param {ArrayBuffer} content
     * @param {string} mimeType
     */
    setBinaryFile(name, content, mimeType) {
        const existingIndex = this.files.findIndex((f) => f.name === name);
        /** @type {BinaryFile} */
        const file = { kind: "binary", name, mimeType, content };
        if (existingIndex >= 0) {
            this.files[existingIndex] = file;
        } else {
            this.files.push(file);
        }
    }

    /**
     * @param {string} name
     * @returns {BinaryFile | null}
     */
    getBinaryFile(name) {
        const f = this.files.find((f) => f.name === name && f.kind === "binary");
        return f === undefined ? null : /** @type {BinaryFile} */ (f);
    }

    /**
     * Remove a file from the bundle. If the removed file was
     * the current image, imageName is cleared.
     * @param {string} name
     */
    removeFile(name) {
        this.files = this.files.filter((f) => f.name !== name);
        if (this.imageName === name) this.imageName = null;
    }

    /**
     * Replace the bundle's current image with fresh bytes.
     * Removes any prior image file, then adds the new one and
     * marks it as current.
     * @param {string} name
     * @param {ArrayBuffer} content
     * @param {string} mimeType
     */
    replaceImage(name, content, mimeType) {
        if (this.imageName !== null && this.imageName !== name) {
            this.removeFile(this.imageName);
        }
        this.setBinaryFile(name, content, mimeType);
        this.imageName = name;
    }

    /**
     * Remove the current image from the bundle.
     */
    removeImage() {
        if (this.imageName !== null) {
            this.removeFile(this.imageName);
        }
    }

    /**
     * @returns {BinaryFile | null}
     */
    getCurrentImage() {
        if (this.imageName === null) return null;
        return this.getBinaryFile(this.imageName);
    }

    // --- Persistence ---

    /**
     * Serialise to a record suitable for IndexedDB storage.
     * @returns {import("./storage.js").ScoreRecord}
     */
    toRecord() {
        /** @type {Object<string, import("./storage.js").BundleFileRecord>} */
        const files = {};
        for (const f of this.files) {
            files[f.name] = { mimeType: f.mimeType, content: f.content };
        }
        return {
            name: this.name,
            files,
            imageName: this.imageName,
            updatedAt: Date.now(),
        };
    }

    /**
     * Rehydrate a Bundle from a stored record.
     * @param {import("./storage.js").ScoreRecord} record
     * @returns {Bundle}
     */
    static fromRecord(record) {
        const bundle = new Bundle(record.name);
        for (const name of Object.keys(record.files)) {
            const entry = record.files[name];
            if (typeof entry.content === "string") {
                bundle.addTextFile(name, entry.content, entry.mimeType);
            } else {
                bundle.setBinaryFile(name, entry.content, entry.mimeType);
            }
        }
        bundle.imageName = record.imageName;
        return bundle;
    }

    /**
     * Save this bundle to IndexedDB under its current name.
     */
    async save() {
        await saveScoreRecord(this.toRecord());
    }
}

/**
 * Produce the contents of a freshly-created score. The score
 * holds two text files: scene.json (declarative data, edited
 * via the Properties tab and a future property panel) and
 * behaviours.js (named function definitions, edited via the
 * Behaviours tab). The scene loader stitches them together
 * at run time. See DESIGN.md v2.1 for the data and behaviour
 * split.
 *
 * @param {string} name
 * @returns {Bundle}
 */
export function makeEmptyBundle(name) {
    const bundle = new Bundle(name);

    bundle.addTextFile(
        "scene.json",
        `{
  "bpm": 120,
  "timeSignature": [4, 4],
  "tonic": "C",
  "scaleName": "C major",

  "curves": [
    {
      "shape": { "type": "circle", "cx": 0, "cy": 0, "r": 6 },
      "cycleBeats": 4,
      "beatsPerCycle": 16,
      "activeBeats": "x...x...x...x...",
      "strength": "9272",
      "cursorR": 2,
      "cursorL": 0,
      "beat": "circleBeat",
      "sweep": "curveSweep"
    }
  ],

  "triggers": [
    { "x":  9, "y":  0, "note": 60, "collision": "triggerHit" },
    { "x": -9, "y":  0, "note": 64, "collision": "triggerHit" },
    { "x":  0, "y":  9, "note": 67, "collision": "triggerHit" },
    { "x":  0, "y": -9, "note": 72, "collision": "triggerHit" }
  ],

  "sprites": [
    { "x": 0, "y": 0, "vx": 1, "vy": 0, "step": "wander" }
  ]
}
`,
        "application/json"
    );

    bundle.addTextFile(
        "behaviours.js",
        `// behaviours.js — object behaviour definitions for this
// score.
//
// This file holds the named functions that scene.json's
// objects refer to by name. Each function slot in scene.json
// (beat, sweep, collision, step, auto) takes the string name
// of one of the functions below. The two files together —
// declarative data plus named behaviours — make up a score.
//
// Function bodies aren't yet invoked — the simulation loop
// arrives in a later milestone. Until then this file just
// needs to parse and execute without errors. The bodies
// reference helpers (scaleMap, etc.) that will be wired up
// when audio output lands; until then, any reference inside
// a function body is harmless because nothing calls these
// functions yet.

// --- Curve behaviours ---
function circleBeat(ctx) {
    const degrees = [0, 2, 4, 5];
    return {
        note: scaleMap(degrees[ctx.beatIndex % 4] / 7,
                       { scale: ctx.scale, root: ctx.root }),
        velocity: ctx.strength * 14,
        duration: 200,
    };
}

function curveSweep(ctx) {
    return {
        note: ctx.trigger.note - Math.floor(ctx.d),
        velocity: Math.max(20, 127 - Math.floor(ctx.d * 8)),
        duration: 400,
    };
}

// --- Trigger behaviours ---
function triggerHit(ctx) {
    return { note: this.note, velocity: 100, duration: 300 };
}

// --- Sprite behaviours ---
function wander(ctx) {
    // No-op for now — the sprite drifts under its initial
    // velocity. Once the simulation loop runs, this is where
    // image-driven behaviour will live.
    return null;
}
`
    );

    return bundle;
}

/**
 * Load a score from IndexedDB by name.
 * @param {string} name
 * @returns {Promise<Bundle | null>}
 */
export async function loadScoreByName(name) {
    const record = await loadScoreRecord(name);
    if (record === null) return null;
    return Bundle.fromRecord(record);
}

/**
 * Create a new empty score under the given name, save it, and
 * return the bundle.
 * @param {string} name
 * @returns {Promise<Bundle>}
 */
export async function createNewScore(name) {
    const bundle = makeEmptyBundle(name);
    await bundle.save();
    return bundle;
}

/**
 * List every score's name and updated timestamp, most recent
 * first. Thin pass-through for callers that don't want to
 * import from storage.js directly.
 * @returns {Promise<Array<{name: string, updatedAt: number}>>}
 */
export async function listAvailableScores() {
    return await listScores();
}

/**
 * Delete a score by name.
 * @param {string} name
 */
export async function deleteScoreByName(name) {
    await deleteScoreRecord(name);
}
