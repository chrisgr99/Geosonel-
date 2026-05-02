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

Authoring routes. The form-based property inspector lives in the Properties tab as a display surface for object properties; in v1 it shows selection-driven layout but is not yet a modification route (data binding from scene.json into the form is the next milestone — see Section 13). Modifications to a score happen through three routes, all of which converge on the same in-memory bundle and the same explicit-save model:

1. The Properties JSON tab in the editor lets the composer edit scene.json directly. Standard JSON syntax with linting; saving persists.
2. The Behaviours tab lets the composer edit behaviours.js. Standard JavaScript with syntax linting; saving persists.
3. The canvas toolbar and direct-manipulation gestures let the composer add, move, and delete objects through the canvas. Each operation parses scene.json, mutates it, stringifies back, and refreshes the editor view. The user then sees the same content in the JSON tab and can continue editing there, or save with Cmd-S, or run with Cmd-Enter (which auto-saves first).

Run Scene (Cmd-Enter, or the Run menu) re-executes the scene loader: parses scene.json, parses behaviours.js with Acorn to find top-level function names, executes behaviours.js to build a function map, walks the scene.json arrays resolving function-name strings against the map, and constructs a Scene that the canvas renders. Errors at any stage are reported in the message area at the bottom of the canvas pane with line numbers where possible.

AI-assisted authoring. A conversation pane within GXW talks to Claude via the Anthropic API. The user converses in natural language; Claude edits scene.json and behaviours.js directly through the bundle's in-memory representation. Each edit triggers the same parse-and-run pipeline as a manual save. Claude's knowledge of GXW's API is supplied through an API.md reference document that the integration pre-loads into the conversation context.
