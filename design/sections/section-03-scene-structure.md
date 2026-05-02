## Section 3 — Scene Structure

A scene's data model:

- An optional image, resampled to 1000x1000. The image is a scalar field: at any 2D position it provides r, g, b, luminance, hue, saturation. Consulted by sprites (via their Motion Update functions) and available as context fields in all other functions.

- A collection of curves, each with a geometric shape, a set of beat points, a cursor, and zero to two functions.

- A collection of triggers, each with a position, optional payload, and zero to two functions.

- A collection of sprites, each with a position, velocity, motion parameters, and zero to two functions.

- A vector field built from one or more field sources (attractors, repulsors, uniform flows, pixel-gradient flows) that combine to produce a force vector at any position. Consulted by sprites during integration.

- Optional named regions — 2D areas with boolean membership and optional scalar data.

- Score-level harmonic parameters (see Section 11) — tonic, scale, root, chord, range — that objects inherit unless they override.

The canvas is always live and displays whatever state the model currently holds. There is no separate edit and run mode at the canvas level; editing happens by modifying the sketch, and the canvas reflects the result after the sketch re-executes.
