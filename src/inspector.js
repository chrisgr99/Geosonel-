/**
 * Property Inspector module (GeosonixV2).
 *
 * Renders the form-based property inspector in the Properties
 * tab. The form is ALWAYS rendered — the nothing-selected state
 * shows every band with all fields greyed and "No selection" in
 * the title bar. With a selection, the bands populate from the
 * selected object(s) and each control un-greys based on which
 * kinds are present; controls that don't apply to a kind stay in
 * place but grey, so the layout never shifts. Values aggregate
 * across the selection: a uniform value shows, a divergent one
 * renders blank ("varies") and committing applies the typed value
 * to every applicable object.
 *
 * Structure. The Inspector class holds _scene, _selection, and
 * the edit callback; the per-band builders are mixed onto the
 * prototype via Object.assign from three modules — fieldMethods
 * (inspectorFields.js, the field/widget builders), bandObjectMethods
 * (inspectorBandsObject.js, the title bar + Identity + Transform
 * bands), and bandExtraMethods (inspectorBandsExtra.js, the Msg
 * Functions, Beat Points, Cycle, middle-area, and global bands).
 * Selection helpers live in inspectorSelection.js, shared widths in
 * inspectorShared.js, small widgets in inspectorWidgets.js.
 *
 * Render order (_render, top to bottom): title bar; Identity (no
 * header); Geometry; Behaviour Functions (the four callbacks, ONE
 * band); Rhythm (beat points); Timing (cycle); Mutability; Voice
 * (per-object, superdough only); Global (Sound Engine); a bottom
 * spacer. Every band except Identity carries a titled-divider header
 * (── TITLE ──────, mkBandHeader) that doubles as the separator — the
 * standalone separator divs and per-band borders are gone. The bands
 * and their fields are documented in DESIGN.md section 4 — that
 * section is kept in sync with this code, the source of truth.
 *
 * Bands in brief:
 *   - Identity: Object ID (read-only) + State (Active / No Cursor /
 *     Disable radio); Object Name (a blank, non-editable
 *     placeholder for now) + Time Lag (multiplier × shared interval).
 *   - Transform & appearance: Initial Conditions (X, Y, vX, vY);
 *     one Dimension row (curve Length/Width + Line Width, or a single
 *     sprite/trigger Size); Cursor Length/Width; Color + Variability.
 *     No Z anywhere.
 *   - Msg Functions: callbacks onActiveBeat, hasCollided, beenTriggered, onTick —
 *     each a Can-X checkbox + function-name field + one contextual
 *     Create / Go-to button (Create scaffolds slotName_objectId in
 *     script.js, e.g. onActiveBeat_CRV1; Go-to navigates).
 *   - Beat Points (curves/sprites): mode None / Normal / Euclidean.
 *     Active Beats and Beat Strength are a live-input field
 *     (_buildBeatStringField) — one char per keystroke, "." or SPACE
 *     for a dot and any other key for "x" (Beat Strength is digits or
 *     a dot), with bar "|" separators managed live. Euclidean is a
 *     starter: its parameters regenerate the pattern (euclidean.js)
 *     and that generated pattern field is locked read-only.
 *   - Cycle: Cycle Speeds + Start/Stop at Cycle (curves/sprites);
 *     Trigger Sync To Beat (triggers).
 *   - Below the separators: the carried-over GXW multi-engine voice
 *     (middle area) and Sound Engine (global) bands.
 *
 * Edit lifecycle. Most editable fields share a validator-driven
 * commit: hard errors squiggle red and refuse to commit (Enter
 * keeps focus, blur reverts); soft warnings squiggle yellow and
 * commit; ok values commit cleanly. Numeric fields support
 * scroll-wheel nudging with the validator clamping as soft walls.
 * The Beat Points strings are the exception — a custom live <input>
 * that coerces and re-bars on each keystroke and commits on
 * Enter/blur. Every commit emits an edit through the callback;
 * main.js applies it to scene.json and re-runs the scene, which
 * calls setScene() and triggers a full re-render.
 *
 * The Inspector exposes setSelection(), setScene(), and
 * setEditCallback(); main.js wires the three so the inspector
 * tracks selection changes, scene reloads, and edit commits.
 *
 * Look & feel tracks GeoSonix: inspector background #3e3e3e, field
 * fill #646464, 2px mint #789678 frames on editable fields, white
 * values, muted grey for disabled, dense rows. The styles live in
 * css/inspector.css (the loaded stylesheet) and css/layout.css (the
 * #inspector-area background). NOTE: main.css is NOT loaded by
 * index.html — do not edit it for inspector styling.
 */

