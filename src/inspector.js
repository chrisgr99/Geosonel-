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
 * Render order (_render, top to bottom): title bar; Identity;
 * Transform & appearance; Msg Functions (the four callbacks plus
 * the Automessage Interval, all ONE band); Beat Points; Cycle; a
 * separator; the reserved middle area (per-object voice); a heavy
 * separator; the global band (Sound Engine); a bottom spacer. The
 * bands and their fields are documented in DESIGN.md section 4 —
 * that section is kept in sync with this code, the source of truth.
 *
 * Bands in brief:
 *   - Identity: Object ID (read-only) + State (Active / No Cursor /
 *     Disable radio); Object Name (a blank, non-editable
 *     placeholder for now) + Time Lag (multiplier × shared interval).
 *   - Transform & appearance: Initial Conditions (X, Y, vX, vY);
 *     one Dimension row (curve Length/Width + Line Width, or a single
 *     sprite/trigger Size); Cursor Length/Width; Color + Variability.
 *     No Z anywhere.
 *   - Msg Functions: callbacks hasHit, beenHit, onTick, autoMessage —
 *     each a Can-X checkbox + function-name field + one contextual
 *     Create / Go-to button (Create scaffolds slotName_objectId in
 *     behaviors.js, e.g. autoMessage_CRV1; Go-to navigates). The
 *     Automessage Interval dropdown sits in this band ABOVE the
 *     autoMessage row (its rate must be defined first).
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
        this._render();
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
        const ctx = buildSelectionContext(this._selection);

        const panel = document.createElement("div");
        panel.className = "inspector-panel";

        panel.appendChild(this._buildTitleBar(ctx));
        panel.appendChild(this._buildBandIdentity(ctx));
        panel.appendChild(this._buildBandGeometry(ctx));
        panel.appendChild(this._buildBandCallbackSlots(ctx));
        panel.appendChild(this._buildBandBeatPoints(ctx));
        panel.appendChild(this._buildBandCycle(ctx));

        // Structural break separating the per-object
        // bands above from the engine-driven bands below.
        // The middle area is currently empty and reserved
        // for the per-object voice band the multi-engine
        // design lands later (sound / bank dropdowns under
        // superdough, port / channel / program under MIDI,
        // synth-class fields under Tone.js); the global
        // band carries the always-visible Sound Engine
        // dropdown that controls which engine the rest of
        // the audio surfaces reshape around.
        const sep1 = document.createElement("div");
        sep1.className = "insp-separator";
        panel.appendChild(sep1);
        panel.appendChild(this._buildBandMiddleArea(ctx));
        const sep2 = document.createElement("div");
        sep2.className = "insp-separator insp-separator-heavy";
        panel.appendChild(sep2);
        panel.appendChild(this._buildBandGlobal(ctx));

        // Bottom spacer. Pushes the last band's fields up by
        // about two row heights so the macOS dock doesn't
        // pop over them when the user mouses near the screen
        // edge while editing fields in the lower bands. Lives
        // inside the panel so it scrolls with the rest of the
        // form rather than docking to the pane bottom.
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
