# AGENTS.md — GeoSonel composition mirror

This folder is the **composition mirror** for an open GeoSonel score. GeoSonel (internal codename GXW) is a 2D scene-based generative music application. The user composes by placing curves, triggers, and sprites on a canvas; each object's pattern fires when its cursor sweeps through the scene, when another object's cursor crosses it, or both. Sound is produced via MIDI to external synths or via Strudel's superdough audio engine.

The mirror exists so an AI assistant — typically Claude Desktop with a filesystem MCP server pointed at this folder — can observe and edit the user's current score by reading and writing these files. The user is authoritative. The AI is a slower, more deliberate collaborator working from the user's instructions; the user always has the final say.

For deeper conceptual material on curves, cursors, sprites, triggers, cyclePattern semantics, the collision model, the simulation tick model, transport and tempo, and the pattern language, the source of truth is `DESIGN.md` in the GXW repo (typically at `~/ProgrammingProjects/GXW/design/DESIGN.md`). This file covers only what an AI needs to know to participate in the mirror protocol safely. When you need depth, read DESIGN.md.

## Mirror folder

The folder is at `~/Library/Application Support/GeoSonel/Active/` on macOS. It is created when the user enables the mirror in GeoSonel's Settings, cleared when the user disables it, and emptied and refilled when the user switches scores. The user does not edit files in this folder directly; the in-memory bundle inside GeoSonel is the source of truth, and the mirror's files are projected from it.

`isLive` in `active-score.json` is `true` while GeoSonel is running and `false` after the app has quit. An AI reading the folder while the app is closed sees stale data; check `isLive` before assuming the user is at the keyboard.

## File inventory

The folder contains two kinds of file: round-trip files that the AI may edit (the bundle accepts AI edits, validates them, and applies them back to its in-memory state) and observation-only files that the bundle writes and the AI reads but cannot modify.

**Round-trip files:**

- `scene.json` — composition data: object positions, geometries, patterns, score-level harmony. Schema documented in `sceneSchema.md`.
- `behaviours.js` — per-object JavaScript callback code (`hasHit_<id>`, `beenHit_<id>`, `onTick_<id>` for each object that opts in).
- the score's image file (varies by name, e.g. `tofes.jpg`) — the background image. **See "Image replacement" below.**

**Observation-only files:**

- `active-score.json` — protocol metadata: score identity, sync timestamp, current transport snapshot, files lists, and the result of the most recent AI-edit batch.
- `runtime-state.json` — simulation-side state at the moment of the last at-rest capture. Schema below.
- `sceneSchema.md` — scene.json reference, generated from `src/sceneSchema.js` in the repo.
- `AGENTS.md` — this file.

The files lists inside `active-score.json` are the protocol-level declaration of which file is which; trust those over this prose if they ever disagree.

## active-score.json

The first file to read on any new conversation. Top-level shape:

```json
{
  "protocolVersion": 1,
  "isLive": true,
  "score": {
    "displayName": "Tofes 17",
    "path": "/Users/chrisgr/Documents/Geosonix Scores/Tofes 17.gxs",
    "dirty": false
  },
  "sync": { "lastSyncAt": "2026-05-25T15:30:00.000Z" },
  "transport": {
    "state": "paused",
    "elapsedSeconds": 12.34,
    "beat": 8,
    "bpm": 120
  },
  "files": {
    "roundTrip": ["scene.json", "behaviours.js", "tofes.jpg"],
    "observationOnly": ["active-score.json", "runtime-state.json", "sceneSchema.md", "AGENTS.md"]
  },
  "lastApplyResult": null
}
```

`score.path` is `null` for an Untitled bundle the user has not saved yet. `score.dirty` indicates unsaved changes in the in-memory bundle. `transport.state` is `"playing"`, `"paused"`, or `"stopped"`; `beat` and `bpm` are `null` for time-based pieces with no tempo set.

`lastApplyResult` is `null` until the round-trip validation pipeline (Phase 1B) lands. When that pipeline ships, this field will carry the result of the most recent AI-edit batch — an `appliedAt` timestamp, a `status` (`"accepted"` or `"rejected"`), a `summary` string, and an `errors` array with file path, error kind, and detail for each failure. Until then, AI edits to round-trip files are not yet automatically applied; the bundle's pipeline for receiving AI writes is under development.

## runtime-state.json

Captures simulation-side state that scene.json does not carry: where sprites have moved under physics, where cursors currently sit on curves, the transport time and beat at the moment of capture. Captured at-rest only — when the transport is stopped or paused. The file is overwritten on each capture; there is no time series.

Shape:

```json
{
  "protocolVersion": 1,
  "capturedAt": "2026-05-25T15:30:00.000Z",
  "transport": {
    "state": "paused",
    "elapsedSeconds": 12.34,
    "elapsedBeats": 24,
    "musicalPosition": { "bars": 6, "beats": 0, "ticks": 0 },
    "bpm": 120
  },
  "sprites": [
    {
      "id": "SPR1",
      "position": { "x": 524.3, "y": 187.9 },
      "velocity": { "vx": 1.2, "vy": -0.4 },
      "cycle": { "count": 6, "progress": 0.25 }
    }
  ],
  "curves": [
    {
      "id": "CRV1",
      "offset": { "dx": 0, "dy": 0 },
      "halted": false,
      "cycle": { "count": 3, "progress": 0.5 },
      "cursor": { "t": 0.5, "x": 500, "y": 800 }
    }
  ]
}
```