// @ts-check

import {
    buildSelectionContext,
} from "./inspectorSelection.js";
import { fieldMethods } from "./inspectorFields.js";
import { bandObjectMethods } from "./inspectorBandsObject.js";
import { bandExtraMethods } from "./inspectorBandsExtra.js";

// Hover-preview hide timing. When the pointer leaves an object with
// NOTHING selected, the peeked fields linger for HOVER_HIDE_DELAY_MS, then
// fade out over PER_OBJECT_FADE_MS before clearing to blank. Moving onto
// another object cancels this and shows the new object at once; reverting
// to an actual selection is prompt (no delay, no fade). PER_OBJECT_FADE_MS
// must match the .insp-perobject opacity transition in css/inspector.css.
const HOVER_HIDE_DELAY_MS = 1000;
const PER_OBJECT_FADE_MS = 1000;

export class Inspector {
    /**
     * @param {HTMLElement} container
     */
    constructor(container) {
        this.container = container;
        this.container.classList.add("inspector-pane");
        /** @type {{sprites: number[], triggers: number[], curves: number[]}} */
        this._selection = { sprites: [], triggers: [], curves: [] };
        /**
         * Hover preview. When the canvas reports a hovered object,
         * setHoverPreview stores its index-based selection here and the
         * form peeks at THAT object's fields, while this._selection — the
         * REAL selection that _emitEdit targets — is left untouched. Null
         * when nothing is hovered, so the form shows the real selection.
         * @type {{sprites: number[], triggers: number[], curves: number[]} | null}
         */
        this._hoverPreview = null;
        /**
         * The selection the form is CURRENTLY rendering: the hover preview
         * if one is active, else the real selection. Set at the top of
         * each _render and read by the bands. Edits still target
         * this._selection (see _emitEdit), never this — so a hover preview
         * can never redirect an edit to the wrong object.
         * @type {{sprites: number[], triggers: number[], curves: number[]}}
         */
        this._activeSelection = this._selection;
        /**
         * Hover-preview fade-out timers and the current per-object section
         * element. _hideTimer is the HOVER_HIDE_DELAY_MS grace before the
         * fade; _fadeTimer spans the fade itself. _perObjectEl is the
         * wrapper whose opacity the fade animates (null when the section
         * isn't rendered). All null when no hide is pending.
         * @type {ReturnType<typeof setTimeout> | null}
         */
        this._hideTimer = null;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._fadeTimer = null;
        /** @type {HTMLElement | null} */
        this._perObjectEl = null;
        /**
         * The runtime Scene built by sceneLoader. Field reads
         * for Band 1 (id, name, mute, hide) come from this.
         * Null until the first runScene completes; in that
         * window the inspector falls back to greyed/empty
         * placeholders instead of crashing on lookup.
         * @type {import("./scene.js").Scene | null}
         */
        this._scene = null;
        /**
         * Callback fired when the user commits an inspector
         * edit. main.js wires this to applyInspectorEdit
         * which runs the parse-mutate-stringify pipeline and
         * re-runs the scene. Edits carry a kind tag plus per-
         * kind payload, with the current selection attached
         * automatically by _emitEdit.
         * @type {((edit: any) => void) | null}
         */
        this._editCallback = null;
        this._render();
    }

    /**
     * Register the callback that handles inspector edit
     * commits. main.js installs this once during setup; the
     * callback is invoked synchronously from the inspector's
     * event handlers (checkbox clicks, name field commits)
     * and is expected to be async-safe.
     * @param {(edit: any) => void} callback
     */
    setEditCallback(callback) {
        this._editCallback = callback;
    }

