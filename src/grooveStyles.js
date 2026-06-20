/**
 * Built-in Groove styles (the rhythm-generator presets). Defined here — not in
 * the Styles-tab UI module — so both the Styles tab and the inspector's Auto-mode
 * Style dropdown can list them. For this slice a groove is an MStyle whose rhythm
 * core is what matters; the dedicated GrooveStyle class + generator land later.
 */

// @ts-check

import { MStyle } from "./mStyle.js";

export const BUILTIN_GROOVE = {
    straight: new MStyle({
        rhythm: {
            density: 0.5, syncopation: 0.05, accents: 0.6,
            imageTiming: { amount: 0.4, channel: "b" },
        },
    }),
    syncopated: new MStyle({
        rhythm: {
            density: 0.6, syncopation: 0.4, accents: 0.5,
            imageTiming: { amount: 0.5, channel: "b" },
            ratchets: { frequency: 0.15, intensity: 0.5 },
        },
    }),
};

export const BUILTIN_GROOVE_NAMES = Object.keys(BUILTIN_GROOVE);
