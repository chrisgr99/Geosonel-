## Section 9 — Behaviour Slots and behaviors.js

Each source kind carries up to four behaviour slots: the cyclePattern (a Strudel mini-notation string) and three callback slots (hasHit, beenHit, onTick), all backed by fields in the schema and exposed in the inspector. The cyclePattern lives in scene.json's cyclePattern field for each object; the three callbacks live as function-name references that point at top-level function declarations in the score's behaviors.js file.

### behaviors.js structure

behaviors.js is a mixture of procedural function declarations, labelled pattern statements, and any helper functions or variables the user needs. A typical file might contain:

```javascript
$SPR1: sound("c4 e4 g4").s("piano")

$TRG3: note("c5").duration(0.5)

function beenHit_TRG3(ctx) {
    // user-authored response when this trigger is hit
}

function onTick_SPR1(ctx) {
    // image-driven 2D force from the colour beneath the sprite,
    // reversed per axis after each wall bounce so it never traps
    const k = 6;
    ctx.applyForce((ctx.pxR - ctx.pxG) * k * ctx.flipX,
                   (ctx.pxY - ctx.pxB) * k * ctx.flipY);
}

// helper available to all callbacks
function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
}
```

The labelled-block syntax `$objectId: expression` defines a cyclePattern that the runtime resolves to the named object's cyclePattern field. The procedural function names follow the convention `slotName_objectId`, for example `hasHit_CRV2`, `beenHit_TRG3`, `onTick_SPR1`. Helper functions and shared variables that are not bound to any slot are equally welcome at the top level; the bound slots reference them by call.

The scene-load path pre-processes behaviors.js through Acorn before executing it, walking the top-level statements and splitting them into two streams. Labelled statements whose label matches the objectId pattern are pulled out as inert source text and held in a per-object pattern table. Everything else is concatenated back into a JavaScript source string and executed as before to register the procedural function declarations. Labelled blocks remain in the file as the composer sees them but do not run at scene-load — executing them would call strudel pattern constructors before the engine is ready, producing either errors or stray Pattern objects with no binding. Cmd-Enter is the only path that activates a labelled block.

Per-object cyclePattern in scene.json holds the currently-active pattern expression for that object as plain text — the expression body alone, with no objectId prefix. Cmd-Enter on a labelled block in the Code tab extracts the block's expression, writes it to the object's cyclePattern field, and re-runs the scene. The scene runtime reads cyclePattern directly when evaluating each cycle. Scene reload from disk uses cyclePattern as-is without re-parsing the Code tab for patterns. The Code tab file is the editing surface; cyclePattern is the runtime cache. This separation means scene reload does not depend on the Code tab containing any patterns at all, and the composer can rearrange or comment out blocks in the Code tab without disturbing what is currently playing.

### Authoring with the inspector

The pattern row at the bottom of Band 1 in the property inspector carries a Create / Go-to button that scaffolds a labelled block (`$objectId: sound("")`) at the end of behaviors.js or navigates to the existing block for the selected object. Band 3's three callback rows each carry a Can-X checkbox, a function-name field, and a Create / Go-to button that scaffolds a stub function or navigates to the existing one. Default function names use the convention `slotName_objectId`; the composer can edit the field before clicking Create to override.

When the Can-X checkbox is unchecked, the slot is gated off and the field plus button are greyed. When checked and a single object is selected, the Create / Go-to button is operative; the inspector looks up the displayed function name in the scene's functionMap and labels the button "Create" or "Go to" accordingly. A name in scene.json that does not resolve to a function in behaviors.js is a soft error: the slot stays inert for that object and the inspector renders the field's content muted.

When several labelled blocks for the same object coexist in behaviors.js (a kind of pattern library for that object), the currently-active block's tag renders in GXW's accent green to mark it as the one whose expression body matches scene.json's cyclePattern field. Inactive tags render in the default name-token colour, the lighter pink from cmTheme.js. The matching rule is text-equality between the labelled block's expression body and the object's cyclePattern; duplicated blocks (two with identical expression text) highlight both as active.

Validation has two surfaces. For labelled pattern blocks in the Code tab, parsing runs only at Cmd-Enter time, not as the user types. On parse failure the editor keeps focus, the GXW console logs the diagnostic, and the edit does not propagate to the scene. On parse success the expression body is written to the named object's cyclePattern field, the active-tag highlight moves to the just-Cmd-Entered block, the scene re-runs, and the console logs the parsed event positions. Live parsing on every keystroke was considered and rejected because a partial mid-type input — an unfinished function call, an unclosed string — would flag as broken even when the user has simply not finished typing. The standard JavaScript syntax linter (Acorn-driven, debounced) continues to flag syntax errors at the file level via the existing lint-gutter mechanism; the pattern parse only runs on the labelled-statement bodies at Cmd-Enter time.

