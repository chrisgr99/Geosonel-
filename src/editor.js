/**
 * Tabbed editor module.
 *
 * Manages the tab bar and the single CodeMirror editor instance
 * below it. Only one editor exists — switching tabs swaps the
 * editor's document rather than creating multiple editor views.
 *
 * Auto-persistence: every content change schedules a debounced
 * save of the full bundle to IndexedDB. There is no explicit
 * save action and no dirty dots on tabs — the content is
 * always saved. This matches a modern web-app model (Google
 * Docs, Notion) where "what you see is what's persisted."
 *
 * When the active bundle changes (e.g. the user opens a
 * different score), call setBundle() to swap in the new
 * content.
 */

// @ts-check

import { EditorView, keymap, lineNumbers } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { EditorState } from "https://esm.sh/@codemirror/state@6.5.2";
import { defaultKeymap, history, historyKeymap } from "https://esm.sh/@codemirror/commands@6?deps=@codemirror/state@6.5.2";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6?deps=@codemirror/state@6.5.2";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6?deps=@codemirror/state@6.5.2";

/** @typedef {import("./bundle.js").Bundle} Bundle */

const AUTOSAVE_DEBOUNCE_MS = 500;

export class TabbedEditor {
    /**
     * @param {HTMLElement} tabBarElement   The .tab-bar element.
     * @param {HTMLElement} editorAreaElement  The #editor-area element.
     * @param {Bundle} bundle
     * @param {() => void} [onPersisted]  Called after each successful autosave.
     */
    constructor(tabBarElement, editorAreaElement, bundle, onPersisted) {
        this.tabBar = tabBarElement;
        this.editorArea = editorAreaElement;
        this.bundle = bundle;
        this.onPersisted = onPersisted ?? (() => {});

        /** @type {string | null} */
        this.activeName = null;

        /** @type {EditorView | null} */
        this.view = null;

        /** Suppress content-persistence during programmatic
         * document replacement (tab switches, bundle swaps). */
        this._suppressPersist = false;

        /** @type {number | null} */
        this._autosaveTimer = null;

        this._mountEditor();
        this._renderTabs();

        if (this.bundle.textFiles.length > 0) {
            this.selectTab(this.bundle.textFiles[0].name);
        }
    }

    // --- Bundle lifecycle ---

    /**
     * Swap the editor over to a different bundle. Flushes any
     * pending autosave for the old bundle first, then replaces
     * the tab bar and editor contents with the new bundle's.
     * @param {Bundle} bundle
     */
    async setBundle(bundle) {
        await this._flushAutosave();
        this.bundle = bundle;
        this.activeName = null;
        this._renderTabs();
        if (this.bundle.textFiles.length > 0) {
            this.selectTab(this.bundle.textFiles[0].name);
        } else if (this.view !== null) {
            // Empty bundle — blank the editor.
            this._suppressPersist = true;
            this.view.dispatch({
                changes: { from: 0, to: this.view.state.doc.length, insert: "" },
            });
            this._suppressPersist = false;
        }
    }

    /**
     * Flush any pending debounced autosave immediately.
     */
    async _flushAutosave() {
        if (this._autosaveTimer !== null) {
            clearTimeout(this._autosaveTimer);
            this._autosaveTimer = null;
            await this._persistNow();
        }
    }

    // --- Mounting ---

    _mountEditor() {
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
                        fontSize: "14pt",
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

    // --- Tab selection ---

    /**
     * @param {string} name
     */
    selectTab(name) {
        const file = this.bundle.getFile(name);
        if (file === null || this.view === null) return;

        this.activeName = name;

        this._suppressPersist = true;
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: file.content,
            },
        });
        this._suppressPersist = false;

        this._renderTabs();
    }

    /**
     * @param {string} content
     */
    _onDocChanged(content) {
        if (this.activeName === null) return;
        if (this._suppressPersist) return;
        this.bundle.updateContent(this.activeName, content);
        this._scheduleAutosave();
    }

    _scheduleAutosave() {
        if (this._autosaveTimer !== null) {
            clearTimeout(this._autosaveTimer);
        }
        this._autosaveTimer = /** @type {number} */ (
            /** @type {unknown} */ (
                setTimeout(() => {
                    this._autosaveTimer = null;
                    this._persistNow();
                }, AUTOSAVE_DEBOUNCE_MS)
            )
        );
    }

    async _persistNow() {
        try {
            await this.bundle.save();
            this.onPersisted();
        } catch (err) {
            console.error("GXW: autosave failed:", err);
        }
    }

    // --- Tab rendering ---

    _renderTabs() {
        this.tabBar.innerHTML = "";

        for (const file of this.bundle.textFiles) {
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
            el.textContent = file.name;

            el.addEventListener("click", () => this.selectTab(file.name));
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.selectTab(file.name);
                }
            });

            this.tabBar.appendChild(el);
        }

        const filler = document.createElement("div");
        filler.className = "tab-bar-filler";
        this.tabBar.appendChild(filler);
    }
}
