## Section 27 — Strudel and Tonal Integration

### Direction

GXW commits to Strudel as its pattern-based event-generation engine and audio engine, and to Tonal as its music-theory operations library. Strudel bundles superdough as its sound source, so this single dependency choice supplies both the rhythmic-and-melodic substrate (mini-notation, pattern algebra, voice-led chord progressions) and the rich palette of synthesised and sampled sounds. Tonal supplies notes, scales, chords, intervals, keys, modes, and progressions; it is consumed both directly and through Strudel's `@strudel/tonal` operators (`.scale()`, `.voicing()`, `.transpose()`).

This direction reshapes the v2.5 work. The Paths-and-Sprites collapse from earlier v2.5 lock-ins is bundled with Strudel adoption as one v2.5 revision, because the two changes interact heavily.

### Two parallel ways to produce events

An active object — a path's bound sprite, or a free sprite — produces events through one of two surfaces, and each composition picks per object which surface fits.

The declarative surface is the Cycle Pattern field: a Strudel mini-notation string with chained operators and signals composed in. Cycle Pattern handles the 80–95% case where the composer authors a structure once and lets scene state modulate values. It is the primary authoring surface and most objects use only this.

The procedural surface is the Motion Update callback, which the engine calls per tick on every active sprite. Motion Update is the GeoSonix-style auto-message: the composer constructs each event from scratch in JavaScript, schedules the next event whenever they like, and reads scene state directly. Motion Update covers the cases Cycle Pattern cannot reach — conditional firing based on inequalities, scene-state-driven beat rate, fully procedural construction of timbre, note, duration, and amplitude per event, edge detection on image gradients.

The two surfaces are peers. They run independently when both are populated; an object can use both, either, or neither. Overlapping events at the same instant from the two sources mix in the audio output, and composers manage the layering through their compositional choices (different timbres, panning, gain).

### Cycle Pattern as the declarative surface

Every active object carries a Cycle Pattern field: a Strudel mini-notation string, optionally with chained operators. The Cycle Pattern is the object's declarative output; it replaces the active-beats string, strength string, beat-points mode, and Euclidean parameters that v2.4 carried as separate fields in Band 5. Mini-notation expresses everything those fields expressed and more, more concisely: rests with `~`, sub-divisions with `[a b]`, alternation across cycles with `<a b c>`, repetition with `*N`, slot weighting with `@N`, Euclidean rhythms with `(n,k)`, polymeters with `{a b, c d}`. The two parallel cycles (active-beats and strength) become two parallel patterns composed through the chained API, e.g. `note("c d e f").gain("0.9 0.5 0.3 0.7")`.

Strudel's chained operators give the composer transformations that GXW would otherwise have to invent: `.fast(N)`, `.slow(N)`, `.every(N, fn)`, `.rev()`, `.chunk(N, fn)`, `.iter(N)`, `.scramble`, `.degradeBy(amount)`, plus the Tonal-backed operators `.scale(...)`, `.chord(...)`, `.voicing(...)`, `.transpose(...)`. These are immediately available in Band 5 by typing them.

Sound emission is part of mini-notation. `s("bd hh sd hh")` plays superdough's drum samples; `note("c d e f").s("piano")` plays piano notes; the composer never has to define a callback for the basic case. The Cycle Pattern field is sufficient.

### Tempo and synchronisation

GXW carries a global BPM that serves as the synchronisation reference for all object cycles. cycleDuration on each object is a positive integer expressed in beats. The product of cycleDuration and the global beat duration gives each object's cycle length in wall-clock seconds, which is what the object's Strudel scheduler uses. Objects with co-prime cycleDuration values drift naturally against one another in time-locked but non-aligned ways, which is the expected and desirable behaviour for many compositions.

Within a cycle, internal event timing is fully Strudel's domain. The global BPM has no role in placing events inside a cycle; only the cycle's wall-clock duration depends on it. Composers writing patterns with non-uniform timing (Euclidean rhythms, weighted slots, swing) get exactly what mini-notation specifies, scaled to the cycle's wall-clock length.