### Sharing functions across objects

Sharing a function across multiple objects is opt-in. The composer types the same function name into each object's slot field; the binding is by name, so two sprites both pointing at `onTick_shared` invoke the same function. The implicit `motionUpdate` default convention from pre-Strudel versions has been retired in favour of explicit per-object binding.

### Sharing patterns across objects

Labelled-pattern blocks support multiple labels in front of a single expression so several objects can share one pattern definition. The form is a chain of dollar-prefixed labels stacked in front of one expression statement:

```javascript
$CRV1: $CRV5: $CRV9: note("c d e f");
```

This parses as nested labelled statements in standard JavaScript. The grammar allows any LabeledStatement to have another LabeledStatement as its body, so a chain of any depth resolves at the parser level to a tree of nested LabeledStatements wrapping one inner ExpressionStatement. Identifiers starting with a dollar sign are valid alongside letters and underscore, and the labels are inert at runtime since the only thing JavaScript does with a label is reach for it from a `break` or `continue` inside the labelled statement, which is never the case for these pattern blocks.

The scene-load Acorn pre-processing walks the label chain when it encounters a top-level LabeledStatement whose body is itself a LabeledStatement, collecting all dollar-prefixed labels until it reaches an ExpressionStatement. Each collected label produces one entry in the scene's labelledBlocks list, all sharing the same expressionText and the same source range. Everything that consumes labelledBlocks downstream (the inspector's pattern row state, the Code tab's active-tag highlight, the objectHasCodeSource navigation gate, the orphan-tag decoration) continues to operate per-label without any structural change. The only difference is that several entries now resolve to the same expression text, which is precisely the semantic the shared block conveys.

Duplicate uses this form as its default. Duplicating an object whose source already has a labelled block prepends the new id to the source's chain rather than appending a fresh block elsewhere in behaviors.js. After duplicating CRV1, the source's chain `$CRV1: note("c d e f");` becomes `$CRV1: $CRV5: note("c d e f");`. The two objects now share one block of source text; editing the pattern there affects both. This matches the common case where a duplicate is intended to play the same musical material as the source, and it avoids the copy-paste of pattern text that an append-a-new-block approach would produce.

Delete is the mirror operation. Removing an object that has a label on a chain trims just that label from the chain; the block stays in place with one fewer label. When the last label is removed (no objects still reference the block), the whole block is removed. This makes delete and duplicate symmetric in their effect on behaviors.js, and it resolves the orphan-accumulation case a duplicate-delete-duplicate sequence would otherwise create: each delete trims its own label, no stray blocks pile up over time.

Cmd-Enter on a shared block promotes the same cyclePattern to every object whose label is on the chain. The editor's promote handler walks the chain at the cursor position, collects all the labels, and the receiving handler in main.js applies the new cyclePattern to each matched object in one applySceneEdit. This keeps the gesture one keystroke and updates every sharer consistently. A parse failure on the expression body leaves every object's existing cyclePattern intact.

The active-tag highlight paints the selected object's specific label in accent green, leaving the co-labels in the default pink. With chained labels the user can see exactly which label corresponds to the canvas selection and which other objects are sharing the same expression. The orphan-tag red wavy underline works the same way per-label: a chained block with one orphan label and two live labels paints just the orphan label as flagged.

The inspector's pattern row surfaces a brief sharing indicator after the Go-to button when the selected object's labelled block has co-labels: a small `+N` where N is the number of other objects on the chain, excluding the selected object itself. The indicator is absent when N is zero. A short spacer separates the indicator from the Repeats label that follows on the same row, so the indicator does not run into the next field but does not push the row wider than it needs to be. The row label itself shortens to "Pattern" from the older longer form; inside the property inspector for a single selected object the longer phrasing is redundant, since every row is implicitly for the selected object. Clicking Go-to navigates to the shared block in the Code tab, where the full chain of labels is visible and the user can read off the co-labels directly. The inspector does not enumerate the co-labels because doing so would clutter the row, and the Go-to navigation is one click away.

Structural changes to a chain — splitting a sharer off so it diverges, or merging two existing blocks into one shared chain — are done as manual code edits in the Code tab rather than through dedicated inspector affordances. To split CRV5 off from a chain like `$CRV1: $CRV5: $CRV9: <expr>`, the composer removes the CRV5 label from the chain and pastes it on a new line in front of a copy of the expression body. To merge two blocks into one chain, the composer types one block's label in front of the other's expression and removes the now-redundant block. The loader's chain-walking logic only cares about the parsed structure, not how the source text got into whatever shape it is in, so manual edits and system-driven edits (duplicate, delete) compose freely. AI assistants editing behaviors.js follow the same rules, writing chained labels directly when they want to express sharing.