    /**
     * Emit an inspector edit to the registered callback,
     * attaching the current selection automatically. If the
     * callback isn't wired yet the edit is dropped silently
     * — happens in startup ordering edge cases but otherwise
     * shouldn't.
     * @param {Object} edit
     */
    _emitEdit(edit) {
        if (typeof this._editCallback === "function") {
            this._editCallback({ ...edit, selection: this._selection });
        }
    }

    /**
     * Update the inspector's reference to the runtime Scene.
     * Called by main.js after each successful scene reload.
     * Triggers a re-render so currently-displayed Band 1
     * values reflect the new data — important after edits
     * that change id, name, mute, or hide.
     * @param {import("./scene.js").Scene | null} scene
     */
    setScene(scene) {
        this._scene = scene;
        // A scene reload mid-fade abandons the hover hide and renders fresh.
        if (this._hideTimer !== null || this._fadeTimer !== null) {
            this._cancelHideSequence();
            this._hoverPreview = null;
        }
        this._render();
    }

    /**
     * Update the inspector to reflect a new canvas selection.
     * Empty arrays mean nothing selected — the form clears
     * entirely. Non-empty selections re-populate the form with
     * the appropriate greying.
     * @param {{sprites?: number[], triggers?: number[], curves?: number[]}} selection
     */
    setSelection(selection) {
        this._selection = {
            sprites: selection.sprites ?? [],
            triggers: selection.triggers ?? [],
            curves: selection.curves ?? [],
        };
        // A real selection change while a hover fade-out is pending takes
        // over: cancel the fade and drop the lingering preview so the new
        // selection shows at once.
        if (this._hideTimer !== null || this._fadeTimer !== null) {
            this._cancelHideSequence();
            this._hoverPreview = null;
        }
        this._render();
    }

    /**
     * Set or clear the hover preview as the pointer hovers canvas objects.
     *
     * - A non-null (index-based) selection makes the form peek at that
     *   object's fields AT ONCE, cancelling any pending fade-out. Hover
     *   always wins over the real selection. View-only — the pointer
     *   leaving the object clears the hover (canvas mouseleave) before any
     *   field can be reached, so edits always target the SELECTED object.
     * - Null (pointer off all objects): if an object is actually selected,
     *   revert to it promptly. If nothing is selected, keep peeking at the
     *   last object for HOVER_HIDE_DELAY_MS, then fade the per-object
     *   section out over PER_OBJECT_FADE_MS, then clear to blank.
     *
     * @param {{sprites?: number[], triggers?: number[], curves?: number[]} | null} selection
     */
    setHoverPreview(selection) {
        if (selection !== null) {
            this._cancelHideSequence();
            this._hoverPreview = {
                sprites: selection.sprites ?? [],
                triggers: selection.triggers ?? [],
                curves: selection.curves ?? [],
            };
            this._render();
            return;
        }
        // Pointer left the object onto nothing.
        if (this._hoverPreview === null) return; // already on the selection / blank
        if (this._selectionHasObjects()) {
            // Prompt revert to the real selection — no grace, no fade.
            this._cancelHideSequence();
            this._hoverPreview = null;
            this._render();
            return;
        }
        // Nothing selected: linger, then fade, then blank. The grace
        // restarts on pointer motion (notifyHoverMotion), so the fade only
        // begins once the cursor goes idle over empty canvas.
        this._startHideGrace();
    }

    /**
     * Pointer is moving over empty canvas. While a hover-preview fade-out
     * is pending (grace not yet elapsed), restart the grace so the fade
     * holds off until the cursor stops moving. No-op when showing a
     * selection / blank, or once the fade itself has begun.
     */
    notifyHoverMotion() {
        if (this._hideTimer === null) return;
        this._startHideGrace();
    }

