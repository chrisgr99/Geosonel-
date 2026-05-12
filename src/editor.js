/** @typedef {import("./bundle.js").Bundle} Bundle */
/**
 * Tabbed editor module.
 *
 * Manages the tab bar and the single CodeMirror editor instance
 * below it. One editor; switching tabs swaps the editor's
 * document rather than creating multiple editor views.
 *
 * Persistence model: explicit save only. Typing marks the
 * bundle dirty. Calling save() persists to IndexedDB and
 * clears the dirty flag. There is no timer-driven autosave;
 * the composer (or the Run Scene command) decides when bytes
 * hit storage. This avoids autosaving mid-edit in a state the
 * composer didn't intend.
 *
 * When the active bundle changes (user opens a different
 * score), call setBundle() to swap in the new content.
 */

// @ts-check

import { EditorView, keymap, lineNumbers } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6.5.2";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "https://esm.sh/@codemirror/commands@6?deps=@codemirror/state@6.5.2";
import { indentOnInput, indentUnit, bracketMatching } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6?deps=@codemirror/state@6.5.2";
import { json } from "https://esm.sh/@codemirror/lang-json@6?deps=@codemirror/state@6.5.2";
import { linter, lintGutter } from "https://esm.sh/@codemirror/lint@6?deps=@codemirror/state@6.5.2";
import * as acorn from "https://esm.sh/acorn@8";
import { Inspector } from "./inspector.js";
import { customDarkTheme } from "./cmTheme.js";
import { patternHighlightExtension, setSelectedObjectIdsEffect, setKnownObjectIdsEffect } from "./patternHighlight.js";

/**
 * Sentinel name for the virtual Properties tab. The
 * Properties tab is the form-based property inspector and
 * does not correspond to any file in the bundle, so its
 * "name" is a reserved string that will never collide with a
 * real filename. Selecting this tab hides the CodeMirror
 * area and shows the inspector area.
 */
const VIRTUAL_TAB_INSPECTOR = "__inspector__";

/**
 * CodeMirror linter that runs the source through Acorn's
 * JavaScript parser. Any parse error is returned as a
 * diagnostic with its line/column position, which CodeMirror
 * renders as a squiggly underline plus a hover tooltip and a
 * marker in the lint gutter.
 *
 * The linter is called automatically when the document
 * changes, with CodeMirror's built-in debounce (about 750ms
 * of idle time before a re-run). No runtime execution happens
 * here — this only catches syntax errors, not things like
 * "variable not declared" which require running the code.
 */
const jsSyntaxLinter = linter((view) => {
    const source = view.state.doc.toString();
    /** @type {Array<{from: number, to: number, severity: string, message: string}>} */
    const diagnostics = [];
    try {
        acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: "script",
            allowReturnOutsideFunction: true,
            locations: false,
        });
    } catch (err) {
        if (err instanceof SyntaxError) {
            // @ts-ignore — Acorn attaches pos as a number.
            const pos = typeof err.pos === "number" ? err.pos : 0;
            diagnostics.push({
                from: pos,
                to: Math.min(source.length, pos + 1),
                severity: "error",
                message: err.message,
            });
        }
    }
    return diagnostics;
});

/**
 * CodeMirror linter for JSON. Runs JSON.parse on every
 * idle-debounced change and surfaces parse errors with a
 * best-effort source position. Browser engines disagree on
 * the exact text of SyntaxError messages from JSON.parse, so
 * we recognise both the V8 "position N" pattern and the
 * SpiderMonkey "line N column M" pattern, and fall back to
 * highlighting the start of the document.
 */
const jsonSyntaxLinter = linter((view) => {
    const source = view.state.doc.toString();
    /** @type {Array<{from: number, to: number, severity: string, message: string}>} */
    const diagnostics = [];
    if (source.trim() === "") return diagnostics;
    try {
        JSON.parse(source);
    } catch (err) {
        if (err instanceof Error) {
            const pos = jsonErrorPosition(err.message, source);
            diagnostics.push({
                from: pos,
                to: Math.min(source.length, pos + 1),
                severity: "error",
                message: err.message,
            });
        }
    }
    return diagnostics;
});

/**
 * Best-effort 0-based source position from a JSON.parse
 * error message. Returns 0 if no recognisable position
 * pattern is present.
 * @param {string} message
 * @param {string} source
 * @returns {number}
 */
