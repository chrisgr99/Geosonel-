## Section 16 — Score Bundle

A GXW score is a bundle — a collection of related files — containing:

```
MyScore/
    scene.json           # declarative scene data
    behaviours.js        # named JavaScript functions referenced from scene.json
    image.png            # background image (1000x1000 PNG, optional)
    resources/           # user support files (helper modules, data tables)
    .git/                # version history (see Section 17)
```

Bundles are stored in the browser's persistent storage (IndexedDB) by default, with export and import functions to move bundles between machines or share them. The deprecated disk-mirror feature (Section 25, question 17) optionally exposed bundles as real folders on disk; the v2.3-planned successor is the AI Handoff feature (see Section 15) and the longer-term direction is in-app via an embedded API key rather than through disk round-trips.

The last opened score name is stored in application settings and reopened on launch.

The bundle is deliberately lean. The data/behaviour split (scene.json plus behaviours.js) replaces the v2.0-era single sketch.js file. No audio assets beyond the background image: GXW synthesises sound internally via Web Audio and optionally sends MIDI. No conversation history as bundle state — conversation history lives with the user session, not with the score.

The resources folder holds user-managed support files. behaviours.js can import from it using standard ES module imports. Custom harmony definitions, data tables, helper modules, alternate tunings — anything the behaviours call on beyond the core GXW API. JavaScript files in the bundle (behaviours.js at the top level and any modules inside resources/) appear as their own tabs in the editor; scene.json appears as the Properties JSON tab, while the form-based property inspector occupies the Properties tab itself (see Section 13).