Each object runs its own scheduler. The schedulers don't coordinate beyond reading the same global BPM; they each compute "next event time" independently from their own pattern and cycle length. This is feasible because Strudel's `@strudel/core` exposes pattern-query primitives that don't require a single global cycle counter.

Global BPM is itself modifiable at runtime. A score-level Transport control exposes BPM as a slider in the toolbar. Programmatic modulation is available through a writable global `globalBPM` that any Motion Update body can assign to:

```javascript
const motion_lumDrivenTempo = (ctx) => {
  globalBPM = 60 + ctx.lum * 120;  // dark = 60 BPM, bright = 180 BPM
  return { ax: 0, ay: 0 };
};
```

BPM changes take effect at the next event-scheduling computation, which means in-flight cycles re-time their pending events. Composers turning the dial or driving BPM from scene state hear the change immediately rather than waiting for the next cycle boundary. When multiple Motion Updates write to `globalBPM` in the same tick, last write wins; composers who want deterministic behaviour give only one sprite the tempo-master role.

Events fired through `play()` or `playOnce()` from Motion Update are atomic from the moment they fire — they continue at their scheduled audio rate regardless of subsequent BPM changes. The re-timing applies only to Cycle Pattern events whose firing is still in the future when BPM changes.

### Signals for scene-derived values

Scene state — image colour at the firing object's position, sprite velocity and position, harmony context — flows into patterns through Strudel's signal abstraction rather than through string substitution. A signal is a function of (time, firing object) that can be sampled at any moment and composed with patterns through the chained API exactly the same way Strudel's built-in `sine`, `saw`, `rand`, and `perlin` signals are.

GXW registers a standard signal set at scene load time, available as globals to every pattern. Image-colour signals derive from OKLCh, the perceptually-uniform colour space:

`imageLightness` — perceived brightness, calibrated so equal numerical changes correspond to equal perceived brightness changes
`imageChroma` — perceptual saturation, "how vivid versus grey"
`imageRedness` and `imageGreenness` — opposite ends of the red-green opponent axis (each is the negation of the other; composers pick whichever expression matches their intent)
`imageYellowness` and `imageBlueness` — opposite ends of the yellow-blue opponent axis (same inversion relationship)
`imageLum` — grayscale luminance, kept as a separate convenience field

Sprite kinematic signals: `spriteX`, `spriteY`, `spriteVx`, `spriteVy`, `spriteV` (scalar speed).

Harmony signals: `currentScale`, `currentChord`, `currentTonic`, `currentRoot` for the inherited harmony context.

The composer uses these in patterns the same way they'd use Strudel's own signals:

```
s("bd hh sd hh").gain(imageLum.range(0.2, 1))
note(imageLightness.range(60, 84)).s("piano").struct("x x ~ x x ~ x ~")
note("c d e f g a").s("piano").gain(imageRedness.range(0.3, 1)).pan(spriteX.range(-1, 1))
```

The mini-notation string itself stays vanilla Strudel. The signal is a value source composed in through the chained API, sampled at each event moment. The bridge that connects Strudel to GXW's per-object firing sets the firing-context (the object's position, velocity, scene reference) before pulling events for an object's pattern, so signals resolve against the right object automatically.

This is deliberately not a string-substitution mechanism. There is no `$lum` syntax, no pre-processor, no parser fork. Strudel's existing composition machinery does the work, and the surface the composer sees is the chained operator they already know from Strudel.

GXW exposes only OKLCh-derived perceptual colour as the standard colour-driven music vocabulary. Raw RGB is not exposed in the standard signal set. The redness/greenness and yellowness/blueness pairs encode the perceptual opponent axes that human vision actually uses, with the named signals letting composers pick whichever sign of each axis matches their compositional intent — `imageRedness` reads naturally for "music responds to red regions," `imageGreenness` for the inverted intent. Hue is not exposed as an angle; the opponent-axis projections give composers smooth values that don't suffer wraparound discontinuity when a sprite traverses the colour boundary at 0/360°. Composers who specifically want angular hue can compute it themselves with `Math.atan2(yellowness, redness)` in a defineSignal.

