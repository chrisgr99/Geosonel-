## Section 11 — Harmony Framework

Harmony is a future capability of GXW. It is not yet detailed in this design pass and largely unimplemented in the current code, though the schema fields for score-level harmonic context and per-object override exist (SCENE_FIELDS and HARMONY_OVERRIDE_FIELDS).

The intent is that GXW will offer score-level harmonic parameters (tonic, scale, root, chord, range, rangeLow, and a Map-Notes-To target) that each object inherits unless overridden. GeoSonix had this capability through a two-level inherit-or-override model with helpers like scaleMap and chordMap that mapped abstract values into concrete pitches. GXW will reach for the same shape, but the combination of @strudel/tonal (Strudel's tonal-theory module) and the new pattern-based authoring model substantially changes how the framework should be designed.

The detailed design is deferred until @strudel/tonal integration is taken up. For the current implementation state (schema fields shipped, everything else pending), see TODO.md under Harmony. For the pattern-language context in which a harmony framework would be consumed, see section 27.
