/**
 * Built-in Rhythm styles (the rhythm-generator presets). Defined here — not in
 * the Styles-tab UI module — so both the Styles tab and the inspector's Auto-mode
 * Style dropdown can list them. For this slice a rhythm style is an MStyle whose
 * rhythm core is what matters; the dedicated RhythmStyle class + generator land later.
 */

// @ts-check

import { MStyle, materializeMStyle } from "./mStyle.js";
import { getStyleRecord } from "./styleStore.js";

// A spread of rhythm styles from straight to off-beat, plus density extremes, so
// the dropdown offers a wide A/B set without a trip to the style editor. (Only the
// fields that vary are set; mergeRhythmCore fills the rest.)
export const BUILTIN_RHYTHM = {
    straight:   new MStyle({ rhythm: { density: 0.55, syncopation: 0.0,  dynamicRange: 0.7 } }),
    pushed:     new MStyle({ rhythm: { density: 0.55, syncopation: 0.35, dynamicRange: 0.6 } }),
    syncopated: new MStyle({ rhythm: { density: 0.6,  syncopation: 0.6,  dynamicRange: 0.5 } }),
    offbeat:    new MStyle({ rhythm: { density: 0.55, syncopation: 1.0,  dynamicRange: 0.5 } }),
    busy:       new MStyle({ rhythm: { density: 0.85, syncopation: 0.05, dynamicRange: 0.6 } }),
    sparse:     new MStyle({ rhythm: { density: 0.3,  syncopation: 0.1,  dynamicRange: 0.8 } }),
};

export const BUILTIN_RHYTHM_NAMES = Object.keys(BUILTIN_RHYTHM);

/**
 * Resolve a rhythm-style NAME to a RhythmStyle (an MStyle whose `.rhythm` core
 * drives the generator): a user style from the library, else a built-in, else
 * the default ("straight"). Resolved by the generator's CALLER so the generator
 * itself stays pure. Not a hot path (generation runs per cycle, not per note), so
 * it resolves on demand with no cache.
 * @param {string} name @returns {MStyle}
 */
export function resolveRhythm(name) {
    if (typeof name === "string" && name !== "") {
        const rec = getStyleRecord("rhythm", name);
        if (rec) return materializeMStyle(rec.def);
        if (Object.prototype.hasOwnProperty.call(BUILTIN_RHYTHM, name)) {
            return BUILTIN_RHYTHM[name];
        }
    }
    return BUILTIN_RHYTHM.straight;
}
