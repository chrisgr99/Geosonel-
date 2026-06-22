/**
 * Sample score: "Beatbox Kit".
 *
 * Three concentric circles, each a BEATBOX voice on a RolandTR909 (kick, snare,
 * hat) whose rhythm is authored as a Strudel BEAT-STRENGTH PATTERN — digits 0-9
 * are the per-beat accent, "~" a rest. One callback (`drum`) drives all three:
 * nxtSound reads each object's voice (set to Beatbox + bank + sound in the
 * inspector's Rhythm/Voice bands) and playSound fires that drum at the beat's
 * strength. Edit a pattern in the Rhythm band's "Beat Strength Pattern" field,
 * or swap a drum in the Voice band's Beatbox row, and play.
 *
 * Exercises the new system end to end: Strudel beat-strength patterns, the
 * Instrument/Beatbox voice radio (Beatbox here), and the type-agnostic
 * nxtSound → playSound path. Load Engine in the transport bar to hear it.
 *
 * A sample is `{ id, name, description, build(name) → Bundle }`; the build
 * returns an UNTITLED bundle so opening it lands an editable copy.
 */

// @ts-check

import { Bundle } from "../bundle.js";

export const beatboxKit = {
    id: "beatbox-kit",
    name: "Beatbox Kit",
    description: "Three RolandTR909 drum voices, each a Strudel beat-strength pattern.",
    /**
     * @param {string} [name]
     * @returns {Bundle}
     */
    build(name = "Beatbox Kit") {
        const bundle = new Bundle(name);

        bundle.addTextFile(
            "scene.json",
            `{
  "bpm": 110,
  "tonic": "C",
  "scaleName": "C major",
  "engine": "superdough",

  "curves": [
    {
      "id": "CRV1",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 26, "h": 26 },
      "color": "#e0915a",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "measures": 2,
      "repeats": 1,
      "beatPointsMode": "strudel",
      "beatPattern": "9 ~ 5 ~ | 9 ~ 5 9",
      "canActiveBeat": true,
      "onActiveBeatFunction": "drum",
      "voice": { "superdough": { "source": "beatbox", "bank": "RolandTR909", "sample": "bd" } }
    },
    {
      "id": "CRV2",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 20, "h": 20 },
      "color": "#5a9be0",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "measures": 2,
      "repeats": 1,
      "beatPointsMode": "strudel",
      "beatPattern": "~ 9 ~ 9",
      "canActiveBeat": true,
      "onActiveBeatFunction": "drum",
      "voice": { "superdough": { "source": "beatbox", "bank": "RolandTR909", "sample": "sd" } }
    },
    {
      "id": "CRV3",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 14, "h": 14 },
      "color": "#9ec79e",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "measures": 2,
      "repeats": 1,
      "beatPointsMode": "strudel",
      "beatPattern": "7 5 7 5 7 5 7 5",
      "canActiveBeat": true,
      "onActiveBeatFunction": "drum",
      "voice": { "superdough": { "source": "beatbox", "bank": "RolandTR909", "sample": "hh" } }
    }
  ],

  "triggers": [],
  "sprites": [],

  "idCounters": { "sprite": 1, "trigger": 1, "curve": 4 }
}
`,
            "application/json"
        );

        bundle.addTextFile(
            "script.js",
            `// Beatbox Kit — three RolandTR909 drum voices (kick / snare / hat), each
// authored as a Strudel Beat-Strength Pattern in the Rhythm band: digits 0-9
// are the beat accent, "~" a rest. Every voice is set to Beatbox (bank +
// sound) in the Voice band.
//
// One callback drives them all: nxtSound() reads THIS object's voice — here a
// beatbox drum — and shapes a hit from the style's velocity/duration (no
// pitch). playSound then fires that drum at the beat's strength. The same
// function would play a pitched line for an Instrument voice — nxtSound and
// playSound are type-agnostic. Load Engine to hear it; tweak a pattern or swap
// a drum and play again.

function drum() { playSound(nxtSound(this.style)); }
`,
        );

        return bundle;
    },
};