### Composer-defined custom signals

Beyond the standard set, composers define their own signals in behaviours.js using a `defineSignal` helper that absorbs the boilerplate. The signal's body is plain JavaScript: destructure whichever context fields you need, do whatever math you want, return a number.

```javascript
defineSignal('warmth',        ({redness, yellowness}) => (redness + yellowness) / 2);
defineSignal('intensity',     ({lightness, chroma})   => lightness * chroma);
defineSignal('cornerDist',    ({x, y})                => Math.hypot(16 - Math.abs(x), 12 - Math.abs(y)));
defineSignal('verticalDrift', ({y, vy})               => y * 0.5 + vy * 2);
defineSignal('threshLight',   ({lightness})           => lightness > 0.6 ? 1 : lightness > 0.3 ? 0.5 : 0);
```

Once defined, the signal name is available in every pattern in this score. Patterns reference it identically to a built-in: `note(warmth.range(60, 84)).s("piano").struct("x x ~ x x ~")`. Math functions are in scope, plus a small GXW helper library (smoothstep, lerp, clamp, fold, mirror, hypot) for common curve-shaping primitives. Closure-captured state in the formula is supported and is the way to express signals that need memory across events (smoothing, peak tracking, edge detection); the helper documentation includes examples.

`defineSignal` accepts either a formula function or a Strudel pattern, so signals can be built out of other signals using Strudel's algebra: `defineSignal('warmRed', imageRedness.mul(warmth))`.

This is where compositional creativity lives in many scores. In GeoMaestro the rich catalogue of named distortion functions (Volume, Pit, Dur, Pan, Time, Mer) was where composers expressed their non-linear, multi-input mappings of geometry and image data into musical parameters; in GXW that creative layer is the signal, and it lives in behaviours.js as small declarative formulas rather than as full callback functions with their own context-marshalling code.

### Motion Update as the procedural surface

Motion Update is the per-tick callback the engine calls on every active sprite. It plays three roles, often together:

Physics. The callback returns acceleration `{ax, ay}`. Free sprites use this for force-driven motion — wandering, attractors, image-gradient drift, custom integration. Path-bound sprites usually return zero acceleration since their position derives from the bound pattern's cycle position projected onto the path; their Motion Update body, if defined at all, is doing something else.

Procedural event production. The callback's body can call `playOnce(...)` or `play(...)` to fire whatever it wants — pitch from luminance, timbre selected from image colour, duration computed from gradient, amplitude driven by velocity. The composer constructs the entire event from scratch each tick.

Conditional firing. The composer evaluates an inequality and fires only when it holds — "play a note when redness rises above 0.5 in the rising direction," "fire when the sprite enters a region," "trigger when velocity exceeds a threshold." This is the edge-detection style of music GeoSonix supported and that pure Cycle Pattern composition cannot express.

A Motion Update body covering all three at once:

```javascript
const motion_redRising = (() => {
  let lastFireTime = -1;

  return (ctx) => {
    if (ctx.redness > 0.5 && ctx.dredness_ds > 0 && ctx.t - lastFireTime > 0.1) {
      const noteVal = 60 + ctx.redness * 24;
      const timbre = ctx.lightness > 0.5 ? "piano" : "bass";
      play({ s: timbre, note: noteVal, gain: 0.3 + ctx.redness * 0.7, duration: 0.3 });
      lastFireTime = ctx.t;
    }
    return { ax: 0, ay: 0 };
  };
})();
```

The IIFE wrapping captures private state (`lastFireTime`) that survives across ticks, scoped to this callback alone. When the same kind of detector runs on multiple sprites, each sprite's callback has its own independent state because each is a separate closure.