### Context objects

Each callback receives a context object carrying the relevant state for the firing event: object identity, geometry, image samples, transport, and so on. The specific fields evolve as features land, but the conceptual contract is unchanged from earlier versions of the design: the context exists to pass state into the callback without the callback having to reach for global scene state. onTick reads its state through this context object exclusively, not through the pattern signal system — the dynamic signals are Strudel Pattern values built for the pattern engine's two-pass evaluation, and procedural code wants plain numeric reads instead. Where a context read overlaps a pattern signal it echoes the signal's name, so the vocabulary is shared across the two surfaces; the concrete onTick surface is enumerated below.

The cyclePattern slot, in contrast, is not a function and receives no context object. It is a Strudel mini-notation string whose dynamic signals (such as pxLt or spriteV) read the firing source's state through the firing-context pointer described in Section 12 (Pattern Engine).

### The onTick contract

onTick is the most open-ended of the three callbacks. Where hasHit and beenHit run in response to a collision, onTick runs every simulation step for as long as the object exists, and its body is unrestricted procedural JavaScript that acts through the context by imperative side effect rather than by returning a value. An earlier version of this design framed onTick narrowly as a function returning an acceleration; the working model is broader. A tick callback decides, from any function of the current state it cares to compute, to do any combination of things: apply a force to its own motion, apply a force to another object, fire a note, or change any other state the context exposes. Nothing constrains what it may do. An onTick can produce nonsensical or self-defeating results if written carelessly, the same way any unrestricted script can, and that is an accepted trade for expressive range; this is not safety-critical software, and the cost of a bad callback is a bad-sounding score.

Motion is changed by impulse, never by absolute assignment. An onTick does not set an object's velocity; it applies a force, which the engine converts to a change in velocity through the object's mass and adds to the object's accumulated motion (see Section 6 for the two-layer velocity model and Section 22 for the physics). A force field falls directly out of this: a callback that reads the image colour beneath the object each step and applies a small force derived from it makes the object behave as though that region of the image exerts a continuous acceleration on it. The same imperative force, applied to another object by id, lets one object push another; applied with a magnitude derived from both objects' masses and positions, it expresses gravitational and other inter-object interactions. A force passed to applyForce is applied literally — the engine divides it by mass and integrates it over the step but never changes its direction — so a directional force such as gravity stays pointed where the callback aimed it. To keep an image-derived field from pinning the object to a wall, the context exposes two per-axis reflection signs, flipX and flipY, that the callback multiplies into a pixel force when it wants the field to reverse after each bounce and omits when it does not (see Section 22).

Firing a note from onTick is immediate. Unlike a cyclePattern, whose events are scheduled a cycle ahead and quantized to the object's beats, an onTick note is dispatched as soon as the callback fires, into the same output layer the patterns use. It is deliberately not beat-quantized: the patterns own beat-locked material, and the value of an onTick note is precisely that its timing is determined by the environment as the object moves through it, giving irregular, state-driven phrasing a grid cannot. The procedural note and the scale helper that feeds it a pitch are specified in Section 30. Note density is bounded by a per-object polyphony cap rather than by quantization (see Section 19 and Section 30 for the voice model).

The context provides both reads and writes. The reads, for a sprite, are: the colour of the image pixel beneath it, exposed under the same names the pattern engine uses — pxLt and pxChr for perceptual brightness and saturation, and the eight directional OKLab reads pxR, pxG, pxY, pxB, pxOr, pxPu, pxCy, pxLi; its kinematics as x, y, vx, vy, and speed (the sprite prefix the pattern signals carry is dropped here, since the context already is the object and onTick will run on curves too); the transport as beat, time in seconds, bpm, cyclePhase, and cycleCount; its id and kind; and the two reflection signs flipX and flipY. For inter-object logic the context also reads the position, mass, and velocity of any other object by id. The writes are applyForce(fx, fy) — force components in canvas units with positive Y up, accumulating across multiple calls in a step — the same force applied to another object by id, and immediate note or sample firing via playNote and playSound (the procedural emitters specified in Section 30). The context also exposes a motion-reset generation number that increments whenever the object's motion is reset: on a rewind, and on a home-teleport (the cycle-boundary home-snap a zero-terminated cycleSpeeds produces; see Section 4). Helpers use this generation to know when to clear their own per-object state, so that edge detectors and accumulators built on closures re-zero in lockstep with the engine's resets and a deterministic retrace is preserved (see The state-keeping idiom below).

