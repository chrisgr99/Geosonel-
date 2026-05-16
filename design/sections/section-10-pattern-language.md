## Section 10 — Pattern Language

GXW patterns are written in Strudel mini-notation. The pattern language is what Strudel calls its compact representation of rhythm, pitch, parameters, and modulation; GXW imports `@strudel/web` and uses its parser, Pattern type, and modifier algebra unchanged. This section documents the subset of the language that composes well with GXW's per-source-cycle clock model, the static and dynamic signals composers can reach for, and how patterns are authored within GXW.

### Mini-notation as the authoring surface

A pattern is a string expression. The syntax covers subdivisions, repetition, parallel layers, rests, alternation, modifiers, and parameter setters. A typical pattern reads as `sound("bd sn bd sn")` or `note("c4 e4 g4").fast(2)`. The string evaluates to a Pattern value — a pure function from a time range to a list of events — that GXW's Pattern Engine (Section 12) queries each cycle to produce scheduled audio.

Within GXW patterns are authored in the Code tab as labelled JavaScript statements of the form `$objectId: expression`, where the label names the object the pattern belongs to and the expression is any valid Strudel pattern. See Section 9 for the file-level structure of behaviors.js, the active-block promotion mechanism via Cmd-Enter, and the bidirectional navigation between the Code tab and the property inspector.

### Curated modifier vocabulary

GXW imports the full @strudel/web library and uses the parser, Pattern type, and modifier algebra as-is; the Pattern abstraction is general enough that modifiers compose normally and queryArc returns coherent results regardless of which modifiers a pattern uses. What GXW documents is a curated subset known to behave intuitively under the per-source-cycle clock model. Other modifiers remain accessible for composers who reach for them, with a soft validation warning in the inspector when a modifier is used outside its promised context.

Within-cycle modifiers always work cleanly. Subdivision `[a b]`, repetition `a*4`, parallel layers `a,b`, weighted slots `a@2 b`, rest `~`, the `.fast(N)` modifier (which divides cycle time so more events fit), `.rev` (within-cycle reverse), `.struct(...)`, `.jux(fn)`, `.layer(...)`, and all sound-selection and parameter setters — `.s`, `.n`, `.note`, `.gain`, `.pan`, `.lpf`, and the rest. These produce events whose times and values are determined entirely within one cycle, so they need no continuous master-clock context to behave as the composer expects.

Cross-cycle modifiers work cleanly when the firing source is continuous. A curve whose cursor loops the curve, or a sprite whose cyclePattern resets per cycle, has its cycle counter advance naturally on each wrap, so alternation `<a b c>` rotates through values across firings, `.every(4, fn)` applies a transformation every fourth firing, and `.iter(N)` rotates subdivisions across cycles. These are part of the promoted vocabulary for continuous sources.

Cross-cycle modifiers are problematic when the firing source is one-shot. A trigger collision or a sprite-hit-trigger event fires sporadically with no inherent next cycle. Under `.slow(N)` only one Nth of the events fire per firing because the pattern is stretched across multiple cycles that the one-shot never sees. `.late(N)` and `.early(N)` shift events into adjacent cycles where the one-shot does not query, so events silently disappear. The inspector flags these patterns with a soft validation warning (yellow squiggle, matching the existing soft-error pattern for things like duplicate names) when the source's firing model is one-shot, but does not hard-reject them. A composer who understands the implications can commit a warned pattern; the parse and evaluation are correct, just the typical intent does not match the result.

### Static signals

Strudel's built-in signals — sine, saw, square, tri, perlin — are pure mathematical functions of cycle position. They work identically under GXW's clock as they do under Strudel's master cycle: queryArc samples them at each event's fractional position, and the value depends only on that position, not on wall-clock time. No GXW-side modification needed; they integrate as-is.

### Dynamic signals

Dynamic signals read scene state at firing time. They are not extensions to Strudel; they are new Patterns whose query function happens to read external state during the call. Strudel's Pattern type is general enough to express them naturally — a Pattern is a function from a time range to a list of Haps, and nothing about that function needs to be pure. Anything that implements the queryArc shape composes with mini-notation and modifiers identically to a built-in signal.

The standard signal set falls into three groups: image-colour signals, sprite kinematic signals, and harmony-context signals.

Image-colour signals derive from the OKLCh perceptually-uniform colour space and read the image pixel at the firing source's current canvas position. The `px` prefix reads as "pixel" and groups the signals together at autocomplete time:

- `pxLt` — perceptual brightness, the L component of OKLCh, calibrated so equal numerical changes correspond to equal perceived brightness changes.
- `pxChr` — perceptual saturation, the magnitude of the (a, b) vector. How vivid versus grey the pixel reads.
- `pxR`, `pxG`, `pxY`, `pxB` — the four single-letter primaries projecting onto the OKLab opponent axes (redness, greenness, yellowness, blueness).
- `pxOr`, `pxPu`, `pxCy`, `pxLi` — the four two-letter hue intermediates projecting onto the 45-degree-rotated directions between adjacent primaries (orange, purple, cyan, lime), named for direct expression of culturally-meaningful off-axis colours.

GXW exposes only OKLCh-derived perceptual colour as the standard colour-driven music vocabulary; raw RGB is not exposed. The four primaries encode the perceptual opponent axes that human vision actually uses; the named-positive-direction form lets composers pick whichever name reads naturally in context (`pxR` for "music responds to red regions", `pxG` for the inverted intent). Hue is not exposed as an angle: the opponent-axis projections give composers smooth values that do not suffer the wraparound discontinuity an angular hue would when a sprite traverses the colour boundary at 0 or 360 degrees. Composers who specifically want angular hue can compute it themselves with `Math.atan2(pxY, pxR)` inside a composer-defined signal once the defineSignal mechanism lands; the schema and inspector hooks for that are tracked in TODO.md.

Sprite kinematic signals expose the firing sprite's current motion state: `spriteX` and `spriteY` for position, `spriteVx` and `spriteVy` for velocity components, `spriteV` for scalar speed.

Harmony-context signals expose the inherited harmony at the firing source: `currentScale`, `currentChord`, `currentTonic`, `currentRoot`. These are deferred until @strudel/tonal integration lands and the harmony framework (Section 11) is wired through; the underlying schema fields exist but the signals themselves are not yet implemented.

The mechanism by which dynamic signals read live scene state at near-play time lives in the Pattern Engine (Section 12) — specifically the firing-context pointer set in a try-finally block during pattern evaluation, and the two-pass evaluation that refreshes signal values just before each event dispatches.