Triggers are intentionally omitted since they do not move; scene.json fully describes their state.

A curve's `cursor` is `null` when the shape cannot be sampled — usually a degenerate piste (fewer than two points) or a not-yet-implemented shape type (`bezier`, `helice`). The cursor `x`, `y` are world coordinates including the runtime offset; the `t` is the parameter in `[0, 1]` along the authored shape.

`musicalPosition` is `null` for time-based pieces or when no time signature is set.

## Coordinate system

All positions in `scene.json` and the position fields in `runtime-state.json` are in **image space**: an abstract 1000x1000 coordinate grid. Image space is independent of the user's viewport size, zoom level, or window resolution. AI edits should always use image-space coordinates. Never assume pixel coordinates from the canvas's current render size.

A curve's authored shape uses image-space coordinates. At runtime the curve may have a physics offset (`offset.dx`, `offset.dy` in runtime-state.json); the displayed position is `(authored + offset)`. The cursor world coordinates in runtime-state.json already include the offset; the `t` parameter is along the authored shape.

## Image replacement is destructive

The score's image is often the compositional starting point. Replacing it (writing a new file under the same name, or writing a file under a new name and updating `imageName` in scene.json) is a destructive edit that can fundamentally change what the score is "about." Treat image edits as user-only territory unless the user has explicitly asked for an image replacement and confirmed it. When you are uncertain, ask before touching the image file.

The image lives in `files.roundTrip` in active-score.json so the protocol permits AI replacement, but the permission is much narrower in practice than for scene.json or behaviours.js edits.

## Editing scene.json

Use `sceneSchema.md` (in this folder) as the field-by-field reference. The bundle validates AI-edited scene.json against `src/sceneSchema.js` (the authoritative source the .md is derived from). A failing edit is rejected as a whole batch — the in-memory state is not changed, the mirror is rewritten with the last-known-good content, and `lastApplyResult` in active-score.json carries the failure detail.

Object IDs (`CRV1`, `TRG2`, etc.) are referenced by callback function names in `behaviours.js` (e.g. `hasHit_CRV1`). Renaming an ID without renaming the matching callback breaks the binding silently. When restructuring IDs, update both files in the same batch.

## Editing behaviours.js

`behaviours.js` holds per-object JavaScript callback functions. Function names follow the convention `<slot>_<id>`: `hasHit_CRV1` is the hit-emitter for curve `CRV1`, `beenHit_TRG3` is the hit-receiver for trigger `TRG3`, `onTick_SPR2` is the per-tick callback for sprite `SPR2`. Whether a callback fires depends on the matching gate boolean on the object (`canHit`, `canBeHit`, `canTick`) plus the function name being resolvable.

The callback execution context (the `ctx` parameter), pattern-emission API, and the modulatable-parameter machinery are described in `DESIGN.md` Section 9 (Behaviour Slots) and Section 10 (Pattern Language). Read those before authoring substantial behaviour code.

`behaviours.js` is parsed with Acorn before being applied. Syntax errors reject the batch with the parser's line, column, and message in `lastApplyResult`.

## Atomic write protocol

Files in this folder use temp-and-rename atomic writes. When the bundle pushes content, it writes `scene.json.tmp` then renames to `scene.json`; an AI watching `scene.json` directly never sees a torn write. AIs editing round-trip files should follow the same pattern: write `scene.json.tmp` first, then rename, so the bundle's watcher sees an atomic transition.

For batches that touch more than one round-trip file or include slow operations (image generation), write a `.pending` sentinel file in this folder *before* the batch and remove it *after*. The bundle's watcher then waits for `.pending` to disappear before applying the batch as a unit. A `.pending` file older than 60 seconds is treated as orphaned and removed.

Note: the round-trip watcher and validation pipeline are part of Phase 1B and not yet implemented. AI edits to round-trip files in the current Phase 1A do not flow back into the bundle automatically. Atomic-write habits are still worth following so the protocol works correctly once Phase 1B ships.

## When in doubt

Ask the user. They drive the work; the AI carries it out. Three patterns worth keeping:

- When an edit could be destructive (image replacement, removing objects, large structural changes), confirm before writing.
- When a request is ambiguous about which object or which behaviour, ask which one rather than guessing.
- When validation rejects a batch, share the `lastApplyResult` details with the user and propose the fix; do not silently retry with a guess.

The user's gesture is always authoritative. If the user switches scores while an AI batch is in flight, that batch is cancelled — the user moved on.

## Going deeper

`DESIGN.md` in the GXW repo is the comprehensive design reference. Its section index covers:

- Conceptual model (Sections 1–2)
- Scene structure, curves, triggers, sprites (Sections 3–6)
- Transport and tempo (Section 7)
- Collision model (Section 8)
- Behaviour slots and `behaviours.js` (Section 9)
- Pattern language (Section 10)
- Score orchestration and harmony (Section 11)
- Pattern engine (Section 12)
- User interface and canvas (Sections 13, 13.5)
- Authoring workflow (Section 14)
- The disk mirror (Section 15 — this protocol)
- Score bundle (Section 16)
- Audio and MIDI output (Section 19)
- Coordinate system (Section 21)
- Sprite physics (Section 22)

If you have filesystem access to the GXW repo, read the relevant section before any non-trivial design discussion with the user. If you do not, ask the user to share the section.