For composers who don't want IIFE syntax, the helper library provides `withState`:

```javascript
const motion_redRising = withState({ lastFireTime: -1 }, (ctx, state) => {
  if (ctx.redness > 0.5 && ctx.dredness_ds > 0 && ctx.t - state.lastFireTime > 0.1) {
    play({ s: "piano", note: 60 + ctx.redness * 24, gain: 0.7, duration: 0.3 });
    state.lastFireTime = ctx.t;
  }
  return { ax: 0, ay: 0 };
});
```

Same mechanism, slightly more discoverable for composers new to JavaScript closures. Both forms work; the helper exists for ergonomics.

The "scene-state-driven beat rate" pattern — where the inter-event interval varies with image colour or other state — is also expressible directly in Motion Update without an additional slot:

```javascript
const motion_lightDrivenBeat = withState({ nextBeatTime: 0 }, (ctx, state) => {
  if (ctx.t >= state.nextBeatTime) {
    play({ s: ctx.lightness > 0.5 ? "piano" : "bass", note: 60 + ctx.lightness * 24, gain: 0.7 });
    const interval = 0.2 + (1 - ctx.lightness) * 1.8;
    state.nextBeatTime = ctx.t + interval;
  }
  return { ax: 0, ay: 0 };
});
```

The composer schedules the next beat by writing a future time into state. The engine doesn't need a rate-multiplier slot; the callback's state IS the rate. Bright regions produce 0.2-second intervals, dark regions 2-second intervals, and the music compresses and stretches in time as the sprite navigates the image.

### Smoothed values and distance-derivatives in ctx

The Motion Update context carries two kinds of scene-state fields: smoothed values and their distance-derivatives. Both are computed by the engine, with EMA smoothing applied, so the composer never has to build the bookkeeping themselves.

Smoothed values are the standard scene fields after exponential-moving-average smoothing. Image-colour fields: `lightness`, `chroma`, `redness`, `greenness`, `yellowness`, `blueness`, `lum`. Kinematic fields: `x`, `y`, `vx`, `vy`, `v`. Smoothing suppresses sub-pixel jitter from image sampling and any high-frequency noise in physics, giving the composer values that vary at the perceptual scale of the music rather than at the noise floor of the simulation.

Distance-derivatives are first derivatives of the smoothed image fields with respect to arc length traversed: `dlightness_ds`, `dchroma_ds`, `dredness_ds`, `dgreenness_ds`, `dyellowness_ds`, `dblueness_ds`, `dlum_ds`. They describe how the image varies along the path the sprite is travelling, independent of speed. A sprite traversing the same path produces the same distance-derivative regardless of how fast it moves; only the timing of musical decisions made from that derivative changes with speed. This is almost always what composers want: the geometric gradient is the musical signal, and how fast they're hearing it should be controlled separately.

Time-derivatives `dlightness_dt`, `dredness_dt`, etc. are also exposed for the cases where wall-clock rate is what matters, but the documentation steers composers toward distance-derivatives as the default.

The smoothing time-constant for values and the smoothing distance-constant for derivatives are configurable, with score-global defaults tunable in the score's setup section and per-object override available in the sprite's JSON entry. Starting defaults are 100 ms time constant for smoothed values and 1 unit of arc length for distance-derivative smoothing; these will be tuned through real-composition experience.

For path-bound sprites at rest (cursor not advancing) and free sprites at rest (zero velocity), distance-derivatives are zero — there's no spatial gradient being traversed, so threshold-rising logic naturally pauses. This is the correct behaviour and matches the composer's mental model: no motion, no music driven by motion.

Composers can derive their own smoothed values and custom-shape derivatives via `defineSignal` with closure-captured state. The helper library ships a `defineSmoothedSignal(name, formula, { tau })` shorthand that absorbs the EMA boilerplate for common cases.

### Direct sound playback