function jsonErrorPosition(message, source) {
    let m = message.match(/position\s+(\d+)/i);
    if (m !== null) return Math.min(parseInt(m[1], 10), source.length);
    m = message.match(/line\s+(\d+).*column\s+(\d+)/i);
    if (m !== null) {
        const line = parseInt(m[1], 10);
        const col = parseInt(m[2], 10);
        const lines = source.split("\n");
        let pos = 0;
        for (let i = 0; i < line - 1 && i < lines.length; i++) {
            pos += lines[i].length + 1;
        }
        pos += Math.max(0, col - 1);
        return Math.min(pos, source.length);
    }
    return 0;
}

/**
 * Tab label overrides. Files with a friendly name listed here
 * show that label in the tab bar instead of the raw filename.
 * The filename remains the underlying identifier for storage,
 * disk-mirror, and AI editing — only the human-facing tab
 * text is affected here.
 *
 * scene.json shows as "Properties JSON" rather than
 * "Properties" because the Properties tab is now a virtual
 * tab hosting the form-based property inspector. The raw
 * JSON view stays available as a fallback (and will until
 * the inspector covers every editable scene field).
 *
 * behaviors.js and behaviours.js both show as "Code" per
 * section 28's terminology, which treats the behaviour file
 * as the score's source-code surface (callback functions,
 * labelled pattern blocks) rather than naming it after the
 * older "behaviours" concept. behaviors.js is the canonical
 * v2.4 filename; behaviours.js is the legacy spelling kept
 * here as a fallback so a bundle mid-migration (legacy
 * filename still present) renders the right tab label until
 * the rename pass runs.
 */
const TAB_LABELS = {
    "scene.json": "Properties JSON",
    "behaviors.js": "Code",
    "behaviours.js": "Code",
};

/**
 * @param {string} name
 * @returns {string}
 */
function tabLabelFor(name) {
    return TAB_LABELS[name] ?? name;
}

/**
 * Pick the CodeMirror language extension and linter for a
 * file, by extension. Anything that isn't .json gets the
 * JavaScript pair.
 * @param {string} name
 * @returns {{language: any, linter: any}}
 */
function extensionsForFile(name) {
    if (name.toLowerCase().endsWith(".json")) {
        return { language: json(), linter: jsonSyntaxLinter };
    }
    return { language: javascript(), linter: jsSyntaxLinter };
}

/**
 * Find the start position of a top-level reference in a
 * source file. Two reference forms are supported, dispatched
 * by their leading character:
 *
 *   - A candidate starting with a dollar character is
 *     treated as a labelled-statement tag. A line-anchored
 *     regex matches the candidate followed by optional
 *     whitespace and a colon, locating dollar-prefixed
 *     labelled blocks like "$sp_a3f7:" used as pattern
 *     authoring blocks per section 28.
 *
 *   - Any other identifier-shaped candidate is treated as
 *     a function name. A line-anchored regex matches the
 *     word "function" followed by whitespace and the
 *     candidate followed by an opening parenthesis,
 *     locating top-level function declarations.
 *
 * Returns -1 when the candidate is not a valid JS
 * identifier shape (defence in depth against regex
 * metacharacters) or when no match is found. Both regexes
 * anchor at line start to avoid spurious matches inside
 * expression bodies or string literals.
 *
 * @param {string} source
 * @param {string} candidate
 * @returns {number}
 */
function findReferencePosition(source, candidate) {
    if (typeof candidate !== "string") return -1;
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(candidate)) return -1;
    let re;
    if (candidate[0] === "$") {
        // Escape the leading dollar for the regex (where it
        // otherwise anchors to end-of-string). The rest of
        // the identifier is already safe by the shape check
        // above.
        re = new RegExp("^\\" + candidate + "\\s*:", "m");
    } else {
        re = new RegExp("^function\\s+" + candidate + "\\s*\\(", "m");
    }
    const match = re.exec(source);
    return match === null ? -1 : match.index;
}


/**
 * @typedef {Object} EditorCallbacks
 * @property {(dirty: boolean) => void} [onDirtyChange]
 * @property {() => void} [onSaved]
 * @property {() => void} [onRunScene]
 * @property {(objectId: string, expressionBody: string) => void} [onPromotePattern]
 */

