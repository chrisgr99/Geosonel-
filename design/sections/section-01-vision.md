## Section 1 — Vision

GXW is a web app for composing music that emerges from 2D scenes. A scene is a substrate of curves and triggers placed at considered positions. Curves have intrinsic rhythmic structure and play their own beat points on internal cycles; curves with extended cursors also sweep through the scene, triggering any triggers they encounter — this is the GeoMaestro projector idea preserved as a property of every curve. Sprites are autonomous agents that wander the scene, reading its image-as-scalar-field and firing musical events based on their environment. All agents share one transport and one musical framework.

The composer works by editing a JavaScript sketch file describing the scene, its objects, and their behaviour. GXW watches the sketch and re-executes it whenever it changes. A canvas shows the scene and its animation. Sound is produced by the browser's Web Audio API, and optionally routed to external synthesisers via Web MIDI where supported.

Sketches are typically constructed and modified through conversation with Claude, which edits the sketch directly. The conversational authoring experience is a first-class concern of GXW rather than an external workflow.
