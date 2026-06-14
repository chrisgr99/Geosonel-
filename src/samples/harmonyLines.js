/**
 * Sample score: "Harmony Lines" (working name).
 *
 * Two image-driven voices — a sawtooth bass (inner circle) and a piano melody
 * (outer circle) — each with 16 beat points that read the colour under the
 * cursor and turn it into a stepwise, chord-aware line (nxtNote) over a
 * looping C^7 | A-7 | D-7 | G7 progression. Drop an image on the canvas to
 * drive the notes. This is the first sample and the piece we'll evolve the
 * default-score behaviour from.
 *
 * A sample is `{ id, name, description, build(name) → Bundle }`. The build
 * returns an UNTITLED bundle (path null) so opening it lands an editable copy;
 * the original is never touched. Lives in src/samples/ so adding a sample is a
 * new file here plus a line in the manifest (src/samples/index.js).
 */

// @ts-check

import { Bundle } from "../bundle.js";
import { getPreference } from "../preferences.js";
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
    description: "Image-driven bass + melody following a looping chord progression.",
    /**
     * @param {string} [name]
     * @returns {Bundle}
     */
    build(name = "Harmony Lines") {
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
      "beatsPerCycle": 16,
      "beatInterval": "Qtr",
      "beatPointsMode": "normal",
      "activeBeats": "x",
      "strength": "9 6 6 6",
      "canActiveBeat": true,
      "onActiveBeatFunction": "bass"
    },
    {
      "id": "CRV2",
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 20, "h": 20 },
      "color": "#5a9be0",
      "cursorR": 2,
      "cursorL": 0,
      "cycleSpeeds": "1",
      "beatsPerCycle": 16,
      "beatInterval": "Qtr",
      "beatPointsMode": "normal",
      "activeBeats": "x",
      "strength": "9 6 6 6",
      "canActiveBeat": true,
      "onActiveBeatFunction": "melody"
    }
  ],

  "triggers": [
    { "id": "TRG1", "x":  9, "y":  0, "note": 60 },
    { "id": "TRG2", "x": -9, "y":  0, "note": 64 },
    { "id": "TRG3", "x":  0, "y":  9, "note": 67 },
    { "id": "TRG4", "x":  0, "y": -9, "note": 72 }
  ],

  "sprites": [
    { "id": "SPR1", "x": 0, "y": 0, "vx": 1, "vy": 1, "cycleSpeeds": "1 -1" }
  ],

  "idCounters": { "sprite": 2, "trigger": 5, "curve": 3 }
}
`,
            "application/json"
        );

        bundle.addTextFile(
            "script.js",
            `// Each circle reads the image colour under its 16 beat points
// (this.col.lt = lightness) and turns it into a melodic LINE that follows
// the chord progression: nxtNote favours stepwise motion and chord tones,
// so the colours shape a real melody and bass rather than leaping randomly.
// Inner circle = bass, outer = melody. Drop an image on the canvas to drive
// them; edit the changes in the Harmony tab. Try styles.lead, or a custom
// { ...styles.melody, scale: "blues" }.

function bass() {
  // Inner circle — low, root-locked, walking the changes.
  playNote("sawtooth", nxtNote(this.col.lt, styles.bass), this.vel, 1);
}

function melody() {
  // Outer circle — larger radius samples the image further out, so it's an
  // independent voice in the upper register.
  playNote("piano", nxtNote(this.col.lt, styles.melody), this.vel, 1);
}
`,
        );

        return bundle;
    },
};
