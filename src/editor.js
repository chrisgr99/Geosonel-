/** @typedef {import("./bundle.js").Bundle} Bundle */
/**
 * Tabbed editor module.
 *
 * Manages the tab bar and the single CodeMirror editor instance
 * below it. One editor; switching tabs swaps the editor's
 * document rather than creating multiple editor views.
 *
 * Persistence model: explicit save only. Typing or any other
 * mutation marks the bundle dirty; the bundle's own change
 * stream propagates the state to subscribers (title bar, saved
 * indicator). Calling save() persists and clears the dirty
 * flag. There is no timer-driven autosave and no save-on-Run;
 * the composer decides when bytes hit storage.
 *
 * When the active bundle changes (user opens a different
 * score), call setBundle() to swap in the new content.
 */

// @ts-check

import { EditorView, keymap, lineNumbers, drawSelection, ViewPlugin, Decoration, WidgetType } from "https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6.5.2";
import { EditorState, Compartment, RangeSetBuilder } from "https://esm.sh/@codemirror/state@6.5.2";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo as cmUndo, redo as cmRedo, selectAll as cmSelectAll } from "https://esm.sh/@codemirror/commands@6?deps=@codemirror/state@6.5.2";
import { indentOnInput, indentUnit, bracketMatching } from "https://esm.sh/@codemirror/language@6?deps=@codemirror/state@6.5.2";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6?deps=@codemirror/state@6.5.2";
import { json } from "https://esm.sh/@codemirror/lang-json@6?deps=@codemirror/state@6.5.2";
import { linter, lintGutter } from "https://esm.sh/@codemirror/lint@6?deps=@codemirror/state@6.5.2";
import { completionKeymap } from "https://esm.sh/@codemirror/autocomplete@6?deps=@codemirror/state@6.5.2";
import * as acorn from "https://esm.sh/acorn@8";
import { Inspector } from "./inspector.js";
import { CanvasInspector } from "./canvasInspector.js";
import { customDarkTheme } from "./cmTheme.js";
import { patternHighlightExtension, setSelectedObjectIdsEffect, setKnownObjectIdsEffect } from "./patternHighlight.js";
import { isAutoCompletionEnabled } from "./strudel/codemirror/autocomplete.mjs";
import { isTooltipEnabled } from "./strudel/codemirror/tooltip.mjs";
import { deriveCursorTargetIds } from "./cursorTargets.js";
import { getPreference, subscribePreference } from "./preferences.js";
import { codeSpeechExtension } from "./codeSpeech.js";

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
 * Sentinel name for the virtual Canvas tab. Like the
 * Properties tab, the Canvas tab is selection-independent
 * scene-level chrome (canvas dimensions, background image
 * controls, image-transformation sliders, recent-image
 * gallery) and does not back onto any file in the bundle.
 * Selecting it hides the CodeMirror area and the
 * Properties inspector area, and shows the canvas-
 * inspector area. See DESIGN.md Section 13.5.
 */
const VIRTUAL_TAB_CANVAS = "__canvas__";

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
 * Soft-wrap hanging-indent extension.
 *
 * When EditorView.lineWrapping is on, long lines flow to a
 * second visual row at column 0 by default. For code that
 * uses indentation to convey structure (nested function
 * bodies, dot-method chains inside callbacks), the column-
 * zero continuation reads as if the wrapped portion is at
 * top-level scope. The hanging-indent variant pulls every
 * continuation visual row in one indent unit further than
 * the source line's start column, so the wrapped portion
 * reads as subordinate to its first row regardless of how
 * deeply indented that first row already is. An unindented
 * top-level line wraps to four-space-indented continuation
 * rows; a four-space-indented line wraps to eight-space-
 * indented continuation rows; and so on.
 *
 * Implementation: per visible logical line, count leading
 * whitespace characters and add one indent unit (4 spaces,
 * matching indentUnit at editor mount) to get the
 * continuation column. Emit a Decoration.line whose inline
 * style sets padding-left to that column in ch units and
 * text-indent to the negative of the same. padding-left
 * applies to every visual row of the line; text-indent
 * shifts the FIRST row back by the same amount so the
 * original leading whitespace and the line's content
 * render at their natural columns. Net effect: first row
 * sits at its natural column, continuation rows sit one
 * tab stop further in than the source line's start.
 *
 * Always emits a decoration when wrap mode is active,
 * including for lines with no leading whitespace, since
 * the +4 continuation indent applies regardless of the
 * line's own indent level. The plugin itself is only
 * loaded into the wrap compartment when the Soft-Wrap
 * Long Lines preference is on (see _wrapExtensions); when
 * the preference is off, none of this code runs.
 *
 * Tabs count as one character each. The codebase uses
 * 4-space indent via indentUnit so tabs are uncommon; if
 * they appear the column estimate may differ from rendered
 * width but the wrap will still align reasonably with the
 * line's start.
 */
const hangingIndentPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
        this.decorations = this._compute(view);
    }

    update(update) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this._compute(update.view);
        }
    }

    _compute(view) {
        const builder = new RangeSetBuilder();
        for (const { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const m = line.text.match(/^[ \t]*/);
                const leading = m !== null ? m[0].length : 0;
                // One indent unit further than the source
                // line's start column, matching indentUnit
                // of four spaces at editor mount. Emitted
                // for every line including unindented ones,
                // so the continuation indent applies
                // uniformly regardless of the line's own
                // indent level.
                const indent = leading + 4;
                builder.add(line.from, line.from, Decoration.line({
                    attributes: {
                        style: `padding-left: ${indent}ch; text-indent: -${indent}ch;`,
                    },
                }));
                pos = line.to + 1;
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations,
});

/**
 * Token-boundary soft-wrap break opportunities.
 *
 * EditorView.lineWrapping uses overflow-wrap: anywhere as its
 * fallback when no other soft-break point fits. That means a
 * long mixed token like `circleRadius*sin(angle)` (one CSS
 * "word" since it has no spaces) gets broken at the column
 * boundary, splitting the identifier or operator mid-token.
 * For code, the wrap reads better when it lands at the
 * boundary between tokens (between an identifier and an
 * operator, between an operator and a paren, between a
 * paren and a string delimiter) rather than mid-identifier.
 *
 * This plugin injects an invisible <wbr> widget at every
 * transition between identifier characters ([A-Za-z0-9_$])
 * and non-identifier characters across the visible source.
 * <wbr> is the HTML "word break opportunity" element:
 * invisible, no content, just a hint to the layout engine
 * that breaking here is acceptable. The browser prefers
 * these over overflow-wrap: anywhere, so wraps land at
 * token boundaries when one fits. Very long single
 * identifiers that exceed the editor width still fall back
 * to mid-token breaks; that fallback stays active and
 * covers the edge case where no boundary fits.
 *
 * Whitespace runs inside the source are already soft-break
 * opportunities under default CSS, so no widget is needed
 * for them — the transitions adjacent to whitespace pick
 * up break points naturally.
 *
 * Char-code comparisons rather than a regex for the
 * per-character test; the test runs once per visible source
 * char on every viewport update, and the comparison form
 * avoids regex engine overhead in the inner loop.
 */
class WbrWidget extends WidgetType {
    eq() { return true; }
    toDOM() { return document.createElement("wbr"); }
    ignoreEvent() { return true; }
}

const wbrDecoration = Decoration.widget({
    widget: new WbrWidget(),
    side: 0,
});

const tokenBreakPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
        this.decorations = this._compute(view);
    }

    update(update) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this._compute(update.view);
        }
    }

    _compute(view) {
        const builder = new RangeSetBuilder();
        for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            let prevWord = false;
            let primed = false;
            for (let i = 0; i < text.length; i++) {
                const code = text.charCodeAt(i);
                const isWord =
                    (code >= 48 && code <= 57) ||   // 0-9
                    (code >= 65 && code <= 90) ||   // A-Z
                    (code >= 97 && code <= 122) ||  // a-z
                    code === 95 ||                  // _
                    code === 36;                    // $
                if (primed && isWord !== prevWord) {
                    builder.add(from + i, from + i, wbrDecoration);
                }
                prevWord = isWord;
                primed = true;
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations,
});

