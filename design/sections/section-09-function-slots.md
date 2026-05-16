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

### Authoring with the inspector

The pattern row at the bottom of Band 1 in the property inspector carries a Create / Go-to button that scaffolds a labelled block (`$objectId: sound("")`) at the end of behaviors.js or navigates to the existing block for the selected object. Band 3's three callback rows each carry a Can-X checkbox, a function-name field, and a Create / Go-to button that scaffolds a stub function or navigates to the existing one. Default function names use the convention `slotName_objectId`; the composer can edit the field before clicking Create to override.

When the Can-X checkbox is unchecked, the slot is gated off and the field plus button are greyed. When checked and a single object is selected, the Create / Go-to button is operative; the inspector looks up the displayed function name in the scene's functionMap and labels the button "Create" or "Go to" accordingly. A name in scene.json that does not resolve to a function in behaviors.js is a soft error: the slot stays inert for that object and the inspector renders the field's content muted.

### Sharing functions across objects

Sharing a function across multiple objects is opt-in. The composer types the same function name into each object's slot field; the binding is by name, so two sprites both pointing at `onTick_shared` invoke the same function. The implicit `motionUpdate` default convention from pre-Strudel versions has been retired in favour of explicit per-object binding.

### Context objects

Each callback receives a context object carrying the relevant state for the firing event: object identity, geometry, image samples, transport, and so on. The specific fields evolve as features land, but the conceptual contract is unchanged from earlier versions of the design: the context exists to pass state into the callback without the callback having to reach for global scene state.

The cyclePattern slot, in contrast, is not a function and receives no context object. It is a Strudel mini-notation string whose dynamic signals (such as pxLt or spriteV) read the firing source's state through the firing-context pointer described in section 27.

### Score-wide helpers

A JavaScript helper library originally written for GeoSonix (scaleMap, rangeMap, chordMap, harmonyMap, listMap, and related utilities) is planned to be ported into GXW with revision and pruning to fit the new model; this is captured in TODO.md under Code tab and behaviors.js. Until that port lands, callbacks can still use plain JavaScript and Math, plus the firing-context plumbing described in section 27.
