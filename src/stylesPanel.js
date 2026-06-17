/**
 * Styles panel — the "Styles" tab (design/styles.md).
 *
 * Two style libraries under one tab: VOICE styles (vStyles) and RHYTHM styles
 * (rStyles). A segmented control at the top picks which kind the rest of the tab
 * edits; below it a named list (built-ins shown read-only, then the user's), and
 * below that the editor for the selected style.
 *
 * THIS COMMIT is the scaffold: the segmented control, the voice list (built-ins
 * + user voice styles from styleStore), and a placeholder editor. The voice
 * editor form (identity / pitch / drivers / rhythm bands), the reusable
 * driver-row widget, and the sandbox-buffer + Save model land in the next slice.
 * The Rhythm side is a "coming soon" placeholder until the rStyle work.
 *
 * Structurally mirrors HarmonyPanel / CanvasInspector: the panel owns its DOM
 * subtree inside a container the editor hands it, exposes a small wiring contract
 * for the edit pipeline (main.js), and a refresh() the editor calls when the tab
 * activates so a style created elsewhere appears without an app restart.
 *
 * DOM-only at render time plus pure-library imports, so it's node --checkable.
 */

// @ts-check

import { listStyles } from "./styleStore.js";
import { styles as BUILTIN_STYLES } from "./harmonyMelody.js";

/** The two sound-generation categories, chosen by the Voice Style radio pair. */
const KINDS = [
    { key: "melodic", label: "Melodic" },
    { key: "rhythmic", label: "Rhythmic" },
];

/**
 * Built-in melodic style names offered in the chooser. "melodic" is excluded —
 * it's now the top-level CATEGORY, not a named style (its line is the engine's
 * implicit default for the category, reached by leaving a slot's style on
 * Default). So only the specific built-ins (bass, lead) are named here.
 */
const BUILTIN_VOICE_NAMES = Object.keys(BUILTIN_STYLES).filter((n) => n !== "melodic");

export class StylesPanel {
    /**
     * @param {HTMLElement} container  Element to mount the panel in.
     */
    constructor(container) {
        this.container = container;

        /**
         * Save callback wired by main.js. Receives a style record
         * { type, name, def } to persist to the library. Null until wired.
         * @type {((record: { type: string, name: string, def: any }) => void) | null}
         */
        this._onSaveStyle = null;
        /**
         * Delete callback wired by main.js. Receives (type, name). Null until wired.
         * @type {((type: string, name: string) => void) | null}
         */
        this._onDeleteStyle = null;

        // --- State ---
        /** Which category the tab is editing. @type {"melodic" | "rhythmic"} */
        this._kind = "melodic";
        /** Selected style name, or null. @type {string | null} */
        this._selected = null;

        // --- DOM handles (filled by _render) ---
        /** @type {HTMLSelectElement | null} */
        this._selectEl = null;
        /** @type {HTMLButtonElement | null} */
        this._dupBtn = null;
        /** @type {HTMLButtonElement | null} */
        this._delBtn = null;
        /** @type {HTMLElement | null} */
        this._editorEl = null;

        this._render();
    }

    /** Wire the save-style edit callback (main.js owns persistence + re-run). */
    onSaveStyle(cb) { this._onSaveStyle = cb; }
    /** Wire the delete-style edit callback. */
    onDeleteStyle(cb) { this._onDeleteStyle = cb; }

    /** Re-read the library and rebuild. Called by the editor on tab activation. */
    refresh() { this._render(); }

    /** Full re-render from current state + library. */
    _render() {
        this.container.innerHTML = "";

        // 1) Voice Style category: Melodic | Rhythmic (radio pair).
        this.container.appendChild(this._buildKindRow());

        if (this._kind === "rhythmic") {
            // Rhythmic side is a placeholder until the rStyle work lands.
            const hint = document.createElement("p");
            hint.className = "styles-placeholder-hint";
            hint.textContent = "Rhythmic styles are coming soon.";
            this.container.appendChild(hint);
            return;
        }

        // 2) The compact style chooser (dropdown + actions on one row).
        this.container.appendChild(this._buildChooserRow());

        // 3) The editor for the selected style (placeholder this slice).
        const editor = document.createElement("div");
        editor.className = "styles-editor";
        this._editorEl = editor;
        this.container.appendChild(editor);
        this._renderEditor();
    }

