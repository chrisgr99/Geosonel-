## Section 27 — Strudel and Tonal Integration

### Direction

GXW commits to Strudel as its pattern-based event-generation engine and audio engine, and to Tonal as its music-theory operations library. Strudel bundles superdough as its sound source, so this single dependency choice supplies both the rhythmic-and-melodic substrate (mini-notation, pattern algebra, voice-led chord progressions) and the rich palette of synthesised and sampled sounds. Tonal supplies notes, scales, chords, intervals, keys, modes, and progressions; it is consumed both directly and through Strudel's `@strudel/tonal` operators (`.scale()`, `.voicing()`, `.transpose()`).

This direction reshapes the v2.5 work. The Paths-and-Sprites collapse from earlier v2.5 lock-ins is bundled with Strudel adoption as one v2.5 revision, because the two changes interact heavily.

### Two parallel ways to produce events

An active object — a path's bound sprite, or a free sprite — produces events through one of two surfaces, and each composition picks per object which surface fits.

The declarative surface is the cycle() function: a JavaScript function in behaviours.js that takes no arguments and returns a Strudel pattern. The sprite carries the function's name in its cycle slot; the runtime applies the sprite's cycleDuration as Strudel's `.slow` factor to the returned pattern, then schedules the events. The cycle() body is plain JavaScript, so mini-notation strings, chained operators, signals, Tonal helpers, and ordinary JavaScript expressions are all available inside it. The declarative shape handles the 80–95% case where the composer authors a structure once and lets scene state modulate values, and it is the primary authoring surface — most sprites use only this.

The procedural surface is the onTick() callback, which the engine calls per tick on every active sprite. onTick is the GeoSonix-style auto-message: the composer constructs each event from scratch in JavaScript, reads scene state directly, and fires events through `play(...)` or `playOnce(...)` whenever they like. onTick covers the cases the cycle function cannot reach — conditional firing based on inequalities, scene-state-driven beat rate, fully procedural construction of timbre, note, duration, and amplitude per event, edge detection on image gradients.

The two surfaces are peers. They run independently when both are populated; an object can use both, either, or neither. Overlapping events at the same instant from the two sources mix in the audio output, and composers manage the layering through their compositional choices (different timbres, panning, gain).

### The cycle function as the declarative surface

Every active sprite carries a cycle slot in its inspector entry: a string that names a function in behaviours.js. The named function takes no arguments and returns a Strudel pattern. At schedule time the runtime resolves the slot's name against the function map, calls the function to obtain a fresh pattern, applies `.slow(cycleDuration)` from the sprite's cycleDuration field, and queries the result for events to fire over the next cycle.

A trivial cycle function is one line: `const cycle_drum1 = () => s("bd hh sd hh");`. The function is plain JavaScript, so the body has full access to mini-notation strings, Strudel's chained operators and signals, the Tonal helpers, defineSignal-registered values, and any helper functions the composer has authored alongside it. There is no inspector text editor for patterns — pattern authoring lives in behaviours.js, where the composer has the full editor of their choice and the freedom to factor shared helpers across many cycle functions.

The cycle function replaces the active-beats string, strength string, beat-points mode, and Euclidean parameters that v2.4 carried as separate fields in Band 5. Mini-notation expresses everything those fields expressed and more, more concisely: rests with `~`, sub-divisions with `[a b]`, alternation across cycles with `<a b c>`, repetition with `*N`, slot weighting with `@N`, Euclidean rhythms with `(n,k)`, polymeters with `{a b, c d}`. The two parallel cycles (active-beats and strength) become two parallel patterns composed through the chained API:

```javascript
const cycle_lead = () => note("c d e f").gain("0.9 0.5 0.3 0.7").s("piano");
```

Strudel's chained operators give the composer transformations that GXW would otherwise have to invent: `.fast(N)`, `.slow(N)`, `.every(N, fn)`, `.rev()`, `.chunk(N, fn)`, `.iter(N)`, `.scramble`, `.degradeBy(amount)`, plus the Tonal-backed operators `.scale(...)`, `.chord(...)`, `.voicing(...)`, `.transpose(...)`. All of these are available inside the function body by typing them.

Sound emission is part of mini-notation. `s("bd hh sd hh")` plays superdough's drum samples; `note("c d e f").s("piano")` plays piano notes. The cycle function is sufficient for the basic case — the composer doesn't need an onTick body to produce sound.

Two adjustments at the inspector level let composers gate cycle output without losing the binding. The Can Cycle checkbox, when off, suspends the cycle function for that sprite without clearing the slot — the next time the box is checked, the same function resumes. The Rate field is the inspector surface for cycleDuration; values above 1 slow the pattern, values below 1 speed it up, and the default of 1 means the sprite cycles at the global CPS.

