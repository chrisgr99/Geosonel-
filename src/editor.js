/**
 * Tabbed editor module.
 *
 * Manages the tab bar and the single CodeMirror editor instance
 * below it. Only one editor exists — switching tabs swaps the
 * editor's document rather than creating multiple editor views.
 * That's lighter than one-editor-per-tab and matches how the
 * desktop version conceptually works (one active tab shown at a
 * time).
 *
 * Dirty-state tracking is bundle-driven. When the editor content
 * changes, we push the new content into the bundle which marks
 * the file dirty. The tab label is redrawn from the bundle's
 * dirty flag.
 *
 * CodeMirror 6 is loaded from esm.sh on demand. The import is
 * inside this module (not index.html) so any future change to the
 * editor backend — a different library, a bundled local copy —
 * only touches this file.
 */

// @ts-check

// CodeMirror 6 imports. Each @codemirror/* package carries its
// own dependency on @codemirror/state, and without deduplication
// esm.sh serves multiple copies — breaking CodeMirror's internal
// instanceof checks. The ?deps= query parameter pins each package
// to the same shared state version, collapsing the module graph
// to a single instance.
//
// Import statements require static string literals, so the pinned
// version is repeated on every line rather than extracted to a
// constant. If the version needs bumping, update all lines.
import { EditorView, keymap, lineNumbers } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { EditorState } from "https://esm.sh/@codemirror/state@6.5.2";
import { defaultKeymap, history, historyKeymap } from "https://esm.sh/@codemirror/commands@6?deps=@codemirror/state@6.5.2";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6?deps=@codemirror/state@6.5.2";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6?deps=@codemirror/state@6.5.2";

/** @typedef {import("./bundle.js").Bundle} Bundle */
/** @typedef {import("./bundle.js").BundleFile} BundleFile */

export class TabbedEditor {
    /**
     * @param {HTMLElement} tabBarElement   The .tab-bar element.
     * @param {HTMLElement} editorAreaElement  The #editor-area element.
     * @param {Bundle} bundle
     */
    constructor(tabBarElement, editorAreaElement, bundle) {
        this.tabBar = tabBarElement;
        this.editorArea = editorAreaElement;
        this.bundle = bundle;

        /** @type {string | null} Name of the currently active file. */
        this.activeName = null;

        /** @type {EditorView | null} */
        this.view = null;

        /** Suppress dirty-marking during programmatic document
         * replacement (tab switching, bundle reload). */
        this._suppressDirty = false;

        this._mountEditor();
        this._renderTabs();

        if (this.bundle.files.length > 0) {
            this.selectTab(this.bundle.files[0].name);
        }
    }

    /**
     * Create the CodeMirror EditorView once. Content is set via
     * setState() when a tab is selected.
     */
    _mountEditor() {
        // Clear the placeholder content if present.
        this.editorArea.innerHTML = "";

        const state = EditorState.create({
            doc: "",
            extensions: [
                lineNumbers(),
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap]),
                javascript(),
                oneDark,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        this._onDocChanged(update.state.doc.toString());
                    }
                }),
                EditorView.theme({
                    "&": {
                        height: "100%",
                        fontSize: "15pt",
                    },
                    ".cm-scroller": {
                        fontFamily: "SF Mono, Menlo, Consolas, monospace",
                    },
                }),
            ],
        });

        this.view = new EditorView({
            state,
            parent: this.editorArea,
        });
    }

    /**
     * Swap the editor's content to that of the named file and
     * remember which file is now active. Uses a dispatch to
     * replace the document contents in place rather than creating
     * a new EditorState, which is the idiomatic CodeMirror 6
     * approach and preserves the editor's configured extensions
     * without re-specifying them.
     * @param {string} name
     */
    selectTab(name) {
        const file = this.bundle.getFile(name);
        if (file === null || this.view === null) return;

        this.activeName = name;

        // Replace the document contents. We set a flag before
        // dispatching so the updateListener can tell this is a
        // programmatic tab switch rather than user typing, and
        // skip marking the file dirty.
        this._suppressDirty = true;
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: file.content,
            },
        });
        this._suppressDirty = false;

        this._renderTabs();
    }

    /**
     * Push the editor's current text back into the active bundle
     * file and refresh the tab label so the dirty marker appears
     * if the content has changed. Skipped during tab switches,
     * which replace the document programmatically and should not
     * produce a dirty state.
     * @param {string} content
     */
    _onDocChanged(content) {
        if (this.activeName === null) return;
        if (this._suppressDirty) return;
        const file = this.bundle.getFile(this.activeName);
        if (file === null) return;
        const wasDirty = file.dirty;
        this.bundle.updateContent(this.activeName, content);
        if (file.dirty !== wasDirty) {
            this._renderTabs();
        }
    }

    /**
     * Save the active tab. At this milestone there is no disk
     * target, so "save" means clearing the dirty flag. In a later
     * milestone this will write the bundle to IndexedDB and
     * commit to git.
     */
    saveCurrent() {
        if (this.activeName === null) return;
        this.bundle.markClean(this.activeName);
        this._renderTabs();
    }

    /**
     * Save every dirty file in the bundle.
     */
    saveAll() {
        for (const file of this.bundle.files) {
            if (file.dirty) this.bundle.markClean(file.name);
        }
        this._renderTabs();
    }

    /**
     * Returns true if any file in the bundle has unsaved changes.
     * @returns {boolean}
     */
    hasUnsavedChanges() {
        return this.bundle.files.some((f) => f.dirty);
    }

    /**
     * Rebuild the tab bar DOM from the bundle's current file list
     * and active name. Simplest to redraw than to do surgical
     * updates, and the tab count is small.
     */
    _renderTabs() {
        // Clear existing tabs but preserve the filler element.
        this.tabBar.innerHTML = "";

        for (const file of this.bundle.files) {
            const el = document.createElement("div");
            el.className = "tab";
            if (file.name === this.activeName) {
                el.classList.add("tab-selected");
                el.setAttribute("aria-selected", "true");
            } else {
                el.setAttribute("aria-selected", "false");
            }
            el.setAttribute("role", "tab");
            el.setAttribute("tabindex", "0");

            const prefix = file.dirty ? "● " : "";
            el.textContent = `${prefix}${file.name}`;

            el.addEventListener("click", () => this.selectTab(file.name));
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.selectTab(file.name);
                }
            });

            this.tabBar.appendChild(el);
        }

        // Re-append the filler so it sits to the right of the tabs.
        const filler = document.createElement("div");
        filler.className = "tab-bar-filler";
        this.tabBar.appendChild(filler);
    }
}
