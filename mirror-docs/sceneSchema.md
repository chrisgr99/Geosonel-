# scene.json schema

scene.json is the score's composition data: the static layout of curves, triggers, and sprites that make up a GXW piece, plus score-level settings. This document describes its structure so an AI editing scene.json can produce valid output. The authoritative source is `src/sceneSchema.js` in the repo; this file is the human- and AI-readable companion that lives in the mirror folder.

The renderer validates incoming AI edits against `sceneSchema.js`. A scene.json that diverges from the shapes documented here will be rejected and reverted, with the failure reason written to active-score.json's `lastApplyResult` field.

## Top-level structure

scene.json is a JSON object with score-level fields at the top, three object arrays (`curves`, `triggers`, `sprites`), and an optional `output` sub-object for MIDI configuration. A minimal valid form:

```json
{
  "bpm": 120,
  "curves": [],
  "triggers": [],
  "sprites": []
}
```

The three object arrays should always be present, even when empty. Score-level fields default when omitted; their defaults are listed below.

## Object IDs

Every curve, trigger, and sprite carries an `id` field (string). IDs follow the convention `CRV<n>`, `TRG<n>`, `SPR<n>` — three-letter kind prefix followed by an integer (e.g. `CRV1`, `TRG3`, `SPR2`). IDs are referenced from behaviour-callback function names in `behaviours.js` (a curve `CRV2`'s hit callback is named `hasHit_CRV2`), so they must stay stable across edits and remain unique within their kind. Renaming an ID without updating the matching callback names breaks the binding silently — the callback will not fire.

## Field types

The `type` field in `sceneSchema.js` uses these values:

| Type | Meaning |
|---|---|
| `integer` | Whole number |
| `number` | Floating-point number |
| `string` | UTF-8 text |
| `boolean` | `true` or `false` |
| `enum` | One of a fixed set of strings (allowed values listed per field) |
| `color` | Hex colour string like `"#7dd68a"` or a named palette entry |
| `shape` | Sub-object describing curve geometry (see Shapes below) |
| `object` | Opaque sub-object (currently used for the `output` field and trigger `payload`) |
| `functionRef` | Name of a function defined in `behaviours.js` |

Where a field has `min` or `max` constraints, values outside the range are rejected by validation.

## Score-level fields

These live at the top of scene.json, outside any object array.

| Field | Type | Default | Notes |
|---|---|---|---|
| `bpm` | integer | `null` | Tempo. `null` means a time-based piece with no beat reference. Range 1–1000. |
| `tonic` | string | `null` | Score-level tonic note name (e.g. `"C"`, `"F#"`). |
| `scaleName` | string | `null` | Score-level scale name (e.g. `"major"`, `"dorian"`). |
| `root` | string | `null` | Chord root note name. |
| `chordName` | string | `null` | Chord name (e.g. `"m7"`). |
| `range` | integer | `null` | Pitch range in semitones for note mapping. |
| `rangeLow` | integer | `null` | Lowest MIDI note number in the mapping range. |
| `mapNotesTo` | enum | `null` | One of `"Score"`, `"Scale"`, `"Chord"`, `"None"`. |
| `imageName` | string | `null` | Filename of the score's background image (must match the file present in the bundle). |
| `output` | object | `null` | MIDI output configuration. Opaque; see implementation. |
| `triggerScale` | number | `1` | Global multiplier on trigger visual size. Range 0.1–10. |
| `spriteScale` | number | `1` | Global multiplier on sprite display diameter. Range 0.1–10. |

Harmony fields at the score level (`tonic`, `scaleName`, `root`, `chordName`, `range`, `rangeLow`, `mapNotesTo`) are inherited by curves, triggers, and sprites unless those objects override them in their own harmony fields.

## Curve fields

Curves are paths on the canvas with optional sweeping cursors. Each curve carries geometry (`shape`), motion (`vx`, `vy`), and the shared callback-slot and harmony-override field groups described below.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | (required) | Object ID, see above. |
| `name` | string | `""` | Optional user-facing name. |
| `mute` | boolean | `false` | When true, the curve fires no notes. |
| `hide` | boolean | `false` | When true, the curve is not rendered. |
| `shape` | shape | (required) | Geometry sub-object. See Shapes. |
| `vx` | number | `0` | X-component of physics motion in canvas units per second. |
| `vy` | number | `0` | Y-component of physics motion in canvas units per second. |
| `curveThickness` | number | `1` | Line thickness when rendered. |
| `color` | color | `"#7dd68a"` | Stroke colour. |
| `stopAtCycle` | integer | `-1` | Cycle count at which firing stops. `-1` means never stop. |
| `cursorR` | number | `0` | Cursor extent ahead of the cursor point (R = right side). |
| `cursorL` | number | `0` | Cursor extent behind the cursor point (L = left side). |
| `cursorThickness` | number | `2` | Visual thickness of the cursor element. |
| `patternRepeats` | integer | `1` | Number of pattern repeats per cycle. Range 1+. |
| `cycleSpeeds` | string | `"1"` | Per-segment speed multipliers as a Strudel-style fractional string. |

The full curve schema continues with the shared callback-slot fields and harmony-override fields described below.

## Trigger fields

Triggers are fixed collision points. They fire when a cursor crosses their position.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | (required) | Object ID, see above. |
| `name` | string | `""` | Optional user-facing name. |
| `mute` | boolean | `false` | When true, the trigger fires no notes. |
| `x` | number | `0` | X position in image space (1000x1000 grid). |
| `y` | number | `0` | Y position in image space. |
| `size` | number | `0.35` | Visual size in canvas units (scaled by `triggerScale`). |
| `color` | color | `"#7db8d6"` | Fill colour. |
| `note` | integer | `null` | Static MIDI note number, used when the trigger fires a fixed pitch. |
| `payload` | object | `null` | Opaque pattern payload. |

The full trigger schema continues with the shared callback-slot fields and harmony-override fields described below.

## Sprite fields

Sprites are mobile bodies that move under physics. Their cursors (when set) make them colliders against other objects.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | (required) | Object ID, see above. |
| `name` | string | `""` | Optional user-facing name. |
| `mute` | boolean | `false` | When true, the sprite fires no notes. |
| `x` | number | `0` | Initial X position in image space. |
| `y` | number | `0` | Initial Y position in image space. |
| `vx` | number | `0` | Initial X velocity in canvas units per second. |
| `vy` | number | `0` | Initial Y velocity in canvas units per second. |
| `maxSpeed` | number | `16` | Speed cap. |
| `displayDiameter` | number | `1.05` | Visual diameter (scaled by `spriteScale`). |
| `color` | color | `"#7db8d6"` | Fill colour. |
| `cursorR` | number | `0` | Cursor extent ahead of the sprite's motion direction. |
| `cursorL` | number | `0` | Cursor extent behind. |

The full sprite schema continues with the shared callback-slot fields and harmony-override fields described below.

## Shared callback-slot fields

Every curve, trigger, and sprite carries these fields. The `cyclePattern` holds the Strudel mini-notation pattern that the object fires; the `canHit`, `canBeHit`, `canTick` booleans gate the three Code-tab callback slots; the `*Function` fields are function-reference strings naming the callbacks in `behaviours.js`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `cyclePattern` | string | `""` | Strudel mini-notation pattern fired per cycle. |
| `beatsPerCycle` | number | `4` | Cycle length in master beats. Range 0+. |
| `beatInterval` | enum | `"4n"` | Beat-interval token. See `src/beatIntervals.js` for the full set. |
| `canHit` | boolean | `false` | Gate for the hit-emitter callback. |
| `hasHitFunction` | functionRef | `""` | Name of the function in `behaviours.js` that emits hits. |
| `canBeHit` | boolean | `false` | Gate for the hit-receiver callback. |
| `beenHitFunction` | functionRef | `""` | Name of the function that handles being hit. |
| `canTick` | boolean | `false` | Gate for the per-tick callback. |
| `onTickFunction` | functionRef | `""` | Name of the function called on every simulation tick. |

Function reference fields resolve at scene-load time. A `hasHitFunction` of `"hasHit_CRV2"` resolves to the function with that name in `behaviours.js`. The naming convention `slot_id` (e.g. `onTick_SPR1`) is suggested but not enforced; any valid identifier works.

## Shared harmony-override fields

Every curve, trigger, and sprite also carries these fields. Each one defaults to `null`, meaning "inherit from the score-level setting of the same name."

| Field | Type | Default | Notes |
|---|---|---|---|
| `tonic` | string | `null` | Override tonic for this object. |
| `scaleName` | string | `null` | Override scale name. |
| `root` | string | `null` | Override chord root. |
| `chordName` | string | `null` | Override chord name. |
| `range` | integer | `null` | Override pitch range in semitones. |
| `rangeLow` | integer | `null` | Override lowest note. |
| `mapNotesTo` | enum | `null` | Override note-mapping mode. One of `"Score"`, `"Scale"`, `"Chord"`, `"None"`. |

## Shapes

A curve's `shape` field is a sub-object describing the curve's geometry. Three shape types are currently implemented; two more (`bezier`, `helice`) are reserved but not yet sampled.

### Line

```json
{ "type": "line", "x1": 100, "y1": 200, "x2": 800, "y2": 600 }
```

The cursor sweeps linearly from `(x1, y1)` at parameter `t=0` to `(x2, y2)` at `t=1`. All coordinates are in image space.

### Ellipse

```json
{ "type": "ellipse", "cx": 500, "cy": 500, "w": 400, "h": 300 }
```

`(cx, cy)` is the centre; `w` and `h` are the full width and height. The cursor starts at the 3-o'clock position (`t=0`) and sweeps clockwise through one full revolution at `t=1`.

### Piste

```json
{
  "type": "piste",
  "points": [[100, 100], [400, 200], [700, 500]],
  "closed": false
}
```

A polyline through the listed `[x, y]` points, sampled by arc length so `t=0` is at the first point and `t=1` is at the last. When `closed` is `true`, the path is treated as a loop with an extra segment from the last point back to the first.

### Bezier and helice

Reserved shape types. Not yet implemented. A curve with one of these shapes will load but its cursor cannot be sampled, so it cannot fire pattern events.

## Coordinate system

All positions in scene.json (trigger `x`/`y`, sprite `x`/`y`, shape coordinates) are in image space: an abstract 1000x1000 coordinate grid that scales to whatever pixel size the canvas renders at. The image space is independent of the user's viewport size, zoom level, or window resolution. AI edits should always use image-space coordinates and never assume a particular pixel resolution.

The canvas rendering may apply a runtime offset to a curve (from physics motion); that offset is not in scene.json. To see the displayed position of a running curve, read `runtime-state.json` (described in AGENTS.md), which carries the simulation-side offsets.

## Example

A minimal scene with one trigger and one curve:

```json
{
  "bpm": 120,
  "tonic": "C",
  "scaleName": "minor",
  "mapNotesTo": "Scale",
  "curves": [
    {
      "id": "CRV1",
      "shape": { "type": "ellipse", "cx": 500, "cy": 500, "w": 600, "h": 600 },
      "cursorR": 20,
      "cursorL": 20,
      "color": "#7dd68a",
      "cyclePattern": "note(\"c d e f g a b c5\")",
      "beatsPerCycle": 8,
      "patternRepeats": 1
    }
  ],
  "triggers": [
    {
      "id": "TRG1",
      "x": 500,
      "y": 200,
      "note": 60,
      "color": "#7db8d6",
      "canBeHit": true,
      "beenHitFunction": "beenHit_TRG1"
    }
  ],
  "sprites": []
}
```

This scene has an ellipse curve sweeping a scale, and a trigger at the top of the canvas that fires when the curve's cursor crosses it. The trigger's `beenHitFunction` references a function defined in `behaviours.js` that emits note(s) on each crossing.