Evaluation across objects is sequential, in a fixed order, and deterministic. Each simulation step the engine walks the objects in scene order and runs each onTick in turn; an object whose callback runs later in the step sees the effects — the impulses, the state changes — that earlier objects' callbacks have already applied this step. Order matters when one object pushes another, so the order is fixed (scene order) and stable, which makes the whole step reproducible: the same scene from the same starting state produces the same sequence of steps every run. The only thing that can break this is nondeterminism a callback introduces itself, such as reading a random number or the wall clock; the engine guarantees a fixed order and deterministic inputs, and what the callback does with them is the author's responsibility. A callback that throws is caught rather than allowed to crash the simulation: because onTick runs every sub-step, the engine disables that object's onTick for the rest of the session on the first throw and logs the error once — the object id and the message — to the console and the message area, rather than flooding either at the sub-step rate. A reload of behaviours.js re-enables it.

### A worked onTick example

The canonical force field steers a sprite by the colour beneath it and keeps it off the walls:

```javascript
function onTick_SPR1(ctx) {
  const k = 6;
  ctx.applyForce((ctx.pxR - ctx.pxG) * k * ctx.flipX,
                 (ctx.pxY - ctx.pxB) * k * ctx.flipY);
}
```

The x force follows the red-green balance under the sprite and the y force the yellow-blue balance, so the image's colour drives genuine two-dimensional motion: the sprite veers toward red, drifts along the yellow-blue axis, and carves a path that depends on the whole picture rather than a single brightness scalar. Multiplying each axis by its flip sign reverses that axis's response after a wall bounce, so the sprite always works back into the field instead of pinning to an edge; dropping the flip signs gives pure colour-following, which can trap. Over a dark, low-chroma region the force is near zero and the sprite coasts on its base velocity; over vivid colour it accelerates toward maxSpeed.

### The state-keeping idiom

Many useful onTick behaviours need to remember something from the previous step. Detecting that a signal crossed a threshold in a given direction, counting events, or integrating a value over time all require last step's value, which a stateless function does not have. The idiom for this is the JavaScript closure: a tick callback closes over variables declared once at the top level of behaviors.js and updates them each step. An edge detector closes over a last-value variable; a counter closes over a running total.

Closure state lives outside the engine, so the engine's resets — a rewind, a home-teleport — do not clear it. For a plain edge detector this barely matters: the first step after a reset produces one spurious comparison against the stale value and then self-heals on the next step. For anything that accumulates, the carried state survives the reset and quietly breaks the identical-retrace the deterministic model otherwise provides. Authors who hand-roll closures own this caveat; reaching for randomness or unreset accumulation is the author's choice to make.

The paved path is a set of reset-aware helpers that wrap the common patterns — threshold crossing, counting, integration — and handle reset correctly so the author does not have to. Each helper holds its own state keyed by the object's id (so a single onTick function shared by several objects keeps separate state per object rather than letting them clobber one another), and re-zeros that state when the context's motion-reset generation advances. The helper set is specified in Section 30; the engine support it relies on is the object id and the reset generation on the context described above.

### Score-wide helpers

A JavaScript helper library originally written for GeoSonix (scaleMap, rangeMap, chordMap, harmonyMap, listMap, and related utilities) is planned to be ported into GXW with revision and pruning to fit the new model; this is captured in TODO.md under Code tab and behaviors.js. Until that port lands, callbacks can still use plain JavaScript and Math, plus the firing-context plumbing described in Section 12 (Pattern Engine).

### Navigating between Properties and Code tabs

The pattern row's Create/Go-to button in Band 1 of the property inspector navigates to the object's first occurrence in behaviors.js — a labelled pattern block or any callback function whose name follows the slotName_objectId convention — when one exists, or scaffolds an empty labelled block at the end of behaviors.js and drops the cursor there when none does. The Band 3 callback row Create/Go-to buttons do the same for their corresponding callback functions.

Beyond explicit Create/Go-to clicks, the two tabs follow the canvas selection. In the Code tab, when the canvas selection changes to a single object and the Code tab is active, the editor scrolls to that object's first occurrence in the file. Multi-select does not scroll, since the user is probably working on something not focused on a single object. When the user switches from Code to Properties, the Code tab's cursor position is read and its enclosing block's objectId is checked against the current canvas selection. If the object is part of the selection, the selection is preserved — the user may have set up a deliberate multi-selection, and parking the cursor in one member of that set reads as navigation within the set. If the object is not part of the selection, the selection is replaced with just that one object — the user's focus has moved. A cursor on a non-recognised statement or a blank line leaves the selection unchanged in either case.
