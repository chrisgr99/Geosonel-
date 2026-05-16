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
    // image-driven acceleration computed from the local pixel
    const c = ctx.imageColorAt(ctx.x, ctx.y);
    return { ax: c.r * 0.5, ay: c.g * 0.5 };
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

### Context objects

Each callback receives a context object carrying the relevant state for the firing event: object identity, geometry, image samples, transport, and so on. The specific fields evolve as features land, but the conceptual contract is unchanged from earlier versions of the design: the context exists to pass state into the callback without the callback having to reach for global scene state.

The cyclePattern slot, in contrast, is not a function and receives no context object. It is a Strudel mini-notation string whose dynamic signals (such as pxLt or spriteV) read the firing source's state through the firing-context pointer described in Section 12 (Pattern Engine).

### Score-wide helpers

A JavaScript helper library originally written for GeoSonix (scaleMap, rangeMap, chordMap, harmonyMap, listMap, and related utilities) is planned to be ported into GXW with revision and pruning to fit the new model; this is captured in TODO.md under Code tab and behaviors.js. Until that port lands, callbacks can still use plain JavaScript and Math, plus the firing-context plumbing described in Section 12 (Pattern Engine).

### Navigating between Properties and Code tabs

The pattern row's Create/Go-to button in Band 1 of the property inspector navigates to the object's first occurrence in behaviors.js — a labelled pattern block or any callback function whose name follows the slotName_objectId convention — when one exists, or scaffolds an empty labelled block at the end of behaviors.js and drops the cursor there when none does. The Band 3 callback row Create/Go-to buttons do the same for their corresponding callback functions.

Beyond explicit Create/Go-to clicks, the two tabs follow the canvas selection. In the Code tab, when the canvas selection changes to a single object and the Code tab is active, the editor scrolls to that object's first occurrence in the file. Multi-select does not scroll, since the user is probably working on something not focused on a single object. When the user switches from Code to Properties, the Code tab's cursor position is read and its enclosing block's objectId is checked against the current canvas selection. If the object is part of the selection, the selection is preserved — the user may have set up a deliberate multi-selection, and parking the cursor in one member of that set reads as navigation within the set. If the object is not part of the selection, the selection is replaced with just that one object — the user's focus has moved. A cursor on a non-recognised statement or a blank line leaves the selection unchanged in either case.
