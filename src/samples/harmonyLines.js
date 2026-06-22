/**
 * Sample score: "Harmony Lines".
 *
 * Two INSTRUMENT voices — a sawtooth bass (inner circle) and a piano melody
 * (outer circle) — each with a Strudel BEAT-STRENGTH PATTERN that turns the
 * colour under the cursor into a stepwise, chord-aware line over a looping
 * C^7 | A-7 | D-7 | G7 progression. Each voice carries an inspector-assigned
 * note STYLE (onActiveBeatStyle = "bass" / "melodic"); the callback reads it
 * with nxtSound and plays it with playSound. Drop an image on the canvas to
 * drive the notes; edit the changes in the Harmony tab.
 *
 * Exercises the new system: Strudel beat-strength patterns, Instrument voices,
 * inspector-assigned nxtSound styles, and the type-agnostic nxtSound → playSound
 * path (the SAME callback would fire a drum for a Beatbox voice). Load Engine in
 * the transport bar to hear it.
 *
 * A sample is `{ id, name, description, build(name) → Bundle }`; the build
 * returns an UNTITLED bundle so opening it lands an editable copy.
 */

// @ts-check

import { Bundle } from "../bundle.js";
import { parseChord, parseKey } from "../irealChord.js";

/**
 * The baked-in demo harmony: a simple looping progression (C^7 | A-7 | D-7 |
 * G7 in C major) so the lines have changes to follow. Chords are built with
 * the real parser so they match an imported chart.
 * @returns {object}
 */
function makeDemoHarmony() {
    const key = parseKey("C"); // { tonicPitchClass: 0, mode: "major" }
    const chord = (/** @type {string} */ sym) =>
        ({ type: "chord", chord: parseChord(sym, key), raw: sym });
    const bar = { type: "bar" };
    return {
        title: "Demo Changes",
        composer: "",
        key,
        timeSignature: [4, 4],
        progression: [
            chord("C^7"), bar,
            chord("A-7"), bar,
            chord("D-7"), bar,
            chord("G7"), bar,
        ],
    };
}

export const harmonyLines = {
    id: "harmony-lines",
    name: "Harmony Lines",
    description: "Strudel-driven bass + melody (Instrument voices) following a chord loop.",
    /**
     * @param {string} [name]
     * @returns {Bundle}
     */
    build(name = "Harmony Lines") {
        const bundle = new Bundle(name);
        const harmonyJson = JSON.stringify(makeDemoHarmony());

        bundle.addTextFile(
            "scene.json",
            `{
  "bpm": 110,
  "tonic": "C",
  "scaleName": "C major",
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
      "measures": 4,
      "repeats": 1,
      "beatPointsMode": "strudel",
      "beatPattern": "9 ~ 5 ~",
      "canActiveBeat": true,
      "onActiveBeatFunction": "bass",
      "onActiveBeatStyle": "bass",
      "voice": { "superdough": { "source": "instrument", "sound": "sawtooth" } }
    },
    {
      "id": "CRV2",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 20, "h": 20 },
      "color": "#5a9be0",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "measures": 4,
      "repeats": 1,
      "beatPointsMode": "strudel",
      "beatPattern": "7 5 9 5 7 5 9 5 | 9 5 7 5 | 5 7 9 7 | 9 ~ 7 5",
      "canActiveBeat": true,
      "onActiveBeatFunction": "melody",
      "onActiveBeatStyle": "melodic",
      "voice": { "superdough": { "source": "instrument", "sound": "piano" } }
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
            `// Two INSTRUMENT voices following the chord loop. Each circle's rhythm is a
// Strudel Beat-Strength Pattern (Rhythm band), and each carries an
// inspector-assigned note STYLE (Band 3) — "bass" on the inner circle,
// "melodic" on the outer.
//
// nxtSound(this.style) reads the object's voice (Instrument here, so it makes a
// pitched, chord-aware note from the style — pitch from lightness, velocity from
// the beat strength) and playSound plays it through that voice's sound
// (sawtooth / piano). The SAME callback would fire a drum for a Beatbox voice —
// nxtSound and playSound are type-agnostic.
//
// Drop an image on the canvas to drive the lines; edit the changes in the
// Harmony tab; try a different style in Band 3 or a different sound in the
// Voice band. Load Engine to hear it.

function bass()   { playSound(nxtSound(this.style)); }
function melody() { playSound(nxtSound(this.style)); }
`,
        );

        return bundle;
    },
};
