/**
 * In-memory bundle module.
 *
 * At this milestone a Bundle is just a map from filename to the
 * file's text content, plus an ordering to drive the tab display.
 * There is no disk persistence and no git yet — the bundle lives
 * entirely in memory and vanishes on page reload. That is
 * deliberate: it keeps Milestone 2 focused on the editor mechanics
 * (tabs, dirty state, content switching) without pulling in the
 * storage layer. IndexedDB persistence arrives in a later
 * milestone, and git versioning after that.
 *
 * A bundle file carries three pieces of state: its name (which
 * doubles as the tab label), the text content, and a dirty flag
 * indicating unsaved changes since the last save. "Save" in this
 * milestone just clears the dirty flag — there is no target to
 * save to yet.
 */

// @ts-check

/**
 * @typedef {Object} BundleFile
 * @property {string} name       Filename, used as tab label.
 * @property {string} content    File text content.
 * @property {boolean} dirty     Has content been modified since last save?
 */

export class Bundle {
    constructor() {
        /** @type {BundleFile[]} */
        this.files = [];
    }

    /**
     * Add a file to the bundle.
     * @param {string} name
     * @param {string} content
     */
    addFile(name, content) {
        this.files.push({ name, content, dirty: false });
    }

    /**
     * Look up a file by name. Returns null if not found.
     * @param {string} name
     * @returns {BundleFile | null}
     */
    getFile(name) {
        return this.files.find((f) => f.name === name) ?? null;
    }

    /**
     * Update a file's content and mark it dirty.
     * @param {string} name
     * @param {string} content
     */
    updateContent(name, content) {
        const file = this.getFile(name);
        if (file === null) return;
        if (file.content === content) return;
        file.content = content;
        file.dirty = true;
    }

    /**
     * Mark a file clean (called after a successful save).
     * @param {string} name
     */
    markClean(name) {
        const file = this.getFile(name);
        if (file !== null) file.dirty = false;
    }
}

/**
 * Build a default bundle with a bare-default sketch and one helper
 * module. Used until we have real bundle loading. The content is
 * throwaway placeholder text that demonstrates the editor; it does
 * not yet correspond to a runnable sketch.
 * @returns {Bundle}
 */
export function makeDefaultBundle() {
    const bundle = new Bundle();

    bundle.addFile(
        "sketch.js",
        `// sketch.js — your GXW score definition.
//
// This is a placeholder. The actual sketch API will be wired up in
// a later milestone. For now this file demonstrates that the
// editor, tabs, and dirty-state tracking all work.

function setup() {
    bpm(120);
    timeSignature(4, 4);
    scale("D minor");
}

const scene = new Scene();
scene.addEvent(45, 60, { note: "C4" });
scene.addEvent(55, 65, { note: "E4" });
`
    );

    bundle.addFile(
        "helpers.js",
        `// helpers.js — a place to define reusable message and
// distortion functions shared across sketches.

export function blueNote(ctx) {
    const note = scaleMap(ctx.r, { scale: ctx.scale, root: ctx.root });
    const velocity = rangeMap(ctx.lum, 20, 127);
    return { note, velocity, duration: 400 };
}
`
    );

    return bundle;
}
