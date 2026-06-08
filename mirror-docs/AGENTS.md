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
- `script.js` — per-object JavaScript callback code (`onActiveBeat_<id>`, `onTick_<id>`, `hasCollided_<id>`, `beenTriggered_<id>`, `autoMessage_<id>` for each object that opts in).
- the score's image file (varies by name, e.g. `tofes.jpg`) — the background image. **See "Image replacement" below.**

**Observation-only files:**

- `active-score.json` — protocol metadata: score identity, sync timestamp, current transport snapshot, files lists.
- `runtime-state.json` — simulation-side state at the moment of the last at-rest capture. Schema below.
- `focus.json` — the user's current text-cursor location in the Script editor: the deictic "this" pointer. Schema below.
- `last-apply-result.json` — outcome of the most recent AI-edit batch (success or rejection with details). Schema below.
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
    "roundTrip": ["scene.json", "script.js", "tofes.jpg"],
    "observationOnly": ["active-score.json", "runtime-state.json", "focus.json", "last-apply-result.json", "sceneSchema.md", "AGENTS.md"]
  }
}
```

`score.path` is `null` for an Untitled bundle the user has not saved yet. `score.dirty` indicates unsaved changes in the in-memory bundle. `transport.state` is `"playing"`, `"paused"`, or `"stopped"`; `beat` and `bpm` are `null` for time-based pieces with no tempo set.

## last-apply-result.json

Written by GeoSonel after every AI-edit batch — success or rejection — so an AI reading the folder can find out whether its last edit was accepted, and if not, why. The file does not exist until the first batch lands; an AI reading the mirror folder before any batch has been processed will see it absent.

Success shape:

```json
{
  "status": "success",
  "timestamp": "2026-05-26T22:15:33.412Z",
  "applied": ["scene.json", "script.js"]
}
```

Rejection shape:

```json
{
  "status": "rejected",
  "timestamp": "2026-05-26T22:15:33.412Z",
  "filename": "scene.json",
  "error": "Expected double-quoted property name in JSON at position 613"
}
```

The `applied` list on success reflects what actually landed in the bundle, in mirror-surface naming. The `filename` and `error` on rejection identify the first file that failed validation — GeoSonel short-circuits on the first failure, so a rejection record describes one specific problem rather than every problem in the batch. When a batch is rejected, the bundle's last-known-good state is force-pushed back to the mirror folder, so the round-trip files (`scene.json`, `script.js`, the image) revert to their pre-batch content within the same write window that produces this file.

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

## focus.json

The user's current text-cursor location in the Script editor — the **deictic "this" pointer**. When the user is working with you in Claude Desktop they can't hover the canvas or point at code on their screen, so they place the text caret on the code they mean and refer to it ("what does this do?", "change this", "why is this firing twice?"). Read focus.json to resolve that "this".

Updated (debounced) whenever the caret or selection moves in the Script tab. When the user is on any other tab, `focus` is `null` — there is no active code pointer. The file is written only in the Electron build; in environments without the editor it stays absent.

Shape:

```json
{
  "protocolVersion": 1,
  "capturedAt": "2026-06-08T15:30:00.000Z",
  "focus": {
    "function": "onActiveBeat_CRV2",
    "expression": "this.col.r",
    "selection": null,
    "caret": { "line": 4, "column": 17, "offset": 92 },
    "lineText": "    playNote(60 + this.col.r * 12, this.vel)",
    "range": { "from": 86, "to": 96 }
  }
}
```

- `function` — the name of the callback function enclosing the caret, or `null` if the caret is at top level / outside any function. This tells you *which object's behaviour* the user is pointing at (the `_<id>` suffix identifies the object).
- `expression` — the identifier or member expression directly under the caret (e.g. hovering anywhere in `this.col.r` yields the whole chain), or `null` if the caret isn't on an expression. This is the most likely referent of "this".
- `selection` — the selected text if the user has a non-empty selection, else `null`. A selection is a stronger, more explicit pointer than the caret expression; prefer it when present.
- `caret` — `line` and `column` are 1-based; `offset` is the 0-based document character offset.
- `lineText` — the full text of the caret's line, for context.
- `range` — document offsets `{from, to}` of `expression`, or `null`.

`focus` is `null` (no active pointer) when the user is off the Script tab, or when the caret sits on blank space outside any function with nothing selected. Treat a `null` focus as "the user hasn't pointed at anything specific" — fall back to asking which object or which code they mean.

## Coordinate system

All positions in `scene.json` and the position fields in `runtime-state.json` are in **image space**: an abstract 1000x1000 coordinate grid. Image space is independent of the user's viewport size, zoom level, or window resolution. AI edits should always use image-space coordinates. Never assume pixel coordinates from the canvas's current render size.

A curve's authored shape uses image-space coordinates. At runtime the curve may have a physics offset (`offset.dx`, `offset.dy` in runtime-state.json); the displayed position is `(authored + offset)`. The cursor world coordinates in runtime-state.json already include the offset; the `t` parameter is along the authored shape.

## Image replacement is destructive

The score's image is often the compositional starting point. Replacing it (writing a new file under the same name, or writing a file under a new name and updating `imageName` in scene.json) is a destructive edit that can fundamentally change what the score is "about." Treat image edits as user-only territory unless the user has explicitly asked for an image replacement and confirmed it. When you are uncertain, ask before touching the image file.

The image lives in `files.roundTrip` in active-score.json so the protocol permits AI replacement, but the permission is much narrower in practice than for scene.json or script.js edits.

## Editing scene.json

Use `sceneSchema.md` (in this folder) as the field-by-field reference. The bundle validates AI-edited scene.json against `src/sceneSchema.js` (the authoritative source the .md is derived from). A failing edit is rejected as a whole batch — the in-memory state is not changed, the mirror is rewritten with the last-known-good content, and `last-apply-result.json` carries the failure detail.

Object IDs (`CRV1`, `TRG2`, etc.) are referenced by callback function names in `script.js` (e.g. `onActiveBeat_CRV1`). Renaming an ID without renaming the matching callback breaks the binding silently. When restructuring IDs, update both files in the same batch.

## Editing script.js

`script.js` holds per-object JavaScript callback functions. Function names follow the convention `<slot>_<id>`. The slots are:

- `onActiveBeat_<id>` — fires when a cursor crosses one of this object's active beat points (curves and sprites). Gated by `canActiveBeat`.
- `onTick_<id>` — fires every simulation control tick (~60 Hz) while the object is live. Gated by `canTick`.
- `hasCollided_<id>` — fires on this object when it collides with another. Gated by `canCollide`.
- `beenTriggered_<id>` — fires when another object's cursor crosses this one. Gated by `canBeTriggered`.
- `autoMessage_<id>` — fires at the object's Automessage Interval. Gated by `canAutoMessage`.

So `onActiveBeat_CRV2` is the active-beat callback for curve `CRV2`. Whether a callback fires depends on the matching gate boolean on the object plus the function name being resolvable in `script.js`.

Callbacks take **no parameters**. Inside the body, `this` is bound to the firing object's context: `this.vel` / `this.velocity` (beat strength rescaled to 0–1), `this.col.*` (colour signals under the firing point — `r`, `g`, `b`, `y`, `or`, `li`, `cy`, `pu`, `lt`, `chr`), plus other per-slot fields. Sound is emitted with **bare** emitter calls (no `this.` prefix): `playNote(note, vel?, dur?, pan?)`, `playSound(sample, vel?)`, `applyForce(...)`. `playNote("xylophone", 60)` with a leading string overrides the instrument. The pattern-emission API is described in `DESIGN.md` Section 9 (Behaviour Slots) and Section 10 (Pattern Language). Read those before authoring substantial behaviour code.

`script.js` is parsed with Acorn before being applied. Syntax errors reject the batch with the parser's message in `last-apply-result.json`.

## Atomic write protocol

Files in this folder use temp-and-rename atomic writes. When the bundle pushes content, it writes `script.js.tmp` then renames to `script.js`; an AI watching `script.js` directly never sees a torn write. AIs editing round-trip files **must** follow the same pattern: write `script.js.tmp` first, then rename, so the bundle's watcher sees a single atomic transition rather than a partial file.

That atomic write is all the protocol needs. A completed rename of a round-trip file (`scene.json`, `script.js`, image) is itself the signal to GeoSonel that an AI has proposed a change. GeoSonel debounces briefly (a fraction of a second) so that several files written back-to-back coalesce into one batch, then surfaces the change to the user in the confirm-to-apply dialog. There is no separate "start" handshake to perform — just write the file(s).

**No `.pending` sentinel is required.** Earlier versions of this protocol required creating a `.pending` marker file before writing. That is no longer necessary: a bare atomic write to a round-trip file is processed on its own. (The `.pending` sentinel is still honoured if present — it lets an AI explicitly bracket a multi-file batch that spans more than the debounce window — but for the normal case of editing one file, do not bother with it. Just write the file.)

To make several related edits land as one batch, write all the affected files within roughly a third of a second of each other; the debounce groups them. For edits that take longer to produce, you may still create an empty `.pending` file first and remove it when done — while `.pending` exists, GeoSonel accumulates writes and only applies them when you remove it.

After GeoSonel processes a batch it writes `last-apply-result.json` (see above) with the outcome. Read it to confirm your edit was accepted, or to get the validation error if it was rejected.

If the user clicks Cancel in the confirm-to-apply dialog, your proposed change is discarded and the bundle's last-known-good state is force-pushed back to the mirror, so the round-trip files revert to their pre-edit content. Re-read the files before proposing anything further.

## When in doubt

Ask the user. They drive the work; the AI carries it out. Three patterns worth keeping:

- When an edit could be destructive (image replacement, removing objects, large structural changes), confirm before writing.
- When a request is ambiguous about which object or which behaviour, ask which one rather than guessing.
- When validation rejects a batch, share the `last-apply-result.json` details with the user and propose the fix; do not silently retry with a guess.

The user's gesture is always authoritative. If the user switches scores while an AI batch is in flight, that batch is cancelled — the user moved on.

## Going deeper

`DESIGN.md` in the GXW repo is the comprehensive design reference. Its section index covers:

- Conceptual model (Sections 1–2)
- Scene structure, curves, triggers, sprites (Sections 3–6)
- Transport and tempo (Section 7)
- Collision model (Section 8)
- Behaviour slots and `script.js` (Section 9)
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