/**
 * Wrap-related theme rules.
 *
 * Loaded into the wrap compartment alongside lineWrapping,
 * hangingIndentPlugin, and tokenBreakPlugin so the whole
 * wrap behaviour toggles as one extension when the Soft-
 * Wrap Long Lines preference changes. Splitting these out
 * of the static theme keeps the always-on theme block free
 * of rules that would create visible artifacts (trailing
 * padding column, wrap marker mask) when wrapping is off.
 *
 * .cm-content uses pre-wrap rather than CodeMirror's
 * break-spaces default, so trailing whitespace at a wrap
 * point doesn't render and the last token sits flush
 * against the right edge.
 *
 * .cm-line carries a two-layer background-image for the
 * wrap marker. The first layer is a single-colour linear-
 * gradient acting as an opaque mask at the bottom-right
 * corner; the second is an inline SVG of ↵ (U+21B5)
 * repeating vertically at the right edge. The marker
 * tiles once per line-height of element height, so on a
 * wrapped logical line the marker appears at every visual
 * row's right edge; the bottom-right mask covers the last
 * line-height worth, hiding the marker on the final visual
 * row (which doesn't wrap). On a non-wrapping logical line
 * the mask covers the whole right edge and the marker is
 * hidden entirely. The mask colour matches the editor
 * surface (#141414 from main.css's #editor-area .cm-editor
 * rule); on the active line the colour switches via the
 * CSS variable to oneDark's active-line background so the
 * mask stays invisible there too. Marker colour is the
 * comment colour from cmTheme.js so it reads at the same
 * brightness as documentation text.
 *
 * padding-right reserves a column matching the marker
 * width inside .cm-line so text wraps before reaching the
 * marker rather than running underneath it. The marker
 * width is held in a CSS variable so the padding, the
 * background tile width, and the mask tile width stay in
 * lockstep — change the variable to resize and the text
 * reflows to leave the matching amount of space.
 */
const wrapTheme = EditorView.theme({
    ".cm-content": {
        whiteSpace: "pre-wrap",
    },
    ".cm-line": {
        "--gxw-wrap-mask-bg": "#141414",
        "--gxw-wrap-marker-width": "1.5ch",
        paddingRight: "var(--gxw-wrap-marker-width)",
        backgroundImage:
            "linear-gradient(var(--gxw-wrap-mask-bg), var(--gxw-wrap-mask-bg)), " +
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 20'><text x='7' y='16' text-anchor='middle' font-family='monospace' font-size='18' font-weight='bold' fill='%23c8c0b0'>%E2%86%B5</text></svg>\")",
        backgroundRepeat: "no-repeat, repeat-y",
        backgroundPosition: "right bottom, right top",
        backgroundSize:
            "var(--gxw-wrap-marker-width) 1lh, " +
            "var(--gxw-wrap-marker-width) 1lh",
    },
    ".cm-line.cm-activeLine": {
        "--gxw-wrap-mask-bg": "#2c313a",
    },
});

/**
 * Tab label overrides. Files with a friendly name listed here
 * show that label in the tab bar instead of the raw filename.
 * The filename remains the underlying identifier for storage,
 * disk-mirror, and AI editing — only the human-facing tab
 * text is affected here.
 *
 * scene.json renders with an empty label — a deliberately
 * underemphasised, anonymous final tab whose footprint is
 * just the tab chrome and (when dirty) a dirty dot. The raw
 * JSON view stays available as a fallback for hand-editing
 * fields the Properties inspector doesn't yet cover, but
 * isn't called out by name in the strip; eventual retirement
 * of the JSON view once the inspector covers every scene
 * field will simply drop the tab.
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
    "scene.json": "",
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
 * @property {(objectIds: string[], expressionBody: string) => void} [onPromotePattern]
 * @property {(objectId: string) => void} [onClearPattern]
 * @property {(objectId: string, blockingLine: number) => void} [onClearPatternBlocked]
 * @property {(ids: Set<string>) => void} [onCursorTargetIdsChange]
 */

export class TabbedEditor {
    /**
     * @param {HTMLElement} tabBarElement
     * @param {HTMLElement} editorAreaElement
     * @param {HTMLElement} inspectorAreaElement
     * @param {HTMLElement} canvasInspectorAreaElement
     * @param {Bundle} bundle
     * @param {EditorCallbacks} [callbacks]
     */
    constructor(tabBarElement, editorAreaElement, inspectorAreaElement, canvasInspectorAreaElement, bundle, callbacks = {}) {
        this.tabBar = tabBarElement;
        this.editorArea = editorAreaElement;
        this.inspectorArea = inspectorAreaElement;
        this.canvasInspectorArea = canvasInspectorAreaElement;
        this.bundle = bundle;
        this.onDirtyChange = callbacks.onDirtyChange ?? (() => {});
        this.onSaved = callbacks.onSaved ?? (() => {});
        this.onRunScene = callbacks.onRunScene ?? (() => {});
        this.onPromotePattern = callbacks.onPromotePattern ?? (() => {});
        this.onClearPattern = callbacks.onClearPattern ?? (() => {});
        this.onClearPatternBlocked = callbacks.onClearPatternBlocked ?? (() => {});
        this.onCursorTargetIdsChange = callbacks.onCursorTargetIdsChange ?? (() => {});

        /** @type {string | null} */
        this.activeName = null;

        /** @type {EditorView | null} */
        this.view = null;

        /** Suppress dirty-marking during programmatic document
         *  replacement (tab switches, bundle swaps). */
        this._suppressDirty = false;

        /**
         * Live scene reference for the cursor-target highlight.
         * Set by main.js after every successful runScene via
         * setScene; read by _emitCursorTargetIds when the
         * cursor in behaviors.js sits inside a top-level
         * FunctionDeclaration whose name needs to be looked
         * up across each object's hasHitFunction /
         * beenHitFunction / onTickFunction slots. Null
         * before the first runScene; in that case the
         * highlight emits an empty id set so the canvas
         * stays at default colours.
         * @type {{curves: any[], triggers: any[], sprites: any[]} | null}
         */
        this._scene = null;

        /**
         * Unsubscribe handle for the active bundle's dirty-
         * change subscription. Re-bound on every bundle swap
         * via _subscribeBundleDirty so the editor's onDirtyChange
         * callback always reflects the current bundle's state.
         * @type {(() => void) | null}
         */
        this._unsubBundleDirty = null;

        // Compartments allow us to swap the language extension
        // and linter dynamically when the active tab changes
        // between scene.json and script.js. Created here so
        // they exist by the time _mountEditor reads them.
        this._langCompartment = new Compartment();
        this._linterCompartment = new Compartment();

        /**
         * Compartment holding the Strudel autocomplete and
         * Ctrl-hover tooltip extensions. Reconfigured to an
         * empty array on every non-Code tab so the popup
         * and tooltip stay silent on scene.json and the
         * virtual Properties / Canvas tabs, and reconfigured
         * to the live extension list when the Code tab
         * (behaviors.js or behaviours.js) is active. The
         * extension list inside is itself gated on the user's
         * Enable Autocompletion and Function Documentation
         * Tooltips preferences, so a flip of either control
         * in the Settings dialog immediately removes or
         * restores the corresponding behaviour without
         * needing a tab switch. See _strudelExtensionsForActiveTab.
         * @type {Compartment}
         */
        this._strudelCompartment = new Compartment();

        /**
         * Compartment holding the line-wrap related
         * extensions: EditorView.lineWrapping, the hanging-
         * indent plugin, the token-break plugin, and the
         * wrap-only theme rules (padding column, ↵ marker,
         * pre-wrap whitespace). All four toggle together
         * when the Soft-Wrap Long Lines preference changes,
         * so a flip in the Settings dialog reflows the
         * editor between wrap and no-wrap modes cleanly
         * without artifacts in either direction.
         * @type {Compartment}
         */
        this._wrapCompartment = new Compartment();

        /**
         * Compartment holding the read-only state effect
         * that blocks user input while the AI batch
         * confirm-to-apply dialog is visible (Phase 1B
         * commit 4b.2). Reconfigured to
         * [EditorState.readOnly.of(true)] by aiBatchDialog
         * when the dialog opens and back to [] when it
         * closes. EditorState.readOnly blocks keystrokes
         * and paste; it still allows scrolling, selection
         * for copy, and programmatic dispatches — which
         * is what mirrorPush.confirmApply uses to land the
         * held batch's edits, so apply continues to work
         * under the lock.
         * @type {Compartment}
         */
        this._readOnlyCompartment = new Compartment();

        this._mountEditor();
        this._mountInspector();
        this._mountCanvasInspector();
        this._renderTabs();
        this._subscribeBundleDirty();
        this._subscribeStrudelPreferences();
        this._subscribeWrapPreference();

        // The form-based Properties inspector is the default
        // landing tab — for most editing the form is what the
        // composer wants, and the raw JSON view (Properties
        // JSON) remains a click away when needed.
        this.selectTab(VIRTUAL_TAB_INSPECTOR);
    }

