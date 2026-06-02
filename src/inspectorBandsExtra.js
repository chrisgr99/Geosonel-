import {
    aggregateBoolean,
    aggregateString,
    aggregateVoiceField,
    patternUsesNote,
    patternUsesSound,
    selectedObjects,
} from "./inspectorSelection.js";
import {
    GLOBAL_BANK_OPTIONS,
    GLOBAL_SOUND_OPTIONS,
    PER_OBJECT_BANK_OPTIONS,
    PER_OBJECT_SOUND_OPTIONS,
    W,
} from "./inspectorShared.js";
import {
    mkCheckbox,
    mkLabel,
    mkRow,
    proposedFunctionName,
} from "./inspectorWidgets.js";

export const bandExtraMethods = {

    /**
     * Band 3 — Callback slots. Three rows: hasHit,
     * beenHit, onTick. Each row carries a row label, a
     * Can-X checkbox, a function-name field, and a
     * Create or Go-to button. Every row activates for
     * any non-empty selection regardless of kinds,
     * since the slot vocabulary is shared across
     * curves, triggers, and sprites. The canCycle gate
     * is gone (cursor presence is derived from cursor
     * extents and mute), the cycle duration
     * (beatsPerCycle) field lives on Band 1's second
     * row, and the cycle-pattern authoring row is the
     * third row of Band 1.
     *
     * Read binding aggregates each field across the
     * entire selection (objs.all). Multi-select
     * disagreement renders blank for the function-name
     * fields and as a tri-state varies-checkbox for the
     * Can-X bools. Editing a blank-varies field commits
     * the typed value to every selected object
     * regardless of kind.
     *
     * Create / Go-to buttons. Disabled when the slot's
     * Can-X checkbox is unchecked or when the selection
     * isn't single-object. When checked and a single
     * object is selected, the displayed function name
     * (or the proposed default when the field is empty)
     * is looked up in scene.functionMap; found triggers
     * Go-to, not-found triggers Create. The function-
     * name field renders muted when its text doesn't
     * resolve in functionMap.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandCallbackSlots(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        const objs = selectedObjects(this._scene, this._selection);
        const slotActive = ctx.total > 0;

        // Single-object context. The placeholder name, the
        // function-existence check, and the Create / Go-to
        // button gate all read against one specific object.
        // Multi-object selections drop to a blank
        // placeholder and a disabled button.
        const singleObj = (ctx.isSingle && objs.all.length === 1) ? objs.all[0] : null;

        const canHitAgg = aggregateBoolean(objs.all, "canHit");
        const hasHitFunctionAgg = aggregateString(objs.all, "hasHitFunction");
        const canBeHitAgg = aggregateBoolean(objs.all, "canBeHit");
        const beenHitFunctionAgg = aggregateString(objs.all, "beenHitFunction");
        const canTickAgg = aggregateBoolean(objs.all, "canTick");
        const onTickFunctionAgg = aggregateString(objs.all, "onTickFunction");

        // Three slot rows driven by a small config table
        // so they share one construction loop.
        /** @type {Array<{
         *   label: string,
         *   slotKey: "hasHit" | "beenHit" | "onTick",
         *   canEditKind: "setCanHit" | "setCanBeHit" | "setCanTick",
         *   canAgg: boolean | "varies",
         *   funcEditKind: "setHasHitFunction" | "setBeenHitFunction" | "setOnTickFunction",
         *   funcAgg: string | "varies",
         * }>} */
        const slotRows = [
            { label: "hasHit", slotKey: "hasHit", canEditKind: "setCanHit", canAgg: canHitAgg, funcEditKind: "setHasHitFunction", funcAgg: hasHitFunctionAgg },
            { label: "beenHit", slotKey: "beenHit", canEditKind: "setCanBeHit", canAgg: canBeHitAgg, funcEditKind: "setBeenHitFunction", funcAgg: beenHitFunctionAgg },
            { label: "onTick", slotKey: "onTick", canEditKind: "setCanTick", canAgg: canTickAgg, funcEditKind: "setOnTickFunction", funcAgg: onTickFunctionAgg },
        ];
        for (const row of slotRows) {
            const r = mkRow();
            r.appendChild(mkLabel(row.label, { width: W.leftLabel, disabled: !slotActive }));
            r.appendChild(mkCheckbox({
                checked: row.canAgg === true,
                varies: row.canAgg === "varies",
                disabled: !slotActive,
                onClick: slotActive
                    ? () => this._onBooleanCheckboxClick(row.canEditKind, row.canAgg)
                    : undefined,
            }));

            // Field value and placeholder. Aggregate
            // disagreement renders blank; the placeholder
            // hint is the proposed default name when the
            // field is empty and the selection is a single
            // object.
            const fieldValue = row.funcAgg === "varies" ? "" : row.funcAgg;
            const placeholder = singleObj !== null
                ? proposedFunctionName(row.slotKey, singleObj)
                : "";
            // Effective name for existence-and-button
            // purposes: typed value if non-empty, else
            // the proposed default. Empty effective name
            // (multi-object with no typed value) means
            // there's no name to look up or scaffold and
            // the button stays disabled.
            const effectiveName = fieldValue.length > 0 ? fieldValue : placeholder;
            const functionExists = effectiveName.length > 0
                && this._functionExistsInScene(effectiveName);

            r.appendChild(this._buildSlotField({
                value: fieldValue,
                placeholder,
                width: W.callbackField,
                editable: slotActive,
                functionExists,
                editKind: row.funcEditKind,
            }));

            // Button. Disabled when slot Can-X unchecked,
            // multi-object selected, or no name to act on.
            const canChecked = row.canAgg === true;
            const buttonEnabled = canChecked && singleObj !== null && effectiveName.length > 0;
            const buttonLabel = functionExists ? "Go to" : "Create";
            r.appendChild(this._buildSlotButton({
                label: buttonLabel,
                disabled: !buttonEnabled,
                slotKey: row.slotKey,
                functionName: effectiveName,
                functionExists,
            }));

            band.appendChild(r);
        }

        return band;
    },

    /**
     * Middle area band. Populated when the active sound
     * engine is superdough: two dropdowns let the user
     * override the strudel sound and bank used for any
     * pattern event that doesn't carry an explicit one,
     * with a "Default" sentinel at the top of each list
     * meaning "no injection — let the pattern's own
     * values (or strudel's no-s defaults) win". The
     * pitched-sound dropdown applies to events from
     * note() and n() patterns (no s field on the event);
     * the unpitched-bank dropdown applies to events from
     * sound() patterns whose s field is a raw drum name
     * with no underscore. Soft-injection happens in the
     * firing engine right before dispatch, so explicit
     * pattern values like sound("bd").bank("RolandTR808")
     * always win. The right side of the band is left
     * empty as a reservation for future per-object
     * effects controls.
     *
     * Empty when the active engine is MIDI (no per-object
     * MIDI voice fields in this commit — see IN_FLIGHT for
     * the rationale, briefly: Electron mode exposes a
     * single virtual GeoSonel CoreMIDI source and per-
     * track routing happens inside the DAW). Future
     * engines (tone, csound, dough) will reshape the
     * band based on this._scene.engine the same way the
     * superdough branch does today.
     *
     * @param {ReturnType<typeof buildSelectionContext>} ctx
     */
    _buildBandMiddleArea(ctx) {
        const band = document.createElement("div");
        band.className = "insp-band insp-band-middle";

        const engine =
            (this._scene !== null && typeof this._scene.engine === "string")
                ? this._scene.engine
                : "midi";
        if (engine !== "superdough") return band;

        const objs = selectedObjects(this._scene, this._selection);
        const voiceActive = ctx.total > 0;
        const soundAgg = aggregateVoiceField(objs.all, "superdough", "sound");
        const bankAgg = aggregateVoiceField(objs.all, "superdough", "bank");

        // Per-field relevance. A Note Voice override only
        // has an effect on events from note() / n() patterns
        // (which carry no s field for the sound to fill);
        // a Sound Bank override only matters for events from
        // sound() / s() patterns (raw drum names the bank
        // prefixes). When a single object's pattern uses
        // only one of those forms, the other dropdown is
        // greyed as a hint that it would do nothing for this
        // object. The check is textual on the cyclePattern
        // string (see patternUsesNote / patternUsesSound),
        // deliberately simple: it can be fooled by unusual
        // patterns, so it only ever greys a field, never
        // disables the underlying edit path, and both fields
        // stay active whenever the relevance is uncertain.
        // Uncertain cases that leave BOTH active: multi-
        // select (per-object patterns may differ), an empty
        // or unparsed-looking pattern, or a pattern that uses
        // both forms. This mirrors the "never surprise the
        // user with a disabled control" stance the rest of
        // the inspector takes.
        let soundRelevant = true;
        let bankRelevant = true;
        if (ctx.isSingle && objs.all.length === 1) {
            const pat = objs.all[0].cyclePattern;
            const patText = typeof pat === "string" ? pat : "";
            const usesNote = patternUsesNote(patText);
            const usesSound = patternUsesSound(patText);
            // Only narrow when exactly one form is present.
            // Neither-present (empty / still-typing / non-
            // standard) and both-present both leave the
            // fields as they are.
            if (usesNote !== usesSound) {
                soundRelevant = usesNote;
                bankRelevant = usesSound;
            }
        }

        const r1 = mkRow();
        r1.appendChild(mkLabel("Note\nVoice", {
            width: W.leftLabel,
            disabled: !voiceActive || !soundRelevant,
            multiline: true,
        }));
        r1.appendChild(this._buildDropdownField({
            options: PER_OBJECT_SOUND_OPTIONS,
            value: soundAgg === "varies" ? "" : soundAgg,
            width: W.voiceField,
            editable: voiceActive && soundRelevant,
            editKind: "setVoiceSuperdoughSound",
        }));
        band.appendChild(r1);

        const r2 = mkRow();
        r2.appendChild(mkLabel("Sound\nBank", {
            width: W.leftLabel,
            disabled: !voiceActive || !bankRelevant,
            multiline: true,
        }));
        r2.appendChild(this._buildDropdownField({
            options: PER_OBJECT_BANK_OPTIONS,
            value: bankAgg === "varies" ? "" : bankAgg,
            width: W.voiceField,
            editable: voiceActive && bankRelevant,
            editKind: "setVoiceSuperdoughBank",
        }));
        band.appendChild(r2);

        return band;
    },

    /**
     * Global band. Sits at the bottom of the inspector,
     * always visible regardless of selection. Carries the
     * Sound Engine dropdown that controls which engine
     * the rest of the audio surfaces reshape around. The
     * dropdown reads scene.engine (null falls back to
     * "midi" for the brief startup window before the
     * loader's migration pass fills the field); changes
     * emit a setSceneEngine edit that main.js routes
     * through applySceneEdit, which writes the new value
     * to scene.json, marks the bundle dirty, and re-runs
     * the scene so firingEngine.setOutputMode picks up
     * the change.
     *
     * Under superdough the band also carries two voice
     * rows below the engine dropdown — the score-wide
     * Note Voice and Sound Bank defaults that per-object
     * voices left on "Global" inherit (see
     * _buildBandMiddleArea). Their top sentinel is
     * "Default" (inject nothing) since the global band
     * can't inherit from itself. Further global-band
     * content (per-engine score-wide effect controls —
     * superdough's reverb and delay character knobs,
     * Tone.js's score-wide layer if added) would layer
     * below those when it lands. The engine dropdown
     * stays at the top of the band as the parent control
     * the rest of the audio surfaces depend on.
     *
     * @param {ReturnType<typeof buildSelectionContext>} _ctx
     */
    _buildBandGlobal(_ctx) {
        const band = document.createElement("div");
        band.className = "insp-band";

        // Section header titling the band as "Global
        // Settings". The header plus the heavier
        // separator above the band together do the work
        // of marking the global section as distinct from
        // the per-object bands, without depending on a
        // layout mechanism to push the band to the
        // bottom of the pane. Future per-object voice
        // fields in the middle band will naturally
        // space the global section lower as content
        // populates the middle area.
        const header = document.createElement("div");
        header.className = "insp-band-header";
        header.textContent = "Global Settings";
        band.appendChild(header);

        const engineValue =
            (this._scene !== null && typeof this._scene.engine === "string")
                ? this._scene.engine
                : "midi";

        const r = mkRow();
        r.appendChild(mkLabel("Sound\nEngine", {
            width: W.soundEngineLabel,
            multiline: true,
        }));
        r.appendChild(this._buildDropdownField({
            options: [
                { value: "midi", label: "MIDI" },
                { value: "superdough", label: "Superdough (Web Audio)" },
            ],
            value: engineValue,
            width: W.soundEngine,
            editable: true,
            editKind: "setSceneEngine",
        }));
        band.appendChild(r);

        // Global voice rows. Visible only under superdough,
        // matching the middle band's gate. These set the
        // score-wide default Note Voice and Sound Bank that
        // every per-object voice left on "Global" inherits.
        // The top sentinel in each list is "Default" (inject
        // nothing / superdough's own default) rather than
        // the per-object band's "Global", since the global
        // band can't inherit from itself. Read directly
        // from scene.voiceSuperdough.{sound,bank} with
        // object guards; an absent or non-string field
        // reads as the empty-string "Default" sentinel.
        // Never pattern-greyed — the global voice is score-
        // wide and not tied to any one object's pattern —
        // so editable is unconditionally true here, unlike
        // the middle band's per-object dropdowns.
        if (engineValue === "superdough") {
            const vs =
                (this._scene !== null
                    && this._scene.voiceSuperdough !== null
                    && typeof this._scene.voiceSuperdough === "object"
                    && !Array.isArray(this._scene.voiceSuperdough))
                    ? this._scene.voiceSuperdough
                    : null;
            const globalSoundVal =
                (vs !== null && typeof vs.sound === "string") ? vs.sound : "";
            const globalBankVal =
                (vs !== null && typeof vs.bank === "string") ? vs.bank : "";

            const vr1 = mkRow();
            vr1.appendChild(mkLabel("Note\nVoice", {
                width: W.leftLabel,
                multiline: true,
            }));
            vr1.appendChild(this._buildDropdownField({
                options: GLOBAL_SOUND_OPTIONS,
                value: globalSoundVal,
                width: W.voiceField,
                editable: true,
                editKind: "setSceneVoiceSuperdoughSound",
            }));
            band.appendChild(vr1);

            const vr2 = mkRow();
            vr2.appendChild(mkLabel("Sound\nBank", {
                width: W.leftLabel,
                multiline: true,
            }));
            vr2.appendChild(this._buildDropdownField({
                options: GLOBAL_BANK_OPTIONS,
                value: globalBankVal,
                width: W.voiceField,
                editable: true,
                editKind: "setSceneVoiceSuperdoughBank",
            }));
            band.appendChild(vr2);
        }

        return band;
    },
};