### Tempo and synchronisation

GXW carries a global CPS (cycles per second) that serves as the synchronisation reference for all sprite cycles. cycleDuration on each sprite is a positive number expressed as a multiple or fraction of the global rate, applied to the sprite's returned pattern in one of two branches. Values at or above 1 apply as `pattern.slow(cycleDuration)`: cycleDuration of 1 means "this sprite cycles at the same rate as the global clock", cycleDuration of 2 means "this sprite's cycle takes twice as long". Values below 1 apply as `pattern.compress(0, cycleDuration)`: the sub-pattern plays at faster-than-cycle rate within the fractional first portion of the global cycle and rests for the remainder, so cycleDuration of 0.5 packs one full pattern into the first half of each global cycle and is silent for the second half. Both branches share the same semantic meaning: cycleDuration is the duration of one full pattern measured in global cycles, with sub-1 values understood as patterns that occupy only part of a global cycle. Decimals are valid and meaningful throughout. Sprites with co-prime cycleDuration ratios (3 against 5, say) drift naturally against one another in time-locked but non-aligned ways, which is the expected and desirable behaviour for many compositions.

Within a cycle, internal event timing is fully Strudel's domain. The global CPS has no role in placing events inside a cycle; only the cycle's wall-clock duration depends on it. Composers writing patterns with non-uniform timing (Euclidean rhythms, weighted slots, swing) get exactly what mini-notation specifies, scaled to the cycle's wall-clock length.

GXW runs one unified scheduler that holds a stack pattern. Each sprite with a populated cycle slot contributes a sub-pattern to that stack; the scheduler queries the stack as a single Strudel pattern and dispatches the resulting events. The stack rebuilds whenever an inspector commit changes anything that affects the stack's shape: cycle bindings, the Can Cycle gate, the Mute toggle, cycleDuration changes, cyclePhase changes, or a scene reload. The clock is preserved across rebuilds — Strudel's setPattern swaps the active pattern under the scheduler without restarting the underlying cycle counter — so rebuilds are glitch-free.

Each sprite's contribution is wrapped in three layers before it joins the stack. cycleDuration is applied to the cycle function's returned pattern via the .slow or .compress branch described above. cyclePhase is then applied as `pattern.late(cyclePhase)` to offset the sub-pattern's phase within the global cycle (default 0, meaning no offset). The result is wrapped in a try/catch shim: an exception thrown by the cycle function or by any of these pattern operations falls back to silence for that sub-pattern rather than poisoning the whole stack, with the error logged against the sprite id so the composer can find and fix it; the rest of the score keeps playing.

cyclePhase is a per-sprite schema field, default 0, that lets composers stagger sprite phases without breaking the global tempo lock. Two sprites with the same cycleDuration but different cyclePhase values play the same pattern shape offset in time within each global cycle — useful for hocketing, call-and-response, or any composition where sprites should be locked in tempo but not in phase.

Source attribution is via a custom `_spriteId` control parameter applied to each sprite's sub-pattern before stacking. Haps emerging from the unified scheduler carry the originating sprite id, which is what lets the visualiser drop breadcrumbs against the right sprite, and what lets per-sprite settings (gain, pan, mute, MIDI routing) apply correctly even though the underlying scheduler is global.

The global CPS is modifiable at runtime through two complementary surfaces, and composers can use either, both, or neither. The Transport control exposes CPS as a slider in the toolbar for direct manual setting.

The declarative surface is an optional score-level cps() function in behaviours.js that returns a Strudel pattern. The runtime samples that pattern at tick rate, writes the sampled value into the writable `globalCPS` global, then after onTick bodies have run for the tick calls Strudel's `setcps(globalCPS)` once if the value has changed. The sample-and-setcps approach is necessary because patterning Strudel's CPS directly inside pattern algebra does not work in current Strudel — the scheduler resolves event timing against a single CPS value at scheduling time, not against per-event values. Sampling at tick rate gives composers smooth tempo modulation expressible in pattern algebra without depending on a feature Strudel's clock doesn't support. The cps() pattern can carry signals composed in, so tempo can be a smooth function of scene state:

```javascript
const cps = () => imageLightness.range(0.25, 1.5);
```

This expression makes the CPS drift between 0.25 and 1.5 cycles per second as the firing sprite traverses dark and bright regions of the image. Pattern algebra is available too: `imageLightness.range(0.25, 1.5).slow(8)` gives the same drift but spread across an eight-cycle window, and chaining onto a sine signal gives a sinusoidal tempo modulation independent of scene content.