    /**
     * The canonical dirty signal lives on the bundle now;
     * this accessor preserves the long-standing
     * editor.isDirty API for external callers.
     * @returns {boolean}
     */
    get isDirty() {
        return this.bundle.dirty;
    }

    /**
     * Bind the editor's onDirtyChange callback to the
     * current bundle's dirty-change stream. Called from the
     * constructor and from setBundle so the callback always
     * tracks the live bundle. The old subscription is torn
     * down before the new one is established.
     */
    _subscribeBundleDirty() {
        if (this._unsubBundleDirty !== null) {
            this._unsubBundleDirty();
            this._unsubBundleDirty = null;
        }
        this._unsubBundleDirty = this.bundle.subscribeDirtyChange((dirty) => {
            // Per-tab dirty dots refresh on every whole-
            // bundle dirty transition: clean→dirty on the
            // first edit lights the active file's dot,
            // dirty→clean on save clears every dot at once.
            // Per-file transitions while the bundle is
            // already dirty are handled by _onDocChanged
            // (CodeMirror typing) and refreshActiveTabFromBundle
            // (inspector and canvas-driven edits).
            this._renderTabs();
            this.onDirtyChange(dirty);
        });
    }

    /**
     * Compute the Strudel extension list for the currently
     * active tab, gated by the user's two preferences. Returns
     * an empty array for any tab that isn't the Code tab
     * (behaviors.js / behaviours.js), so the autocomplete
     * popup and the Ctrl-hover tooltip stay silent on
     * scene.json and on the virtual Properties / Canvas
     * tabs. When the Code tab is active, returns the live
     * extensions for whichever of autocompletion and tooltip
     * the user has enabled — either preference being off
     * folds that extension out of the array without affecting
     * the other.
     *
     * Read from the same compartment under selectTab,
     * selectTabAndScrollToFunction, and the preference
     * subscriptions so all three reconfigure paths derive
     * the same answer from the current state.
     * @returns {any[]}
     */
    _strudelExtensionsForActiveTab() {
        const isCodeTab =
            this.activeName === "behaviors.js" ||
            this.activeName === "behaviours.js";
        if (!isCodeTab) return [];
        return [
            isAutoCompletionEnabled(getPreference("enableStrudelAutocomplete")),
            isTooltipEnabled(getPreference("enableStrudelTooltips")),
        ];
    }

    /**
     * Dispatch a Strudel-compartment reconfigure based on
     * the current active tab and preference state. Used by
     * the virtual-tab branches of selectTab (which don't
     * carry a CodeMirror document-replace dispatch of their
     * own to fold the reconfigure into) and by the
     * preference subscriber. The file-tab branches of
     * selectTab and selectTabAndScrollToFunction inline the
     * reconfigure effect into their existing dispatch
     * instead, so the language swap, linter swap, and
     * Strudel-extension swap all land in one transaction.
     */
    _reconfigureStrudelCompartment() {
        if (this.view === null) return;
        this.view.dispatch({
            effects: this._strudelCompartment.reconfigure(
                this._strudelExtensionsForActiveTab(),
            ),
        });
    }

    /**
     * Subscribe to the two Strudel-related preferences
     * (enableStrudelAutocomplete and enableStrudelTooltips)
     * so a flip of either control in the Settings dialog
     * immediately reconfigures the editor's Strudel
     * compartment. The reconfigure honours the active-tab
     * gate, so flipping a preference on while a non-Code
     * tab is active leaves the compartment empty (the next
     * selectTab into the Code tab picks up the new state).
     *
     * Called once at construction; no unsubscribe is wired
     * because the editor lives for the duration of the
     * app session.
     */
    _subscribeStrudelPreferences() {
        const onChange = () => this._reconfigureStrudelCompartment();
        subscribePreference("enableStrudelAutocomplete", onChange);
        subscribePreference("enableStrudelTooltips", onChange);
    }

    /**
     * Compute the wrap-compartment extension list from the
     * user's Soft-Wrap Long Lines preference. When on, the
     * compartment holds EditorView.lineWrapping, the
     * hanging-indent plugin, the token-break plugin, and
     * wrapTheme (the wrap-only CSS rules). When off, the
     * list is empty so text doesn't wrap and the marker
     * plus padding column don't render. Read from the same
     * compartment under the constructor (initial mount) and
     * the preference subscriber (live toggle) so both paths
     * derive the same answer from current state.
     * @returns {any[]}
     */
    _wrapExtensions() {
        if (!getPreference("enableLineWrapping")) return [];
        return [
            EditorView.lineWrapping,
            hangingIndentPlugin,
            tokenBreakPlugin,
            wrapTheme,
        ];
    }

    /**
     * Dispatch a wrap-compartment reconfigure based on the
     * current preference state. Called by the preference
     * subscriber so a flip of the Soft-Wrap Long Lines
     * control in the Settings dialog reflows the editor
     * immediately.
     */
    _reconfigureWrapCompartment() {
        if (this.view === null) return;
        this.view.dispatch({
            effects: this._wrapCompartment.reconfigure(this._wrapExtensions()),
        });
    }

    /**
     * Subscribe to the Soft-Wrap Long Lines preference so a
     * flip of the control in the Settings dialog
     * immediately reconfigures the editor's wrap
     * compartment. Called once at construction; no
     * unsubscribe is wired because the editor lives for
     * the duration of the app session.
     */
    _subscribeWrapPreference() {
        subscribePreference("enableLineWrapping", () => {
            this._reconfigureWrapCompartment();
        });
    }

    // --- Bundle lifecycle ---

    /**
     * Swap the editor over to a different bundle. Any pending
     * unsaved changes on the old bundle are discarded (the
     * caller should save first if that matters). The new
     * bundle's dirty state is whatever it carries; the editor
     * re-subscribes to its dirty-change stream and fires the
     * onDirtyChange callback explicitly with the new state so
     * the saved indicator and title bar refresh on swap.
     * @param {Bundle} bundle
     */
    async setBundle(bundle) {
        this.bundle = bundle;
        this.activeName = null;
        this._subscribeBundleDirty();
        this._renderTabs();
        // Default to the form-based Properties inspector when
        // switching scores, matching the constructor's initial
        // landing behaviour.
        this.selectTab(VIRTUAL_TAB_INSPECTOR);
        this.onDirtyChange(this.bundle.dirty);
    }

