/**
 * Sample score: "Auto Rhythm Testbed".
 *
 * A test bed for the Auto beat-pattern generator (design/rhythm-auto-generation.md,
 * milestone M1). Two concentric circles in Auto beat mode, each firing an
 * UNPITCHED drum on its generated onsets so you hear the rhythm itself, not melody:
 *   - inner circle → kick (bd), playing the "straight" rhythm style
 *   - outer circle → hi-hat (hh), playing the "syncopated" rhythm style
 *
 * Each drum fires at the beat's strength (the default velocity), so you also hear
 * the generated DYNAMIC RANGE (the beat-strength spread). Pick a different rhythm
 * style for either circle in the inspector's Rhythm band to compare the built-ins
 * (straight / pushed / syncopated / offbeat / busy / sparse) without a trip to the
 * style editor.
 *
 * M1 is structural-only: the pattern is the same every cycle and does NOT yet
 * respond to the image (that's M3) — drop an image and the rhythm won't change,
 * which is the expected M1 boundary. The Active Beats / Beat Strength below are
 * pre-baked from those two styles so the score plays on load; re-picking a style
 * regenerates them.
 *
 * A sample is `{ id, name, description, build(name) → Bundle }`.
 */

// @ts-check

import { Bundle } from "../bundle.js";
import { getPreference } from "../preferences.js";
import { parseChord, parseKey } from "../irealChord.js";

/** A simple looping progression, so a later pitched voice would have changes to
 *  follow. The drums ignore it. */
function makeDemoHarmony() {
    const key = parseKey("C");
    const chord = (/** @type {string} */ sym) =>
        ({ type: "chord", chord: parseChord(sym, key), raw: sym });
    const bar = { type: "bar" };
    return {
        title: "Demo Changes",
        composer: "",
        key,
        timeSignature: [4, 4],
        progression: [chord("C^7"), bar, chord("A-7"), bar, chord("D-7"), bar, chord("G7"), bar],
    };
}

export const autoRhythmTestbed = {
    id: "auto-rhythm-testbed",
    name: "Auto Rhythm Testbed",
    description: "Two drum circles in Auto mode — kick (straight) + hi-hat (syncopated) — to test and compare the rhythm generator's styles.",
    /**
     * @param {string} [name]
     * @returns {Bundle}
     */
    build(name = "Auto Rhythm Testbed") {
        const bundle = new Bundle(name);
        const triggerScale = getPreference("defaultTriggerScale");
        const spriteScale = getPreference("defaultSpriteScale");
        const harmonyJson = JSON.stringify(makeDemoHarmony());

        bundle.addTextFile(
            "scene.json",
            `{
  "bpm": 120,
  "tonic": "C",
  "scaleName": "C major",
  "triggerScale": ${triggerScale},
  "spriteScale": ${spriteScale},
  "engine": "superdough",

  "harmony": ${harmonyJson},
  "harmonyLoop": true,

  "curves": [
    {
      "id": "CRV1",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 12, "h": 12 },
      "color": "#e0915a",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "beatPointsMode": "auto",
      "autoStyle": "straight",
      "beatInterval": "8th",
      "beatsPerCycle": 16,
      "beatsPerBar": 8,
      "activeBeats": "x.xx..xx|..xx..x.",
      "strength": "84546454|84546454",
      "canActiveBeat": true,
      "onActiveBeatFunction": "kick",
      "voice": { "superdough": { "sound": "bd", "bank": "RolandTR909" } }
    },
    {
      "id": "CRV2",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 22, "h": 22 },
      "color": "#5ad0c0",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "beatPointsMode": "auto",
      "autoStyle": "syncopated",
      "beatInterval": "8th",
      "beatsPerCycle": 16,
      "beatsPerBar": 8,
      "activeBeats": "xxxx..xx|..xx.xx.",
      "strength": "55555555|55555555",
      "canActiveBeat": true,
      "onActiveBeatFunction": "hat",
      "voice": { "superdough": { "sound": "hh", "bank": "RolandTR909" } }
    }
  ],

  "triggers": [],
  "sprites": [],

  "idCounters": { "sprite": 1, "trigger": 1, "curve": 3 }
}
`,
            "application/json"
        );

        bundle.addTextFile(
            "script.js",
            `// Auto Rhythm Testbed — two unpitched drum voices driving the rhythm generator.
// Each onActiveBeat fires its bank sample at the beat's strength (the default
// velocity), so you hear the generated PLACEMENT and DYNAMIC RANGE — no pitch in the way.
//   inner circle → kick (bd), playing the "straight" rhythm style
//   outer circle → hi-hat (hh), playing the "syncopated" rhythm style
// Pick a different rhythm style for either circle in the Rhythm band to compare them
// (straight / pushed / syncopated / offbeat / busy / sparse).

function kick() { playSound("bd"); }
function hat()  { playSound("hh"); }
`
        );

        return bundle;
    },
};