For procedurally-fired single events, going through `playOnce(s("..."))` is more machinery than the case needs. The composer is constructing one sound with one set of parameters; building a one-element Strudel pattern just to play it once adds a layer that doesn't earn its keep. GXW exposes a direct path: `play(soundDescription)`, a thin wrapper over superdough's underlying single-event call.

```javascript
play({ s: "piano", note: 60 + ctx.redness * 24, gain: 0.7, duration: 0.3 });
play({ s: "bd", gain: 0.5, duration: 0.2 });
play({ s: "strings", note: "c4", gain: 0.4, duration: 1.5, room: 0.6, cutoff: 800 });
```

The argument is a sound description with the same field set Strudel events ultimately produce — `s` for the sound source, `note` for pitch, `gain` for amplitude, `duration` for hold time in seconds, plus the full set of effect parameters (`pan`, `cutoff`, `resonance`, `attack`, `release`, `room`, `delay`, and the rest). The wrapper handles the firing-context bookkeeping and routes through the same audio output path that patterns use, so volume, mute, and MIDI routing settings apply uniformly.

Motion Update bodies that fire conditionally on a single sound are usually clearer with `play` than with `playOnce`:

```javascript
function motion_redRising(ctx) {
  if (ctx.redness > 0.5 && ctx.dredness_ds > 0) {
    play({ s: "piano", note: 60 + ctx.redness * 24, gain: 0.7, duration: 0.3 });
  }
  return { ax: 0, ay: 0 };
}
```

The two helpers cover different needs. `play` is for single events with all parameters known at the call site — concise, no pattern infrastructure, no chained-operator thinking. `playOnce` is for multi-event flourishes or pattern-shaped responses where the composer wants Strudel's algebra (`.fast`, `.every`, signals composed in) to do work. Both are first-class; the composer picks whichever fits the case.

### Collision response: Has Hit and Been Hit

Two collision callbacks remain on every sprite, both fired by geometric events the engine detects (one object's cursor sweeping another's center).

Has Hit fires on the sprite whose cursor caused the sweep. Been Hit fires on the sprite whose center was swept.

Both typically play a sound or pattern via `play` or `playOnce`. The pattern can use signals, chained operators, anything mini-notation expresses; the only thing that distinguishes a hit-response pattern from a Cycle Pattern is one-shot vs. looping playback.

```javascript
function hasHit_default(ctx) {
  play({ s: "piano", note: "c4", gain: 0.7, duration: 0.5 });
}

function hasHit_drumFlourish(ctx) {
  playOnce(s("bd [hh hh] sn hh").gain(0.7));
}
```

When a slot is empty in the inspector, the default is silence — no error, normal authoring state. When a slot names a handler that doesn't exist in behaviours.js, or a handler that throws during execution, the engine flags a runtime error in the console identifying which object, which slot, and which name failed to resolve, and produces no sound for that call. The inspector's Create button generates a boilerplate stub with the right signature, so the typical authoring loop is "name the handler, click Create, fill in the body."

### Cycle durations and one-shot durations

cycleDuration governs the autonomous Cycle Pattern field's cycle. The Cycle Pattern's events spread across this duration; the cursor on a path advances through one Strudel cycle in cycleDuration beats. cycleDuration is a positive integer in the object's beat units. cycleDuration lives on the sprite; for a path-bound sprite it lives in the path's JSON entry alongside the bound sprite's other properties, for a free sprite at the top level of the sprite's entry.

For path-bound sprites, cursor position and Cycle Pattern cycle position are unified: the cursor advances along the path at exactly the rate the pattern cycles. cycleDuration governs both. The cursor's geometric position at any moment IS the visualisation of where the pattern is in its cycle; there is no separate cursor-speed control. A composer who wants "fast cursor, slow rhythm" writes a pattern with sparse events on a short cycle; a composer who wants "slow cursor, fast rhythm" writes a dense pattern on a long cycle. The decoupling lives in the pattern density, not in two separate rate dials.