    /**
     * Persist the current bundle and clear its dirty flag.
     * Bundle.save() handles the dirty transition internally,
     * which propagates back through this editor's bundle
     * subscription to refresh dependent UI.
     */
    async save() {
        try {
            await this.bundle.save();
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
     * to catch up. The bundle's dirty state is whatever the
     * external code left it as; this method does not mark or
     * clear it. Callers that want a clean state after the
     * external sync should call bundle.markClean() themselves.
     */
    reloadFromBundle() {
        this._renderTabs();
        const isVirtual =
            this.activeName === VIRTUAL_TAB_INSPECTOR ||
            this.activeName === VIRTUAL_TAB_CANVAS;
        const stillExists = this.activeName !== null &&
            !isVirtual &&
            this.bundle.getFile(this.activeName) !== null;
        if (this.activeName === VIRTUAL_TAB_INSPECTOR) {
            // Inspector is its own surface; reselecting it
            // keeps the same tab visually highlighted and
            // (eventually, when bound) re-reads scene data.
            this.selectTab(VIRTUAL_TAB_INSPECTOR);
        } else if (this.activeName === VIRTUAL_TAB_CANVAS) {
            // Same treatment for the Canvas tab: reselect
            // keeps it active and the canvas-inspector
            // area visible.
            this.selectTab(VIRTUAL_TAB_CANVAS);
        } else if (stillExists) {
            this.selectTab(/** @type {string} */ (this.activeName));
        } else if (this.bundle.textFiles.length > 0) {
            this.selectTab(VIRTUAL_TAB_INSPECTOR);
        }
    }

    /**
     * Sync the active tab's CodeMirror document with whatever
     * is currently in the bundle. Used when canvas-driven edits
     * (Add Sprite, drag-to-move) mutate scene.json out from
     * under the editor: the editor needs to show the new
     * content. The caller has already mutated the bundle (which
     * marked it dirty through Bundle.updateContent), so this
     * method's job is only to bring the visible CodeMirror
     * document into sync. The non-active tab's content lives
     * only in the bundle until the user switches to it; that's
     * fine since selectTab pulls from the bundle each time.
     *
     * No-op dispatch when the active tab's bundle content
     * equals the editor's current document. Cmd-Enter promote
     * is the case that motivates the guard: it mutates
     * scene.json (via applySceneEdit) but never touches
     * behaviors.js, yet applySceneEdit calls
     * refreshActiveTabFromBundle unconditionally. Without the
     * guard, the active behaviors.js tab gets a
     * full-document replace transaction that inserts the
     * same content it already has — a logical no-op as far
     * as text is concerned, but a real transaction in
     * CodeMirror's history that interferes with the redo
     * stack and breaks Cmd-Shift-Z after the user undoes
     * past the promote. Skipping the dispatch when content
     * is unchanged preserves the history exactly.
     */
    refreshActiveTabFromBundle() {
        if (this.activeName === null) return;
        // Virtual inspector tab does not back onto a file in
        // CodeMirror, so there's no document to refresh; the
        // bundle's scene.json content has already been updated
        // by the caller and the bundle's own markDirty has
        // fired. Nothing more to do here.
        if (this.activeName === VIRTUAL_TAB_INSPECTOR) return;
        if (this.view === null) return;
        const file = this.bundle.getFile(this.activeName);
        if (file === null) return;
        if (file.content === this.view.state.doc.toString()) {
            // Content is already in sync. Skip the dispatch
            // to preserve CodeMirror's undo/redo history.
            return;
        }
        this._suppressDirty = true;
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: file.content,
            },
        });
        this._suppressDirty = false;
        // The bundle was mutated by the caller before this
        // method was invoked (typically applySceneEdit
        // updating scene.json via an inspector or canvas
        // gesture). Re-render the tab bar so per-tab dirty
        // dots reflect the new bundle state; the whole-
        // bundle dirty event only fires on transitions, so
        // an already-dirty bundle receiving another edit
        // wouldn't otherwise refresh the dots here.
        this._renderTabs();
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
     * Set the editor's read-only state. Used by
     * aiBatchDialog (Phase 1B commit 4b.2) to lock the
     * Code tab against keystrokes while the AI batch
     * confirm-to-apply dialog is visible.
     * EditorState.readOnly blocks user input — keystrokes
     * and paste — but still allows scrolling, selection
     * for copy, and programmatic dispatches. The apply
     * path inside mirrorPush.confirmApply uses
     * programmatic dispatches to land the held batch's
     * edits, so it continues to work under the lock; only
     * the user's keyboard is gated.
     *
     * Safe to call before the view has mounted: the call
     * is a no-op in that case. Idempotent: setting the
     * same state twice produces no visible change.
     *
     * @param {boolean} readOnly
     */
    setReadOnly(readOnly) {
        if (this.view === null) return;
        this.view.dispatch({
            effects: this._readOnlyCompartment.reconfigure(
                readOnly ? [EditorState.readOnly.of(true)] : [],
            ),
        });
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

    /**
     * Provide the editor with the live scene so the
     * cursor-target highlight in behaviors.js can resolve
     * top-level function declarations back to the object
     * ids that bind them in hasHitFunction /
     * beenHitFunction / onTickFunction slots. Called by
     * main.js after each successful runScene, mirroring
     * setSelectedObjectIds and setKnownObjectIds. After
     * stashing the scene reference the editor re-emits the
     * cursor-target id set so the canvas picks up any
     * binding changes that landed with the reload (e.g.
     * a slot was just rewired through the inspector and
     * Cmd-Enter ran the scene). Safe to call before the
     * view has mounted: _emitCursorTargetIds short-circuits
     * in that case.
     *
     * @param {{curves: any[], triggers: any[], sprites: any[]} | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        this._emitCursorTargetIds();
    }

    /**
     * Re-derive the cursor-target id set from the editor's
     * current selection range and the live scene, then
     * fire onCursorTargetIdsChange with the result. A bare
     * cursor with no selection comes through as a
     * zero-width range and resolves to the single
     * top-level node containing the cursor (the original
     * behaviour); a non-empty selection unions the ids of
     * every owned region the selection overlaps. Active
     * only on behaviors.js / behaviours.js — any other tab
     * fires an empty set so the canvas's highlight clears
     * as soon as the user switches away from the Code
     * tab. A null scene also fires empty so the highlight
     * stays cleared until the first runScene has landed.
     *
     * Called by the editor's updateListener on every
     * docChanged or selectionSet update (so cursor moves,
     * drag-selection extensions, and edits all track the
     * highlight in real time), by selectTab and
     * selectTabAndScrollToFunction after a tab change,
     * and by setScene after a fresh scene load.
     */
    _emitCursorTargetIds() {
        if (this.view === null) return;
        const isCodeTab =
            this.activeName === "behaviors.js" ||
            this.activeName === "behaviours.js";
        if (!isCodeTab || this._scene === null) {
            this.onCursorTargetIdsChange(new Set());
            return;
        }
        const source = this.view.state.doc.toString();
        const sel = this.view.state.selection.main;
        const ids = deriveCursorTargetIds(source, sel.from, sel.to, this._scene);
        this.onCursorTargetIdsChange(ids);
    }

    /**
     * Try to handle an Undo gesture against the currently-
     * focused element. Called by the native macOS menu's
     * Cmd-Z dispatcher (src/menuActions.js) so the
     * accelerator does the right thing depending on where
     * the cursor is:
     *
     *   - Focus inside .cm-editor: call CodeMirror's own
     *     undo command against this editor's view. Same
     *     effect the historyKeymap's Mod-z binding would
     *     have produced if the native menu hadn't
     *     preempted the keystroke.
     *   - Focus inside an INPUT / TEXTAREA / contenteditable:
     *     fall through to document.execCommand("undo"),
     *     which triggers the browser's native text-input
     *     undo. Deprecated in spec but functional in
     *     Chromium, which is what Electron runs.
     *   - Anything else (canvas focus, body focus, menu
     *     focus): return false so the caller can fall
     *     through to the canvas undo stack.
     *
     * Returns true iff the keystroke was handled here.
     *
     * @returns {boolean}
     */
    tryUndoInFocus() {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return false;
        if (focused.closest(".cm-editor") !== null) {
            if (this.view !== null) {
                cmUndo(this.view);
                return true;
            }
            return false;
        }
        if (focused.tagName === "INPUT" ||
            focused.tagName === "TEXTAREA" ||
            focused.isContentEditable) {
            document.execCommand("undo");
            return true;
        }
        return false;
    }

    /**
     * Symmetric with tryUndoInFocus for Cmd-Shift-Z. See
     * that method's comment for the dispatch logic.
     *
     * @returns {boolean}
     */
    tryRedoInFocus() {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return false;
        if (focused.closest(".cm-editor") !== null) {
            if (this.view !== null) {
                cmRedo(this.view);
                return true;
            }
            return false;
        }
        if (focused.tagName === "INPUT" ||
            focused.tagName === "TEXTAREA" ||
            focused.isContentEditable) {
            document.execCommand("redo");
            return true;
        }
        return false;
    }

    /**
     * Try to handle a Cut gesture against the currently-
     * focused element. Called by the native macOS menu's
     * Cmd-X dispatcher (src/menuActions.js) so the
     * accelerator does the right thing depending on where
     * focus is. CodeMirror, INPUT, TEXTAREA, and
     * contenteditable all share one path: invoke the
     * browser's native cut via document.execCommand("cut").
     * That fires the cut event which CodeMirror's content
     * area listens for, and triggers the standard text-
     * field cut for native inputs. Any other focus context
     * (canvas, body, menu chrome) returns false so the
     * dispatcher falls through to the canvas performCut.
     *
     * execCommand("cut") is technically deprecated in the
     * spec but remains supported in Chromium (and
     * therefore Electron). The newer Clipboard API
     * alternative (navigator.clipboard.writeText after
     * reading the selection manually) doesn't trigger
     * CodeMirror's own cut-event handlers and would
     * require a per-surface re-implementation, which
     * isn't worth the layering complexity here.
     *
     * @returns {boolean}
     */
    tryCutInFocus() {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return false;
        if (focused.closest(".cm-editor") !== null ||
            focused.tagName === "INPUT" ||
            focused.tagName === "TEXTAREA" ||
            focused.isContentEditable) {
            document.execCommand("cut");
            return true;
        }
        return false;
    }

    /**
     * Symmetric with tryCutInFocus for Cmd-C. See that
     * method's comment for the dispatch logic and the
     * execCommand rationale.
     *
     * @returns {boolean}
     */
    tryCopyInFocus() {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return false;
        if (focused.closest(".cm-editor") !== null ||
            focused.tagName === "INPUT" ||
            focused.tagName === "TEXTAREA" ||
            focused.isContentEditable) {
            document.execCommand("copy");
            return true;
        }
        return false;
    }

    /**
     * Try to handle a Paste gesture against the currently-
     * focused element. Called by the native macOS menu's
     * Cmd-V dispatcher (src/menuActions.js); async because
     * navigator.clipboard.readText returns a promise.
     * Returns true iff the gesture was handled here
     * (regardless of whether the paste actually succeeded;
     * a clipboard read failure logs to console and still
     * returns true so the canvas performPaste doesn't run
     * over a text-focused element).
     *
     * Unlike tryCutInFocus / tryCopyInFocus, paste can't
     * use document.execCommand("paste") because modern
     * Chromium silently rejects it from non-extension
     * contexts as a security measure (the API can read
     * clipboard text without explicit permission, which
     * is considered a privacy risk). The Clipboard API's
     * readText is the supported alternative; in Electron
     * renderers it works without permission prompts
     * because Electron grants clipboard access by default.
     *
     * Per-surface insertion: CodeMirror gets a view
     * dispatch with the read text replacing the current
     * selection range, mirroring what its native paste
     * event handler would do. INPUT and TEXTAREA splice
     * the text into .value at the current selection and
     * fire an input event so any onInput listeners pick
     * up the change. contenteditable falls back to
     * document.execCommand("insertText", false, text),
     * which is the most reliable cursor-position insert
     * for editable regions.
     *
     * @returns {Promise<boolean>}
     */
    async tryPasteInFocus() {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return false;
        const isCm = focused.closest(".cm-editor") !== null;
        const isInput = focused.tagName === "INPUT" || focused.tagName === "TEXTAREA";
        const isCE = focused.isContentEditable;
        if (!isCm && !isInput && !isCE) return false;

        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (err) {
            console.error("GXW: clipboard read failed:", err);
            return true;
        }

        if (isCm && this.view !== null) {
            const sel = this.view.state.selection.main;
            this.view.dispatch({
                changes: { from: sel.from, to: sel.to, insert: text },
                selection: { anchor: sel.from + text.length },
                userEvent: "input.paste",
            });
            return true;
        }

        if (isInput) {
            const inputEl = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (focused);
            const start = inputEl.selectionStart ?? inputEl.value.length;
            const end = inputEl.selectionEnd ?? inputEl.value.length;
            inputEl.value = inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
            const cursor = start + text.length;
            inputEl.selectionStart = inputEl.selectionEnd = cursor;
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        }

        if (isCE) {
            document.execCommand("insertText", false, text);
            return true;
        }

        return false;
    }

    /**
     * Try to handle a Select All gesture against the
     * currently-focused element. Called by the native
     * macOS menu's Cmd-A dispatcher (src/menuActions.js).
     * Three branches:
     *
     *   - CodeMirror focus: invoke cm6's selectAll
     *     command, which selects the full document and
     *     keeps the editor's history coherent.
     *   - INPUT or TEXTAREA focus: call the element's
     *     own .select() method, which selects the entire
     *     value (single-line for INPUT, all lines for
     *     TEXTAREA).
     *   - contenteditable focus: fall back to
     *     document.execCommand("selectAll"), which
     *     extends the document selection across the
     *     editable region.
     *
     * Any other focus context returns false so the
     * dispatcher falls through to the canvas
     * performSelectAll.
     *
     * @returns {boolean}
     */
    trySelectAllInFocus() {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement)) return false;
        if (focused.closest(".cm-editor") !== null) {
            if (this.view !== null) {
                cmSelectAll(this.view);
                return true;
            }
            return false;
        }
        if (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA") {
            /** @type {HTMLInputElement | HTMLTextAreaElement} */ (focused).select();
            return true;
        }
        if (focused.isContentEditable) {
            document.execCommand("selectAll");
            return true;
        }
        return false;
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
            {
                key: "Ctrl-/",
                run: () => {
                    // Toggle the wrap state of the modifier
                    // chain at the cursor. On a single-line
                    // chain, breaks each dot-method onto its
                    // own indented line; on a wrapped chain,
                    // collapses back to one line. See
                    // _toggleModifierChainWrap for the
                    // detection and formatting rules. The
                    // explicit Ctrl- prefix (rather than
                    // Mod-) means this binds to physical
                    // Ctrl on every platform, not Cmd on
                    // Mac — we deliberately leave Mod-/
                    // (Cmd-/ on Mac) free for CodeMirror's
                    // built-in toggle-comment, which the
                    // composer relies on for the comment-
                    // out-and-clear gesture.
                    if (this._toggleModifierChainWrap()) return true;
                    return false;
                },
                preventDefault: true,
            },
            {
                key: "Enter",
                run: (view) => {
                    // Preserve the current line's leading
                    // whitespace when starting a new line.
                    // CodeMirror's default Enter binding
                    // (insertNewlineAndIndent) consults the
                    // active language's indent service,
                    // which can return a different indent
                    // than the current line's — sometimes
                    // deeper, sometimes zero, depending on
                    // syntax. The composer prefers the
                    // simpler "match the current line"
                    // rule so the indent level stays steady
                    // when editing inside an already-
                    // indented region and the cursor never
                    // lands at an unexpected column. Bound
                    // in appKeymap which sits before
                    // defaultKeymap in the keymap stack, so
                    // this binding consumes the keypress
                    // before the default Enter handler
                    // sees it.
                    const { state } = view;
                    const sel = state.selection.main;
                    const line = state.doc.lineAt(sel.from);
                    const leadingMatch = line.text.match(/^[ \t]*/);
                    const indent = leadingMatch !== null
                        ? leadingMatch[0]
                        : "";
                    view.dispatch({
                        changes: {
                            from: sel.from,
                            to: sel.to,
                            insert: "\n" + indent,
                        },
                        selection: {
                            anchor: sel.from + 1 + indent.length,
                        },
                        scrollIntoView: true,
                        userEvent: "input.type",
                    });
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
                drawSelection(),
                this._wrapCompartment.of(this._wrapExtensions()),
                this._readOnlyCompartment.of([]),
                indentOnInput(),
                indentUnit.of("    "),
                bracketMatching(),
                this._linterCompartment.of(jsSyntaxLinter),
                lintGutter(),
                this._strudelCompartment.of([]),
                keymap.of([
                    // completionKeymap sits ahead of
                    // appKeymap so its Enter binding
                    // accepts the highlighted completion
                    // when the popup is open. When the
                    // popup is closed, the binding returns
                    // false and the keypress falls through
                    // to appKeymap's preserve-indent Enter
                    // handler. The autocompletion()
                    // extension that lives inside
                    // _strudelCompartment also registers
                    // completionKeymap internally, but that
                    // registration sits after our explicit
                    // appKeymap in extension order at the
                    // same precedence level, so without this
                    // explicit-first placement our Enter
                    // would consume the keypress before the
                    // popup got to accept. completionKeymap
                    // bindings beyond Enter (arrow keys for
                    // navigation, Escape to close, etc.)
                    // are inactive when no completion is
                    // open and so don't conflict with
                    // anything else when the popup is
                    // silent or the Code tab isn't active.
                    ...completionKeymap,
                    ...appKeymap,
                    indentWithTab,
                    ...defaultKeymap,
                    ...historyKeymap,
                ]),
                // Semantic Code Speech Layer (Section 31).
                // Returns a DOM event handler tracking the
                // last pointer offset and a keymap binding
                // Mod-Shift-' to read the enclosing
                // ExpressionStatement at that offset. The
                // isCodeTab callback gates the keymap
                // command to behaviors.js / behaviours.js;
                // on any other tab the command returns
                // false so the keystroke falls through.
                ...codeSpeechExtension({
                    isCodeTab: () =>
                        this.activeName === "behaviors.js" ||
                        this.activeName === "behaviours.js",
                }),
                this._langCompartment.of(javascript()),
                ...customDarkTheme(),
                patternHighlightExtension(),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        this._onDocChanged(update.state.doc.toString());
                    }
                    // selectionSet fires on cursor moves and
                    // selection changes without document
                    // changes; docChanged fires on edits.
                    // Either one can move the cursor in or
                    // out of a labelled pattern block or a
                    // top-level function declaration, so we
                    // re-emit the cursor-target id set on
                    // either trigger. The acorn re-parse
                    // inside the helper is cheap for the
                    // size of behaviors.js files composers
                    // write; the same parse already runs on
                    // Mod-Enter and Ctrl-/ without a
                    // perceptible cost. A one-entry source-
                    // text cache can be added later if
                    // profiling shows it's worth it.
                    if (update.docChanged || update.selectionSet) {
                        this._emitCursorTargetIds();
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
     * Mount the canvas inspector into the canvas-inspector
     * area. Like _mountInspector, the CanvasInspector owns
     * its own DOM subtree; the editor's only job is to
     * show or hide the area when the Canvas tab becomes
     * active. main.js reaches this.canvasInspector after
     * construction to wire setCanvasSize and onSceneEdit,
     * the same wiring the toolbar used to expose before
     * the W/H field migration.
     */
    _mountCanvasInspector() {
        if (this.canvasInspectorArea === null) return;
        this.canvasInspector = new CanvasInspector(this.canvasInspectorArea);
    }

    /**
     * Show exactly one of the three editor-pane areas:
     * the CodeMirror editor area, the Properties
     * inspector area, or the Canvas inspector area. All
     * three occupy the same flex slot under the tab bar;
     * the .hidden class controls which one paints.
     * @param {"editor" | "inspector" | "canvas-inspector"} which
     */
    _showArea(which) {
        this.editorArea.classList.toggle("hidden", which !== "editor");
        if (this.inspectorArea !== null) {
            this.inspectorArea.classList.toggle("hidden", which !== "inspector");
        }
        if (this.canvasInspectorArea !== null) {
            this.canvasInspectorArea.classList.toggle("hidden", which !== "canvas-inspector");
        }
    }

    // --- Tab selection ---

    /**
     * @param {string} name
     */
    selectTab(name) {
        // Virtual inspector tab. No CodeMirror document swap;
        // we just show the inspector area and update the
        // tab-bar selection styling.
        if (name === VIRTUAL_TAB_INSPECTOR) {
            this.activeName = name;
            this._showArea("inspector");
            this._reconfigureStrudelCompartment();
            this._renderTabs();
            this._emitCursorTargetIds();
            return;
        }

        // Virtual Canvas tab. Same pattern: show the canvas-
        // inspector area, no CodeMirror swap.
        if (name === VIRTUAL_TAB_CANVAS) {
            this.activeName = name;
            this._showArea("canvas-inspector");
            this._reconfigureStrudelCompartment();
            this._renderTabs();
            this._emitCursorTargetIds();
            return;
        }

        const file = this.bundle.getFile(name);
        if (file === null || this.view === null) return;

        this.activeName = name;
        this._showArea("editor");

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
                this._strudelCompartment.reconfigure(
                    this._strudelExtensionsForActiveTab(),
                ),
            ],
        });
        this._suppressDirty = false;

