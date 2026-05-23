// Auto-generated from the Strudel monorepo via
// scripts/refresh-strudel-doc.sh. Do not edit by hand; re-run
// the refresh script if a new Strudel release adds functions.
// AGPL-3.0-or-later (see repo-root LICENSE; original from
// https://codeberg.org/uzu/strudel).
//
// Refreshed: 2026-05-23
// Entries: 597
export default {
  "docs": [
    {
      "name": "markcss",
      "longname": "markcss",
      "description": "<p>Overrides the css of highlighted events. Make sure to use single quotes!</p>",
      "examples": [
        "note(\"c a f e\")\n.markcss('text-decoration:underline')"
      ],
      "kind": "member",
      "tags": [
        {
          "originalTitle": "tag",
          "title": "tag",
          "text": "visualization",
          "value": "visualization"
        }
      ]
    },
    {
      "name": "slider",
      "longname": "slider",
      "description": "<p>Displays a slider widget to allow the user manipulate a value</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Initial value</p>",
          "name": "value"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Minimum value - optional, defaults to 0</p>",
          "name": "min"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Maximum value - optional, defaults to 1</p>",
          "name": "max"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Step size - optional</p>",
          "name": "step"
        }
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "visualization"
      ]
    },
    {
      "name": "s",
      "longname": "s",
      "description": "<p>Select a sound / sample by name. When using mininotation, you can also optionally supply 'n' and 'gain' parameters\nseparated by ':'.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>The sound / pattern of sounds to pick</p>",
          "name": "sound"
        }
      ],
      "examples": [
        "s(\"bd hh\")",
        "s(\"bd:0 bd:1 bd:0:0.3 bd:1:1.4\")"
      ],
      "synonyms": [
        "sound"
      ],
      "synonyms_text": "sound",
      "kind": "member",
      "tags": [
        "superdough",
        "samples"
      ]
    },
    {
      "name": "wt",
      "longname": "wt",
      "description": "<p>Position in the wavetable of the wavetable oscillator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Position in the wavetable from 0 to 1</p>",
          "name": "position"
        }
      ],
      "examples": [
        "s(\"squelch\").bank(\"wt_digital\").seg(8).note(\"F1\").wt(\"0 0.25 0.5 0.75 1\")"
      ],
      "synonyms": [
        "wavetablePosition"
      ],
      "synonyms_text": "wavetablePosition",
      "kind": "member",
      "tags": [
        "wavetable",
        "superdough"
      ]
    },
    {
      "name": "wtenv",
      "longname": "wtenv",
      "description": "<p>Amount of envelope applied wavetable oscillator's position envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "amount"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "wtattack",
      "longname": "wtattack",
      "description": "<p>Attack time of the wavetable oscillator's position envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>attack time in seconds</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "wtatt"
      ],
      "synonyms_text": "wtatt",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "wtdecay",
      "longname": "wtdecay",
      "description": "<p>Decay time of the wavetable oscillator's position envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>decay time in seconds</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "wtdec"
      ],
      "synonyms_text": "wtdec",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "wtsustain",
      "longname": "wtsustain",
      "description": "<p>Sustain time of the wavetable oscillator's position envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>sustain level (0 to 1)</p>",
          "name": "gain"
        }
      ],
      "synonyms": [
        "wtsus"
      ],
      "synonyms_text": "wtsus",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "wtrelease",
      "longname": "wtrelease",
      "description": "<p>Release time of the wavetable oscillator's position envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>release time in seconds</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "wtrel"
      ],
      "synonyms_text": "wtrel",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "wtrate",
      "longname": "wtrate",
      "description": "<p>Rate of the LFO for the wavetable oscillator's position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in hertz</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "wtsync",
      "longname": "wtsync",
      "description": "<p>cycle synced rate of the LFO for the wavetable oscillator's position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in cycles</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "wtdepth",
      "longname": "wtdepth",
      "description": "<p>Depth of the LFO for the wavetable oscillator's position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "wtshape",
      "longname": "wtshape",
      "description": "<p>Shape of the LFO for the wavetable oscillator's position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          "name": "shape"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "wtdc",
      "longname": "wtdc",
      "description": "<p>DC offset of the LFO for the wavetable oscillator's position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>dc offset. set to 0 for unipolar</p>",
          "name": "dcoffset"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "wtskew",
      "longname": "wtskew",
      "description": "<p>Skew of the LFO for the wavetable oscillator's position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>How much to bend the LFO shape</p>",
          "name": "skew"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "warp",
      "longname": "warp",
      "description": "<p>Amount of warp (alteration of the waveform) to apply to the wavetable oscillator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Warp of the wavetable from 0 to 1</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"basique\").bank(\"wt_digital\").seg(8).note(\"F1\").warp(\"0 0.25 0.5 0.75 1\")\n  .warpmode(\"spin\")"
      ],
      "synonyms": [
        "wavetableWarp"
      ],
      "synonyms_text": "wavetableWarp",
      "kind": "member",
      "tags": [
        "wavetable",
        "superdough"
      ]
    },
    {
      "name": "warpattack",
      "longname": "warpattack",
      "description": "<p>Attack time of the wavetable oscillator's warp envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>attack time in seconds</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "warpatt"
      ],
      "synonyms_text": "warpatt",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "warpdecay",
      "longname": "warpdecay",
      "description": "<p>Decay time of the wavetable oscillator's warp envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>decay time in seconds</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "warpdec"
      ],
      "synonyms_text": "warpdec",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "warpsustain",
      "longname": "warpsustain",
      "description": "<p>Sustain time of the wavetable oscillator's warp envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>sustain level (0 to 1)</p>",
          "name": "gain"
        }
      ],
      "synonyms": [
        "warpsus"
      ],
      "synonyms_text": "warpsus",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "warprelease",
      "longname": "warprelease",
      "description": "<p>Release time of the wavetable oscillator's warp envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>release time in seconds</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "warprel"
      ],
      "synonyms_text": "warprel",
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "warprate",
      "longname": "warprate",
      "description": "<p>Rate of the LFO for the wavetable oscillator's warp</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in hertz</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "warpdepth",
      "longname": "warpdepth",
      "description": "<p>Depth of the LFO for the wavetable oscillator's warp</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "warpshape",
      "longname": "warpshape",
      "description": "<p>Shape of the LFO for the wavetable oscillator's warp</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          "name": "shape"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "warpdc",
      "longname": "warpdc",
      "description": "<p>DC offset of the LFO for the wavetable oscillator's warp</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>dc offset. set to 0 for unipolar</p>",
          "name": "dcoffset"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "warpskew",
      "longname": "warpskew",
      "description": "<p>Skew of the LFO for the wavetable oscillator's warp</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>How much to bend the LFO shape</p>",
          "name": "skew"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "warpmode",
      "longname": "warpmode",
      "description": "<p>Type of warp (alteration of the waveform) to apply to the wavetable oscillator.</p>\n<p>The current options are: none, asym, bendp, bendm, bendmp, sync, quant, fold, pwm, orbit,\nspin, chaos, primes, binary, brownian, reciprocal, wormhole, logistic, sigmoid, fractal, flip</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "string",
              "Pattern"
            ]
          },
          "description": "<p>Warp mode</p>",
          "name": "mode"
        }
      ],
      "examples": [
        "s(\"morgana\").bank(\"wt_digital\").seg(8).note(\"F1\").warp(\"0 0.25 0.5 0.75 1\")\n  .warpmode(\"<asym bendp spin logistic sync wormhole brownian>*2\")"
      ],
      "synonyms": [
        "wavetableWarpMode"
      ],
      "synonyms_text": "wavetableWarpMode",
      "kind": "member",
      "tags": [
        "wavetable",
        "superdough"
      ]
    },
    {
      "name": "wtphaserand",
      "longname": "wtphaserand",
      "description": "<p>Amount of randomness of the initial phase of the wavetable oscillator.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Randomness of the initial phase. Between 0 (not random) and 1 (fully random)</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"basique\").bank(\"wt_digital\").seg(16).wtphaserand(\"<0 1>\")"
      ],
      "synonyms": [
        "wavetablePhaseRand"
      ],
      "synonyms_text": "wavetablePhaseRand",
      "kind": "member",
      "tags": [
        "wavetable",
        "superdough"
      ]
    },
    {
      "name": "warpenv",
      "longname": "warpenv",
      "description": "<p>Amount of envelope applied wavetable oscillator's position envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "amount"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "warpsync",
      "longname": "warpsync",
      "description": "<p>cycle synced rate of the LFO for the wavetable warp position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in cycles</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "wavetable",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "source",
      "longname": "source",
      "description": "<p>Define a custom webaudio node to use as a sound source.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "getSource"
        }
      ],
      "synonyms": [
        "src"
      ],
      "synonyms_text": "src",
      "kind": "member",
      "tags": [
        "external_io",
        "superdough"
      ]
    },
    {
      "name": "n",
      "longname": "n",
      "description": "<p>Selects the given index:</p>\n<ul>\n<li>for samples, it picks the sample by index, with wrap around</li>\n<li>for scales, it picks the scale degree</li>\n<li>for voicings, it picks the voice index</li>\n</ul>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>sample index starting from 0</p>",
          "name": "value"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*6\").n(\"<0 1>\")"
      ],
      "kind": "member",
      "tags": [
        "superdough",
        "samples",
        "tonal"
      ]
    },
    {
      "name": "i",
      "longname": "i",
      "description": "<p>Selects the given degree. Currently used in <code>xen</code> and <code>tune</code>:</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "value"
        }
      ],
      "examples": [
        "i(\"0 1 2 3 4 5 6 7\").xen(\"<5edo 10edo 15edo hexany15>\")"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "note",
      "longname": "note",
      "description": "<p>Plays the given note name or midi number. A note name consists of</p>\n<ul>\n<li>a letter (a-g or A-G)</li>\n<li>optional accidentals (b or #)</li>\n<li>optional (possibly negative) octave number (0-9). Defaults to 3</li>\n</ul>\n<p>Examples of valid note names: <code>c</code>, <code>bb</code>, <code>Bb</code>, <code>f#</code>, <code>c3</code>, <code>A4</code>, <code>Eb2</code>, <code>c#5</code></p>\n<p>You can also use midi numbers instead of note names, where 69 is mapped to A4 440Hz in 12EDO.</p>",
      "examples": [
        "note(\"c a f e\")",
        "note(\"c4 a4 f4 e4\")",
        "note(\"60 69 65 64\")",
        "note(\"fbb1 a#0 cbbb-1 e##-2\").sound(\"saw\")"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "accelerate",
      "longname": "accelerate",
      "description": "<p>A pattern of numbers that speed up (or slow down) samples while they play. Currently only supported by osc / superdirt.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>acceleration.</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"sax\").accelerate(\"<0 1 2 4 8 16>\").slow(2).osc()"
      ],
      "kind": "member",
      "tags": [
        "samples",
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "velocity",
      "longname": "velocity",
      "description": "<p>Sets the velocity from 0 to 1. Is multiplied together with gain.</p>",
      "examples": [
        "s(\"hh*8\")\n.gain(\".4!2 1 .4!2 1 .4 1\")\n.velocity(\".4 1\")"
      ],
      "synonyms": [
        "vel"
      ],
      "synonyms_text": "vel",
      "kind": "member",
      "tags": [
        "amplitude",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "gain",
      "longname": "gain",
      "description": "<p>Controls the gain by an exponential amount.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>gain.</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"hh*8\").gain(\".4!2 1 .4!2 1 .4 1\").fast(2)"
      ],
      "kind": "member",
      "tags": [
        "amplitude",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "postgain",
      "longname": "postgain",
      "description": "<p>Gain applied after all effects have been processed.</p>",
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\")\n.compressor(\"-20:20:10:.002:.02\").postgain(1.5)"
      ],
      "kind": "member",
      "tags": [
        "amplitude",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "amp",
      "longname": "amp",
      "description": "<p>Like <code>gain</code>, but linear.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>gain.</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"bd*8\").amp(\".1*2 .5 .1*2 .5 .1 .5\").osc()"
      ],
      "kind": "member",
      "tags": [
        "amplitude",
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "fmh",
      "longname": "fmh",
      "description": "<p>Sets the Frequency Modulation Harmonicity Ratio.\nControls the timbre of the sound.\nWhole numbers and simple ratios sound more natural,\nwhile decimal numbers and complex ratios sound metallic.</p>\n<p>A number may be added afterwards to control the harmonicity of\nany of the 8 individual FMs (e.g. <code>fmh2</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "harmonicity"
        }
      ],
      "examples": [
        "note(\"c e g b g e\")\n.fm(4)\n.fmh(\"<1 2 1.5 1.61>\")\n._scope()"
      ],
      "kind": "member",
      "tags": [
        "fm",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmi",
      "longname": "fmi",
      "description": "<p>Sets the Frequency Modulation of the synth.\nControls the modulation index, which defines the brightness of the sound.</p>\n<p>A number may be added afterwards to control the modulation index of\nany of the 8 individual FMs (e.g. <code>fm3</code>). Also, FMs may be routed into\neach other with matrix commands like <code>fm13</code>, which would send <code>fm1</code> back into\n<code>fm3</code></p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>modulation index</p>",
          "name": "brightness"
        }
      ],
      "examples": [
        "note(\"c e g b g e\")\n.fm(\"<0 1 2 8 32>\")\n._scope()",
        "s(\"sine\").note(\"F1\").seg(8)\n .fm(4).fm2(rand.mul(4)).fm3(saw.mul(8).slow(8))\n .fmh(1.06).fmh2(10).fmh3(0.1)"
      ],
      "synonyms": [
        "fm"
      ],
      "synonyms_text": "fm",
      "kind": "member",
      "tags": [
        "fm",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmenv",
      "longname": "fmenv",
      "description": "<p>Ramp type of fm envelope. Exp might be a bit broken..</p>\n<p>A number may be added afterwards to control the envelope of\nany of the 8 individual FMs (e.g. <code>fmenv4</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>lin | exp</p>",
          "name": "type"
        }
      ],
      "examples": [
        "note(\"c e g b g e\")\n.fm(4)\n.fmdecay(.2)\n.fmsustain(0)\n.fmenv(\"<exp lin>\")\n._scope()"
      ],
      "synonyms": [
        "fme"
      ],
      "synonyms_text": "fme",
      "kind": "member",
      "tags": [
        "fm",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmattack",
      "longname": "fmattack",
      "description": "<p>Attack time for the FM envelope: time it takes to reach maximum modulation</p>\n<p>A number may be added afterwards to control the attack of the envelope of\nany of the 8 individual FMs (e.g. <code>fmatt5</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>attack time</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"c e g b g e\")\n.fm(4)\n.fmattack(\"<0 .05 .1 .2>\")\n._scope()"
      ],
      "synonyms": [
        "fmatt"
      ],
      "synonyms_text": "fmatt",
      "kind": "member",
      "tags": [
        "fm",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmwave",
      "longname": "fmwave",
      "description": "<p>Waveform of the fm modulator</p>\n<p>A number may be added afterwards to control the waveform\nany of the 8 individual FMs (e.g. <code>fmwave6</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>waveform</p>",
          "name": "wave"
        }
      ],
      "examples": [
        "n(\"0 1 2 3\".fast(4)).scale(\"d:minor\").s(\"sine\").fmwave(\"<sine square sawtooth crackle>\").fm(4).fmh(2.01)",
        "n(\"0 1 2 3\".fast(4)).chord(\"<Dm Am F G>\").voicing().s(\"sawtooth\").fmwave(\"brown\").fm(.6)"
      ],
      "kind": "member",
      "tags": [
        "fm",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmdecay",
      "longname": "fmdecay",
      "description": "<p>Decay time for the FM envelope: seconds until the sustain level is reached after the attack phase.</p>\n<p>A number may be added afterwards to control the decay of the envelope of\nany of the 8 individual FMs (e.g. <code>fmdec6</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>decay time</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"c e g b g e\")\n.fm(4)\n.fmdecay(\"<.01 .05 .1 .2>\")\n.fmsustain(.4)\n._scope()"
      ],
      "synonyms": [
        "fmdec"
      ],
      "synonyms_text": "fmdec",
      "kind": "member",
      "tags": [
        "fm",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmsustain",
      "longname": "fmsustain",
      "description": "<p>Sustain level for the FM envelope: how much modulation is applied after the decay phase</p>\n<p>A number may be added afterwards to control the sustain of the envelope of\nany of the 8 individual FMs (e.g. <code>fmsus7</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>sustain level</p>",
          "name": "level"
        }
      ],
      "examples": [
        "note(\"c e g b g e\")\n.fm(4)\n.fmdecay(.1)\n.fmsustain(\"<1 .75 .5 0>\")\n._scope()"
      ],
      "synonyms": [
        "fmsus"
      ],
      "synonyms_text": "fmsus",
      "kind": "member",
      "tags": [
        "fm",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "fmrelease",
      "longname": "fmrelease",
      "description": "<p>Release time for the FM envelope: how much modulation is applied after the note is released</p>\n<p>A number may be added afterwards to control the release of the envelope of\nany of the 8 individual FMs (e.g. <code>fmrel8</code>)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>release time</p>",
          "name": "time"
        }
      ],
      "synonyms": [
        "fmrel"
      ],
      "synonyms_text": "fmrel",
      "kind": "member",
      "tags": [
        "fm",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bank",
      "longname": "bank",
      "description": "<p>Select the sound bank to use. To be used together with <code>s</code>. The bank name (+ &quot;_&quot;) will be prepended to the value of <code>s</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>the name of the bank</p>",
          "name": "bank"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").bank('RolandTR909') // = s(\"RolandTR909_bd RolandTR909_sd\")"
      ],
      "kind": "member",
      "tags": [
        "samples",
        "superdough"
      ]
    },
    {
      "name": "chorus",
      "longname": "chorus",
      "description": "<p>mix control for the chorus effect</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>mix amount between 0 and 1</p>",
          "name": "chorus"
        }
      ],
      "examples": [
        "note(\"d d a# a\").s(\"sawtooth\").chorus(.5)"
      ],
      "kind": "member",
      "tags": [
        "pitch"
      ]
    },
    {
      "name": "attack",
      "longname": "attack",
      "description": "<p>Amplitude envelope attack time: Specifies how long it takes for the sound to reach its peak value, relative to the onset.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time in seconds.</p>",
          "name": "attack"
        }
      ],
      "examples": [
        "note(\"c3 e3 f3 g3\").attack(\"<0 .1 .5>\")"
      ],
      "synonyms": [
        "att"
      ],
      "synonyms_text": "att",
      "kind": "member",
      "tags": [
        "amplitude",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "decay",
      "longname": "decay",
      "description": "<p>Amplitude envelope decay time: the time it takes after the attack time to reach the sustain level.\nNote that the decay is only audible if the sustain value is lower than 1.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>decay time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"c3 e3 f3 g3\").decay(\"<.1 .2 .3 .4>\").sustain(0)"
      ],
      "synonyms": [
        "dec"
      ],
      "synonyms_text": "dec",
      "kind": "member",
      "tags": [
        "amplitude",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "sustain",
      "longname": "sustain",
      "description": "<p>Amplitude envelope sustain level: The level which is reached after attack / decay, being sustained until the offset.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>sustain level between 0 and 1</p>",
          "name": "gain"
        }
      ],
      "examples": [
        "note(\"c3 e3 f3 g3\").decay(.2).sustain(\"<0 .1 .4 .6 1>\")"
      ],
      "synonyms": [
        "sus"
      ],
      "synonyms_text": "sus",
      "kind": "member",
      "tags": [
        "amplitude",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "release",
      "longname": "release",
      "description": "<p>Amplitude envelope release time: The time it takes after the offset to go from sustain level to zero.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>release time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"c3 e3 g3 c4\").release(\"<0 .1 .4 .6 1>/2\")"
      ],
      "synonyms": [
        "rel"
      ],
      "synonyms_text": "rel",
      "kind": "member",
      "tags": [
        "amplitude",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bpf",
      "longname": "bpf",
      "description": "<p>Sets the center frequency of the <strong>b</strong>and-<strong>p</strong>ass <strong>f</strong>ilter. When using mininotation, you\ncan also optionally supply the 'bpq' parameter separated by ':'.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>center frequency</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*6\").bpf(\"<1000 2000 4000 8000>\")"
      ],
      "synonyms": [
        "bandf",
        "bp"
      ],
      "synonyms_text": "bandf, bp",
      "kind": "member",
      "tags": [
        "filter",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bpq",
      "longname": "bpq",
      "description": "<p>Sets the <strong>b</strong>and-<strong>p</strong>ass <strong>q</strong>-factor (resonance).</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>q factor</p>",
          "name": "q"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").bpf(500).bpq(\"<0 1 2 3>\")"
      ],
      "synonyms": [
        "bandq"
      ],
      "synonyms_text": "bandq",
      "kind": "member",
      "tags": [
        "filter",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "begin",
      "longname": "begin",
      "description": "<p>A pattern of numbers from 0 to 1. Skips the beginning of each sample, e.g. <code>0.25</code> to cut off the first quarter from each sample.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1, where 1 is the length of the sample</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "samples({ rave: 'rave/AREUREADY.wav' }, 'github:tidalcycles/dirt-samples')\ns(\"rave\").begin(\"<0 .25 .5 .75>\").fast(2)"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "end",
      "longname": "Pattern.end",
      "description": "<p>The same as .begin, but cuts off the end off each sample.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>1 = whole sample, .5 = half sample, .25 = quarter sample etc..</p>",
          "name": "length"
        }
      ],
      "examples": [
        "s(\"bd*2,oh*4\").end(\"<.1 .2 .5 1>\").fast(2)"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "loop",
      "longname": "loop",
      "description": "<p>Loops the sample.\nNote that the tempo of the loop is not synced with the cycle tempo.\nTo change the loop region, use loopBegin / loopEnd.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>If 1, the sample is looped</p>",
          "name": "on"
        }
      ],
      "examples": [
        "s(\"casio\").loop(1)"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "loopBegin",
      "longname": "loopBegin",
      "description": "<p>Begin to loop at a specific point in the sample (inbetween <code>begin</code> and <code>end</code>).\nNote that the loop point must be inbetween <code>begin</code> and <code>end</code>, and before <code>loopEnd</code>!\nNote: Samples starting with wt_ will automatically loop! (wt = wavetable)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1, where 1 is the length of the sample</p>",
          "name": "time"
        }
      ],
      "examples": [
        "s(\"space\").loop(1)\n.loopBegin(\"<0 .125 .25>\")._scope()"
      ],
      "synonyms": [
        "loopb"
      ],
      "synonyms_text": "loopb",
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "loopEnd",
      "longname": "loopEnd",
      "description": "<p>End the looping section at a specific point in the sample (inbetween <code>begin</code> and <code>end</code>).\nNote that the loop point must be inbetween <code>begin</code> and <code>end</code>, and after <code>loopBegin</code>!</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1, where 1 is the length of the sample</p>",
          "name": "time"
        }
      ],
      "examples": [
        "s(\"space\").loop(1)\n.loopEnd(\"<1 .75 .5 .25>\")._scope()"
      ],
      "synonyms": [
        "loope"
      ],
      "synonyms_text": "loope",
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "crush",
      "longname": "crush",
      "description": "<p>Bit crusher effect.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 1 (for drastic reduction in bit-depth) to 16 (for barely no reduction).</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "s(\"<bd sd>,hh*3\").fast(2).crush(\"<16 8 7 6 5 4 3 2>\")"
      ],
      "kind": "member",
      "tags": [
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "coarse",
      "longname": "coarse",
      "description": "<p>Fake-resampling for lowering the sample rate. Caution: This effect seems to only work in chromium based browsers</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>1 for original 2 for half, 3 for a third and so on.</p>",
          "name": "factor"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\").coarse(\"<1 4 8 16 32>\")"
      ],
      "kind": "member",
      "tags": [
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "tremolo",
      "longname": "tremolo",
      "description": "<p>Modulate the amplitude of a sound with a continuous waveform</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>modulation speed in HZ</p>",
          "name": "speed"
        }
      ],
      "examples": [
        "note(\"d d d# d\".fast(4)).s(\"supersaw\").tremolo(\"<3 2 100> \").tremoloskew(\"<.5>\")"
      ],
      "synonyms": [
        "trem"
      ],
      "synonyms_text": "trem",
      "kind": "member",
      "tags": [
        "amplitude",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "tremolosync",
      "longname": "tremolosync",
      "description": "<p>Modulate the amplitude of a sound with a continuous waveform</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>modulation speed in cycles</p>",
          "name": "cycles"
        }
      ],
      "examples": [
        "note(\"d d d# d\".fast(4)).s(\"supersaw\").tremolosync(\"4\").tremoloskew(\"<1 .5 0>\")"
      ],
      "synonyms": [
        "tremsync"
      ],
      "synonyms_text": "tremsync",
      "kind": "member",
      "tags": [
        "amplitude",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "tremolodepth",
      "longname": "tremolodepth",
      "description": "<p>Depth of amplitude modulation</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "depth"
        }
      ],
      "examples": [
        "note(\"a1 a1 a#1 a1\".fast(4)).s(\"pulse\").tremsync(4).tremolodepth(\"<1 2 .7>\")"
      ],
      "synonyms": [
        "tremdepth"
      ],
      "synonyms_text": "tremdepth",
      "kind": "member",
      "tags": [
        "amplitude",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "tremoloskew",
      "longname": "tremoloskew",
      "description": "<p>Alter the shape of the modulation waveform</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 &amp; 1, the shape of the waveform</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "note(\"{f a c e}%16\").s(\"sawtooth\").tremsync(4).tremoloskew(\"<.5 0 1>\")"
      ],
      "synonyms": [
        "tremskew"
      ],
      "synonyms_text": "tremskew",
      "kind": "member",
      "tags": [
        "amplitude",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "tremolophase",
      "longname": "tremolophase",
      "description": "<p>Alter the phase of the modulation waveform</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>the offset in cycles of the modulation</p>",
          "name": "offset"
        }
      ],
      "examples": [
        "note(\"{f a c e}%16\").s(\"sawtooth\").tremsync(4).tremolophase(\"<0 .25 .66>\")"
      ],
      "synonyms": [
        "tremphase"
      ],
      "synonyms_text": "tremphase",
      "kind": "member",
      "tags": [
        "amplitude",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "tremoloshape",
      "longname": "tremoloshape",
      "description": "<p>Shape of amplitude modulation</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>tri | square | sine | saw | ramp</p>",
          "name": "shape"
        }
      ],
      "examples": [
        "note(\"{f g c d}%16\").tremsync(4).tremoloshape(\"<sine tri square>\").s(\"sawtooth\")"
      ],
      "synonyms": [
        "tremshape"
      ],
      "synonyms_text": "tremshape",
      "kind": "member",
      "tags": [
        "amplitude",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "drive",
      "longname": "drive",
      "description": "<p>Filter overdrive for supported filter types</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "amount"
        }
      ],
      "examples": [
        "note(\"{f g g c d a a#}%16\".sub(17)).s(\"supersaw\").lpenv(8).lpf(150).lpq(.8).ftype('ladder').drive(\"<.5 4>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "superdough"
      ]
    },
    {
      "name": "duckorbit",
      "longname": "duckorbit",
      "description": "<p>Modulate the amplitude of an orbit to create a &quot;sidechain&quot; like effect.</p>\n<p>Can be applied to multiple orbits with the ':' mininotation, e.g. <code>duckorbit(&quot;2:3&quot;)</code></p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>target orbit</p>",
          "name": "orbit"
        }
      ],
      "examples": [
        "$: n(run(16)).scale(\"c:minor:pentatonic\").s(\"sawtooth\").delay(.7).orbit(2)\n$: s(\"bd:4!4\").beat(\"0,4,8,11,14\",16).duckorbit(2).duckattack(0.2).duckdepth(1)",
        "$: n(run(16)).scale(\"c:minor:pentatonic\").s(\"sawtooth\").delay(.7).orbit(2)\n$: s(\"hh*16\").orbit(3)\n$: s(\"bd:4!4\").beat(\"0,4,8,11,14\",16).duckorbit(\"2:3\").duckattack(0.2).duckdepth(1)"
      ],
      "synonyms": [
        "duck"
      ],
      "synonyms_text": "duck",
      "kind": "member",
      "tags": [
        "amplitude",
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "duckdepth",
      "longname": "duckdepth",
      "description": "<p>The amount of ducking applied to target orbit</p>\n<p>Can vary across orbits with the ':' mininotation, e.g. <code>duckdepth(&quot;0.3:0.1&quot;)</code>.\nNote: this requires first applying the effect to multiple orbits with e.g. <code>duckorbit(&quot;2:3&quot;)</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation from 0 to 1</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "stack( n(run(8)).scale(\"c:minor\").s(\"sawtooth\").delay(.7).orbit(2), s(\"bd:4!4\").beat(\"0,4,8,11,14\",16).duckorbit(2).duckattack(0.2).duckdepth(\"<1 .9 .6 0>\"))",
        "$: n(run(16)).scale(\"c:minor:pentatonic\").s(\"sawtooth\").delay(.7).orbit(2)\n$: s(\"hh*16\").orbit(3)\n$: s(\"bd:4!4\").beat(\"0,4,8,11,14\",16).duckorbit(\"2:3\").duckattack(0.2).duckdepth(\"1:0.5\")"
      ],
      "kind": "member",
      "tags": [
        "amplitude",
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "duckonset",
      "longname": "duckonset",
      "description": "<p>The time required for the ducked signal(s) to reach their lowest volume.\nCan be used to prevent clicking or for creative rhythmic effects.</p>\n<p>Can vary across orbits with the ':' mininotation, e.g. <code>duckonset(&quot;0:0.003&quot;)</code>.\nNote: this requires first applying the effect to multiple orbits with e.g. <code>duckorbit(&quot;2:3&quot;)</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>The onset time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "// Clicks\nsound: freq(\"63.2388\").s(\"sine\").orbit(2).gain(4)\nduckerWithClick: s(\"bd*4\").duckorbit(2).duckattack(0.3).duckonset(0).postgain(0)",
        "// No clicks\nsound: freq(\"63.2388\").s(\"sine\").orbit(2).gain(4)\nduckerWithoutClick: s(\"bd*4\").duckorbit(2).duckattack(0.3).duckonset(0.01).postgain(0)",
        "// Rhythmic\nnoise: s(\"pink\").distort(\"2:1\").orbit(4) // used rhythmically with 0.3 onset below\nhhat: s(\"hh*16\").orbit(7)\nducker: s(\"bd*4\").bank(\"tr909\").duckorbit(\"4:7\").duckonset(\"0.3:0.003\").duckattack(0.25)"
      ],
      "synonyms": [
        "duckons"
      ],
      "synonyms_text": "duckons",
      "kind": "member",
      "tags": [
        "amplitude",
        "envelope",
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "duckattack",
      "longname": "duckattack",
      "description": "<p>The time required for the ducked signal(s) to return to their normal volume.</p>\n<p>Can vary across orbits with the ':' mininotation, e.g. <code>duckonset(&quot;0:0.003&quot;)</code>.\nNote: this requires first applying the effect to multiple orbits with e.g. <code>duckorbit(&quot;2:3&quot;)</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>The attack time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "sound: n(run(8)).scale(\"c:minor\").s(\"sawtooth\").delay(.7).orbit(2)\nducker: s(\"bd:4!4\").beat(\"0,4,8,11,14\",16).duckorbit(2).duckattack(\"<0.2 0 0.4>\").duckdepth(1)",
        "moreduck: n(run(8)).scale(\"c:minor\").s(\"sawtooth\").delay(.7).orbit(2)\nlessduck: s(\"hh*16\").orbit(5)\nducker: s(\"bd:4!4\").beat(\"0,4,8,11,14\",16).duckorbit(\"2:5\").duckattack(\"0.4:0.1\")"
      ],
      "synonyms": [
        "duckatt",
        "datt"
      ],
      "synonyms_text": "duckatt, datt",
      "kind": "member",
      "tags": [
        "amplitude",
        "envelope",
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "byteBeatExpression",
      "longname": "byteBeatExpression",
      "description": "<p>Create byte beats with custom expressions</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>bitwise expression for creating bytebeat</p>",
          "name": "byteBeatExpression"
        }
      ],
      "examples": [
        "s(\"bytebeat\").bbexpr('t*(t>>15^t>>66)')"
      ],
      "synonyms": [
        "bbexpr",
        "bb"
      ],
      "synonyms_text": "bbexpr, bb",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "byteBeatStartTime",
      "longname": "byteBeatStartTime",
      "description": "<p>Create byte beats with custom expressions</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>in samples (t)</p>",
          "name": "byteBeatStartTime"
        }
      ],
      "examples": [
        "note(\"c3!8\".add(\"{0 0 12 0 7 5 3}%8\")).s(\"bytebeat:5\").bbst(\"<3 1>\".mul(10000))._scope()"
      ],
      "synonyms": [
        "bbst"
      ],
      "synonyms_text": "bbst",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "channels",
      "longname": "channels",
      "description": "<p>Allows you to set the output channels on the interface</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>pattern the output channels</p>",
          "name": "channels"
        }
      ],
      "examples": [
        "note(\"e a d b g\").channels(\"3:4\")"
      ],
      "synonyms": [
        "ch"
      ],
      "synonyms_text": "ch",
      "kind": "member",
      "tags": [
        "external_io",
        "superdough"
      ]
    },
    {
      "name": "pw",
      "longname": "pw",
      "description": "<p>Controls the pulsewidth of the pulse oscillator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "pulsewidth"
        }
      ],
      "examples": [
        "note(\"{f a c e}%16\").s(\"pulse\").pw(\".8:1:.2\")",
        "n(run(8)).scale(\"D:pentatonic\").s(\"pulse\").pw(\"0 .75 .5 1\")"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "pwrate",
      "longname": "pwrate",
      "description": "<p>Controls the lfo rate for the pulsewidth of the pulse oscillator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "rate"
        }
      ],
      "examples": [
        "n(run(8)).scale(\"D:pentatonic\").s(\"pulse\").pw(\"0.5\").pwrate(\"<5 .1 25>\").pwsweep(\"<0.3 .8>\")"
      ],
      "synonyms": [
        "pwr"
      ],
      "synonyms_text": "pwr",
      "kind": "member",
      "tags": [
        "superdough",
        "lfo"
      ]
    },
    {
      "name": "pwsweep",
      "longname": "pwsweep",
      "description": "<p>Controls the lfo sweep for the pulsewidth of the pulse oscillator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "sweep"
        }
      ],
      "examples": [
        "n(run(8)).scale(\"D:pentatonic\").s(\"pulse\").pw(\"0.5\").pwrate(\"<5 .1 25>\").pwsweep(\"<0.3 .8>\")"
      ],
      "synonyms": [
        "pws"
      ],
      "synonyms_text": "pws",
      "kind": "member",
      "tags": [
        "superdough",
        "lfo"
      ]
    },
    {
      "name": "phaser",
      "longname": "phaser",
      "description": "<p>Phaser audio effect that approximates popular guitar pedals.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>speed of modulation</p>",
          "name": "speed"
        }
      ],
      "examples": [
        "n(run(8)).scale(\"D:pentatonic\").s(\"sawtooth\").release(0.5)\n.phaser(\"<1 2 4 8>\")"
      ],
      "synonyms": [
        "ph"
      ],
      "synonyms_text": "ph",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "phasersweep",
      "longname": "phasersweep",
      "description": "<p>The frequency sweep range of the lfo for the phaser effect. Defaults to 2000</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>most useful values are between 0 and 4000</p>",
          "name": "phasersweep"
        }
      ],
      "examples": [
        "n(run(8)).scale(\"D:pentatonic\").s(\"sawtooth\").release(0.5)\n.phaser(2).phasersweep(\"<800 2000 4000>\")"
      ],
      "synonyms": [
        "phs"
      ],
      "synonyms_text": "phs",
      "kind": "member",
      "tags": [
        "superdough",
        "lfo"
      ]
    },
    {
      "name": "phasercenter",
      "longname": "phasercenter",
      "description": "<p>The center frequency of the phaser in HZ. Defaults to 1000</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>in HZ</p>",
          "name": "centerfrequency"
        }
      ],
      "examples": [
        "n(run(8)).scale(\"D:pentatonic\").s(\"sawtooth\").release(0.5)\n.phaser(2).phasercenter(\"<800 2000 4000>\")"
      ],
      "synonyms": [
        "phc"
      ],
      "synonyms_text": "phc",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "phaserdepth",
      "longname": "phaserdepth",
      "description": "<p>The amount the signal is affected by the phaser effect. Defaults to 0.75</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>number between 0 and 1</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "n(run(8)).scale(\"D:pentatonic\").s(\"sawtooth\").release(0.5)\n.phaser(2).phaserdepth(\"<0 .5 .75 1>\")"
      ],
      "synonyms": [
        "phd",
        "phasdp"
      ],
      "synonyms_text": "phd, phasdp",
      "kind": "member",
      "tags": [
        "superdough",
        "superdirt"
      ]
    },
    {
      "name": "channel",
      "longname": "channel",
      "description": "<p>Choose the channel the pattern is sent to</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>channel number</p>",
          "name": "channel"
        }
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "cut",
      "longname": "cut",
      "description": "<p>In the style of classic drum-machines, <code>cut</code> will stop a playing sample as soon as another samples with in same cutgroup is to be played. An example would be an open hi-hat followed by a closed one, essentially muting the open.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>cut group number</p>",
          "name": "group"
        }
      ],
      "examples": [
        "s(\"[oh hh]*4\").cut(1)"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "lpf",
      "longname": "lpf",
      "description": "<p>Applies the cutoff frequency of the <strong>l</strong>ow-<strong>p</strong>ass <strong>f</strong>ilter.</p>\n<p>When using mininotation, you can also optionally add the 'lpq' parameter, separated by ':'.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>audible between 0 and 20000</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*6\").lpf(\"<4000 2000 1000 500 200 100>\")",
        "s(\"bd*16\").lpf(\"1000:0 1000:10 1000:20 1000:30\")"
      ],
      "synonyms": [
        "cutoff",
        "ctf",
        "lp"
      ],
      "synonyms_text": "cutoff, ctf, lp",
      "kind": "member",
      "tags": [
        "filter",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lpenv",
      "longname": "lpenv",
      "description": "<p>Sets the lowpass filter envelope modulation depth.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of the lowpass filter envelope between 0 and <em>n</em></p>",
          "name": "modulation"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.lpf(300)\n.lpa(.5)\n.lpenv(\"<4 2 1 0 -1 -2 -4>/4\")"
      ],
      "synonyms": [
        "lpe"
      ],
      "synonyms_text": "lpe",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "hpenv",
      "longname": "hpenv",
      "description": "<p>Sets the highpass filter envelope modulation depth.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of the highpass filter envelope between 0 and <em>n</em></p>",
          "name": "modulation"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.hpf(500)\n.hpa(.5)\n.hpenv(\"<4 2 1 0 -1 -2 -4>/4\")"
      ],
      "synonyms": [
        "hpe"
      ],
      "synonyms_text": "hpe",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bpenv",
      "longname": "bpenv",
      "description": "<p>Sets the bandpass filter envelope modulation depth.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of the bandpass filter envelope between 0 and <em>n</em></p>",
          "name": "modulation"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.bpf(500)\n.bpa(.5)\n.bpenv(\"<4 2 1 0 -1 -2 -4>/4\")"
      ],
      "synonyms": [
        "bpe"
      ],
      "synonyms_text": "bpe",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lpattack",
      "longname": "lpattack",
      "description": "<p>Sets the attack duration for the lowpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the filter envelope</p>",
          "name": "attack"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.lpf(300)\n.lpa(\"<.5 .25 .1 .01>/4\")\n.lpenv(4)"
      ],
      "synonyms": [
        "lpa"
      ],
      "synonyms_text": "lpa",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "hpattack",
      "longname": "hpattack",
      "description": "<p>Sets the attack duration for the highpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the highpass filter envelope</p>",
          "name": "attack"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.hpf(500)\n.hpa(\"<.5 .25 .1 .01>/4\")\n.hpenv(4)"
      ],
      "synonyms": [
        "hpa"
      ],
      "synonyms_text": "hpa",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bpattack",
      "longname": "bpattack",
      "description": "<p>Sets the attack duration for the bandpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the bandpass filter envelope</p>",
          "name": "attack"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.bpf(500)\n.bpa(\"<.5 .25 .1 .01>/4\")\n.bpenv(4)"
      ],
      "synonyms": [
        "bpa"
      ],
      "synonyms_text": "bpa",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lpdecay",
      "longname": "lpdecay",
      "description": "<p>Sets the decay duration for the lowpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the filter envelope</p>",
          "name": "decay"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.lpf(300)\n.lpd(\"<.5 .25 .1 0>/4\")\n.lpenv(4)"
      ],
      "synonyms": [
        "lpd"
      ],
      "synonyms_text": "lpd",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "hpdecay",
      "longname": "hpdecay",
      "description": "<p>Sets the decay duration for the highpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the highpass filter envelope</p>",
          "name": "decay"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.hpf(500)\n.hpd(\"<.5 .25 .1 0>/4\")\n.hps(0.2)\n.hpenv(4)"
      ],
      "synonyms": [
        "hpd"
      ],
      "synonyms_text": "hpd",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bpdecay",
      "longname": "bpdecay",
      "description": "<p>Sets the decay duration for the bandpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the bandpass filter envelope</p>",
          "name": "decay"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.bpf(500)\n.bpd(\"<.5 .25 .1 0>/4\")\n.bps(0.2)\n.bpenv(4)"
      ],
      "synonyms": [
        "bpd"
      ],
      "synonyms_text": "bpd",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lpsustain",
      "longname": "lpsustain",
      "description": "<p>Sets the sustain amplitude for the lowpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amplitude of the lowpass filter envelope</p>",
          "name": "sustain"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.lpf(300)\n.lpd(.5)\n.lps(\"<0 .25 .5 1>/4\")\n.lpenv(4)"
      ],
      "synonyms": [
        "lps"
      ],
      "synonyms_text": "lps",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "hpsustain",
      "longname": "hpsustain",
      "description": "<p>Sets the sustain amplitude for the highpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amplitude of the highpass filter envelope</p>",
          "name": "sustain"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.hpf(500)\n.hpd(.5)\n.hps(\"<0 .25 .5 1>/4\")\n.hpenv(4)"
      ],
      "synonyms": [
        "hps"
      ],
      "synonyms_text": "hps",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bpsustain",
      "longname": "bpsustain",
      "description": "<p>Sets the sustain amplitude for the bandpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amplitude of the bandpass filter envelope</p>",
          "name": "sustain"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.bpf(500)\n.bpd(.5)\n.bps(\"<0 .25 .5 1>/4\")\n.bpenv(4)"
      ],
      "synonyms": [
        "bps"
      ],
      "synonyms_text": "bps",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lprelease",
      "longname": "lprelease",
      "description": "<p>Sets the release time for the lowpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the filter envelope</p>",
          "name": "release"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.clip(.5)\n.lpf(300)\n.lpenv(4)\n.lpr(\"<.5 .25 .1 0>/4\")\n.release(.5)"
      ],
      "synonyms": [
        "lpr"
      ],
      "synonyms_text": "lpr",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "hprelease",
      "longname": "hprelease",
      "description": "<p>Sets the release time for the highpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the highpass filter envelope</p>",
          "name": "release"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.clip(.5)\n.hpf(500)\n.hpenv(4)\n.hpr(\"<.5 .25 .1 0>/4\")\n.release(.5)"
      ],
      "synonyms": [
        "hpr"
      ],
      "synonyms_text": "hpr",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "bprelease",
      "longname": "bprelease",
      "description": "<p>Sets the release time for the bandpass filter envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time of the bandpass filter envelope</p>",
          "name": "release"
        }
      ],
      "examples": [
        "note(\"c2 e2 f2 g2\")\n.sound('sawtooth')\n.clip(.5)\n.bpf(500)\n.bpenv(4)\n.bpr(\"<.5 .25 .1 0>/4\")\n.release(.5)"
      ],
      "synonyms": [
        "bpr"
      ],
      "synonyms_text": "bpr",
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "ftype",
      "longname": "ftype",
      "description": "<p>Sets the filter type. The ladder filter is more aggressive. More types might be added in the future.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>12db (0), ladder (1), or 24db (2)</p>",
          "name": "type"
        }
      ],
      "examples": [
        "note(\"{f g g c d a a#}%8\").s(\"sawtooth\").lpenv(4).lpf(500).ftype(\"<0 1 2>\").lpq(1)",
        "note(\"c f g g a c d4\").fast(2)\n.sound('sawtooth')\n.lpf(200).fanchor(0)\n.lpenv(3).lpq(1)\n.ftype(\"<ladder 12db 24db>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "superdough"
      ]
    },
    {
      "name": "fanchor",
      "longname": "fanchor",
      "description": "<p>controls the center of the filter envelope. 0 is unipolar positive, .5 is bipolar, 1 is unipolar negative</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>0 to 1</p>",
          "name": "center"
        }
      ],
      "examples": [
        "note(\"{f g g c d a a#}%8\").s(\"sawtooth\").lpf(\"{1000}%2\")\n.lpenv(8).fanchor(\"<0 .5 1>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "hpf",
      "longname": "hpf",
      "description": "<p>Applies the cutoff frequency of the <strong>h</strong>igh-<strong>p</strong>ass <strong>f</strong>ilter.</p>\n<p>When using mininotation, you can also optionally add the 'hpq' parameter, separated by ':'.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>audible between 0 and 20000</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\").hpf(\"<4000 2000 1000 500 200 100>\")",
        "s(\"bd sd [~ bd] sd,hh*8\").hpf(\"<2000 2000:25>\")"
      ],
      "synonyms": [
        "hp",
        "hcutoff"
      ],
      "synonyms_text": "hp, hcutoff",
      "kind": "member",
      "tags": [
        "filter",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lprate",
      "longname": "lprate",
      "description": "<p>Rate of the LFO for the lowpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in hertz</p>",
          "name": "rate"
        }
      ],
      "examples": [
        "note(\"<c c c# c c c4>*16\").s(\"sawtooth\").lpf(600).lprate(\"<4 8 2 1>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "lpsync",
      "longname": "lpsync",
      "description": "<p>Cycle-synced rate of the LFO for the lowpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in cycles</p>",
          "name": "rate"
        }
      ],
      "examples": [
        "note(\"<c c c# c c c4>*16\").s(\"sawtooth\").lpf(600).lpsync(\"<4 8 2 1>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "lpdepth",
      "longname": "lpdepth",
      "description": "<p>Depth of the LFO for the lowpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "note(\"<c c c# c c c4>*16\").s(\"sawtooth\").lpf(600).lpdepth(\"<1 .5 1.8 0>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "lpdepthfrequency",
      "longname": "lpdepthfrequency",
      "description": "<p>Depth of the LFO for the lowpass filter, in HZ</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "note(\"<c c c# c c c4>*16\").s(\"sawtooth\").lpf(600).lpdepthfrequency(\"<200 500 100 0>\")"
      ],
      "synonyms": [
        "lpdepthfreq"
      ],
      "synonyms_text": "lpdepthfreq",
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "lpshape",
      "longname": "lpshape",
      "description": "<p>Shape of the LFO for the lowpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          "name": "shape"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "lpdc",
      "longname": "lpdc",
      "description": "<p>DC offset of the LFO for the lowpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>dc offset. set to 0 for unipolar</p>",
          "name": "dcoffset"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "lpskew",
      "longname": "lpskew",
      "description": "<p>Skew of the LFO for the lowpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>How much to bend the LFO shape</p>",
          "name": "skew"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bprate",
      "longname": "bprate",
      "description": "<p>Rate of the LFO for the bandpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in hertz</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bpsync",
      "longname": "bpsync",
      "description": "<p>Cycle-synced rate of the LFO for the bandpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in cycles</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bpdepth",
      "longname": "bpdepth",
      "description": "<p>Depth of the LFO for the bandpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bpdepthfrequency",
      "longname": "bpdepthfrequency",
      "description": "<p>Depth of the LFO for the bandpass filter, in HZ</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "note(\"<c c c# c c c4>*16\").s(\"sawtooth\").lpf(600).bpdepthfrequency(\"<200 500 100 0>\")"
      ],
      "synonyms": [
        "bpdepthfreq"
      ],
      "synonyms_text": "bpdepthfreq",
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bpshape",
      "longname": "bpshape",
      "description": "<p>Shape of the LFO for the bandpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          "name": "shape"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bpdc",
      "longname": "bpdc",
      "description": "<p>DC offset of the LFO for the bandpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>dc offset. set to 0 for unipolar</p>",
          "name": "dcoffset"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "bpskew",
      "longname": "bpskew",
      "description": "<p>Skew of the LFO for the bandpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>How much to bend the LFO shape</p>",
          "name": "skew"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hprate",
      "longname": "hprate",
      "description": "<p>Rate of the LFO for the highpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in hertz</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hpsync",
      "longname": "hpsync",
      "description": "<p>Cycle-synced rate of the LFO for the highpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>rate in cycles</p>",
          "name": "rate"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hpdepth",
      "longname": "hpdepth",
      "description": "<p>Depth of the LFO for the highpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hpdepthfrequency",
      "longname": "hpdepthfrequency",
      "description": "<p>Depth of the LFO for the hipass filter, in hz</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>depth of modulation</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "note(\"<c c c# c c c4>*16\").s(\"sawtooth\").lpf(600).hpdepthfrequency(\"<200 500 100 0>\")"
      ],
      "synonyms": [
        "hpdepthfreq"
      ],
      "synonyms_text": "hpdepthfreq",
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hpshape",
      "longname": "hpshape",
      "description": "<p>Shape of the LFO for the highpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          "name": "shape"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hpdc",
      "longname": "hpdc",
      "description": "<p>DC offset of the LFO for the highpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>dc offset. set to 0 for unipolar</p>",
          "name": "dcoffset"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "hpskew",
      "longname": "hpskew",
      "description": "<p>Skew of the LFO for the highpass filter</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>How much to bend the LFO shape</p>",
          "name": "skew"
        }
      ],
      "kind": "member",
      "tags": [
        "filter",
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "vib",
      "longname": "vib",
      "description": "<p>Applies a vibrato to the frequency of the oscillator.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>of the vibrato in hertz</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "note(\"a e\")\n.vib(\"<.5 1 2 4 8 16>\")\n._scope()",
        "// change the modulation depth with \":\"\nnote(\"a e\")\n.vib(\"<.5 1 2 4 8 16>:12\")\n._scope()"
      ],
      "synonyms": [
        "vibrato",
        "v"
      ],
      "synonyms_text": "vibrato, v",
      "kind": "member",
      "tags": [
        "pitch",
        "lfo",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "noise",
      "longname": "noise",
      "description": "<p>Adds pink noise to the mix</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>wet amount</p>",
          "name": "wet"
        }
      ],
      "examples": [
        "sound(\"<white pink brown>/2\")"
      ],
      "kind": "member",
      "tags": [
        "generators",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "vibmod",
      "longname": "vibmod",
      "description": "<p>Sets the vibrato depth in semitones. Only has an effect if <code>vibrato</code> | <code>vib</code> | <code>v</code> is is also set</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>of vibrato (in semitones)</p>",
          "name": "depth"
        }
      ],
      "examples": [
        "note(\"a e\").vib(4)\n.vibmod(\"<.25 .5 1 2 12>\")\n._scope()",
        "// change the vibrato frequency with \":\"\nnote(\"a e\")\n.vibmod(\"<.25 .5 1 2 12>:8\")\n._scope()"
      ],
      "synonyms": [
        "vmod"
      ],
      "synonyms_text": "vmod",
      "kind": "member",
      "tags": [
        "pitch",
        "lfo",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "hpq",
      "longname": "hpq",
      "description": "<p>Controls the <strong>h</strong>igh-<strong>p</strong>ass <strong>q</strong>-value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>resonance factor between 0 and 50</p>",
          "name": "q"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\").hpf(2000).hpq(\"<0 10 20 30>\")"
      ],
      "synonyms": [
        "hresonance"
      ],
      "synonyms_text": "hresonance",
      "kind": "member",
      "tags": [
        "filter",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "lpq",
      "longname": "lpq",
      "description": "<p>Controls the <strong>l</strong>ow-<strong>p</strong>ass <strong>q</strong>-value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>resonance factor between 0 and 50</p>",
          "name": "q"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\").lpf(2000).lpq(\"<0 10 20 30>\")"
      ],
      "synonyms": [
        "resonance"
      ],
      "synonyms_text": "resonance",
      "kind": "member",
      "tags": [
        "filter",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "djf",
      "longname": "djf",
      "description": "<p>DJ filter, below 0.5 is low pass filter, above is high pass filter.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>below 0.5 is low pass filter, above is high pass filter</p>",
          "name": "cutoff"
        }
      ],
      "examples": [
        "n(irand(16).seg(8)).scale(\"d:phrygian\").s(\"supersaw\").djf(\"<.5 .3 .2 .75>\")"
      ],
      "kind": "member",
      "tags": [
        "filter",
        "superdough"
      ]
    },
    {
      "name": "delay",
      "longname": "delay",
      "description": "<p>Sets the level of the delay signal.</p>\n<p>When using mininotation, you can also optionally add the 'delaytime' and 'delayfeedback' parameter,\nseparated by ':'.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "level"
        }
      ],
      "examples": [
        "s(\"bd bd\").delay(\"<0 .25 .5 1>\")",
        "s(\"bd bd\").delay(\"0.65:0.25:0.9 0.65:0.125:0.7\")"
      ],
      "kind": "member",
      "tags": [
        "orbit",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "delayfeedback",
      "longname": "delayfeedback",
      "description": "<p>Sets the level of the signal that is fed back into the delay.\nCaution: Values &gt;= 1 will result in a signal that gets louder and louder! Don't do it</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "feedback"
        }
      ],
      "examples": [
        "s(\"bd\").delay(.25).delayfeedback(\"<.25 .5 .75 1>\")"
      ],
      "synonyms": [
        "delayfb",
        "dfb"
      ],
      "synonyms_text": "delayfb, dfb",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "delayspeed",
      "longname": "delayspeed",
      "description": "<p>Sets the time of the delay effect.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>controls the pitch of the delay feedback</p>",
          "name": "delayspeed"
        }
      ],
      "examples": [
        "note(\"d d a# a\".fast(2)).s(\"sawtooth\").delay(.8).delaytime(1/2).delayspeed(\"<2 .5 -1 -2>\")"
      ],
      "synonyms": [
        "delayt",
        "dt"
      ],
      "synonyms_text": "delayt, dt",
      "kind": "member",
      "tags": [
        "supradough"
      ]
    },
    {
      "name": "delaytime",
      "longname": "delaytime",
      "description": "<p>Sets the time of the delay effect in seconds.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>in seconds</p>",
          "name": "delay"
        }
      ],
      "examples": [
        "note(\"d d a# a\".fast(2))\n.s(\"sawtooth\")\n.delay(.8)\n.delaytime(1/2)\n.delayspeed(\"<2 .5 -1 -2>\")"
      ],
      "synonyms": [
        "delayt",
        "dt"
      ],
      "synonyms_text": "delayt, dt",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "delaysync",
      "longname": "delaysync",
      "description": "<p>Sets the time of the delay effect in cycles.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>delay length in cycles</p>",
          "name": "cycles"
        }
      ],
      "examples": [
        "s(\"bd bd\").delay(.25).delaysync(\"<1 2 3 5>\".div(8))"
      ],
      "synonyms": [
        "delays",
        "ds"
      ],
      "synonyms_text": "delays, ds",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "lock",
      "longname": "lock",
      "description": "<p>Specifies whether delaytime is calculated relative to cps.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>When set to 1, delaytime is a direct multiple of a cycle.</p>",
          "name": "enable"
        }
      ],
      "examples": [
        "s(\"sd\").delay().lock(1).osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "detune",
      "longname": "detune",
      "description": "<p>Set detune for stacked voices of supported oscillators.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "amount"
        }
      ],
      "examples": [
        "note(\"d f a a# a d3\").fast(2).s(\"supersaw\").detune(\"<.1 .2 .5 24.1>\")"
      ],
      "synonyms": [
        "det"
      ],
      "synonyms_text": "det",
      "kind": "member",
      "tags": [
        "pitch",
        "superdough"
      ]
    },
    {
      "name": "unison",
      "longname": "unison",
      "description": "<p>Set number of stacked voices for supported oscillators.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "numvoices"
        }
      ],
      "examples": [
        "note(\"d f a a# a d3\").fast(2).s(\"supersaw\").unison(\"<1 2 7>\")"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "spread",
      "longname": "spread",
      "description": "<p>Set the stereo pan spread for supported oscillators</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "spread"
        }
      ],
      "examples": [
        "note(\"d f a a# a d3\").fast(2).s(\"supersaw\").spread(\"<0 .3 1>\")"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "dry",
      "longname": "dry",
      "description": "<p>Set dryness of reverb. See <code>room</code> and <code>size</code> for more information about reverb.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>0 = wet, 1 = dry</p>",
          "name": "dry"
        }
      ],
      "examples": [
        "n(\"[0,3,7](3,8)\").s(\"superpiano\").room(.7).dry(\"<0 .5 .75 1>\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "fadeTime",
      "longname": "fadeTime",
      "description": "<p>Used when using <code>begin</code>/<code>end</code> or <code>chop</code>/<code>striate</code> and friends, to change the fade out time of the 'grain' envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "time"
        }
      ],
      "examples": [
        "s(\"oh*4\").end(.1).fadeTime(\"<0 .2 .4 .8>\").osc()"
      ],
      "synonyms": [
        "fadeOutTime"
      ],
      "synonyms_text": "fadeOutTime",
      "kind": "member",
      "tags": [
        "superdirt"
      ]
    },
    {
      "name": "freq",
      "longname": "freq",
      "description": "<p>Set frequency of sound.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>in Hz. the audible range is between 20 and 20000 Hz</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "freq(\"220 110 440 110\").s(\"superzow\").osc()",
        "freq(\"110\".mul.out(\".5 1.5 .6 [2 3]\")).s(\"superzow\").osc()"
      ],
      "kind": "member",
      "tags": [
        "pitch",
        "superdough"
      ]
    },
    {
      "name": "pattack",
      "longname": "pattack",
      "description": "<p>Attack time of pitch envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"c eb g bb\").pattack(\"0 .1 .25 .5\").slow(2)"
      ],
      "synonyms": [
        "patt"
      ],
      "synonyms_text": "patt",
      "kind": "member",
      "tags": [
        "pitch",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "pdecay",
      "longname": "pdecay",
      "description": "<p>Decay time of pitch envelope.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"<c eb g bb>\").pdecay(\"<0 .1 .25 .5>\")"
      ],
      "synonyms": [
        "pdec"
      ],
      "synonyms_text": "pdec",
      "kind": "member",
      "tags": [
        "pitch",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "prelease",
      "longname": "prelease",
      "description": "<p>Release time of pitch envelope</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"<c eb g bb> ~\")\n.release(.5) // to hear the pitch release\n.prelease(\"<0 .1 .25 .5>\")"
      ],
      "synonyms": [
        "prel"
      ],
      "synonyms_text": "prel",
      "kind": "member",
      "tags": [
        "pitch",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "penv",
      "longname": "penv",
      "description": "<p>Amount of pitch envelope. Negative values will flip the envelope.\nIf you don't set other pitch envelope controls, <code>pattack:.2</code> will be the default.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>change in semitones</p>",
          "name": "semitones"
        }
      ],
      "examples": [
        "note(\"c\")\n.penv(\"<12 7 1 .5 0 -1 -7 -12>\")"
      ],
      "kind": "member",
      "tags": [
        "pitch",
        "envelope",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "pcurve",
      "longname": "pcurve",
      "description": "<p>Curve of envelope. Defaults to linear. exponential is good for kicks</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>0 = linear, 1 = exponential</p>",
          "name": "type"
        }
      ],
      "examples": [
        "note(\"g1*4\")\n.s(\"sine\").pdec(.5)\n.penv(32)\n.pcurve(\"<0 1>\")"
      ],
      "kind": "member",
      "tags": [
        "pitch",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "panchor",
      "longname": "panchor",
      "description": "<p>Sets the range anchor of the envelope:</p>\n<ul>\n<li>anchor 0: range = [note, note + penv]</li>\n<li>anchor 1: range = [note - penv, note]\nIf you don't set an anchor, the value will default to the psustain value.</li>\n</ul>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>anchor offset</p>",
          "name": "anchor"
        }
      ],
      "examples": [
        "note(\"c c4\").penv(12).panchor(\"<0 .5 1 .5>\")"
      ],
      "kind": "member",
      "tags": [
        "pitch",
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "leslie",
      "longname": "leslie",
      "description": "<p>Emulation of a Leslie speaker: speakers rotating in a wooden amplified cabinet.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "wet"
        }
      ],
      "examples": [
        "n(\"0,4,7\").s(\"supersquare\").leslie(\"<0 .4 .6 1>\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "lrate",
      "longname": "lrate",
      "description": "<p>Rate of modulation / rotation for leslie effect</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>6.7 for fast, 0.7 for slow</p>",
          "name": "rate"
        }
      ],
      "examples": [
        "n(\"0,4,7\").s(\"supersquare\").leslie(1).lrate(\"<1 2 4 8>\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "lsize",
      "longname": "lsize",
      "description": "<p>Physical size of the cabinet in meters. Be careful, it might be slightly larger than your computer. Affects the Doppler amount (pitch warble)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>somewhere between 0 and 1</p>",
          "name": "meters"
        }
      ],
      "examples": [
        "n(\"0,4,7\").s(\"supersquare\").leslie(1).lrate(2).lsize(\"<.1 .5 1>\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "label",
      "longname": "label",
      "description": "<p>Sets the displayed text for an event on the pianoroll</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>text to display</p>",
          "name": "label"
        }
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "octave",
      "longname": "octave",
      "description": "<p>Sets the default octave of a synth.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>octave number</p>",
          "name": "octave"
        }
      ],
      "examples": [
        "n(\"0,4,7\").scale(\"F:minor\").s('supersaw').octave(\"<0 1 2 3>\")"
      ],
      "synonyms": [
        "oct"
      ],
      "synonyms_text": "oct",
      "kind": "member",
      "tags": [
        "superdirt"
      ]
    },
    {
      "name": "orbit",
      "longname": "orbit",
      "description": "<p>An <code>orbit</code> is a global parameter context for patterns. Patterns with the same orbit will share the same global effects.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "number"
        }
      ],
      "examples": [
        "stack(\n  s(\"hh*6\").delay(.5).delaytime(.25).orbit(1),\n  s(\"~ sd ~ sd\").delay(.5).delaytime(.125).orbit(2)\n)"
      ],
      "synonyms": [
        "o"
      ],
      "synonyms_text": "o",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "bus",
      "longname": "bus",
      "description": "<p>A <code>bus</code> is a send which can be used for mixing patterns. It combines with..\ns(&quot;bus&quot;) to play that bus through another pattern (for, say, applying non-linear\neffects like distortion to multiple signals)</p>\n<p>otherPat.bmod(..) (to modulate another pattern with the bus)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "number"
        }
      ],
      "kind": "member",
      "tags": [
        "superdirt"
      ]
    },
    {
      "name": "busgain",
      "longname": "busgain",
      "description": "<p>Postgain multiplier prior to sending the signal to the audio bus.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "name": "number"
        }
      ],
      "synonyms": [
        "bgain"
      ],
      "synonyms_text": "bgain",
      "kind": "member",
      "tags": [
        "superdirt"
      ]
    },
    {
      "name": "pan",
      "longname": "pan",
      "description": "<p>Sets position in stereo.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1, from left to right (assuming stereo), once round a circle (assuming multichannel)</p>",
          "name": "pan"
        }
      ],
      "examples": [
        "s(\"[bd hh]*2\").pan(\"<.5 1 .5 0>\")",
        "s(\"bd rim sd rim bd ~ cp rim\").pan(sine.slow(2))"
      ],
      "kind": "member",
      "tags": [
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "panspan",
      "longname": "panspan",
      "description": "<p>Controls how much multichannel output is fanned out</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between -inf and inf, negative is backwards ordering</p>",
          "name": "span"
        }
      ],
      "examples": [
        "s(\"[bd hh]*2\").pan(\"<.5 1 .5 0>\").panspan(\"<0 .5 1>\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt"
      ]
    },
    {
      "name": "pansplay",
      "longname": "pansplay",
      "description": "<p>Controls how much multichannel output is spread</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "spread"
        }
      ],
      "examples": [
        "s(\"[bd hh]*2\").pan(\"<.5 1 .5 0>\").pansplay(\"<0 .5 1>\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt"
      ]
    },
    {
      "name": "chord",
      "longname": "chord",
      "description": "<p>The chord to voice</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>chord symbols to voice e.g., C, Eb, Fm7, G7. The symbols can be defined via addVoicings</p>",
          "name": "symbols"
        }
      ],
      "examples": [
        "chord(\"<Am C D F Am E Am E>\").voicing()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "dictionary",
      "longname": "dictionary",
      "description": "<p>Which dictionary to use for the voicings. This falls back to the default dictionary if not provided</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>which dictionary (having been defined with <code>addVoicings</code>) to use</p>",
          "name": "dictionaryName"
        }
      ],
      "examples": [
        "addVoicings('house', {\n'': ['7 12 16', '0 7 16', '4 7 12'],\n'm': ['0 3 7']\n})\nchord(\"<Am C D F Am E Am E>\")\n.dict('house').anchor(66)\n.voicing().room(.5)"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "anchor",
      "longname": "anchor",
      "description": "<p>The top note to align the voicing to. Defaults to c5</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>the note to align the voicing or scale to</p>",
          "name": "anchorNote"
        }
      ],
      "examples": [
        "anchor(\"<c4 g4 c5 g5>\").chord(\"C\").voicing()",
        "n(\"0 .. 7\").anchor(\"<c4 g4 c5 g5>\").scale(\"<C:major F:minor>\")"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "offset",
      "longname": "offset",
      "description": "<p>Sets how the voicing is offset from the anchored position</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>the amount to shift the voicing up or down</p>",
          "name": "shift"
        }
      ],
      "examples": [
        "chord(\"<Am C D F Am E Am E>\").offset(\"<0 1 2 3 4 5>\") // alter the voicing each time"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "octaves",
      "longname": "octaves",
      "description": "<p>How many octaves are voicing steps spread apart, defaults to 1</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>the number of octaves</p>",
          "name": "count"
        }
      ],
      "examples": [
        "chord(\"<Am C D F Am E Am E>\").octaves(\"<2 4>\").voicing()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "mode",
      "longname": "mode",
      "description": "<p>Remove anchor note from the voicing. Useful for melody harmonization</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>one of {below | above | duck | root}</p>",
          "name": "modeName"
        }
      ],
      "examples": [
        "mode(\"<below above duck root>\").chord(\"C\").voicing()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "room",
      "longname": "room",
      "description": "<p>Sets the level of reverb.</p>\n<p>When using mininotation, you can also optionally add the 'size' parameter, separated by ':'.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "level"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").room(\"<0 .2 .4 .6 .8 1>\")",
        "s(\"bd sd [~ bd] sd\").room(\"<0.9:1 0.9:4>\")"
      ],
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "roomlp",
      "longname": "roomlp",
      "description": "<p>Reverb lowpass starting frequency (in hertz).\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>between 0 and 20000hz</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").room(0.5).rlp(10000)",
        "s(\"bd sd [~ bd] sd\").room(0.5).rlp(5000)"
      ],
      "synonyms": [
        "rlp"
      ],
      "synonyms_text": "rlp",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "roomdim",
      "longname": "roomdim",
      "description": "<p>Reverb lowpass frequency at -60dB (in hertz).\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>between 0 and 20000hz</p>",
          "name": "frequency"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").room(0.5).rlp(10000).rdim(8000)",
        "s(\"bd sd [~ bd] sd\").room(0.5).rlp(5000).rdim(400)"
      ],
      "synonyms": [
        "rdim"
      ],
      "synonyms_text": "rdim",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "roomfade",
      "longname": "roomfade",
      "description": "<p>Reverb fade time (in seconds).\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>for the reverb to fade</p>",
          "name": "seconds"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").room(0.5).rlp(10000).rfade(0.5)",
        "s(\"bd sd [~ bd] sd\").room(0.5).rlp(5000).rfade(4)"
      ],
      "synonyms": [
        "rfade"
      ],
      "synonyms_text": "rfade",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "iresponse",
      "longname": "iresponse",
      "description": "<p>Sets the sample to use as an impulse response for the reverb.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>to use as an impulse response</p>",
          "name": "sample"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").room(.8).ir(\"<shaker_large:0 shaker_large:2>\")"
      ],
      "synonyms": [
        "ir"
      ],
      "synonyms_text": "ir",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "irspeed",
      "longname": "irspeed",
      "description": "<p>Sets speed of the sample for the impulse response.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "name": "speed"
        }
      ],
      "examples": [
        "samples('github:switchangel/pad')\n$: s(\"brk/2\").fit().scrub(irand(16).div(16).seg(8)).ir(\"swpad:4\").room(.2).irspeed(\"<2 1 .5>/2\").irbegin(.5).roomsize(.5)"
      ],
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "irbegin",
      "longname": "irbegin",
      "description": "<p>Sets the beginning of the IR response sample</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "begin"
        }
      ],
      "examples": [
        "samples('github:switchangel/pad')\n$: s(\"brk/2\").fit().scrub(irand(16).div(16).seg(8)).ir(\"swpad:4\").room(.65).irspeed(\"-2\").irbegin(\"<0 .5 .75>/2\").roomsize(.6)"
      ],
      "synonyms": [
        "ir"
      ],
      "synonyms_text": "ir",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "roomsize",
      "longname": "roomsize",
      "description": "<p>Sets the room size of the reverb, see <code>room</code>.\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 10</p>",
          "name": "size"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd\").room(.8).rsize(1)",
        "s(\"bd sd [~ bd] sd\").room(.8).rsize(4)"
      ],
      "synonyms": [
        "rsize",
        "sz",
        "size"
      ],
      "synonyms_text": "rsize, sz, size",
      "kind": "member",
      "tags": [
        "orbit",
        "superdough"
      ]
    },
    {
      "name": "shape",
      "longname": "shape",
      "description": "<p>(Deprecated) Wave shaping distortion. WARNING: can suddenly get unpredictably loud.\nPlease use distort instead, which has a more predictable response curve\nsecond option in optional array syntax (ex: &quot;.9:.5&quot;) applies a postgain to the output</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and 1</p>",
          "name": "distortion"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\").shape(\"<0 .2 .4 .6 .8>\")"
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "distort",
      "longname": "distort",
      "description": "<p>Wave shaping distortion. CAUTION: it can get loud.\nSecond option in optional array syntax (ex: &quot;.9:.5&quot;) applies a postgain to the output. Third option sets the waveshaping type.\nMost useful values are usually between 0 and 10 (depending on source gain). If you are feeling adventurous, you can turn it up to 11 and beyond ;)</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        },
        {
          "type": {
            "names": [
              "number",
              "string",
              "Pattern"
            ]
          },
          "description": "<p>type of distortion to apply</p>",
          "name": "type"
        }
      ],
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\").distort(\"<0 2 3 10:.5>\")",
        "note(\"d1!8\").s(\"sine\").penv(36).pdecay(.12).decay(.23).distort(\"8:.4\")",
        "s(\"bd:4*4\").bank(\"tr808\").distort(\"3:0.5:diode\")"
      ],
      "synonyms": [
        "dist"
      ],
      "synonyms_text": "dist",
      "kind": "member",
      "tags": [
        "distortion",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "distortvol",
      "longname": "distortvol",
      "description": "<p>Postgain for waveshaping distortion.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "examples": [
        "s(\"bd*4\").bank(\"tr909\").distort(2).distortvol(0.8)"
      ],
      "synonyms": [
        "distortion",
        "distvol"
      ],
      "synonyms_text": "distortion, distvol",
      "kind": "member",
      "tags": [
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "distorttype",
      "longname": "distorttype",
      "description": "<p>Type of waveshaping distortion to apply.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "string",
              "Pattern"
            ]
          },
          "description": "<p>type of distortion to apply</p>",
          "name": "type"
        }
      ],
      "examples": [
        "s(\"bd*4\").bank(\"tr909\").distort(2).distorttype(\"<0 1 2>\")",
        "s(\"sine\").note(\"F1*2\").release(1)\n  .penv(24).pdecay(0.05)\n  .distort(rand.range(1, 8))\n  .distorttype(\"<fold chebyshev scurve diode asym sinefold>\")"
      ],
      "synonyms": [
        "disttype"
      ],
      "synonyms_text": "disttype",
      "kind": "member",
      "tags": [
        "distortion",
        "superdough",
        "supradough"
      ]
    },
    {
      "name": "compressor",
      "longname": "compressor",
      "description": "<p>Dynamics Compressor. The params are <code>compressor(&quot;threshold:ratio:knee:attack:release&quot;)</code>\nMore info <a href=\"https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode?retiredLocale=de#instance_properties\">here</a></p>",
      "examples": [
        "s(\"bd sd [~ bd] sd,hh*8\")\n.compressor(\"-20:20:10:.002:.02\")"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "speed",
      "longname": "speed",
      "description": "<p>Changes the speed of sample playback, i.e. a cheap way of changing pitch.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>inf to inf, negative numbers play the sample backwards.</p>",
          "name": "speed"
        }
      ],
      "examples": [
        "s(\"bd*6\").speed(\"1 2 4 1 -2 -4\")",
        "speed(\"1 1.5*2 [2 1.1]\").s(\"piano\").clip(1)"
      ],
      "kind": "member",
      "tags": [
        "pitch",
        "samples"
      ]
    },
    {
      "name": "stretch",
      "longname": "stretch",
      "description": "<p>Changes the pitch of the sample without changing its speed.\nThe frequencies are multiplied by (factor + 1) for positive numbers\nand by max(factor / 4 + 1, 0) for negative numbers.\nSo tuning up by octaves can be done with 1, 3, 7, ...\nand tuning down by octaves with -2, -3, -3.5...</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between <code>-4</code> and <code>inf</code>. Positive increases pitch, 0 does nothing, negative decreases the pitch.</p>",
          "name": "factor"
        }
      ],
      "examples": [
        "s(\"gm_flute\").stretch(\"<2 1 0 -2>\")"
      ],
      "kind": "member",
      "tags": [
        "pitch",
        "samples"
      ]
    },
    {
      "name": "unit",
      "longname": "unit",
      "description": "<p>Used in conjunction with <code>speed</code>, accepts values of &quot;r&quot; (rate, default behavior), &quot;c&quot; (cycles), or &quot;s&quot; (seconds). Using <code>unit &quot;c&quot;</code> means <code>speed</code> will be interpreted in units of cycles, e.g. <code>speed &quot;1&quot;</code> means samples will be stretched to fill a cycle. Using <code>unit &quot;s&quot;</code> means the playback speed will be adjusted so that the duration is the number of seconds specified by <code>speed</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "string",
              "Pattern"
            ]
          },
          "description": "<p>see description above</p>",
          "name": "unit"
        }
      ],
      "examples": [
        "speed(\"1 2 .5 3\").s(\"bd\").unit(\"c\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "squiz",
      "longname": "squiz",
      "description": "<p>Made by Calum Gunn. Reminiscent of some weird mixture of filter, ring-modulator and pitch-shifter. The SuperCollider manual defines Squiz as:</p>\n<p>&quot;A simplistic pitch-raising algorithm. It's not meant to sound natural; its sound is reminiscent of some weird mixture of filter, ring-modulator and pitch-shifter, depending on the input. The algorithm works by cutting the signal into fragments (delimited by upwards-going zero-crossings) and squeezing those fragments in the time domain (i.e. simply playing them back faster than they came in), leaving silences inbetween. All the parameters apart from memlen can be modulated.&quot;</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Try passing multiples of 2 to it - 2, 4, 8 etc.</p>",
          "name": "squiz"
        }
      ],
      "examples": [
        "squiz(\"2 4/2 6 [8 16]\").s(\"bd\").osc()"
      ],
      "kind": "member",
      "tags": [
        "superdirt",
        {
          "originalTitle": "superdirtOnly",
          "title": "superdirtonly",
          "text": ""
        }
      ]
    },
    {
      "name": "vowel",
      "longname": "vowel",
      "description": "<p>Formant filter to make things sound like vowels.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>You can use a e i o u ae aa oe ue y uh un en an on, corresponding to [a] [e] [i] [o] [u] [æ] [ɑ] [ø] [y] [ɯ] [ʌ] [œ̃] [ɛ̃] [ɑ̃] [ɔ̃]. Aliases: aa = å = ɑ, oe = ø = ö, y = ı, ae = æ.</p>",
          "name": "vowel"
        }
      ],
      "examples": [
        "note(\"[c2 <eb2 <g2 g1>>]*2\").s('sawtooth')\n.vowel(\"<a e i <o u>>\")",
        "s(\"bd sd mt ht bd [~ cp] ht lt\").vowel(\"[a|e|i|o|u]\")"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "density",
      "longname": "density",
      "description": "<p>crackle noise density</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>between 0 and x</p>",
          "name": "density"
        }
      ],
      "examples": [
        "s(\"crackle*4\").density(\"<0.01 0.04 0.2 0.5>\".slow(4))"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "clip",
      "longname": "clip",
      "description": "<p>Multiplies the duration with the given number. Also cuts samples off at the end if they exceed the duration.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<blockquote>\n<p>= 0</p>\n</blockquote>",
          "name": "factor"
        }
      ],
      "examples": [
        "note(\"c a f e\").s(\"piano\").clip(\"<.5 1 2>\")"
      ],
      "synonyms": [
        "legato"
      ],
      "synonyms_text": "legato",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "duration",
      "longname": "duration",
      "description": "<p>Sets the duration of the event in cycles. Similar to clip / legato, it also cuts samples off at the end if they exceed the duration.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<blockquote>\n<p>= 0</p>\n</blockquote>",
          "name": "seconds"
        }
      ],
      "examples": [
        "note(\"c a f e\").s(\"piano\").dur(\"<.5 1 2>\")"
      ],
      "synonyms": [
        "dur"
      ],
      "synonyms_text": "dur",
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "color",
      "longname": "color",
      "description": "<p>Sets the color of the hap in visualizations like pianoroll or highlighting.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>Hexadecimal or CSS color name</p>",
          "name": "color"
        }
      ],
      "synonyms": [
        "colour"
      ],
      "synonyms_text": "colour",
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "adsr",
      "longname": "adsr",
      "description": "<p>ADSR envelope: Combination of Attack, Decay, Sustain, and Release.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>attack time in seconds</p>",
          "name": "time"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>decay time in seconds</p>",
          "name": "time"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>sustain level (0 to 1)</p>",
          "name": "gain"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>release time in seconds</p>",
          "name": "time"
        }
      ],
      "examples": [
        "note(\"[c3 bb2 f3 eb3]*2\").sound(\"sawtooth\").lpf(600).adsr(\".1:.1:.5:.2\")"
      ],
      "kind": "member",
      "tags": [
        "envelope",
        "amplitude"
      ]
    },
    {
      "name": "midichan",
      "longname": "midichan",
      "description": "<p>MIDI channel: Sets the MIDI channel for the event.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI channel number (0-15)</p>",
          "name": "channel"
        }
      ],
      "examples": [
        "note(\"c4\").midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "midiport",
      "longname": "midiport",
      "description": "<p>MIDI port: Sets the MIDI port for the event.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI port</p>",
          "name": "port"
        }
      ],
      "examples": [
        "note(\"c a f e\").midiport(\"<0 1 2 3>\").midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "midicmd",
      "longname": "midicmd",
      "description": "<p>MIDI command: Sends a MIDI command message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI command</p>",
          "name": "command"
        }
      ],
      "examples": [
        "midicmd(\"clock*48,<start stop>/2\").midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "control",
      "longname": "control",
      "description": "<p>MIDI control: Sends a MIDI control change message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>control number (0-127)</p>",
          "name": "MIDI"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>controller value (0-127)</p>",
          "name": "MIDI"
        }
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "ccn",
      "longname": "ccn",
      "description": "<p>MIDI control number: Sends a MIDI control change message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>control number (0-127)</p>",
          "name": "MIDI"
        }
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "ccv",
      "longname": "ccv",
      "description": "<p>MIDI control value: Sends a MIDI control change message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>control value (0-127)</p>",
          "name": "MIDI"
        }
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "nrpnn",
      "longname": "nrpnn",
      "description": "<p>MIDI NRPN non-registered parameter number: Sends a MIDI NRPN non-registered parameter number message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI NRPN non-registered parameter number (0-127)</p>",
          "name": "nrpnn"
        }
      ],
      "examples": [
        "note(\"c4\").nrpnn(\"1:8\").nrpv(\"123\").midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "nrpv",
      "longname": "nrpv",
      "description": "<p>MIDI NRPN non-registered parameter value: Sends a MIDI NRPN non-registered parameter value message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI NRPN non-registered parameter value (0-127)</p>",
          "name": "nrpv"
        }
      ],
      "examples": [
        "note(\"c4\").nrpnn(\"1:8\").nrpv(\"123\").midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "progNum",
      "longname": "progNum",
      "description": "<p>MIDI program number: Sends a MIDI program change message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI program number (0-127)</p>",
          "name": "program"
        }
      ],
      "examples": [
        "note(\"c4\").progNum(10).midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "sysex",
      "longname": "sysex",
      "description": "<p>MIDI sysex: Sends a MIDI sysex message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Sysex ID</p>",
          "name": "id"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Sysex data</p>",
          "name": "data"
        }
      ],
      "examples": [
        "note(\"c4\").sysex([\"0x77\", \"0x01:0x02:0x03:0x04\"]).midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "sysexid",
      "longname": "sysexid",
      "description": "<p>MIDI sysex ID: Sends a MIDI sysex identifier message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Sysex ID</p>",
          "name": "id"
        }
      ],
      "examples": [
        "note(\"c4\").sysexid(\"0x77\").sysexdata(\"0x01:0x02:0x03:0x04\").midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "sysexdata",
      "longname": "sysexdata",
      "description": "<p>MIDI sysex data: Sends a MIDI sysex message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Sysex data</p>",
          "name": "data"
        }
      ],
      "examples": [
        "note(\"c4\").sysexid(\"0x77\").sysexdata(\"0x01:0x02:0x03:0x04\").midichan(1).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "midibend",
      "longname": "midibend",
      "description": "<p>MIDI pitch bend: Sends a MIDI pitch bend message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI pitch bend (-1 - 1)</p>",
          "name": "midibend"
        }
      ],
      "examples": [
        "note(\"c4\").midibend(sine.slow(4).range(-0.4,0.4)).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "miditouch",
      "longname": "miditouch",
      "description": "<p>MIDI key after touch: Sends a MIDI key after touch message.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>MIDI key after touch (0-1)</p>",
          "name": "miditouch"
        }
      ],
      "examples": [
        "note(\"c4\").miditouch(sine.slow(4).range(0,1)).midi()"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "oschost",
      "longname": "oschost",
      "description": "<p>The host to send open sound control messages to. Requires running the OSC bridge.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>e.g. 'localhost'</p>",
          "name": "oschost"
        }
      ],
      "examples": [
        "note(\"c4\").oschost('127.0.0.1').oscport(57120).osc();"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "oscport",
      "longname": "oscport",
      "description": "<p>The port to send open sound control messages to. Requires running the OSC bridge.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>e.g. 57120</p>",
          "name": "oscport"
        }
      ],
      "examples": [
        "note(\"c4\").oschost('127.0.0.1').oscport(57120).osc();"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "as",
      "longname": "as",
      "description": "<p>Sets properties in a batch.</p>",
      "params": [
        {
          "type": {
            "names": [
              "String",
              "Array"
            ]
          },
          "description": "<p>the control names that are set</p>",
          "name": "mapping"
        }
      ],
      "examples": [
        "\"c:.5 a:1 f:.25 e:.8\".as(\"note:clip\")",
        "\"{0@2 0.25 0 0.5 .3 .5}%8\".as(\"begin\").s(\"sax_vib\").clip(1)"
      ],
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "scrub",
      "longname": "Pattern.scrub",
      "description": "<p>Allows you to scrub an audio file like a tape loop by passing values that represents the position in the audio file\nin the optional array syntax ex: &quot;0.5:2&quot;, the second value controls the speed of playback</p>",
      "examples": [
        "samples('github:switchangel/pad')\ns(\"swpad:0\").scrub(\"{0.1!2 .25@3 0.7!2 <0.8:1.5>}%8\")",
        "samples('github:yaxu/clean-breaks/main');\ns(\"amen/4\").fit().scrub(\"{0@3 0@2 4@3}%8\".div(16))"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "lfo",
      "longname": "lfo",
      "description": "<p>Configures an LFO. Can be called in sequence like pat.lfo(...).lfo(...) to set up multiple LFOs.\nThere are two ways to declare which control will be modulated:</p>\n<ol>\n<li>Explicitly put <code>control</code> in the config (e.g. <code>lfo({ c: &quot;lpf&quot; })</code>)</li>\n<li>If the control parameter is absent, the control <em>immediately before</em> the <code>lfo</code> call will be used\n(e.g. <code>s(&quot;saw&quot;).lpf(500).lfo()</code> to modulate <code>lpf</code>)</li>\n</ol>\n<p>Modulators can be referred to by <code>id</code> so that they can be updated later e.g. inside\na <code>sometimes</code>. See example below.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "description": "<p>LFO configuration.</p>",
          "name": "config"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Node to modulate. Aliases: c</p>",
          "name": "config.control"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Sub-control name to append to the control key. Aliases: sc</p>",
          "name": "config.subControl"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Modulation rate. Aliases: r</p>",
          "name": "config.rate"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Tempo-synced modulation rate. Aliases: s</p>",
          "name": "config.sync"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Relative modulation depth. Aliases: dep, dr</p>",
          "name": "config.depth"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Absolute modulation depth. Aliases: da</p>",
          "name": "config.depthabs"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>DC offset / bias for the waveform. Aliases: dc</p>",
          "name": "config.dcoffset"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Shape index. Aliases: sh</p>",
          "name": "config.shape"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Skew amount. Aliases: sk</p>",
          "name": "config.skew"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Exponential curve amount. Aliases: cu</p>",
          "name": "config.curve"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>If &gt; 0.5, the LFO will retrigger on each event. Aliases: rt</p>",
          "name": "config.retrig"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>FX index to target</p>",
          "name": "config.fxi"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>ID to use for this modulator</p>",
          "name": "id"
        }
      ],
      "examples": [
        "s(\"saw\").note(\"F1\").lpf(500).lfo()",
        "s(\"saw\").lfo().lpf(500).lfo({ s: 0.3 })",
        "s(\"saw\").lpf(500).diode(0.3)\n  .lfo({ c: \"lpf\" })",
        "s(\"pulse\").lpf(500).lfo()\n  .lfo({ c: \"s\" })\n  .diode(0.3)\n  .sometimes(x => x.lfo({ s: \"8\" }, 1)) // lfo #1 (0-indexed)",
        "s(\"pulse\").lpf(500).lfo({ depth: 4 }, 'lpf_mod')\n  .lfo({ c: \"s\" })\n  .diode(0.3)\n  .sometimes(x => x.lfo({ s: \"8\" }, 'lpf_mod'))"
      ],
      "kind": "member",
      "tags": [
        "lfo",
        "superdough"
      ]
    },
    {
      "name": "env",
      "longname": "env",
      "description": "<p>Configures an envelope. Can be called in sequence like pat.env(...).env(...) to set up multiple envelopes\nThere are two ways to declare which control will be modulated:</p>\n<ol>\n<li>Explicitly put <code>control</code> in the config (e.g. <code>env({ c: &quot;lpf&quot; })</code>)</li>\n<li>If the control parameter is absent, the control <em>immediately before</em> the <code>env</code> call will be used\n(e.g. <code>s(&quot;saw&quot;).lpf(500).env({ a: 1 })</code> to modulate <code>lpf</code>)</li>\n</ol>\n<p>Modulators can be referred to by <code>id</code> so that they can be updated later e.g. inside\na <code>sometimes</code>. See example below.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "description": "<p>Envelope configuration.</p>",
          "name": "config"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Node to modulate. Aliases: c</p>",
          "name": "config.control"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Sub-control name to append to the control key. Aliases: sc</p>",
          "name": "config.subControl"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Relative modulation depth. Aliases: dep, dr</p>",
          "name": "config.depth"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Absolute modulation depth. Aliases: da</p>",
          "name": "config.depthabs"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Time to reach depth. Aliases: att, a</p>",
          "name": "config.attack"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Time to reach sustain. Aliases: dec, d</p>",
          "name": "config.decay"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Sustain depth. Aliases: sus, s</p>",
          "name": "config.sustain"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Time to return to nominal value. Aliases: rel, r</p>",
          "name": "config.release"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Snappiness of attack curve (-1 = relaxed, 1 = snappy). Aliases: ac</p>",
          "name": "config.acurve"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Snappiness of decay curve (-1 = relaxed, 1 = snappy). Aliases: dc</p>",
          "name": "config.dcurve"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Snappiness of release curve (-1 = relaxed, 1 = snappy). Aliases: rc</p>",
          "name": "config.rcurve"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>FX index to target</p>",
          "name": "config.fxi"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>ID to use for this modulator</p>",
          "name": "id"
        }
      ],
      "examples": [
        "s(\"saw\").note(\"F1\").lpf(500).env({ a: 1 })",
        "s(\"saw\").env({ d: 1 }).note(\"F1\")\n  .lpq(4).lpf(50)\n  .env({ a: 0.1, d: 1, ac: 0.8, dc: 0.3, depth: 50 })",
        "s(\"saw\").lpf(500).diode(0.3)\n  .env({ c: \"lpf\", a: 0.5, d: 0.5 })",
        "s(\"pulse\").lpf(500).env({ a: 1 })\n  .env({ c: \"s\", a: 1 })\n  .diode(0.3)\n  .sometimes(x => x.env({ a: \"0.5\" }, 1)) // envelope #1 (0-indexed)",
        "s(\"pulse\").lpf(500).env({ a: 1 }, 'lpf_mod')\n  .env({ c: \"s\", a: 1 })\n  .diode(0.3)\n  .sometimes(x => x.env({ a: \"0.5\" }, 'lpf_mod'))"
      ],
      "kind": "member",
      "tags": [
        "envelope",
        "superdough"
      ]
    },
    {
      "name": "bmod",
      "longname": "bmod",
      "description": "<p>Modulates with the output from a given <code>bus</code>.\nCan be called in sequence like pat.bmod(...).bmod(...) to set up multiple modulators</p>\n<p>Send to an audio bus with <code>otherPat.bus(..)</code>.</p>\n<p>There are two ways to declare which control will be modulated:</p>\n<ol>\n<li>Explicitly put <code>control</code> in the config (e.g. <code>bmod({ id: 2, c: &quot;lpf&quot; })</code>)</li>\n<li>If the control parameter is absent, the control <em>immediately before</em> the <code>bmod</code> call will be used\n(e.g. <code>s(&quot;saw&quot;).lpf(500).bmod({ id: 2 })</code> to modulate <code>lpf</code>)</li>\n</ol>\n<p>Modulators can be referred to by <code>id</code> so that they can be updated later e.g. inside\na <code>sometimes</code>. See example below.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "description": "<p>Bus modulation configuration.</p>",
          "name": "config"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Bus to get modulation signal from</p>",
          "name": "config.bus"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Node to modulate. Aliases: c</p>",
          "name": "config.control"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Sub-control name to append to the control key. Aliases: sc</p>",
          "name": "config.subControl"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Relative modulation depth. Aliases: dep, dr</p>",
          "name": "config.depth"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>Absolute modulation depth. Aliases: da</p>",
          "name": "config.depthabs"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>DC offset prior to application</p>",
          "name": "config.dc"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "optional": true,
          "description": "<p>FX index to target</p>",
          "name": "config.fxi"
        },
        {
          "type": {
            "names": [
              "string",
              "Pattern"
            ]
          },
          "description": "<p>ID to use for this modulator</p>",
          "name": "id"
        }
      ],
      "examples": [
        "modulator: s(\"one\").seg(64).gain(slider(0, 0, 1)).bus(1).dry(0)\ncarrier: s(\"saw\").bmod({ b: 1 })"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "transient",
      "longname": "transient",
      "description": "<p>Transient shaper. Gives independent control over the emphasis on transients\nand sustains</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Emphasis on transients; between -1 (deaccentuate) and 1 (accentuate)</p>",
          "name": "attack"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Emphasis on the sustains; between -1 (deaccentuate) and 1 (accentuate)</p>",
          "name": "sustain"
        }
      ],
      "examples": [
        "s(\"bd\").transient(\"<-1 -0.5 0 0.5 1>\")",
        "s(\"hh*16\").bank(\"tr909\").transient(\"<-1:1 1:-1>\")"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "drawLine",
      "longname": "drawLine",
      "description": "<p>Intended for a debugging, drawLine renders the pattern as a string, where each character represents the same time span.\nShould only be used with single characters as values, otherwise the character slots will be messed up.\nCharacter legend:</p>\n<ul>\n<li>&quot;|&quot; cycle separator</li>\n<li>&quot;-&quot; hold previous value</li>\n<li>&quot;.&quot; silence</li>\n</ul>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "description": "<p>the pattern to use</p>",
          "name": "pattern"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>max number of characters (approximately)</p>",
          "name": "chars"
        }
      ],
      "examples": [
        "const line = drawLine(\"0 [1 2 3]\", 10); // |0--123|0--123\nconsole.log(line);\nsilence;"
      ],
      "kind": "function",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "euclid",
      "longname": "Pattern.euclid",
      "description": "<p>Changes the structure of the pattern to form an Euclidean rhythm.\nEuclidean rhythms are rhythms obtained using the greatest common\ndivisor of two numbers.  They were described in 2004 by Godfried\nToussaint, a Canadian computer scientist.  Euclidean rhythms are\nreally useful for computer/algorithmic music because they can\ndescribe a large number of rhythms with a couple of numbers.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of onsets/beats</p>",
          "name": "pulses"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of steps to fill</p>",
          "name": "steps"
        }
      ],
      "examples": [
        "// The Cuban tresillo pattern.\nnote(\"c3\").euclid(3,8)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "euclidRot",
      "longname": "Pattern.euclidRot",
      "description": "<p>Like <code>euclid</code>, but has an additional parameter for 'rotating' the resulting sequence.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of onsets/beats</p>",
          "name": "pulses"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of steps to fill</p>",
          "name": "steps"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>offset in steps</p>",
          "name": "rotation"
        }
      ],
      "examples": [
        "// A Samba rhythm necklace from Brazil\nnote(\"c3\").euclidRot(3,16,14)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "_euclidRot",
      "longname": "_euclidRot",
      "params": [],
      "examples": [
        "// A thirteenth-century Persian rhythm called Khafif-e-ramal.\nnote(\"c3\").euclid(2,5)",
        "// The archetypal pattern of the Cumbia from Colombia, as well as a Calypso rhythm from Trinidad.\nnote(\"c3\").euclid(3,4)",
        "// Another thirteenth century Persian rhythm by the name of Khafif-e-ramal, as well as a Rumanian folk-dance rhythm.\nnote(\"c3\").euclidRot(3,5,2)",
        "// A Ruchenitza rhythm used in a Bulgarian folk dance.\nnote(\"c3\").euclid(3,7)",
        "// The Cuban tresillo pattern.\nnote(\"c3\").euclid(3,8)",
        "// Another Ruchenitza Bulgarian folk-dance rhythm.\nnote(\"c3\").euclid(4,7)",
        "// The Aksak rhythm of Turkey.\nnote(\"c3\").euclid(4,9)",
        "// The metric pattern used by Frank Zappa in his piece titled Outside Now.\nnote(\"c3\").euclid(4,11)",
        "// Yields the York-Samai pattern, a popular Arab rhythm.\nnote(\"c3\").euclid(5,6)",
        "// The Nawakhat pattern, another popular Arab rhythm.\nnote(\"c3\").euclid(5,7)",
        "// The Cuban cinquillo pattern.\nnote(\"c3\").euclid(5,8)",
        "// A popular Arab rhythm called Agsag-Samai.\nnote(\"c3\").euclid(5,9)",
        "// The metric pattern used by Moussorgsky in Pictures at an Exhibition.\nnote(\"c3\").euclid(5,11)",
        "// The Venda clapping pattern of a South African children’s song.\nnote(\"c3\").euclid(5,12)",
        "// The Bossa-Nova rhythm necklace of Brazil.\nnote(\"c3\").euclid(5,16)",
        "// A typical rhythm played on the Bendir (frame drum).\nnote(\"c3\").euclid(7,8)",
        "// A common West African bell pattern.\nnote(\"c3\").euclid(7,12)",
        "// A Samba rhythm necklace from Brazil.\nnote(\"c3\").euclidRot(7,16,14)",
        "// A rhythm necklace used in the Central African Republic.\nnote(\"c3\").euclid(9,16)",
        "// A rhythm necklace of the Aka Pygmies of Central Africa.\nnote(\"c3\").euclidRot(11,24,14)",
        "// Another rhythm necklace of the Aka Pygmies of the upper Sangha.\nnote(\"c3\").euclidRot(13,24,5)"
      ],
      "kind": "function"
    },
    {
      "name": "euclidLegato",
      "longname": "Pattern.euclidLegato",
      "description": "<p>Similar to <code>euclid</code>, but each pulse is held until the next pulse,\nso there will be no gaps.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of onsets/beats</p>",
          "name": "pulses"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of steps to fill</p>",
          "name": "steps"
        },
        {
          "description": "<p>offset in steps</p>",
          "name": "rotation"
        },
        {
          "name": "pat"
        }
      ],
      "examples": [
        "note(\"c3\").euclidLegato(3,8)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "euclidLegatoRot",
      "longname": "Pattern.euclidLegatoRot",
      "description": "<p>Similar to <code>euclid</code>, but each pulse is held until the next pulse,\nso there will be no gaps, and has an additional parameter for 'rotating'\nthe resulting sequence</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of onsets/beats</p>",
          "name": "pulses"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of steps to fill</p>",
          "name": "steps"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>offset in steps</p>",
          "name": "rotation"
        }
      ],
      "examples": [
        "note(\"c3\").euclidLegatoRot(3,5,2)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "euclidish",
      "longname": "Pattern.euclidish",
      "description": "<p>A 'euclid' variant with an additional parameter that morphs the resulting\nrhythm from 0 (no morphing) to 1 (completely 'even'). For example\n<code>sound(&quot;bd&quot;).euclidish(3,8,0)</code> would be the same as\n<code>sound(&quot;bd&quot;).euclid(3,8)</code>, and <code>sound(&quot;bd&quot;).euclidish(3,8,1)</code> would be the\nsame as <code>sound(&quot;bd bd bd&quot;)</code>. <code>sound(&quot;bd&quot;).euclidish(3,8,0.5)</code> would have a\ngroove somewhere between.\nInspired by the work of Malcom Braff.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of onsets</p>",
          "name": "pulses"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the number of steps to fill</p>",
          "name": "steps"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>exists between the extremes of 0 (straight euclidian) and 1 (straight pulse)</p>",
          "name": "groove"
        }
      ],
      "examples": [
        "sound(\"hh\").euclidish(7,12,sine.slow(8))\n.pan(sine.slow(8))"
      ],
      "synonyms": [
        "eish"
      ],
      "synonyms_text": "eish",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "clearScope",
      "longname": "clearScope",
      "description": "<p>Clears all user-defined variables and functions from the scope.\nThis removes variables created during block-based evaluation.</p>",
      "examples": [
        "// After defining variables in blocks:\n// let myVar = 5\n// function myFunc() { return 10; }\nclearScope() // removes myVar and myFunc from scope"
      ],
      "kind": "member"
    },
    {
      "name": "Pattern",
      "longname": "Pattern",
      "description": "<p>Create a pattern. As an end user, you will most likely not create a Pattern directly.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>The function that maps a <code>State</code> to an array of <code>Hap</code>.</p>",
          "name": "query"
        }
      ],
      "kind": "class",
      "tags": [
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withValue",
      "longname": "Pattern#withValue",
      "description": "<p>Returns a new pattern, with the function applied to the value of\neach hap. It has the alias <code>fmap</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>to to apply to the value</p>",
          "name": "func"
        }
      ],
      "examples": [
        "\"0 1 2\".withValue(v => v + 10).log()"
      ],
      "synonyms": [
        "fmap"
      ],
      "synonyms_text": "fmap",
      "kind": "function",
      "tags": [
        "functional"
      ]
    },
    {
      "name": "fmap",
      "longname": "Pattern#fmap",
      "description": "<p>see <code>withValue</code></p>",
      "params": [],
      "kind": "function",
      "tags": [
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "appWhole",
      "longname": "Pattern#appWhole",
      "description": "<p>Assumes 'this' is a pattern of functions, and given a function to\nresolve wholes, applies a given pattern of values to that\npattern of functions.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "whole_func"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "functional",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "appBoth",
      "longname": "Pattern#appBoth",
      "description": "<p>When this method is called on a pattern of functions, it matches its haps\nwith those in the given pattern of values.  A new pattern is returned, with\neach matching value applied to the corresponding function.</p>\n<p>In this <code>_appBoth</code> variant, where timespans of the function and value haps\nare not the same but do intersect, the resulting hap has a timespan of the\nintersection. This applies to both the part and the whole timespan.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat_val"
        }
      ],
      "kind": "function",
      "tags": [
        "functional",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "appLeft",
      "longname": "Pattern#appLeft",
      "description": "<p>As with <code>appBoth</code>, but the <code>whole</code> timespan is not the intersection,\nbut the timespan from the function of patterns that this method is called\non. In practice, this means that the pattern structure, including onsets,\nare preserved from the pattern of functions (often referred to as the left\nhand or inner pattern).</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat_val"
        }
      ],
      "kind": "function",
      "tags": [
        "functional",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "appRight",
      "longname": "Pattern#appRight",
      "description": "<p>As with <code>appLeft</code>, but <code>whole</code> timespans are instead taken from the\npattern of values, i.e. structure is preserved from the right hand/outer\npattern.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat_val"
        }
      ],
      "kind": "function",
      "tags": [
        "functional",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "queryArc",
      "longname": "Pattern#queryArc",
      "description": "<p>Query haps inside the given time span.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Fraction",
              "number"
            ]
          },
          "description": "<p>from time</p>",
          "name": "begin"
        },
        {
          "type": {
            "names": [
              "Fraction",
              "number"
            ]
          },
          "description": "<p>to time</p>",
          "name": "end"
        }
      ],
      "examples": [
        "const pattern = sequence('a', ['b', 'c'])\nconst haps = pattern.queryArc(0, 1)\nconsole.log(haps)\nsilence"
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "splitQueries",
      "longname": "Pattern#splitQueries",
      "description": "<p>Returns a new pattern, with queries split at cycle boundaries. This makes\nsome calculations easier to express, as all haps are then constrained to\nhappen within a cycle.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withQuerySpan",
      "longname": "Pattern#withQuerySpan",
      "description": "<p>Returns a new pattern, where the given function is applied to the query\ntimespan before passing it to the original pattern.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>the function to apply</p>",
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withQueryTime",
      "longname": "Pattern#withQueryTime",
      "description": "<p>As with <code>withQuerySpan</code>, but the function is applied to both the\nbegin and end time of the query timespan.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>the function to apply</p>",
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withHapSpan",
      "longname": "Pattern#withHapSpan",
      "description": "<p>Similar to <code>withQuerySpan</code>, but the function is applied to the timespans\nof all haps returned by pattern queries (both <code>part</code> timespans, and where\npresent, <code>whole</code> timespans).</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withHapTime",
      "longname": "Pattern#withHapTime",
      "description": "<p>As with <code>withHapSpan</code>, but the function is applied to both the\nbegin and end time of the hap timespans.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>the function to apply</p>",
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withHaps",
      "longname": "Pattern#withHaps",
      "description": "<p>Returns a new pattern with the given function applied to the list of haps returned by every query.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withHap",
      "longname": "Pattern#withHap",
      "description": "<p>As with <code>withHaps</code>, but applies the function to every hap, rather than every list of haps.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "setContext",
      "longname": "Pattern#setContext",
      "description": "<p>Returns a new pattern with the context field set to every hap set to the given value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "context"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withContext",
      "longname": "Pattern#withContext",
      "description": "<p>Returns a new pattern with the given function applied to the context field of every hap.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "func"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "stripContext",
      "longname": "Pattern#stripContext",
      "description": "<p>Returns a new pattern with the context field of every hap set to an empty object.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "withLoc",
      "longname": "Pattern#withLoc",
      "description": "<p>Returns a new pattern with the given location information added to the\ncontext of every hap.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Number"
            ]
          },
          "description": "<p>start offset</p>",
          "name": "start"
        },
        {
          "type": {
            "names": [
              "Number"
            ]
          },
          "description": "<p>end offset</p>",
          "name": "end"
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "filterHaps",
      "longname": "Pattern#filterHaps",
      "description": "<p>Returns a new Pattern, which only returns haps that meet the given test.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>a function which returns false for haps to be removed from the pattern</p>",
          "name": "hap_test"
        }
      ],
      "examples": [
        "s(\"bd*8\").velocity(rand).filterHaps((h) => (h.whole.begin % 1) < h.value.velocity)"
      ],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "filterValues",
      "longname": "Pattern#filterValues",
      "description": "<p>As with <code>filterHaps</code>, but the function is applied to values\ninside haps.</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "value_test"
        }
      ],
      "examples": [
        "const drums = s(\"bd sd bd sd\")\nkick: drums.filterValues((v) => v.s === 'bd').duck(2)\nsnare: drums.filterValues((v) => v.s === 'sd')\nbass: s(\"saw!4\").note(\"G#1\").lpf(80).lpenv(4).orbit(2)"
      ],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "removeUndefineds",
      "longname": "Pattern#removeUndefineds",
      "description": "<p>Returns a new pattern, with haps containing undefined values removed from\nquery results.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "onsetsOnly",
      "longname": "Pattern#onsetsOnly",
      "description": "<p>Returns a new pattern, with all haps without onsets filtered out. A hap\nwith an onset is one with a <code>whole</code> timespan that begins at the same time\nas its <code>part</code> timespan.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "discreteOnly",
      "longname": "Pattern#discreteOnly",
      "description": "<p>Returns a new pattern, with 'continuous' haps (those without 'whole'\ntimespans) removed from query results.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "defragmentHaps",
      "longname": "Pattern#defragmentHaps",
      "description": "<p>Combines adjacent haps with the same value and whole.  Only\nintended for use in tests.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "firstCycle",
      "longname": "Pattern#firstCycle",
      "description": "<p>Queries the pattern for the first cycle, returning Haps. Mainly of use when\ndebugging a pattern.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Boolean"
            ]
          },
          "description": "<p>set to true, otherwise the context field\nwill be stripped from the resulting haps.</p>",
          "name": "with_context",
          "defaultvalue": false
        }
      ],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "firstCycleValues",
      "longname": "Pattern#firstCycleValues",
      "description": "<p>Accessor for a list of values returned by querying the first cycle.</p>",
      "params": [],
      "kind": "member",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "showFirstCycle",
      "longname": "Pattern#showFirstCycle",
      "description": "<p>More human-readable version of the <code>firstCycleValues</code> accessor.</p>",
      "params": [],
      "kind": "member",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "sortHapsByPart",
      "longname": "Pattern#sortHapsByPart",
      "description": "<p>Returns a new pattern, which returns haps sorted in temporal order. Mainly\nof use when comparing two patterns for equality, in tests.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "asNumber",
      "longname": "Pattern#asNumber",
      "description": "<p>Returns a new pattern with all values parsed as numerals.</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "layer",
      "longname": "Pattern.layer",
      "description": "<p>Layers the result of the given function(s). Like <code>superimpose</code>, but without the original pattern:</p>",
      "examples": [
        "\"<0 2 4 6 ~ 4 ~ 2 0!3 ~!5>*8\"\n  .layer(x=>x.add(\"0,2\"))\n  .scale('C minor').note()"
      ],
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "superimpose",
      "longname": "Pattern.superimpose",
      "description": "<p>Superimposes the result of the given function(s) on top of the original pattern:</p>",
      "examples": [
        "\"<0 2 4 6 ~ 4 ~ 2 0!3 ~!5>*8\"\n  .superimpose(x=>x.add(2))\n  .scale('C minor').note()"
      ],
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "log",
      "longname": "Pattern.log",
      "description": "<p>Writes the content of the current event to the console (visible in the side menu).</p>",
      "examples": [
        "s(\"bd sd\").log()"
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "logValues",
      "longname": "Pattern.logValues",
      "description": "<p>A simplified version of <code>log</code> which writes all &quot;values&quot; (various configurable parameters)\nwithin the event to the console (visible in the side menu).</p>",
      "examples": [
        "s(\"bd sd\").gain(\"0.25 0.5 1\").n(\"2 1 0\").logValues()"
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "into",
      "longname": "Pattern.into",
      "description": "<p>Breaks a pattern into pieces according to the structure of a given pattern.\nTrue values in the given pattern cause the corresponding subcycle of the\nsource pattern to be looped, and for an (optional) given function to be\napplied. False values result in the corresponding part of the source pattern\nto be played unchanged.</p>",
      "examples": [
        "sound(\"bd sd ht lt\").into(\"1 0\", hurry(2))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "arpWith",
      "longname": "arpWith",
      "description": "<p>Selects indices in in stacked notes.</p>",
      "examples": [
        "note(\"<[c,eb,g]!2 [c,f,ab] [d,f,ab]>\")\n.arpWith(haps => haps[2])"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "arp",
      "longname": "arp",
      "description": "<p>Selects indices in in stacked notes.</p>",
      "examples": [
        "note(\"<[c,eb,g]!2 [c,f,ab] [d,f,ab]>\")\n.arp(\"0 [0,2] 1 [0,2]\")"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "set",
      "longname": "Pattern.set",
      "description": "<p>When called on a pattern <code>a</code>, with a input pattern <code>b</code> (<code>a.set(b)</code>),\ncombines <code>a</code> and <code>b</code> such that anything defined in <code>b</code>\nand anything defined in <code>a</code> that is <em>not</em> defined in <code>b</code>\nwill be in the resulting pattern.</p>\n<p>The structure is maintained from <code>a</code>,\nbecause the default pattern alignment is <code>in</code>,\nsee the section on <code>Pattern Alignment</code>\nin the technical manual in the docs</p>\n<p>This is the inverse of <code>keep</code></p>\n<p>See examples below</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        }
      ],
      "examples": [
        "// because input pattern has `s` set,\n// it overrides the \"sine\" declared earlier\nnote(\"c a f e\").s(\"sine\").set(s(\"triangle\"))"
      ],
      "kind": "member",
      "tags": [
        "internal",
        "combiners"
      ]
    },
    {
      "name": "keep",
      "longname": "Pattern.keep",
      "description": "<p>When called on a pattern <code>a</code>, with a input pattern <code>b</code> (<code>a.keep(b)</code>),\ncombines <code>a</code> and <code>b</code> such that anything defined in <code>a</code>,\nand anything defined in <code>b</code> that is <em>not</em> defined in <code>a</code>\nwill be in the resulting pattern</p>\n<p>The structure is maintained from <code>a</code>,\nbecause the default pattern alignment is <code>in</code>,\nsee the section on <code>Pattern Alignment</code>\nin the technical manual in the docs</p>\n<p>This is the inverse of <code>set</code></p>\n<p>See examples below</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        }
      ],
      "examples": [
        "// notes, already defined, will stay \"c a f e\",\n// while \"s\", not defined, will be set to \"piano\"\nnote(\"c a f e\").keep(note(\"e f a c\").s(\"piano\"))"
      ],
      "kind": "member",
      "tags": [
        "internal",
        "combiners"
      ]
    },
    {
      "name": "add",
      "longname": "Pattern.add",
      "description": "<p>Assumes a pattern of numbers. Adds the given number to each item in the pattern.</p>",
      "examples": [
        "// Here, the triad 0, 2, 4 is shifted by different amounts\nn(\"0 2 4\".add(\"<0 3 4 0>\")).scale(\"C:major\")\n// Without add, the equivalent would be:\n// n(\"<[0 2 4] [3 5 7] [4 6 8] [0 2 4]>\").scale(\"C:major\")",
        "// You can also use add with notes:\nnote(\"c3 e3 g3\".add(\"<0 5 7 0>\"))\n// Behind the scenes, the notes are converted to midi numbers:\n// note(\"48 52 55\".add(\"<0 5 7 0>\"))"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "sub",
      "longname": "Pattern.sub",
      "description": "<p>Like add, but the given numbers are subtracted.</p>",
      "examples": [
        "n(\"0 2 4\".sub(\"<0 1 2 3>\")).scale(\"C4:minor\")\n// See add for more information."
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "mul",
      "longname": "Pattern.mul",
      "description": "<p>Multiplies each number by the given factor.</p>",
      "examples": [
        "\"<1 1.5 [1.66, <2 2.33>]>*4\".mul(150).freq()"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "div",
      "longname": "Pattern.div",
      "description": "<p>Divides each number by the given factor.</p>",
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "struct",
      "longname": "Pattern#struct",
      "description": "<p>Applies the given structure to the pattern:</p>",
      "examples": [
        "note(\"c,eb,g\")\n  .struct(\"x ~ x ~ ~ x ~ x ~ ~ ~ x ~ x ~ ~\")\n  .slow(2)"
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "mask",
      "longname": "Pattern#mask",
      "description": "<p>Returns silence when mask is 0 or &quot;~&quot;</p>",
      "examples": [
        "note(\"c [eb,g] d [eb,g]\").mask(\"<1 [0 1]>\")"
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "reset",
      "longname": "Pattern#reset",
      "description": "<p>Resets the pattern to the start of the cycle for each onset of the reset pattern.</p>",
      "examples": [
        "s(\"[<bd lt> sd]*2, hh*8\").reset(\"<x@3 x(5,8)>\")"
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "restart",
      "longname": "Pattern#restart",
      "description": "<p>Restarts the pattern for each onset of the restart pattern.\nWhile reset will only reset the current cycle, restart will start from cycle 0.</p>",
      "examples": [
        "s(\"[<bd lt> sd]*2, hh*8\").restart(\"<x@3 x(5,8)>\")"
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "setDefaultJoin",
      "longname": "setDefaultJoin",
      "description": "<p>Sets the default method of combining events from two patterns (aka <a href=\"https://strudel.cc/technical-manual/alignment/\">alignment</a>) in Strudel.\nThe default method is 'in', meaning that patterns to the left will (typically) dictate the event timings when combined with patterns to the right.\nBy changing alignment to 'out', the opposite will happen. With 'mix', they will combine their event timings.</p>\n<p>Note that we say the <em>default</em> method, because alignments can also be set explicitly with calls like\n'add.mix', 'set.squeeze', etc.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>Default join method to use. Options: 'in', 'out', 'mix', 'squeeze', 'squeezeout', 'reset', 'restart', 'poly'</p>",
          "name": "method"
        }
      ],
      "examples": [
        "setDefaultJoin('mix') // also try 'in', 'out', 'squeeze', etc.\ns(\"saw\").vel(\"1 0.5\").note(\"F A C E\").delay(\"0 0.2 0.3\")"
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "gap",
      "longname": "gap",
      "description": "<p>Does absolutely nothing, but with a given metrical 'steps'</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "steps"
        }
      ],
      "examples": [
        "gap(3) // \"~@3\""
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "silence",
      "longname": "silence",
      "description": "<p>Does absolutely nothing..</p>",
      "examples": [
        "silence // \"~\""
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "pure",
      "longname": "pure",
      "description": "<p>A discrete value that repeats once per cycle.</p>",
      "examples": [
        "pure('e4') // \"e4\""
      ],
      "kind": "function",
      "tags": [
        "generators",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "sequenceP",
      "longname": "sequenceP",
      "description": "<p>Takes a list of patterns, and returns a pattern of lists.</p>",
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "stack",
      "longname": "stack",
      "description": "<p>The given items are played at the same time at the same length.</p>",
      "examples": [
        "stack(\"g3\", \"b3\", [\"e4\", \"d4\"]).note()\n// \"g3,b3,[e4 d4]\".note()",
        "// As a chained function:\ns(\"hh*4\").stack(\n  note(\"c4(5,8)\")\n)"
      ],
      "synonyms": [
        "polyrhythm",
        "pr"
      ],
      "synonyms_text": "polyrhythm, pr",
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "slowcat",
      "longname": "slowcat",
      "description": "<p>Concatenation: combines a list of patterns, switching between them successively, one per cycle.</p>",
      "examples": [
        "slowcat(\"e5\", \"b4\", [\"d5\", \"c5\"])"
      ],
      "synonyms": [
        "cat"
      ],
      "synonyms_text": "cat",
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "slowcatPrime",
      "longname": "slowcatPrime",
      "description": "<p>Concatenation: combines a list of patterns, switching between them successively, one per cycle. Unlike slowcat, this version will skip cycles.</p>",
      "params": [
        {
          "type": {
            "names": [
              "any"
            ]
          },
          "variable": true,
          "description": "<p>The items to concatenate</p>",
          "name": "items"
        }
      ],
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "cat",
      "longname": "cat",
      "description": "<p>The given items are con<strong>cat</strong>enated, where each one takes one cycle.</p>",
      "params": [
        {
          "type": {
            "names": [
              "any"
            ]
          },
          "variable": true,
          "description": "<p>The items to concatenate</p>",
          "name": "items"
        }
      ],
      "examples": [
        "cat(\"e5\", \"b4\", [\"d5\", \"c5\"]).note()\n// \"<e5 b4 [d5 c5]>\".note()",
        "// As a chained function:\ns(\"hh*4\").cat(\n   note(\"c4(5,8)\")\n)"
      ],
      "synonyms": [
        "slowcat"
      ],
      "synonyms_text": "slowcat",
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "arrange",
      "longname": "arrange",
      "description": "<p>Allows to arrange multiple patterns together over multiple cycles.\nTakes a variable number of arrays with two elements specifying the number of cycles and the pattern to use.</p>",
      "examples": [
        "arrange(\n  [4, \"<c a f e>(3,8)\"],\n  [2, \"<g a>(5,8)\"]\n).note()"
      ],
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "seqPLoop",
      "longname": "seqPLoop",
      "description": "<p>Similarly to <code>arrange</code>, allows you to arrange multiple patterns together over multiple cycles.\nUnlike <code>arrange</code>, you specify a start and stop time for each pattern rather than duration, which\nmeans that patterns can overlap.</p>",
      "examples": [
        "seqPLoop(\n  [0, 2, \"bd(3,8)\"],\n  [1, 3, \"cp(3,8)\"]\n).sound()"
      ],
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "sequence",
      "longname": "sequence",
      "description": "<p>See <code>fastcat</code></p>",
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "seq",
      "longname": "seq",
      "description": "<p>Like <strong>cat</strong>, but the items are crammed into one cycle.</p>",
      "examples": [
        "seq(\"e5\", \"b4\", [\"d5\", \"c5\"]).note()\n// \"e5 b4 [d5 c5]\".note()",
        "// As a chained function:\ns(\"hh*4\").seq(\n  note(\"c4(5,8)\")\n)"
      ],
      "synonyms": [
        "fastcat"
      ],
      "synonyms_text": "fastcat",
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "register",
      "longname": "register",
      "description": "<p>Registers a new pattern method. The method is added to the Pattern class + the standalone function is returned from register.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Array.<string>"
            ]
          },
          "description": "<p>name of the function, or an array of names to be used as synonyms</p>",
          "name": "name"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function with 1 or more params, where last is the current pattern</p>",
          "name": "func"
        },
        {
          "type": {
            "names": [
              "bool"
            ]
          },
          "description": "<p>defaults to true; if set to false, you will have more control over the arguments to <code>func</code> as they will be\nin their raw form and it will be up to you to patternify them and/or query them for values</p>",
          "name": "patternify"
        }
      ],
      "examples": [
        "const vlpf = register('vlpf', (freq, pat) => {\n  return pat.fmap((v) => ({...v, cutoff: freq * (v.velocity ?? 1) }));\n})\ns(\"saw\").seg(8).velocity(rand).vlpf(800)"
      ],
      "kind": "function",
      "tags": [
        "functional"
      ]
    },
    {
      "name": "round",
      "longname": "Pattern.round",
      "description": "<p>Assumes a numerical pattern. Returns a new pattern with all values rounded\nto the nearest integer.</p>",
      "examples": [
        "n(\"0.5 1.5 2.5\".round()).scale(\"C:major\")"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "floor",
      "longname": "Pattern.floor",
      "description": "<p>Assumes a numerical pattern. Returns a new pattern with all values set to\ntheir mathematical floor. E.g. <code>3.7</code> replaced with to <code>3</code>, and <code>-4.2</code>\nreplaced with <code>-5</code>.</p>",
      "examples": [
        "note(\"42 42.1 42.5 43\".floor())"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "ceil",
      "longname": "Pattern.ceil",
      "description": "<p>Assumes a numerical pattern. Returns a new pattern with all values set to\ntheir mathematical ceiling. E.g. <code>3.2</code> replaced with <code>4</code>, and <code>-4.2</code>\nreplaced with <code>-4</code>.</p>",
      "examples": [
        "note(\"42 42.1 42.5 43\".ceil())"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "toBipolar",
      "longname": "toBipolar",
      "description": "<p>Assumes a numerical pattern, containing unipolar values in the range 0 ..</p>\n<ol>\n<li>Returns a new pattern with values scaled to the bipolar range -1 .. 1</li>\n</ol>",
      "kind": "constant",
      "tags": [
        "math",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "fromBipolar",
      "longname": "fromBipolar",
      "description": "<p>Assumes a numerical pattern, containing bipolar values in the range -1 .. 1\nReturns a new pattern with values scaled to the unipolar range 0 .. 1</p>",
      "kind": "constant",
      "tags": [
        "math",
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "range",
      "longname": "Pattern.range",
      "description": "<p>Assumes a numerical pattern, containing unipolar values in the range 0 .. 1.\nReturns a new pattern with values scaled to the given min/max range.\nMost useful in combination with continuous patterns.</p>",
      "examples": [
        "s(\"[bd sd]*2,hh*8\")\n.cutoff(sine.range(500,4000))"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "rangex",
      "longname": "Pattern.rangex",
      "description": "<p>Assumes a numerical pattern, containing unipolar values in the range 0 .. 1\nReturns a new pattern with values scaled to the given min/max range,\nfollowing an exponential curve.</p>",
      "examples": [
        "s(\"[bd sd]*2,hh*8\")\n.cutoff(sine.rangex(500,4000))"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "range2",
      "longname": "Pattern.range2",
      "description": "<p>Assumes a numerical pattern, containing bipolar values in the range -1 .. 1\nReturns a new pattern with values scaled to the given min/max range.</p>",
      "examples": [
        "s(\"[bd sd]*2,hh*8\")\n.cutoff(sine2.range2(500,4000))"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "ratio",
      "longname": "Pattern.ratio",
      "description": "<p>Allows dividing numbers via list notation using &quot;:&quot;.\nReturns a new pattern with just numbers.</p>",
      "examples": [
        "ratio(\"1, 5:4, 3:2\").mul(110)\n.freq().s(\"piano\")"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "compress",
      "longname": "compress",
      "description": "<p>Compress each cycle into the given timespan, leaving a gap</p>",
      "examples": [
        "cat(\n  s(\"bd sd\").compress(.25,.75),\n  s(\"~ bd sd ~\")\n)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "fastGap",
      "longname": "fastGap",
      "description": "<p>speeds up a pattern like fast, but rather than it playing multiple times as fast would it instead leaves a gap in the remaining space of the cycle. For example, the following will play the sound pattern &quot;bd sn&quot; only once but compressed into the first half of the cycle, i.e. twice as fast.</p>",
      "examples": [
        "s(\"bd sd\").fastGap(2)"
      ],
      "synonyms": [
        "fastgap"
      ],
      "synonyms_text": "fastgap",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "focus",
      "longname": "focus",
      "description": "<p>Similar to <code>compress</code>, but doesn't leave gaps, and the 'focus' can be bigger than a cycle</p>",
      "examples": [
        "s(\"bd hh sd hh\").focus(1/4, 3/4)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "ply",
      "longname": "ply",
      "description": "<p>The ply function repeats each event the given number of times.</p>",
      "examples": [
        "s(\"bd ~ sd cp\").ply(\"<1 2 3>\")"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "fast",
      "longname": "Pattern.fast",
      "description": "<p>Speed up a pattern by the given factor. Used by &quot;*&quot; in mini notation.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>speed up factor</p>",
          "name": "factor"
        }
      ],
      "examples": [
        "s(\"bd hh sd hh\").fast(2) // s(\"[bd hh sd hh]*2\")"
      ],
      "synonyms": [
        "density"
      ],
      "synonyms_text": "density",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "hurry",
      "longname": "hurry",
      "description": "<p>Both speeds up the pattern (like 'fast') and the sample playback (like 'speed').</p>",
      "examples": [
        "s(\"bd sd:2\").hurry(\"<1 2 4 3>\").slow(1.5)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "slow",
      "longname": "Pattern.slow",
      "description": "<p>Slow down a pattern over the given number of cycles. Like the &quot;/&quot; operator in mini notation.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>slow down factor</p>",
          "name": "factor"
        }
      ],
      "examples": [
        "s(\"bd hh sd hh\").slow(2) // s(\"[bd hh sd hh]/2\")"
      ],
      "synonyms": [
        "sparsity"
      ],
      "synonyms_text": "sparsity",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "inside",
      "longname": "inside",
      "description": "<p>Carries out an operation 'inside' a cycle.</p>",
      "examples": [
        "\"0 1 2 3 4 3 2 1\".inside(4, rev).scale('C major').note()\n// \"0 1 2 3 4 3 2 1\".slow(4).rev().fast(4).scale('C major').note()"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "outside",
      "longname": "outside",
      "description": "<p>Carries out an operation 'outside' a cycle.</p>",
      "examples": [
        "\"<[0 1] 2 [3 4] 5>\".outside(4, rev).scale('C major').note()\n// \"<[0 1] 2 [3 4] 5>\".fast(4).rev().slow(4).scale('C major').note()"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "lastOf",
      "longname": "Pattern.lastOf",
      "description": "<p>Applies the given function every n cycles, starting from the last cycle.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many cycles</p>",
          "name": "n"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply</p>",
          "name": "func"
        }
      ],
      "examples": [
        "note(\"c3 d3 e3 g3\").lastOf(4, x=>x.rev())"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "firstOf",
      "longname": "Pattern.firstOf",
      "description": "<p>Applies the given function every n cycles, starting from the first cycle.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many cycles</p>",
          "name": "n"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply</p>",
          "name": "func"
        }
      ],
      "examples": [
        "note(\"c3 d3 e3 g3\").firstOf(4, x=>x.rev())"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "every",
      "longname": "Pattern.every",
      "description": "<p>An alias for <code>firstOf</code></p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many cycles</p>",
          "name": "n"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply</p>",
          "name": "func"
        }
      ],
      "examples": [
        "note(\"c3 d3 e3 g3\").every(4, x=>x.rev())"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "apply",
      "longname": "apply",
      "description": "<p>Applies the given function to the pattern. Like layer, but with a single function:</p>",
      "examples": [
        "\"<c3 eb3 g3>\".scale('C minor').apply(scaleTranspose(\"0,2,4\")).note()"
      ],
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "cpm",
      "longname": "cpm",
      "description": "<p>Plays the pattern at the given cycles per minute.</p>",
      "examples": [
        "s(\"<bd sd>,hh*2\").cpm(90) // = 90 bpm"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "early",
      "longname": "Pattern.early",
      "description": "<p>Nudge a pattern to start earlier in time. Equivalent of Tidal's &lt;~ operator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>number of cycles to nudge left</p>",
          "name": "cycles"
        }
      ],
      "examples": [
        "\"bd ~\".stack(\"hh ~\".early(.1)).s()"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "late",
      "longname": "Pattern.late",
      "description": "<p>Nudge a pattern to start later in time. Equivalent of Tidal's ~&gt; operator</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>number of cycles to nudge right</p>",
          "name": "cycles"
        }
      ],
      "examples": [
        "\"bd ~\".stack(\"hh ~\".late(.1)).s()"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "zoom",
      "longname": "zoom",
      "description": "<p>Plays a portion of a pattern, specified by the beginning and end of a time span. The new resulting pattern is played over the time period of the original pattern:</p>",
      "examples": [
        "s(\"bd*2 hh*3 [sd bd]*2 perc\").zoom(0.25, 0.75)\n// s(\"hh*3 [sd bd]*2\") // equivalent"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "bite",
      "longname": "bite",
      "description": "<p>Splits a pattern into the given number of slices, and plays them according to a pattern of slice numbers.\nSimilar to <code>slice</code>, but slices up patterns rather than sound samples.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>of slices</p>",
          "name": "number"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>to play</p>",
          "name": "slices"
        }
      ],
      "examples": [
        "note(\"0 1 2 3 4 5 6 7\".scale('c:mixolydian'))\n.bite(4, \"3 2 1 0\")",
        "sound(\"bd - bd bd*2, - sd:6 - sd:5 sd:1 - [- sd:2] -, hh [- cp:7]\")\n  .bank(\"RolandTR909\").speed(1.2)\n  .bite(4, \"0 0 [1 2] <3 2> 0 0 [2 1] 3\")"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "linger",
      "longname": "linger",
      "description": "<p>Selects the given fraction of the pattern and repeats that part to fill the remainder of the cycle.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>fraction to select</p>",
          "name": "fraction"
        }
      ],
      "examples": [
        "s(\"lt ht mt cp, [hh oh]*2\").linger(\"<1 .5 .25 .125>\")"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "segment",
      "longname": "segment",
      "description": "<p>Samples the pattern at a rate of n events per cycle. Useful for turning a continuous pattern into a discrete one.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>number of segments per cycle</p>",
          "name": "segments"
        }
      ],
      "examples": [
        "note(saw.range(40,52).segment(24))"
      ],
      "synonyms": [
        "seg"
      ],
      "synonyms_text": "seg",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "swingBy",
      "longname": "swingBy",
      "description": "<p>The function <code>swingBy x n</code> breaks each cycle into <code>n</code> slices, and then delays events in the second half of each slice by the amount <code>x</code>, which is relative to the size of the (half) slice. So if <code>x</code> is 0 it does nothing, <code>0.5</code> delays for half the note duration, and 1 will wrap around to doing nothing again. The end result is a shuffle or swing-like rhythm</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "subdivision"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "offset"
        }
      ],
      "examples": [
        "s(\"hh*8\").swingBy(1/3, 4)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "swing",
      "longname": "swing",
      "description": "<p>Shorthand for swingBy with 1/3:</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "subdivision"
        }
      ],
      "examples": [
        "s(\"hh*8\").swing(4)\n// s(\"hh*8\").swingBy(1/3, 4)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "invert",
      "longname": "invert",
      "description": "<p>Swaps 1s and 0s in a binary pattern.</p>",
      "examples": [
        "s(\"bd\").struct(\"1 0 0 1 0 0 1 0\".lastOf(4, invert))"
      ],
      "synonyms": [
        "inv"
      ],
      "synonyms_text": "inv",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "when",
      "longname": "Pattern.when",
      "description": "<p>Applies the given function whenever the given pattern is in a true state.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "binary_pat"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "name": "func"
        }
      ],
      "examples": [
        "\"c3 eb3 g3\".when(\"<0 1>/2\", x=>x.sub(\"5\")).note()"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "off",
      "longname": "Pattern.off",
      "description": "<p>Superimposes the function result on top of the original pattern, delayed by the given time.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern",
              "number"
            ]
          },
          "description": "<p>offset time</p>",
          "name": "time"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply</p>",
          "name": "func"
        }
      ],
      "examples": [
        "\"c3 eb3 g3\".off(1/8, x=>x.add(7)).note()"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "brak",
      "longname": "brak",
      "description": "<p>Returns a new pattern where every other cycle is played once, twice as\nfast, and offset in time by one quarter of a cycle. Creates a kind of\nbreakbeat feel.</p>",
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "rev",
      "longname": "Pattern.rev",
      "description": "<p>Reverse all cycles in a pattern. See also <code>revv</code> for reversing a whole pattern.</p>",
      "examples": [
        "note(\"c d e g\").rev()"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "revv",
      "longname": "Pattern.revv",
      "description": "<p>Reverse a whole pattern. See also <code>rev</code> for reversing each cycle.</p>",
      "examples": [
        "// This is the same as `<[g e] [d c]>`. If `rev()` is used, you get\n// the same as `<[d c] [g e]>`, where each cycle reverses, but the order of\n// cycles stays the same.\nnote(\"<[c d] [e g]>\").revv()"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "pressBy",
      "longname": "pressBy",
      "description": "<p>Like press, but allows you to specify the amount by which each\nevent is shifted. pressBy(0.5) is the same as press, while\npressBy(1/3) shifts each event by a third of its timespan.</p>",
      "examples": [
        "stack(s(\"hh*4\"),\n      s(\"bd mt sd ht\").pressBy(\"<0 0.5 0.25>\")\n     ).slow(2)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "press",
      "longname": "press",
      "description": "<p>Syncopates a rhythm, by shifting each event halfway into its timespan.</p>",
      "examples": [
        "stack(s(\"hh*4\"),\n      s(\"bd mt sd ht\").every(4, press)\n     ).slow(2)"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "hush",
      "longname": "Pattern#hush",
      "description": "<p>Silences a pattern.</p>",
      "examples": [
        "stack(\n  s(\"bd\").hush(),\n  s(\"hh*3\")\n)"
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "palindrome",
      "longname": "palindrome",
      "description": "<p>Applies <code>rev</code> to a pattern every other cycle, so that the pattern alternates between forwards and backwards.</p>",
      "examples": [
        "note(\"c d e g\").palindrome()"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "juxBy",
      "longname": "juxBy",
      "description": "<p>Jux with adjustable stereo width. 0 = mono, 1 = full stereo.</p>",
      "examples": [
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").juxBy(\"<0 .5 1>/2\", rev)"
      ],
      "synonyms": [
        "juxby"
      ],
      "synonyms_text": "juxby",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "juxFlipBy",
      "longname": "juxFlipBy",
      "description": "<p>Like juxBy, except it flips the ears each cycle.</p>",
      "examples": [
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").juxFlipBy(\".8\", rev)"
      ],
      "synonyms": [
        "juxflipby",
        "fluxBy",
        "fluxby"
      ],
      "synonyms_text": "juxflipby, fluxBy, fluxby",
      "kind": "member"
    },
    {
      "name": "jux",
      "longname": "jux",
      "description": "<p>The jux function creates strange stereo effects, by applying a function to a pattern, but only in the right-hand channel.</p>",
      "examples": [
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").jux(rev)",
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").jux(press)",
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").jux(iter(4))"
      ],
      "kind": "constant",
      "tags": [
        "temporal",
        "superdough"
      ]
    },
    {
      "name": "juxFlip",
      "longname": "juxFlip",
      "description": "<p>Like jux, but flips the ears each cycle.</p>",
      "examples": [
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").juxFlip(rev)",
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").juxFlip(press)",
        "s(\"bd lt [~ ht] mt cp ~ bd hh\").juxFlip(iter(4))"
      ],
      "synonyms": [
        "juxflip",
        "flux"
      ],
      "synonyms_text": "juxflip, flux",
      "kind": "member"
    },
    {
      "name": "echoWith",
      "longname": "echoWith",
      "description": "<p>Superimpose and offset multiple times, applying the given function each time.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many times to repeat</p>",
          "name": "times"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>cycle offset between iterations</p>",
          "name": "time"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply, given the pattern and the iteration index</p>",
          "name": "func"
        }
      ],
      "examples": [
        "\"<0 [2 4]>\"\n.echoWith(4, 1/8, (p,n) => p.add(n*2))\n.scale(\"C:minor\").note()"
      ],
      "synonyms": [
        "echowith",
        "stutWith",
        "stutwith"
      ],
      "synonyms_text": "echowith, stutWith, stutwith",
      "kind": "member",
      "tags": [
        "temporal",
        "functional"
      ]
    },
    {
      "name": "echo",
      "longname": "Pattern.echo",
      "description": "<p>Superimpose and offset multiple times, gradually decreasing the velocity</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many times to repeat</p>",
          "name": "times"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>cycle offset between iterations</p>",
          "name": "time"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>velocity multiplicator for each iteration</p>",
          "name": "feedback"
        }
      ],
      "examples": [
        "s(\"bd sd\").echo(3, 1/6, .8)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "stut",
      "longname": "stut",
      "description": "<p>Deprecated. Like echo, but the last 2 parameters are flipped.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many times to repeat</p>",
          "name": "times"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>velocity multiplicator for each iteration</p>",
          "name": "feedback"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>cycle offset between iterations</p>",
          "name": "time"
        }
      ],
      "examples": [
        "s(\"bd sd\").stut(3, .8, 1/6)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "plyWith",
      "longname": "plyWith",
      "description": "<p>The plyWith function repeats each event the given number of times, applying the given function to each event.\\n</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many times to repeat</p>",
          "name": "factor"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply, given the pattern</p>",
          "name": "func"
        }
      ],
      "examples": [
        "\"<0 [2 4]>\"\n.plyWith(4, (p) => p.add(2))\n.scale(\"C:minor\").note()"
      ],
      "synonyms": [
        "plywith"
      ],
      "synonyms_text": "plywith",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "plyForEach",
      "longname": "plyForEach",
      "description": "<p>The plyForEach function repeats each event the given number of times, applying the given function to each event.\nThis version of ply uses the iteration index as an argument to the function, similar to echoWith.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>how many times to repeat</p>",
          "name": "factor"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to apply, given the pattern and the iteration index</p>",
          "name": "func"
        }
      ],
      "examples": [
        "\"<0 [2 4]>\"\n.plyForEach(4, (p,n) => p.add(n*2))\n.scale(\"C:minor\").note()"
      ],
      "synonyms": [
        "plyforeach"
      ],
      "synonyms_text": "plyforeach",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "iter",
      "longname": "Pattern.iter",
      "description": "<p>Divides a pattern into a given number of subdivisions, plays the subdivisions in order, but increments the starting subdivision each cycle. The pattern wraps to the first subdivision after the last subdivision is played.</p>",
      "examples": [
        "note(\"0 1 2 3\".scale('A minor')).iter(4)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "iterBack",
      "longname": "Pattern.iterBack",
      "description": "<p>Like <code>iter</code>, but plays the subdivisions in reverse order. Known as iter' in tidalcycles</p>",
      "examples": [
        "note(\"0 1 2 3\".scale('A minor')).iterBack(4)"
      ],
      "synonyms": [
        "iterback"
      ],
      "synonyms_text": "iterback",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "repeatCycles",
      "longname": "Pattern.repeatCycles",
      "description": "<p>Repeats each cycle the given number of times.</p>",
      "examples": [
        "note(irand(12).add(34)).segment(4).repeatCycles(2).s(\"gm_acoustic_guitar_nylon\")"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "chunk",
      "longname": "Pattern.chunk",
      "description": "<p>Divides a pattern into a given number of parts, then cycles through those parts in turn, applying the given function to each part in turn (one part per cycle).</p>",
      "examples": [
        "\"0 1 2 3\".chunk(4, x=>x.add(7))\n.scale(\"A:minor\").note()"
      ],
      "synonyms": [
        "slowChunk",
        "slowchunk"
      ],
      "synonyms_text": "slowChunk, slowchunk",
      "kind": "member",
      "tags": [
        "temporal",
        "functional"
      ]
    },
    {
      "name": "chunkBack",
      "longname": "Pattern.chunkBack",
      "description": "<p>Like <code>chunk</code>, but cycles through the parts in reverse order. Known as chunk' in tidalcycles</p>",
      "examples": [
        "\"0 1 2 3\".chunkBack(4, x=>x.add(7))\n.scale(\"A:minor\").note()"
      ],
      "synonyms": [
        "chunkback"
      ],
      "synonyms_text": "chunkback",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "fastChunk",
      "longname": "Pattern.fastChunk",
      "description": "<p>Like <code>chunk</code>, but the cycles of the source pattern aren't repeated\nfor each set of chunks.</p>",
      "examples": [
        "\"<0 8> 1 2 3 4 5 6 7\"\n.scale(\"C2:major\").note()\n.fastChunk(4, x => x.color('red')).slow(2)"
      ],
      "synonyms": [
        "fastchunk"
      ],
      "synonyms_text": "fastchunk",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "chunkInto",
      "longname": "Pattern.chunkInto",
      "description": "<p>Like <code>chunk</code>, but the function is applied to a looped subcycle of the source pattern.</p>",
      "examples": [
        "sound(\"bd sd ht lt bd - cp lt\").chunkInto(4, hurry(2))\n  .bank(\"tr909\")"
      ],
      "synonyms": [
        "chunkinto"
      ],
      "synonyms_text": "chunkinto",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "chunkBackInto",
      "longname": "Pattern.chunkBackInto",
      "description": "<p>Like <code>chunkInto</code>, but moves backwards through the chunks.</p>",
      "examples": [
        "sound(\"bd sd ht lt bd - cp lt\").chunkInto(4, hurry(2))\n  .bank(\"tr909\")"
      ],
      "synonyms": [
        "chunkbackinto"
      ],
      "synonyms_text": "chunkbackinto",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "ribbon",
      "longname": "ribbon",
      "description": "<p>Loops the pattern inside an <code>offset</code> for <code>cycles</code>.\nIf you think of the entire span of time in cycles as a ribbon, you can cut a single piece and loop it.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>start point of loop in cycles</p>",
          "name": "offset"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>loop length in cycles</p>",
          "name": "cycles"
        }
      ],
      "examples": [
        "note(\"<c d e f>\").ribbon(1, 2)",
        "// Looping a portion of randomness\nn(irand(8).segment(4)).scale(\"c:pentatonic\").ribbon(1337, 2)",
        "// rhythm generator\ns(\"bd!16?\").ribbon(29,.5)"
      ],
      "synonyms": [
        "rib"
      ],
      "synonyms_text": "rib",
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "tag",
      "longname": "tag",
      "description": "<p>Tags each Hap with an identifier. Good for filtering. The function populates Hap.context.tags (Array).</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>anything unique</p>",
          "name": "tag"
        }
      ],
      "examples": [
        "s(\"saw!16\").note(\"F1\")\n  .lpf(tri.range(40, 80).slow(4)).lpenv(5).lpq(4).lpd(0.15)\n  .when(rand.late(0.1).gte(0.5), x => x.transpose(\"12\").tag('altered'))\n  .when(rand.late(0.2).gte(0.5), x => x.s(\"square\").tag('altered'))\n  .when(\"<0 1>\", x => x.filter((hap) => hap.hasTag('altered')))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "filter",
      "longname": "filter",
      "description": "<p>Filters haps using the given function</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to test Hap</p>",
          "name": "test"
        }
      ],
      "examples": [
        "s(\"hh!7 oh\").filter(hap => hap.value.s === 'hh')"
      ],
      "kind": "member",
      "tags": [
        "temporal",
        "functional"
      ]
    },
    {
      "name": "filterWhen",
      "longname": "filterWhen",
      "description": "<p>Filters haps by their begin time</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to test Hap.whole.begin</p>",
          "name": "test"
        }
      ],
      "examples": [
        "oneCycle: s(\"bd*4\").filterWhen((t) => t < 1)"
      ],
      "kind": "member",
      "tags": [
        "temporal",
        "functional"
      ]
    },
    {
      "name": "within",
      "longname": "within",
      "description": "<p>Use within to apply a function to only a part of a pattern.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>start within cycle (0 - 1)</p>",
          "name": "start"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>end within cycle (0 - 1). Must be &gt; start</p>",
          "name": "end"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>function to be applied to the sub-pattern</p>",
          "name": "func"
        }
      ],
      "kind": "member",
      "tags": [
        "temporal",
        "functional"
      ]
    },
    {
      "name": "pace",
      "longname": "pace",
      "description": "<p><em>Experimental</em></p>\n<p>Speeds a pattern up or down, to fit to the given number of steps per cycle.</p>",
      "examples": [
        "sound(\"bd sd cp\").pace(4)\n// The same as sound(\"{bd sd cp}%4\") or sound(\"<bd sd cp>*4\")"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "polymeter",
      "longname": "polymeter",
      "description": "<p><em>Experimental</em></p>\n<p>Aligns the steps of the patterns, creating polymeters. The patterns are repeated until they all fit the cycle. For example, in the below the first pattern is repeated twice, and the second is repeated three times, to fit the lowest common multiple of six steps.</p>",
      "examples": [
        "// The same as note(\"{c eb g, c2 g2}%6\")\npolymeter(\"c eb g\", \"c2 g2\").note()"
      ],
      "synonyms": [
        "pm"
      ],
      "synonyms_text": "pm",
      "kind": "function",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "stepcat",
      "longname": "stepcat",
      "description": "<p>'Concatenates' patterns like <code>fastcat</code>, but proportional to a number of steps per cycle.\nThe steps can either be inferred from the pattern, or provided as a [length, pattern] pair.\nHas the alias <code>timecat</code>.</p>",
      "examples": [
        "stepcat([3,\"e3\"],[1, \"g3\"]).note()\n// the same as \"e3@3 g3\".note()",
        "stepcat(\"bd sd cp\",\"hh hh\").sound()\n// the same as \"bd sd cp hh hh\".sound()"
      ],
      "synonyms": [
        "timeCat",
        "timecat"
      ],
      "synonyms_text": "timeCat, timecat",
      "kind": "member",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "stepalt",
      "longname": "stepalt",
      "description": "<p><em>Experimental</em></p>\n<p>Concatenates patterns stepwise, according to an inferred 'steps per cycle'.\nSimilar to <code>stepcat</code>, but if an argument is a list, the whole pattern will alternate between the elements in the list.</p>",
      "examples": [
        "stepalt([\"bd cp\", \"mt\"], \"bd\").sound()\n// The same as \"bd cp bd mt bd\".sound()"
      ],
      "kind": "function",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "take",
      "longname": "take",
      "description": "<p><em>Experimental</em></p>\n<p>Takes the given number of steps from a pattern (dropping the rest).\nA positive number will take steps from the start of a pattern, and a negative number from the end.</p>",
      "examples": [
        "\"bd cp ht mt\".take(\"2\").sound()\n// The same as \"bd cp\".sound()",
        "\"bd cp ht mt\".take(\"1 2 3\").sound()\n// The same as \"bd bd cp bd cp ht\".sound()",
        "\"bd cp ht mt\".take(\"-1 -2 -3\").sound()\n// The same as \"mt ht mt cp ht mt\".sound()"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "drop",
      "longname": "drop",
      "description": "<p><em>Experimental</em></p>\n<p>Drops the given number of steps from a pattern.\nA positive number will drop steps from the start of a pattern, and a negative number from the end.</p>",
      "examples": [
        "\"tha dhi thom nam\".drop(\"1\").sound().bank(\"mridangam\")",
        "\"tha dhi thom nam\".drop(\"-1\").sound().bank(\"mridangam\")",
        "\"tha dhi thom nam\".drop(\"0 1 2 3\").sound().bank(\"mridangam\")",
        "\"tha dhi thom nam\".drop(\"0 -1 -2 -3\").sound().bank(\"mridangam\")"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "extend",
      "longname": "extend",
      "description": "<p><em>Experimental</em></p>\n<p><code>extend</code> is similar to <code>fast</code> in that it increases its density, but it also increases the step count\naccordingly. So <code>stepcat(&quot;a b&quot;.extend(2), &quot;c d&quot;)</code> would be the same as <code>&quot;a b a b c d&quot;</code>, whereas\n<code>stepcat(&quot;a b&quot;.fast(2), &quot;c d&quot;)</code> would be the same as <code>&quot;[a b] [a b] c d&quot;</code>.</p>",
      "examples": [
        "stepcat(\n  sound(\"bd bd - cp\").extend(2),\n  sound(\"bd - sd -\")\n).pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "replicate",
      "longname": "replicate",
      "description": "<p><em>Experimental</em></p>\n<p><code>replicate</code> is similar to <code>fast</code> in that it increases its density, but it also increases the step count\naccordingly. So <code>stepcat(&quot;a b&quot;.replicate(2), &quot;c d&quot;)</code> would be the same as <code>&quot;a b a b c d&quot;</code>, whereas\n<code>stepcat(&quot;a b&quot;.fast(2), &quot;c d&quot;)</code> would be the same as <code>&quot;[a b] [a b] c d&quot;</code>.</p>\n<p>TODO: find out how this function differs from extend</p>",
      "examples": [
        "stepcat(\n  sound(\"bd bd - cp\").replicate(2),\n  sound(\"bd - sd -\")\n).pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "expand",
      "longname": "expand",
      "description": "<p><em>Experimental</em></p>\n<p>Expands the step size of the pattern by the given factor.</p>",
      "examples": [
        "sound(\"tha dhi thom nam\").bank(\"mridangam\").expand(\"3 2 1 1 2 3\").pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "contract",
      "longname": "contract",
      "description": "<p><em>Experimental</em></p>\n<p>Contracts the step size of the pattern by the given factor. See also <code>expand</code>.</p>",
      "examples": [
        "sound(\"tha dhi thom nam\").bank(\"mridangam\").contract(\"3 2 1 1 2 3\").pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "shrink",
      "longname": "shrink",
      "description": "<p><em>Experimental</em></p>\n<p>Progressively shrinks the pattern by 'n' steps until there's nothing left, or if a second value is given (using mininotation list syntax with <code>:</code>),\nthat number of times.\nA positive number will progressively drop steps from the start of a pattern, and a negative number from the end.</p>",
      "examples": [
        "\"tha dhi thom nam\".shrink(\"1\").sound()\n.bank(\"mridangam\")",
        "\"tha dhi thom nam\".shrink(\"-1\").sound()\n.bank(\"mridangam\")",
        "\"tha dhi thom nam\".shrink(\"1 -1\").sound().bank(\"mridangam\").pace(4)",
        "note(\"0 1 2 3 4 5 6 7\".scale(\"C:ritusen\")).sound(\"folkharp\")\n   .shrink(\"1 -1\").pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "grow",
      "longname": "grow",
      "description": "<p><em>Experimental</em></p>\n<p>Progressively grows the pattern by 'n' steps until the full pattern is played, or if a second value is given (using mininotation list syntax with <code>:</code>),\nthat number of times.\nA positive number will progressively grow steps from the start of a pattern, and a negative number from the end.</p>",
      "examples": [
        "\"tha dhi thom nam\".grow(\"1\").sound()\n.bank(\"mridangam\")",
        "\"tha dhi thom nam\".grow(\"-1\").sound()\n.bank(\"mridangam\")",
        "\"tha dhi thom nam\".grow(\"1 -1\").sound().bank(\"mridangam\").pace(4)",
        "note(\"0 1 2 3 4 5 6 7\".scale(\"C:ritusen\")).sound(\"folkharp\")\n   .grow(\"1 -1\").pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "tour",
      "longname": "tour",
      "description": "<p><em>Experimental</em></p>\n<p>Inserts a pattern into a list of patterns. On the first repetition it will be inserted at the end of the list, then moved backwards through the list\non successive repetitions. The patterns are added together stepwise, with all repetitions taking place over a single cycle. Using <code>pace</code> to set the\nnumber of steps per cycle is therefore usually recommended.</p>",
      "examples": [
        "\"[c g]\".tour(\"e f\", \"e f g\", \"g f e c\").note()\n   .sound(\"folkharp\")\n   .pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "zip",
      "longname": "zip",
      "description": "<p><em>Experimental</em></p>\n<p>'zips' together the steps of the provided patterns. This can create a long repetition, taking place over a single, dense cycle.\nUsing <code>pace</code> to set the number of steps per cycle is therefore usually recommended.</p>",
      "examples": [
        "zip(\"e f\", \"e f g\", \"g [f e] a f4 c\").note()\n   .sound(\"folkharp\")\n   .pace(8)"
      ],
      "kind": "constant",
      "tags": [
        "stepwise"
      ]
    },
    {
      "name": "timecat",
      "longname": "timecat",
      "description": "<p>Aliases for <code>stepcat</code></p>",
      "kind": "constant"
    },
    {
      "name": "chop",
      "longname": "Pattern.chop",
      "description": "<p>Cuts each sample into the given number of parts, allowing you to explore a technique known as 'granular synthesis'.\nIt turns a pattern of samples into a pattern of parts of samples.</p>",
      "examples": [
        "samples({ rhodes: 'https://cdn.freesound.org/previews/132/132051_316502-lq.mp3' })\ns(\"rhodes\")\n .chop(4)\n .rev() // reverse order of chops\n .loopAt(2) // fit sample into 2 cycles"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "striate",
      "longname": "Pattern.striate",
      "description": "<p>Cuts each sample into the given number of parts, triggering progressive portions of each sample at each loop.</p>",
      "examples": [
        "s(\"numbers:0 numbers:1 numbers:2\").striate(6).slow(3)"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "loopAt",
      "longname": "Pattern.loopAt",
      "description": "<p>Makes the sample fit the given number of cycles by changing the speed.</p>",
      "examples": [
        "samples({ rhodes: 'https://cdn.freesound.org/previews/132/132051_316502-lq.mp3' })\ns(\"rhodes\").loopAt(2)"
      ],
      "kind": "member",
      "tags": [
        "samples",
        "pitch"
      ]
    },
    {
      "name": "slice",
      "longname": "Pattern.slice",
      "description": "<p>Chops samples into the given number of slices, triggering those slices with a given pattern of slice numbers.\nInstead of a number, it also accepts a list of numbers from 0 to 1 to slice at specific points.</p>",
      "examples": [
        "samples('github:tidalcycles/dirt-samples')\ns(\"breaks165\").slice(8, \"0 1 <2 2*2> 3 [4 0] 5 6 7\".every(3, rev)).slow(0.75)",
        "samples('github:tidalcycles/dirt-samples')\ns(\"breaks125\").fit().slice([0,.25,.5,.75], \"0 1 1 <2 3>\")"
      ],
      "kind": "member",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "onTriggerTime",
      "longname": "Pattern.onTriggerTime",
      "description": "<p>make something happen on event time\nuses browser timeout which is innacurate for audio tasks</p>",
      "examples": [
        "s(\"bd!8\").onTriggerTime((hap) => {console.log(hap)})"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "splice",
      "longname": "splice",
      "description": "<p>Works the same as slice, but changes the playback speed of each slice to match the duration of its step.</p>",
      "examples": [
        "samples('github:tidalcycles/dirt-samples')\ns(\"breaks165\")\n.splice(8,  \"0 1 [2 3 0]@2 3 0@2 7\")"
      ],
      "kind": "member",
      "tags": [
        "samples",
        "pitch"
      ]
    },
    {
      "name": "fit",
      "longname": "fit",
      "description": "<p>Makes the sample fit its event duration. Good for rhythmical loops like drum breaks.\nSimilar to <code>loopAt</code>.</p>",
      "examples": [
        "samples({ rhodes: 'https://cdn.freesound.org/previews/132/132051_316502-lq.mp3' })\ns(\"rhodes/2\").fit()"
      ],
      "kind": "member",
      "tags": [
        "samples",
        "pitch"
      ]
    },
    {
      "name": "loopAtCps",
      "longname": "Pattern.loopAtCps",
      "description": "<p>Makes the sample fit the given number of cycles and cps value, by\nchanging the speed. deprecated: use loopAt or fit instead, together with setCps / setCpm.</p>",
      "examples": [
        "samples({ rhodes: 'https://cdn.freesound.org/previews/132/132051_316502-lq.mp3' })\ns(\"rhodes\").loopAtCps(4,1.5).cps(1.5)"
      ],
      "kind": "member",
      "tags": [
        "samples",
        "pitch"
      ]
    },
    {
      "name": "ref",
      "longname": "ref",
      "description": "<p>exposes a custom value at query time. basically allows mutating state without evaluation</p>",
      "kind": "constant",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "xfade",
      "longname": "xfade",
      "description": "<p>Cross-fades between left and right from 0 to 1:</p>\n<ul>\n<li>0 = (full left, no right)</li>\n<li>.5 = (both equal)</li>\n<li>1 = (no left, full right)</li>\n</ul>",
      "examples": [
        "xfade(s(\"bd*2\"), \"<0 .25 .5 .75 1>\", s(\"hh*8\"))"
      ],
      "kind": "member",
      "tags": [
        "amplitude"
      ]
    },
    {
      "name": "beat",
      "longname": "beat",
      "description": "<p>creates a structure pattern from divisions of a cycle\nespecially useful for creating rhythms</p>",
      "examples": [
        "s(\"bd\").beat(\"0,7,10\", 16)",
        "s(\"sd\").beat(\"4,12\", 16)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "morph",
      "longname": "morph",
      "description": "<p>Takes two binary rhythms represented as lists of 1s and 0s, and a number\nbetween 0 and 1 that morphs between them. The two lists should contain the same\nnumber of true values.</p>",
      "examples": [
        "sound(\"hh\").struct(morph([1,0,1,0,1,0,1,0], // straight rhythm\n                         [1,1,0,1,0,1,0], // wonky rhythm\n                         0.25 // creates a slightly wonky rhythm\n                        )\n                  )",
        "sound(\"hh\").struct(morph(\"1:0:1:0:1:0:1:0\", // straight rhythm\n                         \"1:1:0:1:0:1:0\", // wonky rhythm\n                         sine.slow(8) // slowly morph between the rhythms\n                        )\n                  )"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "soft",
      "longname": "soft",
      "description": "<p>Soft-clipping distortion</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "hard",
      "longname": "hard",
      "description": "<p>Hard-clipping distortion</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "cubic",
      "longname": "cubic",
      "description": "<p>Cubic polynomial distortion</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "diode",
      "longname": "diode",
      "description": "<p>Diode-emulating distortion</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "asym",
      "longname": "asym",
      "description": "<p>Asymmetrical diode distortion</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "fold",
      "longname": "fold",
      "description": "<p>Wavefolding distortion</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "sinefold",
      "longname": "sinefold",
      "description": "<p>Wavefolding distortion composed with sinusoid</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "chebyshev",
      "longname": "chebyshev",
      "description": "<p>Distortion via Chebyshev polynomials</p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>amount of distortion to apply</p>",
          "name": "distortion"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>linear postgain of the distortion</p>",
          "name": "volume"
        }
      ],
      "kind": "member",
      "tags": [
        "distortion",
        "superdough"
      ]
    },
    {
      "name": "parray",
      "longname": "parray",
      "description": "<p>Turns a list of patterns into a single pattern which outputs list-values</p>",
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "partials",
      "longname": "partials",
      "description": "<p>Scale the magnitude of the harmonics of one of the core synths ('sine', 'tri', 'saw', ..)</p>\n<p>Can also be used to create a new synth via <code>s('user').partials(...)</code></p>",
      "params": [
        {
          "type": {
            "names": [
              "Array.<number>",
              "Pattern"
            ]
          },
          "description": "<p>List of [0, 1] magnitudes for partials. 0th entry is the fundamental harmonic (i.e. DC offset is skipped)</p>",
          "name": "magnitudes"
        }
      ],
      "examples": [
        "s(\"user\").seg(16).n(irand(8)).scale(\"A:major\")\n  .partials([1, 0, 1, 0, 0, 1])",
        "s(\"saw\").seg(8).n(irand(12)).scale(\"G#:minor\")\n  .partials(binaryL(irand(256).add(\"1\")))"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "phases",
      "longname": "phases",
      "description": "<p>Rotates the harmonics of one of the core synths ('sine', 'tri', 'saw', 'user', ..) by a list of phases</p>",
      "params": [
        {
          "type": {
            "names": [
              "Array.<number>",
              "Pattern"
            ]
          },
          "description": "<p>List of [0, 1) phases for partials. 0th entry is the fundamental phase (i.e. DC offset is skipped)</p>",
          "name": "phases"
        }
      ],
      "examples": [
        "// Phase cancellation\ns(\"saw\").seg(8).n(irand(12)).scale(\"G#1:minor\")\n  .partials(partials([1, 1, 1]))\n  .superimpose(x => x.phases([0.5, 0.5, 0.5]))"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "FX",
      "longname": "Pattern.FX",
      "description": "<p>Establishes an FX chain. Can be called by chaining .FX(fx1).FX(fx2)..\ncalls and/or in a single .FX(fx1, fx2, ..) call. The fx1, .. are <em>patterns</em> which\nestablish the controls of the given effect. See examples.</p>",
      "examples": [
        "$: s(\"[sbd <hh [bd | lt | oh]>]*4\").dec(.4)\n  .FX(\n    phaser(0.5).gain(2),\n    bpf(800),\n    distort(1.3),\n    room(0.2),\n    delay(0.5).gain(1.25),\n    distort(0.3),\n  ).fxr(1.7) // sets release time of effects (like delay)",
        "$: s(\"saw\").fm(0.5)\n  .delay(0.3) // outer effects are applied *last*\n  .FX(coarse(4)) // first coarse\n  .FX(lpf(500).lpe(4).lpa(1).lpd(2)) // then lpf\n  .FX(distort(1)) // then distort"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "K",
      "longname": "Pattern.K",
      "description": "<p>Produces a <a href=\"https://kabel.salat.dev/\">Kabelsalat</a> modular sound engine.\nThis can be used as either an effect (by including <code>audioin()</code> at the beginning\nof your kabel expression) or as a sound source (via any expression which doesn't\nstart with <code>audioin()</code>).</p>\n<p>Some helpers you have available to you:</p>\n<ul>\n<li>Strudel mini notation works fine in K(..) via &quot;&quot; or ``</li>\n<li>More complex Strudel expressions (like &quot;0 1 2&quot;.fast(4) or irand(24)) can be\nwritten by wrapping them in <code>S(..)</code> inside your Kabel code</li>\n<li>We expose Strudel's note frequency under <code>sFreq</code> and Strudel's gate\ninformation under <code>sGate</code></li>\n<li>You can use more complex multi-line expressions (like <code>let x = a; let y = b; x.lpf(y);</code>)\nby wrapping them inside a function in K (see example).</li>\n</ul>",
      "params": [
        {
          "type": {
            "names": [
              "KabelsalatExpression",
              "function"
            ]
          },
          "description": "<p>Kabelsalat graph definition</p>",
          "name": "expr"
        }
      ],
      "examples": [
        "note(\"A c e\".fast(4)).transpose(\"<0 2 4 6 8>\")\n  .scale(\"F:minor\").transpose(\"12\")\n  .s(\"saw\")\n  .K(\n    // audioin().mul(sGate.adsr(0.001, 0.3, 0, 0.2)) // as effect\n    saw(saw(sFreq / \"2!3 16\").mul(8).add(sFreq).lag(\"0!3 0.1\")).mul(0.3) // as source\n    .mul(sGate.adsr(0, 0.15, 0.5, \"0.1!3 1\"))\n    .lpf(sGate.adsr(0, 0.2, 0.3, 0.2).mul(1).add(0))\n    .add(x => x.delay(S(\"0.3 0.2\".fast(2))).mul(0.7))\n    .add(x => x.delay(\"0.03 [0.08 0.01] 0.01 0.013\").mul(0.77)).mul(0.7)\n    .add(x => x.delay(.13).mul(0.7))\n    .out()\n  )",
        "n(\"<0 1 <2 3 2 4>>*16\")\n  .scale(\"G#2:minor\").sometimes(x => x.transpose(\"12 | 24\"))\n  .K(() => {\n    const att = S(rand.range(0, 0.05))\n    const dec = S(rand.range(0.05, 0.2))\n    let f = n(sFreq);\n    const mod = sine(f).mul(\"0.1 | 0.2 | 0.3\")\n      .add(\"[[1.5 1] | 1 | 2 | 4 | [6 4@3]]*2\")\n    saw(f.mul(mod))\n    .mul(sGate.ad(att, dec))\n    .add(x => x.delay(0.4).mul(0.3))\n    .out()\n  }).fxr(1).room(0.3)"
      ],
      "kind": "member",
      "tags": [
        "generators",
        "superdough"
      ]
    },
    {
      "name": "worklet",
      "longname": "Pattern.worklet",
      "description": "<p>Creates a worklet effect. Typically derived by writing K(...) in the REPL which will parse\nKabelsalat code.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>Source code of the worklet update function</p>",
          "name": "src"
        },
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>Worklet inputs</p>",
          "name": "inputs"
        }
      ],
      "kind": "member",
      "tags": [
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "pick",
      "longname": "pick",
      "description": "<p>Picks patterns (or plain values) either from a list (by index) or a lookup table (by name).\nSimilar to <code>inhabit</code>, but maintains the structure of the original patterns.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "examples": [
        "note(\"<0 1 2!2 3>\".pick([\"g a\", \"e f\", \"f g f g\" , \"g c d\"]))",
        "sound(\"<0 1 [2,0]>\".pick([\"bd sd\", \"cp cp\", \"hh hh\"]))",
        "sound(\"<0!2 [0,1] 1>\".pick([\"bd(3,8)\", \"sd sd\"]))",
        "s(\"<a!2 [a,b] b>\".pick({a: \"bd(3,8)\", b: \"sd sd\"}))"
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickmod",
      "longname": "pickmod",
      "description": "<p>The same as <code>pick</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.\nFor example, if you pick the fifth pattern of a list of three, you'll get the\nsecond one.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickF",
      "longname": "pickF",
      "description": "<p>pickF lets you use a pattern of numbers to pick which function to apply to another pattern.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "description": "<p>a pattern of indices or names</p>",
          "name": "lookup"
        },
        {
          "type": {
            "names": [
              "Array.<function()>",
              "object"
            ]
          },
          "description": "<p>the array or lookup object of functions from which to pull</p>",
          "name": "lookup"
        }
      ],
      "examples": [
        "s(\"bd [rim hh]\").pickF(\"<0 1 2>\", [rev,jux(rev),fast(2)])",
        "note(\"<c2 d2>(3,8)\").s(\"square\")\n.pickF(\"<0 2> 1\", [jux(rev), fast(2), x=>x.lpf(800)])",
        "note(\"<c2 d2>(3,8)\").s(\"square\")\n.pickF(\"<jr l> f\", { jr:jux(rev), f:fast(2), l:x=>x.lpf(800) })"
      ],
      "kind": "constant",
      "tags": [
        "combiners",
        "functional"
      ]
    },
    {
      "name": "pickmodF",
      "longname": "pickmodF",
      "description": "<p>The same as <code>pickF</code>, but if you pick a number greater than the size of the functions list,\nit wraps around, rather than sticking at the maximum value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "description": "<p>a pattern of indices or names</p>",
          "name": "lookup"
        },
        {
          "type": {
            "names": [
              "Array.<function()>",
              "object"
            ]
          },
          "description": "<p>the array or lookup object of functions from which to pull</p>",
          "name": "lookup"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickOut",
      "longname": "pickOut",
      "description": "<p>Similar to <code>pick</code>, but it applies an outerJoin instead of an innerJoin.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickmodOut",
      "longname": "pickmodOut",
      "description": "<p>The same as <code>pickOut</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickRestart",
      "longname": "pickRestart",
      "description": "<p>Similar to <code>pick</code>, but the choosen pattern is restarted when its index is triggered.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickmodRestart",
      "longname": "pickmodRestart",
      "description": "<p>The same as <code>pickRestart</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "examples": [
        "\"<a@2 b@2 c@2 d@2>\".pickRestart({\n        a: n(\"0 1 2 0\"),\n        b: n(\"2 3 4 ~\"),\n        c: n(\"[4 5] [4 3] 2 0\"),\n        d: n(\"0 -3 0 ~\")\n      }).scale(\"C:major\").s(\"piano\")"
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickReset",
      "longname": "pickReset",
      "description": "<p>Similar to <code>pick</code>, but the choosen pattern is reset when its index is triggered.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "pickmodReset",
      "longname": "pickmodReset",
      "description": "<p>The same as <code>pickReset</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "inhabit",
      "longname": "inhabit",
      "description": "<p>Picks patterns (or plain values) either from a list (by index) or a lookup table (by name).\nSimilar to <code>pick</code>, but cycles are squeezed into the target ('inhabited') pattern.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "examples": [
        "let a = s(\"bd(3,8)\")\nlet b = s(\"cp sd\")\n\"<a b [a,b]>\".inhabit({ a, b })",
        "s(\"a@2 [a b] a\"\n.inhabit({a: \"bd(3,8)\", b: \"sd sd\"}))\n.slow(4)"
      ],
      "synonyms": [
        "pickSqueeze"
      ],
      "synonyms_text": "pickSqueeze",
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "inhabitmod",
      "longname": "inhabitmod",
      "description": "<p>The same as <code>inhabit</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.\nFor example, if you pick the fifth pattern of a list of three, you'll get the\nsecond one.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "synonyms": [
        "pickmodSqueeze"
      ],
      "synonyms_text": "pickmodSqueeze",
      "kind": "member",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "squeeze",
      "longname": "squeeze",
      "description": "<p>Pick from the list of values (or patterns of values) via the index using the given\npattern of integers. The selected pattern will be compressed to fit the duration of the selecting event</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "examples": [
        "note(squeeze(\"<0@2 [1!2] 2>\", [\"g a\", \"f g f g\" , \"g a c d\"]))"
      ],
      "kind": "constant",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "setcpm",
      "longname": "setcpm",
      "description": "<p>Changes the global tempo to the given cycles per minute</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>cycles per minute</p>",
          "name": "cpm"
        }
      ],
      "examples": [
        "setcpm(140/4) // =140 bpm in 4/4\n$: s(\"bd*4,[- sd]*2\").bank('tr707')"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "all",
      "longname": "repl~all",
      "description": "<p>Applies a function to all the running patterns. Note that the patterns are grouped together into a single <code>stack</code> before the function is applied. This is probably what you want, but see <code>each</code> for\na version that applies the function to each pattern separately.</p>\n<p><strong>Note:</strong> Patterns must be labeled (e.g. with <code>$:</code>) to be picked up by <code>all</code>. An unlabeled\npattern such as <code>note(&quot;c4&quot;)</code> is not registered and will produce no audio when <code>all</code> is present.\nUse <code>$: note(&quot;c4&quot;)</code> instead.</p>\n<pre class=\"prettyprint source\"><code>$: sound(&quot;bd - cp sd&quot;)\n$: sound(&quot;hh*8&quot;)\nall(fast(&quot;&lt;2 3>&quot;))\n</code></pre>\n<pre class=\"prettyprint source\"><code>$: sound(&quot;bd - cp sd&quot;)\n$: sound(&quot;hh*8&quot;)\nall(x => x.pianoroll())\n</code></pre>",
      "params": [],
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "each",
      "longname": "repl~each",
      "description": "<p>Applies a function to each of the running patterns separately. This is intended for future use with upcoming 'stepwise' features. See <code>all</code> for a version that applies the function to all the patterns stacked together into a single pattern.</p>\n<p><strong>Note:</strong> Patterns must be labeled (e.g. with <code>$:</code>) to be picked up by <code>each</code>. An unlabeled\npattern such as <code>note(&quot;c4&quot;)</code> is not registered and will produce no audio when <code>each</code> is present.\nUse <code>$: note(&quot;c4&quot;)</code> instead.</p>\n<pre class=\"prettyprint source\"><code>$: sound(&quot;bd - cp sd&quot;)\n$: sound(&quot;hh*8&quot;)\neach(fast(&quot;&lt;2 3>&quot;))\n</code></pre>",
      "params": [],
      "kind": "function",
      "tags": [
        "combiners"
      ]
    },
    {
      "name": "saw",
      "longname": "saw",
      "description": "<p>A sawtooth signal between 0 and 1.</p>",
      "examples": [
        "note(\"<c3 [eb3,g3] g2 [g3,bb3]>*8\")\n.clip(saw.slow(2))",
        "n(saw.range(0,8).segment(8))\n.scale('C major')"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "saw2",
      "longname": "saw2",
      "description": "<p>A sawtooth signal between -1 and 1 (like <code>saw</code>, but bipolar).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "isaw",
      "longname": "isaw",
      "description": "<p>A sawtooth signal between 1 and 0 (like <code>saw</code>, but flipped).</p>",
      "examples": [
        "note(\"<c3 [eb3,g3] g2 [g3,bb3]>*8\")\n.clip(isaw.slow(2))",
        "n(isaw.range(0,8).segment(8))\n.scale('C major')"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "isaw2",
      "longname": "isaw2",
      "description": "<p>A sawtooth signal between 1 and -1 (like <code>saw2</code>, but flipped).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "sine2",
      "longname": "sine2",
      "description": "<p>A sine signal between -1 and 1 (like <code>sine</code>, but bipolar).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "sine",
      "longname": "sine",
      "description": "<p>A sine signal between 0 and 1.</p>",
      "examples": [
        "n(sine.segment(16).range(0,15))\n.scale(\"C:minor\")"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "cosine",
      "longname": "cosine",
      "description": "<p>A cosine signal between 0 and 1.</p>",
      "examples": [
        "n(stack(sine,cosine).segment(16).range(0,15))\n.scale(\"C:minor\")"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "cosine2",
      "longname": "cosine2",
      "description": "<p>A cosine signal between -1 and 1 (like <code>cosine</code>, but bipolar).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "square",
      "longname": "square",
      "description": "<p>A square signal between 0 and 1.</p>",
      "examples": [
        "n(square.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "square2",
      "longname": "square2",
      "description": "<p>A square signal between -1 and 1 (like <code>square</code>, but bipolar).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "tri",
      "longname": "tri",
      "description": "<p>A triangle signal between 0 and 1.</p>",
      "examples": [
        "n(tri.segment(8).range(0,7)).scale(\"C:minor\")"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "tri2",
      "longname": "tri2",
      "description": "<p>A triangle signal between -1 and 1 (like <code>tri</code>, but bipolar).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "itri",
      "longname": "itri",
      "description": "<p>An inverted triangle signal between 1 and 0 (like <code>tri</code>, but flipped).</p>",
      "examples": [
        "n(itri.segment(8).range(0,7)).scale(\"C:minor\")"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "itri2",
      "longname": "itri2",
      "description": "<p>An inverted triangle signal between -1 and 1 (like <code>itri</code>, but bipolar).</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "time",
      "longname": "time",
      "description": "<p>A signal representing the cycle time.</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "mousex",
      "longname": "mousex",
      "description": "<p>The mouse's x position value ranges from 0 to 1.</p>",
      "examples": [
        "n(mousex.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "mousey",
      "longname": "mousey",
      "description": "<p>The mouse's y position value ranges from 0 to 1.</p>",
      "examples": [
        "n(mousey.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "useRNG",
      "longname": "useRNG",
      "description": "<p>Sets which random number generator to use. Historically Strudel would\nuse <code>useRNG('legacy')</code>, which remains the default. To use a new more statistically\nprecise RNG, try <code>useRNG('precise')</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>Mode. One of 'legacy', 'precise'</p>",
          "name": "mod"
        }
      ],
      "examples": [
        "useRNG('legacy')\n// Repeats every 300 cycles\n$: n(irand(50)).seg(16).scale(\"C:minor\").ribbon(88, 32)\n$: n(irand(50)).seg(16).scale(\"C:minor\").ribbon(388, 32)"
      ],
      "kind": "member",
      "tags": [
        "generators",
        "math"
      ]
    },
    {
      "name": "run",
      "longname": "run",
      "description": "<p>A discrete pattern of numbers from 0 to n-1</p>",
      "examples": [
        "n(run(4)).scale(\"C4:pentatonic\")\n// n(\"0 1 2 3\").scale(\"C4:pentatonic\")"
      ],
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "binary",
      "longname": "binary",
      "description": "<p>Creates a binary pattern from a number.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>input number to convert to binary</p>",
          "name": "n"
        }
      ],
      "examples": [
        "\"hh\".s().struct(binary(5))\n// \"hh\".s().struct(\"1 0 1\")"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "binaryN",
      "longname": "binaryN",
      "description": "<p>Creates a binary pattern from a number, padded to n bits long.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>input number to convert to binary</p>",
          "name": "n"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>pattern length, defaults to 16</p>",
          "name": "nBits"
        }
      ],
      "examples": [
        "\"hh\".s().struct(binaryN(55532, 16))\n// \"hh\".s().struct(\"1 1 0 1 1 0 0 0 1 1 1 0 1 1 0 0\")"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "binaryL",
      "longname": "binaryL",
      "description": "<p>Creates a binary list pattern from a number.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>input number to convert to binary\ns(&quot;saw&quot;).seg(8)\n.partials(binaryL(irand(4096).add(1)))</p>",
          "name": "n"
        }
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "binaryNL",
      "longname": "binaryNL",
      "description": "<p>Creates a binary list pattern from a number, padded to n bits long.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>input number to convert to binary</p>",
          "name": "n"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>pattern length, defaults to 16</p>",
          "name": "nBits"
        }
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "randL",
      "longname": "randL",
      "description": "<p>Creates a list of random numbers of the given length</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Number of random numbers to sample</p>",
          "name": "n"
        }
      ],
      "examples": [
        "s(\"saw\").seg(16).n(irand(12)).scale(\"F1:minor\")\n  .partials(randL(8))"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "shuffle",
      "longname": "shuffle",
      "description": "<p>Slices a pattern into the given number of parts, then plays those parts in random order.\nEach part will be played exactly once per cycle.</p>",
      "examples": [
        "note(\"c d e f\").sound(\"piano\").shuffle(4)",
        "seq(\"c d e f\".shuffle(4), \"g\").note().sound(\"piano\")"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "scramble",
      "longname": "scramble",
      "description": "<p>Slices a pattern into the given number of parts, then plays those parts at random. Similar to <code>shuffle</code>,\nbut parts might be played more than once, or not at all, per cycle.</p>",
      "examples": [
        "note(\"c d e f\").sound(\"piano\").scramble(4)",
        "seq(\"c d e f\".scramble(4), \"g\").note().sound(\"piano\")"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "withSeed",
      "longname": "withSeed",
      "description": "<p>Modify a pattern by applying a function to the <code>randomSeed</code> control if present</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>Function from seed (or undefined) to seed (or undefined)</p>",
          "name": "func"
        },
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "description": "<p>Pattern to update</p>",
          "name": "pat"
        }
      ],
      "kind": "constant",
      "tags": [
        "math"
      ]
    },
    {
      "name": "seed",
      "longname": "seed",
      "description": "<p>Change the seed for random signals. Normally, random signals depend on time,\nso two patterns at the same time will have the same random values. Specifying\na new seed changes the signal output by <code>rand</code>. This also affects other functions\nthat use randomness, like <code>shuffle</code> and <code>sometimes</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>A new seed. Can be any number.</p>",
          "name": "n"
        }
      ],
      "examples": [
        "$: s(\"hh*4\").degrade();\n$: s(\"bd*4\").degrade().seed(1); // Will degrade different events from the hi-hat"
      ],
      "kind": "member",
      "tags": [
        "math"
      ]
    },
    {
      "name": "rand",
      "longname": "rand",
      "description": "<p>A continuous pattern of random numbers, between 0 and 1.</p>",
      "examples": [
        "// randomly change the cutoff\ns(\"bd*4,hh*8\").cutoff(rand.range(500,8000))"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "rand2",
      "longname": "rand2",
      "description": "<p>A continuous pattern of random numbers, between -1 and 1</p>",
      "kind": "constant",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "brandBy",
      "longname": "brandBy",
      "description": "<p>A continuous pattern of 0 or 1 (binary random), with a probability for the value being 1</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>a number between 0 and 1</p>",
          "name": "probability"
        }
      ],
      "examples": [
        "s(\"hh*10\").pan(brandBy(0.2))"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "brand",
      "longname": "brand",
      "description": "<p>A continuous pattern of 0 or 1 (binary random)</p>",
      "examples": [
        "s(\"hh*10\").pan(brand)"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "irand",
      "longname": "irand",
      "description": "<p>A continuous pattern of random integers, between 0 and n-1.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>max value (exclusive)</p>",
          "name": "n"
        }
      ],
      "examples": [
        "// randomly select scale notes from 0 - 7 (= C to C)\nn(irand(8)).struct(\"x x*2 x x*3\").scale(\"C:minor\")"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "chooseWith",
      "longname": "chooseWith",
      "description": "<p>Choose from the list of values (or patterns of values) using the given\npattern of numbers, which should be in the range of 0..1</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "examples": [
        "note(\"c2 g2!2 d2 f1\").s(chooseWith(sine.fast(2), [\"sawtooth\", \"triangle\", \"bd:6\"]))"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "chooseInWith",
      "longname": "chooseInWith",
      "description": "<p>As with {chooseWith}, but the structure comes from the chosen values, rather\nthan the pattern you're using to choose with.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Pattern"
            ]
          },
          "name": "pat"
        },
        {
          "type": {
            "names": [
              "*"
            ]
          },
          "name": "xs"
        }
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "choose",
      "longname": "choose",
      "description": "<p>Chooses randomly from the given list of elements.</p>",
      "params": [
        {
          "type": {
            "names": [
              "any"
            ]
          },
          "variable": true,
          "description": "<p>values / patterns to choose from.</p>",
          "name": "xs"
        }
      ],
      "examples": [
        "note(\"c2 g2!2 d2 f1\").s(choose(\"sine\", \"triangle\", \"bd:6\"))"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "choose",
      "longname": "Pattern#choose",
      "description": "<p>Chooses from the given list of values (or patterns of values), according\nto the pattern that the method is called on. The pattern should be in\nthe range 0 .. 1.</p>",
      "params": [
        {
          "type": {
            "names": [
              "any"
            ]
          },
          "variable": true,
          "name": "xs"
        }
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "choose2",
      "longname": "Pattern#choose2",
      "description": "<p>As with choose, but the pattern that this method is called on should be\nin the range -1 .. 1</p>",
      "params": [
        {
          "type": {
            "names": [
              "any"
            ]
          },
          "variable": true,
          "name": "xs"
        }
      ],
      "kind": "function",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "chooseCycles",
      "longname": "chooseCycles",
      "description": "<p>Picks one of the elements at random each cycle.</p>",
      "examples": [
        "chooseCycles(\"bd\", \"hh\", \"sd\").s().fast(8)",
        "s(\"bd | hh | sd\").fast(8)"
      ],
      "synonyms": [
        "randcat"
      ],
      "synonyms_text": "randcat",
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "wchoose",
      "longname": "wchoose",
      "description": "<p>Chooses randomly from the given list of elements by giving a probability to each element</p>",
      "params": [
        {
          "type": {
            "names": [
              "any"
            ]
          },
          "variable": true,
          "description": "<p>arrays of value and weight</p>",
          "name": "pairs"
        }
      ],
      "examples": [
        "note(\"c2 g2!2 d2 f1\").s(wchoose([\"sine\",10], [\"triangle\",1], [\"bd:6\",1]))"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "wchooseCycles",
      "longname": "wchooseCycles",
      "description": "<p>Picks one of the elements at random each cycle by giving a probability to each element</p>",
      "examples": [
        "wchooseCycles([\"bd\",10], [\"hh\",1], [\"sd\",1]).s().fast(8)",
        "wchooseCycles([\"c c c\",5], [\"a a a\",3], [\"f f f\",1]).fast(4).note()",
        "// The probability can itself be a pattern\nwchooseCycles([\"bd(3,8)\",\"<5 0>\"], [\"hh hh hh\",3]).fast(4).s()"
      ],
      "synonyms": [
        "wrandcat"
      ],
      "synonyms_text": "wrandcat",
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "perlin",
      "longname": "perlin",
      "description": "<p>Generates a continuous pattern of <a href=\"https://en.wikipedia.org/wiki/Perlin_noise\">perlin noise</a>, in the range 0..1.</p>",
      "examples": [
        "// randomly change the cutoff\ns(\"bd*4,hh*8\").cutoff(perlin.range(500,8000))"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "berlin",
      "longname": "berlin",
      "description": "<p>Generates a continuous pattern of [berlin noise](conceived by Jame Coyne and Jade Rowland as a joke but turned out to be surprisingly cool and useful,\nlike perlin noise but with sawtooth waves), in the range 0..1.</p>",
      "examples": [
        "// ascending arpeggios\nn(\"0!16\".add(berlin.fast(4).mul(14))).scale(\"d:minor\")"
      ],
      "kind": "member",
      "tags": [
        "generators"
      ]
    },
    {
      "name": "degradeBy",
      "longname": "Pattern.degradeBy",
      "description": "<p>Randomly removes events from the pattern by a given amount.\n0 = 0% chance of removal\n1 = 100% chance of removal</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>a number between 0 and 1</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"hh*8\").degradeBy(0.2)",
        "s(\"[hh?0.2]*8\")",
        "//beat generator\ns(\"bd\").segment(16).degradeBy(.5).ribbon(16,1)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "degrade",
      "longname": "Pattern.degrade",
      "description": "<p>Randomly removes 50% of events from the pattern. Shorthand for <code>.degradeBy(0.5)</code></p>",
      "examples": [
        "s(\"hh*8\").degrade()",
        "s(\"[hh?]*8\")"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "undegradeBy",
      "longname": "Pattern.undegradeBy",
      "description": "<p>Inverse of <code>degradeBy</code>: Randomly removes events from the pattern by a given amount.\n0 = 100% chance of removal\n1 = 0% chance of removal\nEvents that would be removed by degradeBy are let through by undegradeBy and vice versa (see second example).</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>a number between 0 and 1</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "s(\"hh*8\").undegradeBy(0.2)",
        "s(\"hh*10\").layer(\n  x => x.degradeBy(0.2).pan(0),\n  x => x.undegradeBy(0.8).pan(1)\n)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "undegrade",
      "longname": "Pattern.undegrade",
      "description": "<p>Inverse of <code>degrade</code>: Randomly removes 50% of events from the pattern. Shorthand for <code>.undegradeBy(0.5)</code>\nEvents that would be removed by degrade are let through by undegrade and vice versa (see second example).</p>",
      "examples": [
        "s(\"hh*8\").undegrade()",
        "s(\"hh*10\").layer(\n  x => x.degrade().pan(0),\n  x => x.undegrade().pan(1)\n)"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "sometimesBy",
      "longname": "Pattern.sometimesBy",
      "description": "<p>Randomly applies the given function by the given probability.\nSimilar to <code>someCyclesBy</code></p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>a number between 0 and 1</p>",
          "name": "probability"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>the transformation to apply</p>",
          "name": "function"
        }
      ],
      "examples": [
        "s(\"hh*8\").sometimesBy(.4, x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "sometimes",
      "longname": "Pattern.sometimes",
      "description": "<p>Applies the given function with a 50% chance</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>the transformation to apply</p>",
          "name": "function"
        }
      ],
      "examples": [
        "s(\"hh*8\").sometimes(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "someCyclesBy",
      "longname": "Pattern.someCyclesBy",
      "description": "<p>Randomly applies the given function by the given probability on a cycle by cycle basis.\nSimilar to <code>sometimesBy</code></p>",
      "params": [
        {
          "type": {
            "names": [
              "number",
              "Pattern"
            ]
          },
          "description": "<p>a number between 0 and 1</p>",
          "name": "probability"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>the transformation to apply</p>",
          "name": "function"
        }
      ],
      "examples": [
        "s(\"bd,hh*8\").someCyclesBy(.3, x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "someCycles",
      "longname": "Pattern.someCycles",
      "description": "<p>Shorthand for <code>.someCyclesBy(0.5, fn)</code></p>",
      "examples": [
        "s(\"bd,hh*8\").someCycles(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "often",
      "longname": "Pattern.often",
      "description": "<p>Shorthand for <code>.sometimesBy(0.75, fn)</code></p>",
      "examples": [
        "s(\"hh*8\").often(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "rarely",
      "longname": "Pattern.rarely",
      "description": "<p>Shorthand for <code>.sometimesBy(0.25, fn)</code></p>",
      "examples": [
        "s(\"hh*8\").rarely(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "almostNever",
      "longname": "Pattern.almostNever",
      "description": "<p>Shorthand for <code>.sometimesBy(0.1, fn)</code></p>",
      "examples": [
        "s(\"hh*8\").almostNever(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "almostAlways",
      "longname": "Pattern.almostAlways",
      "description": "<p>Shorthand for <code>.sometimesBy(0.9, fn)</code></p>",
      "examples": [
        "s(\"hh*8\").almostAlways(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "never",
      "longname": "Pattern.never",
      "description": "<p>Shorthand for <code>.sometimesBy(0, fn)</code> (never calls fn)</p>",
      "examples": [
        "s(\"hh*8\").never(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "always",
      "longname": "Pattern.always",
      "description": "<p>Shorthand for <code>.sometimesBy(1, fn)</code> (always calls fn)</p>",
      "examples": [
        "s(\"hh*8\").always(x=>x.speed(\"0.5\"))"
      ],
      "kind": "member",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "whenKey",
      "longname": "Pattern.whenKey",
      "description": "<p>Do something on a keypress, or array of keypresses\n<a href=\"https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values\">Key name reference</a></p>",
      "examples": [
        "s(\"bd(5,8)\").whenKey(\"Control:j\", x => x.segment(16).color(\"red\")).whenKey(\"Control:i\", x => x.fast(2).color(\"blue\"))"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "keyDown",
      "longname": "Pattern.keyDown",
      "description": "<p>returns true when a key or array of keys is held\n<a href=\"https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values\">Key name reference</a></p>",
      "examples": [
        "keyDown(\"Control:j\").pick([s(\"bd(5,8)\"), s(\"cp(3,8)\")])"
      ],
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "cyclesPer",
      "longname": "cyclesPer",
      "description": "<p>A pattern measuring the duration of events,\nin cycles per event. <code>cyclesPer</code> doesn't have structure itself, but takes structure, and therefore\nevent durations, from the pattern that it is combined with.\nFor example <code>cyclesPer.struct(&quot;1 1 [1 1] 1&quot;)</code> would give the same as <code>&quot;0.25 0.25 [0.125 0.125] 0.25&quot;</code>.\nSee also its reciprocal, <code>per</code>, also known as <code>perCycle</code>.</p>",
      "examples": [
        "// Shorter events are lower in pitch\nsound(\"saw saw [saw saw] saw\")\n  .note(cyclesPer.range(50, 100))",
        "sound(\"bd sd [bd bd] sd*4 [- sd] [bd [bd bd]]\")\n  .note(cyclesPer.add(20))"
      ],
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "per",
      "longname": "per",
      "description": "<p>A pattern measuring the 'shortness' of events, or in other words, the duration of pattern events,\nin events per cycle. <code>per</code> doesn't have structure itself, but takes structure, and therefore\nevent durations, from the pattern that it is combined with.\nFor example <code>per.struct(&quot;1 1 [1 1] 1&quot;)</code> would give the same as <code>&quot;4 4 [8 8] 4&quot;</code>.\nSee also its reciprocal, <code>cyclesPer</code>.</p>",
      "examples": [
        "// Shorter events are more distorted\nn(\"0 0*2 0 0*2 0 [0 0 0]@2\").sound(\"bd\")\n .distort(per.div(2))"
      ],
      "synonyms": [
        "perCycle"
      ],
      "synonyms_text": "perCycle",
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "perx",
      "longname": "perx",
      "description": "<p>Like <code>per</code> but measures the shortness of events according to an exponential curve. In\nparticular, where the event duration halves, the\nreturned value increases by one. <code>perx.struct(&quot;1 1 [1 [1 1]] 1&quot;)</code> would therefore be\nthe same as <code>&quot;3 3 [4 [5 5]] 3&quot;</code>.</p>",
      "kind": "constant",
      "tags": [
        "temporal"
      ]
    },
    {
      "name": "getFreq",
      "longname": "getFreq",
      "kind": "constant",
      "tags": [
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "midi2note",
      "longname": "midi2note",
      "kind": "constant",
      "tags": [
        {
          "originalTitle": "noAutocomplete",
          "title": "noautocomplete",
          "text": ""
        }
      ]
    },
    {
      "name": "csoundm",
      "longname": "csoundm",
      "description": "<p>Sends notes to Csound for rendering with MIDI semantics. The hap value is\ntranslated to these Csound pfields:</p>\n<p>p1 -- Csound instrument either as a number (1-based, can be a fraction),\nor as a string name.\np2 -- time in beats (usually seconds) from start of performance.\np3 -- duration in beats (usually seconds).\np4 -- MIDI key number (as a real number, not an integer but in [0, 127].\np5 -- MIDI velocity (as a real number, not an integer but in [0, 127].\np6 -- Strudel controls, as a string.</p>",
      "kind": "constant",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "pianoroll",
      "longname": "pianoroll",
      "description": "<p>Visualises a pattern as a scrolling 'pianoroll', displayed in the background of the editor. To show a pianoroll for all running patterns, use <code>all(pianoroll)</code>. To have a pianoroll appear below\na pattern instead, prefix with <code>_</code>, e.g.: <code>sound(&quot;bd sd&quot;)._pianoroll()</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "description": "<p>Object containing all the optional following parameters as key value pairs:</p>",
          "name": "options"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>number of cycles to be displayed at the same time - defaults to 4</p>",
          "name": "cycles"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>location of the active notes on the time axis - 0 to 1, defaults to 0.5</p>",
          "name": "playhead"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>displays the roll vertically - 0 by default</p>",
          "name": "vertical"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>displays labels on individual notes (see the label function) - 0 by default</p>",
          "name": "labels"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>reverse the direction of the roll - 0 by default</p>",
          "name": "flipTime"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>reverse the relative location of notes on the value axis - 0 by default</p>",
          "name": "flipValues"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>lookup X cycles outside of the cycles window to display notes in advance - 1 by default</p>",
          "name": "overscan"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>hide notes with negative time (before starting playing the pattern) - 0 by default</p>",
          "name": "hideNegative"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>notes leave a solid trace - 0 by default</p>",
          "name": "smear"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>notes takes the full value axis width - 0 by default</p>",
          "name": "fold"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>hexadecimal or CSS color of the active notes - defaults to #FFCA28</p>",
          "name": "active"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>hexadecimal or CSS color of the inactive notes - defaults to #7491D2</p>",
          "name": "inactive"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>hexadecimal or CSS color of the background - defaults to transparent</p>",
          "name": "background"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>hexadecimal or CSS color of the line representing the play head - defaults to white</p>",
          "name": "playheadColor"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>notes are filled with color (otherwise only the label is displayed) - 0 by default</p>",
          "name": "fill"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>active notes are filled with color - 0 by default</p>",
          "name": "fillActive"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>notes are shown with colored borders - 0 by default</p>",
          "name": "stroke"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>active notes are shown with colored borders - 0 by default</p>",
          "name": "strokeActive"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>only active notes are shown - 0 by default</p>",
          "name": "hideInactive"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>use note color for inactive notes - 1 by default</p>",
          "name": "colorizeInactive"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>define the font used by notes labels - defaults to 'monospace'</p>",
          "name": "fontFamily"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>minimum note value to display on the value axis - defaults to 10</p>",
          "name": "minMidi"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>maximum note value to display on the value axis - defaults to 90</p>",
          "name": "maxMidi"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>automatically calculate the minMidi and maxMidi parameters - 0 by default</p>",
          "name": "autorange"
        }
      ],
      "examples": [
        "note(\"c2 a2 eb2\")\n.euclid(5,8)\n.s('sawtooth')\n.lpenv(4).lpf(300)\n.pianoroll({ labels: 1 })"
      ],
      "synonyms": [
        "punchcard"
      ],
      "synonyms_text": "punchcard",
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "wordfall",
      "longname": "wordfall",
      "description": "<p>Displays a vertical pianoroll with event labels.\nSupports all the same options as pianoroll.</p>",
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "pitchwheel",
      "longname": "pitchwheel",
      "description": "<p>Renders a pitch circle to visualize frequencies within one octave</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "hapcircles"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "circle"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "edo"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "name": "root"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "thickness"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "hapRadius"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "name": "mode"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "margin"
        }
      ],
      "examples": [
        "n(\"0 .. 12\").scale(\"C:chromatic\")\n.s(\"sawtooth\")\n.lpf(500)\n._pitchwheel()"
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "spiral",
      "longname": "spiral",
      "description": "<p>Displays a spiral visual.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "description": "<p>Object containing all the optional following parameters as key value pairs:</p>",
          "name": "options"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>controls the rotations per cycle ratio, where 1 = 1 cycle / 360 degrees</p>",
          "name": "stretch"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>the diameter of the spiral</p>",
          "name": "size"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>line thickness</p>",
          "name": "thickness"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>style of line ends: butt (default), round, square</p>",
          "name": "cap"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>number of rotations before spiral starts (default 3)</p>",
          "name": "inset"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>color of playhead, defaults to white</p>",
          "name": "playheadColor"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>length of playhead in rotations, defaults to 0.02</p>",
          "name": "playheadLength"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>thickness of playheadrotations, defaults to thickness</p>",
          "name": "playheadThickness"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>space around spiral</p>",
          "name": "padding"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>steadyness of spiral vs playhead. 1 = spiral doesn't move, playhead does.</p>",
          "name": "steady"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>color of active segment. defaults to foreground of theme</p>",
          "name": "activeColor"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>color of inactive segments. defaults to gutterForeground of theme</p>",
          "name": "inactiveColor"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>wether or not to colorize inactive segments, defaults to 0</p>",
          "name": "colorizeInactive"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>wether or not past and future should fade out. defaults to 1</p>",
          "name": "fade"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>wether or not the spiral should be logarithmic. defaults to 0</p>",
          "name": "logSpiral"
        }
      ],
      "examples": [
        "note(\"c2 a2 eb2\")\n.euclid(5,8)\n.s('sawtooth')\n.lpenv(4).lpf(300)\n._spiral({ steady: .96 })"
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "edoScale",
      "longname": "edoScale",
      "description": "<p>Turns numbers into notes in the given EDO scale (zero indexed).</p>\n<p>An EDO scale definition looks like this:</p>\n<p>e.g. C:LLsLLLs:2:1 &lt;- this is the C major scale, 12 EDO</p>\n<p>e.g. C:LLsLLL:3:1 &lt;- this is the Gorgo 6 note scale, 16 EDO</p>\n<p>An EDO scale, e.g. C:LLsLLLs:2:1, consists of a root note (e.g. C)\nfollowed by semicolon (':')\nand then a <a href=\"https://en.xen.wiki/w/MOS_scale\">Large/small step notation sequence</a>\n(e.g. LLsLLLs)\nfollowed by semicolon, then the large step size (e.g. 2)\nfollowed by semicolon, then the small step size (e.g. 1).</p>\n<p>The number of divisions of the octave is calculated as the sum\nof the steps in the EDO scale definition.</p>\n<p>e.g. C:LLsLLLs:2:1 is 2+2+1+2+2+2+1 = 12 EDO, 7 note scale</p>\n<p>e.g. C:LLsLLL:3:1 is 3+3+1+3+3+3 = 16 EDO, 6 note scale</p>\n<p>The root note defaults to octave 3, if no octave number is given.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>Definition of EDO scale.</p>",
          "name": "scale"
        }
      ],
      "examples": [
        "n(\"0 2 4 6 4 2\").edoScale(\"C:LLsLLLs:2:1\")",
        "n(\"[0,7] 4 [2,7] 4\")\n.edoScale(\"G2:<LLsLLL LLLLsL>:3:1\")\n.s(\"piano\")._pitchwheel()",
        "n(rand.range(0,5).segment(6))\n.edoScale(\"<G2 C3>:LLsLL:3:1\")\n.s(\"piano\")._pitchwheel()"
      ],
      "kind": "member"
    },
    {
      "name": "MidiInput",
      "longname": "MidiInput",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "number"
            ]
          },
          "description": "<p>MIDI device name or index defaulting to 0</p>",
          "name": "input"
        }
      ],
      "kind": "class"
    },
    {
      "name": "createCC",
      "longname": "MidiInput#createCC",
      "description": "<p>Implementation for the cc() factory function tied to this specific input.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>MIDI CC number</p>",
          "name": "cc"
        },
        {
          "type": {
            "names": [
              "number",
              "undefined"
            ]
          },
          "description": "<p>MIDI channel (1-16) or undefined for all channels</p>",
          "name": "chan"
        }
      ],
      "kind": "function"
    },
    {
      "name": "defaultmidimap",
      "longname": "defaultmidimap",
      "description": "<p>configures the default midimap, which is used when no &quot;midimap&quot; port is set</p>",
      "examples": [
        "defaultmidimap({ lpf: 74 })\n$: note(\"c a f e\").midi();\n$: lpf(sine.slow(4).segment(16)).midi();"
      ],
      "kind": "function",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "midimaps",
      "longname": "midimaps",
      "description": "<p>Adds midimaps to the registry. Inside each midimap, control names (e.g. lpf) are mapped to cc numbers.</p>",
      "examples": [
        "midimaps({ mymap: { lpf: 74 } })\n$: note(\"c a f e\")\n.lpf(sine.slow(4))\n.midimap('mymap')\n.midi()",
        "midimaps({ mymap: {\n  lpf: { ccn: 74, min: 0, max: 20000, exp: 0.5 }\n}})\n$: note(\"c a f e\")\n.lpf(sine.slow(2).range(400,2000))\n.midimap('mymap')\n.midi()"
      ],
      "kind": "function",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "midi",
      "longname": "Pattern#midi",
      "description": "<p>MIDI output: Opens a MIDI output port.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "number"
            ]
          },
          "description": "<p>MIDI device name or index defaulting to 0</p>",
          "name": "midiport"
        },
        {
          "type": {
            "names": [
              "object"
            ]
          },
          "description": "<p>Additional MIDI configuration options</p>",
          "name": "options"
        }
      ],
      "examples": [
        "note(\"c4\").midichan(1).midi('IAC Driver Bus 1')",
        "note(\"c4\").midichan(1).midi('IAC Driver Bus 1', { controller: true, latency: 50 })"
      ],
      "kind": "function",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "_initializeInput",
      "longname": "_initializeInput",
      "description": "<p>Initialize a midi input device</p>",
      "params": [],
      "kind": "function"
    },
    {
      "name": "midin",
      "longname": "midin",
      "description": "<p>MIDI input: Opens a MIDI input port to receive MIDI control change messages.</p>\n<p>The output is a function that accepts a midi cc value to query as well as (optionally) a midi channel</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "number"
            ]
          },
          "description": "<p>MIDI device name or index defaulting to 0</p>",
          "name": "input"
        }
      ],
      "examples": [
        "const cc = await midin('IAC Driver Bus 1')\nnote(\"c a f e\").lpf(cc(0).range(0, 1000)).lpq(cc(1).range(0, 10)).sound(\"sawtooth\")",
        "const allCC = await midin('IAC Driver Bus 1')\nconst cc = (ccNum) => allCC(ccNum, 2) // just channel 2\nnote(\"c a f e\").s(\"saw\")\n  .when(cc(0).gt(0), x => x.postgain(0))"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "midikeys",
      "longname": "midikeys",
      "description": "<p>MIDI keyboard: Opens a MIDI input port to receive MIDI keyboard messages.</p>\n<p>The note length is fixed as Superdough is not currently set up for undetermined\nnote durations</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "number"
            ]
          },
          "description": "<p>MIDI device name or index defaulting to 0</p>",
          "name": "input"
        }
      ],
      "examples": [
        "const kb = await midikeys('Arturia KeyStep 32')\nkb().s(\"tri\").lpf(80).lpe(6).lpd(0.1).room(2).delay(0.35)",
        "const kb = await midikeys('Arturia KeyStep 32')\nkb(\"0.5 1\")\n  .s(\"saw\")\n  .add(note(rand.mul(0.3)))\n  .lpf(1000).lpe(2).room(0.5)"
      ],
      "kind": "member",
      "tags": [
        "external_io",
        "midi"
      ]
    },
    {
      "name": "getMidiDeviceNamesString",
      "longname": "getMidiDeviceNamesString",
      "description": "<p>Get a string listing device names for error messages.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Array.<Input>",
              "Array.<Output>"
            ]
          },
          "name": "devices"
        }
      ],
      "kind": "function"
    },
    {
      "name": "getDevice",
      "longname": "getDevice",
      "description": "<p>Look up a device by index or name. Otherwise return a default device, or fail if none are connected.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "number"
            ]
          },
          "name": "indexOrName"
        },
        {
          "type": {
            "names": [
              "Array.<Input>",
              "Array.<Output>"
            ]
          },
          "name": "devices"
        }
      ],
      "kind": "function"
    },
    {
      "name": "accelerationX",
      "longname": "accelerationX",
      "description": "<p>The accelerometer's x-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(accelerationX.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "accX"
      ],
      "synonyms_text": "accX",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "accelerationY",
      "longname": "accelerationY",
      "description": "<p>The accelerometer's y-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(accelerationY.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "accY"
      ],
      "synonyms_text": "accY",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "accelerationZ",
      "longname": "accelerationZ",
      "description": "<p>The accelerometer's z-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(accelerationZ.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "accZ"
      ],
      "synonyms_text": "accZ",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "gravityX",
      "longname": "gravityX",
      "description": "<p>The device's gravity x-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(gravityX.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "gravX"
      ],
      "synonyms_text": "gravX",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "gravityY",
      "longname": "gravityY",
      "description": "<p>The device's gravity y-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(gravityY.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "gravY"
      ],
      "synonyms_text": "gravY",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "gravityZ",
      "longname": "gravityZ",
      "description": "<p>The device's gravity z-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(gravityZ.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "gravZ"
      ],
      "synonyms_text": "gravZ",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "rotationAlpha",
      "longname": "rotationAlpha",
      "description": "<p>The device's rotation around the alpha-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(rotationAlpha.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "rotA",
        "rotZ",
        "rotationZ"
      ],
      "synonyms_text": "rotA, rotZ, rotationZ",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "rotationBeta",
      "longname": "rotationBeta",
      "description": "<p>The device's rotation around the beta-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(rotationBeta.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "rotB",
        "rotX",
        "rotationX"
      ],
      "synonyms_text": "rotB, rotX, rotationX",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "rotationGamma",
      "longname": "rotationGamma",
      "description": "<p>The device's rotation around the gamma-axis value ranges from 0 to 1.</p>",
      "examples": [
        "n(rotationGamma.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "rotG",
        "rotY",
        "rotationY"
      ],
      "synonyms_text": "rotG, rotY, rotationY",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "orientationAlpha",
      "longname": "orientationAlpha",
      "description": "<p>The device's orientation alpha value ranges from 0 to 1.</p>",
      "examples": [
        "n(orientationAlpha.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "oriA",
        "oriZ",
        "orientationZ"
      ],
      "synonyms_text": "oriA, oriZ, orientationZ",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "orientationBeta",
      "longname": "orientationBeta",
      "description": "<p>The device's orientation beta value ranges from 0 to 1.</p>",
      "examples": [
        "n(orientationBeta.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "oriB",
        "oriX",
        "orientationX"
      ],
      "synonyms_text": "oriB, oriX, orientationX",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "orientationGamma",
      "longname": "orientationGamma",
      "description": "<p>The device's orientation gamma value ranges from 0 to 1.</p>",
      "examples": [
        "n(orientationGamma.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "oriG",
        "oriY",
        "orientationY"
      ],
      "synonyms_text": "oriG, oriY, orientationY",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "absoluteOrientationAlpha",
      "longname": "absoluteOrientationAlpha",
      "description": "<p>The device's absolute orientation alpha value ranges from 0 to 1.</p>",
      "examples": [
        "n(absoluteOrientationAlpha.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "absOriA",
        "absOriZ",
        "absoluteOrientationZ"
      ],
      "synonyms_text": "absOriA, absOriZ, absoluteOrientationZ",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "absoluteOrientationBeta",
      "longname": "absoluteOrientationBeta",
      "description": "<p>The device's absolute orientation beta value ranges from 0 to 1.</p>",
      "examples": [
        "n(absoluteOrientationBeta.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "absOriB",
        "absOriX",
        "absoluteOrientationX"
      ],
      "synonyms_text": "absOriB, absOriX, absoluteOrientationX",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "absoluteOrientationGamma",
      "longname": "absoluteOrientationGamma",
      "description": "<p>The device's absolute orientation gamma value ranges from 0 to 1.</p>",
      "examples": [
        "n(absoluteOrientationGamma.segment(4).range(0,7)).scale(\"C:minor\")"
      ],
      "synonyms": [
        "absOriG",
        "absOriY",
        "absoluteOrientationY"
      ],
      "synonyms_text": "absOriG, absOriY, absoluteOrientationY",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "osc",
      "longname": "Pattern.osc",
      "description": "<p>Sends each hap as an OSC message, which can be picked up by SuperCollider or any other OSC-enabled software.\nFor more info, read <a href=\"https://strudel.cc/learn/input-output/\">MIDI &amp; OSC in the docs</a></p>",
      "kind": "member",
      "tags": [
        "external_io"
      ]
    },
    {
      "name": "OLAProcessor",
      "longname": "OLAProcessor",
      "kind": "class"
    },
    {
      "name": "reallocateChannelsIfNeeded",
      "longname": "OLAProcessor#reallocateChannelsIfNeeded",
      "description": "<p>Handles dynamic reallocation of input/output channels buffer\n(channel numbers may vary during lifecycle)</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "readInputs",
      "longname": "OLAProcessor#readInputs",
      "description": "<p>Read next web audio block to input buffers</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "writeOutputs",
      "longname": "OLAProcessor#writeOutputs",
      "description": "<p>Write next web audio block from output buffers</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "shiftInputBuffers",
      "longname": "OLAProcessor#shiftInputBuffers",
      "description": "<p>Shift left content of input buffers to receive new web audio block</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "shiftOutputBuffers",
      "longname": "OLAProcessor#shiftOutputBuffers",
      "description": "<p>Shift left content of output buffers to receive new web audio block</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "prepareInputBuffersToSend",
      "longname": "OLAProcessor#prepareInputBuffersToSend",
      "description": "<p>Copy contents of input buffers to buffer actually sent to process</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "handleOutputBuffersToRetrieve",
      "longname": "OLAProcessor#handleOutputBuffersToRetrieve",
      "description": "<p>Add contents of output buffers just processed to output buffers</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "generateReverb",
      "longname": "reverbGen.generateReverb",
      "description": "<p>Generates a reverb impulse response.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "nullable": false,
          "description": "<p>TODO: Document the properties.</p>",
          "name": "params"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "nullable": false,
          "description": "<p>Function to call when\nthe impulse response has been generated. The impulse response\nis passed to this function as its parameter. May be called\nimmediately within the current execution context, or later.</p>",
          "name": "callback"
        }
      ],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "generateGraph",
      "longname": "reverbGen.generateGraph",
      "description": "<p>Creates a canvas element showing a graph of the given data.</p>",
      "params": [
        {
          "type": {
            "names": [
              "Float32Array"
            ]
          },
          "nullable": false,
          "description": "<p>An array of numbers, or a Float32Array.</p>",
          "name": "data"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Width in pixels of the canvas.</p>",
          "name": "width"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Height in pixels of the canvas.</p>",
          "name": "height"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Minimum value of data for the graph (lower edge).</p>",
          "name": "min"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Maximum value of data in the graph (upper edge).</p>",
          "name": "max"
        }
      ],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "applyGradualLowpass",
      "longname": "applyGradualLowpass",
      "description": "<p>Applies a constantly changing lowpass filter to the given sound.</p>",
      "params": [
        {
          "type": {
            "names": [
              "AudioBuffer"
            ]
          },
          "nullable": false,
          "name": "input"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "lpFreqStart"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "lpFreqEnd"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "lpFreqEndAt"
        },
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "nullable": false,
          "description": "<p>May be called\nimmediately within the current execution context, or later.</p>",
          "name": "callback"
        }
      ],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "getAllChannelData",
      "longname": "getAllChannelData",
      "params": [
        {
          "type": {
            "names": [
              "AudioBuffer"
            ]
          },
          "nullable": false,
          "name": "buffer"
        }
      ],
      "kind": "function"
    },
    {
      "name": "randomSample",
      "longname": "randomSample",
      "params": [],
      "kind": "function"
    },
    {
      "name": "getDur",
      "longname": "getDuration,getDur",
      "description": "<p>Returns the duration, in seconds, of the given sample.\nHas optional param <code>n</code> (for instance, the <code>2</code> in <code>s(&quot;casio:2&quot;)</code>)</p>\n<p>Note: <code>must</code> be called with await, otherwise you'll get a pending Promise object.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "name": "sampleName"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>n</p>",
          "name": "(optional)"
        }
      ],
      "examples": [
        "// Set a patterns cycle length to exactly the length of the sample\nsamples('github:tidalcycles/dirt-samples')\nlet k = await getDuration('sax')\ns(\"sax\").cps(1/k)"
      ],
      "kind": "member",
      "tags": [
        {
          "originalTitle": "tag",
          "title": "tag",
          "text": "samples",
          "value": "samples"
        }
      ]
    },
    {
      "name": "samples",
      "longname": "samples",
      "description": "<p>Loads a collection of samples to use with <code>s</code></p>",
      "examples": [
        "samples('github:tidalcycles/dirt-samples');\ns(\"[bd ~]*2, [~ hh]*2, ~ sd\")",
        "samples({\n bd: '808bd/BD0000.WAV',\n sd: '808sd/SD0010.WAV'\n }, 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/');\ns(\"[bd ~]*2, [~ hh]*2, ~ sd\")"
      ],
      "kind": "constant",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "setMaxPolyphony",
      "longname": "setMaxPolyphony",
      "description": "<p>Set the max polyphony. If notes are ringing out via <code>release</code> then they will\nstart to die out in first-in-first-out order once the max polyphony has been hit</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>polyphony. Defaults to 128</p>",
          "name": "Max"
        }
      ],
      "examples": [
        "setMaxPolyphony(4)\nn(irand(24).seg(8)).scale(\"C#3:minor\").room(1).release(4).gain(0.5)"
      ],
      "kind": "member",
      "tags": [
        "superdough"
      ]
    },
    {
      "name": "setGainCurve",
      "longname": "setGainCurve",
      "description": "<p>Apply a function to all gains provided in patterns. Can be used to rescale gain to be\nquadratic, exponential, etc. rather than linear</p>",
      "params": [
        {
          "type": {
            "names": [
              "function"
            ]
          },
          "description": "<p>to apply to all gain values</p>",
          "name": "function"
        }
      ],
      "examples": [
        "setGainCurve((x) => x * x) // quadratic gain\ns(\"bd*4\").gain(0.5) // equivalent to 0.25 gain normally"
      ],
      "kind": "member",
      "tags": [
        "amplitude",
        "superdough"
      ]
    },
    {
      "name": "aliasBank",
      "longname": "aliasBank",
      "description": "<p>Register an alias for a bank of sounds.\nOptionally accepts a single argument map of bank aliases.\nOptionally accepts a single argument string of a path to a JSON file containing bank aliases.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>The bank to alias</p>",
          "name": "bank"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>The alias to use for the bank</p>",
          "name": "alias"
        }
      ],
      "kind": "function",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "soundAlias",
      "longname": "soundAlias",
      "description": "<p>Register an alias for a sound.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>The original sound name</p>",
          "name": "original"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>The alias to use for the sound</p>",
          "name": "alias"
        }
      ],
      "kind": "function",
      "tags": [
        "samples"
      ]
    },
    {
      "name": "pickAndRename",
      "longname": "pickAndRename",
      "description": "<p>Selects entries from <code>source</code> and renames them via <code>map</code></p>",
      "kind": "constant",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "tables",
      "longname": "tables",
      "description": "<p>Loads a collection of wavetables to use with <code>s</code></p>",
      "kind": "member",
      "tags": [
        "wavetable"
      ]
    },
    {
      "name": "applyHannWindow",
      "longname": "PhaseVocoderProcessor#applyHannWindow",
      "description": "<p>Apply Hann window in-place</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "computeMagnitudes",
      "longname": "PhaseVocoderProcessor#computeMagnitudes",
      "description": "<p>Compute squared magnitudes for peak finding</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "findPeaks",
      "longname": "PhaseVocoderProcessor#findPeaks",
      "description": "<p>Find peaks in spectrum magnitudes</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "shiftPeaks",
      "longname": "PhaseVocoderProcessor#shiftPeaks",
      "description": "<p>Shift peaks and regions of influence by pitchFactor into new specturm</p>",
      "params": [],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "chyx",
      "longname": "chyx",
      "description": "<p>BYTE BEATS</p>",
      "params": [],
      "kind": "constant",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "crossfade",
      "longname": "crossfade",
      "description": "<p>Equal Power Crossfade function.\nSmoothly transitions between signals A and B, maintaining consistent perceived loudness.</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Signal A (can be a single value or an array value in buffer processing).</p>",
          "name": "a"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Signal B (can be a single value or an array value in buffer processing).</p>",
          "name": "b"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>Crossfade parameter (0.0 = all A, 1.0 = all B, 0.5 = equal mix).</p>",
          "name": "m"
        }
      ],
      "kind": "function",
      "tags": [
        "internals"
      ]
    },
    {
      "name": "id",
      "longname": "DoughVoice#id",
      "kind": "member"
    },
    {
      "name": "out",
      "longname": "DoughVoice#out",
      "kind": "member"
    },
    {
      "name": "attack",
      "longname": "DoughVoice#attack",
      "kind": "member"
    },
    {
      "name": "decay",
      "longname": "DoughVoice#decay",
      "kind": "member"
    },
    {
      "name": "sustain",
      "longname": "DoughVoice#sustain",
      "kind": "member"
    },
    {
      "name": "release",
      "longname": "DoughVoice#release",
      "kind": "member"
    },
    {
      "name": "_begin",
      "longname": "DoughVoice#_begin",
      "kind": "member"
    },
    {
      "name": "_duration",
      "longname": "DoughVoice#_duration",
      "kind": "member"
    },
    {
      "name": "_sound",
      "longname": "DoughVoice#_sound",
      "kind": "member"
    },
    {
      "name": "_channels",
      "longname": "DoughVoice#_channels",
      "kind": "member"
    },
    {
      "name": "_buffers",
      "longname": "DoughVoice#_buffers",
      "kind": "member"
    },
    {
      "name": "unit",
      "longname": "DoughVoice#unit",
      "kind": "member"
    },
    {
      "name": "_penv",
      "longname": "DoughVoice#_penv",
      "kind": "member"
    },
    {
      "name": "penv",
      "longname": "DoughVoice#penv",
      "kind": "member"
    },
    {
      "name": "pattack",
      "longname": "DoughVoice#pattack",
      "kind": "member"
    },
    {
      "name": "pdecay",
      "longname": "DoughVoice#pdecay",
      "kind": "member"
    },
    {
      "name": "psustain",
      "longname": "DoughVoice#psustain",
      "kind": "member"
    },
    {
      "name": "prelease",
      "longname": "DoughVoice#prelease",
      "kind": "member"
    },
    {
      "name": "vib",
      "longname": "DoughVoice#vib",
      "kind": "member"
    },
    {
      "name": "vibmod",
      "longname": "DoughVoice#vibmod",
      "kind": "member"
    },
    {
      "name": "_fm",
      "longname": "DoughVoice#_fm",
      "kind": "member"
    },
    {
      "name": "fmh",
      "longname": "DoughVoice#fmh",
      "kind": "member"
    },
    {
      "name": "fmi",
      "longname": "DoughVoice#fmi",
      "kind": "member"
    },
    {
      "name": "_fmenv",
      "longname": "DoughVoice#_fmenv",
      "kind": "member"
    },
    {
      "name": "fmattack",
      "longname": "DoughVoice#fmattack",
      "kind": "member"
    },
    {
      "name": "fmdecay",
      "longname": "DoughVoice#fmdecay",
      "kind": "member"
    },
    {
      "name": "fmsustain",
      "longname": "DoughVoice#fmsustain",
      "kind": "member"
    },
    {
      "name": "fmrelease",
      "longname": "DoughVoice#fmrelease",
      "kind": "member"
    },
    {
      "name": "_lpenv",
      "longname": "DoughVoice#_lpenv",
      "kind": "member"
    },
    {
      "name": "lpattack",
      "longname": "DoughVoice#lpattack",
      "kind": "member"
    },
    {
      "name": "lpdecay",
      "longname": "DoughVoice#lpdecay",
      "kind": "member"
    },
    {
      "name": "lpsustain",
      "longname": "DoughVoice#lpsustain",
      "kind": "member"
    },
    {
      "name": "lprelease",
      "longname": "DoughVoice#lprelease",
      "kind": "member"
    },
    {
      "name": "_hpenv",
      "longname": "DoughVoice#_hpenv",
      "kind": "member"
    },
    {
      "name": "hpenv",
      "longname": "DoughVoice#hpenv",
      "kind": "member"
    },
    {
      "name": "hpattack",
      "longname": "DoughVoice#hpattack",
      "kind": "member"
    },
    {
      "name": "hpdecay",
      "longname": "DoughVoice#hpdecay",
      "kind": "member"
    },
    {
      "name": "hpsustain",
      "longname": "DoughVoice#hpsustain",
      "kind": "member"
    },
    {
      "name": "hprelease",
      "longname": "DoughVoice#hprelease",
      "kind": "member"
    },
    {
      "name": "_bpenv",
      "longname": "DoughVoice#_bpenv",
      "kind": "member"
    },
    {
      "name": "bpenv",
      "longname": "DoughVoice#bpenv",
      "kind": "member"
    },
    {
      "name": "bpattack",
      "longname": "DoughVoice#bpattack",
      "kind": "member"
    },
    {
      "name": "bpdecay",
      "longname": "DoughVoice#bpdecay",
      "kind": "member"
    },
    {
      "name": "bpsustain",
      "longname": "DoughVoice#bpsustain",
      "kind": "member"
    },
    {
      "name": "bprelease",
      "longname": "DoughVoice#bprelease",
      "kind": "member"
    },
    {
      "name": "cutoff",
      "longname": "DoughVoice#cutoff",
      "kind": "member"
    },
    {
      "name": "hcutoff",
      "longname": "DoughVoice#hcutoff",
      "kind": "member"
    },
    {
      "name": "bandf",
      "longname": "DoughVoice#bandf",
      "kind": "member"
    },
    {
      "name": "coarse",
      "longname": "DoughVoice#coarse",
      "kind": "member"
    },
    {
      "name": "crush",
      "longname": "DoughVoice#crush",
      "kind": "member"
    },
    {
      "name": "distort",
      "longname": "DoughVoice#distort",
      "kind": "member"
    },
    {
      "name": "freq",
      "longname": "DoughVoice#freq",
      "kind": "member"
    },
    {
      "name": "note",
      "longname": "DoughVoice#note",
      "kind": "member"
    },
    {
      "name": "_lpf",
      "longname": "DoughVoice#_lpf",
      "kind": "member"
    },
    {
      "name": "_hpf",
      "longname": "DoughVoice#_hpf",
      "kind": "member"
    },
    {
      "name": "_bpf",
      "longname": "DoughVoice#_bpf",
      "kind": "member"
    },
    {
      "name": "_chorus",
      "longname": "DoughVoice#_chorus",
      "kind": "member"
    },
    {
      "name": "_coarse",
      "longname": "DoughVoice#_coarse",
      "kind": "member"
    },
    {
      "name": "_crush",
      "longname": "DoughVoice#_crush",
      "kind": "member"
    },
    {
      "name": "_distort",
      "longname": "DoughVoice#_distort",
      "kind": "member"
    },
    {
      "name": "DoughVoice",
      "longname": "DoughVoice#DoughVoice",
      "params": [
        {
          "type": {
            "names": [
              "DoughVoice"
            ]
          },
          "name": "value"
        }
      ],
      "kind": "class"
    },
    {
      "name": "transpose",
      "longname": "Pattern.transpose",
      "description": "<p>Change the pitch of each value by the given amount. Expects numbers or note strings as values.\nThe amount can be given as a number of semitones or as a string in interval short notation.\nIf you don't care about enharmonic correctness, just use numbers. Otherwise, pass the interval of\nthe form: ST where S is the degree number and T the type of interval with</p>\n<ul>\n<li>M = major</li>\n<li>m = minor</li>\n<li>P = perfect</li>\n<li>A = augmented</li>\n<li>d = diminished</li>\n</ul>\n<p>Examples intervals:</p>\n<ul>\n<li>1P = unison</li>\n<li>3M = major third</li>\n<li>3m = minor third</li>\n<li>4P = perfect fourth</li>\n<li>4A = augmented fourth</li>\n<li>5P = perfect fifth</li>\n<li>5d = diminished fifth</li>\n</ul>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "number"
            ]
          },
          "description": "<p>Either number of semitones or interval string.</p>",
          "name": "amount"
        }
      ],
      "examples": [
        "\"c2 c3\".fast(2).transpose(\"<0 -2 5 3>\".slow(2)).note()",
        "\"c2 c3\".fast(2).transpose(\"<1P -2M 4P 3m>\".slow(2)).note()"
      ],
      "synonyms": [
        "trans"
      ],
      "synonyms_text": "trans",
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "scaleTranspose",
      "longname": "Pattern.scaleTranspose",
      "description": "<p>Transposes notes inside the scale by the number of steps.\nExpected to be called on a Pattern which already has a {@link Pattern#scale}</p>",
      "params": [
        {
          "type": {
            "names": [
              "offset"
            ]
          },
          "description": "<p>number of steps inside the scale</p>",
          "name": "offset"
        }
      ],
      "examples": [
        "\"-8 [2,4,6]\"\n.scale('C4 bebop major')\n.scaleTranspose(\"<0 -1 -2 -3 -4 -5 -6 -4>\")\n.note()"
      ],
      "synonyms": [
        "scaleTrans",
        "strans"
      ],
      "synonyms_text": "scaleTrans, strans",
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "scale",
      "longname": "scale",
      "description": "<p>Turns numbers into notes in the scale (zero indexed) or quantizes notes to a scale.</p>\n<p>When describing notes via numbers, note that negative numbers can be used to wrap backwards\nin the scale as well as sharps or flats to produce notes outside of the scale.</p>\n<p>Also sets scale for other scale operations, like {@link Pattern#scaleTranspose}.</p>\n<p>A scale consists of a root note (e.g. <code>c4</code>, <code>c</code>, <code>f#</code>, <code>bb4</code>) followed by semicolon (':') and then a <a href=\"https://github.com/tonaljs/tonal/blob/main/packages/scale-type/data.ts\">scale type</a>.</p>\n<p>The scale name must be written without spaces (because it would be interpreted as a multi-step pattern otherwise).\nIf your scale name includes spaces, replace them with colons.</p>\n<p>The root note defaults to octave 3, if no octave number is given.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>Name of scale</p>",
          "name": "scale"
        }
      ],
      "examples": [
        "n(\"0 2 4 6 4 2\").scale(\"C:major\")",
        "n(\"[0,7] 4 [2,7] 4\")\n.scale(\"C:<major minor>/2\")\n.s(\"piano\")",
        "n(rand.range(0,12).segment(8))\n.scale(\"C:ritusen\")\n.s(\"piano\")",
        "n(\"<[0,7b] [-4# -4] [-2,7##] 4 [0,7] [-4# -4b] [-2,7###] 4b>*4\")\n.scale(\"C:<major minor>/2\")\n.s(\"piano\")",
        "note(\"C1*16\").transpose(irand(36)).scale('Cb2 major').scaleTranspose(3)",
        "n(\"[0 0] [1 2] [3 4] [5 6]\").scale(\"C:major:blues\")"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "addVoicings",
      "longname": "Pattern.addVoicings",
      "description": "<p>Adds a new custom voicing dictionary.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>identifier for the voicing dictionary</p>",
          "name": "name"
        },
        {
          "type": {
            "names": [
              "Object"
            ]
          },
          "description": "<p>maps chord symbol to possible voicings</p>",
          "name": "dictionary"
        },
        {
          "type": {
            "names": [
              "Array"
            ]
          },
          "description": "<p>min, max note</p>",
          "name": "range"
        }
      ],
      "examples": [
        "addVoicings('cookie', {\n  7: ['3M 7m 9M 12P 15P', '7m 10M 13M 16M 19P'],\n  '^7': ['3M 6M 9M 12P 14M', '7M 10M 13M 16M 19P'],\n  m7: ['8P 11P 14m 17m 19P', '5P 8P 11P 14m 17m'],\n  m7b5: ['3m 5d 8P 11P 14m', '5d 8P 11P 14m 17m'],\n  o7: ['3m 6M 9M 11A 15P'],\n  '7alt': ['3M 7m 10m 13m 15P'],\n  '7#11': ['7m 10m 13m 15P 17m'],\n}, ['C3', 'C6'])\n\"<C^7 A7 Dm7 G7>\".voicings('cookie').note()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "voicings",
      "longname": "Pattern.voicings",
      "description": "<p>DEPRECATED: still works, but it is recommended you use .voicing instead (without s).\nTurns chord symbols into voicings, using the smoothest voice leading possible.\nUses <a href=\"https://github.com/felixroos/chord-voicings#chord-voicings\">chord-voicings package</a>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>which voicing dictionary to use.</p>",
          "name": "dictionary"
        }
      ],
      "examples": [
        "stack(\"<C^7 A7 Dm7 G7>\".voicings('lefthand'), \"<C3 A2 D3 G2>\").note()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "rootNotes",
      "longname": "Pattern.rootNotes",
      "description": "<p>Maps the chords of the incoming pattern to root notes in the given octave.</p>",
      "params": [
        {
          "type": {
            "names": [
              "octave"
            ]
          },
          "description": "<p>octave to use</p>",
          "name": "octave"
        }
      ],
      "examples": [
        "\"<C^7 A7 Dm7 G7>\".rootNotes(2).note()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "voicing",
      "longname": "voicing",
      "description": "<p>Turns chord symbols into voicings. You can use the following control params:</p>\n<ul>\n<li><code>chord</code>: Note, followed by chord symbol, e.g. C Am G7 Bb^7</li>\n<li><code>dict</code>: voicing dictionary to use, falls back to default dictionary</li>\n<li><code>anchor</code>: the note that is used to align the chord</li>\n<li><code>mode</code>: how the voicing is aligned to the anchor\n<ul>\n<li><code>below</code>: top note &lt;= anchor</li>\n<li><code>duck</code>: top note &lt;= anchor, anchor excluded</li>\n<li><code>above</code>: bottom note &gt;= anchor</li>\n</ul>\n</li>\n<li><code>offset</code>: whole number that shifts the voicing up or down to the next voicing</li>\n<li><code>n</code>: if set, the voicing is played like a scale. Overshooting numbers will be octaved</li>\n</ul>\n<p>All of the above controls are optional, except <code>chord</code>.\nIf you pass a pattern of strings to voicing, they will be interpreted as chords.</p>",
      "examples": [
        "n(\"0 1 2 3\").chord(\"<C Am F G>\").voicing()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "fscope",
      "longname": "fscope",
      "description": "<p>Renders an oscilloscope for the frequency domain of the audio signal.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>line color as hex or color name. defaults to white.</p>",
          "name": "color"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>scales the y-axis. Defaults to 0.25</p>",
          "name": "scale"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>y-position relative to screen height. 0 = top, 1 = bottom of screen</p>",
          "name": "pos"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>y-axis alignment where 0 = top and 1 = bottom</p>",
          "name": "lean"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>min value</p>",
          "name": "min"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>max value</p>",
          "name": "max"
        }
      ],
      "examples": [
        "s(\"sawtooth\").fscope()"
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "scope",
      "longname": "scope",
      "description": "<p>Renders an oscilloscope for the time domain of the audio signal.</p>",
      "params": [
        {
          "type": {
            "names": [
              "object"
            ]
          },
          "description": "<p>optional config with options:</p>",
          "name": "config"
        },
        {
          "type": {
            "names": [
              "boolean"
            ]
          },
          "description": "<p>if 1, the scope will be aligned to the first zero crossing. defaults to 1</p>",
          "name": "align"
        },
        {
          "type": {
            "names": [
              "string"
            ]
          },
          "description": "<p>line color as hex or color name. defaults to white.</p>",
          "name": "color"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>line thickness. defaults to 3</p>",
          "name": "thickness"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>scales the y-axis. Defaults to 0.25</p>",
          "name": "scale"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>y-position relative to screen height. 0 = top, 1 = bottom of screen</p>",
          "name": "pos"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>amplitude value that is used to align the scope. defaults to 0.</p>",
          "name": "trigger"
        }
      ],
      "examples": [
        "s(\"sawtooth\")._scope()"
      ],
      "synonyms": [
        "tscope"
      ],
      "synonyms_text": "tscope",
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "spectrum",
      "longname": "spectrum",
      "description": "<p>Renders a spectrum analyzer for the incoming audio signal.</p>",
      "params": [
        {
          "type": {
            "names": [
              "object"
            ]
          },
          "description": "<p>optional config with options:</p>",
          "name": "config"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>line thickness in px (default 3)</p>",
          "name": "thickness"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>scroll speed (default 1)</p>",
          "name": "speed"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>min db (default -80)</p>",
          "name": "min"
        },
        {
          "type": {
            "names": [
              "integer"
            ]
          },
          "description": "<p>max db (default 0)</p>",
          "name": "max"
        }
      ],
      "examples": [
        "n(\"<0 4 <2 3> 1>*3\")\n.off(1/8, add(n(5)))\n.off(1/5, add(n(7)))\n.scale(\"d3:minor:pentatonic\")\n.s('sine')\n.dec(.3).room(.5)\n._spectrum()"
      ],
      "kind": "member",
      "tags": [
        "visualization"
      ]
    },
    {
      "name": "tune",
      "longname": "Pattern.tune",
      "description": "<p>Assumes pattern contains numerical scale degrees on the <code>i</code> control (see examples below). Accepts a scale name or list of frequencies (see all available names at the link on the reference). Returns a new pattern with all values mapped to a frequency ratio. Similar to <code>xen</code>.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Array.<number>"
            ]
          },
          "name": "scale"
        }
      ],
      "examples": [
        "i(\"0 1 2 3 4 5\").tune(\"hexany15\").mul(\"220\").freq()",
        "// You can set your root to be a\n// particular note with getFreq:\ni(\"4 8 9 10 - - 5 7 9 11 - -\").tune(\"tranh3\")\n  .mul(getFreq('c3'))\n  .freq().clip(.5).room(1)",
        "// You can also give tune a list of\n// frequencies to use as the scale:\ni(\"0 1 2 3 4\").tune([\n  261.6255653006,\n  302.72962012827,\n  350.29154279212,\n  405.32593044476,\n  469.00678383895,\n  523.2511306012\n]).mul(220).freq();"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "xen",
      "longname": "Pattern.xen",
      "description": "<p>Assumes a numerical pattern of scale steps, and a scale. Scales accepted are all preset scale names of <code>tune</code>, arbitrary edos such as 31edo, or an array of frequency ratios. Assumes scales repeat at octave (2/1). Returns a new pattern with all values mapped to their associated frequency, assuming a base frequency of 220hz.</p>",
      "params": [
        {
          "type": {
            "names": [
              "string",
              "Array.<number>"
            ]
          },
          "name": "scaleNameOrRatios"
        }
      ],
      "examples": [
        "// A minor triad in 31edo:\ni(\"0 8 18\").xen(\"31edo\").piano()",
        "// You can also use xen with frequency ratios.\n// This is equivalent to the above:\ni(\"0 1 2\").xen([\n  Math.pow(2, 0/31),\n  Math.pow(2, 8/31),\n  Math.pow(2, 18/31),\n]).piano()",
        "// xen also supports all scale names that\n// tune does:\ni(\"0 1 2 3 4 5\").xen(\"hexany15\")\n// equiv to:\n// \"0 1 2 3 4 5\".tune(\"hexany15\").mul(\"220\").freq()",
        "i(\"0 1 2 3 4 5 6 7\").xen(\"<5edo 10edo 15edo hexany15>\")"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "withBase",
      "longname": "withBase",
      "description": "<p>Assumes pattern of frequencies tuned to some <code>base</code> frequency, such as the output of <code>xen</code>\nBecause <code>xen</code> defaults to <code>220Hz</code>, so will <code>withBase</code>.\nbut you can specify a different original base with the standard optional array syntax '<code>:</code>'</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "base"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>originalBase</p>",
          "name": "(optional)"
        }
      ],
      "examples": [
        "i(\"[0 1 2 3] [3 4] [4 3 2 1]\").xen(\"hexany23\").withBase(\"<220 [300 200]>\")",
        "mini([1 / 1, 16 / 15, 9 / 8, 6 / 5, 5 / 4].join(' ')).withBase(\"220:1\")\n// mini([1 / 1, 16 / 15, 9 / 8, 6 / 5, 5 / 4].join(' ')).mul(220).freq()"
      ],
      "kind": "member",
      "tags": [
        "tonal"
      ]
    },
    {
      "name": "ftranspose",
      "longname": "ftranspose",
      "description": "<p>Frequency transpose. Assumes pattern either has <code>freq</code> set, or has values that can be interpreted as frequencies\namt has optional <code>edoSize</code> param, defaults to 12.\nIf haps have edoSize param set, such as from the output of <code>xen(&quot;31edo&quot;)</code>,\n<code>ftrans</code> will fallback to that instead of 12 as the default.</p>\n<p>Transposes the frequency by <code>amt</code> edoSteps</p>",
      "params": [
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "name": "amt"
        },
        {
          "type": {
            "names": [
              "number"
            ]
          },
          "description": "<p>(optional)</p>",
          "name": "edoSize"
        }
      ],
      "examples": [
        "i(\"0 1 2\").xen(\"12edo\").ftrans(\"7\")\n// n(\"0 1 2\").scale(\"A:chromatic\").trans(\"7\")",
        "i(\"0 8 18\").xen(\"31edo\").ftrans(\"<8 -8>\")",
        "// to transpose by steps of an edo, use \"step:edo\" :\ni(\"0 7 8 18\").xen(\"31edo\").ftrans(\"<0 1:31 1:12>\")",
        "// it can also work with frequency values directly\nfreq(\"200 300 400\").ftrans(\"<0 7:31 7>\")"
      ],
      "synonyms": [
        "ftrans",
        "fTrans",
        "ftranspose",
        "fTranspose"
      ],
      "synonyms_text": "ftrans, fTrans, ftranspose, fTranspose",
      "kind": "member",
      "tags": [
        "tonal"
      ]
    }
  ]
};