    /** The "Voice Style" label + the Melodic | Rhythmic radio pair (exclusive). */
    _buildKindRow() {
        const row = document.createElement("div");
        row.className = "styles-kindrow";

        const label = document.createElement("span");
        label.className = "styles-kindrow-label";
        label.textContent = "Voice Style";
        row.appendChild(label);

        for (const k of KINDS) {
            const wrap = document.createElement("label");
            wrap.className = "styles-radio";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "styles-kind";
            input.value = k.key;
            input.checked = this._kind === k.key;
            input.addEventListener("change", () => {
                if (!input.checked || this._kind === k.key) return;
                this._kind = /** @type {"melodic" | "rhythmic"} */ (k.key);
                this._selected = null;
                this._render();
            });
            wrap.appendChild(input);
            wrap.appendChild(document.createTextNode(" " + k.label));
            row.appendChild(wrap);
        }
        return row;
    }

    /**
     * The compact style chooser: a dropdown of voice-style names (built-ins,
     * then the user's) plus New / Duplicate / Delete, all on one row, so the
     * editor below gets the vertical room. Built-ins can't be deleted.
     */
    _buildChooserRow() {
        const row = document.createElement("div");
        row.className = "styles-chooser";

        const nameLabel = document.createElement("span");
        nameLabel.className = "styles-chooser-label";
        nameLabel.textContent = "Voice Name";
        row.appendChild(nameLabel);

        const select = document.createElement("select");
        select.className = "styles-chooser-select";
        select.title = "The voice style to edit.";
        select.addEventListener("change", () => {
            this._selected = select.value || null;
            this._syncChooser();
            this._renderEditor();
        });
        this._selectEl = select;
        row.appendChild(select);

        row.appendChild(this._chooserButton("New", "Create a new voice style.",
            () => this._onNew()));
        this._dupBtn = this._chooserButton("Duplicate", "Copy the selected style to a new one.",
            () => { if (this._selected !== null) this._onDuplicate(this._selected); });
        row.appendChild(this._dupBtn);
        this._delBtn = this._chooserButton("Delete", "Delete the selected custom style.",
            () => { if (this._selected !== null) this._onDelete(this._selected); });
        this._delBtn.classList.add("danger");
        row.appendChild(this._delBtn);

        this._syncChooser();
        return row;
    }

    /**
     * @param {string} label @param {string} title @param {() => void} onClick
     * @returns {HTMLButtonElement}
     */
    _chooserButton(label, title, onClick) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "styles-chooser-btn";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", onClick);
        return b;
    }

    /** (Re)fill the dropdown options (built-ins, then custom) and update the
     *  action-button enabled states. Defaults the selection to the first
     *  built-in when nothing is selected. */
    _syncChooser() {
        const select = this._selectEl;
        if (select === null) return;
        select.innerHTML = "";

        const builtinGroup = document.createElement("optgroup");
        builtinGroup.label = "Built-in";
        for (const name of BUILTIN_VOICE_NAMES) builtinGroup.appendChild(this._option(name));
        select.appendChild(builtinGroup);

        const userRecords = listStyles("voice");
        if (userRecords.length > 0) {
            const userGroup = document.createElement("optgroup");
            userGroup.label = "Custom";
            for (const rec of userRecords) userGroup.appendChild(this._option(rec.name));
            select.appendChild(userGroup);
        }

        if (this._selected === null) this._selected = BUILTIN_VOICE_NAMES[0] || null;
        if (this._selected !== null) select.value = this._selected;

        const isUser = userRecords.some((r) => r.name === this._selected);
        if (this._delBtn !== null) this._delBtn.disabled = !isUser;
        if (this._dupBtn !== null) this._dupBtn.disabled = this._selected === null;
    }

    /** @param {string} name @returns {HTMLOptionElement} */
    _option(name) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        return opt;
    }

    /** Render the editor pane for the selected style (placeholder this slice). */
    _renderEditor() {
        const el = this._editorEl;
        if (el === null) return;
        el.innerHTML = "";
        if (this._selected === null) {
            const hint = document.createElement("div");
            hint.className = "styles-editor-empty";
            hint.textContent = "Select a voice style to edit, or create one with New.";
            el.appendChild(hint);
            return;
        }
        const note = document.createElement("div");
        note.className = "styles-editor-placeholder";
        note.textContent = `Editing "${this._selected}" — the voice editor form lands in the next slice.`;
        el.appendChild(note);
    }

    // --- Edit actions (sandbox + Save model arrives with the editor slice) ---

    _onNew() {
        // The sandbox-buffer editor lands next; for now this is a no-op stub.
    }

    /** @param {string} _name */
    _onDuplicate(_name) {
        // Duplicate-into-sandbox lands with the editor slice.
    }

    /** @param {string} name */
    _onDelete(name) {
        if (BUILTIN_VOICE_NAMES.includes(name)) return;   // built-ins aren't deletable
        if (this._onDeleteStyle !== null) this._onDeleteStyle("voice", name);
        if (this._selected === name) this._selected = null;
        this._syncChooser();
        this._renderEditor();
    }
}