The imperative surface is the same `globalCPS` global as a write target. Any onTick body can assign to it, including expressions that read the current value:

```javascript
const onTick_speedZone = (ctx) => {
  if (ctx.x > 0) globalCPS = globalCPS * 2;
  return { ax: 0, ay: 0 };
};
```

The two surfaces compose by layering: each tick the runtime samples cps() if it's defined, writes the result into globalCPS, then runs the onTick bodies in scene order. Any onTick may overwrite globalCPS, and the scheduler reads the final value at the end of the tick. Composers using only cps() get pure declarative behaviour; composers using only onTick writes get GeoSonix-style behaviour; composers using both get a patterned baseline that imperative bumps can lift away from momentarily. Last write wins when more than one onTick writes in the same tick, which in practice almost never matters; composers who want deterministic behaviour give a single sprite the tempo-master role.

CPS changes take effect at the next event-scheduling computation, which means in-flight cycles re-time their pending events. Composers turning the dial or driving CPS from scene state hear the change immediately rather than waiting for the next cycle boundary.

Events fired through `play()` or `playOnce()` from onTick or hit handlers are atomic from the moment they fire — they continue at their scheduled audio rate regardless of subsequent CPS changes. The re-timing applies only to events scheduled by cycle functions whose firing is still in the future when CPS changes.