One-shot duration for hit responses and procedurally-fired patterns is not an object property. The `playOnce` helper takes a duration parameter that defaults to 1 beat in the firing object's beat units, so the simplest call — `playOnce(s("piano"))` — plays one piano note at the moment of firing. Composers who want a longer flourish pass the parameter explicitly, `playOnce(s("c d e f"), { beats: 2 })`, or use Strudel's `.slow(N)` operator on the pattern. Anchoring the default at 1 beat keeps responses naturally short, preventing long sustained passages from triggering on every collision or every Motion Update fire.

For `play(...)` calls, duration is a field in the sound description object expressed in seconds — composers writing `play({ s: "piano", note: 60, duration: 0.3 })` pick the wall-clock duration directly without thinking about beat units. This is the right surface for the procedural-event case where the composer is constructing each sound from scratch and wants direct control.

### Visualisation: beat points and breadcrumbs

Beat points remain a first-class visualisation, derived from the Cycle Pattern rather than from a separate authoring surface. The engine queries the pattern for one cycle's events, gets back their fractional positions within the cycle, and renders glyphs at those positions.

For path-bound sprites, the glyphs are placed along the path at the arc-length positions corresponding to the events' fractional positions within the cycle. The composer reading the canvas sees where in space each event will fire, what colour is under each glyph, and how the cursor will move through them on the next traversal — the GeoSonix anticipation workflow, preserved. Patterns with cycle-to-cycle variation (`<a b c>`, `.every(4, fn)`) update their glyph layout each cycle, making structural change visible as it happens. Probabilistic events (`degradeBy`, `?`) use a dimmer or outlined glyph treatment to indicate conditional firing. The default update rhythm queries the pattern once per cycle at the cycle boundary, which is correct for the great majority of patterns; patterns whose timing genuinely varies within a cycle update their glyphs at each event-fire.

For free sprites, beat points cannot be projected onto a path because there is no path. Instead the engine drops a fading breadcrumb at the sprite's position at each event-firing moment. Each breadcrumb glows briefly and fades over a configurable duration, leaving a phosphor-trail visualisation of the sprite's recent musical activity. The composer sees where the sprite was when each event fired, which gives retrospective insight comparable to the path-bound sprite's anticipatory glyphs. The breadcrumb fade time is a score-level setting with sensible default.

The two visualisation modes complement each other naturally: path-bound sprites show "here's where events will happen" in advance, free sprites show "here's where events did happen" in retrospect. Both serve the same authorial purpose — reading the canvas to understand the music — appropriate to what the composer can know about each kind of object's future.

### The composer's mental model

Patterns are the language for musical content, period. They appear in three places: the Cycle Pattern field expresses the object's autonomous declarative output, looped on cycleDuration; the Has Hit and Been Hit handlers express collision responses, played as one-shots via `play` or `playOnce`; the Motion Update body, when used procedurally, fires its own events constructed from scene state.

In all four firing sites the vocabulary is identical: Strudel mini-notation with chained operators, signals composed in for scene-derived values, the Tonal-backed harmony surface, the same helper library. Only the trigger differs — the cycle clock for the autonomous Cycle Pattern, geometric collision events for the hit handlers, the per-tick procedural callback for Motion Update.

For the 80–95% case the composer writes Cycle Pattern strings in the inspector and never opens behaviours.js. Sound, rhythm, melody, harmony, image-driven modulation are all expressible in chained mini-notation with signals. behaviours.js holds custom signal definitions, the small minority of Has Hit and Been Hit handlers, and Motion Update bodies for compositions that need procedural authoring.

### Audio output

Strudel includes superdough as its audio engine, so the embedded voice bank that Section 19 originally specified is largely replaced. superdough's drum machines, sample-based instruments, and effects become the default sound palette accessed through `s()` in patterns and through the `s` field in `play()` calls. MIDI routing for external destinations remains, exposed through `setup()` as before. Section 19 simplifies to a brief description of the Strudel-driven internal output plus the MIDI option.

