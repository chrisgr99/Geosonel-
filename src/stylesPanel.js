/**
 * Styles panel — the "vStyles" tab (design/styles.md).
 *
 * Under the vStyle umbrella, two subtypes share one tab: melodic (mStyle) and
 * rhythmic (rStyle). A "Voice Style" label + Melodic | Rhythmic radio pair picks
 * the subtype; below it a compact "Voice Name" chooser, and below that the
 * editor for the selected style.
 *
 * THIS SLICE: the Mode A (library) melodic editor — Identity / Pitch / Drivers /
 * Dynamics / Rhythm bands, numeric spinner fields, the driver-row control, a
 * sandbox buffer with a Save / Revert footer, and per-band Advanced expanders.
 * Field colours match the Properties inspector exactly (#646464 fields / #789678
 * border / #3e3e3e panel).
 * Mode B live editing (the LIVE banner, immediate apply, in-use chooser entries)
 * and the rhythmic (rStyle) editor are later slices.
 *
 * Editing is sandboxed: selecting a style loads a deep copy of its SERIALISED
 * form (serializeMStyle JSON), the form edits that copy, and nothing reaches the
 * library until Save. Built-ins are never overwritten in place — saving an edited
 * built-in writes a user style.
 *
 * DOM-only at render time plus pure-library imports, so it's node --checkable.
 */

// @ts-check

import { listStyles, getStyleRecord } from "./styleStore.js";
import { styles as BUILTIN_STYLES, SCALES } from "./harmonyMelody.js";
import { MStyle, serializeMStyle, materializeMStyle } from "./mStyle.js";

/**
 * Built-in melodic style names offered in the chooser. "melodic" is excluded —
 * it's now the top-level CATEGORY, not a named style (its line is the engine's
 * implicit default, reached by leaving a slot's style on Default). So only the
 * specific built-ins (bass, lead) are named here.
 */
const BUILTIN_MELODIC_NAMES = Object.keys(BUILTIN_STYLES).filter((n) => n !== "melodic");

/**
 * Seed built-in RHYTHMIC styles for the chooser. They reuse the MStyle field set
 * (there is NO separate rStyle class) — the editor simply omits the pitch fields.
 * A couple of simple voices so the Rhythmic dropdown isn't empty.
 */
const BUILTIN_RHYTHMIC = {
    kick: new MStyle({
        role: "foundation", articulation: 0.3, accentResponse: 1.3,
        rhythm: { density: 0.35, syncopation: 0.05, imageInfluence: 0.4, accent: 0.7, ratchets: 0.0 },
    }),
    hat: new MStyle({
        role: "pulse", articulation: 0.2, accentResponse: 1.0,
        rhythm: { density: 0.8, syncopation: 0.15, imageInfluence: 0.5, accent: 0.4, ratchets: 0.1 },
    }),
};
const BUILTIN_RHYTHMIC_NAMES = Object.keys(BUILTIN_RHYTHMIC);

/** The ten colour channels a "Colour" driver can read. */
const CHANNELS = ["lt", "chr", "r", "g", "y", "b", "or", "li", "cy", "pu"];

/** Scale options: "key" (follow the song mode) first, then the named scales. */
const SCALE_OPTIONS = ["key", ...Object.keys(SCALES)];

/** Musical-role options — the voice's function in the ensemble. Shared by both
 *  style kinds. "none" = a free voice with no declared role. */
