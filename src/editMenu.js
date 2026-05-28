/**
 * Edit menu.
 *
 * Hosts the canvas-edit history commands (Undo, Redo) and
 * the Duplicate command, plus their keyboard shortcuts. The
 * menu sits between File and View in the menubar and follows
 * the same install pattern as the other GXW menus
 * (viewMenu.js, fileMenu.js, runMenu.js, appMenu.js).
 *
 * Keyboard shortcuts. Cmd-Z (Undo) and Cmd-Shift-Z (Redo)
 * listen at the window level with a focus filter that skips
 * text-editing surfaces \u2014 CodeMirror inside the Code tab,
 * INPUT and TEXTAREA fields, and any contenteditable
 * element \u2014 so those surfaces continue to handle their
 * own native undo. Cmd-D (Duplicate) shares the same filter
 * but always calls preventDefault so the browser doesn't
 * fall through to its bookmark-this-page default when the
 * focus filter declines the action.
 *
 * The commands are passed in as context callbacks so this
 * module stays decoupled from main.js's undo-stack state
 * and canvas reference. main.js owns performUndo,
 * performRedo, and performDuplicate; the menu just wires
 * the user-facing surfaces (dropdown items and key
 * shortcuts) to those callbacks.
 */

// @ts-check

import { buildDropdown, findMenuItem, wireDropdown } from "./menuUtil.js";

/**
 * @typedef {Object} EditMenuContext
 * @property {() => void} performUndo
 * @property {() => void} performRedo
 * @property {() => void} performDuplicate
 * @property {() => void} performCut
 * @property {() => void} performCopy
 * @property {() => void} performPaste
 * @property {() => void} performSelectAll
 */

/**
 * Return true when the event target is a text-editing
 * surface that should handle its own keyboard input
 * (CodeMirror, native form fields, contenteditable
 * regions). Used by the Cmd-Z and Cmd-D handlers to avoid
 * stealing keystrokes from text-input contexts.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function inTextEditingContext(e) {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest(".cm-editor") !== null) return true;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
    if (target.isContentEditable) return true;
    return false;
}

/**
 * @param {EditMenuContext} ctx
 */
export function installEditMenu(ctx) {
    const editItem = findMenuItem("Edit");
    if (editItem === null) {
        console.error("GXW: Edit menu item not found.");
        return;
    }

    const dropdown = buildDropdown([
        {
            label: "Undo",
            shortcut: "\u2318Z",
            action: () => ctx.performUndo(),
        },
        {
            label: "Redo",
            shortcut: "\u21E7\u2318Z",
            action: () => ctx.performRedo(),
        },
        { separator: true },
        {
            label: "Cut",
            shortcut: "\u2318X",
            action: () => ctx.performCut(),
        },
        {
            label: "Copy",
            shortcut: "\u2318C",
            action: () => ctx.performCopy(),
        },
        {
            label: "Paste",
            shortcut: "\u2318V",
            action: () => ctx.performPaste(),
        },
        {
            label: "Select All",
            shortcut: "\u2318A",
            action: () => ctx.performSelectAll(),
        },
        { separator: true },
        {
            label: "Duplicate",
            shortcut: "\u2318D",
            action: () => ctx.performDuplicate(),
        },
    ]);

    document.body.appendChild(dropdown);
    wireDropdown(editItem, dropdown);

    // Cmd-Z (Undo) and Cmd-Shift-Z (Redo). In text-editing
    // contexts we return early WITHOUT preventDefault so the
    // browser's native undo (CodeMirror's edit history,
    // contenteditable undo, INPUT/TEXTAREA undo) handles the
    // keystroke as the user expects.
    window.addEventListener("keydown", (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        if (e.key.toLowerCase() !== "z") return;
        if (inTextEditingContext(e)) return;
        e.preventDefault();
        if (e.shiftKey) {
            ctx.performRedo();
        } else {
            ctx.performUndo();
        }
    });

    // Cmd-D (Duplicate). The browser's default behaviour
    // for Cmd-D is "bookmark this page", which is never the
    // right outcome inside GXW \u2014 even in text-editing
    // contexts where Duplicate doesn't fire, we'd rather
    // suppress the bookmark dialog than let it appear. So
    // preventDefault runs unconditionally and the focus
    // filter only decides whether to invoke performDuplicate
    // afterwards.
    window.addEventListener("keydown", (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        if (e.key.toLowerCase() !== "d") return;
        if (e.shiftKey) return;
        e.preventDefault();
        if (inTextEditingContext(e)) return;
        ctx.performDuplicate();
    });

    // Cmd-X / Cmd-C / Cmd-V / Cmd-A (Cut, Copy, Paste,
    // Select All). In text-editing contexts we return
    // WITHOUT preventDefault so the browser's native
    // clipboard handling and select-all behaviour fire
    // normally (INPUT and TEXTAREA selection, CodeMirror's
    // own cut/copy/paste, contenteditable selection).
    // Outside text contexts the keystroke acts on the
    // canvas selection, mirroring the same focus filter
    // used by Cmd-Z above.
    //
    // Bound here only for the web build; the Electron
    // build skips installEditMenu entirely (see main.js)
    // and routes the four shortcuts through the native
    // menu's custom items in electron-menu.js. The
    // renderer-side dispatcher in menuActions.js then
    // delegates to the editor's text-context handlers or
    // the canvas performs, mirroring this branch's logic.
    window.addEventListener("keydown", (e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        if (e.shiftKey || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key !== "x" && key !== "c" && key !== "v" && key !== "a") return;
        if (inTextEditingContext(e)) return;
        e.preventDefault();
        if (key === "x") ctx.performCut();
        else if (key === "c") ctx.performCopy();
        else if (key === "v") ctx.performPaste();
        else if (key === "a") ctx.performSelectAll();
    });
}