superdough is more than a sample player. Underneath the sample-bank surface it provides a full subtractive synthesizer with the standard four basic oscillators (sine, sawtooth, square, triangle), three noise sources (white, pink, brown) usable as oscillators or blended with other sources via a wet/dry parameter, and a filter section (low-pass, high-pass, band-pass) with cutoff, resonance, and dedicated ADSR envelopes per filter. FM synthesis is built in as a second mode: any oscillator becomes a carrier, with modulator waveform selection, harmonicity ratio (controlling timbre — whole numbers natural, decimals metallic), modulation depth, and the modulator's own ADSR envelope. Wavetable synthesis is the third mode: any sample prefixed with `wt_` loads as a wavetable, with a default set of over a thousand wavetables (the AKWF set) shipping built in plus support for custom imports and scanning via loopBegin/loopEnd. ZZFX is integrated as a fourth engine for chiptune-style sounds. Effects available per voice include reverb (room, size), delay, distortion, bitcrush, chorus, compressor, vibrato, and post-gain.

The practical consequence for procedural authoring is that a `play(...)` call from Motion Update has access to the full synthesis palette through field assignments. A composer constructing per-event timbre from scene state can write `play({ s: "sawtooth", note: 60+ctx.lightness*24, lpf: 200+ctx.redness*3000, lpq: ctx.blueness*15, fm: ctx.greenness*8, fmh: 1+ctx.yellowness, room: ctx.chroma })` and every parameter is image-driven. This is a meaningfully larger creative space than sample playback alone, and it lands without GXW writing any synthesis code — superdough provides the engine, and the composer's procedural body just sets fields.

superdough is not a modular synth; you cannot build arbitrary signal graphs or wire your own operator topologies. For composers who need that depth, Strudel exposes a CSound integration as a separate path. For the great majority of scene-driven composition the built-in synthesis modes are more than sufficient.

### Inspector implications

The property inspector has four named regions, displayed top to bottom: the Identity band, the Geometry band, the Callback band, and the Cycle editor. The Cycle editor is the tallest region and is anchored at the bottom; the three short bands above it carry the metadata. Each region has a fixed vertical height that doesn't change with selection — the reflow rule preserves layout stability so composers under accessibility zoom can build muscle memory for where each field lives.

The Identity band carries name, mute, and hide.

The Geometry band carries the bounding box for paths and the visual fields (curveThickness, hide flag, cursor R, cursor L, cursorThickness, body size, body colour) when a path-and-bound-sprite is selected. For a free sprite it carries originX, originY, v0x, v0y, body size, body colour, and hide flag. v0x and v0y are starting velocity, mirroring origin's role for starting position.

The Callback band carries three handler-binding rows — Motion Update, Has Hit, Been Hit — each with a dropdown of named functions from behaviours.js whose names match the slot's prefix (`motion_*`, `hasHit_*`, `beenHit_*`), plus a Create button that scaffolds a stub function with the right signature when the field names something undefined.

The Cycle editor opens with a cycleDuration row at the top, then takes the rest of its vertical space for a multi-line CodeMirror Strudel editor. Strudel's own CodeMirror mode is used as the base, with a GXW completion layer that knows about the standard signals (image-colour, kinematics, harmony) and dynamically reads composer-defined signals from the defineSignal registry. The editor scrolls internally when patterns grow longer than the editor's fixed height. The Strudel pattern handles all rhythmic structure, sound emission, and value modulation that the cycle is meant to produce.

The behaviours.js editor uses a JavaScript-base CodeMirror mode with embedded Strudel mini-notation highlighting inside pattern function calls (`s()`, `note()`, `gain()`, `play()`, `playOnce()`, etc.) — Strudel's own setup, which already handles this mixed-content case correctly. The completion layer is shared with the Cycle editor, providing autocomplete for ctx fields, standard signals, defineSignal-registered signals, and the GXW helper library. Patterns look the same whether they're standalone in the Cycle editor or embedded in JavaScript in behaviours.js.