    /**
     * (Re)start the hover-preview grace timer: after HOVER_HIDE_DELAY_MS
     * of no motion, fade the section over PER_OBJECT_FADE_MS, then clear
     * to blank. Does nothing once the fade has already begun.
     */
    _startHideGrace() {
        if (this._fadeTimer !== null) return;
        if (this._hideTimer !== null) clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => {
            this._hideTimer = null;
            // Trigger the CSS opacity transition on the live section.
            if (this._perObjectEl !== null) this._perObjectEl.style.opacity = "0";
            this._fadeTimer = setTimeout(() => {
                this._fadeTimer = null;
                this._hoverPreview = null;
                this._render();
            }, PER_OBJECT_FADE_MS);
        }, HOVER_HIDE_DELAY_MS);
    }

    /** Whether the real selection currently holds any object. */
    _selectionHasObjects() {
        return this._selection.sprites.length > 0
            || this._selection.triggers.length > 0
            || this._selection.curves.length > 0;
    }

    /** Cancel a pending or running hover fade-out (clears the timers; the
     * following render rebuilds the section at full opacity). */
    _cancelHideSequence() {
        if (this._hideTimer !== null) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }
        if (this._fadeTimer !== null) {
            clearTimeout(this._fadeTimer);
            this._fadeTimer = null;
        }
    }

    _render() {
        this.container.innerHTML = "";

        // The form is always rendered, even when nothing is
        // selected. Empty-selection state shows every band
        // with all fields greyed and a "No selection" handle
        // in the title bar. This is the GeoSonix convention
        // and is convenient for testing layout, scrolling,
        // and band greying without first having to click on
        // an object. The selection-driven greying machinery
        // (ctx.hasCurves and so on) returns false for every
        // kind when total === 0, so every band renders with
        // its dis flag true, which is exactly the visual
        // outcome we want.
        // Render from the hover preview when one is active (peek at the
        // hovered object), else from the real selection. The bands read
        // this._activeSelection; edits still use this._selection.
        this._activeSelection = this._hoverPreview ?? this._selection;
        const ctx = buildSelectionContext(this._activeSelection);

        const panel = document.createElement("div");
        panel.className = "inspector-panel";

        panel.appendChild(this._buildTitleBar(ctx));

        // Per-object bands render ONLY when something is selected. With
        // an empty selection the whole per-object area is hidden so the
        // inspector reads as blank up top (no greyed clutter) — just the
        // title bar, then empty space, then the Global band pinned at the
        // bottom. Each lower band carries its own titled-divider header
        // (── TITLE ───────); Mutability sits above the per-object Voice
        // band, which is empty under MIDI.
        if (ctx.total > 0) {
            // Per-object bands live in one wrapper so the whole section
            // can fade out as a unit on hover-preview hide. It renders at
            // full opacity (instant appearance); only the JS-driven
            // fade-to-0 (setHoverPreview) animates, via the .insp-perobject
            // opacity transition.
            const perObj = document.createElement("div");
            perObj.className = "insp-perobject";
            perObj.appendChild(this._buildBandIdentity(ctx));
            perObj.appendChild(this._buildBandGeometry(ctx));
            perObj.appendChild(this._buildBandCallbackSlots(ctx));
            perObj.appendChild(this._buildBandBeatPoints(ctx));
            perObj.appendChild(this._buildBandCycle(ctx));
            perObj.appendChild(this._buildBandMutability(ctx));
            perObj.appendChild(this._buildBandMiddleArea(ctx));

            // Title-less divider capping the bottom of the per-object
            // section, separating it from the empty space above the
            // pinned Global band. Hidden with the bands when nothing is
            // selected.
            const sectionDivider = document.createElement("div");
            sectionDivider.className = "insp-section-divider";
            perObj.appendChild(sectionDivider);

            panel.appendChild(perObj);
            this._perObjectEl = perObj;
        } else {
            this._perObjectEl = null;
        }

        // Growing spacer pins the Global band to the panel's bottom: it
        // absorbs the slack between the per-object section (or the blank
        // area when nothing is selected) and the Global band. The fields
        // are now vertically compact enough that the content fits without
        // scrolling.
        const flexSpacer = document.createElement("div");
        flexSpacer.className = "insp-flex-spacer";
        panel.appendChild(flexSpacer);

        // Global band — score-wide section, always visible, pinned to the
        // bottom by the spacer above.
        panel.appendChild(this._buildBandGlobal(ctx));

        // Bottom spacer — a small 7px gap below the Global band at the
        // panel's bottom edge.
        const spacer = document.createElement("div");
        spacer.className = "insp-bottom-spacer";
        panel.appendChild(spacer);

        this.container.appendChild(panel);
    }
}

Object.assign(
    Inspector.prototype,
    fieldMethods,
    bandObjectMethods,
    bandExtraMethods,
);