export class TabbedEditor {
    /**
     * @param {HTMLElement} tabBarElement
     * @param {HTMLElement} editorAreaElement
     * @param {HTMLElement} inspectorAreaElement
     * @param {Bundle} bundle
     * @param {EditorCallbacks} [callbacks]
     */
    constructor(tabBarElement, editorAreaElement, inspectorAreaElement, bundle, callbacks = {}) {
        this.tabBar = tabBarElement;
        this.editorArea = editorAreaElement;
        this.inspectorArea = inspectorAreaElement;
        this.bundle = bundle;
        this.onDirtyChange = callbacks.onDirtyChange ?? (() => {});
        this.onSaved = callbacks.onSaved ?? (() => {});
        this.onRunScene = callbacks.onRunScene ?? (() => {});
        this.onPromotePattern = callbacks.onPromotePattern ?? (() => {});

        /** @type {string | null} */
        this.activeName = null;

        /** @type {EditorView | null} */
        this.view = null;

        /** Suppress dirty-marking during programmatic document
         *  replacement (tab switches, bundle swaps). */
        this._suppressDirty = false;

        /** Has the bundle changed since the last save? */
        this.isDirty = false;

        // Compartments allow us to swap the language extension
        // and linter dynamically when the active tab changes
        // between scene.json and script.js. Created here so
        // they exist by the time _mountEditor reads them.
        this._langCompartment = new Compartment();
        this._linterCompartment = new Compartment();

        this._mountEditor();
        this._mountInspector();
        this._renderTabs();

        // The form-based Properties inspector is the default
        // landing tab — for most editing the form is what the
        // composer wants, and the raw JSON view (Properties
        // JSON) remains a click away when needed.
        this.selectTab(VIRTUAL_TAB_INSPECTOR);
    }

    // --- Bundle lifecycle ---

    /**
     * Swap the editor over to a different bundle. Any pending
     * unsaved changes on the old bundle are discarded (the
     * caller should save first if that matters). Resets dirty
     * state to clean for the new bundle.
     * @param {Bundle} bundle
     */
    async setBundle(bundle) {
        this.bundle = bundle;
        this.activeName = null;
        this._setDirty(false);
        this._renderTabs();
        // Default to the form-based Properties inspector when
        // switching scores, matching the constructor's initial
        // landing behaviour.
        this.selectTab(VIRTUAL_TAB_INSPECTOR);
    }

    /**
     * Persist the current bundle to IndexedDB, clear dirty.
     */
    async save() {
        try {
            await this.bundle.save();
            this._setDirty(false);
            this.onSaved();
        } catch (err) {
            console.error("GXW: save failed:", err);
        }
    }

    /**
     * Re-read the bundle's text-file contents into the editor
     * without changing the active tab. Used when something
     * outside the editor (e.g. a disk-mirror external-change
     * detection) has already updated the bundle's in-memory
     * file contents and we just need the visible editor view
     * to catch up. Clears dirty since the bundle and the on-
     * disk content are now in sync by construction.
     */
    reloadFromBundle() {
        this._renderTabs();
        const isVirtual = this.activeName === VIRTUAL_TAB_INSPECTOR;
        const stillExists = this.activeName !== null &&
            !isVirtual &&
            this.bundle.getFile(this.activeName) !== null;
        if (isVirtual) {
            // Inspector is its own surface; reselecting it
            // keeps the same tab visually highlighted and
            // (eventually, when bound) re-reads scene data.
            this.selectTab(VIRTUAL_TAB_INSPECTOR);
        } else if (stillExists) {
            this.selectTab(/** @type {string} */ (this.activeName));
        } else if (this.bundle.textFiles.length > 0) {
            this.selectTab(VIRTUAL_TAB_INSPECTOR);
        }
        this._setDirty(false);
    }

