## Section 19 — Audio and MIDI Output

GXW produces sound internally via the Web Audio API. The default synthesis engine is **superdough** — the Web Audio sampler-and-synth originally built for Strudel and published as a standalone npm package with no dependency on Strudel itself. Adopting superdough gives GXW an immediate rich sound palette without specifying a voice bank from scratch: a built-in sample map covering the tidal-drum-machines library (TR808, TR909, LinnDrum, and similar, accessible through short names like `bd`, `sd`, `hh`, `cp` with bank prefixes), the VCSL orchestral instrument samples, and over 1000 AKWF wavetables; subtractive and FM synthesis with selectable waveforms (sine, sawtooth, square, triangle, plus pink/white/brown noise and crackle); an effect catalogue covering filters with envelopes, convolution reverb with generated impulse responses, phaser, delay, sidechain ducking, and the Dirt-inheritance effects vowel, crush, coarse, and shape; and arbitrary sample loading from any URL, with a `github:user/repo` shorthand for repositories that publish a `strudel.json` manifest. Sample loading is lazy: maps load at init while individual audio files load on first playback, keeping the runtime cost low until a sound is actually used.

A GXW preferences panel lets the user choose among superdough's voice categories and adjust output levels. Behaviours request voices through the parameter shape superdough uses internally (`{s: "bd"}`, `{s: "sawtooth", note: 60}`, and so on); GXW's musical-event format is a thin wrapper over that parameter object.

The choice to adopt superdough is independent of the Strudel pattern-engine commitments documented in Section 27. superdough is its own npm package with no Strudel dependencies, so GXW installs and uses it on its own without pulling in any Strudel pattern code. Section 27 documents the packaging boundaries and the staged adoption plan.

For composers who want to drive external synthesisers or DAWs, GXW supports Web MIDI output on browsers that implement it (Chrome, Edge, and Firefox recent versions). Safari lacks Web MIDI support at time of writing; on Safari, superdough is the only output option. The sketch specifies an output preference in setup():

```javascript
function setup() {
    bpm(120);
    output("internal");  // or output("midi", "IAC Bus 1");
}
```

Audio timing is scheduled against AudioContext.currentTime with a lookahead window. Events are scheduled a few frames ahead and fire at precise audio-clock times, producing sub-millisecond timing accuracy regardless of browser frame rate jitter.

Future direction. superdough's authors are exploring single-AudioWorklet implementations of the engine (the **supradough** and **dough** projects) that consolidate its many Web Audio nodes into a single signal-processing thread. These remain experimental as of this revision, but the migration path is well-defined within superdough's own roadmap, so GXW would inherit any stabilised improvement automatically when it lands.
