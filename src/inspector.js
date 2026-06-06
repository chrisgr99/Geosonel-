/**
 * Property Inspector module.
 *
 * Renders the form-based property inspector that lives in
 * the Properties tab. The form is always rendered —
 * nothing-selected state shows every band with all fields
 * greyed and a "No selection" handle in the title bar.
 * When at least one object is selected, the same bands
 * populate with that object's data and the appropriate
 * fields un-grey based on which kinds are present in the
 * selection.
 *
 * Cursor-as-collider stage. Inspector renders Bands 1
 * (Identity), 2 (Geometry / visual), and 3 (Callback
 * slots). Band 3 exposes three Code-tab callback slots
 * (hasHit, beenHit, onTick) defined in sections 27 and
 * 28 of DESIGN.md; each row carries a Can-X checkbox,
 * a function-name field, and a Create or Go-to button.
 * Band 1's bottom row is the cycle-pattern authoring
 * row: a static "Pattern for This Object" label plus
 * one button that reads either "Create $id" or "Go to
 * $id" depending on whether a labelled block for the
 * selected object exists in behaviors.js. The canCycle
 * gate is derived from cursor extents and mute
 * (cursor-as-collider model).
 *
 * Band 1 — Identity. Three rows. Row 1: Object ID
 * (read-only, greyed for multi-select), Hide Cursor
 * (editable for any non-empty selection, stored in
 * scene.json's `mute` field, suppresses cursor
 * rendering and the firing that depends on it per the
 * cursor-as-collider model). Row 2
 * is the cycle duration row, reading as "Cycles In [N]
 * beats" with the schema's beatsPerCycle field as the
 * editable number between the label and the units. The
 * cycle duration field is universal across kinds but
 * greys for trigger-only selections since triggers
 * cannot self-fire under the cursor-as-collider model.
 * Row 3 is the pattern row: a static "Pattern" label
 * plus one button whose text incorporates the labelled-
 * block tag the button targets. With a single object
 * selected the button reads "Create $id" when no
 * labelled block for the selected object exists in
 * behaviors.js, or "Go to $id" when one does. When the
 * selected object's labelled block is part of a chain
 * shared with other objects (section 9), a small "+N"
 * indicator follows the button showing the count of
 * co-labels (other objects sharing the same block).
 * Multi-select and empty selections grey the row and
 * shorten the button text to just "Create" with no
 * identifier.
 * The user-typed Name field that earlier inspector
 * versions exposed has been dropped; the schema field
 * stays in place for future re-surfacing.
 *
 * Band 2 — Geometry / visual. Starting State carries the
 * object's starting position (X, Y, universal for any
 * non-empty selection) and starting velocity (vX, vY,
 * active when the selection contains at least one sprite
 * or curve, greyed for trigger-only selections since
 * triggers don't move under physics); Curve Size W/H and
 * Curve Thickness activate when curves are in the
 * selection; Cursor R/L and Cursor Thickness extend to
 * curves and sprites under the cursor-as-collider model
 * and grey when all selected curves and sprites are
 * muted (the sprite cursor line itself is drawn in a
 * later commit); Sprite/Trigger Size
 * activates when the selection is exclusively that kind
 * (the row's label tracks which); Color activates for any
 * non-empty selection since curves, sprites, and triggers
 * all carry a per-object colour. Starting State's
 * four numeric fields and Curve Size W/H use absolute-
 * set semantics — typing a value commits that value as
 * the new coordinate (or dimension or velocity
 * component) for every applicable selected object — so
 * single-select, uniform multi-select, and varies
 * multi-select all flow through the same primitive.
 *
 * Band 3 — Callback slots. Three rows: hasHit, beenHit,
 * onTick. Each row carries a row label, a Can-X
 * checkbox, a function-name field, and a Create or
 * Go-to button. Every row activates for any non-empty
 * selection regardless of kinds, since the slot
 * vocabulary is shared across curves, triggers, and
 * sprites.
 *
 * Create / Go-to buttons. Operative for all three
 * slots. Both disable when the slot's Can-X checkbox
 * is unchecked or when the selection isn't single-
 * object. When checked and a single object is
 * selected, the displayed function name (or the
 * proposed default if the field is empty) is looked up
 * in scene.functionMap. Found triggers the Go-to label
 * and a goToFunction edit; not-found triggers the
 * Create label and a createFunctionStub edit. The
 * function-name field's text renders muted when the
 * named function doesn't yet exist in behaviors.js —
 * a low-key cue that the slot's not yet wired up.
 * Default proposed name when the field is empty is
 * slotName_objectId, e.g. onTick_sp_a3f7.
 *
 * cyclePattern field. The schema field exists on every
 * source but is not directly editable through the
 * inspector. Stage A3 of the pattern-authoring pivot
 * added the pattern row at the bottom of Band 1, whose
 * Create / Go-to button navigates into the Code tab
 * where labelled-statement blocks of the form
 * $objectId: expression act as the authoring surface
 * per section 28. Stage A4 will land Cmd-Enter routing
 * that promotes a labelled block's expression body to
 * the named object's cyclePattern field in scene.json;
 * until then, existing cyclePattern values keep firing
 * through the runtime but the Code-tab blocks are the
 * place to draft and revise.
 *
 * Stage 1 inert pieces. The function-name fields
 * accept any text without validation. A future stage
 * will add validateFunctionName for the three function
 * fields.
 *
 * Edit lifecycle. Editable fields share a validator-driven
 * commit lifecycle: hard errors squiggle red and refuse to
 * commit (Enter retains focus, blur silently reverts);
 * soft warnings squiggle yellow and commit; ok values
 * commit cleanly. Soft squiggles are transient — they
 * appear at commit time and are gone after the scene
 * reloads, except for Name's duplicate-name check which
 * runs at render time so the squiggle persists until the
 * conflict is resolved.
 *
 * Numeric fields support scroll-wheel adjustment. Hovering
 * over a numeric field and rotating the wheel nudges the
 * value in 0.3 increments — wheel up to increase, wheel
 * down to decrease. The validator clamps during scrolling
 * so field-specific bounds act as soft walls. Each wheel
 * event emits a fresh edit so the canvas, the JSON tab,
 * and any other scene-derived UI track the value
 * continually as the user scrolls. Wheel emits bypass the
 * keyboard commit's destruction-blur guard because wheel
 * scrolling doesn't focus the field.
 *
 * Greying rules.
 *   - Universal fields (Starting State X/Y, Hide Cursor)
 *     are active for any non-empty selection.
 *   - Object ID is active only for single-object
 *     selections; greyed for multi-select since the id
 *     is per-object unique.
 *   - Sprite/Trigger Size is active only when the selection
 *     is exclusively sprites or exclusively triggers; the
 *     row's label tracks which.
 *   - Curve Size and Curve Thickness are active only when
 *     at least one curve is selected. Cursor Size (R / L)
 *     and Cursor Thickness extend to curves and sprites
 *     and grey when all of them are muted.
 *   - Color is active when any object is present; curves,
 *     sprites, and triggers all carry a per-object
 *     colour.
 *   - Band 3 callback slots are universal: every row
 *     activates for any non-empty selection regardless
 *     of kinds.
 *   - Band 1's pattern row activates only for single-
 *     object selections.
 *
 * The Inspector exposes setSelection(), setScene(), and
 * setEditCallback(); main.js wires the three together so
 * the inspector tracks selection changes, scene reloads,
 * and edit commits.
 *
 * Aesthetic tracks GeoSonix closely: dark grey panel,
 * lighter grey field fills (visible even when empty so
 * each field's footprint reads), bright white labels and
 * values for active fields, muted grey for disabled
 * fields, green frames on editable fields, green-filled
 * checkboxes, green stepper dots on numeric fields. See
 * main.css for the .insp-* class styles that produce this
 * look.
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