Implementation note: as of Phase 3 commit 3, the user-set CPS surface (the Transport's CPS field) is honoured by scaling each sprite's cycleDuration during pattern construction rather than by calling Strudel's setcps. Investigation during commit 3 found setcps unreachable in the @strudel/web 1.0.3 umbrella the import map currently pins — the function is not registered as a window global, not exposed as a module export, and not surfaced inside evaluate's eval scope. A trial upgrade to 1.3.0 made setcps reachable through evaluate's eval scope but introduced a cyclist-takeover side effect that broke pause, so the upgrade was rolled back. The cycleDuration-scaling workaround multiplies cycleDuration by STRUDEL_DEFAULT_CPS / gxCps inside _buildSpritePattern's slow and compress calls, leaving Strudel's own scheduler CPS at its default and never written to. User-visible behaviour is identical to a real setcps for the manual-CPS-field surface. The patternable cps() function and the per-tick globalCPS-to-setcps loop described above remain the long-term design for Phase 5+ but depend on an upstream path to setcps becoming available; tracked on TODO.md. When real setcps lands, the cycleDuration-scaling workaround stays as the user-set CPS surface and real setcps drives the patternable cps() function — the two surfaces compose by layering, just as the original design specified.

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

The mini-notation string itself stays vanilla Strudel. The signal is a value source composed in through the chained API, sampled at each event moment. The bridge that connects Strudel to GXW's per-object firing is the SignalRegistry's firing-context pointer. Each sub-pattern's wrapper in the unified stack sets the pointer to its sprite id before delegating to queryArc and clears it after, in a try-finally block so an exception during query doesn't strand the pointer pointing at the failed sprite. While the pointer is set, signal lookups read context (position, velocity, scene reference, smoothed image fields) for that sprite, so signals resolve against the right object automatically.

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

Once defined, the signal is available in every pattern in this score under the `signals` namespace: `note(signals.warmth.range(60, 84)).s("piano").struct("x x ~ x x ~")`. The namespace prefix distinguishes composer-defined signals from GXW's built-in standard signals (imageLightness, spriteVx, currentScale, and the rest), which are bare globals in cycle context. The split keeps the compact bare-global form for the standard set composers reach for most often, and prevents custom-signal names from silently shadowing a built-in or clashing with a Strudel global. Math functions are in scope inside defineSignal formulas, plus a small GXW helper library (smoothstep, lerp, clamp, fold, mirror, hypot) for common curve-shaping primitives. Closure-captured state in the formula is supported and is the way to express signals that need memory across events (smoothing, peak tracking, edge detection); the helper documentation includes examples.

`defineSignal` accepts either a formula function or a Strudel pattern, so signals can be built out of other signals using Strudel's algebra: `defineSignal('warmRed', imageRedness.mul(signals.warmth))`. Built-in signals are referenced as bare globals; previously-defined custom signals are referenced through the `signals` namespace.

This is where compositional creativity lives in many scores. In GeoMaestro the rich catalogue of named distortion functions (Volume, Pit, Dur, Pan, Time, Mer) was where composers expressed their non-linear, multi-input mappings of geometry and image data into musical parameters; in GXW that creative layer is the signal, and it lives in behaviours.js as small declarative formulas rather than as full callback functions with their own context-marshalling code.

### onTick as the procedural surface

onTick is the per-tick callback the engine calls on every active sprite. It plays three roles, often together:

Physics. The callback returns acceleration `{ax, ay}`. Free sprites use this for force-driven motion — wandering, attractors, image-gradient drift, custom integration. Path-bound sprites usually return zero acceleration since their position derives from the bound pattern's cycle position projected onto the path; their onTick body, if defined at all, is doing something else.

Procedural event production. The callback's body can call `playOnce(...)` or `play(...)` to fire whatever it wants — pitch from luminance, timbre selected from image colour, duration computed from gradient, amplitude driven by velocity. The composer constructs the entire event from scratch each tick.

Conditional firing. The composer evaluates an inequality and fires only when it holds — "play a note when redness rises above 0.5 in the rising direction," "fire when the sprite enters a region," "trigger when velocity exceeds a threshold." This is the edge-detection style of music GeoSonix supported and that pure cycle-function composition cannot express.

An onTick body covering all three at once:

```javascript
const onTick_redRising = (() => {
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
const onTick_redRising = withState({ lastFireTime: -1 }, (ctx, state) => {
  if (ctx.redness > 0.5 && ctx.dredness_ds > 0 && ctx.t - state.lastFireTime > 0.1) {
    play({ s: "piano", note: 60 + ctx.redness * 24, gain: 0.7, duration: 0.3 });
    state.lastFireTime = ctx.t;
  }
  return { ax: 0, ay: 0 };
});
```

Same mechanism, slightly more discoverable for composers new to JavaScript closures. Both forms work; the helper exists for ergonomics.

The "scene-state-driven beat rate" pattern — where the inter-event interval varies with image colour or other state — is also expressible directly in onTick without an additional slot:

```javascript
const onTick_lightDrivenBeat = withState({ nextBeatTime: 0 }, (ctx, state) => {
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

The onTick context carries two kinds of scene-state fields: smoothed values and their distance-derivatives. Both are computed by the engine, with EMA smoothing applied, so the composer never has to build the bookkeeping themselves.

Smoothed values are the standard scene fields after exponential-moving-average smoothing. Image-colour fields: `lightness`, `chroma`, `redness`, `greenness`, `yellowness`, `blueness`, `lum`. Kinematic fields: `x`, `y`, `vx`, `vy`, `v`. Smoothing suppresses sub-pixel jitter from image sampling and any high-frequency noise in physics, giving the composer values that vary at the perceptual scale of the music rather than at the noise floor of the simulation.

Distance-derivatives are first derivatives of the smoothed image fields with respect to arc length traversed: `dlightness_ds`, `dchroma_ds`, `dredness_ds`, `dgreenness_ds`, `dyellowness_ds`, `dblueness_ds`, `dlum_ds`. They describe how the image varies along the path the sprite is travelling, independent of speed. A sprite traversing the same path produces the same distance-derivative regardless of how fast it moves; only the timing of musical decisions made from that derivative changes with speed. This is almost always what composers want: the geometric gradient is the musical signal, and how fast they're hearing it should be controlled separately.

Time-derivatives `dlightness_dt`, `dredness_dt`, etc. are also exposed for the cases where wall-clock rate is what matters, but the documentation steers composers toward distance-derivatives as the default.

The smoothing time-constant for values and the smoothing distance-constant for derivatives are configurable, with score-global defaults tunable in the score's setup section and per-object override available in the sprite's JSON entry. Starting defaults are 100 ms time constant for smoothed values and 1 unit of arc length for distance-derivative smoothing; these will be tuned through real-composition experience.

For path-bound sprites at rest (cursor not advancing) and free sprites at rest (zero velocity), distance-derivatives are zero — there's no spatial gradient being traversed, so threshold-rising logic naturally pauses. This is the correct behaviour and matches the composer's mental model: no motion, no music driven by motion.

Composers can derive their own smoothed values and custom-shape derivatives via `defineSignal` with closure-captured state. The helper library ships a `defineSmoothedSignal(name, formula, { tau })` shorthand that absorbs the EMA boilerplate for common cases.

Custom signals appear as plain ctx fields for callback-context reads, alongside the built-ins. In callback context there is no namespace distinction on the read side; both built-in and custom signals are top-level numeric values on ctx.

A small subset of signals is writable: the four harmony-context signals (currentScale, currentChord, currentTonic, currentRoot) plus any custom defineSignal signals. Callbacks write to them via `ctx.signals.name` rather than `ctx.name`: `ctx.signals.currentScale = "C major"`, `ctx.signals.warmth = 0.7`. The split keeps the bare ctx.x form unambiguously read-only and makes writes explicit at the call site.

### Direct sound playback

For procedurally-fired single events, going through `playOnce(s("..."))` is more machinery than the case needs. The composer is constructing one sound with one set of parameters; building a one-element Strudel pattern just to play it once adds a layer that doesn't earn its keep. GXW exposes a direct path: `play(soundDescription)`, a thin wrapper over superdough's underlying single-event call.

```javascript
play({ s: "piano", note: 60 + ctx.redness * 24, gain: 0.7, duration: 0.3 });
play({ s: "bd", gain: 0.5, duration: 0.2 });
play({ s: "strings", note: "c4", gain: 0.4, duration: 1.5, room: 0.6, cutoff: 800 });
```

The argument is a sound description with the same field set Strudel events ultimately produce — `s` for the sound source, `note` for pitch, `gain` for amplitude, `duration` for hold time in seconds, plus the full set of effect parameters (`pan`, `cutoff`, `resonance`, `attack`, `release`, `room`, `delay`, and the rest). The wrapper handles the firing-context bookkeeping and routes through the same audio output path that patterns use, so volume, mute, and MIDI routing settings apply uniformly.

play() applies a default scheduling deadline of 0.05 seconds rather than zero. This works around a known superdough behaviour where events with an exactly-zero deadline are sometimes dropped before reaching the audio output, particularly when several events fire on the same tick. Fifty milliseconds is small enough to be inaudible as latency on procedural triggers and large enough to reliably survive the dispatch path. Composers who specifically want a different deadline can override it via the sound description.

onTick bodies that fire conditionally on a single sound are usually clearer with `play` than with `playOnce`:

```javascript
function onTick_redRising(ctx) {
  if (ctx.redness > 0.5 && ctx.dredness_ds > 0) {
    play({ s: "piano", note: 60 + ctx.redness * 24, gain: 0.7, duration: 0.3 });
  }
  return { ax: 0, ay: 0 };
}
```

The two helpers cover different needs. `play` is for single events with all parameters known at the call site — concise, no pattern infrastructure, no chained-operator thinking. `playOnce` is for multi-event flourishes or pattern-shaped responses where the composer wants Strudel's algebra (`.fast`, `.every`, signals composed in) to do work. Both are first-class; the composer picks whichever fits the case.

### Collision response: hasHit and beenHit

Two collision callbacks remain on every sprite, both fired by geometric events the engine detects (one sprite's cursor sweeping another's center).

hasHit fires on the sprite whose cursor caused the sweep. beenHit fires on the sprite whose center was swept.

Both typically play a sound or pattern via `play` or `playOnce`. The pattern can use signals, chained operators, anything mini-notation expresses; the only thing that distinguishes a hit-response pattern from a cycle-function pattern is one-shot vs. looping playback.

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

cycleDuration governs the cycle function's cycle length on the sprite that owns it. The pattern's events spread across this duration; the cursor on a path advances through one Strudel cycle in `cycleDuration / globalCPS` wall-clock seconds. cycleDuration is a positive number expressed as a ratio against the global rate — 1 means same rate, 2 means twice as long, 0.5 means the pattern packs into the first half of each global cycle and rests for the second half (see Tempo and synchronisation for the .slow vs .compress branch detail). cycleDuration lives on the sprite; for a path-bound sprite it lives in the path's JSON entry alongside the bound sprite's other properties, for a free sprite at the top level of the sprite's entry.

cyclePhase is a per-sprite companion field, default 0, that offsets the sub-pattern's phase within the global cycle without affecting its rate. The runtime applies it as `pattern.late(cyclePhase)` after the cycleDuration branch and before stacking. Two sprites with the same cycleDuration but different cyclePhase values play the same pattern shape, time-locked to one another, but offset within the global cycle — useful for hocketing, call-and-response, or any composition where sprites should be locked in tempo but not in phase. cyclePhase lives on the sprite at the same JSON location as cycleDuration.

For path-bound sprites, cursor position and cycle phase are unified: the cursor advances along the path at exactly the rate the pattern cycles. cycleDuration governs both. The cursor's geometric position at any moment IS the visualisation of where the pattern is in its cycle; there is no separate cursor-speed control. A composer who wants "fast cursor, slow rhythm" writes a sparse pattern on a short cycle; a composer who wants "slow cursor, fast rhythm" writes a dense pattern on a long cycle. The decoupling lives in pattern density, not in two separate rate dials.

One-shot duration for hit responses and procedurally-fired patterns is not a sprite property. The `playOnce` helper takes a duration parameter for how many cycles to play; the simplest call — `playOnce(s("piano"))` — plays one cycle of the pattern from the moment of firing. Composers who want a longer flourish pass the parameter explicitly, `playOnce(s("c d e f"), { cycles: 2 })`, or use Strudel's `.slow(N)` operator on the pattern. Anchoring the default at a single cycle keeps the helper's expected unit consistent with the rest of the model: composers think in cycles, not beats.

For `play(...)` calls, duration is a field in the sound description object expressed in seconds — composers writing `play({ s: "piano", note: 60, duration: 0.3 })` pick the wall-clock duration directly without thinking about cycle units. This is the right surface for the procedural-event case where the composer is constructing each sound from scratch and wants direct control.

### Visualisation: breadcrumbs

GXW's per-event visualisation is a fading breadcrumb dropped at the firing sprite's position each time the cycle pattern produces an event, applied uniformly to path-bound and free sprites. Each breadcrumb glows briefly then fades over a configurable duration, leaving a phosphor-trail of the sprite's recent musical activity. The composer reads the canvas to see where the sprite was when each event fired, which gives enough geometric grounding to understand how the music maps to the image.

The two sprite kinds get the same retrospective visualisation. A path-bound sprite's cursor advances along the path and breadcrumbs land at the arc-length positions where events fired during recent cycles; a free sprite's breadcrumbs land wherever it was in canvas space at firing time. Behaviour is consistent across kinds, which keeps the composer's reading of the canvas uniform rather than asking them to switch mental models between path and free sprites. The breadcrumb fade duration is a score-level setting with a sensible default.

This is a deliberate departure from earlier section-27 designs that proposed beat-point glyphs derived from the cycle function's returned pattern, placed along the path in advance of firing. With Strudel's mini-notation and modifiers expressing rhythm internally, up-front glyph layout was less useful than expected — pattern algebra (`<a b c>`, `.every(4, fn)`, `degradeBy`) makes pre-firing positions either ambiguous or churn-prone, and the breadcrumb-everywhere story conveys the same geometric information after the fact without needing to query the pattern in advance.

A separate future direction is composer-authored beat points: explicit collidable points placed along a path that act like fixed sprites a cursor can hit. Unlike the dynamic-beat-points design this section previously proposed, authored beat points would be static under most circumstances — the score declares them and they don't change while the score plays, except under explicit procedural commands that ask to redefine them. This is an unbuilt feature recorded so the section's vocabulary doesn't leave a gap; tracked on TODO.md.

### The composer's mental model

Patterns are the language for musical content, period. They appear at four firing sites, all of them defined in behaviours.js: the cycle function expresses the sprite's autonomous declarative output, looped at cycleDuration; the hasHit and beenHit handlers express collision responses, played as one-shots via `play` or `playOnce`; the onTick body, when used procedurally, fires its own events constructed from scene state.

In all four firing sites the vocabulary is identical: Strudel mini-notation with chained operators, signals composed in for scene-derived values, the Tonal-backed harmony surface, the same helper library. Only the trigger differs — the cycle clock for the autonomous cycle function, geometric collision events for the hit handlers, the per-tick procedural callback for onTick.

The 80–95% case is the composer binding a cycle function on each sprite and writing the function body in behaviours.js as straightforward mini-notation. Sound, rhythm, melody, harmony, and image-driven modulation are all expressible inside the function body via chained mini-notation with signals composed in. The minority of compositions reach for hit handlers, onTick bodies, defineSignal expressions, and helper functions, all alongside the cycle definitions in the same behaviours.js file.

### Audio output

Strudel includes superdough as its audio engine, so the embedded voice bank that Section 19 originally specified is largely replaced. superdough's drum machines, sample-based instruments, and effects become the default sound palette accessed through `s()` in patterns and through the `s` field in `play()` calls. MIDI routing for external destinations remains, exposed through `setup()` as before. Section 19 simplifies to a brief description of the Strudel-driven internal output plus the MIDI option.

superdough is more than a sample player. Underneath the sample-bank surface it provides a full subtractive synthesizer with the standard four basic oscillators (sine, sawtooth, square, triangle), three noise sources (white, pink, brown) usable as oscillators or blended with other sources via a wet/dry parameter, and a filter section (low-pass, high-pass, band-pass) with cutoff, resonance, and dedicated ADSR envelopes per filter. FM synthesis is built in as a second mode: any oscillator becomes a carrier, with modulator waveform selection, harmonicity ratio (controlling timbre — whole numbers natural, decimals metallic), modulation depth, and the modulator's own ADSR envelope. Wavetable synthesis is the third mode: any sample prefixed with `wt_` loads as a wavetable, with a default set of over a thousand wavetables (the AKWF set) shipping built in plus support for custom imports and scanning via loopBegin/loopEnd. ZZFX is integrated as a fourth engine for chiptune-style sounds. Effects available per voice include reverb (room, size), delay, distortion, bitcrush, chorus, compressor, vibrato, and post-gain.

The practical consequence for procedural authoring is that a `play(...)` call from onTick has access to the full synthesis palette through field assignments. A composer constructing per-event timbre from scene state can write `play({ s: "sawtooth", note: 60+ctx.lightness*24, lpf: 200+ctx.redness*3000, lpq: ctx.blueness*15, fm: ctx.greenness*8, fmh: 1+ctx.yellowness, room: ctx.chroma })` and every parameter is image-driven. This is a meaningfully larger creative space than sample playback alone, and it lands without GXW writing any synthesis code — superdough provides the engine, and the composer's procedural body just sets fields.

superdough is not a modular synth; you cannot build arbitrary signal graphs or wire your own operator topologies. For composers who need that depth, Strudel exposes a CSound integration as a separate path. For the great majority of scene-driven composition the built-in synthesis modes are more than sufficient.

### Inspector implications

The property inspector has three named bands, displayed top to bottom: Identity, Geometry, and Behaviours. Each band has a fixed vertical height that doesn't change with selection — the reflow rule preserves layout stability so composers under accessibility zoom can build muscle memory for where each field lives.

The Identity band carries Object ID, Name, Mute, and Hide. ID and Name are editable for single-object selections only; Mute applies to any non-empty selection; Hide is path-only and greyed when no path is selected.

The Geometry band carries the visual and kinematic fields. For a path it carries Position (the bbox centroid), Path Size W/H, Curve Thickness, Cursor R/L, and Cursor Thickness. For a free sprite it carries Position (X/Y), Velocity (V0X/V0Y, the authored initial velocity), Sprite Size, and Color. Mixed selections grey out fields that aren't shared.

The Behaviours band carries six rows. Top to bottom: a Can Cycle checkbox plus Rate field on one row; the cycle() callback slot; a row carrying the Can Hit and Can Be Hit checkboxes side by side; the hasHit() callback slot; the beenHit() callback slot; the onTick() callback slot. Each callback slot has a label, a string field for the bound function name, and a Create button that scaffolds a stub function in behaviours.js with the correct signature when the named function doesn't yet exist; once the function exists the button label changes to indicate the function is bound.

The cycle() slot names a function in behaviours.js whose name conventionally matches `cycle_<sprite>`. The Rate field is the inspector surface for cycleDuration; values above 1 slow the pattern, values below 1 compress it into the fractional first portion of the global cycle (see Tempo and synchronisation for the .slow vs .compress branch detail), default 1 means same rate as the global CPS. A companion Phase field for cyclePhase is a planned addition to the band. Can Cycle gates the cycle function from running without clearing the slot binding. Can Hit and Can Be Hit gate hasHit and beenHit collision detection respectively, again without clearing the bindings — toggling the checkbox off preserves the function name in the slot for when the checkbox is toggled back on.

behaviours.js authoring is not handled in the inspector. The composer opens behaviours.js in their editor of choice and authors their cycle, hasHit, beenHit, onTick, defineSignal, and helper functions there. The inspector's role is binding sprite slots to functions by name; the function bodies themselves live in JavaScript and are edited as JavaScript. Strudel mini-notation strings inside those functions get whatever syntax highlighting the composer's editor offers, since `s("...")` and `note("...")` are just function calls with string arguments.

### Module additions

All Strudel and Tonal code reaches the browser through an import map in index.html, not through a bundler. The @strudel/web umbrella package — pinned to 1.0.3 and served from esm.sh as an ES module — is the primary loading path; it bundles core, mini, webaudio (which contains superdough), and the inter-package wiring into a single coherent module. Tonal is loaded as a separate import-map specifier from esm.sh for direct music-theory use in behaviours.js. The fallback path through jsdelivr, the @strudel/web umbrella as a global script tag from unpkg, and a self-hosted bundle is recorded as a contingency but not implemented; if esm.sh fails in a way the umbrella can't dodge, those fallbacks land as code at that time. Promoting the umbrella from fallback to primary reflects experience from the Phase 1 smoke test, where a four-package import-map configuration produced a duplicate-copies-of-core failure inside Strudel's scheduler that the umbrella cleanly avoids.

Three new internal modules join the dependency graph. StrudelRuntime wraps `@strudel/web`; it owns the unified scheduler that holds the stack pattern, the per-sprite sub-pattern wrappers (cycleDuration, cyclePhase, try/catch, _spriteId attribution), and the bridge between Strudel's pattern clock and the Transport's wall clock. It reads the global CPS as the synchronisation reference; each tick it samples the score-level cps() pattern (if defined), writes the result into the writable `globalCPS` global, lets onTick bodies overwrite it, and at the end of the tick calls Strudel's setcps once with the final value if it has changed. SignalRegistry registers GXW's standard signals at scene load time, exposes `defineSignal` for composer use, computes smoothed values and distance-derivatives, and holds the firing-context pointer that each sub-pattern's wrapper sets and clears around queryArc. PlaybackHelpers contains the two playback functions: `playOnce` pulls one cycle of events from a Strudel pattern, schedules them through StrudelRuntime, and stops; `play` is the direct single-event wrapper over superdough, with the 0.05-second default deadline applied. Both are used by hasHit, beenHit, and onTick bodies and available as globals to any composer code.

Tonal joins as a fourth dependency, both directly (its functions available to composer code in behaviours.js) and through `@strudel/tonal` for the Strudel-shaped harmony operators. Section 11's harmony helpers are reimplemented on Tonal in v2.5, replacing the placeholder primitives.

The Audio module shrinks to a thin layer over superdough's output. The Phrase module's role likely changes — it may remain as the shape Strudel events get translated into for Compositor consumption, or may be obsoleted entirely. Section 23 will be revised to reflect the new module set.

### Documentation

API.md grows a "Procedural authoring patterns" section covering at minimum: edge detection (rising, falling, both directions), scheduled events, threshold latching, hysteresis, counters and rate limiting, smoothed integrator, sequence stepping, and persistent random walk. Each pattern shown as a `withState`-wrapped onTick body or defineSignal formula, with brief commentary on what it does and how to adapt it. The standard signal vocabulary, the helper library, and the OKLCh perceptual colour space are documented alongside.

### Future directions

A handful of capabilities are out of scope for v2.5 but worth recording as natural extensions for later revisions.

Token-interpreting functions (`hit`, `trigger`, `region` and similar) are deferred. Patterns in v2.5 stay purely declarative; procedural authoring lives in onTick. If composition reveals a need to invoke named callbacks from within a pattern, the `register()` mechanism Strudel exposes makes adding such functions straightforward in a later revision.

Region concepts and region-derived signals depend on a regions feature that doesn't exist in v2.5. When regions are added as a scene-data concept, region-membership signals and `region(...)` token interpretation become a natural extension.

Default-handler sugar — letting an empty hasHit slot automatically play the sprite's cycle-function pattern as a one-shot — is deferred. v2.5 ships with the silence-by-default rule and the Create button workflow. If composer feedback shows the friendly default would be valuable, a built-in `hasHit_playPattern` handler can be shipped in a later revision and surfaced in the inspector slot dropdown.

Several v2.4 cycle-shape parameters are dropped from v2.5's schema: cycleSpeeds, beatsPerBar, beatInterval, beatOffset, beatPointsMode, activeBeatsCount, beatShift, repeats, activeBeats, and strength. Mini-notation expresses everything those fields covered, more concisely: `.fast`/`.slow` and angle-bracket alternation handle per-cycle rate variation; mini-notation expresses active-beat patterns and weighted slots directly; Euclidean rhythms and polymeters are first-class. stopAtCycle stays in the schema as the one v2.4 deferred rhythm field that has no clean mini-notation analogue and remains genuinely useful for one-shot patterns. beatOffset (a starting fractional position within the cycle) is the only dropped field that might be wanted back; if real compositions call for it, the cleanest add-back is via Strudel's `.early(n)` or `.late(n)` rather than as a separate scalar field.

Modular audio synthesis beyond superdough's built-in subtractive, FM, wavetable, and ZZFX modes is available through Strudel's CSound integration but not promoted as a primary GXW path. Composers who need synthesis depth beyond superdough use CSound directly through Strudel.

### Status

Captured for v2.5. The Paths-and-Sprites collapse and Strudel adoption are bundled as one revision. Section 27 was updated in a follow-up pass to reflect two further design refinements: the cycle pattern lives in behaviours.js as a function rather than as a string field on the sprite, and the tempo model is one global CPS with per-sprite cycle ratios rather than a global BPM with integer beat counts. The TODO file's tempo-model rewrite and "Schema and inspector update for cycle length" entries track the schema and code work that follows from this section. Sections 1–26 still need an editing pass to reflect the full v2.5 model — that ripple work is also tracked on the TODO.
