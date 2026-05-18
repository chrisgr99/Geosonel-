## Section 14 — Authoring Workflow

A score's data and behaviour are split across two files in the bundle: scene.json (declarative data) and behaviours.js (named JavaScript functions). The two files are tied together by name reference: scene.json's function-slot fields hold strings that name functions defined in behaviours.js, and the scene loader resolves them at run time.

scene.json contains piece-level parameters (bpm, time signature, harmony framework, output target, image name, per-score scales) plus three arrays — curves, triggers, sprites — each entry of which is a flat object with the declarative properties for one object (geometry, rhythm strings, position, function-slot names, harmony overrides). No JavaScript runs from scene.json; it's pure data that any tool can read or write.

behaviours.js contains named JavaScript functions referenced from scene.json. Top-level function declarations and top-level const/let bindings to function expressions and arrows are exposed by name; the file is executed once on every scene load to build a function map. The split lets a property inspector, the canvas toolbar, or an AI assistant edit scene.json directly without parsing or rewriting any code, while the JavaScript editor keeps full freedom over behaviours.js.

Example scene.json:

```json
{
  "bpm": 120,
  "tonic": "D",
  "scaleName": "D minor",
  "imageName": "background.jpg",
  "triggerScale": 1,
  "spriteScale": 1,
  "curves": [
    {
      "shape": { "type": "ellipse", "cx": 0, "cy": 0, "w": 10, "h": 10 },
      "cycleDuration": 4,
      "beatInterval": "Qtr",
      "beatsPerBar": 4,
      "beatOffset": 0,
      "cycleSpeeds": "1",
      "stopAtCycle": -1,
      "beatPointsMode": "normal",
      "activeBeats": "x",
      "strength": "9",
      "cursorR": 3,
      "cursorL": 0,
      "hitBeat": "hitBeat_circle",
      "hitTrigger": "hitTrigger_circle"
    }
  ],
  "triggers": [
    { "x": 3, "y": 4, "note": 60, "collision": "collision_node" },
    { "x": -4, "y": 2, "note": 64, "collision": "collision_node" },
    { "x": 2, "y": -3, "note": 67, "collision": "collision_node" }
  ],
  "sprites": [
    { "x": 0, "y": 0, "vx": 1, "vy": 0, "motionUpdate": "" }
  ]
}
```

Corresponding behaviours.js:

```javascript
// Curve functions.
function hitBeat_circle(ctx) {
    // An arpeggio keyed to which beat of the cycle fired.
    const degrees = [0, 2, 4, 5];
    const note = scaleMap(degrees[ctx.beatIndex % 4] / 7,
                          { scale: ctx.scale, root: ctx.root });
    return { note, velocity: ctx.strength * 14, duration: 200 };
}

function hitTrigger_circle(ctx) {
    // Distance-based pitch — GeoMaestro distortion pattern.
    return {
        note: ctx.trigger.note - Math.floor(ctx.d),
        velocity: Math.max(0, 127 - Math.floor(ctx.d * 8)),
        duration: 400,
    };
}

// Trigger functions.
function collision_node(ctx) {
    return { note: this.note, velocity: 100, duration: 300 };
}

// Sprite functions. The shared Motion Update default — every sprite
// with an empty motionUpdate field invokes this function.
function motionUpdate(ctx) {
    // Image colour drives acceleration — red pulls right, blue pulls
    // left, the green channel pushes vertically. The simulation adds
    // the returned ax/ay to velocity before integrating position.
    const c = ctx.imageColor;
    return {
        ax: (c.r - c.b) * 0.05,
        ay: (c.g - 128) * 0.05,
    };
}
```

### Authoring routes

The form-based property inspector lives in the Properties tab as a display surface for object properties; in v1 it shows selection-driven layout but is not yet a modification route (data binding from scene.json into the form is the next milestone — see Section 13). Modifications to a score happen through three routes, all of which converge on the same in-memory bundle and the same explicit-save model:

1. The Properties JSON tab in the editor lets the composer edit scene.json directly. Standard JSON syntax with linting; saving persists.
2. The Behaviours tab lets the composer edit behaviours.js. Standard JavaScript with syntax linting; saving persists.
3. The canvas toolbar and direct-manipulation gestures let the composer add, move, and delete objects through the canvas. Each operation parses scene.json, mutates it, stringifies back, and refreshes the editor view. The user then sees the same content in the JSON tab and can continue editing there, save with Cmd-S, or run with Cmd-Enter to audition the change in-memory.

### Save semantics

GeoSonel uses an explicit-save model rather than auto-save with a debounce. In-memory edits accumulate without being committed to disk until the composer explicitly saves. This matches the convention of Logic Pro, Bitwig, Final Cut, and other artefact-producing tools, where Save is a deliberate gesture the composer controls and audition gestures like Cmd-Enter never commit to disk by themselves.

