## Section 3 — Scene Structure

A scene's data model:

- An optional background image, resampled to 1000x1000, acting as a scalar field. The image is read at each firing source's current position through the dynamic signal vocabulary (see section 27 for details).

- A collection of curves, each with a geometric shape, optional cursor extents (cursorL and cursorR), starting velocity, and up to four behaviour slots: cyclePattern, hasHit, beenHit, and onTick.

- A collection of triggers, each with a position and up to four behaviour slots (one-shot cyclePattern on collision, plus hasHit, beenHit, and onTick).

- A collection of sprites, each with a position, velocity, optional cursor extents, and up to four behaviour slots (cyclePattern, hasHit, beenHit, onTick). Sprite motion comes from physics plus per-sprite acceleration computed in onTick, typically from the local image colour.

The canvas is always live and displays whatever state the model currently holds. There is no separate edit and run mode at the canvas level; editing happens by modifying the sketch, and the canvas reflects the result after the sketch re-executes.