    /**
     * Sync the active tab's CodeMirror document with whatever
     * is currently in the bundle, then mark the editor dirty.
     * Used when canvas-driven edits (Add Sprite, drag-to-move)
     * mutate scene.json out from under the editor: the editor
     * needs to show the new content, and the bundle needs to
     * reflect that there are unsaved changes the user can
     * Cmd-S out to disk. The non-active tab's content lives
     * only in the bundle until the user switches to it; that's
     * fine since selectTab pulls from the bundle each time.
     */
    refreshActiveTabFromBundle() {
        if (this.activeName === null) return;
        // Virtual inspector tab does not back onto a file in
        // CodeMirror, so there's no document to refresh; the
        // bundle's scene.json content has already been updated
        // by the caller. We still flip the dirty flag because
        // the bundle differs from disk now, even though the
        // form-inspector view doesn't reflect that yet (data
        // binding comes in a later milestone).
        if (this.activeName === VIRTUAL_TAB_INSPECTOR) {
            this._setDirty(true);
            return;
        }
        if (this.view === null) return;
        const file = this.bundle.getFile(this.activeName);
        if (file === null) return;
        this._suppressDirty = true;
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: file.content,
            },
        });
        this._suppressDirty = false;
        this._setDirty(true);
    }

    /**
     * Get the current content of a named text file in the
     * bundle — reflects any in-flight edits, since updateContent
     * keeps the bundle in sync on every change even though
     * persistence is deferred.
     * @param {string} name
     * @returns {string | null}
     */
    getFileContent(name) {
        const f = this.bundle.getFile(name);
        return f === null ? null : f.content;
    }

    /**
     * Update the editor's selected-object-id state so the
     * Stage A5 active-tag decoration in patternHighlight.js
     * highlights labelled blocks whose dollar-prefixed
     * label matches one of the ids currently selected on
     * the canvas. Dispatched to the underlying CodeMirror
     * view as a setSelectedObjectIdsEffect; the ViewPlugin
     * reads the new set and recomputes its DecorationSet
     * immediately.
     *
     * Called by main.js on every canvas selection change
     * and after each successful runScene, so the highlight
     * follows clicks in real time and starts with the right
     * state on first load. Safe to call before the view
     * has mounted: the call is a no-op in that case.
     *
     * @param {Set<string>} selectedObjectIds
     */
    setSelectedObjectIds(selectedObjectIds) {
        if (this.view === null) return;
        this.view.dispatch({
            effects: setSelectedObjectIdsEffect.of(selectedObjectIds),
        });
    }

    /**
     * Update the editor's known-object-id state so the
     * orphan-tag decoration in patternHighlight.js flags
     * labelled blocks whose dollar-prefixed label does
     * NOT match any object in the current scene. The
     * decoration is a red wavy underline indicating the
     * block fires no pattern. Dispatched to the
     * underlying CodeMirror view as a
     * setKnownObjectIdsEffect; the ViewPlugin reads the
     * new set and recomputes its DecorationSet
     * immediately.
     *
     * Called by main.js after each successful runScene so
     * the orphan flags track scene mutations (objects
     * being added, removed, or renamed). Safe to call
     * before the view has mounted: the call is a no-op
     * in that case.
     *
     * @param {Set<string>} knownObjectIds
     */
    setKnownObjectIds(knownObjectIds) {
        if (this.view === null) return;
        this.view.dispatch({
            effects: setKnownObjectIdsEffect.of(knownObjectIds),
        });
    }

    // --- Mounting ---

    _mountEditor() {
        this.editorArea.innerHTML = "";

        // Custom keymap entries for our app-level shortcuts.
        // These sit BEFORE defaultKeymap in the keymap stack so
        // CodeMirror consumes them (run returns true) before the
        // default Enter handler inserts a newline.
        const appKeymap = [
            {
                key: "Mod-Enter",
                run: () => {
                    // Stage A4: if the cursor sits inside a
                    // top-level labelled pattern block in
                    // behaviors.js, promote the block's
                    // expression body to the named object's
                    // cyclePattern via the onPromotePattern
                    // callback. Otherwise fall through to the
                    // existing Run Scene gesture.
                    if (this._tryPromoteLabelledBlock()) return true;
                    this.onRunScene();
                    return true;
                },
                preventDefault: true,
            },
            {
                key: "Mod-s",
                run: () => {
                    this.save();
                    return true;
                },
                preventDefault: true,
            },
        ];

        const state = EditorState.create({
            doc: "",
            extensions: [
                lineNumbers(),
                history(),
                indentOnInput(),
                indentUnit.of("    "),
                bracketMatching(),
                this._linterCompartment.of(jsSyntaxLinter),
                lintGutter(),
                keymap.of([
                    ...appKeymap,
                    indentWithTab,
                    ...defaultKeymap,
                    ...historyKeymap,
                ]),
                this._langCompartment.of(javascript()),
                ...customDarkTheme(),
                patternHighlightExtension(),
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
                    // Bottom padding on the content area so the
                    // editor can scroll any line all the way to
                    // the top of the viewport. Without this,
                    // scrollIntoView near the end of the file
                    // hits the bottom of the document and
                    // leaves the target somewhere short of the
                    // first row — there isn't enough content
                    // below to fill the viewport, so CodeMirror
                    // can't scroll further. 100vh covers any
                    // pane size up to full body height (focus-
                    // canvas mode being the largest case), so
                    // every function declaration and labelled
                    // pattern block in behaviors.js can land at
                    // row 0 regardless of where it sits in the
                    // file. The trade-off is some empty space
                    // visible when the user scrolls past the
                    // last line of code; this is rare in
                    // practice (navigation is by
                    // selectTabAndScrollToFunction, not by
                    // manual end-of-file scrolling) and the
                    // scrollbar still indicates the document
                    // boundary.
                    ".cm-content": {
                        paddingBottom: "100vh",
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
     * Mount the form-based property inspector into the
     * inspector area. The Inspector class owns its own DOM
     * subtree; the editor's job is to show or hide the
     * inspector area when its tab becomes active.
     */
    _mountInspector() {
        if (this.inspectorArea === null) return;
        this.inspector = new Inspector(this.inspectorArea);
    }

    /**
     * Toggle visibility between the CodeMirror editor area and
     * the inspector area. Both occupy the same flex slot in the
     * editor pane and only one is shown at a time.
     * @param {boolean} showInspector
     */
    _setInspectorVisible(showInspector) {
        if (this.inspectorArea === null) return;
        if (showInspector) {
            this.inspectorArea.classList.remove("hidden");
            this.editorArea.classList.add("hidden");
        } else {
            this.inspectorArea.classList.add("hidden");
            this.editorArea.classList.remove("hidden");
        }
    }

    // --- Tab selection ---

    /**
     * @param {string} name
     */
    selectTab(name) {
        // Virtual inspector tab. No CodeMirror document swap;
        // we just toggle which area is visible and update the
        // tab-bar selection styling.
        if (name === VIRTUAL_TAB_INSPECTOR) {
            this.activeName = name;
            this._setInspectorVisible(true);
            this._renderTabs();
            return;
        }

        const file = this.bundle.getFile(name);
        if (file === null || this.view === null) return;

        this.activeName = name;
        this._setInspectorVisible(false);

        const exts = extensionsForFile(name);

        this._suppressDirty = true;
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: file.content,
            },
            effects: [
                this._langCompartment.reconfigure(exts.language),
                this._linterCompartment.reconfigure(exts.linter),
            ],
        });
        this._suppressDirty = false;

        this._renderTabs();
    }

    /**
     * Switch to the named tab and scroll a top-level
     * reference to the top of the editor's visible region.
     * Used after Create scaffolds a new declaration (so the
     * user sees the new content ready for editing) and
     * after Go-to on any Band 3 slot whose target already
     * exists. The CodeMirror cursor is moved to the matched
     * line so a subsequent keystroke lands at the right
     * place, and the editor takes focus so the user can
     * begin typing.
     *
     * The target can be either a single string or an array
     * of strings. The single-string form is what current
     * callers use; the array form picks the earliest match
     * across multiple candidates and is supported for cases
     * that may need it. Each candidate is dispatched by
     * its leading character: a dollar-prefixed name
     * matches a labelled-statement tag, any other
     * identifier-shaped name matches a top-level function
     * declaration. When multiple candidates match, the
     * earliest match in the file wins.
     *
     * Combines the doc replacement, language switch, cursor
     * move, and scroll into one dispatch so all four happen
     * in a single layout pass — separate dispatches would
     * scroll based on the doc state after the change but
     * before measurement, which can land a fraction of a
     * line off.
     *
     * If no candidate matches in the file (e.g. the user
     * deleted the target in CodeMirror after the scene was
     * last reloaded), the call falls back to plain selectTab
     * so the user still sees the file rather than getting a
     * silent no-op.
     *
     * @param {string} name  File name (e.g. "behaviors.js").
     * @param {string | string[]} target  Function name, dollar-prefixed labelled-statement tag, or an array of either.
     */
    selectTabAndScrollToFunction(name, target) {
        if (name === VIRTUAL_TAB_INSPECTOR) {
            this.selectTab(name);
            return;
        }
        const file = this.bundle.getFile(name);
        if (file === null || this.view === null) {
            this.selectTab(name);
            return;
        }

        // Walk the candidate list and pick the earliest
        // match. Each candidate is dispatched by leading
        // character: dollar-prefixed candidates match
        // labelled-statement tags, others match function
        // declarations. findReferencePosition gates each
        // candidate on a JS identifier shape check for
        // defence in depth against regex metacharacters in
        // any path that has not run a stricter validator.
        const candidates = Array.isArray(target) ? target : [target];
        let targetPos = -1;
        for (const candidate of candidates) {
            const pos = findReferencePosition(file.content, candidate);
            if (pos === -1) continue;
            if (targetPos === -1 || pos < targetPos) {
                targetPos = pos;
            }
        }

        if (targetPos === -1) {
            this.selectTab(name);
            return;
        }

        this.activeName = name;
        this._setInspectorVisible(false);

        const exts = extensionsForFile(name);

        this._suppressDirty = true;
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: file.content,
            },
            selection: { anchor: targetPos },
            effects: [
                this._langCompartment.reconfigure(exts.language),
                this._linterCompartment.reconfigure(exts.linter),
                EditorView.scrollIntoView(targetPos, { y: "start", yMargin: 0 }),
            ],
        });
        this._suppressDirty = false;

        this._renderTabs();
        this.view.focus();
    }

    /**
     * Switch to the Properties tab, which hosts the
     * form-based property inspector. Equivalent to
     * clicking the Properties tab in the tab bar: the
     * CodeMirror editor area is hidden and the inspector
     * area is shown. Used by main.js as the navigation
     * target when a canvas double-click lands on an
     * object that has no source in behaviors.js (no
     * labelled pattern block and no default-named
     * callback declaration), so the user can use the
     * inspector's Create buttons to scaffold one.
     */
    selectInspectorTab() {
        this.selectTab(VIRTUAL_TAB_INSPECTOR);
    }

    /**
     * Detect whether the cursor in the active tab is inside
     * a top-level labelled pattern block, and if so emit
     * the onPromotePattern callback with the block's
     * objectId and expression body text. The labelled-
     * statement form is $objectId: expression — a JavaScript
     * LabeledStatement whose label name starts with a dollar
     * character and whose body is an ExpressionStatement.
     * The objectId passed to the callback is the label name
     * minus its leading dollar; the expression body is
     * sliced from the source text so the user's original
     * whitespace and formatting carry through.
     *
     * Active only on behaviors.js / behaviours.js. The
     * labelled-statement convention is part of the behaviour
     * file's authoring surface per section 28; other tabs
     * (the virtual inspector, scene.json, any additional
     * text files) never trigger pattern promotion.
     *
     * Returns true iff a labelled block was found and the
     * callback was emitted. The Mod-Enter handler uses the
     * return value to decide whether to consume the keypress
     * (true) or fall through to onRunScene (false). A
     * whole-file Acorn parse failure falls through to
     * onRunScene as well, because that path will surface the
     * syntax error via its existing load-fail mechanism.
     *
     * @returns {boolean}
     */
    _tryPromoteLabelledBlock() {
        if (this.view === null) return false;
        if (this.activeName !== "behaviors.js" &&
            this.activeName !== "behaviours.js") return false;
        const source = this.view.state.doc.toString();
        const cursorPos = this.view.state.selection.main.head;
        let ast;
        try {
            ast = acorn.parse(source, {
                ecmaVersion: 2022,
                sourceType: "script",
                allowReturnOutsideFunction: true,
                locations: false,
            });
        } catch (err) {
            // Whole-file syntax error: fall through to the
            // Run Scene gesture, whose load-fail path
            // surfaces the diagnostic.
            return false;
        }
        if (ast === null || !Array.isArray(ast.body)) return false;
        for (const node of ast.body) {
            if (node.type !== "LabeledStatement") continue;
            // Acorn's start/end are character offsets into
            // the source string. Inclusive on both ends so a
            // cursor immediately after the block's closing
            // punctuation still counts as inside.
            if (cursorPos < node.start || cursorPos > node.end) continue;
            const label = node.label;
            if (label === null ||
                label.type !== "Identifier" ||
                typeof label.name !== "string") continue;
            if (!label.name.startsWith("$")) continue;
            const body = node.body;
            if (body === null ||
                body.type !== "ExpressionStatement") continue;
            const expr = body.expression;
            if (expr === null) continue;
            const objectId = label.name.slice(1);
            const expressionText = source.slice(expr.start, expr.end);
            this.onPromotePattern(objectId, expressionText);
            return true;
        }
        return false;
    }

    /**
     * @param {string} content
     */
    _onDocChanged(content) {
        if (this.activeName === null) return;
        // The virtual inspector tab has no file backing; spurious
        // CodeMirror updates while it's hidden must not flow
        // through to bundle.updateContent.
        if (this.activeName === VIRTUAL_TAB_INSPECTOR) return;
        if (this._suppressDirty) return;
        this.bundle.updateContent(this.activeName, content);
        this._setDirty(true);
    }

    /**
     * @param {boolean} dirty
     */
    _setDirty(dirty) {
        if (this.isDirty === dirty) return;
        this.isDirty = dirty;
        this.onDirtyChange(dirty);
    }

    // --- Tab rendering ---

    /**
     * Render the tab bar. The Properties tab (form inspector)
     * is virtual — it has no backing file and is rendered
     * first regardless of bundle file order. The Code tab
     * (behaviors.js / behaviours.js) follows, then Properties
     * JSON (scene.json), then any other text files in the
     * bundle in their natural order. Pinning the order this
     * way means the form-based Properties tab is always
     * leftmost and the raw JSON view sits next to its
     * companion Code tab regardless of how the bundle stores
     * its files.
     */
    _renderTabs() {
        this.tabBar.innerHTML = "";

        // Virtual Properties tab (form inspector).
        this.tabBar.appendChild(
            this._renderVirtualTab(VIRTUAL_TAB_INSPECTOR, "Properties"),
        );

        // File tabs in display order. Code first so the
        // composer reads function declarations and pattern
        // blocks before the declarative scene data;
        // Properties JSON second. Both legacy and v2.4
        // filenames are listed so a bundle in either state
        // renders correctly during the migration window.
        const orderedNames = ["behaviors.js", "behaviours.js", "scene.json"];
        const renderedNames = new Set();
        for (const name of orderedNames) {
            const file = this.bundle.getFile(name);
            if (file === null) continue;
            this.tabBar.appendChild(this._renderFileTab(name));
            renderedNames.add(name);
        }

        // Any remaining text files (e.g. resources/foo.js) in
        // their natural bundle order, after the pinned tabs.
        for (const file of this.bundle.textFiles) {
            if (renderedNames.has(file.name)) continue;
            this.tabBar.appendChild(this._renderFileTab(file.name));
        }

        const filler = document.createElement("div");
        filler.className = "tab-bar-filler";
        this.tabBar.appendChild(filler);
    }

    /**
     * Build a tab element for the virtual Properties tab.
     * @param {string} virtualName
     * @param {string} label
     * @returns {HTMLDivElement}
     */
    _renderVirtualTab(virtualName, label) {
        const el = document.createElement("div");
        el.className = "tab";
        if (virtualName === this.activeName) {
            el.classList.add("tab-selected");
            el.setAttribute("aria-selected", "true");
        } else {
            el.setAttribute("aria-selected", "false");
        }
        el.setAttribute("role", "tab");
        el.setAttribute("tabindex", "0");
        el.textContent = label;
        el.addEventListener("click", () => this.selectTab(virtualName));
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.selectTab(virtualName);
            }
        });
        return el;
    }

    /**
     * Build a tab element for a file in the bundle.
     * @param {string} name
     * @returns {HTMLDivElement}
     */
    _renderFileTab(name) {
        const el = document.createElement("div");
        el.className = "tab";
        if (name === this.activeName) {
            el.classList.add("tab-selected");
            el.setAttribute("aria-selected", "true");
        } else {
            el.setAttribute("aria-selected", "false");
        }
        el.setAttribute("role", "tab");
        el.setAttribute("tabindex", "0");
        el.textContent = tabLabelFor(name);
        el.addEventListener("click", () => this.selectTab(name));
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.selectTab(name);
            }
        });
        return el;
    }
}