Save (Cmd-S) writes the current in-memory bundle to disk under its current name and clears the dirty flag.

Save As (Cmd-Shift-S) prompts for a new name, writes the in-memory bundle to disk under that name, and switches the editing target to the new bundle. The original bundle on disk is left in whatever state it was last saved in; any unsaved edits live only in the new bundle going forward. Save As is therefore "branch from current in-memory state", complementing Duplicate Score, which is "branch from disk state without losing the editing context on the original". Both gestures still exist; Save As is the more common one because it captures the work the composer has in front of them.

Revert discards in-memory edits and reloads the bundle from disk, restoring the last saved state. Because Revert is destructive of unsaved work, GeoSonel prompts for confirmation before proceeding.

Numbered backups are kept inside each bundle alongside the live files, following Logic Pro's project file backup pattern. A hidden .backups/ subfolder holds numbered subfolders 01, 02, 03, and so on, with 01 always the most recent backup and higher numbers older. Each backup captures the pre-save state rather than the just-saved state, so the composer can recover from a save they later regret.

On every Save, the existing backups shift up by one number, anything past the configured limit is dropped, and a fresh 01 is written containing the bundle state as it was immediately before this save. The number of backups to keep is set in preferences, defaulting to five. Backups are accessed through File > Revert to, which lists them newest to oldest with their save timestamps.

### Dirty state and document lifecycle

The Bundle holds a single canonical dirty flag. Any in-memory mutation from any of the three authoring routes sets the flag; Save clears it. Save As also clears the flag because the editing target switches to the freshly-written bundle, which is by definition clean.

The window title reflects the dirty flag. In Electron it uses setDocumentEdited, which produces the standard dot in the close-button circle that macOS users recognize from every other native app. In the web version the same flag drives a marker in document.title.

Each editor tab also shows a small dot prefix on its label when the file it represents has been edited since the last save, so the composer can see at a glance which file the unsaved work lives in. The per-tab dots are pure UI hints; the canonical dirty state remains at the bundle level.

When the composer attempts to close the window, open a different score, or quit the app while the bundle is dirty, GeoSonel intercepts the gesture and shows a standard three-button dialog. The title reads "Save changes to [Score Name]?", the body reads "If you don't save, your changes will be lost.", and the buttons are Save (default, Return), Don't Save, and Cancel (Escape). Save commits the bundle and proceeds with the original gesture, Don't Save discards in-memory edits and proceeds, Cancel returns to editing.

The web version applies the same dialog to in-app gestures like File > New, File > Open, and File > Recent. Actual tab close, page reload, and browser navigation are a different case: modern browsers restrict beforeunload to a generic warning that the app cannot customize, so the user sees only the browser's "Leave site? Changes you made may not be saved" prompt. This is a limitation of beforeunload rather than a design choice, and the web version accepts it as part of its degraded durability mode.

### Web version durability

Both versions present the same authoring model, but they save to different places and the user-facing UI makes this distinction explicit. The Electron version writes bundles to a Finder-visible folder on disk where each bundle is a real .gxw directory the user can copy, back up, sync with other tools, or open with other applications. The web version writes bundles to IndexedDB inside the browser, which is more fragile because browser updates, profile resets, manual site-data clearing, and incognito mode can all erase it.

The web version surfaces this distinction in three places. The window title reads "Score Name — GeoSonel (Browser)" rather than "Score Name — GeoSonel", so the storage mode is always present in the title bar and audible through Speak Selection. The Save confirmation status message reads "Saved to browser storage" instead of plain "Saved". A first-run banner explains the durability difference up front and recommends the desktop app for work that matters, with a dismiss button for users who already understand.

### Running a scene

Run Scene (Cmd-Enter, or the Run menu) re-executes the scene loader from the current in-memory bundle, independent of Save. It parses scene.json, parses behaviours.js with Acorn to find top-level function names, executes behaviours.js to build a function map, walks the scene.json arrays resolving function-name strings against the map, and constructs a Scene that the canvas renders. Because Run reads from in-memory state, the composer can audition unsaved edits freely; nothing is committed to disk until Save fires. Errors at any stage are reported in the message area at the bottom of the canvas pane with line numbers where possible.

### AI-assisted authoring

A conversation pane within GXW talks to Claude via the Anthropic API. The user converses in natural language; Claude edits scene.json and behaviours.js directly through the bundle's in-memory representation. Each edit triggers the same parse-and-run pipeline as a manual save. Claude's knowledge of GXW's API is supplied through an API.md reference document that the integration pre-loads into the conversation context.