const ROLE_OPTIONS = [
    { value: "none", label: "None / Free" },
    { value: "foundation", label: "Foundation" },
    { value: "pulse", label: "Pulse" },
    { value: "accent", label: "Accent" },
    { value: "lead", label: "Lead" },
    { value: "pad", label: "Pad" },
    { value: "fill", label: "Fill" },
    { value: "counter", label: "Counter" },
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** MIDI number → note name, e.g. 60 → "C4". */
function noteName(midi) {
    const m = Math.round(Number(midi));
    if (!Number.isFinite(m)) return "";
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

const clamp01 = (v) => { const n = Number(v); return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n; };
const deepCopy = (x) => JSON.parse(JSON.stringify(x));
const isIdentifier = (s) => typeof s === "string" && /^[A-Za-z_$][\w$]*$/.test(s);

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
        /** The Type (kind) being edited; the Name list is filtered to it.
         *  @type {"melodic" | "rhythmic"} */
        this._kind = "melodic";
        /** True for the one re-render after a Type change, so the Pitch band slides
         *  instead of snapping. @type {boolean} */
        this._animatePitchNext = false;
        /** The currently-loaded saved style name, or null. @type {string | null} */
        this._selected = null;

        // Sandbox: the serialised def being edited (a deep copy), plus the base
        // it came from for the dirty comparison.
        /** @type {any} */
        this._sandbox = null;
        /** @type {string} */
        this._sandboxName = "";
        /** @type {string | null} */
        this._baseName = null;
        /** @type {string} JSON of the base serialised def. */
        this._baseSerialized = "";
        /** True when editing a brand-new (unsaved) style. */
        this._isNew = false;
        /** Per-band Advanced expander open-state. @type {Record<string, boolean>} */
        this._advancedOpen = {};

        // --- DOM handles ---
        /** @type {HTMLSelectElement | null} */
        this._selectEl = null;
        /** @type {HTMLButtonElement | null} */
        this._dupBtn = null;
        /** @type {HTMLButtonElement | null} */
        this._delBtn = null;
        /** @type {HTMLElement | null} */
        this._editorEl = null;
        /** The Pitch Tendencies band element, kept so the radio can slide it
         *  open/closed in place (rhythmic = closed). @type {HTMLElement | null} */
        this._pitchBandEl = null;
        /** @type {HTMLButtonElement | null} */
        this._saveBtn = null;
        /** @type {HTMLButtonElement | null} */
        this._revertBtn = null;

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

        // 1) Top row: Type + Name + the icon action buttons, all on one centred row.
        this.container.appendChild(this._buildTopRow());
        // 2) Fill the Name dropdown (filtered to the current Type) + a default.
        if (this._isNew) {
            if (this._dupBtn !== null) this._dupBtn.disabled = true;
            if (this._delBtn !== null) this._delBtn.disabled = true;
        } else {
            this._syncChooser();
        }
        // 4) Load the sandbox for the current selection.
        if (this._sandbox === null && !this._isNew && this._selected !== null) {
            this._loadSandbox(this._selected);
        }
        const editor = document.createElement("div");
        editor.className = "styles-editor";
        this._editorEl = editor;
        this.container.appendChild(editor);
        this._renderEditor();
        this._refreshFooter();
        this._animatePitchNext = false;
    }

    /** Top row: a narrow "Type" dropdown + the "Name" field + the icon action
     *  buttons (New / Duplicate / Save / Revert / Delete), all on one centred row.
     *  Changing Type filters the Name list to that kind, loads its first style, and
     *  slides the Pitch band open/closed. */
    _buildTopRow() {
        const wrap = document.createElement("div");
        wrap.className = "styles-chooser-block";

        // Line 1: Style Type. Uses the editor's 80px right-aligned label column so
        // its dropdown lines up with Voice Name (below) and Voice Role (in the
        // editor) and the rest of the bands.
        const typeRow = document.createElement("div");
        typeRow.className = "styles-row";
        typeRow.appendChild(this._fieldLabel("Style Type"));
        const typeSel = document.createElement("select");
        typeSel.className = "styles-select styles-type";
        for (const [val, label] of [["melodic", "Melodic"], ["rhythmic", "Rhythmic"]]) {
            const o = document.createElement("option");
            o.value = val; o.textContent = label;
            typeSel.appendChild(o);
        }
        typeSel.value = this._kind;
        typeSel.title = "Melodic styles have a Pitch section; rhythmic styles don't.";
        typeSel.addEventListener("change", () => this._onChangeType(typeSel.value));
        typeRow.appendChild(typeSel);
        wrap.appendChild(typeRow);

        // Line 2: Voice Name + the icon action buttons.
        const nameRow = document.createElement("div");
        nameRow.className = "styles-row styles-namerow";
        nameRow.appendChild(this._fieldLabel("Voice Name"));
        this._selectEl = null;
        if (this._isNew) {
            // A new / duplicated style: the name is TYPED here.
            const inp = document.createElement("input");
            inp.type = "text";
            inp.className = "styles-text styles-name";
            inp.placeholder = "myVoice";
            inp.value = this._sandboxName || "";
            const validate = () => inp.classList.toggle("invalid", inp.value !== "" && !isIdentifier(inp.value));
            inp.addEventListener("input", () => { this._sandboxName = inp.value; validate(); this._refreshFooter(); });
            validate();
            nameRow.appendChild(inp);
        } else {
            const select = document.createElement("select");
            select.className = "styles-chooser-select";
            select.title = "The style to edit (filtered by Type).";
            select.addEventListener("change", () => this._selectStyle(select.value));
            this._selectEl = select;
            nameRow.appendChild(select);
        }
        nameRow.appendChild(this._iconButton("＋", "New — create a new style.", () => this._onNew()));
        this._dupBtn = this._iconButton("⧉", "Duplicate — copy to a new style.",
            () => { if (this._selected !== null) this._onDuplicate(this._selected); });
        nameRow.appendChild(this._dupBtn);
        this._saveBtn = this._iconButton("✓", "Save changes to this style.", () => this._onSave());
        nameRow.appendChild(this._saveBtn);
        this._revertBtn = this._iconButton("↺", "Revert — discard changes.", () => this._onRevert());
        nameRow.appendChild(this._revertBtn);
        this._delBtn = this._iconButton("✕", "Delete the selected custom style.",
            () => { if (this._selected !== null) this._onDelete(this._selected); });
        this._delBtn.classList.add("danger");
        nameRow.appendChild(this._delBtn);
        wrap.appendChild(nameRow);

        return wrap;
    }

    /** A compact icon button (the action buttons in the top row). The glyph shows;
     *  the action name is the hover tooltip.
     *  @param {string} glyph @param {string} title @param {() => void} onClick
     *  @returns {HTMLButtonElement} */
    _iconButton(glyph, title, onClick) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "styles-chooser-btn styles-icon-btn";
        b.textContent = glyph;
        b.title = title;
        b.addEventListener("click", onClick);
        return b;
    }

    /** Switch the Type (kind): filter the Name list to that kind, load its first
     *  style, and slide the Pitch band open/closed. @param {string} kind */
    _onChangeType(kind) {
        if (kind === this._kind) return;
        this._kind = /** @type {"melodic" | "rhythmic"} */ (kind);
        this._selected = null;
        this._sandbox = null;
        this._isNew = false;
        this._animatePitchNext = true;   // slide the Pitch band during the re-render
        this._render();
    }


    /** (Re)fill the Name dropdown with the CURRENT kind's styles (built-ins, then
     *  the user's) and update the Duplicate/Delete states. Filtered by Type. */
    _syncChooser() {
        const select = this._selectEl;
        if (select === null) return;
        select.innerHTML = "";

        const builtinGroup = document.createElement("optgroup");
        builtinGroup.label = "Built-in";
        for (const name of this._builtinNames()) builtinGroup.appendChild(this._option(name));
        select.appendChild(builtinGroup);

        const userRecords = listStyles(this._kind);
        if (userRecords.length > 0) {
            const userGroup = document.createElement("optgroup");
            userGroup.label = "Custom";
            for (const rec of userRecords) userGroup.appendChild(this._option(rec.name));
            select.appendChild(userGroup);
        }

        if (this._selected === null) this._selected = this._builtinNames()[0] || null;
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

    /** Built-in style names for the current kind. @returns {string[]} */
    _builtinNames() {
        return this._kind === "rhythmic" ? BUILTIN_RHYTHMIC_NAMES : BUILTIN_MELODIC_NAMES;
    }

    /** The built-in MStyle for `name` in the current kind (or undefined). */
    _builtinStyle(name) {
        return this._kind === "rhythmic" ? BUILTIN_RHYTHMIC[name] : BUILTIN_STYLES[name];
    }

    // --- Sandbox lifecycle ---------------------------------------------------

    /** Load `name`'s serialised def into the sandbox (normalised through MStyle
     *  so partial/older user defs fill their defaults). @param {string} name */
    _loadSandbox(name) {
        let def;
        if (this._builtinNames().includes(name)) {
            def = serializeMStyle(this._builtinStyle(name));
        } else {
            const rec = getStyleRecord(this._kind, name);
            def = rec ? serializeMStyle(materializeMStyle(rec.def)) : serializeMStyle(new MStyle());
        }
        this._sandbox = deepCopy(def);
        this._baseSerialized = JSON.stringify(def);
        this._baseName = name;
        this._sandboxName = name;
        this._isNew = false;
    }

    /** @param {string} name  Select a style of the current kind and load it. */
    _selectStyle(name) {
        this._loadSandbox(name);
        this._selected = name;
        this._render();
    }

    /** Whether the sandbox's values diverge from the base they were loaded from. */
    _isDirty() {
        if (this._sandbox === null) return false;
        return JSON.stringify(this._sandbox) !== this._baseSerialized;
    }

    /** Called on every edit: refresh the footer + the chooser's dirty marker. */
    _markDirty() {
        this._refreshFooter();
        this._updateChooserDirtyMarker();
    }

    _updateChooserDirtyMarker() {
        const sel = this._selectEl;
        if (sel === null || this._isNew || this._baseName === null) return;
        const dirty = this._isDirty() || this._sandboxName !== this._baseName;
        const opt = sel.options[sel.selectedIndex];
        if (opt !== undefined && opt !== null) {
            opt.textContent = this._baseName + (dirty ? " *" : "");
        }
    }

    // --- The editor form -----------------------------------------------------

    _renderEditor() {
        const el = this._editorEl;
        if (el === null) return;
        el.innerHTML = "";
        if (this._sandbox === null) {
            const hint = document.createElement("div");
            hint.className = "styles-editor-empty";
            hint.textContent = "Select a voice style to edit, or create one with New.";
            el.appendChild(hint);
            return;
        }
        const s = this._sandbox;
        this._buildRoleBand(el, s);
        const divider = document.createElement("div");
        divider.className = "styles-divider";
        el.appendChild(divider);
        // One form for both kinds: the Pitch band always renders; it's collapsed
        // (hidden) for a rhythmic style so the bands below move up under the Sound
        // section. The slide animates only on a radio toggle (below), not here.
        this._buildPitchBand(el, s);
        this._buildVelocityBand(el, s);
        this._buildSustainBand(el, s);
        this._buildRhythmBand(el, s);
        this._setPitchCollapsed(this._kind === "rhythmic", this._animatePitchNext === true);
        this._updateChooserDirtyMarker();
    }

    /**
     * Show/hide the Pitch band by sliding its height (and margin/opacity) — closed
     * for a rhythmic style, open for melodic. The bands below reflow up or down to
     * follow. `animate` false snaps to the state (initial render); true plays the
     * ~200ms slide (a radio toggle).
     * @param {boolean} collapsed @param {boolean} animate
     */
    _setPitchCollapsed(collapsed, animate) {
        const band = this._pitchBandEl;
        if (band === null) return;
        band.style.overflow = "hidden";
        if (!animate) {
            band.style.transition = "";
            band.style.height = collapsed ? "0px" : "auto";
            band.style.marginBottom = collapsed ? "0px" : "";
            band.style.opacity = collapsed ? "0" : "1";
            return;
        }
        const TRANS = "height 200ms ease, margin-bottom 200ms ease, opacity 200ms ease";
        if (collapsed) {
            band.style.height = band.scrollHeight + "px";   // pin the start height
            void band.offsetHeight;                          // commit it (reflow)
            band.style.transition = TRANS;
            band.style.height = "0px";
            band.style.marginBottom = "0px";
            band.style.opacity = "0";
        } else {
            band.style.height = "0px";
            band.style.marginBottom = "0px";
            band.style.opacity = "0";
            void band.offsetHeight;
            band.style.transition = TRANS;
            band.style.height = band.scrollHeight + "px";
            band.style.marginBottom = "";
            band.style.opacity = "1";
            // Release to auto height once open, so later content changes aren't pinned.
            const done = (e) => {
                if (e.propertyName !== "height") return;
                band.style.transition = "";
                band.style.height = "auto";
                band.removeEventListener("transitionend", done);
            };
            band.addEventListener("transitionend", done);
        }
    }

    /** @param {HTMLElement} el @param {any} s */
    _buildRoleBand(el, s) {
        // Musical Role — the voice's function in the ensemble. (The Sound field was
        // removed: a style no longer carries an instrument; the object's own voice
        // is always used.)
        const roleRow = document.createElement("div");
        roleRow.className = "styles-row";
        const rLab = document.createElement("span");
        rLab.className = "styles-field-label";
        rLab.textContent = "Voice Role";
        roleRow.appendChild(rLab);
        const roleSel = document.createElement("select");
        roleSel.className = "styles-select styles-role";
        for (const o of ROLE_OPTIONS) {
            const opt = document.createElement("option");
            opt.value = o.value; opt.textContent = o.label;
            roleSel.appendChild(opt);
        }
        roleSel.value = (typeof s.role === "string" && s.role) ? s.role : "none";
        roleSel.title = "The voice's function in the ensemble (its musical role).";
        roleSel.addEventListener("change", () => { s.role = roleSel.value; this._markDirty(); });
        roleRow.appendChild(roleSel);
        el.appendChild(roleRow);
    }

    /** A short label that hugs its field (content-sized). @param {string} text @returns {HTMLElement} */
    _inlineLabel(text) {
        const l = document.createElement("span");
        l.className = "styles-inline-label";
        l.textContent = text;
        return l;
    }

    /** @param {HTMLElement} el @param {any} s */
    _buildPitchBand(el, s) {
        const band = this._band("Pitch Influencers");

        // Scale row: scale dropdown on the left, the "Pull to Scale" strength
        // (0..1) on its right (single-line label — it fits).
        const scaleRow = document.createElement("div");
        scaleRow.className = "styles-row";
        const sLab = document.createElement("span");
        sLab.className = "styles-field-label";
        sLab.textContent = "Scale";
        scaleRow.appendChild(sLab);
        const scaleSel = document.createElement("select");
        scaleSel.className = "styles-select styles-scale";
        for (const sc of SCALE_OPTIONS) {
            const o = document.createElement("option");
            o.value = sc; o.textContent = sc;
            scaleSel.appendChild(o);
        }
        scaleSel.value = s.scale;
        scaleSel.addEventListener("change", () => { s.scale = scaleSel.value; this._markDirty(); });
        scaleRow.appendChild(scaleSel);
        const psLab = document.createElement("span");
        psLab.className = "styles-pull-label";
        psLab.textContent = "Pull to Scale";
        scaleRow.appendChild(psLab);
        const pull = this._numInput(s.scalePull, (v) => { s.scalePull = v; this._markDirty(); }, {});
        pull.title = "Pull to scale (0–1): how strongly notes are drawn to the scale.";
        scaleRow.appendChild(pull);
        band.appendChild(scaleRow);

        // Pull to Chord — its own row, nothing else on it, the field aligned
        // directly under Pull to Scale (an empty label slot + a scale-width spacer
        // line it up). Lead's home is decided later.
        const chordRow = document.createElement("div");
        chordRow.className = "styles-row";
        chordRow.appendChild(this._spacer("styles-field-label"));
        chordRow.appendChild(this._spacer("styles-scale-spacer"));
        const pcLab = document.createElement("span");
        pcLab.className = "styles-pull-label";
        pcLab.textContent = "Pull to Chord";
        chordRow.appendChild(pcLab);
        chordRow.appendChild(this._numInput(s.chordLock, (v) => { s.chordLock = v; this._markDirty(); }, {}));
        band.appendChild(chordRow);

        // Note Range: lowest note "to" highest note — two note-name dropdowns that
        // constrain each other so the high note is never below the low note.
        const rangeRow = document.createElement("div");
        rangeRow.className = "styles-row";
        const rLab = document.createElement("span");
        rLab.className = "styles-field-label";
        rLab.textContent = "Note Range";
        rangeRow.appendChild(rLab);
        const lowSel = document.createElement("select");
        lowSel.className = "styles-select styles-midi";
        const highSel = document.createElement("select");
        highSel.className = "styles-select styles-midi";
        // (Re)fill a note dropdown with MIDI values lo..hi (highest first), and
        // select `selected`.
        const fillNotes = (el, lo, hi, selected) => {
            el.innerHTML = "";
            for (let m = hi; m >= lo; m -= 1) {
                const o = document.createElement("option");
                o.value = String(m); o.textContent = noteName(m);
                el.appendChild(o);
            }
            el.value = String(selected);
        };
        const lo0 = Number.isFinite(s.range[0]) ? s.range[0] : 60;
        const hi0 = Number.isFinite(s.range[1]) ? s.range[1] : 84;
        s.range[0] = lo0;
        s.range[1] = Math.max(hi0, lo0);
        fillNotes(lowSel, 0, s.range[1], s.range[0]);      // low: 0..high
        fillNotes(highSel, s.range[0], 127, s.range[1]);   // high: low..127
        lowSel.addEventListener("change", () => {
            s.range[0] = Number(lowSel.value);
            fillNotes(highSel, s.range[0], 127, s.range[1]);   // high can't drop below low
            this._markDirty();
        });
        highSel.addEventListener("change", () => {
            s.range[1] = Number(highSel.value);
            fillNotes(lowSel, 0, s.range[1], s.range[0]);      // low can't rise above high
            this._markDirty();
        });
        rangeRow.appendChild(lowSel);
        const toLab = document.createElement("span");
        toLab.className = "styles-range-to";
        toLab.textContent = "to";
        rangeRow.appendChild(toLab);
        rangeRow.appendChild(highSel);
        band.appendChild(rangeRow);

        // Motion row: Smoothness (left) + Downward Pull (right). The Downward Pull
        // label sits in a fixed-width slot so its value lands in the right-hand
        // influence column, aligned under Pull to Scale / Pull to Chord.
        const motionRow = document.createElement("div");
        motionRow.className = "styles-row";
        motionRow.appendChild(this._fieldLabel("Smoothness"));
        motionRow.appendChild(this._numInput(s.smoothness, (v) => { s.smoothness = v; this._markDirty(); }, {}));
        const dpLab = document.createElement("span");
        dpLab.className = "styles-influence-label";
        dpLab.textContent = "Downward Pull";
        motionRow.appendChild(dpLab);
        motionRow.appendChild(this._numInput(this._multToDial(s.descendBias, 2, 0.5), (v) => { s.descendBias = this._dialToMult(v, 2, 0.5); this._markDirty(); }, { min: -1, max: 1, step: 0.05, fallback: 0 }));
        band.appendChild(motionRow);
        // Anchoring row: Avoid Note Extremes (gravity, left) + Strong Beats on Chord
        // Root (root, right). The Strong-Beats label uses the same influence slot, so
        // its value aligns with Downward Pull / Pull to Chord / Pull to Scale.
        const anchorRow = document.createElement("div");
        anchorRow.className = "styles-row";
        const gLab = document.createElement("span");
        gLab.className = "styles-field-label styles-wrap";
        gLab.appendChild(document.createTextNode("Avoid Note"));
        gLab.appendChild(document.createElement("br"));
        gLab.appendChild(document.createTextNode("Extremes"));
        anchorRow.appendChild(gLab);
        anchorRow.appendChild(this._numInput(s.gravity, (v) => { s.gravity = v; this._markDirty(); }, {}));
        const rtLab = document.createElement("span");
        rtLab.className = "styles-influence-label";
        rtLab.textContent = "Strong Beats on Chord Root";
        anchorRow.appendChild(rtLab);
        anchorRow.appendChild(this._numInput(this._multToDial(s.rootPull, 4, 0), (v) => { s.rootPull = this._dialToMult(v, 4, 0); this._markDirty(); }, { min: -1, max: 1, step: 0.05, fallback: 0 }));
        band.appendChild(anchorRow);
        // Voice Leading. (Phrase End Breath moved to the Rhythm band — it's a
        // phrasing field, not pitch-specific.)
        this._knob(band, "Voice Leading", this._multToDial(s.lead, 3, 0), (v) => { s.lead = this._dialToMult(v, 3, 0); this._markDirty(); }, { min: -1, max: 1, step: 0.05, fallback: 0 });
        // Pitch driver (the Pitch Arbitrator) at the foot of the pitch band. The
        // reserved Bend row is removed for now (may return later).
        this._driverRow(band, "Pitch Dice", "pitch", {
            defaultChannel: "lt",
            help: "A canvas value (colour, position, etc.) that selects the pitch from the candidates the tendencies above have weighted. It navigates within the scale/chord/smoothness shaping — it never overrides it.",
        });
        this._pitchBandEl = band;
        el.appendChild(band);
    }

    /**
     * Convert a stored engine multiplier (1 = neutral) to a -1..1 DIAL value,
     * where +1 maps to `posMax` and -1 to `negMin`. The dial is purely a display
     * scale — the stored value stays the multiplier the generator expects.
     * @param {number} m @param {number} posMax @param {number} negMin @returns {number}
     */
    _multToDial(m, posMax, negMin) {
        const mm = (typeof m === "number" && Number.isFinite(m)) ? m : 1;
        const v = mm >= 1 ? (mm - 1) / (posMax - 1) : (mm - 1) / (1 - negMin);
        return v < -1 ? -1 : v > 1 ? 1 : v;
    }

    /** Inverse of {@link _multToDial}: a -1..1 dial value back to the multiplier. */
    _dialToMult(v, posMax, negMin) {
        const vv = Math.max(-1, Math.min(1, Number(v)));
        return vv >= 0 ? 1 + vv * (posMax - 1) : 1 + vv * (1 - negMin);
    }

    /** An empty flex spacer of a given class width (lines fields up across rows).
     *  @param {string} cls @returns {HTMLElement} */
    _spacer(cls) {
        const span = document.createElement("span");
        span.className = cls;
        return span;
    }

    /** A small inline label (content-sized). @param {string} text @returns {HTMLElement} */
    _mini(text) {
        const span = document.createElement("span");
        span.className = "styles-mini-label";
        span.textContent = text;
        return span;
    }

    /**
     * A left-column field label (the 80px right-aligned slot). `label` may be a
     * string or an array of lines (wrapped via <br>, so a long name keeps its
     * right edge in the column instead of running off the panel). An optional
     * `help` string becomes the hover tooltip. With `autoWidth`, the label hugs
     * its text (content width) and pushes its field right instead of sitting in
     * the fixed column — for a standalone one-line label with nothing to align to.
     * @param {string | string[]} label @param {string} [help] @param {boolean} [autoWidth]
     * @returns {HTMLElement}
     */
    _fieldLabel(label, help, autoWidth) {
        const lab = document.createElement("span");
        const lines = Array.isArray(label) ? label : [label];
        lab.className = "styles-field-label"
            + (lines.length > 1 ? " styles-wrap" : "")
            + (autoWidth ? " styles-label-auto" : "");
        lines.forEach((line, i) => {
            if (i > 0) lab.appendChild(document.createElement("br"));
            lab.appendChild(document.createTextNode(line));
        });
        if (help) lab.title = help;
        return lab;
    }

    /** @param {HTMLElement} el @param {any} s */
    _buildVelocityBand(el, s) {
        const band = this._band("Note Velocity");

        // Row 1: Velocity Mix   A ◀──slider──▶ B  (A = beat strength, B = canvas).
        // velocityWeight maps DIRECTLY: 0 = A (beat, left) … 1 = B (canvas, right).
        const mixRow = document.createElement("div");
        mixRow.className = "styles-row";
        mixRow.appendChild(this._fieldLabel("Velocity Mix"));
        const aEnd = document.createElement("span");
        aEnd.className = "styles-mix-end";
        aEnd.textContent = "A";
        mixRow.appendChild(aEnd);
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0"; slider.max = "1"; slider.step = "0.01";
        slider.className = "styles-weight-slider";
        slider.title = "A (Inspector beat strength) ◀──▶ B (colour from canvas)";
        slider.value = String(clamp01(s.velocityWeight));
        slider.addEventListener("input", () => { s.velocityWeight = clamp01(Number(slider.value)); this._markDirty(); });
        mixRow.appendChild(slider);
        const bEnd = document.createElement("span");
        bEnd.className = "styles-mix-end";
        bEnd.textContent = "B";
        mixRow.appendChild(bEnd);
        // Trailing spacer: reserves 50px at the row's right edge so the slider
        // (which fills the rest) is ~50px shorter, with B still hugging its end.
        const trim = document.createElement("span");
        trim.className = "styles-mix-trim";
        mixRow.appendChild(trim);
        band.appendChild(mixRow);

        // Row 2: the A legend.
        const aRow = document.createElement("div");
        aRow.className = "styles-row styles-mix-legend";
        const aTxt = document.createElement("span");
        aTxt.textContent = "A: Inspector Beat Strength";
        aRow.appendChild(aTxt);
        band.appendChild(aRow);

        // Row 3: the B legend + the canvas source / value dropdowns.
        const bRow = document.createElement("div");
        bRow.className = "styles-row styles-mix-legend";
        const bTxt = document.createElement("span");
        bTxt.textContent = "B: Color From Canvas";
        bRow.appendChild(bTxt);
        this._driverSourceValue(bRow, "velocity", { defaultChannel: "r" });
        band.appendChild(bRow);

        // Row 4: the two shaping knobs, indented 80px.
        this._groupRow(band, [
            ["Dynamic Range", s.accentResponse, (v) => { s.accentResponse = v; this._markDirty(); }, { min: 0, max: 3, step: 0.1, fallback: 1 }],
            ["Shape to Phrases", s.phraseDynamics, (v) => { s.phraseDynamics = v; this._markDirty(); }, {}],
        ], "styles-mix-knobs");
        el.appendChild(band);
    }

    /** @param {HTMLElement} el @param {any} s */
    _buildRhythmBand(el, s) {
        const band = this._band("Rhythm");
        const r = s.rhythm || (s.rhythm = {});
        // Density + Phrase End Breath share the top row (breath on the right). Breath
        // is a phrasing amount (0..1; 0 = play through), so it lives in this
        // always-active band rather than the pitch-only one.
        this._groupRow(band, [
            ["Density", r.density, (v) => { r.density = v; this._markDirty(); }, {}],
            ["Phrase End Breath", typeof s.breathe === "number" ? s.breathe : (s.breathe ? 1 : 0), (v) => { s.breathe = v; this._markDirty(); }, {}],
        ]);
        this._knob(band, "Syncopation", r.syncopation, (v) => { r.syncopation = v; this._markDirty(); });
        this._knob(band, "Image Influence", r.imageInfluence, (v) => { r.imageInfluence = v; this._markDirty(); });
        this._knob(band, "Accent", r.accent, (v) => { r.accent = v; this._markDirty(); });
        this._knob(band, "Fills / Ratchets", r.ratchets, (v) => { r.ratchets = v; this._markDirty(); });
        el.appendChild(band);
    }

    /**
     * Sustain band — how long the note holds from its onset (regardless of when the
     * next note starts): a default/fixed sustain, the canvas Source that can drive
     * it, and the image-vs-default weight balancing the two. (Data fields stay named
     * `articulation` / `duration` / `durationWeight`; only the UI says "sustain".)
     * @param {HTMLElement} el @param {any} s
     */
    _buildSustainBand(el, s) {
        const band = this._band("Note Sustain");

        // Row 1: Sustain Mix   A ◀──slider──▶ B  (A = fixed default, B = canvas).
        // durationWeight maps DIRECTLY: 0 = A (fixed, left) … 1 = B (canvas, right).
        const mixRow = document.createElement("div");
        mixRow.className = "styles-row";
        mixRow.appendChild(this._fieldLabel("Sustain Mix"));
        const aEnd = document.createElement("span");
        aEnd.className = "styles-mix-end";
        aEnd.textContent = "A";
        mixRow.appendChild(aEnd);
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0"; slider.max = "1"; slider.step = "0.01";
        slider.className = "styles-weight-slider";
        slider.title = "A (fixed default sustain) ◀──▶ B (colour from canvas)";
        slider.value = String(clamp01(s.durationWeight));
        slider.addEventListener("input", () => { s.durationWeight = clamp01(Number(slider.value)); this._markDirty(); });
        mixRow.appendChild(slider);
        const bEnd = document.createElement("span");
        bEnd.className = "styles-mix-end";
        bEnd.textContent = "B";
        mixRow.appendChild(bEnd);
        const trim = document.createElement("span");
        trim.className = "styles-mix-trim";
        mixRow.appendChild(trim);
        band.appendChild(mixRow);

        // Row 2: the A legend — A is the fixed default sustain (editable, in beats).
        const aRow = document.createElement("div");
        aRow.className = "styles-row styles-mix-legend";
        const aTxt = document.createElement("span");
        aTxt.textContent = "A: Fixed at";
        aRow.appendChild(aTxt);
        const aNum = this._numInput(s.articulation, (v) => { s.articulation = v; this._markDirty(); }, { min: 0, max: 2, step: 0.05, fallback: 0.9 });
        aNum.title = "The default note sustain in beats — how long the note holds from its onset, absolute and independent of the next note (so it works for collision/trigger notes too).";
        aRow.appendChild(aNum);
        band.appendChild(aRow);

        // Row 3: the B legend + the canvas source / value dropdowns.
        const bRow = document.createElement("div");
        bRow.className = "styles-row styles-mix-legend";
        const bTxt = document.createElement("span");
        bTxt.textContent = "B: Color From Canvas";
        bTxt.title = "A canvas value (a colour channel, etc.) driving the sustain, scaled to the beat range. The Sustain Mix slider blends it against the fixed default (A).";
        bRow.appendChild(bTxt);
        this._driverSourceValue(bRow, "duration", { defaultChannel: "b" });
        band.appendChild(bRow);

        // Row 4: clip-at-next-note (the overlap param), indented like velocity's knobs.
        const clipRow = document.createElement("div");
        clipRow.className = "styles-row styles-mix-knobs";
        const clipLab = document.createElement("span");
        clipLab.textContent = "Clip at next note";
        clipRow.appendChild(clipLab);
        const clipNum = this._numInput(s.overlap, (v) => { s.overlap = v; this._markDirty(); }, { min: -0.5, max: 0.5, step: 0.05, fallback: 0 });
        clipNum.title = "When there IS a next note, where the note ends relative to that onset (beats): + rings past it (legato overlap), − stops short of it (a gap). Ignored when there's no next note.";
        clipRow.appendChild(clipNum);
        band.appendChild(clipRow);

        el.appendChild(band);
    }

    // --- Widgets -------------------------------------------------------------

    /** @param {string} title @returns {HTMLElement} */
    _band(title) {
        const band = document.createElement("div");
        band.className = "styles-band";
        const h = document.createElement("div");
        h.className = "styles-band-header";
        h.textContent = title;
        band.appendChild(h);
        return band;
    }

    /**
     * A bare numeric spinner input (native number input, styled like the
     * inspector fields). @param {number} value @param {(v: number) => void} onChange
     * @param {{min?: number, max?: number, step?: number, fallback?: number}} [opts]
     * @returns {HTMLInputElement}
     */
    _numInput(value, onChange, opts = {}) {
        const min = opts.min ?? 0;
        const max = opts.max ?? 1;
        const step = opts.step ?? 0.01;
        const num = document.createElement("input");
        num.type = "number";
        num.min = String(min); num.max = String(max); num.step = String(step);
        num.className = "styles-num";
        const init = (typeof value === "number" && Number.isFinite(value)) ? value : (opts.fallback ?? min);
        num.value = String(init);
        const clampN = (x) => { let n = Number(x); if (!Number.isFinite(n)) n = min; return n < min ? min : n > max ? max : n; };
        num.addEventListener("change", () => { const n = clampN(num.value); num.value = String(n); onChange(n); });
        return num;
    }

    /**
     * A single labelled knob row: the label in the left column + a spinner.
     * `label` may be a string or wrapped lines; `opts.help` adds a tooltip;
     * `opts.autoLabel` content-sizes the label so it pushes the spinner right.
     * @param {HTMLElement} parent @param {string | string[]} label @param {number} value
     * @param {(v: number) => void} onChange
     * @param {{min?: number, max?: number, step?: number, fallback?: number, help?: string, autoLabel?: boolean}} [opts]
     */
    _knob(parent, label, value, onChange, opts = {}) {
        const row = document.createElement("div");
        row.className = "styles-row";
        row.appendChild(this._fieldLabel(label, opts.help, opts.autoLabel));
        row.appendChild(this._numInput(value, onChange, opts));
        parent.appendChild(row);
    }

    /**
     * A row grouping related knobs. The FIRST field's label sits in the left
     * column (so the first fields of every row align vertically with Scale /
     * Sound); each further field gets a small inline label. `rowClass`, if given,
     * is added to the row (e.g. to indent it).
     * @param {HTMLElement} parent
     * @param {Array<[string, number, (v: number) => void, object]>} fields
     * @param {string} [rowClass]
     */
    _groupRow(parent, fields, rowClass) {
        const row = document.createElement("div");
        row.className = "styles-row" + (rowClass ? " " + rowClass : "");
        fields.forEach(([label, value, onChange, opts], i) => {
            const lab = document.createElement("span");
            lab.className = i === 0 ? "styles-field-label" : "styles-mini-label";
            lab.textContent = label;
            row.appendChild(lab);
            row.appendChild(this._numInput(value, onChange, opts || {}));
        });
        parent.appendChild(row);
    }

    /**
     * Append a driver's source dropdown (Fixed / Colour / Formula; +Off if hasOff)
     * and its value control (a number / colour-channel / formula box that swaps by
     * source) to `row`, editing the sandbox's tagged `s[field]` in place.
     * @param {HTMLElement} row @param {string} field
     * @param {{defaultChannel?: string, hasOff?: boolean}} [opts]
     */
    _driverSourceValue(row, field, opts = {}) {
        const s = this._sandbox;
        if (!s[field] || typeof s[field] !== "object") s[field] = { src: "fixed", value: 0.5 };

        const srcSel = document.createElement("select");
        srcSel.className = "styles-driver-src";
        const sources = opts.hasOff ? ["off", "fixed", "channel", "formula"] : ["fixed", "channel", "formula"];
        const srcLabels = { off: "Off", fixed: "Fixed", channel: "Colour", formula: "Formula" };
        for (const sc of sources) {
            const o = document.createElement("option");
            o.value = sc; o.textContent = srcLabels[sc];
            srcSel.appendChild(o);
        }
        srcSel.value = s[field].src || "fixed";
        row.appendChild(srcSel);

        const valWrap = document.createElement("span");
        valWrap.className = "styles-driver-val";
        row.appendChild(valWrap);

        const renderVal = () => {
            valWrap.innerHTML = "";
            const d = s[field];
            if (d.src === "fixed") {
                const num = document.createElement("input");
                num.type = "number"; num.min = "0"; num.max = "1"; num.step = "0.01";
                num.className = "styles-num";
                num.value = String(typeof d.value === "number" ? d.value : 0.5);
                num.addEventListener("change", () => { d.value = clamp01(num.value); num.value = String(d.value); this._markDirty(); });
                valWrap.appendChild(num);
            } else if (d.src === "channel") {
                const sel = document.createElement("select");
                sel.className = "styles-driver-chan";
                for (const ch of CHANNELS) {
                    const o = document.createElement("option");
                    o.value = ch; o.textContent = ch;
                    sel.appendChild(o);
                }
                sel.value = d.channel || opts.defaultChannel || "lt";
                sel.addEventListener("change", () => { d.channel = sel.value; this._markDirty(); });
                valWrap.appendChild(sel);
            } else if (d.src === "formula") {
                const txt = document.createElement("input");
                txt.type = "text"; txt.className = "styles-driver-expr";
                txt.placeholder = "c.col.r ** 2";
                txt.value = d.expr || "";
                txt.addEventListener("change", () => { d.expr = txt.value; this._markDirty(); });
                valWrap.appendChild(txt);
            }
            // off → no value control
        };
        srcSel.addEventListener("change", () => {
            const ns = srcSel.value;
            if (ns === "fixed") s[field] = { src: "fixed", value: 0.5 };
            else if (ns === "channel") s[field] = { src: "channel", channel: opts.defaultChannel || "lt" };
            else if (ns === "formula") s[field] = { src: "formula", expr: "" };
            else s[field] = { src: "off" };
            renderVal();
            this._markDirty();
        });
        renderVal();
    }

    /**
     * A driver row: label + source dropdown + value control + an optional blend-weight
     * spinner (sustain's "image vs default", pinned to the right of the row by the
     * value-wrap's flex). `label` may be a string or wrapped lines.
     * @param {HTMLElement} parent @param {string | string[]} label @param {string} field
     * @param {{defaultChannel?: string, hasOff?: boolean, weightKey?: string, weightLabel?: string, help?: string}} [opts]
     */
    _driverRow(parent, label, field, opts = {}) {
        const s = this._sandbox;
        const row = document.createElement("div");
        row.className = "styles-row styles-driver-row";
        row.appendChild(this._fieldLabel(label, opts.help));
        this._driverSourceValue(row, field, { defaultChannel: opts.defaultChannel, hasOff: opts.hasOff });
        if (opts.weightKey) {
            const wk = opts.weightKey;
            if (opts.weightLabel) row.appendChild(this._mini(opts.weightLabel));
            row.appendChild(this._numInput(s[wk], (v) => { s[wk] = v; this._markDirty(); }, {}));
        }
        parent.appendChild(row);
    }

    /** A collapsible Advanced section. @param {HTMLElement} parent @param {string} key
     *  @param {string} label @param {(body: HTMLElement) => void} buildBody */
    _expander(parent, key, label, buildBody) {
        const head = document.createElement("button");
        head.type = "button";
        head.className = "styles-expander-head";
        const open = this._advancedOpen[key] === true;
        head.textContent = (open ? "▾ " : "▸ ") + label;
        const body = document.createElement("div");
        body.className = "styles-expander-body" + (open ? "" : " hidden");
        head.addEventListener("click", () => {
            this._advancedOpen[key] = !this._advancedOpen[key];
            const nowOpen = this._advancedOpen[key] === true;
            head.textContent = (nowOpen ? "▾ " : "▸ ") + label;
            body.classList.toggle("hidden", !nowOpen);
        });
        buildBody(body);
        parent.appendChild(head);
        parent.appendChild(body);
    }

    /** @param {HTMLElement} parent @param {string} label @param {string} value
     *  @param {(v: string) => void} onChange @param {{placeholder?: string}} [opts]
     *  @returns {HTMLInputElement} */
    _textField(parent, label, value, onChange, opts = {}) {
        const row = document.createElement("div");
        row.className = "styles-row";
        const lab = document.createElement("span");
        lab.className = "styles-field-label";
        lab.textContent = label;
        row.appendChild(lab);
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "styles-text";
        inp.value = value || "";
        if (opts.placeholder) inp.placeholder = opts.placeholder;
        inp.addEventListener("input", () => onChange(inp.value));
        row.appendChild(inp);
        parent.appendChild(row);
        return inp;
    }

    /** @param {HTMLElement} parent @param {string} label
     *  @param {Array<string | {value: string, label: string}>} options
     *  @param {string} value @param {(v: string) => void} onChange
     *  @param {string} [extraClass]  width/styling class on the select */
    _selectField(parent, label, options, value, onChange, extraClass) {
        const row = document.createElement("div");
        row.className = "styles-row";
        const lab = document.createElement("span");
        lab.className = "styles-field-label";
        lab.textContent = label;
        row.appendChild(lab);
        const sel = document.createElement("select");
        sel.className = "styles-select" + (extraClass ? " " + extraClass : "");
        for (const o of options) {
            const opt = document.createElement("option");
            if (typeof o === "string") { opt.value = o; opt.textContent = o; }
            else { opt.value = o.value; opt.textContent = o.label; }
            sel.appendChild(opt);
        }
        sel.value = value ?? "";
        sel.addEventListener("change", () => onChange(sel.value));
        row.appendChild(sel);
        parent.appendChild(row);
    }

    /** @param {HTMLElement} parent @param {string} label @param {boolean} checked
     *  @param {(v: boolean) => void} onChange */
    _checkboxField(parent, label, checked, onChange) {
        const row = document.createElement("div");
        row.className = "styles-row";
        const wrap = document.createElement("label");
        wrap.className = "styles-check";
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.checked = !!checked;
        inp.addEventListener("change", () => onChange(inp.checked));
        wrap.appendChild(inp);
        wrap.appendChild(document.createTextNode(" " + label));
        row.appendChild(wrap);
        parent.appendChild(row);
    }

    /** The Low / High MIDI range row with note names. @param {HTMLElement} parent
     *  @param {number[]} range */
    _rangeRow(parent, range) {
        const row = document.createElement("div");
        row.className = "styles-row styles-range-row";
        const lab = document.createElement("span");
        lab.className = "styles-field-label";
        lab.textContent = "Range";
        row.appendChild(lab);
        const mk = (idx, fallback) => {
            const num = document.createElement("input");
            num.type = "number"; num.min = "0"; num.max = "127"; num.step = "1";
            num.className = "styles-num";
            num.value = String(Number.isFinite(range[idx]) ? range[idx] : fallback);
            const note = document.createElement("span");
            note.className = "styles-note";
            note.textContent = noteName(range[idx] ?? fallback);
            num.addEventListener("change", () => {
                let n = Math.round(Number(num.value));
                if (!Number.isFinite(n)) n = fallback;
                n = n < 0 ? 0 : n > 127 ? 127 : n;
                range[idx] = n;
                num.value = String(n);
                note.textContent = noteName(n);
                this._markDirty();
            });
            return { num, note };
        };
        const lo = mk(0, 60);
        const hi = mk(1, 84);
        row.appendChild(this._span("Low", "styles-range-tag"));
        row.appendChild(lo.num); row.appendChild(lo.note);
        row.appendChild(this._span("High", "styles-range-tag"));
        row.appendChild(hi.num); row.appendChild(hi.note);
        parent.appendChild(row);
    }

    /** @param {string} text @param {string} cls @returns {HTMLElement} */
    _span(text, cls) {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = text;
        return s;
    }

    /** A reserved (non-editable) row, e.g. Bend. @param {HTMLElement} parent
     *  @param {string} label @param {string} text */
    _reservedRow(parent, label, text) {
        const row = document.createElement("div");
        row.className = "styles-row styles-reserved";
        const lab = document.createElement("span");
        lab.className = "styles-field-label";
        lab.textContent = label;
        row.appendChild(lab);
        const note = document.createElement("span");
        note.className = "styles-reserved-note";
        note.textContent = text;
        row.appendChild(note);
        parent.appendChild(row);
    }

    // --- Action row (Save / Revert) ------------------------------------------

    _refreshFooter() {
        const dirty = this._isDirty();
        const nameChanged = !this._isNew && this._sandboxName !== this._baseName;
        const saveable = isIdentifier(this._sandboxName) && (this._isNew || dirty || nameChanged);
        if (this._saveBtn !== null) this._saveBtn.disabled = !saveable;
        if (this._revertBtn !== null) this._revertBtn.disabled = !(!this._isNew && (dirty || nameChanged));
    }

    _onSave() {
        const name = this._sandboxName;
        if (!isIdentifier(name)) return;
        // Prompt only when this would overwrite a DIFFERENT existing user style
        // (collision); silently updating the style you loaded is the normal case.
        const existing = getStyleRecord(this._kind, name);
        if (existing !== null && name !== this._baseName) {
            // eslint-disable-next-line no-alert
            if (!window.confirm(`Replace existing style "${name}"?`)) return;
        }
        if (this._onSaveStyle !== null) {
            this._onSaveStyle({ type: this._kind, name, def: deepCopy(this._sandbox) });
        }
        // The sandbox is now the saved base.
        this._isNew = false;
        this._baseName = name;
        this._baseSerialized = JSON.stringify(this._sandbox);
        this._selected = name;
        this._render();
    }

    _onRevert() {
        if (this._isNew || this._baseName === null) return;
        this._loadSandbox(this._baseName);
        this._selected = this._baseName;
        this._render();
    }

    // --- Lifecycle actions ---------------------------------------------------

    _onNew() {
        this._sandbox = serializeMStyle(new MStyle());
        this._baseSerialized = JSON.stringify(serializeMStyle(new MStyle()));
        this._baseName = null;
        this._sandboxName = "";
        this._isNew = true;
        this._advancedOpen = {};
        this._render();
    }

    /** @param {string} name */
    _onDuplicate(name) {
        this._loadSandbox(name);
        this._baseName = null;
        this._sandboxName = name + "Copy";
        this._baseSerialized = JSON.stringify(this._sandbox);  // start clean; isNew forces saveable
        this._isNew = true;
        this._render();
    }

    /** @param {string} name */
    _onDelete(name) {
        if (this._builtinNames().includes(name)) return;   // built-ins aren't deletable
        if (this._onDeleteStyle !== null) this._onDeleteStyle(this._kind, name);
        if (this._selected === name) { this._selected = null; this._sandbox = null; }
        this._isNew = false;
        this._render();   // _render reloads the now-default selection's sandbox
    }
}