### Module additions

Three new modules join the dependency graph. StrudelRuntime wraps `@strudel/core`, `@strudel/mini`, and `@strudel/webaudio` (which contains superdough); owns the cycle scheduling that bridges Strudel's pattern clock to the Transport's beat clock, per object, and consumes the global BPM as the synchronisation reference. SignalRegistry registers GXW's standard signals at scene load time, exposes `defineSignal` for composer use, computes smoothed values and distance-derivatives, and holds the firing-context lookup the bridge sets per object. PlaybackHelpers contains the two playback functions: `playOnce` pulls one cycle of events from a Strudel pattern, schedules them through StrudelRuntime, and stops; `play` is the direct single-event wrapper over superdough. Both are used by Has Hit, Been Hit, and Motion Update bodies and available as globals to any composer code.

Tonal joins as a fourth dependency, both directly (its functions available to composer code in behaviours.js) and through `@strudel/tonal` for the Strudel-shaped harmony operators. Section 11's harmony helpers are reimplemented on Tonal in v2.5, replacing the placeholder primitives.

The Audio module shrinks to a thin layer over superdough's output. The Phrase module's role likely changes — it may remain as the shape Strudel events get translated into for Compositor consumption, or may be obsoleted entirely. Section 23 will be revised to reflect the new module set.

### Documentation

API.md grows a "Procedural authoring patterns" section covering at minimum: edge detection (rising, falling, both directions), scheduled events, threshold latching, hysteresis, counters and rate limiting, smoothed integrator, sequence stepping, and persistent random walk. Each pattern shown as a `withState`-wrapped Motion Update body or defineSignal formula, with brief commentary on what it does and how to adapt it. The standard signal vocabulary, the helper library, and the OKLCh perceptual colour space are documented alongside.

### Future directions

A handful of capabilities are out of scope for v2.5 but worth recording as natural extensions for later revisions.

Token-interpreting functions (`hit`, `trigger`, `region` and similar) are deferred. Patterns in v2.5 stay purely declarative; procedural authoring lives in Motion Update. If composition reveals a need to invoke named callbacks from within a pattern, the `register()` mechanism Strudel exposes makes adding such functions straightforward in a later revision.

Region concepts and region-derived signals depend on a regions feature that doesn't exist in v2.5. When regions are added as a scene-data concept, region-membership signals and `region(...)` token interpretation become a natural extension.

Default-handler sugar — letting an empty Has Hit slot automatically play the object's Cycle Pattern as a one-shot — is deferred. v2.5 ships with the silence-by-default rule and the Create button workflow. If composer feedback shows the friendly default would be valuable, a built-in `hasHit_playPattern` handler can be shipped in a later revision and surfaced in the inspector slot dropdown.

Several v2.4 cycle-shape parameters are deferred from v2.5: cycleSpeeds (per-cycle rate variation), beatOffset (starting fractional position within the cycle), and stopAtCycle (one-shot termination after N cycles). Strudel's mini-notation handles cycle-rate variation through `.fast`/`.slow` and through angle-bracket alternation across cycles, so cycleSpeeds has lost its main purpose; beatOffset and stopAtCycle have no direct mini-notation equivalent but are rare enough that adding them back when real compositions call for them is reasonable.

Modular audio synthesis beyond superdough's built-in subtractive, FM, wavetable, and ZZFX modes is available through Strudel's CSound integration but not promoted as a primary GXW path. Composers who need synthesis depth beyond superdough use CSound directly through Strudel.

### Status

Captured for v2.5. The Paths-and-Sprites collapse from earlier v2.5 lock-ins is bundled with this Strudel adoption as one revision. The next step is rippling these changes through the rest of the design document — Sections 1–26 each need an editing pass to reflect the v2.5 model.
