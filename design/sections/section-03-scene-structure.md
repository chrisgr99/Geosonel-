## Section 3 — Scene Structure

A scene's data model:

- An optional background image, resampled to 1000x1000, acting as a scalar field. The image is read at each firing source's current position through the dynamic signal vocabulary (see Section 10).

- A collection of curves, each with a geometric shape, optional cursor extents (cursorL and cursorR), starting velocity, and up to four behaviour slots: cyclePattern, hasHit, beenHit, and onTick.

- A collection of triggers, each with a position and up to four behaviour slots (one-shot cyclePattern on collision, plus hasHit, beenHit, and onTick).

- A collection of sprites, each with a position, velocity, optional cursor extents, and up to four behaviour slots (cyclePattern, hasHit, beenHit, onTick). Sprite motion comes from physics plus per-sprite acceleration computed in onTick, typically from the local image colour.

### Object identifiers

Each object in scene.json carries an id with a fixed shape: a three-uppercase-letter prefix denoting the kind (`SPR` for sprites, `TRG` for triggers, `CRV` for curves) followed immediately by a positive integer with no separator. Sprites are SPR1, SPR2, SPR3; triggers are TRG1, TRG2; curves are CRV1, CRV2. The integer is assigned in creation order per kind and never repeats. A deleted object's number is not reused on the next creation, so deletion leaves gaps in the numbering that remain visible for the lifetime of the score. Name stability is the reasoning — a labelled pattern block `$SPR4` in behaviors.js stays meaningful as long as SPR4 exists, and recycling that number for a different sprite later would orphan or silently rebind the reference. Callback function names follow the same convention (`hasHit_SPR4`, `beenHit_SPR4`, `onTick_SPR4`) and similarly need a stable id binding. See Section 9 for the file-level structure of behaviors.js, the labelled-statement form for cyclePattern blocks, and the slot-name-plus-id naming for callback functions.

The next-integer counters live in scene.json as a top-level `idCounters` sub-object with `sprite`, `trigger`, and `curve` keys, each holding the integer the next-created object of that kind will receive. Counters monotonically increase. The loader's fill-pass advances each counter past the largest integer it finds in a conventional id, so a hand-edited scene.json that jumps from CRV3 to CRV10 has its curve counter pulled forward to 11. Objects missing an id entirely get one assigned by the fill-pass at the counter's current value, after which the counter increments.

The conventional shape pattern is `/^(SPR|TRG|CRV)[1-9]\d*$/` — a three-letter prefix from the fixed set followed by a positive integer with no leading zero. The pattern also doubles as the validator that rejects user-typed Name fields that would collide with system-assigned ids. Hand-edited ids that do not match the conventional shape are left alone (the fill-pass treats them like user-supplied identifiers) and the counter does not try to reconcile against them. Any references elsewhere (labelled blocks, callback function names) to such hand-edited ids are the composer's responsibility to keep in sync.

The new-score template seeds the counters one past the highest id assigned in the template. The default template ships with one sprite, four triggers, and one curve, so the template's scene.json has `idCounters: { sprite: 2, trigger: 5, curve: 2 }`.

### Canvas

The canvas is always live and displays whatever state the model currently holds. There is no separate edit and run mode at the canvas level; editing happens by modifying the sketch, and the canvas reflects the result after the sketch re-executes.