        this._renderTabs();
        this._emitCursorTargetIds();
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
        this._showArea("editor");

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
                this._strudelCompartment.reconfigure(
                    this._strudelExtensionsForActiveTab(),
                ),
                EditorView.scrollIntoView(targetPos, { y: "start", yMargin: 0 }),
            ],
        });
        this._suppressDirty = false;

        this._renderTabs();
        this.view.focus();
        this._emitCursorTargetIds();
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
     * Switch to the Canvas tab. Equivalent to clicking
     * the Canvas tab in the tab bar: the CodeMirror
     * editor area and the Properties inspector area are
     * hidden, and the canvas-inspector area is shown.
     * Exposed symmetrically with selectInspectorTab so
     * future menu items or canvas gestures that want to
     * land on the Canvas tab have a clean entry point.
     */
    selectCanvasTab() {
        this.selectTab(VIRTUAL_TAB_CANVAS);
    }

    /**
     * Toggle the wrap state of the dot-method chain at the
     * cursor in behaviors.js / behaviours.js. The composer
     * uses this to break a long chain across multiple lines
     * for readability under high zoom, or collapse a wrapped
     * chain back into one line when horizontal space allows.
     *
     * Scope is the top-level statement containing the cursor.
     * Two statement shapes are handled:
     *
     *   - LabeledStatement whose body is an
     *     ExpressionStatement: e.g. `$CRV1: note("c4")
     *     .fast(2);`. The expression body's chain is the
     *     target.
     *   - Plain ExpressionStatement: e.g.
     *     `note("c4").fast(2);`. The expression's chain is
     *     the target.
     *
     * Other statement types fall through (return false). The
     * label tag and the trailing semicolon, if any, are
     * outside the replaced range and stay untouched.
     *
     * Chain extraction walks the AST from the outermost
     * CallExpression down through .callee.object so long as
     * each callee is a MemberExpression. The bottom of that
     * walk is the "base" (e.g. `note("c4")`), and the path
     * up gives the ordered modifier list (.fast(2),
     * .gain(0.5), ...). The modifier text for each step is
     * sliced from the source at the dot, so any leading
     * whitespace from a wrapped form is dropped and the
     * modifier reads as `.method(args)`.
     *
     * Nested chains inside argument lists (e.g.
     * .gain(perlin.range(0.5, 1))) are NOT touched. The
     * walker only follows the outermost chain's callee.
     * object spine; the argument list is copied verbatim
     * as part of the parent modifier's text.
     *
     * State detection: the chain is considered "wrapped"
     * iff at least one inter-modifier connector (the source
     * span between one element's end and the next dot)
     * contains a newline. Wrapped chains unwrap; unwrapped
     * chains wrap. Robust against unrelated multi-line
     * content like template literals in the base call's
     * arguments, since those never appear as connectors.
     *
     * Wrap formatting indents each modifier line by the
     * leading whitespace of the line containing the chain's
     * base, plus one indent unit (four spaces). So an
     * unindented top-level chain wraps to four-space-indented
     * modifier lines; a chain inside a function body indents
     * relative to that function's body indent level.
     *
     * Returns true if the keystroke was consumed (chain
     * found and reformatted, or chain present but empty so
     * nothing to do). Returns false if no chain expression
     * is present at the cursor; the Ctrl-/ handler then
     * leaves the keystroke unhandled and CodeMirror's
     * default keymap (which doesn't bind Ctrl-/ on Mac)
     * does whatever it would otherwise do.
     *
     * @returns {boolean}
     */
    _toggleModifierChainWrap() {
        if (this.view === null) return false;
        if (this.activeName !== "behaviors.js" &&
            this.activeName !== "behaviours.js") return false;
        const doc = this.view.state.doc;
        const source = doc.toString();
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
            // Whole-file syntax error: silently ignore.
            // The Mod-Enter / Run Scene path's load-fail
            // mechanism is the right place for the
            // diagnostic; surfacing it from Ctrl-/ would
            // be confusing.
            return false;
        }
        if (ast === null || !Array.isArray(ast.body)) return false;

        // Find the top-level statement that contains the
        // cursor. Loop rather than binary-search since
        // top-level statement counts are small and the
        // simplicity wins.
        let stmt = null;
        for (const node of ast.body) {
            if (cursorPos >= node.start && cursorPos <= node.end) {
                stmt = node;
                break;
            }
        }
        if (stmt === null) return false;

        // Extract the expression to reformat. LabeledStatement
        // wraps an inner statement; the typical strudel
        // authoring shape is a labelled block whose body is
        // an ExpressionStatement, so we unwrap one level.
        // Plain ExpressionStatement is also accepted for
        // callbacks that build their chain at top level.
        let expr;
        if (stmt.type === "LabeledStatement" &&
            stmt.body !== null &&
            stmt.body.type === "ExpressionStatement") {
            expr = stmt.body.expression;
        } else if (stmt.type === "ExpressionStatement") {
            expr = stmt.expression;
        } else {
            return false;
        }
        if (expr === null || expr === undefined) return false;

        // Walk the chain from the outermost CallExpression
        // down through .callee.object. Each step yields a
        // raw text span (potential whitespace before the
        // dot, then the .method(args) call). The connector
        // (the part before the dot) is used for wrap-state
        // detection; the method text is the wrapped or
        // unwrapped output.
        /** @type {Array<{connector: string, methodText: string}>} */
        const modifiers = [];
        let current = expr;
        while (current.type === "CallExpression" &&
               current.callee !== null &&
               current.callee.type === "MemberExpression") {
            const rawText = source.slice(
                current.callee.object.end,
                current.end,
            );
            const dotIdx = rawText.indexOf(".");
            // dotIdx should always be >= 0 for a valid AST,
            // but guard defensively against any pathological
            // input shape that slips past Acorn.
            if (dotIdx === -1) return false;
            const connector = rawText.slice(0, dotIdx);
            const methodText = rawText.slice(dotIdx);
            modifiers.unshift({ connector, methodText });
            current = current.callee.object;
        }
        if (modifiers.length === 0) return false;

        // current is now the base expression: the receiver
        // of the first .method() call.
        const baseText = source.slice(current.start, current.end);
        const exprStart = current.start;
        const exprEnd = expr.end;

        // Wrap state: any connector with a newline counts as
        // wrapped. A clean unwrapped chain has empty
        // connectors throughout.
        const isWrapped = modifiers.some(
            (m) => m.connector.indexOf("\n") !== -1,
        );

        // Indent for each wrapped modifier line: the line
        // indent of the line containing the base, plus one
        // indent unit. doc.lineAt returns the line containing
        // the given position; we extract its leading
        // whitespace and append four spaces.
        const baseLine = doc.lineAt(exprStart);
        const lineLeadingMatch = baseLine.text.match(/^[ \t]*/);
        const lineIndent = lineLeadingMatch !== null
            ? lineLeadingMatch[0]
            : "";
        const chainIndent = lineIndent + "    ";

        let newText;
        if (isWrapped) {
            // Unwrap. Concatenate base with each modifier's
            // method text, no inter-modifier whitespace.
            newText = baseText + modifiers.map((m) => m.methodText).join("");
        } else {
            // Wrap. Base, then each modifier on its own line
            // prefixed with chainIndent.
            const wrappedLines = modifiers.map(
                (m) => chainIndent + m.methodText,
            );
            newText = baseText + "\n" + wrappedLines.join("\n");
        }

        // Single dispatch so the change is one undo step.
        // The cursor lands at the start of the rewritten
        // expression. A more elaborate version could try to
        // preserve the cursor's logical position within the
        // chain, but the simpler behaviour is usable and
        // doesn't surprise the composer.
        this.view.dispatch({
            changes: {
                from: exprStart,
                to: exprEnd,
                insert: newText,
            },
        });
        return true;
    }

    /**
     * Detect whether the cursor in the active tab is inside
     * a top-level labelled pattern block (live or commented
     * out) and emit one of three callbacks accordingly. Two
     * paths run through here:
     *
     *   Promote path. Cursor sits inside a live labelled
     *   pattern block. The block may be a single
     *   $objectId: expression form or a chain of
     *   dollar-prefixed labels stacked in front of one
     *   expression statement (section 9). Walk the chain
     *   inward, collect every dollar-prefixed label, and
     *   emit onPromotePattern with the full list of
     *   objectIds plus the expression body text sliced
     *   from the source so the user's original whitespace
     *   and formatting carry through. The receiving handler
     *   applies the same cyclePattern to every named object
     *   in one applySceneEdit.
     *
     *   Clear path. Cursor sits inside a comment whose text
     *   matches the labelled-block shape — leading non-
     *   whitespace content of the form $id:. The user has
     *   commented out a labelled block as a textual
     *   "silence this source" gesture; the Cmd-Enter commits
     *   that intent to scene.json by clearing the matching
     *   object's cyclePattern. Edge case: if some OTHER live
     *   labelled block elsewhere in the file still defines
     *   the same id, clearing would silently drop the live
     *   block's pattern. To prevent that, scan the live
     *   blocks for the same id; if one exists, emit
     *   onClearPatternBlocked with the blocking block's 1-
     *   based line number so the messages area can point
     *   the user at the still-active version. Otherwise
     *   emit onClearPattern with the objectId. The regex
     *   anchors at start-of-content so a comment like
     *   `// Note that $CRV4: is a labelled block` doesn't
     *   false-match (the leading non-whitespace is "Note",
     *   not "$").
     *
     * Acorn's onComment option surfaces both line and block
     * comments with the same callback shape, so commenting
     * a labelled block with `// $id: ...` or
     * `/* $id: ... *\/` both work.
     *
     * Active only on behaviors.js / behaviours.js. The
     * labelled-statement convention is part of the behaviour
     * file's authoring surface per section 28; other tabs
     * (the virtual inspector, scene.json, any additional
     * text files) never trigger any of the callbacks here.
     *
     * Returns true iff one of the three callbacks fired.
     * The Mod-Enter handler uses the return value to decide
     * whether to consume the keypress (true) or fall
     * through to onRunScene (false). A whole-file Acorn
     * parse failure falls through to onRunScene, since
     * that path's load-fail mechanism is the right place
     * to surface the syntax-error diagnostic.
     *
     * @returns {boolean}
     */
    _tryPromoteLabelledBlock() {
        if (this.view === null) return false;
        if (this.activeName !== "behaviors.js" &&
            this.activeName !== "behaviours.js") return false;
        const source = this.view.state.doc.toString();
        const cursorPos = this.view.state.selection.main.head;

        // Collect comments alongside the AST so the clear
        // path below can probe whether the cursor sits
        // inside any. Acorn's onComment is the cheap way
        // to do this; no separate scan over the source is
        // needed.
        /** @type {Array<{value: string, start: number, end: number}>} */
        const comments = [];
        let ast;
        try {
            ast = acorn.parse(source, {
                ecmaVersion: 2022,
                sourceType: "script",
                allowReturnOutsideFunction: true,
                locations: false,
                onComment: (_block, text, start, end) => {
                    comments.push({ value: text, start, end });
                },
            });
        } catch (err) {
            // Whole-file syntax error: fall through to the
            // Run Scene gesture, whose load-fail path
            // surfaces the diagnostic.
            return false;
        }
        if (ast === null || !Array.isArray(ast.body)) return false;

        // Collect every live (uncommented) top-level
        // labelled pattern block, walking each top-level
        // LabeledStatement's chain inward and accepting
        // only chains where every label is dollar-prefixed
        // and the innermost body is an ExpressionStatement.
        // Each entry carries the full list of dollar-prefixed
        // labels along the chain plus the outer node for
        // cursor-containment checks and the pre-sliced
        // expressionText. The clear path searches across
        // all entries' objectIds for a still-defining-this-id
        // block elsewhere in the file when a commented-out
        // labelled block is Cmd-Entered.
        /** @type {Array<{objectIds: string[], node: any, lineNum: number, expressionText: string}>} */
        const liveBlocks = [];
        for (const node of ast.body) {
            if (node.type !== "LabeledStatement") continue;

            /** @type {string[]} */
            const objectIds = [];
            let current = node;
            let chainValid = true;
            while (current !== null && current.type === "LabeledStatement") {
                const lbl = current.label;
                if (lbl === null ||
                    lbl.type !== "Identifier" ||
                    typeof lbl.name !== "string" ||
                    !lbl.name.startsWith("$")) {
                    chainValid = false;
                    break;
                }
                objectIds.push(lbl.name.slice(1));
                current = current.body;
            }
            if (!chainValid) continue;
            if (current === null || current.type !== "ExpressionStatement") continue;
            const expr = current.expression;
            if (expr === null) continue;

            liveBlocks.push({
                objectIds,
                node,
                lineNum: this.view.state.doc.lineAt(node.start).number,
                expressionText: source.slice(expr.start, expr.end),
            });
        }

        // Promote path. Cursor inside any live labelled
        // block: emit onPromotePattern with the full list
        // of objectIds along the chain plus the expression
        // body text. Acorn's start/end are character
        // offsets into the source string; the check is
        // inclusive on both ends so a cursor immediately
        // after the block's closing punctuation still
        // counts as inside. For a single-label block the
        // list has one entry; for a chained block all
        // sharers get promoted in one applySceneEdit on
        // the receiving side.
        for (const lb of liveBlocks) {
            if (cursorPos < lb.node.start || cursorPos > lb.node.end) continue;
            this.onPromotePattern(lb.objectIds, lb.expressionText);
            return true;
        }

        // Clear path. Cursor inside a comment whose text
        // begins with $id: shape. The regex requires the
        // identifier to start with a letter or underscore
        // and contain only letters, digits, and
        // underscores after that, which is GXW's id
        // convention (SPR1, TRG1, CRV1) plus the
        // generality of any JS-identifier-shaped id a
        // hand-written scene.json might carry. Exotic
        // identifiers with dollar signs in the middle
        // wouldn't round-trip cleanly anyway since they
        // are vanishingly rare in user-authored scores.
        for (const c of comments) {
            if (cursorPos < c.start || cursorPos > c.end) continue;
            const m = /^\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*:/.exec(c.value);
            if (m === null) continue;
            const objectId = m[1];
            const blocking = liveBlocks.find((lb) => lb.objectIds.includes(objectId));
            if (blocking !== undefined) {
                this.onClearPatternBlocked(objectId, blocking.lineNum);
            } else {
                this.onClearPattern(objectId);
            }
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
        // bundle.updateContent fires markDirty internally, which
        // propagates back to this editor's onDirtyChange via the
        // bundle subscription — no separate _setDirty call needed.
        const wasFileDirty = this.bundle.isFileDirty(this.activeName);
        this.bundle.updateContent(this.activeName, content);
        // Per-tab dot for the active file may have just
        // transitioned (clean→dirty on the first keystroke
        // after save, or dirty→clean if an undo restored
        // the saved content). Re-render only on transition
        // so steady-state typing doesn't rebuild the tab bar
        // on every keystroke.
        if (wasFileDirty !== this.bundle.isFileDirty(this.activeName)) {
            this._renderTabs();
        }
    }

    // --- Tab rendering ---

    /**
     * Render the tab bar. Two virtual tabs come first —
     * Properties (form inspector) and Canvas (scene-level
     * canvas chrome per DESIGN.md Section 13.5), neither
     * of which backs onto a file in the bundle. Then the
     * Code tabs (behaviors.js / behaviours.js) for the
     * authored source. Last comes scene.json, rendered
     * with an empty label — a deliberately anonymous
     * fallback tab the user can still click to reach the
     * raw JSON view, kept around for hand-editing fields
     * the Properties inspector doesn't yet cover. Any
     * other text files in the bundle (rare; resources
     * the user has added) follow in their natural order
     * after the pinned tabs.
     */
    _renderTabs() {
        this.tabBar.innerHTML = "";

        // Virtual Properties tab (form inspector).
        this.tabBar.appendChild(
            this._renderVirtualTab(
                VIRTUAL_TAB_INSPECTOR,
                "Properties",
                /* dirtyBackingFile */ "scene.json",
            ),
        );

        // Virtual Canvas tab. Selection-independent
        // scene-level chrome; doesn't carry a dirty dot
        // because the Properties and J tabs already
        // surface scene.json's dirty state and a third
        // signal for the same backing file would just
        // duplicate the cue.
        this.tabBar.appendChild(
            this._renderVirtualTab(
                VIRTUAL_TAB_CANVAS,
                "Canvas",
                /* dirtyBackingFile */ null,
            ),
        );

        // File tabs in display order. Code tabs first so
        // the composer reads function declarations and
        // pattern blocks before the declarative scene data,
        // and so the anonymous scene.json tab sits at the
        // far right where it doesn't draw the eye. Both
        // legacy and v2.4 behaviour filenames are listed so
        // a bundle in either state renders correctly during
        // the migration window.
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
     * Build a tab element for a virtual (file-less) tab.
     * Virtual tabs include Properties (the form inspector)
     * and Canvas (the canvas-inspector). dirtyBackingFile,
     * if provided, names the bundle file whose per-file
     * dirty state lights this tab's dirty dot — used by
     * the Properties tab to track scene.json. Pass null
     * for tabs that never carry a dirty dot regardless of
     * underlying state, like Canvas.
     * @param {string} virtualName
     * @param {string} label
     * @param {string | null} dirtyBackingFile
     * @returns {HTMLDivElement}
     */
    _renderVirtualTab(virtualName, label, dirtyBackingFile) {
        const el = document.createElement("div");
        el.className = "tab";
        if (virtualName === this.activeName) {
            el.classList.add("tab-selected");
            el.setAttribute("aria-selected", "true");
        } else {
            el.setAttribute("aria-selected", "false");
        }
        if (dirtyBackingFile !== null &&
            this.bundle.isFileDirty(dirtyBackingFile)) {
            el.classList.add("tab-dirty");
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
        if (this.bundle.isFileDirty(name)) {
            el.classList.add("tab-dirty");
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
