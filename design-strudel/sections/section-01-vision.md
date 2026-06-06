## Section 1 — Vision

GeoStrudel is a web app for composing music from 2D scenes. The project's working name is GXW, used throughout this documentation and codebase.

GeoStrudel is the modern web-based successor to GeoSonix[^1], a pattern-based experimental music system by the same author, available in the years of about 2007 through 2012. GeoSonix was built on the Qt framework, based on IanniX, and inspired by GeoMaestro. GeoStrudel carries forward the core concepts of GeoSonix and incorporates new ideas learned from the original system and others made possible by the web platform; the integration of Strudel's pattern language is the most significant of these.

A scene contains three kinds of object: curves (paths with optional sweeping cursors), triggers (fixed collision points), and sprites (bodies moving under physics over the image beneath them). Both curves and sprites with non-zero cursor extents become colliders against other objects. Each source has its own pattern and its own cycle length in master beats, so sources can run at independent tempos while sharing one master clock.

Pattern content is written in Strudel's mini-notation, which expresses rhythmic patterns with subdivisions and modifiers. The phrasing that captures the integration is GXW owns the WHEN, Strudel owns the WHAT: GXW's simulation determines when each source fires, Strudel's vocabulary determines what plays. Patterns can also read live scene state through dynamic signals such as perceptual brightness, colour, or sprite velocity.

The composer works in a tabbed editor beside the canvas. The Properties tab inspects scene objects; the Code tab holds JavaScript callbacks and labelled pattern blocks. Cmd-Enter on a labelled block promotes it to the active pattern for its object and re-runs the scene.

Sound is produced through Strudel's superdough audio engine or through Web MIDI to external synthesisers. MIDI is the current default; both paths coexist.

[^1]: An example GeoSonix composition: https://www.youtube.com/watch?v=fhNaQF8PEV4. Links to IanniX, GeoMaestro, and additional examples to be added before public release.
